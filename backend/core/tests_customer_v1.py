from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from core.models import Customer, Permission, Role, Team, User
from sales.models import SalesOrder


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


class CustomerSecurityApiTests(TestCase):
    CUSTOMER_ACTIONS = [
        'VIEW',
        'CREATE',
        'EDIT',
        'SUBMIT',
        'APPROVE',
        'REJECT',
        'IMPORT',
        'EXPORT',
        'ASSIGN',
        'DELETE',
    ]

    def setUp(self):
        self.client = APIClient()
        self.list_url = reverse('customer-list')
        self.team = Team.objects.create(code='CSEC-A', name='Customer Security A')
        self.other_team = Team.objects.create(code='CSEC-B', name='Customer Security B')
        self.permission_map = {
            action: Permission.objects.create(
                resource='CUSTOMER',
                action=action,
                code=f'CUSTOMER_{action}',
                name=f'Customer {action}',
            )
            for action in self.CUSTOMER_ACTIONS
        }

    def make_user(self, username, actions, teams=None):
        user = User.objects.create_user(username=username, password='pass')
        role = Role.objects.create(code=f'ROLE_{username}', name=f'Role {username}')
        role.permissions.set([self.permission_map[action] for action in actions])
        user.roles.add(role)
        if teams:
            user.teams.add(*teams)
        return user

    def make_customer(self, code, owner=None, team=None, status_value='DRAFT'):
        return Customer.objects.create(
            code=code,
            name=f'{code} Customer',
            payment_terms=30,
            credit_limit=Decimal('0'),
            owner=owner,
            team=team,
            status=status_value,
        )

    def assert_denied(self, response):
        self.assertIn(response.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    def test_anonymous_customer_endpoints_are_denied(self):
        customer = self.make_customer('CSEC-ANON')
        detail_url = reverse('customer-detail', args=[customer.id])

        self.assert_denied(self.client.get(self.list_url))
        self.assert_denied(self.client.get(detail_url))
        self.assert_denied(self.client.post(self.list_url, {'code': 'CSEC-NEW', 'name': 'New'}, format='json'))
        self.assert_denied(self.client.patch(detail_url, {'name': 'Changed'}, format='json'))
        self.assert_denied(self.client.delete(detail_url))
        self.assert_denied(self.client.post(reverse('customer-submit-for-approval', args=[customer.id])))

    def test_authenticated_user_without_customer_view_is_denied(self):
        no_view_user = self.make_user('customer_no_view', [])
        customer = self.make_customer('CSEC-NO-VIEW')

        self.client.force_authenticate(no_view_user)
        self.assertEqual(self.client.get(self.list_url).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.get(reverse('customer-detail', args=[customer.id])).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.get(reverse('customer-list-comments', args=[customer.id])).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.get(reverse('customer-approval-history', args=[customer.id])).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(reverse('customer-bulk-delete'), {'ids': [customer.id]}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertTrue(Customer.objects.filter(id=customer.id).exists())

    def test_view_only_user_can_read_scoped_customers_but_cannot_write(self):
        view_user = self.make_user('customer_view_only', ['VIEW'], teams=[self.team])
        foreign_owner = self.make_user('customer_foreign_owner', ['VIEW'], teams=[self.other_team])
        owned = self.make_customer('CSEC-OWNED', owner=view_user)
        team_customer = self.make_customer('CSEC-TEAM', team=self.team)
        unassigned = self.make_customer('CSEC-UNASSIGNED')
        foreign = self.make_customer('CSEC-FOREIGN', owner=foreign_owner, team=self.other_team)

        self.client.force_authenticate(view_user)
        list_response = self.client.get(self.list_url)
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        codes = {row['code'] for row in list_response.data['results']}
        self.assertSetEqual(codes, {owned.code, team_customer.code, unassigned.code})

        self.assertEqual(self.client.get(reverse('customer-detail', args=[owned.id])).status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(reverse('customer-detail', args=[foreign.id])).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.get(reverse('customer-approval-history', args=[owned.id])).status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(reverse('customer-list-attachments', args=[owned.id])).status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(reverse('customer-list-comments', args=[owned.id])).status_code, status.HTTP_200_OK)

        self.assertEqual(
            self.client.post(self.list_url, {'code': 'CSEC-DENIED', 'name': 'Denied'}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.patch(reverse('customer-detail', args=[owned.id]), {'name': 'Denied'}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(reverse('customer-bulk-activate'), {'ids': [owned.id], 'is_active': False}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.get(reverse('customer-export-data')).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.get(reverse('customer-download-import-template')).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.get(reverse('customer-export')).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.get(reverse('customer-export-pdf')).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(reverse('customer-bulk-export'), {'ids': [owned.id]}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(reverse('customer-export-async'), {'template_id': 1}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(reverse('customer-import-excel'), {}, format='multipart').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(reverse('customer-upload-attachment', args=[owned.id]), {}, format='multipart').status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(reverse('customer-add-comment', args=[owned.id]), {'content': 'Denied'}, format='json').status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_editor_can_create_and_edit_but_cannot_workflow_or_hard_delete(self):
        editor = self.make_user('customer_editor', ['VIEW', 'CREATE', 'EDIT'])
        other_user = self.make_user('customer_other_assignee', ['VIEW'])
        customer = self.make_customer('CSEC-EDIT')

        self.client.force_authenticate(editor)
        create_response = self.client.post(
            self.list_url,
            {
                'code': 'CSEC-CREATED',
                'name': 'Created',
                'payment_terms': 15,
                'credit_limit': '0',
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        detail_url = reverse('customer-detail', args=[customer.id])
        edit_response = self.client.patch(detail_url, {'is_active': False}, format='json')
        self.assertEqual(edit_response.status_code, status.HTTP_200_OK)
        customer.refresh_from_db()
        self.assertFalse(customer.is_active)

        assignment_response = self.client.patch(detail_url, {'owner': other_user.id}, format='json')
        self.assertEqual(assignment_response.status_code, status.HTTP_400_BAD_REQUEST)

        self.assertEqual(self.client.post(reverse('customer-submit-for-approval', args=[customer.id])).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post(reverse('customer-approve', args=[customer.id])).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.delete(detail_url).status_code, status.HTTP_403_FORBIDDEN)
        customer.refresh_from_db()
        self.assertEqual(customer.status, 'DRAFT')

    def test_import_export_permissions_are_separate_from_view(self):
        importer = self.make_user('customer_importer', ['VIEW', 'IMPORT'])
        exporter = self.make_user('customer_exporter', ['VIEW', 'EXPORT'])
        customer = self.make_customer('CSEC-EXPORT')

        self.client.force_authenticate(importer)
        import_template_response = self.client.get(reverse('customer-download-import-template'))
        self.assertEqual(import_template_response.status_code, status.HTTP_200_OK)
        import_missing_file_response = self.client.post(reverse('customer-import-excel'), {}, format='multipart')
        self.assertEqual(import_missing_file_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.client.get(reverse('customer-export')).status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(exporter)
        export_missing_template_response = self.client.get(reverse('customer-export'))
        self.assertEqual(export_missing_template_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.get(reverse('customer-export-pdf')).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            self.client.post(reverse('customer-bulk-export'), {'ids': []}, format='json').status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            self.client.post(reverse('customer-export-async'), {}, format='json').status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            self.client.get(reverse('customer-download-import-template')).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertTrue(Customer.objects.filter(id=customer.id).exists())

    def test_assign_permission_controls_owner_and_team_assignment(self):
        assigner = self.make_user('customer_assigner', ['VIEW', 'EDIT', 'ASSIGN'])
        other_user = self.make_user('customer_assigned_owner', ['VIEW'])
        owner_customer = self.make_customer('CSEC-ASSIGN-OWNER')
        team_customer = self.make_customer('CSEC-ASSIGN-TEAM')

        self.client.force_authenticate(assigner)
        owner_response = self.client.post(
            reverse('customer-assign-owner', args=[owner_customer.id]),
            {'user_id': other_user.id},
            format='json',
        )
        self.assertEqual(owner_response.status_code, status.HTTP_200_OK)
        owner_customer.refresh_from_db()
        self.assertEqual(owner_customer.owner_id, other_user.id)

        team_response = self.client.post(
            reverse('customer-assign-team', args=[team_customer.id]),
            {'team_id': self.team.id},
            format='json',
        )
        self.assertEqual(team_response.status_code, status.HTTP_200_OK)
        team_customer.refresh_from_db()
        self.assertEqual(team_customer.team_id, self.team.id)

    def test_assign_permission_still_respects_customer_data_scope(self):
        assigner = self.make_user('customer_scope_assigner', ['VIEW', 'EDIT', 'ASSIGN'], teams=[self.team])
        foreign_owner = self.make_user('customer_scope_foreign', ['VIEW'], teams=[self.other_team])
        foreign_customer = self.make_customer('CSEC-FOREIGN-ASSIGN', owner=foreign_owner, team=self.other_team)

        self.client.force_authenticate(assigner)
        response = self.client.post(
            reverse('customer-assign-team', args=[foreign_customer.id]),
            {'team_id': self.team.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        foreign_customer.refresh_from_db()
        self.assertEqual(foreign_customer.team_id, self.other_team.id)

    def test_workflow_permissions_are_separate_for_submit_approve_and_reject(self):
        submitter = self.make_user('customer_submitter', ['VIEW', 'SUBMIT'])
        approver = self.make_user('customer_approver', ['VIEW', 'APPROVE', 'REJECT'])
        submit_customer = self.make_customer('CSEC-SUBMIT')
        reject_customer = self.make_customer('CSEC-REJECT', status_value='PENDING_APPROVAL')

        self.client.force_authenticate(submitter)
        submit_response = self.client.post(reverse('customer-submit-for-approval', args=[submit_customer.id]))
        self.assertEqual(submit_response.status_code, status.HTTP_200_OK)
        submit_customer.refresh_from_db()
        self.assertEqual(submit_customer.status, 'PENDING_APPROVAL')

        self.assertEqual(
            self.client.post(reverse('customer-approve', args=[submit_customer.id])).status_code,
            status.HTTP_403_FORBIDDEN,
        )

        self.client.force_authenticate(approver)
        approve_response = self.client.post(reverse('customer-approve', args=[submit_customer.id]))
        self.assertEqual(approve_response.status_code, status.HTTP_200_OK)
        submit_customer.refresh_from_db()
        self.assertEqual(submit_customer.status, 'APPROVED')

        reject_response = self.client.post(
            reverse('customer-reject', args=[reject_customer.id]),
            {'reason': 'Thiếu hồ sơ'},
            format='json',
        )
        self.assertEqual(reject_response.status_code, status.HTTP_200_OK)
        reject_customer.refresh_from_db()
        self.assertEqual(reject_customer.status, 'REJECTED')

    def test_hard_delete_requires_permission_and_blocks_related_sales_orders(self):
        deleter = self.make_user('customer_deleter', ['VIEW', 'DELETE'])
        related_customer = self.make_customer('CSEC-RELATED')
        clean_customer = self.make_customer('CSEC-CLEAN')
        bulk_related_customer = self.make_customer('CSEC-BULK-RELATED')
        bulk_clean_customer = self.make_customer('CSEC-BULK-CLEAN')
        SalesOrder.objects.create(
            code='SO-CSEC-001',
            order_date=timezone.localdate(),
            customer=related_customer,
            created_by=deleter,
        )
        SalesOrder.objects.create(
            code='SO-CSEC-002',
            order_date=timezone.localdate(),
            customer=bulk_related_customer,
            created_by=deleter,
        )

        self.client.force_authenticate(deleter)
        related_response = self.client.delete(reverse('customer-detail', args=[related_customer.id]))
        self.assertEqual(related_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            related_response.data['error'],
            'Không thể xóa khách hàng đã phát sinh chứng từ. Hãy chuyển sang Ngừng sử dụng.',
        )
        self.assertTrue(Customer.objects.filter(id=related_customer.id).exists())
        self.assertTrue(SalesOrder.objects.filter(code='SO-CSEC-001', customer=related_customer).exists())

        bulk_response = self.client.post(
            reverse('customer-bulk-delete'),
            {'ids': [bulk_related_customer.id, bulk_clean_customer.id]},
            format='json',
        )
        self.assertEqual(bulk_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            bulk_response.data['error'],
            'Không thể xóa khách hàng đã phát sinh chứng từ. Hãy chuyển sang Ngừng sử dụng.',
        )
        self.assertTrue(Customer.objects.filter(id=bulk_related_customer.id).exists())
        self.assertTrue(Customer.objects.filter(id=bulk_clean_customer.id).exists())
        self.assertTrue(SalesOrder.objects.filter(code='SO-CSEC-002', customer=bulk_related_customer).exists())

        clean_response = self.client.delete(reverse('customer-detail', args=[clean_customer.id]))
        self.assertEqual(clean_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Customer.objects.filter(id=clean_customer.id).exists())
