from django.test import TestCase
from rest_framework.test import APIClient

from core.models import CustomReportDefinition, CustomReportRun, User


class CustomReportsApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='reports_admin',
            password='pass',
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(user=self.user)

    def test_reports_list_seeds_builtin_reports_and_summary(self):
        response = self.client.get('/api/reports/custom/')
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertGreaterEqual(body.get('count', 0), 7)

        summary_response = self.client.get('/api/reports/custom/summary/')
        self.assertEqual(summary_response.status_code, 200, summary_response.content)
        self.assertGreaterEqual(summary_response.json().get('system_count', 0), 7)

    def test_generate_custom_report_persists_definition_and_run_history(self):
        response = self.client.post(
            '/api/reports/custom/generate_report/',
            {
                'report_name': 'Sales Snapshot',
                'report_type': 'SALES',
                'period_start': '2026-03-01',
                'period_end': '2026-03-16',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertIn('id', body)
        self.assertIn('run_id', body)

        report = CustomReportDefinition.objects.get(pk=body['id'])
        self.assertEqual(report.report_type, 'SALES')
        self.assertEqual(report.status, CustomReportDefinition.STATUS_GENERATED)
        self.assertEqual(report.run_count, 1)

        history_response = self.client.get('/api/reports/custom/history/', {'report_id': report.id})
        self.assertEqual(history_response.status_code, 200, history_response.content)
        history_body = history_response.json()
        self.assertEqual(history_body.get('count'), 1)
        self.assertEqual(history_body['results'][0]['status'], CustomReportRun.STATUS_SUCCESS)

    def test_schedule_report_creates_django_q_schedule(self):
        create_response = self.client.post(
            '/api/reports/custom/',
            {
                'code': 'OPS_WEEKLY',
                'name': 'Operations Weekly',
                'report_type': 'PRODUCTION',
                'description': 'Weekly operations snapshot',
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, 201, create_response.content)
        report_id = create_response.json()['id']

        schedule_response = self.client.post(
            '/api/reports/custom/schedule_report/',
            {
                'report_id': report_id,
                'schedule_enabled': True,
                'schedule_frequency': 'DAILY',
                'schedule_time': '08:30',
                'schedule_recipients': ['ops@example.com', 'manager@example.com'],
            },
            format='json',
        )
        self.assertEqual(schedule_response.status_code, 200, schedule_response.content)
        body = schedule_response.json()
        self.assertTrue(body['scheduled'])
        self.assertIsNotNone(body['schedule_id'])
        self.assertTrue(body['report']['schedule_enabled'])

        from django_q.models import Schedule

        report = CustomReportDefinition.objects.get(pk=report_id)
        schedule = Schedule.objects.get(name=report.schedule_name)
        self.assertEqual(schedule.func, 'phase5_reports.run_scheduled_custom_report_job')
        self.assertEqual(schedule.args, str(report_id))

    def test_system_report_cannot_be_deleted(self):
        self.client.get('/api/reports/custom/')
        report = CustomReportDefinition.objects.get(code='AUDIT_TRAIL')
        response = self.client.delete(f'/api/reports/custom/{report.id}/')
        self.assertEqual(response.status_code, 400, response.content)
