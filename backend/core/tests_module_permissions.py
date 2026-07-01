from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.test.utils import override_settings
from rest_framework.test import APIClient

from core.models import AuditLog, Notification, Permission, Role, Team, User
from core.permissions import CUSTOMER_PERMISSION_DEFINITIONS, PURCHASING_PERMISSION_DEFINITIONS, SUPPLIER_PERMISSION_DEFINITIONS
from purchasing.models import Supplier


class RoleModulePermissionsApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username='rbac_admin', password='pass')
        self.admin.is_staff = True
        self.admin.save(update_fields=['is_staff'])

        self.normal_user = User.objects.create_user(username='rbac_user', password='pass')

        self._ensure_permissions()
        self.role_admin = Role.objects.create(code='ADMIN', name='Admin')
        self.role_finance = Role.objects.create(code='ACCOUNTANT', name='Accountant')

    @staticmethod
    def _ensure_permissions():
        for resource, action, code, name in [
            ('WORKFORCE', 'MANAGE', 'WORKFORCE_MANAGE', 'Manage Workforce module'),
            ('FINANCE', 'MANAGE', 'FINANCE_MANAGE', 'Manage Finance module'),
            ('PURCHASING', 'MANAGE', 'PURCHASING_MANAGE', 'Manage purchasing module'),
            ('PRODUCTION', 'MANAGE', 'PRODUCTION_MANAGE', 'Manage production module'),
            ('OPS', 'VIEW', 'OPS_VIEW', 'View operations cockpit'),
            ('CORE', 'VIEW_REPORTS', 'CORE_VIEW_REPORTS', 'View reports center'),
            ('WORKFLOW', 'VIEW', 'WORKFLOW_VIEW', 'View workflow boards'),
            ('WORKFLOW', 'MANAGE', 'WORKFLOW_MANAGE', 'Manage workflow templates'),
            ('CORE', 'VIEW_OPERATIONS_LOG', 'CORE_VIEW_OPERATIONS_LOG', 'View operations log'),
            ('CORE', 'VIEW_RBAC_AUDIT', 'CORE_VIEW_RBAC_AUDIT', 'View RBAC audit history'),
            ('CORE', 'MANAGE_RBAC', 'CORE_MANAGE_RBAC', 'Manage RBAC settings'),
            *[
                (row['resource'], row['action'], row['code'], row['name'])
                for row in PURCHASING_PERMISSION_DEFINITIONS
            ],
            *[
                (row['resource'], row['action'], row['code'], row['name'])
                for row in CUSTOMER_PERMISSION_DEFINITIONS
            ],
            *[
                (row['resource'], row['action'], row['code'], row['name'])
                for row in SUPPLIER_PERMISSION_DEFINITIONS
            ],
        ]:
            Permission.objects.update_or_create(
                resource=resource,
                action=action,
                defaults={
                    'code': code,
                    'name': name,
                },
            )

    def test_get_module_permissions_forbidden_for_normal_user(self):
        self.client.force_authenticate(user=self.normal_user)
        response = self.client.get('/api/roles/module_permissions/')
        self.assertEqual(response.status_code, 403)

    def test_update_module_permissions_creates_audit_log(self):
        self.client.force_authenticate(user=self.admin)
        payload = {
            'items': [
                {
                    'role_id': self.role_admin.id,
                    'workforce_manage': True,
                    'finance_manage': True,
                    'rbac_manage': True,
                },
                {
                    'role_id': self.role_finance.id,
                    'workforce_manage': False,
                    'finance_manage': True,
                    'rbac_manage': False,
                },
            ]
        }
        response = self.client.post('/api/roles/module_permissions/', payload, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get('success'))

        audit = AuditLog.objects.filter(entity_type='RoleModulePermission').first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.action, 'UPDATE')

    def test_update_module_permissions_requires_at_least_one_active_rbac_role(self):
        self.client.force_authenticate(user=self.admin)
        payload = {
            'items': [
                {
                    'role_id': self.role_admin.id,
                    'workforce_manage': True,
                    'finance_manage': True,
                    'rbac_manage': False,
                },
                {
                    'role_id': self.role_finance.id,
                    'workforce_manage': False,
                    'finance_manage': True,
                    'rbac_manage': False,
                },
            ]
        }
        response = self.client.post('/api/roles/module_permissions/', payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('ít nhất 1 vai trò', response.json().get('error', ''))

    def test_module_permissions_history_returns_audit_entries(self):
        self.client.force_authenticate(user=self.admin)
        AuditLog.objects.create(
            user=self.admin,
            action='UPDATE',
            entity_type='RoleModulePermission',
            entity_id=0,
            entity_id_str='role-module-permissions',
            entity_code='ROLE_MODULE_PERMISSIONS',
            old_values={'items': []},
            new_values={'items': [{'role_id': self.role_admin.id}]},
            changed_fields=['module_permissions'],
        )
        response = self.client.get('/api/roles/module_permissions_history/', {'page_size': 10})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertGreaterEqual(body.get('count', 0), 1)
        self.assertTrue(body.get('results'))

    def test_module_permissions_history_supports_role_filter_and_excel_export(self):
        self.client.force_authenticate(user=self.admin)
        AuditLog.objects.create(
            user=self.admin,
            action='UPDATE',
            entity_type='RoleModulePermission',
            entity_id=0,
            entity_id_str='role-module-permissions',
            entity_code='ROLE_MODULE_PERMISSIONS',
            old_values={'items': [{'role_id': self.role_admin.id, 'role_code': 'ADMIN', 'workforce_manage': False}]},
            new_values={'items': [{'role_id': self.role_admin.id, 'role_code': 'ADMIN', 'workforce_manage': True}]},
            changed_fields=['module_permissions'],
        )
        list_res = self.client.get(
            '/api/roles/module_permissions_history/',
            {'role_code': 'ADMIN', 'changed_type': 'workforce', 'page_size': 10},
        )
        self.assertEqual(list_res.status_code, 200)
        self.assertGreaterEqual(list_res.json().get('count', 0), 1)

        export_res = self.client.get(
            '/api/roles/module_permissions_history/',
            {'role_code': 'ADMIN', 'changed_type': 'workforce', 'export': 'excel'},
        )
        self.assertEqual(export_res.status_code, 200)
        self.assertIn(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            export_res.get('Content-Type', ''),
        )

    def test_module_permissions_history_summary_contains_trend_and_anomaly_keys(self):
        self.client.force_authenticate(user=self.admin)
        AuditLog.objects.create(
            user=self.admin,
            action='UPDATE',
            entity_type='RoleModulePermission',
            entity_id=0,
            entity_id_str='role-module-permissions',
            entity_code='ROLE_MODULE_PERMISSIONS',
            old_values={'items': []},
            new_values={'items': [{'role_id': self.role_admin.id, 'role_code': 'ADMIN'}]},
            changed_fields=['module_permissions'],
        )
        response = self.client.get('/api/roles/module_permissions_history/', {'page_size': 10})
        self.assertEqual(response.status_code, 200)
        summary = response.json().get('summary', {})
        self.assertIn('trend_12m', summary)
        self.assertIn('anomalies_24h', summary)

    def test_module_permissions_meta_returns_users_and_changed_types(self):
        self.client.force_authenticate(user=self.admin)
        AuditLog.objects.create(
            user=self.admin,
            action='UPDATE',
            entity_type='RoleModulePermission',
            entity_id=0,
            entity_id_str='role-module-permissions',
            entity_code='ROLE_MODULE_PERMISSIONS',
            old_values={'items': []},
            new_values={'items': [{'role_id': self.role_admin.id, 'role_code': 'ADMIN', 'ops_view': True}]},
            changed_fields=['module_permissions'],
        )
        response = self.client.get('/api/roles/module_permissions_history_meta/')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        changed_types = {item['value'] for item in body.get('changed_types', [])}
        self.assertIn('ops', changed_types)
        self.assertTrue(body.get('users'))



    def test_update_module_permissions_creates_realtime_anomaly_notification(self):
        self.client.force_authenticate(user=self.admin)
        receiver = User.objects.create_user(username='rbac_receiver', password='pass')
        receiver.is_staff = True
        receiver.save(update_fields=['is_staff'])

        for _ in range(19):
            AuditLog.objects.create(
                user=self.admin,
                action='UPDATE',
                entity_type='RoleModulePermission',
                entity_id=0,
                entity_id_str='role-module-permissions',
                entity_code='ROLE_MODULE_PERMISSIONS',
                old_values={'items': []},
                new_values={'items': [{'role_id': self.role_admin.id}]},
                changed_fields=['module_permissions'],
            )

        payload = {
            'items': [
                {
                    'role_id': self.role_admin.id,
                    'workforce_manage': True,
                    'finance_manage': True,
                    'rbac_manage': True,
                }
            ]
        }
        response = self.client.post('/api/roles/module_permissions/', payload, format='json')
        self.assertEqual(response.status_code, 200)

        notif = Notification.objects.filter(
            recipient=receiver,
            notification_type='system',
            entity_type='RoleModulePermission',
            actor=self.admin,
            title='Canh bao bat thuong thay doi quyen module',
        ).first()
        self.assertIsNotNone(notif)



    def test_freeze_flow_blocks_update_until_unfreeze(self):
        self.client.force_authenticate(user=self.admin)
        target = User.objects.create_user(username='rbac_target', password='pass')

        rbac_perm = Permission.objects.get(resource='CORE', action='MANAGE_RBAC')
        self.role_admin.permissions.add(rbac_perm)
        target.roles.add(self.role_admin)

        payload = {
            'items': [{'role_id': self.role_admin.id, 'workforce_manage': True, 'finance_manage': True, 'rbac_manage': True}]
        }

        self.client.force_authenticate(user=target)
        before = self.client.post('/api/roles/module_permissions/', payload, format='json')
        self.assertEqual(before.status_code, 200)

        self.client.force_authenticate(user=self.admin)
        prepare = self.client.post(
            '/api/roles/module_permissions_freeze_prepare/',
            {'user_id': target.id, 'hours': 24, 'reason': 'test freeze'},
            format='json',
        )
        self.assertEqual(prepare.status_code, 200)
        token = prepare.json().get('prepare_token')

        apply_res = self.client.post(
            '/api/roles/module_permissions_freeze_apply/',
            {'prepare_token': token, 'confirm_text': 'FREEZE'},
            format='json',
        )
        self.assertEqual(apply_res.status_code, 200)

        self.client.force_authenticate(user=target)
        blocked = self.client.post('/api/roles/module_permissions/', payload, format='json')
        self.assertEqual(blocked.status_code, 403)
        self.assertIn('đóng băng', str(blocked.json().get('error', '')).lower())

        self.client.force_authenticate(user=self.admin)
        unfreeze = self.client.post(
            '/api/roles/module_permissions_unfreeze_actor/',
            {'user_id': target.id, 'confirm_text': 'UNFREEZE'},
            format='json',
        )
        self.assertEqual(unfreeze.status_code, 200)

        self.client.force_authenticate(user=target)
        after = self.client.post('/api/roles/module_permissions/', payload, format='json')
        self.assertEqual(after.status_code, 200)

    def test_module_permissions_freeze_history_returns_rows(self):
        self.client.force_authenticate(user=self.admin)
        target = User.objects.create_user(username='rbac_target_2', password='pass')
        prepare = self.client.post(
            '/api/roles/module_permissions_freeze_prepare/',
            {'user_id': target.id, 'hours': 24},
            format='json',
        )
        token = prepare.json().get('prepare_token')
        self.client.post(
            '/api/roles/module_permissions_freeze_apply/',
            {'prepare_token': token, 'confirm_text': 'FREEZE'},
            format='json',
        )
        history = self.client.get('/api/roles/module_permissions_freeze_history/', {'page_size': 20})
        self.assertEqual(history.status_code, 200)
        body = history.json()
        self.assertGreaterEqual(body.get('count', 0), 1)
        self.assertTrue(body.get('results'))


class SeedSupplierPermissionsCommandTest(TestCase):
    def test_seed_supplier_permissions_creates_rows_without_demo_data(self):
        Permission.objects.filter(resource='SUPPLIER').delete()
        out = StringIO()

        call_command('seed_supplier_permissions', stdout=out)

        permission_keys = set(
            Permission.objects.filter(resource='SUPPLIER').values_list('resource', 'action')
        )
        expected_keys = {
            (row['resource'], row['action'])
            for row in SUPPLIER_PERMISSION_DEFINITIONS
        }
        self.assertEqual(permission_keys, expected_keys)
        self.assertFalse(Role.objects.exists())
        self.assertIn('Supplier permissions synced', out.getvalue())

    def test_seed_supplier_permissions_can_grant_existing_uat_roles(self):
        for code in ('ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER'):
            Role.objects.create(code=code, name=code.replace('_', ' ').title())
        out = StringIO()

        call_command('seed_supplier_permissions', grant_uat_roles=True, stdout=out)

        all_supplier_actions = {
            row['action']
            for row in SUPPLIER_PERMISSION_DEFINITIONS
        }
        admin_actions = set(
            Permission.objects.filter(roles__code='ADMIN', resource='SUPPLIER')
            .values_list('action', flat=True)
        )
        ops_actions = set(
            Permission.objects.filter(roles__code='OPS_MANAGER', resource='SUPPLIER')
            .values_list('action', flat=True)
        )
        self.assertEqual(admin_actions, all_supplier_actions)
        self.assertEqual(ops_actions, {'VIEW', 'CREATE', 'EDIT'})
        self.assertIn('Supplier UAT role grants synced', out.getvalue())


class SeedPurchasingPermissionsCommandTest(TestCase):
    def test_seed_purchasing_permissions_creates_rows_without_demo_data(self):
        Permission.objects.filter(resource='PURCHASING', action='VIEW').delete()
        out = StringIO()

        call_command('seed_purchasing_permissions', stdout=out)

        permission_keys = set(
            Permission.objects.filter(resource='PURCHASING', action='VIEW').values_list('resource', 'action')
        )
        expected_keys = {
            (row['resource'], row['action'])
            for row in PURCHASING_PERMISSION_DEFINITIONS
        }
        self.assertEqual(permission_keys, expected_keys)
        self.assertFalse(Role.objects.exists())
        self.assertIn('Purchasing permissions synced', out.getvalue())

    def test_seed_purchasing_permissions_can_grant_existing_uat_roles(self):
        for code in ('ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER'):
            Role.objects.create(code=code, name=code.replace('_', ' ').title())
        out = StringIO()

        call_command('seed_purchasing_permissions', grant_uat_roles=True, stdout=out)

        granted_role_codes = set(
            Role.objects.filter(permissions__resource='PURCHASING', permissions__action='VIEW')
            .values_list('code', flat=True)
        )
        self.assertEqual(granted_role_codes, {'ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER'})
        self.assertIn('Purchasing UAT role grants synced', out.getvalue())

    @override_settings(APP_ENV='production', DATABASES={'default': {'NAME': 'erp_carton_prod', 'HOST': '127.0.0.1'}})
    def test_seed_purchasing_permissions_refuses_production_target(self):
        with self.assertRaisesMessage(CommandError, 'Refusing Purchasing permission seed'):
            call_command('seed_purchasing_permissions', stdout=StringIO())


class SeedUatRolesOnlyCommandTest(TestCase):
    expected_codes = {'ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'OPS_MANAGER', 'PRODUCT_MANAGER'}

    def test_seed_uat_roles_only_creates_missing_roles_without_demo_data(self):
        out = StringIO()

        call_command('seed_uat_roles_only', stdout=out)

        roles = Role.objects.filter(code__in=self.expected_codes, deleted_at__isnull=True)
        self.assertEqual(set(roles.values_list('code', flat=True)), self.expected_codes)
        self.assertEqual(User.objects.count(), 0)
        self.assertEqual(Team.objects.count(), 0)
        self.assertEqual(Supplier.objects.count(), 0)
        self.assertFalse(Permission.objects.filter(roles__code__in=self.expected_codes).exists())
        self.assertIn('UAT roles synced: 5 created, 0 existing', out.getvalue())

    def test_seed_uat_roles_only_is_idempotent(self):
        call_command('seed_uat_roles_only', stdout=StringIO())
        out = StringIO()

        call_command('seed_uat_roles_only', stdout=out)

        self.assertEqual(Role.objects.filter(code__in=self.expected_codes).count(), 5)
        self.assertIn('UAT roles synced: 0 created, 5 existing', out.getvalue())

    @override_settings(APP_ENV='production')
    def test_seed_uat_roles_only_refuses_production(self):
        with self.assertRaises(CommandError):
            call_command('seed_uat_roles_only', stdout=StringIO())
