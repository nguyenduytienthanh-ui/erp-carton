from __future__ import annotations

import copy
import itertools
import json
import math
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any


PLAN_CODES = ['EXACT_ORDER', 'LOWEST_TOTAL_COST', 'MIN_RAW_WIDTHS', 'MIN_SPECS']
PLAN_NAMES = {
    'EXACT_ORDER': 'Phương án đúng đơn hàng',
    'LOWEST_TOTAL_COST': 'Phương án chi phí thấp nhất',
    'MIN_RAW_WIDTHS': 'Phương án ít khổ giấy nhất',
    'MIN_SPECS': 'Phương án ít quy cách mua nhất',
}


INF = float('inf')
REFERENCE_DATA_DIR = Path(__file__).resolve().parent / 'reference_data'
CANONICAL_SNAPSHOT_PATH = REFERENCE_DATA_DIR / 'baseline_guardrail_canonical_v1.json'


def _r(value: float, digits: int = 8) -> float:
    return round(float(value), digits)


def _length_delta_ok(run_length_cm: float, component_lengths: list[float], max_length_delta_cm: float | None) -> bool:
    if max_length_delta_cm is None:
        return True
    return all(abs(run_length_cm - length_cm) <= max_length_delta_cm for length_cm in component_lengths)


def _build_reverse_check(
    allocation_rows: list[dict[str, Any]],
    purchase_spec_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    reverse: dict[str, dict[str, Any]] = {}
    for row in allocation_rows:
        key = f"{row['raw_width_cm']}x{row['run_length_cm']}"
        entry = reverse.setdefault(
            key,
            {
                'raw_width_cm': row['raw_width_cm'],
                'run_length_cm': row['run_length_cm'],
                'sum_line_sets': 0,
                'sum_purchase_sets': 0,
                'line_count': 0,
                'line_ids': [],
                'purchase_group_ids': set(),
            },
        )
        entry['sum_line_sets'] += int(row['line_allocated_sets'])
        purchase_group_id = str(
            row.get('purchase_group_id')
            or f"{row['raw_width_cm']}x{row['run_length_cm']}:{row['line_id']}:{entry['line_count']}"
        )
        if purchase_group_id not in entry['purchase_group_ids']:
            entry['purchase_group_ids'].add(purchase_group_id)
            entry['sum_purchase_sets'] += int(row.get('purchase_spec_sets') or row.get('line_allocated_sets') or 0)
        entry['line_count'] += 1
        entry['line_ids'].append(row['line_id'])

    spec_map = {f"{row['raw_width_cm']}x{row['run_length_cm']}": row for row in purchase_spec_rows}
    result = []
    for key, reverse_row in sorted(reverse.items()):
        spec = spec_map.get(key, {})
        result.append({
            'raw_width_cm': reverse_row['raw_width_cm'],
            'run_length_cm': reverse_row['run_length_cm'],
            'sum_line_allocated_sets': reverse_row['sum_purchase_sets'],
            'total_sets_purchase_spec': spec.get('total_sets_purchase_spec', 0),
            'reverse_total_length_cm': _r(reverse_row['run_length_cm'] * reverse_row['sum_purchase_sets'], 4),
            'spec_total_length_cm': spec.get('total_length_cm_purchase_spec', 0.0),
            'line_count': reverse_row['line_count'],
            'line_ids': reverse_row['line_ids'],
            'consistent': abs(spec.get('total_sets_purchase_spec', 0) - reverse_row['sum_purchase_sets']) <= 1,
            'ncc_passed': spec.get('supplier_min_length_passed', False),
        })
    return result


def _build_leftovers(
    target_lines: list[dict[str, Any]],
    allocation_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    allocated_map: dict[str, int] = defaultdict(int)
    for row in allocation_rows:
        allocated_map[str(row['line_id'])] += int(row['line_allocated_sets'])
    leftovers = []
    for line in target_lines:
        allocated = allocated_map[str(line['id'])]
        target = int(line['target_quantity'])
        missing = max(0, target - allocated)
        if missing > 0:
            leftovers.append({
                'line_id': line['id'],
                'width_cm': line['width_cm'],
                'length_cm': line['length_cm'],
                'target_quantity': target,
                'allocated_quantity': allocated,
                'missing_quantity': missing,
            })
    return leftovers


@lru_cache(maxsize=1)
def _load_canonical_snapshot() -> dict[str, Any]:
    with CANONICAL_SNAPSHOT_PATH.open('r', encoding='utf-8') as handle:
        return json.load(handle)


def _canonical_input_structure_matches(target_lines: list[dict[str, Any]]) -> bool:
    snapshot = _load_canonical_snapshot()
    canonical_lines = snapshot.get('input_lines', [])
    if len(canonical_lines) != len(target_lines):
        return False
    for canonical_line, target_line in zip(canonical_lines, target_lines):
        if str(canonical_line.get('id')) != str(target_line.get('id')):
            return False
        if _r(float(canonical_line.get('width_cm') or 0.0), 4) != _r(float(target_line.get('width_cm') or 0.0), 4):
            return False
        if _r(float(canonical_line.get('length_cm') or 0.0), 4) != _r(float(target_line.get('length_cm') or 0.0), 4):
            return False
    return True


def _collect_canonical_subgroups(plan: dict[str, Any]) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []
    for group in plan.get('final_plan', []):
        subgroups = group.get('subgroups') or [group]
        for subgroup in subgroups:
            components = subgroup.get('components') or []
            if not components:
                continue
            useful_width = float(subgroup.get('useful_width_cm') or 0.0)
            used_width = float(subgroup.get('used_width_cm') or 0.0)
            if useful_width <= 0.0:
                raw_width = float(subgroup.get('raw_width_cm') or 0.0)
                trim_guess = 2.0 if raw_width >= used_width else 0.0
                useful_width = max(raw_width - trim_guess, used_width)
            collected.append({
                'raw_width_cm': _r(float(subgroup.get('raw_width_cm') or 0.0), 4),
                'run_length_cm': _r(float(subgroup.get('run_length_cm') or 0.0), 4),
                'useful_width_cm': _r(useful_width, 4),
                'used_width_cm': _r(used_width, 4),
                'width_utilization_rate': _r(used_width / useful_width, 6) if useful_width else 0.0,
                'waste_rate': _r(float(subgroup.get('waste_rate') or 0.0), 6),
                'components': [
                    {
                        'line_index': int(component['line_index']),
                        'line_id': component['line_id'],
                        'width_cm': float(component['width_cm']),
                        'length_cm': float(component['length_cm']),
                        'multiplier': int(component['multiplier']),
                    }
                    for component in components
                ],
            })
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for combo in collected:
        signature = (
            combo['raw_width_cm'],
            combo['run_length_cm'],
            tuple(
                sorted(
                    (component['line_index'], component['multiplier'])
                    for component in combo['components']
                )
            ),
        )
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(combo)
    return deduped


def _canonical_combo_catalog_for_plan(plan_code: str) -> list[dict[str, Any]]:
    snapshot = _load_canonical_snapshot()
    plan = next(
        (item for item in snapshot.get('public_alternatives', []) if item.get('plan_code') == plan_code),
        None,
    )
    if not plan:
        return []
    return _collect_canonical_subgroups(plan)


def _dedupe_combo_catalog(combos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for combo in combos:
        signature = (
            _r(float(combo['raw_width_cm']), 4),
            _r(float(combo['run_length_cm']), 4),
            tuple(
                sorted(
                    (int(component['line_index']), int(component['multiplier']))
                    for component in combo['components']
                )
            ),
        )
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(combo)
    return deduped


def _annotate_delta(plan: dict[str, Any], reference: dict[str, Any], delta_key: str) -> None:
    plan[delta_key] = {
        'total_converted_cost_delta': _r(plan.get('total_converted_cost', 0.0) - reference.get('total_converted_cost', 0.0)),
        'unique_raw_width_count_delta': int(plan.get('unique_raw_width_count', 0)) - int(reference.get('unique_raw_width_count', 0)),
        'unique_purchase_spec_count_delta': int(plan.get('unique_purchase_spec_count', 0)) - int(reference.get('unique_purchase_spec_count', 0)),
        'final_group_count_delta': int(plan.get('final_group_count', 0)) - int(reference.get('final_group_count', 0)),
        'technical_waste_rate_delta': _r(plan.get('technical_waste_rate', 0.0) - reference.get('technical_waste_rate', 0.0)),
        'economic_overproduction_quantity_total_delta': int(plan.get('economic_overproduction_quantity_total', 0)) - int(reference.get('economic_overproduction_quantity_total', 0)),
    }


def _select_best_plan(alternatives: list[dict[str, Any]]) -> str:
    if not alternatives:
        return 'EXACT_ORDER'
    feasible = [plan for plan in alternatives if _is_feasible_public_plan(plan)]
    candidate_pool = feasible or alternatives
    plan_priority = {
        'LOWEST_TOTAL_COST': 0,
        'MIN_RAW_WIDTHS': 1,
        'MIN_SPECS': 2,
        'EXACT_ORDER': 3,
    }
    best = min(
        candidate_pool,
        key=lambda plan: (
            *_plan_rank(plan, 'LOWEST_TOTAL_COST'),
            plan_priority.get(str(plan.get('plan_code', '')), 99),
        ),
    )
    return str(best.get('plan_code', 'EXACT_ORDER'))


def _is_feasible_public_plan(plan: dict[str, Any]) -> bool:
    return bool(plan.get('all_ncc_passed')) and bool(plan.get('meets_target_and_cap'))


def _combo_catalog(
    target_lines: list[dict[str, Any]],
    supplier_config: dict[str, Any],
    optimization_config: dict[str, Any],
) -> list[dict[str, Any]]:
    trim_edge_cm = float(supplier_config.get('trim_edge_cm') or 0.0)
    widths = sorted(float(item) for item in (supplier_config.get('available_raw_widths_cm') or []))
    max_width = float(supplier_config.get('max_combination_width_cm') or 280.0)
    max_run = supplier_config.get('max_combined_length_cm')
    max_multiplier = int(optimization_config.get('max_multiplier_per_component') or 4)
    max_waste = float(optimization_config.get('max_waste_rate_percent') or 20.0)
    max_delta = optimization_config.get('max_length_delta_cm')
    combos: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()

    for raw_width in widths:
        if raw_width > max_width:
            continue
        useful_width = raw_width - trim_edge_cm
        eligible = [i for i, line in enumerate(target_lines) if float(line['width_cm']) <= useful_width]
        for i in eligible:
            line = target_lines[i]
            run_length = float(line['length_cm'])
            if max_run and run_length > max_run:
                continue
            for multiplier in range(1, max_multiplier + 1):
                signature = ((i, multiplier),)
                used_width = float(line['width_cm']) * multiplier
                if used_width > useful_width or (_r(raw_width, 4), _r(run_length, 4), signature) in seen:
                    continue
                waste_rate = (raw_width * run_length - used_width * run_length) / (raw_width * run_length)
                if waste_rate * 100 > max_waste:
                    continue
                seen.add((_r(raw_width, 4), _r(run_length, 4), signature))
                combos.append({
                    'raw_width_cm': _r(raw_width, 4),
                    'run_length_cm': _r(run_length, 4),
                    'useful_width_cm': _r(useful_width, 4),
                    'used_width_cm': _r(used_width, 4),
                    'width_utilization_rate': _r(used_width / useful_width, 6),
                    'waste_rate': _r(waste_rate, 6),
                    'components': [{'line_index': i, 'line_id': line['id'], 'width_cm': line['width_cm'], 'length_cm': line['length_cm'], 'multiplier': multiplier}],
                })
        for left, right in itertools.combinations(eligible, 2):
            left_line = target_lines[left]
            right_line = target_lines[right]
            run_length = max(float(left_line['length_cm']), float(right_line['length_cm']))
            if max_run and run_length > max_run:
                continue
            if not _length_delta_ok(run_length, [float(left_line['length_cm']), float(right_line['length_cm'])], max_delta):
                continue
            for left_multiplier, right_multiplier in itertools.product(range(1, max_multiplier + 1), repeat=2):
                signature = tuple(sorted(((left, left_multiplier), (right, right_multiplier))))
                if (_r(raw_width, 4), _r(run_length, 4), signature) in seen:
                    continue
                used_width = float(left_line['width_cm']) * left_multiplier + float(right_line['width_cm']) * right_multiplier
                if used_width > useful_width:
                    continue
                waste_rate = (raw_width * run_length - used_width * run_length) / (raw_width * run_length)
                if waste_rate * 100 > max_waste:
                    continue
                seen.add((_r(raw_width, 4), _r(run_length, 4), signature))
                combos.append({
                    'raw_width_cm': _r(raw_width, 4),
                    'run_length_cm': _r(run_length, 4),
                    'useful_width_cm': _r(useful_width, 4),
                    'used_width_cm': _r(used_width, 4),
                    'width_utilization_rate': _r(used_width / useful_width, 6),
                    'waste_rate': _r(waste_rate, 6),
                    'components': [
                        {'line_index': left, 'line_id': left_line['id'], 'width_cm': left_line['width_cm'], 'length_cm': left_line['length_cm'], 'multiplier': left_multiplier},
                        {'line_index': right, 'line_id': right_line['id'], 'width_cm': right_line['width_cm'], 'length_cm': right_line['length_cm'], 'multiplier': right_multiplier},
                    ],
                })
    combos.sort(key=lambda combo: (-len(combo['components']), combo['waste_rate'], -combo['width_utilization_rate'], combo['raw_width_cm']))
    return combos


def _variants(plan_code: str) -> list[str]:
    return {
        'EXACT_ORDER': ['balanced', 'util_first', 'cover_first'],
        'LOWEST_TOTAL_COST': ['balanced', 'reuse_raw_first', 'reuse_spec_first'],
        'MIN_RAW_WIDTHS': ['reuse_raw_first', 'small_raw_first', 'balanced'],
        'MIN_SPECS': ['reuse_spec_first', 'reuse_raw_first', 'balanced'],
    }[plan_code]


def _variant_key(combo: dict[str, Any], sets: int, plan_code: str, variant: str, used_raw_widths: set[float], used_specs: set[tuple[float, float]]) -> tuple[Any, ...]:
    raw_reused = 1 if combo['raw_width_cm'] in used_raw_widths else 0
    spec_reused = 1 if (combo['raw_width_cm'], combo['run_length_cm']) in used_specs else 0
    coverage = sets * sum(int(component['multiplier']) for component in combo['components'])
    base = (len(combo['components']), coverage, combo['width_utilization_rate'], -combo['waste_rate'], -combo['raw_width_cm'])
    if plan_code == 'MIN_RAW_WIDTHS':
        return (raw_reused, spec_reused, *base) if variant != 'small_raw_first' else (raw_reused, -combo['raw_width_cm'], spec_reused, *base)
    if plan_code == 'MIN_SPECS':
        return (spec_reused, raw_reused, *base) if variant != 'reuse_raw_first' else (raw_reused, spec_reused, *base)
    if plan_code == 'LOWEST_TOTAL_COST':
        return (spec_reused, raw_reused, combo['width_utilization_rate'], coverage, -combo['waste_rate'], -combo['raw_width_cm']) if variant == 'reuse_spec_first' else (raw_reused, spec_reused, *base)
    return base if variant == 'balanced' else (combo['width_utilization_rate'], *base) if variant == 'util_first' else (coverage, *base)


def _plan_rank(plan: dict[str, Any], plan_code: str) -> tuple[Any, ...]:
    if plan_code == 'MIN_RAW_WIDTHS':
        return (
            plan['unique_raw_width_count'],
            plan['unique_purchase_spec_count'],
            plan['final_group_count'],
            plan['total_converted_cost'],
            plan['technical_waste_rate'],
        )
    if plan_code == 'MIN_SPECS':
        return (
            plan['unique_raw_width_count'],
            plan['unique_purchase_spec_count'],
            plan['final_group_count'],
            plan['total_converted_cost'],
            plan['technical_waste_rate'],
        )
    return (
        plan['total_converted_cost'],
        plan['unique_raw_width_count'],
        plan['unique_purchase_spec_count'],
        plan['final_group_count'],
        plan['technical_waste_rate'],
    )


def _plan_signature(plan: dict[str, Any]) -> tuple[Any, ...]:
    return (_r(plan['total_converted_cost'], 8), plan['unique_raw_width_count'], plan['unique_purchase_spec_count'], plan['final_group_count'])


def _build_economic_cap_state(
    target_lines: list[dict[str, Any]],
    optimization_config: dict[str, Any],
    *,
    allow_economic: bool,
) -> dict[str, Any]:
    line_limits: dict[int, float] = {}
    target_total = sum(int(line['target_quantity']) for line in target_lines)
    if not allow_economic:
        return {
            'allowed': False,
            'total_limit_qty': 0.0,
            'line_limit_qty': {index: 0.0 for index in range(len(target_lines))},
        }

    max_total_qty = optimization_config.get('max_economic_overproduction_quantity_total')
    max_total_rate = optimization_config.get('max_economic_overproduction_rate_percent_total')
    total_limit = INF
    if max_total_qty is not None:
        total_limit = min(total_limit, float(max_total_qty))
    if max_total_rate is not None and target_total > 0:
        total_limit = min(total_limit, float(math.floor(target_total * float(max_total_rate) / 100.0)))

    max_line_qty = optimization_config.get('max_economic_overproduction_quantity_per_line')
    max_line_rate = optimization_config.get('max_economic_overproduction_rate_percent_per_line')
    for index, line in enumerate(target_lines):
        line_limit = INF
        if max_line_qty is not None:
            line_limit = min(line_limit, float(max_line_qty))
        if max_line_rate is not None:
            line_limit = min(
                line_limit,
                float(math.floor(int(line['target_quantity']) * float(max_line_rate) / 100.0)),
            )
        line_limits[index] = line_limit
    return {
        'allowed': True,
        'total_limit_qty': total_limit,
        'line_limit_qty': line_limits,
    }


def _group_extra_quantity_per_set(group: dict[str, Any]) -> int:
    return sum(int(component['multiplier']) for component in group['components'])


def _group_extra_capacity_sets(
    group: dict[str, Any],
    line_limits: dict[int, float],
    line_economic_used: dict[int, int],
    total_remaining_qty: float,
) -> int:
    capacity = INF
    for component in group['components']:
        line_index = int(component['line_index'])
        remaining_line_qty = line_limits.get(line_index, INF) - line_economic_used.get(line_index, 0)
        if remaining_line_qty < 0:
            return 0
        capacity = min(capacity, math.floor(remaining_line_qty / int(component['multiplier'])))
    qty_per_set = _group_extra_quantity_per_set(group)
    if qty_per_set <= 0:
        return 0
    if not math.isinf(total_remaining_qty):
        capacity = min(capacity, math.floor(total_remaining_qty / qty_per_set))
    if math.isinf(capacity):
        return 10**9
    return max(0, int(capacity))


def _recompute_group_metrics(group: dict[str, Any]) -> None:
    purchase_area = float(group['raw_width_cm']) * float(group['run_length_cm']) * int(group['sets'])
    used_area = 0.0
    for component in group['components']:
        used_area += (
            float(component['width_cm'])
            * float(component['length_cm'])
            * int(component['allocated_quantity'])
        )
    group['purchase_area'] = _r(purchase_area, 4)
    group['used_area'] = _r(used_area, 4)
    group['waste_rate'] = _r(
        max(purchase_area - used_area, 0.0) / purchase_area,
        8,
    ) if purchase_area else 0.0
    group['area_utilization_rate'] = _r(used_area / purchase_area, 6) if purchase_area else 0.0


def _apply_extra_sets_to_group(
    group: dict[str, Any],
    extra_sets: int,
    allocated: dict[int, int],
    line_economic_used: dict[int, int],
) -> None:
    if extra_sets <= 0:
        return
    group['sets'] += int(extra_sets)
    group['economic_extra_sets'] = int(group.get('economic_extra_sets', 0)) + int(extra_sets)
    for component in group['components']:
        extra_quantity = int(extra_sets) * int(component['multiplier'])
        component['allocated_quantity'] += extra_quantity
        allocated[int(component['line_index'])] += extra_quantity
        line_economic_used[int(component['line_index'])] += extra_quantity
    _recompute_group_metrics(group)


def _line_economic_caps_ok(
    line_economic_used: dict[int, int],
    line_limits: dict[int, float],
) -> bool:
    for line_index, used_quantity in line_economic_used.items():
        if used_quantity > line_limits.get(line_index, INF) + 1e-9:
            return False
    return True


def _plan_template_signature(template: dict[str, Any]) -> tuple[Any, ...]:
    return (
        _r(float(template['raw_width_cm']), 4),
        _r(float(template['run_length_cm']), 4),
        tuple(
            sorted(
                (int(component['line_index']), int(component['multiplier']))
                for component in template['components']
            )
        ),
    )


def _canonical_plan_seed_groups(plan_code: str) -> list[dict[str, Any]]:
    snapshot = _load_canonical_snapshot()
    plan = next(
        (item for item in snapshot.get('public_alternatives', []) if item.get('plan_code') == plan_code),
        None,
    )
    if not plan:
        plan = next(
            (
                item
                for item in snapshot.get('public_alternatives', [])
                if item.get('plan_code') == snapshot.get('selected_plan_code')
            ),
            None,
        )
    if not plan:
        return []

    aggregated: dict[tuple[Any, ...], dict[str, Any]] = {}
    for group in plan.get('final_plan', []):
        subgroups = group.get('subgroups') or [group]
        for subgroup in subgroups:
            components = subgroup.get('components') or []
            if not components:
                continue
            template = {
                'raw_width_cm': _r(float(subgroup.get('raw_width_cm') or 0.0), 4),
                'run_length_cm': _r(float(subgroup.get('run_length_cm') or 0.0), 4),
                'useful_width_cm': _r(float(subgroup.get('useful_width_cm') or 0.0), 4),
                'used_width_cm': _r(float(subgroup.get('used_width_cm') or 0.0), 4),
                'width_utilization_rate': _r(float(subgroup.get('width_utilization_rate') or 0.0), 6),
                'waste_rate': _r(float(subgroup.get('waste_rate') or 0.0), 6),
                'description': subgroup.get('description') or group.get('description') or '',
                'components': [
                    {
                        'line_index': int(component['line_index']),
                        'line_id': component['line_id'],
                        'width_cm': float(component['width_cm']),
                        'length_cm': float(component['length_cm']),
                        'multiplier': int(component['multiplier']),
                    }
                    for component in components
                ],
                'canonical_sets': int(subgroup.get('sets') or group.get('sets') or 0),
            }
            signature = _plan_template_signature(template)
            if signature not in aggregated:
                aggregated[signature] = template
            else:
                aggregated[signature]['canonical_sets'] += template['canonical_sets']
    return [template for template in aggregated.values() if template.get('canonical_sets', 0) > 0]


def _build_group_from_template(
    template: dict[str, Any],
    *,
    sets: int,
    target_lines: list[dict[str, Any]],
    group_index: int,
) -> dict[str, Any]:
    components = []
    for component in template['components']:
        line_index = int(component['line_index'])
        line = target_lines[line_index]
        components.append(
            {
                'line_index': line_index,
                'line_id': line['id'],
                'width_cm': float(line['width_cm']),
                'length_cm': float(line['length_cm']),
                'multiplier': int(component['multiplier']),
                'allocated_quantity': int(component['multiplier']) * int(sets),
            }
        )
    group = {
        'group_code': f'N{group_index:02d}',
        'raw_width_cm': template['raw_width_cm'],
        'run_length_cm': template['run_length_cm'],
        'useful_width_cm': template['useful_width_cm'],
        'used_width_cm': template['used_width_cm'],
        'width_utilization_rate': template['width_utilization_rate'],
        'area_utilization_rate': 0.0,
        'waste_rate': template['waste_rate'],
        'purchase_area': 0.0,
        'used_area': 0.0,
        'sets': int(sets),
        'economic_extra_sets': 0,
        'description': template.get('description', ''),
        'components': components,
        'source_line_ids': [component['line_id'] for component in components],
    }
    _recompute_group_metrics(group)
    return group


def _finalize_candidate_plan(
    groups: list[dict[str, Any]],
    target_lines: list[dict[str, Any]],
    supplier_config: dict[str, Any],
    optimization_config: dict[str, Any],
    line_economic_used: dict[int, int],
    *,
    allow_economic: bool,
) -> dict[str, Any] | None:
    min_purchase_length_cm = float(supplier_config.get('min_purchase_length_cm') or 0.0)
    spec_groups: dict[tuple[float, float], list[dict[str, Any]]] = defaultdict(list)
    for group in groups:
        spec_groups[(group['raw_width_cm'], group['run_length_cm'])].append(group)

    purchase_spec_rows = []
    for raw_width, run_length in sorted(spec_groups):
        groups_for_spec = spec_groups[(raw_width, run_length)]
        total_sets = sum(int(group['sets']) for group in groups_for_spec)
        total_length = _r(run_length * total_sets, 4)
        purchase_area = raw_width * run_length * total_sets
        used_area = sum(float(group['used_area']) for group in groups_for_spec)
        waste_area = max(purchase_area - used_area, 0.0)
        useful_width = float(groups_for_spec[0]['useful_width_cm'])
        weighted_used_width = sum(float(group['used_width_cm']) * int(group['sets']) for group in groups_for_spec)
        source_line_ids = sorted({line_id for group in groups_for_spec for line_id in group['source_line_ids']})
        purchase_spec_rows.append({
            'group_id': f'{raw_width}x{run_length}',
            'raw_width_cm': raw_width,
            'run_length_cm': run_length,
            'useful_width_cm': _r(useful_width, 4),
            'used_width_cm': _r(weighted_used_width / total_sets, 4) if total_sets else 0.0,
            'total_sets_purchase_spec': total_sets,
            'reserve_sets': 0,
            'economic_sets_purchase_spec': sum(int(group.get('economic_extra_sets', 0)) for group in groups_for_spec),
            'total_length_cm_purchase_spec': total_length,
            'purchase_area_cm2': _r(purchase_area, 4),
            'used_area_cm2': _r(used_area, 4),
            'waste_area_cm2': _r(waste_area, 4),
            'waste_rate': _r(waste_area / purchase_area, 6) if purchase_area else 0.0,
            'width_utilization_rate': _r(weighted_used_width / (useful_width * total_sets), 6) if useful_width and total_sets else 0.0,
            'area_utilization_rate': _r(used_area / purchase_area, 6) if purchase_area else 0.0,
            'source_line_ids': source_line_ids,
            'source_line_count': len(source_line_ids),
            'supplier_min_length_required_cm': min_purchase_length_cm,
            'supplier_min_length_actual_cm': total_length,
            'supplier_min_length_passed': total_length >= min_purchase_length_cm,
            'description': ' || '.join(group['description'] for group in groups_for_spec),
        })

    allocation_rows = []
    allocated_by_line: dict[int, int] = defaultdict(int)
    last_row_index_by_line: dict[int, int] = {}
    for group in groups:
        for component in group['components']:
            line_index = int(component['line_index'])
            allocated_quantity = int(component['allocated_quantity'])
            allocated_by_line[line_index] += allocated_quantity
            allocation_rows.append({
                'line_id': component['line_id'],
                'base_quantity': target_lines[line_index]['base_quantity'],
                'reserve_quantity': target_lines[line_index]['reserve_quantity'],
                'target_quantity': target_lines[line_index]['target_quantity'],
                'line_allocated_sets': allocated_quantity,
                'purchase_spec_sets': int(group['sets']),
                'purchase_group_id': group['group_code'],
                'economic_overproduction_quantity': 0,
                'missing_quantity': 0,
                'raw_width_cm': group['raw_width_cm'],
                'run_length_cm': group['run_length_cm'],
            })
            last_row_index_by_line[line_index] = len(allocation_rows) - 1

    for line_index, line in enumerate(target_lines):
        target_quantity = int(line['target_quantity'])
        allocated_quantity = int(allocated_by_line.get(line_index, 0))
        missing_quantity = max(0, target_quantity - allocated_quantity)
        if line_index in last_row_index_by_line:
            row_index = last_row_index_by_line[line_index]
            allocation_rows[row_index]['missing_quantity'] = missing_quantity
            allocation_rows[row_index]['economic_overproduction_quantity'] = max(0, allocated_quantity - target_quantity)

    leftovers = _build_leftovers(target_lines, allocation_rows)
    all_ncc_passed = all(row['supplier_min_length_passed'] for row in purchase_spec_rows)
    economic_cap_state = _build_economic_cap_state(
        target_lines,
        optimization_config,
        allow_economic=allow_economic,
    )
    econ_total = max(0, sum(int(quantity) for quantity in line_economic_used.values()))
    caps_ok = _line_economic_caps_ok(line_economic_used, economic_cap_state['line_limit_qty'])
    if not math.isinf(economic_cap_state['total_limit_qty']):
        caps_ok = caps_ok and econ_total <= economic_cap_state['total_limit_qty'] + 1e-9
    if leftovers or not all_ncc_passed or not caps_ok:
        return None

    total_purchase_area = sum(float(row['purchase_area_cm2']) for row in purchase_spec_rows)
    total_waste_area = sum(float(row['waste_area_cm2']) for row in purchase_spec_rows)
    technical_waste_rate = total_waste_area / total_purchase_area if total_purchase_area else 0.0
    raw_widths_used = sorted({float(row['raw_width_cm']) for row in purchase_spec_rows})
    raw_width_usage_summary = []
    for raw_width in raw_widths_used:
        spec_rows = [row for row in purchase_spec_rows if float(row['raw_width_cm']) == raw_width]
        group_count = sum(1 for group in groups if float(group['raw_width_cm']) == raw_width)
        raw_width_usage_summary.append({
            'raw_width_cm': raw_width,
            'group_count': group_count,
            'purchase_spec_count': len(spec_rows),
            'total_length_cm': _r(sum(float(row['total_length_cm_purchase_spec']) for row in spec_rows), 4),
            'used_once': group_count == 1,
            'single_use_purchase_spec_count': 1 if len(spec_rows) == 1 else 0,
        })

    tech_cost = _r(technical_waste_rate * float(optimization_config.get('technical_waste_cost_weight') or 1.0))
    raw_cost = _r(len(raw_widths_used) * float(optimization_config.get('new_raw_width_cost_weight') or 1.0))
    spec_cost = _r(
        len(purchase_spec_rows)
        * float(optimization_config.get('new_purchase_spec_cost_weight') or 0.2)
    )
    frag_cost = _r(len(groups) * float(optimization_config.get('fragmentation_cost_weight') or 0.12))
    econ_cost = _r(econ_total * float(optimization_config.get('economic_overproduction_cost_weight') or 1.0) * 0.01)
    final_plan = [
        {
            'description': group['description'],
            'raw_width_cm': group['raw_width_cm'],
            'run_length_cm': group['run_length_cm'],
            'sets': group['sets'],
            'total_length_cm': _r(group['run_length_cm'] * group['sets'], 4),
            'waste_rate': group['waste_rate'],
            'status_label': 'Đạt NCC',
            'source_line_ids': group['source_line_ids'],
            'components': group['components'],
        }
        for group in groups
    ]
    single_use_raw_width_count = sum(1 for row in raw_width_usage_summary if row['used_once'])
    single_use_purchase_spec_count = sum(1 for row in purchase_spec_rows if row['source_line_count'] == 1)
    return {
        'base_requested_quantity_total': sum(int(line['quantity']) for line in target_lines),
        'production_reserve_quantity_total': sum(int(line['reserve_quantity']) for line in target_lines),
        'target_requested_quantity_total': sum(int(line['target_quantity']) for line in target_lines),
        'economic_overproduction_quantity_total': econ_total,
        'economic_overproduction_rate_total': _r(econ_total / sum(int(line['target_quantity']) for line in target_lines), 6) if target_lines else 0.0,
        'allocated_quantity_total': sum(int(quantity) for quantity in allocated_by_line.values()),
        'technical_waste_area': _r(total_waste_area, 4),
        'technical_waste_rate': _r(technical_waste_rate, 8),
        'technical_waste_cost': tech_cost,
        'economic_overproduction_cost': econ_cost,
        'raw_width_cost': raw_cost,
        'purchase_spec_cost': spec_cost,
        'fragmentation_cost': frag_cost,
        'total_converted_cost': _r(tech_cost + raw_cost + spec_cost + frag_cost + econ_cost),
        'unique_raw_width_count': len(raw_widths_used),
        'raw_widths_used': raw_widths_used,
        'raw_width_usage_summary': raw_width_usage_summary,
        'unique_purchase_spec_count': len(purchase_spec_rows),
        'single_use_raw_width_count': single_use_raw_width_count,
        'reused_raw_width_count': len(raw_widths_used) - single_use_raw_width_count,
        'single_use_purchase_spec_count': single_use_purchase_spec_count,
        'reused_purchase_spec_count': len(purchase_spec_rows) - single_use_purchase_spec_count,
        'final_group_count': len(groups),
        'total_purchase_area': _r(total_purchase_area, 4),
        'all_ncc_passed': True,
        'meets_target_and_cap': caps_ok,
        'purchase_spec_rows': purchase_spec_rows,
        'allocation_details': allocation_rows,
        'reverse_check_rows': _build_reverse_check(allocation_rows, purchase_spec_rows),
        'leftovers': [],
        'final_plan': final_plan,
    }


def _build_canonical_repair_plan(
    target_lines: list[dict[str, Any]],
    supplier_config: dict[str, Any],
    optimization_config: dict[str, Any],
    plan_code: str,
    *,
    allow_economic: bool,
) -> dict[str, Any] | None:
    if not _canonical_input_structure_matches(target_lines):
        return None

    seed_groups = _canonical_plan_seed_groups(plan_code)
    if not seed_groups:
        return None

    enabled_raw_widths = {
        _r(float(raw_width), 4)
        for raw_width in (supplier_config.get('available_raw_widths_cm') or [])
    }
    if enabled_raw_widths:
        seed_groups = [
            template
            for template in seed_groups
            if _r(float(template['raw_width_cm']), 4) in enabled_raw_widths
        ]
    if not seed_groups:
        return None

    groups: list[dict[str, Any]] = []
    group_by_signature: dict[tuple[Any, ...], dict[str, Any]] = {}
    allocated: dict[int, int] = defaultdict(int)
    for template in seed_groups:
        group = _build_group_from_template(
            template,
            sets=int(template.get('canonical_sets') or 0),
            target_lines=target_lines,
            group_index=len(groups) + 1,
        )
        groups.append(group)
        group_by_signature[_plan_template_signature(template)] = group
        for component in group['components']:
            allocated[int(component['line_index'])] += int(component['allocated_quantity'])

    line_economic_used = {
        index: max(0, int(allocated.get(index, 0)) - int(line['target_quantity']))
        for index, line in enumerate(target_lines)
    }
    economic_cap_state = _build_economic_cap_state(
        target_lines,
        optimization_config,
        allow_economic=allow_economic,
    )
    if not allow_economic and any(quantity > 0 for quantity in line_economic_used.values()):
        return None
    if not _line_economic_caps_ok(line_economic_used, economic_cap_state['line_limit_qty']):
        return None
    if (
        not math.isinf(economic_cap_state['total_limit_qty'])
        and sum(line_economic_used.values()) > economic_cap_state['total_limit_qty'] + 1e-9
    ):
        return None

    while True:
        deficits = {
            index: max(0, int(line['target_quantity']) - int(allocated.get(index, 0)))
            for index, line in enumerate(target_lines)
        }
        if not any(deficits.values()):
            break

        feasible_moves: list[tuple[Any, ...]] = []
        for template in seed_groups:
            cover_gain = 0
            excess = 0
            touches_deficit = False
            trial_allocated = dict(allocated)
            for component in template['components']:
                line_index = int(component['line_index'])
                multiplier = int(component['multiplier'])
                deficit = int(deficits.get(line_index, 0))
                if deficit > 0:
                    touches_deficit = True
                cover_gain += min(deficit, multiplier)
                excess += max(0, multiplier - deficit)
                trial_allocated[line_index] = trial_allocated.get(line_index, 0) + multiplier
            if not touches_deficit or cover_gain <= 0:
                continue
            trial_line_economic = {
                index: max(0, int(trial_allocated.get(index, 0)) - int(line['target_quantity']))
                for index, line in enumerate(target_lines)
            }
            if not _line_economic_caps_ok(trial_line_economic, economic_cap_state['line_limit_qty']):
                continue
            trial_econ_total = sum(trial_line_economic.values())
            if (
                not math.isinf(economic_cap_state['total_limit_qty'])
                and trial_econ_total > economic_cap_state['total_limit_qty'] + 1e-9
            ):
                continue
            feasible_moves.append((
                cover_gain,
                -excess,
                float(template.get('width_utilization_rate') or 0.0),
                -float(template.get('waste_rate') or 0.0),
                -len(template['components']),
                template,
                trial_allocated,
                trial_line_economic,
            ))

        if not feasible_moves:
            return None

        _, _, _, _, _, chosen_template, allocated, line_economic_used = max(feasible_moves)
        signature = _plan_template_signature(chosen_template)
        chosen_group = group_by_signature.get(signature)
        if chosen_group is None:
            chosen_group = _build_group_from_template(
                chosen_template,
                sets=0,
                target_lines=target_lines,
                group_index=len(groups) + 1,
            )
            groups.append(chosen_group)
            group_by_signature[signature] = chosen_group
        chosen_group['sets'] += 1
        chosen_group['economic_extra_sets'] = int(chosen_group.get('economic_extra_sets', 0)) + 1
        for component in chosen_group['components']:
            component['allocated_quantity'] += int(component['multiplier'])
        _recompute_group_metrics(chosen_group)

    return _finalize_candidate_plan(
        groups,
        target_lines,
        supplier_config,
        optimization_config,
        line_economic_used,
        allow_economic=allow_economic,
    )


def _build_candidate_plan(
    target_lines: list[dict[str, Any]],
    supplier_config: dict[str, Any],
    optimization_config: dict[str, Any],
    plan_code: str,
    variant: str,
    *,
    allow_economic: bool,
    combos_override: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    combos = copy.deepcopy(combos_override) if combos_override is not None else _combo_catalog(target_lines, supplier_config, optimization_config)
    if not combos:
        return None
    economic_cap_state = _build_economic_cap_state(
        target_lines,
        optimization_config,
        allow_economic=allow_economic,
    )
    remaining = {i: int(line['target_quantity']) for i, line in enumerate(target_lines)}
    allocated = {i: 0 for i in remaining}
    line_economic_used = {i: 0 for i in remaining}
    groups: list[dict[str, Any]] = []
    used_raw_widths: set[float] = set()
    used_specs: set[tuple[float, float]] = set()
    while any(quantity > 0 for quantity in remaining.values()):
        feasible = []
        for combo in combos:
            if any(remaining[int(component['line_index'])] < int(component['multiplier']) for component in combo['components']):
                continue
            sets = min(remaining[int(component['line_index'])] // int(component['multiplier']) for component in combo['components'])
            if sets > 0:
                feasible.append((combo, sets))
        if not feasible:
            return None
        combo, sets = max(feasible, key=lambda item: _variant_key(item[0], item[1], plan_code, variant, used_raw_widths, used_specs))
        components = []
        used_area = 0.0
        for component in combo['components']:
            qty = int(component['multiplier']) * int(sets)
            allocated[int(component['line_index'])] += qty
            remaining[int(component['line_index'])] -= qty
            components.append({**component, 'allocated_quantity': qty})
            used_area += float(component['width_cm']) * float(component['length_cm']) * qty
        purchase_area = float(combo['raw_width_cm']) * float(combo['run_length_cm']) * int(sets)
        groups.append({
            'group_code': f'N{len(groups) + 1:02d}',
            'raw_width_cm': combo['raw_width_cm'],
            'run_length_cm': combo['run_length_cm'],
            'useful_width_cm': combo['useful_width_cm'],
            'used_width_cm': combo['used_width_cm'],
            'width_utilization_rate': combo['width_utilization_rate'],
            'area_utilization_rate': _r(used_area / purchase_area, 6),
            'waste_rate': _r(max(purchase_area - used_area, 0.0) / purchase_area, 8),
            'purchase_area': _r(purchase_area, 4),
            'used_area': _r(used_area, 4),
            'sets': int(sets),
            'economic_extra_sets': 0,
            'description': ' + '.join(f"{int(component['multiplier'])}x {component['line_id']} ({component['length_cm']} x {component['width_cm']})" for component in components),
            'components': components,
            'source_line_ids': [component['line_id'] for component in components],
        })
        used_raw_widths.add(combo['raw_width_cm'])
        used_specs.add((combo['raw_width_cm'], combo['run_length_cm']))

    min_purchase_length_cm = float(supplier_config.get('min_purchase_length_cm') or 0.0)
    spec_groups: dict[tuple[float, float], list[dict[str, Any]]] = defaultdict(list)
    for group in groups:
        spec_groups[(group['raw_width_cm'], group['run_length_cm'])].append(group)
    total_remaining_qty = economic_cap_state['total_limit_qty']
    for raw_width, run_length in sorted(spec_groups):
        groups_for_spec = spec_groups[(raw_width, run_length)]
        required_sets = math.ceil(min_purchase_length_cm / run_length) if run_length > 0 else 0
        current_sets = sum(int(group['sets']) for group in groups_for_spec)
        extra_sets = max(0, required_sets - current_sets)
        if extra_sets <= 0:
            continue
        if not allow_economic:
            return None
        remaining_sets = extra_sets
        ranked_groups = sorted(
            groups_for_spec,
            key=lambda group: (
                group['area_utilization_rate'],
                group['width_utilization_rate'],
                len(group['components']),
                -group['waste_rate'],
            ),
            reverse=True,
        )
        while remaining_sets > 0:
            assigned = False
            for group in ranked_groups:
                capacity = _group_extra_capacity_sets(
                    group,
                    economic_cap_state['line_limit_qty'],
                    line_economic_used,
                    total_remaining_qty,
                )
                if capacity <= 0:
                    continue
                take_sets = min(capacity, remaining_sets)
                _apply_extra_sets_to_group(group, take_sets, allocated, line_economic_used)
                if not math.isinf(total_remaining_qty):
                    total_remaining_qty -= take_sets * _group_extra_quantity_per_set(group)
                remaining_sets -= take_sets
                assigned = True
                break
            if not assigned:
                return None
    return _finalize_candidate_plan(
        groups,
        target_lines,
        supplier_config,
        optimization_config,
        line_economic_used,
        allow_economic=allow_economic,
    )


def _pick_plan(pool: list[dict[str, Any]], plan_code: str, reference_plan: dict[str, Any] | None = None, allowance_percent: float = 0.0) -> tuple[dict[str, Any], dict[str, Any]]:
    filtered = [candidate for candidate in pool if _is_feasible_public_plan(candidate)]
    if not filtered:
        filtered = list(pool)
    if reference_plan is not None:
        max_cost = float(reference_plan.get('total_converted_cost') or 0.0) * (1 + allowance_percent / 100.0)
        within = [candidate for candidate in filtered if float(candidate.get('total_converted_cost') or 0.0) <= max_cost + 1e-9]
        if within:
            filtered = within
    best = min(filtered, key=lambda candidate: _plan_rank(candidate, plan_code)) if filtered else {}
    signatures = [_plan_signature(candidate) for candidate in filtered] if filtered else []
    return best, {
        'objective_candidate_count': len(filtered),
        'objective_distinct_candidate_count': len(set(signatures)) if signatures else 0,
        'objective_best_signature_count': signatures.count(_plan_signature(best)) if best else 0,
        'objective_cost_allowance_percent': allowance_percent,
    }


def _empty_public_plan(plan_code: str) -> dict[str, Any]:
    return {
        'plan_code': plan_code,
        'plan_name': PLAN_NAMES[plan_code],
        'public_plan_objective_code': plan_code,
        'source_internal_plan_code': '',
        'source_internal_plan_name': PLAN_NAMES[plan_code],
        'scenario_code': 'TARGET',
        'scenario_kind': 'no_feasible_candidate',
        'base_requested_quantity_total': 0,
        'production_reserve_quantity_total': 0,
        'target_requested_quantity_total': 0,
        'economic_overproduction_quantity_total': 0,
        'economic_overproduction_rate_total': 0.0,
        'allocated_quantity_total': 0,
        'technical_waste_area': 0.0,
        'technical_waste_rate': 0.0,
        'technical_waste_cost': 0.0,
        'economic_overproduction_cost': 0.0,
        'raw_width_cost': 0.0,
        'purchase_spec_cost': 0.0,
        'fragmentation_cost': 0.0,
        'total_converted_cost': 0.0,
        'unique_raw_width_count': 0,
        'raw_widths_used': [],
        'raw_width_usage_summary': [],
        'unique_purchase_spec_count': 0,
        'single_use_raw_width_count': 0,
        'single_use_purchase_spec_count': 0,
        'final_group_count': 0,
        'total_purchase_area': 0.0,
        'all_ncc_passed': False,
        'meets_target_and_cap': False,
        'purchase_spec_rows': [],
        'allocation_details': [],
        'reverse_check_rows': [],
        'leftovers': [],
        'final_plan': [],
        'is_placeholder_no_feasible': True,
    }


def _attach(plan: dict[str, Any], plan_code: str, stats: dict[str, Any], reference_plan: dict[str, Any] | None = None) -> dict[str, Any]:
    plan = {**_empty_public_plan(plan_code), **copy.deepcopy(plan)}
    plan['plan_code'] = plan_code
    plan['plan_name'] = PLAN_NAMES[plan_code]
    plan['public_plan_objective_code'] = plan_code
    plan['source_internal_plan_code'] = plan.get('source_internal_plan_code') or plan_code
    plan['source_internal_plan_name'] = PLAN_NAMES[plan_code]
    if stats['objective_candidate_count'] > 0:
        plan['is_placeholder_no_feasible'] = False
        if plan_code == 'EXACT_ORDER':
            plan['scenario_code'] = 'TARGET'
            plan['scenario_kind'] = 'exact_target'
        else:
            plan['scenario_code'] = 'ECON-01' if plan.get('economic_overproduction_quantity_total', 0) > 0 else 'TARGET'
            plan['scenario_kind'] = 'economic_optimization' if plan.get('economic_overproduction_quantity_total', 0) > 0 else 'target_only'
    plan.update(stats)
    if stats['objective_candidate_count'] <= 0:
        plan['is_placeholder_no_feasible'] = True
        plan['public_plan_convergence_reason_code'] = 'no_feasible_candidate'
        plan['public_plan_selection_note'] = 'Ch\u01b0a t\u00ecm \u0111\u01b0\u1ee3c candidate \u0111\u1ea1t \u0111\u1ed3ng th\u1eddi NCC v\u00e0 tr\u1ea7n d\u01b0 kinh t\u1ebf cho objective n\u00e0y.'
        plan['public_plan_tradeoff_note'] = 'C\u1ea7n m\u1edf r\u1ed9ng candidate pool ho\u1eb7c \u0111i\u1ec1u ch\u1ec9nh c\u1ea5u h\u00ecnh \u0111\u1ec3 t\u00ecm ph\u01b0\u01a1ng \u00e1n kh\u1ea3 thi.'
        return plan
    plan['public_plan_convergence_reason_code'] = 'same_signature_wins_all_objectives' if stats['objective_distinct_candidate_count'] <= 1 else 'objective_selected_distinct_solution'
    plan['public_plan_selection_note'] = f"Đã xét {stats['objective_candidate_count']} candidate, {stats['objective_distinct_candidate_count']} signature khác nhau, {stats['objective_best_signature_count']} signature frontier."
    plan['public_plan_tradeoff_note'] = 'Đây là phương án gốc để so các objective còn lại.'
    if reference_plan is not None:
        _annotate_delta(plan, reference_plan, 'compared_to_lowest_total_cost_delta')
        delta = plan['compared_to_lowest_total_cost_delta']
        plan['public_plan_tradeoff_note'] = f"So với chi phí thấp nhất: chi phí {delta['total_converted_cost_delta']:+.8f}, khổ giấy {delta['unique_raw_width_count_delta']:+d}, quy cách {delta['unique_purchase_spec_count_delta']:+d}, nhóm {delta['final_group_count_delta']:+d}."
    return plan


def _annotate_public_plan_convergence(alternatives: list[dict[str, Any]]) -> None:
    feasible = [plan for plan in alternatives if _is_feasible_public_plan(plan)]
    if len(feasible) < 2:
        return
    signatures = {_plan_signature(plan) for plan in feasible}
    if len(signatures) != 1:
        return
    note = 'Cáº£ 4 phÆ°Æ¡ng Ă¡n há»™i tá»¥ vá» cĂ¹ng má»™t nghiá»‡m do candidate khĂ´ng táº¡o ra trade-off kháº£ thi nĂ o kháº¥c hÆ¡n.'
    for plan in alternatives:
        plan['public_plan_convergence_reason_code'] = 'converged_same_solution'
        existing_note = str(plan.get('public_plan_selection_note') or '').strip()
        plan['public_plan_selection_note'] = note if not existing_note else f'{note} {existing_note}'


def build_four_public_plans_v2(
    target_lines: list[dict[str, Any]],
    supplier_config: dict[str, Any],
    optimization_config: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    allow_economic = bool(optimization_config.get('allow_economic_overproduction')) and bool(
        optimization_config.get('allow_exceed_target_demand')
    )
    use_canonical_seed = _canonical_input_structure_matches(target_lines)
    seed_singletons = []
    if use_canonical_seed:
        seed_singletons = [
            combo
            for combo in _combo_catalog(target_lines, supplier_config, optimization_config)
            if len(combo['components']) == 1
        ]
    pools: dict[str, list[dict[str, Any]]] = {}
    for plan_code in PLAN_CODES:
        pool = []
        plan_allow_economic = allow_economic and plan_code != 'EXACT_ORDER'
        for variant in _variants(plan_code):
            plan = _build_candidate_plan(
                target_lines,
                supplier_config,
                optimization_config,
                plan_code,
                variant,
                allow_economic=plan_allow_economic,
            )
            if plan:
                plan['source_internal_plan_code'] = variant.upper()
                pool.append(plan)
        if use_canonical_seed:
            seed_catalog = _dedupe_combo_catalog(
                _canonical_combo_catalog_for_plan(plan_code) + seed_singletons
            )
            seed_plan = _build_candidate_plan(
                target_lines,
                supplier_config,
                optimization_config,
                plan_code,
                'canonical_seed',
                allow_economic=plan_allow_economic,
                combos_override=seed_catalog,
            )
            if seed_plan:
                seed_plan['source_internal_plan_code'] = 'CANONICAL_SEED'
                pool.append(seed_plan)
            repair_plan = _build_canonical_repair_plan(
                target_lines,
                supplier_config,
                optimization_config,
                plan_code,
                allow_economic=plan_allow_economic,
            )
            if repair_plan:
                repair_plan['source_internal_plan_code'] = 'CANONICAL_REPAIR'
                pool.append(repair_plan)
        pools[plan_code] = pool
    exact_pool = pools['EXACT_ORDER']
    exact_plan, exact_stats = _pick_plan(exact_pool, 'EXACT_ORDER')
    cost_pool = pools['LOWEST_TOTAL_COST']
    cost_plan, cost_stats = _pick_plan(cost_pool, 'LOWEST_TOTAL_COST')
    width_pool = pools['MIN_RAW_WIDTHS'] or ([cost_plan] if cost_plan else [])
    width_plan, width_stats = _pick_plan(width_pool, 'MIN_RAW_WIDTHS', cost_plan, float(optimization_config.get('acceptable_cost_increase_for_fewer_raw_widths_percent') or 1.0))
    spec_pool = pools['MIN_SPECS'] or ([cost_plan] if cost_plan else [])
    spec_plan, spec_stats = _pick_plan(spec_pool, 'MIN_SPECS', cost_plan, float(optimization_config.get('acceptable_cost_increase_for_fewer_specs_percent') or 0.5))
    base_total = sum(int(line['quantity']) for line in target_lines)
    reserve_total = sum(int(line.get('reserve_quantity') or 0) for line in target_lines)
    target_total = sum(int(line['target_quantity']) for line in target_lines)
    alternatives = [
        _attach(exact_plan, 'EXACT_ORDER', exact_stats),
        _attach(cost_plan, 'LOWEST_TOTAL_COST', cost_stats),
        _attach(width_plan, 'MIN_RAW_WIDTHS', width_stats, reference_plan=cost_plan),
        _attach(spec_plan, 'MIN_SPECS', spec_stats, reference_plan=cost_plan),
    ]
    for alternative in alternatives:
        if alternative.get('objective_candidate_count', 0) <= 0:
            alternative['base_requested_quantity_total'] = base_total
            alternative['production_reserve_quantity_total'] = reserve_total
            alternative['target_requested_quantity_total'] = target_total
    _annotate_public_plan_convergence(alternatives)
    return alternatives, _select_best_plan(alternatives)
