from io import StringIO
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient, APIRequestFactory

from core.models import Customer, Permission, Role
from inventory.models import (
    InventoryReservation,
    InventoryTransaction,
    InventoryTransactionStatus,
    InventoryTransactionType,
    OutboundShipment as InventoryOutboundShipment,
    Warehouse,
    WarehouseLocation,
)
from products.models import Product, ProductUnit
from sales.models import DeliveryCarrier, OutboundShipment, SalesOrder, SalesOrderDeliveryPlan, SalesOrderLine, SalesOrderStatus
from sales.serializers import OutboundShipmentSerializer, SalesOrderSerializer

User = get_user_model()


class DeliveryCarrierApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.viewer = User.objects.create_user(username='carrier_viewer', password='test')
        self.editor = User.objects.create_user(username='carrier_editor', password='test')

        sales_role = Role.objects.create(name='Sales', code='SALES')
        edit_role = Role.objects.create(name='Delivery Carrier Manager', code='DELIVERY_CARRIER_MANAGER')
        permission, _ = Permission.objects.get_or_create(
            resource='DELIVERYCARRIER',
            action='EDIT',
            defaults={
                'code': 'DELIVERYCARRIER_EDIT',
                'name': 'Manage delivery carriers',
                'description': 'Manage delivery carriers',
            },
        )
        edit_role.permissions.add(permission)

        self.viewer.roles.add(sales_role)
        self.editor.roles.add(sales_role, edit_role)

    def test_viewer_can_list_but_cannot_create(self):
        self.client.force_authenticate(self.viewer)
        list_response = self.client.get('/api/sales/delivery-carriers/')
        self.assertEqual(list_response.status_code, 200, list_response.content)

        create_response = self.client.post(
            '/api/sales/delivery-carriers/',
            {
                'code': 'DVC-TEST',
                'name': 'Xe test',
                'is_internal': False,
                'is_active': True,
                'sort_order': 10,
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 403, create_response.content)

    def test_editor_can_create_and_delete_unused_carrier(self):
        self.client.force_authenticate(self.editor)
        create_response = self.client.post(
            '/api/sales/delivery-carriers/',
            {
                'code': 'DVC-EDIT',
                'name': 'Vận chuyển chỉnh sửa',
                'is_internal': True,
                'is_active': True,
                'sort_order': 5,
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        carrier_id = create_response.json()['id']

        delete_response = self.client.delete(f'/api/sales/delivery-carriers/{carrier_id}/')
        self.assertEqual(delete_response.status_code, 204, delete_response.content)
        self.assertFalse(DeliveryCarrier.objects.filter(pk=carrier_id, deleted_at__isnull=True).exists())


class DeliveryCarrierIntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.factory = APIRequestFactory()
        self.user = User.objects.create_user(username='carrier_staff', password='test', is_staff=True)
        self.customer = Customer.objects.create(code='CARRIER-CUST', name='Khách carrier')
        self.unit = ProductUnit.objects.create(code='BOXCAR01', name='Thùng')
        self.product = Product.objects.create(
            code='BOX-CARRIER-01',
            name='Thùng carrier',
            unit=self.unit,
            sale_price=Decimal('15000'),
        )
        self.warehouse = Warehouse.objects.create(code='WH-CARRIER', name='Kho carrier')
        self.location = WarehouseLocation.objects.create(
            warehouse=self.warehouse,
            code='A-01',
            name='Kệ A-01',
        )
        self.master_carrier = DeliveryCarrier.objects.create(
            code='DVC-MASTER',
            name='Xe nội bộ',
            is_internal=True,
            is_active=True,
            sort_order=10,
            created_by=self.user,
            updated_by=self.user,
        )

    def _build_order_payload(self, *, code, planned_carrier=None, planned_carrier_name=''):
        return {
            'code': code,
            'doc_type': 'SO',
            'order_date': timezone.localdate(),
            'status': SalesOrderStatus.DRAFT,
            'customer': self.customer.id,
            'currency': 'VND',
            'exchange_rate': '1',
            'lines': [
                {
                    'line_number': 1,
                    'product': self.product.id,
                    'qty': '10',
                    'unit_price': '15000',
                    'delivery_plans': [
                        {
                            'delivery_date': str(timezone.localdate()),
                            'qty': '10',
                            'planned_carrier': planned_carrier,
                            'planned_carrier_name': planned_carrier_name,
                        },
                    ],
                },
            ],
        }

    def _create_order_with_line(self, code):
        order = SalesOrder.objects.create(
            code=code,
            doc_type='SO',
            order_date=timezone.localdate(),
            status=SalesOrderStatus.APPROVED,
            customer=self.customer,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        line = SalesOrderLine.objects.create(
            sales_order=order,
            line_number=1,
            product=self.product,
            qty=Decimal('10'),
            unit_price=Decimal('15000'),
        )
        return order, line

    def _create_reservation(self, order, line, code):
        return InventoryReservation.objects.create(
            code=code,
            reservation_date=timezone.localdate(),
            sales_order=order,
            sales_order_line=line,
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            reserved_qty=Decimal('10'),
            created_by=self.user,
            updated_by=self.user,
        )

    def _create_on_hand_stock(self, code):
        return InventoryTransaction.objects.create(
            code=code,
            transaction_type=InventoryTransactionType.RECEIPT,
            status=InventoryTransactionStatus.POSTED,
            transaction_date=timezone.localdate(),
            product=self.product,
            warehouse=self.warehouse,
            location=self.location,
            quantity=Decimal('10'),
            unit_cost=Decimal('10000'),
            reference='SEED-CARRIER',
            reason='Nhập kho seed cho test master carrier',
            created_by=self.user,
            updated_by=self.user,
            posted_by=self.user,
        )

    def test_sales_order_serializer_saves_master_carrier_snapshot(self):
        serializer = SalesOrderSerializer(data=self._build_order_payload(
            code='SO-CARRIER-001',
            planned_carrier=self.master_carrier.id,
            planned_carrier_name='',
        ))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        order = serializer.save(created_by=self.user, updated_by=self.user, owner=self.user)
        plan = order.lines.get(line_number=1).delivery_plans.get()

        self.assertEqual(plan.planned_carrier_id, self.master_carrier.id)
        self.assertEqual(plan.planned_carrier_name, self.master_carrier.name)

    def test_sales_order_serializer_keeps_outside_catalog_snapshot(self):
        serializer = SalesOrderSerializer(data=self._build_order_payload(
            code='SO-CARRIER-002',
            planned_carrier=None,
            planned_carrier_name='Đơn vị giao thuê ngoài',
        ))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        order = serializer.save(created_by=self.user, updated_by=self.user, owner=self.user)
        plan = order.lines.get(line_number=1).delivery_plans.get()

        self.assertIsNone(plan.planned_carrier_id)
        self.assertEqual(plan.planned_carrier_name, 'Đơn vị giao thuê ngoài')

    def test_ship_action_saves_runtime_carrier_fk_and_snapshot(self):
        order, line = self._create_order_with_line('SO-CARRIER-003')
        self._create_on_hand_stock('INVTX-CARRIER-001')
        reservation = self._create_reservation(order, line, 'INVRSV-CARRIER-001')
        self.client.force_authenticate(self.user)

        response = self.client.post(
            f'/api/sales/orders/{order.id}/ship/',
            {
                'items': [
                    {
                        'reservation_id': reservation.id,
                        'quantity': '10',
                    },
                ],
                'transaction_date': str(timezone.localdate()),
                'carrier_id': self.master_carrier.id,
                'carrier_name': '',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)

        shipment = InventoryOutboundShipment.objects.get(pk=response.json()['shipment_id'])
        self.assertEqual(shipment.carrier_id, self.master_carrier.id)
        self.assertEqual(shipment.carrier_name, self.master_carrier.name)

    def test_ship_action_keeps_outside_catalog_snapshot(self):
        order, line = self._create_order_with_line('SO-CARRIER-004')
        self._create_on_hand_stock('INVTX-CARRIER-002')
        reservation = self._create_reservation(order, line, 'INVRSV-CARRIER-002')
        self.client.force_authenticate(self.user)

        response = self.client.post(
            f'/api/sales/orders/{order.id}/ship/',
            {
                'items': [
                    {
                        'reservation_id': reservation.id,
                        'quantity': '10',
                    },
                ],
                'transaction_date': str(timezone.localdate()),
                'carrier_id': None,
                'carrier_name': 'Đơn vị ngoài danh mục',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)

        shipment = InventoryOutboundShipment.objects.get(pk=response.json()['shipment_id'])
        self.assertIsNone(shipment.carrier_id)
        self.assertEqual(shipment.carrier_name, 'Đơn vị ngoài danh mục')

    def test_legacy_shipment_serializer_supports_master_and_outside_catalog(self):
        request = self.factory.post('/api/sales/shipments/')
        request.user = self.user
        serializer = OutboundShipmentSerializer(
            data={
                'customer': self.customer.id,
                'shipment_date': str(timezone.localdate()),
                'carrier_master': self.master_carrier.id,
                'carrier': '',
                'lines': [
                    {
                        'line_number': 1,
                        'product': self.product.id,
                        'qty_ordered': '1',
                        'qty_shipped': '1',
                        'qty_received': '0',
                        'unit_price': '15000',
                    },
                ],
            },
            context={'request': request},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        shipment = serializer.save()
        self.assertEqual(shipment.carrier_master_id, self.master_carrier.id)
        self.assertEqual(shipment.carrier, self.master_carrier.name)

        update_request = self.factory.patch(f'/api/sales/shipments/{shipment.id}/')
        update_request.user = self.user
        update_serializer = OutboundShipmentSerializer(
            instance=shipment,
            data={
                'carrier_master': None,
                'carrier': 'Đơn vị giao thuê ngoài',
            },
            partial=True,
            context={'request': update_request},
        )
        self.assertTrue(update_serializer.is_valid(), update_serializer.errors)
        shipment = update_serializer.save()
        self.assertIsNone(shipment.carrier_master_id)
        self.assertEqual(shipment.carrier, 'Đơn vị giao thuê ngoài')

    def test_delete_is_blocked_when_carrier_has_usage(self):
        order, line = self._create_order_with_line('SO-CARRIER-005')
        SalesOrderDeliveryPlan.objects.create(
            line=line,
            delivery_date=timezone.localdate(),
            qty=Decimal('10'),
            planned_carrier=self.master_carrier,
            planned_carrier_name=self.master_carrier.name,
        )
        self.client.force_authenticate(self.user)

        response = self.client.delete(f'/api/sales/delivery-carriers/{self.master_carrier.id}/')
        self.assertEqual(response.status_code, 400, response.content)
        self.master_carrier.refresh_from_db()
        self.assertTrue(self.master_carrier.is_active)
        self.assertIsNone(self.master_carrier.deleted_at)

    def test_sync_delivery_carriers_command_creates_and_links_exact_matches(self):
        order, line = self._create_order_with_line('SO-CARRIER-006')
        SalesOrderDeliveryPlan.objects.create(
            line=line,
            delivery_date=timezone.localdate(),
            qty=Decimal('10'),
            planned_carrier=None,
            planned_carrier_name='VietPost',
        )
        inventory_shipment = InventoryOutboundShipment.objects.create(
            code='SHIP-CARRIER-001',
            sales_order=order,
            shipment_date=timezone.localdate(),
            carrier=None,
            carrier_name='VietPost',
            created_by=self.user,
            updated_by=self.user,
        )
        legacy_request = self.factory.post('/api/sales/shipments/')
        legacy_request.user = self.user
        legacy_shipment = OutboundShipment.objects.create(
            code='SHIP-LEGACY-CARRIER-001',
            customer=self.customer,
            shipment_date=timezone.localdate(),
            carrier='VietPost',
            created_by=self.user,
        )

        self.master_carrier.delete()
        DeliveryCarrier.objects.all().delete()

        stdout = StringIO()
        call_command('sync_delivery_carriers', '--json', stdout=stdout)
        payload = stdout.getvalue().strip()
        self.assertTrue(payload)

        created_carrier = DeliveryCarrier.objects.get(name='VietPost')
        plan = SalesOrderDeliveryPlan.objects.get(line=line)
        inventory_shipment.refresh_from_db()
        legacy_shipment.refresh_from_db()

        self.assertEqual(plan.planned_carrier_id, created_carrier.id)
        self.assertEqual(inventory_shipment.carrier_id, created_carrier.id)
        self.assertEqual(legacy_shipment.carrier_master_id, created_carrier.id)
