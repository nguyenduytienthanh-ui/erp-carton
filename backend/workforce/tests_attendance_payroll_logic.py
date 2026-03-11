from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import User
from workforce.models import AttendanceRecord, Employee, EmployeeProfileHistory, PayrollRecord


class AttendancePayrollLogicTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='wf_payroll_logic', password='pass')
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        self.client.force_authenticate(user=self.user)
        self.employee = Employee.objects.create(
            code='E-LOGIC-01',
            name='Nhan vien logic',
            salary_basic=Decimal('2600000'),
            created_by=self.user,
            updated_by=self.user,
        )

    def test_attendance_rejects_total_days_exceeding_standard(self):
        resp = self.client.post(
            '/api/workforce/attendance-records/',
            {
                'employee': self.employee.id,
                'month': '2026-04',
                'standard_days': 26,
                'actual_days': 25,
                'paid_leave': 1,
                'unpaid_leave': 1,
                'note': '',
                'is_active': True,
                'overtime_items': [],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('non_field_errors', resp.json())

    def test_calculate_month_counts_paid_leave_as_payable_days(self):
        AttendanceRecord.objects.create(
            employee=self.employee,
            month='2026-04',
            standard_days=Decimal('26'),
            actual_days=Decimal('24'),
            paid_leave=Decimal('2'),
            unpaid_leave=Decimal('0'),
            note='',
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )

        resp = self.client.post(
            '/api/workforce/payroll-records/calculate_month/',
            {'month': '2026-04', 'overwrite': True},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)

        payroll = PayrollRecord.objects.get(employee=self.employee, month='2026-04')
        self.assertEqual(str(payroll.salary_by_attendance), '2600000.00')
        self.assertEqual(str(payroll.total_income), '2600000.00')
        self.assertEqual(str(payroll.net_pay), '2600000.00')

    def test_calculate_month_uses_effective_salary_history(self):
        self.employee.salary_basic = Decimal('5000000')
        self.employee.save(update_fields=['salary_basic', 'updated_at', 'search_text'])
        EmployeeProfileHistory.objects.create(
            employee=self.employee,
            effective_month='2026-03',
            salary_basic=Decimal('3000000'),
            department='Kho',
            position='NV',
            status=Employee.STATUS_ACTIVE,
            note='Moc cu',
            created_by=self.user,
            updated_by=self.user,
        )
        EmployeeProfileHistory.objects.create(
            employee=self.employee,
            effective_month='2026-05',
            salary_basic=Decimal('5000000'),
            department='Kho',
            position='NV',
            status=Employee.STATUS_ACTIVE,
            note='Moc moi',
            created_by=self.user,
            updated_by=self.user,
        )
        AttendanceRecord.objects.create(
            employee=self.employee,
            month='2026-04',
            standard_days=Decimal('26'),
            actual_days=Decimal('26'),
            paid_leave=Decimal('0'),
            unpaid_leave=Decimal('0'),
            note='',
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )

        resp = self.client.post(
            '/api/workforce/payroll-records/calculate_month/',
            {'month': '2026-04', 'overwrite': True},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)

        payroll = PayrollRecord.objects.get(employee=self.employee, month='2026-04')
        self.assertEqual(str(payroll.basic_salary), '3000000.00')
        self.assertEqual(payroll.profile_effective_month, '2026-03')

    def test_employee_update_creates_current_effective_history(self):
        current_month = timezone.localdate().strftime('%Y-%m')
        resp = self.client.patch(
            f'/api/workforce/employees/{self.employee.id}/',
            {'salary_basic': '4000000', 'department': 'Ke toan'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        history = EmployeeProfileHistory.objects.get(employee=self.employee, effective_month=current_month)
        self.assertEqual(str(history.salary_basic), '4000000.00')
        self.assertEqual(history.department, 'Ke toan')

    def test_payroll_keeps_department_and_position_snapshot(self):
        EmployeeProfileHistory.objects.create(
            employee=self.employee,
            effective_month='2026-04',
            salary_basic=Decimal('2600000'),
            department='Kho cu',
            position='NV kho',
            status=Employee.STATUS_ACTIVE,
            note='Snapshot payroll',
            created_by=self.user,
            updated_by=self.user,
        )
        AttendanceRecord.objects.create(
            employee=self.employee,
            month='2026-04',
            standard_days=Decimal('26'),
            actual_days=Decimal('26'),
            paid_leave=Decimal('0'),
            unpaid_leave=Decimal('0'),
            note='',
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        resp = self.client.post(
            '/api/workforce/payroll-records/calculate_month/',
            {'month': '2026-04', 'overwrite': True},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        payroll = PayrollRecord.objects.get(employee=self.employee, month='2026-04')
        self.assertEqual(payroll.employee_department_snapshot, 'Kho cu')
        self.assertEqual(payroll.employee_position_snapshot, 'NV kho')

    def test_employee_hard_delete_blocked_when_dependent_records_exist(self):
        AttendanceRecord.objects.create(
            employee=self.employee,
            month='2026-04',
            standard_days=Decimal('26'),
            actual_days=Decimal('26'),
            paid_leave=Decimal('0'),
            unpaid_leave=Decimal('0'),
            note='',
            is_active=True,
            created_by=self.user,
            updated_by=self.user,
        )
        resp = self.client.delete(f'/api/workforce/employees/{self.employee.id}/')
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(Employee.objects.filter(id=self.employee.id).exists())

    def test_attendance_rejects_resigned_employee(self):
        self.employee.status = Employee.STATUS_RESIGNED
        self.employee.save(update_fields=['status', 'updated_at', 'search_text'])
        resp = self.client.post(
            '/api/workforce/attendance-records/',
            {
                'employee': self.employee.id,
                'month': '2026-04',
                'standard_days': 26,
                'actual_days': 25,
                'paid_leave': 1,
                'unpaid_leave': 0,
                'note': '',
                'is_active': True,
                'overtime_items': [],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('employee', resp.json())
