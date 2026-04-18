import json
from io import StringIO
from datetime import timedelta

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AuditLog, User


class AuditRetentionCommandTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff_user = User.objects.create_user(
            username='audit_staff',
            password='pass',
            email='audit_staff@example.com',
            is_staff=True,
        )
        self.client.force_authenticate(self.staff_user)

    @override_settings(AUDIT_LOG_RETENTION_DAYS=30)
    def test_purge_audit_logs_dry_run_reports_expired_and_records_audit(self):
        old_log = AuditLog.objects.create(
            user=self.staff_user,
            action='UPDATE',
            entity_type='Role',
            entity_id=1,
            entity_id_str='1',
            entity_code='ADMIN',
            changed_fields=['name'],
            old_values={'name': 'Admin'},
            new_values={'name': 'Admin 2'},
        )
        AuditLog.objects.filter(pk=old_log.pk).update(created_at=timezone.now() - timedelta(days=45))

        stdout = StringIO()
        call_command('purge_audit_logs', '--dry-run', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['mode'], 'dry_run')
        self.assertGreaterEqual(payload['expired_count'], 1)
        self.assertEqual(payload['deleted_count'], 0)
        self.assertTrue(AuditLog.objects.filter(entity_type='AuditRetention', action='DRY_RUN').exists())

    @override_settings(AUDIT_LOG_RETENTION_DAYS=30)
    def test_purge_audit_logs_confirm_deletes_expired_and_workspace_exposes_last_run(self):
        old_log = AuditLog.objects.create(
            user=self.staff_user,
            action='UPDATE',
            entity_type='Team',
            entity_id=2,
            entity_id_str='2',
            entity_code='OPS_TEAM',
            changed_fields=['name'],
            old_values={'name': 'Ops'},
            new_values={'name': 'Ops 2'},
        )
        AuditLog.objects.filter(pk=old_log.pk).update(created_at=timezone.now() - timedelta(days=60))

        stdout = StringIO()
        call_command('purge_audit_logs', '--confirm', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertGreaterEqual(payload['deleted_count'], 1)
        self.assertFalse(AuditLog.objects.filter(pk=old_log.pk).exists())

        response = self.client.get('/api/users/admin_audit_workspace/', {'hours': 96, 'limit': 20})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertIsNotNone(body['retention_policy']['last_run'])
        self.assertEqual(body['retention_policy']['last_run']['action'], 'PURGE')
