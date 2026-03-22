import json
from io import StringIO

from django.core.management import call_command
from django.test import TestCase, override_settings

from core.models import AuditLog


class PerformanceDrilldownCommandTests(TestCase):
    @override_settings(
        LARGE_DATA_WARNING_ROWS=5,
        LARGE_DATA_CRITICAL_ROWS=20,
        DB_SLOW_QUERY_THRESHOLD_MS=1000,
    )
    def test_performance_drilldown_returns_surface_timings_and_explain_excerpt(self):
        for index in range(6):
            AuditLog.objects.create(
                user=None,
                action='UPDATE',
                entity_type='PerformanceDrilldownProbe',
                entity_id=index,
                entity_id_str=str(index),
                entity_code=f'PDR-{index}',
                changed_fields=['status'],
                old_values={},
                new_values={'status': 'OK'},
            )

        stdout = StringIO()
        call_command('performance_drilldown', '--json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertGreaterEqual(payload['surface_count'], 1)
        self.assertEqual(payload['sample_size'], 25)
        audit_surface = next(item for item in payload['surfaces'] if item['key'] == 'audit_logs')
        self.assertEqual(audit_surface['count'], 6)
        self.assertIn('count_query_ms', audit_surface)
        self.assertIn('sample_query_ms', audit_surface)
        self.assertIn('auditlog_created_desc_idx', audit_surface['index_hints'])
        self.assertTrue(isinstance(audit_surface['explain_excerpt'], str))
