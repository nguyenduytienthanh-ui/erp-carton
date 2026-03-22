import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command
from django.test import TestCase, override_settings

from core.models import AuditLog


class ReleaseLockfileCommandTests(TestCase):
    def test_release_lockfile_writes_bundle_and_records_export_audit(self):
        call_command('bootstrap_uat_demo', password='Demo123!', reset_passwords=True)

        with TemporaryDirectory() as tmpdir:
            backup_dir = Path(tmpdir) / '20260322_110000'
            backup_dir.mkdir(parents=True, exist_ok=True)
            (backup_dir / 'database.sql').write_text('-- dump --', encoding='utf-8')
            (backup_dir / 'backup_info.txt').write_text('created', encoding='utf-8')
            (backup_dir / 'backup_manifest.json').write_text('{"status":"ok"}', encoding='utf-8')
            (backup_dir / 'restore_dry_run.json').write_text('{"status":"ok"}', encoding='utf-8')

            output_path = Path(tmpdir) / 'release-lockfile.json'
            stdout = StringIO()
            with override_settings(
                BACKUP_ROOT=Path(tmpdir),
                BACKUP_STALE_HOURS=72,
                ALERT_EMAIL_RECIPIENTS=['it@example.com'],
            ):
                call_command('release_lockfile', '--environment=staging', f'--output={output_path}', '--json', stdout=stdout)

            payload = json.loads(stdout.getvalue())
            self.assertTrue(output_path.exists())

        self.assertEqual(payload['environment'], 'staging')
        self.assertIn('permission_surface_audit', payload)
        self.assertIn('docs/RELEASE_LOCK.md', payload['document_refs'])
        self.assertTrue(AuditLog.objects.filter(entity_type='ReleaseLockfile', action='EXPORT').exists())
