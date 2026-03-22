import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command
from django.test import TestCase, override_settings


class BackupRestoreCommandTests(TestCase):
    def test_backup_command_writes_manifest_and_copies_media(self):
        with TemporaryDirectory() as tmpdir:
            media_root = Path(tmpdir) / 'media-source'
            media_root.mkdir(parents=True, exist_ok=True)
            (media_root / 'sample.txt').write_text('seed-media', encoding='utf-8')

            stdout = StringIO()
            with override_settings(BACKUP_ROOT=Path(tmpdir) / 'backups', MEDIA_ROOT=media_root):
                call_command('backup', '--json', stdout=stdout)

            payload = json.loads(stdout.getvalue())
            backup_dir = Path(payload['backup_dir'])
            self.assertTrue((backup_dir / 'backup_manifest.json').exists())
            self.assertTrue((backup_dir / 'backup_info.txt').exists())
            self.assertTrue((backup_dir / 'media' / 'sample.txt').exists())
            self.assertEqual(payload['media']['status'], 'ok')
            self.assertIn(payload['database']['status'], {'skipped', 'warning', 'ok'})

    def test_restore_dry_run_validates_bundle_and_writes_report(self):
        with TemporaryDirectory() as tmpdir:
            backup_dir = Path(tmpdir) / '20260322_080000'
            backup_dir.mkdir(parents=True, exist_ok=True)
            (backup_dir / 'database.sql').write_text('-- dump --', encoding='utf-8')
            (backup_dir / 'backup_info.txt').write_text('created', encoding='utf-8')
            (backup_dir / 'backup_manifest.json').write_text(
                json.dumps({'status': 'ok', 'generated_at': '2026-03-22T08:00:00'}),
                encoding='utf-8',
            )

            stdout = StringIO()
            call_command('restore', str(backup_dir), '--dry-run', '--json', stdout=stdout)
            payload = json.loads(stdout.getvalue())

            self.assertEqual(payload['status'], 'ok')
            self.assertEqual(payload['mode'], 'dry_run')
            report_payload = json.loads((backup_dir / 'restore_dry_run.json').read_text(encoding='utf-8'))
            self.assertEqual(report_payload['status'], 'ok')
            self.assertTrue(report_payload['checks']['has_backup_manifest'])
