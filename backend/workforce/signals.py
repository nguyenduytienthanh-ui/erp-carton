from django.apps import apps
from django.db.models.signals import post_migrate
from django.dispatch import receiver

from .reminders import ensure_salary_advance_approval_sla_schedule


@receiver(post_migrate)
def workforce_post_migrate_setup(sender, **kwargs):
    workforce_app = apps.get_app_config('workforce')
    if sender != workforce_app:
        return
    ensure_salary_advance_approval_sla_schedule()
