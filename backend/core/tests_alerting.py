import json
from io import StringIO
from unittest.mock import MagicMock, patch

from django.core import mail
from django.core.management import call_command
from django.test import TestCase, override_settings

from core.models import AuditLog


class AlertingCommandTests(TestCase):
    @override_settings(
        EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
        ALERT_EMAIL_RECIPIENTS=['it@example.com'],
    )
    def test_send_test_alert_command_delivers_email_and_records_audit(self):
        stdout = StringIO()
        call_command(
            'send_test_alert',
            channels=['email'],
            json=True,
            stdout=stdout,
        )
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['status_counts']['SUCCESS'], 1)
        self.assertEqual(len(mail.outbox), 1)
        audit = AuditLog.objects.filter(entity_type='AlertDelivery', entity_code='EMAIL').latest('id')
        self.assertEqual(audit.new_values['status'], 'SUCCESS')
        self.assertTrue(audit.new_values['is_test'])

    @override_settings(
        ALERT_SLACK_WEBHOOK_URL='https://hooks.slack.com/services/test',
        ALERT_TELEGRAM_BOT_TOKEN='bot-token',
        ALERT_TELEGRAM_CHAT_ID='12345',
    )
    @patch('core.alerting.urlopen')
    def test_send_test_alert_command_supports_slack_and_telegram(self, mock_urlopen):
        response = MagicMock()
        response.getcode.return_value = 200
        response.read.return_value = b'{}'
        mock_urlopen.return_value.__enter__.return_value = response

        stdout = StringIO()
        call_command(
            'send_test_alert',
            channels=['slack', 'telegram'],
            json=True,
            stdout=stdout,
        )
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['status_counts']['SUCCESS'], 2)
        self.assertEqual(mock_urlopen.call_count, 2)
        self.assertTrue(
            AuditLog.objects.filter(entity_type='AlertDelivery', entity_code='SLACK', new_values__status='SUCCESS').exists()
        )
        self.assertTrue(
            AuditLog.objects.filter(entity_type='AlertDelivery', entity_code='TELEGRAM', new_values__status='SUCCESS').exists()
        )

    @override_settings(
        APP_ENV='production',
        ALERT_REQUIRED_CHANNEL_COUNT=2,
        ALERT_REQUIRED_CHANNELS=['email', 'slack'],
        ALERT_EMAIL_RECIPIENTS=['it@example.com'],
        DEFAULT_FROM_EMAIL='ERP Carton <noreply@example.com>',
        SERVER_EMAIL='ERP Carton <server@example.com>',
        INCIDENT_RUNBOOK_URL='https://runbooks.example.com/erp',
        INCIDENT_CONTACT_EMAILS=['oncall@example.com'],
    )
    def test_alert_channel_readiness_reports_missing_required_channel(self):
        stdout = StringIO()
        call_command('alert_channel_readiness', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['config']['required_channel_count'], 2)
        self.assertIn('slack', payload['config']['missing_required_channels'])
        self.assertEqual(payload['overall_status'], 'warning')
