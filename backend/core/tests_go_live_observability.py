import json
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AuditLog, Permission, Role, User


class GoLiveObservabilityApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff_user = User.objects.create_user(
            username='go_live_staff',
            password='pass',
            email='go_live_staff@example.com',
            is_staff=True,
        )
        self.client.force_authenticate(self.staff_user)

    def _create_workflow_admin_user(self):
        permission, _ = Permission.objects.get_or_create(
            resource='WORKFLOW',
            action='MANAGE',
            defaults={
                'code': 'WORKFLOW_MANAGE',
                'name': 'Manage workflow',
            },
        )
        role, _ = Role.objects.get_or_create(
            code='WORKFLOW_ADMIN',
            defaults={
                'name': 'Workflow Admin',
                'is_active': True,
            },
        )
        role.permissions.add(permission)
        user = User.objects.create_user(
            username='workflow_admin_role_user',
            password='pass',
            email='workflow_admin_role_user@example.com',
            is_staff=False,
            is_superuser=False,
        )
        user.roles.add(role)
        return user

    def test_admin_observability_workspace_includes_monitoring_payload(self):
        AuditLog.objects.create(
            user=self.staff_user,
            action='UPDATE',
            entity_type='MailDelivery',
            entity_id=1,
            entity_id_str='1',
            entity_code='recipient@example.com',
            changed_fields=['status'],
            old_values={},
            new_values={
                'status': 'FAILED',
                'message': 'SMTP timeout',
                'recipient_email': 'recipient@example.com',
            },
        )

        with TemporaryDirectory() as tmpdir:
            backup_dir = Path(tmpdir) / '20260321_230000'
            backup_dir.mkdir(parents=True, exist_ok=True)
            (backup_dir / 'database.sql').write_text('-- backup --', encoding='utf-8')
            (backup_dir / 'backup_info.txt').write_text('created', encoding='utf-8')
            (backup_dir / 'cloud_sync.json').write_text('{"status":"ok","mode":"sync"}', encoding='utf-8')

            with override_settings(
                BACKUP_ROOT=Path(tmpdir),
                BACKUP_STALE_HOURS=72,
                BACKUP_CLOUD_SYNC_ENABLED=True,
                BACKUP_CLOUD_PROVIDER='rclone',
                BACKUP_RCLONE_DESTINATION='gdrive:erp-carton-backups',
                ALERT_EMAIL_RECIPIENTS=['it@example.com'],
                ALERT_SLACK_WEBHOOK_URL='https://hooks.slack.com/services/test',
                INCIDENT_RUNBOOK_URL='https://runbooks.example.com/erp',
                INCIDENT_CONTACT_EMAILS=['oncall@example.com'],
                DB_SLOW_QUERY_THRESHOLD_MS=2200,
            ):
                response = self.client.get('/api/users/admin_observability_workspace/')

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        monitoring = body['monitoring']
        self.assertEqual(monitoring['backup']['status'], 'ok')
        self.assertTrue(monitoring['backup']['latest_backup']['has_database_dump'])
        self.assertEqual(monitoring['backup']['cloud_sync_status'], 'ok')
        self.assertEqual(monitoring['email_delivery']['status_counts']['FAILED'], 1)
        self.assertGreaterEqual(monitoring['alert_channels']['configured_count'], 2)
        self.assertIn('alert_delivery', monitoring)
        self.assertEqual(monitoring['database']['slow_query_threshold_ms'], 2200)
        self.assertEqual(monitoring['incident_response']['runbook_url'], 'https://runbooks.example.com/erp')
        self.assertIn('release_hygiene', monitoring)
        self.assertIn('performance', monitoring)
        self.assertIn('alert_readiness', monitoring)

    def test_admin_observability_workspace_handles_access_exception_activity_with_null_approver(self):
        AuditLog.objects.create(
            user=self.staff_user,
            action='UPDATE',
            entity_type='UserAccessExceptionApproverAvailability',
            entity_id=11,
            entity_id_str='11',
            entity_code='approver-null',
            changed_fields=['backup_user_id'],
            old_values={'approver': None},
            new_values={
                'approver': None,
                'backup_user_id': 7,
                'label': 'Coverage refresh',
            },
        )

        response = self.client.get('/api/users/admin_observability_workspace/')

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(any(
            item.get('kind') == 'availability'
            for item in body['access_exception']['recent_activity']
        ))

    @override_settings(
        AUDIT_LOG_RETENTION_DAYS=30,
        AUDIT_EXPORT_MAX_ROWS=50,
        INCIDENT_RUNBOOK_URL='https://runbooks.example.com/erp',
        INCIDENT_CONTACT_EMAILS=['audit@example.com'],
    )
    def test_admin_audit_workspace_includes_retention_export_and_incident_metadata(self):
        old_log = AuditLog.objects.create(
            user=self.staff_user,
            action='UPDATE',
            entity_type='UserProvisioning',
            entity_id=10,
            entity_id_str='10',
            entity_code='uat_user',
            changed_fields=['roles'],
            old_values={},
            new_values={'roles': ['OPS_MANAGER']},
        )
        AuditLog.objects.filter(pk=old_log.pk).update(created_at=timezone.now() - timedelta(days=45))

        response = self.client.get('/api/users/admin_audit_workspace/', {'hours': 96, 'limit': 20})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertEqual(body['retention_policy']['retention_days'], 30)
        self.assertGreaterEqual(body['retention_policy']['expired_events'], 1)
        self.assertIn('csv', body['export_options']['formats'])
        self.assertEqual(body['export_options']['max_rows'], 50)
        self.assertEqual(body['incident_response']['runbook_url'], 'https://runbooks.example.com/erp')
        self.assertEqual(body['incident_response']['contacts'], ['audit@example.com'])

    def test_admin_audit_export_supports_json_and_csv_and_records_export_log(self):
        AuditLog.objects.create(
            user=self.staff_user,
            action='RUN',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['status'],
            old_values={'status': 'SUCCESS'},
            new_values={'status': 'FAILED', 'message': 'Worker timeout'},
        )

        json_response = self.client.get('/api/users/admin_audit_export/', {'export_format': 'json', 'hours': 48, 'limit': 10})
        self.assertEqual(json_response.status_code, 200, json_response.content)
        self.assertIn('application/json', json_response['Content-Type'])
        json_payload = json.loads(json_response.content)
        self.assertGreaterEqual(json_payload['count'], 1)

        csv_response = self.client.get('/api/users/admin_audit_export/', {'export_format': 'csv', 'hours': 48, 'limit': 10})
        self.assertEqual(csv_response.status_code, 200, csv_response.content)
        self.assertIn('text/csv', csv_response['Content-Type'])
        self.assertIn('timestamp,domain,severity,action', csv_response.content.decode('utf-8'))
        self.assertTrue(AuditLog.objects.filter(entity_type='AdminAuditExport', action='EXPORT').exists())

    @override_settings(
        EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
        ALERT_EMAIL_RECIPIENTS=['it@example.com'],
    )
    def test_admin_observability_alert_drill_delivers_and_records_audit(self):
        response = self.client.post('/api/users/admin_observability_alert_drill/', {
            'title': 'Go-live drill',
            'message': 'Check alert bridge',
            'channels': ['email'],
            'severity': 'warning',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertEqual(body['status_counts']['SUCCESS'], 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertTrue(AuditLog.objects.filter(entity_type='AlertDelivery', entity_code='EMAIL').exists())

    @override_settings(
        EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
        ALERT_EMAIL_RECIPIENTS=['it@example.com'],
    )
    def test_role_based_workflow_manager_can_run_observability_operational_actions(self):
        role_user = self._create_workflow_admin_user()
        self.client.force_authenticate(role_user)

        workspace_response = self.client.get('/api/users/admin_observability_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()
        self.assertTrue(workspace_body['capabilities']['can_manage_workflow'])

        alert_drill_response = self.client.post('/api/users/admin_observability_alert_drill/', {
            'title': 'Role drill',
            'message': 'Check role-based observability access',
            'channels': ['email'],
            'severity': 'warning',
        }, format='json')
        self.assertEqual(alert_drill_response.status_code, 200, alert_drill_response.content)

        handoff_response = self.client.get('/api/users/admin_observability_go_live_handoff/', {'environment': 'staging'})
        self.assertEqual(handoff_response.status_code, 200, handoff_response.content)
        self.assertEqual(handoff_response.json()['environment'], 'staging')

    def test_admin_observability_go_live_handoff_returns_bundle(self):
        response = self.client.get('/api/users/admin_observability_go_live_handoff/', {'environment': 'staging'})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertEqual(body['environment'], 'staging')
        self.assertIn('release_hygiene', body)
        self.assertIn('performance_readiness', body)
        self.assertEqual(body['document_refs'], ['AGENTS.md'])

    def test_admin_observability_alert_readiness_returns_bundle(self):
        response = self.client.get('/api/users/admin_observability_alert_readiness/', {'hours': 24})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertIn('config', body)
        self.assertIn('delivery', body)
        self.assertIn('overall_status', body)

    def test_admin_observability_release_cleanup_preview_returns_payload(self):
        response = self.client.get('/api/users/admin_observability_release_cleanup_preview/')
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertIn('artifact_count', body)
        self.assertIn(body['status'], {'ok', 'warning'})

    def test_admin_observability_release_lockfile_returns_bundle(self):
        response = self.client.get('/api/users/admin_observability_release_lockfile/', {'environment': 'staging'})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertEqual(body['environment'], 'staging')
        self.assertIn('permission_surface_audit', body)
        self.assertEqual(body['document_refs'], ['AGENTS.md'])

    def test_admin_observability_performance_drilldown_returns_payload(self):
        response = self.client.get('/api/users/admin_observability_performance_drilldown/')
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertIn('surfaces', body)
        self.assertIn('status', body)

    def test_admin_audit_retention_preview_returns_dry_run_payload(self):
        response = self.client.get('/api/users/admin_audit_retention_preview/', {'days': 30})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertEqual(body['mode'], 'dry_run')
        self.assertEqual(body['retention_days'], 30)
        self.assertIn(body['status'], {'ok', 'warning'})
