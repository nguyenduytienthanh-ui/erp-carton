from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AuditLog, Permission, Role
from inventory.models import (
    InventoryReservation,
    InventoryReservationStatus,
    OutboundShipmentPackage,
    InventoryTransaction,
    InventoryTransactionStatus,
    InventoryTransactionType,
    OutboundShipment,
    Stocktake,
    WarehouseTransfer,
    Warehouse,
    WarehouseLocation,
)
from products.models import Product, ProductUnit
from production.models import ProductionIssue, ProductionOrder, ProductionReceipt
from purchasing.models import PurchaseOrder, PurchaseReceipt, Supplier
from sales.models import SalesOrder, SalesOrderDeliveryPlan, SalesOrderLine, SalesOrderStatus


User = get_user_model()


class InventoryApiFlowTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='inventory_admin', password='test', is_staff=True)
        self.user.is_superuser = True
        self.user.save(update_fields=['is_superuser'])
        self.viewer = User.objects.create_user(username='inventory_viewer', password='test', is_staff=False)
        self.client.force_authenticate(self.user)

        self.unit = ProductUnit.objects.create(code='PCS', name='Piece')
        self.product = Product.objects.create(
            code='BOX-STK-01',
            name='Carton stock item',
            unit=self.unit,
            sale_price=Decimal('100'),
            min_stock=Decimal('5'),
        )
        self.warehouse = Warehouse.objects.create(code='KTP', name='Kho thành phẩm')
        self.location = WarehouseLocation.objects.create(
            warehouse=self.warehouse,
            code='A-01',
            name='Kệ A-01',
        )
        self.inactive_location = WarehouseLocation.objects.create(
            warehouse=self.warehouse,
            code='A-99',
            name='Kệ ngưng dùng',
            is_active=False,
        )
        self.return_location = WarehouseLocation.objects.create(
            warehouse=self.warehouse,
            code='RET-01',
            name='Khu hàng trả',
            location_type='RETURN',
        )
        self.order = SalesOrder.objects.create(
            code='SO-202603-00999',
            doc_type='SO',
            order_date=timezone.localdate(),
            status=SalesOrderStatus.APPROVED,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        self.order_line = SalesOrderLine.objects.create(
            sales_order=self.order,
            line_number=1,
            product=self.product,
            qty=Decimal('10'),
            unit_price=Decimal('100'),
        )

    def _create_inventory_product(self, code):
        return Product.objects.create(
            code=code,
            name=f'{code} product',
            unit=self.unit,
            sale_price=Decimal('100'),
            min_stock=Decimal('0'),
        )

    def _create_inventory_transaction(self, tx_type, product, quantity, code_suffix, warehouse=None):
        return InventoryTransaction.objects.create(
            code=f'INVTX-STK-{code_suffix}',
            transaction_type=tx_type,
            transaction_date=timezone.localdate(),
            product=product,
            warehouse=warehouse or self.warehouse,
            quantity=Decimal(str(quantity)),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )

    def _grant_inventory_permission(self, user, action):
        permission, _ = Permission.objects.update_or_create(
            resource='INVENTORY',
            action=action,
            defaults={
                'code': f'INVENTORY_{action}',
                'name': f'Inventory {action.lower()}',
            },
        )
        role, _ = Role.objects.get_or_create(
            code=f'INV_{action}',
            defaults={'name': f'Inventory {action.title()}'},
        )
        role.permissions.add(permission)
        user.roles.add(role)
        return permission

    def _create_completed_stocktake(self, lines_data):
        create_response = self.client.post(
            '/api/inventory/stocktakes/',
            {
                'warehouse': self.warehouse.id,
                'count_date': str(timezone.localdate()),
                'note': 'Stocktake adjustment regression',
                'lines_data': lines_data,
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.json())
        stocktake_id = create_response.json()['id']
        complete_response = self.client.post(
            f'/api/inventory/stocktakes/{stocktake_id}/complete/',
            format='json',
        )
        self.assertEqual(complete_response.status_code, 200, complete_response.json())
        return Stocktake.objects.get(pk=stocktake_id)

    def test_stock_receipt_reservation_and_summary_flow(self):
        receipt_response = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'RECEIPT',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '10',
                'unit_cost': '75',
                'reference': 'PO-001',
            },
            format='json',
        )
        self.assertEqual(receipt_response.status_code, 201, receipt_response.json())

        reservation_response = self.client.post(
            '/api/inventory/reservations/',
            {
                'reservation_date': str(timezone.localdate()),
                'sales_order': self.order.id,
                'sales_order_line': self.order_line.id,
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'reserved_qty': '4',
                'reference': 'SO reserve',
            },
            format='json',
        )
        self.assertEqual(reservation_response.status_code, 201, reservation_response.json())

        stock_response = self.client.get('/api/inventory/stock/', {'warehouse': self.warehouse.id})
        self.assertEqual(stock_response.status_code, 200)
        results = stock_response.json()['results']
        self.assertEqual(len(results), 1)
        self.assertEqual(Decimal(str(results[0]['on_hand'])), Decimal('10.0'))
        self.assertEqual(Decimal(str(results[0]['reserved'])), Decimal('4.0'))
        self.assertEqual(Decimal(str(results[0]['available'])), Decimal('6.0'))

        summary_response = self.client.get('/api/inventory/stock/summary/')
        self.assertEqual(summary_response.status_code, 200)
        self.assertEqual(summary_response.json()['below_min_count'], 0)

    def test_cannot_reserve_more_than_available(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-001',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryReservation.objects.create(
            code='INVRSV-TEST-001',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('8'),
            created_by=self.user,
            updated_by=self.user,
        )

        response = self.client.post(
            '/api/inventory/reservations/',
            {
                'reservation_date': str(timezone.localdate()),
                'sales_order': self.order.id,
                'sales_order_line': self.order_line.id,
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'reserved_qty': '3',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('reserved_qty', response.json())

    def test_cannot_reserve_from_inactive_or_return_location(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-001A',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )

        inactive_response = self.client.post(
            '/api/inventory/reservations/',
            {
                'reservation_date': str(timezone.localdate()),
                'sales_order': self.order.id,
                'sales_order_line': self.order_line.id,
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.inactive_location.id,
                'reserved_qty': '1',
            },
            format='json',
        )
        self.assertEqual(inactive_response.status_code, 400)
        self.assertIn('location', inactive_response.json())

        InventoryTransaction.objects.create(
            code='INVTX-TEST-001B',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.return_location,
            quantity=Decimal('5'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        return_response = self.client.post(
            '/api/inventory/reservations/',
            {
                'reservation_date': str(timezone.localdate()),
                'sales_order': self.order.id,
                'sales_order_line': self.order_line.id,
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.return_location.id,
                'reserved_qty': '1',
            },
            format='json',
        )
        self.assertEqual(return_response.status_code, 400)
        self.assertIn('location', return_response.json())

    def test_cannot_issue_more_than_on_hand(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-002',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('5'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )

        response = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'ISSUE',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '7',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('quantity', response.json())

    def test_cannot_issue_reserved_stock_without_matching_reservation(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-002A',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryReservation.objects.create(
            code='INVRSV-TEST-002A',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('8'),
            created_by=self.user,
            updated_by=self.user,
        )

        response = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'ISSUE',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '3',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('quantity', response.json())

    def test_issue_against_reservation_marks_reservation_fulfilled(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-003',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-002',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('6'),
            created_by=self.user,
            updated_by=self.user,
        )

        response = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'ISSUE',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '6',
                'sales_order': self.order.id,
                'sales_order_line': self.order_line.id,
                'reservation': reservation.id,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.json())
        reservation.refresh_from_db()
        self.assertEqual(reservation.fulfilled_qty, Decimal('6'))
        self.assertEqual(reservation.status, InventoryReservationStatus.FULFILLED)

        overview_response = self.client.get(f'/api/sales/orders/{self.order.id}/reservation_overview/')
        self.assertEqual(overview_response.status_code, 200)
        self.assertEqual(overview_response.json()['count'], 1)

    def test_inventory_endpoints_use_view_and_specialized_write_permissions(self):
        self.client.force_authenticate(self.viewer)
        response = self.client.get('/api/inventory/stock/')
        self.assertEqual(response.status_code, 403)

        self._grant_inventory_permission(self.viewer, 'VIEW')
        response = self.client.get('/api/inventory/stock/')
        self.assertEqual(response.status_code, 200)

        blocked_write = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'ADJUSTMENT_IN',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '2',
                'unit_cost': '0',
                'reason': 'Cycle count correction',
            },
            format='json',
        )
        self.assertEqual(blocked_write.status_code, 403)

        self._grant_inventory_permission(self.viewer, 'ADJUST')
        missing_reason = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'ADJUSTMENT_IN',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '2',
                'unit_cost': '0',
            },
            format='json',
        )
        self.assertEqual(missing_reason.status_code, 400)
        self.assertIn('reason', missing_reason.json())

        allowed_write = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'ADJUSTMENT_IN',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '2',
                'unit_cost': '0',
                'reason': 'Cycle count correction',
            },
            format='json',
        )
        self.assertEqual(allowed_write.status_code, 201, allowed_write.json())

    def test_cancel_transaction_direct_cancel_is_blocked(self):
        tx = InventoryTransaction.objects.create(
            code='INVTX-TEST-004',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('3'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        response = self.client.post(
            f'/api/inventory/transactions/{tx.id}/cancel/',
            {'reason': 'Sai kho'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('Không thể hủy trực tiếp', str(response.json()))
        tx.refresh_from_db()
        self.assertEqual(tx.status, InventoryTransactionStatus.POSTED)

    def test_release_reservation_endpoint_updates_active_qty_and_status(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-004A',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-004A',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('6'),
            created_by=self.user,
            updated_by=self.user,
        )

        partial_release = self.client.post(
            f'/api/inventory/reservations/{reservation.id}/release/',
            {'qty': '2'},
            format='json',
        )
        self.assertEqual(partial_release.status_code, 200, partial_release.json())
        reservation.refresh_from_db()
        self.assertEqual(reservation.released_qty, Decimal('2'))
        self.assertEqual(reservation.active_qty, Decimal('4'))
        self.assertEqual(reservation.status, InventoryReservationStatus.OPEN)

        full_release = self.client.post(
            f'/api/inventory/reservations/{reservation.id}/release/',
            {},
            format='json',
        )
        self.assertEqual(full_release.status_code, 200, full_release.json())
        reservation.refresh_from_db()
        self.assertEqual(reservation.active_qty, Decimal('0'))
        self.assertEqual(reservation.status, InventoryReservationStatus.RELEASED)

    def test_cancel_reservation_endpoint_changes_status(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-004B',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-004B',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('3'),
            created_by=self.user,
            updated_by=self.user,
        )

        response = self.client.post(
            f'/api/inventory/reservations/{reservation.id}/cancel/',
            {'reason': 'Khách đổi quy cách'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.json())
        reservation.refresh_from_db()
        self.assertEqual(reservation.status, InventoryReservationStatus.CANCELLED)
        self.assertEqual(reservation.cancel_reason, 'Khách đổi quy cách')

    def test_cancel_issue_reopens_reservation_quantities(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-005',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-005',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('6'),
            created_by=self.user,
            updated_by=self.user,
        )
        create_response = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'ISSUE',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '6',
                'sales_order': self.order.id,
                'sales_order_line': self.order_line.id,
                'reservation': reservation.id,
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.json())
        tx_id = create_response.json()['id']

        cancel_response = self.client.post(
            f'/api/inventory/transactions/{tx_id}/cancel/',
            {'reason': 'Khách dời lịch giao'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 400)
        reservation.refresh_from_db()
        self.assertEqual(reservation.fulfilled_qty, Decimal('6'))
        self.assertEqual(reservation.active_qty, Decimal('0'))
        self.assertEqual(reservation.status, InventoryReservationStatus.FULFILLED)

    def test_issue_and_cancel_sync_delivery_plan_actuals(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-005A',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-005A',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
        )
        plan_1 = SalesOrderDeliveryPlan.objects.create(
            line=self.order_line,
            delivery_date=timezone.localdate(),
            qty=Decimal('2'),
            shipped_qty=Decimal('0'),
            delivered_qty=Decimal('0'),
        )
        plan_2 = SalesOrderDeliveryPlan.objects.create(
            line=self.order_line,
            delivery_date=timezone.localdate() + timedelta(days=1),
            qty=Decimal('3'),
            shipped_qty=Decimal('0'),
            delivered_qty=Decimal('0'),
        )

        create_response = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'ISSUE',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '4',
                'sales_order': self.order.id,
                'sales_order_line': self.order_line.id,
                'reservation': reservation.id,
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.json())
        plan_1.refresh_from_db()
        plan_2.refresh_from_db()
        self.assertEqual(plan_1.shipped_qty, Decimal('2'))
        self.assertEqual(plan_1.delivered_qty, Decimal('0'))
        self.assertEqual(plan_2.shipped_qty, Decimal('2'))
        self.assertEqual(plan_2.delivered_qty, Decimal('0'))

        cancel_response = self.client.post(
            f"/api/inventory/transactions/{create_response.json()['id']}/cancel/",
            {'reason': 'Rollback giao hàng'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 400)
        plan_1.refresh_from_db()
        plan_2.refresh_from_db()
        self.assertEqual(plan_1.shipped_qty, Decimal('2'))
        self.assertEqual(plan_1.delivered_qty, Decimal('0'))
        self.assertEqual(plan_2.shipped_qty, Decimal('2'))
        self.assertEqual(plan_2.delivered_qty, Decimal('0'))

    def test_sales_order_ship_action_creates_issue_transaction(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-006',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-006',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
        )

        response = self.client.post(
            f'/api/sales/orders/{self.order.id}/ship/',
            {
                'reservation_id': reservation.id,
                'transaction_date': str(timezone.localdate()),
                'reference': self.order.code,
                'reason': 'Xuất kho thử nghiệm',
                'carrier_name': 'VietShip',
                'tracking_number': 'TRACK-001',
                'vehicle_no': '51D-12345',
                'driver_name': 'Nguyen Van A',
                'driver_phone': '0909000111',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.json())
        self.assertIn('shipment_code', response.json())
        shipment_batch = OutboundShipment.objects.get(pk=response.json()['shipment_id'])
        self.assertEqual(shipment_batch.carrier_name, 'VietShip')
        self.assertEqual(shipment_batch.tracking_number, 'TRACK-001')
        reservation.refresh_from_db()
        self.assertEqual(reservation.fulfilled_qty, Decimal('4'))
        self.assertEqual(reservation.status, InventoryReservationStatus.FULFILLED)
        shipment_overview = self.client.get(f'/api/sales/orders/{self.order.id}/shipment_overview/')
        self.assertEqual(shipment_overview.status_code, 200)
        self.assertEqual(shipment_overview.json()['count'], 1)
        self.assertEqual(shipment_overview.json()['results'][0]['shipment_code'], shipment_batch.code)
        self.assertEqual(shipment_overview.json()['results'][0]['carrier_name'], 'VietShip')
        self.assertEqual(Decimal(str(shipment_overview.json()['results'][0]['total_qty'])), Decimal('4'))

    def test_sales_order_ship_action_updates_delivery_overview(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-006A',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-006A',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
        )
        plan = SalesOrderDeliveryPlan.objects.create(
            line=self.order_line,
            delivery_date=timezone.localdate(),
            qty=Decimal('4'),
            shipped_qty=Decimal('0'),
            delivered_qty=Decimal('0'),
        )

        response = self.client.post(
            f'/api/sales/orders/{self.order.id}/ship/',
            {
                'reservation_id': reservation.id,
                'transaction_date': str(timezone.localdate()),
                'quantity': '4',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.json())
        delivery_overview = self.client.get(f'/api/sales/orders/{self.order.id}/delivery_overview/')
        self.assertEqual(delivery_overview.status_code, 200)
        self.assertEqual(Decimal(str(delivery_overview.json()['results'][0]['shipped_qty'])), Decimal('4'))
        self.assertEqual(Decimal(str(delivery_overview.json()['results'][0]['delivered_qty'])), Decimal('0'))
        order_detail = self.client.get(f'/api/sales/orders/{self.order.id}/')
        self.assertEqual(order_detail.status_code, 200)
        line = order_detail.json()['lines'][0]
        self.assertEqual(Decimal(str(line['reserved_qty_total'])), Decimal('4'))
        self.assertEqual(Decimal(str(line['shipped_qty_total'])), Decimal('4'))
        self.assertEqual(Decimal(str(line['remaining_reservation_qty'])), Decimal('6'))

    def test_cancel_shipment_batch_reopens_reservation_and_delivery_actuals(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-006AX',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-006AX',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
        )
        plan = SalesOrderDeliveryPlan.objects.create(
            line=self.order_line,
            delivery_date=timezone.localdate(),
            qty=Decimal('4'),
            shipped_qty=Decimal('0'),
            delivered_qty=Decimal('0'),
        )

        create_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/ship/',
            {
                'reservation_id': reservation.id,
                'transaction_date': str(timezone.localdate()),
                'quantity': '4',
                'carrier_name': 'Cancel Test Carrier',
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.json())
        shipment_id = create_response.json()['shipment_id']

        cancel_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/cancel_shipment/',
            {
                'shipment_id': shipment_id,
                'reason': 'Xe loi lich giao',
            },
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.json())
        shipment_batch = OutboundShipment.objects.get(pk=shipment_id)
        self.assertEqual(shipment_batch.status, 'CANCELLED')
        self.assertEqual(shipment_batch.cancel_reason, 'Xe loi lich giao')
        reservation.refresh_from_db()
        self.assertEqual(reservation.fulfilled_qty, Decimal('0'))
        self.assertEqual(reservation.active_qty, Decimal('4'))
        self.assertEqual(reservation.status, InventoryReservationStatus.OPEN)
        plan.refresh_from_db()
        self.assertEqual(plan.shipped_qty, Decimal('0'))
        self.assertEqual(plan.delivered_qty, Decimal('0'))
        shipment_overview = self.client.get(f'/api/sales/orders/{self.order.id}/shipment_overview/')
        self.assertEqual(shipment_overview.status_code, 200)
        self.assertEqual(shipment_overview.json()['results'][0]['status'], 'CANCELLED')

    def test_pack_shipment_creates_package_records_and_updates_overview(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-006PK',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-006PK',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
        )
        ship_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/ship/',
            {
                'reservation_id': reservation.id,
                'transaction_date': str(timezone.localdate()),
                'quantity': '4',
            },
            format='json',
        )
        self.assertEqual(ship_response.status_code, 201, ship_response.json())
        shipment_id = ship_response.json()['shipment_id']
        shipment = OutboundShipment.objects.get(pk=shipment_id)
        tx = shipment.transactions.get(status='POSTED')

        pack_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/pack_shipment/',
            {
                'shipment_id': shipment_id,
                'items': [
                    {
                        'transaction_id': tx.id,
                        'package_count': 3,
                        'package_type': 'Carton 5 lop',
                        'gross_weight_kg': '2.500',
                        'length_cm': '40',
                        'width_cm': '30',
                        'height_cm': '20',
                        'note': 'Dong goi tieu chuan',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(pack_response.status_code, 201, pack_response.json())
        self.assertEqual(pack_response.json()['package_count'], 3)
        self.assertEqual(OutboundShipmentPackage.objects.filter(shipment=shipment, status='ACTIVE').count(), 3)
        package = OutboundShipmentPackage.objects.filter(shipment=shipment, status='ACTIVE').order_by('package_no').first()
        self.assertIsNotNone(package)
        self.assertEqual(package.package_type, 'Carton 5 lop')
        self.assertEqual(package.gross_weight_kg, Decimal('2.500'))
        self.assertEqual(package.length_cm, Decimal('40'))
        self.assertEqual(package.width_cm, Decimal('30'))
        self.assertEqual(package.height_cm, Decimal('20'))
        self.assertEqual(package.note, 'Dong goi tieu chuan')
        shipment_overview = self.client.get(f'/api/sales/orders/{self.order.id}/shipment_overview/')
        self.assertEqual(shipment_overview.status_code, 200)
        self.assertEqual(shipment_overview.json()['results'][0]['package_count'], 3)
        self.assertEqual(Decimal(str(shipment_overview.json()['results'][0]['total_gross_weight_kg'])), Decimal('7.500'))

    def test_cancel_shipment_marks_packages_cancelled(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-006PKC',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-006PKC',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
        )
        ship_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/ship/',
            {
                'reservation_id': reservation.id,
                'transaction_date': str(timezone.localdate()),
                'quantity': '4',
            },
            format='json',
        )
        shipment = OutboundShipment.objects.get(pk=ship_response.json()['shipment_id'])
        tx = shipment.transactions.get(status='POSTED')
        self.client.post(
            f'/api/sales/orders/{self.order.id}/pack_shipment/',
            {
                'shipment_id': shipment.id,
                'items': [{'transaction_id': tx.id, 'package_count': 2}],
            },
            format='json',
        )

        cancel_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/cancel_shipment/',
            {'shipment_id': shipment.id, 'reason': 'Khach doi lich'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.json())
        self.assertEqual(OutboundShipmentPackage.objects.filter(shipment=shipment, status='CANCELLED').count(), 2)

    def test_scan_shipment_package_marks_verified_and_updates_overview(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-006SCAN',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-006SCAN',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
        )
        ship_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/ship/',
            {'reservation_id': reservation.id, 'transaction_date': str(timezone.localdate()), 'quantity': '4'},
            format='json',
        )
        shipment = OutboundShipment.objects.get(pk=ship_response.json()['shipment_id'])
        tx = shipment.transactions.get(status='POSTED')
        self.client.post(
            f'/api/sales/orders/{self.order.id}/pack_shipment/',
            {'shipment_id': shipment.id, 'items': [{'transaction_id': tx.id, 'package_count': 2}]},
            format='json',
        )
        package = OutboundShipmentPackage.objects.filter(shipment=shipment, status='ACTIVE').order_by('package_no').first()

        scan_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/scan_shipment_package/',
            {'shipment_id': shipment.id, 'scan_value': package.package_code},
            format='json',
        )
        self.assertEqual(scan_response.status_code, 200, scan_response.json())
        package.refresh_from_db()
        self.assertIsNotNone(package.verified_at)
        self.assertEqual(package.verified_by, self.user)
        self.assertEqual(scan_response.json()['verified_package_count'], 1)

        shipment_overview = self.client.get(f'/api/sales/orders/{self.order.id}/shipment_overview/')
        self.assertEqual(shipment_overview.status_code, 200)
        self.assertEqual(shipment_overview.json()['results'][0]['verified_package_count'], 1)

    def test_resolve_scan_finds_package_by_code_and_qr_value(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-006RESOLVE',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-006RESOLVE',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
        )
        ship_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/ship/',
            {'reservation_id': reservation.id, 'transaction_date': str(timezone.localdate()), 'quantity': '4'},
            format='json',
        )
        shipment = OutboundShipment.objects.get(pk=ship_response.json()['shipment_id'])
        tx = shipment.transactions.get(status='POSTED')
        self.client.post(
            f'/api/sales/orders/{self.order.id}/pack_shipment/',
            {'shipment_id': shipment.id, 'items': [{'transaction_id': tx.id, 'package_count': 2}]},
            format='json',
        )
        package = OutboundShipmentPackage.objects.filter(shipment=shipment, status='ACTIVE').order_by('package_no').first()
        package.label_qr_value = f'QR-{package.package_code}'
        package.save(update_fields=['label_qr_value'])

        by_code = self.client.post(
            '/api/sales/shipments/resolve_scan/',
            {'scan_value': package.package_code},
            format='json',
        )
        self.assertEqual(by_code.status_code, 200, by_code.json())
        self.assertEqual(by_code.json()['matched_by'], 'package_code')
        self.assertEqual(by_code.json()['order_id'], self.order.id)
        self.assertEqual(by_code.json()['shipment_id'], shipment.id)
        self.assertEqual(by_code.json()['package']['id'], package.id)

        by_qr = self.client.post(
            '/api/sales/shipments/resolve_scan/',
            {'scan_value': package.label_qr_value},
            format='json',
        )
        self.assertEqual(by_qr.status_code, 200, by_qr.json())
        self.assertEqual(by_qr.json()['matched_by'], 'label_qr_value')
        self.assertEqual(by_qr.json()['package']['package_code'], package.package_code)

    def test_mark_shipment_packages_loaded_requires_verified_scan(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-006LOAD',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-006LOAD',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
        )
        ship_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/ship/',
            {'reservation_id': reservation.id, 'transaction_date': str(timezone.localdate()), 'quantity': '4'},
            format='json',
        )
        shipment = OutboundShipment.objects.get(pk=ship_response.json()['shipment_id'])
        tx = shipment.transactions.get(status='POSTED')
        self.client.post(
            f'/api/sales/orders/{self.order.id}/pack_shipment/',
            {'shipment_id': shipment.id, 'items': [{'transaction_id': tx.id, 'package_count': 2}]},
            format='json',
        )
        packages = list(OutboundShipmentPackage.objects.filter(shipment=shipment, status='ACTIVE').order_by('package_no'))

        load_fail_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/mark_shipment_packages_loaded/',
            {'shipment_id': shipment.id, 'package_ids': [packages[0].id]},
            format='json',
        )
        self.assertEqual(load_fail_response.status_code, 400, load_fail_response.json())

        self.client.post(
            f'/api/sales/orders/{self.order.id}/scan_shipment_package/',
            {'shipment_id': shipment.id, 'scan_value': packages[0].package_code},
            format='json',
        )
        load_success_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/mark_shipment_packages_loaded/',
            {'shipment_id': shipment.id, 'package_ids': [packages[0].id]},
            format='json',
        )
        self.assertEqual(load_success_response.status_code, 200, load_success_response.json())
        packages[0].refresh_from_db()
        self.assertIsNotNone(packages[0].loaded_at)
        self.assertEqual(packages[0].loaded_by, self.user)
        shipment_overview = self.client.get(f'/api/sales/orders/{self.order.id}/shipment_overview/')
        self.assertEqual(shipment_overview.status_code, 200)
        self.assertEqual(shipment_overview.json()['results'][0]['loaded_package_count'], 1)

    def test_confirm_shipment_loading_requires_loaded_packages_and_blocks_further_changes(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-006HAND',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-006HAND',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
        )
        ship_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/ship/',
            {'reservation_id': reservation.id, 'transaction_date': str(timezone.localdate()), 'quantity': '4'},
            format='json',
        )
        shipment = OutboundShipment.objects.get(pk=ship_response.json()['shipment_id'])
        tx = shipment.transactions.get(status='POSTED')
        self.client.post(
            f'/api/sales/orders/{self.order.id}/pack_shipment/',
            {'shipment_id': shipment.id, 'items': [{'transaction_id': tx.id, 'package_count': 2}]},
            format='json',
        )
        packages = list(OutboundShipmentPackage.objects.filter(shipment=shipment, status='ACTIVE').order_by('package_no'))
        for package in packages:
            self.client.post(
                f'/api/sales/orders/{self.order.id}/scan_shipment_package/',
                {'shipment_id': shipment.id, 'scan_value': package.package_code},
                format='json',
            )
        self.client.post(
            f'/api/sales/orders/{self.order.id}/mark_shipment_packages_loaded/',
            {'shipment_id': shipment.id, 'package_ids': [package.id for package in packages]},
            format='json',
        )
        self.client.post(
            '/api/attachments/',
            {
                'entity_type': 'OutboundShipment',
                'entity_id': str(shipment.id),
                'filename': 'loading-proof.txt',
                'file': SimpleUploadedFile('loading-proof.txt', b'loading proof content', content_type='text/plain'),
                'description': '[LOAD_PROOF] loading proof',
            },
        )

        confirm_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/confirm_shipment_loading/',
            {
                'shipment_id': shipment.id,
                'loading_reference': 'LOAD-SHIP-001',
                'handover_receiver_name': 'Tran Van B',
                'handover_receiver_phone': '0909000111',
                'loading_confirmation_note': 'Da ban giao day du',
            },
            format='json',
        )
        self.assertEqual(confirm_response.status_code, 200, confirm_response.json())
        shipment.refresh_from_db()
        self.assertEqual(shipment.loading_reference, 'LOAD-SHIP-001')
        self.assertEqual(shipment.handover_receiver_name, 'Tran Van B')
        self.assertEqual(shipment.handover_receiver_phone, '0909000111')
        self.assertIn('/media/attachments/OutboundShipment/', shipment.handover_proof_url)
        self.assertEqual(shipment.loading_confirmation_note, 'Da ban giao day du')
        self.assertIsNotNone(shipment.loading_confirmed_at)
        self.assertEqual(shipment.loading_confirmed_by, self.user)

        repack_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/pack_shipment/',
            {'shipment_id': shipment.id, 'items': [{'transaction_id': tx.id, 'package_count': 1}]},
            format='json',
        )
        self.assertEqual(repack_response.status_code, 400, repack_response.json())

        cancel_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/cancel_shipment/',
            {'shipment_id': shipment.id, 'reason': 'Khong hop le'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 400, cancel_response.json())

    def test_confirm_shipment_delivery_requires_loading_confirmation_and_saves_pod(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-006POD',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-006POD',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
        )
        ship_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/ship/',
            {'reservation_id': reservation.id, 'transaction_date': str(timezone.localdate()), 'quantity': '4'},
            format='json',
        )
        shipment = OutboundShipment.objects.get(pk=ship_response.json()['shipment_id'])
        tx = shipment.transactions.get(status='POSTED')
        self.client.post(
            f'/api/sales/orders/{self.order.id}/pack_shipment/',
            {'shipment_id': shipment.id, 'items': [{'transaction_id': tx.id, 'package_count': 2}]},
            format='json',
        )
        packages = list(OutboundShipmentPackage.objects.filter(shipment=shipment, status='ACTIVE').order_by('package_no'))
        for package in packages:
            self.client.post(
                f'/api/sales/orders/{self.order.id}/scan_shipment_package/',
                {'shipment_id': shipment.id, 'scan_value': package.package_code},
                format='json',
            )
        self.client.post(
            f'/api/sales/orders/{self.order.id}/mark_shipment_packages_loaded/',
            {'shipment_id': shipment.id, 'package_ids': [package.id for package in packages]},
            format='json',
        )

        delivery_fail_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/confirm_shipment_delivery/',
            {
                'shipment_id': shipment.id,
                'delivery_reference': 'DEL-SHIP-001',
                'customer_receiver_name': 'Nguyen Van Nhan',
            },
            format='json',
        )
        self.assertEqual(delivery_fail_response.status_code, 400, delivery_fail_response.json())

        self.client.post(
            f'/api/sales/orders/{self.order.id}/confirm_shipment_loading/',
            {
                'shipment_id': shipment.id,
                'loading_reference': 'LOAD-SHIP-001',
                'handover_receiver_name': 'Tran Van B',
                'handover_receiver_phone': '0909000111',
            },
            format='json',
        )
        self.client.post(
            '/api/attachments/',
            {
                'entity_type': 'OutboundShipment',
                'entity_id': str(shipment.id),
                'filename': 'delivery-proof.txt',
                'file': SimpleUploadedFile('delivery-proof.txt', b'delivery proof content', content_type='text/plain'),
                'description': '[DELIVERY_PROOF] delivery proof',
            },
        )
        delivery_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/confirm_shipment_delivery/',
            {
                'shipment_id': shipment.id,
                'delivery_reference': 'DEL-SHIP-001',
                'customer_receiver_name': 'Nguyen Van Nhan',
                'customer_receiver_phone': '0909888777',
                'delivery_confirmation_note': 'Khach da nhan du hang',
                'delivered_at_actual': '2026-03-10T15:45:00',
            },
            format='json',
        )
        self.assertEqual(delivery_response.status_code, 200, delivery_response.json())
        shipment.refresh_from_db()
        self.assertEqual(shipment.delivery_reference, 'DEL-SHIP-001')
        self.assertEqual(shipment.customer_receiver_name, 'Nguyen Van Nhan')
        self.assertEqual(shipment.customer_receiver_phone, '0909888777')
        self.assertIn('/media/attachments/OutboundShipment/', shipment.delivery_proof_url)
        self.assertEqual(shipment.delivery_confirmation_note, 'Khach da nhan du hang')
        self.assertIsNotNone(shipment.delivered_at_actual)
        self.assertIsNotNone(shipment.delivery_confirmed_at)
        self.assertEqual(shipment.delivery_confirmed_by, self.user)
        plan = SalesOrderDeliveryPlan.objects.filter(line=self.order_line).order_by('delivery_date', 'id').first()
        if plan:
            plan.refresh_from_db()
            self.assertEqual(plan.shipped_qty, Decimal('4'))
            self.assertEqual(plan.delivered_qty, Decimal('4'))

        duplicate_response = self.client.post(
            f'/api/sales/orders/{self.order.id}/confirm_shipment_delivery/',
            {
                'shipment_id': shipment.id,
                'customer_receiver_name': 'Nguoi khac',
            },
            format='json',
        )
        self.assertEqual(duplicate_response.status_code, 400, duplicate_response.json())

    def test_cannot_issue_beyond_sales_order_line_qty(self):
        InventoryTransaction.objects.create(
            code='INVTX-TEST-006B',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('20'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        first_issue = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'ISSUE',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '8',
                'sales_order': self.order.id,
                'sales_order_line': self.order_line.id,
            },
            format='json',
        )
        self.assertEqual(first_issue.status_code, 201, first_issue.json())

        second_issue = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'ISSUE',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '3',
                'sales_order': self.order.id,
                'sales_order_line': self.order_line.id,
            },
            format='json',
        )
        self.assertEqual(second_issue.status_code, 400)
        self.assertIn('quantity', second_issue.json())

    def test_void_sales_order_blocked_when_open_reservation_exists(self):
        reservation = InventoryReservation.objects.create(
            code='INVRSV-TEST-006C',
            reservation_date=timezone.localdate(),
            sales_order=self.order,
            sales_order_line=self.order_line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('2'),
            created_by=self.user,
            updated_by=self.user,
        )
        response = self.client.post(
            f'/api/sales/orders/{self.order.id}/void/',
            {'void_reason': 'Khách hủy đơn'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('reservation', response.json()['error'].lower())
        reservation.refresh_from_db()
        self.assertEqual(reservation.status, InventoryReservationStatus.OPEN)

    def test_transfer_and_adjustment_out_update_stock_balances(self):
        target_warehouse = Warehouse.objects.create(code='K2', name='Kho 2')
        target_location = WarehouseLocation.objects.create(
            warehouse=target_warehouse,
            code='B-01',
            name='Kệ B-01',
        )
        InventoryTransaction.objects.create(
            code='INVTX-TEST-007A',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )

        transfer_response = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'TRANSFER',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'target_warehouse': target_warehouse.id,
                'target_location': target_location.id,
                'quantity': '4',
            },
            format='json',
        )
        self.assertEqual(transfer_response.status_code, 201, transfer_response.json())

        adjustment_response = self.client.post(
            '/api/inventory/transactions/',
            {
                'transaction_type': 'ADJUSTMENT_OUT',
                'transaction_date': str(timezone.localdate()),
                'product': self.product.id,
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'quantity': '1',
                'reason': 'Cycle count adjustment',
            },
            format='json',
        )
        self.assertEqual(adjustment_response.status_code, 201, adjustment_response.json())

        source_stock = self.client.get('/api/inventory/stock/', {'warehouse': self.warehouse.id, 'product': self.product.id})
        self.assertEqual(source_stock.status_code, 200)
        source_rows = source_stock.json()['results']
        self.assertEqual(len(source_rows), 1)
        self.assertEqual(Decimal(str(source_rows[0]['on_hand'])), Decimal('5'))

        target_stock = self.client.get('/api/inventory/stock/', {'warehouse': target_warehouse.id, 'product': self.product.id})
        self.assertEqual(target_stock.status_code, 200)
        target_rows = target_stock.json()['results']
        self.assertEqual(len(target_rows), 1)
        self.assertEqual(Decimal(str(target_rows[0]['on_hand'])), Decimal('4'))

    def test_nxt_report_counts_transfer_opening_period_and_warehouse_filter(self):
        target_warehouse = Warehouse.objects.create(code='K-NXT', name='Kho NXT')
        date_from = timezone.localdate() - timedelta(days=3)
        date_to = timezone.localdate()
        opening_date = date_from - timedelta(days=2)
        period_date = date_from + timedelta(days=1)

        InventoryTransaction.objects.create(
            code='INVTX-NXT-OPEN-001',
            transaction_type=InventoryTransactionType.RECEIPT,
            transaction_date=opening_date,
            product=self.product,
            warehouse=self.warehouse,
            quantity=Decimal('20'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-IN-001',
            transaction_type=InventoryTransactionType.RECEIPT,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            quantity=Decimal('5'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-OUT-001',
            transaction_type=InventoryTransactionType.ISSUE,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            quantity=Decimal('3'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-TRANSFER-001',
            transaction_type=InventoryTransactionType.TRANSFER,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            target_warehouse=target_warehouse,
            quantity=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-WH-TRANSFER-ISSUE',
            transaction_type=InventoryTransactionType.ISSUE,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            reference='TRN-NXT-001',
            quantity=Decimal('2'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-WH-TRANSFER-RECEIPT',
            transaction_type=InventoryTransactionType.RECEIPT,
            transaction_date=period_date,
            product=self.product,
            warehouse=target_warehouse,
            reference='TRN-NXT-001',
            quantity=Decimal('2'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-CANCELLED-001',
            transaction_type=InventoryTransactionType.RECEIPT,
            status=InventoryTransactionStatus.CANCELLED,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            quantity=Decimal('99'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )

        response = self.client.get(
            '/api/inventory/transactions/nxt_report/',
            {'date_from': str(date_from), 'date_to': str(date_to), 'product': self.product.id},
        )
        self.assertEqual(response.status_code, 200, response.json())
        rows = {(row['product_id'], row['warehouse_id']): row for row in response.json()['results']}

        source_row = rows[(self.product.id, self.warehouse.id)]
        self.assertEqual(Decimal(source_row['opening_qty']), Decimal('20'))
        self.assertEqual(Decimal(source_row['in_qty']), Decimal('5'))
        self.assertEqual(Decimal(source_row['out_qty']), Decimal('9'))
        self.assertEqual(Decimal(source_row['closing_qty']), Decimal('16'))
        self.assertEqual(Decimal(source_row['source_breakdown']['MANUAL']['in_qty']), Decimal('5'))
        self.assertEqual(Decimal(source_row['source_breakdown']['MANUAL']['out_qty']), Decimal('3'))
        self.assertEqual(Decimal(source_row['source_breakdown']['TRANSFER']['out_qty']), Decimal('6'))
        self.assertEqual(source_row['source_breakdown']['TRANSFER']['source_document_types']['TRANSFER_TRANSACTION'], 1)
        self.assertEqual(source_row['source_breakdown']['TRANSFER']['source_document_types']['WAREHOUSE_TRANSFER_REFERENCE'], 1)
        self.assertEqual(source_row['source_warnings']['TRANSFER_REFERENCE_ONLY'], 1)

        target_row = rows[(self.product.id, target_warehouse.id)]
        self.assertEqual(Decimal(target_row['opening_qty']), Decimal('0'))
        self.assertEqual(Decimal(target_row['in_qty']), Decimal('6'))
        self.assertEqual(Decimal(target_row['out_qty']), Decimal('0'))
        self.assertEqual(Decimal(target_row['closing_qty']), Decimal('6'))
        self.assertEqual(Decimal(target_row['source_breakdown']['TRANSFER']['in_qty']), Decimal('6'))
        self.assertEqual(target_row['source_breakdown']['TRANSFER']['source_document_types']['WAREHOUSE_TRANSFER_REFERENCE'], 1)
        self.assertEqual(target_row['source_warnings']['TRANSFER_REFERENCE_ONLY'], 1)

        filtered_response = self.client.get(
            '/api/inventory/transactions/nxt_report/',
            {
                'date_from': str(date_from),
                'date_to': str(date_to),
                'warehouse': target_warehouse.id,
                'product': self.product.id,
            },
        )
        self.assertEqual(filtered_response.status_code, 200, filtered_response.json())
        filtered_rows = filtered_response.json()['results']
        self.assertEqual(len(filtered_rows), 1)
        self.assertEqual(filtered_rows[0]['warehouse_id'], target_warehouse.id)
        self.assertEqual(Decimal(filtered_rows[0]['in_qty']), Decimal('6'))

    def test_nxt_report_source_breakdown_keeps_totals_and_transfer_direction(self):
        target_warehouse = Warehouse.objects.create(code='K-NXT-SRC', name='Kho NXT source')
        supplier = Supplier.objects.create(code='SUP-NXT-SRC', name='Supplier NXT source')
        date_from = timezone.localdate() - timedelta(days=3)
        date_to = timezone.localdate()
        opening_date = date_from - timedelta(days=2)
        period_date = date_from + timedelta(days=1)

        purchase_order = PurchaseOrder.objects.create(
            code='PO-NXT-SRC',
            order_date=period_date,
            supplier=supplier,
            warehouse=self.warehouse,
            created_by=self.user,
            updated_by=self.user,
        )
        purchase_receipt = PurchaseReceipt.objects.create(
            code='GRN-NXT-SRC',
            purchase_order=purchase_order,
            receipt_date=period_date,
            warehouse=self.warehouse,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        production_order = ProductionOrder.objects.create(
            code='MO-NXT-SRC',
            order_date=period_date,
            product=self.product,
            planned_qty=Decimal('1'),
            target_warehouse=self.warehouse,
            created_by=self.user,
            updated_by=self.user,
        )
        production_issue = ProductionIssue.objects.create(
            code='PMI-NXT-SRC',
            production_order=production_order,
            issue_date=period_date,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        production_receipt = ProductionReceipt.objects.create(
            code='FGR-NXT-SRC',
            production_order=production_order,
            receipt_date=period_date,
            warehouse=self.warehouse,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        stocktake = Stocktake.objects.create(
            code='STKT-NXT-SRC',
            warehouse=self.warehouse,
            count_date=period_date,
            status='COMPLETED',
            created_by=self.user,
        )

        InventoryTransaction.objects.create(
            code='INVTX-NXT-SRC-OPEN',
            transaction_type=InventoryTransactionType.RECEIPT,
            transaction_date=opening_date,
            product=self.product,
            warehouse=self.warehouse,
            quantity=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-SRC-PURCHASE',
            transaction_type=InventoryTransactionType.RECEIPT,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            purchase_order=purchase_order,
            purchase_receipt=purchase_receipt,
            quantity=Decimal('5'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-SRC-PROD-ISSUE',
            transaction_type=InventoryTransactionType.ISSUE,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            production_order=production_order,
            production_issue=production_issue,
            quantity=Decimal('2'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-SRC-PROD-RECEIPT',
            transaction_type=InventoryTransactionType.RECEIPT,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            production_order=production_order,
            production_receipt=production_receipt,
            quantity=Decimal('3'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-SRC-STOCKTAKE',
            transaction_type=InventoryTransactionType.ADJUSTMENT_OUT,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            stocktake=stocktake,
            quantity=Decimal('1'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-SRC-TRANSFER',
            transaction_type=InventoryTransactionType.TRANSFER,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            target_warehouse=target_warehouse,
            quantity=Decimal('4'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-SRC-MANUAL',
            transaction_type=InventoryTransactionType.RECEIPT,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            reference='T-NXT-SRC-MANUAL',
            quantity=Decimal('2'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-NXT-SRC-CANCELLED',
            transaction_type=InventoryTransactionType.RECEIPT,
            status=InventoryTransactionStatus.CANCELLED,
            transaction_date=period_date,
            product=self.product,
            warehouse=self.warehouse,
            purchase_order=purchase_order,
            purchase_receipt=purchase_receipt,
            quantity=Decimal('99'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )

        response = self.client.get(
            '/api/inventory/transactions/nxt_report/',
            {'date_from': str(date_from), 'date_to': str(date_to), 'product': self.product.id},
        )
        self.assertEqual(response.status_code, 200, response.json())
        rows = {(row['product_id'], row['warehouse_id']): row for row in response.json()['results']}

        source_row = rows[(self.product.id, self.warehouse.id)]
        self.assertEqual(Decimal(source_row['opening_qty']), Decimal('10'))
        self.assertEqual(Decimal(source_row['in_qty']), Decimal('10'))
        self.assertEqual(Decimal(source_row['out_qty']), Decimal('7'))
        self.assertEqual(Decimal(source_row['closing_qty']), Decimal('13'))

        breakdown = source_row['source_breakdown']
        self.assertEqual(Decimal(breakdown['PURCHASE']['in_qty']), Decimal('5'))
        self.assertEqual(Decimal(breakdown['PURCHASE']['out_qty']), Decimal('0'))
        self.assertEqual(breakdown['PURCHASE']['count'], 1)
        self.assertEqual(breakdown['PURCHASE']['source_document_types']['PURCHASE_RECEIPT'], 1)
        self.assertEqual(Decimal(breakdown['PRODUCTION']['in_qty']), Decimal('3'))
        self.assertEqual(Decimal(breakdown['PRODUCTION']['out_qty']), Decimal('2'))
        self.assertEqual(breakdown['PRODUCTION']['count'], 2)
        self.assertEqual(breakdown['PRODUCTION']['source_document_types']['PRODUCTION_ISSUE'], 1)
        self.assertEqual(breakdown['PRODUCTION']['source_document_types']['PRODUCTION_RECEIPT'], 1)
        self.assertEqual(Decimal(breakdown['STOCKTAKE']['out_qty']), Decimal('1'))
        self.assertEqual(breakdown['STOCKTAKE']['source_document_types']['STOCKTAKE'], 1)
        self.assertEqual(Decimal(breakdown['TRANSFER']['out_qty']), Decimal('4'))
        self.assertEqual(breakdown['TRANSFER']['source_document_types']['TRANSFER_TRANSACTION'], 1)
        self.assertEqual(Decimal(breakdown['MANUAL']['in_qty']), Decimal('2'))
        self.assertEqual(breakdown['MANUAL']['source_document_types']['MANUAL'], 1)

        source_in_total = sum(Decimal(item['in_qty']) for item in breakdown.values())
        source_out_total = sum(Decimal(item['out_qty']) for item in breakdown.values())
        source_net_total = sum(Decimal(item['net_qty']) for item in breakdown.values())
        self.assertEqual(source_in_total, Decimal(source_row['in_qty']))
        self.assertEqual(source_out_total, Decimal(source_row['out_qty']))
        self.assertEqual(source_net_total, Decimal(source_row['in_qty']) - Decimal(source_row['out_qty']))
        self.assertEqual(source_row['source_warnings'], {})

        target_row = rows[(self.product.id, target_warehouse.id)]
        self.assertEqual(Decimal(target_row['opening_qty']), Decimal('0'))
        self.assertEqual(Decimal(target_row['in_qty']), Decimal('4'))
        self.assertEqual(Decimal(target_row['out_qty']), Decimal('0'))
        self.assertEqual(Decimal(target_row['closing_qty']), Decimal('4'))
        self.assertEqual(Decimal(target_row['source_breakdown']['TRANSFER']['in_qty']), Decimal('4'))
        self.assertEqual(target_row['source_breakdown']['TRANSFER']['count'], 1)

        filtered_response = self.client.get(
            '/api/inventory/transactions/nxt_report/',
            {
                'date_from': str(date_from),
                'date_to': str(date_to),
                'warehouse': target_warehouse.id,
                'product': self.product.id,
            },
        )
        self.assertEqual(filtered_response.status_code, 200, filtered_response.json())
        filtered_row = filtered_response.json()['results'][0]
        self.assertEqual(filtered_row['warehouse_id'], target_warehouse.id)
        self.assertEqual(Decimal(filtered_row['source_breakdown']['TRANSFER']['in_qty']), Decimal('4'))
        self.assertEqual(Decimal(filtered_row['source_breakdown']['TRANSFER']['out_qty']), Decimal('0'))

    def test_transaction_list_filters_by_involved_warehouse_and_source_type(self):
        target_warehouse = Warehouse.objects.create(code='K-FLT', name='Kho filter')
        transfer = InventoryTransaction.objects.create(
            code='INVTX-FILTER-TRANSFER',
            transaction_type=InventoryTransactionType.TRANSFER,
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            target_warehouse=target_warehouse,
            quantity=Decimal('1'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        stocktake = Stocktake.objects.create(
            code='STKT-FILTER-001',
            warehouse=self.warehouse,
            count_date=timezone.localdate(),
            status='COMPLETED',
            created_by=self.user,
        )
        stocktake_tx = InventoryTransaction.objects.create(
            code='INVTX-FILTER-STOCKTAKE',
            transaction_type=InventoryTransactionType.ADJUSTMENT_IN,
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            stocktake=stocktake,
            quantity=Decimal('1'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )

        involved_response = self.client.get('/api/inventory/transactions/', {'warehouse_involved': target_warehouse.id})
        self.assertEqual(involved_response.status_code, 200, involved_response.json())
        involved_codes = {row['code'] for row in involved_response.json()['results']}
        self.assertIn(transfer.code, involved_codes)

        stocktake_response = self.client.get('/api/inventory/transactions/', {'source_type': 'STOCKTAKE'})
        self.assertEqual(stocktake_response.status_code, 200, stocktake_response.json())
        stocktake_codes = {row['code'] for row in stocktake_response.json()['results']}
        self.assertIn(stocktake_tx.code, stocktake_codes)
        self.assertNotIn(transfer.code, stocktake_codes)

    def test_transaction_source_audit_payload_and_extended_source_filters(self):
        today = timezone.localdate()
        target_warehouse = Warehouse.objects.create(code='K-SRC', name='Kho source audit')
        supplier = Supplier.objects.create(code='SUP-SRC', name='Supplier source audit')
        purchase_order = PurchaseOrder.objects.create(
            code='PO-SRC-AUDIT',
            order_date=today,
            supplier=supplier,
            warehouse=self.warehouse,
            created_by=self.user,
            updated_by=self.user,
        )
        purchase_receipt = PurchaseReceipt.objects.create(
            code='GRN-SRC-AUDIT',
            purchase_order=purchase_order,
            receipt_date=today,
            warehouse=self.warehouse,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        production_order = ProductionOrder.objects.create(
            code='MO-SRC-AUDIT',
            order_date=today,
            product=self.product,
            planned_qty=Decimal('1'),
            target_warehouse=self.warehouse,
            created_by=self.user,
            updated_by=self.user,
        )
        production_issue = ProductionIssue.objects.create(
            code='PMI-SRC-AUDIT',
            production_order=production_order,
            issue_date=today,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        production_receipt = ProductionReceipt.objects.create(
            code='FGR-SRC-AUDIT',
            production_order=production_order,
            receipt_date=today,
            warehouse=self.warehouse,
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        stocktake = Stocktake.objects.create(
            code='STKT-SRC-AUDIT',
            warehouse=self.warehouse,
            count_date=today,
            status='COMPLETED',
            created_by=self.user,
        )

        purchase_tx = InventoryTransaction.objects.create(
            code='INVTX-SRC-PURCHASE',
            transaction_type=InventoryTransactionType.RECEIPT,
            transaction_date=today,
            product=self.product,
            warehouse=self.warehouse,
            quantity=Decimal('3'),
            purchase_order=purchase_order,
            purchase_receipt=purchase_receipt,
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        production_issue_tx = InventoryTransaction.objects.create(
            code='INVTX-SRC-PRODUCTION-ISSUE',
            transaction_type=InventoryTransactionType.ISSUE,
            transaction_date=today,
            product=self.product,
            warehouse=self.warehouse,
            quantity=Decimal('1'),
            production_order=production_order,
            production_issue=production_issue,
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        production_receipt_tx = InventoryTransaction.objects.create(
            code='INVTX-SRC-PRODUCTION-RECEIPT',
            transaction_type=InventoryTransactionType.RECEIPT,
            transaction_date=today,
            product=self.product,
            warehouse=self.warehouse,
            quantity=Decimal('1'),
            production_order=production_order,
            production_receipt=production_receipt,
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        stocktake_tx = InventoryTransaction.objects.create(
            code='INVTX-SRC-STOCKTAKE',
            transaction_type=InventoryTransactionType.ADJUSTMENT_IN,
            transaction_date=today,
            product=self.product,
            warehouse=self.warehouse,
            quantity=Decimal('1'),
            stocktake=stocktake,
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        transfer_tx = InventoryTransaction.objects.create(
            code='INVTX-SRC-TRANSFER',
            transaction_type=InventoryTransactionType.TRANSFER,
            transaction_date=today,
            product=self.product,
            warehouse=self.warehouse,
            target_warehouse=target_warehouse,
            quantity=Decimal('1'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        transfer_reference_tx = InventoryTransaction.objects.create(
            code='INVTX-SRC-TRANSFER-REF',
            transaction_type=InventoryTransactionType.ISSUE,
            transaction_date=today,
            product=self.product,
            warehouse=self.warehouse,
            reference='TRN-20260524-9001',
            quantity=Decimal('1'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )
        manual_tx = InventoryTransaction.objects.create(
            code='INVTX-SRC-MANUAL',
            transaction_type=InventoryTransactionType.RECEIPT,
            transaction_date=today,
            product=self.product,
            warehouse=self.warehouse,
            reference='T-MANUAL-SRC-AUDIT',
            quantity=Decimal('1'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )

        purchase_response = self.client.get('/api/inventory/transactions/', {'source_type': 'PURCHASE'})
        self.assertEqual(purchase_response.status_code, 200, purchase_response.json())
        purchase_rows = {row['code']: row for row in purchase_response.json()['results']}
        self.assertIn(purchase_tx.code, purchase_rows)
        purchase_row = purchase_rows[purchase_tx.code]
        self.assertEqual(purchase_row['source_type'], 'PURCHASE')
        self.assertEqual(purchase_row['source_code'], purchase_receipt.code)
        self.assertEqual(purchase_row['purchase_order_code'], purchase_order.code)
        self.assertEqual(purchase_row['purchase_receipt_code'], purchase_receipt.code)
        self.assertEqual(purchase_row['source_audit']['document_type'], 'PURCHASE_RECEIPT')

        production_response = self.client.get('/api/inventory/transactions/', {'source_type': 'PRODUCTION'})
        self.assertEqual(production_response.status_code, 200, production_response.json())
        production_rows = {row['code']: row for row in production_response.json()['results']}
        self.assertEqual(production_rows[production_issue_tx.code]['source_code'], production_issue.code)
        self.assertEqual(production_rows[production_issue_tx.code]['source_document_type'], 'PRODUCTION_ISSUE')
        self.assertEqual(production_rows[production_receipt_tx.code]['source_code'], production_receipt.code)
        self.assertEqual(production_rows[production_receipt_tx.code]['source_document_type'], 'PRODUCTION_RECEIPT')

        stocktake_response = self.client.get('/api/inventory/transactions/', {'source_type': 'STOCKTAKE'})
        self.assertEqual(stocktake_response.status_code, 200, stocktake_response.json())
        stocktake_rows = {row['code']: row for row in stocktake_response.json()['results']}
        self.assertEqual(stocktake_rows[stocktake_tx.code]['source_type'], 'STOCKTAKE')
        self.assertEqual(stocktake_rows[stocktake_tx.code]['source_code'], stocktake.code)

        transfer_response = self.client.get('/api/inventory/transactions/', {'source_type': 'TRANSFER'})
        self.assertEqual(transfer_response.status_code, 200, transfer_response.json())
        transfer_rows = {row['code']: row for row in transfer_response.json()['results']}
        self.assertEqual(transfer_rows[transfer_tx.code]['source_document_type'], 'TRANSFER_TRANSACTION')
        self.assertEqual(transfer_rows[transfer_reference_tx.code]['source_document_type'], 'WAREHOUSE_TRANSFER_REFERENCE')
        self.assertIn('TRANSFER_REFERENCE_ONLY', transfer_rows[transfer_reference_tx.code]['source_warnings'])

        manual_response = self.client.get('/api/inventory/transactions/', {'source_type': 'MANUAL'})
        self.assertEqual(manual_response.status_code, 200, manual_response.json())
        manual_rows = {row['code']: row for row in manual_response.json()['results']}
        manual_codes = set(manual_rows)
        self.assertIn(manual_tx.code, manual_codes)
        self.assertEqual(manual_rows[manual_tx.code]['source_type'], 'MANUAL')
        self.assertEqual(manual_rows[manual_tx.code]['source_document_type'], 'MANUAL')
        self.assertNotIn(purchase_tx.code, manual_codes)
        self.assertNotIn(production_issue_tx.code, manual_codes)
        self.assertNotIn(transfer_tx.code, manual_codes)

    def test_create_stocktake_complete_and_delete_draft(self):
        create_response = self.client.post(
            '/api/inventory/stocktakes/',
            {
                'warehouse': self.warehouse.id,
                'count_date': str(timezone.localdate()),
                'note': 'Phieu kiem ton regression',
                'lines_data': [
                    {
                        'product_id': self.product.id,
                        'count_qty': '9',
                        'note': 'Dong 1',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.json())
        stocktake_id = create_response.json()['id']

        stocktake = Stocktake.objects.get(pk=stocktake_id)
        self.assertEqual(stocktake.status, 'DRAFT')
        self.assertEqual(stocktake.created_by, self.user)
        self.assertEqual(stocktake.lines.count(), 1)
        line = stocktake.lines.first()
        self.assertIsNotNone(line)
        self.assertEqual(line.product_id, self.product.id)
        self.assertEqual(line.count_qty, Decimal('9'))

        complete_response = self.client.post(
            f'/api/inventory/stocktakes/{stocktake_id}/complete/',
            format='json',
        )
        self.assertEqual(complete_response.status_code, 200, complete_response.json())
        self.assertEqual(complete_response.json()['status'], 'COMPLETED')

        stocktake.refresh_from_db()
        self.assertEqual(stocktake.status, 'COMPLETED')
        self.assertEqual(stocktake.completed_by, self.user)
        self.assertIsNotNone(stocktake.completed_at)

        delete_blocked_response = self.client.delete(f'/api/inventory/stocktakes/{stocktake_id}/')
        self.assertEqual(delete_blocked_response.status_code, 400, delete_blocked_response.json())

        draft_delete_response = self.client.post(
            '/api/inventory/stocktakes/',
            {
                'warehouse': self.warehouse.id,
                'count_date': str(timezone.localdate()),
                'note': 'Phieu kiem ton xoa',
                'lines_data': [
                    {
                        'product_id': self.product.id,
                        'count_qty': '3',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(draft_delete_response.status_code, 201, draft_delete_response.json())
        draft_stocktake_id = draft_delete_response.json()['id']

        delete_response = self.client.delete(f'/api/inventory/stocktakes/{draft_stocktake_id}/')
        self.assertEqual(delete_response.status_code, 204, delete_response.content)
        self.assertFalse(Stocktake.objects.filter(pk=draft_stocktake_id).exists())

    def test_complete_stocktake_does_not_create_adjustment_transactions(self):
        self._create_inventory_transaction(InventoryTransactionType.RECEIPT, self.product, '10', 'COMPLETE-001')
        stocktake = self._create_completed_stocktake([
            {'product_id': self.product.id, 'count_qty': '12'},
        ])

        stocktake.refresh_from_db()
        self.assertEqual(stocktake.status, 'COMPLETED')
        self.assertIsNone(stocktake.adjustment_posted_at)
        self.assertIsNone(stocktake.adjustment_posted_by)
        self.assertFalse(InventoryTransaction.objects.filter(stocktake=stocktake).exists())

    def test_preview_stocktake_adjustments_returns_in_out_and_zero_lines(self):
        product_out = self._create_inventory_product('BOX-STK-02')
        product_zero = self._create_inventory_product('BOX-STK-03')
        self._create_inventory_transaction(InventoryTransactionType.RECEIPT, self.product, '10', 'PREV-001')
        self._create_inventory_transaction(InventoryTransactionType.RECEIPT, product_out, '5', 'PREV-002')
        self._create_inventory_transaction(InventoryTransactionType.RECEIPT, product_zero, '7', 'PREV-003')
        stocktake = self._create_completed_stocktake([
            {'product_id': self.product.id, 'count_qty': '12'},
            {'product_id': product_out.id, 'count_qty': '3'},
            {'product_id': product_zero.id, 'count_qty': '7'},
        ])

        response = self.client.post(
            f'/api/inventory/stocktakes/{stocktake.id}/preview_adjustments/',
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.json())
        data = response.json()
        self.assertTrue(data['can_post'])
        self.assertEqual(data['total_in_lines'], 1)
        self.assertEqual(data['total_out_lines'], 1)
        self.assertEqual(data['skipped_zero_lines'], 1)
        self.assertEqual(data['blocked_lines'], 0)

        lines_by_product = {line['product']: line for line in data['lines']}
        self.assertEqual(lines_by_product[self.product.id]['adjustment_type'], InventoryTransactionType.ADJUSTMENT_IN)
        self.assertEqual(Decimal(lines_by_product[self.product.id]['adjustment_qty']), Decimal('2.0000'))
        self.assertEqual(lines_by_product[product_out.id]['adjustment_type'], InventoryTransactionType.ADJUSTMENT_OUT)
        self.assertEqual(Decimal(lines_by_product[product_out.id]['adjustment_qty']), Decimal('2.0000'))
        self.assertEqual(lines_by_product[product_zero.id]['status'], 'SKIPPED')

    def test_post_stocktake_adjustments_requires_reason(self):
        self._create_inventory_transaction(InventoryTransactionType.RECEIPT, self.product, '10', 'REASON-001')
        stocktake = self._create_completed_stocktake([
            {'product_id': self.product.id, 'count_qty': '12'},
        ])

        response = self.client.post(
            f'/api/inventory/stocktakes/{stocktake.id}/post_adjustments/',
            {'reason': '   '},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.json())
        self.assertFalse(InventoryTransaction.objects.filter(stocktake=stocktake).exists())

    def test_post_stocktake_adjustments_creates_transactions_and_audit(self):
        product_out = self._create_inventory_product('BOX-STK-04')
        self._create_inventory_transaction(InventoryTransactionType.RECEIPT, self.product, '10', 'POST-001')
        self._create_inventory_transaction(InventoryTransactionType.RECEIPT, product_out, '5', 'POST-002')
        stocktake = self._create_completed_stocktake([
            {'product_id': self.product.id, 'count_qty': '12'},
            {'product_id': product_out.id, 'count_qty': '3'},
        ])

        response = self.client.post(
            f'/api/inventory/stocktakes/{stocktake.id}/post_adjustments/',
            {'reason': 'Điều chỉnh theo kiểm kê cuối ngày'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.json())
        data = response.json()
        self.assertEqual(data['status'], 'POSTED')
        self.assertEqual(data['transaction_count'], 2)
        self.assertEqual(len(data['transaction_ids']), 2)

        transactions = InventoryTransaction.objects.filter(stocktake=stocktake).order_by('stocktake_line__line_number')
        self.assertEqual(transactions.count(), 2)
        self.assertEqual(transactions[0].transaction_type, InventoryTransactionType.ADJUSTMENT_IN)
        self.assertEqual(transactions[0].quantity, Decimal('2.0000'))
        self.assertEqual(transactions[0].stocktake_line.product_id, self.product.id)
        self.assertEqual(transactions[1].transaction_type, InventoryTransactionType.ADJUSTMENT_OUT)
        self.assertEqual(transactions[1].quantity, Decimal('2.0000'))
        self.assertEqual(transactions[1].stocktake_line.product_id, product_out.id)

        stocktake.refresh_from_db()
        self.assertIsNotNone(stocktake.adjustment_posted_at)
        self.assertEqual(stocktake.adjustment_posted_by, self.user)
        self.assertTrue(
            AuditLog.objects.filter(
                entity_type='Stocktake',
                entity_id=stocktake.id,
                entity_code=stocktake.code,
                action='POST',
            ).exists()
        )

    def test_post_stocktake_adjustments_is_single_use(self):
        self._create_inventory_transaction(InventoryTransactionType.RECEIPT, self.product, '10', 'ONCE-001')
        stocktake = self._create_completed_stocktake([
            {'product_id': self.product.id, 'count_qty': '12'},
        ])

        first_response = self.client.post(
            f'/api/inventory/stocktakes/{stocktake.id}/post_adjustments/',
            {'reason': 'Post lần đầu'},
            format='json',
        )
        self.assertEqual(first_response.status_code, 200, first_response.json())

        second_response = self.client.post(
            f'/api/inventory/stocktakes/{stocktake.id}/post_adjustments/',
            {'reason': 'Post lần hai'},
            format='json',
        )
        self.assertEqual(second_response.status_code, 400, second_response.json())
        self.assertEqual(InventoryTransaction.objects.filter(stocktake=stocktake).count(), 1)

    def test_post_stocktake_adjustments_blocks_shortage_without_partial_writes(self):
        product_in = self._create_inventory_product('BOX-STK-05')
        self._create_inventory_transaction(InventoryTransactionType.RECEIPT, self.product, '1', 'BLOCK-001')
        stocktake = self._create_completed_stocktake([
            {'product_id': self.product.id, 'count_qty': '0'},
            {'product_id': product_in.id, 'count_qty': '1'},
        ])
        self._create_inventory_transaction(InventoryTransactionType.ADJUSTMENT_OUT, self.product, '1', 'BLOCK-002')

        response = self.client.post(
            f'/api/inventory/stocktakes/{stocktake.id}/post_adjustments/',
            {'reason': 'Không được ghi một phần khi thiếu tồn'},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.json())
        self.assertFalse(InventoryTransaction.objects.filter(stocktake=stocktake).exists())
        stocktake.refresh_from_db()
        self.assertIsNone(stocktake.adjustment_posted_at)

    def test_post_stocktake_adjustments_requires_inventory_permission(self):
        self._create_inventory_transaction(InventoryTransactionType.RECEIPT, self.product, '10', 'PERM-001')
        stocktake = self._create_completed_stocktake([
            {'product_id': self.product.id, 'count_qty': '12'},
        ])

        self.client.force_authenticate(self.viewer)
        response = self.client.post(
            f'/api/inventory/stocktakes/{stocktake.id}/post_adjustments/',
            {'reason': 'Không đủ quyền'},
            format='json',
        )
        self.assertEqual(response.status_code, 403, response.json())
        self.assertFalse(InventoryTransaction.objects.filter(stocktake=stocktake).exists())
        self.client.force_authenticate(self.user)

    def test_create_warehouse_transfer_and_progress_workflow(self):
        target_warehouse = Warehouse.objects.create(code='K3', name='Kho 3')
        InventoryTransaction.objects.create(
            code='INVTX-TEST-TRN-001',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            quantity=Decimal('15'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )

        create_response = self.client.post(
            '/api/inventory/warehouse-transfers/',
            {
                'transfer_date': str(timezone.localdate()),
                'from_warehouse': self.warehouse.id,
                'to_warehouse': target_warehouse.id,
                'reference': 'TRN-REG-001',
                'note': 'Transfer regression',
                'lines': [
                    {
                        'line_number': 1,
                        'product': self.product.id,
                        'qty': '6',
                        'note': 'Line 1',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.json())
        transfer_id = create_response.json()['id']

        transfer = WarehouseTransfer.objects.get(pk=transfer_id)
        self.assertEqual(transfer.status, 'DRAFT')
        self.assertEqual(transfer.created_by, self.user)
        self.assertEqual(transfer.lines.count(), 1)

        submit_response = self.client.post(
            f'/api/inventory/warehouse-transfers/{transfer_id}/submit_transfer/',
            format='json',
        )
        self.assertEqual(submit_response.status_code, 200, submit_response.json())
        self.assertEqual(submit_response.json()['status'], 'SUBMITTED')

        post_response = self.client.post(
            f'/api/inventory/warehouse-transfers/{transfer_id}/post_transfer/',
            format='json',
        )
        self.assertEqual(post_response.status_code, 200, post_response.json())
        self.assertEqual(post_response.json()['status'], 'IN_TRANSIT')

        transfer.refresh_from_db()
        self.assertEqual(transfer.status, 'IN_TRANSIT')
        self.assertEqual(transfer.posted_by, self.user)
        self.assertIsNotNone(transfer.posted_at)

        receive_response = self.client.post(
            f'/api/inventory/warehouse-transfers/{transfer_id}/receive_transfer/',
            {
                'lines': [
                    {
                        'id': transfer.lines.first().id,
                        'received_qty': '6',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 200, receive_response.json())
        self.assertEqual(receive_response.json()['status'], 'RECEIVED')

        transfer.refresh_from_db()
        self.assertEqual(transfer.status, 'RECEIVED')
        transfer_line = transfer.lines.first()
        self.assertIsNotNone(transfer_line)
        self.assertEqual(transfer_line.received_qty, Decimal('6'))

        source_stock = self.client.get('/api/inventory/stock/', {'warehouse': self.warehouse.id, 'product': self.product.id})
        self.assertEqual(source_stock.status_code, 200)
        source_rows = source_stock.json()['results']
        self.assertEqual(len(source_rows), 1)
        self.assertEqual(Decimal(str(source_rows[0]['on_hand'])), Decimal('9'))

        target_stock = self.client.get('/api/inventory/stock/', {'warehouse': target_warehouse.id, 'product': self.product.id})
        self.assertEqual(target_stock.status_code, 200)
        target_rows = target_stock.json()['results']
        self.assertEqual(len(target_rows), 1)
        self.assertEqual(Decimal(str(target_rows[0]['on_hand'])), Decimal('6'))

    def test_cancel_in_transit_transfer_restores_source_stock(self):
        target_warehouse = Warehouse.objects.create(code='K4', name='Kho 4')
        InventoryTransaction.objects.create(
            code='INVTX-TEST-TRN-002',
            transaction_type='RECEIPT',
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            quantity=Decimal('15'),
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )

        create_response = self.client.post(
            '/api/inventory/warehouse-transfers/',
            {
                'transfer_date': str(timezone.localdate()),
                'from_warehouse': self.warehouse.id,
                'to_warehouse': target_warehouse.id,
                'reference': 'TRN-REG-002',
                'note': 'Transfer cancel regression',
                'lines': [
                    {
                        'line_number': 1,
                        'product': self.product.id,
                        'qty': '4',
                        'note': 'Cancel before receipt',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.json())
        transfer_id = create_response.json()['id']

        self.client.post(f'/api/inventory/warehouse-transfers/{transfer_id}/submit_transfer/', format='json')
        self.client.post(f'/api/inventory/warehouse-transfers/{transfer_id}/post_transfer/', format='json')
        cancel_response = self.client.post(
            f'/api/inventory/warehouse-transfers/{transfer_id}/cancel_transfer/',
            {'reason': 'Hoan lai chuyen kho de doi lich xe'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.json())
        self.assertEqual(cancel_response.json()['status'], 'CANCELLED')

        transfer = WarehouseTransfer.objects.get(pk=transfer_id)
        self.assertEqual(transfer.status, 'CANCELLED')
        self.assertEqual(transfer.cancel_reason, 'Hoan lai chuyen kho de doi lich xe')

        source_stock = self.client.get('/api/inventory/stock/', {'warehouse': self.warehouse.id, 'product': self.product.id})
        self.assertEqual(source_stock.status_code, 200)
        source_rows = source_stock.json()['results']
        self.assertEqual(len(source_rows), 1)
        self.assertEqual(Decimal(str(source_rows[0]['on_hand'])), Decimal('15'))
        self.assertTrue(AuditLog.objects.filter(entity_type='WarehouseTransfer', entity_id=transfer_id, action='VOID').exists())
