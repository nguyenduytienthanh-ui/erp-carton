"""
Tests tối thiểu: transition, totals, cannot edit when posted, idempotent post.
"""
from datetime import timedelta
from decimal import Decimal
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from core.models import Customer, Team, Task
from products.models import Product, ProductUnit
from sales.models import SalesOrder, SalesOrderLine, SalesOrderDeliveryPlan, SalesOrderStatus, PeriodSequence
from sales.document_policy import calc_line_totals, round_money
from sales.services import (
    post_sales_order,
    workflow_can_transition,
    get_next_sales_order_code,
    sync_sales_order_delivery_tasks,
)
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


class SalesOrderDeliveryPlanTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='delivery_user', password='test')
        self.unit = ProductUnit.objects.create(code='BOX', name='Thùng')
        self.product = Product.objects.create(code='BOX01', name='Carton Box', unit=self.unit, sale_price=Decimal('10'))
        period = '202603'
        PeriodSequence.objects.get_or_create(doc_type='SO', period=period, defaults={'current_number': 0})

    def test_create_order_with_split_delivery_plans(self):
        serializer = SalesOrderSerializer(data={
            'code': 'SO-202603-00001',
            'doc_type': 'SO',
            'order_date': timezone.now().date(),
            'status': SalesOrderStatus.DRAFT,
            'lines': [{
                'line_number': 1,
                'product': self.product.id,
                'qty': '100',
                'unit_price': '10',
                'delivery_plans': [
                    {'delivery_date': str(timezone.now().date()), 'qty': '40', 'delivered_qty': '10'},
                    {'delivery_date': str(timezone.now().date() + timedelta(days=2)), 'qty': '60', 'delivered_qty': '0'},
                ],
            }],
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        order = serializer.save(created_by=self.user, updated_by=self.user, owner=self.user)
        line = order.lines.first()
        self.assertEqual(line.delivery_plans.count(), 2)
        self.assertEqual(line.planned_qty_total, Decimal('100'))
        self.assertEqual(line.unplanned_qty, Decimal('0'))

    def test_plan_total_cannot_exceed_line_qty(self):
        serializer = SalesOrderSerializer(data={
            'code': 'SO-202603-00002',
            'doc_type': 'SO',
            'order_date': timezone.now().date(),
            'status': SalesOrderStatus.DRAFT,
            'lines': [{
                'line_number': 1,
                'product': self.product.id,
                'qty': '50',
                'unit_price': '10',
                'delivery_plans': [
                    {'delivery_date': str(timezone.now().date()), 'qty': '30'},
                    {'delivery_date': str(timezone.now().date() + timedelta(days=1)), 'qty': '25'},
                ],
            }],
        })
        self.assertFalse(serializer.is_valid())
        self.assertIn('lines', serializer.errors)

    def test_sync_delivery_tasks_creates_and_completes_tasks(self):
        order = SalesOrder.objects.create(
            code='SO-202603-00003',
            doc_type='SO',
            order_date=timezone.now().date(),
            status=SalesOrderStatus.APPROVED,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        line = SalesOrderLine.objects.create(
            sales_order=order,
            line_number=1,
            product=self.product,
            qty=Decimal('100'),
            unit_price=Decimal('10'),
        )
        plan = SalesOrderDeliveryPlan.objects.create(
            line=line,
            delivery_date=timezone.localdate() - timedelta(days=1),
            qty=Decimal('100'),
            delivered_qty=Decimal('0'),
        )
        result = sync_sales_order_delivery_tasks(actor=self.user, order_ids=[order.id], days_ahead=3)
        self.assertEqual(result['created'], 1)
        task = Task.objects.get(source_key=f"sales-delivery-plan:{plan.id}")
        self.assertEqual(task.entity_type, 'SalesOrder')
        self.assertEqual(task.status, Task.STATUS_TODO)

        plan.delivered_qty = Decimal('100')
        plan.save(update_fields=['delivered_qty', 'updated_at'])
        result = sync_sales_order_delivery_tasks(actor=self.user, order_ids=[order.id], days_ahead=3)
        self.assertEqual(result['completed'], 1)
        task.refresh_from_db()
        self.assertEqual(task.status, Task.STATUS_DONE)

    def test_sync_delivery_tasks_fallback_for_header_delivery_date(self):
        order = SalesOrder.objects.create(
            code='SO-202603-00004',
            doc_type='SO',
            order_date=timezone.now().date(),
            delivery_date=timezone.localdate() + timedelta(days=1),
            status=SalesOrderStatus.SUBMITTED,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        SalesOrderLine.objects.create(
            sales_order=order,
            line_number=1,
            product=self.product,
            qty=Decimal('20'),
            unit_price=Decimal('10'),
        )
        result = sync_sales_order_delivery_tasks(actor=self.user, order_ids=[order.id], days_ahead=3)
        self.assertEqual(result['created'], 1)
        task = Task.objects.get(source_key=f"sales-delivery-order:{order.id}")
        self.assertEqual(task.status, Task.STATUS_TODO)
        self.assertEqual(task.due_date, order.delivery_date)
