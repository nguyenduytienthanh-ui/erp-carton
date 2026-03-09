from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from core.models import User
from finance.models import AdvanceSettlement, AdvanceTransaction, CashAccount


class FinanceOverdueReportTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='finance_admin', password='pass')
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        self.client.force_authenticate(user=self.user)

        self.cash_account = CashAccount.objects.create(
            name='Quy TC',
            account_type=CashAccount.TYPE_CASH,
            balance=Decimal('50000000'),
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )

    def test_overdue_report_returns_remaining_advances(self):
        as_of = date.today()
        old_date = as_of - timedelta(days=45)
        adv = AdvanceTransaction.objects.create(
            code='TA001',
            advance_type=AdvanceTransaction.TYPE_PURCHASE,
            advance_date=old_date,
            recipient_name='Nguoi A',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('1000000'),
            purpose='Mua vat tu',
            status=AdvanceTransaction.STATUS_OPEN,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        AdvanceSettlement.objects.create(
            advance_transaction=adv,
            settlement_date=as_of - timedelta(days=10),
            spent_amount=Decimal('300000'),
            refund_amount=Decimal('100000'),
            created_by=self.user,
            updated_by=self.user,
        )

        response = self.client.get(
            '/api/finance/advance-transactions/overdue_report/',
            {'as_of': as_of.isoformat(), 'overdue_days': 30},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['summary']['count'], 1)
        self.assertEqual(payload['summary']['total_remaining'], '600000.00')
        self.assertEqual(payload['items'][0]['code'], 'TA001')

    def test_overdue_report_excel_export(self):
        as_of = date.today()
        old_date = as_of - timedelta(days=60)
        AdvanceTransaction.objects.create(
            code='TA002',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=old_date,
            recipient_name='Nguoi B',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('500000'),
            purpose='Tam ung',
            status=AdvanceTransaction.STATUS_OPEN,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        response = self.client.get(
            '/api/finance/advance-transactions/overdue_report/',
            {'as_of': as_of.isoformat(), 'overdue_days': 30, 'export': 'excel'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            response.get('Content-Type', ''),
        )

    def test_overdue_overview_returns_buckets_and_top_urgent(self):
        as_of = date.today()
        old_95 = as_of - timedelta(days=95)
        old_62 = as_of - timedelta(days=62)
        old_35 = as_of - timedelta(days=35)
        AdvanceTransaction.objects.create(
            code='TA101',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=old_95,
            recipient_name='Nguoi 95',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('1000000'),
            purpose='A',
            status=AdvanceTransaction.STATUS_OPEN,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        AdvanceTransaction.objects.create(
            code='TA102',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=old_62,
            recipient_name='Nguoi 62',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('2000000'),
            purpose='B',
            status=AdvanceTransaction.STATUS_OPEN,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        AdvanceTransaction.objects.create(
            code='TA103',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=old_35,
            recipient_name='Nguoi 35',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('3000000'),
            purpose='C',
            status=AdvanceTransaction.STATUS_OPEN,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        response = self.client.get(
            '/api/finance/advance-transactions/overdue_overview/',
            {'as_of': as_of.isoformat()},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['as_of'], as_of.isoformat())
        by_threshold = {item['threshold_days']: item for item in payload['buckets']}
        self.assertEqual(by_threshold[30]['count'], 3)
        self.assertEqual(by_threshold[60]['count'], 2)
        self.assertEqual(by_threshold[90]['count'], 1)
        self.assertEqual(payload['top_urgent'][0]['code'], 'TA101')
