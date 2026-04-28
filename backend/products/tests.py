import importlib

from django.apps import apps as django_apps
from django.test import TestCase
from rest_framework.test import APIClient

from core.models import User
from products.models import Operation, Product, ProductOperation, ProductUnit


OPERATION_CODES = ['XA', 'IN', 'CAN_MANG', 'BOI', 'BE', 'CHAP', 'DONG', 'DAN', 'KHAC']


def run_operation_seed_backfill():
    migration = importlib.import_module(
        'products.migrations.0015_seed_operations_and_backfill_product_operations'
    )
    migration.seed_operations_and_backfill_product_operations(django_apps, None)


class ProductOperationBackfillTest(TestCase):
    def setUp(self):
        self.unit = ProductUnit.objects.create(code='CAI', name='Cai')

    def test_seed_creates_expected_operation_master_rows(self):
        run_operation_seed_backfill()

        operations = Operation.objects.filter(code__in=OPERATION_CODES).order_by('sequence')

        self.assertEqual(operations.count(), 9)
        self.assertEqual(list(operations.values_list('code', flat=True)), OPERATION_CODES)
        self.assertEqual(operations.get(code='CAN_MANG').sequence, 30)

    def test_backfill_creates_product_operation_for_positive_process_rate(self):
        product = Product.objects.create(
            code='OP-BACKFILL-IN',
            name='Backfill In',
            unit=self.unit,
            process_in=20000,
        )

        run_operation_seed_backfill()

        product_operation = ProductOperation.objects.get(product=product, operation__code='IN')
        self.assertEqual(product_operation.operation_code, 'IN')
        self.assertEqual(product_operation.operation_name, 'In')
        self.assertEqual(product_operation.sequence, 20)
        self.assertEqual(product_operation.standard_rate_per_hour, 20000)

    def test_backfill_skips_empty_zero_and_negative_process_rates(self):
        product = Product.objects.create(
            code='OP-BACKFILL-SKIP',
            name='Backfill Skip',
            unit=self.unit,
            process_xa=None,
            process_in=0,
            process_be=-5,
        )

        run_operation_seed_backfill()

        self.assertFalse(ProductOperation.objects.filter(product=product).exists())

    def test_backfill_is_idempotent_for_existing_product_operation(self):
        product = Product.objects.create(
            code='OP-BACKFILL-IDEMPOTENT',
            name='Backfill Idempotent',
            unit=self.unit,
            process_in=20000,
        )

        run_operation_seed_backfill()
        run_operation_seed_backfill()

        self.assertEqual(ProductOperation.objects.filter(product=product, operation__code='IN').count(), 1)


class ProductOperationApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='product_ops', password='pass')
        self.client.force_authenticate(user=self.user)
        self.unit = ProductUnit.objects.create(code='CAI', name='Cai')
        run_operation_seed_backfill()

    def test_product_api_returns_legacy_process_fields_and_product_operations(self):
        operation = Operation.objects.get(code='IN')
        product = Product.objects.create(
            code='OP-API-IN',
            name='API In',
            unit=self.unit,
            process_in=20000,
        )
        ProductOperation.objects.create(
            product=product,
            operation=operation,
            standard_rate_per_hour=20000,
            note='Standard in rate',
        )

        response = self.client.get(f'/api/products/products/{product.id}/')

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['process_in'], 20000)
        self.assertEqual(len(payload['operations']), 1)
        self.assertEqual(payload['operations'][0]['operation_code'], 'IN')
        self.assertEqual(payload['operations'][0]['standard_rate_per_hour'], 20000)
        self.assertEqual(payload['operations'][0]['note'], 'Standard in rate')

    def test_product_api_falls_back_to_process_fields_when_no_product_operations_exist(self):
        product = Product.objects.create(
            code='OP-API-FALLBACK',
            name='API Fallback',
            unit=self.unit,
            process_xa=3000,
        )

        response = self.client.get(f'/api/products/products/{product.id}/')

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['process_xa'], 3000)
        self.assertEqual(len(payload['operations']), 1)
        self.assertIsNone(payload['operations'][0]['id'])
        self.assertEqual(payload['operations'][0]['operation_code'], 'XA')
        self.assertEqual(payload['operations'][0]['standard_rate_per_hour'], 3000)

    def test_product_create_accepts_operations_input_and_syncs_legacy_process_fields(self):
        response = self.client.post(
            '/api/products/products/',
            {
                'code': 'OP-API-CREATE',
                'name': 'API Create',
                'unit': self.unit.id,
                'process_in': 999,
                'operations_input': [
                    {
                        'operation_code': 'IN',
                        'standard_rate_per_hour': 21000,
                        'note': 'Primary input wins',
                    },
                    {
                        'operation_code': 'XA',
                        'standard_rate_per_hour': 3000,
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        product = Product.objects.get(code='OP-API-CREATE')
        self.assertEqual(product.process_in, 21000)
        self.assertEqual(product.process_xa, 3000)
        self.assertNotIn('operations_input', payload)
        self.assertEqual(payload['process_in'], 21000)
        self.assertEqual(payload['process_xa'], 3000)
        self.assertEqual(
            list(ProductOperation.objects.filter(product=product, is_active=True).values_list('operation__code', flat=True).order_by('sequence')),
            ['XA', 'IN'],
        )
        self.assertEqual(ProductOperation.objects.get(product=product, operation__code='IN').note, 'Primary input wins')

    def test_product_update_operations_input_replaces_active_operations_and_process_fields(self):
        product = Product.objects.create(
            code='OP-API-UPDATE',
            name='API Update',
            unit=self.unit,
            process_xa=3000,
            process_in=20000,
        )
        ProductOperation.objects.create(
            product=product,
            operation=Operation.objects.get(code='XA'),
            standard_rate_per_hour=3000,
        )
        ProductOperation.objects.create(
            product=product,
            operation=Operation.objects.get(code='IN'),
            standard_rate_per_hour=20000,
        )

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {
                'operations_input': [
                    {
                        'operation_code': 'BOI',
                        'standard_rate_per_hour': 5000,
                        'note': 'Updated from operations input',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        product.refresh_from_db()
        self.assertIsNone(product.process_xa)
        self.assertIsNone(product.process_in)
        self.assertEqual(product.process_boi, 5000)
        self.assertEqual(len(payload['operations']), 1)
        self.assertEqual(payload['operations'][0]['operation_code'], 'BOI')
        self.assertEqual(payload['operations'][0]['standard_rate_per_hour'], 5000)
        self.assertFalse(ProductOperation.objects.get(product=product, operation__code='XA').is_active)
        self.assertFalse(ProductOperation.objects.get(product=product, operation__code='IN').is_active)

    def test_product_update_legacy_process_fields_syncs_product_operations(self):
        product = Product.objects.create(
            code='OP-API-LEGACY-SYNC',
            name='API Legacy Sync',
            unit=self.unit,
        )

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {'process_in': 22000},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        product.refresh_from_db()
        product_operation = ProductOperation.objects.get(product=product, operation__code='IN')
        self.assertEqual(product.process_in, 22000)
        self.assertEqual(product_operation.standard_rate_per_hour, 22000)
        self.assertTrue(product_operation.is_active)
        self.assertEqual(payload['operations'][0]['operation_code'], 'IN')
        self.assertEqual(payload['operations'][0]['standard_rate_per_hour'], 22000)
