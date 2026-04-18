import json
from pathlib import Path

from django.conf import settings
from django.test import TestCase


class PaperOptimizerCanonicalAssetsTests(TestCase):
    def test_frontend_and_backend_canonical_snapshot_are_aligned(self):
        repo_root = Path(settings.BASE_DIR).parent
        backend_snapshot_path = settings.BASE_DIR / 'paper_optimizer' / 'reference_data' / 'baseline_guardrail_canonical_v1.json'
        frontend_snapshot_path = repo_root / 'frontend' / 'public' / 'paper-optimizer' / 'baseline_guardrail_canonical_v1.json'
        backend_workbook_path = settings.BASE_DIR / 'paper_optimizer' / 'reference_data' / 'paper_optimizer_canonical_guardrail_v1.xlsx'
        frontend_workbook_path = repo_root / 'frontend' / 'public' / 'paper-optimizer' / 'paper_optimizer_canonical_guardrail_v1.xlsx'

        self.assertTrue(backend_snapshot_path.exists(), f'Missing backend snapshot: {backend_snapshot_path}')
        self.assertTrue(frontend_snapshot_path.exists(), f'Missing frontend snapshot: {frontend_snapshot_path}')
        self.assertTrue(backend_workbook_path.exists(), f'Missing backend workbook: {backend_workbook_path}')
        self.assertTrue(frontend_workbook_path.exists(), f'Missing frontend workbook: {frontend_workbook_path}')

        backend_payload = json.loads(backend_snapshot_path.read_text(encoding='utf-8'))
        frontend_payload = json.loads(frontend_snapshot_path.read_text(encoding='utf-8'))

        self.assertEqual(frontend_payload['reference_code'], 'baseline-canonical-v5000-v1')
        self.assertEqual(backend_payload['config_fingerprint'], frontend_payload['config_fingerprint'])
        self.assertEqual(backend_payload['selected_plan_code'], frontend_payload['selected_plan_code'])
        self.assertEqual(backend_payload['selected_scenario_code'], frontend_payload['selected_scenario_code'])
        self.assertEqual(
            backend_payload['selected_source_internal_plan_code'],
            frontend_payload['selected_source_internal_plan_code'],
        )
