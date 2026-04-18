import json
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from paper_optimizer.models import PaperOptimizerRun


class PaperOptimizerDemoCommandTests(TestCase):
    def _run_command(self, *args):
        stdout = StringIO()
        call_command(
            'bootstrap_paper_optimizer_demo',
            '--json',
            '--reset',
            *args,
            stdout=stdout,
        )
        return json.loads(stdout.getvalue())

    def test_bootstrap_paper_optimizer_demo_outputs_expected_payload_for_canonical(self):
        payload = self._run_command('--scenario', 'canonical')

        self.assertTrue(payload['route'].startswith('/paper-optimization?run_id='))
        self.assertEqual(payload['selected_plan_code'], 'LOWEST_TOTAL_COST')
        self.assertEqual(payload['selected_scenario_code'], 'TARGET')
        self.assertTrue(payload['canonical_match'])
        self.assertTrue(PaperOptimizerRun.objects.filter(code='POPT-RCV-DEMO-CANONICAL').exists())

    def test_bootstrap_paper_optimizer_demo_supports_preview_warning_scenario(self):
        payload = self._run_command('--scenario', 'preview-warning')

        self.assertEqual(payload['route'], '/paper-optimization')
        self.assertEqual(payload['preview_issue_count'], 3)
        self.assertTrue(payload['preview_fixture_path'].endswith('paper-optimizer-preview-invalid.csv'))

    def test_bootstrap_paper_optimizer_demo_supports_fresh_optimize_scenario(self):
        payload = self._run_command('--scenario', 'fresh-optimize')

        self.assertEqual(payload['route'], '/paper-optimization')
        self.assertEqual(payload['scenario'], 'fresh-optimize')

    def test_bootstrap_paper_optimizer_demo_supports_failed_scenario(self):
        payload = self._run_command('--scenario', 'failed')

        self.assertTrue(payload['route'].startswith('/paper-optimization?run_id='))
        run = PaperOptimizerRun.objects.get(id=payload['run_id'])
        self.assertEqual(run.code, 'POPT-RCV-DEMO-FAILED')
        self.assertEqual(run.status, PaperOptimizerRun.STATUS_FAILED)
        self.assertIn('failed', payload['scenario'])

    def test_bootstrap_paper_optimizer_demo_supports_legacy_fallback_scenario(self):
        payload = self._run_command('--scenario', 'legacy-fallback')

        self.assertTrue(payload['route'].startswith('/paper-optimization?run_id='))
        self.assertTrue(payload['engine_fallback_used'])
        run = PaperOptimizerRun.objects.get(id=payload['run_id'])
        self.assertEqual(run.code, 'POPT-RCV-DEMO-LEGACY-FALLBACK')
        self.assertTrue(run.result_payload['stats']['engine_fallback_used'])

    def test_bootstrap_paper_optimizer_demo_supports_no_feasible_scenario(self):
        payload = self._run_command('--scenario', 'no-feasible')

        self.assertTrue(payload['route'].startswith('/paper-optimization?run_id='))
        run = PaperOptimizerRun.objects.get(id=payload['run_id'])
        self.assertEqual(run.code, 'POPT-RCV-DEMO-NO-FEASIBLE')
        self.assertEqual(run.status, PaperOptimizerRun.STATUS_SUCCESS)
        self.assertEqual(run.result_payload['result_state'], 'no_feasible_candidate')
        self.assertTrue(run.result_payload['stats']['no_feasible_candidate'])

    def test_bootstrap_paper_optimizer_demo_supports_legacy_no_feasible_scenario(self):
        payload = self._run_command('--scenario', 'legacy-no-feasible')

        self.assertTrue(payload['route'].startswith('/paper-optimization?run_id='))
        run = PaperOptimizerRun.objects.get(id=payload['run_id'])
        self.assertEqual(run.code, 'POPT-RCV-DEMO-LEGACY-NO-FEASIBLE')
        self.assertEqual(run.status, PaperOptimizerRun.STATUS_SUCCESS)
        self.assertNotIn('result_state', run.result_payload)
        self.assertTrue(run.result_payload['stats']['no_feasible_candidate'])
