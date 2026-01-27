from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from datetime import datetime
from .models import User, Role, Permission, Team, Setting, Customer, ExportTemplate
from .serializers import (
    UserSerializer, RoleSerializer, PermissionSerializer,
    TeamSerializer, SettingSerializer, CustomTokenObtainPairSerializer,
    CustomerSerializer, ExportTemplateSerializer
)
from .filters import CustomerFilter
from .utils import export_to_excel


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer


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
    
    @action(detail=False, methods=['get'])
    def export(self, request):
        """Export customers to Excel using template"""
        from .models import ExportTemplate
        
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
                return Response(
                    {"error": "Template not found"},
                    status=404
                )
        else:
            # Get default template
            template = ExportTemplate.objects.filter(
                entity_type='Customer',
                is_default=True,
                is_active=True
            ).first()
            
            if not template:
                return Response(
                    {"error": "No default template found"},
                    status=404
                )
        
        # Get filtered queryset
        queryset = self.filter_queryset(self.get_queryset())
        
        # Generate filename
        filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
        
        # Export using template
        return export_to_excel(
            queryset,
            template.columns,
            template.headers,
            filename
        )


class ExportTemplateViewSet(viewsets.ReadOnlyModelViewSet):
    """Export Template ViewSet - Read only for users"""
    queryset = ExportTemplate.objects.filter(is_active=True)
    serializer_class = ExportTemplateSerializer
    filterset_fields = ['entity_type']


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer
