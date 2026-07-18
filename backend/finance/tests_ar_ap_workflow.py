from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APITestCase

from core.models import Customer, User
from finance.models import (
    CashAccount,
    CashTransaction,
    PayableAdjustment,
    PayableAdjustmentDirection,
    PayableDocument,
    ReceivableDocument,
    TransactionCategory,
)
from finance.services import ensure_system_transaction_category
from products.models import Product, ProductUnit
from purchasing.models import Supplier
from sales.management.commands.seed_sales_order_workflow import Command as SeedSalesWorkflowCommand
from sales.models import SalesOrder, SalesOrderLine, SalesOrderStatus
from sales.services import post_sales_order
from inventory.models import Warehouse, WarehouseLocation


class FinanceArApWorkflowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='finance_bridge_admin',
            password='Demo123!',
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(user=self.user)
        SeedSalesWorkflowCommand().handle()

        self.cash_account = CashAccount.objects.create(
            name='Quỹ vận hành',
            account_type='CASH',
            balance=Decimal('5000000'),
            created_by=self.user,
            updated_by=self.user,
        )
        self.unit = ProductUnit.objects.create(code='CAI', name='Cái')
        self.product = Product.objects.create(
            code='FIN-001',
            name='Thùng carton tài chính',
            unit=self.unit,
            cost_price=Decimal('70000'),
            sale_price=Decimal('100000'),
            status='ACTIVE',
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        self.customer = Customer.objects.create(
            code='CUST-AR-001',
            name='Khách hàng AR',
            company_name='Cong ty Khach AR',
            payment_terms=15,
            credit_limit=Decimal('10000000'),
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        self.supplier = Supplier.objects.create(
            code='SUP-AP-001',
            name='Nhà cung cấp AP',
            company_name='Cong ty NCC AP',
            payment_terms_days=10,
            created_by=self.user,
            updated_by=self.user,
        )
        self.warehouse = Warehouse.objects.create(
            code='KHO-AP',
            name='Kho AP',
            created_by=self.user,
            updated_by=self.user,
        )
        self.location = WarehouseLocation.objects.create(
            warehouse=self.warehouse,
            code='A-01',
            name='A-01',
            created_by=self.user,
            updated_by=self.user,
        )

    def _create_posted_sales_order(self):
        order = SalesOrder.objects.create(
            code='SO-AR-001',
            doc_type='SO',
            order_date=timezone.localdate(),
            status=SalesOrderStatus.APPROVED,
            customer=self.customer,
            currency='VND',
            exchange_rate=Decimal('1'),
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        SalesOrderLine.objects.create(
            sales_order=order,
            line_number=1,
            product=self.product,
            qty=Decimal('2'),
            unit_price=Decimal('100000'),
            tax_pct=Decimal('8'),
        )
        order.recalc_totals()
        ok, message = post_sales_order(order, self.user)
        self.assertTrue(ok, message)
        order.refresh_from_db()
        return order

    def _create_received_purchase_receipt(self):
        create_response = self.client.post('/api/purchasing/orders/', {
            'order_date': '2026-03-13',
            'expected_receipt_date': '2026-03-16',
            'supplier': self.supplier.id,
            'warehouse': self.warehouse.id,
            'location': self.location.id,
            'reference': 'PO-ARAP-001',
            'notes': 'Đơn mua tài chính',
            'lines': [
                {
                    'line_number': 1,
                    'product': self.product.id,
                    'qty': '3',
                    'unit_price': '70000',
                    'discount_pct': '0',
                    'tax_pct': '0',
                }
            ],
        }, format='json')
        self.assertEqual(create_response.status_code, 201, create_response.data)
        order_id = create_response.data['id']
        self.client.post(f'/api/purchasing/orders/{order_id}/submit/', format='json')
        self.client.post(f'/api/purchasing/orders/{order_id}/approve/', format='json')
        line_id = create_response.data['lines'][0]['id']
        receive_response = self.client.post(
            f'/api/purchasing/orders/{order_id}/receive/',
            {
                'receipt_date': '2026-03-14',
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'reference': 'GRN-ARAP-001',
                'items': [
                    {
                        'purchase_order_line': line_id,
                        'quantity': '3',
                        'unit_cost': '68000',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 201, receive_response.data)
        return receive_response.data

    def test_posted_sales_order_creates_receivable_and_collect_settles(self):
        order = self._create_posted_sales_order()
        receivable = ReceivableDocument.objects.get(source_sales_order=order)

        self.assertEqual(receivable.status, 'OPEN')
        self.assertEqual(receivable.customer_snapshot['payment_terms_days'], 15)
        self.assertEqual(str(receivable.total_amount), '216000.00')

        collect_response = self.client.post(
            f'/api/finance/receivables/{receivable.id}/collect/',
            {
                'settlement_date': '2026-03-14',
                'amount': '100000',
                'source_type': 'CASH',
                'source_cash_account': self.cash_account.id,
                'note': 'Thu đợt 1',
            },
            format='json',
        )
        self.assertEqual(collect_response.status_code, 200, collect_response.data)
        receivable.refresh_from_db()
        self.assertEqual(receivable.status, 'PARTIAL')
        self.assertEqual(str(receivable.settled_amount), '100000.00')

        second_collect_response = self.client.post(
            f'/api/finance/receivables/{receivable.id}/collect/',
            {
                'settlement_date': '2026-03-15',
                'amount': '116000',
                'source_type': 'CASH',
                'source_cash_account': self.cash_account.id,
                'note': 'Thu đợt 2',
            },
            format='json',
        )
        self.assertEqual(second_collect_response.status_code, 200, second_collect_response.data)
        receivable.refresh_from_db()
        self.assertEqual(receivable.status, 'SETTLED')
        self.assertEqual(str(receivable.settled_amount), '216000.00')
        self.assertEqual(
            CashTransaction.objects.filter(reason__icontains=f'[AR:{receivable.id}]').count(),
            2,
        )

    def test_system_transaction_category_is_not_rewritten_when_unchanged(self):
        category = TransactionCategory.objects.create(
            code='AP_PAYMENT',
            name='Chi trả công nợ phải trả',
            category_type=CashTransaction.TYPE_EXPENSE,
            color='#faad14',
            is_system=True,
            is_active=True,
            note='Tự động tạo từ cầu nối công nợ.',
        )
        original_updated_at = category.updated_at

        returned = ensure_system_transaction_category(
            code='AP_PAYMENT',
            name='Chi trả công nợ phải trả',
            category_type=CashTransaction.TYPE_EXPENSE,
            color='#faad14',
        )

        returned.refresh_from_db()
        self.assertEqual(returned.id, category.id)
        self.assertEqual(returned.updated_at, original_updated_at)

    def test_existing_system_transaction_category_metadata_is_not_rewritten(self):
        category = TransactionCategory.objects.create(
            code='AR_COLLECTION',
            name='Legacy AR category',
            category_type=CashTransaction.TYPE_INCOME,
            color='#52c41a',
            is_system=True,
            is_active=True,
            note='Legacy metadata',
        )
        original_updated_at = category.updated_at

        returned = ensure_system_transaction_category(
            code='AR_COLLECTION',
            name='Thu công nợ phải thu',
            category_type=CashTransaction.TYPE_INCOME,
            color='#52c41a',
        )

        returned.refresh_from_db()
        self.assertEqual(returned.id, category.id)
        self.assertEqual(returned.name, 'Legacy AR category')
        self.assertEqual(returned.note, 'Legacy metadata')
        self.assertEqual(returned.updated_at, original_updated_at)

    def test_void_posted_sales_order_cancels_unpaid_receivable(self):
        order = self._create_posted_sales_order()
        receivable = ReceivableDocument.objects.get(source_sales_order=order)

        void_response = self.client.post(
            f'/api/sales/orders/{order.id}/void/',
            {'void_reason': 'Khách hủy đơn'},
            format='json',
        )
        self.assertEqual(void_response.status_code, 200, void_response.data)

        receivable.refresh_from_db()
        self.assertEqual(receivable.status, 'CANCELLED')

    def test_purchase_receipt_creates_payable_and_payment_blocks_receipt_cancel(self):
        receipt_payload = self._create_received_purchase_receipt()
        payable = PayableDocument.objects.get(source_purchase_receipt_id=receipt_payload['id'])

        self.assertEqual(payable.status, 'OPEN')
        self.assertEqual(payable.supplier_snapshot['payment_terms_days'], 10)
        self.assertEqual(str(payable.total_amount), '204000.00')

        pay_response = self.client.post(
            f'/api/finance/payables/{payable.id}/pay/',
            {
                'settlement_date': '2026-03-15',
                'amount': '204000',
                'source_type': 'CASH',
                'source_cash_account': self.cash_account.id,
                'note': 'Thanh toán đủ',
            },
            format='json',
        )
        self.assertEqual(pay_response.status_code, 200, pay_response.data)
        payable.refresh_from_db()
        self.assertEqual(payable.status, 'SETTLED')
        self.assertEqual(
            CashTransaction.objects.filter(reason__icontains=f'[AP:{payable.id}]').count(),
            1,
        )

        cancel_receipt_response = self.client.post(
            f"/api/purchasing/receipts/{receipt_payload['id']}/cancel/",
            {'reason': 'Không được hủy vì đã chi trả'},
            format='json',
        )
        self.assertEqual(cancel_receipt_response.status_code, 400, cancel_receipt_response.data)

    def test_cancel_unpaid_purchase_receipt_posts_payable_credit_adjustment(self):
        receipt_payload = self._create_received_purchase_receipt()
        payable = PayableDocument.objects.get(source_purchase_receipt_id=receipt_payload['id'])
        self.assertEqual(payable.status, 'OPEN')

        cancel_receipt_response = self.client.post(
            f"/api/purchasing/receipts/{receipt_payload['id']}/cancel/",
            {'reason': 'Hủy phiếu nhập chưa thanh toán'},
            format='json',
        )
        self.assertEqual(cancel_receipt_response.status_code, 200, cancel_receipt_response.data)
        payable.refresh_from_db()
        self.assertEqual(payable.status, 'OPEN')
        self.assertEqual(payable.adjusted_total_amount, Decimal('0'))
        self.assertEqual(
            PayableAdjustment.objects.filter(
                payable=payable,
                source_purchase_receipt_id=receipt_payload['id'],
                source_return__isnull=True,
                direction=PayableAdjustmentDirection.CREDIT,
            ).count(),
            1,
        )
