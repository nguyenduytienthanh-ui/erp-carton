import copy
import json
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from core.models import UserPreferences
from paper_optimizer.models import PaperOptimizerRun
from paper_optimizer.regression_corpus import (
    build_non_viable_public_alternatives,
    run_regression_case,
)
from paper_optimizer.services import (
    build_default_input_lines,
    build_default_optimization_config,
    build_default_supplier_config,
    load_canonical_snapshot,
    run_optimizer_recovery,
)


DEMO_CODE_PREFIX = 'POPT-RCV-DEMO'
SUPPORTED_SCENARIOS = {
    'canonical',
    'fresh-optimize',
    'preview-warning',
    'failed',
    'legacy-fallback',
    'no-feasible',
    'legacy-no-feasible',
}


class Command(BaseCommand):
    help = 'Bootstrap deterministic demo data for the paper optimizer recovery center.'

    def add_arguments(self, parser):
        parser.add_argument('--username', default='uat_admin')
        parser.add_argument('--password', default='Demo123!')
        parser.add_argument('--reset', action='store_true')
        parser.add_argument('--reset-passwords', action='store_true')
        parser.add_argument('--json', action='store_true')
        parser.add_argument('--scenario', default='canonical')

    def handle(self, *args, **options):
        username = str(options['username']).strip()
        password = str(options['password'])
        reset = bool(options['reset'])
        output_json = bool(options['json'])
        reset_passwords = bool(options['reset_passwords'])
        scenario = str(options['scenario']).strip().lower() or 'canonical'

        if not username:
            raise CommandError('Username is required.')
        if scenario not in SUPPORTED_SCENARIOS:
            raise CommandError(f'Unsupported scenario: {scenario}')

        user = self._ensure_user(username=username, password=password, reset_passwords=reset_passwords)

        if reset:
            PaperOptimizerRun.objects.filter(code__startswith=DEMO_CODE_PREFIX).delete()

        if output_json:
            silent_buffer = StringIO()
            call_command('bootstrap_uat_demo', stdout=silent_buffer)
        else:
            call_command('bootstrap_uat_demo')

        payload = self._build_payload_for_scenario(scenario=scenario, user=user)
        if output_json:
            self.stdout.write(json.dumps(payload))
            return
        self.stdout.write(self.style.SUCCESS(f'Paper optimizer demo data is ready for scenario "{scenario}".'))
        self.stdout.write(payload['route'])

    def _ensure_user(self, username: str, password: str, reset_passwords: bool):
        User = get_user_model()
        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                'email': f'{username}@example.local',
                'is_staff': True,
                'is_superuser': True,
                'is_active': True,
                'first_name': 'UAT',
                'last_name': 'Admin',
            },
        )
        if created or reset_passwords:
            user.set_password(password)
            user.save(update_fields=['password'])
        return user

    def _build_payload_for_scenario(self, scenario: str, user):
        if scenario == 'preview-warning':
            return self._build_preview_warning_payload()
        if scenario == 'fresh-optimize':
            return self._build_fresh_optimize_payload(user)
        if scenario == 'failed':
            return self._build_failed_run_payload(user)
        if scenario == 'legacy-fallback':
            return self._build_legacy_fallback_payload(user)
        if scenario == 'no-feasible':
            return self._build_no_feasible_payload(user)
        if scenario == 'legacy-no-feasible':
            return self._build_legacy_no_feasible_payload(user)
        return self._build_canonical_payload(user)

    def _build_canonical_payload(self, user):
        result_payload = run_optimizer_recovery(
            input_lines=build_default_input_lines(),
            supplier_config=build_default_supplier_config(),
            optimization_config=build_default_optimization_config(),
            source_filename='baseline-canonical.xlsx',
            note='Bootstrap canonical run for paper optimizer UI verification.',
        )
        run = self._upsert_success_run(
            code=f'{DEMO_CODE_PREFIX}-CANONICAL',
            user=user,
            result_payload=result_payload,
        )
        selected_plan = result_payload.get('selected_plan') or {}
        return {
            'scenario': 'canonical',
            'route': f'/paper-optimization?run_id={run.id}',
            'run_id': run.id,
            'run_code': run.code,
            'selected_plan_code': result_payload.get('selected_plan_code'),
            'selected_scenario_code': result_payload.get('selected_scenario_code'),
            'final_group_count': selected_plan.get('final_group_count'),
            'canonical_match': bool(result_payload.get('canonical_match')),
            'ui_assert_text': run.code,
        }

    def _build_preview_warning_payload(self):
        repo_root = Path(__file__).resolve().parents[4]
        fixture_path = repo_root / 'frontend' / 'tests' / 'e2e' / 'fixtures' / 'paper-optimizer-preview-invalid.csv'
        if not fixture_path.exists():
            raise CommandError(f'Missing preview warning fixture: {fixture_path}')
        return {
            'scenario': 'preview-warning',
            'route': '/paper-optimization',
            'preview_fixture_path': str(fixture_path),
            'preview_issue_count': 3,
            'ui_assert_text': 'cần xem lại',
        }

    def _build_fresh_optimize_payload(self, user):
        UserPreferences.objects.filter(user=user, page='production-paper-optimizer').delete()
        return {
            'scenario': 'fresh-optimize',
            'route': '/paper-optimization',
            'ui_assert_text': 'Sinh phương án',
        }

    def _build_failed_run_payload(self, user):
        input_lines = build_default_input_lines()
        supplier_config = build_default_supplier_config()
        optimization_config = build_default_optimization_config()
        run, _created = PaperOptimizerRun.objects.update_or_create(
            code=f'{DEMO_CODE_PREFIX}-FAILED',
            defaults={
                'status': PaperOptimizerRun.STATUS_FAILED,
                'source_filename': 'failed-demo.xlsx',
                'note': 'Bootstrap failed run for paper optimizer UI verification.',
                'input_lines': input_lines,
                'supplier_config': supplier_config,
                'optimization_config': optimization_config,
                'preview_rows': input_lines,
                'result_payload': {},
                'recovery_mode': False,
                'canonical_match': False,
                'failed_reason': 'Demo failed run: cần nạp lại cấu hình hoặc chạy lại.',
                'created_by': user,
            },
        )
        return {
            'scenario': 'failed',
            'route': f'/paper-optimization?run_id={run.id}',
            'run_id': run.id,
            'run_code': run.code,
            'selected_plan_code': '',
            'selected_scenario_code': '',
            'final_group_count': 0,
            'canonical_match': False,
            'ui_assert_text': 'thất bại',
        }

    def _build_legacy_fallback_payload(self, user):
        input_lines = build_default_input_lines()
        input_lines[0]['quantity'] = int(input_lines[0]['quantity']) + 1
        supplier_config = build_default_supplier_config()
        optimization_config = build_default_optimization_config()
        canonical_snapshot = load_canonical_snapshot()
        legacy_case = run_regression_case('legacy_fallback_success')
        legacy_alternatives = copy.deepcopy(legacy_case['result_payload']['final_plan_alternatives'])

        with patch(
            'paper_optimizer.optimizer.build_four_public_plans_v2',
            return_value=(build_non_viable_public_alternatives(), 'LOWEST_TOTAL_COST'),
        ), patch(
            'paper_optimizer.optimizer.build_four_public_plans',
            return_value=(
                legacy_alternatives,
                canonical_snapshot['selected_plan_code'],
            ),
        ):
            result_payload = run_optimizer_recovery(
                input_lines=input_lines,
                supplier_config=supplier_config,
                optimization_config=optimization_config,
                source_filename='legacy-fallback.xlsx',
                note='Bootstrap legacy fallback run for paper optimizer UI verification.',
            )

        if not (result_payload.get('stats') or {}).get('engine_fallback_used'):
            raise CommandError('Legacy fallback scenario did not trigger engine fallback metadata.')

        run = self._upsert_success_run(
            code=f'{DEMO_CODE_PREFIX}-LEGACY-FALLBACK',
            user=user,
            result_payload=result_payload,
        )
        selected_plan = result_payload.get('selected_plan') or {}
        return {
            'scenario': 'legacy-fallback',
            'route': f'/paper-optimization?run_id={run.id}',
            'run_id': run.id,
            'run_code': run.code,
            'selected_plan_code': result_payload.get('selected_plan_code'),
            'selected_scenario_code': result_payload.get('selected_scenario_code'),
            'final_group_count': selected_plan.get('final_group_count'),
            'canonical_match': bool(result_payload.get('canonical_match')),
            'engine_fallback_used': True,
            'ui_assert_text': 'legacy',
        }

    def _build_no_feasible_payload(self, user):
        result_payload = copy.deepcopy(run_regression_case('no_feasible_candidate')['result_payload'])
        run = self._upsert_success_run(
            code=f'{DEMO_CODE_PREFIX}-NO-FEASIBLE',
            user=user,
            result_payload=result_payload,
        )
        return {
            'scenario': 'no-feasible',
            'route': f'/paper-optimization?run_id={run.id}',
            'run_id': run.id,
            'run_code': run.code,
            'selected_plan_code': result_payload.get('selected_plan_code'),
            'selected_scenario_code': result_payload.get('selected_scenario_code'),
            'final_group_count': 0,
            'canonical_match': bool(result_payload.get('canonical_match')),
            'ui_assert_text': 'chưa tìm được phương án',
        }

    def _build_legacy_no_feasible_payload(self, user):
        result_payload = copy.deepcopy(run_regression_case('no_feasible_candidate')['result_payload'])
        result_payload.pop('result_state', None)
        (result_payload.get('stats') or {}).pop('displayable_result', None)
        (result_payload.get('selected_plan') or {}).pop('is_placeholder_no_feasible', None)
        for alternative in result_payload.get('final_plan_alternatives') or []:
            alternative.pop('is_placeholder_no_feasible', None)

        run = self._upsert_success_run(
            code=f'{DEMO_CODE_PREFIX}-LEGACY-NO-FEASIBLE',
            user=user,
            result_payload=result_payload,
        )
        return {
            'scenario': 'legacy-no-feasible',
            'route': f'/paper-optimization?run_id={run.id}',
            'run_id': run.id,
            'run_code': run.code,
            'selected_plan_code': result_payload.get('selected_plan_code'),
            'selected_scenario_code': result_payload.get('selected_scenario_code'),
            'final_group_count': 0,
            'canonical_match': bool(result_payload.get('canonical_match')),
            'ui_assert_text': 'legacy no feasible',
        }

    def _upsert_success_run(self, code: str, user, result_payload: dict):
        run, _created = PaperOptimizerRun.objects.update_or_create(
            code=code,
            defaults={
                'status': PaperOptimizerRun.STATUS_SUCCESS,
                'source_filename': result_payload['source_filename'],
                'note': result_payload['note'],
                'input_lines': result_payload['input_lines'],
                'supplier_config': result_payload['supplier_config'],
                'optimization_config': result_payload['optimization_config'],
                'preview_rows': result_payload['input_lines'],
                'result_payload': result_payload,
                'recovery_mode': bool(result_payload.get('recovery_mode')),
                'canonical_match': bool(result_payload.get('canonical_match')),
                'failed_reason': '',
                'created_by': user,
            },
        )
        return run
