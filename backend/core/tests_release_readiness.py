import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

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
            (backup_dir / 'cloud_sync.json').write_text('{"status":"ok","mode":"sync"}', encoding='utf-8')
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
            with patch('core.management.commands.preflight_check.shutil.which') as mock_which:
                mock_which.side_effect = lambda tool: f'/usr/bin/{tool}'
                with override_settings(
                    APP_ENV='production',
                    DEPLOYMENT_MODE='hybrid',
                    BACKUP_ROOT=Path(tmpdir),
                    BACKUP_STALE_HOURS=72,
                    BACKUP_CLOUD_SYNC_ENABLED=True,
                    BACKUP_CLOUD_PROVIDER='rclone',
                    BACKUP_RCLONE_DESTINATION='gdrive:erp-carton-backups',
                    FRONTEND_URL='https://erp.example.com',
                    FRONTEND_PUBLIC_URL='https://erp.example.com',
                    API_PUBLIC_URL='https://api.example.com/api',
                    ALLOWED_HOSTS=['api.example.com', 'erp.example.com'],
                    CORS_ALLOWED_ORIGINS=['https://erp.example.com'],
                    CSRF_TRUSTED_ORIGINS=['https://erp.example.com'],
                    SESSION_COOKIE_SECURE=True,
                    CSRF_COOKIE_SECURE=True,
                    SECURE_HSTS_SECONDS=31_536_000,
                    SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO', 'https'),
                    TUNNEL_PROVIDER='cloudflared',
                    CLOUDFLARED_TUNNEL_ID='cf-tunnel-id',
                    CLOUDFLARED_CONFIG_PATH='/etc/cloudflared/erp-carton.yml',
                    ALERT_EMAIL_RECIPIENTS=['it@example.com'],
                    INCIDENT_RUNBOOK_URL='https://runbooks.example.com/erp',
                    INCIDENT_CONTACT_EMAILS=['it@example.com'],
                ):
                    call_command('release_readiness', '--json', stdout=stdout)
            payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['backups']['status'], 'ok')
        self.assertEqual(payload['backups']['restore_drill_status'], 'ok')
        self.assertEqual(payload['backups']['cloud_sync_status'], 'ok')
        self.assertEqual(payload['backups']['backup_count'], 1)
        self.assertTrue(payload['backups']['latest_backup']['has_database_dump'])
        self.assertGreaterEqual(float(payload['backups']['latest_backup']['age_hours']), 0)
        self.assertEqual(payload['preflight']['checks']['hybrid_deploy']['status'], 'ok')
        self.assertGreaterEqual(payload['alerts']['configured_count'], 1)
        self.assertEqual(payload['alert_delivery']['status'], 'ok')
        self.assertGreaterEqual(payload['alert_delivery']['status_counts']['SUCCESS'], 1)
        self.assertIn(payload['release_hygiene']['status'], {'ok', 'warning'})
        self.assertIn(payload['performance']['status'], {'ok', 'warning'})
        self.assertIn(payload['performance_drilldown']['status'], {'ok', 'warning'})
        self.assertIn(payload['preflight']['checks']['audit_controls']['status'], {'ok', 'warning'})

    @patch('core.management.commands.preflight_check.shutil.which')
    def test_release_readiness_recommends_postgres_tools_when_missing_from_path(self, mock_which):
        mock_which.return_value = None
        stdout = StringIO()
        with override_settings(
            BACKUP_CLOUD_SYNC_ENABLED=False,
            BACKUP_CLOUD_PROVIDER='',
            BACKUP_RCLONE_DESTINATION='',
            DEPLOYMENT_MODE='colocated',
            TUNNEL_PROVIDER='',
        ):
            call_command('release_readiness', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['preflight']['checks']['backup_tools']['status'], 'warning')
        self.assertTrue(
            any('PostgreSQL client tools' in item and 'Windows PATH' in item for item in payload['recommendations'])
        )
