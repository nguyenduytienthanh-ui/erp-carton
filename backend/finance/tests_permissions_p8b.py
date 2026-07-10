from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APITestCase

from core.models import Permission, Role, User
from core.permissions import FINANCE_PERMISSION_DEFINITIONS
from finance.models import (
    CashAccount,
    CashTransaction,
    GeneralLedgerAccount,
    GeneralLedgerEntry,
    PayableDocument,
    PayableSettlement,
    PayableStatus,
    ReceivableDocument,
    ReceivableSettlement,
    ReceivableStatus,
    TransactionCategory,
)


class FinancePermissionBaselineP8BTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.permission_by_action = {}
        for definition in FINANCE_PERMISSION_DEFINITIONS:
            permission, _ = Permission.objects.update_or_create(
                resource=definition['resource'],
                action=definition['action'],
                defaults={
                    'code': definition['code'],
                    'name': definition['name'],
                    'description': definition['label'],
                },
            )
            cls.permission_by_action[definition['action']] = permission

        cls.cash_account = CashAccount.objects.create(
            name='P8B test cash',
            account_type=CashAccount.TYPE_CASH,
            balance=Decimal('10000000.00'),
        )
        cls.receivable = ReceivableDocument.objects.create(
            code='P8B-AR-001',
            customer_snapshot={'code': 'P8B-CUS', 'name': 'P8B customer'},
            document_date=timezone.localdate(),
            due_date=timezone.localdate(),
            subtotal_amount=Decimal('300.00'),
            total_amount=Decimal('300.00'),
            settled_amount=Decimal('0.00'),
            status=ReceivableStatus.OPEN,
            reference='P8B AR baseline',
        )
        cls.payable = PayableDocument.objects.create(
            code='P8B-AP-001',
            supplier_snapshot={'code': 'P8B-SUP', 'name': 'P8B supplier'},
            document_date=timezone.localdate(),
            due_date=timezone.localdate(),
            subtotal_amount=Decimal('300.00'),
            total_amount=Decimal('300.00'),
            settled_amount=Decimal('0.00'),
            status=PayableStatus.OPEN,
            reference='P8B AP baseline',
        )
        cls.category = TransactionCategory.objects.create(
            code='P8B-INCOME',
            name='P8B income',
            category_type=TransactionCategory.TYPE_INCOME,
            is_system=True,
        )
        cls.cash_transaction = CashTransaction.objects.create(
            transaction_type=CashTransaction.TYPE_INCOME,
            source_type=CashTransaction.SOURCE_CASH,
            source_cash_account=cls.cash_account,
            category=cls.category,
            transaction_date=timezone.localdate(),
            amount=Decimal('125.00'),
            object_name='P8B counterparty',
            reason='P8B cash movement without model reference field',
        )
        cls.gl_account = GeneralLedgerAccount.objects.create(
            code='P8B100',
            name='P8B GL cash',
            account_type='ASSET',
        )
        cls.gl_entry = GeneralLedgerEntry.objects.create(
            account=cls.gl_account,
            posting_date=timezone.localdate(),
            debit_amount=Decimal('125.00'),
            credit_amount=Decimal('0.00'),
            document_type='P8B',
            document_id=cls.cash_transaction.id,
            document_code='P8B-GL-001',
            description='P8B GL read baseline',
        )

    def _user_with_permissions(self, username, *actions):
        user = User.objects.create_user(username=username, password='Demo123!')
        if actions:
            role = Role.objects.create(code=f'P8B-{username}'.upper(), name=f'P8B {username}')
            role.permissions.add(*(self.permission_by_action[action] for action in actions))
            user.roles.add(role)
        return user

    def _authenticate(self, user):
        self.client.force_authenticate(user=user)

    def test_no_view_user_cannot_read_finance_endpoints(self):
        self._authenticate(self._user_with_permissions('p8b_no_view'))

        receivables_response = self.client.get('/api/finance/receivables/')
        gl_response = self.client.get('/api/finance/general-ledger/')

        self.assertEqual(receivables_response.status_code, 403)
        self.assertEqual(gl_response.status_code, 403)

    def test_view_user_can_read_but_cannot_settle_adjust_or_manage(self):
        self._authenticate(self._user_with_permissions('p8b_view', 'VIEW'))

        receivables_response = self.client.get('/api/finance/receivables/')
        payables_response = self.client.get('/api/finance/payables/')
        collect_response = self.client.post(
            f'/api/finance/receivables/{self.receivable.id}/collect/',
            {
                'settlement_date': timezone.localdate().isoformat(),
                'amount': '10.00',
                'source_type': CashTransaction.SOURCE_CASH,
                'source_cash_account': self.cash_account.id,
            },
            format='json',
        )
        cancel_response = self.client.post(
            f'/api/finance/receivables/{self.receivable.id}/cancel/',
            {'reason': 'P8B view-only cannot cancel'},
            format='json',
        )
        create_gl_response = self.client.post(
            '/api/finance/general-ledger-accounts/',
            {'code': 'P8B999', 'name': 'Blocked', 'account_type': 'ASSET'},
            format='json',
        )

        self.assertEqual(receivables_response.status_code, 200, receivables_response.data)
        self.assertEqual(payables_response.status_code, 200, payables_response.data)
        self.assertEqual(collect_response.status_code, 403)
        self.assertEqual(cancel_response.status_code, 403)
        self.assertEqual(create_gl_response.status_code, 403)
        self.assertEqual(ReceivableSettlement.objects.count(), 0)

    def test_settle_user_can_collect_and_pay_but_overpayment_is_blocked(self):
        self._authenticate(self._user_with_permissions('p8b_settle', 'SETTLE'))

        collect_response = self.client.post(
            f'/api/finance/receivables/{self.receivable.id}/collect/',
            {
                'settlement_date': timezone.localdate().isoformat(),
                'amount': '100.00',
                'source_type': CashTransaction.SOURCE_CASH,
                'source_cash_account': self.cash_account.id,
                'note': 'P8B partial collect',
            },
            format='json',
        )
        over_collect_response = self.client.post(
            f'/api/finance/receivables/{self.receivable.id}/collect/',
            {
                'settlement_date': timezone.localdate().isoformat(),
                'amount': '500.00',
                'source_type': CashTransaction.SOURCE_CASH,
                'source_cash_account': self.cash_account.id,
            },
            format='json',
        )
        pay_response = self.client.post(
            f'/api/finance/payables/{self.payable.id}/pay/',
            {
                'settlement_date': timezone.localdate().isoformat(),
                'amount': '100.00',
                'source_type': CashTransaction.SOURCE_CASH,
                'source_cash_account': self.cash_account.id,
                'note': 'P8B partial pay',
            },
            format='json',
        )
        over_pay_response = self.client.post(
            f'/api/finance/payables/{self.payable.id}/pay/',
            {
                'settlement_date': timezone.localdate().isoformat(),
                'amount': '500.00',
                'source_type': CashTransaction.SOURCE_CASH,
                'source_cash_account': self.cash_account.id,
            },
            format='json',
        )
        adjust_response = self.client.post(
            f'/api/finance/payables/{self.payable.id}/cancel/',
            {'reason': 'P8B settle-only cannot adjust'},
            format='json',
        )

        self.assertEqual(collect_response.status_code, 200, collect_response.data)
        self.assertEqual(over_collect_response.status_code, 400)
        self.assertEqual(pay_response.status_code, 200, pay_response.data)
        self.assertEqual(over_pay_response.status_code, 400)
        self.assertEqual(adjust_response.status_code, 403)
        self.assertEqual(ReceivableSettlement.objects.count(), 1)
        self.assertEqual(PayableSettlement.objects.count(), 1)

    def test_adjust_user_can_cancel_unsettled_documents_but_cannot_settle(self):
        receivable = ReceivableDocument.objects.create(
            code='P8B-AR-ADJ',
            customer_snapshot={'code': 'P8B-CUS2', 'name': 'P8B customer 2'},
            document_date=timezone.localdate(),
            due_date=timezone.localdate(),
            total_amount=Decimal('100.00'),
            settled_amount=Decimal('0.00'),
            status=ReceivableStatus.OPEN,
        )
        payable = PayableDocument.objects.create(
            code='P8B-AP-ADJ',
            supplier_snapshot={'code': 'P8B-SUP2', 'name': 'P8B supplier 2'},
            document_date=timezone.localdate(),
            due_date=timezone.localdate(),
            total_amount=Decimal('100.00'),
            settled_amount=Decimal('0.00'),
            status=PayableStatus.OPEN,
        )
        self._authenticate(self._user_with_permissions('p8b_adjust', 'ADJUST'))

        collect_response = self.client.post(
            f'/api/finance/receivables/{receivable.id}/collect/',
            {
                'settlement_date': timezone.localdate().isoformat(),
                'amount': '10.00',
                'source_type': CashTransaction.SOURCE_CASH,
                'source_cash_account': self.cash_account.id,
            },
            format='json',
        )
        receivable_cancel_response = self.client.post(
            f'/api/finance/receivables/{receivable.id}/cancel/',
            {'reason': 'P8B adjust cancel AR'},
            format='json',
        )
        payable_cancel_response = self.client.post(
            f'/api/finance/payables/{payable.id}/cancel/',
            {'reason': 'P8B adjust cancel AP'},
            format='json',
        )

        receivable.refresh_from_db()
        payable.refresh_from_db()
        self.assertEqual(collect_response.status_code, 403)
        self.assertEqual(receivable_cancel_response.status_code, 200, receivable_cancel_response.data)
        self.assertEqual(payable_cancel_response.status_code, 200, payable_cancel_response.data)
        self.assertEqual(receivable.status, ReceivableStatus.CANCELLED)
        self.assertEqual(payable.status, PayableStatus.CANCELLED)

    def test_gl_user_can_read_gl_and_cash_ledger_without_ar_ap_access(self):
        self._authenticate(self._user_with_permissions('p8b_gl', 'GL'))
        today = timezone.localdate().isoformat()

        gl_response = self.client.get('/api/finance/general-ledger/')
        trial_balance_response = self.client.get('/api/finance/general-ledger/trial_balance/')
        account_balance_response = self.client.get(
            '/api/finance/general-ledger/account_balance/',
            {'account_id': self.gl_account.id},
        )
        cash_ledger_response = self.client.get(
            '/api/finance/cash-transactions/general_ledger/',
            {'date_from': today, 'date_to': today},
        )
        receivables_response = self.client.get('/api/finance/receivables/')

        self.assertEqual(gl_response.status_code, 200, gl_response.data)
        self.assertEqual(trial_balance_response.status_code, 200, trial_balance_response.data)
        self.assertEqual(account_balance_response.status_code, 200, account_balance_response.data)
        self.assertEqual(cash_ledger_response.status_code, 200, cash_ledger_response.data)
        self.assertEqual(receivables_response.status_code, 403)
        self.assertEqual(
            cash_ledger_response.data['results'][0]['reference'],
            self.cash_transaction.reason,
        )
