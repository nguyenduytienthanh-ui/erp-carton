from __future__ import annotations

import copy
import time
from contextlib import nullcontext
from typing import Any
from unittest.mock import patch

from paper_optimizer.services import load_canonical_snapshot, run_optimizer_recovery


REGRESSION_CASE_ORDER = (
    'canonical_locked',
    'non_canonical_success',
    'no_feasible_candidate',
    'legacy_fallback_success',
)

PRIMARY_GUARDRAIL_METRICS = (
    'total_converted_cost',
    'unique_raw_width_count',
    'unique_purchase_spec_count',
    'final_group_count',
    'technical_waste_rate',
)

REPORT_ONLY_GUARDRAIL_METRICS = (
    'total_purchase_area',
)


def build_non_viable_public_alternatives() -> list[dict[str, Any]]:
    alternatives: list[dict[str, Any]] = []
    for plan_code in ['EXACT_ORDER', 'LOWEST_TOTAL_COST', 'MIN_RAW_WIDTHS', 'MIN_SPECS']:
        alternatives.append(
            {
                'plan_code': plan_code,
                'plan_name': plan_code,
                'scenario_code': 'NO_FEASIBLE',
                'source_internal_plan_code': plan_code,
                'all_ncc_passed': False,
                'meets_target_and_cap': False,
                'purchase_spec_rows': [],
                'allocation_details': [],
                'final_plan': [],
                'reverse_check_rows': [],
                'leftovers': [],
                'raw_widths_used': [],
                'total_converted_cost': 999999.0,
                'unique_raw_width_count': 0,
                'unique_purchase_spec_count': 0,
                'final_group_count': 0,
                'public_plan_convergence_reason_code': 'no_feasible_candidate',
                'objective_candidate_count': 0,
            }
        )
    return alternatives


def build_viable_legacy_fallback_alternatives(snapshot: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    canonical_snapshot = snapshot or load_canonical_snapshot()
    alternatives = copy.deepcopy(canonical_snapshot['public_alternatives'])
    for alternative in alternatives:
        alternative['all_ncc_passed'] = True
        alternative.setdefault('purchase_spec_rows', [])
    return alternatives


def build_regression_case_definitions() -> dict[str, dict[str, Any]]:
    snapshot = load_canonical_snapshot()
    changed_lines = [dict(item) for item in snapshot['input_lines']]
    changed_lines[0]['quantity'] = int(changed_lines[0]['quantity']) + 1
    non_canonical_success_lines = [
        dict(snapshot['input_lines'][0]),
        dict(snapshot['input_lines'][1]),
    ]
    non_canonical_success_lines[0]['quantity'] = 60
    non_canonical_success_lines[1]['quantity'] = 40
    no_feasible_candidate_lines = [
        dict(snapshot['input_lines'][0]),
        dict(snapshot['input_lines'][1]),
        dict(snapshot['input_lines'][2]),
    ]
    for row in no_feasible_candidate_lines:
        row['quantity'] = 1

    return {
        'canonical_locked': {
            'input_lines': copy.deepcopy(snapshot['input_lines']),
            'supplier_config': copy.deepcopy(snapshot['supplier_config']),
            'optimization_config': copy.deepcopy(snapshot['optimization_config']),
            'source_filename': 'canonical-benchmark.xlsx',
            'note': 'canonical benchmark',
            'expected': {
                'selected_plan_code': 'LOWEST_TOTAL_COST',
                'selected_scenario_code': 'TARGET',
                'engine_fallback_used': False,
                'feasible_alternative_count': 4,
                'no_feasible_candidate': False,
                'canonical_match': True,
                'total_converted_cost': 2.67223922,
                'total_purchase_area': 8537140.0,
                'unique_raw_width_count': 1,
                'unique_purchase_spec_count': 4,
                'final_group_count': 6,
                'technical_waste_rate': 0.15223922,
            },
        },
        'non_canonical_success': {
            'input_lines': non_canonical_success_lines,
            'supplier_config': copy.deepcopy(snapshot['supplier_config']),
            'optimization_config': copy.deepcopy(snapshot['optimization_config']),
            'source_filename': 'non-canonical-success.xlsx',
            'note': 'success benchmark',
            'expected': {
                'selected_plan_code': 'LOWEST_TOTAL_COST',
                'selected_scenario_code': 'ECON',
                'engine_fallback_used': True,
                'engine_fallback_source': 'legacy',
                'engine_fallback_reason_code': 'no_viable_public_alternatives',
                'feasible_alternative_count': 4,
                'no_feasible_candidate': False,
                'canonical_match': False,
                'total_converted_cost': 2.18782609,
                'total_purchase_area': 1457567.5,
                'unique_raw_width_count': 1,
                'unique_purchase_spec_count': 2,
                'final_group_count': 2,
                'technical_waste_rate': 0.54782609,
            },
        },
        'no_feasible_candidate': {
            'input_lines': no_feasible_candidate_lines,
            'supplier_config': copy.deepcopy(snapshot['supplier_config']),
            'optimization_config': copy.deepcopy(snapshot['optimization_config']),
            'source_filename': 'non-canonical-no-feasible.xlsx',
            'note': 'no feasible benchmark',
            'expected': {
                'selected_plan_code': 'LOWEST_TOTAL_COST',
                'selected_scenario_code': 'TARGET',
                'engine_fallback_used': False,
                'feasible_alternative_count': 0,
                'no_feasible_candidate': True,
                'canonical_match': False,
                'total_converted_cost': 0.0,
                'total_purchase_area': 0.0,
                'unique_raw_width_count': 0,
                'unique_purchase_spec_count': 0,
                'final_group_count': 0,
                'technical_waste_rate': 0.0,
            },
        },
        'legacy_fallback_success': {
            'input_lines': changed_lines,
            'supplier_config': copy.deepcopy(snapshot['supplier_config']),
            'optimization_config': copy.deepcopy(snapshot['optimization_config']),
            'source_filename': 'legacy-fallback-benchmark.xlsx',
            'note': 'legacy fallback benchmark',
            'expected': {
                'selected_plan_code': 'LOWEST_TOTAL_COST',
                'selected_scenario_code': 'TARGET',
                'engine_fallback_used': True,
                'engine_fallback_source': 'legacy',
                'engine_fallback_reason_code': 'no_viable_public_alternatives',
                'feasible_alternative_count': 4,
                'no_feasible_candidate': False,
                'canonical_match': False,
                'total_converted_cost': 2.67223922,
                'total_purchase_area': 8537140.0,
                'unique_raw_width_count': 1,
                'unique_purchase_spec_count': 4,
                'final_group_count': 6,
                'technical_waste_rate': 0.15223922,
            },
        },
    }


def run_regression_case(case_name: str) -> dict[str, Any]:
    definitions = build_regression_case_definitions()
    if case_name not in definitions:
        raise ValueError(f'Unsupported regression case: {case_name}')

    case = definitions[case_name]
    snapshot = load_canonical_snapshot()
    patch_context = nullcontext()
    if case_name == 'legacy_fallback_success':
        patch_context = patch(
            'paper_optimizer.optimizer.build_four_public_plans_v2',
            return_value=(build_non_viable_public_alternatives(), 'LOWEST_TOTAL_COST'),
        )
        legacy_patch_context = patch(
            'paper_optimizer.optimizer.build_four_public_plans',
            return_value=(
                build_viable_legacy_fallback_alternatives(snapshot),
                snapshot['selected_plan_code'],
            ),
        )
    else:
        legacy_patch_context = nullcontext()

    with patch_context, legacy_patch_context:
        started_at = time.perf_counter()
        result_payload = run_optimizer_recovery(
            input_lines=copy.deepcopy(case['input_lines']),
            supplier_config=copy.deepcopy(case['supplier_config']),
            optimization_config=copy.deepcopy(case['optimization_config']),
            source_filename=case['source_filename'],
            note=case['note'],
        )
        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)

    stats = result_payload.get('stats') or {}
    selected_plan = result_payload.get('selected_plan') or {}
    return {
        'case': case_name,
        'duration_ms': duration_ms,
        'selected_plan_code': result_payload.get('selected_plan_code'),
        'selected_scenario_code': result_payload.get('selected_scenario_code'),
        'engine_fallback_used': bool(stats.get('engine_fallback_used')),
        'engine_fallback_source': stats.get('engine_fallback_source'),
        'engine_fallback_reason_code': stats.get('engine_fallback_reason_code'),
        'feasible_alternative_count': int(stats.get('feasible_alternative_count') or 0),
        'no_feasible_candidate': bool(stats.get('no_feasible_candidate')),
        'canonical_match': bool(result_payload.get('canonical_match')),
        'total_converted_cost': selected_plan.get('total_converted_cost'),
        'total_purchase_area': selected_plan.get('total_purchase_area'),
        'unique_raw_width_count': selected_plan.get('unique_raw_width_count'),
        'unique_purchase_spec_count': selected_plan.get('unique_purchase_spec_count'),
        'final_group_count': selected_plan.get('final_group_count'),
        'technical_waste_rate': selected_plan.get('technical_waste_rate'),
        'result_payload': result_payload,
        'expected': copy.deepcopy(case['expected']),
    }


def _compare_metric(actual: float | int | None, expected: float | int | None, *, tolerance: float = 1e-6) -> int:
    actual_value = float(actual or 0.0)
    expected_value = float(expected or 0.0)
    if abs(actual_value - expected_value) <= tolerance:
        return 0
    return -1 if actual_value < expected_value else 1


def evaluate_regression_case_guardrail(case_result: dict[str, Any]) -> dict[str, Any]:
    expected = case_result.get('expected') or {}
    comparisons: dict[str, dict[str, Any]] = {}
    decision_metric = 'matched'
    guardrail_passed = True

    for metric in PRIMARY_GUARDRAIL_METRICS + REPORT_ONLY_GUARDRAIL_METRICS:
        actual_value = case_result.get(metric)
        expected_value = expected.get(metric)
        delta_value = None
        if actual_value is not None and expected_value is not None:
            delta_value = round(float(actual_value) - float(expected_value), 8)
        comparisons[metric] = {
            'actual': actual_value,
            'expected': expected_value,
            'delta': delta_value,
        }

    for metric in PRIMARY_GUARDRAIL_METRICS:
        comparison = comparisons[metric]
        result = _compare_metric(comparison['actual'], comparison['expected'])
        if result < 0:
            decision_metric = metric
            guardrail_passed = True
            break
        if result > 0:
            decision_metric = metric
            guardrail_passed = False
            break

    return {
        'passed': guardrail_passed,
        'decision_metric': decision_metric,
        'comparisons': comparisons,
    }


def build_regression_guardrail_report() -> dict[str, Any]:
    results = [run_regression_case(case_name) for case_name in REGRESSION_CASE_ORDER]
    failures: list[dict[str, Any]] = []
    payload_results: list[dict[str, Any]] = []

    for case_result in results:
        guardrail = evaluate_regression_case_guardrail(case_result)
        if not guardrail['passed']:
            failures.append(
                {
                    'case': case_result['case'],
                    'decision_metric': guardrail['decision_metric'],
                }
            )
        payload_results.append(
            {
                **case_result,
                'guardrail': guardrail,
            }
        )

    return {
        'passed': not failures,
        'failing_cases': failures,
        'results': payload_results,
    }
