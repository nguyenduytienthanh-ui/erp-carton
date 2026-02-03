from django.core.mail import EmailMultiAlternatives
from django.conf import settings
from .models import EmailTemplate, Notification
import logging

logger = logging.getLogger(__name__)


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
            return False

        # Get email template
        try:
            template = EmailTemplate.objects.get(
                notification_type=notification.notification_type,
                is_active=True
            )
        except EmailTemplate.DoesNotExist:
            logger.warning(f"No email template for {notification.notification_type}")
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
        return True

    except Exception as e:
        logger.error(f"Failed to send email for notification {notification_id}: {str(e)}")
        return False


def should_send_email(notification):
    """Check if email should be sent based on user preferences"""
    # TODO: Implement user email preferences
    # For now, send email for important types only
    important_types = [
        'approval_request',
        'approval_approved',
        'approval_rejected',
        'mention'
    ]

    return notification.notification_type in important_types


def send_bulk_emails(notification_ids):
    """Send emails for multiple notifications (for batch processing)"""
    success_count = 0
    for notification_id in notification_ids:
        if send_notification_email(notification_id):
            success_count += 1

    return success_count
