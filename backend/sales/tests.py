"""
Tests tối thiểu: transition, totals, cannot edit when posted, idempotent post.
"""
from decimal import Decimal
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from core.models import Customer, Team
from products.models import Product, ProductUnit
from sales.models import SalesOrder, SalesOrderLine, SalesOrderStatus, PeriodSequence
from sales.document_policy import calc_line_totals, round_money
from sales.services import post_sales_order, workflow_can_transition, get_next_sales_order_code
from sales.serializers import SalesOrderSerializer

User = get_user_model()


class MoneyPolicyTests(TestCase):
    def test_calc_line_totals(self):
        line_sub, disc, tax, total = calc_line_totals(
            qty=2, unit_price=100, discount_pct=10, tax_pct=10,
        )
        self.assertEqual(line_sub, Decimal('200.00'))
        self.assertEqual(disc, Decimal('20.00'))
        self.assertEqual(tax, Decimal('18.00'))
        self.assertEqual(total, Decimal('198.00'))

    def test_round_money(self):
        self.assertEqual(round_money(10.555), Decimal('10.56'))
        self.assertEqual(round_money(10.554), Decimal('10.55'))


class SalesOrderTotalsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='test', password='test')
        self.unit = ProductUnit.objects.create(code='CAI', name='Cái')
        self.product = Product.objects.create(
            code='P1', name='Product 1', unit=self.unit,
            sale_price=Decimal('100'),
        )
        period = '202602'
        PeriodSequence.objects.get_or_create(doc_type='SO', period=period, defaults={'current_number': 0})
        from datetime import date
        self.order = SalesOrder.objects.create(
            code='SO-202602-00001', doc_type='SO', order_date=date(2026, 2, 1),
            status=SalesOrderStatus.DRAFT, created_by=self.user, updated_by=self.user,
        )
        SalesOrderLine.objects.create(
            sales_order=self.order, line_number=1, product=self.product,
            qty=2, unit_price=100, discount_pct=0, tax_pct=0,
        )
        SalesOrderLine.objects.create(
            sales_order=self.order, line_number=2, product=self.product,
            qty=1, unit_price=50, discount_pct=10, tax_pct=0,
        )

    def test_recalc_totals(self):
        self.order.recalc_totals()
        self.order.refresh_from_db()
        self.assertEqual(self.order.subtotal, Decimal('250.00'))
        self.assertGreater(self.order.total, Decimal('0'))


class SalesOrderTransitionTests(TestCase):
    def setUp(self):
        from sales.management.commands.seed_sales_order_workflow import Command
        Command().handle()

    def test_workflow_can_transition(self):
        self.assertTrue(workflow_can_transition('SalesOrder', 'DRAFT', 'SUBMITTED'))
        self.assertTrue(workflow_can_transition('SalesOrder', 'SUBMITTED', 'APPROVED'))
        self.assertTrue(workflow_can_transition('SalesOrder', 'APPROVED', 'POSTED'))
        self.assertFalse(workflow_can_transition('SalesOrder', 'POSTED', 'DRAFT'))


class SalesOrderCannotEditWhenPostedTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='test2', password='test')
        self.unit = ProductUnit.objects.create(code='CAI2', name='Cái')
        self.product = Product.objects.create(code='P2', name='P2', unit=self.unit, sale_price=Decimal('1'))
        self.order = SalesOrder.objects.create(
            code='SO-202602-00099', doc_type='SO', order_date=timezone.now().date(),
            status=SalesOrderStatus.POSTED, created_by=self.user, updated_by=self.user,
            posted_at=timezone.now(), post_number='SO-202602-00099',
        )

    def test_update_serializer_raises_when_posted(self):
        serializer = SalesOrderSerializer(instance=self.order, data={'notes': 'x'}, partial=True)
        self.assertFalse(serializer.is_valid())
        self.assertIn('status', serializer.errors)


class SalesOrderIdempotentPostTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='test3', password='test')
        self.unit = ProductUnit.objects.create(code='CAI3', name='Cái')
        self.product = Product.objects.create(code='P3', name='P3', unit=self.unit, sale_price=Decimal('1'))
        self.order = SalesOrder.objects.create(
            code='SO-202602-00098', doc_type='SO', order_date=timezone.now().date(),
            status=SalesOrderStatus.APPROVED, created_by=self.user, updated_by=self.user,
            approved_by=self.user, approved_at=timezone.now(),
        )

    def test_post_twice_idempotent(self):
        ok1, msg1 = post_sales_order(self.order, self.user)
        self.assertTrue(ok1)
        self.order.refresh_from_db()
        self.assertIsNotNone(self.order.posted_at)
        post_number_first = self.order.post_number
        ok2, msg2 = post_sales_order(self.order, self.user)
        self.assertTrue(ok2)
        self.assertTrue('idempotent' in msg2.lower() or 'Already' in msg2)
        self.order.refresh_from_db()
        self.assertEqual(self.order.post_number, post_number_first)
