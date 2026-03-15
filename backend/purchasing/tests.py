from datetime import timedelta

from rest_framework.test import APITestCase
from django.utils import timezone

from core.models import User
from inventory.models import InventoryTransaction, Warehouse, WarehouseLocation
from products.models import Product, ProductUnit
from purchasing.models import PurchaseOrder, PurchaseOrderLine, PurchaseReceipt


class PurchasingWorkflowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='purchasing_admin',
            password='Demo123!',
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(user=self.user)

        self.unit = ProductUnit.objects.create(code='CAI', name='Cái')
        self.product = Product.objects.create(
            code='SP-PO-001',
            name='Tấm carton test',
            unit=self.unit,
            cost_price=10000,
            sale_price=15000,
            status='ACTIVE',
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        self.warehouse = Warehouse.objects.create(
            code='KHO-MUA',
            name='Kho mua hàng',
            created_by=self.user,
            updated_by=self.user,
        )
        self.location = WarehouseLocation.objects.create(
            warehouse=self.warehouse,
            code='A-01',
            name='Kệ A-01',
            created_by=self.user,
            updated_by=self.user,
        )
        supplier_response = self.client.post('/api/purchasing/suppliers/', {
            'code': 'NCC-001',
            'name': 'Nhà cung cấp A',
            'company_name': 'Công ty NCC A',
            'payment_terms_days': 15,
        }, format='json')
        self.assertEqual(supplier_response.status_code, 201)
        self.supplier_id = supplier_response.data['id']

    def _create_purchase_order(self, qty='10'):
        response = self.client.post('/api/purchasing/orders/', {
            'order_date': '2026-03-13',
            'expected_receipt_date': '2026-03-16',
            'supplier': self.supplier_id,
            'warehouse': self.warehouse.id,
            'location': self.location.id,
            'reference': 'PO-REF-001',
            'notes': 'Đơn mua test',
            'lines': [
                {
                    'line_number': 1,
                    'product': self.product.id,
                    'qty': qty,
                    'unit_price': '12000',
                    'discount_pct': '0',
                    'tax_pct': '8',
                    'note': 'Dòng test',
                }
            ],
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_purchase_order_submit_approve_receive_creates_inventory(self):
        order = self._create_purchase_order()
        order_id = order['id']

        submit_response = self.client.post(f'/api/purchasing/orders/{order_id}/submit/', format='json')
        self.assertEqual(submit_response.status_code, 200, submit_response.data)
        self.assertEqual(submit_response.data['status'], 'SUBMITTED')

        approve_response = self.client.post(f'/api/purchasing/orders/{order_id}/approve/', format='json')
        self.assertEqual(approve_response.status_code, 200, approve_response.data)
        self.assertEqual(approve_response.data['status'], 'APPROVED')

        line = PurchaseOrderLine.objects.get(purchase_order_id=order_id, line_number=1)
        receive_response = self.client.post(
            f'/api/purchasing/orders/{order_id}/receive/',
            {
                'receipt_date': '2026-03-14',
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'reference': 'GRN-001',
                'items': [
                    {
                        'purchase_order_line': line.id,
                        'quantity': '10',
                        'unit_cost': '11800',
                        'note': 'Nhận đủ',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 201, receive_response.data)

        line.refresh_from_db()
        order_obj = PurchaseOrder.objects.get(pk=order_id)
        receipt = PurchaseReceipt.objects.get(pk=receive_response.data['id'])
        inventory_tx = InventoryTransaction.objects.get(purchase_receipt=receipt)

        self.assertEqual(str(line.received_qty), '10.0000')
        self.assertEqual(order_obj.status, 'RECEIVED')
        self.assertEqual(inventory_tx.transaction_type, 'RECEIPT')
        self.assertEqual(inventory_tx.purchase_order_id, order_id)
        self.assertEqual(inventory_tx.purchase_order_line_id, line.id)
        self.assertEqual(inventory_tx.purchase_receipt_id, receipt.id)

    def test_cancel_purchase_receipt_rolls_back_order_receiving(self):
        order = self._create_purchase_order(qty='8')
        order_id = order['id']
        self.client.post(f'/api/purchasing/orders/{order_id}/submit/', format='json')
        self.client.post(f'/api/purchasing/orders/{order_id}/approve/', format='json')

        line = PurchaseOrderLine.objects.get(purchase_order_id=order_id, line_number=1)
        receive_response = self.client.post(
            f'/api/purchasing/orders/{order_id}/receive/',
            {
                'receipt_date': '2026-03-14',
                'warehouse': self.warehouse.id,
                'location': self.location.id,
                'reference': 'GRN-002',
                'items': [
                    {
                        'purchase_order_line': line.id,
                        'quantity': '3',
                        'unit_cost': '11800',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 201, receive_response.data)
        receipt_id = receive_response.data['id']

        cancel_response = self.client.post(
            f'/api/purchasing/receipts/{receipt_id}/cancel/',
            {'reason': 'Hủy phiếu nhập test'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.data)
        self.assertEqual(cancel_response.data['status'], 'CANCELLED')

        line.refresh_from_db()
        order_obj = PurchaseOrder.objects.get(pk=order_id)
        receipt = PurchaseReceipt.objects.get(pk=receipt_id)
        inventory_tx = InventoryTransaction.objects.get(purchase_receipt=receipt)

        self.assertEqual(str(line.received_qty), '0.0000')
        self.assertEqual(order_obj.status, 'APPROVED')
        self.assertEqual(receipt.status, 'CANCELLED')
        self.assertEqual(inventory_tx.status, 'CANCELLED')

    def test_summary_endpoint_returns_procurement_counts(self):
        order = self._create_purchase_order(qty='6')
        order_id = order['id']
        order_obj = PurchaseOrder.objects.get(pk=order_id)
        order_obj.expected_receipt_date = timezone.localdate() - timedelta(days=1)
        order_obj.save(update_fields=['expected_receipt_date', 'updated_at'])
        self.client.post(f'/api/purchasing/orders/{order_id}/submit/', format='json')
        self.client.post(f'/api/purchasing/orders/{order_id}/approve/', format='json')

        response = self.client.get('/api/purchasing/orders/summary/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['approved_count'], 1)
        self.assertEqual(response.data['waiting_receipt_count'], 1)
        self.assertEqual(response.data['overdue_receipt_count'], 1)
