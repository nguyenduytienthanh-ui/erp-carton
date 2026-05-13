from django.db.models import Count
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    QualityDefectCatalog,
    QualityImageArtifact,
    QualityImageRetentionPolicy,
    QualityInspection,
    QualityInspectionDefect,
    QualityStorageCleanupRun,
    QualityStorageSettings,
    VisionInspectionJob,
)
from .permissions import (
    can_create_quality,
    can_manage_quality_catalog,
    can_manage_quality_storage,
    can_override_quality,
    can_review_quality,
    can_submit_quality,
    can_view_quality,
)
from .serializers import (
    QualityDefectCatalogSerializer,
    QualityImageArtifactSerializer,
    QualityImageRetentionPolicySerializer,
    QualityInspectionDefectSerializer,
    QualityInspectionDetailSerializer,
    QualityInspectionLineSerializer,
    QualityInspectionSerializer,
    QualityStorageCleanupRunSerializer,
    QualityStorageSettingsSerializer,
    VisionInspectionJobSerializer,
)
from .services import (
    create_inspection_from_operation,
    create_quality_audit,
    create_vision_job,
    ensure_default_checklist_lines,
    generate_inspection_code,
    override_inspection_result,
    pin_image_artifact,
    review_inspection,
    run_cleanup_dry_run,
    submit_inspection_result,
    unpin_image_artifact,
    update_checklist_lines,
)


def _ensure_permission(user, allowed, message):
    if not allowed(user):
        raise PermissionDenied(message)


class QualityInspectionViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = QualityInspectionSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']
    ordering_fields = ['created_at', 'updated_at', 'code', 'status', 'result']
    ordering = ['-created_at', '-id']

    def get_queryset(self):
        _ensure_permission(self.request.user, can_view_quality, 'Bạn không có quyền xem QC.')
        queryset = (
            QualityInspection.objects
            .select_related(
                'product',
                'sales_order',
                'sales_order_line',
                'production_order',
                'production_operation',
                'inspector',
                'reviewed_by',
            )
            .prefetch_related('lines', 'defects', 'vision_jobs', 'image_artifacts')
            .annotate(line_count=Count('lines', distinct=True), defect_count=Count('defects', distinct=True))
        )
        params = self.request.query_params
        for field_name in ['status', 'result', 'inspection_type', 'operation_code', 'machine_code', 'work_center_code']:
            raw_value = str(params.get(field_name) or '').strip()
            if raw_value:
                queryset = queryset.filter(**{field_name: raw_value})
        product_code = str(params.get('product_code') or '').strip()
        if product_code:
            queryset = queryset.filter(product__code__icontains=product_code)
        production_order_code = str(params.get('production_order_code') or '').strip()
        if production_order_code:
            queryset = queryset.filter(production_order__code__icontains=production_order_code)
        return queryset

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return QualityInspectionDetailSerializer
        return QualityInspectionSerializer

    def perform_create(self, serializer):
        _ensure_permission(self.request.user, can_create_quality, 'Bạn không có quyền tạo QC.')
        inspection = serializer.save(
            code=generate_inspection_code(),
            inspector=self.request.user,
            created_by=self.request.user,
            updated_by=self.request.user,
        )
        ensure_default_checklist_lines(inspection)
        create_quality_audit(
            self.request.user,
            action='QC_CREATE',
            entity_type='QualityInspection',
            entity_id=inspection.id,
            entity_code=inspection.code,
            new_values={'inspection_type': inspection.inspection_type},
            changed_fields=['inspection_type'],
        )

    @action(detail=False, methods=['post'], url_path='create-from-operation')
    def create_from_operation(self, request):
        inspection, created = create_inspection_from_operation(
            operation_id=request.data.get('production_operation_id') or request.data.get('operation_id'),
            user=request.user,
        )
        serializer = QualityInspectionDetailSerializer(inspection, context={'request': request})
        response_status = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        return Response({'created': created, 'inspection': serializer.data}, status=response_status)

    @action(detail=True, methods=['post'], url_path='lines/bulk-update')
    def bulk_update_lines(self, request, pk=None):
        _ensure_permission(
            request.user,
            lambda user: can_create_quality(user) or can_submit_quality(user),
            'Bạn không có quyền cập nhật checklist QC.',
        )
        inspection = self.get_object()
        updated = update_checklist_lines(
            inspection=inspection,
            items=request.data.get('items') or [],
            user=request.user,
        )
        serializer = QualityInspectionLineSerializer(updated, many=True)
        return Response({'count': len(updated), 'results': serializer.data})

    @action(detail=True, methods=['post'], url_path='submit-result')
    def submit_result(self, request, pk=None):
        inspection = submit_inspection_result(
            inspection=self.get_object(),
            result=request.data.get('result'),
            user=request.user,
            notes=request.data.get('notes') or '',
        )
        return Response(QualityInspectionDetailSerializer(inspection, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        inspection = review_inspection(
            inspection=self.get_object(),
            user=request.user,
            notes=request.data.get('notes') or '',
        )
        return Response(QualityInspectionDetailSerializer(inspection, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def override(self, request, pk=None):
        inspection = override_inspection_result(
            inspection=self.get_object(),
            result=request.data.get('result'),
            user=request.user,
            reason=request.data.get('reason') or '',
        )
        return Response(QualityInspectionDetailSerializer(inspection, context={'request': request}).data)


class QualityDefectCatalogViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = QualityDefectCatalogSerializer
    queryset = QualityDefectCatalog.objects.all()
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        _ensure_permission(self.request.user, can_view_quality, 'Bạn không có quyền xem QC.')
        queryset = super().get_queryset()
        active = self.request.query_params.get('is_active')
        if active in {'true', 'false'}:
            queryset = queryset.filter(is_active=(active == 'true'))
        return queryset

    def perform_create(self, serializer):
        _ensure_permission(self.request.user, can_manage_quality_catalog, 'Bạn không có quyền quản lý danh mục lỗi QC.')
        serializer.save()

    def perform_update(self, serializer):
        _ensure_permission(self.request.user, can_manage_quality_catalog, 'Bạn không có quyền quản lý danh mục lỗi QC.')
        serializer.save()


class QualityInspectionDefectViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = QualityInspectionDefectSerializer
    queryset = QualityInspectionDefect.objects.select_related('inspection', 'defect', 'created_by')
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        _ensure_permission(self.request.user, can_view_quality, 'Bạn không có quyền xem QC.')
        queryset = super().get_queryset()
        inspection_id = self.request.query_params.get('inspection')
        if inspection_id:
            queryset = queryset.filter(inspection_id=inspection_id)
        return queryset

    def perform_create(self, serializer):
        _ensure_permission(self.request.user, can_create_quality, 'Bạn không có quyền tạo lỗi QC.')
        defect = serializer.save(created_by=self.request.user)
        create_quality_audit(
            self.request.user,
            action='QC_DEFECT_ADD',
            entity_type='QualityInspection',
            entity_id=defect.inspection_id,
            entity_code=defect.inspection.code,
            new_values={'defect_code': defect.defect_code, 'severity': defect.severity},
            changed_fields=['defects'],
        )


class VisionInspectionJobViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = VisionInspectionJobSerializer
    queryset = VisionInspectionJob.objects.select_related('inspection', 'requested_by').all()
    http_method_names = ['get', 'post', 'head', 'options']
    lookup_field = 'job_id'

    def get_queryset(self):
        _ensure_permission(self.request.user, can_view_quality, 'Bạn không có quyền xem QC.')
        return super().get_queryset()

    def create(self, request, *args, **kwargs):
        _ensure_permission(request.user, can_create_quality, 'Bạn không có quyền tạo vision job.')
        inspection_id = request.data.get('inspection')
        try:
            inspection = QualityInspection.objects.get(pk=inspection_id)
        except QualityInspection.DoesNotExist:
            return Response({'inspection': 'Inspection not found.'}, status=status.HTTP_404_NOT_FOUND)
        job = create_vision_job(
            inspection=inspection,
            user=request.user,
            payload=request.data.get('request_payload') or {},
        )
        serializer = self.get_serializer(job)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class QualityImageArtifactViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = QualityImageArtifactSerializer
    queryset = QualityImageArtifact.objects.select_related('inspection', 'job', 'retention_policy', 'pinned_by')

    def get_queryset(self):
        _ensure_permission(self.request.user, can_view_quality, 'Bạn không có quyền xem QC.')
        queryset = super().get_queryset()
        inspection_id = self.request.query_params.get('inspection')
        if inspection_id:
            queryset = queryset.filter(inspection_id=inspection_id)
        return queryset

    @action(detail=True, methods=['post'])
    def pin(self, request, pk=None):
        _ensure_permission(request.user, can_manage_quality_storage, 'Bạn không có quyền giữ lại ảnh QC.')
        artifact = pin_image_artifact(
            artifact=self.get_object(),
            user=request.user,
            reason=request.data.get('reason') or '',
        )
        return Response(self.get_serializer(artifact).data)

    @action(detail=True, methods=['post'])
    def unpin(self, request, pk=None):
        _ensure_permission(request.user, can_manage_quality_storage, 'Bạn không có quyền bỏ giữ ảnh QC.')
        artifact = unpin_image_artifact(artifact=self.get_object(), user=request.user)
        return Response(self.get_serializer(artifact).data)


class QualityImageRetentionPolicyViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = QualityImageRetentionPolicySerializer
    queryset = QualityImageRetentionPolicy.objects.all()
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        _ensure_permission(self.request.user, can_view_quality, 'Bạn không có quyền xem QC.')
        queryset = super().get_queryset()
        image_type = self.request.query_params.get('image_type')
        result_status = self.request.query_params.get('result_status')
        if image_type:
            queryset = queryset.filter(image_type=image_type)
        if result_status:
            queryset = queryset.filter(result_status=result_status)
        return queryset

    def perform_create(self, serializer):
        _ensure_permission(self.request.user, can_manage_quality_storage, 'Bạn không có quyền quản lý lưu trữ QC.')
        serializer.save()

    def perform_update(self, serializer):
        _ensure_permission(self.request.user, can_manage_quality_storage, 'Bạn không có quyền quản lý lưu trữ QC.')
        serializer.save()


class QualityStorageSettingsViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def _get_settings(self):
        settings_obj, _created = QualityStorageSettings.objects.get_or_create(singleton_key='default')
        return settings_obj

    def list(self, request):
        _ensure_permission(request.user, can_view_quality, 'Bạn không có quyền xem QC.')
        return Response(QualityStorageSettingsSerializer(self._get_settings()).data)

    @action(detail=False, methods=['patch', 'put'], url_path='update')
    def update_settings(self, request):
        _ensure_permission(request.user, can_manage_quality_storage, 'Bạn không có quyền quản lý lưu trữ QC.')
        settings_obj = self._get_settings()
        serializer = QualityStorageSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        create_quality_audit(
            request.user,
            action='QC_STORAGE_SET',
            entity_type='QualityStorageSettings',
            entity_id=settings_obj.id,
            entity_code=settings_obj.singleton_key,
            new_values=serializer.data,
            changed_fields=list(serializer.validated_data.keys()),
        )
        return Response(serializer.data)


class QualityStorageCleanupViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = QualityStorageCleanupRunSerializer
    queryset = QualityStorageCleanupRun.objects.prefetch_related('items').all()

    def get_queryset(self):
        _ensure_permission(self.request.user, can_manage_quality_storage, 'Bạn không có quyền quản lý lưu trữ QC.')
        return super().get_queryset()

    @action(detail=False, methods=['post'], url_path='dry-run')
    def dry_run(self, request):
        cleanup_run = run_cleanup_dry_run(user=request.user, limit=int(request.data.get('limit') or 1000))
        serializer = self.get_serializer(cleanup_run)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
