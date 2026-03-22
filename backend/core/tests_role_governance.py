from django.test import TestCase
from rest_framework.test import APIClient

from core.models import AuditLog, Permission, Role, Team, User


class RoleTeamGovernanceApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = 'SecurePass123!'

        self.manage_rbac_permission, _ = Permission.objects.get_or_create(
            resource='CORE',
            action='MANAGE_RBAC',
            defaults={'code': 'TEST_CORE_MANAGE_RBAC', 'name': 'Manage RBAC'},
        )
        self.finance_permission, _ = Permission.objects.get_or_create(
            resource='FINANCE',
            action='MANAGE',
            defaults={'code': 'TEST_FINANCE_MANAGE', 'name': 'Manage finance'},
        )
        self.reports_permission, _ = Permission.objects.get_or_create(
            resource='CORE',
            action='VIEW_REPORTS',
            defaults={'code': 'TEST_CORE_VIEW_REPORTS', 'name': 'View reports'},
        )

        self.manager_role = Role.objects.create(name='Governance Manager', code='GOV_MANAGER')
        self.manager_role.permissions.add(self.manage_rbac_permission)
        self.finance_role = Role.objects.create(name='Finance Controller', code='FIN_CONTROLLER')
        self.finance_role.permissions.set([self.finance_permission, self.reports_permission])
        self.orphan_role = Role.objects.create(name='Orphan Role', code='ORPHAN_ROLE')

        self.ops_team = Team.objects.create(name='Ops Team', code='OPS_TEAM')
        self.finance_team = Team.objects.create(name='Finance Team', code='FIN_TEAM')
        self.empty_team = Team.objects.create(name='Empty Team', code='EMPTY_TEAM')

        self.manager_user = User.objects.create_user(
            username='governance_admin',
            password=self.password,
            email='governance_admin@example.com',
            first_name='Governance',
            last_name='Admin',
        )
        self.manager_user.roles.add(self.manager_role)
        self.manager_user.teams.add(self.ops_team)

        self.finance_user = User.objects.create_user(
            username='finance_member',
            password=self.password,
            email='finance_member@example.com',
            first_name='Finance',
            last_name='Member',
        )
        self.finance_user.roles.add(self.finance_role)
        self.finance_user.teams.add(self.finance_team)

        self.unassigned_user = User.objects.create_user(
            username='unassigned_governance',
            password=self.password,
            email='unassigned_governance@example.com',
            first_name='No',
            last_name='Assignment',
        )

        self.regular_user = User.objects.create_user(
            username='regular_governance',
            password=self.password,
            email='regular_governance@example.com',
            first_name='Regular',
            last_name='User',
        )

    def login(self, user):
        response = self.client.post(
            '/api/auth/login/',
            {'username': user.username, 'password': self.password},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {body['access']}")
        return body

    def test_governance_summary_returns_watchlist_templates_and_permission_catalog(self):
        self.login(self.manager_user)

        response = self.client.get('/api/roles/governance_summary/')
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertEqual(body['summary']['total_roles'], 3)
        self.assertEqual(body['summary']['roles_without_users'], 1)
        self.assertEqual(body['summary']['roles_without_permissions'], 1)
        self.assertEqual(body['summary']['empty_teams'], 1)
        self.assertEqual(body['summary']['users_without_role'], 2)
        self.assertEqual(body['summary']['users_without_team'], 2)
        self.assertTrue(body['role_templates'])
        self.assertTrue(body['permissions'])
        watchlist_titles = {item['title'] for item in body['watchlist']}
        self.assertIn('Role ORPHAN_ROLE chua duoc gan', watchlist_titles)
        self.assertIn('Nhom EMPTY_TEAM dang trong', watchlist_titles)

    def test_role_crud_bulk_and_activity_feed_create_audit_logs(self):
        self.login(self.manager_user)

        create_response = self.client.post(
            '/api/roles/',
            {
                'code': 'OPS_LEAD',
                'name': 'Operations Lead',
                'description': 'Coordinates operations',
                'is_active': True,
                'sort_order': 25,
                'permission_ids': [self.finance_permission.id, self.reports_permission.id],
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        created_role_id = create_response.json()['id']

        update_response = self.client.patch(
            f'/api/roles/{created_role_id}/',
            {
                'description': 'Coordinates operations and reporting',
                'permission_ids': [self.reports_permission.id],
            },
            format='json',
        )
        self.assertEqual(update_response.status_code, 200, update_response.content)

        deactivate_response = self.client.post(
            '/api/roles/bulk_deactivate/',
            {'ids': [created_role_id]},
            format='json',
        )
        self.assertEqual(deactivate_response.status_code, 200, deactivate_response.content)
        self.assertEqual(deactivate_response.json()['count'], 1)

        activity_response = self.client.get('/api/roles/governance_activity/', {'kind': 'role', 'limit': 10})
        self.assertEqual(activity_response.status_code, 200, activity_response.content)
        activity_items = activity_response.json()['items']
        self.assertTrue(any('OPS_LEAD' in item['summary'] for item in activity_items))

        role_audits = AuditLog.objects.filter(entity_type='Role', entity_id=created_role_id)
        self.assertEqual(role_audits.count(), 3)
        self.assertTrue(role_audits.filter(action='CREATE').exists())
        self.assertTrue(role_audits.filter(action='UPDATE').exists())
        self.assertTrue(role_audits.filter(action='DEACTIVATE').exists())

    def test_team_crud_bulk_and_audit_logs_work_for_governance_manager(self):
        self.login(self.manager_user)

        create_response = self.client.post(
            '/api/teams/',
            {
                'code': 'QUALITY_CELL',
                'name': 'Quality Cell',
                'description': 'Quality assurance team',
                'is_active': True,
                'sort_order': 40,
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        team_id = create_response.json()['id']

        update_response = self.client.patch(
            f'/api/teams/{team_id}/',
            {'description': 'Quality assurance and release readiness'},
            format='json',
        )
        self.assertEqual(update_response.status_code, 200, update_response.content)

        deactivate_response = self.client.post(
            '/api/teams/bulk_deactivate/',
            {'ids': [team_id]},
            format='json',
        )
        self.assertEqual(deactivate_response.status_code, 200, deactivate_response.content)

        team_audits = AuditLog.objects.filter(entity_type='Team', entity_id=team_id)
        self.assertEqual(team_audits.count(), 3)
        self.assertTrue(team_audits.filter(action='CREATE').exists())
        self.assertTrue(team_audits.filter(action='UPDATE').exists())
        self.assertTrue(team_audits.filter(action='DEACTIVATE').exists())

    def test_role_team_governance_endpoints_require_rbac_permission(self):
        self.login(self.regular_user)

        summary_response = self.client.get('/api/roles/governance_summary/')
        self.assertEqual(summary_response.status_code, 403)

        create_role_response = self.client.post(
            '/api/roles/',
            {'code': 'BLOCKED_ROLE', 'name': 'Blocked Role'},
            format='json',
        )
        self.assertEqual(create_role_response.status_code, 403)

        create_team_response = self.client.post(
            '/api/teams/',
            {'code': 'BLOCKED_TEAM', 'name': 'Blocked Team'},
            format='json',
        )
        self.assertEqual(create_team_response.status_code, 403)
