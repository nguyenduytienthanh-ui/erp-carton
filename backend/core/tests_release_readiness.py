import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command
from django.test import TestCase, override_settings

from core.models import AuditLog


class ReleaseReadinessCommandTests(TestCase):
    def test_release_readiness_supports_json_output(self):
        stdout = StringIO()
        call_command('release_readiness', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertIn('overall_status', payload)
        self.assertIn('preflight', payload)
        self.assertIn('migrations', payload)
        self.assertIn('data_snapshot', payload)
        self.assertIn('backups', payload)
        self.assertIn('alerts', payload)
        self.assertIn('alert_delivery', payload)
        self.assertIn('uat_personas', payload)
        self.assertIn('release_hygiene', payload)
        self.assertIn('performance', payload)
        self.assertIn('performance_drilldown', payload)

    def test_release_readiness_reports_backup_and_alert_context(self):
        with TemporaryDirectory() as tmpdir:
            backup_dir = Path(tmpdir) / '20260321_230000'
            backup_dir.mkdir(parents=True, exist_ok=True)
            (backup_dir / 'database.sql').write_text('-- backup --', encoding='utf-8')
            (backup_dir / 'backup_info.txt').write_text('created', encoding='utf-8')
            (backup_dir / 'backup_manifest.json').write_text('{"status":"ok"}', encoding='utf-8')
            (backup_dir / 'restore_dry_run.json').write_text('{"status":"ok"}', encoding='utf-8')
            AuditLog.objects.create(
                user=None,
                action='DELIVER',
                entity_type='AlertDelivery',
                entity_id=0,
                entity_id_str='email',
                entity_code='EMAIL',
                changed_fields=['status'],
                old_values={},
                new_values={'channel': 'email', 'status': 'SUCCESS', 'is_test': True, 'title': 'test', 'message': 'ok'},
            )

            stdout = StringIO()
            with override_settings(
                BACKUP_ROOT=Path(tmpdir),
                BACKUP_STALE_HOURS=72,
                ALERT_EMAIL_RECIPIENTS=['it@example.com'],
                INCIDENT_RUNBOOK_URL='https://runbooks.example.com/erp',
            ):
                call_command('release_readiness', '--json', stdout=stdout)
            payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['backups']['status'], 'ok')
        self.assertEqual(payload['backups']['restore_drill_status'], 'ok')
        self.assertEqual(payload['backups']['backup_count'], 1)
        self.assertTrue(payload['backups']['latest_backup']['has_database_dump'])
        self.assertGreaterEqual(float(payload['backups']['latest_backup']['age_hours']), 0)
        self.assertGreaterEqual(payload['alerts']['configured_count'], 1)
        self.assertEqual(payload['alert_delivery']['status'], 'ok')
        self.assertGreaterEqual(payload['alert_delivery']['status_counts']['SUCCESS'], 1)
        self.assertIn(payload['release_hygiene']['status'], {'ok', 'warning'})
        self.assertIn(payload['performance']['status'], {'ok', 'warning'})
        self.assertIn(payload['performance_drilldown']['status'], {'ok', 'warning'})
        self.assertIn(payload['preflight']['checks']['audit_controls']['status'], {'ok', 'warning'})
