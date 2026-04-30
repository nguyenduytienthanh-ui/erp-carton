from datetime import timedelta

from django.db import IntegrityError, transaction
from rest_framework.test import APITestCase
from django.utils import timezone

from core.models import ApprovalHistory, AuditLog, Customer, User
from inventory.models import InventoryTransaction, Warehouse, WarehouseLocation
from products.models import Product, ProductUnit
from production.models import (
    ProductionDemand,
    ProductionDemandPlanningStatus,
    ProductionDemandPriority,
    ProductionDemandProductionStatus,
    ProductionIssue,
    ProductionMaterialRequirement,
    ProductionOperation,
    ProductionOrder,
    ProductionReceipt,
)
from sales.models import SalesOrder, SalesOrderDeliveryPlan, SalesOrderLine


class ProductionDemandModelTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='production_demand_admin',
            password='Demo123!',
            is_staff=True,
            is_superuser=True,
        )
        self.customer = Customer.objects.create(
            code='PD-CUST-001',
            name='Production Demand Customer',
            created_by=self.user,
            updated_by=self.user,
        )
        self.unit = ProductUnit.objects.create(code='PD-UNIT', name='Unit')
        self.product = Product.objects.create(
            code='PD-FG-001',
            name='Production Demand Finished Good',
            unit=self.unit,
            cost_price=25000,
            sale_price=40000,
            process_in=20000,
            process_be=8500,
            status='ACTIVE',
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        self.order = SalesOrder.objects.create(
            code='SO-PD-001',
            order_date=timezone.localdate(),
            delivery_date=timezone.localdate() + timedelta(days=10),
            customer=self.customer,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        self.line = SalesOrderLine.objects.create(
            sales_order=self.order,
            line_number=1,
            product=self.product,
            qty='10',
            uom='PD-UNIT',
            unit_price='40000',
        )
        self.delivery_plan = SalesOrderDeliveryPlan.objects.create(
            line=self.line,
            delivery_date=timezone.localdate() + timedelta(days=10),
            qty='6',
        )

    def _create_demand(self, **overrides):
        data = {
            'demand_key': 'SO:1:LINE:1:PLAN:1',
            'sales_order': self.order,
            'sales_order_line': self.line,
            'delivery_plan': self.delivery_plan,
            'product': self.product,
            'customer_id_snapshot': self.customer.id,
            'customer_name_snapshot': self.customer.name,
            'product_code': self.product.code,
            'product_name': self.product.name,
            'product_kind': 'GENERIC',
            'unit_name': self.unit.name,
            'size_order': '20x30',
            'size_production': '21x31',
            'print_colors': ['Black', 'Red'],
            'operations_summary': [{'operation_code': 'IN', 'applied_rate_per_hour': 20000}],
            'routing_summary': [{'step_no': 10, 'operation_code': 'IN'}],
            'qty_required': '10',
            'order_date': self.order.order_date,
            'delivery_date': self.delivery_plan.delivery_date,
            'source': 'SALES_ORDER',
            'created_by': self.user,
            'updated_by': self.user,
        }
        data.update(overrides)
        return ProductionDemand.objects.create(**data)

    def test_create_production_demand_with_delivery_plan(self):
        demand = self._create_demand()

        self.assertEqual(demand.sales_order_id, self.order.id)
        self.assertEqual(demand.sales_order_line_id, self.line.id)
        self.assertEqual(demand.delivery_plan_id, self.delivery_plan.id)
        self.assertEqual(demand.product_id, self.product.id)
        self.assertEqual(demand.product_code, self.product.code)
        self.assertEqual(demand.print_colors, ['Black', 'Red'])
        self.assertIn('pd-fg-001', demand.search_text)

    def test_delivery_plan_is_nullable(self):
        demand = self._create_demand(
            demand_key='SO:1:LINE:1:DEFAULT',
            delivery_plan=None,
            delivery_date=self.order.delivery_date,
        )

        self.assertIsNone(demand.delivery_plan_id)
        self.assertEqual(demand.delivery_date, self.order.delivery_date)

    def test_demand_key_is_unique(self):
        self._create_demand(demand_key='SO:1:LINE:1:PLAN:UNIQUE')

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self._create_demand(demand_key='SO:1:LINE:1:PLAN:UNIQUE')

    def test_remaining_quantity_properties_are_clamped(self):
        demand = self._create_demand(
            qty_required='10',
            qty_planned='4',
            qty_released='3',
            qty_completed='7',
        )

        self.assertEqual(str(demand.qty_remaining_to_plan), '6.0000')
        self.assertEqual(str(demand.qty_remaining_to_release), '7.0000')
        self.assertEqual(str(demand.qty_remaining_to_complete), '3.0000')

        demand.qty_planned = '12'
        demand.qty_released = '12'
        demand.qty_completed = '12'
        self.assertEqual(str(demand.qty_remaining_to_plan), '0.0000')
        self.assertEqual(str(demand.qty_remaining_to_release), '0.0000')
        self.assertEqual(str(demand.qty_remaining_to_complete), '0.0000')

    def test_default_status_and_priority(self):
        demand = self._create_demand()

        self.assertEqual(demand.planning_status, ProductionDemandPlanningStatus.NOT_DUE)
        self.assertEqual(demand.production_status, ProductionDemandProductionStatus.NOT_RELEASED)
        self.assertEqual(demand.priority, ProductionDemandPriority.NORMAL)


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

    def _issue_all_materials(self, order_id):
        requirement = ProductionMaterialRequirement.objects.get(production_order_id=order_id, line_number=1)
        response = self.client.post(
            f'/api/production/orders/{order_id}/issue_materials/',
            {
                'issue_date': timezone.localdate().isoformat(),
                'items': [
                    {
                        'material_requirement': requirement.id,
                        'warehouse': self.rm_warehouse.id,
                        'location': self.rm_location.id,
                        'quantity': str(requirement.remaining_issue_qty),
                        'unit_cost': '9800',
                    }
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

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

    def test_production_receipt_supports_partial_output_packaging_and_qr_scan(self):
        order = self._create_production_order(planned_qty='5')
        order_id = order['id']
        self._release_order(order_id)

        receive_response = self.client.post(
            f'/api/production/orders/{order_id}/receive_output/',
            {
                'receipt_date': '2026-03-15',
                'warehouse': self.fg_warehouse.id,
                'location': self.fg_location.id,
                'quantity': '2',
                'unit_cost': '28000',
                'bundle_count': 2,
                'units_per_bundle': '1',
                'pallet_count': 1,
                'bundles_per_pallet': '2',
                'note': 'Nhap dot 1',
            },
            format='json',
        )
        self.assertEqual(receive_response.status_code, 201, receive_response.data)

        order_obj = ProductionOrder.objects.get(pk=order_id)
        receipt = ProductionReceipt.objects.get(pk=receive_response.data['id'])
        line = receipt.lines.get(line_number=1)
        trace_code = f'{self.finished_product.code}|20260313|{order_obj.code}'

        self.assertEqual(order_obj.status, 'IN_PROGRESS')
        self.assertEqual(str(order_obj.produced_qty), '2.0000')
        self.assertEqual(str(order_obj.remaining_qty), '3.0000')
        self.assertEqual(receive_response.data['lines'][0]['trace_code'], trace_code)
        self.assertEqual(receive_response.data['lines'][0]['bundle_count'], 2)
        self.assertEqual(receive_response.data['lines'][0]['units_per_bundle'], '1.0000')
        self.assertEqual(receive_response.data['lines'][0]['pallet_count'], 1)
        self.assertEqual(receive_response.data['lines'][0]['bundles_per_pallet'], '2.0000')
        self.assertEqual(receive_response.data['lines'][0]['packaging_summary'], '2 goi lon | 1 cai/goi | 1 pallet | 2 goi/pallet')
        self.assertEqual(line.bundle_count, 2)

        scan_response = self.client.post(
            f'/api/production/receipts/{receipt.id}/scan_receipt_qr/',
            {'scan_value': trace_code},
            format='json',
        )
        self.assertEqual(scan_response.status_code, 200, scan_response.data)
        self.assertEqual(scan_response.data['scan_status'], 'MATCHED')
        self.assertEqual(scan_response.data['match_mode'], 'ROOT_QR')
        self.assertEqual(scan_response.data['match']['trace_code'], trace_code)
        self.assertEqual(scan_response.data['match']['production_order_code'], order_obj.code)
        self.assertEqual(scan_response.data['match']['packaging_summary'], '2 goi lon | 1 cai/goi | 1 pallet | 2 goi/pallet')

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

    def test_production_issue_exposes_next_states_and_lifecycle_history(self):
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

        next_states_response = self.client.get(f'/api/production/issues/{issue_id}/next_states/')
        self.assertEqual(next_states_response.status_code, 200, next_states_response.data)
        self.assertEqual(next_states_response.data['current'], 'POSTED')
        self.assertEqual(next_states_response.data['next_states'], ['CANCELLED'])

        history_response = self.client.get(f'/api/production/issues/{issue_id}/lifecycle_history/')
        self.assertEqual(history_response.status_code, 200, history_response.data)
        self.assertEqual(history_response.data[0]['action'], 'ISSUE')
        self.assertEqual(history_response.data[0]['action_label'], 'Đã cấp vật tư')
        self.assertIn('Số lượng', history_response.data[0]['comments'])

        cancel_response = self.client.post(
            f'/api/production/issues/{issue_id}/cancel/',
            {'reason': 'Huy cap vat tu de doi soat'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.data)
        self.assertEqual(cancel_response.data['status'], 'CANCELLED')

        cancelled_states = self.client.get(f'/api/production/issues/{issue_id}/next_states/')
        self.assertEqual(cancelled_states.status_code, 200, cancelled_states.data)
        self.assertEqual(cancelled_states.data['current'], 'CANCELLED')
        self.assertEqual(cancelled_states.data['next_states'], [])

        cancelled_history = self.client.get(f'/api/production/issues/{issue_id}/lifecycle_history/')
        self.assertEqual(cancelled_history.status_code, 200, cancelled_history.data)
        self.assertEqual([item['action'] for item in cancelled_history.data[:2]], ['CANCEL', 'ISSUE'])
        self.assertEqual(cancelled_history.data[0]['action_label'], 'Đã hủy')
        self.assertEqual(cancelled_history.data[0]['comments'], 'Huy cap vat tu de doi soat')

        audit_rows = AuditLog.objects.filter(entity_type='ProductionIssue', entity_id=issue_id)
        self.assertEqual(audit_rows.count(), 2)

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

    def test_production_receipt_exposes_next_states_and_lifecycle_history(self):
        order = self._create_production_order(planned_qty='4')
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

        next_states_response = self.client.get(f'/api/production/receipts/{receipt_id}/next_states/')
        self.assertEqual(next_states_response.status_code, 200, next_states_response.data)
        self.assertEqual(next_states_response.data['current'], 'POSTED')
        self.assertEqual(next_states_response.data['next_states'], ['CANCELLED'])

        history_response = self.client.get(f'/api/production/receipts/{receipt_id}/lifecycle_history/')
        self.assertEqual(history_response.status_code, 200, history_response.data)
        self.assertEqual(history_response.data[0]['action'], 'RECEIVE')
        self.assertEqual(history_response.data[0]['action_label'], 'Đã ghi nhận')
        self.assertIn('Số lượng', history_response.data[0]['comments'])

        cancel_response = self.client.post(
            f'/api/production/receipts/{receipt_id}/cancel/',
            {'reason': 'Huy doi soat nhap thanh pham'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.data)

        cancelled_states = self.client.get(f'/api/production/receipts/{receipt_id}/next_states/')
        self.assertEqual(cancelled_states.status_code, 200, cancelled_states.data)
        self.assertEqual(cancelled_states.data['current'], 'CANCELLED')
        self.assertEqual(cancelled_states.data['next_states'], [])

        cancelled_history = self.client.get(f'/api/production/receipts/{receipt_id}/lifecycle_history/')
        self.assertEqual(cancelled_history.status_code, 200, cancelled_history.data)
        self.assertEqual([item['action'] for item in cancelled_history.data[:2]], ['CANCEL', 'RECEIVE'])
        self.assertEqual(cancelled_history.data[0]['action_label'], 'Đã hủy')
        self.assertEqual(cancelled_history.data[0]['comments'], 'Huy doi soat nhap thanh pham')

        audit_rows = AuditLog.objects.filter(entity_type='ProductionReceipt', entity_id=receipt_id)
        self.assertEqual(audit_rows.count(), 2)

    def test_summary_endpoint_returns_active_and_overdue_counts(self):
        order = self._create_production_order(planned_qty='2')
        order_id = order['id']
        order_obj = ProductionOrder.objects.get(pk=order_id)
        order_obj.planned_end_date = timezone.localdate() - timedelta(days=1)
        order_obj.save(update_fields=['planned_end_date', 'updated_at'])
        self._release_order(order_id)
        self._issue_all_materials(order_id)
        operations = list(ProductionOperation.objects.filter(production_order_id=order_id).order_by('sequence'))
        today = timezone.localdate()

        overdue_response = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[0].id,
                'planned_date': (today - timedelta(days=1)).isoformat(),
                'planned_shift': 'MORNING',
                'priority_rank': 1,
            },
            format='json',
        )
        self.assertEqual(overdue_response.status_code, 200, overdue_response.data)

        blocked_response = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[1].id,
                'planned_date': today.isoformat(),
                'planned_shift': 'AFTERNOON',
                'priority_rank': 2,
                'block_reason_code': 'WAIT_PREVIOUS_STEP',
                'block_reason_note': 'Cho line truoc ban giao',
            },
            format='json',
        )
        self.assertEqual(blocked_response.status_code, 200, blocked_response.data)

        response = self.client.get('/api/production/orders/summary/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['active_count'], 1)
        self.assertEqual(response.data['overdue_plan_count'], 1)
        self.assertEqual(response.data['planner_digest']['overdue_operations'], 1)
        self.assertGreaterEqual(response.data['planner_digest']['ready_to_run_count'], 1)
        self.assertEqual(response.data['planner_digest']['wait_material_count'], 0)
        self.assertEqual(response.data['planner_digest']['wait_previous_step_count'], 2)
        self.assertEqual(response.data['planner_digest']['machine_down_count'], 0)
        self.assertEqual(response.data['planner_digest']['over_capacity_count'], 0)
        self.assertEqual(response.data['planner_digest']['at_limit_count'], 0)
        self.assertEqual(response.data['planner_digest']['over_capacity_slot_count'], 0)
        self.assertEqual(response.data['planner_digest']['unscheduled_count'], 1)
        self.assertEqual(response.data['planner_digest']['blocked_count'], 1)
        self.assertEqual(response.data['planner_digest']['handover_ready_count'], 0)
        self.assertEqual(response.data['planner_digest']['handover_accepted_count'], 0)
        self.assertEqual(response.data['planner_digest']['unassigned_machine_count'], 0)
        self.assertEqual(response.data['planner_digest']['unassigned_work_center_count'], 3)
        self.assertEqual(response.data['planner_digest']['affected_sales_order_count'], 0)

    def test_summary_endpoint_returns_hot_window_and_queue_focus(self):
        order = self._create_production_order(planned_qty='6')
        order_id = order['id']
        self._release_order(order_id)
        self._issue_all_materials(order_id)
        operations = list(ProductionOperation.objects.filter(production_order_id=order_id).order_by('sequence'))
        today = timezone.localdate()

        first_response = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[0].id,
                'status': 'READY',
                'planned_date': today.isoformat(),
                'planned_shift': 'MORNING',
                'work_center_code': 'IN',
                'work_center_name': 'Line In',
                'machine_code': 'IN-01',
                'machine_name': 'May In 01',
                'estimated_runtime_hours': '4.50',
                'setup_minutes': 30,
            },
            format='json',
        )
        self.assertEqual(first_response.status_code, 200, first_response.data)

        second_response = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[1].id,
                'status': 'READY',
                'planned_date': today.isoformat(),
                'planned_shift': 'MORNING',
                'work_center_code': 'IN',
                'work_center_name': 'Line In',
                'machine_code': 'IN-01',
                'machine_name': 'May In 01',
                'estimated_runtime_hours': '4.00',
                'setup_minutes': 20,
            },
            format='json',
        )
        self.assertEqual(second_response.status_code, 200, second_response.data)

        third_response = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[2].id,
                'status': 'READY',
                'planned_date': (today + timedelta(days=1)).isoformat(),
                'planned_shift': 'AFTERNOON',
                'work_center_code': 'BE',
                'work_center_name': 'Line Be',
                'machine_code': 'BE-02',
                'machine_name': 'May Be 02',
                'estimated_runtime_hours': '7.00',
                'setup_minutes': 0,
            },
            format='json',
        )
        self.assertEqual(third_response.status_code, 200, third_response.data)

        response = self.client.get('/api/production/orders/summary/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertGreaterEqual(response.data['planner_digest']['over_capacity_count'], 1)
        self.assertGreaterEqual(response.data['planner_digest']['at_limit_count'], 1)
        self.assertEqual(response.data['planner_digest']['hot_over_capacity_window']['shift_key'], 'MORNING')
        self.assertIn('capacity_state=OVER_CAPACITY', response.data['planner_digest']['hot_over_capacity_window']['focus_url'])
        self.assertEqual(response.data['planner_digest']['hot_at_limit_window']['shift_key'], 'AFTERNOON')
        self.assertIn('capacity_state=AT_LIMIT', response.data['planner_digest']['hot_at_limit_window']['focus_url'])
        self.assertEqual(response.data['planner_digest']['hot_machine_queue']['machine_code'], 'IN-01')
        self.assertIn('queue_key=IN-01', response.data['planner_digest']['hot_machine_queue']['focus_url'])

    def test_summary_endpoint_returns_hot_owner_sales_and_material_focus(self):
        customer = Customer.objects.create(
            code='CUS-PLAN',
            name='Khach planner',
            created_by=self.user,
            updated_by=self.user,
        )
        sales_order = SalesOrder.objects.create(
            code='SO-PLAN-001',
            order_date=timezone.localdate(),
            delivery_date=timezone.localdate() + timedelta(days=2),
            customer=customer,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        order = self._create_production_order(planned_qty='4')
        order_id = order['id']
        production_order = ProductionOrder.objects.get(pk=order_id)
        production_order.sales_order = sales_order
        production_order.reference = sales_order.code
        production_order.save(update_fields=['sales_order', 'reference', 'updated_at'])
        self._release_order(order_id)
        operation = ProductionOperation.objects.get(production_order_id=order_id, sequence=1)
        planned_date = timezone.localdate().isoformat()

        updated = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operation.id,
                'status': 'READY',
                'planned_date': planned_date,
                'planned_shift': 'MORNING',
                'work_center_code': 'IN',
                'work_center_name': 'Line In',
                'machine_code': 'IN-01',
                'machine_name': 'May In 01',
                'estimated_runtime_hours': '2.50',
                'setup_minutes': 15,
            },
            format='json',
        )
        self.assertEqual(updated.status_code, 200, updated.data)
        owner_signal = self.client.post(
            '/api/production/orders/shop_floor_signal/',
            {
                'items': [{'order_id': order_id, 'operation_id': operation.id}],
                'signal_code': 'READY',
                'dispatch_owner': 'Ca A',
            },
            format='json',
        )
        self.assertEqual(owner_signal.status_code, 200, owner_signal.data)

        response = self.client.get('/api/production/orders/summary/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['planner_digest']['hot_dispatch_owner']['dispatch_owner'], 'Ca A')
        self.assertIn('dispatch_owner=Ca+A', response.data['planner_digest']['hot_dispatch_owner']['focus_url'])
        self.assertEqual(response.data['planner_digest']['hot_sales_order']['sales_order_code'], sales_order.code)
        self.assertIn('sales_order_code=SO-PLAN-001', response.data['planner_digest']['hot_sales_order']['focus_url'])
        self.assertEqual(response.data['planner_digest']['hot_material_wait']['material_product_code'], self.material_product.code)
        self.assertIn('material_product_code=RM-001', response.data['planner_digest']['hot_material_wait']['focus_url'])
        self.assertEqual(response.data['planner_digest']['hot_work_center']['work_center_code'], 'IN')
        self.assertIn('work_center_code=IN', response.data['planner_digest']['hot_work_center']['focus_url'])
        self.assertEqual(response.data['planner_digest']['hot_machine']['machine_code'], 'IN-01')
        self.assertIn('machine_code=IN-01', response.data['planner_digest']['hot_machine']['focus_url'])
        self.assertEqual(str(response.data['planner_digest']['hot_delivery_date']['delivery_due_date']), str(production_order.planned_end_date))
        self.assertIn('delivery_due_date=', response.data['planner_digest']['hot_delivery_date']['focus_url'])
        self.assertIn('bucket_key=UNSCHEDULED', response.data['planner_digest']['hot_unscheduled_step']['focus_url'])
        self.assertIsNotNone(response.data['planner_digest']['hot_shift_watch'])
        self.assertIn('planned_shift=', response.data['planner_digest']['hot_shift_watch']['focus_url'])
        self.assertIsNotNone(response.data['planner_digest']['hot_date_watch'])
        self.assertTrue(
            'planned_date=' in response.data['planner_digest']['hot_date_watch']['focus_url']
            or 'bucket_key=UNSCHEDULED' in response.data['planner_digest']['hot_date_watch']['focus_url']
        )
        self.assertEqual(response.data['planner_digest']['hot_owner_capacity']['dispatch_owner'], 'Ca A')
        self.assertIn('dispatch_owner=Ca+A', response.data['planner_digest']['hot_owner_capacity']['focus_url'])
        self.assertIsNotNone(response.data['planner_digest']['hot_step_watch'])
        self.assertIn('step_code=', response.data['planner_digest']['hot_step_watch']['focus_url'])
        self.assertIn('hot_rebalance_summary', response.data['planner_digest'])

    def test_update_operation_supports_planning_fields_and_audits_reschedule(self):
        order = self._create_production_order(planned_qty='3')
        order_id = order['id']
        self._release_order(order_id)
        operation = ProductionOperation.objects.get(production_order_id=order_id, sequence=1)
        planned_date = timezone.localdate().isoformat()

        response = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operation.id,
                'planned_date': planned_date,
                'planned_shift': 'MORNING',
                'priority_rank': 5,
                'dispatch_sequence': 7,
                'work_center_code': 'IN',
                'work_center_name': 'Line In',
                'machine_code': 'IN-01',
                'machine_name': 'May In 01',
                'estimated_runtime_hours': '5.50',
                'setup_minutes': 45,
                'block_reason_code': 'WAIT_MATERIAL',
                'block_reason_note': 'Cho xuat kho giay',
                'note': 'Uu tien dau ca',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)

        operation.refresh_from_db()
        self.assertEqual(str(operation.planned_date), planned_date)
        self.assertEqual(operation.planned_shift, 'MORNING')
        self.assertEqual(operation.priority_rank, 5)
        self.assertEqual(operation.dispatch_sequence, 7)
        self.assertEqual(operation.work_center_code, 'IN')
        self.assertEqual(operation.work_center_name, 'Line In')
        self.assertEqual(operation.machine_code, 'IN-01')
        self.assertEqual(operation.machine_name, 'May In 01')
        self.assertEqual(str(operation.estimated_runtime_hours), '5.50')
        self.assertEqual(operation.setup_minutes, 45)
        self.assertEqual(operation.block_reason_code, 'WAIT_MATERIAL')
        self.assertEqual(operation.block_reason_note, 'Cho xuat kho giay')
        self.assertEqual(response.data['operation']['risk_state'], 'BLOCKED')
        self.assertEqual(response.data['operation']['material_readiness'], 'WAITING')
        self.assertTrue(response.data['operation']['planned_shift_label'])
        self.assertTrue(response.data['operation']['block_reason_label'])

        audit = AuditLog.objects.filter(entity_type='ProductionOperation', entity_id=operation.id).latest('id')
        self.assertEqual(audit.action, 'UPDATE')
        self.assertEqual(audit.new_values['planned_shift'], 'MORNING')
        self.assertEqual(audit.new_values['priority_rank'], 5)
        self.assertEqual(audit.new_values['dispatch_sequence'], 7)
        self.assertEqual(audit.new_values['work_center_code'], 'IN')
        self.assertEqual(audit.new_values['machine_code'], 'IN-01')
        self.assertEqual(audit.new_values['estimated_runtime_hours'], '5.50')
        self.assertEqual(audit.new_values['setup_minutes'], 45)
        self.assertEqual(audit.new_values['block_reason_code'], 'WAIT_MATERIAL')
        self.assertEqual(audit.new_values['risk_state'], 'BLOCKED')

    def test_update_operation_rejects_planning_change_when_order_not_released(self):
        order = self._create_production_order(planned_qty='3')
        order_id = order['id']
        operation = ProductionOperation.objects.get(production_order_id=order_id, sequence=1)

        response = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operation.id,
                'planned_date': timezone.localdate().isoformat(),
                'planned_shift': 'AFTERNOON',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        operation.refresh_from_db()
        self.assertIsNone(operation.planned_date)
        self.assertEqual(operation.planned_shift, '')

    def test_update_operation_requires_note_for_other_block_reason_and_clears_block_when_done(self):
        order = self._create_production_order(planned_qty='3')
        order_id = order['id']
        self._release_order(order_id)
        operation = ProductionOperation.objects.get(production_order_id=order_id, sequence=1)

        missing_note = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operation.id,
                'block_reason_code': 'OTHER',
            },
            format='json',
        )
        self.assertEqual(missing_note.status_code, 400, missing_note.data)
        self.assertIn('Khac', missing_note.data['error'])

        blocked = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operation.id,
                'planned_date': timezone.localdate().isoformat(),
                'block_reason_code': 'MACHINE_DOWN',
                'block_reason_note': 'Dung may de doi dao',
            },
            format='json',
        )
        self.assertEqual(blocked.status_code, 200, blocked.data)

        done = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operation.id,
                'status': 'DONE',
            },
            format='json',
        )
        self.assertEqual(done.status_code, 200, done.data)
        operation.refresh_from_db()
        self.assertEqual(operation.block_reason_code, '')
        self.assertEqual(operation.block_reason_note, '')

    def test_planning_board_returns_summary_lanes_watchlist_and_filters(self):
        order = self._create_production_order(planned_qty='5')
        order_id = order['id']
        self._release_order(order_id)
        self._issue_all_materials(order_id)
        operations = list(ProductionOperation.objects.filter(production_order_id=order_id).order_by('sequence'))
        today = timezone.localdate()

        first_response = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[0].id,
                'planned_date': (today - timedelta(days=1)).isoformat(),
                'planned_shift': 'MORNING',
                'priority_rank': 1,
                'note': 'Qua han can keo lai',
            },
            format='json',
        )
        self.assertEqual(first_response.status_code, 200, first_response.data)

        second_response = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[1].id,
                'planned_date': today.isoformat(),
                'planned_shift': 'AFTERNOON',
                'priority_rank': 2,
                'block_reason_code': 'WAIT_PREVIOUS_STEP',
                'block_reason_note': 'Cho buoc in xong',
            },
            format='json',
        )
        self.assertEqual(second_response.status_code, 200, second_response.data)

        board_response = self.client.get('/api/production/orders/planning_board/')
        self.assertEqual(board_response.status_code, 200, board_response.data)
        self.assertEqual(board_response.data['summary']['total_orders'], 1)
        self.assertEqual(board_response.data['summary']['total_operations'], 3)
        self.assertEqual(board_response.data['summary']['overdue_operations'], 1)
        self.assertEqual(board_response.data['summary']['wait_previous_step_count'], 2)
        self.assertEqual(board_response.data['summary']['machine_down_count'], 0)
        self.assertEqual(board_response.data['summary']['unscheduled_count'], 1)
        self.assertGreaterEqual(board_response.data['summary']['ready_to_run_count'], 1)
        self.assertEqual(board_response.data['summary']['handover_ready_count'], 0)
        self.assertEqual(board_response.data['summary']['handover_accepted_count'], 0)
        self.assertEqual(board_response.data['summary']['bucket_counts']['OVERDUE'], 1)
        self.assertEqual(board_response.data['summary']['bucket_counts']['UNSCHEDULED'], 1)
        self.assertEqual(board_response.data['summary']['risk_counts']['OVERDUE'], 1)
        self.assertEqual(board_response.data['summary']['risk_counts']['UNSCHEDULED'], 1)
        shift_loads = {
            item['key']: item
            for item in board_response.data['summary']['shift_loads']
        }
        self.assertEqual(shift_loads['MORNING']['total_operations'], 1)
        self.assertEqual(shift_loads['AFTERNOON']['total_operations'], 1)
        self.assertEqual(shift_loads['UNASSIGNED']['total_operations'], 1)
        exception_groups = {
            item['key']: item
            for item in board_response.data['exception_groups']
        }
        self.assertEqual(exception_groups['OVERDUE']['count'], 1)
        self.assertEqual(exception_groups['WAIT_PREVIOUS_STEP']['count'], 2)
        self.assertGreaterEqual(exception_groups['READY_TO_RUN']['count'], 1)
        self.assertIn('/shipments/scan', exception_groups['READY_TO_RUN']['secondary_action']['url'])
        self.assertEqual(len(board_response.data['lanes']), 3)
        self.assertEqual(board_response.data['lanes'][0]['buckets'][0]['label'], 'Qua han')
        self.assertEqual(board_response.data['lanes'][1]['buckets'][0]['label'], 'Hom nay')
        self.assertEqual(board_response.data['lanes'][2]['buckets'][0]['label'], 'Chua xep')
        self.assertEqual(board_response.data['lanes'][0]['shift_loads'][0]['key'], 'MORNING')
        self.assertEqual(board_response.data['watchlist'][0]['exceptions']['risk_state'], 'OVERDUE')
        self.assertEqual(board_response.data['dispatch_groups'][0]['key'], 'MORNING')
        self.assertEqual(board_response.data['dispatch_groups'][0]['total_operations'], 1)
        self.assertIn('/sales-orders', board_response.data['watchlist'][0]['actions']['sales_fulfillment_url'])
        self.assertIn('/production-orders?focus_id=', board_response.data['watchlist'][0]['actions']['production_order_url'])
        self.assertIn('/shipments/scan?', board_response.data['watchlist'][0]['actions']['scan_center_url'])
        self.assertIn('ready_to_run', board_response.data['watchlist'][0]['materials'])
        self.assertIn('days_to_delivery', board_response.data['watchlist'][0]['exceptions'])
        self.assertIn('delivery_gap_days', board_response.data['watchlist'][0]['exceptions'])
        self.assertIn('shop_floor', board_response.data['watchlist'][0])

        shift_filtered = self.client.get('/api/production/orders/planning_board/', {'planned_shift': 'AFTERNOON'})
        self.assertEqual(shift_filtered.status_code, 200, shift_filtered.data)
        self.assertEqual(shift_filtered.data['summary']['total_operations'], 1)
        self.assertEqual(shift_filtered.data['lanes'][0]['step_code'], operations[1].step_code)
        self.assertEqual(shift_filtered.data['lanes'][0]['buckets'][0]['cards'][0]['operation']['planned_shift'], 'AFTERNOON')

        bucket_filtered = self.client.get('/api/production/orders/planning_board/', {'bucket_key': 'TODAY'})
        self.assertEqual(bucket_filtered.status_code, 200, bucket_filtered.data)
        self.assertEqual(bucket_filtered.data['summary']['total_operations'], 1)
        self.assertEqual(bucket_filtered.data['lanes'][0]['buckets'][0]['cards'][0]['bucket']['key'], 'TODAY')

        unscheduled_filtered = self.client.get('/api/production/orders/planning_board/', {'risk_state': 'UNSCHEDULED'})
        self.assertEqual(unscheduled_filtered.status_code, 200, unscheduled_filtered.data)
        self.assertEqual(unscheduled_filtered.data['summary']['total_operations'], 1)
        self.assertEqual(unscheduled_filtered.data['lanes'][0]['buckets'][0]['cards'][0]['exceptions']['risk_state'], 'UNSCHEDULED')

        unassigned_shift = self.client.get('/api/production/orders/planning_board/', {'planned_shift': 'UNASSIGNED'})
        self.assertEqual(unassigned_shift.status_code, 200, unassigned_shift.data)
        self.assertEqual(unassigned_shift.data['summary']['total_operations'], 1)
        self.assertEqual(unassigned_shift.data['lanes'][0]['buckets'][0]['cards'][0]['operation']['planned_shift'], '')

        attention_filtered = self.client.get('/api/production/orders/planning_board/', {'needs_attention': 1})
        self.assertEqual(attention_filtered.status_code, 200, attention_filtered.data)
        self.assertEqual(attention_filtered.data['summary']['total_operations'], 3)

        ready_filtered = self.client.get('/api/production/orders/planning_board/', {'ready_to_run': 1})
        self.assertEqual(ready_filtered.status_code, 200, ready_filtered.data)
        self.assertGreaterEqual(ready_filtered.data['summary']['total_operations'], 1)
        self.assertTrue(ready_filtered.data['lanes'][0]['buckets'][0]['cards'][0]['materials']['ready_to_run'])

        current_order_status = ProductionOrder.objects.get(pk=order_id).status
        order_filtered = self.client.get('/api/production/orders/planning_board/', {'production_order_id': order_id, 'order_status': current_order_status})
        self.assertEqual(order_filtered.status_code, 200, order_filtered.data)
        self.assertEqual(order_filtered.data['summary']['total_orders'], 1)
        self.assertEqual(order_filtered.data['summary']['total_operations'], 3)

        finished_product_filtered = self.client.get('/api/production/orders/planning_board/', {'finished_product_code': self.finished_product.code})
        self.assertEqual(finished_product_filtered.status_code, 200, finished_product_filtered.data)
        self.assertEqual(finished_product_filtered.data['summary']['total_operations'], 3)

        material_filtered = self.client.get('/api/production/orders/planning_board/', {'material_product_code': self.material_product.code})
        self.assertEqual(material_filtered.status_code, 200, material_filtered.data)
        self.assertEqual(material_filtered.data['summary']['total_operations'], 3)

    def test_planning_board_returns_capacity_groups_and_filters(self):
        order = self._create_production_order(planned_qty='5')
        order_id = order['id']
        self._release_order(order_id)
        self._issue_all_materials(order_id)
        operations = list(ProductionOperation.objects.filter(production_order_id=order_id).order_by('sequence'))
        today = timezone.localdate().isoformat()

        first = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[0].id,
                'status': 'READY',
                'planned_date': today,
                'planned_shift': 'MORNING',
                'dispatch_sequence': 10,
                'work_center_code': 'IN',
                'work_center_name': 'Line In',
                'machine_code': 'IN-01',
                'machine_name': 'May In 01',
                'estimated_runtime_hours': '5.00',
                'setup_minutes': 60,
            },
            format='json',
        )
        self.assertEqual(first.status_code, 200, first.data)

        second = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[1].id,
                'status': 'READY',
                'planned_date': today,
                'planned_shift': 'MORNING',
                'dispatch_sequence': 20,
                'work_center_code': 'IN',
                'work_center_name': 'Line In',
                'machine_code': 'IN-01',
                'machine_name': 'May In 01',
                'estimated_runtime_hours': '4.50',
                'setup_minutes': 30,
            },
            format='json',
        )
        self.assertEqual(second.status_code, 200, second.data)

        third = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[2].id,
                'status': 'READY',
                'planned_date': today,
                'planned_shift': 'AFTERNOON',
                'dispatch_sequence': 30,
                'estimated_runtime_hours': '2.00',
                'setup_minutes': 0,
            },
            format='json',
        )
        self.assertEqual(third.status_code, 200, third.data)

        second_order = self._create_production_order(planned_qty='2')
        second_order_id = second_order['id']
        self._release_order(second_order_id)
        self._issue_all_materials(second_order_id)
        second_order_operations = list(ProductionOperation.objects.filter(production_order_id=second_order_id).order_by('sequence'))
        afternoon = self.client.post(
            f'/api/production/orders/{second_order_id}/update_operation/',
            {
                'operation_id': second_order_operations[0].id,
                'status': 'READY',
                'planned_date': today,
                'planned_shift': 'AFTERNOON',
                'dispatch_sequence': 5,
                'work_center_code': 'IN',
                'work_center_name': 'Line In',
                'machine_code': 'IN-02',
                'machine_name': 'May In 02',
                'estimated_runtime_hours': '1.00',
                'setup_minutes': 0,
            },
            format='json',
        )
        self.assertEqual(afternoon.status_code, 200, afternoon.data)

        response = self.client.get('/api/production/orders/planning_board/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['summary']['over_capacity_count'], 2)
        self.assertEqual(response.data['summary']['at_limit_count'], 0)
        self.assertEqual(response.data['summary']['unassigned_work_center_count'], 3)
        self.assertEqual(response.data['summary']['unassigned_machine_count'], 0)
        self.assertEqual(response.data['summary']['over_capacity_slot_count'], 1)
        self.assertEqual(response.data['scope_summary']['total_operations'], 6)
        self.assertGreater(float(response.data['summary']['total_runtime_hours']), 0)
        self.assertEqual(len(response.data['work_center_groups']), 2)
        self.assertEqual(response.data['work_center_groups'][0]['work_center_code'], 'IN')
        self.assertEqual(response.data['work_center_groups'][0]['total_operations'], 2)
        self.assertEqual(len(response.data['machine_queues']), 2)
        self.assertEqual(response.data['machine_queues'][0]['machine_code'], 'IN-01')
        self.assertEqual(response.data['machine_queues'][0]['total_operations'], 2)
        self.assertEqual(len(response.data['capacity_calendar']), 2)
        self.assertEqual(response.data['capacity_calendar'][0]['total_operations'], 4)
        self.assertEqual(response.data['capacity_calendar'][0]['shifts'][0]['shift_key'], 'MORNING')
        self.assertGreaterEqual(len(response.data['rebalance_suggestions']), 1)
        self.assertEqual(response.data['rebalance_suggestions'][0]['kind'], 'MOVE_SHIFT')
        self.assertGreaterEqual(len(response.data['shift_watch']), 1)
        self.assertTrue(any(item['shift_key'] == 'MORNING' for item in response.data['shift_watch']))
        self.assertGreaterEqual(len(response.data['date_watch']), 1)
        self.assertEqual(response.data['date_watch'][0]['date'], today)
        self.assertGreaterEqual(len(response.data['step_watch']), 1)
        self.assertTrue(any(item['step_code'] == operations[0].step_code for item in response.data['step_watch']))
        self.assertGreaterEqual(len(response.data['rebalance_summary']), 1)
        self.assertEqual(response.data['rebalance_summary'][0]['kind'], 'MOVE_SHIFT')
        self.assertGreaterEqual(len(response.data['rebalance_summary'][0]['suggestion_keys']), 1)

        over_capacity = self.client.get('/api/production/orders/planning_board/', {'capacity_state': 'OVER_CAPACITY'})
        self.assertEqual(over_capacity.status_code, 200, over_capacity.data)
        self.assertEqual(over_capacity.data['summary']['total_operations'], 2)
        self.assertEqual(over_capacity.data['lanes'][0]['buckets'][0]['cards'][0]['capacity']['capacity_state'], 'OVER_CAPACITY')

        unassigned_work_center = self.client.get('/api/production/orders/planning_board/', {'capacity_state': 'UNASSIGNED_WORK_CENTER'})
        self.assertEqual(unassigned_work_center.status_code, 200, unassigned_work_center.data)
        self.assertEqual(unassigned_work_center.data['summary']['total_operations'], 3)
        self.assertEqual(unassigned_work_center.data['lanes'][0]['buckets'][0]['cards'][0]['capacity']['capacity_state'], 'UNASSIGNED_WORK_CENTER')

        work_center_filtered = self.client.get('/api/production/orders/planning_board/', {'work_center_code': 'IN'})
        self.assertEqual(work_center_filtered.status_code, 200, work_center_filtered.data)
        self.assertEqual(work_center_filtered.data['summary']['total_operations'], 3)

        machine_filtered = self.client.get('/api/production/orders/planning_board/', {'machine_code': 'IN-01'})
        self.assertEqual(machine_filtered.status_code, 200, machine_filtered.data)
        self.assertEqual(machine_filtered.data['summary']['total_operations'], 2)

    def test_planning_board_returns_owner_sales_and_material_watch(self):
        customer = Customer.objects.create(
            code='CUS-BOARD',
            name='Khach board',
            created_by=self.user,
            updated_by=self.user,
        )
        sales_order = SalesOrder.objects.create(
            code='SO-BOARD-001',
            order_date=timezone.localdate(),
            delivery_date=timezone.localdate() + timedelta(days=1),
            customer=customer,
            created_by=self.user,
            updated_by=self.user,
            owner=self.user,
        )
        order = self._create_production_order(planned_qty='5')
        order_id = order['id']
        production_order = ProductionOrder.objects.get(pk=order_id)
        production_order.sales_order = sales_order
        production_order.reference = sales_order.code
        production_order.save(update_fields=['sales_order', 'reference', 'updated_at'])
        self._release_order(order_id)
        operations = list(ProductionOperation.objects.filter(production_order_id=order_id).order_by('sequence'))
        planned_date = timezone.localdate().isoformat()

        seeded = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[0].id,
                'status': 'READY',
                'planned_date': planned_date,
                'planned_shift': 'MORNING',
                'work_center_code': 'IN',
                'work_center_name': 'Line In',
                'machine_code': 'IN-02',
                'machine_name': 'May In 02',
                'estimated_runtime_hours': '3.00',
                'setup_minutes': 15,
            },
            format='json',
        )
        self.assertEqual(seeded.status_code, 200, seeded.data)
        owner_signal = self.client.post(
            '/api/production/orders/shop_floor_signal/',
            {
                'items': [{'order_id': order_id, 'operation_id': operations[0].id}],
                'signal_code': 'READY',
                'dispatch_owner': 'Ca B',
            },
            format='json',
        )
        self.assertEqual(owner_signal.status_code, 200, owner_signal.data)

        response = self.client.get('/api/production/orders/planning_board/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertGreaterEqual(len(response.data['dispatch_owner_groups']), 1)
        self.assertEqual(response.data['dispatch_owner_groups'][0]['dispatch_owner'], 'Ca B')
        self.assertIn('dispatch_owner=Ca+B', response.data['dispatch_owner_groups'][0]['focus_url'])
        self.assertGreaterEqual(len(response.data['sales_watch']), 1)
        self.assertEqual(response.data['sales_watch'][0]['sales_order_code'], sales_order.code)
        self.assertIn('/sales-orders', response.data['sales_watch'][0]['sales_fulfillment_url'])
        self.assertGreaterEqual(len(response.data['material_watch']), 1)
        self.assertEqual(response.data['material_watch'][0]['material_product_code'], self.material_product.code)
        self.assertGreaterEqual(response.data['material_watch'][0]['wait_material_operations'], 1)
        self.assertIn('material_product_code=RM-001', response.data['material_watch'][0]['focus_url'])
        self.assertGreaterEqual(len(response.data['work_center_watch']), 1)
        self.assertEqual(response.data['work_center_watch'][0]['work_center_code'], 'IN')
        self.assertIn('work_center_code=IN', response.data['work_center_watch'][0]['focus_url'])
        self.assertGreaterEqual(len(response.data['machine_watch']), 1)
        self.assertEqual(response.data['machine_watch'][0]['machine_code'], 'IN-02')
        self.assertIn('machine_code=IN-02', response.data['machine_watch'][0]['focus_url'])
        self.assertGreaterEqual(len(response.data['delivery_watch']), 1)
        self.assertEqual(str(response.data['delivery_watch'][0]['delivery_due_date']), str(production_order.planned_end_date))
        self.assertIn('delivery_due_date=', response.data['delivery_watch'][0]['focus_url'])
        self.assertGreaterEqual(len(response.data['unscheduled_watch']), 1)
        self.assertTrue(any(item['step_code'] == operations[1].step_code for item in response.data['unscheduled_watch']))
        self.assertIn('bucket_key=UNSCHEDULED', response.data['unscheduled_watch'][0]['focus_url'])
        self.assertGreaterEqual(len(response.data['shift_watch']), 1)
        self.assertTrue(any(item['shift_key'] == 'MORNING' for item in response.data['shift_watch']))
        self.assertGreaterEqual(len(response.data['date_watch']), 1)
        self.assertTrue(any('focus_url' in item and item['focus_url'] for item in response.data['date_watch']))
        self.assertGreaterEqual(len(response.data['dispatch_owner_capacity_watch']), 1)
        self.assertEqual(response.data['dispatch_owner_capacity_watch'][0]['dispatch_owner'], 'Ca B')
        self.assertIn('dispatch_owner=Ca+B', response.data['dispatch_owner_capacity_watch'][0]['focus_url'])
        self.assertGreaterEqual(len(response.data['step_watch']), 1)
        self.assertTrue(any(item['step_code'] == operations[0].step_code for item in response.data['step_watch']))
        self.assertIn('rebalance_summary', response.data)

        due_date_filtered = self.client.get('/api/production/orders/planning_board/', {'delivery_due_date': str(production_order.planned_end_date)})
        self.assertEqual(due_date_filtered.status_code, 200, due_date_filtered.data)
        self.assertEqual(due_date_filtered.data['summary']['total_operations'], 3)

    def test_preview_operation_update_returns_projected_bucket_risk_and_attention(self):
        order = self._create_production_order(planned_qty='4')
        order_id = order['id']
        self._release_order(order_id)
        self._issue_all_materials(order_id)
        operation = ProductionOperation.objects.get(production_order_id=order_id, sequence=1)
        today = timezone.localdate()

        scheduled = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operation.id,
                'status': 'READY',
                'planned_date': today.isoformat(),
                'planned_shift': 'MORNING',
                'priority_rank': 3,
                'dispatch_sequence': 11,
                'work_center_code': 'IN',
                'work_center_name': 'Line In',
                'machine_code': 'IN-01',
                'machine_name': 'May In 01',
                'estimated_runtime_hours': '3.00',
                'setup_minutes': 30,
            },
            format='json',
        )
        self.assertEqual(scheduled.status_code, 200, scheduled.data)

        preview = self.client.post(
            f'/api/production/orders/{order_id}/preview_operation_update/',
            {
                'operation_id': operation.id,
                'planned_date': (today + timedelta(days=1)).isoformat(),
                'planned_shift': 'NIGHT',
                'dispatch_sequence': 5,
                'work_center_code': 'BE',
                'work_center_name': 'Line Be',
                'machine_code': '',
                'machine_name': '',
                'estimated_runtime_hours': '6.00',
                'setup_minutes': 45,
                'block_reason_code': 'WAIT_MATERIAL',
                'block_reason_note': 'Cho cap boi',
                'priority_rank': 1,
            },
            format='json',
        )
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data['current']['bucket']['key'], 'TODAY')
        self.assertEqual(preview.data['preview']['bucket']['key'], 'TOMORROW')
        self.assertEqual(preview.data['preview']['operation']['planned_shift'], 'NIGHT')
        self.assertEqual(preview.data['preview']['exceptions']['risk_state'], 'BLOCKED')
        self.assertEqual(preview.data['preview']['capacity']['work_center_code'], 'BE')
        self.assertEqual(preview.data['preview']['capacity']['machine_code'], '')
        self.assertTrue(preview.data['impact']['bucket_changed'])
        self.assertTrue(preview.data['impact']['risk_changed'])
        self.assertTrue(preview.data['impact']['needs_attention_changed'])
        self.assertTrue(preview.data['impact']['capacity_state_changed'])
        self.assertTrue(preview.data['impact']['work_center_changed'])
        self.assertTrue(preview.data['impact']['machine_changed'])

        invalid_preview = self.client.post(
            f'/api/production/orders/{order_id}/preview_operation_update/',
            {
                'operation_id': operation.id,
                'block_reason_code': 'OTHER',
            },
            format='json',
        )
        self.assertEqual(invalid_preview.status_code, 400, invalid_preview.data)

    def test_bulk_update_operations_reschedules_multiple_steps_and_audits_each_row(self):
        order = self._create_production_order(planned_qty='6')
        order_id = order['id']
        self._release_order(order_id)
        operations = list(ProductionOperation.objects.filter(production_order_id=order_id).order_by('sequence'))
        planned_date = timezone.localdate().isoformat()

        response = self.client.post(
            '/api/production/orders/bulk_update_operations/',
            {
                'items': [
                    {'order_id': order_id, 'operation_id': operations[0].id},
                    {'order_id': order_id, 'operation_id': operations[1].id},
                ],
                'changes': {
                    'planned_date': planned_date,
                    'planned_shift': 'AFTERNOON',
                    'priority_rank': 8,
                    'block_reason_code': 'WAIT_MATERIAL',
                    'block_reason_note': 'Cho cap boi',
                },
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['updated_count'], 2)
        self.assertEqual(response.data['order_ids'], [order_id])

        for operation in operations[:2]:
            operation.refresh_from_db()
            self.assertEqual(str(operation.planned_date), planned_date)
            self.assertEqual(operation.planned_shift, 'AFTERNOON')
            self.assertEqual(operation.priority_rank, 8)
            self.assertEqual(operation.block_reason_code, 'WAIT_MATERIAL')
            self.assertEqual(operation.block_reason_note, 'Cho cap boi')
            audit = AuditLog.objects.filter(entity_type='ProductionOperation', entity_id=operation.id).latest('id')
            self.assertEqual(audit.new_values['planned_shift'], 'AFTERNOON')
            self.assertEqual(audit.new_values['bulk_batch_size'], 2)

    def test_bulk_update_operations_rejects_non_released_orders(self):
        order = self._create_production_order(planned_qty='3')
        order_id = order['id']
        operation = ProductionOperation.objects.get(production_order_id=order_id, sequence=1)

        response = self.client.post(
            '/api/production/orders/bulk_update_operations/',
            {
                'items': [{'order_id': order_id, 'operation_id': operation.id}],
                'changes': {
                    'planned_date': timezone.localdate().isoformat(),
                    'planned_shift': 'MORNING',
                },
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('hang loat', response.data['error'])

    def test_preview_bulk_update_operations_returns_shift_and_delivery_impact(self):
        order = self._create_production_order(planned_qty='6')
        order_id = order['id']
        self._release_order(order_id)
        self._issue_all_materials(order_id)
        operations = list(ProductionOperation.objects.filter(production_order_id=order_id).order_by('sequence'))
        today = timezone.localdate()

        scheduled = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[0].id,
                'status': 'READY',
                'planned_date': today.isoformat(),
                'planned_shift': 'MORNING',
                'priority_rank': 2,
                'dispatch_sequence': 8,
                'work_center_code': 'IN',
                'work_center_name': 'Line In',
                'machine_code': 'IN-01',
                'machine_name': 'May In 01',
                'estimated_runtime_hours': '3.00',
                'setup_minutes': 30,
            },
            format='json',
        )
        self.assertEqual(scheduled.status_code, 200, scheduled.data)

        preview = self.client.post(
            '/api/production/orders/preview_bulk_update_operations/',
            {
                'items': [{'order_id': order_id, 'operation_id': operations[0].id}],
                'changes': {
                    'block_reason_code': 'WAIT_MATERIAL',
                    'block_reason_note': 'Cho cap boi',
                    'planned_shift': 'AFTERNOON',
                    'work_center_code': 'BE',
                    'work_center_name': 'Line Be',
                    'machine_code': 'BE-03',
                    'machine_name': 'May Be 03',
                    'estimated_runtime_hours': '6.50',
                    'setup_minutes': 60,
                },
            },
            format='json',
        )
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data['current_summary']['ready_to_run_count'], 1)
        self.assertEqual(preview.data['preview_summary']['blocked_count'], 1)
        self.assertGreater(float(preview.data['preview_summary']['total_scheduled_hours']), float(preview.data['current_summary']['total_scheduled_hours']))
        self.assertEqual(preview.data['operations'][0]['preview']['operation']['planned_shift'], 'AFTERNOON')
        self.assertEqual(preview.data['operations'][0]['preview']['capacity']['work_center_code'], 'BE')
        self.assertEqual(preview.data['operations'][0]['preview']['capacity']['machine_code'], 'BE-03')
        self.assertTrue(preview.data['operations'][0]['impact']['risk_changed'])
        self.assertTrue(preview.data['operations'][0]['impact']['capacity_state_changed'])
        self.assertTrue(preview.data['operations'][0]['impact']['work_center_changed'])
        self.assertTrue(preview.data['operations'][0]['impact']['machine_changed'])
        self.assertIn('delivery_gap_days', preview.data['operations'][0]['preview']['exceptions'])

    def test_preview_rebalance_suggestions_returns_scenario_summary_and_queue_highlights(self):
        order = self._create_production_order(planned_qty='6')
        order_id = order['id']
        self._release_order(order_id)
        self._issue_all_materials(order_id)
        operations = list(ProductionOperation.objects.filter(production_order_id=order_id).order_by('sequence'))
        today = timezone.localdate().isoformat()

        seed = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operations[0].id,
                'status': 'READY',
                'planned_date': today,
                'planned_shift': 'MORNING',
                'work_center_code': 'IN',
                'work_center_name': 'Line In',
                'machine_code': 'IN-01',
                'machine_name': 'May In 01',
                'estimated_runtime_hours': '4.00',
                'setup_minutes': 30,
            },
            format='json',
        )
        self.assertEqual(seed.status_code, 200, seed.data)

        preview = self.client.post(
            '/api/production/orders/preview_rebalance_suggestions/',
            {
                'items': [
                    {
                        'order_id': order_id,
                        'operation_id': operations[0].id,
                        'suggestion_key': 'rebalance-move-shift-demo',
                        'suggestion_kind': 'MOVE_SHIFT',
                        'suggestion_title': 'Day sang ca chieu',
                        'severity': 'critical',
                        'suggested_changes': {
                            'planned_shift': 'AFTERNOON',
                            'work_center_code': 'BE',
                            'work_center_name': 'Line Be',
                            'machine_code': 'BE-02',
                            'machine_name': 'May Be 02',
                            'estimated_runtime_hours': '6.50',
                            'setup_minutes': 45,
                        },
                    },
                ],
            },
            format='json',
        )
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data['operations'][0]['scenario']['suggestion_kind'], 'MOVE_SHIFT')
        self.assertEqual(preview.data['operations'][0]['preview']['capacity']['work_center_code'], 'BE')
        self.assertEqual(preview.data['operations'][0]['preview']['capacity']['machine_code'], 'BE-02')
        self.assertIn('summary_delta', preview.data)
        self.assertIn('capacity_windows', preview.data)
        self.assertGreaterEqual(len(preview.data['capacity_windows']), 1)
        self.assertIn('machine_queue_highlights', preview.data)
        self.assertGreaterEqual(len(preview.data['machine_queue_highlights']), 1)

    def test_apply_rebalance_suggestions_supports_distinct_changes_and_audits_scenario(self):
        order = self._create_production_order(planned_qty='6')
        order_id = order['id']
        self._release_order(order_id)
        operations = list(ProductionOperation.objects.filter(production_order_id=order_id).order_by('sequence'))
        today = timezone.localdate().isoformat()

        response = self.client.post(
            '/api/production/orders/apply_rebalance_suggestions/',
            {
                'items': [
                    {
                        'order_id': order_id,
                        'operation_id': operations[0].id,
                        'suggestion_key': 'rebalance-assign-wc-op1',
                        'suggestion_kind': 'ASSIGN_WORK_CENTER',
                        'suggestion_title': 'Gan line in cho buoc 1',
                        'severity': 'warning',
                        'suggested_changes': {
                            'planned_date': today,
                            'planned_shift': 'MORNING',
                            'work_center_code': 'IN',
                            'work_center_name': 'Line In',
                            'machine_code': 'IN-01',
                            'machine_name': 'May In 01',
                            'estimated_runtime_hours': '2.50',
                            'setup_minutes': 20,
                        },
                    },
                    {
                        'order_id': order_id,
                        'operation_id': operations[1].id,
                        'suggestion_key': 'rebalance-move-day-op2',
                        'suggestion_kind': 'MOVE_DAY',
                        'suggestion_title': 'Doi buoc 2 sang ngay mai',
                        'severity': 'critical',
                        'suggested_changes': {
                            'planned_date': (timezone.localdate() + timedelta(days=1)).isoformat(),
                            'planned_shift': 'AFTERNOON',
                            'work_center_code': 'BE',
                            'work_center_name': 'Line Be',
                            'machine_code': 'BE-03',
                            'machine_name': 'May Be 03',
                            'estimated_runtime_hours': '3.00',
                            'setup_minutes': 35,
                            'block_reason_code': 'WAIT_PREVIOUS_STEP',
                            'block_reason_note': 'Cho line truoc ban giao',
                        },
                    },
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['updated_count'], 2)
        self.assertEqual(response.data['operations'][0]['scenario']['suggestion_key'], 'rebalance-assign-wc-op1')

        first_operation = ProductionOperation.objects.get(pk=operations[0].id)
        second_operation = ProductionOperation.objects.get(pk=operations[1].id)
        self.assertEqual(first_operation.work_center_code, 'IN')
        self.assertEqual(first_operation.machine_code, 'IN-01')
        self.assertEqual(second_operation.work_center_code, 'BE')
        self.assertEqual(second_operation.machine_code, 'BE-03')
        self.assertEqual(second_operation.block_reason_code, 'WAIT_PREVIOUS_STEP')

        first_audit = AuditLog.objects.filter(entity_type='ProductionOperation', entity_id=first_operation.id).latest('id')
        second_audit = AuditLog.objects.filter(entity_type='ProductionOperation', entity_id=second_operation.id).latest('id')
        self.assertEqual(first_audit.new_values['scenario_batch_size'], 2)
        self.assertEqual(first_audit.new_values['suggestion_kind'], 'ASSIGN_WORK_CENTER')
        self.assertEqual(second_audit.new_values['scenario_batch_size'], 2)
        self.assertEqual(second_audit.new_values['suggestion_key'], 'rebalance-move-day-op2')

    def test_shop_floor_signal_updates_block_owner_and_audit(self):
        order = self._create_production_order(planned_qty='4')
        order_id = order['id']
        self._release_order(order_id)
        operation = ProductionOperation.objects.get(production_order_id=order_id, sequence=1)

        response = self.client.post(
            '/api/production/orders/shop_floor_signal/',
            {
                'items': [{'order_id': order_id, 'operation_id': operation.id}],
                'signal_code': 'MACHINE_DOWN',
                'note': 'May can doi dao',
                'dispatch_owner': 'Ca B',
                'handover_status': 'ACTIVE',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        operation.refresh_from_db()
        self.assertEqual(operation.block_reason_code, 'MACHINE_DOWN')
        self.assertEqual(operation.block_reason_note, 'May can doi dao')
        self.assertEqual(operation.dispatch_owner, 'Ca B')
        self.assertEqual(operation.handover_status, 'ACTIVE')
        audit = AuditLog.objects.filter(entity_type='ProductionOperation', entity_id=operation.id).latest('id')
        self.assertEqual(audit.action, 'SIGNAL')
        self.assertEqual(audit.new_values['signal_code'], 'MACHINE_DOWN')

    def test_shop_floor_handover_sets_ready_and_clears_previous_wait(self):
        order = self._create_production_order(planned_qty='4')
        order_id = order['id']
        self._release_order(order_id)
        operation = ProductionOperation.objects.get(production_order_id=order_id, sequence=1)
        blocked = self.client.post(
            f'/api/production/orders/{order_id}/update_operation/',
            {
                'operation_id': operation.id,
                'block_reason_code': 'WAIT_PREVIOUS_STEP',
                'block_reason_note': 'Cho ban giao tu line truoc',
            },
            format='json',
        )
        self.assertEqual(blocked.status_code, 200, blocked.data)

        response = self.client.post(
            '/api/production/orders/shop_floor_handover/',
            {
                'items': [{'order_id': order_id, 'operation_id': operation.id}],
                'handover_status': 'ACCEPTED',
                'dispatch_owner': 'To in',
                'handover_receiver': 'To boi',
                'handover_note': 'Da tiep quan tai Trung tam quet QR',
                'clear_previous_wait': True,
                'set_ready': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        operation.refresh_from_db()
        self.assertEqual(operation.handover_status, 'ACCEPTED')
        self.assertEqual(operation.handover_receiver, 'To boi')
        self.assertEqual(operation.handover_note, 'Da tiep quan tai Trung tam quet QR')
        self.assertEqual(operation.block_reason_code, '')
        self.assertEqual(operation.status, 'READY')
        audit = AuditLog.objects.filter(entity_type='ProductionOperation', entity_id=operation.id).latest('id')
        self.assertEqual(audit.action, 'HANDOVER')
        self.assertEqual(audit.new_values['handover_status'], 'ACCEPTED')

    def test_next_states_and_approval_history_follow_production_lifecycle(self):
        order = self._create_production_order(planned_qty='6')
        order_id = order['id']

        draft_next_states = self.client.get(f'/api/production/orders/{order_id}/next_states/')
        self.assertEqual(draft_next_states.status_code, 200, draft_next_states.data)
        self.assertEqual(draft_next_states.data['current'], 'DRAFT')
        self.assertIn('SUBMITTED', draft_next_states.data['next_states'])
        self.assertIn('CANCELLED', draft_next_states.data['next_states'])

        submit_response = self.client.post(f'/api/production/orders/{order_id}/submit/', format='json')
        self.assertEqual(submit_response.status_code, 200, submit_response.data)
        approve_response = self.client.post(f'/api/production/orders/{order_id}/approve/', format='json')
        self.assertEqual(approve_response.status_code, 200, approve_response.data)
        release_response = self.client.post(f'/api/production/orders/{order_id}/release/', format='json')
        self.assertEqual(release_response.status_code, 200, release_response.data)

        released_next_states = self.client.get(f'/api/production/orders/{order_id}/next_states/')
        self.assertEqual(released_next_states.status_code, 200, released_next_states.data)
        self.assertEqual(released_next_states.data['current'], 'RELEASED')
        self.assertIn('IN_PROGRESS', released_next_states.data['next_states'])
        self.assertIn('COMPLETED', released_next_states.data['next_states'])

        history_response = self.client.get(f'/api/production/orders/{order_id}/approval_history/')
        self.assertEqual(history_response.status_code, 200, history_response.data)
        history_actions = [item['action'] for item in history_response.data]
        self.assertEqual(history_actions[:2], ['APPROVE', 'SUBMIT'])
        self.assertEqual(history_response.data[0]['action_label'], 'Đã duyệt')

        history_rows = ApprovalHistory.objects.filter(entity_type='ProductionOrder', entity_id=order_id)
        self.assertEqual(history_rows.count(), 2)

    def test_reject_then_resubmit_clears_reject_reason_and_reopens_lifecycle(self):
        order = self._create_production_order(planned_qty='4')
        order_id = order['id']

        self.client.post(f'/api/production/orders/{order_id}/submit/', format='json')
        reject_response = self.client.post(
            f'/api/production/orders/{order_id}/reject/',
            {'reason': 'Sai ke hoach san xuat'},
            format='json',
        )
        self.assertEqual(reject_response.status_code, 200, reject_response.data)

        order_obj = ProductionOrder.objects.get(pk=order_id)
        self.assertEqual(order_obj.status, 'REJECTED')
        self.assertEqual(order_obj.reject_reason, 'Sai ke hoach san xuat')

        resubmit_response = self.client.post(f'/api/production/orders/{order_id}/submit/', format='json')
        self.assertEqual(resubmit_response.status_code, 200, resubmit_response.data)

        order_obj.refresh_from_db()
        self.assertEqual(order_obj.status, 'SUBMITTED')
        self.assertEqual(order_obj.reject_reason, '')
        self.assertIsNone(order_obj.rejected_at)
        self.assertIsNone(order_obj.rejected_by)

    def test_production_order_reject_edit_resubmit_release_and_cancel(self):
        order = self._create_production_order(planned_qty='4')
        order_id = order['id']

        draft_update = self.client.patch(
            f'/api/production/orders/{order_id}/',
            {
                'version': order['version'],
                'planned_qty': '5',
                'notes': 'Cap nhat nhap lieu truoc khi gui duyet',
            },
            format='json',
        )
        self.assertEqual(draft_update.status_code, 200, draft_update.data)

        self.client.post(f'/api/production/orders/{order_id}/submit/', format='json')
        reject_response = self.client.post(
            f'/api/production/orders/{order_id}/reject/',
            {'reason': 'Can cap nhat dinh muc va ke hoach'},
            format='json',
        )
        self.assertEqual(reject_response.status_code, 200, reject_response.data)

        rejected_update = self.client.patch(
            f'/api/production/orders/{order_id}/',
            {
                'version': ProductionOrder.objects.get(pk=order_id).version,
                'planned_qty': '6',
                'notes': 'Da cap nhat sau khi bi tu choi',
            },
            format='json',
        )
        self.assertEqual(rejected_update.status_code, 200, rejected_update.data)

        self.client.post(f'/api/production/orders/{order_id}/submit/', format='json')
        approve_response = self.client.post(f'/api/production/orders/{order_id}/approve/', format='json')
        self.assertEqual(approve_response.status_code, 200, approve_response.data)
        release_response = self.client.post(f'/api/production/orders/{order_id}/release/', format='json')
        self.assertEqual(release_response.status_code, 200, release_response.data)

        cancel_response = self.client.post(
            f'/api/production/orders/{order_id}/cancel/',
            {'reason': 'Dung lenh sau UAT lifecycle'},
            format='json',
        )
        self.assertEqual(cancel_response.status_code, 200, cancel_response.data)
        self.assertEqual(cancel_response.data['status'], 'CANCELLED')

        order_obj = ProductionOrder.objects.get(pk=order_id)
        self.assertEqual(order_obj.status, 'CANCELLED')
        self.assertEqual(str(order_obj.planned_qty), '6.0000')
        history_actions = list(
            ApprovalHistory.objects
            .filter(entity_type='ProductionOrder', entity_id=order_id)
            .order_by('created_at', 'id')
            .values_list('action', flat=True)
        )
        self.assertEqual(history_actions, ['SUBMIT', 'REJECT', 'SUBMIT', 'APPROVE', 'REJECT'])
        self.assertTrue(AuditLog.objects.filter(entity_type='ProductionOrder', entity_id=order_id, action='CANCEL').exists())
