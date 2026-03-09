from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from core.models import User
from workforce.models import Employee, PayrollRecord


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

    def test_lock_month_blocks_payroll_update(self):
        payroll = PayrollRecord.objects.create(
            employee=self.employee,
            month='2026-03',
            net_pay=Decimal('7000000'),
            status=PayrollRecord.STATUS_UNLOCKED,
            created_by=self.user,
            updated_by=self.user,
        )
        lock_resp = self.client.post('/api/workforce/payroll-records/lock_month/', {'month': '2026-03'}, format='json')
        self.assertEqual(lock_resp.status_code, 200)

        update_resp = self.client.patch(
            f'/api/workforce/payroll-records/{payroll.id}/',
            {'note': 'edited'},
            format='json',
        )
        self.assertEqual(update_resp.status_code, 403)

    def test_lock_month_blocks_calculate_month(self):
        lock_resp = self.client.post('/api/workforce/payroll-records/lock_month/', {'month': '2026-03'}, format='json')
        self.assertEqual(lock_resp.status_code, 200)

        calculate_resp = self.client.post(
            '/api/workforce/payroll-records/calculate_month/',
            {'month': '2026-03', 'overwrite': True},
            format='json',
        )
        self.assertEqual(calculate_resp.status_code, 400)
