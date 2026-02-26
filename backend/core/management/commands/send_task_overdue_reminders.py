from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import models
from django.utils import timezone

from core.models import Notification, Task, User


class Command(BaseCommand):
    help = 'Send overdue reminders for open tasks (with cooldown anti-spam).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--cooldown-hours',
            type=int,
            default=24,
            help='Skip recipients who already got reminder within this many hours (default: 24).',
        )
        parser.add_argument(
            '--escalate-after-days',
            type=int,
            default=2,
            help='Escalate to managers when overdue days >= this number (default: 2).',
        )

    def handle(self, *args, **options):
        cooldown_hours = max(int(options['cooldown_hours']), 1)
        escalate_after_days = max(int(options['escalate_after_days']), 1)
        now = timezone.now()
        today = timezone.localdate()
        cooldown_since = now - timedelta(hours=cooldown_hours)

        tasks = Task.objects.filter(
            status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS],
            due_date__lt=today,
        ).select_related('assigned_to', 'assigned_by')

        manager_ids = set(
            User.objects.filter(
                models.Q(is_staff=True) | models.Q(is_superuser=True),
                is_active=True,
            ).values_list('id', flat=True)
        )

        sent = 0
        for task in tasks:
            overdue_days = (today - task.due_date).days
            recipients = set()
            if task.assigned_to_id:
                recipients.add(task.assigned_to_id)
            if task.assigned_by_id:
                recipients.add(task.assigned_by_id)
            if overdue_days >= escalate_after_days:
                recipients.update(manager_ids)

            for recipient_id in recipients:
                duplicated_recent = Notification.objects.filter(
                    recipient_id=recipient_id,
                    notification_type='due_date',
                    entity_type='Task',
                    entity_id=task.id,
                    created_at__gte=cooldown_since,
                ).exists()
                if duplicated_recent:
                    continue

                Notification.objects.create(
                    recipient_id=recipient_id,
                    notification_type='due_date',
                    title=f'⏰ Quá hạn: {task.title[:60]}',
                    message=(
                        f'Nhiệm vụ "{task.title}" đã quá hạn {overdue_days} ngày.'
                        f' Hạn hoàn thành: {task.due_date.strftime("%d/%m/%Y")}.'
                    ),
                    entity_type='Task',
                    entity_id=task.id,
                    actor=None,
                )
                sent += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'Overdue reminders completed. Sent={sent}, tasks_scanned={tasks.count()}, '
                f'cooldown_hours={cooldown_hours}, escalate_after_days={escalate_after_days}'
            )
        )
