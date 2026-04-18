from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from core.models import AuditLog, User
from products.models import BundlePriceChange, Product, ProductBundle, ProductBundleComponent, ProductUnit


class BundlePriceWorkflowApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='bundle_ops', password='pass')
        self.client.force_authenticate(user=self.user)

        self.unit = ProductUnit.objects.create(code='CAI', name='Cái', created_by=self.user, updated_by=self.user)
        self.mother = Product.objects.create(
            code='BUNDLE-001',
            name='Bộ carton 001',
            unit=self.unit,
            cost_price=Decimal('10000'),
            sale_price=Decimal('12000'),
            commission_per_unit=Decimal('500'),
            commission_percent=Decimal('2'),
            created_by=self.user,
            updated_by=self.user,
            status='ACTIVE',
        )
        self.child = Product.objects.create(
            code='BUNDLE-001-1',
            name='Lót bộ carton 001',
            unit=self.unit,
            parent=self.mother,
            component_quantity=1,
            cost_price=Decimal('3000'),
            sale_price=Decimal('3500'),
            commission_per_unit=Decimal('100'),
            commission_percent=Decimal('1'),
            created_by=self.user,
            updated_by=self.user,
            status='ACTIVE',
        )
        self.bundle = ProductBundle.objects.create(
            sellable_product=self.mother,
            primary_product=self.mother,
            pricing_mode=ProductBundle.PRICING_MODE_FIXED,
            fixed_cost_price=Decimal('10000'),
            fixed_sale_price=Decimal('14000'),
            commission_mode=ProductBundle.COMMISSION_MODE_FIXED,
            fixed_commission_per_unit=Decimal('600'),
            fixed_commission_percent=Decimal('3'),
            delivery_rule=ProductBundle.DELIVERY_RULE_STRICT_FULL_SET,
            created_by=self.user,
            updated_by=self.user,
        )
        ProductBundleComponent.objects.create(
            bundle=self.bundle,
            component_product=self.child,
            qty_per_bundle=Decimal('1'),
            is_required=True,
        )

    def test_submit_and_approve_bundle_fixed_price_change(self):
        submit_res = self.client.post(
            f'/api/products/products/{self.mother.id}/submit_bundle_price_change/',
            {
                'new_cost_price': '11000',
                'new_sale_price': '15500',
                'new_commission_per_unit': '700',
                'new_commission_percent': '4',
                'reason': 'Điều chỉnh giá bộ theo hợp đồng mới',
            },
            format='json',
        )
        self.assertEqual(submit_res.status_code, 201)
        payload = submit_res.json()
        self.assertEqual(payload['status'], BundlePriceChange.STATUS_PENDING_APPROVAL)

        approve_res = self.client.post(
            f'/api/products/products/{self.mother.id}/approve_bundle_price_change/',
            {'change_id': payload['id']},
            format='json',
        )
        self.assertEqual(approve_res.status_code, 200)
        approved_payload = approve_res.json()
        self.assertEqual(approved_payload['status'], BundlePriceChange.STATUS_ACTIVE_APPLIED)

        self.bundle.refresh_from_db()
        self.assertEqual(self.bundle.fixed_cost_price, Decimal('11000'))
        self.assertEqual(self.bundle.fixed_sale_price, Decimal('15500'))
        self.assertEqual(self.bundle.fixed_commission_per_unit, Decimal('700'))
        self.assertEqual(self.bundle.fixed_commission_percent, Decimal('4'))

    def test_product_activity_stream_includes_child_and_bundle_history(self):
        AuditLog.objects.create(
            user=self.user,
            action='UPDATE',
            entity_type='Product',
            entity_id=self.child.id,
            entity_id_str=str(self.child.id),
            entity_code=self.child.code,
            old_values={'film_code': 'FILM-OLD'},
            new_values={'film_code': 'FILM-NEW'},
            changed_fields=['film_code'],
        )
        AuditLog.objects.create(
            user=self.user,
            action='UPDATE',
            entity_type='ProductBundle',
            entity_id=self.bundle.id,
            entity_id_str=str(self.bundle.id),
            entity_code=self.mother.code,
            old_values={'pricing_mode': 'PRIMARY_PRODUCT'},
            new_values={'pricing_mode': 'FIXED_BUNDLE'},
            changed_fields=['pricing_mode'],
        )
        BundlePriceChange.objects.create(
            bundle=self.bundle,
            old_fixed_cost_price=Decimal('10000'),
            new_fixed_cost_price=Decimal('12000'),
            old_fixed_sale_price=Decimal('14000'),
            new_fixed_sale_price=Decimal('16000'),
            old_fixed_commission_per_unit=Decimal('600'),
            new_fixed_commission_per_unit=Decimal('750'),
            old_fixed_commission_percent=Decimal('3'),
            new_fixed_commission_percent=Decimal('4'),
            delta_cost=Decimal('2000'),
            delta_sale=Decimal('2000'),
            reason='Điều chỉnh giá bộ mùa cao điểm',
            status=BundlePriceChange.STATUS_PENDING_APPROVAL,
            submitted_by=self.user,
        )

        res = self.client.get('/api/activity/by_entity/', {
            'entity_type': 'Product',
            'entity_id': self.mother.id,
        })
        self.assertEqual(res.status_code, 200)
        items = res.json()

        has_child_item = any(
            item.get('details', {}).get('entity_scope') == 'COMPONENT_PRODUCT'
            and item.get('details', {}).get('related_entity_code') == self.child.code
            for item in items
        )
        has_bundle_config_item = any(
            item.get('details', {}).get('entity_scope') == 'BUNDLE_CONFIG'
            for item in items
        )
        has_bundle_price_item = any(
            item.get('details', {}).get('entity_scope') == 'BUNDLE_FIXED'
            for item in items
        )

        self.assertTrue(has_child_item)
        self.assertTrue(has_bundle_config_item)
        self.assertTrue(has_bundle_price_item)
