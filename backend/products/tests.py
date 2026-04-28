import importlib

from django.apps import apps as django_apps
from django.test import TestCase
from rest_framework.test import APIClient

from core.models import User
from products.models import Operation, Product, ProductOperation, ProductRoutingStep, ProductUnit


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

    def create_product_with_operations(self, code):
        product = Product.objects.create(
            code=code,
            name=code,
            unit=self.unit,
        )
        for operation_code, rate in [('XA', 3000), ('IN', 20000)]:
            ProductOperation.objects.create(
                product=product,
                operation=Operation.objects.get(code=operation_code),
                standard_rate_per_hour=rate,
            )
        return product

    def test_product_defaults_to_specific_kind(self):
        product = Product.objects.create(
            code='KIND-DEFAULT',
            name='Kind Default',
            unit=self.unit,
        )

        self.assertEqual(product.product_kind, Product.ProductKind.SPECIFIC)
        self.assertFalse(product.requires_order_spec)
        self.assertFalse(product.requires_order_operations_review)

    def test_product_api_returns_product_kind_fields(self):
        product = Product.objects.create(
            code='KIND-API-FIELDS',
            name='Kind API Fields',
            unit=self.unit,
            requires_order_spec=True,
        )

        response = self.client.get(f'/api/products/products/{product.id}/')

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['product_kind'], 'SPECIFIC')
        self.assertTrue(payload['requires_order_spec'])
        self.assertFalse(payload['requires_order_operations_review'])

    def test_product_create_generic_auto_sets_order_review_flags(self):
        response = self.client.post(
            '/api/products/products/',
            {
                'code': 'KIND-GENERIC-CREATE',
                'name': 'Kind Generic Create',
                'unit': self.unit.id,
                'product_kind': 'GENERIC',
                'requires_order_spec': False,
                'requires_order_operations_review': False,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        product = Product.objects.get(code='KIND-GENERIC-CREATE')
        self.assertEqual(product.product_kind, Product.ProductKind.GENERIC)
        self.assertTrue(product.requires_order_spec)
        self.assertTrue(product.requires_order_operations_review)
        self.assertTrue(payload['requires_order_spec'])
        self.assertTrue(payload['requires_order_operations_review'])

    def test_product_update_to_generic_auto_sets_order_review_flags(self):
        product = Product.objects.create(
            code='KIND-GENERIC-UPDATE',
            name='Kind Generic Update',
            unit=self.unit,
        )

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {
                'product_kind': 'GENERIC',
                'requires_order_spec': False,
                'requires_order_operations_review': False,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        product.refresh_from_db()
        self.assertEqual(product.product_kind, Product.ProductKind.GENERIC)
        self.assertTrue(product.requires_order_spec)
        self.assertTrue(product.requires_order_operations_review)
        self.assertTrue(payload['requires_order_spec'])
        self.assertTrue(payload['requires_order_operations_review'])

    def test_specific_product_allows_manual_order_review_flags(self):
        response = self.client.post(
            '/api/products/products/',
            {
                'code': 'KIND-SPECIFIC-FLAGS',
                'name': 'Kind Specific Flags',
                'unit': self.unit.id,
                'product_kind': 'SPECIFIC',
                'requires_order_spec': True,
                'requires_order_operations_review': False,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        product = Product.objects.get(code='KIND-SPECIFIC-FLAGS')
        self.assertEqual(product.product_kind, Product.ProductKind.SPECIFIC)
        self.assertTrue(product.requires_order_spec)
        self.assertFalse(product.requires_order_operations_review)
        self.assertTrue(payload['requires_order_spec'])
        self.assertFalse(payload['requires_order_operations_review'])

    def test_product_create_with_print_colors_sets_color_count(self):
        response = self.client.post(
            '/api/products/products/',
            {
                'code': 'COLOR-CREATE-3',
                'name': 'Color Create 3',
                'unit': self.unit.id,
                'print_color_1': ' Đen ',
                'print_color_2': 'Đỏ',
                'print_color_3': '',
                'print_color_4': 'Pantone 185C',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        product = Product.objects.get(code='COLOR-CREATE-3')
        self.assertEqual(product.print_color_1, 'Đen')
        self.assertEqual(product.print_color_2, 'Đỏ')
        self.assertEqual(product.print_color_4, 'Pantone 185C')
        self.assertEqual(product.color_count, 3)
        self.assertEqual(payload['color_count'], 3)
        self.assertEqual(payload['print_colors'], ['Đen', 'Đỏ', 'Pantone 185C'])

    def test_product_create_without_print_colors_defaults_color_count_to_zero(self):
        response = self.client.post(
            '/api/products/products/',
            {
                'code': 'COLOR-CREATE-EMPTY',
                'name': 'Color Create Empty',
                'unit': self.unit.id,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        product = Product.objects.get(code='COLOR-CREATE-EMPTY')
        self.assertEqual(product.color_count, 0)
        self.assertEqual(response.json()['print_colors'], [])

    def test_product_update_print_colors_updates_color_count(self):
        product = Product.objects.create(
            code='COLOR-UPDATE-ADD',
            name='Color Update Add',
            unit=self.unit,
        )

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {
                'print_color_1': 'Xanh',
                'print_color_2': 'Vàng',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        product.refresh_from_db()
        self.assertEqual(product.color_count, 2)
        self.assertEqual(response.json()['print_colors'], ['Xanh', 'Vàng'])

    def test_product_update_empty_print_colors_preserves_legacy_color_count(self):
        product = Product.objects.create(
            code='COLOR-UPDATE-PRESERVE',
            name='Color Update Preserve',
            unit=self.unit,
        )
        Product.objects.filter(pk=product.pk).update(color_count=4)
        product.refresh_from_db()

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {
                'print_color_1': '',
                'print_color_2': '',
                'print_color_3': '',
                'print_color_4': '',
                'print_color_5': '',
                'color_count': 0,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        product.refresh_from_db()
        self.assertEqual(product.color_count, 4)
        self.assertEqual(response.json()['print_colors'], [])

    def test_product_api_returns_print_color_fields(self):
        product = Product.objects.create(
            code='COLOR-API-FIELDS',
            name='Color API Fields',
            unit=self.unit,
            print_color_1='Đen',
            print_color_5='CMYK',
        )

        response = self.client.get(f'/api/products/products/{product.id}/')

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['print_color_1'], 'Đen')
        self.assertEqual(payload['print_color_2'], '')
        self.assertEqual(payload['print_color_3'], '')
        self.assertEqual(payload['print_color_4'], '')
        self.assertEqual(payload['print_color_5'], 'CMYK')
        self.assertEqual(payload['color_count'], 2)
        self.assertEqual(payload['print_colors'], ['Đen', 'CMYK'])

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

    def test_product_api_returns_default_routing_from_product_operations(self):
        product = Product.objects.create(
            code='ROUTE-DEFAULT',
            name='Route Default',
            unit=self.unit,
        )
        ProductOperation.objects.create(
            product=product,
            operation=Operation.objects.get(code='IN'),
            standard_rate_per_hour=20000,
            note='Default in',
        )
        ProductOperation.objects.create(
            product=product,
            operation=Operation.objects.get(code='XA'),
            standard_rate_per_hour=3000,
            note='Default xa',
        )

        response = self.client.get(f'/api/products/products/{product.id}/')

        self.assertEqual(response.status_code, 200)
        routing_steps = response.json()['routing_steps']
        self.assertEqual([step['operation_code'] for step in routing_steps], ['XA', 'IN'])
        self.assertEqual([step['source'] for step in routing_steps], ['product_operations_default', 'product_operations_default'])
        self.assertEqual([step['display_step'] for step in routing_steps], [1, 2])
        self.assertEqual([step['step_no'] for step in routing_steps], [10, 20])
        self.assertIsNone(routing_steps[0]['route_step_id'])
        self.assertIsNotNone(routing_steps[0]['product_operation_id'])

    def test_product_api_prefers_custom_product_routing_steps(self):
        product = Product.objects.create(
            code='ROUTE-CUSTOM',
            name='Route Custom',
            unit=self.unit,
        )
        xa_operation = Operation.objects.get(code='XA')
        in_operation = Operation.objects.get(code='IN')
        xa_product_operation = ProductOperation.objects.create(
            product=product,
            operation=xa_operation,
            standard_rate_per_hour=3000,
        )
        in_product_operation = ProductOperation.objects.create(
            product=product,
            operation=in_operation,
            standard_rate_per_hour=20000,
        )
        first_step = ProductRoutingStep.objects.create(
            product=product,
            operation=in_operation,
            product_operation=in_product_operation,
            step_no=10,
            display_order=10,
            standard_rate_per_hour=20000,
            note='Custom first',
        )
        ProductRoutingStep.objects.create(
            product=product,
            operation=xa_operation,
            product_operation=xa_product_operation,
            step_no=20,
            display_order=20,
            standard_rate_per_hour=3000,
            note='Custom second',
        )

        response = self.client.get(f'/api/products/products/{product.id}/')

        self.assertEqual(response.status_code, 200)
        routing_steps = response.json()['routing_steps']
        self.assertEqual([step['operation_code'] for step in routing_steps], ['IN', 'XA'])
        self.assertEqual([step['source'] for step in routing_steps], ['product_routing', 'product_routing'])
        self.assertEqual(routing_steps[0]['route_step_id'], first_step.id)
        self.assertEqual(routing_steps[0]['product_operation_id'], in_product_operation.id)

    def test_product_api_routing_supports_repeated_operation(self):
        product = Product.objects.create(
            code='ROUTE-REPEAT',
            name='Route Repeat',
            unit=self.unit,
        )
        xa_operation = Operation.objects.get(code='XA')
        xa_product_operation = ProductOperation.objects.create(
            product=product,
            operation=xa_operation,
            standard_rate_per_hour=3000,
        )
        ProductRoutingStep.objects.create(
            product=product,
            operation=xa_operation,
            product_operation=xa_product_operation,
            step_no=10,
            display_order=10,
            standard_rate_per_hour=3000,
            note='Xa lan 1',
        )
        ProductRoutingStep.objects.create(
            product=product,
            operation=xa_operation,
            product_operation=xa_product_operation,
            step_no=30,
            display_order=30,
            standard_rate_per_hour=3200,
            note='Xa lan 2',
        )

        response = self.client.get(f'/api/products/products/{product.id}/')

        self.assertEqual(response.status_code, 200)
        routing_steps = response.json()['routing_steps']
        self.assertEqual([step['operation_code'] for step in routing_steps], ['XA', 'XA'])
        self.assertEqual([step['step_no'] for step in routing_steps], [10, 30])
        self.assertEqual([step['display_step'] for step in routing_steps], [1, 2])
        self.assertEqual([step['note'] for step in routing_steps], ['Xa lan 1', 'Xa lan 2'])

    def test_product_api_routing_supports_same_step_no_display_step(self):
        product = Product.objects.create(
            code='ROUTE-SAME-STEP',
            name='Route Same Step',
            unit=self.unit,
        )
        dong_operation = Operation.objects.get(code='DONG')
        dan_operation = Operation.objects.get(code='DAN')
        dong_product_operation = ProductOperation.objects.create(
            product=product,
            operation=dong_operation,
            standard_rate_per_hour=5000,
        )
        dan_product_operation = ProductOperation.objects.create(
            product=product,
            operation=dan_operation,
            standard_rate_per_hour=4500,
        )
        ProductRoutingStep.objects.create(
            product=product,
            operation=dong_operation,
            product_operation=dong_product_operation,
            step_no=30,
            display_order=10,
            standard_rate_per_hour=5000,
            step_type=ProductRoutingStep.StepType.PARALLEL,
            allow_parallel=True,
        )
        ProductRoutingStep.objects.create(
            product=product,
            operation=dan_operation,
            product_operation=dan_product_operation,
            step_no=30,
            display_order=20,
            standard_rate_per_hour=4500,
            step_type=ProductRoutingStep.StepType.PARALLEL,
            allow_parallel=True,
        )

        response = self.client.get(f'/api/products/products/{product.id}/')

        self.assertEqual(response.status_code, 200)
        routing_steps = response.json()['routing_steps']
        self.assertEqual([step['operation_code'] for step in routing_steps], ['DONG', 'DAN'])
        self.assertEqual([step['step_no'] for step in routing_steps], [30, 30])
        self.assertEqual([step['display_step'] for step in routing_steps], [1, 1])
        self.assertTrue(all(step['allow_parallel'] for step in routing_steps))

    def test_product_api_falls_back_to_legacy_process_fields_for_routing(self):
        product = Product.objects.create(
            code='ROUTE-LEGACY',
            name='Route Legacy',
            unit=self.unit,
            process_xa=3000,
            process_in=20000,
        )

        response = self.client.get(f'/api/products/products/{product.id}/')

        self.assertEqual(response.status_code, 200)
        routing_steps = response.json()['routing_steps']
        self.assertEqual([step['operation_code'] for step in routing_steps], ['XA', 'IN'])
        self.assertEqual([step['source'] for step in routing_steps], ['legacy_process_fields', 'legacy_process_fields'])
        self.assertEqual([step['standard_rate_per_hour'] for step in routing_steps], [3000, 20000])
        self.assertTrue(all(step['route_step_id'] is None for step in routing_steps))
        self.assertFalse(ProductOperation.objects.filter(product=product).exists())

    def test_product_create_accepts_routing_input(self):
        response = self.client.post(
            '/api/products/products/',
            {
                'code': 'ROUTE-INPUT-CREATE',
                'name': 'Route Input Create',
                'unit': self.unit.id,
                'routing_input': [
                    {
                        'step_no': 10,
                        'operation_code': 'IN',
                        'standard_rate_per_hour': 20000,
                        'note': 'In truoc',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        product = Product.objects.get(code='ROUTE-INPUT-CREATE')
        self.assertNotIn('routing_input', payload)
        self.assertEqual(ProductRoutingStep.objects.filter(product=product, is_active=True).count(), 1)
        self.assertEqual(payload['routing_steps'][0]['source'], 'product_routing')
        self.assertEqual(payload['routing_steps'][0]['operation_code'], 'IN')
        self.assertIsNone(payload['routing_steps'][0]['product_operation_id'])

    def test_product_update_routing_input_replaces_custom_routing(self):
        product = self.create_product_with_operations('ROUTE-INPUT-UPDATE')

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {
                'routing_input': [
                    {
                        'step_no': 10,
                        'operation_code': 'IN',
                        'standard_rate_per_hour': 20000,
                        'note': 'In truoc',
                    },
                    {
                        'step_no': 20,
                        'operation_code': 'XA',
                        'standard_rate_per_hour': 12000,
                        'note': 'Xa sau in',
                    },
                    {
                        'step_no': 30,
                        'operation_code': 'XA',
                        'standard_rate_per_hour': 10000,
                        'note': 'Xa lan 2',
                    },
                    {
                        'step_no': 40,
                        'operation_code': 'DONG',
                        'standard_rate_per_hour': 8000,
                        'note': 'Dong',
                        'step_type': 'PARALLEL',
                        'group_code': 'finish',
                    },
                    {
                        'step_no': 40,
                        'operation_code': 'DAN',
                        'standard_rate_per_hour': 7000,
                        'note': 'Dan cung buoc',
                        'step_type': 'PARALLEL',
                        'group_code': 'finish',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        routing_steps = payload['routing_steps']
        self.assertNotIn('routing_input', payload)
        self.assertEqual([step['source'] for step in routing_steps], ['product_routing'] * 5)
        self.assertEqual([step['operation_code'] for step in routing_steps], ['IN', 'XA', 'XA', 'DONG', 'DAN'])
        self.assertEqual([step['step_no'] for step in routing_steps], [10, 20, 30, 40, 40])
        self.assertEqual([step['display_step'] for step in routing_steps], [1, 2, 3, 4, 4])
        self.assertTrue(routing_steps[3]['allow_parallel'])
        self.assertTrue(routing_steps[4]['allow_parallel'])
        self.assertEqual(routing_steps[3]['group_code'], 'FINISH')
        self.assertEqual(ProductRoutingStep.objects.filter(product=product, is_active=True).count(), 5)
        self.assertEqual(ProductOperation.objects.filter(product=product, is_active=True).count(), 2)
        self.assertEqual(product.process_in, None)

    def test_product_update_routing_input_empty_deactivates_custom_and_returns_fallback(self):
        product = self.create_product_with_operations('ROUTE-INPUT-CLEAR')
        ProductRoutingStep.objects.create(
            product=product,
            operation=Operation.objects.get(code='IN'),
            step_no=10,
            display_order=10,
            standard_rate_per_hour=20000,
            note='Custom route',
        )

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {'routing_input': []},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        routing_steps = response.json()['routing_steps']
        self.assertEqual(ProductRoutingStep.objects.filter(product=product, is_active=True).count(), 0)
        self.assertEqual(ProductRoutingStep.objects.filter(product=product, is_active=False).count(), 1)
        self.assertEqual({step['source'] for step in routing_steps}, {'product_operations_default'})
        self.assertEqual([step['operation_code'] for step in routing_steps], ['XA', 'IN'])

    def test_product_update_without_routing_input_preserves_custom_routing(self):
        product = self.create_product_with_operations('ROUTE-INPUT-PRESERVE')
        route_step = ProductRoutingStep.objects.create(
            product=product,
            operation=Operation.objects.get(code='IN'),
            step_no=10,
            display_order=10,
            standard_rate_per_hour=20000,
            note='Keep me',
        )

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {'name': 'Route Input Preserve Renamed'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        route_step.refresh_from_db()
        routing_steps = response.json()['routing_steps']
        self.assertTrue(route_step.is_active)
        self.assertEqual(ProductRoutingStep.objects.filter(product=product, is_active=True).count(), 1)
        self.assertEqual(routing_steps[0]['route_step_id'], route_step.id)
        self.assertEqual(routing_steps[0]['source'], 'product_routing')

    def test_product_update_routing_input_requires_group_code_for_choose_one(self):
        product = self.create_product_with_operations('ROUTE-INPUT-CHOOSE-ONE')

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {
                'routing_input': [
                    {
                        'step_no': 10,
                        'operation_code': 'IN',
                        'standard_rate_per_hour': 20000,
                        'step_type': 'CHOOSE_ONE',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(ProductRoutingStep.objects.filter(product=product).count(), 0)

    def test_product_update_routing_input_rejects_unknown_operation_code(self):
        product = self.create_product_with_operations('ROUTE-INPUT-BAD-OP')

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {
                'routing_input': [
                    {
                        'step_no': 10,
                        'operation_code': 'NO_SUCH_OPERATION',
                        'standard_rate_per_hour': 20000,
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_product_update_routing_input_rejects_invalid_rate_and_step_no(self):
        product = self.create_product_with_operations('ROUTE-INPUT-BAD-NUMBER')

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {
                'routing_input': [
                    {
                        'step_no': 0,
                        'operation_code': 'IN',
                        'standard_rate_per_hour': 0,
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)

        response = self.client.patch(
            f'/api/products/products/{product.id}/',
            {
                'routing_input': [
                    {
                        'step_no': 'abc',
                        'operation_code': 'IN',
                        'standard_rate_per_hour': 'abc',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)

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
        self.assertEqual([step['operation_code'] for step in payload['routing_steps']], ['XA', 'IN'])
        self.assertEqual(
            {step['source'] for step in payload['routing_steps']},
            {'product_operations_default'},
        )

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
