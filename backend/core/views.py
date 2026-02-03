from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from django.http import HttpResponse
from django.db import models
from datetime import datetime
from .models import User, Role, Permission, Team, Setting, Customer, ExportTemplate, SavedView, Attachment, Comment, Notification, AuditLog, UserSession
from .serializers import (
    UserSerializer, RoleSerializer, PermissionSerializer,
    TeamSerializer, SettingSerializer, CustomTokenObtainPairSerializer,
    CustomerSerializer, ExportTemplateSerializer, SavedViewSerializer, AttachmentSerializer, CommentSerializer, NotificationSerializer, UserSessionSerializer
)
from .filters import CustomerFilter
from .utils import export_to_excel
from .mixins import AuditLogMixin


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


class RoleViewSet(viewsets.ModelViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer


class PermissionViewSet(viewsets.ModelViewSet):
    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer


class TeamViewSet(viewsets.ModelViewSet):
    queryset = Team.objects.all()
    serializer_class = TeamSerializer


class SettingViewSet(viewsets.ModelViewSet):
    queryset = Setting.objects.all()
    serializer_class = SettingSerializer


class CustomerViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
    filterset_class = CustomerFilter
    ordering_fields = ['code', 'name', 'created_at', 'credit_limit']
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

        # Fuzzy search (trigram + unidecode)
        search = self.request.query_params.get('search', None)
        if search:
            from core.utils import get_fuzzy_search_queryset
            search_fields = ['code', 'name', 'email', 'phone', 'address']
            queryset = get_fuzzy_search_queryset(queryset, search, search_fields)

        return queryset

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
                "total": result['total'],
                "imported": result['success'],
                "errors": result['errors'],
                "log_id": result['log_id']
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


def _export_products_excel_logic(request):
    """
    Logic xuất Excel (dùng chung). request phải có .user (đã auth) và .GET.
    Trả về HttpResponse (file) hoặc HttpResponse (JSON lỗi).
    """
    from io import BytesIO
    from django.db.models import Q
    from openpyxl import Workbook
    from products.models import Product
    from core.filters import ProductFilter

    if request.GET.get('format', 'excel') != 'excel':
        return HttpResponse('{"error":"Only Excel format supported"}', status=400, content_type='application/json')
    try:
        base = Product.objects.select_related(
            'category', 'unit', 'owner', 'team', 'created_by', 'updated_by'
        ).all()
        user = request.user
        if user.is_superuser:
            pass
        elif user.groups.filter(name='Manager').exists():
            base = base.filter(
                Q(owner=user) | Q(team__in=user.teams.all()) | Q(owner__isnull=True)
            )
        else:
            base = base.filter(Q(owner=user) | Q(owner__isnull=True))
        search = request.GET.get('search')
        if search:
            from core.utils import get_fuzzy_search_queryset
            base = get_fuzzy_search_queryset(base, search, ['code', 'name', 'description'])
        queryset = ProductFilter(request.GET, queryset=base).qs

        wb = Workbook()
        ws = wb.active
        ws.title = 'Sản phẩm'
        headers = [
            'Mã SP', 'Tên sản phẩm', 'Danh mục', 'Đơn vị',
            'Kích thước ĐH', 'KTSX', 'Sóng', 'Kiểu',
            'Giá vốn', 'Giá bán', 'Tồn TT', '+/-',
            'HHCĐ (đ/cái)', 'HH%', 'Mô tả', 'Trạng thái', 'Ghi chú',
        ]
        ws.append(headers)
        for product in queryset:
            ws.append([
                product.code or '',
                product.name or '',
                product.category.name if product.category else '',
                product.unit.name if product.unit else '',
                product.size_order or '',
                product.size_production or '',
                product.wave_type or '',
                product.box_type or '',
                float(product.cost_price) if product.cost_price is not None else 0,
                float(product.sale_price) if product.sale_price is not None else 0,
                float(product.min_stock) if product.min_stock is not None else 0,
                product.delivery_tolerance or '',
                float(product.commission_per_unit) if product.commission_per_unit is not None else 0,
                float(product.commission_percent) if product.commission_percent is not None else 0,
                (product.description or '')[:500],
                product.get_status_display() if product.status else '',
                (product.note or '')[:500],
            ])
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        data = output.getvalue()
        resp = HttpResponse(data, content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        resp['Content-Disposition'] = 'attachment; filename="san_pham.xlsx"'
        resp['Content-Length'] = str(len(data))
        return resp
    except Exception as e:
        return HttpResponse(f'{{"error":"Xuất Excel thất bại","detail":"{str(e)}"}}', status=500, content_type='application/json')


def export_products_excel_plain_view(request):
    """
    View thuần Django (không @api_view) dùng từ middleware: tự xác thực JWT rồi gọi _export_products_excel_logic.
    Trả về HttpResponse, không qua DRF → tránh 404 khi gọi từ middleware.
    """
    from rest_framework_simplejwt.authentication import JWTAuthentication
    from rest_framework.exceptions import AuthenticationFailed

    if request.method != 'GET':
        return HttpResponse('Method not allowed', status=405)
    auth = JWTAuthentication()
    try:
        auth_result = auth.authenticate(request)
        if auth_result is None:
            return HttpResponse('{"detail":"Authentication credentials were not provided."}', status=401, content_type='application/json')
        request.user = auth_result[0]
    except Exception:
        return HttpResponse('{"detail":"Invalid or expired token."}', status=401, content_type='application/json')
    return _export_products_excel_logic(request)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def export_products_excel_view(request):
    """Xuất Excel sản phẩm - GET (gọi từ URL hoặc app có Authorization header)."""
    return _export_products_excel_logic(request)


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