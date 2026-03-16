from datetime import timedelta

from rest_framework.test import APITestCase
from django.utils import timezone

from core.models import User
from inventory.models import InventoryTransaction, Warehouse, WarehouseLocation
from products.models import Product, ProductUnit
from production.models import (
    ProductionIssue,
    ProductionMaterialRequirement,
    ProductionOperation,
    ProductionOrder,
    ProductionReceipt,
)


class ProductionWorkflowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='production_admin',
            password='Demo123!',
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(user=self.user)

        self.unit = ProductUnit.objects.create(code='CAI', name='Cái')
        self.finished_product = Product.objects.create(
            code='FG-001',
            name='Thùng carton hoàn chỉnh',
            unit=self.unit,
            cost_price=25000,
            sale_price=40000,
            process_xa=3000,
            process_in=2500,
            process_be=1200,
            status='ACTIVE',
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        self.material_product = Product.objects.create(
            code='RM-001',
            name='Tấm carton nguyên liệu',
            unit=self.unit,
            cost_price=10000,
            sale_price=0,
            parent=self.finished_product,
            component_quantity=2,
            status='ACTIVE',
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        self.rm_warehouse = Warehouse.objects.create(
            code='KHO-RM',
            name='Kho nguyên liệu',
            created_by=self.user,
            updated_by=self.user,
        )
        self.rm_location = WarehouseLocation.objects.create(
            warehouse=self.rm_warehouse,
            code='RM-A1',
            name='Kệ nguyên liệu A1',
            created_by=self.user,
            updated_by=self.user,
        )
        self.fg_warehouse = Warehouse.objects.create(
            code='KHO-FG',
            name='Kho thành phẩm',
            created_by=self.user,
            updated_by=self.user,
        )
        self.fg_location = WarehouseLocation.objects.create(
            warehouse=self.fg_warehouse,
            code='FG-A1',
            name='Kệ thành phẩm A1',
            created_by=self.user,
            updated_by=self.user,
        )
        InventoryTransaction.objects.create(
            code='INVTX-TEST-RM-001',
            transaction_type='RECEIPT',
            transaction_date='2026-03-12',
            product=self.material_product,
            warehouse=self.rm_warehouse,
            location=self.rm_location,
            quantity='100',
            unit_cost='9500',
            posted_by=self.user,
            created_by=self.user,
            updated_by=self.user,
        )

    def _create_production_order(self, planned_qty='5'):
        response = self.client.post('/api/production/orders/', {
            'order_date': '2026-03-13',
            'planned_start_date': '2026-03-14',
            'planned_end_date': '2026-03-16',
            'product': self.finished_product.id,
            'planned_qty': planned_qty,
            'target_warehouse': self.fg_warehouse.id,
            'target_location': self.fg_location.id,
            'notes': 'Lệnh sản xuất test',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def _release_order(self, order_id):
        self.client.post(f'/api/production/orders/{order_id}/submit/', format='json')
        self.client.post(f'/api/production/orders/{order_id}/approve/', format='json')
        release_response = self.client.post(f'/api/production/orders/{order_id}/release/', format='json')
        self.assertEqual(release_response.status_code, 200, release_response.data)
        self.assertEqual(release_response.data['status'], 'RELEASED')

    def test_production_flow_creates_operations_issue_and_receipt(self):
        order = self._create_production_order(planned_qty='5')
        order_id = order['id']

        requirement = ProductionMaterialRequirement.objects.get(production_order_id=order_id, line_number=1)
        operations = list(ProductionOperation.objects.filter(production_order_id=order_id).order_by('sequence'))
        self.assertEqual(len(operations), 3)
        self.assertEqual(str(requirement.required_qty), '10.0000')

        self._release_order(order_id)

        issue_response = self.client.post(
            f'/api/production/orders/{order_id}/issue_materials/',
            {
                'issue_date': '2026-03-14',
                'items': [
                    {
                        'material_requirement': requirement.id,
                        'warehouse': self.rm_warehouse.id,
                        'location': self.rm_location.id,
                        'quantity': '10',
                        'unit_cost': '9800',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(issue_response.status_code, 201, issue_response.data)

        receive_response = self.client.post(
            f'/api/production/orders/{order_id}/receive_output/',
            {
                'receipt_date': '2026-03-15',
                'warehouse': self.fg_warehouse.id,
                'location': self.fg_location.id,
                'items': [
                    {
                        'quantity': '5',
                        'unit_cost': '28000',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 201, receive_response.data)

        order_obj = ProductionOrder.objects.get(pk=order_id)
        requirement.refresh_from_db()
        issue = ProductionIssue.objects.get(production_order_id=order_id)
        receipt = ProductionReceipt.objects.get(production_order_id=order_id)
        issue_tx = InventoryTransaction.objects.get(production_issue=issue)
        receipt_tx = InventoryTransaction.objects.get(production_receipt=receipt)

        self.assertEqual(order_obj.status, 'COMPLETED')
        self.assertEqual(str(order_obj.produced_qty), '5.0000')
        self.assertEqual(str(requirement.issued_qty), '10.0000')
        self.assertEqual(issue_tx.transaction_type, 'ISSUE')
        self.assertEqual(receipt_tx.transaction_type, 'RECEIPT')
        self.assertEqual(issue_tx.production_order_id, order_id)
        self.assertEqual(receipt_tx.production_order_id, order_id)
        self.finished_product.refresh_from_db()
        self.assertEqual(str(self.finished_product.cost_price), '28000.00')

    def test_cancel_production_issue_rolls_back_issued_qty(self):
        order = self._create_production_order(planned_qty='4')
        order_id = order['id']
        requirement = ProductionMaterialRequirement.objects.get(production_order_id=order_id, line_number=1)
        self._release_order(order_id)

        issue_response = self.client.post(
            f'/api/production/orders/{order_id}/issue_materials/',
            {
                'issue_date': '2026-03-14',
                'items': [
                    {
                        'material_requirement': requirement.id,
                        'warehouse': self.rm_warehouse.id,
                        'location': self.rm_location.id,
                        'quantity': '8',
                        'unit_cost': '10000',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(issue_response.status_code, 201, issue_response.data)
        issue_id = issue_response.data['id']

        cancel_response = self.client.post(
            f'/api/production/issues/{issue_id}/cancel/',
            {'reason': 'Hủy cấp vật tư test'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.data)
        self.assertEqual(cancel_response.data['status'], 'CANCELLED')

        requirement.refresh_from_db()
        order_obj = ProductionOrder.objects.get(pk=order_id)
        issue = ProductionIssue.objects.get(pk=issue_id)
        issue_tx = InventoryTransaction.objects.get(production_issue=issue)

        self.assertEqual(str(requirement.issued_qty), '0.0000')
        self.assertEqual(order_obj.status, 'RELEASED')
        self.assertEqual(issue.status, 'CANCELLED')
        self.assertEqual(issue_tx.status, 'CANCELLED')

    def test_cancel_production_receipt_rolls_back_output_qty(self):
        order = self._create_production_order(planned_qty='3')
        order_id = order['id']
        self._release_order(order_id)

        receive_response = self.client.post(
            f'/api/production/orders/{order_id}/receive_output/',
            {
                'receipt_date': '2026-03-15',
                'warehouse': self.fg_warehouse.id,
                'location': self.fg_location.id,
                'items': [
                    {
                        'quantity': '2',
                        'unit_cost': '25000',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 201, receive_response.data)
        receipt_id = receive_response.data['id']

        cancel_response = self.client.post(
            f'/api/production/receipts/{receipt_id}/cancel/',
            {'reason': 'Hủy nhập kho test'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.data)
        self.assertEqual(cancel_response.data['status'], 'CANCELLED')

        order_obj = ProductionOrder.objects.get(pk=order_id)
        receipt = ProductionReceipt.objects.get(pk=receipt_id)
        receipt_tx = InventoryTransaction.objects.get(production_receipt=receipt)

        self.assertEqual(str(order_obj.produced_qty), '0.0000')
        self.assertEqual(order_obj.status, 'RELEASED')
        self.assertEqual(receipt.status, 'CANCELLED')
        self.assertEqual(receipt_tx.status, 'CANCELLED')

    def test_summary_endpoint_returns_active_and_overdue_counts(self):
        order = self._create_production_order(planned_qty='2')
        order_id = order['id']
        order_obj = ProductionOrder.objects.get(pk=order_id)
        order_obj.planned_end_date = timezone.localdate() - timedelta(days=1)
        order_obj.save(update_fields=['planned_end_date', 'updated_at'])
        self._release_order(order_id)

        response = self.client.get('/api/production/orders/summary/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['active_count'], 1)
        self.assertEqual(response.data['overdue_plan_count'], 1)
