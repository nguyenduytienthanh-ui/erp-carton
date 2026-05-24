import json
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings


class PreflightCommandTest(TestCase):
    def test_preflight_command_runs_and_reports_status(self):
        stdout = StringIO()
        call_command('preflight_check', stdout=stdout)
        output = stdout.getvalue()
        self.assertIn('Preflight status:', output)
        self.assertIn('database:', output)
        self.assertIn('jwt_sessions:', output)
        self.assertIn('email:', output)
        self.assertIn('audit_controls:', output)

    def test_preflight_command_supports_json_output(self):
        stdout = StringIO()
        call_command('preflight_check', '--json', stdout=stdout)
        output = stdout.getvalue()
        self.assertIn('"overall_status"', output)
        self.assertIn('"database"', output)
        self.assertIn('"jwt_sessions"', output)
        self.assertIn('"audit_controls"', output)

    @patch('core.management.commands.preflight_check.shutil.which')
    @override_settings(
        APP_ENV='production',
        DEPLOYMENT_MODE='hybrid',
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
        BACKUP_CLOUD_SYNC_ENABLED=True,
        BACKUP_CLOUD_PROVIDER='rclone',
        BACKUP_RCLONE_DESTINATION='gdrive:erp-carton-backups',
        TUNNEL_PROVIDER='cloudflared',
        CLOUDFLARED_TUNNEL_ID='cf-tunnel-id',
        CLOUDFLARED_CONFIG_PATH='/etc/cloudflared/erp-carton.yml',
        ALERT_EMAIL_RECIPIENTS=['ops@example.com'],
        INCIDENT_RUNBOOK_URL='https://runbooks.example.com/erp-carton',
        INCIDENT_CONTACT_EMAILS=['ops@example.com'],
    )
    def test_preflight_reports_hybrid_deploy_as_ok_when_env_is_complete(self, mock_which):
        mock_which.side_effect = lambda tool: f'/usr/bin/{tool}'
        stdout = StringIO()
        call_command('preflight_check', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertIn('hybrid_deploy', payload['checks'])
        self.assertEqual(payload['checks']['hybrid_deploy']['status'], 'ok')
        self.assertEqual(payload['checks']['backup_tools']['status'], 'ok')

    @patch('core.management.commands.preflight_check.shutil.which')
    @override_settings(
        APP_ENV='production',
        DEPLOYMENT_MODE='hybrid',
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
        BACKUP_CLOUD_SYNC_ENABLED=True,
        BACKUP_CLOUD_PROVIDER='rclone',
        BACKUP_RCLONE_DESTINATION='gdrive:erp-carton-backups',
        TUNNEL_PROVIDER='cloudflared',
        CLOUDFLARED_TUNNEL_ID='cf-tunnel-id',
        CLOUDFLARED_CONFIG_PATH='/etc/cloudflared/erp-carton.yml',
        ALERT_EMAIL_RECIPIENTS=['ops@example.com'],
        INCIDENT_RUNBOOK_URL='https://runbooks.example.com/erp-carton',
        INCIDENT_CONTACT_EMAILS=['ops@example.com'],
    )
    def test_preflight_accepts_api_public_url_without_version_suffix(self, mock_which):
        mock_which.side_effect = lambda tool: f'/usr/bin/{tool}'
        stdout = StringIO()
        call_command('preflight_check', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertIn('hybrid_deploy', payload['checks'])
        self.assertEqual(payload['checks']['hybrid_deploy']['status'], 'ok')
