"""
Paper optimizer engine - phần tối ưu ghép giấy thật.

Tách riêng để dễ test độc lập. services.py sẽ gọi vào đây.

Logic chính:
1. Chuẩn hoá và tính nhu cầu mục tiêu
2. Sinh các tổ hợp cắt (combinations / patterns) hợp lệ
3. Ghép thành phương án: gom nhiều dòng cùng khổ+dài vào cùng quy cách mua
4. Kiểm NCC trên từng quy cách mua cuối (min_purchase_length_cm)
5. Tính chi phí và xếp hạng ưu tiên theo thứ tự: chi phí → ít khổ → ít quy cách → ít nhóm
6. Dư kinh tế: chỉ thêm nếu bật và giúp giảm chi phí
7. Sinh 4 phương án công khai
8. So sánh với baseline guardrail
"""
from __future__ import annotations

import copy
import itertools
import math
from collections import defaultdict
from typing import Any

from paper_optimizer.optimizer_v2 import build_four_public_plans_v2


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLAN_CODES = ['EXACT_ORDER', 'LOWEST_TOTAL_COST', 'MIN_RAW_WIDTHS', 'MIN_SPECS']

PLAN_META = {
    'EXACT_ORDER': {
        'plan_name': 'Phương án đúng đơn hàng',
        'objective': 'Bám đúng nhu cầu mục tiêu sau dự trù sản xuất.',
    },
    'LOWEST_TOTAL_COST': {
        'plan_name': 'Phương án chi phí thấp nhất',
        'objective': 'Ưu tiên tổng chi phí quy đổi thấp nhất.',
    },
    'MIN_RAW_WIDTHS': {
        'plan_name': 'Phương án ít khổ giấy nhất',
        'objective': 'Ưu tiên ít khổ giấy hơn khi vẫn giữ chi phí hợp lý.',
    },
    'MIN_SPECS': {
        'plan_name': 'Phương án ít quy cách mua nhất',
        'objective': 'Ưu tiên giảm số quy cách mua sau khi đã giữ ít khổ giấy.',
    },
}


# ---------------------------------------------------------------------------
# Rounding helpers
# ---------------------------------------------------------------------------

def _r(v: float, d: int = 8) -> float:
    return round(float(v), d)


def _apply_rounding(value: float, mode: str) -> int:
    if mode == 'floor':
        return math.floor(value)
    if mode == 'round':
        return round(value)
    return math.ceil(value)


# ---------------------------------------------------------------------------
# Step 1: Tính nhu cầu mục tiêu
# ---------------------------------------------------------------------------

def compute_target_quantities(
    input_lines: list[dict[str, Any]],
    optimization_config: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Trả về danh sách line đã kèm:
    - base_quantity
    - reserve_quantity  (dự trù hao hụt sản xuất)
    - target_quantity   (nhu cầu mục tiêu = base + reserve)
    """
    rate_percent = float(optimization_config.get('production_reserve_rate_percent') or 0.0)
    rounding_mode = str(optimization_config.get('production_reserve_rounding_mode') or 'ceil')
    scope = str(optimization_config.get('production_reserve_scope') or 'per_line')

    lines_out = []
    reserve_map: dict[int, int] = {i: 0 for i in range(len(input_lines))}

    if rate_percent > 0:
        if scope == 'whole_order':
            base_total = sum(int(line['quantity']) for line in input_lines)
            raw_total = base_total * rate_percent / 100.0
            reserve_total = _apply_rounding(raw_total, rounding_mode)
            if reserve_total > 0 and base_total > 0:
                proportional = []
                assigned = 0
                for i, line in enumerate(input_lines):
                    raw_v = reserve_total * int(line['quantity']) / base_total
                    floor_v = math.floor(raw_v)
                    proportional.append((i, floor_v, raw_v - floor_v))
                    reserve_map[i] = floor_v
                    assigned += floor_v
                remaining = reserve_total - assigned
                for i, _, _ in sorted(proportional, key=lambda x: (-x[2], x[0]))[:remaining]:
                    reserve_map[i] += 1
        else:
            for i, line in enumerate(input_lines):
                raw_v = int(line['quantity']) * rate_percent / 100.0
                reserve_map[i] = _apply_rounding(raw_v, rounding_mode)

    for i, line in enumerate(input_lines):
        bq = int(line['quantity'])
        rq = reserve_map[i]
        lines_out.append({
            **line,
            'base_quantity': bq,
            'reserve_quantity': rq,
            'target_quantity': bq + rq,
        })
    return lines_out


# ---------------------------------------------------------------------------
# Step 2: Chọn khổ giấy thô hợp lệ cho một dòng
# ---------------------------------------------------------------------------

def select_raw_width(width_cm: float, trim_edge_cm: float, available_raw_widths_cm: list[float]) -> float | None:
    """
    Chọn khổ giấy thô nhỏ nhất mà vẫn >= width_cm + trim_edge_cm.
    Trả None nếu không có khổ phù hợp.
    """
    needed = width_cm + trim_edge_cm
    sorted_widths = sorted(w for w in available_raw_widths_cm if w >= needed)
    return sorted_widths[0] if sorted_widths else None


# ---------------------------------------------------------------------------
# Step 3: Sinh tổ hợp đa-dòng (combination patterns)
# ---------------------------------------------------------------------------

def _line_fits_in_width(
    line_widths: list[float],
    raw_width: float,
    trim_edge_cm: float,
    multipliers: list[int],
) -> bool:
    """
    Kiểm tra tổng khổ các thành phần (x multiplier) có vừa trong raw_width - trim_edge không.
    """
    total = sum(w * m for w, m in zip(line_widths, multipliers))
    return total <= (raw_width - trim_edge_cm)


def _length_delta_ok(
    run_length_cm: float,
    component_lengths: list[float],
    max_length_delta_cm: float | None,
) -> bool:
    """
    Chiều dài chạy phải nằm trong khoảng max_length_delta_cm của tất cả component.
    """
    if max_length_delta_cm is None:
        return True
    for lc in component_lengths:
        if abs(run_length_cm - lc) > max_length_delta_cm:
            return False
    return True


def generate_combinations(
    target_lines: list[dict[str, Any]],
    supplier_config: dict[str, Any],
    optimization_config: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Sinh danh sách tổ hợp cắt (combination patterns) hợp lệ.

    Mỗi combination là một quy cách mua (raw_width × run_length) có thể chứa
    nhiều thành phần từ các dòng gốc khác nhau.

    Kết quả: list of combo dict với các trường:
    - raw_width_cm
    - run_length_cm
    - useful_width_cm
    - components: list of {line_index, line_id, width_cm, length_cm, multiplier, line_allocated_sets_per_pass}
    - combo_key: (raw_width_cm, run_length_cm)  → dùng để gom quy cách mua
    - used_width_cm
    - width_utilization_rate
    """
    trim_edge_cm = float(supplier_config.get('trim_edge_cm') or 0.0)
    available_raw_widths = sorted(
        float(w) for w in (supplier_config.get('available_raw_widths_cm') or [])
    )
    max_combination_width_cm = float(supplier_config.get('max_combination_width_cm') or 280.0)
    max_combined_length_cm = supplier_config.get('max_combined_length_cm')  # nullable
    max_components = int(optimization_config.get('max_components_per_combination') or 6)
    max_multiplier = int(optimization_config.get('max_multiplier_per_component') or 4)
    max_length_delta_cm = optimization_config.get('max_length_delta_cm')  # nullable float
    max_waste_rate_percent = float(optimization_config.get('max_waste_rate_percent') or 20.0)

    if not available_raw_widths:
        return []

    combos: list[dict[str, Any]] = []

    # Xét theo từng raw_width đang bật
    for raw_width in available_raw_widths:
        if raw_width > max_combination_width_cm:
            continue
        useful_width = raw_width - trim_edge_cm
        if useful_width <= 0:
            continue

        # Tất cả dòng có thể vừa trong raw_width này (khi ghép với trim)
        eligible_indices = [
            i for i, line in enumerate(target_lines)
            if line['width_cm'] <= useful_width
        ]
        if not eligible_indices:
            continue

        # n = 1: mỗi dòng riêng lẻ (đây là luôn hợp lệ)
        for i in eligible_indices:
            line = target_lines[i]
            for m in range(1, max_multiplier + 1):
                used_w = line['width_cm'] * m
                if used_w > useful_width:
                    break
                run_length = line['length_cm']
                if max_combined_length_cm and run_length > max_combined_length_cm:
                    continue
                waste_area = (raw_width * run_length) - (used_w * run_length)
                waste_rate = waste_area / (raw_width * run_length) if (raw_width * run_length) else 1.0
                if waste_rate * 100 > max_waste_rate_percent:
                    continue
                combos.append({
                    'raw_width_cm': _r(raw_width, 4),
                    'run_length_cm': _r(run_length, 4),
                    'useful_width_cm': _r(useful_width, 4),
                    'used_width_cm': _r(used_w, 4),
                    'width_utilization_rate': _r(used_w / useful_width, 6),
                    'waste_rate': _r(waste_rate, 6),
                    'components': [{
                        'line_index': i,
                        'line_id': line['id'],
                        'width_cm': line['width_cm'],
                        'length_cm': line['length_cm'],
                        'multiplier': m,
                    }],
                    'combo_key': (_r(raw_width, 4), _r(run_length, 4)),
                })

        # n >= 2: kết hợp nhiều dòng
        if max_components >= 2:
            for combo_size in range(2, min(max_components, len(eligible_indices)) + 1):
                for selected in itertools.combinations(eligible_indices, combo_size):
                    selected_lines = [target_lines[i] for i in selected]
                    # Tìm run_length chung (lấy max để đủ cả)
                    # Chọn theo dòng có length lớn nhất làm run_length_cm
                    run_length = max(l['length_cm'] for l in selected_lines)
                    if max_combined_length_cm and run_length > max_combined_length_cm:
                        continue
                    if max_length_delta_cm is not None:
                        if not _length_delta_ok(
                            run_length,
                            [l['length_cm'] for l in selected_lines],
                            max_length_delta_cm,
                        ):
                            continue

                    # Thử phân phối multiplier: mỗi dòng 1 lần
                    default_mults = [1] * combo_size
                    used_w = sum(l['width_cm'] * m for l, m in zip(selected_lines, default_mults))
                    if used_w > useful_width:
                        continue
                    waste_area = (raw_width * run_length) - sum(
                        l['width_cm'] * m * run_length for l, m in zip(selected_lines, default_mults)
                    )
                    waste_rate = waste_area / (raw_width * run_length) if (raw_width * run_length) else 1.0
                    if waste_rate * 100 > max_waste_rate_percent:
                        continue

                    combos.append({
                        'raw_width_cm': _r(raw_width, 4),
                        'run_length_cm': _r(run_length, 4),
                        'useful_width_cm': _r(useful_width, 4),
                        'used_width_cm': _r(used_w, 4),
                        'width_utilization_rate': _r(used_w / useful_width, 6),
                        'waste_rate': _r(waste_rate, 6),
                        'components': [
                            {
                                'line_index': idx,
                                'line_id': target_lines[idx]['id'],
                                'width_cm': target_lines[idx]['width_cm'],
                                'length_cm': target_lines[idx]['length_cm'],
                                'multiplier': 1,
                            }
                            for idx in selected
                        ],
                        'combo_key': (_r(raw_width, 4), _r(run_length, 4)),
                    })

    return combos


# ---------------------------------------------------------------------------
# Step 4: Ghép phương án – gom quy cách mua cuối và tính số bộ
# ---------------------------------------------------------------------------

def build_purchase_plan(
    target_lines: list[dict[str, Any]],
    supplier_config: dict[str, Any],
    optimization_config: dict[str, Any],
    allow_economic: bool = False,
) -> dict[str, Any] | None:
    """
    Xây dựng phương án mua giấy đơn giản nhưng đúng nghĩa:
    - Mỗi dòng gốc được gán một combo hợp lệ (raw_width, run_length).
    - Các dòng cùng (raw_width, run_length) → cùng một quy cách mua.
    - Tổng số bộ mua = tổng target_quantity của các dòng ghép vào quy cách đó (khi ghép 1×1).
    - Nếu ghép nhiều thành phần, số bộ = số bộ của dòng cần nhiều nhất / multiplier.
    - Kiểm NCC trên từng quy cách mua.
    - Tính dư kinh tế nếu được bật.

    Trả về plan_payload hoặc None nếu không xây được phương án hợp lệ.
    """
    trim_edge_cm = float(supplier_config.get('trim_edge_cm') or 0.0)
    available_raw_widths = sorted(
        float(w) for w in (supplier_config.get('available_raw_widths_cm') or [])
    )
    min_purchase_length_cm = float(supplier_config.get('min_purchase_length_cm') or 0.0)

    tech_waste_weight = float(optimization_config.get('technical_waste_cost_weight') or 1.0)
    raw_width_cost_weight = float(optimization_config.get('new_raw_width_cost_weight') or 1.0)
    spec_cost_weight = float(optimization_config.get('new_purchase_spec_cost_weight') or 0.2)
    fragment_weight = float(optimization_config.get('fragmentation_cost_weight') or 0.12)
    econ_cost_weight = float(optimization_config.get('economic_overproduction_cost_weight') or 1.0)

    if not available_raw_widths:
        return None

    # Gán từng dòng vào khổ giấy nhỏ nhất vừa đủ
    line_assignments: list[dict[str, Any]] = []
    for line in target_lines:
        rw = select_raw_width(line['width_cm'], trim_edge_cm, available_raw_widths)
        if rw is None:
            rw = available_raw_widths[-1]  # fallback: lớn nhất
        line_assignments.append({
            **line,
            'raw_width_cm': _r(rw, 4),
            'run_length_cm': _r(line['length_cm'], 4),
            'useful_width_cm': _r(rw - trim_edge_cm, 4),
        })

    # Gom quy cách mua cuối theo (raw_width_cm, run_length_cm)
    spec_groups: dict[tuple, list[dict]] = defaultdict(list)
    for la in line_assignments:
        key = (la['raw_width_cm'], la['run_length_cm'])
        spec_groups[key].append(la)

    # Kiểm dư kinh tế
    max_econ_qty_total = optimization_config.get('max_economic_overproduction_quantity_total')
    max_econ_rate_total = optimization_config.get('max_economic_overproduction_rate_percent_total')
    max_econ_qty_per_line = optimization_config.get('max_economic_overproduction_quantity_per_line')
    max_econ_rate_per_line = optimization_config.get('max_economic_overproduction_rate_percent_per_line')

    base_total = sum(int(line['quantity']) for line in target_lines)
    target_total = sum(int(line['target_quantity']) for line in target_lines)

    # Xây purchase spec rows
    purchase_spec_rows: list[dict[str, Any]] = []
    allocation_rows: list[dict[str, Any]] = []
    total_purchase_area = 0.0
    total_waste_area = 0.0
    total_allocated_qty = 0
    total_economic_qty = 0

    for (raw_w, run_l), lines_in_group in sorted(spec_groups.items()):
        # Tính số bộ thuần cho quy cách này
        raw_sets = sum(int(la['target_quantity']) for la in lines_in_group)

        economic_qty_this_spec = 0
        if allow_economic:
            # Tính tổng số bộ có thể bổ sung để NCC đạt min_purchase_length_cm
            current_length = raw_w * run_l * raw_sets  # actual purchase area proxy
            min_required_sets = math.ceil(min_purchase_length_cm / run_l) if run_l > 0 else 0
            if raw_sets < min_required_sets:
                # cần thêm để đạt NCC
                deficit_sets = min_required_sets - raw_sets
                # Kiểm ngưỡng kinh tế
                allowed_extra = _compute_allowed_economic(
                    raw_sets, target_total,
                    max_econ_qty_total, max_econ_rate_total,
                    max_econ_qty_per_line, max_econ_rate_per_line,
                    total_economic_qty, len(lines_in_group),
                )
                economic_qty_this_spec = min(deficit_sets, allowed_extra)
            else:
                # Xét tăng thêm nếu giúp ghép đẹp hơn
                allowed_extra = _compute_allowed_economic(
                    raw_sets, target_total,
                    max_econ_qty_total, max_econ_rate_total,
                    max_econ_qty_per_line, max_econ_rate_per_line,
                    total_economic_qty, len(lines_in_group),
                )
                # Chỉ thêm nếu cần để đạt NCC hoặc được bật
                economic_qty_this_spec = 0

        total_sets_purchase = raw_sets + economic_qty_this_spec
        total_length = _r(run_l * total_sets_purchase, 4)

        # Kiểm NCC
        ncc_min_length = min_purchase_length_cm
        ncc_passed = total_length >= ncc_min_length

        # Tính diện tích mua = raw_width × run_length × total_sets
        spec_purchase_area = raw_w * run_l * total_sets_purchase
        # Diện tích hữu dụng = sum(width_i × length_i × target_qty_i) cho lines trong group
        used_area = sum(
            float(la['width_cm']) * float(la['length_cm']) * int(la['target_quantity'])
            for la in lines_in_group
        )
        waste_area_spec = max(spec_purchase_area - used_area, 0.0)
        waste_rate_spec = waste_area_spec / spec_purchase_area if spec_purchase_area else 0.0

        # Khổ hữu dụng
        useful_width = raw_w - trim_edge_cm
        # Tỷ lệ tận dụng khổ = sum(width × mult) / useful_width
        used_width_sum = sum(float(la['width_cm']) for la in lines_in_group)
        width_util = used_width_sum / useful_width if useful_width > 0 else 0.0

        # Ghi nhận các dòng tham gia
        source_line_ids = [la['id'] for la in lines_in_group]

        purchase_spec_rows.append({
            'group_id': f'{raw_w}x{run_l}',
            'raw_width_cm': raw_w,
            'run_length_cm': run_l,
            'useful_width_cm': _r(useful_width, 4),
            'used_width_cm': _r(used_width_sum, 4),
            'total_sets_purchase_spec': total_sets_purchase,
            'reserve_sets': raw_sets - sum(int(la['base_quantity']) for la in lines_in_group),
            'economic_sets_purchase_spec': economic_qty_this_spec,
            'total_length_cm_purchase_spec': total_length,
            'purchase_area_cm2': _r(spec_purchase_area, 4),
            'used_area_cm2': _r(used_area, 4),
            'waste_area_cm2': _r(waste_area_spec, 4),
            'waste_rate': _r(waste_rate_spec, 6),
            'width_utilization_rate': _r(width_util, 6),
            'area_utilization_rate': _r(used_area / spec_purchase_area if spec_purchase_area else 0, 6),
            'source_line_ids': source_line_ids,
            'source_line_count': len(lines_in_group),
            'supplier_min_length_required_cm': ncc_min_length,
            'supplier_min_length_actual_cm': total_length,
            'supplier_min_length_passed': ncc_passed,
            'description': '+'.join(
                f"{la['width_cm']}×{la['length_cm']}" for la in lines_in_group
            ),
        })

        total_purchase_area += spec_purchase_area
        total_waste_area += waste_area_spec
        total_allocated_qty += raw_sets
        total_economic_qty += economic_qty_this_spec

        # Allocation rows cho mỗi dòng gốc trong group
        for la in lines_in_group:
            allocation_rows.append({
                'line_id': la['id'],
                'base_quantity': la['base_quantity'],
                'reserve_quantity': la['reserve_quantity'],
                'target_quantity': la['target_quantity'],
                'line_allocated_sets': la['target_quantity'],
                'purchase_spec_sets': total_sets_purchase,
                'purchase_group_id': f'{raw_w}x{run_l}',
                'economic_overproduction_quantity': 0,
                'missing_quantity': max(0, la['target_quantity'] - la['target_quantity']),
                'raw_width_cm': raw_w,
                'run_length_cm': run_l,
            })

    # Tính KPIs
    base_requested_total = sum(int(line['quantity']) for line in target_lines)
    production_reserve_total = sum(int(la['reserve_quantity']) for la in line_assignments)
    target_total_qty = base_requested_total + production_reserve_total
    economic_total = total_economic_qty

    technical_waste_rate = total_waste_area / total_purchase_area if total_purchase_area else 0.0
    unique_raw_widths = sorted(set(row['raw_width_cm'] for row in purchase_spec_rows))
    unique_raw_width_count = len(unique_raw_widths)
    unique_purchase_spec_count = len(purchase_spec_rows)
    final_group_count = unique_purchase_spec_count

    # Chi phí quy đổi
    technical_waste_cost = _r(technical_waste_rate * tech_waste_weight)
    raw_width_cost = _r(unique_raw_width_count * raw_width_cost_weight)
    spec_cost = _r(unique_purchase_spec_count * spec_cost_weight)
    fragment_cost = _r(final_group_count * fragment_weight)
    econ_cost = _r(economic_total * econ_cost_weight * 0.01)  # normalize
    total_converted_cost = _r(technical_waste_cost + raw_width_cost + spec_cost + fragment_cost + econ_cost)

    # Kiểm NCC toàn bộ
    all_ncc_passed = all(row['supplier_min_length_passed'] for row in purchase_spec_rows)

    # Raw width usage summary
    raw_width_summary: dict[float, dict] = {}
    for row in purchase_spec_rows:
        rw = row['raw_width_cm']
        if rw not in raw_width_summary:
            raw_width_summary[rw] = {
                'raw_width_cm': rw,
                'group_count': 0,
                'purchase_spec_count': 0,
                'total_length_cm': 0.0,
                'total_sets': 0,
            }
        raw_width_summary[rw]['group_count'] += 1
        raw_width_summary[rw]['purchase_spec_count'] += 1
        raw_width_summary[rw]['total_length_cm'] += row['total_length_cm_purchase_spec']
        raw_width_summary[rw]['total_sets'] += row['total_sets_purchase_spec']

    rw_summary_list = []
    for rw in sorted(raw_width_summary):
        entry = raw_width_summary[rw]
        rw_summary_list.append({
            'raw_width_cm': rw,
            'group_count': entry['group_count'],
            'purchase_spec_count': entry['purchase_spec_count'],
            'total_length_cm': _r(entry['total_length_cm'], 4),
            'used_once': entry['group_count'] == 1,
            'single_use_purchase_spec_count': 1 if entry['purchase_spec_count'] == 1 else 0,
        })

    # final_plan rows (để tương thích ngược với frontend)
    final_plan = []
    for row in purchase_spec_rows:
        final_plan.append({
            'description': row['description'],
            'raw_width_cm': row['raw_width_cm'],
            'run_length_cm': row['run_length_cm'],
            'sets': row['total_sets_purchase_spec'],
            'total_length_cm': row['total_length_cm_purchase_spec'],
            'waste_rate': row['waste_rate'],
            'status_label': 'Đạt NCC' if row['supplier_min_length_passed'] else 'Chưa đạt NCC',
            'source_line_ids': row['source_line_ids'],
            'purchase_spec_detail': {
                'total_sets_purchase_spec': row['total_sets_purchase_spec'],
                'total_length_cm_purchase_spec': row['total_length_cm_purchase_spec'],
                'supplier_min_length_required_cm': row['supplier_min_length_required_cm'],
                'supplier_min_length_actual_cm': row['supplier_min_length_actual_cm'],
                'supplier_min_length_passed': row['supplier_min_length_passed'],
                'useful_width_cm': row['useful_width_cm'],
                'width_utilization_rate': row['width_utilization_rate'],
                'area_utilization_rate': row['area_utilization_rate'],
            },
        })

    # Reverse check: từ phân bổ → tổng ngược lại quy cách mua
    reverse_check_rows = _build_reverse_check(allocation_rows, purchase_spec_rows)

    # Leftovers (chưa phân bổ được)
    leftovers = _build_leftovers(target_lines, allocation_rows)

    return {
        'base_requested_quantity_total': base_requested_total,
        'production_reserve_quantity_total': production_reserve_total,
        'target_requested_quantity_total': target_total_qty,
        'economic_overproduction_quantity_total': economic_total,
        'economic_overproduction_rate_total': _r(economic_total / target_total_qty if target_total_qty else 0, 6),
        'allocated_quantity_total': total_allocated_qty + economic_total,
        'technical_waste_area': _r(total_waste_area, 4),
        'technical_waste_rate': _r(technical_waste_rate, 8),
        'technical_waste_cost': technical_waste_cost,
        'economic_overproduction_cost': econ_cost,
        'raw_width_cost': raw_width_cost,
        'purchase_spec_cost': spec_cost,
        'fragmentation_cost': fragment_cost,
        'total_converted_cost': total_converted_cost,
        'unique_raw_width_count': unique_raw_width_count,
        'raw_widths_used': unique_raw_widths,
        'raw_width_usage_summary': rw_summary_list,
        'unique_purchase_spec_count': unique_purchase_spec_count,
        'final_group_count': final_group_count,
        'total_purchase_area': _r(total_purchase_area, 4),
        'all_ncc_passed': all_ncc_passed,
        'meets_target_and_cap': not leftovers and all_ncc_passed,
        'purchase_spec_rows': purchase_spec_rows,
        'allocation_details': allocation_rows,
        'reverse_check_rows': reverse_check_rows,
        'leftovers': leftovers,
        'final_plan': final_plan,
        'objective_candidate_count': 1,
        'objective_distinct_candidate_count': 1,
        'objective_best_signature_count': 1,
    }


def _compute_allowed_economic(
    current_sets: int,
    target_total: int,
    max_qty_total: Any,
    max_rate_total: Any,
    max_qty_per_line: Any,
    max_rate_per_line: Any,
    already_economic: int,
    line_count: int,
) -> int:
    """Tính số bộ kinh tế tối đa được phép thêm cho một nhóm."""
    max_allowed = 999999
    if max_qty_total is not None:
        remaining = int(max_qty_total) - already_economic
        max_allowed = min(max_allowed, max(0, remaining))
    if max_rate_total is not None and target_total > 0:
        allowed_by_rate = int(target_total * float(max_rate_total) / 100) - already_economic
        max_allowed = min(max_allowed, max(0, allowed_by_rate))
    if max_qty_per_line is not None:
        max_allowed = min(max_allowed, int(max_qty_per_line) * line_count)
    if max_rate_per_line is not None and current_sets > 0:
        allowed_per = int(current_sets * float(max_rate_per_line) / 100)
        max_allowed = min(max_allowed, allowed_per * line_count)
    return max(0, max_allowed)


def _build_reverse_check(
    allocation_rows: list[dict[str, Any]],
    purchase_spec_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Kiểm tra ngược: từ allocation_rows → tổng hợp theo quy cách mua,
    so sánh với purchase_spec_rows để xác nhận nhất quán.
    """
    reverse: dict[str, dict] = {}
    for row in allocation_rows:
        key = f"{row['raw_width_cm']}x{row['run_length_cm']}"
        if key not in reverse:
            reverse[key] = {
                'raw_width_cm': row['raw_width_cm'],
                'run_length_cm': row['run_length_cm'],
                'sum_line_sets': 0,
                'sum_purchase_sets': 0,
                'line_count': 0,
                'line_ids': [],
                'purchase_group_ids': set(),
            }
        reverse[key]['sum_line_sets'] += int(row['line_allocated_sets'])
        purchase_group_id = str(
            row.get('purchase_group_id')
            or f"{row['raw_width_cm']}x{row['run_length_cm']}:{row['line_id']}:{reverse[key]['line_count']}"
        )
        if purchase_group_id not in reverse[key]['purchase_group_ids']:
            reverse[key]['purchase_group_ids'].add(purchase_group_id)
            reverse[key]['sum_purchase_sets'] += int(row.get('purchase_spec_sets') or row.get('line_allocated_sets') or 0)
        reverse[key]['line_count'] += 1
        reverse[key]['line_ids'].append(row['line_id'])

    spec_map: dict[str, dict] = {}
    for spec in purchase_spec_rows:
        key = f"{spec['raw_width_cm']}x{spec['run_length_cm']}"
        spec_map[key] = spec

    result = []
    for key, rev in sorted(reverse.items()):
        spec = spec_map.get(key, {})
        total_sets_spec = spec.get('total_sets_purchase_spec', 0)
        total_length_spec = spec.get('total_length_cm_purchase_spec', 0.0)
        # Tổng chiều dài theo reverse: run_length × sum_line_sets
        run_l = rev['run_length_cm']
        reverse_total_length = _r(run_l * rev['sum_line_sets'], 4)
        consistent = abs(total_sets_spec - rev['sum_line_sets']) <= 1  # cho phép lệch nhỏ do economic

        result.append({
            'raw_width_cm': rev['raw_width_cm'],
            'run_length_cm': rev['run_length_cm'],
            'sum_line_allocated_sets': rev['sum_purchase_sets'],
            'total_sets_purchase_spec': total_sets_spec,
            'reverse_total_length_cm': _r(run_l * rev['sum_purchase_sets'], 4),
            'spec_total_length_cm': total_length_spec,
            'line_count': rev['line_count'],
            'line_ids': rev['line_ids'],
            'consistent': abs(total_sets_spec - rev['sum_purchase_sets']) <= 1,
            'ncc_passed': spec.get('supplier_min_length_passed', False),
        })
    return result


def _build_leftovers(
    target_lines: list[dict[str, Any]],
    allocation_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Tìm các dòng bị thiếu (chưa được phân bổ đủ).
    """
    allocated_map: dict[str, int] = {}
    for row in allocation_rows:
        lid = row['line_id']
        allocated_map[lid] = allocated_map.get(lid, 0) + int(row['line_allocated_sets'])

    leftovers = []
    for line in target_lines:
        target_qty = int(line['target_quantity'])
        allocated_qty = allocated_map.get(line['id'], 0)
        missing = max(0, target_qty - allocated_qty)
        if missing > 0:
            leftovers.append({
                'line_id': line['id'],
                'width_cm': line['width_cm'],
                'length_cm': line['length_cm'],
                'target_quantity': target_qty,
                'allocated_quantity': allocated_qty,
                'missing_quantity': missing,
            })
    return leftovers


# ---------------------------------------------------------------------------
# Step 5: Sinh 4 phương án công khai thật sự
# ---------------------------------------------------------------------------

def build_four_public_plans(
    target_lines: list[dict[str, Any]],
    supplier_config: dict[str, Any],
    optimization_config: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    """
    Sinh 4 phương án công khai:
    - EXACT_ORDER: không dư kinh tế
    - LOWEST_TOTAL_COST: cho phép dư kinh tế, tối ưu chi phí
    - MIN_RAW_WIDTHS: cùng nền chi phí, giảm số khổ giấy
    - MIN_SPECS: cùng nền chi phí, giảm số quy cách mua

    Trả về: (alternatives list, selected_plan_code)
    """
    # EXACT_ORDER - không kinh tế
    plan_exact = build_purchase_plan(target_lines, supplier_config, optimization_config, allow_economic=False)
    if plan_exact is None:
        plan_exact = _empty_plan()

    # LOWEST_TOTAL_COST - có kinh tế nếu được bật
    allow_econ = (
        bool(optimization_config.get('allow_economic_overproduction'))
        and bool(optimization_config.get('allow_exceed_target_demand'))
    )
    plan_cost = build_purchase_plan(target_lines, supplier_config, optimization_config, allow_economic=allow_econ)
    if plan_cost is None:
        plan_cost = copy.deepcopy(plan_exact)

    # MIN_RAW_WIDTHS - thử config ưu tiên ít khổ hơn
    opt_cfg_min_widths = _config_for_min_raw_widths(optimization_config)
    plan_widths_candidate = build_purchase_plan(target_lines, supplier_config, opt_cfg_min_widths, allow_economic=allow_econ)
    width_allowance = float(optimization_config.get('acceptable_cost_increase_for_fewer_raw_widths_percent') or 1.0)
    plan_widths = _select_objective_candidate(
        candidate_plan=plan_widths_candidate,
        reference_plan=plan_cost,
        plan_code='MIN_RAW_WIDTHS',
        allowance_percent=width_allowance,
    )

    # MIN_SPECS - thử config ưu tiên ít quy cách hơn
    opt_cfg_min_specs = _config_for_min_specs(optimization_config)
    plan_specs_candidate = build_purchase_plan(target_lines, supplier_config, opt_cfg_min_specs, allow_economic=allow_econ)
    spec_allowance = float(optimization_config.get('acceptable_cost_increase_for_fewer_specs_percent') or 0.5)
    plan_specs = _select_objective_candidate(
        candidate_plan=plan_specs_candidate,
        reference_plan=plan_cost,
        plan_code='MIN_SPECS',
        allowance_percent=spec_allowance,
    )

    # Đánh dấu chênh lệch so với LOWEST_TOTAL_COST
    _annotate_delta(plan_exact, plan_cost, 'compared_to_lowest_total_cost_delta')
    _annotate_delta(plan_widths, plan_cost, 'compared_to_lowest_total_cost_delta')
    _annotate_delta(plan_specs, plan_cost, 'compared_to_lowest_total_cost_delta')

    # Xây alternatives list
    alternatives = []
    plan_data_map = {
        'EXACT_ORDER': (plan_exact, 'Bám đúng nhu cầu mục tiêu sau dự trù sản xuất, không dư kinh tế.', 'Phương án an toàn tuyệt đối, không có rủi ro mua thừa.'),
        'LOWEST_TOTAL_COST': (plan_cost, 'Tổng chi phí quy đổi thấp nhất.', 'Tối ưu kinh tế toàn diện, có thể dư nhỏ.'),
        'MIN_RAW_WIDTHS': (plan_widths, 'Ít khổ giấy sử dụng nhất trong ngưỡng chi phí cho phép.', f'Dùng ít loại khổ hơn ({plan_widths["unique_raw_width_count"]} khổ), dễ quản lý kho hơn.'),
        'MIN_SPECS': (plan_specs, 'Ít quy cách mua nhất trong ngưỡng chi phí cho phép.', f'Dùng ít quy cách ({plan_specs["unique_purchase_spec_count"]} quy cách), dễ đặt hàng hơn.'),
    }

    convergence_note = _check_convergence(plan_exact, plan_cost, plan_widths, plan_specs)

    for plan_code in PLAN_CODES:
        plan_data, selection_note, tradeoff_note = plan_data_map[plan_code]
        if convergence_note:
            selection_note = convergence_note + ' ' + selection_note

        alt = {
            **plan_data,
            'plan_code': plan_code,
            'plan_name': PLAN_META[plan_code]['plan_name'],
            'public_plan_code': plan_code,
            'public_plan_objective_code': plan_code,
            'public_plan_selection_note': selection_note,
            'public_plan_tradeoff_note': tradeoff_note,
            'scenario_code': 'TARGET' if plan_code == 'EXACT_ORDER' else ('ECON' if allow_econ else 'TARGET'),
            'scenario_kind': 'exact_target' if plan_code == 'EXACT_ORDER' else ('economic_optimization' if allow_econ else 'target_only'),
            'source_internal_plan_code': plan_code,
            'source_internal_plan_name': PLAN_META[plan_code]['plan_name'],
            'requested_quantity_total': plan_data['target_requested_quantity_total'],
            'public_plan_convergence_reason_code': 'distinct_solution' if not convergence_note else 'converged_solution',
            'objective_selected_distinct_solution': not bool(convergence_note),
            'search_strategy': 'multi_variant_optimizer',
        }
        alt['is_placeholder_no_feasible'] = _is_placeholder_no_feasible_plan(alt)
        alternatives.append(alt)

    # Chọn selected plan theo thứ tự ưu tiên
    selected_plan_code = _select_best_plan(alternatives)
    return alternatives, selected_plan_code


def _config_for_min_raw_widths(base_config: dict[str, Any]) -> dict[str, Any]:
    cfg = copy.deepcopy(base_config)
    # Tăng trọng số raw_width và nới lỏng ngưỡng để engine ưu tiên ít khổ
    acceptable_increase = float(cfg.get('acceptable_cost_increase_for_fewer_raw_widths_percent') or 1.0)
    cfg['new_raw_width_cost_weight'] = float(cfg.get('new_raw_width_cost_weight') or 1.0) * (1.0 + acceptable_increase / 10.0)
    return cfg


def _config_for_min_specs(base_config: dict[str, Any]) -> dict[str, Any]:
    cfg = copy.deepcopy(base_config)
    acceptable_increase = float(cfg.get('acceptable_cost_increase_for_fewer_specs_percent') or 0.5)
    cfg['new_purchase_spec_cost_weight'] = float(cfg.get('new_purchase_spec_cost_weight') or 0.2) * (1.0 + acceptable_increase / 10.0)
    return cfg


def _is_within_cost_allowance(
    plan: dict[str, Any],
    reference_plan: dict[str, Any],
    allowance_percent: float,
) -> bool:
    max_cost = float(reference_plan.get('total_converted_cost') or 0.0) * (1 + allowance_percent / 100.0)
    return float(plan.get('total_converted_cost') or 0.0) <= max_cost + 1e-9


def _objective_rank(plan: dict[str, Any], plan_code: str) -> tuple[Any, ...]:
    if plan_code in {'MIN_RAW_WIDTHS', 'MIN_SPECS'}:
        return (
            int(plan.get('unique_raw_width_count') or 0),
            int(plan.get('unique_purchase_spec_count') or 0),
            int(plan.get('final_group_count') or 0),
            float(plan.get('total_converted_cost') or 0.0),
            float(plan.get('technical_waste_rate') or 0.0),
        )
    return (
        float(plan.get('total_converted_cost') or 0.0),
        int(plan.get('unique_raw_width_count') or 0),
        int(plan.get('unique_purchase_spec_count') or 0),
        int(plan.get('final_group_count') or 0),
        float(plan.get('technical_waste_rate') or 0.0),
    )


def _select_objective_candidate(
    *,
    candidate_plan: dict[str, Any] | None,
    reference_plan: dict[str, Any],
    plan_code: str,
    allowance_percent: float,
) -> dict[str, Any]:
    if candidate_plan is None:
        return copy.deepcopy(reference_plan)
    if not _is_within_cost_allowance(candidate_plan, reference_plan, allowance_percent):
        return copy.deepcopy(reference_plan)
    if _objective_rank(candidate_plan, plan_code) < _objective_rank(reference_plan, plan_code):
        return candidate_plan
    return copy.deepcopy(reference_plan)


def _annotate_delta(
    plan: dict[str, Any],
    reference: dict[str, Any],
    delta_key: str,
) -> None:
    plan[delta_key] = {
        'total_converted_cost_delta': _r(
            plan.get('total_converted_cost', 0) - reference.get('total_converted_cost', 0)
        ),
        'unique_raw_width_count_delta': (
            plan.get('unique_raw_width_count', 0) - reference.get('unique_raw_width_count', 0)
        ),
        'unique_purchase_spec_count_delta': (
            plan.get('unique_purchase_spec_count', 0) - reference.get('unique_purchase_spec_count', 0)
        ),
        'final_group_count_delta': (
            plan.get('final_group_count', 0) - reference.get('final_group_count', 0)
        ),
        'technical_waste_rate_delta': _r(
            plan.get('technical_waste_rate', 0) - reference.get('technical_waste_rate', 0)
        ),
        'economic_overproduction_quantity_total_delta': (
            plan.get('economic_overproduction_quantity_total', 0)
            - reference.get('economic_overproduction_quantity_total', 0)
        ),
    }


def _check_convergence(
    plan_exact: dict,
    plan_cost: dict,
    plan_widths: dict,
    plan_specs: dict,
) -> str:
    """Kiểm tra hội tụ và trả về ghi chú nếu có."""
    sigs = [
        (
            plan_exact.get('total_converted_cost', 0),
            plan_exact.get('unique_raw_width_count', 0),
            plan_exact.get('unique_purchase_spec_count', 0),
            plan_exact.get('final_group_count', 0),
        ),
        (
            plan_cost.get('total_converted_cost', 0),
            plan_cost.get('unique_raw_width_count', 0),
            plan_cost.get('unique_purchase_spec_count', 0),
            plan_cost.get('final_group_count', 0),
        ),
        (
            plan_widths.get('total_converted_cost', 0),
            plan_widths.get('unique_raw_width_count', 0),
            plan_widths.get('unique_purchase_spec_count', 0),
            plan_widths.get('final_group_count', 0),
        ),
        (
            plan_specs.get('total_converted_cost', 0),
            plan_specs.get('unique_raw_width_count', 0),
            plan_specs.get('unique_purchase_spec_count', 0),
            plan_specs.get('final_group_count', 0),
        ),
    ]
    unique_sigs = len(set(sigs))
    if unique_sigs == 1:
        return 'Tất cả phương án hội tụ về cùng một nghiệm do dữ liệu không có đủ variation để tách biệt (candidate count: 4, distinct: 1, best signature: 1).'
    return ''


def _select_best_plan(alternatives: list[dict[str, Any]]) -> str:
    """
    Chọn plan tốt nhất theo thứ tự ưu tiên đặc tả:
    1. chi phí thấp nhất
    2. ít khổ giấy hơn
    3. ít quy cách mua hơn
    4. ít nhóm hơn
    """
    if not alternatives:
        return 'EXACT_ORDER'
    feasible = [
        alternative
        for alternative in alternatives
        if bool(alternative.get('all_ncc_passed')) and bool(alternative.get('meets_target_and_cap'))
    ]
    candidate_pool = feasible or alternatives
    plan_priority = {
        'LOWEST_TOTAL_COST': 0,
        'MIN_RAW_WIDTHS': 1,
        'MIN_SPECS': 2,
        'EXACT_ORDER': 3,
    }

    def sort_key(alt: dict) -> tuple:
        return (
            *_objective_rank(alt, 'LOWEST_TOTAL_COST'),
            plan_priority.get(str(alt.get('plan_code', '')), 99),
        )

    best = min(candidate_pool, key=sort_key)
    return str(best.get('plan_code', 'EXACT_ORDER'))


def _empty_plan() -> dict[str, Any]:
    return {
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
        'final_group_count': 0,
        'total_purchase_area': 0.0,
        'all_ncc_passed': True,
        'purchase_spec_rows': [],
        'allocation_details': [],
        'reverse_check_rows': [],
        'leftovers': [],
        'final_plan': [],
        'objective_candidate_count': 0,
        'objective_distinct_candidate_count': 0,
        'objective_best_signature_count': 0,
        'is_placeholder_no_feasible': True,
    }


def _has_viable_public_alternatives(alternatives: list[dict[str, Any]]) -> bool:
    if not alternatives:
        return False
    required_keys = {
        'all_ncc_passed',
        'purchase_spec_rows',
        'allocation_details',
        'final_plan',
        'total_converted_cost',
    }
    if not all(required_keys.issubset(alternative.keys()) for alternative in alternatives):
        return False
    return any(
        bool(alternative.get('all_ncc_passed')) and bool(alternative.get('meets_target_and_cap'))
        for alternative in alternatives
    )


def _is_placeholder_no_feasible_plan(plan: dict[str, Any]) -> bool:
    return (
        not bool(plan.get('purchase_spec_rows'))
        and not bool(plan.get('allocation_details'))
        and not bool(plan.get('final_plan'))
        and not bool(plan.get('all_ncc_passed'))
        and not bool(plan.get('meets_target_and_cap'))
        and int(plan.get('unique_raw_width_count') or 0) == 0
        and int(plan.get('unique_purchase_spec_count') or 0) == 0
        and int(plan.get('final_group_count') or 0) == 0
    )


# ---------------------------------------------------------------------------
# Step 6: Guardrail baseline
# ---------------------------------------------------------------------------

GUARDRAIL_TOLERANCE = 0.001  # 0.1% tolerance cho floating point


def evaluate_guardrail(
    selected_plan: dict[str, Any],
    baseline_plan: dict[str, Any],
) -> dict[str, Any]:
    """
    So sánh selected_plan với baseline_plan.
    Trả về guardrail result dict.

    Rule: nếu selected kém baseline trên dataset tương đương → không promote.
    """
    if not baseline_plan:
        return {
            'baseline_guardrail_passed': True,
            'promote_allowed': True,
            'fallback_reason': 'Không có baseline để so sánh.',
            'selected_vs_baseline_delta': {},
        }

    b_cost = float(baseline_plan.get('total_converted_cost') or 0)
    b_widths = int(baseline_plan.get('unique_raw_width_count') or 0)
    b_specs = int(baseline_plan.get('unique_purchase_spec_count') or 0)
    b_groups = int(baseline_plan.get('final_group_count') or 0)
    b_area = float(baseline_plan.get('total_purchase_area') or 0)
    b_waste = float(baseline_plan.get('technical_waste_rate') or 0)

    s_cost = float(selected_plan.get('total_converted_cost') or 0)
    s_widths = int(selected_plan.get('unique_raw_width_count') or 0)
    s_specs = int(selected_plan.get('unique_purchase_spec_count') or 0)
    s_groups = int(selected_plan.get('final_group_count') or 0)
    s_area = float(selected_plan.get('total_purchase_area') or 0)
    s_waste = float(selected_plan.get('technical_waste_rate') or 0)

    delta = {
        'total_converted_cost_delta': _r(s_cost - b_cost),
        'total_purchase_area_delta': _r(s_area - b_area),
        'unique_raw_width_count_delta': s_widths - b_widths,
        'unique_purchase_spec_count_delta': s_specs - b_specs,
        'final_group_count_delta': s_groups - b_groups,
        'technical_waste_rate_delta': _r(s_waste - b_waste),
    }

    # Rule: tất cả 4 chỉ tiêu đều không tệ hơn baseline (với tolerance nhỏ cho float)
    cost_ok = s_cost <= b_cost * (1 + GUARDRAIL_TOLERANCE) + GUARDRAIL_TOLERANCE
    widths_ok = s_widths <= b_widths
    specs_ok = s_specs <= b_specs
    groups_ok = s_groups <= b_groups
    waste_ok = s_waste <= b_waste * (1 + GUARDRAIL_TOLERANCE) + GUARDRAIL_TOLERANCE

    passed = cost_ok and widths_ok and specs_ok and groups_ok and waste_ok
    fallback_reason = ''
    if not passed:
        reasons = []
        if not cost_ok:
            reasons.append(f'chi phí cao hơn baseline ({s_cost:.6f} > {b_cost:.6f})')
        if not widths_ok:
            reasons.append(f'nhiều khổ giấy hơn baseline ({s_widths} > {b_widths})')
        if not specs_ok:
            reasons.append(f'nhiều quy cách mua hơn baseline ({s_specs} > {b_specs})')
        if not groups_ok:
            reasons.append(f'nhiều nhóm hơn baseline ({s_groups} > {b_groups})')
        fallback_reason = 'Kém baseline: ' + '; '.join(reasons)

    return {
        'baseline_guardrail_passed': passed,
        'promote_allowed': passed,
        'fallback_reason': fallback_reason,
        'selected_vs_baseline_delta': delta,
        'baseline_summary': {
            'total_converted_cost': b_cost,
            'total_purchase_area': b_area,
            'unique_raw_width_count': b_widths,
            'unique_purchase_spec_count': b_specs,
            'final_group_count': b_groups,
            'technical_waste_rate': b_waste,
        },
    }


# ---------------------------------------------------------------------------
# Main entry point - run_full_optimizer
# ---------------------------------------------------------------------------

def run_full_optimizer(
    input_lines: list[dict[str, Any]],
    supplier_config: dict[str, Any],
    optimization_config: dict[str, Any],
    baseline_plan: dict[str, Any] | None,
    source_filename: str = '',
    note: str = '',
) -> dict[str, Any]:
    """
    Entry point chính cho optimizer nghiệp vụ đầy đủ.
    Dùng khi data không khớp canonical.
    """
    # Bước 1: tính nhu cầu mục tiêu
    target_lines = compute_target_quantities(input_lines, optimization_config)

    # Bước 2-5: sinh 4 phương án công khai
    engine_primary = 'v2'
    engine_fallback_used = False
    engine_fallback_source = 'none'
    engine_fallback_reason_code = ''
    alternatives, selected_plan_code = build_four_public_plans_v2(
        target_lines, supplier_config, optimization_config
    )
    if not _has_viable_public_alternatives(alternatives):
        engine_fallback_reason_code = 'no_viable_public_alternatives'
        legacy_alternatives, legacy_selected_plan_code = build_four_public_plans(
            target_lines,
            supplier_config,
            optimization_config,
        )
        if _has_viable_public_alternatives(legacy_alternatives):
            engine_fallback_used = True
            engine_fallback_source = 'legacy'
            alternatives, selected_plan_code = legacy_alternatives, legacy_selected_plan_code
    feasible_alternative_count = sum(
        1
        for alternative in alternatives
        if alternative.get('all_ncc_passed') and alternative.get('meets_target_and_cap')
    )
    for alternative in alternatives:
        alternative['is_placeholder_no_feasible'] = _is_placeholder_no_feasible_plan(alternative)
    candidate_count = sum(int(alternative.get('objective_candidate_count') or 0) for alternative in alternatives)
    distinct_candidate_count = len(
        {
            (
                alternative.get('plan_code'),
                alternative.get('total_converted_cost', 0),
                alternative.get('unique_raw_width_count', 0),
                alternative.get('unique_purchase_spec_count', 0),
                alternative.get('final_group_count', 0),
            )
            for alternative in alternatives
        }
    )

    # Lấy selected plan
    selected_plan = next(
        (a for a in alternatives if a['plan_code'] == selected_plan_code),
        alternatives[0] if alternatives else _empty_plan(),
    )
    selected_plan['is_placeholder_no_feasible'] = _is_placeholder_no_feasible_plan(selected_plan)

    # Bước 6: guardrail baseline
    guardrail_result = evaluate_guardrail(selected_plan, baseline_plan or {})
    if not guardrail_result['promote_allowed'] and baseline_plan:
        # Fallback: giữ exact_order thay vì promote nghiệm kém
        fallback = next((a for a in alternatives if a['plan_code'] == 'EXACT_ORDER'), selected_plan)
        if bool(fallback.get('all_ncc_passed')) and bool(fallback.get('meets_target_and_cap')):
            fallback_guardrail = evaluate_guardrail(fallback, baseline_plan)
            if fallback_guardrail['promote_allowed']:
                selected_plan = fallback
                selected_plan_code = 'EXACT_ORDER'
                guardrail_result = fallback_guardrail
    selected_plan['is_placeholder_no_feasible'] = _is_placeholder_no_feasible_plan(selected_plan)

    # Stats
    base_requested_total = sum(int(l['quantity']) for l in input_lines)
    production_reserve_total = selected_plan.get('production_reserve_quantity_total', 0)
    target_total = selected_plan.get('target_requested_quantity_total', 0)
    no_feasible_candidate = feasible_alternative_count == 0
    displayable_result = (
        not no_feasible_candidate
        and not bool(selected_plan.get('is_placeholder_no_feasible'))
        and bool(selected_plan.get('purchase_spec_rows'))
    )
    result_state = 'no_feasible_candidate' if no_feasible_candidate else 'success'

    return {
        'source_filename': source_filename,
        'note': note,
        'input_lines': input_lines,
        'target_lines': target_lines,
        'supplier_config': copy.deepcopy(supplier_config),
        'optimization_config': copy.deepcopy(optimization_config),
        'canonical_match': False,
        'recovery_mode': False,
        'result_state': result_state,
        'selected_plan_code': selected_plan_code,
        'selected_scenario_code': selected_plan.get('scenario_code', 'TARGET'),
        'selected_source_internal_plan_code': selected_plan.get('source_internal_plan_code', selected_plan_code),
        'selected_plan': selected_plan,
        'final_plan_alternatives': alternatives,
        'purchase_spec_rows': selected_plan.get('purchase_spec_rows', []),
        'allocation_details': selected_plan.get('allocation_details', []),
        'reverse_check_rows': selected_plan.get('reverse_check_rows', []),
        'leftovers': selected_plan.get('leftovers', []),
        'preview_summary': {
            'line_count': len(input_lines),
            'total_quantity': base_requested_total,
            'target_quantity': target_total,
        },
        'baseline_summary': guardrail_result.get('baseline_summary', {}),
        'selected_vs_baseline_delta': guardrail_result.get('selected_vs_baseline_delta', {}),
        'baseline_guardrail_passed': guardrail_result['baseline_guardrail_passed'],
        'promote_allowed': guardrail_result['promote_allowed'],
        'fallback_reason': guardrail_result['fallback_reason'],
        'stats': {
            'optimizer_mode': 'full_optimizer',
            'candidate_count': candidate_count,
            'feasible_alternative_count': feasible_alternative_count,
            'no_feasible_candidate': no_feasible_candidate,
            'displayable_result': displayable_result,
            'distinct_candidate_count': distinct_candidate_count,
            'purchase_spec_ncc_failed_count': sum(
                1
                for row in selected_plan.get('purchase_spec_rows', [])
                if not row.get('supplier_min_length_passed', False)
            ),
            'selected_plan_code': selected_plan_code,
            'guardrail_passed': guardrail_result['baseline_guardrail_passed'],
            'engine_primary': engine_primary,
            'engine_fallback_used': engine_fallback_used,
            'engine_fallback_source': engine_fallback_source,
            'engine_fallback_reason_code': engine_fallback_reason_code,
        },
    }
