from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from core.models import Permission, Role, Team, User


class AuthJwtSmokeTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = 'Demo123!'
        call_command('bootstrap_uat_demo', password=self.password, reset_passwords=True)
        self.user = User.objects.get(username='uat_admin')
        self.ops_user = User.objects.get(username='uat_ops')
        self.sales_user = User.objects.get(username='uat_sales')

    def _login(self, username, password):
        response = self.client.post(
            '/api/auth/login/',
            {'username': username, 'password': password},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn('access', body)
        self.assertIn('refresh', body)
        return body

    def test_login_me_refresh_logout_flow(self):
        login = self._login('uat_admin', self.password)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login['access']}")

        me_response = self.client.get('/api/users/me/')
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json().get('username'), 'uat_admin')

        refresh_response = self.client.post('/api/auth/refresh/', {'refresh': login['refresh']}, format='json')
        self.assertEqual(refresh_response.status_code, 200)
        self.assertTrue(refresh_response.json().get('access'))

        logout_response = self.client.post('/api/auth/logout/', {}, format='json')
        self.assertEqual(logout_response.status_code, 200)
        self.assertTrue(logout_response.json().get('success'))

    def test_me_requires_authentication(self):
        response = self.client.get('/api/users/me/')
        self.assertEqual(response.status_code, 401)

    def test_user_without_governance_permission_is_blocked(self):
        login = self._login('uat_sales', self.password)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login['access']}")

        self.assertEqual(self.client.get('/api/activity/operations_log_meta/').status_code, 403)
        self.assertEqual(self.client.get('/api/roles/module_permissions/').status_code, 403)
        self.assertEqual(self.client.get('/api/roles/module_permissions_history_meta/').status_code, 403)

    def test_user_with_ops_permission_can_open_operations_meta(self):
        login = self._login('uat_ops', self.password)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login['access']}")
        response = self.client.get('/api/activity/operations_log_meta/')
        self.assertEqual(response.status_code, 200)


class BootstrapUatDemoCommandTest(TestCase):
    def test_bootstrap_command_creates_expected_demo_users_roles_and_teams(self):
        call_command('bootstrap_uat_demo', password='Demo123!', reset_passwords=True)

        expected_users = {
            'uat_admin',
            'uat_manager',
            'uat_finance',
            'uat_hr',
            'uat_ops',
            'uat_sales',
            'uat_sales_manager',
            'uat_product',
            'uat_auditor',
        }
        self.assertTrue(expected_users.issubset(set(User.objects.values_list('username', flat=True))))
        self.assertTrue(Role.objects.filter(code='OPS_MANAGER', deleted_at__isnull=True).exists())
        self.assertTrue(Team.objects.filter(code='OPS_TEAM', deleted_at__isnull=True).exists())
        self.assertTrue(Permission.objects.filter(resource='SALESORDER', action='POST').exists())

        demo_user = User.objects.get(username='uat_sales')
        self.assertFalse(demo_user.is_staff)
        self.assertFalse(demo_user.is_superuser)
