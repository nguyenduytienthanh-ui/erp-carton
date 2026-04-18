from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from production.permissions import can_manage_production

from .models import PaperOptimizerRun, PaperOptimizerSupplierTemplate
from .serializers import (
    PaperOptimizerManualPatternRequestSerializer,
    PaperOptimizerOptimizeRequestSerializer,
    PaperOptimizerRunSerializer,
    PaperOptimizerRunSummarySerializer,
    PaperOptimizerTemplateSerializer,
)
from .services import (
    build_baseline_reference,
    build_benchmark_reference,
    build_default_input_lines,
    build_import_template_bytes,
    build_default_optimization_config,
    build_default_supplier_config,
    build_default_template_payload,
    build_export_workbook_bytes,
    create_run_code,
    evaluate_manual_pattern,
    normalize_result_payload_for_display,
    parse_preview_file,
    run_optimizer_recovery,
)


class PaperOptimizerSupplierTemplateViewSet(viewsets.ModelViewSet):
    serializer_class = PaperOptimizerTemplateSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not can_manage_production(request.user):
            self.permission_denied(request, message='Bạn không có quyền quản lý sản xuất để dùng Tối ưu ghép giấy.')

    def get_queryset(self):
        self._ensure_system_default()
        queryset = PaperOptimizerSupplierTemplate.objects.all()
        if self.request.user.is_staff or self.request.user.is_superuser:
            return queryset
        return queryset.filter(created_by=self.request.user) | queryset.filter(is_system_default=True)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        template = self.get_object()
        self._ensure_template_mutable(template)
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_template_mutable(instance)
        instance.delete()

    def _ensure_template_mutable(self, template: PaperOptimizerSupplierTemplate):
        if template.is_system_default:
            raise PermissionDenied('Template hệ thống chỉ được áp dụng hoặc nhân bản, không được sửa/xóa.')
        if template.created_by_id != self.request.user.id:
            raise PermissionDenied('Bạn chỉ được sửa hoặc xóa template do chính mình tạo.')

    def _ensure_system_default(self):
        if PaperOptimizerSupplierTemplate.objects.filter(is_system_default=True).exists():
            return
        payload = build_default_template_payload()
        PaperOptimizerSupplierTemplate.objects.create(
            name=payload['name'],
            note=payload['note'],
            supplier_config=payload['supplier_config'],
            optimization_config=payload['optimization_config'],
            is_system_default=True,
        )


class PaperOptimizerRunViewSet(viewsets.GenericViewSet):
    serializer_class = PaperOptimizerRunSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not can_manage_production(request.user):
            self.permission_denied(request, message='Bạn không có quyền quản lý sản xuất để dùng Tối ưu ghép giấy.')

    def get_queryset(self):
        queryset = PaperOptimizerRun.objects.all()
        if self.request.user.is_staff or self.request.user.is_superuser:
            return queryset
        return queryset.filter(created_by=self.request.user)

    def get_serializer_class(self):
        if self.action == 'list':
            return PaperOptimizerRunSummarySerializer
        return super().get_serializer_class()

    def list(self, request, *args, **kwargs):
        queryset = list(self.filter_queryset(self.get_queryset()))
        status_filter = str(request.query_params.get('status') or '').strip().upper()
        query = str(request.query_params.get('q') or '').strip().lower()
        canonical_match = self._parse_bool_query_param(request.query_params.get('canonical_match'))
        engine_fallback_used = self._parse_bool_query_param(request.query_params.get('engine_fallback_used'))

        if status_filter:
            queryset = [run for run in queryset if run.status == status_filter]
        if canonical_match is not None:
            queryset = [run for run in queryset if bool(run.canonical_match) is canonical_match]
        if engine_fallback_used is not None:
            queryset = [
                run
                for run in queryset
                if bool(
                    (
                        normalize_result_payload_for_display(
                            run.result_payload or {},
                            canonical_match=bool(run.canonical_match),
                        ).get('stats')
                        or {}
                    ).get('engine_fallback_used')
                ) is engine_fallback_used
            ]
        if query:
            queryset = [run for run in queryset if self._run_matches_query(run, query)]

        limit = self._parse_positive_int(request.query_params.get('limit'), default=12, minimum=1, maximum=100)
        offset = self._parse_positive_int(request.query_params.get('offset'), default=0, minimum=0, maximum=10_000)
        count = len(queryset)
        page = queryset[offset:offset + limit]
        serializer = self.get_serializer(page, many=True)
        return Response(
            {
                'count': count,
                'limit': limit,
                'offset': offset,
                'results': serializer.data,
            }
        )

    def retrieve(self, request, *args, **kwargs):
        run = self.get_object()
        return Response(self.get_serializer(run).data)

    @action(detail=False, methods=['get'])
    def defaults(self, request):
        return Response(
            {
                'input_lines': build_default_input_lines(),
                'supplier_config': build_default_supplier_config(),
                'optimization_config': build_default_optimization_config(),
                'baseline_reference': build_baseline_reference(),
                'benchmark_reference': build_benchmark_reference(),
            }
        )

    @action(detail=False, methods=['post'])
    def optimize(self, request):
        serializer = PaperOptimizerOptimizeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        run_code = create_run_code()
        source_filename = payload.get('source_filename') or ''
        note = payload.get('note') or ''
        try:
            result_payload = run_optimizer_recovery(
                input_lines=payload['input_lines'],
                supplier_config=payload['supplier_config'],
                optimization_config=payload['optimization_config'],
                source_filename=source_filename,
                note=note,
            )
        except Exception as exc:
            failed_reason = str(exc) or 'Không sinh được phương án tối ưu.'
            run = PaperOptimizerRun.objects.create(
                code=run_code,
                status=PaperOptimizerRun.STATUS_FAILED,
                source_filename=source_filename,
                note=note,
                input_lines=payload['input_lines'],
                supplier_config=payload['supplier_config'],
                optimization_config=payload['optimization_config'],
                preview_rows=payload['input_lines'],
                failed_reason=failed_reason,
                created_by=request.user,
            )
            return Response(self.get_serializer(run).data, status=status.HTTP_201_CREATED)

        run = PaperOptimizerRun.objects.create(
            code=run_code,
            status=PaperOptimizerRun.STATUS_SUCCESS,
            source_filename=result_payload['source_filename'],
            note=result_payload['note'],
            input_lines=result_payload['input_lines'],
            supplier_config=result_payload['supplier_config'],
            optimization_config=result_payload['optimization_config'],
            preview_rows=result_payload['input_lines'],
            result_payload=result_payload,
            recovery_mode=bool(result_payload.get('recovery_mode')),
            canonical_match=bool(result_payload.get('canonical_match')),
            created_by=request.user,
        )
        return Response(self.get_serializer(run).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def upload_preview(self, request):
        uploaded_file = request.FILES.get('file')
        if uploaded_file is None:
            return Response({'detail': 'Thiếu file tải lên.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            preview = parse_preview_file(uploaded_file)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(preview)

    @action(detail=False, methods=['post'])
    def evaluate_manual_pattern(self, request):
        serializer = PaperOptimizerManualPatternRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(evaluate_manual_pattern(serializer.validated_data))

    @action(detail=False, methods=['get'])
    def download_import_template(self, request):
        template_bytes = build_import_template_bytes()
        response = HttpResponse(template_bytes, content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="paper_optimizer_import_template.csv"'
        return response

    @action(detail=True, methods=['get'])
    def export_excel(self, request, pk=None):
        run = self.get_object()
        if run.status != PaperOptimizerRun.STATUS_SUCCESS or not run.result_payload:
            return Response(
                {'detail': 'Run thất bại không có workbook để tải.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result_payload = normalize_result_payload_for_display(
            run.result_payload or {},
            canonical_match=bool(run.canonical_match),
        )
        stats = result_payload.get('stats') or {}
        result_state = str(result_payload.get('result_state') or '').strip().lower()
        no_feasible_candidate = (
            result_state == 'no_feasible_candidate'
            or bool(stats.get('no_feasible_candidate'))
            or stats.get('displayable_result') is False
        )
        if no_feasible_candidate:
            return Response(
                {'detail': 'Run chưa có phương án mua cuối hợp lệ để xuất workbook.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        workbook_bytes = build_export_workbook_bytes(
            result_payload,
            canonical_match=run.canonical_match,
        )
        response = HttpResponse(
            workbook_bytes,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = f'attachment; filename=\"{run.code.lower()}.xlsx\"'
        return response

    def _parse_positive_int(self, raw_value, *, default: int, minimum: int, maximum: int) -> int:
        if raw_value in (None, ''):
            return default
        try:
            value = int(raw_value)
        except (TypeError, ValueError):
            return default
        return max(minimum, min(value, maximum))

    def _parse_bool_query_param(self, raw_value):
        if raw_value in (None, ''):
            return None
        normalized = str(raw_value).strip().lower()
        if normalized in {'1', 'true', 'yes'}:
            return True
        if normalized in {'0', 'false', 'no'}:
            return False
        return None

    def _run_matches_query(self, run: PaperOptimizerRun, query: str) -> bool:
        result_payload = normalize_result_payload_for_display(
            run.result_payload or {},
            canonical_match=bool(run.canonical_match),
        )
        selected_plan = result_payload.get('selected_plan') or {}
        haystack = ' '.join(
            str(value or '')
            for value in [
                run.code,
                run.source_filename,
                run.note,
                run.failed_reason,
                result_payload.get('selected_plan_code'),
                result_payload.get('selected_scenario_code'),
                selected_plan.get('plan_name'),
            ]
        ).lower()
        return query in haystack
