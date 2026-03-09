from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Notification, User
from workforce.models import Employee, PayrollRecord, SalaryAdvanceRecord


class SalaryAdvanceApprovalWorkflowTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='wf_hr_staff', password='pass', is_staff=True, is_active=True)
        self.superuser = User.objects.create_superuser(username='wf_hr_l2', password='pass', email='wf_hr_l2@example.com')
        self.client.force_authenticate(self.user)
        self.employee = Employee.objects.create(
            code='E-SA-01',
            name='Nhan vien ung luong',
            salary_basic=Decimal('10000000'),
            created_by=self.user,
            updated_by=self.user,
        )

    def _create_salary_advance(self, amount: Decimal, month: str = '2026-04') -> SalaryAdvanceRecord:
        return SalaryAdvanceRecord.objects.create(
            employee=self.employee,
            advance_date=date(2026, 4, 10),
            month=month,
            amount=amount,
            reason='Ung luong test',
            approved_by_name='',
            note='',
            status=SalaryAdvanceRecord.STATUS_UNDEDUCTED,
            approval_status=SalaryAdvanceRecord.APPROVAL_DRAFT,
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )

    def test_submit_and_approve_l2_for_large_amount(self):
        row = self._create_salary_advance(Decimal('7000000'))
        submit = self.client.post(f'/api/workforce/salary-advances/{row.id}/submit_approval/', {}, format='json')
        self.assertEqual(submit.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.approval_status, SalaryAdvanceRecord.APPROVAL_PENDING_L1)
        self.assertEqual(row.required_approval_level, 2)

        l1 = self.client.post(f'/api/workforce/salary-advances/{row.id}/approve_level1/', {}, format='json')
        self.assertEqual(l1.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.approval_status, SalaryAdvanceRecord.APPROVAL_PENDING_L2)

        denied_l2 = self.client.post(f'/api/workforce/salary-advances/{row.id}/approve_level2/', {}, format='json')
        self.assertEqual(denied_l2.status_code, 403)

        self.client.force_authenticate(self.superuser)
        ok_l2 = self.client.post(f'/api/workforce/salary-advances/{row.id}/approve_level2/', {}, format='json')
        self.assertEqual(ok_l2.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.approval_status, SalaryAdvanceRecord.APPROVAL_APPROVED)

    def test_reject_workflow(self):
        row = self._create_salary_advance(Decimal('3000000'))
        self.client.post(f'/api/workforce/salary-advances/{row.id}/submit_approval/', {}, format='json')
        reject = self.client.post(
            f'/api/workforce/salary-advances/{row.id}/reject_approval/',
            {'reason': 'Ho so chua day du'},
            format='json',
        )
        self.assertEqual(reject.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.approval_status, SalaryAdvanceRecord.APPROVAL_REJECTED)
        self.assertEqual(row.rejection_reason, 'Ho so chua day du')

    def test_calculate_month_only_deducts_approved_salary_advances(self):
        approved_row = self._create_salary_advance(Decimal('1000000'), month='2026-05')
        pending_row = self._create_salary_advance(Decimal('2000000'), month='2026-05')
        approved_row.approval_status = SalaryAdvanceRecord.APPROVAL_APPROVED
        approved_row.save(update_fields=['approval_status', 'updated_at', 'search_text'])
        pending_row.approval_status = SalaryAdvanceRecord.APPROVAL_PENDING_L1
        pending_row.save(update_fields=['approval_status', 'updated_at', 'search_text'])
        PayrollRecord.objects.create(
            employee=self.employee,
            month='2026-05',
            net_pay=Decimal('9000000'),
            status=PayrollRecord.STATUS_UNLOCKED,
            created_by=self.user,
            updated_by=self.user,
        )
        self.client.post(
            '/api/workforce/payroll-records/calculate_month/',
            {'month': '2026-05', 'overwrite': True},
            format='json',
        )
        approved_row.refresh_from_db()
        pending_row.refresh_from_db()
        self.assertEqual(approved_row.status, SalaryAdvanceRecord.STATUS_DEDUCTED)
        self.assertEqual(pending_row.status, SalaryAdvanceRecord.STATUS_UNDEDUCTED)

    def test_workforce_approval_sla_overview_and_remind(self):
        row = self._create_salary_advance(Decimal('2000000'))
        row.approval_status = SalaryAdvanceRecord.APPROVAL_PENDING_L1
        row.submitted_at = timezone.now() - timedelta(hours=12)
        row.save(update_fields=['approval_status', 'submitted_at', 'updated_at', 'search_text'])
        overview_resp = self.client.get('/api/workforce/salary-advances/approval_sla_overview/')
        self.assertEqual(overview_resp.status_code, 200)
        overview = overview_resp.json()
        self.assertGreaterEqual(int(overview.get('overdue_l1_count') or 0), 1)
        remind_resp = self.client.post('/api/workforce/salary-advances/remind_pending_approvals/', {}, format='json')
        self.assertEqual(remind_resp.status_code, 200)
        payload = remind_resp.json()
        self.assertTrue(payload.get('success'))
        self.assertGreaterEqual(int(payload.get('sent_count') or 0), 1)
        self.assertIn('escalated_count', payload)
        self.assertIn('top_blocked_submitters', overview)
        self.assertTrue(Notification.objects.filter(entity_type='WorkforceSalaryAdvanceApprovalPending').exists())
