from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, Role, Permission, Team, Setting


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