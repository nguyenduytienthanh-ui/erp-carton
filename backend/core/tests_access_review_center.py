from django.test import TestCase
from rest_framework.test import APIClient

from core.models import AuditLog, Permission, Role, Team, User


class AccessReviewCenterApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = 'SecurePass123!'

        self.manage_rbac_permission, _ = Permission.objects.get_or_create(
            resource='CORE',
            action='MANAGE_RBAC',
            defaults={'code': 'TEST_CORE_MANAGE_RBAC_ACCESS_REVIEW', 'name': 'Manage RBAC'},
        )

        self.manager_role = Role.objects.create(name='Access Review Manager', code='ACCESS_REVIEW_MANAGER')
        self.manager_role.permissions.add(self.manage_rbac_permission)
        self.ops_role = Role.objects.create(name='Ops Access', code='OPS_ACCESS_REVIEW')
        self.ops_team = Team.objects.create(name='Ops Team Review', code='OPS_TEAM_REVIEW')

        self.manager_user = User.objects.create_user(
            username='access_review_admin',
            password=self.password,
            email='access_review_admin@example.com',
            first_name='Access',
            last_name='Admin',
        )
        self.manager_user.roles.add(self.manager_role)

        self.dormant_user = User.objects.create_user(
            username='dormant_review_user',
            password=self.password,
            email='dormant_review_user@example.com',
            first_name='Dormant',
            last_name='User',
        )
        self.dormant_user.roles.add(self.ops_role)
        self.dormant_user.teams.add(self.ops_team)

        self.privileged_user = User.objects.create_user(
            username='privileged_review_user',
            password=self.password,
            email='privileged_review_user@example.com',
            first_name='Privileged',
            last_name='User',
            is_staff=True,
        )
        self.privileged_user.roles.add(self.ops_role)
        self.privileged_user.teams.add(self.ops_team)

        self.regular_user = User.objects.create_user(
            username='access_review_regular',
            password=self.password,
            email='access_review_regular@example.com',
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

    def create_campaign(self, payload):
        response = self.client.post('/api/users/access_review_campaigns/', payload, format='json')
        self.assertIn(response.status_code, [200, 201], response.content)
        return response.json()['campaign']

    def test_workspace_and_preview_return_campaign_review_targets(self):
        self.login(self.manager_user)
        campaign = self.create_campaign({
            'key': 'dormant-ops-review',
            'name': 'Dormant ops review',
            'description': 'Review dormant ops users before quarter end.',
            'scope': 'dormant',
            'review_action': 'revoke_access',
            'role_ids': [self.ops_role.id],
            'team_ids': [self.ops_team.id],
            'inactivity_days': 30,
            'only_active_users': True,
            'include_locked': False,
            'checklist': ['Validate owner', 'Confirm revoke'],
        })
        self.assertEqual(campaign['matched_user_count'], 2)

        workspace_response = self.client.get('/api/users/access_review_workspace/')
        self.assertEqual(workspace_response.status_code, 200, workspace_response.content)
        workspace_body = workspace_response.json()
        self.assertGreaterEqual(workspace_body['summary']['active_campaigns'], 1)
        self.assertTrue(any(item['key'] == 'dormant-ops-review' for item in workspace_body['campaigns']))

        preview_response = self.client.post(
            '/api/users/access_review_preview/',
            {'campaign_key': 'dormant-ops-review', 'selected_user_ids': [self.dormant_user.id]},
            format='json',
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.content)
        preview_body = preview_response.json()
        self.assertEqual(preview_body['summary']['selected_users'], 1)
        self.assertEqual(preview_body['target_users'][0]['username'], 'dormant_review_user')
        self.assertEqual(preview_body['target_users'][0]['role_count'], 1)

    def test_apply_access_review_revokes_access_and_creates_audits(self):
        self.login(self.manager_user)
        self.create_campaign({
            'key': 'revoke-dormant-ops',
            'name': 'Revoke dormant ops access',
            'scope': 'dormant',
            'review_action': 'revoke_access',
            'role_ids': [self.ops_role.id],
            'team_ids': [self.ops_team.id],
            'inactivity_days': 30,
            'only_active_users': True,
            'include_locked': False,
        })

        response = self.client.post(
            '/api/users/apply_access_review/',
            {
                'campaign_key': 'revoke-dormant-ops',
                'selected_user_ids': [self.dormant_user.id],
                'note': 'Quarterly dormant cleanup',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['summary']['processed_users'], 1)
        self.assertEqual(body['summary']['access_revoked_users'], 1)

        self.dormant_user.refresh_from_db()
        self.assertEqual(self.dormant_user.roles.count(), 0)
        self.assertEqual(self.dormant_user.teams.count(), 0)
        self.assertTrue(AuditLog.objects.filter(entity_type='UserAccessReview', entity_id=self.dormant_user.id).exists())
        self.assertTrue(AuditLog.objects.filter(entity_type='UserAccess', entity_id=self.dormant_user.id).exists())

    def test_destructive_campaign_requires_manual_selection_for_large_scope(self):
        self.login(self.manager_user)
        for index in range(11):
            User.objects.create_user(
                username=f'access_review_bulk_{index}',
                password=self.password,
                email=f'access_review_bulk_{index}@example.com',
                first_name='Bulk',
                last_name=str(index),
            )

        self.create_campaign({
            'key': 'bulk-lock-all-active',
            'name': 'Bulk lock all active',
            'scope': 'all_active',
            'review_action': 'lock_account',
            'only_active_users': True,
            'include_locked': False,
        })

        response = self.client.post(
            '/api/users/apply_access_review/',
            {'campaign_key': 'bulk-lock-all-active'},
            format='json',
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertTrue(response.json()['manual_selection_required'])

    def test_preview_large_destructive_campaign_requires_manual_selection_and_skips_current_user(self):
        self.login(self.manager_user)
        for index in range(11):
            bulk_user = User.objects.create_user(
                username=f'access_review_preview_{index}',
                password=self.password,
                email=f'access_review_preview_{index}@example.com',
                first_name='Preview',
                last_name=str(index),
            )
            bulk_user.roles.add(self.ops_role)
            bulk_user.teams.add(self.ops_team)

        self.create_campaign({
            'key': 'preview-lock-all-active',
            'name': 'Preview lock all active',
            'scope': 'all_active',
            'review_action': 'lock_account',
            'only_active_users': True,
            'include_locked': False,
        })

        response = self.client.post(
            '/api/users/access_review_preview/',
            {'campaign_key': 'preview-lock-all-active'},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body['manual_selection_required'])
        self.assertTrue(any('phạm vi tác động' in warning.lower() for warning in body['warnings']))
        self.assertTrue(any(item['username'] == self.manager_user.username for item in body['skipped_users']))

    def test_access_review_activity_returns_campaign_and_review_entries(self):
        self.login(self.manager_user)
        self.create_campaign({
            'key': 'activity-dormant-review',
            'name': 'Activity dormant review',
            'scope': 'dormant',
            'review_action': 'revoke_access',
            'role_ids': [self.ops_role.id],
            'team_ids': [self.ops_team.id],
            'inactivity_days': 30,
            'only_active_users': True,
            'include_locked': False,
        })

        apply_response = self.client.post(
            '/api/users/apply_access_review/',
            {
                'campaign_key': 'activity-dormant-review',
                'selected_user_ids': [self.dormant_user.id],
                'note': 'Quarterly dormant cleanup',
            },
            format='json',
        )
        self.assertEqual(apply_response.status_code, 200, apply_response.content)

        activity_response = self.client.get('/api/users/access_review_activity/?limit=5')
        self.assertEqual(activity_response.status_code, 200, activity_response.content)
        activity_body = activity_response.json()
        self.assertLessEqual(len(activity_body['items']), 5)
        self.assertTrue(any(item['kind'] == 'campaign' and 'chiến dịch' in item['summary'].lower() for item in activity_body['items']))
        self.assertTrue(any(item['kind'] == 'review' and 'thu hồi quyền' in item['summary'].lower() for item in activity_body['items']))

    def test_apply_access_review_certifies_without_changing_access(self):
        self.login(self.manager_user)
        self.create_campaign({
            'key': 'certify-dormant-ops',
            'name': 'Certify dormant ops access',
            'scope': 'dormant',
            'review_action': 'certify',
            'role_ids': [self.ops_role.id],
            'team_ids': [self.ops_team.id],
            'inactivity_days': 30,
            'only_active_users': True,
            'include_locked': False,
        })

        response = self.client.post(
            '/api/users/apply_access_review/',
            {
                'campaign_key': 'certify-dormant-ops',
                'selected_user_ids': [self.dormant_user.id],
                'note': 'Quarterly certify run',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['summary']['processed_users'], 1)
        self.assertEqual(body['summary']['certified_users'], 1)
        self.assertEqual(body['summary']['access_revoked_users'], 0)
        self.assertEqual(body['summary']['accounts_locked'], 0)

        self.dormant_user.refresh_from_db()
        self.assertFalse(self.dormant_user.is_locked)
        self.assertEqual(self.dormant_user.roles.count(), 1)
        self.assertEqual(self.dormant_user.teams.count(), 1)
        self.assertTrue(AuditLog.objects.filter(entity_type='UserAccessReview', entity_id=self.dormant_user.id).exists())
        self.assertFalse(AuditLog.objects.filter(entity_type='UserAccess', entity_id=self.dormant_user.id).exists())

    def test_apply_access_review_locks_account_and_preserves_access(self):
        self.login(self.manager_user)
        self.create_campaign({
            'key': 'lock-dormant-ops',
            'name': 'Lock dormant ops access',
            'scope': 'dormant',
            'review_action': 'lock_account',
            'role_ids': [self.ops_role.id],
            'team_ids': [self.ops_team.id],
            'inactivity_days': 30,
            'only_active_users': True,
            'include_locked': False,
        })

        response = self.client.post(
            '/api/users/apply_access_review/',
            {
                'campaign_key': 'lock-dormant-ops',
                'selected_user_ids': [self.dormant_user.id],
                'note': 'Lock dormant account after review',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body['success'])
        self.assertEqual(body['summary']['processed_users'], 1)
        self.assertEqual(body['summary']['accounts_locked'], 1)
        self.assertEqual(body['summary']['access_revoked_users'], 0)

        self.dormant_user.refresh_from_db()
        self.assertTrue(self.dormant_user.is_locked)
        self.assertEqual(self.dormant_user.roles.count(), 1)
        self.assertEqual(self.dormant_user.teams.count(), 1)
        self.assertTrue(AuditLog.objects.filter(entity_type='UserAccessReview', entity_id=self.dormant_user.id).exists())

    def test_access_review_endpoints_require_manage_user_permission(self):
        self.login(self.regular_user)

        workspace_response = self.client.get('/api/users/access_review_workspace/')
        self.assertEqual(workspace_response.status_code, 403)

        preview_response = self.client.post(
            '/api/users/access_review_preview/',
            {'campaign_key': 'missing-campaign'},
            format='json',
        )
        self.assertEqual(preview_response.status_code, 403)

        apply_response = self.client.post(
            '/api/users/apply_access_review/',
            {'campaign_key': 'missing-campaign'},
            format='json',
        )
        self.assertEqual(apply_response.status_code, 403)
