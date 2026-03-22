import json
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.models import AuditLog


class Command(BaseCommand):
    help = 'Dry-run or purge expired audit logs based on retention policy'

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, help='Override retention window in days')
        parser.add_argument('--dry-run', action='store_true', help='Preview expired audit logs without deleting')
        parser.add_argument('--confirm', action='store_true', help='Actually delete expired audit logs')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')

    def handle(self, *args, **options):
        retention_days = int(options.get('days') or getattr(settings, 'AUDIT_LOG_RETENTION_DAYS', 0) or 0)
        if retention_days <= 0:
            raise CommandError('AUDIT_LOG_RETENTION_DAYS must be greater than zero')

        dry_run = bool(options.get('dry_run'))
        confirm = bool(options.get('confirm'))
        if not dry_run and not confirm:
            dry_run = True

        cutoff = timezone.now() - timedelta(days=retention_days)
        queryset = AuditLog.objects.filter(created_at__lt=cutoff).order_by('id')
        expired_count = queryset.count()
        deleted_count = 0
        mode = 'dry_run' if dry_run else 'purge'
        if confirm and not dry_run and expired_count > 0:
            deleted_count, _ = queryset.delete()

        payload = {
            'generated_at': timezone.now(),
            'mode': mode,
            'retention_days': retention_days,
            'cutoff': cutoff,
            'expired_count': expired_count,
            'deleted_count': deleted_count,
            'status': 'ok',
        }
        AuditLog.objects.create(
            user=None,
            action='DRY_RUN' if dry_run else 'PURGE',
            entity_type='AuditRetention',
            entity_id=0,
            entity_id_str='retention',
            entity_code='AUDIT_RETENTION',
            old_values={},
            new_values={
                'retention_days': retention_days,
                'cutoff': cutoff.isoformat(),
                'expired_count': expired_count,
                'deleted_count': deleted_count,
                'mode': mode,
            },
            changed_fields=['deleted_count'],
        )

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(
                f"Audit retention {mode}: expired={expired_count}, deleted={deleted_count}, retention_days={retention_days}"
            )
