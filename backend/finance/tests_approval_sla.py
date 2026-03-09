from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Notification, User
from finance.models import AdvanceTransaction, CashAccount


class FinanceApprovalSlaTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='fin_sla_admin', password='pass', is_staff=True, is_active=True)
        self.client.force_authenticate(self.user)
        self.cash_account = CashAccount.objects.create(
            name='Quy SLA',
            account_type=CashAccount.TYPE_CASH,
            balance=Decimal('100000000'),
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )

    def test_approval_sla_overview_and_remind(self):
        row = AdvanceTransaction.objects.create(
            code='TA-SLA-01',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=timezone.localdate(),
            recipient_name='Nguoi SLA',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('2000000'),
            purpose='SLA test',
            status=AdvanceTransaction.STATUS_OPEN,
            approval_status=AdvanceTransaction.APPROVAL_PENDING_L1,
            required_approval_level=1,
            submitted_at=timezone.now() - timedelta(hours=12),
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        overview_resp = self.client.get('/api/finance/advance-transactions/approval_sla_overview/')
        self.assertEqual(overview_resp.status_code, 200)
        overview = overview_resp.json()
        self.assertGreaterEqual(int(overview.get('overdue_l1_count') or 0), 1)

        remind_resp = self.client.post('/api/finance/advance-transactions/remind_pending_approvals/', {}, format='json')
        self.assertEqual(remind_resp.status_code, 200)
        payload = remind_resp.json()
        self.assertTrue(payload.get('success'))
        self.assertGreaterEqual(int(payload.get('sent_count') or 0), 1)
        self.assertIn('escalated_count', payload)
        self.assertIn('top_blocked_submitters', overview)
        self.assertTrue(Notification.objects.filter(entity_type='FinanceAdvanceApprovalPending').exists())
        kpi_resp = self.client.get('/api/finance/advance-transactions/executive_kpi/')
        self.assertEqual(kpi_resp.status_code, 200)
        kpi_payload = kpi_resp.json()
        self.assertIn('risk_score', kpi_payload)
        self.assertIn('trend_6m', kpi_payload)
        self.assertIn('risk_contributors', kpi_payload)
        self.assertIn('recommendations', kpi_payload)
        self.assertIn('risk_trend', kpi_payload)
        self.assertIn('early_warning', kpi_payload)
        self.assertIn('priority_queue', kpi_payload)
        policy_resp = self.client.get('/api/finance/advance-transactions/executive_auto_policy/')
        self.assertEqual(policy_resp.status_code, 200)
        update_policy_resp = self.client.post(
            '/api/finance/advance-transactions/executive_auto_policy/',
            {
                'enabled': True,
                'cooldown_minutes': 5,
                'auto_run_finance_sla': True,
                'auto_run_workforce_sla': True,
                'only_when_early_warning': False,
            },
            format='json',
        )
        self.assertEqual(update_policy_resp.status_code, 200)
        execute_resp = self.client.post('/api/finance/advance-transactions/executive_auto_execute/', {}, format='json')
        self.assertEqual(execute_resp.status_code, 200)
        execute_payload = execute_resp.json()
        self.assertIn('success', execute_payload)
        self.assertIn('policy', execute_payload)
        history_resp = self.client.get('/api/finance/advance-transactions/executive_auto_history/?limit=5')
        self.assertEqual(history_resp.status_code, 200)
        history_payload = history_resp.json()
        self.assertGreaterEqual(int(history_payload.get('count') or 0), 1)
        self.assertIn('items', history_payload)
        governance_resp = self.client.get('/api/finance/advance-transactions/executive_auto_governance/?days=30&group_by=week')
        self.assertEqual(governance_resp.status_code, 200)
        governance_payload = governance_resp.json()
        self.assertIn('summary', governance_payload)
        self.assertIn('by_period', governance_payload)
        self.assertIn('skip_reasons', governance_payload)
        self.assertIn('action_effectiveness', governance_payload)
        governance_excel_resp = self.client.get('/api/finance/advance-transactions/executive_auto_governance/?days=30&group_by=day&export=excel')
        self.assertEqual(governance_excel_resp.status_code, 200)
        self.assertEqual(
            governance_excel_resp['Content-Type'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        row.refresh_from_db()
