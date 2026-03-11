from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from core.models import User
from finance.models import CashAccount, CashTransaction, TransactionCategory
from workforce.models import Employee, PayrollRecord


class FinancePeriodLockAndReconciliationTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='fin_lock_admin', password='pass')
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        self.client.force_authenticate(user=self.user)

        self.cash = CashAccount.objects.create(
            name='Quy lock test',
            account_type=CashAccount.TYPE_CASH,
            balance=Decimal('50000000'),
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )

    def test_lock_month_blocks_cash_transaction_create(self):
        lock_resp = self.client.post('/api/finance/cash-transactions/lock_month/', {'month': '2026-03'}, format='json')
        self.assertEqual(lock_resp.status_code, 200)

        category = TransactionCategory.objects.create(
            code='EXPENSE_LOCK_TEST',
            name='Chi lock test',
            category_type=TransactionCategory.TYPE_EXPENSE,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        payload = {
            'transaction_type': CashTransaction.TYPE_EXPENSE,
            'source_type': CashTransaction.SOURCE_CASH,
            'source_cash_account': self.cash.id,
            'category': category.id,
            'transaction_date': '2026-03-15',
            'amount': '120000',
            'reason': 'Chi thu nghiem',
            'object_name': 'NCC A',
        }
        create_resp = self.client.post('/api/finance/cash-transactions/', payload, format='json')
        self.assertEqual(create_resp.status_code, 403)

    def test_payroll_reconciliation_returns_delta(self):
        employee = Employee.objects.create(
            code='E-RCN-01',
            name='Nhan vien doi soat',
            salary_basic=Decimal('10000000'),
            created_by=self.user,
            updated_by=self.user,
        )
        PayrollRecord.objects.create(
            employee=employee,
            month='2026-03',
            net_pay=Decimal('10000000'),
            status=PayrollRecord.STATUS_LOCKED,
            created_by=self.user,
            updated_by=self.user,
        )
        category = TransactionCategory.objects.create(
            code='PAYROLL_EXPENSE',
            name='Chi lương',
            category_type=TransactionCategory.TYPE_EXPENSE,
            is_system=True,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        CashTransaction.objects.create(
            transaction_type=CashTransaction.TYPE_EXPENSE,
            source_type=CashTransaction.SOURCE_CASH,
            source_cash_account=self.cash,
            category=category,
            transaction_date=date(2026, 3, 1),
            amount=Decimal('9000000'),
            reason='[PAYROLL:999] Chi lương tháng 2026-03 - E-RCN-01',
            object_name='Nhan vien doi soat',
            created_by=self.user,
        )

        resp = self.client.get('/api/finance/cash-transactions/payroll_reconciliation/', {'month': '2026-03'})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['month'], '2026-03')
        self.assertEqual(data['payroll_total'], '10000000.00')
        self.assertEqual(data['posted_total'], '9000000.00')
        self.assertEqual(data['delta'], '1000000.00')
        self.assertFalse(data['is_balanced'])

    def test_preclose_check_blocks_lock_when_payroll_reconciliation_not_balanced(self):
        employee = Employee.objects.create(
            code='E-RCN-02',
            name='Nhan vien close check',
            salary_basic=Decimal('9000000'),
            created_by=self.user,
            updated_by=self.user,
        )
        PayrollRecord.objects.create(
            employee=employee,
            month='2026-03',
            net_pay=Decimal('9000000'),
            status=PayrollRecord.STATUS_LOCKED,
            created_by=self.user,
            updated_by=self.user,
        )
        category = TransactionCategory.objects.create(
            code='PAYROLL_CLOSE',
            name='Chi lương close',
            category_type=TransactionCategory.TYPE_EXPENSE,
            is_system=True,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        CashTransaction.objects.create(
            transaction_type=CashTransaction.TYPE_EXPENSE,
            source_type=CashTransaction.SOURCE_CASH,
            source_cash_account=self.cash,
            category=category,
            transaction_date=date(2026, 3, 1),
            amount=Decimal('8500000'),
            reason='[PAYROLL:1001] Chi lương tháng 2026-03 - E-RCN-02',
            object_name='Nhan vien close check',
            created_by=self.user,
        )

        check_resp = self.client.get('/api/finance/cash-transactions/preclose_check/', {'month': '2026-03'})
        self.assertEqual(check_resp.status_code, 200)
        data = check_resp.json()
        blocker_codes = {item['code'] for item in data['blockers']}
        self.assertIn('PAYROLL_RECONCILIATION_DELTA', blocker_codes)

        lock_resp = self.client.post('/api/finance/cash-transactions/lock_month/', {'month': '2026-03'}, format='json')
        self.assertEqual(lock_resp.status_code, 400)

    def test_unlock_month_requires_force_when_data_exists(self):
        lock_resp = self.client.post('/api/finance/cash-transactions/lock_month/', {'month': '2026-03'}, format='json')
        self.assertEqual(lock_resp.status_code, 200)
        category = TransactionCategory.objects.create(
            code='LOCK_CHECK',
            name='Kiem tra mo khoa',
            category_type=TransactionCategory.TYPE_EXPENSE,
            is_system=False,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        CashTransaction.objects.create(
            transaction_type=CashTransaction.TYPE_EXPENSE,
            source_type=CashTransaction.SOURCE_CASH,
            source_cash_account=self.cash,
            category=category,
            transaction_date=date(2026, 3, 20),
            amount=Decimal('50000'),
            reason='Du lieu thang khoa',
            object_name='Test',
            created_by=self.user,
        )
        unlock_denied = self.client.post('/api/finance/cash-transactions/unlock_month/', {'month': '2026-03'}, format='json')
        self.assertEqual(unlock_denied.status_code, 400)

    def test_locked_month_blocks_moving_transaction_to_open_month(self):
        category = TransactionCategory.objects.create(
            code='LOCK_MOVE',
            name='Kiem tra doi thang',
            category_type=TransactionCategory.TYPE_EXPENSE,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        tx = CashTransaction.objects.create(
            transaction_type=CashTransaction.TYPE_EXPENSE,
            source_type=CashTransaction.SOURCE_CASH,
            source_cash_account=self.cash,
            category=category,
            transaction_date=date(2026, 3, 10),
            amount=Decimal('70000'),
            reason='Du lieu thang khoa',
            object_name='Test',
            created_by=self.user,
        )
        self.client.post('/api/finance/cash-transactions/lock_month/', {'month': '2026-03'}, format='json')
        resp = self.client.patch(
            f'/api/finance/cash-transactions/{tx.id}/',
            {'transaction_date': '2026-04-02'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_cash_transaction_blocks_when_cash_balance_insufficient(self):
        category = TransactionCategory.objects.create(
            code='EXPENSE_LOW_BAL',
            name='Chi vuot quy',
            category_type=TransactionCategory.TYPE_EXPENSE,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        resp = self.client.post('/api/finance/cash-transactions/', {
            'transaction_type': CashTransaction.TYPE_EXPENSE,
            'source_type': CashTransaction.SOURCE_CASH,
            'source_cash_account': self.cash.id,
            'category': category.id,
            'transaction_date': '2026-03-15',
            'amount': '999999999',
            'reason': 'Chi vuot quy',
            'object_name': 'Test',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('amount', resp.json())
