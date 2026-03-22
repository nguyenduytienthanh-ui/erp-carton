from django.test import TestCase
from rest_framework.test import APIClient

from core.models import AuditLog, Permission, Role, Task, Team, User, UserSession


class UserOffboardingApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = 'SecurePass123!'

        self.manage_rbac_permission, _ = Permission.objects.get_or_create(
            resource='CORE',
            action='MANAGE_RBAC',
            defaults={'code': 'TEST_CORE_MANAGE_RBAC_OFFBOARD', 'name': 'Manage RBAC'},
        )

        self.manager_role = Role.objects.create(name='Lifecycle Manager', code='LIFECYCLE_MANAGER')
        self.manager_role.permissions.add(self.manage_rbac_permission)
        self.ops_role = Role.objects.create(name='Ops Access', code='OPS_ACCESS')
        self.ops_team = Team.objects.create(name='Ops Team', code='OPS_TEAM')

        self.manager_user = User.objects.create_user(
            username='offboard_admin',
            password=self.password,
            email='offboard_admin@example.com',
            first_name='Offboard',
            last_name='Admin',
        )
        self.manager_user.roles.add(self.manager_role)

        self.transfer_user = User.objects.create_user(
            username='task_receiver',
            password=self.password,
            email='task_receiver@example.com',
            first_name='Task',
            last_name='Receiver',
        )

        self.target_user = User.objects.create_user(
            username='departing_user',
            password=self.password,
            email='departing_user@example.com',
            first_name='Departing',
            last_name='User',
        )
        self.target_user.roles.add(self.ops_role)
        self.target_user.teams.add(self.ops_team)

        self.superuser_target = User.objects.create_user(
            username='departing_root',
            password=self.password,
            email='departing_root@example.com',
            first_name='Root',
            last_name='User',
            is_superuser=True,
            is_staff=True,
        )

        UserSession.objects.create(
            user=self.target_user,
            session_key='offboard-session-1',
            device_info={'browser': 'Chrome'},
            ip_address='127.0.0.10',
            is_active=True,
        )

        Task.objects.create(
            entity_type='User',
            entity_id=self.target_user.id,
            entity_code=self.target_user.username,
            title='Close pending checklist',
            assigned_to=self.target_user,
            assigned_by=self.manager_user,
            priority=Task.PRIORITY_HIGH,
            status=Task.STATUS_TODO,
        )
        Task.objects.create(
            entity_type='User',
            entity_id=self.target_user.id,
            entity_code=self.target_user.username,
            title='Review open requests',
            assigned_to=self.target_user,
            assigned_by=self.manager_user,
            priority=Task.PRIORITY_MEDIUM,
            status=Task.STATUS_IN_PROGRESS,
        )

        self.regular_user = User.objects.create_user(
            username='offboard_regular',
            password=self.password,
            email='offboard_regular@example.com',
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
        token = response.json()['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    def test_offboarding_workspace_and_preview_return_cleanup_signals(self):
        self.login(self.manager_user)

        workspace_response = self.client.get('/api/users/offboarding_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()
        self.assertGreaterEqual(workspace_body['summary']['session_cleanup'], 1)
        self.assertTrue(any(item['username'] == 'departing_user' for item in workspace_body['watchlist']))

        preview_response = self.client.post(
            '/api/users/offboarding_preview/',
            {
                'user_id': self.target_user.id,
                'transfer_task_owner_id': self.transfer_user.id,
                'deactivate_account': True,
                'lock_account': True,
                'revoke_access': True,
                'revoke_sessions': True,
            },
            format='json',
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.content)
        preview_body = preview_response.json()
        self.assertEqual(preview_body['tasks']['open_task_count'], 2)
        self.assertEqual(preview_body['sessions']['active_session_count'], 1)
        self.assertTrue(any(item['key'] == 'task_handoff' and item['status'] == 'ready' for item in preview_body['preflight_checks']))
        self.assertEqual(preview_body['transfer_target']['username'], 'task_receiver')

    def test_offboard_user_transfers_tasks_revokes_sessions_and_access(self):
        self.login(self.manager_user)

        response = self.client.post(
            '/api/users/offboard_user/',
            {
                'user_id': self.target_user.id,
                'transfer_task_owner_id': self.transfer_user.id,
                'deactivate_account': True,
                'lock_account': True,
                'revoke_access': True,
                'revoke_sessions': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['cleanup']['tasks_transferred_count'], 2)
        self.assertEqual(body['cleanup']['sessions_revoked_count'], 1)

        self.target_user.refresh_from_db()
        self.assertFalse(self.target_user.is_active)
        self.assertTrue(self.target_user.is_locked)
        self.assertEqual(self.target_user.roles.count(), 0)
        self.assertEqual(self.target_user.teams.count(), 0)
        self.assertEqual(UserSession.objects.filter(user=self.target_user, is_active=True).count(), 0)
        self.assertEqual(Task.objects.filter(assigned_to=self.transfer_user, status__in=[Task.STATUS_TODO, Task.STATUS_IN_PROGRESS]).count(), 2)
        self.assertTrue(AuditLog.objects.filter(entity_type='UserOffboarding', entity_id=self.target_user.id).exists())
        self.assertTrue(AuditLog.objects.filter(entity_type='UserAccess', entity_id=self.target_user.id).exists())

    def test_offboarding_preview_surfaces_handoff_session_access_and_policy_warnings(self):
        self.login(self.manager_user)

        preview_response = self.client.post(
            '/api/users/offboarding_preview/',
            {
                'user_id': self.target_user.id,
                'deactivate_account': True,
                'lock_account': True,
                'revoke_access': False,
                'revoke_sessions': False,
            },
            format='json',
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.content)
        preview_body = preview_response.json()
        warnings = preview_body['warnings']
        self.assertTrue(any('đầu việc đang mở' in item.lower() for item in warnings))
        self.assertTrue(any('phiên đang mở' in item.lower() for item in warnings))
        self.assertTrue(any('vai trò/nhóm' in item.lower() for item in warnings))

        self.login(self.manager_user)
        self_preview_response = self.client.post(
            '/api/users/offboarding_preview/',
            {
                'user_id': self.manager_user.id,
            },
            format='json',
        )
        self.assertEqual(self_preview_response.status_code, 200, self_preview_response.content)
        self.assertTrue(any('chính tài khoản đang thao tác' in item.lower() for item in self_preview_response.json()['warnings']))

        self.login(self.manager_user)
        superuser_preview_response = self.client.post(
            '/api/users/offboarding_preview/',
            {
                'user_id': self.superuser_target.id,
            },
            format='json',
        )
        self.assertEqual(superuser_preview_response.status_code, 200, superuser_preview_response.content)
        self.assertTrue(any('superuser' in item.lower() for item in superuser_preview_response.json()['warnings']))

    def test_offboarding_preview_rejects_transfer_target_same_as_user(self):
        self.login(self.manager_user)

        response = self.client.post(
            '/api/users/offboarding_preview/',
            {
                'user_id': self.target_user.id,
                'transfer_task_owner_id': self.target_user.id,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('transfer_task_owner_id', response.json())

    def test_offboard_user_rejects_self_superuser_and_missing_handoff(self):
        self.login(self.manager_user)

        self_response = self.client.post(
            '/api/users/offboard_user/',
            {
                'user_id': self.manager_user.id,
            },
            format='json',
        )
        self.assertEqual(self_response.status_code, 400, self_response.content)
        self.assertIn('chính tài khoản đang thao tác', self_response.json()['error'].lower())

        superuser_response = self.client.post(
            '/api/users/offboard_user/',
            {
                'user_id': self.superuser_target.id,
            },
            format='json',
        )
        self.assertEqual(superuser_response.status_code, 400, superuser_response.content)
        self.assertIn('superuser', superuser_response.json()['error'].lower())

        missing_handoff_response = self.client.post(
            '/api/users/offboard_user/',
            {
                'user_id': self.target_user.id,
                'deactivate_account': True,
                'lock_account': True,
                'revoke_access': True,
                'revoke_sessions': True,
            },
            format='json',
        )
        self.assertEqual(missing_handoff_response.status_code, 400, missing_handoff_response.content)
        self.assertIn('người nhận bàn giao', missing_handoff_response.json()['error'].lower())

    def test_offboarding_endpoints_require_manage_user_permission(self):
        self.login(self.regular_user)

        workspace_response = self.client.get('/api/users/offboarding_workspace/')
        self.assertEqual(workspace_response.status_code, 403)

        preview_response = self.client.post(
            '/api/users/offboarding_preview/',
            {'user_id': self.target_user.id},
            format='json',
        )
        self.assertEqual(preview_response.status_code, 403)

        apply_response = self.client.post(
            '/api/users/offboard_user/',
            {'user_id': self.target_user.id},
            format='json',
        )
        self.assertEqual(apply_response.status_code, 403)
