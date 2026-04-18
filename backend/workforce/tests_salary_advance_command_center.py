from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AuditLog, Notification, User
from workforce.models import Employee, SalaryAdvanceRecord


class SalaryAdvanceCommandCenterTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.manager = User.objects.create_user(username='wf_cmd_manager', password='pass', is_staff=True, is_active=True)
        self.l2 = User.objects.create_superuser(
            username='wf_cmd_l2',
            password='pass',
            email='wf_cmd_l2@example.com',
        )
        self.normal = User.objects.create_user(username='wf_cmd_normal', password='pass', is_staff=False, is_active=True)
        self.employee = Employee.objects.create(
            code='WF-CMD-01',
            name='Nhan vien command center',
            salary_basic=Decimal('12000000'),
            created_by=self.manager,
            updated_by=self.manager,
        )
        self.client.force_authenticate(self.manager)

    def _create_pending_row(
        self,
        approval_status: str,
        *,
        required_level: int,
        submitted_hours_ago: int,
        amount: str = '2500000',
        month: str = '2026-04',
    ) -> SalaryAdvanceRecord:
        return SalaryAdvanceRecord.objects.create(
            employee=self.employee,
            advance_date=date(2026, 4, 10),
            month=month,
            amount=Decimal(amount),
            reason='Ung luong command center',
            approved_by_name='',
            note='',
            status=SalaryAdvanceRecord.STATUS_UNDEDUCTED,
            approval_status=approval_status,
            required_approval_level=required_level,
            submitted_at=timezone.now() - timedelta(hours=submitted_hours_ago),
            submitted_by=self.manager,
            is_active=True,
            created_by=self.manager,
            updated_by=self.manager,
        )

    def test_approval_queue_hides_l2_items_for_non_l2_viewer(self):
        l1_row = self._create_pending_row(
            SalaryAdvanceRecord.APPROVAL_PENDING_L1,
            required_level=1,
            submitted_hours_ago=8,
        )
        l2_row = self._create_pending_row(
            SalaryAdvanceRecord.APPROVAL_PENDING_L2,
            required_level=2,
            submitted_hours_ago=9,
            amount='5000000',
        )

        manager_resp = self.client.get('/api/workforce/salary-advances/approval_queue/')
        self.assertEqual(manager_resp.status_code, 200)
        manager_payload = manager_resp.json()
        manager_ids = {int(item['id']) for item in manager_payload.get('items', [])}
        self.assertIn(int(l1_row.id), manager_ids)
        self.assertNotIn(int(l2_row.id), manager_ids)
        self.assertEqual(int(manager_payload.get('pending_l2_count') or 0), 0)

        self.client.force_authenticate(self.l2)
        l2_resp = self.client.get('/api/workforce/salary-advances/approval_queue/')
        self.assertEqual(l2_resp.status_code, 200)
        l2_payload = l2_resp.json()
        l2_ids = {int(item['id']) for item in l2_payload.get('items', [])}
        self.assertIn(int(l1_row.id), l2_ids)
        self.assertIn(int(l2_row.id), l2_ids)
        self.assertEqual(int(l2_payload.get('pending_l2_count') or 0), 1)

    def test_approval_sla_policy_roundtrip_and_audit_include_escalation_fields(self):
        get_resp = self.client.get('/api/workforce/salary-advances/approval_sla_policy/')
        self.assertEqual(get_resp.status_code, 200)
        get_payload = get_resp.json()
        self.assertIn('escalation_hours_l1', get_payload)
        self.assertIn('escalation_hours_l2', get_payload)
        self.assertIn('escalation_cooldown_hours', get_payload)

        post_resp = self.client.post(
            '/api/workforce/salary-advances/approval_sla_policy/',
            {
                'sla_hours_l1': 3,
                'sla_hours_l2': 5,
                'remind_every_hours': 2,
                'escalation_hours_l1': 9,
                'escalation_hours_l2': 11,
                'escalation_cooldown_hours': 6,
                'window_days': 45,
            },
            format='json',
        )
        self.assertEqual(post_resp.status_code, 200)
        payload = post_resp.json()
        self.assertTrue(payload.get('success'))
        policy = payload.get('policy') or {}
        self.assertEqual(int(policy.get('escalation_hours_l1') or 0), 9)
        self.assertEqual(int(policy.get('escalation_hours_l2') or 0), 11)
        self.assertEqual(int(policy.get('escalation_cooldown_hours') or 0), 6)

        audit = AuditLog.objects.filter(entity_type='WorkforceSalaryAdvanceApprovalSlaPolicy').order_by('-id').first()
        self.assertIsNotNone(audit)
        changed_fields = set(audit.changed_fields or [])
        self.assertIn('escalation_hours_l1', changed_fields)
        self.assertIn('escalation_hours_l2', changed_fields)
        self.assertIn('escalation_cooldown_hours', changed_fields)

    def test_remind_pending_approvals_supports_dry_run_and_history(self):
        self.client.post(
            '/api/workforce/salary-advances/approval_sla_policy/',
            {
                'sla_hours_l1': 1,
                'sla_hours_l2': 1,
                'remind_every_hours': 1,
                'escalation_hours_l1': 2,
                'escalation_hours_l2': 2,
                'escalation_cooldown_hours': 1,
                'window_days': 30,
            },
            format='json',
        )
        self._create_pending_row(
            SalaryAdvanceRecord.APPROVAL_PENDING_L1,
            required_level=1,
            submitted_hours_ago=8,
        )
        self._create_pending_row(
            SalaryAdvanceRecord.APPROVAL_PENDING_L2,
            required_level=2,
            submitted_hours_ago=10,
            amount='6000000',
        )

        dry_run_resp = self.client.post(
            '/api/workforce/salary-advances/remind_pending_approvals/',
            {'dry_run': True},
            format='json',
        )
        self.assertEqual(dry_run_resp.status_code, 200)
        dry_run_payload = dry_run_resp.json()
        self.assertTrue(dry_run_payload.get('success'))
        self.assertTrue(dry_run_payload.get('dry_run'))
        self.assertGreaterEqual(int(dry_run_payload.get('sent_count') or 0), 2)
        self.assertEqual(Notification.objects.filter(entity_type='WorkforceSalaryAdvanceApprovalPending').count(), 0)

        run_resp = self.client.post('/api/workforce/salary-advances/remind_pending_approvals/', {}, format='json')
        self.assertEqual(run_resp.status_code, 200)
        run_payload = run_resp.json()
        self.assertTrue(run_payload.get('success'))
        self.assertFalse(run_payload.get('dry_run'))
        self.assertGreaterEqual(int(run_payload.get('sent_count') or 0), 2)
        self.assertGreaterEqual(Notification.objects.filter(entity_type='WorkforceSalaryAdvanceApprovalPending').count(), 2)

        history_resp = self.client.get('/api/workforce/salary-advances/approval_sla_reminder_history/', {'days': 30})
        self.assertEqual(history_resp.status_code, 200)
        history_payload = history_resp.json()
        self.assertEqual(int(history_payload.get('days') or 0), 30)
        self.assertIn('summary', history_payload)
        self.assertGreaterEqual(int(history_payload.get('summary', {}).get('total_sent') or 0), 2)
        by_level = {int(item['level_key']): item for item in history_payload.get('items', [])}
        self.assertIn(1, by_level)
        self.assertIn(2, by_level)
        self.assertIn(99, by_level)

    def test_command_center_endpoints_require_manage_workforce_permission(self):
        self.client.force_authenticate(self.normal)

        queue_resp = self.client.get('/api/workforce/salary-advances/approval_queue/')
        self.assertEqual(queue_resp.status_code, 403)

        history_resp = self.client.get('/api/workforce/salary-advances/approval_sla_reminder_history/')
        self.assertEqual(history_resp.status_code, 403)

        policy_resp = self.client.post(
            '/api/workforce/salary-advances/approval_sla_policy/',
            {'sla_hours_l1': 2},
            format='json',
        )
        self.assertEqual(policy_resp.status_code, 403)
