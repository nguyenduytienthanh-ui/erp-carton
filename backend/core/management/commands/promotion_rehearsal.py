import json
from io import StringIO

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone


class Command(BaseCommand):
    help = 'Generate a staging/UAT/production promotion rehearsal checklist from current readiness signals'

    def add_arguments(self, parser):
        parser.add_argument('--environment', default='staging', choices=['staging', 'uat', 'production'])
        parser.add_argument('--hours', type=int, default=24, help='Hours window for email delivery checks')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')
        parser.add_argument('--strict', action='store_true', help='Exit non-zero when blockers are present')

    def _load_release_readiness(self, hours):
        stdout = StringIO()
        call_command('release_readiness', '--json', f'--hours={hours}', stdout=stdout)
        return json.loads(stdout.getvalue())

    @staticmethod
    def _build_phases(environment, latest_backup_path):
        restore_target = latest_backup_path or '<latest-backup-dir>'
        phases = [
            {
                'key': 'backup_and_restore',
                'label': 'Backup and restore drill',
                'commands': [
                    'python manage.py backup --json',
                    f'python manage.py restore {restore_target} --dry-run --json',
                ],
            },
            {
                'key': 'migration_rehearsal',
                'label': 'Migration rehearsal',
                'commands': [
                    'python manage.py migrate --plan',
                    'python manage.py migrate',
                ],
            },
            {
                'key': 'uat_bootstrap',
                'label': 'UAT persona and permission matrix',
                'commands': [
                    'python manage.py bootstrap_uat_demo --reset-passwords',
                    'python manage.py uat_access_matrix --json',
                ],
            },
            {
                'key': 'release_gate',
                'label': 'Release gate checks',
                'commands': [
                    'python manage.py release_readiness --json',
                ],
            },
            {
                'key': 'targeted_tests',
                'label': 'Targeted backend/frontend verification',
                'commands': [
                    'python manage.py test core.tests_release_readiness core.tests_access_surface_matrix core.tests_go_live_observability --keepdb --noinput',
                    'cd frontend && npm run build',
                    'cd frontend && npx playwright test tests/e2e/critical-documents-lifecycle.spec.ts',
                ],
            },
        ]
        if environment in {'uat', 'production'}:
            phases[1]['commands'].append('python manage.py promotion_rehearsal --environment production --strict --json')
        return phases

    @staticmethod
    def _build_blockers(environment, readiness):
        blockers = []
        if int(readiness['migrations']['pending_count']) > 0:
            blockers.append('Pending migrations still exist and must be applied on staging before promotion.')
        if readiness['backups']['status'] != 'ok':
            blockers.append('Latest backup is stale or missing.')
        if readiness['backups'].get('restore_drill_status') != 'ok':
            blockers.append('Latest backup has not passed a restore dry-run.')
        if readiness['uat_personas']['missing_count'] > 0:
            blockers.append('Some expected UAT personas are missing.')
        if environment == 'production' and readiness['alerts']['status'] != 'ok':
            blockers.append('Production alert channels are not fully configured.')
        return blockers

    def handle(self, *args, **options):
        environment = str(options.get('environment') or 'staging').strip().lower()
        hours = max(1, min(int(options.get('hours') or 24), 168))
        readiness = self._load_release_readiness(hours)
        latest_backup = readiness['backups'].get('latest_backup') or {}
        phases = self._build_phases(environment, latest_backup.get('path'))
        blockers = self._build_blockers(environment, readiness)
        payload = {
            'environment': environment,
            'generated_at': timezone.now(),
            'overall_status': 'ok' if not blockers else 'warning',
            'summary': {
                'pending_migrations': readiness['migrations']['pending_count'],
                'backup_status': readiness['backups']['status'],
                'restore_drill_status': readiness['backups'].get('restore_drill_status', 'warning'),
                'missing_uat_personas': readiness['uat_personas']['missing_count'],
                'alert_status': readiness['alerts']['status'],
            },
            'blockers': blockers,
            'phases': phases,
            'release_readiness': readiness,
        }

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Promotion rehearsal ({environment}): {payload['overall_status'].upper()}")
            for blocker in blockers:
                self.stdout.write(f"- blocker: {blocker}")
            self.stdout.write('Phases:')
            for phase in phases:
                self.stdout.write(f"* {phase['label']}")
                for command in phase['commands']:
                    self.stdout.write(f"  - {command}")

        if options.get('strict') and blockers:
            raise CommandError(f'Promotion rehearsal found {len(blockers)} blocker(s)')
