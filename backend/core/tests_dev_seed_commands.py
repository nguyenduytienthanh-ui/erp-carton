import json
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from core.management.commands.bootstrap_uat_demo import USER_MATRIX
from core.models import Customer, Role, Setting, Team, User
from products.models import Operation, Product, ProductOperation, ProductRoutingStep
from production.models import (
    ProductionDemand,
    ProductionDemandPlanningStatus,
    ProductionDemandProductionStatus,
)
from sales.models import DeliveryCarrier, SalesOrder


class DevSeedCommandTests(TestCase):
    def _call(self, *args):
        output = StringIO()
        call_command(*args, stdout=output)
        return output.getvalue()

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
