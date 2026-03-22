import json
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from rest_framework.test import APIClient

from core.models import User


class PermissionSurfaceAuditTests(TestCase):
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

    def test_permission_surface_audit_command_reports_low_coverage_surfaces(self):
        stdout = StringIO()
        call_command('permission_surface_audit', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['available_count'], payload['expected_count'])
        self.assertGreater(payload['summary']['frontend_routes_total'], 0)
        admin_audit_row = next(
            item for item in payload['coverage']['api_surfaces']
            if item['key'] == 'admin_audit_api'
        )
        self.assertGreater(admin_audit_row['coverage_count'], 0)
        self.assertIn(payload['overall_status'], {'ok', 'warning'})

    def test_permission_surface_audit_strict_fails_when_persona_missing(self):
        User.objects.filter(username='uat_admin').delete()

        with self.assertRaises(CommandError):
            call_command('permission_surface_audit', '--strict')

    def test_access_governance_surface_audit_api_requires_governance_access(self):
        self._login('uat_admin')
        response = self.client.get('/api/users/access_governance_surface_audit/')
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertIn('coverage', body)
        self.assertIn('critical_actions', body['coverage'])

        self._login('uat_sales')
        forbidden = self.client.get('/api/users/access_governance_surface_audit/')
        self.assertEqual(forbidden.status_code, 403, forbidden.content)
