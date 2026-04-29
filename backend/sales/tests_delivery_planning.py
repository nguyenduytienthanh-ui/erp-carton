from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Customer
from products.models import Product, ProductUnit
from sales.models import SalesOrder, SalesOrderDeliveryPlan, SalesOrderLine, SalesOrderStatus
from sales.services import apply_delivery_plan_delivery, apply_delivery_plan_shipment

User = get_user_model()


class DeliveryPlanningApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='planner_sales', password='test')
        self.customer = Customer.objects.create(code='CUST-DP', name='Cong ty Demo')
        self.other_customer = Customer.objects.create(code='CUST-DP-2', name='Cong ty Khac')
        self.unit = ProductUnit.objects.create(code='THUNG-DP', name='Thùng')
        self.product_a = Product.objects.create(code='BOX-DP-A', name='Thùng A', unit=self.unit, sale_price=Decimal('10'))
        self.product_b = Product.objects.create(code='BOX-DP-B', name='Thùng B', unit=self.unit, sale_price=Decimal('12'))
        self.client = APIClient()
        self.client.force_authenticate(self.user)

        today = timezone.localdate()

        self.order_a = SalesOrder.objects.create(
            code='SO-DP-0001',
            doc_type='SO',
            order_date=today,
            status=SalesOrderStatus.APPROVED,
            customer=self.customer,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        self.order_b = SalesOrder.objects.create(
            code='SO-DP-0002',
            doc_type='SO',
            order_date=today,
            status=SalesOrderStatus.APPROVED,
            customer=self.customer,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        self.order_c = SalesOrder.objects.create(
            code='SO-DP-0003',
            doc_type='SO',
            order_date=today,
            status=SalesOrderStatus.APPROVED,
            customer=self.customer,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )

        self.line_a = SalesOrderLine.objects.create(
            sales_order=self.order_a,
            line_number=1,
            product=self.product_a,
            qty=Decimal('50'),
            unit_price=Decimal('10'),
        )
        self.line_b = SalesOrderLine.objects.create(
            sales_order=self.order_b,
            line_number=1,
            product=self.product_b,
            qty=Decimal('25'),
            unit_price=Decimal('12'),
        )
        self.line_c = SalesOrderLine.objects.create(
            sales_order=self.order_c,
            line_number=1,
            product=self.product_b,
            qty=Decimal('20'),
            unit_price=Decimal('12'),
        )

        self.main_plan = SalesOrderDeliveryPlan.objects.create(
            line=self.line_a,
            delivery_date=today,
            qty=Decimal('50'),
            planned_carrier_name='VietPost',
            delivery_rule=SalesOrderDeliveryPlan.DELIVERY_RULE_FULL_REQUIRED,
            note='Giao đủ lô đầu',
        )
        SalesOrderDeliveryPlan.objects.create(
            line=self.line_b,
            delivery_date=today,
            qty=Decimal('25'),
            planned_carrier_name='VietPost',
            delivery_rule=SalesOrderDeliveryPlan.DELIVERY_RULE_PARTIAL_ALLOWED,
            note='Giao đủ lô đầu',
        )
        SalesOrderDeliveryPlan.objects.create(
            line=self.line_a,
            delivery_date=today - timedelta(days=1),
            qty=Decimal('10'),
            planned_carrier_name='',
            delivery_rule=SalesOrderDeliveryPlan.DELIVERY_RULE_PARTIAL_ALLOWED,
            note='Cho phép tách chuyến',
        )
        SalesOrderDeliveryPlan.objects.create(
            line=self.line_c,
            delivery_date=today - timedelta(days=1),
            qty=Decimal('20'),
            planned_carrier_name='',
            delivery_rule=SalesOrderDeliveryPlan.DELIVERY_RULE_PARTIAL_ALLOWED,
            note='Giao sau 15h',
        )

    def test_summary_groups_rows_by_date_customer_and_carrier(self):
        response = self.client.get('/api/sales/delivery-planning/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['count'], 2)

        main_row = next(row for row in payload['results'] if row['planned_carrier_name'] == 'VietPost')
        self.assertEqual(main_row['customer_name'], 'Cong ty Demo')
        self.assertEqual(main_row['order_count'], 2)
        self.assertEqual(main_row['sku_count'], 2)
        self.assertEqual(main_row['note_preview'], 'Giao đủ lô đầu')
        self.assertTrue(main_row['has_full_required_items'])

        unassigned_row = next(row for row in payload['results'] if not row['planned_carrier_name'])
        self.assertTrue(unassigned_row['has_unassigned_carrier'])
        self.assertEqual(unassigned_row['note_preview'], 'Nhiều ghi chú')
        self.assertGreaterEqual(unassigned_row['overdue_count'], 1)

    def test_group_items_returns_detail_rows(self):
        summary = self.client.get('/api/sales/delivery-planning/').json()
        target = next(row for row in summary['results'] if row['planned_carrier_name'] == 'VietPost')
        response = self.client.get('/api/sales/delivery-planning/group-items/', {'group_key': target['group_key']})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['count'], 2)
        self.assertEqual(payload['results'][0]['planned_carrier_name'], 'VietPost')
        self.assertIn(payload['results'][0]['delivery_rule'], ['FULL_REQUIRED', 'PARTIAL_ALLOWED'])
        self.assertIn(payload['results'][0]['sales_order_code'], ['SO-DP-0001', 'SO-DP-0002'])

    def test_summary_reflects_shipment_and_delivery_sync(self):
        apply_delivery_plan_shipment(self.line_b, Decimal('20'), actor=self.user, shipment_date=timezone.localdate())
        apply_delivery_plan_delivery(self.line_b, Decimal('10'), actor=self.user, delivery_date=timezone.localdate())

        summary = self.client.get('/api/sales/delivery-planning/').json()
        target = next(row for row in summary['results'] if row['planned_carrier_name'] == 'VietPost')
        self.assertEqual(target['shipped_qty_total'], '20.0000')
        self.assertEqual(target['delivered_qty_total'], '10.0000')

        detail = self.client.get('/api/sales/delivery-planning/group-items/', {'group_key': target['group_key']}).json()
        main_item = next(item for item in detail['results'] if item['sales_order_code'] == 'SO-DP-0002')
        self.assertEqual(main_item['shipped_qty'], '20.0000')
        self.assertEqual(main_item['delivered_qty'], '10.0000')
        self.assertEqual(main_item['remaining_qty'], '15.0000')
