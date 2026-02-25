from django.db.models.signals import post_save, post_delete, pre_save
from django.dispatch import receiver
from django.contrib.auth import get_user_model
from .models import Customer, AuditLog, Comment, Notification
import threading

User = get_user_model()

# Thread-local storage for current request
_thread_locals = threading.local()

def get_current_request():
    return getattr(_thread_locals, 'request', None)

def set_current_request(request):
    _thread_locals.request = request

def get_client_ip(request):
    """Get client IP from request"""
    if not request:
        return None
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip

# Store old values before save
_old_values = {}

@receiver(pre_save, sender=Customer)
def store_old_values(sender, instance, **kwargs):
    """Store old values before update"""
    if instance.pk:  # Only for updates
        try:
            old_instance = sender.objects.get(pk=instance.pk)
            _old_values[instance.pk] = {
                'code': old_instance.code,
                'name': old_instance.name,
                'company_name': old_instance.company_name,
                'tax_code': old_instance.tax_code,
                'phone': old_instance.phone,
                'email': old_instance.email,
                'address': old_instance.address,
                'contact_person': old_instance.contact_person,
                'contact_phone': old_instance.contact_phone,
                'payment_terms': old_instance.payment_terms,
                'credit_limit': old_instance.credit_limit,
                'is_active': old_instance.is_active,
                'status': old_instance.status,
            }
        except sender.DoesNotExist:
            pass

@receiver(post_save, sender=Customer)
def log_customer_save(sender, instance, created, **kwargs):
    """Log customer create/update"""
    request = get_current_request()
    user = request.user if request and hasattr(request, 'user') and request.user.is_authenticated else None
    
    if created:
        # CREATE
        AuditLog.objects.create(
            user=user,
            action='CREATE',
            entity_type='Customer',
            entity_id=instance.id,
            entity_code=instance.code,
            new_values={
                'code': instance.code,
                'name': instance.name,
                'company_name': instance.company_name,
                'phone': instance.phone,
                'email': instance.email,
            },
            ip_address=get_client_ip(request) if request else None,
            user_agent=request.META.get('HTTP_USER_AGENT', '')[:500] if request else ''
        )
    else:
        # UPDATE
        old_vals = _old_values.get(instance.pk, {})
        if old_vals:
            # Find changed fields
            changed_fields = []
            old_values = {}
            new_values = {}
            
            for field in ['code', 'name', 'company_name', 'tax_code', 'phone', 'email', 'address', 'contact_person', 'contact_phone', 'payment_terms', 'credit_limit', 'is_active', 'status']:
                old_val = old_vals.get(field)
                new_val = getattr(instance, field, None)
                
                if old_val != new_val:
                    changed_fields.append(field)
                    old_values[field] = str(old_val) if old_val is not None else None
                    new_values[field] = str(new_val) if new_val is not None else None
            
            # Only log if something changed
            if changed_fields:
                AuditLog.objects.create(
                    user=user,
                    action='UPDATE',
                    entity_type='Customer',
                    entity_id=instance.id,
                    entity_code=instance.code,
                    old_values=old_values,
                    new_values=new_values,
                    changed_fields=changed_fields,
                    ip_address=get_client_ip(request) if request else None,
                    user_agent=request.META.get('HTTP_USER_AGENT', '')[:500] if request else ''
                )
            
            # Clean up
            _old_values.pop(instance.pk, None)

@receiver(post_delete, sender=Customer)
def log_customer_delete(sender, instance, **kwargs):
    """Log customer delete"""
    request = get_current_request()
    user = request.user if request and hasattr(request, 'user') and request.user.is_authenticated else None
    
    AuditLog.objects.create(
        user=user,
        action='DELETE',
        entity_type='Customer',
        entity_id=instance.id,
        entity_code=instance.code,
        old_values={
            'code': instance.code,
            'name': instance.name,
        },
        ip_address=get_client_ip(request) if request else None,
        user_agent=request.META.get('HTTP_USER_AGENT', '')[:500] if request else ''
    )


@receiver(post_save, sender=Comment)
def notify_comment_mentions(sender, instance, created, **kwargs):
    """Notify users mentioned in comment"""
    if created and instance.mentions and instance.created_by:
        from django.contrib.auth import get_user_model
        from .models import Notification
        
        User = get_user_model()
        
        for username in instance.mentions:
            try:
                user = User.objects.get(username=username)
                if user != instance.created_by:  # Don't notify yourself
                    Notification.objects.create(
                        recipient=user,
                        notification_type='mention',
                        title=f'@{instance.created_by.username} mentioned you',
                        message=f'in a comment on {instance.entity_type} #{instance.entity_id}',
                        entity_type=instance.entity_type,
                        entity_id=instance.entity_id,
                        actor=instance.created_by
                    )
            except User.DoesNotExist:
                pass


@receiver(post_save, sender=Notification)
def send_notification_email_signal(sender, instance, created, **kwargs):
    """Queue email sending when notification is created"""
    if created:
        # Queue email task (non-blocking)
        from django_q.tasks import async_task
        async_task('core.email_utils.send_notification_email', instance.id)
