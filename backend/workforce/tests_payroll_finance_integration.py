from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from finance.models import CashAccount, CashTransaction, TransactionCategory
from workforce.models import Employee, PayrollRecord
from core.models import User


class PayrollFinanceIntegrationTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='wf_fin_admin', password='pass')
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        self.client.force_authenticate(user=self.user)

        self.cash_account = CashAccount.objects.create(
            name='Quy test',
            account_type=CashAccount.TYPE_CASH,
            balance=Decimal('100000000'),
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        self.employee = Employee.objects.create(
            code='E001',
            name='Nhan Vien A',
            salary_basic=Decimal('12000000'),
            created_by=self.user,
            updated_by=self.user,
        )
        self.payroll = PayrollRecord.objects.create(
            employee=self.employee,
            month='2026-03',
            net_pay=Decimal('10500000'),
            status=PayrollRecord.STATUS_UNLOCKED,
            created_by=self.user,
            updated_by=self.user,
        )

    def test_lock_payroll_posts_expense_to_cashbook_idempotent(self):
        lock_url = f'/api/workforce/payroll-records/{self.payroll.id}/lock/'
        first = self.client.post(lock_url, {}, format='json')
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.json().get('finance_posting', {}).get('created'))

        marker = f'[PAYROLL:{self.payroll.id}]'
        tx_qs = CashTransaction.objects.filter(reason__icontains=marker)
        self.assertEqual(tx_qs.count(), 1)
        tx = tx_qs.first()
        self.assertIsNotNone(tx)
        self.assertEqual(tx.transaction_type, CashTransaction.TYPE_EXPENSE)
        self.assertEqual(str(tx.amount), '10500000.00')

        category = TransactionCategory.objects.filter(code='PAYROLL_EXPENSE').first()
        self.assertIsNotNone(category)

        second = self.client.post(lock_url, {}, format='json')
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.json().get('finance_posting', {}).get('created'))
        self.assertEqual(CashTransaction.objects.filter(reason__icontains=marker).count(), 1)
