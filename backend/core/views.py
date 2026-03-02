from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
import django_filters
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from django.http import HttpResponse
from django.db import models
from django.db.models import Count, DateTimeField, Exists, IntegerField, OuterRef, Subquery
from django.db.models.functions import Coalesce
from datetime import datetime
from datetime import timedelta
from .models import User, Role, Permission, Team, Setting, Customer, ExportTemplate, SavedView, Attachment, Comment, Notification, AuditLog, UserSession, UserPreferences, ColumnPermission, Task, WorkflowTaskTemplate, TaskWatcher
from .serializers import (
    UserSerializer, RoleSerializer, PermissionSerializer,
    TeamSerializer, SettingSerializer, CustomTokenObtainPairSerializer,
    CustomerSerializer, ExportTemplateSerializer, SavedViewSerializer, AttachmentSerializer, CommentSerializer, NotificationSerializer, UserSessionSerializer, UserPreferencesSerializer, ColumnPermissionSerializer, TaskSerializer,
    WorkflowTaskTemplateSerializer,
)
from django.utils import timezone as django_timezone
from .filters import CustomerFilter, TeamFilter, RoleFilter
from .utils import export_to_excel
from .mixins import AuditLogMixin, ExportExcelMixin
from .permissions import check_action_permission


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        """Bulk activate/deactivate users"""
        ids = request.data.get('ids', [])
        is_active = request.data.get('is_active', True)
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        count = User.objects.filter(id__in=ids).update(is_active=is_active)
        return Response({"success": True, "count": count})

    @action(detail=False, methods=['post'])
    def bulk_lock(self, request):
        """Bulk lock/unlock users"""
        ids = request.data.get('ids', [])
        is_locked = request.data.get('is_locked', True)
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        count = User.objects.filter(id__in=ids).update(is_locked=is_locked)
        return Response({"success": True, "count": count})


class UserPreferencesViewSet(viewsets.ViewSet):
    """
    API cho user preferences
    GET/POST/DELETE /api/preferences/{page}/
    """
    serializer_class = UserPreferencesSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return UserPreferences.objects.filter(user=self.request.user)

    def page_config(self, request, page=None):
        """Get/Save/Delete config cho page"""
        if request.method == 'GET':
            try:
                pref = UserPreferences.objects.get(user=request.user, page=page)
                serializer = UserPreferencesSerializer(pref)
                return Response(serializer.data)
            except UserPreferences.DoesNotExist:
                return Response({'config': {}}, status=status.HTTP_200_OK)

        elif request.method == 'POST':
            config = request.data.get('config', {})
            pref, created = UserPreferences.objects.update_or_create(
                user=request.user,
                page=page,
                defaults={'config': config}
            )
            serializer = UserPreferencesSerializer(pref)
            return Response(serializer.data, status=status.HTTP_200_OK)

        elif request.method == 'DELETE':
            UserPreferences.objects.filter(user=request.user, page=page).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)


class ColumnPermissionViewSet(viewsets.ModelViewSet):
    """
    API quản lý phân quyền cột
    GET /api/column-permissions/{page}/available/ → Lấy cột được phép
    """
    queryset = ColumnPermission.objects.all()
    serializer_class = ColumnPermissionSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'], url_path=r'(?P<page>[^/.]+)/available')
    def available_columns(self, request, page=None):
        """
        Trả về danh sách cột user được phép xem
        Response: {available_columns: [...], restricted_columns: [...]}
        """
        user = request.user
        permissions = ColumnPermission.objects.filter(page=page, is_active=True)

        # Debug log
        # NOTE: Keep logs ASCII-safe for Windows consoles (avoid emoji -> UnicodeEncodeError)
        print(f"\n[ColumnPermission] page={page}, user={user.username} (id={user.id})")
        print(f"   user.roles: {list(user.roles.values_list('code', flat=True))}")
        print(f"   permissions count: {permissions.count()}")

        available = []
        restricted = []
        for perm in permissions:
            if perm.user_has_permission(user):
                available.append(perm.column)
            else:
                restricted.append(perm.column)

        user_roles_list = list(user.roles.values_list('code', flat=True))
        print(f"   Result: available={available}, restricted={restricted}, user_roles={user_roles_list}")
        return Response({
            'page': page,
            'available_columns': available,
            'restricted_columns': restricted,
            'user_roles': user_roles_list,
            'user_id': user.id,
        })


class RoleViewSet(ExportExcelMixin, viewsets.ModelViewSet):
    """Master Data chuẩn: filterset + search + ordering + soft delete + bulk + export."""
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    permission_classes = [IsAuthenticated]
    export_template_entity_type = 'Role'
    filter_backends = [
        django_filters.rest_framework.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = RoleFilter
    search_fields = ['code', 'name', 'description']
    ordering_fields = ['code', 'name', 'sort_order', 'created_at']
    ordering = ['sort_order', 'name']

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        instance.deleted_at = django_timezone.now()
        instance.deleted_by = self.request.user
        instance.save()

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        ids = request.data.get('ids', [])
        Role.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=True)
        return Response({'message': f'Đã kích hoạt {len(ids)} role'})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        ids = request.data.get('ids', [])
        Role.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=False)
        return Response({'message': f'Đã vô hiệu hóa {len(ids)} role'})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        now = django_timezone.now()
        Role.objects.filter(id__in=ids).update(deleted_at=now, deleted_by=request.user)
        return Response({'message': f'Đã xóa (soft) {len(ids)} role'})

    def get_export_sheet_title(self):
        return 'Role'
    def get_export_filename(self):
        return 'roles.xlsx'
    def get_export_headers(self):
        return ['Mã', 'Tên', 'Mô tả', 'Đang dùng', 'Thứ tự', 'Ngày tạo']
    def get_export_row(self, obj):
        return [
            obj.code or '', obj.name or '', (obj.description or '')[:200],
            'Có' if obj.is_active else 'Không', obj.sort_order or 0,
            obj.created_at.strftime('%Y-%m-%d') if obj.created_at else '',
        ]


class PermissionViewSet(viewsets.ModelViewSet):
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer


class TeamViewSet(ExportExcelMixin, viewsets.ModelViewSet):
    """Master Data chuẩn: filterset + search + ordering + soft delete + bulk + export."""
    queryset = Team.objects.all()
    serializer_class = TeamSerializer
    permission_classes = [IsAuthenticated]
    export_template_entity_type = 'Team'
    filter_backends = [
        django_filters.rest_framework.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = TeamFilter
    search_fields = ['code', 'name', 'description']
    ordering_fields = ['code', 'name', 'sort_order', 'created_at']
    ordering = ['sort_order', 'name']

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        instance.deleted_at = django_timezone.now()
        instance.deleted_by = self.request.user
        instance.save()

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        ids = request.data.get('ids', [])
        Team.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=True)
        return Response({'message': f'Đã kích hoạt {len(ids)} team'})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        ids = request.data.get('ids', [])
        Team.objects.filter(id__in=ids, deleted_at__isnull=True).update(is_active=False)
        return Response({'message': f'Đã vô hiệu hóa {len(ids)} team'})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        now = django_timezone.now()
        Team.objects.filter(id__in=ids).update(deleted_at=now, deleted_by=request.user)
        return Response({'message': f'Đã xóa (soft) {len(ids)} team'})

    def get_export_sheet_title(self):
        return 'Team'
    def get_export_filename(self):
        return 'teams.xlsx'
    def get_export_headers(self):
        return ['Mã', 'Tên', 'Mô tả', 'Đang dùng', 'Thứ tự', 'Ngày tạo']
    def get_export_row(self, obj):
        return [
            obj.code or '', obj.name or '', (obj.description or '')[:200],
            'Có' if obj.is_active else 'Không', obj.sort_order or 0,
            obj.created_at.strftime('%Y-%m-%d') if obj.created_at else '',
        ]


class SettingViewSet(viewsets.ModelViewSet):
    queryset = Setting.objects.all()
    serializer_class = SettingSerializer


class CustomerViewSet(ExportExcelMixin, AuditLogMixin, viewsets.ModelViewSet):
    """CRUD Customer với ExportExcelMixin (export_data), Data Scope, Search tiếng Việt không dấu."""
    export_template_entity_type = 'Customer'
    queryset = Customer.objects.select_related('owner', 'team', 'created_by', 'updated_by').all()
    serializer_class = CustomerSerializer
    filterset_class = CustomerFilter
    ordering_fields = ['code', 'name', 'created_at', 'updated_at', 'credit_limit']
    ordering = ['-created_at']

    def get_queryset(self):
        """Apply data scope filtering and custom search (unaccent via unidecode)"""
        queryset = Customer.objects.all()
        user = self.request.user

        if not user.is_authenticated:
            return queryset.none()

        # Admin sees everything
        if user.is_superuser:
            pass
        else:
            user_roles = list(user.roles.values_list('name', flat=True))
            if 'Admin' in user_roles or 'Manager' in user_roles:
                user_teams = user.teams.all()
                queryset = queryset.filter(
                    models.Q(owner=user) |
                    models.Q(team__in=user_teams) |
                    models.Q(owner__isnull=True, team__isnull=True)
                )
            else:
                queryset = queryset.filter(
                    models.Q(owner=user) |
                    models.Q(owner__isnull=True, team__isnull=True)
                )

        # Search: exact_search=1 dùng get_search_query (icontains, không trigram); ngược lại fuzzy
        search = (self.request.query_params.get('search') or self.request.query_params.get('q') or '').strip()
        exact_search = self.request.query_params.get('exact_search') in ('1', 'true', 'True')
        if search:
            search_fields = ['code', 'name', 'company_name', 'email', 'phone', 'address']
            if exact_search:
                from core.utils import get_search_query
                q = get_search_query(search, search_fields)
                queryset = queryset.filter(q)
            else:
                from core.utils import get_fuzzy_search_queryset
                # 1) Ưu tiên match chính xác code (vd: KH001 -> đúng 1 record)
                exact_code = queryset.filter(code__iexact=search)
                if exact_code.exists():
                    return exact_code
                # 2) Fuzzy search (trigram + unaccent)
                queryset = get_fuzzy_search_queryset(queryset, search, search_fields)

        return queryset

    def get_export_queryset(self):
        return self.filter_queryset(self.get_queryset())

    def get_export_sheet_title(self):
        return 'Khách hàng'

    def get_export_filename(self):
        from datetime import datetime
        return f'khach_hang_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'

    def get_export_headers(self):
        return ['Mã KH', 'Tên KH', 'Tên công ty', 'MST', 'Điện thoại', 'Email', 'Địa chỉ', 'Trạng thái', 'Owner', 'Team']

    def get_export_row(self, obj):
        return [
            obj.code or '',
            obj.name or '',
            obj.company_name or '',
            obj.tax_code or '',
            obj.phone or '',
            obj.email or '',
            obj.address or '',
            obj.get_status_display() if hasattr(obj, 'get_status_display') else (obj.status or ''),
            obj.owner.username if obj.owner else '',
            obj.team.name if obj.team else '',
        ]

    def get_export_pdf_fields(self):
        return ['code', 'name', 'company_name', 'tax_code', 'phone', 'email', 'address', 'status', 'owner__username', 'team__name']

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        """Bulk delete customers"""
        ids = request.data.get('ids', [])
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        
        count = Customer.objects.filter(id__in=ids).delete()[0]
        return Response({"success": True, "count": count})

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        """Bulk activate/deactivate customers"""
        ids = request.data.get('ids', [])
        is_active = request.data.get('is_active', True)
        
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        
        count = Customer.objects.filter(id__in=ids).update(is_active=is_active)
        return Response({"success": True, "count": count})

    @action(detail=False, methods=['post'])
    def bulk_export(self, request):
        """Bulk export selected customers"""
        from .utils import export_to_excel
        from datetime import datetime
        
        ids = request.data.get('ids', [])
        template_id = request.data.get('template_id')
        
        if not ids:
            return Response({"error": "No IDs provided"}, status=400)
        
        # Get template
        template = ExportTemplate.objects.filter(
            entity_type='Customer',
            is_default=True
        ).first()
        
        if template_id:
            template = ExportTemplate.objects.filter(id=template_id).first()
        
        if not template:
            return Response({"error": "No template found"}, status=404)
        
        # Get selected customers
        customers = Customer.objects.filter(id__in=ids)
        filename = f'customers_selected_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
        
        return export_to_excel(customers, template.columns, template.headers, filename)
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def export_pdf(self, request):
        """Export customers to PDF"""
        from .models import ExportTemplate
        from .utils import export_to_pdf
        from datetime import datetime
        
        # Get template
        template_id = request.query_params.get('template_id')
        if template_id:
            try:
                template = ExportTemplate.objects.get(id=template_id, entity_type='Customer', is_active=True)
            except ExportTemplate.DoesNotExist:
                return Response({"error": "Template not found"}, status=404)
        else:
            template = ExportTemplate.objects.filter(entity_type='Customer', is_default=True, is_active=True).first()
            if not template:
                return Response({"error": "No default template"}, status=404)
        
        # Get filtered queryset
        queryset = self.filter_queryset(self.get_queryset())
        
        # Export PDF
        filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.pdf'
        return export_to_pdf(queryset, template.columns, template.headers, filename, title='Customer List')

    @action(detail=False, methods=['post'], permission_classes=[AllowAny])
    def export_async(self, request):
        """Queue async export task"""
        from django_q.tasks import async_task

        template_id = request.data.get('template_id')
        if not template_id:
            return Response({"error": "template_id required"}, status=400)

        # Queue task
        task_id = async_task(
            'core.tasks.async_export_customers',
            request.user.id if request.user.is_authenticated else 1,
            template_id
        )

        return Response({
            "success": True,
            "message": "Export queued. You will receive a notification when ready.",
            "task_id": task_id
        })
    
    @action(detail=False, methods=['post'], permission_classes=[AllowAny])
    def import_excel(self, request):
        """Import customers from Excel"""
        from .utils import import_from_excel
        
        # Get uploaded file
        if 'file' not in request.FILES:
            return Response({"error": "No file uploaded"}, status=400)
        
        file = request.FILES['file']
        
        # Validate file extension
        if not file.name.endswith('.xlsx'):
            return Response({"error": "Only .xlsx files are supported"}, status=400)
        
        # Field mapping (Excel header -> Model field)
        field_mapping = {
            'Mã KH': 'code',
            'Tên KH': 'name',
            'Tên công ty': 'company_name',
            'MST': 'tax_code',
            'Điện thoại': 'phone',
            'Email': 'email',
            'Địa chỉ': 'address',
            'Người liên hệ': 'contact_person',
            'SĐT liên hệ': 'contact_phone',
            'Thời hạn TT': 'payment_terms',
            'Hạn mức': 'credit_limit',
        }
        
        try:
            result = import_from_excel(
                file,
                Customer,
                field_mapping,
                user=request.user if request.user.is_authenticated else None
            )
            
            return Response({
                "success": True,
                "total_rows": result['total'],
                "success_count": result['success'],
                "error_count": len(result['errors']),
                "errors": result['errors'],
                "log_id": result.get('log_id'),
            })
            
        except Exception as e:
            return Response({"error": str(e)}, status=500)
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def download_import_template(self, request):
        """Download Excel template for import"""
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
        from django.http import HttpResponse
        
        # Create workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Customers"
        
        # Headers
        headers = [
            'Mã KH', 'Tên KH', 'Tên công ty', 'MST', 
            'Điện thoại', 'Email', 'Địa chỉ', 
            'Người liên hệ', 'SĐT liên hệ', 
            'Thời hạn TT', 'Hạn mức'
        ]
        
        ws.append(headers)
        
        # Style header
        header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
        header_font = Font(color="FFFFFF", bold=True)
        
        for cell in ws[1]:
            cell.fill = header_fill
            cell.font = header_font
        
        # Add example rows
        ws.append([
            'CUST001', 'Công ty ABC', 'CÔNG TY TNHH ABC', '0123456789',
            '0901234567', 'abc@example.com', '123 Đường ABC, Quận 1, TP.HCM',
            'Nguyễn Văn A', '0912345678',
            '30', '50000000'
        ])
        
        ws.append([
            'CUST002', 'Công ty XYZ', 'CÔNG TY CP XYZ', '9876543210',
            '0909876543', 'xyz@example.com', '456 Đường XYZ, Quận 2, TP.HCM',
            'Trần Thị B', '0987654321',
            '60', '100000000'
        ])
        
        # Auto column width
        for column in ws.columns:
            max_length = 0
            column_letter = column[0].column_letter
            for cell in column:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except:
                    pass
            adjusted_width = min(max_length + 2, 50)
            ws.column_dimensions[column_letter].width = adjusted_width
        
        # Create response
        response = HttpResponse(
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response['Content-Disposition'] = 'attachment; filename="customer_import_template.xlsx"'
        wb.save(response)
        
        return response
    
    @action(detail=True, methods=['post'], permission_classes=[AllowAny])
    def upload_attachment(self, request, pk=None):
        """Upload file attachment to customer"""
        customer = self.get_object()
        
        if 'file' not in request.FILES:
            return Response({"error": "No file uploaded"}, status=400)
        
        file = request.FILES['file']
        description = request.data.get('description', '')
        
        # Create attachment
        attachment = Attachment.objects.create(
            entity_type='Customer',
            entity_id=customer.id,
            file=file,
            filename=file.name,
            file_size=file.size,
            file_type=getattr(file, 'content_type', ''),
            description=description,
            uploaded_by=request.user if request.user.is_authenticated else None
        )
        
        serializer = AttachmentSerializer(attachment, context={'request': request})
        return Response(serializer.data, status=201)
    
    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def list_attachments(self, request, pk=None):
        """List all attachments for this customer"""
        customer = self.get_object()
        
        attachments = Attachment.objects.filter(
            entity_type='Customer',
            entity_id=customer.id
        )
        
        serializer = AttachmentSerializer(attachments, many=True, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'], permission_classes=[AllowAny])
    def add_comment(self, request, pk=None):
        """Add comment to customer"""
        customer = self.get_object()
        content = request.data.get('content', '')
        parent_id = request.data.get('parent_id')
        
        if not content:
            return Response({"error": "Content required"}, status=400)
        
        comment = Comment.objects.create(
            entity_type='Customer',
            entity_id=customer.id,
            content=content,
            parent_id=parent_id,
            created_by=request.user if request.user.is_authenticated else None
        )
        
        serializer = CommentSerializer(comment)
        return Response(serializer.data, status=201)
    
    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def list_comments(self, request, pk=None):
        """List all comments for this customer"""
        customer = self.get_object()
        
        comments = Comment.objects.filter(
            entity_type='Customer',
            entity_id=customer.id,
            parent__isnull=True,  # Only top-level
            is_deleted=False
        ).order_by('created_at')
        
        serializer = CommentSerializer(comments, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def submit_for_approval(self, request, pk=None):
        """Submit customer for approval"""
        customer = self.get_object()
        
        if customer.status != 'DRAFT':
            return Response({"error": "Only draft customers can be submitted"}, status=400)
        
        customer.status = 'PENDING_APPROVAL'
        customer.save()
        
        # Log approval history
        from .models import ApprovalHistory
        ApprovalHistory.objects.create(
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            action='SUBMIT',
            user=request.user,
            level=1
        )
        
        # Create audit log
        from .models import AuditLog
        AuditLog.objects.create(
            user=request.user,
            action='APPROVE',
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            new_values={'status': 'PENDING_APPROVAL'}
        )
        
        return Response({"success": True, "status": customer.status})
    
    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """Approve customer"""
        customer = self.get_object()
        
        if customer.status != 'PENDING_APPROVAL':
            return Response({"error": "Only pending customers can be approved"}, status=400)
        
        from django.utils import timezone
        from .models import AuditLog
        customer.status = 'APPROVED'
        customer.approved_by = request.user
        customer.approved_at = timezone.now()
        customer.save()
        
        # Log approval history
        from .models import ApprovalHistory
        ApprovalHistory.objects.create(
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            action='APPROVE',
            user=request.user,
            level=1
        )
        
        # Create audit log
        AuditLog.objects.create(
            user=request.user,
            action='APPROVE',
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            new_values={'status': 'APPROVED'}
        )
        
        return Response({"success": True, "status": customer.status})
    
    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """Reject customer"""
        customer = self.get_object()
        
        if customer.status != 'PENDING_APPROVAL':
            return Response({"error": "Only pending customers can be rejected"}, status=400)
        
        reason = request.data.get('reason', '')
        
        from django.utils import timezone
        from .models import AuditLog
        customer.status = 'REJECTED'
        customer.rejected_by = request.user
        customer.rejected_at = timezone.now()
        customer.rejection_reason = reason
        customer.save()
        
        # Log approval history
        from .models import ApprovalHistory
        ApprovalHistory.objects.create(
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            action='REJECT',
            comments=reason,
            user=request.user,
            level=1
        )
        
        # Create audit log
        AuditLog.objects.create(
            user=request.user,
            action='REJECT',
            entity_type='Customer',
            entity_id=customer.id,
            entity_code=customer.code,
            new_values={'status': 'REJECTED', 'reason': reason}
        )
        
        return Response({"success": True, "status": customer.status})

    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def approval_history(self, request, pk=None):
        """Get approval history for this customer"""
        customer = self.get_object()
        
        from .models import ApprovalHistory
        history = ApprovalHistory.objects.filter(
            entity_type='Customer',
            entity_id=customer.id
        ).order_by('-created_at')
        
        data = []
        for h in history:
            data.append({
                'action': h.get_action_display(),
                'user': h.user.username if h.user else None,
                'comments': h.comments,
                'level': h.level,
                'created_at': h.created_at
            })
        
        return Response(data)

    @action(detail=True, methods=['post'])
    def assign_owner(self, request, pk=None):
        """Assign owner to customer"""
        customer = self.get_object()
        user_id = request.data.get('user_id')

        if not user_id:
            return Response({"error": "user_id required"}, status=400)

        try:
            from django.contrib.auth import get_user_model
            User = get_user_model()
            owner = User.objects.get(id=user_id)

            customer.owner = owner
            customer.save()

            # Log
            AuditLog.objects.create(
                user=request.user,
                action='UPDATE',
                entity_type='Customer',
                entity_id=customer.id,
                entity_code=customer.code,
                new_values={'owner': owner.username}
            )

            return Response({"success": True, "owner": owner.username})
        except User.DoesNotExist:
            return Response({"error": "User not found"}, status=404)

    @action(detail=True, methods=['post'])
    def assign_team(self, request, pk=None):
        """Assign team to customer"""
        customer = self.get_object()
        team_id = request.data.get('team_id')

        if not team_id:
            return Response({"error": "team_id required"}, status=400)

        try:
            team = Team.objects.get(id=team_id)

            customer.team = team
            customer.save()

            # Log
            AuditLog.objects.create(
                user=request.user,
                action='UPDATE',
                entity_type='Customer',
                entity_id=customer.id,
                entity_code=customer.code,
                new_values={'team': team.name}
            )

            return Response({"success": True, "team": team.name})
        except Team.DoesNotExist:
            return Response({"error": "Team not found"}, status=404)
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def export(self, request):
        """Export customers to Excel/CSV/PDF using template"""
        from .models import ExportTemplate
        import csv
        
        # Get format
        format_type = request.query_params.get('format', 'excel')
        
        # Get template
        template_id = request.query_params.get('template_id')
        
        if template_id:
            try:
                template = ExportTemplate.objects.get(
                    id=template_id,
                    entity_type='Customer',
                    is_active=True
                )
            except ExportTemplate.DoesNotExist:
                return Response({"error": "Template not found"}, status=404)
        else:
            template = ExportTemplate.objects.filter(
                entity_type='Customer',
                is_default=True,
                is_active=True
            ).first()
            
            if not template:
                return Response({"error": "No default template found"}, status=404)
        
        # Get filtered queryset
        queryset = self.filter_queryset(self.get_queryset())
        
        # Export based on format
        if format_type == 'csv':
            # CSV Export
            response = HttpResponse(content_type='text/csv; charset=utf-8-sig')
            response['Content-Disposition'] = f'attachment; filename="customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv"'
            
            writer = csv.writer(response)
            writer.writerow(template.headers)
            
            for obj in queryset:
                row = []
                for field in template.columns:
                    value = obj
                    for part in field.split('__'):
                        value = getattr(value, part, '')
                        if value is None:
                            value = ''
                    row.append(str(value))
                writer.writerow(row)
            
            return response
        
        elif format_type == 'excel':
            # Excel Export (existing)
            filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
            return export_to_excel(queryset, template.columns, template.headers, filename)
        
        else:
            return Response({"error": "Invalid format. Use 'excel' or 'csv'"}, status=400)


class ExportTemplateViewSet(viewsets.ReadOnlyModelViewSet):
    """Export Template ViewSet - Read only for users"""
    queryset = ExportTemplate.objects.filter(is_active=True)
    serializer_class = ExportTemplateSerializer
    filterset_fields = ['entity_type']


class SavedViewViewSet(viewsets.ModelViewSet):
    serializer_class = SavedViewSerializer
    filterset_fields = ['entity_type', 'is_public']
    
    def get_queryset(self):
        # User chỉ thấy: view của mình + public views
        if self.request.user.is_authenticated:
            from django.db.models import Q
            return SavedView.objects.filter(
                Q(user=self.request.user) | Q(is_public=True)
            )
        return SavedView.objects.filter(is_public=True)
    
    def perform_create(self, serializer):
        serializer.save(user=self.request.user, created_by=self.request.user)
    
    @action(detail=True, methods=['post'])
    def set_default(self, request, pk=None):
        """Set this view as default for entity_type"""
        view = self.get_object()
        
        # Unset other defaults for this entity
        SavedView.objects.filter(
            user=request.user,
            entity_type=view.entity_type,
            is_default=True
        ).update(is_default=False)
        
        # Set this as default
        view.is_default = True
        view.save()
        
        return Response({"status": "set as default"})
    
    @action(detail=True, methods=['post'], permission_classes=[IsAdminUser])
    def publish(self, request, pk=None):
        """Publish view (admin only)"""
        view = self.get_object()
        view.is_public = True
        view.save()
        return Response({"status": "published"})


class AttachmentViewSet(viewsets.ModelViewSet):
    serializer_class = AttachmentSerializer
    filterset_fields = ['entity_type', 'entity_id']
    
    def get_queryset(self):
        return Attachment.objects.all()
    
    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)
    
    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def download(self, request, pk=None):
        """Download file"""
        attachment = self.get_object()
        
        # Check if file exists
        if not attachment.file:
            return Response({"error": "File not found"}, status=404)
        
        # Serve file
        from django.http import FileResponse
        response = FileResponse(attachment.file.open('rb'))
        response['Content-Disposition'] = f'attachment; filename="{attachment.filename}"'
        response['Content-Type'] = attachment.file_type or 'application/octet-stream'
        
        return response
    
    def destroy(self, request, *args, **kwargs):
        """Delete attachment (and file)"""
        attachment = self.get_object()
        
        # Delete file from disk
        if attachment.file:
            try:
                attachment.file.delete(save=False)
            except:
                pass
        
        # Delete record
        attachment.delete()
        
        return Response(status=204)


class CommentViewSet(viewsets.ModelViewSet):
    serializer_class = CommentSerializer
    filterset_fields = ['entity_type', 'entity_id', 'parent']
    
    def get_queryset(self):
        # Don't show deleted comments
        return Comment.objects.filter(is_deleted=False)
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
    
    def perform_update(self, serializer):
        # Only allow editing own comments
        comment = self.get_object()
        if comment.created_by != self.request.user:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("You can only edit your own comments")
        serializer.save()
    
    def perform_destroy(self, instance):
        # Only allow deleting own comments
        if instance.created_by != self.request.user:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("You can only delete your own comments")
        
        # Soft delete
        from django.utils import timezone
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save()
    
    @action(detail=False, methods=['get'])
    def by_entity(self, request):
        """Get all comments for an entity with replies nested"""
        entity_type = request.query_params.get('entity_type')
        entity_id = request.query_params.get('entity_id')
        
        if not entity_type or not entity_id:
            return Response({"error": "entity_type and entity_id required"}, status=400)
        
        # Get top-level comments (no parent)
        comments = Comment.objects.filter(
            entity_type=entity_type,
            entity_id=entity_id,
            parent__isnull=True,
            is_deleted=False
        ).order_by('created_at')
        
        serializer = self.get_serializer(comments, many=True)
        return Response(serializer.data)


class ActivityStreamViewSet(viewsets.ReadOnlyModelViewSet):
    """Combined activity stream from audit logs and comments"""
    permission_classes = [AllowAny]
    
    @action(detail=False, methods=['get'])
    def by_entity(self, request):
        """Get activity stream for an entity"""
        entity_type = request.query_params.get('entity_type')
        entity_id = request.query_params.get('entity_id')
        
        if not entity_type or not entity_id:
            return Response({"error": "entity_type and entity_id required"}, status=400)
        
        activities = []
        
        # Get audit logs
        from .models import AuditLog, Comment
        
        audit_logs = AuditLog.objects.filter(
            entity_type=entity_type,
            entity_id=entity_id
        ).order_by('-created_at')[:20]
        
        for log in audit_logs:
            activities.append({
                'type': 'audit',
                'action': log.action,
                'user': log.user.username if log.user else None,
                'timestamp': log.created_at,
                'details': {
                    'old_values': log.old_values,
                    'new_values': log.new_values,
                    'changed_fields': log.changed_fields,
                }
            })
        
        # Get comments
        comments = Comment.objects.filter(
            entity_type=entity_type,
            entity_id=entity_id,
            is_deleted=False
        ).order_by('-created_at')[:20]
        
        for comment in comments:
            activities.append({
                'type': 'comment',
                'action': 'COMMENT',
                'user': comment.created_by.username if comment.created_by else None,
                'timestamp': comment.created_at,
                'details': {
                    'content': comment.content,
                    'mentions': comment.mentions,
                }
            })
        
        # Get product price workflow events (avoid duplicate with direct UPDATE audit logs)
        if str(entity_type).lower() == 'product':
            try:
                from products.models import PriceChange
                price_events = PriceChange.objects.filter(
                    product_id=entity_id
                ).exclude(status='APPLIED').order_by('-created_at')[:20]
                for event in price_events:
                    action = {
                        'PENDING': 'SUBMIT',
                        'APPROVED': 'APPROVE',
                        'REJECTED': 'REJECT',
                    }.get(event.status, 'UPDATE')
                    activities.append({
                        'type': 'audit',
                        'action': action,
                        'user': event.submitted_by.username if event.submitted_by else None,
                        'timestamp': event.created_at,
                        'details': {
                            'old_values': {
                                'cost_price': str(event.old_cost_price) if event.old_cost_price is not None else None,
                                'sale_price': str(event.old_sale_price) if event.old_sale_price is not None else None,
                            },
                            'new_values': {
                                'cost_price': str(event.new_cost_price) if event.new_cost_price is not None else None,
                                'sale_price': str(event.new_sale_price) if event.new_sale_price is not None else None,
                                'price_change_reason': event.reason or '',
                                'price_effective_at': event.effective_at.isoformat() if event.effective_at else None,
                                'reject_reason': event.reject_reason or '',
                                'delta_cost_percent': str(event.delta_cost_percent) if event.delta_cost_percent is not None else None,
                                'delta_sale_percent': str(event.delta_sale_percent) if event.delta_sale_percent is not None else None,
                            },
                            'changed_fields': [
                                'cost_price', 'sale_price',
                                *(['price_change_reason'] if event.reason else []),
                                *(['price_effective_at'] if event.effective_at else []),
                                *(['reject_reason'] if event.reject_reason else []),
                            ],
                            'content': (
                                f"Lý do: {event.reason}"
                                + (f" | Hiệu lực: {event.effective_at.strftime('%d/%m/%Y %H:%M')}" if event.effective_at else '')
                            ).strip() if event.reason or event.effective_at else None,
                        }
                    })
            except Exception:
                # Activity stream should still work even if price event query fails.
                pass
        
        # Sort by timestamp (newest first)
        activities.sort(key=lambda x: x['timestamp'], reverse=True)
        
        return Response(activities[:50])  # Return top 50


class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    
    def get_queryset(self):
        # User chỉ thấy notifications của mình
        return Notification.objects.filter(recipient=self.request.user)
    
    @action(detail=False, methods=['get'])
    def unread(self, request):
        """Get unread notifications"""
        notifications = self.get_queryset().filter(is_read=False)
        serializer = self.get_serializer(notifications, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        """Get unread count"""
        count = self.get_queryset().filter(is_read=False).count()
        return Response({"count": count})
    
    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        """Mark notification as read"""
        notification = self.get_object()
        notification.mark_as_read()
        return Response({"success": True})
    
    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        """Mark all notifications as read"""
        from django.utils import timezone
        count = self.get_queryset().filter(is_read=False).update(
            is_read=True,
            read_at=timezone.now()
        )
        return Response({"success": True, "count": count})


class UserSessionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = UserSessionSerializer

    def get_queryset(self):
        # User only sees their own sessions
        return UserSession.objects.filter(user=self.request.user)

    @action(detail=True, methods=['post'])
    def revoke(self, request, pk=None):
        """Revoke a specific session"""
        session = self.get_object()
        session.revoke()
        return Response({"success": True})

    @action(detail=False, methods=['post'])
    def revoke_all(self, request):
        """Revoke all sessions except current"""
        from django.utils import timezone
        current_session = request.session.session_key

        # Revoke all except current
        count = UserSession.objects.filter(
            user=request.user,
            is_active=True
        ).exclude(session_key=current_session).update(
            is_active=False,
            logout_at=timezone.now()
        )

        return Response({"success": True, "count": count})


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
import csv

@api_view(['GET'])
@permission_classes([AllowAny])
def customer_export_view(request):
    """Direct export view - CSV, Excel, or PDF"""
    from .models import ExportTemplate, Customer
    from datetime import datetime
    import csv
    from .utils import export_to_excel
    
    # Get format (csv or excel)
    format_type = request.GET.get('format', 'excel')
    
    # Get template
    template_id = request.GET.get('template_id')
    if template_id:
        try:
            template = ExportTemplate.objects.get(id=template_id, entity_type='Customer', is_active=True)
        except ExportTemplate.DoesNotExist:
            return HttpResponse('{"error": "Template not found"}', status=404, content_type='application/json')
    else:
        template = ExportTemplate.objects.filter(entity_type='Customer', is_default=True, is_active=True).first()
        if not template:
            return HttpResponse('{"error": "No default template"}', status=404, content_type='application/json')
    
    # Get data
    customers = Customer.objects.all()
    
    # Export based on format
    if format_type == 'csv':
        # CSV Export
        response = HttpResponse(content_type='text/csv; charset=utf-8-sig')
        response['Content-Disposition'] = f'attachment; filename="customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv"'
        writer = csv.writer(response)
        writer.writerow(template.headers)
        for customer in customers:
            row = []
            for field in template.columns:
                value = getattr(customer, field, '')
                row.append(str(value) if value else '')
            writer.writerow(row)
        return response
    elif format_type == 'pdf':
        # PDF Export
        from .utils import export_to_pdf
        filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.pdf'
        return export_to_pdf(customers, template.columns, template.headers, filename, title='Customer List')
    else:
        # Excel Export (default)
        filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
        return export_to_excel(customers, template.columns, template.headers, filename)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    """Logout: Blacklist refresh token and revoke sessions"""
    from django.utils import timezone

    try:
        refresh_token = request.data.get('refresh')
        if refresh_token:
            token = RefreshToken(refresh_token)
            token.blacklist()

        # Revoke user sessions
        UserSession.objects.filter(user=request.user, is_active=True).update(
            is_active=False,
            logout_at=timezone.now()
        )

        return Response({"success": True, "message": "Logged out successfully"})
    except Exception as e:
        return Response({"error": str(e)}, status=400)


class TaskViewSet(viewsets.ModelViewSet):
    """
    CRUD + actions cho nhiệm vụ (task/assignment).
    Lọc theo entity: GET /api/v1/tasks/?entity_type=Product&entity_id=5
    """
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated]

    def _can_manage_task(self, user, task):
        return (
            task.assigned_to_id == user.id
            or task.assigned_by_id == user.id
            or user.is_staff
            or user.is_superuser
        )

    def get_queryset(self):
        user = self.request.user
        comment_count_subquery = (
            Comment.objects
            .filter(entity_type='Task', entity_id=OuterRef('pk'), is_deleted=False)
            .values('entity_id')
            .annotate(cnt=Count('id'))
            .values('cnt')
        )
        attachment_count_subquery = (
            Attachment.objects
            .filter(entity_type='Task', entity_id=OuterRef('pk'))
            .values('entity_id')
            .annotate(cnt=Count('id'))
            .values('cnt')
        )
        latest_comment_subquery = (
            Comment.objects
            .filter(entity_type='Task', entity_id=OuterRef('pk'), is_deleted=False)
            .order_by('-created_at')
            .values('created_at')[:1]
        )
        latest_attachment_subquery = (
            Attachment.objects
            .filter(entity_type='Task', entity_id=OuterRef('pk'))
            .order_by('-uploaded_at')
            .values('uploaded_at')[:1]
        )
        watcher_count_subquery = (
            TaskWatcher.objects
            .filter(task_id=OuterRef('pk'))
            .values('task_id')
            .annotate(cnt=Count('id'))
            .values('cnt')
        )
        is_watching_subquery = TaskWatcher.objects.filter(task_id=OuterRef('pk'), user=user)

        qs = (
            Task.objects
            .select_related('assigned_to', 'assigned_by', 'last_updated_by', 'depends_on')
            .annotate(
                comment_count_db=Coalesce(
                    Subquery(comment_count_subquery, output_field=IntegerField()),
                    0,
                ),
                attachment_count_db=Coalesce(
                    Subquery(attachment_count_subquery, output_field=IntegerField()),
                    0,
                ),
                latest_comment_at_db=Subquery(latest_comment_subquery, output_field=DateTimeField()),
                latest_attachment_at_db=Subquery(latest_attachment_subquery, output_field=DateTimeField()),
                watchers_count_db=Coalesce(
                    Subquery(watcher_count_subquery, output_field=IntegerField()),
                    0,
                ),
                is_watching_db=Exists(is_watching_subquery),
            )
        )
        entity_type = self.request.query_params.get('entity_type')
        entity_id = self.request.query_params.get('entity_id')
        if entity_type:
            qs = qs.filter(entity_type=entity_type)
        if entity_id:
            qs = qs.filter(entity_id=entity_id)
        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)
        is_open = self.request.query_params.get('is_open')
        if is_open == '1':
            qs = qs.filter(status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS])
        needs_help = self.request.query_params.get('needs_help')
        if needs_help == '1':
            qs = qs.filter(needs_help=True, status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS])
        is_blocking = self.request.query_params.get('is_blocking')
        if is_blocking == '1':
            qs = qs.filter(is_blocking=True, status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS])
        is_overdue = self.request.query_params.get('is_overdue')
        if is_overdue == '1':
            qs = qs.filter(
                due_date__lt=django_timezone.localdate(),
                status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS],
            )
        dependency_blocked = self.request.query_params.get('dependency_blocked')
        if dependency_blocked == '1':
            qs = qs.filter(depends_on__isnull=False).exclude(depends_on__status=Task.STATUS_DONE)
        tag = (self.request.query_params.get('tag') or '').strip().lower()
        if tag:
            qs = qs.filter(tags__contains=[tag])
        q = (self.request.query_params.get('q') or '').strip()
        if q:
            qs = qs.filter(
                models.Q(title__icontains=q)
                | models.Q(description__icontains=q)
                | models.Q(entity_code__icontains=q)
            )
        mine = self.request.query_params.get('mine')
        if mine == '1':
            qs = qs.filter(assigned_to=self.request.user)
        created_by_me = self.request.query_params.get('created_by_me')
        if created_by_me == '1':
            qs = qs.filter(assigned_by=self.request.user)
        watching = self.request.query_params.get('watching')
        if watching == '1':
            qs = qs.filter(watchers__user=self.request.user)
        team_members = self.request.query_params.get('team_members')
        if team_members == '1':
            team_ids = list(self.request.user.teams.values_list('id', flat=True))
            if team_ids:
                qs = qs.filter(assigned_to__teams__id__in=team_ids).exclude(assigned_to=self.request.user)
            else:
                qs = qs.none()
        ordering_mode = (self.request.query_params.get('ordering_mode') or '').strip()
        if ordering_mode == 'quick_queue':
            today = django_timezone.localdate()
            qs = qs.annotate(
                overdue_rank=models.Case(
                    models.When(
                        due_date__lt=today,
                        status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS],
                        then=models.Value(1),
                    ),
                    default=models.Value(0),
                    output_field=IntegerField(),
                ),
                dependency_rank=models.Case(
                    models.When(depends_on__isnull=False, depends_on__status=Task.STATUS_DONE, then=models.Value(0)),
                    models.When(depends_on__isnull=False, then=models.Value(1)),
                    default=models.Value(0),
                    output_field=IntegerField(),
                ),
                priority_rank=models.Case(
                    models.When(priority=Task.PRIORITY_URGENT, then=models.Value(4)),
                    models.When(priority=Task.PRIORITY_HIGH, then=models.Value(3)),
                    models.When(priority=Task.PRIORITY_MEDIUM, then=models.Value(2)),
                    default=models.Value(1),
                    output_field=IntegerField(),
                ),
            )
            return qs.order_by('-is_pinned', '-is_blocking', '-needs_help', '-overdue_rank', '-dependency_rank', '-priority_rank', 'due_date', '-created_at').distinct()
        # Mặc định: ưu tiên ghim + blocking + mới nhất
        return qs.order_by('-is_pinned', '-is_blocking', '-created_at').distinct()

    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        task = self.get_object()
        if task.status != Task.STATUS_TODO:
            return Response({'error': 'Chỉ có thể bắt đầu nhiệm vụ đang ở trạng thái Chờ thực hiện.'}, status=400)
        if task.depends_on_id and task.depends_on and task.depends_on.status != Task.STATUS_DONE:
            return Response(
                {'error': f'Nhiệm vụ này đang chờ "{task.depends_on.title}" hoàn thành.'},
                status=400
            )
        task.start()
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        task = self.get_object()
        if task.status == Task.STATUS_DONE:
            return Response({'error': 'Nhiệm vụ này đã hoàn thành.'}, status=400)
        if task.status == Task.STATUS_CANCELLED:
            return Response({'error': 'Không thể hoàn thành nhiệm vụ đã hủy.'}, status=400)
        task.complete(user=request.user)
        # Tự động đẩy qua bước kế tiếp nếu task thuộc pipeline template.
        from .workflow_services import auto_advance_pipeline_from_completed_task
        auto_advance_pipeline_from_completed_task(task, actor=request.user)
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        task = self.get_object()
        if task.status in (Task.STATUS_DONE, Task.STATUS_CANCELLED):
            return Response({'error': 'Không thể hủy nhiệm vụ đã hoàn thành hoặc đã hủy.'}, status=400)
        task.cancel()
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def unblock(self, request, pk=None):
        """Tắt blocking flag — chỉ manager/admin hoặc người tạo task."""
        task = self.get_object()
        reason = (request.data.get('reason') or '').strip()

        if not task.is_blocking:
            return Response({'error': 'Nhiệm vụ này không có blocking.'}, status=400)

        # Permission: người tạo hoặc staff/admin
        is_creator = task.assigned_by_id == request.user.id
        if not (is_creator or request.user.is_staff or request.user.is_superuser):
            return Response({'error': 'Chỉ người tạo hoặc quản lý mới có thể bỏ blocking.'}, status=403)

        task.is_blocking = False
        # Ghi lý do vào description nếu có
        if reason:
            note = f'\n\n[Bỏ blocking bởi {request.user.get_full_name() or request.user.username} — Lý do: {reason}]'
            task.description = (task.description or '') + note
            task.save(update_fields=['is_blocking', 'description', 'updated_at'])
        else:
            task.save(update_fields=['is_blocking', 'updated_at'])

        # Ghi AuditLog
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='Task',
            entity_id=task.id,
            entity_code=task.entity_code or str(task.id),
            changed_fields=['is_blocking'],
            old_values={'is_blocking': True},
            new_values={'is_blocking': False, 'reason': reason},
        )

        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def request_help(self, request, pk=None):
        """Nhân viên báo cần hỗ trợ — thông báo cho người tạo task và manager."""
        task = self.get_object()
        if not task.is_open:
            return Response({'error': 'Chỉ có thể báo cần hỗ trợ cho nhiệm vụ đang mở.'}, status=400)

        reason = (request.data.get('reason') or '').strip()
        task.needs_help = True
        task.help_reason = reason
        task.help_requested_at = django_timezone.now()
        task.save(update_fields=['needs_help', 'help_reason', 'help_requested_at', 'updated_at'])

        # Thông báo cho người tạo task (nếu khác người báo)
        actor_name = request.user.get_full_name() or request.user.username
        msg = f'{actor_name} cần hỗ trợ cho nhiệm vụ "{task.title}"'
        if reason:
            msg += f' — {reason}'
        recipients = set()
        if task.assigned_by_id and task.assigned_by_id != request.user.id:
            recipients.add(task.assigned_by_id)
        # Thông báo cho superuser/staff nếu cần (có thể mở rộng sau)
        for uid in recipients:
            Notification.objects.create(
                recipient_id=uid,
                notification_type='system',
                title=f'🆘 Cần hỗ trợ: {task.title[:60]}',
                message=msg,
                entity_type='Task',
                entity_id=task.id,
                actor=request.user,
            )
        AuditLog.objects.create(
            user=request.user, action='UPDATE', entity_type='Task',
            entity_id=task.id, entity_code=task.entity_code or str(task.id),
            changed_fields=['needs_help'], old_values={'needs_help': False},
            new_values={'needs_help': True, 'reason': reason},
        )
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def resolve_help(self, request, pk=None):
        """Manager/người tạo đánh dấu đã xử lý hỗ trợ."""
        task = self.get_object()
        if not task.needs_help:
            return Response({'error': 'Nhiệm vụ này không có yêu cầu hỗ trợ.'}, status=400)
        is_creator = task.assigned_by_id == request.user.id
        if not (is_creator or request.user.is_staff or request.user.is_superuser):
            return Response({'error': 'Chỉ người tạo hoặc quản lý mới có thể giải quyết hỗ trợ.'}, status=403)

        task.needs_help = False
        task.help_reason = ''
        task.save(update_fields=['needs_help', 'help_reason', 'updated_at'])

        # Thông báo lại cho người đã báo cần hỗ trợ
        if task.assigned_to_id and task.assigned_to_id != request.user.id:
            Notification.objects.create(
                recipient_id=task.assigned_to_id,
                notification_type='system',
                title=f'✅ Đã được hỗ trợ: {task.title[:60]}',
                message=f'{request.user.get_full_name() or request.user.username} đã xác nhận hỗ trợ cho nhiệm vụ "{task.title}".',
                entity_type='Task', entity_id=task.id, actor=request.user,
            )
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def reassign(self, request, pk=None):
        """Chuyển nhiệm vụ sang người khác — assigned person, creator, hoặc manager."""
        task = self.get_object()
        if not task.is_open:
            return Response({'error': 'Chỉ có thể chuyển nhiệm vụ đang mở.'}, status=400)

        new_assignee_id = request.data.get('assigned_to')
        note = (request.data.get('note') or '').strip()

        is_assigned = task.assigned_to_id == request.user.id
        is_creator = task.assigned_by_id == request.user.id
        if not (is_assigned or is_creator or request.user.is_staff or request.user.is_superuser):
            return Response({'error': 'Không có quyền chuyển nhiệm vụ này.'}, status=403)

        old_assignee_name = task.assigned_to.get_full_name() if task.assigned_to else 'Chưa giao'
        old_assignee_id = task.assigned_to_id

        task.assigned_to_id = new_assignee_id or None
        # Reset cần hỗ trợ khi chuyển người — đúng logic: help request gắn với người cũ
        # KHÔNG đụng last_update_note — giữ nguyên tiến độ cho người nhận mới tham khảo
        task.needs_help = False
        task.help_reason = ''
        task.save(update_fields=['assigned_to', 'needs_help', 'help_reason', 'updated_at'])

        # Lý do chuyển giao → lưu vào Comment để giữ lịch sử, KHÔNG ghi đè ghi chú tiến độ
        actor_name = request.user.get_full_name() or request.user.username
        new_assignee_obj = task.assigned_to
        new_name = new_assignee_obj.get_full_name() or new_assignee_obj.username if new_assignee_obj else 'Chưa xác định'
        comment_content = f'🔄 **Chuyển giao nhiệm vụ**\nTừ: {old_assignee_name} → Đến: {new_name}\nBởi: {actor_name}'
        if note:
            comment_content += f'\nLý do: {note}'
        if task.last_update_note:
            comment_content += f'\n\n📋 *Tiến độ hiện tại: {task.last_update_note}*'
        Comment.objects.create(
            entity_type='Task',
            entity_id=task.id,
            content=comment_content,
            created_by=request.user,
        )

        # Thông báo cho người nhận mới
        if new_assignee_id and new_assignee_id != request.user.id:
            notif_msg = f'{actor_name} đã chuyển giao nhiệm vụ "{task.title}" cho bạn'
            if old_assignee_id:
                notif_msg += f' (từ {old_assignee_name})'
            if note:
                notif_msg += f'. Lý do: {note}'
            if task.last_update_note:
                notif_msg += f'. Tiến độ hiện tại: {task.last_update_note}'
            Notification.objects.create(
                recipient_id=new_assignee_id,
                notification_type='assignment',
                title=f'👤 Nhiệm vụ chuyển giao: {task.title[:60]}',
                message=notif_msg,
                entity_type='Task', entity_id=task.id, actor=request.user,
            )

        # Thông báo cho người cũ (nếu là bên thứ ba chuyển, không phải tự chuyển)
        if old_assignee_id and old_assignee_id != request.user.id and old_assignee_id != new_assignee_id:
            Notification.objects.create(
                recipient_id=old_assignee_id,
                notification_type='system',
                title=f'↩️ Nhiệm vụ đã được chuyển: {task.title[:60]}',
                message=f'{actor_name} đã chuyển nhiệm vụ "{task.title}" từ bạn sang {new_name}.',
                entity_type='Task', entity_id=task.id, actor=request.user,
            )

        AuditLog.objects.create(
            user=request.user, action='UPDATE', entity_type='Task',
            entity_id=task.id, entity_code=task.entity_code or str(task.id),
            changed_fields=['assigned_to'],
            old_values={'assigned_to': old_assignee_id, 'assignee_name': old_assignee_name},
            new_values={'assigned_to': new_assignee_id, 'assignee_name': new_name, 'note': note},
        )
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def add_note(self, request, pk=None):
        """Thêm ghi chú tiến độ — người được giao, người tạo, hoặc manager."""
        task = self.get_object()
        note = (request.data.get('note') or '').strip()
        if not note:
            return Response({'error': 'Vui lòng nhập nội dung ghi chú.'}, status=400)

        is_involved = (
            task.assigned_to_id == request.user.id
            or task.assigned_by_id == request.user.id
            or request.user.is_staff
            or request.user.is_superuser
        )
        if not is_involved:
            return Response({'error': 'Chỉ người liên quan đến nhiệm vụ mới có thể ghi chú.'}, status=403)

        task.last_update_note = note
        task.last_update_at = django_timezone.now()
        task.last_updated_by = request.user
        if task.needs_help and task.assigned_by_id == request.user.id:
            task.needs_help = False  # Manager trả lời → tự reset help flag
        task.save(update_fields=['last_update_note', 'last_update_at', 'last_updated_by', 'needs_help', 'updated_at'])
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def remind_overdue(self, request, pk=None):
        """
        Nhắc quá hạn cho nhiệm vụ mở.
        - Người liên quan/manager có thể bấm nhắc tay.
        - Chống spam: không gửi trùng cho cùng recipient trong 6 giờ gần nhất.
        """
        task = self.get_object()
        if not task.is_open:
            return Response({'error': 'Chỉ nhắc quá hạn cho nhiệm vụ đang mở.'}, status=400)
        if not task.due_date:
            return Response({'error': 'Nhiệm vụ chưa có hạn hoàn thành.'}, status=400)
        if task.due_date >= django_timezone.localdate():
            return Response({'error': 'Nhiệm vụ chưa quá hạn.'}, status=400)
        if not self._can_manage_task(request.user, task):
            return Response({'error': 'Không có quyền gửi nhắc quá hạn cho nhiệm vụ này.'}, status=403)

        actor_name = request.user.get_full_name() or request.user.username
        overdue_days = (django_timezone.localdate() - task.due_date).days
        sent_count = 0
        recipients = set()
        if task.assigned_to_id:
            recipients.add(task.assigned_to_id)
        if task.assigned_by_id:
            recipients.add(task.assigned_by_id)

        # Escalation nhẹ: quá hạn >= 2 ngày thì nhắc thêm manager/admin.
        if overdue_days >= 2:
            manager_ids = User.objects.filter(
                models.Q(is_staff=True) | models.Q(is_superuser=True),
                is_active=True,
            ).values_list('id', flat=True)
            recipients.update(set(manager_ids))

        recipients.discard(request.user.id)
        cool_down_since = django_timezone.now() - timedelta(hours=6)

        for uid in recipients:
            duplicated_recent = Notification.objects.filter(
                recipient_id=uid,
                notification_type='due_date',
                entity_type='Task',
                entity_id=task.id,
                created_at__gte=cool_down_since,
            ).exists()
            if duplicated_recent:
                continue
            Notification.objects.create(
                recipient_id=uid,
                notification_type='due_date',
                title=f'⏰ Nhắc quá hạn: {task.title[:60]}',
                message=(
                    f'{actor_name} nhắc nhiệm vụ "{task.title}" đã quá hạn {overdue_days} ngày.'
                    f' Hạn: {task.due_date.strftime("%d/%m/%Y")}.'
                ),
                entity_type='Task',
                entity_id=task.id,
                actor=request.user,
            )
            sent_count += 1

        # Ghi comment sự kiện để timeline rõ loại event.
        Comment.objects.create(
            entity_type='Task',
            entity_id=task.id,
            content=(
                f'⏰ **Nhắc quá hạn** bởi {actor_name}\n'
                f'Quá hạn: {overdue_days} ngày (hạn {task.due_date.strftime("%d/%m/%Y")}).'
            ),
            created_by=request.user,
        )
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='Task',
            entity_id=task.id,
            entity_code=task.entity_code or str(task.id),
            changed_fields=['overdue_reminder'],
            old_values={'sent_count': 0},
            new_values={'sent_count': sent_count, 'overdue_days': overdue_days},
        )
        return Response({
            'success': True,
            'sent_count': sent_count,
            'overdue_days': overdue_days,
            'message': f'Đã gửi {sent_count} thông báo nhắc quá hạn.',
        })

    @action(detail=True, methods=['post'])
    def watch(self, request, pk=None):
        task = self.get_object()
        TaskWatcher.objects.get_or_create(task=task, user=request.user)
        return Response({'success': True, 'watching': True})

    @action(detail=True, methods=['post'])
    def unwatch(self, request, pk=None):
        task = self.get_object()
        TaskWatcher.objects.filter(task=task, user=request.user).delete()
        return Response({'success': True, 'watching': False})

    @action(detail=False, methods=['get'])
    def my_summary(self, request):
        today = django_timezone.localdate()
        team_ids = list(request.user.teams.values_list('id', flat=True))
        open_statuses = [Task.STATUS_TODO, Task.STATUS_IN_PROGRESS]

        assigned_to_me = Task.objects.filter(assigned_to=request.user, status__in=open_statuses).count()
        created_by_me = Task.objects.filter(assigned_by=request.user, status__in=open_statuses).count()
        watching = Task.objects.filter(watchers__user=request.user, status__in=open_statuses).distinct().count()
        overdue = Task.objects.filter(
            status__in=open_statuses,
            due_date__lt=today,
        ).filter(
            models.Q(assigned_to=request.user)
            | models.Q(assigned_by=request.user)
            | models.Q(watchers__user=request.user)
        ).distinct().count()
        if team_ids:
            team_members = Task.objects.filter(
                status__in=open_statuses,
                assigned_to__teams__id__in=team_ids,
            ).exclude(assigned_to=request.user).distinct().count()
        else:
            team_members = 0

        return Response({
            'assigned_to_me': assigned_to_me,
            'created_by_me': created_by_me,
            'watching': watching,
            'team_members': team_members,
            'overdue': overdue,
        })

    def perform_update(self, serializer):
        """Ghi AuditLog khi edit task. Dùng serializer.instance để tránh gọi get_object() thêm lần nữa."""
        track_fields = ['title', 'description', 'assigned_to_id', 'depends_on_id', 'priority', 'is_pinned', 'tags', 'is_blocking', 'due_date']
        # Snapshot giá trị cũ TRƯỚC khi save (serializer.instance do DRF đã fetch)
        old_snapshot = {f: getattr(serializer.instance, f) for f in track_fields}

        instance = serializer.save()

        changed, old_vals, new_vals = [], {}, {}
        for field in track_fields:
            old_val = old_snapshot[field]
            new_val = getattr(instance, field)
            if old_val != new_val:
                changed.append(field)
                old_vals[field] = str(old_val) if old_val is not None else None
                new_vals[field] = str(new_val) if new_val is not None else None

        if changed:
            AuditLog.objects.create(
                user=self.request.user,
                action='UPDATE',
                entity_type='Task',
                entity_id=instance.id,
                entity_code=instance.entity_code or str(instance.id),
                changed_fields=changed,
                old_values=old_vals,
                new_values=new_vals,
            )


class WorkflowTaskTemplateViewSet(viewsets.ModelViewSet):
    """
    CRUD Mẫu nhiệm vụ workflow.
    GET  /api/workflow-task-templates/
    POST /api/workflow-task-templates/{id}/preview_generate/  — xem trước task sẽ sinh
    POST /api/workflow-task-templates/generate_for_entity/    — sinh thật task cho entity
    """
    serializer_class = WorkflowTaskTemplateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = WorkflowTaskTemplate.objects.select_related('created_by')
        entity_type = self.request.query_params.get('entity_type')
        trigger = self.request.query_params.get('trigger')
        is_active = self.request.query_params.get('is_active')
        if entity_type:
            qs = qs.filter(entity_type=entity_type)
        if trigger:
            qs = qs.filter(trigger=trigger)
        if is_active is not None:
            qs = qs.filter(is_active=(is_active not in ('0', 'false', 'False')))
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['post'], url_path='generate_for_entity')
    def generate_for_entity(self, request):
        """
        Sinh task từ template cho một entity + trigger cụ thể.
        Body: { entity_type, entity_id, entity_code, trigger }
        Returns: { created: [...task titles], skipped: N }
        """
        from .workflow_services import generate_tasks_for_entity

        entity_type = (request.data.get('entity_type') or '').strip()
        entity_id = request.data.get('entity_id')
        entity_code = (request.data.get('entity_code') or '').strip()
        trigger = (request.data.get('trigger') or '').strip()

        if not entity_type or not entity_id or not trigger:
            return Response(
                {'error': 'entity_type, entity_id và trigger là bắt buộc.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            entity_id = int(entity_id)
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)

        created = generate_tasks_for_entity(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            triggered_by=request.user,
        )

        return Response({
            'created_count': len(created),
            'created': [{'id': t.id, 'title': t.title, 'source_key': t.source_key} for t in created],
        })

    @action(detail=False, methods=['post'], url_path='preview_generate')
    def preview_generate(self, request):
        """
        Xem trước task sẽ được sinh (không tạo thật).
        Body: { entity_type, entity_id, entity_code, trigger }
        """
        from .workflow_services import preview_tasks_for_entity

        entity_type = (request.data.get('entity_type') or '').strip()
        entity_id = request.data.get('entity_id')
        entity_code = (request.data.get('entity_code') or '').strip()
        trigger = (request.data.get('trigger') or '').strip()

        if not entity_type or not entity_id or not trigger:
            return Response(
                {'error': 'entity_type, entity_id và trigger là bắt buộc.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            entity_id = int(entity_id)
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)

        preview = preview_tasks_for_entity(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
        )

        return Response({'preview': preview, 'total': len(preview)})

    @action(detail=False, methods=['get'], url_path='pipeline_board')
    def pipeline_board(self, request):
        """
        Board quy trình kiểu cột cho entity + trigger.
        GET /api/workflow-task-templates/pipeline_board/?entity_type=SalesOrder&trigger=SUBMIT&limit=200
        """
        from .workflow_services import build_workflow_pipeline_board

        entity_type = (request.query_params.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.query_params.get('trigger') or 'SUBMIT').strip()
        limit_raw = request.query_params.get('limit') or '200'
        try:
            limit = int(limit_raw)
        except (TypeError, ValueError):
            return Response({'error': 'limit phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        limit = max(10, min(limit, 500))

        data = build_workflow_pipeline_board(
            entity_type=entity_type,
            trigger=trigger,
            limit=limit,
        )
        return Response(data)

    @action(detail=False, methods=['post'], url_path='advance_pipeline')
    def advance_pipeline(self, request):
        """
        Chuyển entity sang bước kế tiếp.
        Body: {entity_type, entity_id, entity_code, trigger, note}
        """
        from .workflow_services import advance_pipeline_step

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        entity_code = (request.data.get('entity_code') or '').strip()
        note = (request.data.get('note') or '').strip()
        try:
            entity_id = int(request.data.get('entity_id'))
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)

        result = advance_pipeline_step(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            actor=request.user,
            note=note,
        )
        if not result.get('success'):
            return Response({'error': result.get('error') or 'Không thể chuyển bước.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

    @action(detail=False, methods=['post'], url_path='move_pipeline_card')
    def move_pipeline_card(self, request):
        """
        Di chuyển card sang cột khác (drag-drop).
        Body: {entity_type, entity_id, entity_code, trigger, target_column_id, note}
        """
        from .workflow_services import move_pipeline_card

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        entity_code = (request.data.get('entity_code') or '').strip()
        target_column_id = (request.data.get('target_column_id') or '').strip()
        note = (request.data.get('note') or '').strip()
        if not target_column_id:
            return Response({'error': 'target_column_id là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            entity_id = int(request.data.get('entity_id'))
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)

        result = move_pipeline_card(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            target_column_id=target_column_id,
            actor=request.user,
            note=note,
        )
        if not result.get('success'):
            return Response({'error': result.get('error') or 'Không thể di chuyển card.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

    @action(detail=False, methods=['get'], url_path='pipeline_timeline')
    def pipeline_timeline(self, request):
        """
        Timeline sự kiện pipeline theo entity.
        GET .../pipeline_timeline/?entity_type=SalesOrder&entity_id=123&limit=100
        """
        from .workflow_services import get_pipeline_timeline

        entity_type = (request.query_params.get('entity_type') or 'SalesOrder').strip()
        try:
            entity_id = int(request.query_params.get('entity_id'))
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            limit = int(request.query_params.get('limit') or 100)
        except (TypeError, ValueError):
            limit = 100
        limit = max(10, min(limit, 300))

        timeline = get_pipeline_timeline(entity_type=entity_type, entity_id=entity_id, limit=limit)
        return Response({'items': timeline, 'total': len(timeline)})

    @action(detail=False, methods=['post'], url_path='retry_pipeline_failed')
    def retry_pipeline_failed(self, request):
        """
        Khôi phục card Failed về bước xử lý trước đó.
        Body: {entity_type, entity_id, entity_code, trigger, note}
        """
        from .workflow_services import retry_pipeline_from_failed

        entity_type = (request.data.get('entity_type') or 'SalesOrder').strip()
        trigger = (request.data.get('trigger') or 'SUBMIT').strip()
        entity_code = (request.data.get('entity_code') or '').strip()
        note = (request.data.get('note') or '').strip()
        try:
            entity_id = int(request.data.get('entity_id'))
        except (TypeError, ValueError):
            return Response({'error': 'entity_id phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)

        result = retry_pipeline_from_failed(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            actor=request.user,
            note=note,
        )
        if not result.get('success'):
            return Response({'error': result.get('error') or 'Không thể khôi phục card failed.'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)