from decimal import Decimal

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from core.models import Customer, User
from django.test import TestCase


class CustomerV1ApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='customer_v1_admin',
            password='pass',
            is_staff=True,
            is_superuser=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.list_url = reverse('customer-list')

    def test_create_allows_blank_code_and_blank_tax_code(self):
        response = self.client.post(
            self.list_url,
            {
                'code': '',
                'name': 'Customer Blank Code',
                'tax_code': '',
                'payment_terms': 30,
                'credit_limit': '0',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['code'].startswith('KH-'))
        self.assertEqual(response.data['tax_code'], '')

    def test_tax_code_is_trimmed_unique_and_same_record_edit_is_allowed(self):
        first = self.client.post(
            self.list_url,
            {
                'code': 'CUS-TAX-001',
                'name': 'Customer Tax One',
                'tax_code': ' MST-001 ',
                'payment_terms': 15,
                'credit_limit': '1000000',
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(first.data['tax_code'], 'MST-001')

        duplicate = self.client.post(
            self.list_url,
            {
                'code': 'CUS-TAX-002',
                'name': 'Customer Tax Two',
                'tax_code': 'mst-001',
                'payment_terms': 15,
                'credit_limit': '1000000',
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(duplicate.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('tax_code', duplicate.data)

        detail_url = reverse('customer-detail', args=[first.data['id']])
        same_record = self.client.patch(detail_url, {'tax_code': ' MST-001 '}, format='json')
        self.assertEqual(same_record.status_code, status.HTTP_200_OK)
        self.assertEqual(same_record.data['tax_code'], 'MST-001')

    def test_payment_terms_and_credit_limit_must_not_be_negative(self):
        negative_terms = self.client.post(
            self.list_url,
            {
                'code': 'CUS-NEG-TERMS',
                'name': 'Customer Negative Terms',
                'payment_terms': -1,
                'credit_limit': '0',
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(negative_terms.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('payment_terms', negative_terms.data)

        negative_credit = self.client.post(
            self.list_url,
            {
                'code': 'CUS-NEG-CREDIT',
                'name': 'Customer Negative Credit',
                'payment_terms': 0,
                'credit_limit': '-1',
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(negative_credit.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('credit_limit', negative_credit.data)

    def test_tax_code_filter_and_global_search_cover_customer_tax_code(self):
        Customer.objects.create(
            code='CUS-FILTER-001',
            name='Customer Filter One',
            tax_code='FILTER-MST-001',
            payment_terms=30,
            credit_limit=Decimal('0'),
            created_by=self.user,
        )
        Customer.objects.create(
            code='CUS-FILTER-002',
            name='Customer Filter Two',
            tax_code='OTHER-MST-002',
            payment_terms=30,
            credit_limit=Decimal('0'),
            created_by=self.user,
        )

        partial = self.client.get(self.list_url, {'tax_code': 'FILTER-MST'})
        self.assertEqual(partial.status_code, status.HTTP_200_OK)
        self.assertEqual(partial.data['count'], 1)
        self.assertEqual(partial.data['results'][0]['code'], 'CUS-FILTER-001')

        exact = self.client.get(self.list_url, {'tax_code_exact': 'filter-mst-001'})
        self.assertEqual(exact.status_code, status.HTTP_200_OK)
        self.assertEqual(exact.data['count'], 1)
        self.assertEqual(exact.data['results'][0]['code'], 'CUS-FILTER-001')

        global_search = self.client.get(self.list_url, {'q': 'FILTER-MST-001', 'exact_search': '1'})
        self.assertEqual(global_search.status_code, status.HTTP_200_OK)
        self.assertEqual(global_search.data['count'], 1)
        self.assertEqual(global_search.data['results'][0]['code'], 'CUS-FILTER-001')
