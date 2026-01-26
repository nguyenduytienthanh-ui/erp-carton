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
    
    def has_perm(self, permission_code):
        """
        Check if user has permission (placeholder).
        
        Args:
            permission_code: Permission code to check
            
        Returns:
            bool: Always returns False (placeholder implementation)
        """
        return False


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