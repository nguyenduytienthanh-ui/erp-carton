from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from datetime import datetime
from .models import User, Role, Permission, Team, Setting, Customer, ExportTemplate
from .utils import export_to_excel


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Custom User Admin"""
    list_display = ['username', 'email', 'first_name', 'last_name', 'is_staff', 'is_locked']
    list_filter = ['is_staff', 'is_superuser', 'is_active', 'is_locked']
    search_fields = ['username', 'email', 'first_name', 'last_name', 'phone']
    
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Additional Info', {'fields': ('phone', 'avatar', 'is_locked', 'locked_at', 'locked_by')}),
        ('Roles & Teams', {'fields': ('roles', 'teams')}),
    )


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    """Role Admin"""
    list_display = ['name', 'code', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name', 'code', 'description']
    filter_horizontal = ['permissions']


@admin.register(Permission)
class PermissionAdmin(admin.ModelAdmin):
    """Permission Admin"""
    list_display = ['code', 'name', 'resource', 'action', 'created_at']
    list_filter = ['resource', 'action', 'created_at']
    search_fields = ['code', 'name', 'resource', 'action']


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    """Team Admin"""
    list_display = ['name', 'code', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name', 'code', 'description']


@admin.register(Setting)
class SettingAdmin(admin.ModelAdmin):
    """Setting Admin"""
    list_display = ['key', 'value', 'data_type', 'is_active', 'updated_at']
    list_filter = ['data_type', 'is_active', 'created_at']
    search_fields = ['key', 'value', 'description']


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    """Customer Admin"""
    list_display = ['code', 'name', 'company_name', 'phone', 'email', 'is_active', 'created_at']
    list_filter = ['is_active', 'payment_terms', 'created_at']
    search_fields = ['code', 'name', 'company_name', 'tax_code', 'phone', 'email']
    actions = ['export_to_excel']
    readonly_fields = ['created_by', 'updated_by', 'created_at', 'updated_at']
    
    def export_to_excel(self, request, queryset):
        fields = ['code', 'name', 'company_name', 'phone', 'email', 'is_active']
        headers = ['Mã KH', 'Tên KH', 'Công ty', 'SĐT', 'Email', 'Trạng thái']
        filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
        return export_to_excel(queryset, fields, headers, filename)
    
    export_to_excel.short_description = "Export sang Excel"


@admin.register(ExportTemplate)
class ExportTemplateAdmin(admin.ModelAdmin):
    """Export Template Admin"""
    list_display = ['name', 'entity_type', 'is_default', 'is_active', 'created_by', 'created_at']
    list_filter = ['entity_type', 'is_default', 'is_active', 'created_at']
    search_fields = ['name', 'entity_type']
    readonly_fields = ['created_by', 'created_at', 'updated_at']
    
    fieldsets = [
        ('Basic Info', {
            'fields': ['name', 'entity_type', 'is_default', 'is_active']
        }),
        ('Configuration', {
            'fields': ['columns', 'headers'],
            'description': 'Use JSON format. Example: ["code", "name", "phone"]'
        }),
        ('Audit', {
            'fields': ['created_by', 'created_at', 'updated_at']
        })
    ]
    
    def save_model(self, request, obj, form, change):
        if not change:  # Creating new
            obj.created_by = request.user
        super().save_model(request, obj, form, change)