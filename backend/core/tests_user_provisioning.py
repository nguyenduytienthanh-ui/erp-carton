import json

from django.test import TestCase
from rest_framework.test import APIClient

from core.models import AuditLog, Permission, Role, Setting, Task, Team, User, UserPreferences, WorkflowTaskTemplate


class UserProvisioningApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = 'SecurePass123!'

        self.manage_rbac_permission, _ = Permission.objects.get_or_create(
            resource='CORE',
            action='MANAGE_RBAC',
            defaults={'code': 'TEST_CORE_MANAGE_RBAC_PROVISION', 'name': 'Manage RBAC'},
        )

        self.manager_role = Role.objects.create(name='Provisioning Manager', code='PROVISION_MANAGER')
        self.manager_role.permissions.add(self.manage_rbac_permission)
        self.ops_role = Role.objects.create(name='Ops Starter', code='OPS_STARTER')
        self.finance_role = Role.objects.create(name='Finance Reviewer', code='FIN_REVIEWER')

        self.ops_team = Team.objects.create(name='Ops Cell', code='OPS_CELL')
        self.finance_team = Team.objects.create(name='Finance Pod', code='FINANCE_POD')

        self.template_prepare = WorkflowTaskTemplate.objects.create(
            entity_type='User',
            trigger='MANUAL',
            title_template='Prepare workstation for {username}',
            description_template='Provision standard tools for {full_name}',
            due_in_days=1,
            priority=Task.PRIORITY_HIGH,
            is_blocking=True,
            sort_order=10,
            is_active=True,
        )
        self.template_handoff = WorkflowTaskTemplate.objects.create(
            entity_type='User',
            trigger='MANUAL',
            title_template='Run handoff checklist for {full_name}',
            description_template='Review team workflow and SLA package',
            due_in_days=2,
            priority=Task.PRIORITY_MEDIUM,
            sort_order=20,
            is_active=True,
        )

        Setting.objects.create(
            key='USER_ONBOARDING_PRESETS',
            value=json.dumps([
                {
                    'key': 'ops-launch',
                    'name': 'Ops Launch',
                    'description': 'Provisioning preset for operations hires',
                    'is_active': True,
                    'tone': 'cyan',
                    'access_strategy': 'merge',
                    'role_ids': [self.finance_role.id],
                    'team_ids': [self.finance_team.id],
                    'workflow_template_ids': [self.template_prepare.id, self.template_handoff.id],
                    'task_owner_mode': 'target_user',
                    'checklist': ['Welcome call', 'Review SOP'],
                    'email_notifications_enabled': True,
                    'email_notification_types': ['assignment', 'due_date'],
                }
            ]),
            data_type='json',
            description='Test provisioning presets',
            is_active=True,
        )

        self.manager_user = User.objects.create_user(
            username='provision_admin',
            password=self.password,
            email='provision_admin@example.com',
            first_name='Provision',
            last_name='Admin',
        )
        self.manager_user.roles.add(self.manager_role)
        self.manager_user.teams.add(self.ops_team)

        self.existing_user = User.objects.create_user(
            username='existing_member',
            password=self.password,
            email='existing_member@example.com',
            first_name='Existing',
            last_name='Member',
        )

        self.regular_user = User.objects.create_user(
            username='regular_member',
            password=self.password,
            email='regular_member@example.com',
            first_name='Regular',
            last_name='Member',
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

    def test_provisioning_workspace_and_preview_return_summary_and_union_access(self):
        self.login(self.manager_user)

        workspace_response = self.client.get('/api/users/provisioning_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()
        self.assertEqual(workspace_body['summary']['active_presets'], 1)
        self.assertEqual(workspace_body['summary']['ready_presets'], 1)
        self.assertEqual(workspace_body['summary']['attention_accounts'], 2)
        self.assertEqual(workspace_body['summary']['access_gaps'], 2)
        self.assertEqual(len(workspace_body['presets']), 1)
        self.assertTrue(any(item['state'] == 'access-gap' for item in workspace_body['watchlist']))

        preview_response = self.client.post(
            '/api/users/provisioning_preview/',
            {
                'username': 'existing_member',
                'email': 'new_person@example.com',
                'first_name': 'New',
                'last_name': 'Person',
                'phone': '0900111222',
                'preset_key': 'ops-launch',
                'role_ids': [self.ops_role.id],
                'team_ids': [self.ops_team.id],
                'is_active': True,
                'is_staff': False,
                'create_tasks': True,
                'include_security_task': True,
            },
            format='json',
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.content)
        preview_body = preview_response.json()
        self.assertFalse(preview_body['availability']['username_available'])
        self.assertTrue(preview_body['availability']['username_suggestions'])
        role_codes = {item['code'] for item in preview_body['roles']}
        team_codes = {item['code'] for item in preview_body['teams']}
        self.assertEqual(role_codes, {'OPS_STARTER', 'FIN_REVIEWER'})
        self.assertEqual(team_codes, {'OPS_CELL', 'FINANCE_POD'})
        self.assertEqual(preview_body['summary']['workflow_task_total'], 2)
        self.assertEqual(preview_body['summary']['security_task_total'], 1)
        self.assertEqual(preview_body['notification_plan']['email_notification_types'], ['assignment', 'due_date'])
        self.assertTrue(any(item['key'] == 'identity' and item['status'] == 'blocked' for item in preview_body['preflight_checks']))
        self.assertTrue(any(item['key'] == 'access' and item['status'] == 'ready' for item in preview_body['preflight_checks']))

    def test_provision_user_creates_account_audits_preferences_and_tasks(self):
        self.login(self.manager_user)

        create_response = self.client.post(
            '/api/users/provision_user/',
            {
                'username': 'ops_new_hire',
                'email': 'ops_new_hire@example.com',
                'first_name': 'Ops',
                'last_name': 'New Hire',
                'phone': '0911999888',
                'preset_key': 'ops-launch',
                'role_ids': [self.ops_role.id],
                'team_ids': [self.ops_team.id],
                'is_active': True,
                'is_staff': False,
                'create_tasks': True,
                'include_security_task': True,
                'password_mode': 'generated',
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        body = create_response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['credentials']['username'], 'ops_new_hire')
        self.assertTrue(body['credentials']['temporary_password'])
        self.assertEqual(len(body['tasks_created']), 2)
        self.assertIsNotNone(body['security_task_created'])

        created_user = User.objects.get(username='ops_new_hire')
        self.assertEqual(set(created_user.roles.values_list('code', flat=True)), {'OPS_STARTER', 'FIN_REVIEWER'})
        self.assertEqual(set(created_user.teams.values_list('code', flat=True)), {'OPS_CELL', 'FINANCE_POD'})

        preference = UserPreferences.objects.get(user=created_user, page='account-center')
        self.assertTrue(preference.config['email_notifications_enabled'])
        self.assertEqual(preference.config['email_notification_types'], ['assignment', 'due_date'])

        self.assertEqual(Task.objects.filter(entity_type='User', entity_id=created_user.id).count(), 3)
        self.assertTrue(AuditLog.objects.filter(entity_type='UserProvisioning', entity_id=created_user.id, action='CREATE').exists())
        self.assertTrue(AuditLog.objects.filter(entity_type='UserOnboarding', entity_id=created_user.id, action='UPDATE').exists())
        self.assertTrue(AuditLog.objects.filter(entity_type='UserAccess', entity_id=created_user.id, action='UPDATE').exists())

        workspace_response = self.client.get('/api/users/provisioning_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()
        self.assertGreaterEqual(workspace_body['summary']['security_followups'], 1)
        self.assertTrue(any(item['username'] == 'ops_new_hire' and item['state'] == 'security-followup' for item in workspace_body['watchlist']))

        login_response = self.client.post(
            '/api/auth/login/',
            {'username': 'ops_new_hire', 'password': body['credentials']['temporary_password']},
            format='json',
        )
        self.assertEqual(login_response.status_code, 200, login_response.content)

    def test_provision_user_with_custom_password_returns_same_password_and_activity(self):
        self.login(self.manager_user)

        create_response = self.client.post(
            '/api/users/provision_user/',
            {
                'username': 'ops_custom_password',
                'email': 'ops_custom_password@example.com',
                'first_name': 'Ops',
                'last_name': 'Custom',
                'phone': '0900009999',
                'role_ids': [self.ops_role.id],
                'team_ids': [self.ops_team.id],
                'is_active': True,
                'is_staff': False,
                'create_tasks': False,
                'include_security_task': False,
                'password_mode': 'custom',
                'temporary_password': 'CustomPass123!',
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        body = create_response.json()
        self.assertEqual(body['credentials']['password_mode'], 'custom')
        self.assertEqual(body['credentials']['temporary_password'], 'CustomPass123!')
        self.assertIn('Chỉ hiển thị mật khẩu một lần', body['credentials']['secure_share_hint'])

        login_response = self.client.post(
            '/api/auth/login/',
            {'username': 'ops_custom_password', 'password': 'CustomPass123!'},
            format='json',
        )
        self.assertEqual(login_response.status_code, 200, login_response.content)

        activity_response = self.client.get('/api/users/provisioning_activity/?limit=5')
        self.assertEqual(activity_response.status_code, 200, activity_response.content)
        activity_body = activity_response.json()
        self.assertLessEqual(len(activity_body['items']), 5)
        self.assertTrue(any(item['entity_code'] == 'ops_custom_password' and 'cấp tài khoản' in item['summary'].lower() for item in activity_body['items']))

    def test_provisioning_endpoints_require_manage_user_permission(self):
        self.login(self.regular_user)

        workspace_response = self.client.get('/api/users/provisioning_workspace/')
        self.assertEqual(workspace_response.status_code, 403)

        preview_response = self.client.post(
            '/api/users/provisioning_preview/',
            {'username': 'blocked_user'},
            format='json',
        )
        self.assertEqual(preview_response.status_code, 403)

        create_response = self.client.post(
            '/api/users/provision_user/',
            {'username': 'blocked_user', 'password_mode': 'generated'},
            format='json',
        )
        self.assertEqual(create_response.status_code, 403)
