import json
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import ApprovalHistory, AuditLog, Permission, Role, Setting, Task, Team, User


class AccessExceptionCenterApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = 'SecurePass123!'

        self.manage_rbac_permission, _ = Permission.objects.get_or_create(
            resource='CORE',
            action='MANAGE_RBAC',
            defaults={'code': 'TEST_CORE_MANAGE_RBAC_ACCESS_EXCEPTION', 'name': 'Manage RBAC'},
        )

        self.manager_role = Role.objects.create(name='Access Exception Manager', code='ACCESS_EXCEPTION_MANAGER')
        self.manager_role.permissions.add(self.manage_rbac_permission)

        self.base_role = Role.objects.create(name='Base Ops Role', code='BASE_OPS_ROLE')
        self.exception_role = Role.objects.create(name='Exception Ops Role', code='EXCEPTION_OPS_ROLE')
        self.base_team = Team.objects.create(name='Base Ops Team', code='BASE_OPS_TEAM')
        self.exception_team = Team.objects.create(name='Exception Ops Team', code='EXCEPTION_OPS_TEAM')
        self.finance_team = Team.objects.create(name='Finance Control Team', code='FIN_CTRL_TEAM')
        self.finance_governance_team = Team.objects.create(name='Finance Governance Team', code='FIN_GOV_TEAM')

        self.manager_user = User.objects.create_user(
            username='access_exception_admin',
            password=self.password,
            email='access_exception_admin@example.com',
            first_name='Exception',
            last_name='Admin',
        )
        self.manager_user.roles.add(self.manager_role)

        self.approver_user = User.objects.create_user(
            username='access_exception_approver',
            password=self.password,
            email='access_exception_approver@example.com',
            first_name='Exception',
            last_name='Approver',
        )
        self.approver_user.roles.add(self.manager_role)
        self.approver_user.teams.add(self.finance_team)

        self.stage_two_approver_user = User.objects.create_user(
            username='access_exception_stage_two',
            password=self.password,
            email='access_exception_stage_two@example.com',
            first_name='Stage',
            last_name='Two',
        )
        self.stage_two_approver_user.roles.add(self.manager_role)
        self.stage_two_approver_user.teams.add(self.finance_governance_team)

        self.directory_owner_user = User.objects.create_user(
            username='access_exception_directory_owner',
            password=self.password,
            email='access_exception_directory_owner@example.com',
            first_name='Directory',
            last_name='Owner',
        )
        self.directory_owner_user.roles.add(self.manager_role)

        self.directory_stage_two_user = User.objects.create_user(
            username='access_exception_directory_stage_two',
            password=self.password,
            email='access_exception_directory_stage_two@example.com',
            first_name='Directory',
            last_name='StageTwo',
        )
        self.directory_stage_two_user.roles.add(self.manager_role)

        self.target_user = User.objects.create_user(
            username='access_exception_target',
            password=self.password,
            email='access_exception_target@example.com',
            first_name='Target',
            last_name='User',
        )
        self.target_user.roles.add(self.base_role)
        self.target_user.teams.add(self.base_team)

        self.regular_user = User.objects.create_user(
            username='access_exception_regular',
            password=self.password,
            email='access_exception_regular@example.com',
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

    def create_policy(self, **overrides):
        payload = {
            'key': 'ops-burst',
            'name': 'Ops burst',
            'description': 'Temporary exception for ops troubleshooting.',
            'is_active': True,
            'tone': 'cyan',
            'risk_level': 'elevated',
            'default_duration_days': 5,
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
            'policy_key': 'ops-burst',
            'user_id': self.target_user.id,
            'approver_user_id': self.approver_user.id,
            'duration_days': 4,
            'justification': 'Need a short troubleshooting window for shipment recovery.',
            'ticket_ref': 'INC-1001',
        }
        payload.update(overrides)
        response = self.client.post('/api/users/access_exception_requests/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['request']

    def save_approver_availability(self, **overrides):
        payload = {
            'user_id': self.approver_user.id,
            'is_out_of_office': True,
            'label': 'Annual leave',
            'notes': 'Coverage should fail over cleanly.',
        }
        payload.update(overrides)
        response = self.client.post('/api/users/access_exception_approver_availability/', payload, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['availability']

    def patch_request_storage(self, request_key, **overrides):
        setting = Setting.objects.get(key='USER_ACCESS_EXCEPTION_REQUESTS')
        rows = json.loads(setting.value)
        for row in rows:
            if row.get('key') == request_key:
                row.update(overrides)
        setting.value = json.dumps(rows)
        setting.save(update_fields=['value'])

    def test_workspace_and_request_creation_create_approval_task_and_audit(self):
        self.login(self.manager_user)
        self.create_policy()

        workspace_response = self.client.get('/api/users/access_exception_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()
        self.assertGreaterEqual(workspace_body['summary']['active_policies'], 1)
        self.assertTrue(any(item['key'] == 'ops-burst' for item in workspace_body['policies']))
        self.assertTrue(any(item['key'] == 'finance-sensitive' for item in workspace_body['policy_packs']))

        request_row = self.create_request()
        self.assertEqual(request_row['policy']['key'], 'ops-burst')
        self.assertEqual(request_row['lifecycle_state'], 'pending')
        self.assertEqual(request_row['current_stage'], 1)
        self.assertEqual(request_row['total_stages'], 1)
        self.assertEqual(Task.objects.filter(source_key=f"access-exception-approval-{request_row['key']}-s1").count(), 1)
        self.assertTrue(
            AuditLog.objects.filter(
                entity_type='UserAccessExceptionRequest',
                action='CREATE',
                entity_id_str=request_row['key'],
            ).exists()
        )

    def test_approve_request_grants_access_and_creates_access_audit(self):
        self.login(self.manager_user)
        self.create_policy()
        request_row = self.create_request()

        self.login(self.approver_user)
        approve_response = self.client.post(
            '/api/users/access_exception_decide/',
            {
                'request_key': request_row['key'],
                'decision': 'approve',
                'note': 'Approved for incident response window.',
            },
            format='json',
        )
        self.assertEqual(approve_response.status_code, 200, approve_response.content)
        approve_body = approve_response.json()
        self.assertTrue(approve_body['success'])
        self.assertEqual(approve_body['request']['lifecycle_state'], 'active')

        self.target_user.refresh_from_db()
        self.assertIn(self.exception_role.id, list(self.target_user.roles.values_list('id', flat=True)))
        self.assertIn(self.exception_team.id, list(self.target_user.teams.values_list('id', flat=True)))
        self.assertTrue(AuditLog.objects.filter(entity_type='UserAccess', entity_id=self.target_user.id).exists())
        self.assertTrue(
            AuditLog.objects.filter(
                entity_type='UserAccessExceptionRequest',
                action='APPROVE',
                entity_id_str=request_row['key'],
            ).exists()
        )

    def test_multi_stage_approval_routes_to_stage_two_before_granting_access(self):
        self.login(self.manager_user)
        self.create_policy(
            key='finance-bridge',
            name='Finance bridge',
            description='Critical staged exception for finance controls.',
            risk_level='critical',
            approval_stage_count=2,
            approval_sla_hours=6,
            stage_one_label='Finance control review',
            stage_two_label='Governance sign-off',
            default_duration_days=4,
            max_duration_days=5,
        )
        request_row = self.create_request(
            policy_key='finance-bridge',
            duration_days=4,
            ticket_ref='FIN-1001',
            stage_two_approver_user_id=self.stage_two_approver_user.id,
        )

        self.assertEqual(request_row['current_stage'], 1)
        self.assertEqual(request_row['total_stages'], 2)
        self.assertEqual(request_row['stage_two_approver']['id'], self.stage_two_approver_user.id)
        self.assertEqual(Task.objects.filter(source_key=f"access-exception-approval-{request_row['key']}-s1").count(), 1)
        self.assertTrue(
            ApprovalHistory.objects.filter(
                entity_type='UserAccessExceptionRequest',
                entity_code=request_row['key'],
                action='SUBMIT',
                level=1,
            ).exists()
        )

        self.login(self.approver_user)
        stage_one_response = self.client.post(
            '/api/users/access_exception_decide/',
            {
                'request_key': request_row['key'],
                'decision': 'approve',
                'note': 'Finance controller da review.',
            },
            format='json',
        )
        self.assertEqual(stage_one_response.status_code, 200, stage_one_response.content)
        stage_one_body = stage_one_response.json()
        self.assertEqual(stage_one_body['action'], 'UPDATE')
        self.assertEqual(stage_one_body['request']['lifecycle_state'], 'pending')
        self.assertEqual(stage_one_body['request']['current_stage'], 2)
        self.assertEqual(stage_one_body['request']['active_approver']['id'], self.stage_two_approver_user.id)
        self.assertEqual(Task.objects.filter(source_key=f"access-exception-approval-{request_row['key']}-s2").count(), 1)

        self.target_user.refresh_from_db()
        self.assertNotIn(self.exception_role.id, list(self.target_user.roles.values_list('id', flat=True)))
        self.assertNotIn(self.exception_team.id, list(self.target_user.teams.values_list('id', flat=True)))
        self.assertTrue(
            ApprovalHistory.objects.filter(
                entity_type='UserAccessExceptionRequest',
                entity_code=request_row['key'],
                action='APPROVE',
                level=1,
            ).exists()
        )

        self.login(self.stage_two_approver_user)
        stage_two_response = self.client.post(
            '/api/users/access_exception_decide/',
            {
                'request_key': request_row['key'],
                'decision': 'approve',
                'note': 'Governance da chot cap exception.',
            },
            format='json',
        )
        self.assertEqual(stage_two_response.status_code, 200, stage_two_response.content)
        stage_two_body = stage_two_response.json()
        self.assertEqual(stage_two_body['action'], 'APPROVE')
        self.assertEqual(stage_two_body['request']['lifecycle_state'], 'active')

        self.target_user.refresh_from_db()
        self.assertIn(self.exception_role.id, list(self.target_user.roles.values_list('id', flat=True)))
        self.assertIn(self.exception_team.id, list(self.target_user.teams.values_list('id', flat=True)))
        self.assertTrue(
            ApprovalHistory.objects.filter(
                entity_type='UserAccessExceptionRequest',
                entity_code=request_row['key'],
                action='APPROVE',
                level=2,
            ).exists()
        )

    def test_multi_stage_reject_keeps_access_at_baseline(self):
        self.login(self.manager_user)
        self.create_policy(
            key='cross-team-bridge-review',
            name='Cross team bridge review',
            description='Two-stage bridge access request.',
            approval_stage_count=2,
            approval_sla_hours=12,
            stage_one_label='Functional manager review',
            stage_two_label='Platform steward review',
            default_duration_days=3,
            max_duration_days=6,
        )
        request_row = self.create_request(
            policy_key='cross-team-bridge-review',
            duration_days=3,
            ticket_ref='OPS-2201',
            stage_two_approver_user_id=self.stage_two_approver_user.id,
        )

        self.login(self.approver_user)
        stage_one_response = self.client.post(
            '/api/users/access_exception_decide/',
            {
                'request_key': request_row['key'],
                'decision': 'approve',
                'note': 'Manager da dong y tiep tuc review.',
            },
            format='json',
        )
        self.assertEqual(stage_one_response.status_code, 200, stage_one_response.content)

        self.login(self.stage_two_approver_user)
        reject_response = self.client.post(
            '/api/users/access_exception_decide/',
            {
                'request_key': request_row['key'],
                'decision': 'reject',
                'note': 'Governance khong dong y do blast radius qua rong.',
            },
            format='json',
        )
        self.assertEqual(reject_response.status_code, 200, reject_response.content)
        reject_body = reject_response.json()
        self.assertEqual(reject_body['request']['lifecycle_state'], 'rejected')

        self.target_user.refresh_from_db()
        target_role_ids = list(self.target_user.roles.values_list('id', flat=True))
        target_team_ids = list(self.target_user.teams.values_list('id', flat=True))
        self.assertIn(self.base_role.id, target_role_ids)
        self.assertIn(self.base_team.id, target_team_ids)
        self.assertNotIn(self.exception_role.id, target_role_ids)
        self.assertNotIn(self.exception_team.id, target_team_ids)
        self.assertTrue(
            ApprovalHistory.objects.filter(
                entity_type='UserAccessExceptionRequest',
                entity_code=request_row['key'],
                action='REJECT',
                level=2,
            ).exists()
        )

    def test_revoke_request_removes_only_granted_access_and_keeps_baseline(self):
        self.login(self.manager_user)
        self.create_policy()
        request_row = self.create_request()

        self.login(self.approver_user)
        approve_response = self.client.post(
            '/api/users/access_exception_decide/',
            {
                'request_key': request_row['key'],
                'decision': 'approve',
                'note': 'Approved for short-lived exception.',
            },
            format='json',
        )
        self.assertEqual(approve_response.status_code, 200, approve_response.content)

        revoke_response = self.client.post(
            '/api/users/access_exception_revoke/',
            {
                'request_key': request_row['key'],
                'note': 'Window closed after recovery.',
            },
            format='json',
        )
        self.assertEqual(revoke_response.status_code, 200, revoke_response.content)
        revoke_body = revoke_response.json()
        self.assertTrue(revoke_body['success'])
        self.assertEqual(revoke_body['request']['lifecycle_state'], 'revoked')

        self.target_user.refresh_from_db()
        target_role_ids = list(self.target_user.roles.values_list('id', flat=True))
        target_team_ids = list(self.target_user.teams.values_list('id', flat=True))
        self.assertIn(self.base_role.id, target_role_ids)
        self.assertIn(self.base_team.id, target_team_ids)
        self.assertNotIn(self.exception_role.id, target_role_ids)
        self.assertNotIn(self.exception_team.id, target_team_ids)
        self.assertTrue(
            AuditLog.objects.filter(
                entity_type='UserAccessExceptionRequest',
                action='REVOKE',
                entity_id_str=request_row['key'],
            ).exists()
        )

    def test_preview_without_manual_approvers_returns_delegated_routing_recommendation(self):
        self.login(self.manager_user)
        self.target_user.teams.add(self.finance_team)
        self.create_policy(
            key='finance-auto-route',
            pack_key='finance-sensitive',
            name='Finance auto route',
            description='Critical finance exception with delegated routing.',
            risk_level='critical',
            approval_stage_count=2,
            approval_sla_hours=8,
            stage_one_label='Finance control review',
            stage_two_label='Governance sign-off',
            default_duration_days=2,
            max_duration_days=5,
        )

        preview_response = self.client.post(
            '/api/users/access_exception_preview/',
            {
                'policy_key': 'finance-auto-route',
                'user_id': self.target_user.id,
                'duration_days': 2,
                'justification': 'Need temporary finance access for month-end reconciliation.',
                'ticket_ref': 'FIN-ROUTE-01',
            },
            format='json',
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.content)
        preview_body = preview_response.json()

        self.assertEqual(preview_body['approver']['id'], self.approver_user.id)
        self.assertEqual(preview_body['stage_two_approver']['id'], self.stage_two_approver_user.id)
        self.assertEqual(preview_body['routing_recommendation']['department_label'], 'Finance')
        self.assertTrue(preview_body['routing_recommendation']['auto_selected_stage_one'])
        self.assertTrue(preview_body['routing_recommendation']['auto_selected_stage_two'])
        self.assertTrue(
            any(team['code'] == self.finance_team.code for team in preview_body['routing_recommendation']['target_teams'])
        )

    def test_create_request_without_manual_approvers_auto_routes_and_persists_routing_metadata(self):
        self.login(self.manager_user)
        self.target_user.teams.add(self.finance_team)
        self.create_policy(
            key='finance-auto-route-create',
            pack_key='finance-sensitive',
            name='Finance auto route create',
            description='Critical finance exception with delegated routing on submit.',
            risk_level='critical',
            approval_stage_count=2,
            approval_sla_hours=8,
            stage_one_label='Finance control review',
            stage_two_label='Governance sign-off',
            default_duration_days=2,
            max_duration_days=5,
        )

        create_response = self.client.post(
            '/api/users/access_exception_requests/',
            {
                'policy_key': 'finance-auto-route-create',
                'user_id': self.target_user.id,
                'duration_days': 2,
                'justification': 'Need temporary finance exception for controlled reconciliation window.',
                'ticket_ref': 'FIN-ROUTE-02',
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        request_row = create_response.json()['request']

        self.assertEqual(request_row['approver']['id'], self.approver_user.id)
        self.assertEqual(request_row['stage_two_approver']['id'], self.stage_two_approver_user.id)
        self.assertEqual(request_row['routing']['department_label'], 'Finance')
        self.assertTrue(request_row['routing']['auto_selected_stage_one'])
        self.assertTrue(request_row['routing']['auto_selected_stage_two'])
        self.assertIn(self.finance_team.code, request_row['routing']['target_team_codes'])
        self.assertEqual(Task.objects.filter(source_key=f"access-exception-approval-{request_row['key']}-s1").count(), 1)

    def test_routing_directory_rule_overrides_team_matching_for_preview_and_submit(self):
        self.login(self.manager_user)
        self.target_user.teams.add(self.finance_team)
        self.create_policy(
            key='finance-directory-priority',
            pack_key='finance-sensitive',
            name='Finance directory priority',
            description='Use routing directory before team matching.',
            risk_level='critical',
            approval_stage_count=2,
            approval_sla_hours=8,
            stage_one_label='Finance control review',
            stage_two_label='Governance sign-off',
            default_duration_days=2,
            max_duration_days=5,
        )

        routing_response = self.client.post(
            '/api/users/access_exception_routing_rules/',
            {
                'department_key': 'finance',
                'department_label': 'Finance',
                'is_active': True,
                'stage_one_mode': 'directory_then_team',
                'stage_two_mode': 'directory_then_independent',
                'stage_one_primary_user_id': self.directory_owner_user.id,
                'stage_two_primary_user_id': self.directory_stage_two_user.id,
                'fallback_team_tokens': ['FINANCE', 'CONTROL'],
                'notes': 'Finance owners are explicitly delegated via routing directory.',
            },
            format='json',
        )
        self.assertEqual(routing_response.status_code, 200, routing_response.content)
        routing_body = routing_response.json()
        self.assertEqual(routing_body['rule']['stage_one_primary_approver']['id'], self.directory_owner_user.id)
        self.assertEqual(routing_body['rule']['stage_two_primary_approver']['id'], self.directory_stage_two_user.id)

        preview_response = self.client.post(
            '/api/users/access_exception_preview/',
            {
                'policy_key': 'finance-directory-priority',
                'user_id': self.target_user.id,
                'duration_days': 2,
                'justification': 'Need routing directory override for finance control.',
                'ticket_ref': 'FIN-DIR-01',
            },
            format='json',
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.content)
        preview_body = preview_response.json()
        self.assertEqual(preview_body['approver']['id'], self.directory_owner_user.id)
        self.assertEqual(preview_body['stage_two_approver']['id'], self.directory_stage_two_user.id)
        self.assertEqual(preview_body['routing_recommendation']['selected_stage_one_source'], 'directory')
        self.assertEqual(preview_body['routing_recommendation']['selected_stage_two_source'], 'directory')

        create_response = self.client.post(
            '/api/users/access_exception_requests/',
            {
                'policy_key': 'finance-directory-priority',
                'user_id': self.target_user.id,
                'duration_days': 2,
                'justification': 'Need routing directory override for finance control submit.',
                'ticket_ref': 'FIN-DIR-02',
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        request_row = create_response.json()['request']
        self.assertEqual(request_row['approver']['id'], self.directory_owner_user.id)
        self.assertEqual(request_row['stage_two_approver']['id'], self.directory_stage_two_user.id)
        self.assertEqual(request_row['routing']['stage_one_source'], 'directory')
        self.assertEqual(request_row['routing']['stage_two_source'], 'directory')

    def test_workspace_returns_routing_coverage_and_sla_radar(self):
        self.login(self.manager_user)
        self.target_user.teams.add(self.finance_team)
        self.create_policy(
            key='finance-sla-radar',
            pack_key='finance-sensitive',
            name='Finance SLA radar',
            description='Critical finance exception for coverage analytics.',
            risk_level='critical',
            approval_stage_count=2,
            approval_sla_hours=1,
            stage_one_label='Finance control review',
            stage_two_label='Governance sign-off',
            default_duration_days=2,
            max_duration_days=5,
        )

        request_row = self.create_request(
            policy_key='finance-sla-radar',
            duration_days=2,
            justification='Need finance exception that should appear in the SLA radar.',
            ticket_ref='FIN-SLA-01',
            approver_user_id=None,
            stage_two_approver_user_id=None,
        )
        self.patch_request_storage(
            request_row['key'],
            approval_stage_due_at=(timezone.now() + timedelta(minutes=30)).isoformat(),
        )

        workspace_response = self.client.get('/api/users/access_exception_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()

        finance_coverage = next(item for item in workspace_body['routing_coverage'] if item['department_key'] == 'finance')
        self.assertEqual(finance_coverage['pending_request_count'], 1)
        self.assertGreaterEqual(finance_coverage['near_sla_request_count'], 1)
        self.assertGreaterEqual(finance_coverage['fallback_request_count'], 1)
        self.assertFalse(finance_coverage['stage_one_ready'])
        self.assertFalse(finance_coverage['stage_two_ready'])
        self.assertGreaterEqual(workspace_body['routing_coverage_summary']['coverage_gaps'], 1)
        self.assertGreaterEqual(workspace_body['sla_radar']['summary']['warnings_due'], 1)
        self.assertTrue(any(item['request_key'] == request_row['key'] for item in workspace_body['sla_radar']['items']))
        self.assertTrue(any(item['lifecycle_state'] == 'coverage-gap' for item in workspace_body['watchlist']))

    def test_workspace_returns_approver_capacity_and_workload_recommendations(self):
        self.login(self.manager_user)
        self.target_user.teams.add(self.finance_team)
        self.create_policy(
            key='finance-capacity-balance',
            pack_key='finance-sensitive',
            name='Finance capacity balance',
            description='Finance queue used to verify approver capacity analytics.',
            risk_level='elevated',
            approval_stage_count=1,
            approval_sla_hours=8,
            stage_one_label='Finance owner review',
            default_duration_days=2,
            max_duration_days=5,
        )
        routing_response = self.client.post(
            '/api/users/access_exception_routing_rules/',
            {
                'department_key': 'finance',
                'department_label': 'Finance',
                'is_active': True,
                'stage_one_mode': 'directory_then_team',
                'stage_two_mode': '',
                'stage_one_primary_user_id': self.approver_user.id,
                'fallback_team_tokens': ['FINANCE'],
                'notes': 'Finance queue is currently single-threaded for capacity planning test.',
            },
            format='json',
        )
        self.assertEqual(routing_response.status_code, 200, routing_response.content)

        target_users = [self.target_user]
        for offset in range(2):
            extra_user = User.objects.create_user(
                username=f'access_exception_capacity_target_{offset}',
                password=self.password,
                email=f'access_exception_capacity_target_{offset}@example.com',
                first_name='Capacity',
                last_name=f'Target{offset}',
            )
            extra_user.roles.add(self.base_role)
            extra_user.teams.add(self.base_team, self.finance_team)
            target_users.append(extra_user)

        for offset, target_user in enumerate(target_users):
            request_response = self.client.post(
                '/api/users/access_exception_requests/',
                {
                    'policy_key': 'finance-capacity-balance',
                    'user_id': target_user.id,
                    'duration_days': 2,
                    'justification': f'Need finance exception window #{offset + 1} for workload balancing.',
                    'ticket_ref': f'FIN-CAP-{offset + 1:02d}',
                },
                format='json',
            )
            self.assertEqual(request_response.status_code, 201, request_response.content)

        workspace_response = self.client.get('/api/users/access_exception_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()

        self.assertGreaterEqual(workspace_body['approver_capacity_summary']['at_risk_approvers'], 1)
        approver_row = next(item for item in workspace_body['approver_capacity'] if item['approver']['id'] == self.approver_user.id)
        self.assertEqual(approver_row['pending_request_count'], 3)
        self.assertEqual(approver_row['status'], 'warning')
        self.assertIn('Finance', approver_row['single_threaded_departments'])

        recommendation = next(item for item in workspace_body['workload_recommendations'] if item['department_key'] == 'finance' and item['kind'] == 'add-delegate')
        self.assertEqual(recommendation['current_owner']['id'], self.approver_user.id)
        self.assertEqual(recommendation['recommended_delegate_approver']['id'], self.stage_two_approver_user.id)

    def test_out_of_office_rotation_routes_request_to_rotation_coverage(self):
        self.login(self.manager_user)
        self.target_user.teams.add(self.finance_team)
        self.create_policy(
            key='finance-rotation-coverage',
            pack_key='finance-sensitive',
            name='Finance rotation coverage',
            description='Verify OOO routing falls forward into rotation coverage.',
            risk_level='critical',
            approval_stage_count=1,
            approval_sla_hours=8,
            stage_one_label='Finance owner review',
            default_duration_days=2,
            max_duration_days=5,
        )
        routing_response = self.client.post(
            '/api/users/access_exception_routing_rules/',
            {
                'department_key': 'finance',
                'department_label': 'Finance',
                'is_active': True,
                'stage_one_mode': 'directory_then_team',
                'stage_two_mode': '',
                'stage_one_primary_user_id': self.approver_user.id,
                'stage_one_rotation_user_ids': [self.directory_owner_user.id, self.stage_two_approver_user.id],
                'fallback_team_tokens': ['FINANCE'],
                'notes': 'Finance owner rotates when primary approver is unavailable.',
            },
            format='json',
        )
        self.assertEqual(routing_response.status_code, 200, routing_response.content)
        self.save_approver_availability(user_id=self.approver_user.id, backup_user_id=None, label='OOO - month end leave')

        preview_response = self.client.post(
            '/api/users/access_exception_preview/',
            {
                'policy_key': 'finance-rotation-coverage',
                'user_id': self.target_user.id,
                'duration_days': 2,
                'justification': 'Need finance coverage while the primary approver is on leave.',
                'ticket_ref': 'FIN-ROT-01',
            },
            format='json',
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.content)
        preview_body = preview_response.json()
        self.assertEqual(preview_body['approver']['id'], self.directory_owner_user.id)
        self.assertEqual(preview_body['routing_recommendation']['selected_stage_one_resolution_kind'], 'rotation')
        self.assertTrue(any('ooo' in item.lower() for item in preview_body['routing_recommendation']['warnings']))

        create_response = self.client.post(
            '/api/users/access_exception_requests/',
            {
                'policy_key': 'finance-rotation-coverage',
                'user_id': self.target_user.id,
                'duration_days': 2,
                'justification': 'Need finance coverage while the primary approver is on leave.',
                'ticket_ref': 'FIN-ROT-02',
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        request_row = create_response.json()['request']
        self.assertEqual(request_row['active_approver']['id'], self.directory_owner_user.id)
        self.assertEqual(request_row['routing']['stage_one_resolution_kind'], 'rotation')
        self.assertEqual(request_row['routing']['stage_one_resolution_label'], 'Rotation coverage')

    def test_workspace_returns_continuity_runbook_and_reroute_updates_pending_request(self):
        self.login(self.manager_user)
        self.target_user.teams.add(self.finance_team)
        self.create_policy(
            key='finance-continuity-reroute',
            pack_key='finance-sensitive',
            name='Finance continuity reroute',
            description='Verify continuity runbook and reroute action.',
            risk_level='critical',
            approval_stage_count=1,
            approval_sla_hours=8,
            stage_one_label='Finance owner review',
            default_duration_days=2,
            max_duration_days=5,
        )
        routing_response = self.client.post(
            '/api/users/access_exception_routing_rules/',
            {
                'department_key': 'finance',
                'department_label': 'Finance',
                'is_active': True,
                'stage_one_mode': 'directory_then_team',
                'stage_two_mode': '',
                'stage_one_primary_user_id': self.approver_user.id,
                'stage_one_delegate_user_id': self.directory_owner_user.id,
                'fallback_team_tokens': ['FINANCE'],
                'notes': 'Finance continuity should use delegate when primary approver is OOO.',
            },
            format='json',
        )
        self.assertEqual(routing_response.status_code, 200, routing_response.content)

        request_row = self.create_request(
            policy_key='finance-continuity-reroute',
            approver_user_id=self.approver_user.id,
            duration_days=2,
            justification='Need continuity reroute test request.',
            ticket_ref='FIN-CONT-01',
        )
        self.save_approver_availability(
            user_id=self.approver_user.id,
            backup_user_id=self.directory_owner_user.id,
            label='OOO - conference',
        )

        workspace_response = self.client.get('/api/users/access_exception_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()

        self.assertGreaterEqual(workspace_body['approver_availability_summary']['out_of_office_approvers'], 1)
        finance_availability = next(item for item in workspace_body['approver_availability'] if item['user_id'] == self.approver_user.id)
        self.assertTrue(finance_availability['is_currently_out_of_office'])
        self.assertEqual(finance_availability['coverage_status'], 'covered')

        continuity_row = next(item for item in workspace_body['continuity_runbook'] if item['request_key'] == request_row['key'])
        self.assertEqual(continuity_row['status'], 'ready-to-reroute')
        self.assertEqual(continuity_row['suggested_approver']['id'], self.directory_owner_user.id)

        reroute_response = self.client.post(
            '/api/users/access_exception_reroute/',
            {
                'request_key': request_row['key'],
                'note': 'Primary approver is OOO, reroute to department delegate.',
            },
            format='json',
        )
        self.assertEqual(reroute_response.status_code, 200, reroute_response.content)
        reroute_body = reroute_response.json()
        self.assertEqual(reroute_body['request']['active_approver']['id'], self.directory_owner_user.id)
        self.assertEqual(reroute_body['request']['continuity']['reroute_count'], 1)
        self.assertEqual(reroute_body['request']['continuity']['last_reroute_from_approver']['id'], self.approver_user.id)

        approval_task = Task.objects.get(source_key=f"access-exception-approval-{request_row['key']}-s1")
        self.assertEqual(approval_task.assigned_to_id, self.directory_owner_user.id)
        self.assertTrue(
            AuditLog.objects.filter(
                entity_type='UserAccessExceptionRequest',
                action='UPDATE',
                entity_id_str=request_row['key'],
                changed_fields__contains=['active_approver_user_id'],
            ).exists()
        )

    def test_workspace_exposes_continuity_analytics_and_absence_simulation_playbooks(self):
        self.login(self.manager_user)
        self.target_user.teams.add(self.finance_team)
        self.create_policy(
            key='finance-continuity-analytics',
            pack_key='finance-sensitive',
            name='Finance continuity analytics',
            description='Verify continuity analytics and absence simulation playbooks.',
            risk_level='critical',
            approval_stage_count=1,
            approval_sla_hours=8,
            stage_one_label='Finance owner review',
            default_duration_days=2,
            max_duration_days=5,
        )
        routing_response = self.client.post(
            '/api/users/access_exception_routing_rules/',
            {
                'department_key': 'finance',
                'department_label': 'Finance',
                'is_active': True,
                'stage_one_mode': 'directory_then_team',
                'stage_two_mode': '',
                'stage_one_primary_user_id': self.approver_user.id,
                'stage_one_delegate_user_id': self.directory_owner_user.id,
                'fallback_team_tokens': ['FINANCE'],
                'notes': 'Finance continuity analytics test.',
            },
            format='json',
        )
        self.assertEqual(routing_response.status_code, 200, routing_response.content)

        request_row = self.create_request(
            policy_key='finance-continuity-analytics',
            approver_user_id=self.approver_user.id,
            duration_days=2,
            justification='Need continuity analytics request.',
            ticket_ref='FIN-ANL-01',
        )

        workspace_response = self.client.get('/api/users/access_exception_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()

        self.assertGreaterEqual(workspace_body['summary']['continuity_drills_due'], 1)
        self.assertGreaterEqual(workspace_body['continuity_analytics_summary']['departments_due'], 1)
        finance_row = next(item for item in workspace_body['continuity_analytics'] if item['department_key'] == 'finance')
        self.assertEqual(finance_row['drill_status'], 'due')
        self.assertGreaterEqual(finance_row['pending_request_count'], 1)

        simulation_response = self.client.post(
            '/api/users/access_exception_absence_simulation/',
            {
                'approver_user_ids': [self.approver_user.id],
                'duration_hours': 12,
            },
            format='json',
        )
        self.assertEqual(simulation_response.status_code, 200, simulation_response.content)
        simulation_body = simulation_response.json()
        self.assertGreaterEqual(simulation_body['summary']['impacted_requests'], 1)
        self.assertTrue(any(item['request_key'] == request_row['key'] for item in simulation_body['impacted_requests']))
        impacted_row = next(item for item in simulation_body['impacted_requests'] if item['request_key'] == request_row['key'])
        self.assertEqual(impacted_row['status'], 'ready-to-reroute')
        self.assertEqual(impacted_row['suggested_approver']['id'], self.directory_owner_user.id)
        self.assertGreaterEqual(simulation_body['summary']['playbooks_prepared'], 1)
        self.assertTrue(
            AuditLog.objects.filter(
                entity_type='UserAccessExceptionSimulation',
                entity_code='ACCESS_EXCEPTION_ABSENCE_SIMULATION',
            ).exists()
        )

    def test_workspace_exposes_policy_debt_dashboard_and_request_risk_scores(self):
        self.login(self.manager_user)
        self.create_policy(
            key='finance-risk-debt',
            pack_key='finance-sensitive',
            name='Finance risk debt',
            description='Critical exception policy used to verify policy debt analytics.',
            risk_level='critical',
            approval_stage_count=1,
            default_duration_days=2,
            max_duration_days=8,
            requires_approval=False,
            checklist=[],
        )

        request_row = self.create_request(
            policy_key='finance-risk-debt',
            approver_user_id=None,
            duration_days=5,
            justification='Need a high-risk finance exception to validate governance debt scoring.',
            ticket_ref='FIN-DEBT-01',
        )

        workspace_response = self.client.get('/api/users/access_exception_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()

        self.assertGreaterEqual(workspace_body['summary']['high_risk_requests'], 1)
        self.assertGreaterEqual(workspace_body['summary']['policy_debt_critical'], 1)

        policy_row = next(item for item in workspace_body['policies'] if item['key'] == 'finance-risk-debt')
        self.assertEqual(policy_row['debt_status'], 'critical')
        self.assertGreaterEqual(policy_row['debt_score'], 75)
        self.assertGreaterEqual(policy_row['risk_score'], 80)
        self.assertGreaterEqual(policy_row['high_risk_request_count'], 1)
        self.assertTrue(policy_row['debt_reasons'])

        risky_request = next(item for item in workspace_body['requests'] if item['key'] == request_row['key'])
        self.assertEqual(risky_request['risk_band'], 'critical')
        self.assertGreaterEqual(risky_request['risk_score'], 80)
        self.assertTrue(any('approval gate' in reason.lower() for reason in risky_request['risk_reasons']))
        self.assertTrue(any(item['lifecycle_state'] in {'policy-debt', 'high-risk-request'} for item in workspace_body['watchlist']))

    def test_workspace_exposes_guided_remediation_actions(self):
        self.login(self.manager_user)
        self.target_user.teams.add(self.finance_team)
        self.create_policy(
            key='finance-guided-policy',
            pack_key='finance-sensitive',
            name='Finance guided policy',
            description='Critical policy used to verify policy remediation items.',
            risk_level='critical',
            approval_stage_count=1,
            requires_approval=False,
            default_duration_days=2,
            max_duration_days=6,
            checklist=[],
        )
        self.create_policy(
            key='finance-guided-reroute',
            pack_key='finance-sensitive',
            name='Finance guided reroute',
            description='Critical approval policy used to verify request remediation items.',
            risk_level='critical',
            approval_stage_count=1,
            requires_approval=True,
            default_duration_days=2,
            max_duration_days=6,
        )
        routing_response = self.client.post(
            '/api/users/access_exception_routing_rules/',
            {
                'department_key': 'finance',
                'department_label': 'Finance',
                'is_active': True,
                'stage_one_mode': 'directory_then_team',
                'stage_two_mode': '',
                'stage_one_primary_user_id': self.approver_user.id,
                'stage_one_delegate_user_id': self.directory_owner_user.id,
                'fallback_team_tokens': ['FINANCE'],
                'notes': 'Guided remediation continuity coverage.',
            },
            format='json',
        )
        self.assertEqual(routing_response.status_code, 200, routing_response.content)
        request_row = self.create_request(
            policy_key='finance-guided-reroute',
            approver_user_id=self.approver_user.id,
            duration_days=4,
            justification='Need a pending request that should surface in guided remediation.',
            ticket_ref='FIN-GUIDE-01',
        )
        self.save_approver_availability(
            user_id=self.approver_user.id,
            backup_user_id=self.directory_owner_user.id,
            label='OOO - guided remediation',
        )

        workspace_response = self.client.get('/api/users/access_exception_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()

        action_types = {item['action_type'] for item in workspace_body['guided_remediation']}
        self.assertIn('policy_enable_approval', action_types)
        self.assertIn('policy_upgrade_stage_two', action_types)
        self.assertIn('request_reroute', action_types)
        self.assertGreaterEqual(workspace_body['guided_remediation_summary']['total_actions'], 3)
        reroute_item = next(item for item in workspace_body['guided_remediation'] if item['action_type'] == 'request_reroute' and item['request_key'] == request_row['key'])
        self.assertEqual(reroute_item['suggested_approver']['id'], self.directory_owner_user.id)

    def test_guided_remediation_can_update_policy_and_reroute_request(self):
        self.login(self.manager_user)
        self.target_user.teams.add(self.finance_team)
        self.create_policy(
            key='finance-guided-policy-apply',
            pack_key='finance-sensitive',
            name='Finance guided policy apply',
            description='Critical policy used to verify guided policy remediation apply.',
            risk_level='critical',
            approval_stage_count=1,
            requires_approval=False,
            default_duration_days=2,
            max_duration_days=6,
            checklist=[],
        )
        self.create_policy(
            key='finance-guided-reroute-apply',
            pack_key='finance-sensitive',
            name='Finance guided reroute apply',
            description='Critical policy used to verify request reroute remediation apply.',
            risk_level='critical',
            approval_stage_count=1,
            requires_approval=True,
            default_duration_days=2,
            max_duration_days=6,
        )
        self.client.post(
            '/api/users/access_exception_routing_rules/',
            {
                'department_key': 'finance',
                'department_label': 'Finance',
                'is_active': True,
                'stage_one_mode': 'directory_then_team',
                'stage_two_mode': '',
                'stage_one_primary_user_id': self.approver_user.id,
                'stage_one_delegate_user_id': self.directory_owner_user.id,
                'fallback_team_tokens': ['FINANCE'],
                'notes': 'Guided remediation apply routing.',
            },
            format='json',
        )
        request_row = self.create_request(
            policy_key='finance-guided-reroute-apply',
            approver_user_id=self.approver_user.id,
            duration_days=3,
            justification='Need guided remediation reroute test request.',
            ticket_ref='FIN-GUIDE-02',
        )
        self.save_approver_availability(
            user_id=self.approver_user.id,
            backup_user_id=self.directory_owner_user.id,
            label='OOO - guided apply',
        )

        enable_response = self.client.post(
            '/api/users/access_exception_guided_remediation/',
            {
                'action_type': 'policy_enable_approval',
                'policy_key': 'finance-guided-policy-apply',
            },
            format='json',
        )
        self.assertEqual(enable_response.status_code, 200, enable_response.content)
        self.assertTrue(enable_response.json()['policy']['requires_approval'])

        upgrade_response = self.client.post(
            '/api/users/access_exception_guided_remediation/',
            {
                'action_type': 'policy_upgrade_stage_two',
                'policy_key': 'finance-guided-policy-apply',
            },
            format='json',
        )
        self.assertEqual(upgrade_response.status_code, 200, upgrade_response.content)
        self.assertEqual(upgrade_response.json()['policy']['approval_stage_count'], 2)

        reroute_response = self.client.post(
            '/api/users/access_exception_guided_remediation/',
            {
                'action_type': 'request_reroute',
                'request_key': request_row['key'],
            },
            format='json',
        )
        self.assertEqual(reroute_response.status_code, 200, reroute_response.content)
        reroute_body = reroute_response.json()
        self.assertEqual(reroute_body['request']['active_approver']['id'], self.directory_owner_user.id)
        self.assertTrue(
            AuditLog.objects.filter(
                entity_type='UserAccessExceptionRemediation',
                entity_id_str=f"request_reroute:{request_row['key']}",
            ).exists()
        )

    def test_access_exception_activity_returns_reroute_and_revoke_events_with_limit(self):
        self.login(self.manager_user)
        self.target_user.teams.add(self.finance_team)
        self.create_policy(
            key='finance-activity-trail',
            pack_key='finance-sensitive',
            name='Finance activity trail',
            description='Verify activity feed after reroute and revoke actions.',
            risk_level='critical',
            approval_stage_count=1,
            approval_sla_hours=8,
            stage_one_label='Finance owner review',
            default_duration_days=2,
            max_duration_days=6,
        )
        routing_response = self.client.post(
            '/api/users/access_exception_routing_rules/',
            {
                'department_key': 'finance',
                'department_label': 'Finance',
                'is_active': True,
                'stage_one_mode': 'directory_then_team',
                'stage_two_mode': '',
                'stage_one_primary_user_id': self.approver_user.id,
                'stage_one_delegate_user_id': self.directory_owner_user.id,
                'fallback_team_tokens': ['FINANCE'],
                'notes': 'Activity feed reroute coverage.',
            },
            format='json',
        )
        self.assertEqual(routing_response.status_code, 200, routing_response.content)

        reroute_request = self.create_request(
            policy_key='finance-activity-trail',
            approver_user_id=self.approver_user.id,
            duration_days=2,
            justification='Need pending request to verify reroute activity.',
            ticket_ref='FIN-ACT-01',
        )
        self.save_approver_availability(
            user_id=self.approver_user.id,
            backup_user_id=self.directory_owner_user.id,
            label='OOO - activity feed',
        )
        reroute_response = self.client.post(
            '/api/users/access_exception_reroute/',
            {
                'request_key': reroute_request['key'],
                'note': 'Route sang delegate để tránh nghẽn hàng chờ.',
            },
            format='json',
        )
        self.assertEqual(reroute_response.status_code, 200, reroute_response.content)

        self.save_approver_availability(
            user_id=self.approver_user.id,
            is_out_of_office=False,
            backup_user_id=self.directory_owner_user.id,
            label='Back from leave',
        )

        second_target_user = User.objects.create_user(
            username='access_exception_activity_second',
            password=self.password,
            email='access_exception_activity_second@example.com',
            first_name='Second',
            last_name='Target',
        )
        second_target_user.roles.add(self.base_role)
        second_target_user.teams.add(self.base_team, self.finance_team)

        revoke_request = self.create_request(
            policy_key='finance-activity-trail',
            user_id=second_target_user.id,
            approver_user_id=self.approver_user.id,
            duration_days=2,
            justification='Need approved request to verify revoke activity.',
            ticket_ref='FIN-ACT-02',
        )
        self.login(self.approver_user)
        approve_response = self.client.post(
            '/api/users/access_exception_decide/',
            {
                'request_key': revoke_request['key'],
                'decision': 'approve',
                'note': 'Approve để tạo dữ liệu thu hồi.',
            },
            format='json',
        )
        self.assertEqual(approve_response.status_code, 200, approve_response.content)

        self.login(self.manager_user)
        revoke_response = self.client.post(
            '/api/users/access_exception_revoke/',
            {
                'request_key': revoke_request['key'],
                'note': 'Thu hồi ngoại lệ sau khi hoàn tất kiểm tra.',
            },
            format='json',
        )
        self.assertEqual(revoke_response.status_code, 200, revoke_response.content)

        activity_response = self.client.get('/api/users/access_exception_activity/?limit=5')
        self.assertEqual(activity_response.status_code, 200, activity_response.content)
        activity_body = activity_response.json()
        self.assertLessEqual(len(activity_body['items']), 5)
        self.assertTrue(any(item['action'] == 'REVOKE' and 'thu hồi' in item['summary'].lower() for item in activity_body['items']))
        self.assertTrue(any(item['action'] == 'UPDATE' and 'đổi tuyến' in item['summary'].lower() for item in activity_body['items']))

    def test_access_exception_endpoints_require_manage_user_permission(self):
        self.login(self.regular_user)

        workspace_response = self.client.get('/api/users/access_exception_workspace/')
        self.assertEqual(workspace_response.status_code, 403)

        policy_response = self.client.post(
            '/api/users/access_exception_policies/',
            {
                'key': 'regular-attempt',
                'name': 'Regular attempt',
                'role_ids': [self.exception_role.id],
                'team_ids': [self.exception_team.id],
            },
            format='json',
        )
        self.assertEqual(policy_response.status_code, 403)

        request_response = self.client.post(
            '/api/users/access_exception_requests/',
            {
                'policy_key': 'missing-policy',
                'user_id': self.target_user.id,
                'justification': 'Need emergency access.',
            },
            format='json',
        )
        self.assertEqual(request_response.status_code, 403)
