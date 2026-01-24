from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class User(AbstractUser):
    """
    Custom User Model extending Django's AbstractUser.
    
    Adds additional fields for phone, avatar, and account locking functionality.
    """
    phone = models.CharField(max_length=20, blank=True)
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    is_locked = models.BooleanField(
        default=False,
        help_text="Account is locked"
    )
    locked_at = models.DateTimeField(blank=True, null=True)
    locked_by = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='locked_users'
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
