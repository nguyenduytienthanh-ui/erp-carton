from io import BytesIO
import os
import uuid

from django.db.models import Q, Count
from django.conf import settings
from django.core.files.storage import default_storage
from django.http import HttpResponse
from openpyxl import Workbook
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.filters import ProductFilter
from core.mixins import ExportExcelMixin
from .models import ProductCategory, ProductUnit, ProductWave, ProductBoxType, Product
from .serializers import (
    ProductCategorySerializer,
    ProductUnitSerializer,
    ProductWaveSerializer,
    ProductBoxTypeSerializer,
    ProductSerializer,
)


class ProductCategoryViewSet(viewsets.ModelViewSet):
    """CRUD ProductCategory với tree support"""

    queryset = ProductCategory.objects.all()
    serializer_class = ProductCategorySerializer
    permission_classes = [IsAuthenticated]

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['is_active', 'parent']
    search_fields = ['code', 'name', 'description']
    ordering_fields = ['code', 'name', 'created_at']
    ordering = ['code']

    @action(detail=False, methods=['get'])
    def tree(self, request):
        """Lấy cây danh mục"""
        roots = self.queryset.filter(parent__isnull=True, is_active=True)
        serializer = self.get_serializer(roots, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def bulk_activate(self, request, pk=None):
        """Kích hoạt nhiều danh mục"""
        ids = request.data.get('ids', [])
        ProductCategory.objects.filter(id__in=ids).update(is_active=True)
        return Response({'message': f'Đã kích hoạt {len(ids)} danh mục'})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        """Xóa nhiều danh mục"""
        ids = request.data.get('ids', [])
        ProductCategory.objects.filter(id__in=ids).delete()
        return Response({'message': f'Đã xóa {len(ids)} danh mục'})


class ProductUnitViewSet(viewsets.ModelViewSet):
    """CRUD ProductUnit (đơn giản)"""

    queryset = ProductUnit.objects.all()
    serializer_class = ProductUnitSerializer
    permission_classes = [IsAuthenticated]

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['is_active']
    search_fields = ['code', 'name']
    ordering_fields = ['code', 'name', 'created_at']
    ordering = ['code']

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        """Kích hoạt nhiều đơn vị"""
        ids = request.data.get('ids', [])
        ProductUnit.objects.filter(id__in=ids).update(is_active=True)
        return Response({'message': f'Đã kích hoạt {len(ids)} đơn vị'})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        """Xóa nhiều đơn vị"""
        ids = request.data.get('ids', [])
        ProductUnit.objects.filter(id__in=ids).delete()
        return Response({'message': f'Đã xóa {len(ids)} đơn vị'})


class ProductWaveViewSet(viewsets.ModelViewSet):
    """ViewSet cho quản lý loại sóng"""
    queryset = ProductWave.objects.all()
    serializer_class = ProductWaveSerializer
    permission_classes = [IsAuthenticated]

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['is_active']
    search_fields = ['code', 'name']
    ordering_fields = ['code', 'name', 'created_at']
    ordering = ['code']

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get('is_active') == 'true':
            queryset = queryset.filter(is_active=True)
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(code__icontains=search) | Q(name__icontains=search)
            )
        return queryset.order_by('code')


class ProductBoxTypeViewSet(viewsets.ModelViewSet):
    """ViewSet cho quản lý kiểu thùng"""
    queryset = ProductBoxType.objects.all()
    serializer_class = ProductBoxTypeSerializer
    permission_classes = [IsAuthenticated]

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['is_active']
    search_fields = ['code', 'name']
    ordering_fields = ['code', 'name', 'created_at']
    ordering = ['code']

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get('is_active') == 'true':
            queryset = queryset.filter(is_active=True)
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(code__icontains=search) | Q(name__icontains=search)
            )
        return queryset.order_by('code')


class ProductViewSet(ExportExcelMixin, viewsets.ModelViewSet):
    """CRUD Product với Data Scope, Export (Mixin), Bulk Actions, Import Template"""

    queryset = Product.objects.select_related(
        'category', 'unit', 'wave', 'box_type', 'owner', 'team', 'created_by', 'updated_by'
    ).all()
    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated]

    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ProductFilter
    ordering_fields = ['code', 'name', 'cost_price', 'sale_price', 'created_at']
    ordering = ['-created_at']

    def get_queryset(self):
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

        # Fuzzy search (trigram + unidecode)
        search = self.request.query_params.get('search', None)
        if search:
            from core.utils import get_fuzzy_search_queryset
            search_fields = ['code', 'name', 'description']
            queryset = get_fuzzy_search_queryset(queryset, search, search_fields)
            print(f"🔍 Fuzzy search: '{search}' → {queryset.count()} results")

        # Chỉ Mã mẹ khi LIST (bảng tổng hợp) - không filter khi retrieve/update/destroy
        if self.action == 'list' and self.request.query_params.get('parent__isnull') in ('true', 'True', '1'):
            queryset = queryset.filter(parent__isnull=True).annotate(components_count=Count('components'))

        return queryset

    def perform_create(self, serializer):
        from core.models import NumberSequence

        # Mã tự nhập: dùng code từ request nếu có; không thì mới auto
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
            code = seq.get_next_number()

        serializer.save(
            code=code,
            created_by=self.request.user,
            updated_by=self.request.user
        )

    def perform_update(self, serializer):
        instance = serializer.instance
        # Sản phẩm con: không cho sửa mã (mã theo mẹ)
        if instance.parent is not None:
            serializer.validated_data.pop('code', None)
        old_code = instance.code
        serializer.save(updated_by=self.request.user)
        # Nếu mã mẹ đổi → cập nhật mã con (Mã mẹ-1, Mã mẹ-2...)
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

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        """Xóa nhiều sản phẩm"""
        ids = request.data.get('ids', [])
        Product.objects.filter(id__in=ids).delete()
        return Response({'message': f'Đã xóa {len(ids)} sản phẩm'})

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        """Kích hoạt nhiều sản phẩm"""
        ids = request.data.get('ids', [])
        Product.objects.filter(id__in=ids).update(is_active=True, status='ACTIVE')
        return Response({'message': f'Đã kích hoạt {len(ids)} sản phẩm'})

    @action(detail=False, methods=['post'])
    def bulk_discontinue(self, request):
        """Ngừng sản xuất nhiều sản phẩm"""
        ids = request.data.get('ids', [])
        Product.objects.filter(id__in=ids).update(status='DISCONTINUED')
        return Response({'message': f'Đã ngừng sản xuất {len(ids)} sản phẩm'})

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
        return [
            'Mã SP', 'Tên sản phẩm', 'Danh mục', 'Đơn vị',
            'Kích thước ĐH', 'KTSX', 'Sóng', 'Kiểu',
            'Giá vốn', 'Giá bán', 'Tồn TT', '+/-',
            'HHCĐ (đ/cái)', 'HH%', 'Mô tả', 'Trạng thái', 'Ghi chú',
        ]

    def get_export_row(self, obj):
        return [
            obj.code or '',
            obj.name or '',
            obj.category.name if obj.category else '',
            obj.unit.name if obj.unit else '',
            obj.size_order or '',
            obj.size_production or '',
            obj.wave.code if obj.wave else '',
            obj.box_type.code if obj.box_type else '',
            float(obj.cost_price) if obj.cost_price is not None else 0,
            float(obj.sale_price) if obj.sale_price is not None else 0,
            float(obj.min_stock) if obj.min_stock is not None else 0,
            obj.delivery_tolerance or '',
            float(obj.commission_per_unit) if obj.commission_per_unit is not None else 0,
            float(obj.commission_percent) if obj.commission_percent is not None else 0,
            (obj.description or '')[:500],
            obj.get_status_display() if obj.status else '',
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
        """Download Excel template for import (đủ cột: kích thước, sóng, kiểu, ...)"""
        wb = Workbook()
        ws = wb.active
        ws.title = 'Template'

        headers = [
            'Mã SP', 'Tên sản phẩm', 'Mã danh mục', 'Mã đơn vị',
            'Kích thước ĐH', 'KTSX', 'Sóng', 'Kiểu',
            'Giá vốn', 'Giá bán', 'Tồn TT', '+/-',
            'HHCĐ (đ/cái)', 'HH%', 'Mô tả', 'Trạng thái', 'Ghi chú',
        ]
        ws.append(headers)

        ws.append([
            'PROD-0001', 'Thùng carton mẫu', 'CAT-001', 'CAI',
            '30x20x15', '30x20x15', 'BC', 'A1',
            10000, 15000, 100, '±5%', 500, 0, 'Mô tả mẫu', 'ACTIVE', 'Ghi chú mẫu',
        ])
        ws.append([
            'PROD-0002', 'Hộp giấy mẫu', 'CAT-002', 'HOP',
            '25x18x10', '25x18x10', 'E', 'A5',
            5000, 8000, 200, '', 0, 2.5, '', 'ACTIVE', '',
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
        """Import sản phẩm từ Excel"""
        file = request.FILES.get('file')
        if not file:
            return Response({'error': 'Không có file'}, status=status.HTTP_400_BAD_REQUEST)

        import openpyxl
        from core.models import NumberSequence

        wb = openpyxl.load_workbook(file)
        ws = wb.active

        success_count = 0
        error_count = 0
        errors = []

        seq = NumberSequence.objects.filter(entity_type='Product', is_active=True).first()
        if not seq:
            seq = NumberSequence.objects.create(
                entity_type='Product',
                prefix='PROD',
                padding=3,
                format_template='{prefix}-{number}',
                is_active=True,
            )

        for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
            try:
                # Template: 17 cột (Mã SP, Tên, Mã DM, Mã ĐV, Kích thước ĐH, KTSX, Sóng, Kiểu, Giá vốn, Giá bán, Tồn TT, +/-, HHCĐ, HH%, Mô tả, Trạng thái, Ghi chú)
                row = list(row)
                if len(row) < 17:
                    row.extend([None] * (17 - len(row)))
                (code, name, category_code, unit_code,
                 size_order, size_production, wave_type, box_type,
                 cost_price, sale_price, min_stock, delivery_tolerance,
                 commission_per_unit, commission_percent, description,
                 status_val, note) = row[:17]
                name = str(name).strip() if name is not None else ''

                if not name:
                    errors.append(f'Dòng {row_idx}: Thiếu tên sản phẩm')
                    error_count += 1
                    continue

                # Get category
                category = None
                if category_code:
                    category = ProductCategory.objects.filter(code=str(category_code).strip()).first()

                # Get unit
                unit = ProductUnit.objects.filter(code=str(unit_code).strip()).first() if unit_code else None
                if not unit:
                    errors.append(f'Dòng {row_idx}: Không tìm thấy đơn vị {unit_code}')
                    error_count += 1
                    continue

                # Get wave and box_type by code
                wave = None
                if wave_type:
                    wave = ProductWave.objects.filter(code=str(wave_type).strip()).first()
                box_type_obj = None
                if box_type:
                    box_type_obj = ProductBoxType.objects.filter(code=str(box_type).strip()).first()

                # Auto-generate code if empty
                if not code:
                    code = seq.get_next_number()
                code = str(code).strip()

                # Normalize status
                status_val = (str(status_val).strip() if status_val else 'DRAFT')
                if status_val not in dict(Product.STATUS_CHOICES):
                    status_val = 'DRAFT'

                # Create or update (đủ trường: kích thước, sóng, kiểu, mô tả, ghi chú, ...)
                Product.objects.update_or_create(
                    code=code,
                    defaults={
                        'name': name,
                        'category': category,
                        'unit': unit,
                        'size_order': str(size_order).strip() if size_order else '',
                        'size_production': str(size_production).strip() if size_production else '',
                        'wave': wave,
                        'box_type': box_type_obj,
                        'description': str(description).strip() if description else '',
                        'cost_price': cost_price or 0,
                        'sale_price': sale_price or 0,
                        'min_stock': min_stock or 0,
                        'delivery_tolerance': str(delivery_tolerance).strip() if delivery_tolerance else '',
                        'commission_per_unit': commission_per_unit or 0,
                        'commission_percent': commission_percent or 0,
                        'note': str(note).strip() if note else '',
                        'status': status_val,
                        'created_by': request.user,
                        'updated_by': request.user,
                    }
                )
                success_count += 1

            except Exception as e:
                errors.append(f'Dòng {row_idx}: {str(e)}')
                error_count += 1

        return Response({
            'success_count': success_count,
            'error_count': error_count,
            'errors': errors
        })
