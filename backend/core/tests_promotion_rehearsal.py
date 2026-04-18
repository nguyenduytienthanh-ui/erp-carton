import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings


class PromotionRehearsalCommandTests(TestCase):
    def test_promotion_rehearsal_builds_structured_phase_plan(self):
        call_command('bootstrap_uat_demo', password='Demo123!', reset_passwords=True)

        with TemporaryDirectory() as tmpdir:
            backup_dir = Path(tmpdir) / '20260322_090000'
            backup_dir.mkdir(parents=True, exist_ok=True)
            (backup_dir / 'database.sql').write_text('-- dump --', encoding='utf-8')
            (backup_dir / 'backup_info.txt').write_text('created', encoding='utf-8')
            (backup_dir / 'backup_manifest.json').write_text(
                json.dumps({'status': 'ok', 'generated_at': '2026-03-22T09:00:00'}),
                encoding='utf-8',
            )
            (backup_dir / 'restore_dry_run.json').write_text(
                json.dumps({'status': 'ok', 'verified_at': '2026-03-22T09:05:00'}),
                encoding='utf-8',
            )
            (backup_dir / 'cloud_sync.json').write_text(
                json.dumps({'status': 'ok', 'mode': 'sync', 'synced_at': '2026-03-22T09:06:00'}),
                encoding='utf-8',
            )

            stdout = StringIO()
            with override_settings(
                BACKUP_ROOT=Path(tmpdir),
                BACKUP_STALE_HOURS=72,
                BACKUP_CLOUD_SYNC_ENABLED=True,
                BACKUP_CLOUD_PROVIDER='rclone',
                BACKUP_RCLONE_DESTINATION='gdrive:erp-carton-backups',
                ALERT_EMAIL_RECIPIENTS=['it@example.com'],
            ):
                call_command('promotion_rehearsal', '--json', stdout=stdout)

        payload = json.loads(stdout.getvalue())
        self.assertIn(payload['overall_status'], {'ok', 'warning'})
        self.assertEqual(payload['summary']['restore_drill_status'], 'ok')
        self.assertEqual(payload['summary']['cloud_sync_status'], 'ok')
        phase_keys = [item['key'] for item in payload['phases']]
        self.assertIn('backup_and_restore', phase_keys)
        self.assertIn('migration_rehearsal', phase_keys)
        self.assertIn('uat_bootstrap', phase_keys)

    def test_promotion_rehearsal_strict_fails_when_blockers_exist(self):
        with self.assertRaises(CommandError):
            call_command('promotion_rehearsal', '--strict')
