from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from core.models import User
from finance.models import CashAccount
from workforce.models import AttendanceRecord, Employee, PayrollRecord, SalaryAdvanceRecord


class WorkforceMonthLockTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='wf_lock_admin', password='pass')
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        self.client.force_authenticate(user=self.user)

        self.employee = Employee.objects.create(
            code='E-LK-01',
            name='Nhan vien khoa ky',
            salary_basic=Decimal('8000000'),
            created_by=self.user,
            updated_by=self.user,
        )
        self.cash_account = CashAccount.objects.create(
            name='Quy payroll lock',
            account_type=CashAccount.TYPE_CASH,
            balance=Decimal('50000000'),
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )

    def _create_close_ready_month(self):
        AttendanceRecord.objects.create(
            employee=self.employee,
            month='2026-03',
            standard_days=Decimal('26'),
            actual_days=Decimal('25'),
            paid_leave=Decimal('1'),
            unpaid_leave=Decimal('0'),
            note='',
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        return PayrollRecord.objects.create(
            employee=self.employee,
            month='2026-03',
            standard_days=Decimal('26'),
            actual_days=Decimal('25'),
            basic_salary=Decimal('8000000'),
            salary_by_attendance=Decimal('7692307.69'),
            overtime_pay=Decimal('0'),
            total_bonus=Decimal('0'),
            total_penalty=Decimal('0'),
            advance_deduction=Decimal('0'),
            total_income=Decimal('7692307.69'),
            total_deductions=Decimal('0'),
            net_pay=Decimal('7692307.69'),
            status=PayrollRecord.STATUS_LOCKED,
            created_by=self.user,
            updated_by=self.user,
        )

    def test_lock_month_blocks_payroll_update(self):
        payroll = self._create_close_ready_month()
        lock_resp = self.client.post('/api/workforce/payroll-records/lock_month/', {'month': '2026-03'}, format='json')
        self.assertEqual(lock_resp.status_code, 200)

        update_resp = self.client.patch(
            f'/api/workforce/payroll-records/{payroll.id}/',
            {'note': 'edited'},
            format='json',
        )
        self.assertEqual(update_resp.status_code, 403)

    def test_lock_month_blocks_calculate_month(self):
        self._create_close_ready_month()
        lock_resp = self.client.post('/api/workforce/payroll-records/lock_month/', {'month': '2026-03'}, format='json')
        self.assertEqual(lock_resp.status_code, 200)

        calculate_resp = self.client.post(
            '/api/workforce/payroll-records/calculate_month/',
            {'month': '2026-03', 'overwrite': True},
            format='json',
        )
        self.assertEqual(calculate_resp.status_code, 400)

    def test_lock_month_blocks_attendance_and_bonus_penalty_changes(self):
        self._create_close_ready_month()
        lock_resp = self.client.post('/api/workforce/payroll-records/lock_month/', {'month': '2026-03'}, format='json')
        self.assertEqual(lock_resp.status_code, 200)

        another_employee = Employee.objects.create(
            code='E-LK-02',
            name='Nhan vien bi chan',
            salary_basic=Decimal('7500000'),
            created_by=self.user,
            updated_by=self.user,
        )

        attendance_resp = self.client.post(
            '/api/workforce/attendance-records/',
            {
                'employee': another_employee.id,
                'month': '2026-03',
                'standard_days': 26,
                'actual_days': 25,
                'paid_leave': 0,
                'unpaid_leave': 0,
                'note': '',
                'is_active': True,
                'overtime_items': [],
            },
            format='json',
        )
        self.assertEqual(attendance_resp.status_code, 403)

        bonus_resp = self.client.post(
            '/api/workforce/bonus-penalty-records/',
            {
                'employee': self.employee.id,
                'month': '2026-03',
                'record_type': 'BONUS',
                'reason': 'Thuong khoa ky',
                'amount': 100000,
                'calculation_type': 'FIXED',
                'record_date': '2026-03-15',
                'approved_by_name': '',
                'note': '',
                'is_active': True,
            },
            format='json',
        )
        self.assertEqual(bonus_resp.status_code, 403)

    def test_preclose_check_reports_unlocked_payroll_blocker(self):
        AttendanceRecord.objects.create(
            employee=self.employee,
            month='2026-03',
            standard_days=Decimal('26'),
            actual_days=Decimal('25'),
            paid_leave=Decimal('1'),
            unpaid_leave=Decimal('0'),
            note='',
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        PayrollRecord.objects.create(
            employee=self.employee,
            month='2026-03',
            net_pay=Decimal('7000000'),
            status=PayrollRecord.STATUS_UNLOCKED,
            created_by=self.user,
            updated_by=self.user,
        )

        resp = self.client.get('/api/workforce/payroll-records/preclose_check/', {'month': '2026-03'})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        blocker_codes = {item['code'] for item in data['blockers']}
        self.assertIn('UNLOCKED_PAYROLL', blocker_codes)

        lock_resp = self.client.post('/api/workforce/payroll-records/lock_month/', {'month': '2026-03'}, format='json')
        self.assertEqual(lock_resp.status_code, 400)

    def test_preclose_check_distinguishes_disbursed_and_undisbursed_advances(self):
        AttendanceRecord.objects.create(
            employee=self.employee,
            month='2026-03',
            standard_days=Decimal('26'),
            actual_days=Decimal('26'),
            paid_leave=Decimal('0'),
            unpaid_leave=Decimal('0'),
            note='',
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        PayrollRecord.objects.create(
            employee=self.employee,
            month='2026-03',
            net_pay=Decimal('7000000'),
            status=PayrollRecord.STATUS_LOCKED,
            created_by=self.user,
            updated_by=self.user,
        )
        row = SalaryAdvanceRecord.objects.create(
            employee=self.employee,
            advance_date=date(2026, 3, 5),
            month='2026-03',
            amount=Decimal('1000000'),
            reason='Ung luong',
            status=SalaryAdvanceRecord.STATUS_UNDEDUCTED,
            approval_status=SalaryAdvanceRecord.APPROVAL_APPROVED,
            created_by=self.user,
            updated_by=self.user,
        )

        resp = self.client.get('/api/workforce/payroll-records/preclose_check/', {'month': '2026-03'})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        warning_codes = {item['code'] for item in data['warnings']}
        blocker_codes = {item['code'] for item in data['blockers']}
        self.assertIn('APPROVED_ADVANCES_NOT_DISBURSED', warning_codes)
        self.assertNotIn('UNDEDUCTED_DISBURSED_ADVANCES', blocker_codes)

        self.client.post(
            f'/api/workforce/salary-advances/{row.id}/post_disbursement/',
            {'source_type': 'CASH', 'source_cash_account': self.cash_account.id},
            format='json',
        )
        resp_after = self.client.get('/api/workforce/payroll-records/preclose_check/', {'month': '2026-03'})
        self.assertEqual(resp_after.status_code, 200)
        data_after = resp_after.json()
        blocker_codes_after = {item['code'] for item in data_after['blockers']}
        self.assertIn('UNDEDUCTED_DISBURSED_ADVANCES', blocker_codes_after)
