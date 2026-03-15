"""
Tests tối thiểu: transition, totals, cannot edit when posted, idempotent post.
"""
from datetime import date, timedelta
from decimal import Decimal
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import Customer, Team, Task
from inventory.models import InventoryTransaction, OutboundShipment, OutboundShipmentPackage
from products.models import Product, ProductUnit
from sales.models import SalesOrder, SalesOrderLine, SalesOrderDeliveryPlan, SalesOrderStatus, PeriodSequence
from sales.document_policy import calc_line_totals, round_money
from sales.services import (
    build_sales_order_line_package_trace_code,
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
        serializer = SalesOrderSerializer(instance=self.order, data={'notes': 'x', 'version': self.order.version}, partial=True)
        self.assertFalse(serializer.is_valid())
        self.assertIn('status', serializer.errors)


class SalesOrderVersionLockTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='version_user', password='test')
        self.unit = ProductUnit.objects.create(code='CAI-V', name='Cái')
        self.product = Product.objects.create(code='P-V', name='P-V', unit=self.unit, sale_price=Decimal('1'))
        self.order = SalesOrder.objects.create(
            code='SO-202602-00110',
            doc_type='SO',
            order_date=timezone.now().date(),
            status=SalesOrderStatus.DRAFT,
            version=3,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )

    def test_update_serializer_rejects_stale_version(self):
        serializer = SalesOrderSerializer(
            instance=self.order,
            data={'reference': 'new-ref', 'version': 2},
            partial=True,
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('version', serializer.errors)


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
        order = serializer.save(
            code='SO-202603-00011',
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        line = order.lines.first()
        self.assertEqual(line.delivery_plans.count(), 2)
        self.assertEqual(line.planned_qty_total, Decimal('100'))
        self.assertEqual(line.unplanned_qty, Decimal('0'))
        first_plan = line.delivery_plans.order_by('delivery_date', 'id').first()
        self.assertEqual(first_plan.shipped_qty, Decimal('10'))

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


class SalesOrderLineSnapshotTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='snapshot_user', password='test')
        self.unit = ProductUnit.objects.create(code='PCS', name='Pieces')
        self.product = Product.objects.create(
            code='BOX-QR',
            name='Thung Carton QR',
            unit=self.unit,
            sale_price=Decimal('12500'),
            commission_per_unit=Decimal('120'),
            commission_percent=Decimal('2.50'),
            size_order='50x30x20',
            size_production='51x31x21',
            film_code='FILM-01',
            mold_code='MOLD-01',
            color_count=3,
            process_in=2500,
            process_be=1200,
            delivery_tolerance='+-5%',
            waterproof='OUTSIDE',
        )

    def test_serializer_persists_product_snapshot_and_trace_code(self):
        serializer = SalesOrderSerializer(data={
            'code': 'SO-202603-00011',
            'doc_type': 'SO',
            'order_date': '2026-03-09',
            'status': SalesOrderStatus.DRAFT,
            'lines': [{
                'line_number': 1,
                'product': self.product.id,
                'qty': '100',
                'unit_price': '12500',
                'delivery_plans': [
                    {'delivery_date': '2026-03-11', 'qty': '40'},
                    {'delivery_date': '2026-03-15', 'qty': '60'},
                ],
            }],
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        order = serializer.save(created_by=self.user, updated_by=self.user, owner=self.user)
        line = order.lines.prefetch_related('delivery_plans').get(line_number=1)

        self.assertEqual(line.internal_product_code, 'BOX-QR')
        self.assertEqual(line.trace_code, 'BOX-QR|20260309|SO-202603-00011|L001')
        self.assertEqual(line.product_snapshot['name'], 'Thung Carton QR')
        self.assertEqual(line.product_snapshot['commission_per_unit'], '120.00')
        self.assertEqual(line.product_snapshot['process_in'], 2500)

    def test_build_package_trace_code(self):
        self.assertEqual(
            build_sales_order_line_package_trace_code('BOX-QR|20260309|SO-202603-00011|L001', 2),
            'BOX-QR|20260309|SO-202603-00011|L001|C002',
        )

    def test_serializer_uses_snapshot_even_if_product_changes_later(self):
        order = SalesOrder.objects.create(
            code='SO-202603-00012',
            doc_type='SO',
            order_date=date(2026, 3, 9),
            status=SalesOrderStatus.DRAFT,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        line = SalesOrderLine.objects.create(
            sales_order=order,
            line_number=1,
            product=self.product,
            qty=Decimal('50'),
            unit_price=Decimal('12500'),
        )
        SalesOrderDeliveryPlan.objects.create(line=line, delivery_date=date(2026, 3, 10), qty=Decimal('20'))
        SalesOrderDeliveryPlan.objects.create(line=line, delivery_date=date(2026, 3, 12), qty=Decimal('30'))

        self.product.name = 'Da doi ten san pham'
        self.product.commission_percent = Decimal('9.99')
        self.product.save(update_fields=['name', 'commission_percent', 'updated_at'])

        payload = SalesOrderSerializer(instance=SalesOrder.objects.prefetch_related('lines__delivery_plans').get(pk=order.pk)).data
        row = payload['lines'][0]
        self.assertEqual(row['product_name'], 'Thung Carton QR')
        self.assertEqual(row['product_snapshot']['commission_percent'], '2.50')
        self.assertEqual(row['trace_code'], 'BOX-QR|20260309|SO-202603-00012|L001')
        self.assertEqual(row['delivery_schedule_summary'], '2026-03-10:20.0000; 2026-03-12:30.0000')

    def test_serializer_allows_editable_snapshot_fields(self):
        serializer = SalesOrderSerializer(data={
            'code': 'SO-202603-00013',
            'doc_type': 'SO',
            'order_date': '2026-03-09',
            'status': SalesOrderStatus.DRAFT,
            'lines': [{
                'line_number': 1,
                'product': self.product.id,
                'qty': '10',
                'unit_price': '13000',
                'product_snapshot': {
                    'size_order': '52x32x22',
                    'process_xa': 3000,
                    'process_chap': 1800,
                    'film_code': 'FILM-EDIT',
                },
            }],
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        order = serializer.save(
            code='SO-202603-00013',
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        line = order.lines.get(line_number=1)
        self.assertEqual(line.product_snapshot['size_order'], '52x32x22')
        self.assertEqual(line.product_snapshot['process_xa'], 3000)
        self.assertEqual(line.product_snapshot['process_chap'], 1800)
        self.assertEqual(line.product_snapshot['film_code'], 'FILM-EDIT')
        self.assertEqual(line.product_snapshot['sale_price'], '13000.00')


class SalesOrderPdfExportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='pdf_user', password='test')
        self.client.force_authenticate(self.user)
        self.unit = ProductUnit.objects.create(code='PCS-PDF', name='Piece')
        self.product = Product.objects.create(code='P-PDF', name='PDF Product', unit=self.unit, sale_price=Decimal('200'))
        self.order = SalesOrder.objects.create(
            code='SO-202603-00990',
            doc_type='SO',
            order_date=date(2026, 3, 9),
            status=SalesOrderStatus.POSTED,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
            posted_by=self.user,
            posted_at=timezone.now(),
            post_number='SO-202603-00990',
        )
        SalesOrderLine.objects.create(
            sales_order=self.order,
            line_number=1,
            product=self.product,
            qty=Decimal('5'),
            unit_price=Decimal('200'),
        )

    def test_download_packing_slip_pdf(self):
        response = self.client.get(f'/api/sales/orders/{self.order.id}/packing_slip_pdf/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('application/pdf', response['Content-Type'])
        self.assertIn('packing_slip_', response['Content-Disposition'])

    def test_download_trace_labels_pdf(self):
        response = self.client.get(f'/api/sales/orders/{self.order.id}/trace_labels_pdf/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('application/pdf', response['Content-Type'])
        self.assertIn('trace_labels_', response['Content-Disposition'])

    def test_download_trace_labels_pdf_with_options(self):
        second_line = SalesOrderLine.objects.create(
            sales_order=self.order,
            line_number=2,
            product=self.product,
            qty=Decimal('3'),
            unit_price=Decimal('200'),
        )
        response = self.client.get(
            f'/api/sales/orders/{self.order.id}/trace_labels_pdf/',
            {'copies_per_line': 2, 'line_ids': str(second_line.id)},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('application/pdf', response['Content-Type'])

    def test_download_trace_labels_pdf_in_carton_mode(self):
        response = self.client.get(
            f'/api/sales/orders/{self.order.id}/trace_labels_pdf/',
            {'label_mode': 'cartons', 'packages_per_line': 3},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('application/pdf', response['Content-Type'])

    def test_download_shipment_packing_slip_pdf(self):
        shipment = OutboundShipment.objects.create(
            code='SHIP-202603-00001',
            sales_order=self.order,
            shipment_date=date(2026, 3, 10),
            reference=self.order.code,
            carrier_name='VietShip',
            tracking_number='TRACK-PDF',
            vehicle_no='51D-88888',
            driver_name='Driver PDF',
            driver_phone='0909888777',
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        line = self.order.lines.get(line_number=1)
        InventoryTransaction.objects.create(
            code='INVTX-PDF-001',
            transaction_type='ISSUE',
            transaction_date=date(2026, 3, 10),
            product=self.product,
            warehouse=None,
            location=None,
            quantity=Decimal('2'),
            unit_cost=Decimal('0'),
            sales_order=self.order,
            sales_order_line=line,
            shipment_batch=shipment,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        response = self.client.get(
            f'/api/sales/orders/{self.order.id}/shipment_packing_slip_pdf/',
            {'shipment_id': shipment.id},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('application/pdf', response['Content-Type'])
        self.assertIn('shipment_packing_slip_', response['Content-Disposition'])

    def test_download_shipment_package_labels_pdf(self):
        shipment = OutboundShipment.objects.create(
            code='SHIP-202603-00002',
            sales_order=self.order,
            shipment_date=date(2026, 3, 10),
            reference=self.order.code,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        line = self.order.lines.get(line_number=1)
        tx = InventoryTransaction.objects.create(
            code='INVTX-PKG-001',
            transaction_type='ISSUE',
            transaction_date=date(2026, 3, 10),
            product=self.product,
            warehouse=None,
            location=None,
            quantity=Decimal('2'),
            unit_cost=Decimal('0'),
            sales_order=self.order,
            sales_order_line=line,
            shipment_batch=shipment,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        OutboundShipmentPackage.objects.create(
            shipment=shipment,
            inventory_transaction=tx,
            sales_order_line=line,
            package_no=1,
            total_packages=1,
            quantity=Decimal('2'),
            package_code='SHIP-202603-00002-L001-P001',
            label_qr_value='BOX-QR|20260309|SO-202603-00011|L001|SHIP-202603-00002|C001',
            created_by=self.user,
            updated_by=self.user,
        )
        response = self.client.get(
            f'/api/sales/orders/{self.order.id}/shipment_package_labels_pdf/',
            {'shipment_id': shipment.id},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('application/pdf', response['Content-Type'])
        self.assertIn('shipment_package_labels_', response['Content-Disposition'])

    def test_download_shipment_packing_manifest_pdf(self):
        shipment = OutboundShipment.objects.create(
            code='SHIP-202603-00003',
            sales_order=self.order,
            shipment_date=date(2026, 3, 10),
            reference=self.order.code,
            carrier_name='Manifest Express',
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        line = self.order.lines.get(line_number=1)
        tx = InventoryTransaction.objects.create(
            code='INVTX-MANIFEST-001',
            transaction_type='ISSUE',
            transaction_date=date(2026, 3, 10),
            product=self.product,
            warehouse=None,
            location=None,
            quantity=Decimal('2'),
            unit_cost=Decimal('0'),
            sales_order=self.order,
            sales_order_line=line,
            shipment_batch=shipment,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        OutboundShipmentPackage.objects.create(
            shipment=shipment,
            inventory_transaction=tx,
            sales_order_line=line,
            package_no=1,
            total_packages=1,
            quantity=Decimal('2'),
            package_type='Carton A',
            gross_weight_kg=Decimal('3.250'),
            length_cm=Decimal('45'),
            width_cm=Decimal('32'),
            height_cm=Decimal('28'),
            package_code='SHIP-202603-00003-L001-P001',
            label_qr_value='BOX-QR|20260309|SO-202603-00011|L001|SHIP-202603-00003|C001',
            created_by=self.user,
            updated_by=self.user,
        )
        response = self.client.get(
            f'/api/sales/orders/{self.order.id}/shipment_packing_manifest_pdf/',
            {'shipment_id': shipment.id},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('application/pdf', response['Content-Type'])
        self.assertIn('shipment_packing_manifest_', response['Content-Disposition'])

    def test_download_shipment_loading_handover_pdf(self):
        shipment = OutboundShipment.objects.create(
            code='SHIP-202603-00004',
            sales_order=self.order,
            shipment_date=date(2026, 3, 10),
            reference=self.order.code,
            carrier_name='Handover Express',
            loading_reference='LOAD-SHIP-202603-00004',
            handover_receiver_name='Receiver A',
            handover_receiver_phone='0909555666',
            handover_proof_url='https://example.com/proof/handover-00004',
            loading_confirmation_note='Giao xe du chung tu',
            loading_confirmed_at=timezone.now(),
            loading_confirmed_by=self.user,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        line = self.order.lines.get(line_number=1)
        tx = InventoryTransaction.objects.create(
            code='INVTX-HANDOVER-001',
            transaction_type='ISSUE',
            transaction_date=date(2026, 3, 10),
            product=self.product,
            warehouse=None,
            location=None,
            quantity=Decimal('2'),
            unit_cost=Decimal('0'),
            sales_order=self.order,
            sales_order_line=line,
            shipment_batch=shipment,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        OutboundShipmentPackage.objects.create(
            shipment=shipment,
            inventory_transaction=tx,
            sales_order_line=line,
            package_no=1,
            total_packages=1,
            quantity=Decimal('2'),
            gross_weight_kg=Decimal('3.100'),
            package_code='SHIP-202603-00004-L001-P001',
            label_qr_value='BOX-QR|20260309|SO-202603-00011|L001|SHIP-202603-00004|C001',
            verified_at=timezone.now(),
            verified_by=self.user,
            loaded_at=timezone.now(),
            loaded_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        response = self.client.get(
            f'/api/sales/orders/{self.order.id}/shipment_loading_handover_pdf/',
            {'shipment_id': shipment.id},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('application/pdf', response['Content-Type'])
        self.assertIn('shipment_loading_handover_', response['Content-Disposition'])

    def test_download_shipment_delivery_proof_pdf(self):
        shipment = OutboundShipment.objects.create(
            code='SHIP-202603-00005',
            sales_order=self.order,
            shipment_date=date(2026, 3, 10),
            reference=self.order.code,
            carrier_name='Delivery Express',
            loading_reference='LOAD-SHIP-202603-00005',
            handover_receiver_name='Driver B',
            loading_confirmed_at=timezone.now(),
            loading_confirmed_by=self.user,
            delivery_reference='DEL-SHIP-202603-00005',
            customer_receiver_name='Customer Receiver',
            customer_receiver_phone='0909333444',
            delivery_proof_url='https://example.com/proof/delivery-00005',
            delivery_confirmation_note='Khach da ky nhan',
            delivered_at_actual=timezone.now(),
            delivery_confirmed_at=timezone.now(),
            delivery_confirmed_by=self.user,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        line = self.order.lines.get(line_number=1)
        tx = InventoryTransaction.objects.create(
            code='INVTX-DELIVERY-001',
            transaction_type='ISSUE',
            transaction_date=date(2026, 3, 10),
            product=self.product,
            warehouse=None,
            location=None,
            quantity=Decimal('2'),
            unit_cost=Decimal('0'),
            sales_order=self.order,
            sales_order_line=line,
            shipment_batch=shipment,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        OutboundShipmentPackage.objects.create(
            shipment=shipment,
            inventory_transaction=tx,
            sales_order_line=line,
            package_no=1,
            total_packages=1,
            quantity=Decimal('2'),
            gross_weight_kg=Decimal('3.100'),
            package_code='SHIP-202603-00005-L001-P001',
            label_qr_value='BOX-QR|20260309|SO-202603-00011|L001|SHIP-202603-00005|C001',
            verified_at=timezone.now(),
            verified_by=self.user,
            loaded_at=timezone.now(),
            loaded_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        response = self.client.get(
            f'/api/sales/orders/{self.order.id}/shipment_delivery_proof_pdf/',
            {'shipment_id': shipment.id},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('application/pdf', response['Content-Type'])
        self.assertIn('shipment_delivery_proof_', response['Content-Disposition'])


class SalesOrderSummaryApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='sales_summary_user', password='test', is_staff=True, is_superuser=True)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.unit = ProductUnit.objects.create(code='SUM', name='Summary Unit')
        self.product = Product.objects.create(code='SUM-BOX', name='Summary Box', unit=self.unit, sale_price=Decimal('100'))

    def test_summary_endpoint_returns_operational_metrics(self):
        today = timezone.localdate()
        draft_order = SalesOrder.objects.create(
            code='SO-SUM-001',
            doc_type='SO',
            order_date=today,
            status=SalesOrderStatus.DRAFT,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        SalesOrderLine.objects.create(
            sales_order=draft_order,
            line_number=1,
            product=self.product,
            qty=Decimal('1'),
            unit_price=Decimal('100'),
        )
        draft_order.recalc_totals()

        submitted_order = SalesOrder.objects.create(
            code='SO-SUM-002',
            doc_type='SO',
            order_date=today,
            status=SalesOrderStatus.SUBMITTED,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
            submitted_by=self.user,
            submitted_at=timezone.now(),
        )
        SalesOrderLine.objects.create(
            sales_order=submitted_order,
            line_number=1,
            product=self.product,
            qty=Decimal('2'),
            unit_price=Decimal('100'),
        )
        submitted_order.recalc_totals()

        approved_order = SalesOrder.objects.create(
            code='SO-SUM-003',
            doc_type='SO',
            order_date=today,
            status=SalesOrderStatus.APPROVED,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
            approved_by=self.user,
            approved_at=timezone.now(),
        )
        approved_line = SalesOrderLine.objects.create(
            sales_order=approved_order,
            line_number=1,
            product=self.product,
            qty=Decimal('3'),
            unit_price=Decimal('100'),
        )
        approved_order.recalc_totals()
        SalesOrderDeliveryPlan.objects.create(
            line=approved_line,
            delivery_date=today - timedelta(days=1),
            qty=Decimal('3'),
            delivered_qty=Decimal('0'),
        )
        ok, msg = post_sales_order(approved_order, self.user)
        self.assertTrue(ok, msg)

        response = self.client.get('/api/sales/orders/summary/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['draft_count'], 1)
        self.assertEqual(response.data['submitted_count'], 1)
        self.assertEqual(response.data['posted_count'], 1)
        self.assertEqual(response.data['overdue_delivery_count'], 1)
