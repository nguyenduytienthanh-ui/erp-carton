import json
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from core.management.commands.bootstrap_uat_demo import USER_MATRIX
from core.models import ApprovalHistory, AuditLog, Customer, Role, Setting, Team, User
from products.models import Operation, Product, ProductOperation, ProductRoutingStep, ProductUnit
from production.models import (
    ProductionDemand,
    ProductionDemandPlanningStatus,
    ProductionDemandProductionStatus,
    ProductionMaterialRequirement,
    ProductionOperation,
    ProductionOrder,
)
from sales.models import DeliveryCarrier, SalesOrder


class DevSeedCommandTests(TestCase):
    def _call(self, *args):
        output = StringIO()
        call_command(*args, stdout=output)
        return output.getvalue()

    def _create_order_chain(self, tag='TMP_CHAIN', customer_code=None, product_code=None, order_code=None):
        self._call('seed_dev_master_data')
        today = timezone.localdate()
        user = User.objects.get(username='uat_admin')
        unit = ProductUnit.objects.get(code='CAI')
        customer = Customer.objects.create(
            code=customer_code or f'{tag}_CUSTOMER',
            name=f'{tag} Customer',
            company_name=f'{tag} Company',
            status='APPROVED',
            created_by=user,
            updated_by=user,
        )
        product = Product.objects.create(
            code=product_code or f'{tag}_PRODUCT',
            name=f'{tag} Product',
            unit=unit,
            status='ACTIVE',
            is_active=True,
            created_by=user,
            updated_by=user,
        )
        sales_order = SalesOrder.objects.create(
            code=order_code or f'{tag}_SO',
            order_date=today,
            delivery_date=today,
            status='APPROVED',
            customer=customer,
            currency='VND',
            exchange_rate=Decimal('1'),
            notes=f'{tag} sales order',
            created_by=user,
            updated_by=user,
            owner=user,
        )
        line = sales_order.lines.create(
            line_number=1,
            product=product,
            qty=Decimal('10'),
            unit_price=Decimal('1000'),
            uom='CAI',
            note=f'{tag} line',
        )
        demand = ProductionDemand.objects.create(
            demand_code=f'{tag}_DEMAND',
            demand_key=f'{tag}:DEMAND:1',
            sales_order=sales_order,
            sales_order_line=line,
            product=product,
            customer_id_snapshot=customer.id,
            customer_name_snapshot=customer.name,
            product_code=product.code,
            product_name=product.name,
            unit_name='CAI',
            qty_required=Decimal('10'),
            qty_planned=Decimal('10'),
            order_date=today,
            delivery_date=today,
            production_due_date=today,
            planning_due_date=today,
            source=f'{tag}_SOURCE',
            created_by=user,
            updated_by=user,
        )
        production_order = ProductionOrder.objects.create(
            code=f'{tag}_MO',
            order_date=today,
            planned_start_date=today,
            planned_end_date=today,
            status='DRAFT',
            sales_order=sales_order,
            sales_order_line=line,
            production_demand=demand,
            product=product,
            product_snapshot={'code': product.code, 'name': product.name},
            planned_qty=Decimal('10'),
            created_by=user,
            updated_by=user,
            owner=user,
        )
        operation = ProductionOperation.objects.create(
            production_order=production_order,
            sequence=1,
            step_code='IN',
            step_name='In',
            planned_qty=Decimal('10'),
        )
        material_requirement = ProductionMaterialRequirement.objects.create(
            production_order=production_order,
            line_number=1,
            material_product=product,
            required_qty=Decimal('2'),
        )
        AuditLog.objects.create(
            user=user,
            action='CREATE',
            entity_type='ProductionOrder',
            entity_id=production_order.id,
            new_values={'code': production_order.code},
        )
        ApprovalHistory.objects.create(
            entity_type='ProductionOrder',
            entity_id=production_order.id,
            entity_code=production_order.code,
            action='SUBMIT',
            user=user,
            level=1,
        )
        return {
            'customer': customer,
            'product': product,
            'sales_order': sales_order,
            'line': line,
            'demand': demand,
            'production_order': production_order,
            'operation': operation,
            'material_requirement': material_requirement,
        }

    def test_master_seed_is_idempotent_without_demo_order_or_password_output(self):
        first_output = self._call('seed_dev_master_data', '--password', 'Demo123!')
        second_output = self._call('seed_dev_master_data', '--password', 'Demo123!')

        expected_users = {row['username'] for row in USER_MATRIX}
        self.assertTrue(expected_users.issubset(set(User.objects.values_list('username', flat=True))))
        self.assertEqual(User.objects.filter(username__in=expected_users).count(), len(expected_users))
        self.assertTrue(Role.objects.filter(code='ADMIN', deleted_at__isnull=True).exists())
        self.assertTrue(Team.objects.filter(code='OPS_TEAM', deleted_at__isnull=True).exists())
        self.assertTrue(Operation.objects.filter(code='IN').exists())
        self.assertTrue(Setting.objects.filter(key='PRODUCTION_DEMAND_PLANNING_LEAD_DAYS').exists())
        self.assertFalse(SalesOrder.objects.filter(code='SO-DEMO-001').exists())
        self.assertNotIn('Demo123!', first_output)
        self.assertNotIn('Demo123!', second_output)

        user_count = User.objects.filter(username__in=expected_users).count()
        role_count = Role.objects.filter(code__in=['ADMIN', 'MANAGER', 'OPS_MANAGER']).count()
        self._call('seed_dev_master_data', '--password', 'Demo123!')
        self.assertEqual(User.objects.filter(username__in=expected_users).count(), user_count)
        self.assertEqual(Role.objects.filter(code__in=['ADMIN', 'MANAGER', 'OPS_MANAGER']).count(), role_count)

    def test_qa_seed_is_idempotent_and_creates_expected_product_sales_demand_data(self):
        self._call('seed_dev_qa_data')
        counts = {
            'products': Product.objects.filter(code__startswith='QA_').count(),
            'customers': Customer.objects.filter(code__startswith='QA_').count(),
            'orders': SalesOrder.objects.filter(code__startswith='QA_').count(),
            'demands': ProductionDemand.objects.filter(source='QA_SEED').count(),
        }
        self._call('seed_dev_qa_data')
        self.assertEqual(Product.objects.filter(code__startswith='QA_').count(), counts['products'])
        self.assertEqual(Customer.objects.filter(code__startswith='QA_').count(), counts['customers'])
        self.assertEqual(SalesOrder.objects.filter(code__startswith='QA_').count(), counts['orders'])
        self.assertEqual(ProductionDemand.objects.filter(source='QA_SEED').count(), counts['demands'])

        generic = Product.objects.get(code='QA_PRODUCT_GENERIC_CARTON')
        self.assertEqual(generic.product_kind, Product.ProductKind.GENERIC)
        self.assertEqual(generic.color_count, 5)
        self.assertEqual(generic.print_color_2, 'Pantone 185C')
        self.assertEqual(
            set(ProductOperation.objects.filter(product=generic).values_list('operation__code', flat=True)),
            {'IN', 'BE'},
        )
        self.assertEqual(
            list(ProductRoutingStep.objects.filter(product=generic).values_list('operation__code', flat=True)),
            ['IN', 'XA', 'XA', 'DONG', 'DAN'],
        )

        order_v2 = SalesOrder.objects.get(code='QA_SO_SNAPSHOT_V2')
        line_v2 = order_v2.lines.get(line_number=1)
        self.assertEqual(line_v2.product_snapshot.get('schema_version'), 2)
        self.assertEqual(line_v2.delivery_plans.count(), 2)

        legacy_order = SalesOrder.objects.get(code='QA_SO_SNAPSHOT_V1_LEGACY')
        legacy_snapshot = legacy_order.lines.get(line_number=1).product_snapshot
        self.assertNotIn('schema_version', legacy_snapshot)
        self.assertEqual(legacy_snapshot.get('process_in'), 20000)

        self.assertTrue(ProductionDemand.objects.filter(demand_code='QA_DEMAND_OVERDUE').exists())
        self.assertTrue(ProductionDemand.objects.filter(demand_code='QA_DEMAND_DUE_TODAY').exists())
        self.assertTrue(ProductionDemand.objects.filter(demand_code='QA_DEMAND_HELD', hold_reason__gt='').exists())
        self.assertTrue(ProductionDemand.objects.filter(
            demand_code='QA_DEMAND_COMPLETED',
            production_status=ProductionDemandProductionStatus.COMPLETED,
        ).exists())
        self.assertTrue(ProductionDemand.objects.filter(
            demand_code='QA_DEMAND_CANCELLED',
            planning_status=ProductionDemandPlanningStatus.CANCELLED,
        ).exists())

    def test_reset_requires_confirm(self):
        with self.assertRaises(CommandError):
            self._call('reset_dev_qa_data')

    def test_reset_dry_run_does_not_delete_qa_data(self):
        self._call('seed_dev_qa_data')
        demand_count = ProductionDemand.objects.filter(source='QA_SEED').count()
        output = self._call('reset_dev_qa_data', '--confirm', '--dry-run', '--json')
        payload = json.loads(output)

        self.assertTrue(payload['dry_run'])
        self.assertEqual(payload['production_demands'], demand_count)
        self.assertEqual(ProductionDemand.objects.filter(source='QA_SEED').count(), demand_count)
        self.assertTrue(Product.objects.filter(code='QA_PRODUCT_GENERIC_CARTON').exists())

    def test_reset_confirm_removes_only_qa_data_and_preserves_master_data(self):
        self._call('seed_dev_qa_data')
        self.assertTrue(Operation.objects.filter(code='IN').exists())
        self.assertTrue(User.objects.filter(username='uat_admin').exists())
        self.assertTrue(DeliveryCarrier.objects.filter(code='QA_CARRIER_INTERNAL').exists())

        self._call('reset_dev_qa_data', '--confirm')

        self.assertFalse(ProductionDemand.objects.filter(source='QA_SEED').exists())
        self.assertFalse(SalesOrder.objects.filter(code__startswith='QA_').exists())
        self.assertFalse(Product.objects.filter(code__startswith='QA_').exists())
        self.assertFalse(Customer.objects.filter(code__startswith='QA_').exists())
        self.assertFalse(DeliveryCarrier.objects.filter(code__startswith='QA_').exists())
        self.assertTrue(Operation.objects.filter(code='IN').exists())
        self.assertTrue(User.objects.filter(username='uat_admin').exists())

    def test_tmp_reset_dry_run_outputs_counts_without_deleting(self):
        chain = self._create_order_chain(tag='TMP_DRY_RUN')

        output = self._call('reset_dev_tmp_data', '--dry-run', '--json')
        payload = json.loads(output)

        self.assertTrue(payload['dry_run'])
        self.assertFalse(payload['confirmed'])
        self.assertGreaterEqual(payload['customers'], 1)
        self.assertGreaterEqual(payload['products'], 1)
        self.assertGreaterEqual(payload['sales_orders'], 1)
        self.assertGreaterEqual(payload['production_demands'], 1)
        self.assertGreaterEqual(payload['production_orders'], 1)
        self.assertGreaterEqual(payload['production_operations'], 1)
        self.assertGreaterEqual(payload['production_material_requirements'], 1)
        self.assertGreaterEqual(payload['audit_logs'], 1)
        self.assertGreaterEqual(payload['approval_history'], 1)
        self.assertTrue(Customer.objects.filter(pk=chain['customer'].pk).exists())
        self.assertTrue(ProductionOrder.objects.filter(pk=chain['production_order'].pk).exists())

    def test_tmp_reset_dry_run_text_outputs_counts_and_safety_notice(self):
        chain = self._create_order_chain(tag='TMP_TEXT')

        output = self._call('reset_dev_tmp_data', '--dry-run')

        self.assertIn('Dev TMP data dry-run. No data was deleted.', output)
        self.assertIn('Would delete:', output)
        self.assertIn('* customers: 1', output)
        self.assertIn('* products: 1', output)
        self.assertIn('* sales_orders: 1', output)
        self.assertIn('* production_demands: 1', output)
        self.assertIn('* production_orders: 1', output)
        self.assertIn('QA_ seed data is not targeted.', output)
        self.assertIn('Master data is not targeted.', output)
        self.assertIn('python manage.py reset_dev_tmp_data --confirm', output)
        self.assertTrue(Customer.objects.filter(pk=chain['customer'].pk).exists())
        self.assertTrue(ProductionOrder.objects.filter(pk=chain['production_order'].pk).exists())

    def test_tmp_reset_without_confirm_is_dry_run(self):
        chain = self._create_order_chain(tag='TMP_NO_CONFIRM')

        output = self._call('reset_dev_tmp_data', '--json')
        payload = json.loads(output)

        self.assertTrue(payload['dry_run'])
        self.assertFalse(payload['confirmed'])
        self.assertTrue(Customer.objects.filter(pk=chain['customer'].pk).exists())
        self.assertTrue(ProductionOrder.objects.filter(pk=chain['production_order'].pk).exists())

    def test_tmp_reset_confirm_removes_tmp_chain_and_preserves_qa_and_master_data(self):
        self._call('seed_dev_qa_data')
        chain = self._create_order_chain(tag='TMP_CONFIRM')
        self.assertTrue(Product.objects.filter(code='QA_PRODUCT_GENERIC_CARTON').exists())
        self.assertTrue(Customer.objects.filter(code='QA_CUSTOMER_A').exists())
        self.assertTrue(SalesOrder.objects.filter(code='QA_SO_SNAPSHOT_V2').exists())
        self.assertTrue(ProductionDemand.objects.filter(demand_code='QA_DEMAND_UPCOMING_7').exists())
        self.assertTrue(Operation.objects.filter(code='IN').exists())
        self.assertTrue(Setting.objects.filter(key='PRODUCTION_DEMAND_PLANNING_LEAD_DAYS').exists())
        self.assertTrue(User.objects.filter(username='uat_admin').exists())

        self._call('reset_dev_tmp_data', '--confirm')

        self.assertFalse(ProductionMaterialRequirement.objects.filter(pk=chain['material_requirement'].pk).exists())
        self.assertFalse(ProductionOperation.objects.filter(pk=chain['operation'].pk).exists())
        self.assertFalse(ProductionOrder.objects.filter(pk=chain['production_order'].pk).exists())
        self.assertFalse(ProductionDemand.objects.filter(pk=chain['demand'].pk).exists())
        self.assertFalse(SalesOrder.objects.filter(pk=chain['sales_order'].pk).exists())
        self.assertFalse(Product.objects.filter(pk=chain['product'].pk).exists())
        self.assertFalse(Customer.objects.filter(pk=chain['customer'].pk).exists())
        self.assertFalse(AuditLog.objects.filter(entity_type='ProductionOrder', entity_id=chain['production_order'].id).exists())
        self.assertFalse(ApprovalHistory.objects.filter(entity_type='ProductionOrder', entity_id=chain['production_order'].id).exists())
        self.assertTrue(Product.objects.filter(code='QA_PRODUCT_GENERIC_CARTON').exists())
        self.assertTrue(Customer.objects.filter(code='QA_CUSTOMER_A').exists())
        self.assertTrue(SalesOrder.objects.filter(code='QA_SO_SNAPSHOT_V2').exists())
        self.assertTrue(ProductionDemand.objects.filter(demand_code='QA_DEMAND_UPCOMING_7').exists())
        self.assertTrue(Operation.objects.filter(code='IN').exists())
        self.assertTrue(Setting.objects.filter(key='PRODUCTION_DEMAND_PLANNING_LEAD_DAYS').exists())
        self.assertTrue(User.objects.filter(username='uat_admin').exists())

    def test_tmp_reset_is_idempotent(self):
        self._create_order_chain(tag='TMP_IDEMPOTENT')

        self._call('reset_dev_tmp_data', '--confirm')
        output = self._call('reset_dev_tmp_data', '--confirm', '--json')
        payload = json.loads(output)

        self.assertFalse(payload['dry_run'])
        self.assertEqual(payload['production_orders'], 0)
        self.assertEqual(payload['production_demands'], 0)

    def test_tmp_reset_matches_existing_tmp_name_variants(self):
        self._create_order_chain(tag='TMP5C', customer_code='TMP5C_CUSTOMER', product_code='TMP5C_PRODUCT', order_code='TMP5C_SO')
        self._create_order_chain(tag='TMP6B', customer_code='TMP6B_CUSTOMER', product_code='TMP6B_PRODUCT', order_code='TMP6B_SO')
        self._create_order_chain(tag='T5B_VARIANT', customer_code='T5B_CUSTOMER', product_code='T5B_PRODUCT', order_code='T5B_SO')

        self._call('reset_dev_tmp_data', '--confirm')

        self.assertFalse(Customer.objects.filter(code='TMP5C_CUSTOMER').exists())
        self.assertFalse(Customer.objects.filter(code='TMP6B_CUSTOMER').exists())
        self.assertFalse(Customer.objects.filter(code='T5B_CUSTOMER').exists())
        self.assertFalse(Product.objects.filter(code='TMP5C_PRODUCT').exists())
        self.assertFalse(Product.objects.filter(code='TMP6B_PRODUCT').exists())
        self.assertFalse(Product.objects.filter(code='T5B_PRODUCT').exists())
        self.assertFalse(SalesOrder.objects.filter(code='TMP5C_SO').exists())
        self.assertFalse(SalesOrder.objects.filter(code='TMP6B_SO').exists())
        self.assertFalse(SalesOrder.objects.filter(code='T5B_SO').exists())

    def test_tmp_reset_does_not_delete_non_tmp_manual_data(self):
        chain = self._create_order_chain(
            tag='MANUAL_SAFE',
            customer_code='SAFE_CUSTOMER',
            product_code='SAFE_PRODUCT',
            order_code='SAFE_SO',
        )

        self._call('reset_dev_tmp_data', '--confirm')

        self.assertTrue(Customer.objects.filter(pk=chain['customer'].pk).exists())
        self.assertTrue(Product.objects.filter(pk=chain['product'].pk).exists())
        self.assertTrue(SalesOrder.objects.filter(pk=chain['sales_order'].pk).exists())
        self.assertTrue(ProductionOrder.objects.filter(pk=chain['production_order'].pk).exists())
