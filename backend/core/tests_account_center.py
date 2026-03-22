from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.email_utils import send_notification_email, should_send_email
from core.models import AuditLog, EmailTemplate, Notification, Permission, Role, Task, Team, User, UserPreferences, UserSession


class AccountCenterApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = 'SecurePass123!'
        self.user = User.objects.create_user(
            username='account_user',
            password=self.password,
            email='account@example.com',
            first_name='An',
            last_name='Nguyen',
            phone='0900000000',
        )

    def login(self):
        response = self.client.post(
            '/api/auth/login/',
            {'username': self.user.username, 'password': self.password},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {body['access']}")
        return body

    def test_patch_me_updates_profile_and_returns_enriched_fields(self):
        self.login()

        response = self.client.patch(
            '/api/users/me/',
            {
                'first_name': 'Anh',
                'last_name': 'Tran',
                'email': 'anh.tran@example.com',
                'phone': '0911222333',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body['full_name'], 'Anh Tran')
        self.assertEqual(body['email'], 'anh.tran@example.com')
        self.assertEqual(body['phone'], '0911222333')
        self.assertIn('avatar_url', body)

        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, 'Anh')
        self.assertEqual(self.user.last_name, 'Tran')

    def test_user_list_returns_lightweight_directory_rows_for_authenticated_user(self):
        User.objects.create_user(
            username='viewer_user',
            password='ViewerPass123!',
            email='viewer@example.com',
            first_name='Viewer',
            last_name='User',
        )
        self.login()

        response = self.client.get('/api/users/', {'search': 'viewer', 'page_size': 20})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        row = body['results'][0]
        self.assertEqual(row['username'], 'viewer_user')
        self.assertIn('email', row)
        self.assertIn('full_name', row)
        self.assertNotIn('roles', row)
        self.assertNotIn('teams', row)
        self.assertNotIn('is_staff', row)

    def test_change_password_updates_hash_and_revokes_other_sessions(self):
        self.login()
        current_session = UserSession.objects.get(user=self.user, is_active=True)
        other_session = UserSession.objects.create(
            user=self.user,
            session_key='other-session',
            device_info={'browser': 'Firefox', 'os': 'Windows'},
            ip_address='127.0.0.2',
            is_active=True,
        )

        response = self.client.post(
            '/api/users/change_password/',
            {
                'current_password': self.password,
                'new_password': 'NewSecurePass456!',
                'confirm_password': 'NewSecurePass456!',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['revoked_sessions'], 1)

        self.user.refresh_from_db()
        current_session.refresh_from_db()
        other_session.refresh_from_db()
        self.assertTrue(self.user.check_password('NewSecurePass456!'))
        self.assertTrue(current_session.is_active)
        self.assertFalse(other_session.is_active)

    def test_revoked_session_is_blocked_on_follow_up_requests(self):
        self.login()

        sessions_response = self.client.get('/api/sessions/', {'page_size': 10})
        self.assertEqual(sessions_response.status_code, 200, sessions_response.content)
        session_id = sessions_response.json()['results'][0]['id']

        revoke_response = self.client.post(f'/api/sessions/{session_id}/revoke/')
        self.assertEqual(revoke_response.status_code, 200, revoke_response.content)

        me_response = self.client.get('/api/users/me/')
        self.assertEqual(me_response.status_code, 401, me_response.content)

    def test_locked_account_blocks_existing_token_and_revokes_current_session(self):
        self.login()
        current_session = UserSession.objects.get(user=self.user, is_active=True)

        self.user.is_locked = True
        self.user.save(update_fields=['is_locked'])

        me_response = self.client.get('/api/users/me/')
        self.assertEqual(me_response.status_code, 401, me_response.content)

        current_session.refresh_from_db()
        self.assertFalse(current_session.is_active)
        self.assertIsNotNone(current_session.logout_at)

    def test_account_hub_returns_work_security_and_access_summary(self):
        finance_perm, _ = Permission.objects.get_or_create(
            resource='FINANCE',
            action='MANAGE',
            defaults={
                'code': 'ACCOUNT_HUB_TEST_FINANCE_MANAGE',
                'name': 'Manage finance',
            },
        )
        workflow_perm, _ = Permission.objects.get_or_create(
            resource='WORKFLOW',
            action='VIEW',
            defaults={
                'code': 'ACCOUNT_HUB_TEST_WORKFLOW_VIEW',
                'name': 'View workflow',
            },
        )
        role = Role.objects.create(name='Finance Manager', code='FINANCE_MANAGER')
        role.permissions.set([finance_perm, workflow_perm])
        team = Team.objects.create(name='Back Office', code='BACKOFFICE')
        self.user.roles.add(role)
        self.user.teams.add(team)

        self.login()
        current_session = UserSession.objects.get(user=self.user, is_active=True)
        other_session = UserSession.objects.create(
            user=self.user,
            session_key='stale-session',
            device_info={'browser': 'Firefox', 'os': 'Windows'},
            ip_address='127.0.0.2',
            is_active=True,
        )
        UserSession.objects.filter(pk=other_session.pk).update(
            login_at=timezone.now() - timedelta(days=30),
            last_active=timezone.now() - timedelta(days=21),
        )

        Task.objects.create(
            entity_type='Task',
            entity_id=101,
            entity_code='TASK-101',
            title='Follow up overdue item',
            assigned_to=self.user,
            status=Task.STATUS_TODO,
            priority=Task.PRIORITY_HIGH,
            due_date=timezone.localdate() - timedelta(days=1),
            needs_help=True,
            is_blocking=True,
        )
        Task.objects.create(
            entity_type='Task',
            entity_id=102,
            entity_code='TASK-102',
            title='Prepare approval package',
            assigned_to=self.user,
            status=Task.STATUS_IN_PROGRESS,
            priority=Task.PRIORITY_URGENT,
            due_date=timezone.localdate() + timedelta(days=1),
        )
        Task.objects.create(
            entity_type='Task',
            entity_id=103,
            entity_code='TASK-103',
            title='Archived task',
            assigned_to=self.user,
            status=Task.STATUS_DONE,
            priority=Task.PRIORITY_LOW,
        )

        Notification.objects.create(
            recipient=self.user,
            notification_type='approval_request',
            title='Approval pending',
            message='Please review document',
            actor=self.user,
            entity_type='Task',
            entity_id=101,
        )
        Notification.objects.create(
            recipient=self.user,
            notification_type='system',
            title='System note',
            message='Read already',
            actor=self.user,
            is_read=True,
        )
        AuditLog.objects.create(
            user=self.user,
            action='UPDATE',
            entity_type='Customer',
            entity_id=12,
            entity_code='CUS-12',
            changed_fields=['email'],
            old_values={'email': 'old@example.com'},
            new_values={'email': 'new@example.com'},
        )

        response = self.client.get('/api/users/account_hub/')
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertEqual(body['profile_completion']['score'], 100)
        self.assertEqual(body['work_summary']['open_tasks'], 2)
        self.assertEqual(body['work_summary']['overdue_tasks'], 1)
        self.assertEqual(body['work_summary']['needs_help_tasks'], 1)
        self.assertEqual(body['notification_summary']['unread_count'], 1)
        self.assertEqual(body['security']['other_active_sessions'], 1)
        self.assertEqual(body['security']['stale_session_count'], 1)
        self.assertTrue(body['security']['last_login_at'])

        modules = {item['key']: item for item in body['access_summary']['modules']}
        self.assertTrue(modules['finance']['enabled'])
        self.assertTrue(modules['workflow']['enabled'])
        self.assertIn('Finance Manager', modules['finance']['source_roles'])
        self.assertGreaterEqual(len(body['activity_preview']), 3)

    def test_activity_feed_supports_kind_filter(self):
        self.login()

        Notification.objects.create(
            recipient=self.user,
            notification_type='assignment',
            title='Assigned task',
            message='A new task has been assigned',
            actor=self.user,
            entity_type='Task',
            entity_id=5,
        )
        AuditLog.objects.create(
            user=self.user,
            action='CREATE',
            entity_type='Task',
            entity_id=5,
            entity_code='TASK-5',
            changed_fields=['title'],
            old_values={},
            new_values={'title': 'A new task has been assigned'},
        )

        response = self.client.get('/api/users/activity_feed/', {'kind': 'all', 'limit': 20})
        self.assertEqual(response.status_code, 200, response.content)
        items = response.json()['items']
        kinds = {item['kind'] for item in items}
        self.assertIn('notification', kinds)
        self.assertIn('audit', kinds)
        self.assertIn('session', kinds)

        filtered_response = self.client.get('/api/users/activity_feed/', {'kind': 'notification', 'limit': 20})
        self.assertEqual(filtered_response.status_code, 200, filtered_response.content)
        filtered_items = filtered_response.json()['items']
        self.assertTrue(filtered_items)
        self.assertTrue(all(item['kind'] == 'notification' for item in filtered_items))


class AccountCenterEmailPreferenceTests(TestCase):
    def setUp(self):
        self.recipient = User.objects.create_user(
            username='notify_recipient',
            password='pass',
            email='recipient@example.com',
        )
        self.actor = User.objects.create_user(username='notify_actor', password='pass')

    def test_should_send_email_respects_default_and_saved_preferences(self):
        mention_notification = Notification.objects.create(
            recipient=self.recipient,
            notification_type='mention',
            title='Mention',
            message='Ping',
            actor=self.actor,
        )
        system_notification = Notification.objects.create(
            recipient=self.recipient,
            notification_type='system',
            title='System',
            message='System ping',
            actor=self.actor,
        )

        self.assertTrue(should_send_email(mention_notification))
        self.assertFalse(should_send_email(system_notification))

        UserPreferences.objects.update_or_create(
            user=self.recipient,
            page='account-center',
            defaults={
                'config': {
                    'email_notifications_enabled': False,
                    'email_notification_types': ['system'],
                }
            },
        )
        self.assertFalse(should_send_email(mention_notification))
        self.assertFalse(should_send_email(system_notification))

        UserPreferences.objects.update_or_create(
            user=self.recipient,
            page='account-center',
            defaults={
                'config': {
                    'email_notifications_enabled': True,
                    'email_notification_types': ['system'],
                }
            },
        )
        self.assertFalse(should_send_email(mention_notification))
        self.assertTrue(should_send_email(system_notification))

    @override_settings(
        EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
        DEFAULT_FROM_EMAIL='ERP Carton <noreply@example.com>',
        FRONTEND_URL='https://uat.example.com',
    )
    def test_send_notification_email_records_delivery_audit(self):
        EmailTemplate.objects.create(
            notification_type='mention',
            name='Mention template',
            subject='[ERP] {{title}}',
            body_html='<p>{{message}}</p>',
            body_text='{{message}}',
            available_variables=['title', 'message', 'link', 'user_name'],
            is_active=True,
        )

        notification = Notification.objects.create(
            recipient=self.recipient,
            notification_type='mention',
            title='Mention',
            message='Ping from workflow',
            actor=self.actor,
        )
        skipped_notification = Notification.objects.create(
            recipient=self.recipient,
            notification_type='system',
            title='System',
            message='No template configured',
            actor=self.actor,
        )

        self.assertTrue(send_notification_email(notification.id))
        success_audit = AuditLog.objects.filter(entity_type='MailDelivery', entity_id=notification.id).order_by('-id').first()
        self.assertIsNotNone(success_audit)
        self.assertEqual(success_audit.new_values['status'], 'SUCCESS')
        self.assertEqual(success_audit.new_values['recipient_email'], self.recipient.email)

        self.assertFalse(send_notification_email(skipped_notification.id))
        skipped_audit = AuditLog.objects.filter(entity_type='MailDelivery', entity_id=skipped_notification.id).order_by('-id').first()
        self.assertIsNotNone(skipped_audit)
        self.assertEqual(skipped_audit.new_values['status'], 'SKIPPED')


class AdminUserDirectoryApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = 'SecurePass123!'

        self.base_role = Role.objects.create(name='Core User', code='CORE_USER')
        self.alt_role = Role.objects.create(name='Warehouse Lead', code='WAREHOUSE_LEAD')
        self.base_team = Team.objects.create(name='Operations Team', code='OPS_TEAM')
        self.alt_team = Team.objects.create(name='Field Team', code='FIELD_TEAM')
        self.rbac_permission, _ = Permission.objects.get_or_create(
            resource='CORE',
            action='MANAGE_RBAC',
            defaults={
                'code': 'ADMIN_USER_DIRECTORY_RBAC',
                'name': 'Manage RBAC',
            },
        )
        self.manager_role = Role.objects.create(name='Governance Manager', code='GOV_MANAGER')
        self.manager_role.permissions.add(self.rbac_permission)

        self.manager_user = User.objects.create_user(
            username='directory_manager',
            password=self.password,
            email='manager@example.com',
            first_name='Manager',
            last_name='User',
        )
        self.manager_user.roles.add(self.manager_role)
        self.manager_user.teams.add(self.base_team)

        self.regular_user = User.objects.create_user(
            username='directory_regular',
            password=self.password,
            email='regular@example.com',
            first_name='Regular',
            last_name='User',
        )
        self.regular_user.roles.add(self.base_role)
        self.regular_user.teams.add(self.base_team)

        self.locked_user = User.objects.create_user(
            username='locked_target',
            password=self.password,
            email='locked@example.com',
            first_name='Locked',
            last_name='Target',
            is_locked=True,
        )
        self.locked_user.roles.add(self.base_role)
        self.locked_user.teams.add(self.base_team)

        self.unassigned_user = User.objects.create_user(
            username='unassigned_target',
            password=self.password,
            email='unassigned@example.com',
            first_name='Unassigned',
            last_name='Target',
        )

        self.dormant_user = User.objects.create_user(
            username='dormant_target',
            password=self.password,
            email='dormant@example.com',
            first_name='Dormant',
            last_name='Target',
        )
        self.dormant_user.roles.add(self.base_role)
        self.dormant_user.teams.add(self.base_team)

        self.online_user = User.objects.create_user(
            username='online_target',
            password=self.password,
            email='online@example.com',
            first_name='Online',
            last_name='Target',
        )
        self.online_user.roles.add(self.base_role)
        self.online_user.teams.add(self.base_team)

        UserSession.objects.create(
            user=self.online_user,
            session_key='online-user-session',
            device_info={'browser': 'Chrome', 'os': 'Windows'},
            ip_address='10.0.0.10',
            is_active=True,
        )
        dormant_session = UserSession.objects.create(
            user=self.dormant_user,
            session_key='dormant-user-session',
            device_info={'browser': 'Safari', 'os': 'macOS'},
            ip_address='10.0.0.20',
            is_active=True,
        )
        UserSession.objects.filter(pk=dormant_session.pk).update(
            login_at=timezone.now() - timedelta(days=45),
            last_active=timezone.now() - timedelta(days=40),
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

    def test_directory_summary_allows_rbac_manager_and_returns_counts(self):
        self.login(self.manager_user)

        response = self.client.get('/api/users/directory_summary/')
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertEqual(body['total_users'], 6)
        self.assertEqual(body['locked_users'], 1)
        self.assertEqual(body['without_role_users'], 1)
        self.assertEqual(body['without_team_users'], 1)
        self.assertGreaterEqual(body['dormant_users'], 1)
        self.assertGreaterEqual(body['attention_users'], 2)
        self.assertTrue(body['focus_items'])
        self.assertTrue(body['role_breakdown'])

    def test_directory_filters_by_locked_and_unassigned_attention(self):
        self.login(self.manager_user)

        locked_response = self.client.get('/api/users/directory/', {'is_locked': 'true', 'page_size': 50})
        self.assertEqual(locked_response.status_code, 200, locked_response.content)
        locked_results = locked_response.json()['results']
        self.assertEqual([item['username'] for item in locked_results], ['locked_target'])

        attention_response = self.client.get('/api/users/directory/', {'attention': 'unassigned', 'page_size': 50})
        self.assertEqual(attention_response.status_code, 200, attention_response.content)
        attention_usernames = {item['username'] for item in attention_response.json()['results']}
        self.assertIn('unassigned_target', attention_usernames)
        self.assertNotIn('locked_target', attention_usernames)

    def test_bulk_actions_skip_current_user_and_track_lock_metadata(self):
        self.login(self.manager_user)

        lock_response = self.client.post(
            '/api/users/bulk_lock/',
            {'ids': [self.manager_user.id, self.online_user.id], 'is_locked': True},
            format='json',
        )
        self.assertEqual(lock_response.status_code, 200, lock_response.content)
        self.assertEqual(lock_response.json()['count'], 1)
        self.assertEqual(lock_response.json()['skipped_self'], 1)

        self.manager_user.refresh_from_db()
        self.online_user.refresh_from_db()
        self.assertFalse(self.manager_user.is_locked)
        self.assertTrue(self.online_user.is_locked)
        self.assertEqual(self.online_user.locked_by_id, self.manager_user.id)
        self.assertIsNotNone(self.online_user.locked_at)

        activate_response = self.client.post(
            '/api/users/bulk_activate/',
            {'ids': [self.manager_user.id, self.online_user.id], 'is_active': False},
            format='json',
        )
        self.assertEqual(activate_response.status_code, 200, activate_response.content)
        self.assertEqual(activate_response.json()['count'], 1)
        self.assertEqual(activate_response.json()['skipped_self'], 1)

        self.manager_user.refresh_from_db()
        self.online_user.refresh_from_db()
        self.assertTrue(self.manager_user.is_active)
        self.assertFalse(self.online_user.is_active)

    def test_directory_endpoints_forbidden_for_user_without_permission(self):
        self.login(self.regular_user)

        summary_response = self.client.get('/api/users/directory_summary/')
        self.assertEqual(summary_response.status_code, 403)

        list_response = self.client.get('/api/users/directory/', {'page_size': 20})
        self.assertEqual(list_response.status_code, 403)

        bulk_response = self.client.post(
            '/api/users/bulk_lock/',
            {'ids': [self.locked_user.id], 'is_locked': False},
            format='json',
        )
        self.assertEqual(bulk_response.status_code, 403)

    def test_access_profile_updates_roles_teams_and_creates_audit_log(self):
        self.login(self.manager_user)

        response = self.client.post(
            f'/api/users/{self.online_user.id}/access_profile/',
            {
                'role_ids': [self.alt_role.id],
                'team_ids': [self.alt_team.id],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(set(body['changed_fields']), {'roles', 'teams'})
        self.assertEqual([item['id'] for item in body['user']['roles']], [self.alt_role.id])
        self.assertEqual([item['id'] for item in body['user']['teams']], [self.alt_team.id])

        self.online_user.refresh_from_db()
        self.assertEqual(list(self.online_user.roles.values_list('id', flat=True)), [self.alt_role.id])
        self.assertEqual(list(self.online_user.teams.values_list('id', flat=True)), [self.alt_team.id])

        audit = AuditLog.objects.filter(entity_type='UserAccess', entity_id=self.online_user.id).latest('created_at')
        self.assertEqual(audit.user_id, self.manager_user.id)
        self.assertEqual(set(audit.changed_fields), {'roles', 'teams'})
        self.assertEqual(audit.new_values['role_ids'], [self.alt_role.id])
        self.assertEqual(audit.new_values['team_ids'], [self.alt_team.id])

    def test_access_profile_blocks_self_edit(self):
        self.login(self.manager_user)

        response = self.client.post(
            f'/api/users/{self.manager_user.id}/access_profile/',
            {
                'role_ids': [self.alt_role.id],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_bulk_access_and_activity_feed_work_for_rbac_manager(self):
        self.login(self.manager_user)

        response = self.client.post(
            '/api/users/bulk_access/',
            {
                'ids': [self.manager_user.id, self.online_user.id, self.dormant_user.id],
                'strategy': 'add',
                'role_ids': [self.alt_role.id],
                'team_ids': [self.alt_team.id],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body['count'], 2)
        self.assertEqual(body['skipped_self'], 1)
        self.assertEqual(body['strategy'], 'add')

        self.online_user.refresh_from_db()
        self.dormant_user.refresh_from_db()
        self.assertIn(self.alt_role.id, list(self.online_user.roles.values_list('id', flat=True)))
        self.assertIn(self.alt_role.id, list(self.dormant_user.roles.values_list('id', flat=True)))
        self.assertIn(self.alt_team.id, list(self.online_user.teams.values_list('id', flat=True)))

        activity_response = self.client.get('/api/users/access_activity/', {'limit': 20})
        self.assertEqual(activity_response.status_code, 200, activity_response.content)
        activity_items = activity_response.json()['items']
        self.assertGreaterEqual(len(activity_items), 2)
        self.assertTrue(all(item['target_user']['username'] in {'online_target', 'dormant_target'} for item in activity_items[:2]))

        filtered_activity = self.client.get('/api/users/access_activity/', {'user_id': self.online_user.id, 'limit': 20})
        self.assertEqual(filtered_activity.status_code, 200, filtered_activity.content)
        filtered_items = filtered_activity.json()['items']
        self.assertTrue(filtered_items)
        self.assertTrue(all(item['target_user']['id'] == self.online_user.id for item in filtered_items))
