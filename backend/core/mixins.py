from io import BytesIO

from django.http import HttpResponse
from openpyxl import Workbook
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import AuditLog


def get_client_ip(request):
    """Get client IP from request"""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip

class AuditLogMixin:
    """Mixin to automatically create audit logs"""
    
    def perform_create(self, serializer):
        """Log CREATE action"""
        # Check if serializer has custom create() - if so, don't pass created_by
        # The serializer.create() should handle it
        try:
            obj = serializer.save(created_by=self.request.user)
        except TypeError:
            # Serializer.create() doesn't accept created_by as kwarg
            obj = serializer.save()
        
        # Create audit log
        # Convert validated_data to JSON-serializable format
        new_values = {}
        for key, value in serializer.validated_data.items():
            if hasattr(value, 'id') and hasattr(value, '__class__'):
                # FK object - store ID and name
                new_values[key] = f'{value.__class__.__name__}({value.id})'
            else:
                new_values[key] = str(value) if value is not None else None
        
        AuditLog.objects.create(
            user=self.request.user,
            action='CREATE',
            entity_type=obj.__class__.__name__,
            entity_id=obj.id,
            entity_code=getattr(obj, 'code', str(obj.id)),
            new_values=new_values,
            ip_address=get_client_ip(self.request),
            user_agent=self.request.META.get('HTTP_USER_AGENT', '')[:500]
        )
    
    def perform_update(self, serializer):
        """Log UPDATE action"""
        obj = serializer.instance
        
        # Get old values
        old_values = {}
        changed_fields = []
        
        for field in serializer.validated_data.keys():
            old_value = getattr(obj, field, None)
            new_value = serializer.validated_data[field]
            
            # Check if value changed
            if old_value != new_value:
                changed_fields.append(field)
                old_values[field] = str(old_value) if old_value is not None else None
        
        # Update object
        obj = serializer.save(updated_by=self.request.user)
        
        # Create audit log (only if something changed)
        if changed_fields:
            AuditLog.objects.create(
                user=self.request.user,
                action='UPDATE',
                entity_type=obj.__class__.__name__,
                entity_id=obj.id,
                entity_code=getattr(obj, 'code', str(obj.id)),
                old_values=old_values,
                new_values={k: str(v) for k, v in serializer.validated_data.items() if k in changed_fields},
                changed_fields=changed_fields,
                ip_address=get_client_ip(self.request),
                user_agent=self.request.META.get('HTTP_USER_AGENT', '')[:500]
            )
    
    def perform_destroy(self, instance):
        """Log DELETE action"""
        # Create audit log before delete
        AuditLog.objects.create(
            user=self.request.user,
            action='DELETE',
            entity_type=instance.__class__.__name__,
            entity_id=instance.id,
            entity_code=getattr(instance, 'code', str(instance.id)),
            old_values={'id': instance.id, 'code': getattr(instance, 'code', None)},
            ip_address=get_client_ip(self.request),
            user_agent=self.request.META.get('HTTP_USER_AGENT', '')[:500]
        )
        
        # Delete object
        instance.delete()


def _get_attr_path(obj, path):
    """
    Lấy giá trị theo path 'field' hoặc 'field__nested__name'.
    FK null / bất kỳ None nào trong chain → trả về ''.
    Giá trị cuối convert sang str cho Excel (số, date, ...).
    """
    for part in path.split('__'):
        obj = getattr(obj, part, None)
        if obj is None:
            return ''
    return str(obj) if obj is not None else ''


class ExportExcelMixin:
    """
    Mixin dùng chung cho xuất Excel. ViewSet kế thừa mixin này và chỉ cần
    khai báo: tiêu đề sheet, tên file, headers, và cách map mỗi dòng.
    Nếu có export_template_entity_type thì ưu tiên dùng ExportTemplate (columns/headers từ DB).
    """

    export_template_entity_type = None  # e.g. 'ProductCategory', 'Product' -> dùng ExportTemplate nếu có

    @action(detail=False, methods=['get'], url_path='export_data')
    def export_data(self, request):
        fmt = request.query_params.get('format', 'excel')
        if fmt not in ('excel', 'pdf'):
            return Response({'error': 'Chỉ hỗ trợ format=excel hoặc format=pdf'}, status=400)

        queryset = self.get_export_queryset()
        sheet_title = self.get_export_sheet_title()
        filename = self.get_export_filename()
        headers = self.get_export_headers()

        # PDF: dùng export_to_pdf (chung)
        if fmt == 'pdf':
            from .utils import export_to_pdf
            fields = self.get_export_pdf_fields()
            # Nếu có ExportTemplate, dùng columns/headers từ template
            if self.export_template_entity_type:
                from .models import ExportTemplate
                template = ExportTemplate.objects.filter(
                    entity_type=self.export_template_entity_type,
                    is_active=True,
                ).order_by('-is_default', 'id').first()
                if template and template.columns and template.headers:
                    fields = template.columns
                    headers = template.headers
            return export_to_pdf(
                queryset,
                fields,
                headers,
                filename.replace('.xlsx', '.pdf'),
                title=sheet_title,
            )

        # Chuẩn: dùng ExportTemplate nếu có (cấu hình columns/headers)
        if self.export_template_entity_type:
            from .models import ExportTemplate
            template = ExportTemplate.objects.filter(
                entity_type=self.export_template_entity_type,
                is_active=True,
            ).order_by('-is_default', 'id').first()
            if template and template.columns and template.headers:
                headers = template.headers
                wb = Workbook()
                ws = wb.active
                ws.title = sheet_title[:31]
                ws.append(headers)
                for obj in queryset:
                    row = [_get_attr_path(obj, col) for col in template.columns]
                    ws.append(row)
                output = BytesIO()
                wb.save(output)
                output.seek(0)
                response = HttpResponse(
                    output.read(),
                    content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                )
                response['Content-Disposition'] = f'attachment; filename="{filename}"'
                return response

        headers = self.get_export_headers()
        wb = Workbook()
        ws = wb.active
        ws.title = sheet_title[:31]
        ws.append(headers)
        for obj in queryset:
            ws.append(self.get_export_row(obj))
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        response = HttpResponse(
            output.read(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        # Audit log cho export (nếu có entity_type)
        if getattr(self, 'export_template_entity_type', None) and request.user.is_authenticated:
            try:
                from .models import AuditLog
                AuditLog.objects.create(
                    user=request.user,
                    action='EXPORT',
                    entity_type=self.export_template_entity_type,
                    entity_id=0,
                    entity_code=filename,
                    new_values={'filename': filename, 'rows': queryset.count()},
                    ip_address=get_client_ip(request),
                    user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
                )
            except Exception:
                pass
        return response

    def get_export_queryset(self):
        """Mặc định dùng queryset + filter của ViewSet. Override nếu cần."""
        return self.filter_queryset(self.get_queryset())

    def get_export_sheet_title(self):
        """Override: tên sheet trong file Excel, ví dụ 'Sản phẩm', 'Nguyên liệu'."""
        return 'Data'

    def get_export_filename(self):
        """Override: tên file tải về, ví dụ 'san_pham.xlsx'."""
        return 'export.xlsx'

    def get_export_headers(self):
        """Override: list tiêu đề cột, ví dụ ['Mã hàng', 'Tên hàng', ...]."""
        return []

    def get_export_row(self, obj):
        """Override: với mỗi bản ghi obj, trả về list giá trị tương ứng 1 dòng."""
        return []

    def get_export_pdf_fields(self):
        """Override: list field paths cho export PDF (VD: ['code', 'name', 'category__name'])."""
        return getattr(self, 'export_pdf_fields', [])
