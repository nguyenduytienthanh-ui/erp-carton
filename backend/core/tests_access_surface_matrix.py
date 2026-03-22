import json
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from rest_framework.test import APIClient

from core.models import User


class AccessSurfaceMatrixApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = 'Demo123!'
        call_command('bootstrap_uat_demo', password=self.password, reset_passwords=True)

    def _login(self, username):
        response = self.client.post(
            '/api/auth/login/',
            {'username': username, 'password': self.password},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.json()['access']}")

    def _matrix(self, **params):
        response = self.client.get('/api/users/access_surface_matrix/', params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    @staticmethod
    def _route_map(body):
        return {row['key']: row for row in body['frontend_routes']}

    @staticmethod
    def _api_map(body):
        return {row['key']: row for row in body['api_surfaces']}

    @staticmethod
    def _critical_map(body):
        return {row['key']: row for row in body['critical_actions']}

    def test_sales_user_matrix_only_exposes_sales_surface(self):
        self._login('uat_sales')
        body = self._matrix()
        routes = self._route_map(body)
        apis = self._api_map(body)
        critical = self._critical_map(body)

        self.assertEqual(body['user']['username'], 'uat_sales')
        self.assertTrue(routes['sales_orders']['allowed'])
        self.assertTrue(routes['shipments']['allowed'])
        self.assertFalse(routes['purchase_orders']['allowed'])
        self.assertFalse(routes['admin_observability']['allowed'])
        self.assertFalse(routes['access_governance']['allowed'])
        self.assertTrue(apis['sales_orders_api']['allowed'])
        self.assertFalse(apis['purchase_orders_api']['allowed'])
        self.assertFalse(apis['admin_observability_api']['allowed'])
        self.assertTrue(critical['sales_order_submit']['allowed'])
        self.assertFalse(critical['sales_order_approve']['allowed'])
        self.assertFalse(critical['sales_order_post']['allowed'])

    def test_ops_user_matrix_exposes_execution_and_observability_surfaces(self):
        self._login('uat_ops')
        body = self._matrix()
        routes = self._route_map(body)
        apis = self._api_map(body)
        critical = self._critical_map(body)

        self.assertEqual(body['user']['username'], 'uat_ops')
        self.assertTrue(routes['purchase_orders']['allowed'])
        self.assertTrue(routes['production_orders']['allowed'])
        self.assertTrue(routes['warehouse_transfers']['allowed'])
        self.assertTrue(routes['workflow_analytics']['allowed'])
        self.assertTrue(routes['operations_log']['allowed'])
        self.assertTrue(routes['admin_observability']['allowed'])
        self.assertFalse(routes['access_governance']['allowed'])
        self.assertTrue(apis['purchase_orders_api']['allowed'])
        self.assertTrue(apis['production_orders_api']['allowed'])
        self.assertTrue(apis['operations_log_api']['allowed'])
        self.assertFalse(apis['module_permissions_api']['allowed'])
        self.assertTrue(critical['purchase_order_submit']['allowed'])
        self.assertTrue(critical['purchase_order_receive']['allowed'])
        self.assertFalse(critical['purchase_order_approve']['allowed'])
        self.assertTrue(critical['production_order_release']['allowed'])
        self.assertFalse(critical['sales_order_post']['allowed'])

    def test_auditor_matrix_exposes_governance_history_without_admin_write_access(self):
        self._login('uat_auditor')
        body = self._matrix()
        routes = self._route_map(body)
        apis = self._api_map(body)

        self.assertEqual(body['user']['username'], 'uat_auditor')
        self.assertTrue(routes['access_governance']['allowed'])
        self.assertTrue(routes['module_permissions_history']['allowed'])
        self.assertTrue(routes['admin_observability']['allowed'])
        self.assertFalse(routes['module_permissions']['allowed'])
        self.assertFalse(routes['user_directory']['allowed'])
        self.assertTrue(apis['module_permission_history_api']['allowed'])
        self.assertFalse(apis['module_permissions_api']['allowed'])
        self.assertFalse(apis['user_directory_api']['allowed'])
        self.assertEqual(body['summary']['allowed_critical_action_count'], 0)

    def test_finance_matrix_allows_posting_without_sales_submit_access(self):
        self._login('uat_finance')
        body = self._matrix()
        critical = self._critical_map(body)

        self.assertTrue(critical['purchase_order_approve']['allowed'])
        self.assertTrue(critical['purchase_order_cancel']['allowed'])
        self.assertTrue(critical['sales_order_post']['allowed'])
        self.assertTrue(critical['sales_order_void']['allowed'])
        self.assertFalse(critical['sales_order_submit']['allowed'])
        self.assertFalse(critical['production_order_release']['allowed'])

    def test_product_user_matrix_covers_execution_without_admin_governance(self):
        self._login('uat_product')
        body = self._matrix()
        routes = self._route_map(body)
        critical = self._critical_map(body)

        self.assertTrue(routes['purchase_orders']['allowed'])
        self.assertTrue(routes['production_orders']['allowed'])
        self.assertFalse(routes['access_governance']['allowed'])
        self.assertTrue(critical['purchase_order_submit']['allowed'])
        self.assertTrue(critical['purchase_order_receive']['allowed'])
        self.assertFalse(critical['purchase_order_approve']['allowed'])
        self.assertTrue(critical['production_order_issue']['allowed'])
        self.assertFalse(critical['production_order_approve']['allowed'])

    def test_user_can_only_inspect_other_matrix_with_governance_permission(self):
        sales_user = User.objects.get(username='uat_sales')

        self._login('uat_sales_manager')
        forbidden = self.client.get('/api/users/access_surface_matrix/', {'user_id': sales_user.id})
        self.assertEqual(forbidden.status_code, 403, forbidden.content)

        self._login('uat_admin')
        body = self._matrix(user_id=sales_user.id)
        self.assertEqual(body['user']['username'], 'uat_sales')
        self.assertIn('SALESORDER:SUBMIT', body['permission_keys'])

    def test_uat_access_matrix_command_reports_persona_summary(self):
        stdout = StringIO()
        call_command('uat_access_matrix', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['missing_count'], 0)
        finance_row = next(item for item in payload['items'] if item['username'] == 'uat_finance')
        self.assertIn('sales_order_post', finance_row['allowed_critical_action_keys'])
        self.assertNotIn('sales_order_submit', finance_row['allowed_critical_action_keys'])

    def test_uat_access_matrix_command_strict_fails_when_persona_missing(self):
        User.objects.filter(username='uat_product').delete()

        with self.assertRaises(CommandError):
            call_command('uat_access_matrix', '--strict')
