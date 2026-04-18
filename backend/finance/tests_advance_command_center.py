from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AuditLog, Notification, User
from finance.models import AdvanceTransaction, CashAccount


class FinanceAdvanceCommandCenterTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.maker = User.objects.create_user(username='fin_cmd_maker', password='pass', is_staff=True, is_active=True)
        self.approver_l1 = User.objects.create_user(username='fin_cmd_l1', password='pass', is_staff=True, is_active=True)
        self.approver_l2 = User.objects.create_superuser(
            username='fin_cmd_l2',
            password='pass',
            email='fin_cmd_l2@example.com',
        )
        self.normal = User.objects.create_user(username='fin_cmd_normal', password='pass', is_staff=False, is_active=True)
        self.client.force_authenticate(self.maker)
        self.cash_account = CashAccount.objects.create(
            name='Quy command center',
            account_type=CashAccount.TYPE_CASH,
            balance=Decimal('80000000'),
            is_active=True,
            created_by=self.maker,
            updated_by=self.maker,
        )

    def _create_pending_advance(
        self,
        code: str,
        approval_status: str,
        *,
        required_level: int,
        submitted_hours_ago: int,
        amount: str = '2500000',
    ) -> AdvanceTransaction:
        return AdvanceTransaction.objects.create(
            code=code,
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=date.today() - timedelta(days=2),
            recipient_name='Nguoi command center',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal(amount),
            purpose='Advance command center',
            status=AdvanceTransaction.STATUS_OPEN,
            approval_status=approval_status,
            required_approval_level=required_level,
            submitted_at=timezone.now() - timedelta(hours=submitted_hours_ago),
            submitted_by=self.maker,
            is_active=True,
            created_by=self.maker,
            updated_by=self.maker,
        )

    def test_approval_queue_hides_l2_items_for_non_l2_viewer(self):
        l1_row = self._create_pending_advance(
            'TA-CMD-L1',
            AdvanceTransaction.APPROVAL_PENDING_L1,
            required_level=1,
            submitted_hours_ago=12,
        )
        l2_row = self._create_pending_advance(
            'TA-CMD-L2',
            AdvanceTransaction.APPROVAL_PENDING_L2,
            required_level=2,
            submitted_hours_ago=18,
        )

        maker_resp = self.client.get('/api/finance/advance-transactions/approval_queue/')
        self.assertEqual(maker_resp.status_code, 200)
        maker_payload = maker_resp.json()
        self.assertEqual(int(maker_payload.get('pending_l1_count') or 0), 1)
        self.assertEqual(int(maker_payload.get('pending_l2_count') or 0), 0)
        maker_codes = {item['code'] for item in maker_payload.get('items', [])}
        self.assertIn(l1_row.code, maker_codes)
        self.assertNotIn(l2_row.code, maker_codes)

        self.client.force_authenticate(self.approver_l2)
        l2_resp = self.client.get('/api/finance/advance-transactions/approval_queue/')
        self.assertEqual(l2_resp.status_code, 200)
        l2_payload = l2_resp.json()
        self.assertEqual(int(l2_payload.get('pending_l1_count') or 0), 1)
        self.assertEqual(int(l2_payload.get('pending_l2_count') or 0), 1)
        l2_codes = {item['code'] for item in l2_payload.get('items', [])}
        self.assertIn(l1_row.code, l2_codes)
        self.assertIn(l2_row.code, l2_codes)

    def test_approval_sla_policy_roundtrip_and_audit_log_include_escalation_fields(self):
        get_resp = self.client.get('/api/finance/advance-transactions/approval_sla_policy/')
        self.assertEqual(get_resp.status_code, 200)
        get_payload = get_resp.json()
        self.assertIn('escalation_hours_l1', get_payload)
        self.assertIn('escalation_hours_l2', get_payload)
        self.assertIn('escalation_cooldown_hours', get_payload)

        post_resp = self.client.post(
            '/api/finance/advance-transactions/approval_sla_policy/',
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
        post_payload = post_resp.json()
        self.assertTrue(post_payload.get('success'))
        policy = post_payload.get('policy') or {}
        self.assertEqual(int(policy.get('escalation_hours_l1') or 0), 9)
        self.assertEqual(int(policy.get('escalation_hours_l2') or 0), 11)
        self.assertEqual(int(policy.get('escalation_cooldown_hours') or 0), 6)

        audit = AuditLog.objects.filter(entity_type='FinanceAdvanceApprovalSlaPolicy').order_by('-id').first()
        self.assertIsNotNone(audit)
        changed_fields = set(audit.changed_fields or [])
        self.assertIn('escalation_hours_l1', changed_fields)
        self.assertIn('escalation_hours_l2', changed_fields)
        self.assertIn('escalation_cooldown_hours', changed_fields)

    def test_remind_pending_approvals_supports_dry_run_and_history_endpoint(self):
        self.client.post(
            '/api/finance/advance-transactions/approval_sla_policy/',
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
        self._create_pending_advance(
            'TA-CMD-HIS-L1',
            AdvanceTransaction.APPROVAL_PENDING_L1,
            required_level=1,
            submitted_hours_ago=8,
        )
        self._create_pending_advance(
            'TA-CMD-HIS-L2',
            AdvanceTransaction.APPROVAL_PENDING_L2,
            required_level=2,
            submitted_hours_ago=10,
        )

        dry_run_resp = self.client.post(
            '/api/finance/advance-transactions/remind_pending_approvals/',
            {'dry_run': True},
            format='json',
        )
        self.assertEqual(dry_run_resp.status_code, 200)
        dry_run_payload = dry_run_resp.json()
        self.assertTrue(dry_run_payload.get('success'))
        self.assertTrue(dry_run_payload.get('dry_run'))
        self.assertGreaterEqual(int(dry_run_payload.get('sent_count') or 0), 2)
        self.assertEqual(Notification.objects.filter(entity_type='FinanceAdvanceApprovalPending').count(), 0)

        run_resp = self.client.post('/api/finance/advance-transactions/remind_pending_approvals/', {}, format='json')
        self.assertEqual(run_resp.status_code, 200)
        run_payload = run_resp.json()
        self.assertTrue(run_payload.get('success'))
        self.assertFalse(run_payload.get('dry_run'))
        self.assertGreaterEqual(int(run_payload.get('sent_count') or 0), 2)
        self.assertGreaterEqual(Notification.objects.filter(entity_type='FinanceAdvanceApprovalPending').count(), 2)

        history_resp = self.client.get('/api/finance/advance-transactions/approval_sla_reminder_history/', {'days': 30})
        self.assertEqual(history_resp.status_code, 200)
        history_payload = history_resp.json()
        self.assertEqual(int(history_payload.get('days') or 0), 30)
        self.assertIn('summary', history_payload)
        self.assertGreaterEqual(int(history_payload.get('summary', {}).get('total_sent') or 0), 2)
        by_level = {int(item['level_key']): item for item in history_payload.get('items', [])}
        self.assertIn(1, by_level)
        self.assertIn(2, by_level)
        self.assertIn(99, by_level)
        self.assertGreaterEqual(int(by_level[99].get('sent_count') or 0), 1)

    def test_advance_command_center_endpoints_require_finance_manage_access(self):
        self.client.force_authenticate(self.normal)

        queue_resp = self.client.get('/api/finance/advance-transactions/approval_queue/')
        self.assertEqual(queue_resp.status_code, 403)

        history_resp = self.client.get('/api/finance/advance-transactions/approval_sla_reminder_history/')
        self.assertEqual(history_resp.status_code, 403)

        policy_resp = self.client.post(
            '/api/finance/advance-transactions/approval_sla_policy/',
            {'sla_hours_l1': 2},
            format='json',
        )
        self.assertEqual(policy_resp.status_code, 403)
