from django.core.management.base import BaseCommand
from django.utils import timezone

from core.workflow_services import run_due_automation_schedules


class Command(BaseCommand):
    help = 'Run workflow automation scheduler for due slots.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Only simulate due runs without executing.')
        parser.add_argument('--user-id', type=int, action='append', dest='user_ids', help='Run only for specific user_id (can pass multiple).')

    def handle(self, *args, **options):
        dry_run = bool(options.get('dry_run'))
        user_ids = options.get('user_ids') or None
        result = run_due_automation_schedules(
            now=timezone.now(),
            dry_run=dry_run,
            user_ids=user_ids,
        )
        self.stdout.write(self.style.SUCCESS(
            f"[scheduler] success={result.get('success')} dry_run={result.get('dry_run')} users={result.get('users_count')} total_executed={result.get('total_executed')}"
        ))
