from rest_framework.test import APITestCase

from core.models import User
from finance.models import BudgetPlan


class BudgetManagementTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='finance_budget_admin',
            password='Demo123!',
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(user=self.user)
        self.on_track_budget = BudgetPlan.objects.create(
            department='Sales',
            category='Marketing',
            fiscal_year=2026,
            budgeted_amount='500000000',
            actual_amount='200000000',
            committed_amount='50000000',
            note='On track budget',
            created_by=self.user,
            updated_by=self.user,
        )
        self.over_budget = BudgetPlan.objects.create(
            department='Production',
            category='Labor',
            fiscal_year=2026,
            budgeted_amount='800000000',
            actual_amount='650000000',
            committed_amount='200000000',
            note='Over budget scenario',
            created_by=self.user,
            updated_by=self.user,
        )

    def test_create_update_delete_budget_plan(self):
        create_response = self.client.post(
            '/api/finance/budgets/',
            {
                'department': 'Admin',
                'category': 'Office',
                'fiscal_year': 2027,
                'budgeted_amount': '120000000',
                'actual_amount': '10000000',
                'committed_amount': '5000000',
                'note': 'New budget',
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)
        created_id = create_response.data['id']
        self.assertEqual(create_response.data['status'], 'ON_TRACK')

        update_response = self.client.patch(
            f'/api/finance/budgets/{created_id}/',
            {
                'actual_amount': '25000000',
                'committed_amount': '15000000',
                'note': 'Updated budget',
            },
            format='json',
        )
        self.assertEqual(update_response.status_code, 200, update_response.data)
        self.assertEqual(update_response.data['note'], 'Updated budget')

        delete_response = self.client.delete(f'/api/finance/budgets/{created_id}/')
        self.assertEqual(delete_response.status_code, 204)
        self.assertFalse(BudgetPlan.objects.filter(pk=created_id).exists())

    def test_budget_variance_analysis_and_filters(self):
        list_response = self.client.get('/api/finance/budgets/', {'status': 'OVER_BUDGET'})
        self.assertEqual(list_response.status_code, 200, list_response.data)
        self.assertEqual(list_response.data['count'], 1)
        self.assertEqual(list_response.data['results'][0]['department'], self.over_budget.department)

        summary_response = self.client.get('/api/finance/budgets/variance_analysis/', {'fiscal_year': 2026})
        self.assertEqual(summary_response.status_code, 200, summary_response.data)
        self.assertEqual(summary_response.data['total_count'], 2)
        self.assertEqual(summary_response.data['over_budget_count'], 1)
        self.assertEqual(summary_response.data['on_track_count'], 1)
        self.assertEqual(str(summary_response.data['total_budgeted']), '1300000000.00')
        self.assertEqual(len(summary_response.data['departments']), 2)
