from django.test import TestCase
from django.utils import timezone as django_timezone
from rest_framework.test import APIClient

from core.models import AuditLog, Permission, Role, User, WorkflowPipelineEvent


class OperationsLogApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='ops_user', password='pass')
        self.other = User.objects.create_user(username='ops_other', password='pass')
        perm, _ = Permission.objects.update_or_create(
            resource='CORE',
            action='VIEW_OPERATIONS_LOG',
            defaults={
                'code': 'CORE_VIEW_OPERATIONS_LOG',
                'name': 'View operations log',
            },
        )
        role = Role.objects.create(code='OPS_VIEWER', name='Ops Viewer')
        role.permissions.add(perm)
        self.user.roles.add(role)
        self.client.force_authenticate(user=self.user)

    def test_operations_log_returns_combined_items(self):
        AuditLog.objects.create(
            user=self.user,
            action='UPDATE',
            entity_type='TaskBulk',
            entity_id=0,
            entity_code='TASK_BULK',
            changed_fields=['bulk_action'],
            old_values={},
            new_values={
                'action': 'COMPLETE',
                'success_count': 2,
                'failed_count': 0,
                'processed_count': 2,
                'total_requested': 2,
            },
        )
        WorkflowPipelineEvent.objects.create(
            entity_type='SalesOrder',
            entity_id=10,
            entity_code='SO-10',
            trigger='SUBMIT',
            action='ADVANCE',
            from_step='B1',
            to_step='B2',
            note='Move next',
            actor=self.user,
        )

        res = self.client.get('/api/activity/operations_log/', {'limit': 50})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreaterEqual(data.get('total', 0), 2)
        sources = {item['source'] for item in data.get('items', [])}
        self.assertIn('TASK_BULK', sources)
        self.assertIn('PIPELINE_EVENT', sources)

    def test_operations_live_updates_detects_changes_since(self):
        checkpoint = django_timezone.now().isoformat()
        AuditLog.objects.create(
            user=self.user,
            action='UPDATE',
            entity_type='WorkflowAnalytics',
            entity_id=1,
            entity_code='ANL-1',
            changed_fields=['execute_insight'],
            old_values={},
            new_values={
                'insight_type': 'WIP_OVERLOAD',
                'suggested_action': 'RUN_AUTOMATION',
                'success': True,
                'message': 'ok',
            },
        )
        res = self.client.get('/api/activity/operations_live_updates/', {'since': checkpoint})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get('has_changes'))
        self.assertGreaterEqual(int(data.get('changed_count') or 0), 1)

    def test_operations_log_meta_returns_dynamic_filters(self):
        AuditLog.objects.create(
            user=self.user,
            action='UPDATE',
            entity_type='TaskBulk',
            entity_id=0,
            entity_code='TASK_BULK',
            changed_fields=['bulk_action'],
            old_values={},
            new_values={'action': 'COMPLETE', 'success_count': 1, 'failed_count': 1},
        )
        res = self.client.get('/api/activity/operations_log_meta/')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        action_values = {item['value'] for item in body.get('actions', [])}
        source_values = {item['value'] for item in body.get('sources', [])}
        self.assertIn('COMPLETE', action_values)
        self.assertIn('TASK_BULK', source_values)
