from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import ApprovalHistory, AuditLog, Permission, Role, User
from finance.models import AdvanceTransaction, CashAccount
from products.models import Product, ProductUnit
from production.models import ProductionOrder, ProductionOrderStatus
from purchasing.models import PurchaseOrder, PurchaseOrderStatus, PurchaseRequest, PurchaseRequestStatus, Supplier
from workforce.models import Employee, SalaryAdvanceRecord


class AdminObservabilityWorkspaceApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self._ensure_permissions()

        self.ops_role = Role.objects.create(code='OBS_OPS_VIEW', name='Observability Ops')
        self.ops_role.permissions.add(Permission.objects.get(resource='CORE', action='VIEW_OPERATIONS_LOG'))

        self.workflow_role = Role.objects.create(code='OBS_WORKFLOW_VIEW', name='Observability Workflow')
        self.workflow_role.permissions.add(Permission.objects.get(resource='WORKFLOW', action='VIEW'))

        self.rbac_audit_role = Role.objects.create(code='OBS_RBAC_AUDIT', name='Observability RBAC Audit')
        self.rbac_audit_role.permissions.add(Permission.objects.get(resource='CORE', action='VIEW_RBAC_AUDIT'))

        self.finance_role = Role.objects.create(code='OBS_FINANCE_MANAGE', name='Observability Finance')
        self.finance_role.permissions.add(Permission.objects.get(resource='FINANCE', action='MANAGE'))

        self.ops_user = User.objects.create_user(username='obs_ops_user', password='pass')
        self.ops_user.roles.add(self.ops_role)

        self.workflow_user = User.objects.create_user(username='obs_workflow_user', password='pass')
        self.workflow_user.roles.add(self.workflow_role)

        self.rbac_user = User.objects.create_user(username='obs_rbac_user', password='pass')
        self.rbac_user.roles.add(self.rbac_audit_role)

        self.finance_user = User.objects.create_user(username='obs_finance_user', password='pass')
        self.finance_user.roles.add(self.finance_role)

        self.staff_user = User.objects.create_user(username='obs_staff_user', password='pass', is_staff=True)
        self.regular_user = User.objects.create_user(username='obs_regular_user', password='pass')

        self.cash_account = CashAccount.objects.create(
            name='Quỹ quan sát',
            account_type=CashAccount.TYPE_CASH,
            balance=Decimal('100000000'),
            is_active=True,
            created_by=self.staff_user,
            updated_by=self.staff_user,
        )
        self.employee = Employee.objects.create(
            code='OBS-E-01',
            name='Nhân viên quan sát',
            salary_basic=Decimal('12000000'),
            created_by=self.staff_user,
            updated_by=self.staff_user,
        )
        self.unit = ProductUnit.objects.create(code='OBS-U', name='Đơn vị quan sát')
        self.product = Product.objects.create(
            code='OBS-FG-01',
            name='Thành phẩm quan sát',
            unit=self.unit,
            cost_price=Decimal('10000'),
            sale_price=Decimal('15000'),
            min_stock=5,
            status='ACTIVE',
            created_by=self.staff_user,
            updated_by=self.staff_user,
            owner=self.staff_user,
        )
        self.supplier = Supplier.objects.create(
            code='OBS-SUP-01',
            name='Nhà cung cấp quan sát',
            payment_terms_days=15,
            created_by=self.staff_user,
            updated_by=self.staff_user,
        )

    @staticmethod
    def _ensure_permissions():
        for resource, action, code, name in [
            ('CORE', 'VIEW_OPERATIONS_LOG', 'OBS_CORE_VIEW_OPERATIONS_LOG', 'View operations log'),
            ('WORKFLOW', 'VIEW', 'OBS_WORKFLOW_VIEW', 'View workflow'),
            ('CORE', 'VIEW_RBAC_AUDIT', 'OBS_CORE_VIEW_RBAC_AUDIT', 'View RBAC audit'),
            ('FINANCE', 'MANAGE', 'OBS_FINANCE_MANAGE', 'Manage finance'),
            ('WORKFORCE', 'MANAGE', 'OBS_WORKFORCE_MANAGE', 'Manage workforce'),
            ('PURCHASING', 'MANAGE', 'OBS_PURCHASING_MANAGE', 'Manage purchasing'),
            ('PRODUCTION', 'MANAGE', 'OBS_PRODUCTION_MANAGE', 'Manage production'),
        ]:
            Permission.objects.update_or_create(
                resource=resource,
                action=action,
                defaults={
                    'code': code,
                    'name': name,
                },
            )

    def _create_workflow_failure_log(self, actor):
        return AuditLog.objects.create(
            user=actor,
            action='RUN',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['status'],
            old_values={'status': 'SUCCESS'},
            new_values={
                'status': 'FAILED',
                'message': 'Workflow scheduler failed during regression test.',
                'run_mode': 'MANUAL_SIMULATION',
                'duration_ms': 315,
            },
        )

    def _create_rbac_anomaly_logs(self, actor, total=10):
        for index in range(total):
            AuditLog.objects.create(
                user=actor,
                action='UPDATE',
                entity_type='RoleModulePermission',
                entity_id=0,
                entity_id_str='role-module-permissions',
                entity_code=f'ROLE_MODULE_PERMISSIONS_{index}',
                changed_fields=['module_permissions'],
                old_values={'items': []},
                new_values={
                    'items': [{'role_id': index + 1, 'role_code': f'OBS_{index}', 'ops_view': True}],
                },
            )

    def _create_business_flow_fixtures(self, actor):
        now_dt = timezone.now()
        today = timezone.localdate()

        finance_pending = AdvanceTransaction.objects.create(
            code='TA-OBS-L1',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=today - timedelta(days=2),
            recipient_name='Người nhận L1',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('2500000'),
            purpose='Quan sát hàng chờ L1',
            status=AdvanceTransaction.STATUS_OPEN,
            approval_status=AdvanceTransaction.APPROVAL_PENDING_L1,
            required_approval_level=1,
            submitted_at=now_dt - timedelta(hours=20),
            submitted_by=actor,
            is_active=True,
            created_by=actor,
            updated_by=actor,
        )
        finance_old = AdvanceTransaction.objects.create(
            code='TA-OBS-OLD',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=today - timedelta(days=120),
            recipient_name='Người nhận tồn mở',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('5000000'),
            purpose='Quan sát tồn mở',
            status=AdvanceTransaction.STATUS_OPEN,
            approval_status=AdvanceTransaction.APPROVAL_APPROVED,
            required_approval_level=1,
            submitted_at=now_dt - timedelta(days=121),
            submitted_by=actor,
            is_active=True,
            created_by=actor,
            updated_by=actor,
        )
        finance_approved = AdvanceTransaction.objects.create(
            code='TA-OBS-OK',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=today - timedelta(days=4),
            recipient_name='Người nhận đã duyệt',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('4200000'),
            purpose='Quan sát hồ sơ đã duyệt',
            status=AdvanceTransaction.STATUS_OPEN,
            approval_status=AdvanceTransaction.APPROVAL_APPROVED,
            required_approval_level=2,
            submitted_at=now_dt - timedelta(days=3),
            submitted_by=actor,
            approved_level1_at=now_dt - timedelta(days=2, hours=4),
            approved_level1_by=actor,
            approved_level2_at=now_dt - timedelta(days=2),
            approved_level2_by=actor,
            is_active=True,
            created_by=actor,
            updated_by=actor,
        )

        workforce_pending = SalaryAdvanceRecord.objects.create(
            employee=self.employee,
            advance_date=today - timedelta(days=3),
            month=today.strftime('%Y-%m'),
            amount=Decimal('3000000'),
            reason='Quan sát ứng lương',
            approved_by_name='',
            note='',
            status=SalaryAdvanceRecord.STATUS_UNDEDUCTED,
            approval_status=SalaryAdvanceRecord.APPROVAL_PENDING_L1,
            required_approval_level=1,
            submitted_at=now_dt - timedelta(hours=18),
            submitted_by=actor,
            is_active=True,
            created_by=actor,
            updated_by=actor,
        )
        workforce_rejected = SalaryAdvanceRecord.objects.create(
            employee=self.employee,
            advance_date=today - timedelta(days=5),
            month=today.strftime('%Y-%m'),
            amount=Decimal('1800000'),
            reason='Quan sát hồ sơ bị từ chối',
            approved_by_name='',
            note='',
            status=SalaryAdvanceRecord.STATUS_UNDEDUCTED,
            approval_status=SalaryAdvanceRecord.APPROVAL_REJECTED,
            required_approval_level=1,
            submitted_at=now_dt - timedelta(days=4),
            submitted_by=actor,
            rejected_at=now_dt - timedelta(days=1),
            rejected_by=actor,
            rejection_reason='Thiếu chứng từ',
            is_active=True,
            created_by=actor,
            updated_by=actor,
        )

        po_approved = PurchaseOrder.objects.create(
            code='PO-OBS-001',
            order_date=today - timedelta(days=5),
            expected_receipt_date=today - timedelta(days=1),
            supplier=self.supplier,
            status=PurchaseOrderStatus.APPROVED,
            total=Decimal('12000000'),
            created_by=actor,
            updated_by=actor,
            owner=actor,
        )
        po_submitted = PurchaseOrder.objects.create(
            code='PO-OBS-002',
            order_date=today - timedelta(days=2),
            expected_receipt_date=today + timedelta(days=2),
            supplier=self.supplier,
            status=PurchaseOrderStatus.SUBMITTED,
            total=Decimal('8000000'),
            created_by=actor,
            updated_by=actor,
            owner=actor,
        )
        pr_submitted = PurchaseRequest.objects.create(
            code='PR-OBS-001',
            request_date=today - timedelta(days=1),
            status=PurchaseRequestStatus.SUBMITTED,
            requested_by=actor,
            created_by=actor,
            updated_by=actor,
        )

        mo_approved = ProductionOrder.objects.create(
            code='MO-OBS-001',
            order_date=today - timedelta(days=4),
            planned_end_date=today - timedelta(days=1),
            status=ProductionOrderStatus.RELEASED,
            product=self.product,
            planned_qty=Decimal('100'),
            produced_qty=Decimal('25'),
            created_by=actor,
            updated_by=actor,
            owner=actor,
        )
        mo_submitted = ProductionOrder.objects.create(
            code='MO-OBS-002',
            order_date=today - timedelta(days=1),
            planned_end_date=today + timedelta(days=3),
            status=ProductionOrderStatus.SUBMITTED,
            product=self.product,
            planned_qty=Decimal('40'),
            produced_qty=Decimal('0'),
            created_by=actor,
            updated_by=actor,
            owner=actor,
        )
        AuditLog.objects.create(
            user=actor,
            action='UPDATE',
            entity_type='FinanceAdvanceApproval',
            entity_id=finance_pending.id,
            entity_id_str=str(finance_pending.id),
            entity_code=finance_pending.code,
            changed_fields=['approval_status'],
            old_values={'approval_status': 'DRAFT'},
            new_values={'approval_status': AdvanceTransaction.APPROVAL_PENDING_L1},
        )
        AuditLog.objects.create(
            user=actor,
            action='UPDATE',
            entity_type='FinanceAdvanceApproval',
            entity_id=finance_approved.id,
            entity_id_str=str(finance_approved.id),
            entity_code=finance_approved.code,
            changed_fields=['approval_status', 'approved_level2_at'],
            old_values={'approval_status': AdvanceTransaction.APPROVAL_PENDING_L2},
            new_values={
                'approval_status': AdvanceTransaction.APPROVAL_APPROVED,
                'approved_level2_at': finance_approved.approved_level2_at.isoformat(),
            },
        )
        AuditLog.objects.create(
            user=actor,
            action='UPDATE',
            entity_type='WorkforceSalaryAdvanceApproval',
            entity_id=workforce_pending.id,
            entity_id_str=str(workforce_pending.id),
            entity_code=str(workforce_pending.id),
            changed_fields=['approval_status'],
            old_values={'approval_status': 'DRAFT'},
            new_values={'approval_status': SalaryAdvanceRecord.APPROVAL_PENDING_L1},
        )
        AuditLog.objects.create(
            user=actor,
            action='UPDATE',
            entity_type='WorkforceSalaryAdvanceApproval',
            entity_id=workforce_rejected.id,
            entity_id_str=str(workforce_rejected.id),
            entity_code=str(workforce_rejected.id),
            changed_fields=['approval_status', 'rejected_at'],
            old_values={'approval_status': SalaryAdvanceRecord.APPROVAL_PENDING_L1},
            new_values={
                'approval_status': SalaryAdvanceRecord.APPROVAL_REJECTED,
                'rejection_reason': workforce_rejected.rejection_reason,
            },
        )
        ApprovalHistory.objects.create(
            entity_type='PurchaseOrder',
            entity_id=po_submitted.id,
            entity_code=po_submitted.code,
            action='SUBMIT',
            user=actor,
            level=1,
        )
        ApprovalHistory.objects.create(
            entity_type='PurchaseRequest',
            entity_id=pr_submitted.id,
            entity_code=pr_submitted.code,
            action='SUBMIT',
            user=actor,
            level=1,
        )
        ApprovalHistory.objects.create(
            entity_type='PurchaseOrder',
            entity_id=po_approved.id,
            entity_code=po_approved.code,
            action='APPROVE',
            user=actor,
            level=1,
        )
        ApprovalHistory.objects.create(
            entity_type='ProductionOrder',
            entity_id=mo_submitted.id,
            entity_code=mo_submitted.code,
            action='SUBMIT',
            user=actor,
            level=1,
        )
        ApprovalHistory.objects.create(
            entity_type='ProductionOrder',
            entity_id=mo_approved.id,
            entity_code=mo_approved.code,
            action='APPROVE',
            user=actor,
            level=1,
        )

    def test_regular_user_is_forbidden(self):
        self.client.force_authenticate(user=self.regular_user)
        response = self.client.get('/api/users/admin_observability_workspace/')
        self.assertEqual(response.status_code, 403)

    def test_finance_manager_can_access_workspace_with_finance_business_flow_only(self):
        self._create_business_flow_fixtures(self.staff_user)
        self.client.force_authenticate(user=self.finance_user)

        response = self.client.get('/api/users/admin_observability_workspace/')
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertFalse(body['capabilities']['can_view_workflow'])
        self.assertIsNotNone(body['business_flows']['finance'])
        self.assertEqual([item['domain'] for item in body['approval_audit']['domains']], ['finance'])
        self.assertGreaterEqual(len(body['approval_audit']['recent_activity']), 1)
        self.assertGreaterEqual(len(body['approval_audit']['hot_items']), 1)
        self.assertGreaterEqual(len(body['approval_audit']['queue_rows']), 1)
        self.assertEqual(body['approval_audit']['queue_summary']['domain_pending_counts']['finance'], 1)
        self.assertEqual(len(body['approval_audit']['timeline_7d']), 7)
        self.assertIsNotNone(body['approval_audit']['recent_activity'][0]['entity_id'])
        self.assertIsNone(body['business_flows']['workforce'])
        self.assertIsNone(body['business_flows']['purchasing'])
        self.assertIsNone(body['business_flows']['production'])
        self.assertEqual(body['business_flows']['finance']['queue']['pending_l1_count'], 1)
        self.assertEqual(body['business_flows']['finance']['overdue_snapshot_90d']['count'], 1)
        self.assertEqual([item['domain'] for item in body['audit_spotlight']['domains']], ['finance'])
        self.assertTrue(all(item['domain'] == 'finance' for item in body['audit_spotlight']['recent_activity']))

    def test_workflow_viewer_gets_workflow_section_without_sensitive_governance_data(self):
        self._create_workflow_failure_log(self.staff_user)
        self.client.force_authenticate(user=self.workflow_user)

        response = self.client.get('/api/users/admin_observability_workspace/', {
            'hours': 24,
            'incident_limit': 6,
            'activity_limit': 5,
        })
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertTrue(body['capabilities']['can_view_workflow'])
        self.assertFalse(body['capabilities']['can_manage_user_directory'])
        self.assertFalse(body['capabilities']['can_simulate_scheduler_failure'])
        self.assertIsNotNone(body['workflow']['job_status'])
        self.assertEqual(body['workflow']['health']['status_counts']['FAILED'], 1)
        self.assertGreaterEqual(body['workflow']['incidents']['total'], 1)
        self.assertIsNone(body['access_exception']['summary'])
        self.assertEqual(body['access_review']['recent_activity'], [])
        self.assertEqual(body['provisioning']['recent_activity'], [])
        self.assertIsNone(body['governance']['rbac_history_meta'])
        self.assertIsNone(body['business_flows']['finance'])

    def test_rbac_audit_viewer_gets_anomaly_meta_without_workflow_details(self):
        self._create_rbac_anomaly_logs(self.rbac_user, total=10)
        self.client.force_authenticate(user=self.rbac_user)

        response = self.client.get('/api/users/admin_observability_workspace/')
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertFalse(body['capabilities']['can_view_workflow'])
        self.assertTrue(body['capabilities']['can_view_rbac_audit'])
        self.assertIsNone(body['workflow']['job_status'])
        self.assertEqual(body['workflow']['incidents']['total'], 0)
        self.assertIsNotNone(body['governance']['rbac_history_meta'])
        self.assertEqual(body['governance']['rbac_history_meta']['anomalies_24h_count'], 1)

    def test_staff_user_gets_full_workspace_payload_with_business_flows(self):
        self._create_workflow_failure_log(self.staff_user)
        self._create_rbac_anomaly_logs(self.staff_user, total=10)
        self._create_business_flow_fixtures(self.staff_user)
        AuditLog.objects.create(
            user=self.staff_user,
            action='PROVISION',
            entity_type='UserProvisioning',
            entity_id=self.regular_user.id,
            entity_id_str=str(self.regular_user.id),
            entity_code=self.regular_user.username,
            changed_fields=['roles'],
            old_values={},
            new_values={
                'username': self.regular_user.username,
                'full_name': self.regular_user.username,
                'password_mode': 'generated',
                'must_rotate_password': True,
                'role_ids': [],
                'team_ids': [],
                'created_tasks': [],
                'security_task_created': False,
                'preset_key': '',
            },
        )

        self.client.force_authenticate(user=self.staff_user)
        response = self.client.get('/api/users/admin_observability_workspace/', {
            'hours': 24,
            'incident_limit': 10,
            'activity_limit': 8,
        })
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertTrue(body['capabilities']['can_view_workflow'])
        self.assertTrue(body['capabilities']['can_manage_user_directory'])
        self.assertTrue(body['capabilities']['can_simulate_scheduler_failure'])
        self.assertTrue(body['capabilities']['can_view_rbac_audit'])
        self.assertIn('health', body)
        self.assertIn('generated_at', body)
        self.assertIsNotNone(body['workflow']['job_status'])
        self.assertEqual(body['workflow']['health']['status_counts']['FAILED'], 1)
        self.assertIsNotNone(body['access_exception']['summary'])
        self.assertIsNotNone(body['governance']['rbac_history_meta'])
        self.assertGreaterEqual(len(body['provisioning']['recent_activity']), 1)
        self.assertEqual(body['business_flows']['finance']['queue']['pending_l1_count'], 1)
        self.assertEqual(body['business_flows']['finance']['overdue_snapshot_90d']['count'], 1)
        self.assertEqual(body['business_flows']['workforce']['queue']['pending_l1_count'], 1)
        self.assertEqual(body['business_flows']['purchasing']['order_summary']['pending_approval_count'], 1)
        self.assertEqual(body['business_flows']['purchasing']['request_summary']['submitted_count'], 1)
        self.assertEqual(body['business_flows']['production']['order_summary']['pending_approval_count'], 1)
        self.assertEqual(body['business_flows']['production']['order_summary']['overdue_plan_count'], 1)
        self.assertEqual(len(body['approval_audit']['domains']), 4)
        self.assertTrue(any(item['domain'] == 'finance' for item in body['approval_audit']['domains']))
        self.assertTrue(any(item['domain'] == 'purchasing' for item in body['approval_audit']['domains']))
        self.assertGreaterEqual(len(body['approval_audit']['recent_activity']), 4)
        self.assertGreaterEqual(len(body['approval_audit']['hot_items']), 4)
        self.assertGreaterEqual(len(body['approval_audit']['queue_rows']), 5)
        self.assertGreaterEqual(body['approval_audit']['queue_summary']['total_pending'], 5)
        self.assertGreaterEqual(body['approval_audit']['queue_summary']['stale_queue_count'], 1)
        self.assertEqual(len(body['approval_audit']['timeline_7d']), 7)
        self.assertTrue(all('entity_id' in item for item in body['approval_audit']['recent_activity']))
        self.assertGreaterEqual(body['audit_spotlight']['total_events'], 1)
        self.assertTrue(any(item['domain'] == 'workflow' for item in body['audit_spotlight']['domains']))
        self.assertTrue(any(item['domain'] == 'governance' for item in body['audit_spotlight']['domains']))
        self.assertGreaterEqual(len(body['audit_spotlight']['top_actors']), 1)

    def test_admin_audit_workspace_is_forbidden_for_regular_user(self):
        self.client.force_authenticate(user=self.regular_user)
        response = self.client.get('/api/users/admin_audit_workspace/')
        self.assertEqual(response.status_code, 403)

    def test_finance_manager_gets_finance_only_admin_audit_workspace(self):
        self._create_business_flow_fixtures(self.staff_user)
        self.client.force_authenticate(user=self.finance_user)

        response = self.client.get('/api/users/admin_audit_workspace/', {'hours': 48, 'limit': 12})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertEqual([item['domain'] for item in body['domains']], ['finance'])
        self.assertTrue(all(item['domain'] == 'finance' for item in body['recent_activity']))
        self.assertGreaterEqual(body['total_events'], 1)
        self.assertGreaterEqual(len(body['top_actors']), 1)
        self.assertGreaterEqual(len(body['hot_entities']), 1)
        self.assertEqual(len(body['timeline_7d']), 7)

    def test_staff_user_gets_admin_audit_workspace_with_multiple_domains(self):
        self._create_workflow_failure_log(self.staff_user)
        self._create_rbac_anomaly_logs(self.staff_user, total=4)
        self._create_business_flow_fixtures(self.staff_user)
        self.client.force_authenticate(user=self.staff_user)

        response = self.client.get('/api/users/admin_audit_workspace/', {'hours': 48, 'limit': 20})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()

        self.assertTrue(any(item['domain'] == 'finance' for item in body['domains']))
        self.assertTrue(any(item['domain'] == 'workflow' for item in body['domains']))
        self.assertTrue(any(item['domain'] == 'governance' for item in body['domains']))
        self.assertGreaterEqual(body['sensitive_events'], 1)
        self.assertGreaterEqual(body['high_severity_events'], 1)
        self.assertGreaterEqual(len(body['recent_activity']), 3)
        self.assertGreaterEqual(len(body['hot_entities']), 3)
        self.assertEqual(len(body['timeline_7d']), 7)
        self.assertTrue(all('changed_fields' in item for item in body['recent_activity']))
