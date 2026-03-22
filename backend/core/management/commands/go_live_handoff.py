import json
from io import StringIO
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import AuditLog


class Command(BaseCommand):
    help = 'Build a JSON handoff bundle for staging/UAT/production operations'

    def add_arguments(self, parser):
        parser.add_argument('--environment', default='staging', choices=['staging', 'uat', 'production'])
        parser.add_argument('--output', default='', help='Optional output file path')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')

    @staticmethod
    def _run_command_json(*args):
        stdout = StringIO()
        call_command(*args, '--json', stdout=stdout)
        return json.loads(stdout.getvalue())

    def handle(self, *args, **options):
        environment = str(options.get('environment') or 'staging').strip().lower()
        release_readiness = self._run_command_json('release_readiness')
        promotion_rehearsal = self._run_command_json('promotion_rehearsal', f'--environment={environment}')
        uat_access_matrix = self._run_command_json('uat_access_matrix')
        permission_surface_audit = self._run_command_json('permission_surface_audit')
        release_hygiene = self._run_command_json('release_hygiene')
        performance_readiness = self._run_command_json('performance_readiness')

        payload = {
            'generated_at': timezone.now(),
            'environment': environment,
            'summary': {
                'release_readiness': release_readiness['overall_status'],
                'promotion_rehearsal': promotion_rehearsal['overall_status'],
                'uat_personas_available': uat_access_matrix['available_count'],
                'uat_personas_expected': uat_access_matrix['expected_count'],
                'permission_surface_audit': permission_surface_audit['overall_status'],
                'release_hygiene': release_hygiene['status'],
                'performance_readiness': performance_readiness['status'],
            },
            'recommended_commands': [
                'python manage.py release_readiness --json',
                'python manage.py release_hygiene --json',
                'python manage.py cleanup_release_artifacts --json',
                'python manage.py release_lockfile --json',
                'python manage.py alert_channel_readiness --json',
                'python manage.py performance_readiness --json',
                'python manage.py performance_drilldown --json',
                f'python manage.py promotion_rehearsal --environment {environment} --json',
                'python manage.py uat_access_matrix --json',
                'python manage.py permission_surface_audit --json',
                'python manage.py send_test_alert --json',
                'python manage.py purge_audit_logs --dry-run --json',
            ],
            'document_refs': [
                'docs/PRODUCTION_RUNBOOK.md',
                'docs/STAGING_REHEARSAL_CHECKLIST.md',
                'docs/MONITORING_ALERTING.md',
                'docs/RELEASE_HYGIENE.md',
                'docs/RELEASE_LOCK.md',
                'docs/PERFORMANCE_READINESS.md',
                'docs/UAT_DEMO_USERS.md',
                'docs/GO_LIVE_HANDOFF.md',
            ],
            'release_readiness': release_readiness,
            'release_hygiene': release_hygiene,
            'performance_readiness': performance_readiness,
            'promotion_rehearsal': promotion_rehearsal,
            'uat_access_matrix': uat_access_matrix,
            'permission_surface_audit': permission_surface_audit,
        }

        output = str(options.get('output') or '').strip()
        output_path = None
        if output:
            output_path = Path(output)
        else:
            output_path = Path(settings.BASE_DIR).parent / 'docs' / 'GO_LIVE_HANDOFF_LATEST.json'
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding='utf-8')

        AuditLog.objects.create(
            user=None,
            action='EXPORT',
            entity_type='GoLiveHandoff',
            entity_id=0,
            entity_id_str=environment,
            entity_code=environment.upper(),
            old_values={},
            new_values={
                'environment': environment,
                'output_path': str(output_path),
                'release_readiness': payload['summary']['release_readiness'],
                'release_hygiene': payload['summary']['release_hygiene'],
                'performance_readiness': payload['summary']['performance_readiness'],
                'promotion_rehearsal': payload['summary']['promotion_rehearsal'],
                'permission_surface_audit': payload['summary']['permission_surface_audit'],
            },
            changed_fields=['output_path'],
        )

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Go-live handoff bundle written to {output_path}")
