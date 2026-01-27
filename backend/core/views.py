from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework_simplejwt.views import TokenObtainPairView
from django.http import HttpResponse
from datetime import datetime
from .models import User, Role, Permission, Team, Setting, Customer, ExportTemplate, SavedView
from .serializers import (
    UserSerializer, RoleSerializer, PermissionSerializer,
    TeamSerializer, SettingSerializer, CustomTokenObtainPairSerializer,
    CustomerSerializer, ExportTemplateSerializer, SavedViewSerializer
)
from .filters import CustomerFilter
from .utils import export_to_excel


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


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
    filterset_class = CustomerFilter
    search_fields = ['code', 'name', 'company_name', 'phone', 'email']
    ordering_fields = ['code', 'name', 'created_at', 'credit_limit']
    ordering = ['-created_at']
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
    
    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

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