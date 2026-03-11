from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from core.models import AuditLog, User
from finance.models import AdvanceTransaction, CashAccount, CashTransaction


class FinanceAdvanceApprovalWorkflowTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.maker = User.objects.create_user(username='finance_maker', password='pass', is_staff=True, is_active=True)
        self.approver_l1 = User.objects.create_user(username='finance_l1', password='pass', is_staff=True, is_active=True)
        self.approver_l2 = User.objects.create_superuser(username='finance_l2', password='pass', email='l2@example.com')
        self.client.force_authenticate(self.maker)
        self.cash_account = CashAccount.objects.create(
            name='Quy duyet',
            account_type=CashAccount.TYPE_CASH,
            balance=Decimal('100000000'),
            is_active=True,
            created_by=self.maker,
            updated_by=self.maker,
        )

    def _create_advance(self, code: str, amount: Decimal) -> AdvanceTransaction:
        return AdvanceTransaction.objects.create(
            code=code,
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=date.today(),
            recipient_name='Nguoi duyet',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=amount,
            purpose='Tam ung',
            status=AdvanceTransaction.STATUS_OPEN,
            is_active=True,
            created_by=self.maker,
            updated_by=self.maker,
        )

    def test_submit_and_approve_two_levels(self):
        adv = self._create_advance('TA-APP-001', Decimal('60000000'))
        submit_resp = self.client.post(f'/api/finance/advance-transactions/{adv.id}/submit_approval/', {}, format='json')
        self.assertEqual(submit_resp.status_code, 200)
        adv.refresh_from_db()
        self.assertEqual(adv.approval_status, AdvanceTransaction.APPROVAL_PENDING_L1)
        self.assertEqual(adv.required_approval_level, 2)

        self_l1_denied = self.client.post(f'/api/finance/advance-transactions/{adv.id}/approve_level1/', {}, format='json')
        self.assertEqual(self_l1_denied.status_code, 403, 'submitter không được tự duyệt L1')

        self.client.force_authenticate(self.approver_l1)
        l1_resp = self.client.post(f'/api/finance/advance-transactions/{adv.id}/approve_level1/', {}, format='json')
        self.assertEqual(l1_resp.status_code, 200)
        adv.refresh_from_db()
        self.assertEqual(adv.approval_status, AdvanceTransaction.APPROVAL_PENDING_L2)

        self.client.force_authenticate(self.maker)
        l2_denied = self.client.post(f'/api/finance/advance-transactions/{adv.id}/approve_level2/', {}, format='json')
        self.assertEqual(l2_denied.status_code, 403)

        self.client.force_authenticate(self.approver_l2)
        l2_ok = self.client.post(f'/api/finance/advance-transactions/{adv.id}/approve_level2/', {}, format='json')
        self.assertEqual(l2_ok.status_code, 200)
        adv.refresh_from_db()
        self.assertEqual(adv.approval_status, AdvanceTransaction.APPROVAL_APPROVED)

    def test_settlement_requires_approved_advance(self):
        adv = self._create_advance('TA-APP-002', Decimal('2000000'))
        payload = {
            'advance_transaction': adv.id,
            'settlement_date': date.today().isoformat(),
            'spent_amount': '1000000',
            'refund_amount': '0',
            'note': 'Test settlement',
        }
        denied_resp = self.client.post('/api/finance/advance-settlements/', payload, format='json')
        self.assertEqual(denied_resp.status_code, 400)

        self.client.post(f'/api/finance/advance-transactions/{adv.id}/submit_approval/', {}, format='json')
        self.client.force_authenticate(self.approver_l1)
        self.client.post(f'/api/finance/advance-transactions/{adv.id}/approve_level1/', {}, format='json')
        not_disbursed_resp = self.client.post('/api/finance/advance-settlements/', payload, format='json')
        self.assertEqual(not_disbursed_resp.status_code, 400)

        self.client.force_authenticate(self.maker)
        self.client.post(f'/api/finance/advance-transactions/{adv.id}/post_disbursement/', {}, format='json')
        ok_resp = self.client.post('/api/finance/advance-settlements/', payload, format='json')
        self.assertEqual(ok_resp.status_code, 201)

    def test_settlement_date_cannot_be_before_advance_date(self):
        adv = self._create_advance('TA-APP-006', Decimal('2000000'))
        adv.advance_date = date(2026, 4, 10)
        adv.save(update_fields=['advance_date', 'updated_at', 'search_text'])
        self.client.post(f'/api/finance/advance-transactions/{adv.id}/submit_approval/', {}, format='json')
        self.client.force_authenticate(self.approver_l1)
        self.client.post(f'/api/finance/advance-transactions/{adv.id}/approve_level1/', {}, format='json')
        self.client.force_authenticate(self.maker)
        self.client.post(f'/api/finance/advance-transactions/{adv.id}/post_disbursement/', {}, format='json')

        resp = self.client.post(
            '/api/finance/advance-settlements/',
            {
                'advance_transaction': adv.id,
                'settlement_date': '2026-04-09',
                'spent_amount': '1000000',
                'refund_amount': '0',
                'note': 'Invalid date',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('settlement_date', resp.json())

    def test_approved_advance_is_immutable_for_edit_delete(self):
        adv = self._create_advance('TA-APP-003', Decimal('1500000'))
        self.client.post(f'/api/finance/advance-transactions/{adv.id}/submit_approval/', {}, format='json')
        self.client.force_authenticate(self.approver_l1)
        self.client.post(f'/api/finance/advance-transactions/{adv.id}/approve_level1/', {}, format='json')
        self.client.force_authenticate(self.maker)

        patch_resp = self.client.patch(
            f'/api/finance/advance-transactions/{adv.id}/',
            {'purpose': 'Cap nhat sau duyet'},
            format='json',
        )
        self.assertEqual(patch_resp.status_code, 403)

        delete_resp = self.client.delete(f'/api/finance/advance-transactions/{adv.id}/')
        self.assertEqual(delete_resp.status_code, 400)

    def test_manual_status_patch_is_ignored(self):
        adv = self._create_advance('TA-APP-004', Decimal('1500000'))
        patch_resp = self.client.patch(
            f'/api/finance/advance-transactions/{adv.id}/',
            {'status': AdvanceTransaction.STATUS_SETTLED},
            format='json',
        )
        self.assertEqual(patch_resp.status_code, 200)
        adv.refresh_from_db()
        self.assertEqual(adv.status, AdvanceTransaction.STATUS_OPEN)

    def test_post_and_reverse_disbursement_for_approved_advance(self):
        adv = self._create_advance('TA-APP-005', Decimal('2500000'))
        self.client.post(f'/api/finance/advance-transactions/{adv.id}/submit_approval/', {}, format='json')
        self.client.force_authenticate(self.approver_l1)
        self.client.post(f'/api/finance/advance-transactions/{adv.id}/approve_level1/', {}, format='json')
        self.client.force_authenticate(self.maker)

        post_resp = self.client.post(f'/api/finance/advance-transactions/{adv.id}/post_disbursement/', {}, format='json')
        self.assertEqual(post_resp.status_code, 200)
        self.assertEqual(CashTransaction.objects.filter(reason__icontains=f'[ADVANCE:{adv.id}]').count(), 1)

        duplicate_resp = self.client.post(f'/api/finance/advance-transactions/{adv.id}/post_disbursement/', {}, format='json')
        self.assertEqual(duplicate_resp.status_code, 400)

        reverse_resp = self.client.post(f'/api/finance/advance-transactions/{adv.id}/reverse_disbursement/', {}, format='json')
        self.assertEqual(reverse_resp.status_code, 200)
        self.assertFalse(CashTransaction.objects.filter(reason__icontains=f'[ADVANCE:{adv.id}]').exists())

    def test_lock_unlock_month_create_audit(self):
        lock_resp = self.client.post('/api/finance/cash-transactions/lock_month/', {'month': '2026-04'}, format='json')
        self.assertEqual(lock_resp.status_code, 200)
        unlock_resp = self.client.post('/api/finance/cash-transactions/unlock_month/', {'month': '2026-04'}, format='json')
        self.assertEqual(unlock_resp.status_code, 200)
        count = AuditLog.objects.filter(entity_type='FinanceMonthLock').count()
        self.assertGreaterEqual(count, 2)
