from __future__ import annotations

import json
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Run backup, restore dry-run, and optional cloud sync as one hybrid-safe cycle'

    def add_arguments(self, parser):
        parser.add_argument('--output', type=str, default='', help='Optional backup output root')
        parser.add_argument('--skip-cloud-sync', action='store_true', help='Skip the cloud sync step even if configured')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')

    @staticmethod
    def _status_rank(value):
        return {'ok': 0, 'skipped': 0, 'warning': 1, 'error': 2}.get(str(value or '').lower(), 2)

    @staticmethod
    def _run_command_json(*args):
        stdout = StringIO()
        call_command(*args, '--json', stdout=stdout)
        return json.loads(stdout.getvalue())

    def handle(self, *args, **options):
        backup_args = ['backup']
        output_dir = str(options.get('output') or '').strip()
        if output_dir:
            backup_args.append(f'--output={output_dir}')
        backup_payload = self._run_command_json(*backup_args)

        backup_dir = Path(str(backup_payload.get('backup_dir') or '').strip())
        restore_payload = self._run_command_json('restore', str(backup_dir), '--dry-run')
        if options.get('skip_cloud_sync'):
            cloud_sync_payload = {
                'mode': 'sync',
                'status': 'skipped',
                'message': 'Cloud sync skipped by operator request.',
                'backup_dir': str(backup_dir),
                'remote_path': '',
            }
        else:
            cloud_sync_payload = self._run_command_json('backup_cloud_sync', str(backup_dir))

        worst = max(
            self._status_rank(backup_payload.get('status')),
            self._status_rank(restore_payload.get('status')),
            self._status_rank(cloud_sync_payload.get('status')),
        )
        payload = {
            'generated_at': backup_payload.get('generated_at'),
            'backup_dir': str(backup_dir),
            'status': 'ok' if worst == 0 else 'warning' if worst == 1 else 'error',
            'backup': backup_payload,
            'restore_dry_run': restore_payload,
            'cloud_sync': cloud_sync_payload,
        }

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Backup cycle: {payload['status'].upper()}")
            self.stdout.write(f"- backup: {backup_payload.get('status', 'warning').upper()}")
            self.stdout.write(f"- restore dry-run: {restore_payload.get('status', 'warning').upper()}")
            self.stdout.write(f"- cloud sync: {cloud_sync_payload.get('status', 'warning').upper()}")
