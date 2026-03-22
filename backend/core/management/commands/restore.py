from datetime import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess

from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Restore database and media files from backup'

    def add_arguments(self, parser):
        parser.add_argument('backup_dir', type=str, help='Backup directory path')
        parser.add_argument('--confirm', action='store_true', help='Confirm restoration (WILL OVERWRITE DATA)')
        parser.add_argument('--dry-run', action='store_true', help='Validate backup bundle without restoring data')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')

    @staticmethod
    def _status_rank(value):
        return {'ok': 0, 'skipped': 0, 'warning': 1, 'error': 2}.get(str(value or '').lower(), 2)

    @staticmethod
    def _load_json(path: Path):
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except (OSError, TypeError, ValueError):
            return None

    def _build_validation_payload(self, backup_dir: Path):
        manifest = self._load_json(backup_dir / 'backup_manifest.json')
        checks = {
            'backup_dir_exists': backup_dir.exists(),
            'has_database_dump': (backup_dir / 'database.sql').exists(),
            'has_media': (backup_dir / 'media').exists(),
            'has_backup_info': (backup_dir / 'backup_info.txt').exists(),
            'has_backup_manifest': manifest is not None,
        }
        if not checks['backup_dir_exists']:
            status_value = 'error'
            message = f'Backup directory not found: {backup_dir}'
        elif not checks['has_database_dump'] and not checks['has_media']:
            status_value = 'error'
            message = 'Backup bundle does not contain database.sql or media.'
        elif not checks['has_backup_manifest'] or not checks['has_backup_info']:
            status_value = 'warning'
            message = 'Backup bundle is usable but missing backup manifest or info file.'
        else:
            status_value = 'ok'
            message = 'Backup bundle passed restore validation.'
        return {
            'generated_at': datetime.now().isoformat(),
            'backup_dir': str(backup_dir),
            'status': status_value,
            'message': message,
            'checks': checks,
            'manifest': manifest,
        }

    def _write_restore_report(self, backup_dir: Path, filename: str, payload):
        (backup_dir / filename).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, default=str),
            encoding='utf-8',
        )

    def _emit(self, payload, as_json=False):
        if as_json:
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
            return

        self.stdout.write(f"Restore status: {payload['status'].upper()}")
        self.stdout.write(payload['message'])
        if 'database_restore' in payload:
            self.stdout.write(f"- database: {payload['database_restore']['status'].upper()} - {payload['database_restore']['message']}")
        if 'media_restore' in payload:
            self.stdout.write(f"- media: {payload['media_restore']['status'].upper()} - {payload['media_restore']['message']}")

    def handle(self, *args, **options):
        backup_dir = Path(str(options['backup_dir'] or '').strip())
        as_json = bool(options.get('json'))
        dry_run = bool(options.get('dry_run'))
        validation_payload = self._build_validation_payload(backup_dir)

        if not validation_payload['checks']['backup_dir_exists']:
            self._emit(validation_payload, as_json=as_json)
            return

        if dry_run:
            report = {
                **validation_payload,
                'mode': 'dry_run',
                'verified_at': datetime.now().isoformat(),
            }
            self._write_restore_report(backup_dir, 'restore_dry_run.json', report)
            self._emit(report, as_json=as_json)
            return

        if not options['confirm']:
            payload = {
                **validation_payload,
                'status': 'warning' if validation_payload['status'] != 'error' else 'error',
                'message': (
                    'DANGER: This will OVERWRITE current data. Run again with --confirm after reviewing the validation payload.'
                    if validation_payload['status'] != 'error'
                    else validation_payload['message']
                ),
                'suggested_command': f'python manage.py restore {backup_dir} --confirm',
            }
            self._emit(payload, as_json=as_json)
            return

        restore_payload = {
            **validation_payload,
            'mode': 'restore',
            'restored_at': datetime.now().isoformat(),
            'database_restore': {
                'status': 'skipped',
                'message': 'No database dump present in backup bundle.',
            },
            'media_restore': {
                'status': 'skipped',
                'message': 'No media backup present in backup bundle.',
            },
        }
        worst_status = self._status_rank(validation_payload['status'])

        db_file = backup_dir / 'database.sql'
        if db_file.exists():
            db_config = settings.DATABASES['default']

            if db_config['ENGINE'] == 'django.db.backends.postgresql':
                cmd = [
                    'psql',
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
                    restore_payload['database_restore'] = {
                        'status': 'ok',
                        'message': 'Database restored successfully.',
                    }
                except FileNotFoundError:
                    restore_payload['database_restore'] = {
                        'status': 'warning',
                        'message': 'psql not found - restore skipped',
                    }
                except subprocess.CalledProcessError as exc:
                    restore_payload['database_restore'] = {
                        'status': 'error',
                        'message': f'Database restore failed: {exc}',
                    }
            else:
                restore_payload['database_restore'] = {
                    'status': 'warning',
                    'message': 'Database engine is not PostgreSQL; SQL restore skipped.',
                }
            worst_status = max(worst_status, self._status_rank(restore_payload['database_restore']['status']))

        media_backup = backup_dir / 'media'
        if media_backup.exists():
            try:
                if os.path.exists(settings.MEDIA_ROOT):
                    shutil.rmtree(settings.MEDIA_ROOT)
                shutil.copytree(media_backup, settings.MEDIA_ROOT)
                restore_payload['media_restore'] = {
                    'status': 'ok',
                    'message': 'Media files restored successfully.',
                }
            except Exception as exc:
                restore_payload['media_restore'] = {
                    'status': 'error',
                    'message': f'Media restore failed: {exc}',
                }
            worst_status = max(worst_status, self._status_rank(restore_payload['media_restore']['status']))

        restore_payload['status'] = 'ok' if worst_status == 0 else 'warning' if worst_status == 1 else 'error'
        restore_payload['message'] = 'Restore completed.' if restore_payload['status'] == 'ok' else 'Restore completed with warnings/errors.'
        self._write_restore_report(backup_dir, 'restore_last_run.json', restore_payload)
        self._emit(restore_payload, as_json=as_json)
