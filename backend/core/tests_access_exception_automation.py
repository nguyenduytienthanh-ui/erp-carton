import json
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AuditLog, Notification, Permission, Role, Setting, Team, User


class AccessExceptionAutomationApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = 'SecurePass123!'

        self.manage_rbac_permission, _ = Permission.objects.get_or_create(
            resource='CORE',
            action='MANAGE_RBAC',
            defaults={'code': 'TEST_CORE_MANAGE_RBAC_ACCESS_EXCEPTION_AUTOMATION', 'name': 'Manage RBAC'},
        )

        self.manager_role = Role.objects.create(name='Access Exception Automation Manager', code='ACCESS_EXCEPTION_AUTOMATION_MANAGER')
        self.manager_role.permissions.add(self.manage_rbac_permission)

        self.base_role = Role.objects.create(name='Base Ops Role Automation', code='BASE_OPS_ROLE_AUTOMATION')
        self.exception_role = Role.objects.create(name='Exception Ops Role Automation', code='EXCEPTION_OPS_ROLE_AUTOMATION')
        self.base_team = Team.objects.create(name='Base Ops Team Automation', code='BASE_OPS_TEAM_AUTOMATION')
        self.exception_team = Team.objects.create(name='Exception Ops Team Automation', code='EXCEPTION_TEAM_AUTOMATION')

        self.manager_user = User.objects.create_user(
            username='access_exception_automation_admin',
            password=self.password,
            email='access_exception_automation_admin@example.com',
            first_name='Automation',
            last_name='Admin',
        )
        self.manager_user.roles.add(self.manager_role)

        self.approver_user = User.objects.create_user(
            username='access_exception_automation_approver',
            password=self.password,
            email='access_exception_automation_approver@example.com',
            first_name='Automation',
            last_name='Approver',
        )
        self.approver_user.roles.add(self.manager_role)

        self.target_user = User.objects.create_user(
            username='access_exception_automation_target',
            password=self.password,
            email='access_exception_automation_target@example.com',
            first_name='Automation',
            last_name='Target',
        )
        self.target_user.roles.add(self.base_role)
        self.target_user.teams.add(self.base_team)

    def login(self, user):
        response = self.client.post(
            '/api/auth/login/',
            {'username': user.username, 'password': self.password},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        token = response.json()['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    def create_policy(self, **overrides):
        payload = {
            'key': 'ops-burst-automation',
            'name': 'Ops burst automation',
            'description': 'Temporary exception for ops troubleshooting.',
            'is_active': True,
            'tone': 'cyan',
            'risk_level': 'elevated',
            'default_duration_days': 3,
            'max_duration_days': 10,
            'requires_approval': True,
            'role_ids': [self.exception_role.id],
            'team_ids': [self.exception_team.id],
            'checklist': ['Confirm owner', 'Review expiry'],
        }
        payload.update(overrides)
        response = self.client.post('/api/users/access_exception_policies/', payload, format='json')
        self.assertIn(response.status_code, [200, 201], response.content)
        return response.json()['policy']

    def create_request(self, **overrides):
        payload = {
            'policy_key': 'ops-burst-automation',
            'user_id': self.target_user.id,
            'approver_user_id': self.approver_user.id,
            'duration_days': 3,
            'justification': 'Need a short troubleshooting window for shipment recovery.',
            'ticket_ref': 'INC-2001',
        }
        payload.update(overrides)
        response = self.client.post('/api/users/access_exception_requests/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['request']

    def approve_request(self, request_key, note='Approved for operations continuity.'):
        response = self.client.post(
            '/api/users/access_exception_decide/',
            {
                'request_key': request_key,
                'decision': 'approve',
                'note': note,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['request']

    def patch_request_storage(self, request_key, **overrides):
        setting = Setting.objects.get(key='USER_ACCESS_EXCEPTION_REQUESTS')
        rows = json.loads(setting.value)
        for row in rows:
            if row.get('key') == request_key:
                row.update(overrides)
        setting.value = json.dumps(rows)
        setting.save(update_fields=['value'])

    def test_renewal_approval_transfers_active_window_and_keeps_revoke_safe(self):
        self.login(self.manager_user)
        self.create_policy()
        original_request = self.create_request()

        self.login(self.approver_user)
        self.approve_request(original_request['key'])

        self.login(self.manager_user)
        renewal_response = self.client.post(
            '/api/users/access_exception_renewals/',
            {
                'request_key': original_request['key'],
                'approver_user_id': self.approver_user.id,
                'duration_days': 5,
                'justification': 'Need to extend the exception through the recovery weekend.',
                'ticket_ref': 'INC-2002',
            },
            format='json',
        )
        self.assertEqual(renewal_response.status_code, 201, renewal_response.content)
        renewal_request = renewal_response.json()['request']
        self.assertEqual(renewal_request['request_kind'], 'renewal')
        self.assertEqual(renewal_request['parent_request_key'], original_request['key'])

        self.login(self.approver_user)
        approve_response = self.client.post(
            '/api/users/access_exception_decide/',
            {
                'request_key': renewal_request['key'],
                'decision': 'approve',
                'note': 'Renewal approved through the incident bridge.',
            },
            format='json',
        )
        self.assertEqual(approve_response.status_code, 200, approve_response.content)

        workspace_response = self.client.get('/api/users/access_exception_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()
        original_row = next(item for item in workspace_body['requests'] if item['key'] == original_request['key'])
        renewal_row = next(item for item in workspace_body['requests'] if item['key'] == renewal_request['key'])
        self.assertEqual(original_row['lifecycle_state'], 'renewed')
        self.assertEqual(renewal_row['lifecycle_state'], 'active')

        self.target_user.refresh_from_db()
        self.assertIn(self.exception_role.id, list(self.target_user.roles.values_list('id', flat=True)))
        self.assertIn(self.exception_team.id, list(self.target_user.teams.values_list('id', flat=True)))

        revoke_response = self.client.post(
            '/api/users/access_exception_revoke/',
            {
                'request_key': renewal_request['key'],
                'note': 'Renewal window closed cleanly.',
            },
            format='json',
        )
        self.assertEqual(revoke_response.status_code, 200, revoke_response.content)

        self.target_user.refresh_from_db()
        target_role_ids = list(self.target_user.roles.values_list('id', flat=True))
        target_team_ids = list(self.target_user.teams.values_list('id', flat=True))
        self.assertIn(self.base_role.id, target_role_ids)
        self.assertIn(self.base_team.id, target_team_ids)
        self.assertNotIn(self.exception_role.id, target_role_ids)
        self.assertNotIn(self.exception_team.id, target_team_ids)

    def test_automation_preview_and_run_expiry_cleanup(self):
        self.login(self.manager_user)
        self.create_policy()
        request_row = self.create_request(duration_days=1)

        self.login(self.approver_user)
        approved_row = self.approve_request(request_row['key'])
        self.patch_request_storage(
            approved_row['key'],
            expires_at=(timezone.now() - timedelta(hours=2)).isoformat(),
            reminder_offsets_sent=[],
        )

        self.login(self.manager_user)
        policy_response = self.client.post(
            '/api/users/access_exception_automation_policy/',
            {
                'enabled': True,
                'auto_revoke_expired': True,
                'reminder_offsets_days': [7, 3, 1],
                'renewal_window_days': 3,
                'notify_target_user': True,
                'notify_requested_by': True,
                'notify_approver': False,
            },
            format='json',
        )
        self.assertEqual(policy_response.status_code, 200, policy_response.content)

        preview_response = self.client.post(
            '/api/users/access_exception_automation_preview/',
            {'scope': 'all'},
            format='json',
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.content)
        preview_body = preview_response.json()
        self.assertGreaterEqual(preview_body['summary']['expired_with_access'], 1)

        run_response = self.client.post(
            '/api/users/access_exception_run_automation/',
            {'scope': 'all'},
            format='json',
        )
        self.assertEqual(run_response.status_code, 200, run_response.content)
        run_body = run_response.json()
        self.assertEqual(run_body['processed']['requests_auto_revoked'], 1)
        self.assertGreaterEqual(run_body['processed']['notifications_created'], 1)

        self.target_user.refresh_from_db()
        self.assertNotIn(self.exception_role.id, list(self.target_user.roles.values_list('id', flat=True)))
        self.assertNotIn(self.exception_team.id, list(self.target_user.teams.values_list('id', flat=True)))
        self.assertTrue(
            AuditLog.objects.filter(
                entity_type='UserAccessExceptionAutomation',
                entity_code='ACCESS_EXCEPTION_AUTOMATION_JOB',
            ).exists()
        )
        self.assertTrue(
            Notification.objects.filter(
                entity_type='UserAccessExceptionRequest',
                title__icontains='thu hoi',
            ).exists()
        )

    def test_automation_preview_and_run_approval_sla_notifications(self):
        self.login(self.manager_user)
        self.create_policy(approval_sla_hours=1)
        request_row = self.create_request(duration_days=3)
        self.patch_request_storage(
            request_row['key'],
            approval_stage_due_at=(timezone.now() + timedelta(minutes=30)).isoformat(),
            sla_warning_stage_level=None,
            sla_warning_sent_at=None,
            sla_escalation_stage_level=None,
            sla_escalation_sent_at=None,
        )

        policy_response = self.client.post(
            '/api/users/access_exception_automation_policy/',
            {
                'enabled': True,
                'auto_revoke_expired': True,
                'reminder_offsets_days': [7, 3, 1],
                'renewal_window_days': 3,
                'notify_target_user': True,
                'notify_requested_by': True,
                'notify_approver': False,
                'approval_warning_window_hours': 6,
                'approval_escalation_delay_hours': 2,
                'notify_requester_for_sla': True,
                'notify_active_approver_for_sla': True,
                'notify_directory_owners_for_sla': False,
            },
            format='json',
        )
        self.assertEqual(policy_response.status_code, 200, policy_response.content)

        preview_warning_response = self.client.post(
            '/api/users/access_exception_automation_preview/',
            {'scope': 'approvals'},
            format='json',
        )
        self.assertEqual(preview_warning_response.status_code, 200, preview_warning_response.content)
        preview_warning_body = preview_warning_response.json()
        self.assertEqual(preview_warning_body['summary']['sla_warnings_due'], 1)

        run_warning_response = self.client.post(
            '/api/users/access_exception_run_automation/',
            {'scope': 'approvals'},
            format='json',
        )
        self.assertEqual(run_warning_response.status_code, 200, run_warning_response.content)
        run_warning_body = run_warning_response.json()
        self.assertEqual(run_warning_body['processed']['sla_warnings_sent'], 1)
        self.assertGreaterEqual(run_warning_body['processed']['notifications_created'], 1)

        self.patch_request_storage(
            request_row['key'],
            approval_stage_due_at=(timezone.now() - timedelta(hours=3)).isoformat(),
            sla_escalation_stage_level=None,
            sla_escalation_sent_at=None,
        )

        preview_escalation_response = self.client.post(
            '/api/users/access_exception_automation_preview/',
            {'scope': 'approvals'},
            format='json',
        )
        self.assertEqual(preview_escalation_response.status_code, 200, preview_escalation_response.content)
        preview_escalation_body = preview_escalation_response.json()
        self.assertEqual(preview_escalation_body['summary']['sla_escalations_due'], 1)

        run_escalation_response = self.client.post(
            '/api/users/access_exception_run_automation/',
            {'scope': 'approvals'},
            format='json',
        )
        self.assertEqual(run_escalation_response.status_code, 200, run_escalation_response.content)
        run_escalation_body = run_escalation_response.json()
        self.assertEqual(run_escalation_body['processed']['sla_escalations_sent'], 1)
        self.assertTrue(
            Notification.objects.filter(
                entity_type='UserAccessExceptionRequest',
                title__icontains='SLA',
            ).exists()
        )

    def test_automation_preview_and_run_continuity_drills(self):
        self.login(self.manager_user)
        self.create_policy()
        self.create_request(duration_days=3)

        policy_response = self.client.post(
            '/api/users/access_exception_automation_policy/',
            {
                'enabled': True,
                'auto_revoke_expired': True,
                'reminder_offsets_days': [7, 3, 1],
                'renewal_window_days': 3,
                'notify_target_user': True,
                'notify_requested_by': True,
                'notify_approver': False,
                'approval_warning_window_hours': 6,
                'approval_escalation_delay_hours': 2,
                'notify_requester_for_sla': True,
                'notify_active_approver_for_sla': True,
                'notify_directory_owners_for_sla': False,
                'continuity_drill_enabled': True,
                'continuity_drill_interval_days': 7,
                'continuity_drill_warning_days': 2,
                'notify_directory_owners_for_continuity': False,
                'auto_prepare_playbooks': True,
            },
            format='json',
        )
        self.assertEqual(policy_response.status_code, 200, policy_response.content)

        preview_response = self.client.post(
            '/api/users/access_exception_automation_preview/',
            {'scope': 'continuity'},
            format='json',
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.content)
        preview_body = preview_response.json()
        self.assertGreaterEqual(preview_body['summary']['continuity_drills_due'], 1)
        self.assertGreaterEqual(preview_body['summary']['playbooks_prepared'], 1)

        run_response = self.client.post(
            '/api/users/access_exception_run_automation/',
            {'scope': 'continuity'},
            format='json',
        )
        self.assertEqual(run_response.status_code, 200, run_response.content)
        run_body = run_response.json()
        self.assertGreaterEqual(run_body['processed']['continuity_drills_run'], 1)
        self.assertGreaterEqual(run_body['processed']['playbooks_prepared'], 1)

        drill_setting = Setting.objects.get(key='USER_ACCESS_EXCEPTION_CONTINUITY_DRILLS')
        drill_payload = json.loads(drill_setting.value)
        self.assertTrue(drill_payload.get('last_run_at'))
        self.assertTrue(drill_payload.get('departments'))

    def test_automation_policy_and_scheduler_updates_appear_in_activity_feed(self):
        self.login(self.manager_user)

        policy_response = self.client.post(
            '/api/users/access_exception_automation_policy/',
            {
                'enabled': True,
                'auto_revoke_expired': True,
                'reminder_offsets_days': [10, 5, 2],
                'renewal_window_days': 6,
                'notify_target_user': True,
                'notify_requested_by': True,
                'notify_approver': False,
                'approval_warning_window_hours': 8,
                'approval_escalation_delay_hours': 3,
                'notify_requester_for_sla': True,
                'notify_active_approver_for_sla': True,
                'notify_directory_owners_for_sla': True,
                'continuity_drill_enabled': True,
                'continuity_drill_interval_days': 9,
                'continuity_drill_warning_days': 2,
                'notify_directory_owners_for_continuity': True,
                'auto_prepare_playbooks': True,
            },
            format='json',
        )
        self.assertEqual(policy_response.status_code, 200, policy_response.content)

        scheduler_response = self.client.post(
            '/api/users/access_exception_scheduler_status/',
            {
                'enabled': True,
                'interval_minutes': 17,
            },
            format='json',
        )
        self.assertEqual(scheduler_response.status_code, 200, scheduler_response.content)

        activity_response = self.client.get('/api/users/access_exception_activity/?limit=10')
        self.assertEqual(activity_response.status_code, 200, activity_response.content)
        items = activity_response.json()['items']
        self.assertTrue(any(
            item['action'] == 'SAVE_AUTOMATION_POLICY'
            and 'chính sách tự động hóa' in item['summary'].lower()
            for item in items
        ))
        self.assertTrue(any(
            item['action'] == 'SAVE_SCHEDULER_STATUS'
            and 'bộ lập lịch tự động hóa' in item['summary'].lower()
            and '17 phút' in item['summary']
            for item in items
        ))
