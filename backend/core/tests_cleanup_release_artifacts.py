import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings

from core.models import AuditLog


class CleanupReleaseArtifactsCommandTests(TestCase):
    @patch('core.management.commands.cleanup_release_artifacts.get_release_hygiene_payload')
    def test_cleanup_release_artifacts_supports_dry_run_and_confirm(self, mock_hygiene):
        with TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            backend_dir = repo_root / 'backend'
            backend_dir.mkdir(parents=True, exist_ok=True)
            log_file = repo_root / 'backend-dev.log'
            handoff_file = repo_root / 'docs' / 'GO_LIVE_HANDOFF_LATEST.json'
            handoff_file.parent.mkdir(parents=True, exist_ok=True)
            log_file.write_text('dev log', encoding='utf-8')
            handoff_file.write_text('{}', encoding='utf-8')

            mock_hygiene.return_value = {
                'artifact_candidates': [
                    'backend-dev.log',
                    'docs/GO_LIVE_HANDOFF_LATEST.json',
                ],
            }

            with override_settings(BASE_DIR=backend_dir):
                stdout = StringIO()
                call_command('cleanup_release_artifacts', '--json', stdout=stdout)
                dry_run_payload = json.loads(stdout.getvalue())

                self.assertEqual(dry_run_payload['mode'], 'dry_run')
                self.assertEqual(dry_run_payload['existing_count'], 2)
                self.assertEqual(dry_run_payload['removed_count'], 0)
                self.assertTrue(log_file.exists())
                self.assertTrue(handoff_file.exists())

                stdout = StringIO()
                call_command('cleanup_release_artifacts', '--confirm', '--json', stdout=stdout)
                apply_payload = json.loads(stdout.getvalue())

            self.assertEqual(apply_payload['mode'], 'apply')
            self.assertEqual(apply_payload['removed_count'], 2)
            self.assertEqual(apply_payload['remaining_count'], 0)
            self.assertFalse(log_file.exists())
            self.assertFalse(handoff_file.exists())
            self.assertTrue(AuditLog.objects.filter(entity_type='ReleaseArtifactCleanup').exists())
