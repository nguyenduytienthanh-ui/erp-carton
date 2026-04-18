from django.core.mail import EmailMultiAlternatives
from django.conf import settings
from .models import AuditLog, EmailTemplate, Notification, UserPreferences
import logging

logger = logging.getLogger(__name__)


def _record_mail_delivery_audit(notification, status_value, message=''):
    try:
        AuditLog.objects.create(
            user=getattr(notification, 'actor', None) or getattr(notification, 'recipient', None),
            action='UPDATE',
            entity_type='MailDelivery',
            entity_id=int(notification.id or 0),
            entity_id_str=str(notification.id or ''),
            entity_code=str(getattr(notification.recipient, 'email', '') or getattr(notification.recipient, 'username', '') or notification.id),
            old_values={},
            new_values={
                'status': str(status_value or '').upper(),
                'message': str(message or '')[:500],
                'notification_type': str(getattr(notification, 'notification_type', '') or ''),
                'recipient_email': str(getattr(notification.recipient, 'email', '') or ''),
                'recipient_user_id': int(notification.recipient_id or 0) if getattr(notification, 'recipient_id', None) else None,
            },
            changed_fields=['status'],
        )
    except Exception:
        logger.exception('Failed to write mail delivery audit for notification %s', getattr(notification, 'id', None))


def send_notification_email(notification_id):
    """
    Send email for a notification

    Usage:
    send_notification_email(notification_id)

    Or queue it:
    from django_q.tasks import async_task
    async_task('core.email_utils.send_notification_email', notification_id)
    """
    try:
        notification = Notification.objects.get(id=notification_id)

        # Check if email should be sent
        if not should_send_email(notification):
            logger.info(f"Email not sent for notification {notification_id} (user preference or type)")
            _record_mail_delivery_audit(notification, 'SKIPPED', 'Skipped by user preference or notification type policy')
            return False

        # Get email template
        try:
            template = EmailTemplate.objects.get(
                notification_type=notification.notification_type,
                is_active=True
            )
        except EmailTemplate.DoesNotExist:
            logger.warning(f"No email template for {notification.notification_type}")
            _record_mail_delivery_audit(notification, 'SKIPPED', f'No active email template for {notification.notification_type}')
            return False

        # Prepare context
        context = {
            'user_name': notification.recipient.get_full_name() or notification.recipient.username,
            'title': notification.title,
            'message': notification.message,
            'link': f"{settings.FRONTEND_URL}/notifications/{notification.id}" if hasattr(settings, 'FRONTEND_URL') else '#',
            'actor_name': notification.actor.get_full_name() if notification.actor else 'System',
        }

        # Render template
        rendered = template.render(context)

        # Send email
        email = EmailMultiAlternatives(
            subject=rendered['subject'],
            body=rendered['body_text'],
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[notification.recipient.email]
        )

        # Attach HTML version
        email.attach_alternative(rendered['body_html'], "text/html")

        # Send
        email.send(fail_silently=False)

        logger.info(f"Email sent to {notification.recipient.email} for notification {notification_id}")
        _record_mail_delivery_audit(notification, 'SUCCESS', 'Email sent successfully')
        return True

    except Exception as e:
        logger.error(f"Failed to send email for notification {notification_id}: {str(e)}")
        try:
            notification = Notification.objects.filter(id=notification_id).select_related('recipient', 'actor').first()
            if notification is not None:
                _record_mail_delivery_audit(notification, 'FAILED', str(e))
        except Exception:
            logger.exception('Failed to persist mail delivery failure audit for notification %s', notification_id)
        return False


def should_send_email(notification):
    """Check if email should be sent based on user preferences"""
    important_types = {
        'approval_request',
        'approval_approved',
        'approval_rejected',
        'mention',
    }

    recipient = getattr(notification, 'recipient', None)
    if recipient is None or not getattr(recipient, 'email', ''):
        return False

    preference = (
        UserPreferences.objects
        .filter(user=recipient, page='account-center')
        .only('config')
        .first()
    )
    if preference is None or not isinstance(preference.config, dict):
        return notification.notification_type in important_types

    config = preference.config
    enabled = config.get('email_notifications_enabled')
    if enabled is False:
        return False

    selected_types = config.get('email_notification_types')
    if isinstance(selected_types, list):
        selected_set = {str(item).strip() for item in selected_types if str(item).strip()}
        return notification.notification_type in selected_set

    return notification.notification_type in important_types


def send_bulk_emails(notification_ids):
    """Send emails for multiple notifications (for batch processing)"""
    success_count = 0
    for notification_id in notification_ids:
        if send_notification_email(notification_id):
            success_count += 1

    return success_count
