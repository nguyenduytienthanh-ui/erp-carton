from django.test import TestCase
from rest_framework.test import APIClient

from core.models import AuditLog, Permission, Role, Task, Team, User, UserPreferences, WorkflowTaskTemplate


class OnboardingStudioApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = 'SecurePass123!'

        self.manage_rbac_permission, _ = Permission.objects.get_or_create(
            resource='CORE',
            action='MANAGE_RBAC',
            defaults={'code': 'TEST_CORE_MANAGE_RBAC_ONBOARDING', 'name': 'Manage RBAC'},
        )

        self.manager_role = Role.objects.create(name='Onboarding Manager', code='ONBOARDING_MANAGER')
        self.manager_role.permissions.add(self.manage_rbac_permission)
        self.sales_role = Role.objects.create(name='Sales Lead', code='SALES_LEAD')
        self.finance_role = Role.objects.create(name='Finance Buddy', code='FINANCE_BUDDY')

        self.ops_team = Team.objects.create(name='Operations Pod', code='OPS_POD')
        self.finance_team = Team.objects.create(name='Finance Pod', code='FIN_POD')

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
        self.template_intro = WorkflowTaskTemplate.objects.create(
            entity_type='User',
            trigger='MANUAL',
            title_template='Introduce {full_name} to core workflows',
            description_template='Walk through finance and operations hand-off',
            due_in_days=2,
            priority=Task.PRIORITY_MEDIUM,
            depends_on_previous=True,
            sort_order=20,
            is_active=True,
        )

        self.manager_user = User.objects.create_user(
            username='onboarding_admin',
            password=self.password,
            email='onboarding_admin@example.com',
            first_name='Onboarding',
            last_name='Admin',
        )
        self.manager_user.roles.add(self.manager_role)
        self.manager_user.teams.add(self.ops_team)

        self.target_user = User.objects.create_user(
            username='new_joiner',
            password=self.password,
            email='new_joiner@example.com',
            first_name='New',
            last_name='Joiner',
        )
        self.target_user.roles.add(self.finance_role)
        self.target_user.teams.add(self.finance_team)

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

    def create_preset(self):
        response = self.client.post(
            '/api/users/onboarding_presets/',
            {
                'key': 'ops-launch',
                'name': 'Ops Launch',
                'description': 'Preset cho nhan su moi vao line van hanh',
                'is_active': True,
                'tone': 'cyan',
                'access_strategy': 'merge',
                'role_ids': [self.sales_role.id],
                'team_ids': [self.ops_team.id],
                'workflow_template_ids': [self.template_prepare.id, self.template_intro.id],
                'task_owner_mode': 'target_user',
                'checklist': ['Welcome call', 'Review SOP'],
                'email_notifications_enabled': True,
                'email_notification_types': ['assignment', 'due_date'],
            },
            format='json',
        )
        self.assertIn(response.status_code, {200, 201}, response.content)
        return response

    def test_onboarding_studio_summary_and_preset_crud_create_audit_logs(self):
        self.login(self.manager_user)

        create_response = self.create_preset()
        self.assertEqual(create_response.status_code, 201, create_response.content)
        create_body = create_response.json()
        self.assertEqual(create_body['action'], 'CREATE')
        self.assertEqual(create_body['preset']['role_count'], 1)
        self.assertEqual(create_body['preset']['workflow_template_count'], 2)

        summary_response = self.client.get('/api/users/onboarding_studio/')
        self.assertEqual(summary_response.status_code, 200, summary_response.content)
        summary_body = summary_response.json()
        self.assertEqual(summary_body['summary']['total_presets'], 1)
        self.assertEqual(summary_body['summary']['active_presets'], 1)
        self.assertTrue(summary_body['notification_type_options'])
        self.assertEqual(summary_body['presets'][0]['key'], 'ops-launch')
        self.assertTrue(summary_body['recent_activity'])

        update_response = self.client.post(
            '/api/users/onboarding_presets/',
            {
                'key': 'ops-launch',
                'name': 'Ops Launch',
                'description': 'Preset da duoc cap nhat',
                'is_active': False,
                'tone': 'gold',
                'access_strategy': 'replace',
                'role_ids': [self.sales_role.id],
                'team_ids': [self.ops_team.id],
                'workflow_template_ids': [self.template_prepare.id],
                'task_owner_mode': 'target_user',
                'checklist': ['Welcome call'],
                'email_notifications_enabled': False,
                'email_notification_types': [],
            },
            format='json',
        )
        self.assertEqual(update_response.status_code, 200, update_response.content)
        self.assertEqual(update_response.json()['action'], 'UPDATE')

        delete_response = self.client.post(
            '/api/users/onboarding_presets_delete/',
            {'key': 'ops-launch'},
            format='json',
        )
        self.assertEqual(delete_response.status_code, 200, delete_response.content)
        self.assertTrue(delete_response.json()['success'])

        preset_audits = AuditLog.objects.filter(entity_type='UserOnboardingPreset', entity_code='ops-launch')
        self.assertEqual(preset_audits.count(), 3)
        self.assertTrue(preset_audits.filter(action='CREATE').exists())
        self.assertTrue(preset_audits.filter(action='UPDATE').exists())
        self.assertTrue(preset_audits.filter(action='DELETE').exists())

    def test_onboarding_preview_and_apply_updates_access_preferences_and_tasks(self):
        self.login(self.manager_user)
        self.create_preset()

        preview_response = self.client.post(
            '/api/users/onboarding_preview/',
            {
                'preset_key': 'ops-launch',
                'user_id': self.target_user.id,
            },
            format='json',
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.content)
        preview_body = preview_response.json()
        self.assertEqual(preview_body['summary']['task_total'], 2)
        self.assertEqual(preview_body['summary']['task_new'], 2)
        role_codes_after = {item['code'] for item in preview_body['roles_after']}
        team_codes_after = {item['code'] for item in preview_body['teams_after']}
        self.assertIn('SALES_LEAD', role_codes_after)
        self.assertIn('FINANCE_BUDDY', role_codes_after)
        self.assertIn('OPS_POD', team_codes_after)
        self.assertIn('FIN_POD', team_codes_after)
        self.assertEqual(preview_body['notification_after']['email_notification_types'], ['assignment', 'due_date'])

        apply_response = self.client.post(
            '/api/users/apply_onboarding_preset/',
            {
                'preset_key': 'ops-launch',
                'user_id': self.target_user.id,
                'create_tasks': True,
            },
            format='json',
        )
        self.assertEqual(apply_response.status_code, 200, apply_response.content)
        apply_body = apply_response.json()
        self.assertTrue(apply_body['success'])
        self.assertIn('roles', apply_body['changed_fields'])
        self.assertIn('teams', apply_body['changed_fields'])
        self.assertIn('notification_preferences', apply_body['changed_fields'])
        self.assertIn('tasks', apply_body['changed_fields'])
        self.assertEqual(len(apply_body['tasks_created']), 2)

        self.target_user.refresh_from_db()
        role_codes = set(self.target_user.roles.values_list('code', flat=True))
        team_codes = set(self.target_user.teams.values_list('code', flat=True))
        self.assertEqual(role_codes, {'SALES_LEAD', 'FINANCE_BUDDY'})
        self.assertEqual(team_codes, {'OPS_POD', 'FIN_POD'})

        pref = UserPreferences.objects.get(user=self.target_user, page='account-center')
        self.assertTrue(pref.config['email_notifications_enabled'])
        self.assertEqual(pref.config['email_notification_types'], ['assignment', 'due_date'])

        onboarding_tasks = Task.objects.filter(entity_type='User', entity_id=self.target_user.id, source_key__startswith='ob-ops-launch-')
        self.assertEqual(onboarding_tasks.count(), 2)

        repeat_apply = self.client.post(
            '/api/users/apply_onboarding_preset/',
            {
                'preset_key': 'ops-launch',
                'user_id': self.target_user.id,
                'create_tasks': True,
            },
            format='json',
        )
        self.assertEqual(repeat_apply.status_code, 200, repeat_apply.content)
        self.assertEqual(len(repeat_apply.json()['tasks_created']), 0)
        self.assertEqual(len(repeat_apply.json()['tasks_skipped']), 2)

        onboarding_audits = AuditLog.objects.filter(entity_type='UserOnboarding', entity_id=self.target_user.id)
        self.assertEqual(onboarding_audits.count(), 2)
        self.assertEqual(onboarding_audits.order_by('-created_at').first().new_values['tasks_skipped_count'], 2)

    def test_onboarding_studio_endpoints_require_manage_user_permission(self):
        self.login(self.regular_user)

        summary_response = self.client.get('/api/users/onboarding_studio/')
        self.assertEqual(summary_response.status_code, 403)

        create_response = self.client.post(
            '/api/users/onboarding_presets/',
            {'key': 'blocked', 'name': 'Blocked preset'},
            format='json',
        )
        self.assertEqual(create_response.status_code, 403)

        preview_response = self.client.post(
            '/api/users/onboarding_preview/',
            {'preset_key': 'blocked', 'user_id': self.target_user.id},
            format='json',
        )
        self.assertEqual(preview_response.status_code, 403)
