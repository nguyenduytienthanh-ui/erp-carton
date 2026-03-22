from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from core.models import User
from sales.models import SalesDiscountRule


class SalesDiscountManagementTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='sales_discount_admin',
            password='Demo123!',
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(user=self.user)
        today = timezone.localdate()
        self.active_rule = SalesDiscountRule.objects.create(
            code='DISC-ACTIVE',
            name='Tet campaign',
            type=SalesDiscountRule.TYPE_PERCENTAGE,
            value='12.5',
            applicable_to=SalesDiscountRule.APPLIES_ALL_PRODUCTS,
            min_order_value='5000000',
            start_date=today - timedelta(days=2),
            end_date=today + timedelta(days=5),
            status=SalesDiscountRule.STATUS_ACTIVE,
            usage_count=4,
            total_discount_value='1200000',
            created_by=self.user,
            updated_by=self.user,
        )
        self.inactive_rule = SalesDiscountRule.objects.create(
            code='DISC-INACTIVE',
            name='Old campaign',
            type=SalesDiscountRule.TYPE_FIXED,
            value='300000',
            applicable_to=SalesDiscountRule.APPLIES_SPECIFIC_CUSTOMERS,
            start_date=today - timedelta(days=30),
            end_date=today - timedelta(days=10),
            status=SalesDiscountRule.STATUS_INACTIVE,
            usage_count=2,
            total_discount_value='500000',
            created_by=self.user,
            updated_by=self.user,
        )

    def test_create_update_deactivate_discount_rule(self):
        create_response = self.client.post(
            '/api/sales/discounts/',
            {
                'code': 'disc-new',
                'name': 'Volume bonus',
                'type': SalesDiscountRule.TYPE_PERCENTAGE,
                'value': '8',
                'applicable_to': SalesDiscountRule.APPLIES_VOLUME_BASED,
                'min_quantity': '100',
                'start_date': timezone.localdate().isoformat(),
                'status': SalesDiscountRule.STATUS_ACTIVE,
                'note': 'Created from test',
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)
        self.assertEqual(create_response.data['code'], 'DISC-NEW')
        created_id = create_response.data['id']

        update_response = self.client.patch(
            f'/api/sales/discounts/{created_id}/',
            {'value': '10', 'note': 'Updated by test'},
            format='json',
        )
        self.assertEqual(update_response.status_code, 200, update_response.data)
        self.assertEqual(str(update_response.data['value']), '10.00')

        deactivate_response = self.client.post(
            f'/api/sales/discounts/{created_id}/deactivate/',
            format='json',
        )
        self.assertEqual(deactivate_response.status_code, 200, deactivate_response.data)
        self.assertEqual(deactivate_response.data['status'], SalesDiscountRule.STATUS_INACTIVE)

        list_response = self.client.get('/api/sales/discounts/', {'status': SalesDiscountRule.STATUS_INACTIVE})
        self.assertEqual(list_response.status_code, 200, list_response.data)
        self.assertGreaterEqual(list_response.data['count'], 2)

    def test_discount_summary_and_filters(self):
        list_response = self.client.get('/api/sales/discounts/', {'q': 'Tet', 'currently_active': 'true'})
        self.assertEqual(list_response.status_code, 200, list_response.data)
        self.assertEqual(list_response.data['count'], 1)
        self.assertEqual(list_response.data['results'][0]['code'], self.active_rule.code)

        summary_response = self.client.get('/api/sales/discounts/summary/')
        self.assertEqual(summary_response.status_code, 200, summary_response.data)
        self.assertEqual(summary_response.data['total_count'], 2)
        self.assertEqual(summary_response.data['active_count'], 1)
        self.assertEqual(summary_response.data['inactive_count'], 1)
        self.assertEqual(summary_response.data['currently_active_count'], 1)
        self.assertEqual(summary_response.data['total_usage'], 6)
