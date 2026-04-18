from .models import Notification

def create_notification(recipient, notification_type, title, message, 
                       entity_type=None, entity_id=None, actor=None):
    """
    Helper to create notification
    
    Usage:
    create_notification(
        recipient=user,
        notification_type='mention',
        title='You were mentioned',
        message='@john mentioned you in a comment',
        entity_type='Customer',
        entity_id=123,
        actor=mentioner_user
    )
    """
    return Notification.objects.create(
        recipient=recipient,
        notification_type=notification_type,
        title=title,
        message=message,
        entity_type=entity_type or '',
        entity_id=entity_id,
        actor=actor
    )

def notify_mentions(comment, actor):
    """Notify users mentioned in comment"""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    
    for username in comment.mentions:
        try:
            user = User.objects.get(username=username)
            if user != actor:  # Don't notify yourself
                create_notification(
                    recipient=user,
                    notification_type='mention',
                    title=f'@{actor.username} mentioned you',
                    message=f'in a comment on {comment.entity_type} #{comment.entity_id}',
                    entity_type=comment.entity_type,
                    entity_id=comment.entity_id,
                    actor=actor
                )
        except User.DoesNotExist:
            pass
