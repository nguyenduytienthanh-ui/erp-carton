import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command
from django.test import TestCase, override_settings

from core.models import AuditLog


class GoLiveHandoffCommandTests(TestCase):
    def test_go_live_handoff_writes_bundle_and_records_export_audit(self):
        call_command('bootstrap_uat_demo', password='Demo123!', reset_passwords=True)

        with TemporaryDirectory() as tmpdir:
            backup_dir = Path(tmpdir) / '20260322_100000'
            backup_dir.mkdir(parents=True, exist_ok=True)
            (backup_dir / 'database.sql').write_text('-- dump --', encoding='utf-8')
            (backup_dir / 'backup_info.txt').write_text('created', encoding='utf-8')
            (backup_dir / 'backup_manifest.json').write_text('{"status":"ok"}', encoding='utf-8')
            (backup_dir / 'restore_dry_run.json').write_text('{"status":"ok"}', encoding='utf-8')

            stdout = StringIO()
            output_path = Path(tmpdir) / 'handoff.json'
            with override_settings(
                BACKUP_ROOT=Path(tmpdir),
                BACKUP_STALE_HOURS=72,
                ALERT_EMAIL_RECIPIENTS=['it@example.com'],
            ):
                call_command('go_live_handoff', output=str(output_path), json=True, stdout=stdout)

            payload = json.loads(stdout.getvalue())
            self.assertTrue(output_path.exists())

        self.assertEqual(payload['summary']['uat_personas_available'], 9)
        self.assertEqual(payload['release_readiness']['migrations']['pending_count'], 0)
        self.assertIn('docs/GO_LIVE_HANDOFF.md', payload['document_refs'])
        self.assertIn('docs/RELEASE_HYGIENE.md', payload['document_refs'])
        self.assertIn('docs/RELEASE_LOCK.md', payload['document_refs'])
        self.assertIn('docs/PERFORMANCE_READINESS.md', payload['document_refs'])
        self.assertIn('release_hygiene', payload)
        self.assertIn('performance_readiness', payload)
        self.assertIn('permission_surface_audit', payload)
        self.assertTrue(AuditLog.objects.filter(entity_type='GoLiveHandoff', action='EXPORT').exists())
