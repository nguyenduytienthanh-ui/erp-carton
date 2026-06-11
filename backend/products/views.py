from io import BytesIO
import os
import uuid
from decimal import Decimal, ROUND_HALF_UP

from django.db import IntegrityError
from django.db.models import ProtectedError
from django.db.models import Q, Count, Case, When, Value, IntegerField, Exists, OuterRef, Subquery, DateTimeField, DecimalField, Prefetch
from django.conf import settings
from django.core.files.storage import default_storage
from django.http import HttpResponse
from openpyxl import Workbook
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from core.filters import ProductFilter
from core.mixins import ExportExcelMixin, get_client_ip
from core.models import AuditLog, Task as CoreTask
from core.permissions import check_action_permission
from rest_framework.exceptions import ValidationError as DRFValidationError
from .filters import (
    ProductCategoryFilter,
    ProductUnitFilter,
    ProductWaveFilter,
    ProductBoxTypeFilter,
    OperationFilter,
)
from .models import Operation, ProductCategory, ProductUnit, ProductWave, ProductBoxType, Product, ProductOperation, ProductRoutingStep, ProductBundle, PriceChange, BundlePriceChange
from .price_services import (
    activate_due_price_changes,
    activate_due_bundle_price_changes,
    approve_price_change as approve_price_change_service,
    approve_bundle_price_change as approve_bundle_price_change_service,
    merge_price_values,
    record_direct_price_change,
    submit_bundle_price_change_request,
    resolve_product_price_as_of,
    submit_price_change_request,
)
from .readiness import build_product_routing_readiness
from .serializers import (
    ProductCategorySerializer,
    ProductUnitSerializer,
    ProductWaveSerializer,
    ProductBoxTypeSerializer,
    OperationSerializer,
    ProductSerializer,
    ProductBundleSerializer,
    PriceChangeSerializer,
    BundlePriceChangeSerializer,
)


class ProductCategoryViewSet(ExportExcelMixin, viewsets.ModelViewSet):
    """
    CRUD ProductCategory (Master Data chuẩn).
    filterset + search + ordering + bulk + pagination + export template.
    Ví dụ: /api/product-categories?search=giay&is_active=true&ordering=code&created_at__gte=2025-01-01
    """

    queryset = ProductCategory.objects.all()
    serializer_class = ProductCategorySerializer
    permission_classes = [IsAuthenticated]
    export_template_entity_type = 'ProductCategory'

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ProductCategoryFilter
    search_fields = ['code', 'name', 'description']
    ordering_fields = ['code', 'name', 'sort_order', 'created_at']
    ordering = ['sort_order', 'code']

    def get_queryset(self):
        qs = super().get_queryset()
        return qs.filter(deleted_at__isnull=True)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.save()

    @action(detail=False, methods=['get'])
    def tree(self, request):
        """Lấy cây danh mục"""
        roots = self.get_queryset().filter(parent__isnull=True, is_active=True)
        serializer = self.get_serializer(roots, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        if not check_action_permission(request.user, 'ProductCategory', 'EDIT', strict=True):
            return Response({'error': 'Không có quyền kích hoạt'}, status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get('ids', [])
        ProductCategory.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=True)
        return Response({'message': f'Đã kích hoạt {len(ids)} danh mục'})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        if not check_action_permission(request.user, 'ProductCategory', 'EDIT', strict=True):
            return Response({'error': 'Không có quyền vô hiệu hóa'}, status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get('ids', [])
        ProductCategory.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=False)
        return Response({'message': f'Đã vô hiệu hóa {len(ids)} danh mục'})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        now = timezone.now()
        ProductCategory.objects.filter(id__in=ids).update(
            deleted_at=now, deleted_by=request.user
        )
        return Response({'message': f'Đã xóa (soft) {len(ids)} danh mục'})

    def get_export_sheet_title(self):
        return 'Danh mục sản phẩm'

    def get_export_filename(self):
        return 'danh_muc_san_pham.xlsx'

    def get_export_headers(self):
        return ['Mã', 'Tên', 'Mô tả', 'Đang dùng', 'Thứ tự', 'Ngày tạo']

    def get_export_row(self, obj):
        return [
            obj.code or '',
            obj.name or '',
            (obj.description or '')[:200],
            'Có' if obj.is_active else 'Không',
            obj.sort_order or 0,
            obj.created_at.strftime('%Y-%m-%d') if obj.created_at else '',
        ]


class ProductUnitViewSet(ExportExcelMixin, viewsets.ModelViewSet):
    """
    CRUD ProductUnit (Master Data chuẩn).
    /api/product-units?search=CAI&is_active=true&ordering=code&created_at__gte=2025-01-01
    """

    queryset = ProductUnit.objects.all()
    serializer_class = ProductUnitSerializer
    permission_classes = [IsAuthenticated]
    export_template_entity_type = 'ProductUnit'

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ProductUnitFilter
    search_fields = ['code', 'name']
    ordering_fields = ['code', 'name', 'sort_order', 'created_at']
    ordering = ['sort_order', 'code']

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.save()

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        if not check_action_permission(request.user, 'ProductUnit', 'EDIT', strict=True):
            return Response({'error': 'Không có quyền'}, status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get('ids', [])
        ProductUnit.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=True)
        return Response({'message': f'Đã kích hoạt {len(ids)} đơn vị'})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        if not check_action_permission(request.user, 'ProductUnit', 'EDIT', strict=True):
            return Response({'error': 'Không có quyền'}, status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get('ids', [])
        ProductUnit.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=False)
        return Response({'message': f'Đã vô hiệu hóa {len(ids)} đơn vị'})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        now = timezone.now()
        ProductUnit.objects.filter(id__in=ids).update(deleted_at=now, deleted_by=request.user)
        return Response({'message': f'Đã xóa (soft) {len(ids)} đơn vị'})

    def get_export_sheet_title(self):
        return 'Đơn vị tính'

    def get_export_filename(self):
        return 'don_vi_tinh.xlsx'

    def get_export_headers(self):
        return ['Mã', 'Tên', 'Đang dùng', 'Thứ tự', 'Ngày tạo']

    def get_export_row(self, obj):
        return [
            obj.code or '',
            obj.name or '',
            'Có' if obj.is_active else 'Không',
            obj.sort_order or 0,
            obj.created_at.strftime('%Y-%m-%d') if obj.created_at else '',
        ]


class ProductWaveViewSet(ExportExcelMixin, viewsets.ModelViewSet):
    """
    ViewSet cho loại sóng (Master Data chuẩn).
    /api/product-waves?search=BC&is_active=true&ordering=code&created_at__gte=2025-01-01
    """
    queryset = ProductWave.objects.all()
    serializer_class = ProductWaveSerializer
    permission_classes = [IsAuthenticated]
    export_template_entity_type = 'ProductWave'

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ProductWaveFilter
    search_fields = ['code', 'name', 'description']
    ordering_fields = ['code', 'name', 'sort_order', 'created_at']
    ordering = ['sort_order', 'code']

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.save()

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        ids = request.data.get('ids', [])
        ProductWave.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=True)
        return Response({'message': f'Đã kích hoạt {len(ids)} loại sóng'})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        ids = request.data.get('ids', [])
        ProductWave.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=False)
        return Response({'message': f'Đã vô hiệu hóa {len(ids)} loại sóng'})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        now = timezone.now()
        ProductWave.objects.filter(id__in=ids).update(deleted_at=now, deleted_by=request.user)
        return Response({'message': f'Đã xóa (soft) {len(ids)} loại sóng'})

    def get_export_sheet_title(self):
        return 'Loại sóng'

    def get_export_filename(self):
        return 'loai_song.xlsx'

    def get_export_headers(self):
        return ['Mã', 'Tên', 'Mô tả', 'Đang dùng', 'Thứ tự', 'Ngày tạo']

    def get_export_row(self, obj):
        return [
            obj.code or '', obj.name or '', (obj.description or '')[:200],
            'Có' if obj.is_active else 'Không', obj.sort_order or 0,
            obj.created_at.strftime('%Y-%m-%d') if obj.created_at else '',
        ]


class ProductBoxTypeViewSet(ExportExcelMixin, viewsets.ModelViewSet):
    """
    ViewSet cho kiểu thùng (Master Data chuẩn).
    /api/product-box-types?search=A1&is_active=true&ordering=code&created_at__gte=2025-01-01
    """
    queryset = ProductBoxType.objects.all()
    serializer_class = ProductBoxTypeSerializer
    permission_classes = [IsAuthenticated]
    export_template_entity_type = 'ProductBoxType'

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ProductBoxTypeFilter
    search_fields = ['code', 'name', 'description']
    ordering_fields = ['code', 'name', 'sort_order', 'created_at']
    ordering = ['sort_order', 'code']

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.save()

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        ids = request.data.get('ids', [])
        ProductBoxType.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=True)
        return Response({'message': f'Đã kích hoạt {len(ids)} kiểu thùng'})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        ids = request.data.get('ids', [])
        ProductBoxType.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=False)
        return Response({'message': f'Đã vô hiệu hóa {len(ids)} kiểu thùng'})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        now = timezone.now()
        ProductBoxType.objects.filter(id__in=ids).update(deleted_at=now, deleted_by=request.user)
        return Response({'message': f'Đã xóa (soft) {len(ids)} kiểu thùng'})

    def get_export_sheet_title(self):
        return 'Kiểu thùng'

    def get_export_filename(self):
        return 'kieu_thung.xlsx'

    def get_export_headers(self):
        return ['Mã', 'Tên', 'Mô tả', 'Đang dùng', 'Thứ tự', 'Ngày tạo']

    def get_export_row(self, obj):
        return [
            obj.code or '', obj.name or '', (obj.description or '')[:200],
            'Có' if obj.is_active else 'Không', obj.sort_order or 0,
            obj.created_at.strftime('%Y-%m-%d') if obj.created_at else '',
        ]


class OperationViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only master production operations."""

    queryset = Operation.objects.all()
    serializer_class = OperationSerializer
    permission_classes = [IsAuthenticated]

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = OperationFilter
    search_fields = ['code', 'name', 'description']
    ordering_fields = ['code', 'name', 'sequence', 'created_at']
    ordering = ['sequence', 'code']


class ProductViewSet(ExportExcelMixin, viewsets.ModelViewSet):
    """CRUD Product với Data Scope, Export (Mixin), Bulk Actions, Import Template"""

    export_template_entity_type = 'Product'

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {'detail': 'Không thể xóa sản phẩm đã được sử dụng trong đơn hàng. Vui lòng xóa hoặc sửa đơn hàng liên quan trước.'},
                status=status.HTTP_400_BAD_REQUEST
            )

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except DRFValidationError as e:
            return Response(e.detail, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            err_msg = str(e)
            if 'code' in err_msg.lower() or 'products_product_code' in err_msg:
                return Response(
                    {'code': ['Mã hàng này đã tồn tại, hãy đổi lại.']},
                    status=status.HTTP_400_BAD_REQUEST
                )
            return Response(
                {'detail': 'Lỗi dữ liệu. Vui lòng kiểm tra lại.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            import traceback
            error_detail = str(e)
            traceback_str = traceback.format_exc()
            # Log lỗi để debug
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Error creating product: {error_detail}\n{traceback_str}")
            return Response(
                {'detail': f'Lỗi server: {error_detail}. Vui lòng kiểm tra log backend.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def update(self, request, *args, **kwargs):
        try:
            return super().update(request, *args, **kwargs)
        except DRFValidationError as e:
            return Response(e.detail, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            err_msg = str(e)
            if 'code' in err_msg.lower() or 'products_product_code' in err_msg:
                return Response(
                    {'code': ['Mã hàng này đã tồn tại, hãy đổi lại.']},
                    status=status.HTTP_400_BAD_REQUEST
                )
            return Response(
                {'detail': 'Lỗi dữ liệu. Vui lòng kiểm tra lại.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            import traceback
            error_detail = str(e)
            traceback_str = traceback.format_exc()
            # Log lỗi để debug
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f"Error updating product: {error_detail}\n{traceback_str}")
            return Response(
                {'detail': f'Lỗi server: {error_detail}. Vui lòng kiểm tra log backend.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    queryset = Product.objects.select_related(
        'category', 'unit', 'wave', 'box_type', 'owner', 'team', 'created_by', 'updated_by',
        'bundle_config', 'bundle_config__primary_product',
    ).prefetch_related(
        'bundle_config__components__component_product',
        'bundle_config__components__component_product__unit',
        Prefetch(
            'operations',
            queryset=ProductOperation.objects.select_related('operation')
            .filter(is_active=True)
            .order_by('sequence', 'operation_code', 'id'),
            to_attr='prefetched_product_operations',
        ),
        Prefetch(
            'routing_steps',
            queryset=ProductRoutingStep.objects.select_related('operation', 'product_operation')
            .filter(is_active=True)
            .order_by('step_no', 'display_order', 'id'),
            to_attr='prefetched_routing_steps',
        ),
    ).all()
    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated]

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ProductFilter
    ordering_fields = [
        'code', 'name', 'item_type', 'category__name', 'cost_price', 'sale_price', 'commission_per_unit', 'commission_percent',
        'size_order', 'size_production', 'wave__code', 'box_type__code', 'unit__code', 'min_stock', 'delivery_tolerance',
        'process_xa', 'process_in', 'film_code', 'color_count', 'waterproof', 'process_can_mang', 'process_boi', 'process_be',
        'mold_code', 'process_chap', 'process_dong', 'process_dan', 'process_khac', 'note_other', 'note', 'created_at',
    ]
    ordering = ['-created_at']

    def get_queryset(self):
        if self.action in {'list', 'retrieve', 'price_changes', 'bundle_price_changes'}:
            activate_due_price_changes()
            activate_due_bundle_price_changes()
        queryset = super().get_queryset()
        user = self.request.user

        # Data Scope (GIỮ NGUYÊN)
        if user.is_superuser:
            pass
        elif user.groups.filter(name='Manager').exists():
            queryset = queryset.filter(
                Q(owner=user) | Q(team__in=user.teams.all()) | Q(owner__isnull=True)
            )
        else:
            queryset = queryset.filter(Q(owner=user) | Q(owner__isnull=True))

        # Annotate blocking_tasks_count để tránh N+1 query trong serializer
        blocking_subquery = (
            CoreTask.objects
            .filter(
                entity_type='Product',
                entity_id=OuterRef('pk'),
                is_blocking=True,
                status__in=['TODO', 'IN_PROGRESS'],
            )
            .values('entity_id')
            .annotate(cnt=Count('id'))
            .values('cnt')
        )
        queryset = queryset.annotate(
            blocking_tasks_count_db=Subquery(blocking_subquery, output_field=IntegerField())
        )

        # Tìm kiếm: không dấu, lowercase, token hoá, AND search, prefix, ranking (search_text)
        search_raw = (
            self.request.GET.get('search') or self.request.GET.get('q') or ''
        ).strip()
        if hasattr(self.request, 'query_params'):
            search_raw = search_raw or (self.request.query_params.get('search') or self.request.query_params.get('q') or '').strip()
        exact_search = self.request.GET.get('exact_search') in ('1', 'true', 'True')
        if hasattr(self.request, 'query_params'):
            exact_search = exact_search or self.request.query_params.get('exact_search') in ('1', 'true', 'True')
        if search_raw:
            from unidecode import unidecode
            normalized = unidecode(search_raw).lower().strip()
            if exact_search:
                # Tìm chính xác: khớp cả có dấu (search_raw) và không dấu (normalized)
                q_exact = Q(search_text__icontains=normalized)
                if search_raw != normalized:
                    q_exact |= Q(search_text__icontains=search_raw)
                queryset = queryset.filter(q_exact).distinct()
            else:
                tokens = [t for t in normalized.split() if t]
                if tokens:
                    note_only_tokens = {'co': ('có', 'co'), 'khong': ('không', 'khong')}
                    if len(tokens) == 1 and tokens[0] in note_only_tokens:
                        word_unicode, word_ascii = note_only_tokens[tokens[0]]
                        q_ghi_chu = (
                            Q(note__icontains=word_unicode) | Q(note_other__icontains=word_unicode)
                            | Q(note__icontains=word_ascii) | Q(note_other__icontains=word_ascii)
                        )
                        queryset = queryset.filter(q_ghi_chu).distinct()
                    else:
                        q_and = Q(search_text__icontains=tokens[0])
                        for t in tokens[1:]:
                            q_and &= Q(search_text__icontains=t)
                        queryset = queryset.filter(q_and).distinct()
                        rank_expr = Case(
                            When(search_text__icontains=tokens[0], then=Value(1)),
                            default=Value(0),
                            output_field=IntegerField(),
                        )
                        for t in tokens[1:]:
                            rank_expr += Case(
                                When(search_text__icontains=t, then=Value(1)),
                                default=Value(0),
                                output_field=IntegerField(),
                            )
                        queryset = queryset.annotate(_search_rank=rank_expr).order_by('-_search_rank', 'name')

        # Chỉ Mã mẹ khi LIST (bảng tổng hợp) - không filter khi retrieve/update/destroy
        if self.action == 'list' and self.request.query_params.get('parent__isnull') in ('true', 'True', '1'):
            queryset = queryset.filter(parent__isnull=True).annotate(components_count=Count('components'))

        # Badge vận hành: trạng thái trình duyệt giá và giá sắp hiệu lực.
        now = timezone.now()
        pending_price_change_qs = PriceChange.objects.filter(
            product_id=OuterRef('pk'),
            status=PriceChange.STATUS_PENDING_APPROVAL,
        )
        scheduled_price_change_qs = (
            PriceChange.objects
            .filter(
                product_id=OuterRef('pk'),
                status=PriceChange.STATUS_APPROVED_SCHEDULED,
                effective_at__isnull=False,
                effective_at__gt=now,
            )
            .order_by('effective_at', 'id')
        )
        queryset = queryset.annotate(
            has_pending_price_change=Exists(pending_price_change_qs),
            has_scheduled_price_change=Exists(scheduled_price_change_qs),
            next_price_effective_at=Subquery(
                scheduled_price_change_qs.values('effective_at')[:1],
                output_field=DateTimeField(),
            ),
            next_price_cost=Subquery(
                scheduled_price_change_qs.values('new_cost_price')[:1],
                output_field=DecimalField(max_digits=15, decimal_places=2),
            ),
            next_price_sale=Subquery(
                scheduled_price_change_qs.values('new_sale_price')[:1],
                output_field=DecimalField(max_digits=15, decimal_places=2),
            ),
            next_price_commission_per_unit=Subquery(
                scheduled_price_change_qs.values('new_commission_per_unit')[:1],
                output_field=DecimalField(max_digits=10, decimal_places=2),
            ),
            next_price_commission_percent=Subquery(
                scheduled_price_change_qs.values('new_commission_percent')[:1],
                output_field=DecimalField(max_digits=5, decimal_places=2),
            ),
        )

        return queryset

    @action(detail=True, methods=['get'], url_path='readiness')
    def readiness(self, request, pk=None):
        product = self.get_object()
        return Response(build_product_routing_readiness(product))

    @staticmethod
    def _to_decimal(value):
        if value is None or value == '':
            return None
        if isinstance(value, Decimal):
            return value
        try:
            return Decimal(str(value))
        except Exception:
            return None

    @classmethod
    def _calc_delta(cls, old_value, new_value):
        old_dec = cls._to_decimal(old_value)
        new_dec = cls._to_decimal(new_value)
        if old_dec is None or new_dec is None:
            return None, None
        delta = new_dec - old_dec
        pct = None
        if old_dec != 0:
            pct = ((delta / old_dec) * Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return delta, pct

    @staticmethod
    def _parse_effective_at(value):
        if value in (None, ''):
            return None
        if hasattr(value, 'tzinfo'):
            dt = value
        else:
            raw = str(value).strip()
            if len(raw) == 16:
                raw = f"{raw}:00"
            dt = parse_datetime(raw)
        if dt is None:
            raise DRFValidationError({'effective_at': 'Ngày áp dụng không hợp lệ.'})
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        return dt

    def _parse_bulk_price_items(self, payload):
        if not isinstance(payload, list) or not payload:
            raise DRFValidationError({'items': 'Danh sách mã hàng điều chỉnh không hợp lệ.'})
        normalized_items = []
        product_ids = []
        for raw_item in payload:
            if not isinstance(raw_item, dict):
                raise DRFValidationError({'items': 'Mỗi dòng điều chỉnh phải là một object.'})
            try:
                product_id = int(raw_item.get('product_id') or 0)
            except (TypeError, ValueError):
                product_id = 0
            if product_id <= 0:
                raise DRFValidationError({'items': 'Thiếu product_id hợp lệ trong danh sách điều chỉnh.'})
            normalized_items.append({
                'product_id': product_id,
                'new_cost_price': self._to_decimal(raw_item.get('new_cost_price')),
                'new_sale_price': self._to_decimal(raw_item.get('new_sale_price')),
                'new_commission_per_unit': self._to_decimal(raw_item.get('new_commission_per_unit')),
                'new_commission_percent': self._to_decimal(raw_item.get('new_commission_percent')),
            })
            product_ids.append(product_id)
        products = Product.objects.in_bulk(product_ids)
        missing_ids = [product_id for product_id in product_ids if product_id not in products]
        if missing_ids:
            raise DRFValidationError({'items': f'Không tìm thấy sản phẩm: {", ".join(map(str, missing_ids))}.'})
        return normalized_items, products

    def _build_bulk_price_preview(self, items, products):
        activate_due_price_changes(product_ids=list(products.keys()))
        preview_items = []
        for item in items:
            product = products[item['product_id']]
            current_values = resolve_product_price_as_of(product, timezone.now())
            merged_values = merge_price_values(
                {
                    'cost_price': current_values['cost_price'],
                    'sale_price': current_values['sale_price'],
                    'commission_per_unit': current_values['commission_per_unit'],
                    'commission_percent': current_values['commission_percent'],
                },
                {
                    'cost_price': item['new_cost_price'],
                    'sale_price': item['new_sale_price'],
                    'commission_per_unit': item['new_commission_per_unit'],
                    'commission_percent': item['new_commission_percent'],
                },
            )
            next_cost = merged_values['cost_price']
            next_sale = merged_values['sale_price']
            if next_sale is not None and next_cost is not None and next_sale < next_cost:
                raise DRFValidationError({
                    'items': f'Mã {product.code}: đơn giá mới phải lớn hơn hoặc bằng giá vốn mới.'
                })
            delta_cost, delta_cost_pct = self._calc_delta(current_values['cost_price'], next_cost)
            delta_sale, delta_sale_pct = self._calc_delta(current_values['sale_price'], next_sale)
            preview_items.append({
                'product_id': product.id,
                'product_code': product.code,
                'product_name': product.name,
                'old_cost_price': str(current_values['cost_price'] or 0),
                'new_cost_price': str(next_cost or 0),
                'old_sale_price': str(current_values['sale_price'] or 0),
                'new_sale_price': str(next_sale or 0),
                'old_commission_per_unit': str(current_values['commission_per_unit'] or 0),
                'new_commission_per_unit': str(merged_values['commission_per_unit'] or 0),
                'old_commission_percent': str(current_values['commission_percent'] or 0),
                'new_commission_percent': str(merged_values['commission_percent'] or 0),
                'delta_cost': str(delta_cost or 0),
                'delta_cost_percent': str(delta_cost_pct or 0),
                'delta_sale': str(delta_sale or 0),
                'delta_sale_percent': str(delta_sale_pct or 0),
            })
        return preview_items

    @staticmethod
    def _bundle_price_snapshot(bundle):
        return {
            'fixed_cost_price': str(bundle.fixed_cost_price or 0),
            'fixed_sale_price': str(bundle.fixed_sale_price or 0),
            'fixed_commission_per_unit': str(bundle.fixed_commission_per_unit or 0),
            'fixed_commission_percent': str(bundle.fixed_commission_percent or 0),
            'pricing_mode': bundle.pricing_mode,
            'commission_mode': bundle.get_commission_mode(),
            'delivery_rule': bundle.delivery_rule,
            'primary_product_id': bundle.primary_product_id,
            'primary_product_code': bundle.get_primary_product().code if bundle.get_primary_product() else None,
            'component_codes': [component.component_product.code for component in bundle.get_active_components()],
        }

    @staticmethod
    def _bundle_audit_old_values(price_change):
        return {
            'bundle_fixed_cost_price': str(price_change.old_fixed_cost_price or 0),
            'bundle_fixed_sale_price': str(price_change.old_fixed_sale_price or 0),
            'bundle_fixed_commission_per_unit': str(price_change.old_fixed_commission_per_unit or 0),
            'bundle_fixed_commission_percent': str(price_change.old_fixed_commission_percent or 0),
        }

    @staticmethod
    def _bundle_audit_new_values(price_change, *, reason='', reject_reason=''):
        return {
            'bundle_fixed_cost_price': str(price_change.new_fixed_cost_price or 0),
            'bundle_fixed_sale_price': str(price_change.new_fixed_sale_price or 0),
            'bundle_fixed_commission_per_unit': str(price_change.new_fixed_commission_per_unit or 0),
            'bundle_fixed_commission_percent': str(price_change.new_fixed_commission_percent or 0),
            'bundle_price_change_reason': reason or price_change.reason,
            'bundle_price_effective_at': price_change.effective_at.isoformat() if price_change.effective_at else None,
            'bundle_price_change_id': price_change.id,
            'bundle_price_change_status': price_change.status,
            'batch_code': price_change.batch_code or None,
            'reject_reason': reject_reason or price_change.reject_reason or '',
        }

    @staticmethod
    def _bundle_audit_changed_fields(price_change):
        field_map = [
            ('old_fixed_cost_price', 'new_fixed_cost_price', 'bundle_fixed_cost_price'),
            ('old_fixed_sale_price', 'new_fixed_sale_price', 'bundle_fixed_sale_price'),
            ('old_fixed_commission_per_unit', 'new_fixed_commission_per_unit', 'bundle_fixed_commission_per_unit'),
            ('old_fixed_commission_percent', 'new_fixed_commission_percent', 'bundle_fixed_commission_percent'),
        ]
        return [
            changed_name
            for old_field, new_field, changed_name in field_map
            if getattr(price_change, old_field) != getattr(price_change, new_field)
        ]

    @staticmethod
    def _get_bundle_for_price_workflow(product):
        try:
            bundle = product.bundle_config
        except ProductBundle.DoesNotExist:
            bundle = None
        if not bundle or not bundle.is_active:
            raise DRFValidationError({'detail': 'Sản phẩm chưa có cấu hình bộ đang hoạt động.'})
        if bundle.pricing_mode != ProductBundle.PRICING_MODE_FIXED:
            raise DRFValidationError({'detail': 'Luồng này chỉ áp dụng cho bộ đang dùng chế độ Giá bộ cố định.'})
        return bundle

    def perform_create(self, serializer):
        from core.models import NumberSequence
        import logging
        logger = logging.getLogger(__name__)

        try:
            custom_code = (self.request.data.get('code') or '').strip()
            if custom_code:
                code = custom_code
            else:
                seq = NumberSequence.objects.filter(entity_type='Product', is_active=True).first()
                if not seq:
                    seq = NumberSequence.objects.create(
                        entity_type='Product',
                        prefix='PROD',
                        padding=3,
                        format_template='{prefix}-{number}',
                        is_active=True,
                    )
                # Retry nếu mã tự sinh trùng (do sequence lệch với DB)
                code = seq.get_next_number()
                for _ in range(9):
                    if not Product.objects.filter(code__iexact=code).exists():
                        break
                    code = seq.get_next_number()
                else:
                    code = f"PROD-{uuid.uuid4().hex[:8].upper()}"

            obj = serializer.save(
                code=code,
                created_by=self.request.user,
                updated_by=self.request.user
            )
            
            # Tạo AuditLog với error handling
            try:
                create_values = {'code': obj.code}
                for k, v in serializer.validated_data.items():
                    if isinstance(v, (str, int, float, bool)) or v is None:
                        create_values[k] = v
                    else:
                        create_values[k] = str(v)
                AuditLog.objects.create(
                    user=self.request.user,
                    action='CREATE',
                    entity_type='Product',
                    entity_id=obj.id,
                    entity_id_str=str(obj.id),
                    entity_code=obj.code,
                    new_values=create_values,
                    ip_address=get_client_ip(self.request),
                    user_agent=(self.request.META.get('HTTP_USER_AGENT') or '')[:500],
                )
            except Exception as audit_error:
                # Log lỗi AuditLog nhưng không fail việc tạo product
                logger.warning(f"Failed to create AuditLog for product {obj.id}: {audit_error}")
        except Exception as e:
            import traceback
            error_detail = str(e)
            traceback_str = traceback.format_exc()
            logger.error(f"Error in perform_create: {error_detail}\n{traceback_str}")
            raise  # Re-raise để create() method catch

    def perform_update(self, serializer):
        import logging
        logger = logging.getLogger(__name__)
        
        try:
            instance = serializer.instance
            if instance.parent is not None:
                serializer.validated_data.pop('code', None)
            managed_price_fields = {
                'cost_price',
                'sale_price',
                'commission_per_unit',
                'commission_percent',
            }
            price_change_reason = (serializer.validated_data.pop('price_change_reason', '') or '').strip()
            price_effective_at = serializer.validated_data.pop('price_effective_at', None)
            old_values = {}
            new_values = {}
            changed_fields = []
            original_price_snapshot = {
                field: getattr(instance, field, None)
                for field in managed_price_fields
            }
            incoming_price_values = {}
            for field in list(serializer.validated_data.keys()):
                if field not in managed_price_fields:
                    continue
                new_val = serializer.validated_data.pop(field)
                old_val = original_price_snapshot.get(field)
                if old_val != new_val:
                    incoming_price_values[field] = new_val

            for field, new_val in serializer.validated_data.items():
                old_val = getattr(instance, field, None)
                if old_val != new_val:
                    changed_fields.append(field)
                    if isinstance(old_val, (str, int, float, bool)) or old_val is None:
                        old_values[field] = old_val
                    else:
                        old_values[field] = str(old_val)
                    if isinstance(new_val, (str, int, float, bool)) or new_val is None:
                        new_values[field] = new_val
                    else:
                        new_values[field] = str(new_val)
            old_code = instance.code
            serializer.save(updated_by=self.request.user)
            new_code = instance.code
            if old_code != new_code and instance.parent is None:
                import re
                prefix = re.escape(old_code) + r'-(\d+)$'
                for child in instance.components.all():
                    m = re.match(prefix, child.code or '')
                    if m:
                        suffix = m.group(1)
                        child.code = f"{new_code}-{suffix}"
                        child.save(update_fields=['code', 'updated_at'])

            if incoming_price_values:
                price_change = record_direct_price_change(
                    instance,
                    new_values=incoming_price_values,
                    actor=self.request.user,
                    reason=price_change_reason,
                    effective_at=price_effective_at,
                    source=PriceChange.SOURCE_MANUAL,
                )
                field_map = {
                    'cost_price': 'new_cost_price',
                    'sale_price': 'new_sale_price',
                    'commission_per_unit': 'new_commission_per_unit',
                    'commission_percent': 'new_commission_percent',
                }
                for field, change_field in field_map.items():
                    if field not in incoming_price_values:
                        continue
                    changed_fields.append(field)
                    old_values[field] = str(original_price_snapshot.get(field) or 0)
                    new_values[field] = str(getattr(price_change, change_field) or 0)
                new_values['price_change_reason'] = price_change_reason
                if price_change.effective_at:
                    new_values['price_effective_at'] = price_change.effective_at.isoformat()
                new_values['price_change_status'] = price_change.status
                new_values['price_change_id'] = price_change.id
            
            # Tạo AuditLog với error handling
            try:
                AuditLog.objects.create(
                    user=self.request.user,
                    action='UPDATE',
                    entity_type='Product',
                    entity_id=instance.id,
                    entity_id_str=str(instance.id),
                    entity_code=instance.code,
                    old_values=old_values,
                    new_values=new_values,
                    changed_fields=changed_fields,
                    ip_address=get_client_ip(self.request),
                    user_agent=(self.request.META.get('HTTP_USER_AGENT') or '')[:500],
                )
            except Exception as audit_error:
                # Log lỗi AuditLog nhưng không fail việc update product
                logger.warning(f"Failed to create AuditLog for product update {instance.id}: {audit_error}")
        except Exception as e:
            import traceback
            error_detail = str(e)
            traceback_str = traceback.format_exc()
            logger.error(f"Error in perform_update: {error_detail}\n{traceback_str}")
            raise  # Re-raise để update() method catch

    def perform_destroy(self, instance):
        AuditLog.objects.create(
            user=self.request.user,
            action='DELETE',
            entity_type='Product',
            entity_id=instance.id,
            entity_id_str=str(instance.id),
            entity_code=instance.code,
            old_values={'code': instance.code, 'name': instance.name},
            ip_address=get_client_ip(self.request),
            user_agent=(self.request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        instance.delete()

    @action(detail=True, methods=['get', 'put', 'patch', 'delete'], url_path='bundle')
    def bundle(self, request, pk=None):
        product = self.get_object()
        try:
            bundle = product.bundle_config
        except ProductBundle.DoesNotExist:
            bundle = None

        if request.method == 'GET':
            if not bundle:
                return Response({'detail': 'Sản phẩm chưa có cấu hình bộ.'}, status=status.HTTP_404_NOT_FOUND)
            return Response(ProductBundleSerializer(bundle, context={'request': request}).data)

        if request.method == 'DELETE':
            if bundle:
                old_bundle_values = self._bundle_price_snapshot(bundle)
                bundle_id = bundle.id
                bundle.delete()
                AuditLog.objects.create(
                    user=request.user,
                    action='DELETE',
                    entity_type='ProductBundle',
                    entity_id=bundle_id,
                    entity_id_str=str(bundle_id),
                    entity_code=product.code,
                    old_values=old_bundle_values,
                    new_values={'is_active': False},
                    changed_fields=['bundle_deleted'],
                    ip_address=get_client_ip(request),
                    user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
                )
            Product.objects.filter(pk=product.pk).update(is_set=False)
            return Response(status=status.HTTP_204_NO_CONTENT)

        old_bundle_values = self._bundle_price_snapshot(bundle) if bundle else {}
        payload = request.data.copy()
        payload['sellable_product'] = product.id
        serializer = ProductBundleSerializer(
            bundle,
            data=payload,
            partial=request.method == 'PATCH',
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        existed = bundle is not None
        saved_bundle = serializer.save(sellable_product=product)
        new_bundle_values = self._bundle_price_snapshot(saved_bundle)
        changed_fields = sorted({
            field
            for field in set(old_bundle_values) | set(new_bundle_values)
            if old_bundle_values.get(field) != new_bundle_values.get(field)
        })
        if not changed_fields:
            changed_fields = ['bundle_created' if not existed else 'bundle_updated']
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE' if existed else 'CREATE',
            entity_type='ProductBundle',
            entity_id=saved_bundle.id,
            entity_id_str=str(saved_bundle.id),
            entity_code=product.code,
            old_values=old_bundle_values,
            new_values=new_bundle_values,
            changed_fields=changed_fields,
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(
            ProductBundleSerializer(saved_bundle, context={'request': request}).data,
            status=status.HTTP_200_OK if existed else status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'detail': 'Chọn ít nhất một sản phẩm để xóa'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            for obj in Product.objects.filter(id__in=ids):
                AuditLog.objects.create(
                    user=request.user,
                    action='DELETE',
                    entity_type='Product',
                    entity_id=obj.id,
                    entity_id_str=str(obj.id),
                    entity_code=obj.code,
                    old_values={'code': obj.code},
                    ip_address=get_client_ip(request),
                    user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
                )
            Product.objects.filter(id__in=ids).delete()
        except ProtectedError:
            return Response(
                {'detail': 'Không thể xóa sản phẩm đã được sử dụng trong đơn hàng. Vui lòng xóa hoặc sửa đơn hàng liên quan trước.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        return Response({'message': f'Đã xóa {len(ids)} sản phẩm'})

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        if not check_action_permission(request.user, 'Product', 'EDIT', strict=True):
            return Response({'error': 'Không có quyền kích hoạt'}, status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get('ids', [])
        Product.objects.filter(id__in=ids).update(is_active=True, status='ACTIVE')
        # 1 dòng AuditLog cho cả bulk để không nặng DB
        AuditLog.objects.create(
            user=request.user,
            action='ACTIVATE',
            entity_type='Product',
            entity_id=0,
            entity_id_str='',
            entity_code='',
            new_values={'ids': ids, 'count': len(ids), 'is_active': True, 'status': 'ACTIVE'},
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response({'message': f'Đã kích hoạt {len(ids)} sản phẩm'})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        if not check_action_permission(request.user, 'Product', 'EDIT', strict=True):
            return Response({'error': 'Không có quyền vô hiệu hóa'}, status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get('ids', [])
        Product.objects.filter(id__in=ids).update(is_active=False)
        AuditLog.objects.create(
            user=request.user,
            action='DEACTIVATE',
            entity_type='Product',
            entity_id=0,
            entity_id_str='',
            entity_code='',
            new_values={'ids': ids, 'count': len(ids), 'is_active': False},
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response({'message': f'Đã vô hiệu hóa {len(ids)} sản phẩm'})

    @action(detail=False, methods=['post'])
    def bulk_discontinue(self, request):
        ids = request.data.get('ids', [])
        Product.objects.filter(id__in=ids).update(status='DISCONTINUED')
        return Response({'message': f'Đã ngừng sản xuất {len(ids)} sản phẩm'})

    @action(detail=False, methods=['post'], url_path='bulk_price_preview')
    def bulk_price_preview(self, request):
        items, products = self._parse_bulk_price_items(request.data.get('items') or [])
        preview_items = self._build_bulk_price_preview(items, products)
        return Response({
            'total': len(preview_items),
            'items': preview_items,
        })

    @action(detail=False, methods=['post'], url_path='bulk_price_submit')
    def bulk_price_submit(self, request):
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'reason': 'Vui lòng nhập lý do điều chỉnh giá hàng loạt.'}, status=status.HTTP_400_BAD_REQUEST)
        items, products = self._parse_bulk_price_items(request.data.get('items') or [])
        preview_items = self._build_bulk_price_preview(items, products)
        effective_at = self._parse_effective_at(request.data.get('effective_at'))
        auto_approve = str(request.data.get('auto_approve') or '').lower() in ('1', 'true', 'yes')
        batch_code = (request.data.get('batch_code') or '').strip() or f'PRICE-{uuid.uuid4().hex[:10].upper()}'
        results = []
        for item in items:
            product = products[item['product_id']]
            price_change = submit_price_change_request(
                product,
                new_values={
                    'cost_price': item['new_cost_price'],
                    'sale_price': item['new_sale_price'],
                    'commission_per_unit': item['new_commission_per_unit'],
                    'commission_percent': item['new_commission_percent'],
                },
                reason=reason,
                actor=request.user,
                effective_at=effective_at,
                source=PriceChange.SOURCE_MANUAL,
                batch_code=batch_code,
            )
            if auto_approve:
                price_change = approve_price_change_service(price_change, request.user)
            AuditLog.objects.create(
                user=request.user,
                action='BULK_SUBMIT' if not auto_approve else 'BULK_APPROVE',
                entity_type='Product',
                entity_id=product.id,
                entity_id_str=str(product.id),
                entity_code=product.code,
                old_values={
                    'cost_price': str(price_change.old_cost_price or 0),
                    'sale_price': str(price_change.old_sale_price or 0),
                    'commission_per_unit': str(price_change.old_commission_per_unit or 0),
                    'commission_percent': str(price_change.old_commission_percent or 0),
                },
                new_values={
                    'cost_price': str(price_change.new_cost_price or 0),
                    'sale_price': str(price_change.new_sale_price or 0),
                    'commission_per_unit': str(price_change.new_commission_per_unit or 0),
                    'commission_percent': str(price_change.new_commission_percent or 0),
                    'price_change_reason': reason,
                    'price_effective_at': price_change.effective_at.isoformat() if price_change.effective_at else None,
                    'price_change_id': price_change.id,
                    'price_change_status': price_change.status,
                    'batch_code': batch_code,
                },
                changed_fields=[
                    field for field in ['cost_price', 'sale_price', 'commission_per_unit', 'commission_percent']
                    if getattr(price_change, f'old_{field}') != getattr(price_change, f'new_{field}')
                ],
                ip_address=get_client_ip(request),
                user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
            )
            results.append(PriceChangeSerializer(price_change).data)
        return Response({
            'batch_code': batch_code,
            'total': len(results),
            'auto_approve': auto_approve,
            'items': results,
            'preview': preview_items,
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='price_changes')
    def price_changes(self, request, pk=None):
        product = self.get_object()
        activate_due_price_changes(product_ids=[product.id])
        queryset = PriceChange.objects.filter(product=product).order_by('-effective_at', '-created_at')[:100]
        serializer = PriceChangeSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='submit_price_change')
    def submit_price_change(self, request, pk=None):
        product = self.get_object()
        activate_due_price_changes(product_ids=[product.id])
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'reason': 'Vui lòng nhập lý do đề xuất thay đổi giá.'}, status=status.HTTP_400_BAD_REQUEST)

        new_cost = self._to_decimal(request.data.get('new_cost_price'))
        new_sale = self._to_decimal(request.data.get('new_sale_price'))
        new_commission_per_unit = self._to_decimal(request.data.get('new_commission_per_unit'))
        new_commission_percent = self._to_decimal(request.data.get('new_commission_percent'))
        if all(value is None for value in [new_cost, new_sale, new_commission_per_unit, new_commission_percent]):
            return Response(
                {'detail': 'Cần nhập ít nhất 1 giá/hoa hồng mới để trình duyệt.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        current_cost = self._to_decimal(product.cost_price)
        current_sale = self._to_decimal(product.sale_price)
        next_cost = new_cost if new_cost is not None else current_cost
        next_sale = new_sale if new_sale is not None else current_sale
        if next_cost is not None and next_sale is not None and next_sale < next_cost:
            return Response({'new_sale_price': 'Đơn giá mới phải lớn hơn hoặc bằng giá vốn mới.'}, status=status.HTTP_400_BAD_REQUEST)

        effective_at = self._parse_effective_at(request.data.get('effective_at'))
        batch_code = (request.data.get('batch_code') or '').strip()

        price_change = submit_price_change_request(
            product,
            new_values={
                'cost_price': new_cost,
                'sale_price': new_sale,
                'commission_per_unit': new_commission_per_unit,
                'commission_percent': new_commission_percent,
            },
            reason=reason,
            actor=request.user,
            effective_at=effective_at,
            source=PriceChange.SOURCE_MANUAL,
            batch_code=batch_code,
        )
        changed_fields = [
            field for field in ['cost_price', 'sale_price', 'commission_per_unit', 'commission_percent']
            if getattr(price_change, f'old_{field}') != getattr(price_change, f'new_{field}')
        ]

        AuditLog.objects.create(
            user=request.user,
            action='SUBMIT',
            entity_type='Product',
            entity_id=product.id,
            entity_id_str=str(product.id),
            entity_code=product.code,
            old_values={
                'cost_price': str(price_change.old_cost_price or 0),
                'sale_price': str(price_change.old_sale_price or 0),
                'commission_per_unit': str(price_change.old_commission_per_unit or 0),
                'commission_percent': str(price_change.old_commission_percent or 0),
            },
            new_values={
                'cost_price': str(price_change.new_cost_price or 0),
                'sale_price': str(price_change.new_sale_price or 0),
                'commission_per_unit': str(price_change.new_commission_per_unit or 0),
                'commission_percent': str(price_change.new_commission_percent or 0),
                'price_change_reason': reason,
                'price_effective_at': effective_at.isoformat() if effective_at else None,
                'price_change_id': price_change.id,
                'price_change_status': price_change.status,
                'batch_code': price_change.batch_code or None,
            },
            changed_fields=changed_fields,
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(PriceChangeSerializer(price_change).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='approve_price_change')
    def approve_price_change(self, request, pk=None):
        product = self.get_object()
        activate_due_price_changes(product_ids=[product.id])
        change_id = request.data.get('change_id')
        if not change_id:
            return Response({'change_id': 'Thiếu change_id.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            price_change = PriceChange.objects.get(
                id=change_id,
                product=product,
                status=PriceChange.STATUS_PENDING_APPROVAL,
            )
        except PriceChange.DoesNotExist:
            return Response({'detail': 'Đề xuất giá không tồn tại hoặc đã xử lý.'}, status=status.HTTP_404_NOT_FOUND)

        price_change = approve_price_change_service(price_change, request.user)
        changed_fields = [
            field for field in ['cost_price', 'sale_price', 'commission_per_unit', 'commission_percent']
            if getattr(price_change, f'old_{field}') != getattr(price_change, f'new_{field}')
        ]

        AuditLog.objects.create(
            user=request.user,
            action='APPROVE',
            entity_type='Product',
            entity_id=product.id,
            entity_id_str=str(product.id),
            entity_code=product.code,
            old_values={
                'cost_price': str(price_change.old_cost_price or 0),
                'sale_price': str(price_change.old_sale_price or 0),
                'commission_per_unit': str(price_change.old_commission_per_unit or 0),
                'commission_percent': str(price_change.old_commission_percent or 0),
            },
            new_values={
                'cost_price': str(price_change.new_cost_price or 0),
                'sale_price': str(price_change.new_sale_price or 0),
                'commission_per_unit': str(price_change.new_commission_per_unit or 0),
                'commission_percent': str(price_change.new_commission_percent or 0),
                'price_change_reason': price_change.reason,
                'price_effective_at': price_change.effective_at.isoformat() if price_change.effective_at else None,
                'price_change_id': price_change.id,
                'price_change_status': price_change.status,
            },
            changed_fields=changed_fields,
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(PriceChangeSerializer(price_change).data)

    @action(detail=True, methods=['post'], url_path='reject_price_change')
    def reject_price_change(self, request, pk=None):
        product = self.get_object()
        activate_due_price_changes(product_ids=[product.id])
        change_id = request.data.get('change_id')
        reject_reason = (request.data.get('reject_reason') or '').strip()
        if not change_id:
            return Response({'change_id': 'Thiếu change_id.'}, status=status.HTTP_400_BAD_REQUEST)
        if not reject_reason:
            return Response({'reject_reason': 'Vui lòng nhập lý do từ chối.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            price_change = PriceChange.objects.get(
                id=change_id,
                product=product,
                status=PriceChange.STATUS_PENDING_APPROVAL,
            )
        except PriceChange.DoesNotExist:
            return Response({'detail': 'Đề xuất giá không tồn tại hoặc đã xử lý.'}, status=status.HTTP_404_NOT_FOUND)

        price_change.status = PriceChange.STATUS_REJECTED
        price_change.reject_reason = reject_reason
        price_change.approved_by = request.user
        price_change.approved_at = timezone.now()
        price_change.save(update_fields=['status', 'reject_reason', 'approved_by', 'approved_at', 'updated_at'])

        AuditLog.objects.create(
            user=request.user,
            action='REJECT',
            entity_type='Product',
            entity_id=product.id,
            entity_id_str=str(product.id),
            entity_code=product.code,
            old_values={
                'cost_price': str(price_change.old_cost_price or 0),
                'sale_price': str(price_change.old_sale_price or 0),
                'commission_per_unit': str(price_change.old_commission_per_unit or 0),
                'commission_percent': str(price_change.old_commission_percent or 0),
            },
            new_values={
                'cost_price': str(price_change.new_cost_price or 0),
                'sale_price': str(price_change.new_sale_price or 0),
                'commission_per_unit': str(price_change.new_commission_per_unit or 0),
                'commission_percent': str(price_change.new_commission_percent or 0),
                'price_change_reason': price_change.reason,
                'price_effective_at': price_change.effective_at.isoformat() if price_change.effective_at else None,
                'reject_reason': reject_reason,
                'price_change_id': price_change.id,
                'price_change_status': price_change.status,
            },
            changed_fields=[
                field for field in ['cost_price', 'sale_price', 'commission_per_unit', 'commission_percent']
                if getattr(price_change, f'old_{field}') != getattr(price_change, f'new_{field}')
            ],
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(PriceChangeSerializer(price_change).data)

    @action(detail=True, methods=['get'], url_path='bundle_price_changes')
    def bundle_price_changes(self, request, pk=None):
        product = self.get_object()
        bundle = self._get_bundle_for_price_workflow(product)
        activate_due_bundle_price_changes(bundle_ids=[bundle.id])
        queryset = BundlePriceChange.objects.filter(bundle=bundle).order_by('-effective_at', '-created_at')[:100]
        serializer = BundlePriceChangeSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='submit_bundle_price_change')
    def submit_bundle_price_change(self, request, pk=None):
        product = self.get_object()
        bundle = self._get_bundle_for_price_workflow(product)
        activate_due_bundle_price_changes(bundle_ids=[bundle.id])
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'reason': 'Vui lòng nhập lý do đề xuất thay đổi giá bộ.'}, status=status.HTTP_400_BAD_REQUEST)

        new_cost = self._to_decimal(request.data.get('new_cost_price'))
        new_sale = self._to_decimal(request.data.get('new_sale_price'))
        new_commission_per_unit = self._to_decimal(request.data.get('new_commission_per_unit'))
        new_commission_percent = self._to_decimal(request.data.get('new_commission_percent'))
        if all(value is None for value in [new_cost, new_sale, new_commission_per_unit, new_commission_percent]):
            return Response(
                {'detail': 'Cần nhập ít nhất 1 giá/hoa hồng bộ mới để trình duyệt.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        current_cost = self._to_decimal(bundle.fixed_cost_price)
        current_sale = self._to_decimal(bundle.fixed_sale_price)
        next_cost = new_cost if new_cost is not None else current_cost
        next_sale = new_sale if new_sale is not None else current_sale
        if next_cost is not None and next_sale is not None and next_sale < next_cost:
            return Response({'new_sale_price': 'Đơn giá bộ mới phải lớn hơn hoặc bằng giá vốn bộ mới.'}, status=status.HTTP_400_BAD_REQUEST)

        effective_at = self._parse_effective_at(request.data.get('effective_at'))
        batch_code = (request.data.get('batch_code') or '').strip()

        price_change = submit_bundle_price_change_request(
            bundle,
            new_values={
                'fixed_cost_price': new_cost,
                'fixed_sale_price': new_sale,
                'fixed_commission_per_unit': new_commission_per_unit,
                'fixed_commission_percent': new_commission_percent,
            },
            reason=reason,
            actor=request.user,
            effective_at=effective_at,
            source=BundlePriceChange.SOURCE_MANUAL,
            batch_code=batch_code,
        )
        changed_fields = self._bundle_audit_changed_fields(price_change)
        AuditLog.objects.create(
            user=request.user,
            action='SUBMIT',
            entity_type='ProductBundle',
            entity_id=bundle.id,
            entity_id_str=str(bundle.id),
            entity_code=product.code,
            old_values=self._bundle_audit_old_values(price_change),
            new_values=self._bundle_audit_new_values(price_change, reason=reason),
            changed_fields=changed_fields,
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(BundlePriceChangeSerializer(price_change).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='approve_bundle_price_change')
    def approve_bundle_price_change(self, request, pk=None):
        product = self.get_object()
        bundle = self._get_bundle_for_price_workflow(product)
        activate_due_bundle_price_changes(bundle_ids=[bundle.id])
        change_id = request.data.get('change_id')
        if not change_id:
            return Response({'change_id': 'Thiếu change_id.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            price_change = BundlePriceChange.objects.get(
                id=change_id,
                bundle=bundle,
                status=BundlePriceChange.STATUS_PENDING_APPROVAL,
            )
        except BundlePriceChange.DoesNotExist:
            return Response({'detail': 'Đề xuất giá bộ không tồn tại hoặc đã xử lý.'}, status=status.HTTP_404_NOT_FOUND)

        price_change = approve_bundle_price_change_service(price_change, request.user)
        AuditLog.objects.create(
            user=request.user,
            action='APPROVE',
            entity_type='ProductBundle',
            entity_id=bundle.id,
            entity_id_str=str(bundle.id),
            entity_code=product.code,
            old_values=self._bundle_audit_old_values(price_change),
            new_values=self._bundle_audit_new_values(price_change),
            changed_fields=self._bundle_audit_changed_fields(price_change),
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(BundlePriceChangeSerializer(price_change).data)

    @action(detail=True, methods=['post'], url_path='reject_bundle_price_change')
    def reject_bundle_price_change(self, request, pk=None):
        product = self.get_object()
        bundle = self._get_bundle_for_price_workflow(product)
        activate_due_bundle_price_changes(bundle_ids=[bundle.id])
        change_id = request.data.get('change_id')
        reject_reason = (request.data.get('reject_reason') or '').strip()
        if not change_id:
            return Response({'change_id': 'Thiếu change_id.'}, status=status.HTTP_400_BAD_REQUEST)
        if not reject_reason:
            return Response({'reject_reason': 'Vui lòng nhập lý do từ chối.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            price_change = BundlePriceChange.objects.get(
                id=change_id,
                bundle=bundle,
                status=BundlePriceChange.STATUS_PENDING_APPROVAL,
            )
        except BundlePriceChange.DoesNotExist:
            return Response({'detail': 'Đề xuất giá bộ không tồn tại hoặc đã xử lý.'}, status=status.HTTP_404_NOT_FOUND)

        price_change.status = BundlePriceChange.STATUS_REJECTED
        price_change.reject_reason = reject_reason
        price_change.approved_by = request.user
        price_change.approved_at = timezone.now()
        price_change.save(update_fields=['status', 'reject_reason', 'approved_by', 'approved_at', 'updated_at'])

        AuditLog.objects.create(
            user=request.user,
            action='REJECT',
            entity_type='ProductBundle',
            entity_id=bundle.id,
            entity_id_str=str(bundle.id),
            entity_code=product.code,
            old_values=self._bundle_audit_old_values(price_change),
            new_values=self._bundle_audit_new_values(price_change, reject_reason=reject_reason),
            changed_fields=self._bundle_audit_changed_fields(price_change),
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(BundlePriceChangeSerializer(price_change).data)

    @action(detail=True, methods=['post'])
    def assign_owner(self, request, pk=None):
        """Gán owner cho sản phẩm"""
        product = self.get_object()
        user_id = request.data.get('user_id')

        from django.contrib.auth import get_user_model
        User = get_user_model()

        try:
            owner = User.objects.get(id=user_id)
            product.owner = owner
            product.save()
            return Response({'message': f'Đã gán owner: {owner.get_full_name()}'})
        except User.DoesNotExist:
            return Response({'error': 'User không tồn tại'}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def assign_team(self, request, pk=None):
        """Gán team cho sản phẩm"""
        product = self.get_object()
        team_id = request.data.get('team_id')

        from core.models import Team

        try:
            team = Team.objects.get(id=team_id)
            product.team = team
            product.save()
            return Response({'message': f'Đã gán team: {team.name}'})
        except Team.DoesNotExist:
            return Response({'error': 'Team không tồn tại'}, status=status.HTTP_400_BAD_REQUEST)

    def get_export_sheet_title(self):
        return 'Sản phẩm'

    def get_export_filename(self):
        return 'san_pham.xlsx'

    def get_export_headers(self):
        """Thứ tự cột trùng Quản lý sản phẩm (không có Tồn TT, không có Mô tả)."""
        return [
            'Mã hàng', 'Tên hàng', 'Danh mục', 'Trạng thái',
            'Giá vốn', 'Giá bán', 'HHCĐ (đ/cái)', 'HH%',
            'Kích thước ĐH', 'KTSX', 'Sóng', 'Kiểu', 'ĐVT', '+/-',
            'Xả', 'In', 'Mã phim', 'Số màu', 'Chống thấm',
            'Cán màng', 'Bồi', 'Bế', 'Mã khuôn',
            'Chạp', 'Đóng', 'Dán', 'Khác',
            'Ghi chú công đoạn khác', 'Ghi chú chung',
        ]

    def get_export_pdf_fields(self):
        """Field paths cho xuất PDF (cùng thứ tự với get_export_headers)."""
        return [
            'code', 'name', 'category__name', 'status',
            'cost_price', 'sale_price', 'commission_per_unit', 'commission_percent',
            'size_order', 'size_production', 'wave__code', 'box_type__code', 'unit__name',
            'delivery_tolerance',
            'process_xa', 'process_in', 'film_code', 'color_count', 'waterproof',
            'process_can_mang', 'process_boi', 'process_be', 'mold_code',
            'process_chap', 'process_dong', 'process_dan', 'process_khac',
            'note_other', 'note',
        ]

    def get_export_row(self, obj):
        """Thứ tự cột trùng Quản lý sản phẩm (không có Tồn TT, không có Mô tả)."""
        return [
            obj.code or '',
            obj.name or '',
            obj.category.name if obj.category else '',
            obj.get_status_display() if obj.status else '',
            float(obj.cost_price) if obj.cost_price is not None else 0,
            float(obj.sale_price) if obj.sale_price is not None else 0,
            float(obj.commission_per_unit) if obj.commission_per_unit is not None else 0,
            float(obj.commission_percent) if obj.commission_percent is not None else 0,
            obj.size_order or '',
            obj.size_production or '',
            obj.wave.code if obj.wave else '',
            obj.box_type.code if obj.box_type else '',
            obj.unit.name if obj.unit else '',
            obj.delivery_tolerance or '',
            obj.process_xa if obj.process_xa is not None else '',
            obj.process_in if obj.process_in is not None else '',
            obj.film_code or '',
            obj.color_count if obj.color_count is not None else 0,
            obj.waterproof or '',
            obj.process_can_mang if obj.process_can_mang is not None else '',
            obj.process_boi if obj.process_boi is not None else '',
            obj.process_be if obj.process_be is not None else '',
            obj.mold_code or '',
            obj.process_chap if obj.process_chap is not None else '',
            obj.process_dong if obj.process_dong is not None else '',
            obj.process_dan if obj.process_dan is not None else '',
            obj.process_khac if obj.process_khac is not None else '',
            (obj.note_other or '')[:500],
            (obj.note or '')[:500],
        ]

    @action(detail=False, methods=['post'], url_path='upload_file')
    def upload_file(self, request):
        """Tải file PDF (phim/khuôn) lên và trả về URL."""
        if 'file' not in request.FILES:
            return Response({'error': 'Không có file'}, status=status.HTTP_400_BAD_REQUEST)
        file = request.FILES['file']
        field_name = (request.POST.get('field_name') or request.data.get('field_name') or 'film').strip().lower()
        if field_name not in ('film', 'mold'):
            field_name = 'film'
        ext = os.path.splitext(file.name)[1] or '.pdf'
        if ext.lower() != '.pdf':
            return Response({'error': 'Chỉ chấp nhận file PDF'}, status=status.HTTP_400_BAD_REQUEST)
        name = f"{uuid.uuid4().hex[:12]}{ext}"
        path = os.path.join('products', field_name, name)
        try:
            saved_path = default_storage.save(path, file)
            url = request.build_absolute_uri(settings.MEDIA_URL + saved_path)
            filename = file.name or name
            return Response({'url': url, 'filename': filename})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['get'], url_path='download_import_template')
    def download_import_template(self, request):
        """Download Excel template - thứ tự cột trùng với Quản lý sản phẩm."""
        wb = Workbook()
        ws = wb.active
        ws.title = 'Template'

        # Thứ tự cột trùng Quản lý sản phẩm (không có Tồn TT, không có Mô tả)
        headers = [
            'Mã hàng', 'Tên hàng', 'Mã danh mục', 'Trạng thái',
            'Giá vốn', 'Giá bán', 'HHCĐ (đ/cái)', 'HH%',
            'Kích thước ĐH', 'KTSX', 'Sóng', 'Kiểu', 'Mã đơn vị', '+/-',
            'Xả (cái/giờ)', 'In (cái/giờ)', 'Mã phim', 'Số màu', 'Chống thấm',
            'Cán màng (cái/giờ)', 'Bồi (cái/giờ)', 'Bế (cái/giờ)', 'Mã khuôn',
            'Chạp (cái/giờ)', 'Đóng (cái/giờ)', 'Dán (cái/giờ)', 'Khác (cái/giờ)',
            'Ghi chú công đoạn khác', 'Ghi chú chung',
        ]
        ws.append(headers)

        ws.append([
            'PROD-0001', 'Thùng carton mẫu', 'CAT-001', 'ACTIVE',
            10000, 15000, 500, 0,
            '30x20x15', '30x20x15', 'BC', 'A1', 'CAI', '±5%',
            1200, 800, 'PHIM-A1', 4, 'INSIDE',
            500, 600, 400, 'KH-A1',
            300, 350, 450, 100,
            'Ghi chú công đoạn mẫu', 'Ghi chú chung mẫu',
        ])
        ws.append([
            'PROD-0002', 'Hộp giấy mẫu', 'CAT-002', 'ACTIVE',
            5000, 8000, 0, 2.5,
            '25x18x10', '25x18x10', 'E', 'A5', 'HOP', '',
            1000, 700, '', 2, '',
            '', '', 350, '',
            '', 300, 400, '',
            '', '',
        ])

        output = BytesIO()
        wb.save(output)
        output.seek(0)

        response = HttpResponse(
            output.read(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = 'attachment; filename="template_san_pham.xlsx"'
        return response

    @action(detail=False, methods=['post'])
    def import_excel(self, request):
        """Import sản phẩm từ Excel; dùng engine chung import_from_excel_with_processor + ProductImportService."""
        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'Không có file'}, status=status.HTTP_400_BAD_REQUEST)
        if not check_action_permission(request.user, 'Product', 'IMPORT', strict=True):
            return Response({'error': 'Không có quyền import'}, status=status.HTTP_403_FORBIDDEN)

        from core.utils import import_from_excel_with_processor
        from core.models import NumberSequence, AuditLog
        from .importers import ProductImportService

        # Validate file extension
        if not (file.name or '').endswith('.xlsx'):
            return Response({'error': 'Chỉ hỗ trợ file .xlsx'}, status=status.HTTP_400_BAD_REQUEST)

        update_if_exists = str(request.data.get('update_if_exists', '')).lower() in ('true', '1', 'yes')

        seq = NumberSequence.objects.filter(entity_type='Product', is_active=True).first()
        if not seq:
            seq = NumberSequence.objects.create(
                entity_type='Product',
                prefix='PROD',
                padding=3,
                format_template='{prefix}-{number}',
                is_active=True,
            )

        try:
            result = import_from_excel_with_processor(
                file,
                entity_type='Product',
                row_processor=ProductImportService.process_row,
                user=request.user,
                update_if_exists=update_if_exists,
                seq=seq,
            )
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            err_msg = str(e)
            if 'workbook' in err_msg.lower() or 'excel' in err_msg.lower() or 'xlsx' in err_msg.lower():
                return Response(
                    {'error': f'Không đọc được file Excel. Kiểm tra định dạng (.xlsx) hoặc file bị lỗi. Chi tiết: {err_msg}'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(
                {'error': err_msg, 'log_id': getattr(e, 'log_id', None)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # AuditLog
        AuditLog.objects.create(
            user=request.user,
            action='IMPORT',
            entity_type='Product',
            entity_id=result['log_id'],
            entity_id_str=str(result['log_id']),
            entity_code=file.name or '',
            new_values={
                'filename': file.name,
                'total_rows': result['total_rows'],
                'success_count': result['success_count'],
                'error_count': result['error_count'],
                'log_id': result['log_id'],
            },
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )

        return Response({
            'success_count': result['success_count'],
            'error_count': result['error_count'],
            'errors': result['errors'],
            'log_id': result['log_id'],
        })
