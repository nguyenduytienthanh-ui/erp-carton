import os
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Q
from django.utils import timezone


class User(AbstractUser):
    """
    Custom User Model extending Django's AbstractUser.
    
    Adds additional fields for phone, avatar, and account locking functionality.
    """
    
    phone = models.CharField(
        max_length=20,
        blank=True,
        help_text="Phone number"
    )
    
    avatar = models.ImageField(
        upload_to='avatars/',
        blank=True,
        null=True,
        help_text="User avatar"
    )
    
    is_locked = models.BooleanField(
        default=False,
        help_text="Account is locked"
    )
    
    locked_at = models.DateTimeField(
        blank=True,
        null=True,
        help_text="When the account was locked"
    )
    
    locked_by = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='locked_users',
        help_text="User who locked this account"
    )
    
    roles = models.ManyToManyField(
        'Role',
        related_name='users',
        blank=True,
        help_text="Roles assigned to this user"
    )
    
    teams = models.ManyToManyField(
        'Team',
        related_name='users',
        blank=True,
        help_text="Teams this user belongs to"
    )
    
    class Meta:
        db_table = 'users'
        ordering = ['username']
    
    def __str__(self):
        """Return username as string representation"""
        return self.username
    
    def lock_user(self, by_user):
        """
        Lock this user account.
        
        Args:
            by_user: User instance that is locking this account
        """
        self.is_locked = True
        self.locked_at = timezone.now()
        self.locked_by = by_user
        self.save()
    
    def unlock_user(self):
        """Unlock this user account"""
        self.is_locked = False
        self.locked_at = None
        self.locked_by = None
        self.save()
    
    def has_perm(self, perm, obj=None):
        """
        Check if user has permission.
        Superusers have all permissions.
        """
        if self.is_active and self.is_superuser:
            return True
        return super().has_perm(perm, obj)


class Role(models.Model):
    """
    Role for RBAC (Master Data chuẩn).
    """
    name = models.CharField(max_length=100, help_text="Role name (e.g., Admin, Manager)")
    code = models.CharField(max_length=50, help_text="Role code (unique trong bản ghi chưa xóa)")
    description = models.TextField(blank=True, help_text="Role description")
    is_active = models.BooleanField(default=True, help_text="Is this role active?")
    sort_order = models.IntegerField(default=0, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        'User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_roles', verbose_name="Người tạo",
    )
    updated_by = models.ForeignKey(
        'User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='updated_roles', verbose_name="Người cập nhật",
    )
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Ngày xóa (soft)")
    deleted_by = models.ForeignKey(
        'User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='deleted_roles', verbose_name="Người xóa",
    )
    permissions = models.ManyToManyField(
        'Permission', related_name='roles', blank=True,
        help_text="Permissions assigned to this role",
    )

    class Meta:
        db_table = 'roles'
        ordering = ['sort_order', 'name']
        verbose_name = 'Role'
        verbose_name_plural = 'Roles'
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['is_active']),
            models.Index(fields=['created_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['code'],
                condition=Q(deleted_at__isnull=True),
                name='role_code_uniq_active',
            ),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        super().save(*args, **kwargs)


class Permission(models.Model):
    """
    Permission for RBAC - defines what actions can be performed on resources
    """
    
    name = models.CharField(
        max_length=100,
        help_text="Permission name"
    )
    
    code = models.CharField(
        max_length=100,
        unique=True,
        help_text="Permission code (e.g., USER_CREATE)"
    )
    
    resource = models.CharField(
        max_length=50,
        help_text="Resource name (e.g., USER, INVOICE)"
    )
    
    action = models.CharField(
        max_length=50,
        help_text="Action name (e.g., CREATE, VIEW, EDIT, DELETE)"
    )
    
    description = models.TextField(
        blank=True,
        help_text="Permission description"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'permissions'
        ordering = ['resource', 'action']
        verbose_name = 'Permission'
        verbose_name_plural = 'Permissions'
        unique_together = [['resource', 'action']]
    
    def __str__(self):
        return self.code


class Team(models.Model):
    """Team for Data Scope (Master Data chuẩn)."""
    name = models.CharField(max_length=100, help_text="Team name")
    code = models.CharField(max_length=50, help_text="Team code (unique trong bản ghi chưa xóa)")
    description = models.TextField(blank=True, help_text="Team description")
    is_active = models.BooleanField(default=True, help_text="Is this team active?")
    sort_order = models.IntegerField(default=0, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        'User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_teams', verbose_name="Người tạo",
    )
    updated_by = models.ForeignKey(
        'User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='updated_teams', verbose_name="Người cập nhật",
    )
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="Ngày xóa (soft)")
    deleted_by = models.ForeignKey(
        'User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='deleted_teams', verbose_name="Người xóa",
    )

    class Meta:
        db_table = 'teams'
        ordering = ['sort_order', 'name']
        verbose_name = 'Team'
        verbose_name_plural = 'Teams'
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['is_active']),
            models.Index(fields=['created_at']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['code'],
                condition=Q(deleted_at__isnull=True),
                name='team_code_uniq_active',
            ),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if self.code:
            self.code = str(self.code).strip().upper()
        super().save(*args, **kwargs)


class Setting(models.Model):
    """System settings for Configuration-Driven Design"""
    
    key = models.CharField(
        max_length=100,
        unique=True,
        help_text="Setting key (e.g., MAX_LOGIN_ATTEMPTS)"
    )
    
    value = models.TextField(
        help_text="Setting value (stored as text)"
    )
    
    data_type = models.CharField(
        max_length=20,
        choices=[
            ('string', 'String'),
            ('integer', 'Integer'),
            ('boolean', 'Boolean'),
            ('json', 'JSON'),
        ],
        default='string',
        help_text="Data type of the value"
    )
    
    description = models.TextField(
        blank=True,
        help_text="Setting description"
    )
    
    is_active = models.BooleanField(
        default=True,
        help_text="Is this setting active?"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'settings'
        ordering = ['key']
        verbose_name = 'Setting'
        verbose_name_plural = 'Settings'
    
    def __str__(self):
        return f"{self.key} = {self.value}"


class Customer(models.Model):
    """Customer model for managing clients"""
    
    # Basic Info
    code = models.CharField(max_length=50, unique=True, help_text="Customer code")
    name = models.CharField(max_length=200, help_text="Customer name")
    company_name = models.CharField(max_length=200, blank=True, help_text="Company name")
    tax_code = models.CharField(max_length=50, blank=True, help_text="Tax identification number")
    
    # Contact Info
    phone = models.CharField(max_length=20, blank=True, help_text="Phone number")
    email = models.EmailField(blank=True, help_text="Email address")
    address = models.TextField(blank=True, help_text="Address")
    
    # Contact Person
    contact_person = models.CharField(max_length=100, blank=True, help_text="Contact person name")
    contact_phone = models.CharField(max_length=20, blank=True, help_text="Contact person phone")
    
    # Business Info
    payment_terms = models.IntegerField(default=30, help_text="Payment terms in days")
    credit_limit = models.DecimalField(max_digits=15, decimal_places=2, default=0, help_text="Credit limit")
    
    # Status
    is_active = models.BooleanField(default=True, help_text="Is customer active?")
    
    # Audit fields
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='customers_created', help_text="Created by user")
    updated_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='customers_updated', help_text="Updated by user")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Approval workflow
    STATUS_CHOICES = [
        ('DRAFT', 'Draft'),
        ('PENDING_APPROVAL', 'Pending Approval'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
    ]
    
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='DRAFT',
        help_text="Approval status"
    )
    
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_customers',
        help_text="Who approved this customer"
    )
    
    approved_at = models.DateTimeField(null=True, blank=True)
    
    rejected_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='rejected_customers',
        help_text="Who rejected this customer"
    )
    
    rejected_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)

    # Data scope
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='owned_customers',
        help_text="Owner of this customer"
    )

    team = models.ForeignKey(
        'Team',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='team_customers',
        help_text="Team that owns this customer"
    )
    
    class Meta:
        db_table = 'customers'
        ordering = ['code']
        verbose_name = 'Customer'
        verbose_name_plural = 'Customers'
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['name']),
            models.Index(fields=['is_active']),
            models.Index(fields=['team']),
            models.Index(fields=['created_at']),
        ]
    
    def __str__(self):
        return f"{self.code} - {self.name}"


class ExportTemplate(models.Model):
    """Export template for configuration-driven export"""
    
    name = models.CharField(
        max_length=100,
        help_text="Template name (e.g., Customer - Full)"
    )
    
    entity_type = models.CharField(
        max_length=50,
        help_text="Entity type (e.g., Customer, SalesOrder)"
    )
    
    columns = models.JSONField(
        help_text="List of field names ['code', 'name', 'phone']"
    )
    
    headers = models.JSONField(
        help_text="List of header names ['Mã KH', 'Tên KH', 'SĐT']"
    )
    
    is_default = models.BooleanField(
        default=False,
        help_text="Is this the default template for this entity?"
    )
    
    is_active = models.BooleanField(
        default=True,
        help_text="Is template active?"
    )
    
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='export_templates_created',
        help_text="Created by user"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'export_templates'
        ordering = ['entity_type', 'name']
        verbose_name = 'Export Template'
        verbose_name_plural = 'Export Templates'
        unique_together = [['entity_type', 'name']]
    
    def __str__(self):
        return f"{self.entity_type} - {self.name}"


class SavedView(models.Model):
    """Saved view/filter for any entity"""
    
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='saved_views',
        help_text="Owner of this view. Null = shared/public view"
    )
    
    name = models.CharField(max_length=100, help_text="View name")
    
    entity_type = models.CharField(
        max_length=50,
        help_text="Entity type (e.g., Customer, SalesOrder)"
    )
    
    filters = models.JSONField(
        default=dict,
        help_text="Filter parameters {'status': 'APPROVED', 'total__gte': 1000000}"
    )
    
    sorting = models.CharField(
        max_length=100,
        blank=True,
        help_text="Sorting parameter (e.g., -created_at)"
    )
    
    columns = models.JSONField(
        default=list,
        help_text="Visible columns ['code', 'customer__name', 'total']"
    )
    
    is_default = models.BooleanField(
        default=False,
        help_text="Is this the default view for this user/entity?"
    )
    
    is_public = models.BooleanField(
        default=False,
        help_text="Is this view public (shared with all users)?"
    )
    
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_saved_views'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'saved_views'
        ordering = ['entity_type', 'name']
        verbose_name = 'Saved View'
        verbose_name_plural = 'Saved Views'
        unique_together = [['user', 'entity_type', 'name']]
    
    def __str__(self):
        owner = self.user.username if self.user else 'Public'
        return f"{self.entity_type} - {self.name} ({owner})"


class ImportLog(models.Model):
    """Import history log"""
    
    entity_type = models.CharField(max_length=50, help_text="Entity type (Customer, Product...)")
    filename = models.CharField(max_length=255, help_text="Uploaded filename")
    
    total_rows = models.IntegerField(default=0, help_text="Total rows in file")
    success_count = models.IntegerField(default=0, help_text="Successfully imported")
    error_count = models.IntegerField(default=0, help_text="Failed rows")
    
    errors = models.JSONField(default=list, help_text="List of errors [{row, error}]")
    
    status = models.CharField(
        max_length=20,
        choices=[
            ('PROCESSING', 'Processing'),
            ('COMPLETED', 'Completed'),
            ('FAILED', 'Failed'),
        ],
        default='PROCESSING'
    )
    
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'import_logs'
        ordering = ['-created_at']
        verbose_name = 'Import Log'
        verbose_name_plural = 'Import Logs'
    
    def __str__(self):
        return f"{self.entity_type} - {self.filename} ({self.status})"


class AuditLog(models.Model):
    """Audit log for all data changes"""
    
    ACTION_CHOICES = [
        ('CREATE', 'Create'),
        ('UPDATE', 'Update'),
        ('DELETE', 'Delete'),
        ('APPROVE', 'Approve'),
        ('REJECT', 'Reject'),
        ('POST', 'Post'),
        ('LOCK', 'Lock'),
        ('ACTIVATE', 'Activate'),
        ('DEACTIVATE', 'Deactivate'),
        ('IMPORT', 'Import'),
        ('EXPORT', 'Export'),
        ('VOID', 'Void'),
        ('SUBMIT', 'Submit'),
    ]
    
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='audit_logs')
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    
    # What was changed
    entity_type = models.CharField(max_length=50, help_text="Model name (Customer, SalesOrder...)")
    entity_id = models.IntegerField(help_text="Record ID")
    entity_id_str = models.CharField(max_length=64, default='', help_text="Record ID as string (for UUID entities)")
    entity_code = models.CharField(max_length=50, blank=True, help_text="Record code (for display)")
    
    # Changes
    old_values = models.JSONField(null=True, blank=True, help_text="Values before change")
    new_values = models.JSONField(null=True, blank=True, help_text="Values after change")
    changed_fields = models.JSONField(default=list, help_text="List of changed field names")
    
    # Context
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'audit_logs'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['entity_type', 'entity_id']),
            models.Index(fields=['user', 'created_at']),
            models.Index(fields=['action', 'created_at']),
        ]
        verbose_name = 'Audit Log'
        verbose_name_plural = 'Audit Logs'
    
    def __str__(self):
        return f"{self.user} {self.action} {self.entity_type} #{self.entity_id} at {self.created_at}"


def attachment_upload_path(instance, filename):
    """Generate upload path: attachments/{entity_type}/{entity_id}/{filename}"""
    return f'attachments/{instance.entity_type}/{instance.entity_id}/{filename}'

class Attachment(models.Model):
    """File attachments for any entity"""
    
    # What entity this is attached to
    entity_type = models.CharField(max_length=50, help_text="Model name (Customer, SalesOrder...)")
    entity_id = models.IntegerField(help_text="Record ID")
    
    # File info
    file = models.FileField(upload_to=attachment_upload_path)
    filename = models.CharField(max_length=255, help_text="Original filename")
    file_size = models.IntegerField(help_text="File size in bytes")
    file_type = models.CharField(max_length=100, blank=True, help_text="MIME type")
    
    # Metadata
    description = models.TextField(blank=True)
    
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'attachments'
        ordering = ['-uploaded_at']
        indexes = [
            models.Index(fields=['entity_type', 'entity_id']),
        ]
        verbose_name = 'Attachment'
        verbose_name_plural = 'Attachments'
    
    def __str__(self):
        return f"{self.filename} ({self.entity_type} #{self.entity_id})"
    
    def get_file_extension(self):
        return os.path.splitext(self.filename)[1].lower()
    
    def get_file_size_display(self):
        """Human readable file size"""
        size = self.file_size
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024.0:
                return f"{size:.1f} {unit}"
            size /= 1024.0
        return f"{size:.1f} TB"


class Comment(models.Model):
    """Comments for any entity"""
    
    # What entity this comment is on
    entity_type = models.CharField(max_length=50, help_text="Model name (Customer, SalesOrder...)")
    entity_id = models.IntegerField(help_text="Record ID")
    
    # Comment content
    content = models.TextField(help_text="Comment text")
    
    # Mentions (stored as JSON list of usernames)
    mentions = models.JSONField(default=list, help_text="List of mentioned @usernames")
    
    # Reply to another comment (optional)
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='replies')
    
    # Metadata
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='comments')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Soft delete
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'comments'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['entity_type', 'entity_id']),
            models.Index(fields=['created_by', 'created_at']),
        ]
        verbose_name = 'Comment'
        verbose_name_plural = 'Comments'
    
    def __str__(self):
        preview = self.content[:50] + '...' if len(self.content) > 50 else self.content
        return f"{self.created_by}: {preview}"
    
    def extract_mentions(self):
        """Extract @username mentions from content"""
        import re
        pattern = r'@(\w+)'
        mentions = re.findall(pattern, self.content)
        return list(set(mentions))  # Remove duplicates
    
    def save(self, *args, **kwargs):
        # Auto-extract mentions
        if not self.mentions:
            self.mentions = self.extract_mentions()
        super().save(*args, **kwargs)


class CommentReaction(models.Model):
    """Reactions/likes on comments"""
    
    REACTION_CHOICES = [
        ('like', '👍 Like'),
        ('love', '❤️ Love'),
        ('laugh', '😂 Laugh'),
        ('wow', '😮 Wow'),
        ('sad', '😢 Sad'),
        ('angry', '😠 Angry'),
    ]
    
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    reaction_type = models.CharField(max_length=10, choices=REACTION_CHOICES, default='like')
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'comment_reactions'
        unique_together = [['comment', 'user']]
        verbose_name = 'Comment Reaction'
        verbose_name_plural = 'Comment Reactions'
    
    def __str__(self):
        return f"{self.user} {self.reaction_type} on comment #{self.comment.id}"


class Notification(models.Model):
    """In-app notifications"""
    
    NOTIFICATION_TYPES = [
        ('mention', '📢 Mentioned in comment'),
        ('comment', '💬 New comment'),
        ('approval_request', '📝 Approval request'),
        ('approval_approved', '✅ Approved'),
        ('approval_rejected', '❌ Rejected'),
        ('assignment', '👤 Assigned to you'),
        ('due_date', '⏰ Due date reminder'),
        ('system', '⚙️ System notification'),
    ]
    
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    
    notification_type = models.CharField(max_length=20, choices=NOTIFICATION_TYPES)
    title = models.CharField(max_length=255)
    message = models.TextField()
    
    # Link to related object
    entity_type = models.CharField(max_length=50, blank=True, help_text="Model name")
    entity_id = models.IntegerField(null=True, blank=True, help_text="Record ID")
    
    # Actor (who triggered this notification)
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='triggered_notifications')
    
    # Status
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'notifications'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['recipient', 'is_read', 'created_at']),
        ]
        verbose_name = 'Notification'
        verbose_name_plural = 'Notifications'
    
    def __str__(self):
        return f"{self.get_notification_type_display()} for {self.recipient}"
    
    def mark_as_read(self):
        """Mark notification as read"""
        if not self.is_read:
            from django.utils import timezone
            self.is_read = True
            self.read_at = timezone.now()
            self.save()


class ApprovalHistory(models.Model):
    """History of approval actions"""
    
    ACTION_CHOICES = [
        ('SUBMIT', 'Submitted for approval'),
        ('APPROVE', 'Approved'),
        ('REJECT', 'Rejected'),
        ('REVOKE', 'Revoked approval'),
        ('RESUBMIT', 'Resubmitted'),
    ]
    
    # What was approved
    entity_type = models.CharField(max_length=50)
    entity_id = models.IntegerField()
    entity_code = models.CharField(max_length=50, blank=True)
    
    # Action details
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    comments = models.TextField(blank=True, help_text="Approver's comments")
    
    # Who did it
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    
    # When
    created_at = models.DateTimeField(auto_now_add=True)
    
    # Approval level (for multi-level approval)
    level = models.IntegerField(default=1, help_text="Approval level")
    
    class Meta:
        db_table = 'approval_history'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['entity_type', 'entity_id']),
            models.Index(fields=['user', 'created_at']),
        ]
        verbose_name = 'Approval History'
        verbose_name_plural = 'Approval History'
    
    def __str__(self):
        return f"{self.user} {self.action} {self.entity_type} #{self.entity_id}"


class ApprovalLevel(models.Model):
    """Configuration for multi-level approval per entity type"""

    entity_type = models.CharField(max_length=50, help_text="Entity type (Customer, SalesOrder, Invoice...)")
    level = models.IntegerField(help_text="Approval level order (1, 2, 3, ...)")
    name = models.CharField(max_length=100, help_text="Level name (e.g. Manager approval)")

    required_role = models.ForeignKey(
        Role,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        help_text="Role required to approve at this level"
    )

    min_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=0,
        help_text="Minimum amount requiring this level (0 = always)"
    )

    is_required = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'approval_levels'
        ordering = ['entity_type', 'level']
        unique_together = [['entity_type', 'level']]
        verbose_name = 'Approval Level'
        verbose_name_plural = 'Approval Levels'

    def __str__(self):
        return f"{self.entity_type} - Level {self.level}: {self.name}"


class EmailTemplate(models.Model):
    """Email templates for notifications"""

    notification_type = models.CharField(
        max_length=50,
        unique=True,
        help_text="Notification type (mention, approval_request...)"
    )

    name = models.CharField(max_length=100)
    subject = models.CharField(max_length=200, help_text="Email subject (supports variables)")

    # Email body (HTML)
    body_html = models.TextField(help_text="HTML email body (supports variables)")

    # Email body (Plain text fallback)
    body_text = models.TextField(blank=True, help_text="Plain text email body")

    # Variables available in template
    available_variables = models.JSONField(
        default=list,
        help_text="List of available variables: ['user_name', 'title', 'message', 'link']"
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'email_templates'
        verbose_name = 'Email Template'
        verbose_name_plural = 'Email Templates'

    def __str__(self):
        return f"{self.name} ({self.notification_type})"

    def render(self, context):
        """Render template with context variables"""
        subject = self.subject
        body_html = self.body_html
        body_text = self.body_text or self.body_html

        # Replace variables
        for key, value in context.items():
            placeholder = f"{{{{{key}}}}}"
            subject = subject.replace(placeholder, str(value))
            body_html = body_html.replace(placeholder, str(value))
            body_text = body_text.replace(placeholder, str(value))

        return {
            'subject': subject,
            'body_html': body_html,
            'body_text': body_text
        }


class NumberSequence(models.Model):
    """Auto-increment number sequences for entities"""
    
    entity_type = models.CharField(
        max_length=50,
        unique=True,
        help_text="Entity type (Customer, SalesOrder, Invoice...)"
    )
    
    prefix = models.CharField(
        max_length=10,
        help_text="Prefix (CUST, SO, INV...)"
    )
    
    current_number = models.IntegerField(
        default=0,
        help_text="Current number"
    )
    
    padding = models.IntegerField(
        default=3,
        help_text="Number of digits (3 = 001, 4 = 0001)"
    )
    
    # Example format: CUST-{YYYY}-{number} or SO-{number}
    format_template = models.CharField(
        max_length=50,
        default='{prefix}-{number}',
        help_text="Format: {prefix}-{number} or {prefix}-{YYYY}-{number}"
    )
    
    is_active = models.BooleanField(default=True)
    
    class Meta:
        db_table = 'number_sequences'
        verbose_name = 'Number Sequence'
        verbose_name_plural = 'Number Sequences'
    
    def __str__(self):
        return f"{self.entity_type} ({self.prefix})"
    
    def get_next_number(self):
        """Get next number and increment"""
        from django.db import transaction
        
        with transaction.atomic():
            # Lock row for update
            seq = NumberSequence.objects.select_for_update().get(pk=self.pk)
            seq.current_number += 1
            seq.save()
            
            # Format number
            number_str = str(seq.current_number).zfill(seq.padding)
            
            # Apply template
            from datetime import datetime
            code = seq.format_template.format(
                prefix=seq.prefix,
                number=number_str,
                YYYY=datetime.now().year,
                MM=str(datetime.now().month).zfill(2),
                DD=str(datetime.now().day).zfill(2)
            )
            
            return code


class Tag(models.Model):
    """Tags/labels for entities"""
    
    name = models.CharField(max_length=50, unique=True)
    color = models.CharField(
        max_length=7,
        default='#3B82F6',
        help_text="Hex color code (#FF0000)"
    )
    
    description = models.TextField(blank=True)
    
    # What entities can use this tag
    entity_types = models.JSONField(
        default=list,
        help_text="List of entity types ['Customer', 'SalesOrder']"
    )
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'tags'
        ordering = ['name']
        verbose_name = 'Tag'
        verbose_name_plural = 'Tags'
    
    def __str__(self):
        return self.name


class EntityTag(models.Model):
    """Many-to-many relationship between entities and tags"""
    
    tag = models.ForeignKey(Tag, on_delete=models.CASCADE)
    entity_type = models.CharField(max_length=50)
    entity_id = models.IntegerField()
    
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'entity_tags'
        unique_together = [['tag', 'entity_type', 'entity_id']]
        indexes = [
            models.Index(fields=['entity_type', 'entity_id']),
        ]
        verbose_name = 'Entity Tag'
        verbose_name_plural = 'Entity Tags'
    
    def __str__(self):
        return f"{self.tag.name} on {self.entity_type} #{self.entity_id}"


class WorkflowDefinition(models.Model):
    """Workflow definition for document types"""

    entity_type = models.CharField(
        max_length=50,
        unique=True,
        help_text="Entity type (Customer, SalesOrder, Invoice...)"
    )

    name = models.CharField(max_length=100, help_text="Workflow name")
    description = models.TextField(blank=True)

    # Workflow states and transitions
    states = models.JSONField(
        help_text="List of states [{'code': 'DRAFT', 'name': 'Draft', 'color': '#gray'}]"
    )

    transitions = models.JSONField(
        help_text="List of transitions [{'from': 'DRAFT', 'to': 'PENDING', 'action': 'submit', 'required_permission': 'sales.order.create'}]"
    )

    initial_state = models.CharField(
        max_length=50,
        default='DRAFT',
        help_text="Initial state when creating new record"
    )

    final_states = models.JSONField(
        default=list,
        help_text="List of final states ['APPROVED', 'POSTED']"
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'workflow_definitions'
        verbose_name = 'Workflow Definition'
        verbose_name_plural = 'Workflow Definitions'

    def __str__(self):
        return f"{self.entity_type} - {self.name}"

    def get_next_states(self, current_state):
        """Get possible next states from current state"""
        next_states = []
        for transition in self.transitions:
            if transition['from'] == current_state:
                next_states.append(transition['to'])
        return next_states

    def can_transition(self, from_state, to_state):
        """Check if transition is allowed"""
        for transition in self.transitions:
            if transition['from'] == from_state and transition['to'] == to_state:
                return True
        return False


class UserSession(models.Model):
    """Track user login sessions"""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sessions')

    # Session info
    session_key = models.CharField(max_length=255, unique=True, help_text="Django session key or JWT jti")

    # Device info
    device_info = models.JSONField(
        default=dict,
        help_text="User agent, OS, browser info"
    )

    ip_address = models.GenericIPAddressField()

    # Timestamps
    login_at = models.DateTimeField(auto_now_add=True)
    last_active = models.DateTimeField(auto_now=True)
    logout_at = models.DateTimeField(null=True, blank=True)

    # Status
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'user_sessions'
        ordering = ['-login_at']
        indexes = [
            models.Index(fields=['user', 'is_active']),
        ]
        verbose_name = 'User Session'
        verbose_name_plural = 'User Sessions'

    def __str__(self):
        return f"{self.user.username} - {self.device_info.get('browser', 'Unknown')} - {self.ip_address}"

    def revoke(self):
        """Revoke this session"""
        from django.utils import timezone
        self.is_active = False
        self.logout_at = timezone.now()
        self.save()


class PasswordPolicy(models.Model):
    """Password policy settings"""

    name = models.CharField(max_length=100, unique=True)

    # Policy rules
    min_length = models.IntegerField(default=8)
    require_uppercase = models.BooleanField(default=True)
    require_lowercase = models.BooleanField(default=True)
    require_digit = models.BooleanField(default=True)
    require_special = models.BooleanField(default=False)

    # Password history
    prevent_reuse_count = models.IntegerField(
        default=3,
        help_text="Prevent reusing last N passwords"
    )

    # Expiration
    expire_days = models.IntegerField(
        default=0,
        help_text="Password expires after N days (0 = never)"
    )

    # Force change
    force_change_first_login = models.BooleanField(default=True)

    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'password_policies'
        verbose_name = 'Password Policy'
        verbose_name_plural = 'Password Policies'

    def __str__(self):
        return self.name

    def validate_password(self, password):
        """Validate password against this policy"""
        errors = []

        if len(password) < self.min_length:
            errors.append(f"Password must be at least {self.min_length} characters")

        if self.require_uppercase and not any(c.isupper() for c in password):
            errors.append("Password must contain at least one uppercase letter")

        if self.require_lowercase and not any(c.islower() for c in password):
            errors.append("Password must contain at least one lowercase letter")

        if self.require_digit and not any(c.isdigit() for c in password):
            errors.append("Password must contain at least one digit")

        if self.require_special and not any(c in '!@#$%^&*()_+-=[]{}|;:,.<>?' for c in password):
            errors.append("Password must contain at least one special character")

        return errors


class UserPreferences(models.Model):
    """
    GENERIC MODEL - Dùng chung cho TẤT CẢ component/page
    Lưu cấu hình user: columns, filters, tabs, theme...
    """
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='preferences',
        verbose_name='Người dùng'
    )
    page = models.CharField(
        max_length=50,
        verbose_name='Trang',
        help_text='VD: products-list, dashboard, settings...'
    )
    config = models.JSONField(
        default=dict,
        verbose_name='Cấu hình',
        help_text='JSON tự do: {columns, filters, theme, ...}'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'user_preferences'
        verbose_name = 'Cấu hình người dùng'
        verbose_name_plural = 'Cấu hình người dùng'
        unique_together = ['user', 'page']
        indexes = [
            models.Index(fields=['user', 'page']),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.page}"


class ColumnPermission(models.Model):
    """
    Phân quyền cột - Admin kiểm soát user/role nào xem được cột gì
    User chỉ thấy cột được phép (không rối mắt)
    """
    page = models.CharField(
        max_length=50,
        verbose_name='Trang',
        help_text='VD: products-list, customers-list'
    )
    column = models.CharField(
        max_length=50,
        verbose_name='Tên cột (key)',
        help_text='VD: cost_price, sale_price, commission_per_unit'
    )
    column_label = models.CharField(
        max_length=100,
        verbose_name='Nhãn hiển thị',
        help_text='VD: Giá vốn, Giá bán, HHCĐ'
    )
    allowed_roles = models.JSONField(
        default=list,
        verbose_name='Roles được phép xem',
        help_text='VD: ["admin", "manager", "accountant"]'
    )
    allowed_users = models.ManyToManyField(
        User,
        blank=True,
        related_name='column_permissions',
        verbose_name='Users được phép xem (ngoài roles)'
    )
    is_restricted = models.BooleanField(
        default=True,
        verbose_name='Có giới hạn quyền',
        help_text='False = Tất cả được xem, True = Chỉ allowed_roles/users'
    )
    is_active = models.BooleanField(
        default=True,
        verbose_name='Đang áp dụng'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'column_permissions'
        verbose_name = 'Phân quyền cột'
        verbose_name_plural = 'Phân quyền cột'
        unique_together = ['page', 'column']
        indexes = [
            models.Index(fields=['page', 'is_active']),
        ]

    def __str__(self):
        return f"{self.page} - {self.column_label}"

    def user_has_permission(self, user):
        """Kiểm tra user có quyền xem cột này không"""
        if getattr(self, '_debug', False):
            print(f"   🔍 Checking permission for column: {self.column}")
            print(f"      User: {user.username} (ID: {user.id})")
            print(f"      Is restricted: {self.is_restricted}, Is active: {self.is_active}")

        if not self.is_restricted or not self.is_active:
            if getattr(self, '_debug', False):
                print(f"      ✅ ALLOWED (not restricted)")
            return True
        if self.allowed_users.filter(id=user.id).exists():
            if getattr(self, '_debug', False):
                print(f"      ✅ ALLOWED (direct user)")
            return True
        user_roles = list(user.roles.values_list('code', flat=True))
        # Staff/Superuser coi như có thêm role "admin" (để thấy cột cho phép admin)
        if getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False):
            if 'admin' not in [str(r).lower() for r in user_roles]:
                user_roles = list(user_roles) + ['admin']
        allowed_lower = [r.lower() for r in (self.allowed_roles or [])]
        if any((str(role) or '').lower() in allowed_lower for role in user_roles):
            if getattr(self, '_debug', False):
                print(f"      ✅ ALLOWED (has role)")
            return True
        if getattr(self, '_debug', False):
            print(f"      ❌ DENIED")
        return False


class Task(models.Model):
    """
    Nhiệm vụ giao cho người dùng, liên kết với bất kỳ đối tượng nào
    (Product, Customer, SalesOrder, ...) qua entity_type + entity_id.

    Blocking task: nếu is_blocking=True và status chưa DONE,
    sẽ chặn các hành động như RELEASE sản xuất, duyệt đơn hàng.
    """

    STATUS_TODO = 'TODO'
    STATUS_IN_PROGRESS = 'IN_PROGRESS'
    STATUS_DONE = 'DONE'
    STATUS_CANCELLED = 'CANCELLED'

    STATUS_CHOICES = [
        (STATUS_TODO, 'Chờ thực hiện'),
        (STATUS_IN_PROGRESS, 'Đang thực hiện'),
        (STATUS_DONE, 'Hoàn thành'),
        (STATUS_CANCELLED, 'Đã hủy'),
    ]

    PRIORITY_LOW = 'LOW'
    PRIORITY_MEDIUM = 'MEDIUM'
    PRIORITY_HIGH = 'HIGH'
    PRIORITY_URGENT = 'URGENT'

    PRIORITY_CHOICES = [
        (PRIORITY_LOW, 'Thấp'),
        (PRIORITY_MEDIUM, 'Trung bình'),
        (PRIORITY_HIGH, 'Cao'),
        (PRIORITY_URGENT, 'Khẩn cấp'),
    ]

    # Liên kết đối tượng (cùng pattern với Comment, AuditLog)
    entity_type = models.CharField(max_length=50, verbose_name='Loại đối tượng')
    entity_id = models.PositiveIntegerField(verbose_name='ID đối tượng')
    entity_code = models.CharField(max_length=100, blank=True, verbose_name='Mã đối tượng')

    # Nội dung nhiệm vụ
    title = models.CharField(max_length=200, verbose_name='Tiêu đề')
    description = models.TextField(blank=True, verbose_name='Mô tả chi tiết')

    # Giao việc
    assigned_to = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='assigned_tasks', verbose_name='Người thực hiện',
    )
    assigned_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_tasks', verbose_name='Người giao',
    )
    depends_on = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='blocked_tasks', verbose_name='Phụ thuộc nhiệm vụ',
        help_text='Task này chỉ thực hiện được sau khi nhiệm vụ phụ thuộc hoàn thành.',
    )

    # Trạng thái & ưu tiên
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_TODO, verbose_name='Trạng thái')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default=PRIORITY_MEDIUM, verbose_name='Ưu tiên')
    is_pinned = models.BooleanField(default=False, verbose_name='Ghim ưu tiên')
    tags = models.JSONField(default=list, blank=True, verbose_name='Nhãn')

    # Blocking: chặn hành động sản xuất cho đến khi DONE
    is_blocking = models.BooleanField(default=False, verbose_name='Chặn sản xuất')
    blocks_action = models.CharField(
        max_length=50, blank=True,
        verbose_name='Hành động bị chặn',
        help_text='VD: RELEASE, APPROVE. Để trống = chặn tất cả.',
    )

    # Thời hạn
    due_date = models.DateField(null=True, blank=True, verbose_name='Hạn hoàn thành')
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name='Thời gian hoàn thành')

    # Cần hỗ trợ — nhân viên tự báo khi vướng mắc
    needs_help = models.BooleanField(default=False, verbose_name='Cần hỗ trợ')
    help_reason = models.TextField(blank=True, verbose_name='Lý do cần hỗ trợ')
    help_requested_at = models.DateTimeField(null=True, blank=True, verbose_name='Thời điểm báo cần hỗ trợ')

    # Ghi chú tiến độ — người được giao có thể cập nhật
    last_update_note = models.TextField(blank=True, verbose_name='Ghi chú tiến độ')
    last_update_at = models.DateTimeField(null=True, blank=True, verbose_name='Cập nhật tiến độ lần cuối')
    last_updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='task_notes', verbose_name='Người cập nhật tiến độ',
    )

    # Chống tạo trùng khi sinh từ template (idempotency key)
    source_key = models.CharField(
        max_length=200, blank=True, null=True, unique=True,
        verbose_name='Khóa nguồn gốc',
        help_text='Định danh duy nhất khi sinh tự động từ template. Dạng: wft-{template_id}-{entity_type}-{entity_id}',
    )

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'tasks'
        ordering = ['-is_blocking', 'due_date', '-created_at']
        verbose_name = 'Nhiệm vụ'
        verbose_name_plural = 'Nhiệm vụ'
        indexes = [
            models.Index(fields=['entity_type', 'entity_id']),
            models.Index(fields=['assigned_to']),
            models.Index(fields=['status']),
            models.Index(fields=['is_blocking', 'status']),
        ]

    def __str__(self):
        return f'[{self.get_status_display()}] {self.title}'

    @property
    def is_open(self):
        return self.status in (self.STATUS_TODO, self.STATUS_IN_PROGRESS)

    def complete(self, user=None):
        from django.utils import timezone
        self.status = self.STATUS_DONE
        self.completed_at = timezone.now()
        self.save(update_fields=['status', 'completed_at', 'updated_at'])

    def start(self):
        self.status = self.STATUS_IN_PROGRESS
        self.save(update_fields=['status', 'updated_at'])

    def cancel(self):
        self.status = self.STATUS_CANCELLED
        self.save(update_fields=['status', 'updated_at'])


class TaskWatcher(models.Model):
    """
    Người theo dõi nhiệm vụ (watch/follow).
    """
    task = models.ForeignKey(
        'Task', on_delete=models.CASCADE,
        related_name='watchers', verbose_name='Nhiệm vụ',
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE,
        related_name='watched_tasks', verbose_name='Người theo dõi',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'task_watchers'
        verbose_name = 'Theo dõi nhiệm vụ'
        verbose_name_plural = 'Theo dõi nhiệm vụ'
        unique_together = [('task', 'user')]
        indexes = [
            models.Index(fields=['user', 'created_at']),
            models.Index(fields=['task', 'created_at']),
        ]

    def __str__(self):
        return f'{self.user_id} watches {self.task_id}'


class WorkflowTaskTemplate(models.Model):
    """
    Mẫu nhiệm vụ tự động sinh theo workflow.

    Khi entity (SalesOrder, Product...) chuyển trạng thái (trigger),
    hệ thống tự tạo Task theo template này (nếu is_active=True).

    assign_rule JSON examples:
      {}                               → không gán người
      {"type": "role", "value": "Sales"}  → gán user đầu tiên có role đó
      {"type": "user", "id": 5}        → gán user cụ thể theo id
    """

    TRIGGER_SUBMIT = 'SUBMIT'
    TRIGGER_APPROVE = 'APPROVE'
    TRIGGER_REJECT = 'REJECT'
    TRIGGER_POST = 'POST'
    TRIGGER_VOID = 'VOID'
    TRIGGER_MANUAL = 'MANUAL'
    TRIGGER_CHOICES = [
        (TRIGGER_SUBMIT, 'Nộp duyệt'),
        (TRIGGER_APPROVE, 'Phê duyệt'),
        (TRIGGER_REJECT, 'Từ chối'),
        (TRIGGER_POST, 'Đăng sổ (Post)'),
        (TRIGGER_VOID, 'Hủy (Void)'),
        (TRIGGER_MANUAL, 'Thủ công'),
    ]

    entity_type = models.CharField(
        max_length=50, verbose_name='Loại đối tượng',
        help_text='VD: SalesOrder, Product',
    )
    trigger = models.CharField(
        max_length=50, choices=TRIGGER_CHOICES, verbose_name='Sự kiện kích hoạt',
    )
    title_template = models.CharField(
        max_length=200, verbose_name='Tiêu đề nhiệm vụ',
        help_text='Hỗ trợ placeholder: {entity_code}, {entity_type}, {trigger}',
    )
    description_template = models.TextField(
        blank=True, verbose_name='Mô tả nhiệm vụ',
        help_text='Hỗ trợ placeholder: {entity_code}, {entity_type}, {trigger}',
    )
    assign_rule = models.JSONField(
        default=dict, blank=True, verbose_name='Quy tắc gán người',
    )
    due_in_days = models.PositiveSmallIntegerField(
        default=3, verbose_name='Hạn hoàn thành (ngày)',
        help_text='Số ngày kể từ ngày tạo task.',
    )
    priority = models.CharField(
        max_length=20, choices=Task.PRIORITY_CHOICES,
        default=Task.PRIORITY_MEDIUM, verbose_name='Ưu tiên',
    )
    is_blocking = models.BooleanField(
        default=False, verbose_name='Chặn sản xuất',
    )
    blocks_action = models.CharField(
        max_length=50, blank=True, verbose_name='Hành động bị chặn',
    )
    tags = models.JSONField(
        default=list, blank=True, verbose_name='Nhãn',
    )
    depends_on_previous = models.BooleanField(
        default=True,
        verbose_name='Phụ thuộc bước trước',
        help_text='Bật: task sinh từ mẫu này sẽ phụ thuộc task của mẫu đứng ngay trước theo thứ tự.',
    )
    sort_order = models.PositiveSmallIntegerField(
        default=0, verbose_name='Thứ tự',
    )
    is_active = models.BooleanField(default=True, verbose_name='Kích hoạt')

    # Audit
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_workflow_templates', verbose_name='Người tạo',
    )

    class Meta:
        db_table = 'workflow_task_templates'
        ordering = ['entity_type', 'trigger', 'sort_order', 'id']
        verbose_name = 'Mẫu nhiệm vụ workflow'
        verbose_name_plural = 'Mẫu nhiệm vụ workflow'
        indexes = [
            models.Index(fields=['entity_type', 'trigger', 'is_active']),
        ]

    def __str__(self):
        return f'[{self.entity_type}/{self.trigger}] {self.title_template}'


class WorkflowPipelineEvent(models.Model):
    """
    Nhật ký chuyển tiếp công việc theo pipeline cho từng entity.
    """
    ACTION_ADVANCE = 'ADVANCE'
    ACTION_MOVE = 'MOVE'
    ACTION_FAIL = 'FAIL'
    ACTION_GENERATE = 'GENERATE'
    ACTION_CHOICES = [
        (ACTION_ADVANCE, 'Chuyển bước'),
        (ACTION_MOVE, 'Di chuyển cột'),
        (ACTION_FAIL, 'Thất bại'),
        (ACTION_GENERATE, 'Sinh task'),
    ]

    entity_type = models.CharField(max_length=50, db_index=True, verbose_name='Loại đối tượng')
    entity_id = models.PositiveIntegerField(db_index=True, verbose_name='ID đối tượng')
    entity_code = models.CharField(max_length=100, blank=True, verbose_name='Mã đối tượng')

    trigger = models.CharField(max_length=50, blank=True, verbose_name='Trigger')
    action = models.CharField(max_length=20, choices=ACTION_CHOICES, verbose_name='Hành động')
    from_step = models.CharField(max_length=200, blank=True, verbose_name='Từ bước')
    to_step = models.CharField(max_length=200, blank=True, verbose_name='Đến bước')
    note = models.TextField(blank=True, verbose_name='Ghi chú')

    task = models.ForeignKey(
        'Task', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pipeline_events', verbose_name='Task liên quan',
    )
    actor = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='workflow_pipeline_events', verbose_name='Người thao tác',
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'workflow_pipeline_events'
        ordering = ['-created_at', '-id']
        verbose_name = 'Sự kiện pipeline workflow'
        verbose_name_plural = 'Sự kiện pipeline workflow'
        indexes = [
            models.Index(fields=['entity_type', 'entity_id', 'created_at']),
        ]

    def __str__(self):
        return f'[{self.entity_type}:{self.entity_id}] {self.action} {self.from_step} -> {self.to_step}'