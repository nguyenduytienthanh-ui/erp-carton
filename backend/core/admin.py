from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from datetime import datetime
from .models import User, Role, Permission, Team, Setting, Customer, ExportTemplate, SavedView, ImportLog, AuditLog, Attachment, Comment, CommentReaction, Notification, ApprovalHistory, NumberSequence, Tag, EntityTag, WorkflowDefinition, UserSession, PasswordPolicy, ApprovalLevel, EmailTemplate
from .utils import export_to_excel, export_to_pdf


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
    list_display = ['code', 'name', 'owner', 'team', 'status', 'phone', 'is_active']
    list_filter = ['status', 'owner', 'team', 'is_active', 'created_at']
    search_fields = ['code', 'name', 'company_name', 'tax_code', 'phone', 'email']
    actions = ['export_to_excel', 'export_to_pdf']
    readonly_fields = ['approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'created_by', 'created_at', 'updated_by', 'updated_at']
    
    fieldsets = [
        ('Basic Info', {
            'fields': ['code', 'name', 'company_name', 'tax_code', 'is_active']
        }),
        ('Ownership', {
            'fields': ['owner', 'team']
        }),
        ('Contact Info', {
            'fields': ['phone', 'email', 'address', 'contact_person', 'contact_phone']
        }),
        ('Business Info', {
            'fields': ['payment_terms', 'credit_limit']
        }),
        ('Approval', {
            'fields': ['status', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'rejection_reason']
        }),
        ('Audit', {
            'fields': ['created_by', 'created_at', 'updated_by', 'updated_at']
        }),
    ]
    
    def export_to_excel(self, request, queryset):
        """Export using template"""
        from .models import ExportTemplate
        from datetime import datetime
        
        # Get default template for Customer
        template = ExportTemplate.objects.filter(
            entity_type='Customer',
            is_default=True,
            is_active=True
        ).first()
        
        if not template:
            self.message_user(
                request,
                "Không tìm thấy template mặc định. Vui lòng tạo ExportTemplate.",
                level='ERROR'
            )
            return
        
        # Use template columns and headers
        from .utils import export_to_excel as export_func
        filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
        
        return export_func(
            queryset,
            template.columns,
            template.headers,
            filename
        )
    
    export_to_excel.short_description = "Export sang Excel (dùng template mặc định)"
    
    def export_to_pdf(self, request, queryset):
        """Export selected customers to PDF"""
        from .models import ExportTemplate
        from datetime import datetime
        
        # Get default template
        template = ExportTemplate.objects.filter(
            entity_type='Customer',
            is_default=True,
            is_active=True
        ).first()
        
        if not template:
            self.message_user(request, "Không tìm thấy template mặc định", level='ERROR')
            return
        
        filename = f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.pdf'
        return export_to_pdf(queryset, template.columns, template.headers, filename, title='Customer List')
    
    export_to_pdf.short_description = "Export sang PDF"


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


@admin.register(SavedView)
class SavedViewAdmin(admin.ModelAdmin):
    list_display = ['name', 'entity_type', 'user', 'is_default', 'is_public', 'created_at']
    list_filter = ['entity_type', 'is_default', 'is_public', 'created_at']
    search_fields = ['name', 'entity_type', 'user__username']
    readonly_fields = ['created_by', 'created_at', 'updated_at']
    
    fieldsets = [
        ('Basic Info', {
            'fields': ['user', 'name', 'entity_type']
        }),
        ('Configuration', {
            'fields': ['filters', 'sorting', 'columns'],
            'description': 'Use JSON format'
        }),
        ('Options', {
            'fields': ['is_default', 'is_public']
        }),
        ('Audit', {
            'fields': ['created_by', 'created_at', 'updated_at']
        })
    ]
    
    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(ImportLog)
class ImportLogAdmin(admin.ModelAdmin):
    list_display = ['filename', 'entity_type', 'total_rows', 'success_count', 'error_count', 'status', 'created_by', 'created_at']
    list_filter = ['entity_type', 'status', 'created_at']
    search_fields = ['filename', 'entity_type']
    readonly_fields = ['filename', 'entity_type', 'total_rows', 'success_count', 'error_count', 'errors', 'status', 'created_by', 'created_at']
    
    def has_add_permission(self, request):
        return False
    
    def has_change_permission(self, request, obj=None):
        return False


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'user', 'action', 'entity_type', 'entity_code', 'ip_address']
    list_filter = ['action', 'entity_type', 'created_at', 'user']
    search_fields = ['entity_code', 'entity_type', 'user__username']
    readonly_fields = ['user', 'action', 'entity_type', 'entity_id', 'entity_code', 
                       'old_values', 'new_values', 'changed_fields', 'ip_address', 
                       'user_agent', 'created_at']
    
    date_hierarchy = 'created_at'
    
    def has_add_permission(self, request):
        return False
    
    def has_change_permission(self, request, obj=None):
        return False
    
    def has_delete_permission(self, request, obj=None):
        # Only superuser can delete audit logs
        return request.user.is_superuser


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ['filename', 'download_link', 'entity_type', 'entity_id', 'get_file_size_display', 'uploaded_by', 'uploaded_at']
    list_filter = ['entity_type', 'file_type', 'uploaded_at']
    search_fields = ['filename', 'description', 'entity_type']
    readonly_fields = ['download_link', 'file_size', 'file_type', 'uploaded_by', 'uploaded_at']
    
    fieldsets = [
        ('File Info', {
            'fields': ['file', 'filename', 'file_size', 'file_type']
        }),
        ('Attached To', {
            'fields': ['entity_type', 'entity_id']
        }),
        ('Details', {
            'fields': ['description', 'uploaded_by', 'uploaded_at']
        })
    ]
    
    def download_link(self, obj):
        """Display download link"""
        if obj.file:
            from django.utils.html import format_html
            return format_html(
                '<a href="{}" download target="_blank">📥 Download</a>',
                obj.file.url
            )
        return '-'
    download_link.short_description = 'Download'
    
    def save_model(self, request, obj, form, change):
        if not change:
            obj.uploaded_by = request.user
            # Auto-fill filename and size
            if obj.file:
                obj.filename = obj.file.name
                obj.file_size = obj.file.size
                obj.file_type = obj.file.content_type if hasattr(obj.file, 'content_type') else ''
        super().save_model(request, obj, form, change)


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ['preview', 'entity_type', 'entity_id', 'created_by', 'created_at', 'is_deleted']
    list_filter = ['entity_type', 'is_deleted', 'created_at']
    search_fields = ['content', 'entity_type', 'created_by__username']
    readonly_fields = ['mentions', 'created_by', 'created_at', 'updated_at', 'deleted_at']
    
    fieldsets = [
        ('Comment Info', {
            'fields': ['entity_type', 'entity_id', 'content', 'mentions']
        }),
        ('Reply To', {
            'fields': ['parent']
        }),
        ('Metadata', {
            'fields': ['created_by', 'created_at', 'updated_at']
        }),
        ('Delete', {
            'fields': ['is_deleted', 'deleted_at']
        })
    ]
    
    def preview(self, obj):
        """Show comment preview"""
        text = obj.content[:100] + '...' if len(obj.content) > 100 else obj.content
        return text
    preview.short_description = 'Content'
    
    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)
    
    def delete_model(self, request, obj):
        # Soft delete
        obj.is_deleted = True
        from django.utils import timezone
        obj.deleted_at = timezone.now()
        obj.save()


@admin.register(CommentReaction)
class CommentReactionAdmin(admin.ModelAdmin):
    list_display = ['comment_preview', 'user', 'reaction_type', 'created_at']
    list_filter = ['reaction_type', 'created_at']
    search_fields = ['comment__content', 'user__username']
    readonly_fields = ['created_at']
    
    def comment_preview(self, obj):
        preview = obj.comment.content[:50] + '...' if len(obj.comment.content) > 50 else obj.comment.content
        return preview
    comment_preview.short_description = 'Comment'


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ['title', 'recipient', 'notification_type', 'is_read', 'actor', 'created_at']
    list_filter = ['notification_type', 'is_read', 'created_at']
    search_fields = ['title', 'message', 'recipient__username', 'actor__username']
    readonly_fields = ['read_at', 'created_at']
    
    fieldsets = [
        ('Notification Info', {
            'fields': ['recipient', 'notification_type', 'title', 'message']
        }),
        ('Related Object', {
            'fields': ['entity_type', 'entity_id', 'actor']
        }),
        ('Status', {
            'fields': ['is_read', 'read_at', 'created_at']
        })
    ]
    
    actions = ['mark_as_read', 'mark_as_unread']
    
    def mark_as_read(self, request, queryset):
        from django.utils import timezone
        count = queryset.update(is_read=True, read_at=timezone.now())
        self.message_user(request, f"{count} notifications marked as read")
    mark_as_read.short_description = "Mark selected as read"
    
    def mark_as_unread(self, request, queryset):
        count = queryset.update(is_read=False, read_at=None)
        self.message_user(request, f"{count} notifications marked as unread")
    mark_as_unread.short_description = "Mark selected as unread"


@admin.register(ApprovalHistory)
class ApprovalHistoryAdmin(admin.ModelAdmin):
    list_display = ['entity_type', 'entity_code', 'action', 'user', 'level', 'created_at']
    list_filter = ['action', 'entity_type', 'level', 'created_at']
    search_fields = ['entity_code', 'entity_type', 'user__username', 'comments']
    readonly_fields = ['entity_type', 'entity_id', 'entity_code', 'action', 'user', 'created_at', 'level']
    
    fieldsets = [
        ('Entity', {
            'fields': ['entity_type', 'entity_id', 'entity_code']
        }),
        ('Action', {
            'fields': ['action', 'level', 'comments']
        }),
        ('Who & When', {
            'fields': ['user', 'created_at']
        })
    ]
    
    def has_add_permission(self, request):
        return False
    
    def has_change_permission(self, request, obj=None):
        return False


@admin.register(NumberSequence)
class NumberSequenceAdmin(admin.ModelAdmin):
    list_display = ['entity_type', 'prefix', 'current_number', 'format_template', 'is_active']
    list_filter = ['is_active']
    search_fields = ['entity_type', 'prefix']
    
    fieldsets = [
        ('Entity', {
            'fields': ['entity_type', 'prefix']
        }),
        ('Numbering', {
            'fields': ['current_number', 'padding', 'format_template']
        }),
        ('Status', {
            'fields': ['is_active']
        })
    ]
    
    actions = ['reset_counter']
    
    def reset_counter(self, request, queryset):
        count = queryset.update(current_number=0)
        self.message_user(request, f"{count} sequences reset to 0")
    reset_counter.short_description = "Reset counter to 0"


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ['name', 'color_preview', 'entity_types', 'is_active', 'created_at']
    list_filter = ['is_active', 'created_at']
    search_fields = ['name', 'description']
    
    fieldsets = [
        ('Tag Info', {
            'fields': ['name', 'color', 'description']
        }),
        ('Usage', {
            'fields': ['entity_types', 'is_active']
        })
    ]
    
    def color_preview(self, obj):
        from django.utils.html import format_html
        return format_html(
            '<span style="background-color: {}; padding: 5px 15px; color: white; border-radius: 3px;">{}</span>',
            obj.color,
            obj.name
        )
    color_preview.short_description = 'Preview'


@admin.register(EntityTag)
class EntityTagAdmin(admin.ModelAdmin):
    list_display = ['tag', 'entity_type', 'entity_id', 'created_by', 'created_at']
    list_filter = ['tag', 'entity_type', 'created_at']
    search_fields = ['tag__name', 'entity_type']
    readonly_fields = ['created_by', 'created_at']


@admin.register(WorkflowDefinition)
class WorkflowDefinitionAdmin(admin.ModelAdmin):
    list_display = ['entity_type', 'name', 'initial_state', 'is_active', 'updated_at']
    list_filter = ['is_active', 'entity_type']
    search_fields = ['entity_type', 'name']

    fieldsets = [
        ('Basic Info', {
            'fields': ['entity_type', 'name', 'description']
        }),
        ('Workflow Configuration', {
            'fields': ['states', 'transitions', 'initial_state', 'final_states'],
            'description': 'Use JSON format'
        }),
        ('Status', {
            'fields': ['is_active']
        })
    ]

    readonly_fields = ['created_at', 'updated_at']


@admin.register(UserSession)
class UserSessionAdmin(admin.ModelAdmin):
    list_display = ['user', 'device_summary', 'ip_address', 'is_active', 'login_at', 'last_active']
    list_filter = ['is_active', 'login_at', 'last_active']
    search_fields = ['user__username', 'ip_address']
    readonly_fields = ['user', 'session_key', 'device_info', 'ip_address', 'login_at', 'last_active', 'logout_at']

    fieldsets = [
        ('User', {
            'fields': ['user', 'session_key']
        }),
        ('Device & Location', {
            'fields': ['device_info', 'ip_address']
        }),
        ('Activity', {
            'fields': ['login_at', 'last_active', 'logout_at', 'is_active']
        })
    ]

    def device_summary(self, obj):
        browser = obj.device_info.get('browser', 'Unknown')
        os = obj.device_info.get('os', 'Unknown')
        return f"{browser} on {os}"
    device_summary.short_description = 'Device'

    actions = ['revoke_sessions']

    def revoke_sessions(self, request, queryset):
        from django.utils import timezone
        count = queryset.update(is_active=False, logout_at=timezone.now())
        self.message_user(request, f"{count} sessions revoked")
    revoke_sessions.short_description = "Revoke selected sessions"


@admin.register(PasswordPolicy)
class PasswordPolicyAdmin(admin.ModelAdmin):
    list_display = ['name', 'min_length', 'require_uppercase', 'require_digit', 'expire_days', 'is_active']
    list_filter = ['is_active']

    fieldsets = [
        ('Basic Info', {
            'fields': ['name', 'is_active']
        }),
        ('Character Requirements', {
            'fields': ['min_length', 'require_uppercase', 'require_lowercase', 'require_digit', 'require_special']
        }),
        ('Security Settings', {
            'fields': ['prevent_reuse_count', 'expire_days', 'force_change_first_login']
        })
    ]


@admin.register(ApprovalLevel)
class ApprovalLevelAdmin(admin.ModelAdmin):
    list_display = ['entity_type', 'level', 'name', 'required_role', 'min_amount', 'is_required', 'is_active']
    list_filter = ['entity_type', 'is_required', 'is_active']
    search_fields = ['entity_type', 'name']

    fieldsets = [
        ('Basic Info', {
            'fields': ['entity_type', 'level', 'name']
        }),
        ('Requirements', {
            'fields': ['required_role', 'min_amount', 'is_required']
        }),
        ('Status', {
            'fields': ['is_active']
        })
    ]


@admin.register(EmailTemplate)
class EmailTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'notification_type', 'subject', 'is_active', 'updated_at']
    list_filter = ['notification_type', 'is_active']
    search_fields = ['name', 'subject', 'notification_type']

    fieldsets = [
        ('Basic Info', {
            'fields': ['notification_type', 'name', 'is_active']
        }),
        ('Email Content', {
            'fields': ['subject', 'body_html', 'body_text']
        }),
        ('Variables', {
            'fields': ['available_variables'],
            'description': 'Available variables to use: {{user_name}}, {{title}}, {{message}}, {{link}}'
        })
    ]

    readonly_fields = ['created_at', 'updated_at']