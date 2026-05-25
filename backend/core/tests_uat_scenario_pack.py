import json
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.test import SimpleTestCase

from core.management.commands.erp_main_uat_scenarios import build_uat_scenario_pack


class ErpMainUatScenarioPackTests(SimpleTestCase):
    def test_command_returns_copy_friendly_json_for_core_erp_scenarios(self):
        stdout = StringIO()
        call_command('erp_main_uat_scenarios', '--format', 'json', stdout=stdout)
        payload = json.loads(stdout.getvalue())

        self.assertEqual(payload['pack'], 'ERP Main UAT Scenario Pack v1')
        self.assertEqual(payload['mode'], 'read_only_static_repository_check')
        self.assertEqual(payload['overall_status'], 'ok')
        self.assertEqual(payload['summary']['scenario_count'], 6)
        self.assertEqual(payload['summary']['warning_count'], 0)
        scenario_keys = {item['key'] for item in payload['scenarios']}
        self.assertEqual(scenario_keys, {
            'product_readiness',
            'sales_snapshot_v2',
            'production_handoff',
            'planning_dispatch',
            'inventory_ledger_nxt_source_audit',
            'ops_release_readiness',
        })
        self.assertTrue(any('release_readiness' in item for item in payload['recommended_commands']))
        self.assertTrue(any('read-only' in item.lower() for item in payload['safety_notes']))

    def test_command_returns_markdown_with_manual_uat_steps(self):
        stdout = StringIO()
        call_command('erp_main_uat_scenarios', stdout=stdout)
        output = stdout.getvalue()

        self.assertIn('# ERP Main UAT Scenario Pack v1', output)
        self.assertIn('## Scenarios', output)
        self.assertIn('Product master / routing / print readiness', output)
        self.assertIn('PlanningBoard dispatch readiness', output)
        self.assertIn('## Safety notes', output)

    def test_pack_marks_missing_evidence_as_warning_without_db_writes(self):
        payload = build_uat_scenario_pack(repo_root=Path('Z:/missing/repo'))

        self.assertEqual(payload['overall_status'], 'warning')
        self.assertEqual(payload['summary']['ok_count'], 0)
        self.assertEqual(payload['summary']['warning_count'], payload['summary']['scenario_count'])
        first_evidence = payload['scenarios'][0]['evidence'][0]
        self.assertFalse(first_evidence['exists'])
        self.assertEqual(first_evidence['status'], 'warning')
