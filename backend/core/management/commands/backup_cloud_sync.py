from __future__ import annotations

import json
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Sync a backup bundle to cloud storage via rclone and record cloud_sync.json'

    def add_arguments(self, parser):
        parser.add_argument('backup_dir', nargs='?', default='', help='Optional backup directory path; defaults to the latest bundle')
        parser.add_argument('--dry-run', action='store_true', help='Preview the rclone sync without uploading')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')

    @staticmethod
    def _status_rank(value):
        return {'ok': 0, 'skipped': 1, 'warning': 1, 'error': 2}.get(str(value or '').lower(), 2)

    @staticmethod
    def _resolve_latest_backup_dir():
        backup_root = Path(getattr(settings, 'BACKUP_ROOT', Path(settings.BASE_DIR) / 'backups'))
        if not backup_root.exists():
            return None
        candidates = sorted(
            [entry for entry in backup_root.iterdir() if entry.is_dir()],
            key=lambda entry: entry.stat().st_mtime,
            reverse=True,
        )
        return candidates[0] if candidates else None

    @staticmethod
    def _emit(payload, *, stdout, as_json):
        if as_json:
            stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
            return
        stdout.write(f"Backup cloud sync: {payload['status'].upper()}")
        stdout.write(payload['message'])
        stdout.write(f"- backup: {payload['backup_dir']}")
        stdout.write(f"- remote: {payload['remote_path']}")

    def handle(self, *args, **options):
        backup_arg = str(options.get('backup_dir') or '').strip()
        backup_dir = Path(backup_arg) if backup_arg else self._resolve_latest_backup_dir()
        if backup_dir is None:
            raise CommandError('No backup bundle found to sync.')

        provider = str(getattr(settings, 'BACKUP_CLOUD_PROVIDER', '') or '').strip().lower()
        rclone_binary = str(getattr(settings, 'BACKUP_RCLONE_BINARY', 'rclone') or 'rclone').strip()
        destination_root = str(getattr(settings, 'BACKUP_RCLONE_DESTINATION', '') or '').strip()
        dry_run = bool(options.get('dry_run'))
        cloud_sync_enabled = bool(getattr(settings, 'BACKUP_CLOUD_SYNC_ENABLED', False))
        remote_path = f"{destination_root.rstrip('/')}/{backup_dir.name}" if destination_root else ''

        payload = {
            'generated_at': datetime.now().isoformat(),
            'mode': 'dry_run' if dry_run else 'sync',
            'provider': provider,
            'backup_dir': str(backup_dir),
            'backup_name': backup_dir.name,
            'binary': rclone_binary,
            'remote_root': destination_root,
            'remote_path': remote_path,
            'status': 'warning',
            'message': '',
            'stdout': '',
            'stderr': '',
        }

        if not backup_dir.exists():
            payload['status'] = 'error'
            payload['message'] = f'Backup directory not found: {backup_dir}'
        elif not cloud_sync_enabled:
            payload['status'] = 'skipped'
            payload['message'] = 'BACKUP_CLOUD_SYNC_ENABLED is off; cloud sync skipped.'
        elif provider != 'rclone':
            payload['status'] = 'warning'
            payload['message'] = 'BACKUP_CLOUD_PROVIDER must be set to rclone.'
        elif not destination_root:
            payload['status'] = 'warning'
            payload['message'] = 'BACKUP_RCLONE_DESTINATION is empty.'
        elif shutil.which(rclone_binary) is None and not Path(rclone_binary).is_file():
            payload['status'] = 'warning'
            payload['message'] = f'rclone binary not found: {rclone_binary}'
        else:
            command = [rclone_binary, 'copy', str(backup_dir), remote_path, '--create-empty-src-dirs']
            if dry_run:
                command.append('--dry-run')
            completed = subprocess.run(command, capture_output=True, text=True, check=False)
            payload['stdout'] = str(completed.stdout or '').strip()
            payload['stderr'] = str(completed.stderr or '').strip()
            if completed.returncode == 0:
                payload['status'] = 'ok'
                payload['message'] = (
                    'Cloud sync dry-run completed successfully.'
                    if dry_run
                    else 'Backup bundle synced to cloud storage successfully.'
                )
            else:
                payload['status'] = 'error'
                payload['message'] = f'rclone exited with status {completed.returncode}'

        if backup_dir.exists():
            (backup_dir / 'cloud_sync.json').write_text(
                json.dumps(payload, ensure_ascii=False, indent=2, default=str),
                encoding='utf-8',
            )

        self._emit(payload, stdout=self.stdout, as_json=bool(options.get('json')))
