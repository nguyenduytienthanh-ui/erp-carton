import json
from io import StringIO

from django.core.management import call_command
from django.test import TestCase, override_settings

from core.models import AuditLog


class PerformanceReadinessTests(TestCase):
    @override_settings(
        LARGE_DATA_WARNING_ROWS=5,
        LARGE_DATA_CRITICAL_ROWS=20,
        DB_SLOW_QUERY_THRESHOLD_MS=1800,
    )
    def test_performance_readiness_reports_large_data_surfaces(self):
        for index in range(6):
            AuditLog.objects.create(
                user=None,
                action='UPDATE',
                entity_type='PerformanceProbe',
                entity_id=index,
                entity_id_str=str(index),
                entity_code=f'PROBE-{index}',
                changed_fields=['status'],
                old_values={},
                new_values={'status': 'OK'},
            )

        stdout = StringIO()
        call_command('performance_readiness', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['slow_query_threshold_ms'], 1800)
        self.assertEqual(payload['status'], 'warning')
        audit_logs_row = next(row for row in payload['datasets'] if row['key'] == 'audit_logs')
        self.assertEqual(audit_logs_row['risk_band'], 'warning')
        self.assertGreaterEqual(payload['summary']['warning_count'], 1)
