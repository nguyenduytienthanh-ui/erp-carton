from __future__ import annotations

import json
from io import StringIO
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import AuditLog


class Command(BaseCommand):
    help = 'Export a release lockfile with branch, migration, backup, readiness, and UAT coverage metadata'

    def add_arguments(self, parser):
        parser.add_argument('--environment', default='staging', choices=['staging', 'uat', 'production'])
        parser.add_argument('--output', default='', help='Optional output file path')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')

    @staticmethod
    def _run_command_json(*args):
        stdout = StringIO()
        call_command(*args, '--json', stdout=stdout)
        return json.loads(stdout.getvalue())

    @staticmethod
    def _known_blockers(*, release_readiness, release_hygiene, performance_drilldown):
        external_secrets = list(release_readiness.get('alerts', {}).get('external_blockers') or [])
        dirty_unrelated_worktree = []
        if str(release_hygiene.get('status') or '').lower() != 'ok':
            dirty_unrelated_worktree.append(
                f"Working tree still has {int(release_hygiene.get('total_changes') or 0)} open change(s)."
            )
            if release_hygiene.get('migration_candidates'):
                dirty_unrelated_worktree.append('Open migration files are still present in the current working tree.')
        performance_follow_up = []
        for surface in list(performance_drilldown.get('surfaces') or []):
            if str(surface.get('status') or '').lower() == 'ok':
                continue
            performance_follow_up.append(
                f"{surface.get('route') or surface.get('key')}: slow signals = {', '.join(surface.get('slow_signals') or [])}"
            )
        return {
            'external_secrets': external_secrets,
            'dirty_unrelated_worktree': dirty_unrelated_worktree,
            'performance_follow_up': performance_follow_up,
        }

    def handle(self, *args, **options):
        environment = str(options.get('environment') or 'staging').strip().lower()
        release_hygiene = self._run_command_json('release_hygiene')
        release_readiness = self._run_command_json('release_readiness')
        cleanup_preview = self._run_command_json('cleanup_release_artifacts')
        performance_drilldown = self._run_command_json('performance_drilldown')
        promotion_rehearsal = self._run_command_json('promotion_rehearsal', f'--environment={environment}')
        uat_access_matrix = self._run_command_json('uat_access_matrix')
        permission_surface_audit = self._run_command_json('permission_surface_audit')

        payload = {
            'generated_at': timezone.now(),
            'environment': environment,
            'release_identity': {
                'branch': release_hygiene.get('branch', ''),
                'commit_sha': release_hygiene.get('commit_sha', ''),
                'latest_tag': release_hygiene.get('latest_tag', ''),
            },
            'summary': {
                'release_hygiene': release_hygiene.get('status', 'warning'),
                'release_readiness': release_readiness.get('overall_status', 'warning'),
                'cleanup_preview': cleanup_preview.get('status', 'warning'),
                'performance_drilldown': performance_drilldown.get('status', 'warning'),
                'promotion_rehearsal': promotion_rehearsal.get('overall_status', 'warning'),
                'uat_personas_available': uat_access_matrix.get('available_count', 0),
                'uat_personas_expected': uat_access_matrix.get('expected_count', 0),
                'permission_surface_audit': permission_surface_audit.get('overall_status', 'warning'),
            },
            'migration_inventory': {
                'pending_count': release_readiness.get('migrations', {}).get('pending_count', 0),
                'pending_items': release_readiness.get('migrations', {}).get('items', []),
                'working_tree_candidates': release_hygiene.get('migration_candidates', []),
            },
            'backup_bundle': release_readiness.get('backups', {}).get('latest_backup'),
            'cleanup_preview': cleanup_preview,
            'release_hygiene': release_hygiene,
            'release_readiness': release_readiness,
            'performance_drilldown': performance_drilldown,
            'promotion_rehearsal': promotion_rehearsal,
            'uat_access_matrix': uat_access_matrix,
            'permission_surface_audit': permission_surface_audit,
            'known_blockers': self._known_blockers(
                release_readiness=release_readiness,
                release_hygiene=release_hygiene,
                performance_drilldown=performance_drilldown,
            ),
            'recommended_commands': [
                'python manage.py cleanup_release_artifacts --json',
                'python manage.py alert_channel_readiness --json',
                'python manage.py performance_drilldown --json',
                'python manage.py permission_surface_audit --json',
                'python manage.py go_live_handoff --json',
                'git tag <release-version>',
            ],
            'document_refs': ['AGENTS.md'],
        }

        output = str(options.get('output') or '').strip()
        output_path = Path(output) if output else Path(settings.BASE_DIR).parent / 'artifacts' / 'ops' / 'RELEASE_LOCK_LATEST.json'
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding='utf-8')

        AuditLog.objects.create(
            user=None,
            action='EXPORT',
            entity_type='ReleaseLockfile',
            entity_id=0,
            entity_id_str=environment,
            entity_code=environment.upper(),
            old_values={},
            new_values={
                'environment': environment,
                'output_path': str(output_path),
                'release_readiness': payload['summary']['release_readiness'],
                'release_hygiene': payload['summary']['release_hygiene'],
                'permission_surface_audit': payload['summary']['permission_surface_audit'],
            },
            changed_fields=['output_path'],
        )

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Release lockfile written to {output_path}")
