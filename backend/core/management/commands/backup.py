from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import shutil
import subprocess

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Backup database and media files'

    def add_arguments(self, parser):
        parser.add_argument('--output', type=str, default='', help='Output directory')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')

    def _resolve_output_root(self, output_dir):
        raw_output = str(output_dir or '').strip()
        root = Path(raw_output) if raw_output else Path(getattr(settings, 'BACKUP_ROOT', Path(settings.BASE_DIR) / 'backups'))
        if not root.is_absolute():
            root = Path(settings.BASE_DIR) / root
        return root

    def _prune_expired_backups(self, output_root, current_timestamp):
        retention_days = int(getattr(settings, 'BACKUP_RETENTION_DAYS', 0) or 0)
        if retention_days <= 0 or not output_root.exists():
            return 0

        cutoff = datetime.now() - timedelta(days=retention_days)
        pruned_count = 0
        for child in output_root.iterdir():
            if not child.is_dir() or child.name == current_timestamp:
                continue
            child_mtime = datetime.fromtimestamp(child.stat().st_mtime)
            if child_mtime >= cutoff:
                continue
            shutil.rmtree(child, ignore_errors=True)
            pruned_count += 1
        return pruned_count

    @staticmethod
    def _status_rank(value):
        return {'ok': 0, 'skipped': 1, 'warning': 1, 'error': 2}.get(str(value or '').lower(), 2)

    def _emit(self, payload, as_json=False):
        if as_json:
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
            return

        self.stdout.write(f"Creating backup in {payload['backup_dir']}...")
        database = payload['database']
        media = payload['media']
        if database['status'] == 'ok':
            self.stdout.write(self.style.SUCCESS('Database backed up'))
        elif database['status'] == 'warning':
            self.stdout.write(self.style.WARNING(database['message']))
        else:
            self.stdout.write(self.style.ERROR(database['message']))
        if media['status'] == 'ok':
            self.stdout.write(self.style.SUCCESS('Media files backed up'))
        elif media['status'] == 'warning':
            self.stdout.write(self.style.WARNING(media['message']))
        else:
            self.stdout.write(self.style.ERROR(media['message']))
        if payload['pruned_count'] > 0:
            self.stdout.write(self.style.WARNING(f"Pruned {payload['pruned_count']} expired backup folder(s)"))
        self.stdout.write(self.style.SUCCESS(f"\nBackup completed with status {payload['status'].upper()}!\nLocation: {payload['backup_dir']}"))

    def handle(self, *args, **options):
        output_root = self._resolve_output_root(options['output'])
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_dir = output_root / timestamp
        backup_dir.mkdir(parents=True, exist_ok=True)

        db_config = settings.DATABASES['default']
        payload = {
            'generated_at': datetime.now().isoformat(),
            'app_env': str(getattr(settings, 'APP_ENV', 'development') or 'development'),
            'backup_root': str(output_root),
            'backup_dir': str(backup_dir),
            'retention_days': int(getattr(settings, 'BACKUP_RETENTION_DAYS', 0) or 0),
            'database': {
                'engine': str(db_config.get('ENGINE') or ''),
                'name': str(db_config.get('NAME') or ''),
                'host': str(db_config.get('HOST') or ''),
                'port': str(db_config.get('PORT') or ''),
                'status': 'skipped',
                'message': 'Database engine is not PostgreSQL; SQL dump skipped.',
                'dump_path': '',
            },
            'media': {
                'root': str(getattr(settings, 'MEDIA_ROOT', '') or ''),
                'status': 'warning',
                'message': f"Media root does not exist: {getattr(settings, 'MEDIA_ROOT', '')}",
                'backup_path': '',
            },
            'pruned_count': 0,
            'status': 'ok',
        }
        if db_config['ENGINE'] == 'django.db.backends.postgresql':
            db_file = backup_dir / 'database.sql'
            cmd = [
                'pg_dump',
                '-h', db_config['HOST'],
                '-p', str(db_config['PORT']),
                '-U', db_config['USER'],
                '-d', db_config['NAME'],
                '-f', str(db_file),
            ]
            env = os.environ.copy()
            env['PGPASSWORD'] = db_config['PASSWORD']
            try:
                subprocess.run(cmd, env=env, check=True, capture_output=True)
                payload['database'].update({
                    'status': 'ok',
                    'message': 'Database dumped successfully.',
                    'dump_path': str(db_file),
                })
            except FileNotFoundError:
                payload['database'].update({
                    'status': 'warning',
                    'message': 'pg_dump not found - backup skipped',
                })
            except subprocess.CalledProcessError as exc:
                payload['database'].update({
                    'status': 'error',
                    'message': f'Database backup failed: {exc}',
                })

        if os.path.exists(settings.MEDIA_ROOT):
            media_backup = backup_dir / 'media'
            try:
                shutil.copytree(settings.MEDIA_ROOT, media_backup)
                payload['media'].update({
                    'status': 'ok',
                    'message': 'Media files copied successfully.',
                    'backup_path': str(media_backup),
                })
            except Exception as exc:
                payload['media'].update({
                    'status': 'error',
                    'message': f'Media backup failed: {exc}',
                })

        with open(backup_dir / 'backup_info.txt', 'w', encoding='utf-8') as handle:
            handle.write(f"Backup: {datetime.now()}\nDatabase: {db_config['NAME']}\n")

        payload['pruned_count'] = self._prune_expired_backups(output_root, timestamp)
        payload['status'] = (
            'error'
            if max(self._status_rank(payload['database']['status']), self._status_rank(payload['media']['status'])) >= 2
            else 'warning'
            if max(self._status_rank(payload['database']['status']), self._status_rank(payload['media']['status'])) == 1
            else 'ok'
        )

        manifest_payload = {
            'generated_at': payload['generated_at'],
            'app_env': payload['app_env'],
            'backup_dir': payload['backup_dir'],
            'retention_days': payload['retention_days'],
            'status': payload['status'],
            'database': payload['database'],
            'media': payload['media'],
            'pruned_count': payload['pruned_count'],
        }
        (backup_dir / 'backup_manifest.json').write_text(
            json.dumps(manifest_payload, ensure_ascii=False, indent=2, default=str),
            encoding='utf-8',
        )

        self._emit(payload, as_json=bool(options.get('json')))
