from django.apps import apps
from django.db.models.signals import post_migrate
from django.dispatch import receiver

from .reminders import ensure_approval_sla_schedule, ensure_executive_auto_schedule, ensure_overdue_reminder_schedule


@receiver(post_migrate)
def finance_post_migrate_setup(sender, **kwargs):
    finance_app = apps.get_app_config('finance')
    if sender != finance_app:
        return
    ensure_overdue_reminder_schedule()
    ensure_approval_sla_schedule()
    ensure_executive_auto_schedule()