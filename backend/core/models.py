from django.contrib.auth.models import AbstractUser
from django.db import models
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
    Role for RBAC (Role-Based Access Control)
    
    Represents a role that can be assigned to users.
    Each role can have multiple permissions.
    """
    
    name = models.CharField(
        max_length=100,
        unique=True,
        help_text="Role name (e.g., Admin, Manager)"
    )
    
    code = models.CharField(
        max_length=50,
        unique=True,
        help_text="Role code (e.g., ADMIN, MANAGER)"
    )
    
    description = models.TextField(
        blank=True,
        help_text="Role description"
    )
    
    is_active = models.BooleanField(
        default=True,
        help_text="Is this role active?"
    )
    
    created_at = models.DateTimeField(
        auto_now_add=True,
        help_text="When this role was created"
    )
    
    updated_at = models.DateTimeField(
        auto_now=True,
        help_text="When this role was last updated"
    )
    
    permissions = models.ManyToManyField(
        'Permission',
        related_name='roles',
        blank=True,
        help_text="Permissions assigned to this role"
    )
    
    class Meta:
        db_table = 'roles'
        ordering = ['name']
        verbose_name = 'Role'
        verbose_name_plural = 'Roles'
    
    def __str__(self):
        return self.name


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
    """Team for Data Scope - users can only see data within their team"""
    
    name = models.CharField(
        max_length=100,
        unique=True,
        help_text="Team name"
    )
    
    code = models.CharField(
        max_length=50,
        unique=True,
        help_text="Team code"
    )
    
    description = models.TextField(
        blank=True,
        help_text="Team description"
    )
    
    is_active = models.BooleanField(
        default=True,
        help_text="Is this team active?"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'teams'
        ordering = ['name']
        verbose_name = 'Team'
        verbose_name_plural = 'Teams'
    
    def __str__(self):
        return self.name


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
    
    class Meta:
        db_table = 'customers'
        ordering = ['code']
        verbose_name = 'Customer'
        verbose_name_plural = 'Customers'
    
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