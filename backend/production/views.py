from copy import copy
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from urllib.parse import urlencode

from django.db import transaction
from django.db.models import Prefetch, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from unidecode import unidecode

from core.mixins import get_client_ip
from core.models import ApprovalHistory, AuditLog
from core.permissions import check_action_permission
from core.workflow_services import generate_tasks_for_entity
from production.models import (
    ProductionDemand,
    ProductionDemandPlanningStatus,
    ProductionDemandProductionStatus,
    ProductionIssue,
    ProductionIssueLine,
    ProductionIssueStatus,
    ProductionMaterialRequirement,
    ProductionOperation,
    ProductionOperationBlockReason,
    ProductionHandoverStatus as ProductionOperationHandoverStatus,
    ProductionOperationStatus,
    ProductionOrder,
    ProductionOrderStatus,
    ProductionShift as ProductionPlanningShift,
    ProductionReceipt,
    ProductionReceiptLine,
    ProductionReceiptStatus,
)
from production.permissions import (
    can_approve_production_order,
    can_cancel_production_issue,
    can_cancel_production_order,
    can_cancel_production_receipt,
    can_edit_production_order,
    can_issue_materials,
    can_manage_production,
    can_receive_output,
    can_reject_production_order,
    can_release_production_order,
    can_submit_production_order,
)
from production.serializers import (
    ProductionDemandCreateOrderSerializer,
    ProductionDemandDetailSerializer,
    ProductionDemandSerializer,
    ProductionIssueSerializer,
    ProductionOperationSerializer,
    ProductionOrderSerializer,
    ProductionReceiptSerializer,
)
from production.services import (
    add_issued_qty,
    add_produced_qty,
    advance_ready_operations,
    build_material_product_snapshot,
    build_operation_planning_snapshot,
    build_production_order_trace_code,
    create_production_order_from_demand,
    get_shift_capacity_hours,
    get_next_production_issue_code,
    get_next_production_order_code,
    get_next_production_receipt_code,
    recompute_linked_production_demand,
    recompute_production_demand_by_id,
    skip_production_operation,
    subtract_issued_qty,
    subtract_produced_qty,
    sync_order_status_and_demand_counters,
    update_operation_status,
    validate_operation_status_transition,
    validate_production_order_can_release,
)


def _user_role_names(user):
    try:
        pairs = user.roles.values_list('name', 'code')
    except Exception:
        return set()
    names = set()
    for name, code in pairs:
        if name:
            names.add(str(name).strip().lower())
        if code:
            names.add(str(code).strip().lower())
    return names


def _can_manage_production(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'PRODUCTION', 'MANAGE', strict=True):
        return True
    return any(
        role in {
            'admin',
            'manager',
            'ops-manager',
            'operation-manager',
            'product-manager',
            'finance-manager',
            'quan-ly',
            'quanly',
        }
        for role in _user_role_names(user)
    )


def _log_production_audit(request, *, action, entity_type, entity_id, entity_code, old_values, new_values):
    AuditLog.objects.create(
        user=request.user,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_code=entity_code,
        old_values=old_values,
        new_values=new_values,
        ip_address=get_client_ip(request),
        user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
    )


def _approval_action_label(action):
    return {
        'CREATE': 'Đã tạo',
        'UPDATE': 'Đã cập nhật',
        'SUBMIT': 'Gửi duyệt',
        'APPROVE': 'Đã duyệt',
        'REJECT': 'Từ chối',
        'REVOKE': 'Thu hồi',
        'RESUBMIT': 'Gửi lại',
        'ISSUE': 'Đã cấp vật tư',
        'RECEIVE': 'Đã ghi nhận',
        'POST': 'Đã vào sổ',
        'CANCEL': 'Đã hủy',
        'SIGNAL': 'Floor gui tin hieu',
        'HANDOVER': 'Floor chot handover',
    }.get(str(action or '').upper(), str(action or ''))


def _serialize_approval_history_item(item):
    return {
        'action': item.action,
        'action_label': _approval_action_label(item.action),
        'user': getattr(item.user, 'username', None),
        'comments': item.comments,
        'created_at': item.created_at,
    }


def _serialize_audit_timeline_item(item):
    new_values = item.new_values if isinstance(item.new_values, dict) else {}
    comments = ''
    action = str(item.action or '').upper()
    if action in {'RECEIVE', 'ISSUE'}:
        qty = new_values.get('total_qty')
        amount = new_values.get('total_amount')
        segments = []
        if qty not in (None, ''):
            segments.append(f'Số lượng {qty}')
        if amount not in (None, ''):
            segments.append(f'Giá trị {amount}')
        comments = ', '.join(segments)
    elif action in {'CANCEL', 'REJECT'}:
        comments = str(new_values.get('reason') or new_values.get('cancel_reason') or '').strip()
    elif action == 'CREATE':
        comments = str(new_values.get('reference') or '').strip()
    elif action == 'SIGNAL':
        signal_code = str(new_values.get('signal_code') or '').strip()
        signal_note = str(new_values.get('block_reason_note') or new_values.get('handover_note') or '').strip()
        segments = []
        if signal_code:
            segments.append(f'Tin hieu {signal_code}')
        if signal_note:
            segments.append(signal_note)
        comments = ' | '.join(segments)
    elif action == 'HANDOVER':
        handover_status = str(new_values.get('handover_status') or '').strip()
        handover_receiver = str(new_values.get('handover_receiver') or '').strip()
        handover_note = str(new_values.get('handover_note') or '').strip()
        segments = []
        if handover_status:
            segments.append(f'Handover {handover_status}')
        if handover_receiver:
            segments.append(f'Nguoi nhan {handover_receiver}')
        if handover_note:
            segments.append(handover_note)
        comments = ' | '.join(segments)

    return {
        'action': item.action,
        'action_label': _approval_action_label(item.action),
        'user': getattr(item.user, 'username', None),
        'comments': comments,
        'created_at': item.created_at,
    }


def _format_packaging_number(value):
    if value in (None, ''):
        return ''
    text = format(value, 'f') if isinstance(value, Decimal) else str(value)
    if '.' in text:
        text = text.rstrip('0').rstrip('.')
    return text


def _build_production_receipt_line_trace_code(line):
    receipt = getattr(line, 'receipt', None)
    order = getattr(receipt, 'production_order', None)
    product = getattr(line, 'product', None)
    if not order or not product:
        return ''
    return build_production_order_trace_code(order, product)


def _build_production_receipt_packaging_summary(line):
    parts = []
    if getattr(line, 'bundle_count', None):
        parts.append(f'{_format_packaging_number(line.bundle_count)} goi lon')
    if getattr(line, 'units_per_bundle', None):
        parts.append(f'{_format_packaging_number(line.units_per_bundle)} cai/goi')
    if getattr(line, 'pallet_count', None):
        parts.append(f'{_format_packaging_number(line.pallet_count)} pallet')
    if getattr(line, 'bundles_per_pallet', None):
        parts.append(f'{_format_packaging_number(line.bundles_per_pallet)} goi/pallet')
    return ' | '.join(parts)


PLANNING_READINESS_LABELS = {
    'READY': 'San sang chay',
    'PARTIAL': 'Thieu mot phan vat tu',
    'WAITING': 'Cho vat tu',
}

PLANNING_DEPENDENCY_LABELS = {
    'ROOT': 'Cong doan dau',
    'CLEAR': 'Khong bi chan',
    'WAIT_PREVIOUS_STEP': 'Cho cong doan truoc',
}

PLANNING_RISK_LABELS = {
    'DONE': 'Da xong',
    'UNSCHEDULED': 'Chua xep lich',
    'OVERDUE': 'Qua han',
    'BLOCKED': 'Dang nghen',
    'AT_RISK': 'Can uu tien',
    'ON_TRACK': 'Dang bam ke hoach',
}

PLANNING_BUCKETS = {
    'OVERDUE': {'label': 'Qua han', 'sort': 1},
    'TODAY': {'label': 'Hom nay', 'sort': 2},
    'TOMORROW': {'label': 'Ngay mai', 'sort': 3},
    'UPCOMING': {'label': 'Sap toi', 'sort': 4},
    'UNSCHEDULED': {'label': 'Chua xep', 'sort': 5},
}

PLANNING_SHIFT_FILTERS = {
    'MORNING': {'label': 'Ca sang', 'sort': 1},
    'AFTERNOON': {'label': 'Ca chieu', 'sort': 2},
    'EVENING': {'label': 'Ca toi', 'sort': 3},
    'NIGHT': {'label': 'Ca dem', 'sort': 4},
    'FULLDAY': {'label': 'Ca ca ngay', 'sort': 5},
    'UNASSIGNED': {'label': 'Chua xep ca', 'sort': 99},
}

PLANNING_HANDOVER_FILTERS = {
    'ACTIVE': {'label': 'Dang thao tac', 'sort': 1},
    'READY': {'label': 'San sang ban giao', 'sort': 2},
    'ACCEPTED': {'label': 'Da tiep quan', 'sort': 3},
    'NONE': {'label': 'Chua chot handover', 'sort': 99},
}

PLANNING_CAPACITY_STATES = {
    'BALANCED': {'label': 'Tai on dinh', 'sort': 1},
    'AT_LIMIT': {'label': 'Sap kin tai', 'sort': 2},
    'OVER_CAPACITY': {'label': 'Qua tai', 'sort': 3},
    'UNASSIGNED_MACHINE': {'label': 'Chua gan may', 'sort': 4},
    'UNASSIGNED_WORK_CENTER': {'label': 'Chua gan work center', 'sort': 5},
}

SKIP_OPERATION_REQUIRED_MESSAGE = 'Vui long dung chuc nang Bo qua cong doan va nhap ly do.'


def _parse_optional_date(value, *, field_label):
    if value in (None, ''):
        return None
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise ValidationError({field_label: f'{field_label} khong hop le.'}) from exc


def _parse_optional_int(value, *, field_label):
    if value in (None, ''):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError({field_label: f'{field_label} khong hop le.'}) from exc
    if parsed < 0:
        raise ValidationError({field_label: f'{field_label} khong duoc am.'})
    return parsed


def _parse_optional_decimal(value, *, field_label):
    if value in (None, ''):
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValidationError({field_label: f'{field_label} khong hop le.'}) from exc
    if parsed < 0:
        raise ValidationError({field_label: f'{field_label} khong duoc am.'})
    return parsed


def _get_planning_bucket(planned_date, *, today):
    if planned_date is None:
        return 'UNSCHEDULED'
    if planned_date < today:
        return 'OVERDUE'
    if planned_date == today:
        return 'TODAY'
    if planned_date == today + timedelta(days=1):
        return 'TOMORROW'
    return 'UPCOMING'


def _is_ready_to_run_operation(operation, *, snapshot):
    return (
        str(snapshot.get('material_readiness') or '').strip().upper() == 'READY'
        and str(snapshot.get('dependency_state') or '').strip().upper() in {'ROOT', 'CLEAR'}
        and not str(getattr(operation, 'block_reason_code', '') or '').strip()
        and str(getattr(operation, 'status', '') or '').strip().upper()
        in {ProductionOperationStatus.PENDING, ProductionOperationStatus.READY}
    )


def _is_ready_to_run_card(card):
    return (
        str(card['materials'].get('material_readiness') or '').strip().upper() == 'READY'
        and str(card['exceptions'].get('dependency_state') or '').strip().upper() in {'ROOT', 'CLEAR'}
        and not str(card['exceptions'].get('block_reason_code') or '').strip()
        and str(card['operation'].get('status') or '').strip().upper()
        in {ProductionOperationStatus.PENDING, ProductionOperationStatus.READY}
    )


def _get_planning_shift_key(value):
    shift_key = str(value or '').strip().upper()
    if not shift_key:
        return 'UNASSIGNED'
    if shift_key in PLANNING_SHIFT_FILTERS:
        return shift_key
    return 'UNASSIGNED'


def _build_planning_url(base_url, params=None):
    query = {
        key: value
        for key, value in (params or {}).items()
        if value not in (None, '', False)
    }
    if not query:
        return base_url
    return f'{base_url}?{urlencode(query)}'


def _build_shift_load_item(shift_key):
    shift_meta = PLANNING_SHIFT_FILTERS.get(shift_key, PLANNING_SHIFT_FILTERS['UNASSIGNED'])
    return {
        'key': shift_key,
        'label': shift_meta['label'],
        'sort_order': shift_meta['sort'],
        'total_operations': 0,
        'ready_to_run_count': 0,
        'needs_attention_count': 0,
        'overdue_count': 0,
        'planned_qty': Decimal('0'),
    }


def _accumulate_shift_load(item, card):
    item['total_operations'] += 1
    if _is_ready_to_run_card(card):
        item['ready_to_run_count'] += 1
    if card['exceptions'].get('needs_attention'):
        item['needs_attention_count'] += 1
    if card['exceptions'].get('risk_state') == 'OVERDUE':
        item['overdue_count'] += 1
    item['planned_qty'] += Decimal(str(card['operation'].get('planned_qty') or 0))


def _finalize_shift_loads(items, *, include_empty):
    return [
        {
            'key': item['key'],
            'label': item['label'],
            'sort_order': item['sort_order'],
            'total_operations': item['total_operations'],
            'ready_to_run_count': item['ready_to_run_count'],
            'needs_attention_count': item['needs_attention_count'],
            'overdue_count': item['overdue_count'],
            'planned_qty': str(item['planned_qty']),
        }
        for item in sorted(
            items,
            key=lambda candidate: (candidate['sort_order'], candidate['label']),
        )
        if include_empty or item['total_operations'] > 0
    ]


def _get_handover_filter_key(value):
    handover_key = str(value or '').strip().upper()
    if not handover_key:
        return 'NONE'
    if handover_key in PLANNING_HANDOVER_FILTERS:
        return handover_key
    return 'NONE'


def _build_dispatch_group_item(shift_key):
    shift_meta = PLANNING_SHIFT_FILTERS.get(shift_key, PLANNING_SHIFT_FILTERS['UNASSIGNED'])
    return {
        'key': shift_key,
        'label': shift_meta['label'],
        'sort_order': shift_meta['sort'],
        'total_operations': 0,
        'ready_to_run_count': 0,
        'in_progress_count': 0,
        'blocked_count': 0,
        'handover_ready_count': 0,
        'handover_accepted_count': 0,
        'active_owner_count': 0,
        'owners': set(),
        'cards': [],
    }


def _accumulate_dispatch_group(item, card):
    item['total_operations'] += 1
    if _is_ready_to_run_card(card):
        item['ready_to_run_count'] += 1
    if card['operation'].get('status') == ProductionOperationStatus.IN_PROGRESS:
        item['in_progress_count'] += 1
    if card['exceptions'].get('risk_state') == 'BLOCKED':
        item['blocked_count'] += 1
    if card['shop_floor'].get('handover_status') == ProductionOperationHandoverStatus.READY:
        item['handover_ready_count'] += 1
    if card['shop_floor'].get('handover_status') == ProductionOperationHandoverStatus.ACCEPTED:
        item['handover_accepted_count'] += 1
    owner = str(card['shop_floor'].get('dispatch_owner') or '').strip()
    if owner:
        item['owners'].add(owner)
    item['cards'].append(card)


def _finalize_dispatch_groups(items):
    groups = []
    for item in sorted(items, key=lambda candidate: (candidate['sort_order'], candidate['label'])):
        cards = sorted(
            item['cards'],
            key=lambda card: (
                0 if card['materials'].get('ready_to_run') else 1,
                0 if card['exceptions'].get('risk_state') == 'OVERDUE' else 1,
                card['operation'].get('planned_date') or '9999-12-31',
                card['operation'].get('priority_rank') or 99999,
            ),
        )
        groups.append({
            'key': item['key'],
            'label': item['label'],
            'sort_order': item['sort_order'],
            'total_operations': item['total_operations'],
            'ready_to_run_count': item['ready_to_run_count'],
            'in_progress_count': item['in_progress_count'],
            'blocked_count': item['blocked_count'],
            'handover_ready_count': item['handover_ready_count'],
            'handover_accepted_count': item['handover_accepted_count'],
            'active_owner_count': len(item['owners']),
            'owners': sorted(item['owners']),
            'cards': cards[:8],
        })
    return groups


def _get_card_runtime_hours(card):
    return Decimal(str(card['operation'].get('estimated_runtime_hours') or 0))


def _get_card_setup_hours(card):
    return Decimal(str(card['operation'].get('setup_minutes') or 0)) / Decimal('60')


def _get_card_scheduled_hours(card):
    return _get_card_runtime_hours(card) + _get_card_setup_hours(card)


def _get_capacity_ratio(load_hours, capacity_hours):
    if capacity_hours <= 0:
        return None
    return (load_hours / capacity_hours).quantize(Decimal('0.01'))


def _build_work_center_group_item(group_key, *, work_center_code, work_center_name, planned_date, shift_key):
    shift_meta = PLANNING_SHIFT_FILTERS.get(shift_key, PLANNING_SHIFT_FILTERS['UNASSIGNED'])
    return {
        'key': group_key,
        'work_center_code': work_center_code or '',
        'work_center_name': work_center_name or '',
        'planned_date': planned_date,
        'shift_key': shift_key,
        'shift_label': shift_meta['label'],
        'sort_order': shift_meta['sort'],
        'total_operations': 0,
        'ready_to_run_count': 0,
        'blocked_count': 0,
        'in_progress_count': 0,
        'runtime_hours': Decimal('0'),
        'setup_hours': Decimal('0'),
        'scheduled_hours': Decimal('0'),
        'capacity_hours': Decimal('0'),
        'machine_codes': set(),
        'cards': [],
        'overloaded': False,
    }


def _build_machine_queue_item(group_key, *, work_center_code, work_center_name, machine_code, machine_name, planned_date, shift_key):
    shift_meta = PLANNING_SHIFT_FILTERS.get(shift_key, PLANNING_SHIFT_FILTERS['UNASSIGNED'])
    return {
        'key': group_key,
        'work_center_code': work_center_code or '',
        'work_center_name': work_center_name or '',
        'machine_code': machine_code or '',
        'machine_name': machine_name or '',
        'planned_date': planned_date,
        'shift_key': shift_key,
        'shift_label': shift_meta['label'],
        'sort_order': shift_meta['sort'],
        'total_operations': 0,
        'ready_to_run_count': 0,
        'overdue_count': 0,
        'runtime_hours': Decimal('0'),
        'setup_hours': Decimal('0'),
        'scheduled_hours': Decimal('0'),
        'capacity_hours': Decimal('0'),
        'cards': [],
        'overloaded': False,
    }


def _finalize_work_center_groups(items):
    groups = []
    for item in sorted(
        items,
        key=lambda candidate: (
            candidate['planned_date'] or '9999-12-31',
            candidate['sort_order'],
            candidate['work_center_name'] or candidate['work_center_code'] or 'zzz',
        ),
    ):
        load_ratio = _get_capacity_ratio(item['scheduled_hours'], item['capacity_hours'])
        groups.append({
            'key': item['key'],
            'work_center_code': item['work_center_code'],
            'work_center_name': item['work_center_name'],
            'planned_date': item['planned_date'],
            'shift_key': item['shift_key'],
            'shift_label': item['shift_label'],
            'sort_order': item['sort_order'],
            'total_operations': item['total_operations'],
            'ready_to_run_count': item['ready_to_run_count'],
            'blocked_count': item['blocked_count'],
            'in_progress_count': item['in_progress_count'],
            'runtime_hours': str(item['runtime_hours']),
            'setup_hours': str(item['setup_hours']),
            'scheduled_hours': str(item['scheduled_hours']),
            'capacity_hours': str(item['capacity_hours']),
            'load_ratio': str(load_ratio) if load_ratio is not None else None,
            'machine_count': len(item['machine_codes']),
            'overloaded': item['overloaded'],
            'cards': sorted(
                item['cards'],
                key=lambda card: (
                    card['operation'].get('dispatch_sequence') or 99999,
                    card['operation'].get('priority_rank') or 99999,
                    card['operation'].get('planned_date') or '9999-12-31',
                ),
            )[:8],
        })
    return groups


def _finalize_machine_queues(items):
    queues = []
    for item in sorted(
        items,
        key=lambda candidate: (
            candidate['planned_date'] or '9999-12-31',
            candidate['sort_order'],
            candidate['machine_name'] or candidate['machine_code'] or 'zzz',
        ),
    ):
        load_ratio = _get_capacity_ratio(item['scheduled_hours'], item['capacity_hours'])
        queues.append({
            'key': item['key'],
            'work_center_code': item['work_center_code'],
            'work_center_name': item['work_center_name'],
            'machine_code': item['machine_code'],
            'machine_name': item['machine_name'],
            'planned_date': item['planned_date'],
            'shift_key': item['shift_key'],
            'shift_label': item['shift_label'],
            'sort_order': item['sort_order'],
            'total_operations': item['total_operations'],
            'ready_to_run_count': item['ready_to_run_count'],
            'overdue_count': item['overdue_count'],
            'runtime_hours': str(item['runtime_hours']),
            'setup_hours': str(item['setup_hours']),
            'scheduled_hours': str(item['scheduled_hours']),
            'capacity_hours': str(item['capacity_hours']),
            'load_ratio': str(load_ratio) if load_ratio is not None else None,
            'overloaded': item['overloaded'],
            'cards': sorted(
                item['cards'],
                key=lambda card: (
                    card['operation'].get('dispatch_sequence') or 99999,
                    card['operation'].get('priority_rank') or 99999,
                    card['operation'].get('planned_date') or '9999-12-31',
                ),
            )[:8],
        })
    return queues


def _annotate_capacity_context(cards):
    work_center_slots = {}
    machine_slots = {}
    work_center_groups = {}
    machine_queues = {}
    summary = {
        'total_runtime_hours': Decimal('0'),
        'total_setup_hours': Decimal('0'),
        'total_scheduled_hours': Decimal('0'),
        'over_capacity_count': 0,
        'over_capacity_slot_count': 0,
        'unassigned_machine_count': 0,
        'unassigned_work_center_count': 0,
        'capacity_state_counts': {key: 0 for key in PLANNING_CAPACITY_STATES},
    }

    for card in cards:
        operation = card['operation']
        work_center_code = str(operation.get('work_center_code') or '').strip()
        work_center_name = str(operation.get('work_center_name') or '').strip()
        machine_code = str(operation.get('machine_code') or '').strip()
        machine_name = str(operation.get('machine_name') or '').strip()
        planned_date = operation.get('planned_date')
        shift_key = _get_planning_shift_key(operation.get('planned_shift'))
        scheduled_hours = _get_card_scheduled_hours(card)
        runtime_hours = _get_card_runtime_hours(card)
        setup_hours = _get_card_setup_hours(card)
        capacity_hours = Decimal('0') if shift_key == 'UNASSIGNED' else Decimal(str(get_shift_capacity_hours(shift_key)))

        summary['total_runtime_hours'] += runtime_hours
        summary['total_setup_hours'] += setup_hours
        summary['total_scheduled_hours'] += scheduled_hours

        if work_center_code:
            slot_key = f'{work_center_code}|{planned_date or ""}|{shift_key}'
            work_center_slots[slot_key] = work_center_slots.get(slot_key, Decimal('0')) + scheduled_hours
            group = work_center_groups.setdefault(
                slot_key,
                _build_work_center_group_item(
                    slot_key,
                    work_center_code=work_center_code,
                    work_center_name=work_center_name,
                    planned_date=planned_date,
                    shift_key=shift_key,
                ),
            )
            group['total_operations'] += 1
            group['runtime_hours'] += runtime_hours
            group['setup_hours'] += setup_hours
            group['scheduled_hours'] += scheduled_hours
            group['capacity_hours'] = capacity_hours
            if _is_ready_to_run_card(card):
                group['ready_to_run_count'] += 1
            if card['exceptions'].get('risk_state') == 'BLOCKED':
                group['blocked_count'] += 1
            if operation.get('status') == ProductionOperationStatus.IN_PROGRESS:
                group['in_progress_count'] += 1
            if machine_code:
                group['machine_codes'].add(machine_code)
            group['cards'].append(card)
        else:
            summary['unassigned_work_center_count'] += 1

        if machine_code:
            queue_key = f'{machine_code}|{planned_date or ""}|{shift_key}'
            machine_slots[queue_key] = machine_slots.get(queue_key, Decimal('0')) + scheduled_hours
            queue = machine_queues.setdefault(
                queue_key,
                _build_machine_queue_item(
                    queue_key,
                    work_center_code=work_center_code,
                    work_center_name=work_center_name,
                    machine_code=machine_code,
                    machine_name=machine_name,
                    planned_date=planned_date,
                    shift_key=shift_key,
                ),
            )
            queue['total_operations'] += 1
            queue['runtime_hours'] += runtime_hours
            queue['setup_hours'] += setup_hours
            queue['scheduled_hours'] += scheduled_hours
            queue['capacity_hours'] = capacity_hours
            if _is_ready_to_run_card(card):
                queue['ready_to_run_count'] += 1
            if card['exceptions'].get('risk_state') == 'OVERDUE':
                queue['overdue_count'] += 1
            queue['cards'].append(card)
        else:
            summary['unassigned_machine_count'] += 1 if work_center_code else 0

    overloaded_slots = set()
    for card in cards:
        operation = card['operation']
        work_center_code = str(operation.get('work_center_code') or '').strip()
        work_center_name = str(operation.get('work_center_name') or '').strip()
        machine_code = str(operation.get('machine_code') or '').strip()
        machine_name = str(operation.get('machine_name') or '').strip()
        planned_date = operation.get('planned_date')
        shift_key = _get_planning_shift_key(operation.get('planned_shift'))
        shift_meta = PLANNING_SHIFT_FILTERS.get(shift_key, PLANNING_SHIFT_FILTERS['UNASSIGNED'])
        scheduled_hours = _get_card_scheduled_hours(card)
        runtime_hours = _get_card_runtime_hours(card)
        setup_hours = _get_card_setup_hours(card)
        capacity_hours = Decimal('0') if shift_key == 'UNASSIGNED' else Decimal(str(get_shift_capacity_hours(shift_key)))
        work_center_slot_key = f'{work_center_code}|{planned_date or ""}|{shift_key}' if work_center_code else ''
        machine_slot_key = f'{machine_code}|{planned_date or ""}|{shift_key}' if machine_code else ''
        work_center_load = work_center_slots.get(work_center_slot_key, Decimal('0'))
        machine_load = machine_slots.get(machine_slot_key, Decimal('0'))
        work_center_ratio = _get_capacity_ratio(work_center_load, capacity_hours)
        machine_ratio = _get_capacity_ratio(machine_load, capacity_hours)
        if not work_center_code:
            capacity_state = 'UNASSIGNED_WORK_CENTER'
        elif not machine_code:
            capacity_state = 'UNASSIGNED_MACHINE'
        elif capacity_hours > 0 and (work_center_load > capacity_hours or machine_load > capacity_hours):
            capacity_state = 'OVER_CAPACITY'
            overloaded_slots.add(work_center_slot_key or machine_slot_key)
        elif work_center_ratio is not None and work_center_ratio >= Decimal('0.85'):
            capacity_state = 'AT_LIMIT'
        else:
            capacity_state = 'BALANCED'
        summary['capacity_state_counts'][capacity_state] += 1
        if capacity_state == 'OVER_CAPACITY':
            summary['over_capacity_count'] += 1
        card['capacity'] = {
            'work_center_code': work_center_code,
            'work_center_name': work_center_name,
            'machine_code': machine_code,
            'machine_name': machine_name,
            'shift_key': shift_key,
            'shift_label': shift_meta['label'],
            'runtime_hours': str(runtime_hours),
            'setup_hours': str(setup_hours),
            'scheduled_hours': str(scheduled_hours),
            'shift_capacity_hours': str(capacity_hours),
            'work_center_load_hours': str(work_center_load),
            'machine_load_hours': str(machine_load),
            'work_center_load_ratio': str(work_center_ratio) if work_center_ratio is not None else None,
            'machine_load_ratio': str(machine_ratio) if machine_ratio is not None else None,
            'capacity_state': capacity_state,
            'capacity_state_label': PLANNING_CAPACITY_STATES[capacity_state]['label'],
            'over_capacity': capacity_state == 'OVER_CAPACITY',
            'unassigned_machine': capacity_state == 'UNASSIGNED_MACHINE',
            'unassigned_work_center': capacity_state == 'UNASSIGNED_WORK_CENTER',
        }
        if work_center_slot_key in work_center_groups:
            work_center_groups[work_center_slot_key]['overloaded'] = work_center_groups[work_center_slot_key]['overloaded'] or capacity_state == 'OVER_CAPACITY'
        if machine_slot_key in machine_queues:
            machine_queues[machine_slot_key]['overloaded'] = machine_queues[machine_slot_key]['overloaded'] or capacity_state == 'OVER_CAPACITY'
    summary['over_capacity_slot_count'] = len(overloaded_slots)
    return {
        'summary': {
            'total_runtime_hours': str(summary['total_runtime_hours']),
            'total_setup_hours': str(summary['total_setup_hours']),
            'total_scheduled_hours': str(summary['total_scheduled_hours']),
            'over_capacity_count': summary['over_capacity_count'],
            'over_capacity_slot_count': summary['over_capacity_slot_count'],
            'unassigned_machine_count': summary['unassigned_machine_count'],
            'unassigned_work_center_count': summary['unassigned_work_center_count'],
            'capacity_state_counts': summary['capacity_state_counts'],
        },
        'work_center_groups': _finalize_work_center_groups(work_center_groups.values()),
        'machine_queues': _finalize_machine_queues(machine_queues.values()),
    }


def _build_capacity_calendar_shift_item(date_key, shift_key):
    shift_meta = PLANNING_SHIFT_FILTERS.get(shift_key, PLANNING_SHIFT_FILTERS['UNASSIGNED'])
    return {
        'key': f'{date_key}|{shift_key}',
        'date': None if date_key == 'UNSCHEDULED' else date_key,
        'shift_key': shift_key,
        'shift_label': shift_meta['label'],
        'sort_order': shift_meta['sort'],
        'total_operations': 0,
        'ready_to_run_count': 0,
        'needs_attention_count': 0,
        'blocked_count': 0,
        'over_capacity_count': 0,
        'at_limit_count': 0,
        'unassigned_machine_count': 0,
        'unassigned_work_center_count': 0,
        'runtime_hours': Decimal('0'),
        'setup_hours': Decimal('0'),
        'scheduled_hours': Decimal('0'),
        'capacity_hours': Decimal('0'),
        'affected_sales_order_ids': set(),
    }


def _finalize_capacity_calendar(rows):
    items = []
    shift_order = list(PLANNING_SHIFT_FILTERS.keys())
    for row in sorted(
        rows.values(),
        key=lambda candidate: (
            candidate['sort_order'],
            candidate['date'] or '9999-12-31',
        ),
    ):
        shift_map = row['shift_map']
        shifts = []
        for shift_key in shift_order:
            item = shift_map.get(shift_key) or _build_capacity_calendar_shift_item(row['key'], shift_key)
            load_ratio = _get_capacity_ratio(item['scheduled_hours'], item['capacity_hours'])
            window_state = 'BALANCED'
            if item['over_capacity_count'] > 0:
                window_state = 'OVER_CAPACITY'
            elif item['at_limit_count'] > 0:
                window_state = 'AT_LIMIT'
            shifts.append({
                'key': item['key'],
                'date': item['date'],
                'shift_key': item['shift_key'],
                'shift_label': item['shift_label'],
                'sort_order': item['sort_order'],
                'total_operations': item['total_operations'],
                'ready_to_run_count': item['ready_to_run_count'],
                'needs_attention_count': item['needs_attention_count'],
                'blocked_count': item['blocked_count'],
                'over_capacity_count': item['over_capacity_count'],
                'at_limit_count': item['at_limit_count'],
                'unassigned_machine_count': item['unassigned_machine_count'],
                'unassigned_work_center_count': item['unassigned_work_center_count'],
                'runtime_hours': str(item['runtime_hours']),
                'setup_hours': str(item['setup_hours']),
                'scheduled_hours': str(item['scheduled_hours']),
                'capacity_hours': str(item['capacity_hours']),
                'load_ratio': str(load_ratio) if load_ratio is not None else None,
                'window_state': window_state,
                'affected_sales_order_count': len(item['affected_sales_order_ids']),
            })

        items.append({
            'key': row['key'],
            'date': row['date'],
            'date_label': row['date_label'],
            'sort_order': row['sort_order'],
            'total_operations': row['total_operations'],
            'ready_to_run_count': row['ready_to_run_count'],
            'needs_attention_count': row['needs_attention_count'],
            'blocked_count': row['blocked_count'],
            'over_capacity_count': row['over_capacity_count'],
            'at_limit_count': row['at_limit_count'],
            'runtime_hours': str(row['runtime_hours']),
            'setup_hours': str(row['setup_hours']),
            'scheduled_hours': str(row['scheduled_hours']),
            'affected_sales_order_count': len(row['affected_sales_order_ids']),
            'shifts': shifts,
        })
    return items


def _build_capacity_calendar(cards):
    rows = {}
    for card in cards:
        planned_date = card['operation'].get('planned_date')
        row_key = planned_date or 'UNSCHEDULED'
        row = rows.setdefault(
            row_key,
            {
                'key': row_key,
                'date': planned_date,
                'date_label': 'Chua xep lich' if planned_date is None else planned_date,
                'sort_order': 99999 if planned_date is None else 1,
                'total_operations': 0,
                'ready_to_run_count': 0,
                'needs_attention_count': 0,
                'blocked_count': 0,
                'over_capacity_count': 0,
                'at_limit_count': 0,
                'runtime_hours': Decimal('0'),
                'setup_hours': Decimal('0'),
                'scheduled_hours': Decimal('0'),
                'affected_sales_order_ids': set(),
                'shift_map': {},
            },
        )
        shift_key = _get_planning_shift_key(card['operation'].get('planned_shift'))
        shift_item = row['shift_map'].setdefault(shift_key, _build_capacity_calendar_shift_item(row_key, shift_key))
        if planned_date is not None and shift_key != 'UNASSIGNED':
            shift_item['capacity_hours'] = Decimal(str(get_shift_capacity_hours(shift_key)))
        runtime_hours = Decimal(str(card['capacity'].get('runtime_hours') or 0))
        setup_hours = Decimal(str(card['capacity'].get('setup_hours') or 0))
        scheduled_hours = Decimal(str(card['capacity'].get('scheduled_hours') or 0))
        row['total_operations'] += 1
        shift_item['total_operations'] += 1
        row['runtime_hours'] += runtime_hours
        row['setup_hours'] += setup_hours
        row['scheduled_hours'] += scheduled_hours
        shift_item['runtime_hours'] += runtime_hours
        shift_item['setup_hours'] += setup_hours
        shift_item['scheduled_hours'] += scheduled_hours
        if _is_ready_to_run_card(card):
            row['ready_to_run_count'] += 1
            shift_item['ready_to_run_count'] += 1
        if card['exceptions'].get('needs_attention'):
            row['needs_attention_count'] += 1
            shift_item['needs_attention_count'] += 1
        if card['exceptions'].get('risk_state') == 'BLOCKED':
            row['blocked_count'] += 1
            shift_item['blocked_count'] += 1
        if card['capacity'].get('capacity_state') == 'OVER_CAPACITY':
            row['over_capacity_count'] += 1
            shift_item['over_capacity_count'] += 1
        if card['capacity'].get('capacity_state') == 'AT_LIMIT':
            row['at_limit_count'] += 1
            shift_item['at_limit_count'] += 1
        if card['capacity'].get('capacity_state') == 'UNASSIGNED_MACHINE':
            shift_item['unassigned_machine_count'] += 1
        if card['capacity'].get('capacity_state') == 'UNASSIGNED_WORK_CENTER':
            shift_item['unassigned_work_center_count'] += 1
        sales_order_id = card['sales'].get('sales_order_id')
        if sales_order_id:
            row['affected_sales_order_ids'].add(sales_order_id)
            shift_item['affected_sales_order_ids'].add(sales_order_id)
    return _finalize_capacity_calendar(rows)


def _get_capacity_window_score(shift):
    try:
        load_ratio = Decimal(str(shift.get('load_ratio') or 0))
    except (InvalidOperation, TypeError, ValueError):
        load_ratio = Decimal('0')
    return (
        int(shift.get('over_capacity_count') or 0) * 100
        + int(shift.get('at_limit_count') or 0) * 60
        + int(shift.get('needs_attention_count') or 0) * 20
        + int(shift.get('blocked_count') or 0) * 15
        + int(load_ratio * 100)
    )


def _serialize_planner_window_focus(shift):
    params = {}
    if shift.get('date'):
        params['planned_date'] = shift['date']
        params['focus_window_date'] = shift['date']
    if shift.get('shift_key'):
        params['planned_shift'] = shift['shift_key']
        params['focus_window_shift'] = shift['shift_key']
    if shift.get('window_state') == 'OVER_CAPACITY':
        params['capacity_state'] = 'OVER_CAPACITY'
    elif shift.get('window_state') == 'AT_LIMIT':
        params['capacity_state'] = 'AT_LIMIT'
    return {
        'key': shift.get('key') or '',
        'date': shift.get('date'),
        'date_label': shift.get('date') or 'Chua xep lich',
        'shift_key': shift.get('shift_key') or '',
        'shift_label': shift.get('shift_label') or '',
        'window_state': shift.get('window_state') or 'BALANCED',
        'total_operations': int(shift.get('total_operations') or 0),
        'needs_attention_count': int(shift.get('needs_attention_count') or 0),
        'over_capacity_count': int(shift.get('over_capacity_count') or 0),
        'at_limit_count': int(shift.get('at_limit_count') or 0),
        'load_ratio': shift.get('load_ratio'),
        'focus_url': _build_planning_url('/production-planning', params),
    }


def _build_planner_window_focus(capacity_calendar, *, target_state=None):
    matches = []
    for row in capacity_calendar:
        for shift in row.get('shifts', []):
            if int(shift.get('total_operations') or 0) <= 0:
                continue
            if target_state and str(shift.get('window_state') or '').upper() != str(target_state).upper():
                continue
            matches.append(shift)
    if not matches:
        return None
    selected = max(
        matches,
        key=lambda item: (
            _get_capacity_window_score(item),
            int(item.get('over_capacity_count') or 0),
            int(item.get('at_limit_count') or 0),
            int(item.get('total_operations') or 0),
            str(item.get('key') or ''),
        ),
    )
    return _serialize_planner_window_focus(selected)


def _get_machine_queue_focus_score(queue):
    try:
        load_ratio = Decimal(str(queue.get('load_ratio') or 0))
    except (InvalidOperation, TypeError, ValueError):
        load_ratio = Decimal('0')
    return (
        (120 if queue.get('overloaded') else 0)
        + int(queue.get('overdue_count') or 0) * 40
        + int(queue.get('ready_to_run_count') or 0) * 10
        + int(queue.get('total_operations') or 0) * 5
        + int(load_ratio * 100)
    )


def _build_planner_queue_focus(machine_queues):
    candidates = [queue for queue in machine_queues if int(queue.get('total_operations') or 0) > 0]
    if not candidates:
        return None
    selected = max(
        candidates,
        key=lambda item: (
            _get_machine_queue_focus_score(item),
            int(item.get('overdue_count') or 0),
            int(item.get('total_operations') or 0),
            str(item.get('key') or ''),
        ),
    )
    params = {
        'view': 'LIST',
        'queue_key': selected.get('key') or '',
        'focus_window_date': selected.get('planned_date') or '',
        'focus_window_shift': selected.get('shift_key') or '',
    }
    if selected.get('machine_code'):
        params['machine_code'] = selected['machine_code']
    if selected.get('work_center_code'):
        params['work_center_code'] = selected['work_center_code']
    if selected.get('planned_date'):
        params['planned_date'] = selected['planned_date']
    if selected.get('shift_key'):
        params['planned_shift'] = selected['shift_key']
    return {
        'key': selected.get('key') or '',
        'planned_date': selected.get('planned_date'),
        'shift_key': selected.get('shift_key') or '',
        'shift_label': selected.get('shift_label') or '',
        'work_center_code': selected.get('work_center_code') or '',
        'work_center_name': selected.get('work_center_name') or '',
        'machine_code': selected.get('machine_code') or '',
        'machine_name': selected.get('machine_name') or '',
        'total_operations': int(selected.get('total_operations') or 0),
        'ready_to_run_count': int(selected.get('ready_to_run_count') or 0),
        'overdue_count': int(selected.get('overdue_count') or 0),
        'load_ratio': selected.get('load_ratio'),
        'overloaded': bool(selected.get('overloaded')),
        'focus_url': _build_planning_url('/production-planning', params),
    }


def _get_dispatch_owner_focus_score(item):
    return (
        int(item.get('overdue_count') or 0) * 50
        + int(item.get('blocked_count') or 0) * 45
        + int(item.get('handover_ready_count') or 0) * 25
        + int(item.get('ready_to_run_count') or 0) * 12
        + int(item.get('affected_sales_order_count') or 0) * 15
        + int(item.get('total_operations') or 0) * 5
    )


def _build_planner_dispatch_owner_groups(cards, *, limit=6):
    groups = {}
    for card in cards:
        owner = str(card.get('shop_floor', {}).get('dispatch_owner') or '').strip()
        if not owner:
            continue
        item = groups.setdefault(
            owner,
            {
                'key': owner,
                'dispatch_owner': owner,
                'total_operations': 0,
                'ready_to_run_count': 0,
                'blocked_count': 0,
                'overdue_count': 0,
                'handover_ready_count': 0,
                'affected_sales_order_ids': set(),
            },
        )
        item['total_operations'] += 1
        if _is_ready_to_run_card(card):
            item['ready_to_run_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'BLOCKED':
            item['blocked_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'OVERDUE':
            item['overdue_count'] += 1
        if str(card.get('shop_floor', {}).get('handover_status') or '').strip().upper() == ProductionOperationHandoverStatus.READY:
            item['handover_ready_count'] += 1
        sales_order_id = card.get('sales', {}).get('sales_order_id')
        if sales_order_id:
            item['affected_sales_order_ids'].add(sales_order_id)

    rows = []
    for item in groups.values():
        params = {'dispatch_owner': item['dispatch_owner']}
        if item['blocked_count'] or item['overdue_count']:
            params['needs_attention'] = 1
        elif item['handover_ready_count']:
            params['handover_status'] = 'READY'
        elif item['ready_to_run_count']:
            params['ready_to_run'] = 1
        rows.append(
            {
                'key': item['key'],
                'dispatch_owner': item['dispatch_owner'],
                'total_operations': item['total_operations'],
                'ready_to_run_count': item['ready_to_run_count'],
                'blocked_count': item['blocked_count'],
                'overdue_count': item['overdue_count'],
                'handover_ready_count': item['handover_ready_count'],
                'affected_sales_order_count': len(item['affected_sales_order_ids']),
                'focus_url': _build_planning_url('/production-planning', params),
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_dispatch_owner_focus_score(row),
            row['dispatch_owner'].lower(),
        ),
    )
    return rows[:limit]


def _get_sales_watch_score(item):
    negative_delivery_gap_count = int(item.get('negative_delivery_gap_count') or 0)
    try:
        earliest_due_ordinal = date.fromisoformat(str(item.get('earliest_due_date'))).toordinal() if item.get('earliest_due_date') else 999999
    except (TypeError, ValueError):
        earliest_due_ordinal = 999999
    return (
        int(item.get('overdue_count') or 0) * 55
        + int(item.get('blocked_count') or 0) * 45
        + int(item.get('wait_material_count') or 0) * 30
        + negative_delivery_gap_count * 35
        + max(0, 400000 - earliest_due_ordinal)
        + int(item.get('total_operations') or 0) * 5
    )


def _build_planner_sales_watch(cards, *, limit=6):
    groups = {}
    for card in cards:
        sales_order_code = str(card.get('sales', {}).get('sales_order_code') or '').strip()
        if not sales_order_code:
            continue
        item = groups.setdefault(
            sales_order_code,
            {
                'key': sales_order_code,
                'sales_order_code': sales_order_code,
                'customer_code': str(card.get('sales', {}).get('customer_code') or '').strip(),
                'customer_name': str(card.get('sales', {}).get('customer_name') or '').strip(),
                'total_operations': 0,
                'overdue_count': 0,
                'wait_material_count': 0,
                'blocked_count': 0,
                'negative_delivery_gap_count': 0,
                'earliest_due_date': None,
                'sales_fulfillment_url': str(card.get('actions', {}).get('sales_fulfillment_url') or '').strip(),
            },
        )
        item['total_operations'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'OVERDUE':
            item['overdue_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'BLOCKED':
            item['blocked_count'] += 1
        if str(card.get('materials', {}).get('material_readiness') or '').strip().upper() != 'READY':
            item['wait_material_count'] += 1
        delivery_gap_days = card.get('exceptions', {}).get('delivery_gap_days')
        if delivery_gap_days is not None and int(delivery_gap_days) < 0:
            item['negative_delivery_gap_count'] += 1
        due_date = card.get('sales', {}).get('delivery_due_date') or card.get('order', {}).get('planned_end_date')
        if due_date and (not item['earliest_due_date'] or due_date < item['earliest_due_date']):
            item['earliest_due_date'] = due_date

    rows = []
    for item in groups.values():
        params = {'sales_order_code': item['sales_order_code']}
        if item['overdue_count'] or item['blocked_count'] or item['negative_delivery_gap_count']:
            params['needs_attention'] = 1
        elif item['wait_material_count']:
            params['has_material_wait'] = 1
        rows.append(
            {
                'key': item['key'],
                'sales_order_code': item['sales_order_code'],
                'customer_code': item['customer_code'] or None,
                'customer_name': item['customer_name'] or None,
                'total_operations': item['total_operations'],
                'overdue_count': item['overdue_count'],
                'wait_material_count': item['wait_material_count'],
                'blocked_count': item['blocked_count'],
                'negative_delivery_gap_count': item['negative_delivery_gap_count'],
                'earliest_due_date': item['earliest_due_date'],
                'focus_url': _build_planning_url('/production-planning', params),
                'sales_fulfillment_url': item['sales_fulfillment_url'] or _build_planning_url('/sales-orders', {'section': 'delivery-planning', 'sales_order_code': item['sales_order_code']}),
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_sales_watch_score(row),
            row['sales_order_code'].lower(),
        ),
    )
    return rows[:limit]


def _get_material_watch_score(item):
    try:
        remaining_issue_qty = Decimal(str(item.get('remaining_issue_qty') or 0))
    except (InvalidOperation, TypeError, ValueError):
        remaining_issue_qty = Decimal('0')
    return (
        int(item.get('wait_material_operations') or 0) * 55
        + int(item.get('total_orders') or 0) * 20
        + int(item.get('affected_sales_order_count') or 0) * 15
        + min(int(remaining_issue_qty), 999)
    )


def _build_planner_material_watch(orders, cards, *, limit=6):
    cards_by_order_id = {}
    for card in cards:
        cards_by_order_id.setdefault(card['order']['id'], []).append(card)

    groups = {}
    for order in orders:
        order_cards = cards_by_order_id.get(order.id) or []
        if not order_cards:
            continue
        impacted_operation_ids = {
            int(card['operation']['id'])
            for card in order_cards
            if card.get('operation', {}).get('id')
        }
        wait_material_operation_ids = {
            int(card['operation']['id'])
            for card in order_cards
            if card.get('operation', {}).get('id')
            and str(card.get('materials', {}).get('material_readiness') or '').strip().upper() != 'READY'
        }
        if not wait_material_operation_ids:
            continue
        for requirement in order.material_requirements.all():
            remaining_issue_qty = getattr(requirement, 'remaining_issue_qty', Decimal('0')) or Decimal('0')
            try:
                remaining_issue_qty = Decimal(str(remaining_issue_qty))
            except (InvalidOperation, TypeError, ValueError):
                remaining_issue_qty = Decimal('0')
            if remaining_issue_qty <= 0:
                continue
            material_product = getattr(requirement, 'material_product', None)
            material_product_code = (
                getattr(material_product, 'code', None)
                or getattr(requirement, 'internal_product_code', None)
                or ((requirement.product_snapshot or {}).get('code') if isinstance(requirement.product_snapshot, dict) else None)
                or f'REQ-{requirement.id}'
            )
            material_product_name = (
                getattr(material_product, 'name', None)
                or ((requirement.product_snapshot or {}).get('name') if isinstance(requirement.product_snapshot, dict) else None)
                or material_product_code
            )
            item = groups.setdefault(
                material_product_code,
                {
                    'key': material_product_code,
                    'material_product_code': material_product_code,
                    'material_product_name': material_product_name,
                    'internal_product_code': getattr(requirement, 'internal_product_code', '') or '',
                    'order_ids': set(),
                    'order_codes': set(),
                    'impacted_operation_ids': set(),
                    'wait_material_operation_ids': set(),
                    'remaining_issue_qty': Decimal('0'),
                    'affected_sales_order_ids': set(),
                },
            )
            item['order_ids'].add(order.id)
            item['order_codes'].add(order.code)
            item['impacted_operation_ids'].update(impacted_operation_ids)
            item['wait_material_operation_ids'].update(wait_material_operation_ids)
            item['remaining_issue_qty'] += remaining_issue_qty
            if getattr(order, 'sales_order_id', None):
                item['affected_sales_order_ids'].add(order.sales_order_id)

    rows = []
    for item in groups.values():
        first_order_id = sorted(item['order_ids'])[0] if item['order_ids'] else None
        rows.append(
            {
                'key': item['key'],
                'material_product_code': item['material_product_code'],
                'material_product_name': item['material_product_name'],
                'internal_product_code': item['internal_product_code'] or None,
                'total_orders': len(item['order_ids']),
                'impacted_operations': len(item['impacted_operation_ids']),
                'wait_material_operations': len(item['wait_material_operation_ids']),
                'remaining_issue_qty': str(item['remaining_issue_qty']),
                'affected_sales_order_count': len(item['affected_sales_order_ids']),
                'sample_order_codes': sorted(item['order_codes'])[:3],
                'focus_url': _build_planning_url(
                    '/production-planning',
                    {
                        'material_product_code': item['material_product_code'],
                        'has_material_wait': 1,
                        'needs_attention': 1,
                    },
                ),
                'material_issue_url': _build_planning_url('/material-issues', {'production_order': first_order_id}) if first_order_id else '/material-issues',
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_material_watch_score(row),
            str(row.get('material_product_code') or '').lower(),
        ),
    )
    return rows[:limit]


def _get_work_center_watch_score(item):
    try:
        peak_load_ratio = Decimal(str(item.get('peak_load_ratio') or 0))
    except (InvalidOperation, TypeError, ValueError):
        peak_load_ratio = Decimal('0')
    return (
        int(item.get('overloaded_slot_count') or 0) * 100
        + int(item.get('at_limit_slot_count') or 0) * 45
        + int(item.get('blocked_count') or 0) * 40
        + int(item.get('overdue_count') or 0) * 35
        + int(item.get('affected_sales_order_count') or 0) * 20
        + int(item.get('total_operations') or 0) * 5
        + int(peak_load_ratio * 100)
    )


def _build_planner_work_center_watch(groups, *, limit=6):
    aggregated = {}
    for group in groups:
        work_center_code = str(group.get('work_center_code') or '').strip().upper()
        if not work_center_code:
            continue
        item = aggregated.setdefault(
            work_center_code,
            {
                'key': work_center_code,
                'work_center_code': work_center_code,
                'work_center_name': str(group.get('work_center_name') or '').strip(),
                'total_operations': 0,
                'ready_to_run_count': 0,
                'blocked_count': 0,
                'overdue_count': 0,
                'overloaded_slot_count': 0,
                'at_limit_slot_count': 0,
                'total_scheduled_hours': Decimal('0'),
                'total_capacity_hours': Decimal('0'),
                'peak_load_ratio': Decimal('0'),
                'machine_codes': set(),
                'affected_sales_order_ids': set(),
                'sample_order_codes': set(),
                'hot_slot_date': None,
                'hot_shift_key': '',
                'hot_shift_label': '',
            },
        )
        item['total_operations'] += int(group.get('total_operations') or 0)
        item['ready_to_run_count'] += int(group.get('ready_to_run_count') or 0)
        item['blocked_count'] += int(group.get('blocked_count') or 0)
        try:
            item['total_scheduled_hours'] += Decimal(str(group.get('scheduled_hours') or 0))
            item['total_capacity_hours'] += Decimal(str(group.get('capacity_hours') or 0))
            load_ratio = Decimal(str(group.get('load_ratio') or 0))
        except (InvalidOperation, TypeError, ValueError):
            load_ratio = Decimal('0')
        cards = group.get('cards') or []
        overdue_count = sum(1 for card in cards if card.get('exceptions', {}).get('risk_state') == 'OVERDUE')
        at_limit = any(str(card.get('capacity', {}).get('capacity_state') or '').strip().upper() == 'AT_LIMIT' for card in cards)
        if bool(group.get('overloaded')):
            item['overloaded_slot_count'] += 1
        elif at_limit:
            item['at_limit_slot_count'] += 1
        item['overdue_count'] += overdue_count
        for card in cards:
            machine_code = str(card.get('capacity', {}).get('machine_code') or '').strip().upper()
            if machine_code:
                item['machine_codes'].add(machine_code)
            sales_order_id = card.get('sales', {}).get('sales_order_id')
            if sales_order_id:
                item['affected_sales_order_ids'].add(sales_order_id)
            order_code = str(card.get('order', {}).get('code') or '').strip()
            if order_code:
                item['sample_order_codes'].add(order_code)
        if (
            load_ratio > item['peak_load_ratio']
            or (
                load_ratio == item['peak_load_ratio']
                and str(group.get('planned_date') or '') < str(item.get('hot_slot_date') or '9999-12-31')
            )
        ):
            item['peak_load_ratio'] = load_ratio
            item['hot_slot_date'] = group.get('planned_date')
            item['hot_shift_key'] = str(group.get('shift_key') or '').strip().upper()
            item['hot_shift_label'] = str(group.get('shift_label') or '').strip()

    rows = []
    for item in aggregated.values():
        params = {'work_center_code': item['work_center_code']}
        if item['overloaded_slot_count']:
            params['capacity_state'] = 'OVER_CAPACITY'
        elif item['at_limit_slot_count']:
            params['capacity_state'] = 'AT_LIMIT'
        elif item['blocked_count'] or item['overdue_count']:
            params['needs_attention'] = 1
        elif item['ready_to_run_count']:
            params['ready_to_run'] = 1
        if item['hot_slot_date']:
            params['planned_date'] = item['hot_slot_date']
            params['focus_window_date'] = item['hot_slot_date']
        if item['hot_shift_key']:
            params['planned_shift'] = item['hot_shift_key']
            params['focus_window_shift'] = item['hot_shift_key']
        rows.append(
            {
                'key': item['key'],
                'work_center_code': item['work_center_code'],
                'work_center_name': item['work_center_name'] or None,
                'total_operations': item['total_operations'],
                'ready_to_run_count': item['ready_to_run_count'],
                'blocked_count': item['blocked_count'],
                'overdue_count': item['overdue_count'],
                'overloaded_slot_count': item['overloaded_slot_count'],
                'at_limit_slot_count': item['at_limit_slot_count'],
                'total_scheduled_hours': str(item['total_scheduled_hours']),
                'total_capacity_hours': str(item['total_capacity_hours']),
                'peak_load_ratio': str(item['peak_load_ratio']),
                'machine_count': len(item['machine_codes']),
                'affected_sales_order_count': len(item['affected_sales_order_ids']),
                'sample_order_codes': sorted(item['sample_order_codes'])[:3],
                'hot_slot_date': item['hot_slot_date'],
                'hot_shift_key': item['hot_shift_key'] or None,
                'hot_shift_label': item['hot_shift_label'] or None,
                'focus_url': _build_planning_url('/production-planning', params),
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_work_center_watch_score(row),
            str(row.get('work_center_code') or '').lower(),
        ),
    )
    return rows[:limit]


def _get_machine_watch_score(item):
    try:
        peak_load_ratio = Decimal(str(item.get('peak_load_ratio') or 0))
    except (InvalidOperation, TypeError, ValueError):
        peak_load_ratio = Decimal('0')
    return (
        int(item.get('overloaded_queue_count') or 0) * 100
        + int(item.get('blocked_count') or 0) * 40
        + int(item.get('overdue_count') or 0) * 35
        + int(item.get('affected_sales_order_count') or 0) * 20
        + int(item.get('queue_count') or 0) * 15
        + int(item.get('total_operations') or 0) * 5
        + int(peak_load_ratio * 100)
    )


def _build_planner_machine_watch(queues, *, limit=6):
    aggregated = {}
    for queue in queues:
        machine_code = str(queue.get('machine_code') or '').strip().upper()
        if not machine_code:
            continue
        work_center_code = str(queue.get('work_center_code') or '').strip().upper()
        item = aggregated.setdefault(
            machine_code,
            {
                'key': machine_code,
                'machine_code': machine_code,
                'machine_name': str(queue.get('machine_name') or '').strip(),
                'work_center_code': work_center_code,
                'work_center_name': str(queue.get('work_center_name') or '').strip(),
                'total_operations': 0,
                'ready_to_run_count': 0,
                'blocked_count': 0,
                'overdue_count': 0,
                'overloaded_queue_count': 0,
                'queue_count': 0,
                'total_scheduled_hours': Decimal('0'),
                'total_capacity_hours': Decimal('0'),
                'peak_load_ratio': Decimal('0'),
                'affected_sales_order_ids': set(),
                'sample_order_codes': set(),
                'hot_queue_key': '',
                'hot_queue_date': None,
                'hot_shift_key': '',
                'hot_shift_label': '',
            },
        )
        item['queue_count'] += 1
        item['total_operations'] += int(queue.get('total_operations') or 0)
        item['ready_to_run_count'] += int(queue.get('ready_to_run_count') or 0)
        item['overdue_count'] += int(queue.get('overdue_count') or 0)
        if bool(queue.get('overloaded')):
            item['overloaded_queue_count'] += 1
        try:
            item['total_scheduled_hours'] += Decimal(str(queue.get('scheduled_hours') or 0))
            item['total_capacity_hours'] += Decimal(str(queue.get('capacity_hours') or 0))
            load_ratio = Decimal(str(queue.get('load_ratio') or 0))
        except (InvalidOperation, TypeError, ValueError):
            load_ratio = Decimal('0')
        cards = queue.get('cards') or []
        item['blocked_count'] += sum(1 for card in cards if card.get('exceptions', {}).get('risk_state') == 'BLOCKED')
        for card in cards:
            sales_order_id = card.get('sales', {}).get('sales_order_id')
            if sales_order_id:
                item['affected_sales_order_ids'].add(sales_order_id)
            order_code = str(card.get('order', {}).get('code') or '').strip()
            if order_code:
                item['sample_order_codes'].add(order_code)
        if (
            load_ratio > item['peak_load_ratio']
            or (
                load_ratio == item['peak_load_ratio']
                and str(queue.get('planned_date') or '') < str(item.get('hot_queue_date') or '9999-12-31')
            )
        ):
            item['peak_load_ratio'] = load_ratio
            item['hot_queue_key'] = str(queue.get('key') or '').strip()
            item['hot_queue_date'] = queue.get('planned_date')
            item['hot_shift_key'] = str(queue.get('shift_key') or '').strip().upper()
            item['hot_shift_label'] = str(queue.get('shift_label') or '').strip()

    rows = []
    for item in aggregated.values():
        params = {
            'view': 'LIST',
            'machine_code': item['machine_code'],
            'work_center_code': item['work_center_code'],
        }
        if item['hot_queue_key']:
            params['queue_key'] = item['hot_queue_key']
        if item['overloaded_queue_count']:
            params['capacity_state'] = 'OVER_CAPACITY'
        elif item['blocked_count'] or item['overdue_count']:
            params['needs_attention'] = 1
        elif item['ready_to_run_count']:
            params['ready_to_run'] = 1
        if item['hot_queue_date']:
            params['planned_date'] = item['hot_queue_date']
            params['focus_window_date'] = item['hot_queue_date']
        if item['hot_shift_key']:
            params['planned_shift'] = item['hot_shift_key']
            params['focus_window_shift'] = item['hot_shift_key']
        rows.append(
            {
                'key': item['key'],
                'machine_code': item['machine_code'],
                'machine_name': item['machine_name'] or None,
                'work_center_code': item['work_center_code'] or None,
                'work_center_name': item['work_center_name'] or None,
                'total_operations': item['total_operations'],
                'ready_to_run_count': item['ready_to_run_count'],
                'blocked_count': item['blocked_count'],
                'overdue_count': item['overdue_count'],
                'overloaded_queue_count': item['overloaded_queue_count'],
                'queue_count': item['queue_count'],
                'total_scheduled_hours': str(item['total_scheduled_hours']),
                'total_capacity_hours': str(item['total_capacity_hours']),
                'peak_load_ratio': str(item['peak_load_ratio']),
                'affected_sales_order_count': len(item['affected_sales_order_ids']),
                'sample_order_codes': sorted(item['sample_order_codes'])[:3],
                'hot_queue_key': item['hot_queue_key'] or None,
                'hot_queue_date': item['hot_queue_date'],
                'hot_shift_key': item['hot_shift_key'] or None,
                'hot_shift_label': item['hot_shift_label'] or None,
                'focus_url': _build_planning_url('/production-planning', params),
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_machine_watch_score(row),
            str(row.get('machine_code') or '').lower(),
        ),
    )
    return rows[:limit]


def _get_delivery_watch_score(item):
    return (
        int(item.get('negative_delivery_gap_count') or 0) * 90
        + int(item.get('overdue_count') or 0) * 45
        + int(item.get('blocked_count') or 0) * 40
        + int(item.get('wait_material_count') or 0) * 30
        + int(item.get('affected_sales_order_count') or 0) * 20
        + int(item.get('total_operations') or 0) * 5
    )


def _build_planner_delivery_watch(cards, *, limit=6):
    groups = {}
    for card in cards:
        delivery_due_date = card.get('sales', {}).get('delivery_due_date') or card.get('order', {}).get('planned_end_date')
        if not delivery_due_date:
            continue
        due_date = str(delivery_due_date)
        item = groups.setdefault(
            due_date,
            {
                'key': due_date,
                'delivery_due_date': due_date,
                'total_operations': 0,
                'ready_to_run_count': 0,
                'blocked_count': 0,
                'overdue_count': 0,
                'wait_material_count': 0,
                'negative_delivery_gap_count': 0,
                'sales_order_codes': set(),
                'order_codes': set(),
            },
        )
        item['total_operations'] += 1
        if _is_ready_to_run_card(card):
            item['ready_to_run_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'BLOCKED':
            item['blocked_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'OVERDUE':
            item['overdue_count'] += 1
        if str(card.get('materials', {}).get('material_readiness') or '').strip().upper() != 'READY':
            item['wait_material_count'] += 1
        delivery_gap_days = card.get('exceptions', {}).get('delivery_gap_days')
        if delivery_gap_days is not None and int(delivery_gap_days) < 0:
            item['negative_delivery_gap_count'] += 1
        sales_order_code = str(card.get('sales', {}).get('sales_order_code') or '').strip()
        if sales_order_code:
            item['sales_order_codes'].add(sales_order_code)
        order_code = str(card.get('order', {}).get('code') or '').strip()
        if order_code:
            item['order_codes'].add(order_code)

    rows = []
    for item in groups.values():
        params = {'delivery_due_date': item['delivery_due_date']}
        if item['negative_delivery_gap_count'] or item['blocked_count'] or item['overdue_count']:
            params['needs_attention'] = 1
        elif item['wait_material_count']:
            params['has_material_wait'] = 1
        elif item['ready_to_run_count']:
            params['ready_to_run'] = 1
        rows.append(
            {
                'key': item['key'],
                'delivery_due_date': item['delivery_due_date'],
                'total_operations': item['total_operations'],
                'ready_to_run_count': item['ready_to_run_count'],
                'blocked_count': item['blocked_count'],
                'overdue_count': item['overdue_count'],
                'wait_material_count': item['wait_material_count'],
                'negative_delivery_gap_count': item['negative_delivery_gap_count'],
                'affected_sales_order_count': len(item['sales_order_codes']),
                'sample_sales_order_codes': sorted(item['sales_order_codes'])[:3],
                'sample_order_codes': sorted(item['order_codes'])[:3],
                'focus_url': _build_planning_url('/production-planning', params),
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_delivery_watch_score(row),
            str(row.get('delivery_due_date') or ''),
        ),
    )
    return rows[:limit]


def _get_unscheduled_watch_score(item):
    return (
        int(item.get('wait_material_count') or 0) * 45
        + int(item.get('affected_sales_order_count') or 0) * 25
        + int(item.get('ready_to_run_count') or 0) * 20
        + int(item.get('total_operations') or 0) * 5
    )


def _build_planner_unscheduled_watch(cards, *, limit=6):
    groups = {}
    for card in cards:
        if str(card.get('bucket', {}).get('key') or '').strip().upper() != 'UNSCHEDULED':
            continue
        step_code = str(card.get('operation', {}).get('step_code') or '').strip().upper()
        if not step_code:
            continue
        item = groups.setdefault(
            step_code,
            {
                'key': step_code,
                'step_code': step_code,
                'step_name': str(card.get('operation', {}).get('step_name') or '').strip(),
                'total_operations': 0,
                'ready_to_run_count': 0,
                'wait_material_count': 0,
                'affected_order_ids': set(),
                'affected_sales_order_ids': set(),
                'sample_order_codes': set(),
            },
        )
        item['total_operations'] += 1
        if _is_ready_to_run_card(card):
            item['ready_to_run_count'] += 1
        if str(card.get('materials', {}).get('material_readiness') or '').strip().upper() != 'READY':
            item['wait_material_count'] += 1
        order_id = card.get('order', {}).get('id')
        if order_id:
            item['affected_order_ids'].add(order_id)
        sales_order_id = card.get('sales', {}).get('sales_order_id')
        if sales_order_id:
            item['affected_sales_order_ids'].add(sales_order_id)
        order_code = str(card.get('order', {}).get('code') or '').strip()
        if order_code:
            item['sample_order_codes'].add(order_code)

    rows = []
    for item in groups.values():
        params = {
            'bucket_key': 'UNSCHEDULED',
            'step_code': item['step_code'],
        }
        if item['wait_material_count']:
            params['has_material_wait'] = 1
        rows.append(
            {
                'key': item['key'],
                'step_code': item['step_code'],
                'step_name': item['step_name'] or None,
                'total_operations': item['total_operations'],
                'ready_to_run_count': item['ready_to_run_count'],
                'wait_material_count': item['wait_material_count'],
                'affected_order_count': len(item['affected_order_ids']),
                'affected_sales_order_count': len(item['affected_sales_order_ids']),
                'sample_order_codes': sorted(item['sample_order_codes'])[:3],
                'focus_url': _build_planning_url('/production-planning', params),
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_unscheduled_watch_score(row),
            str(row.get('step_code') or '').lower(),
        ),
    )
    return rows[:limit]


def _get_shift_watch_score(item):
    try:
        peak_load_ratio = Decimal(str(item.get('peak_load_ratio') or 0))
    except (InvalidOperation, TypeError, ValueError):
        peak_load_ratio = Decimal('0')
    return (
        int(item.get('overloaded_slot_count') or 0) * 100
        + int(item.get('at_limit_slot_count') or 0) * 55
        + int(item.get('blocked_count') or 0) * 40
        + int(item.get('overdue_count') or 0) * 35
        + int(item.get('needs_attention_count') or 0) * 25
        + int(item.get('affected_sales_order_count') or 0) * 20
        + int(item.get('total_operations') or 0) * 5
        + int(peak_load_ratio * 100)
    )


def _build_planner_shift_watch(cards, capacity_calendar, *, limit=6):
    groups = {}
    for card in cards:
        shift_key = _get_planning_shift_key(card.get('operation', {}).get('planned_shift'))
        shift_meta = PLANNING_SHIFT_FILTERS.get(shift_key, PLANNING_SHIFT_FILTERS['UNASSIGNED'])
        item = groups.setdefault(
            shift_key,
            {
                'key': shift_key,
                'shift_key': shift_key,
                'shift_label': shift_meta['label'],
                'total_operations': 0,
                'ready_to_run_count': 0,
                'blocked_count': 0,
                'overdue_count': 0,
                'needs_attention_count': 0,
                'overloaded_slot_count': 0,
                'at_limit_slot_count': 0,
                'total_scheduled_hours': Decimal('0'),
                'total_capacity_hours': Decimal('0'),
                'peak_load_ratio': Decimal('0'),
                'affected_sales_order_ids': set(),
                'sample_order_codes': set(),
                'hot_date': None,
                'hot_date_label': shift_meta['label'],
                'hot_window_state': 'BALANCED',
                'hot_window_score': -1,
            },
        )
        item['total_operations'] += 1
        if _is_ready_to_run_card(card):
            item['ready_to_run_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'BLOCKED':
            item['blocked_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'OVERDUE':
            item['overdue_count'] += 1
        if card.get('exceptions', {}).get('needs_attention'):
            item['needs_attention_count'] += 1
        try:
            item['total_scheduled_hours'] += Decimal(str(card.get('capacity', {}).get('scheduled_hours') or 0))
        except (InvalidOperation, TypeError, ValueError):
            pass
        sales_order_id = card.get('sales', {}).get('sales_order_id')
        if sales_order_id:
            item['affected_sales_order_ids'].add(sales_order_id)
        order_code = str(card.get('order', {}).get('code') or '').strip()
        if order_code:
            item['sample_order_codes'].add(order_code)

    for row in capacity_calendar:
        for shift in row.get('shifts', []):
            shift_key = _get_planning_shift_key(shift.get('shift_key'))
            if int(shift.get('total_operations') or 0) <= 0:
                continue
            shift_meta = PLANNING_SHIFT_FILTERS.get(shift_key, PLANNING_SHIFT_FILTERS['UNASSIGNED'])
            item = groups.setdefault(
                shift_key,
                {
                    'key': shift_key,
                    'shift_key': shift_key,
                    'shift_label': shift_meta['label'],
                    'total_operations': 0,
                    'ready_to_run_count': 0,
                    'blocked_count': 0,
                    'overdue_count': 0,
                    'needs_attention_count': 0,
                    'overloaded_slot_count': 0,
                    'at_limit_slot_count': 0,
                    'total_scheduled_hours': Decimal('0'),
                    'total_capacity_hours': Decimal('0'),
                    'peak_load_ratio': Decimal('0'),
                    'affected_sales_order_ids': set(),
                    'sample_order_codes': set(),
                    'hot_date': None,
                    'hot_date_label': shift_meta['label'],
                    'hot_window_state': 'BALANCED',
                    'hot_window_score': -1,
                },
            )
            try:
                item['total_capacity_hours'] += Decimal(str(shift.get('capacity_hours') or 0))
                load_ratio = Decimal(str(shift.get('load_ratio') or 0))
            except (InvalidOperation, TypeError, ValueError):
                load_ratio = Decimal('0')
            if str(shift.get('window_state') or '').upper() == 'OVER_CAPACITY':
                item['overloaded_slot_count'] += 1
            elif str(shift.get('window_state') or '').upper() == 'AT_LIMIT':
                item['at_limit_slot_count'] += 1
            window_score = _get_capacity_window_score(shift)
            if (
                window_score > item['hot_window_score']
                or (window_score == item['hot_window_score'] and str(row.get('date') or '') < str(item.get('hot_date') or '9999-12-31'))
            ):
                item['peak_load_ratio'] = max(item['peak_load_ratio'], load_ratio)
                item['hot_date'] = row.get('date')
                item['hot_date_label'] = row.get('date_label') or shift_meta['label']
                item['hot_window_state'] = shift.get('window_state') or 'BALANCED'
                item['hot_window_score'] = window_score
            elif load_ratio > item['peak_load_ratio']:
                item['peak_load_ratio'] = load_ratio

    rows = []
    for item in groups.values():
        params = {'planned_shift': item['shift_key']}
        if item['overloaded_slot_count']:
            params['capacity_state'] = 'OVER_CAPACITY'
        elif item['at_limit_slot_count']:
            params['capacity_state'] = 'AT_LIMIT'
        elif item['needs_attention_count'] or item['blocked_count'] or item['overdue_count']:
            params['needs_attention'] = 1
        elif item['ready_to_run_count']:
            params['ready_to_run'] = 1
        if item['hot_date']:
            params['planned_date'] = item['hot_date']
            params['focus_window_date'] = item['hot_date']
        if item['shift_key']:
            params['focus_window_shift'] = item['shift_key']
        rows.append(
            {
                'key': item['key'],
                'shift_key': item['shift_key'],
                'shift_label': item['shift_label'],
                'total_operations': item['total_operations'],
                'ready_to_run_count': item['ready_to_run_count'],
                'blocked_count': item['blocked_count'],
                'overdue_count': item['overdue_count'],
                'needs_attention_count': item['needs_attention_count'],
                'overloaded_slot_count': item['overloaded_slot_count'],
                'at_limit_slot_count': item['at_limit_slot_count'],
                'total_scheduled_hours': str(item['total_scheduled_hours']),
                'total_capacity_hours': str(item['total_capacity_hours']),
                'peak_load_ratio': str(item['peak_load_ratio']),
                'affected_sales_order_count': len(item['affected_sales_order_ids']),
                'sample_order_codes': sorted(item['sample_order_codes'])[:3],
                'hot_date': item['hot_date'],
                'hot_date_label': item['hot_date_label'],
                'hot_window_state': item['hot_window_state'],
                'focus_url': _build_planning_url('/production-planning', params),
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_shift_watch_score(row),
            str(row.get('shift_key') or '').lower(),
        ),
    )
    return rows[:limit]


def _get_date_watch_score(item):
    try:
        peak_load_ratio = Decimal(str(item.get('peak_load_ratio') or 0))
    except (InvalidOperation, TypeError, ValueError):
        peak_load_ratio = Decimal('0')
    return (
        int(item.get('over_capacity_count') or 0) * 90
        + int(item.get('at_limit_count') or 0) * 45
        + int(item.get('blocked_count') or 0) * 40
        + int(item.get('overdue_count') or 0) * 35
        + int(item.get('needs_attention_count') or 0) * 25
        + int(item.get('affected_sales_order_count') or 0) * 20
        + int(item.get('total_operations') or 0) * 5
        + int(peak_load_ratio * 100)
    )


def _build_planner_date_watch(cards, capacity_calendar, *, limit=6):
    groups = {}
    for card in cards:
        planned_date = card.get('operation', {}).get('planned_date')
        key = planned_date or 'UNSCHEDULED'
        item = groups.setdefault(
            key,
            {
                'key': key,
                'date': planned_date,
                'date_label': 'Chua xep lich' if planned_date is None else str(planned_date),
                'total_operations': 0,
                'ready_to_run_count': 0,
                'blocked_count': 0,
                'overdue_count': 0,
                'needs_attention_count': 0,
                'over_capacity_count': 0,
                'at_limit_count': 0,
                'total_scheduled_hours': Decimal('0'),
                'peak_load_ratio': Decimal('0'),
                'affected_sales_order_ids': set(),
                'sample_order_codes': set(),
                'hot_shift_key': '',
                'hot_shift_label': '',
                'hot_window_state': 'BALANCED',
                'hot_window_score': -1,
            },
        )
        item['total_operations'] += 1
        if _is_ready_to_run_card(card):
            item['ready_to_run_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'BLOCKED':
            item['blocked_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'OVERDUE':
            item['overdue_count'] += 1
        if card.get('exceptions', {}).get('needs_attention'):
            item['needs_attention_count'] += 1
        try:
            item['total_scheduled_hours'] += Decimal(str(card.get('capacity', {}).get('scheduled_hours') or 0))
            load_ratio = Decimal(str(card.get('capacity', {}).get('work_center_load_ratio') or 0))
        except (InvalidOperation, TypeError, ValueError):
            load_ratio = Decimal('0')
        if load_ratio > item['peak_load_ratio']:
            item['peak_load_ratio'] = load_ratio
        sales_order_id = card.get('sales', {}).get('sales_order_id')
        if sales_order_id:
            item['affected_sales_order_ids'].add(sales_order_id)
        order_code = str(card.get('order', {}).get('code') or '').strip()
        if order_code:
            item['sample_order_codes'].add(order_code)

    for row in capacity_calendar:
        key = row.get('date') or 'UNSCHEDULED'
        item = groups.setdefault(
            key,
            {
                'key': key,
                'date': row.get('date'),
                'date_label': row.get('date_label') or ('Chua xep lich' if row.get('date') is None else str(row.get('date'))),
                'total_operations': 0,
                'ready_to_run_count': 0,
                'blocked_count': 0,
                'overdue_count': 0,
                'needs_attention_count': 0,
                'over_capacity_count': 0,
                'at_limit_count': 0,
                'total_scheduled_hours': Decimal('0'),
                'peak_load_ratio': Decimal('0'),
                'affected_sales_order_ids': set(),
                'sample_order_codes': set(),
                'hot_shift_key': '',
                'hot_shift_label': '',
                'hot_window_state': 'BALANCED',
                'hot_window_score': -1,
            },
        )
        item['over_capacity_count'] = max(item['over_capacity_count'], int(row.get('over_capacity_count') or 0))
        item['at_limit_count'] = max(item['at_limit_count'], int(row.get('at_limit_count') or 0))
        for shift in row.get('shifts', []):
            if int(shift.get('total_operations') or 0) <= 0:
                continue
            try:
                load_ratio = Decimal(str(shift.get('load_ratio') or 0))
            except (InvalidOperation, TypeError, ValueError):
                load_ratio = Decimal('0')
            if load_ratio > item['peak_load_ratio']:
                item['peak_load_ratio'] = load_ratio
            window_score = _get_capacity_window_score(shift)
            if (
                window_score > item['hot_window_score']
                or (
                    window_score == item['hot_window_score']
                    and str(shift.get('shift_key') or '') < str(item.get('hot_shift_key') or 'zzzz')
                )
            ):
                item['hot_shift_key'] = str(shift.get('shift_key') or '').strip().upper()
                item['hot_shift_label'] = str(shift.get('shift_label') or '').strip()
                item['hot_window_state'] = shift.get('window_state') or 'BALANCED'
                item['hot_window_score'] = window_score

    rows = []
    for item in groups.values():
        params = {}
        if item['date']:
            params['planned_date'] = item['date']
            params['focus_window_date'] = item['date']
        else:
            params['bucket_key'] = 'UNSCHEDULED'
        if item['hot_shift_key']:
            params['planned_shift'] = item['hot_shift_key']
            params['focus_window_shift'] = item['hot_shift_key']
        if item['over_capacity_count']:
            params['capacity_state'] = 'OVER_CAPACITY'
        elif item['at_limit_count']:
            params['capacity_state'] = 'AT_LIMIT'
        elif item['needs_attention_count'] or item['blocked_count'] or item['overdue_count']:
            params['needs_attention'] = 1
        elif item['ready_to_run_count']:
            params['ready_to_run'] = 1
        rows.append(
            {
                'key': item['key'],
                'date': item['date'],
                'date_label': item['date_label'],
                'total_operations': item['total_operations'],
                'ready_to_run_count': item['ready_to_run_count'],
                'blocked_count': item['blocked_count'],
                'overdue_count': item['overdue_count'],
                'needs_attention_count': item['needs_attention_count'],
                'over_capacity_count': item['over_capacity_count'],
                'at_limit_count': item['at_limit_count'],
                'total_scheduled_hours': str(item['total_scheduled_hours']),
                'peak_load_ratio': str(item['peak_load_ratio']),
                'affected_sales_order_count': len(item['affected_sales_order_ids']),
                'sample_order_codes': sorted(item['sample_order_codes'])[:3],
                'hot_shift_key': item['hot_shift_key'] or None,
                'hot_shift_label': item['hot_shift_label'] or None,
                'hot_window_state': item['hot_window_state'],
                'focus_url': _build_planning_url('/production-planning', params),
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_date_watch_score(row),
            str(row.get('date') or '9999-12-31'),
        ),
    )
    return rows[:limit]


def _get_dispatch_owner_capacity_watch_score(item):
    try:
        peak_load_ratio = Decimal(str(item.get('peak_load_ratio') or 0))
    except (InvalidOperation, TypeError, ValueError):
        peak_load_ratio = Decimal('0')
    return (
        int(item.get('over_capacity_count') or 0) * 80
        + int(item.get('at_limit_count') or 0) * 40
        + int(item.get('blocked_count') or 0) * 35
        + int(item.get('overdue_count') or 0) * 30
        + int(item.get('needs_attention_count') or 0) * 25
        + int(item.get('affected_sales_order_count') or 0) * 15
        + int(item.get('total_operations') or 0) * 5
        + int(peak_load_ratio * 100)
    )


def _build_planner_dispatch_owner_capacity_watch(cards, *, limit=6):
    groups = {}
    for card in cards:
        owner = str(card.get('shop_floor', {}).get('dispatch_owner') or '').strip()
        if not owner:
            continue
        item = groups.setdefault(
            owner,
            {
                'key': owner,
                'dispatch_owner': owner,
                'total_operations': 0,
                'ready_to_run_count': 0,
                'blocked_count': 0,
                'overdue_count': 0,
                'needs_attention_count': 0,
                'over_capacity_count': 0,
                'at_limit_count': 0,
                'total_scheduled_hours': Decimal('0'),
                'peak_load_ratio': Decimal('0'),
                'affected_sales_order_ids': set(),
                'sample_order_codes': set(),
            },
        )
        item['total_operations'] += 1
        if _is_ready_to_run_card(card):
            item['ready_to_run_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'BLOCKED':
            item['blocked_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'OVERDUE':
            item['overdue_count'] += 1
        if card.get('exceptions', {}).get('needs_attention'):
            item['needs_attention_count'] += 1
        capacity_state = str(card.get('capacity', {}).get('capacity_state') or '').strip().upper()
        if capacity_state == 'OVER_CAPACITY':
            item['over_capacity_count'] += 1
        elif capacity_state == 'AT_LIMIT':
            item['at_limit_count'] += 1
        try:
            item['total_scheduled_hours'] += Decimal(str(card.get('capacity', {}).get('scheduled_hours') or 0))
            work_center_ratio = Decimal(str(card.get('capacity', {}).get('work_center_load_ratio') or 0))
            machine_ratio = Decimal(str(card.get('capacity', {}).get('machine_load_ratio') or 0))
            item['peak_load_ratio'] = max(item['peak_load_ratio'], work_center_ratio, machine_ratio)
        except (InvalidOperation, TypeError, ValueError):
            pass
        sales_order_id = card.get('sales', {}).get('sales_order_id')
        if sales_order_id:
            item['affected_sales_order_ids'].add(sales_order_id)
        order_code = str(card.get('order', {}).get('code') or '').strip()
        if order_code:
            item['sample_order_codes'].add(order_code)

    rows = []
    for item in groups.values():
        params = {'dispatch_owner': item['dispatch_owner']}
        if item['over_capacity_count']:
            params['capacity_state'] = 'OVER_CAPACITY'
        elif item['at_limit_count']:
            params['capacity_state'] = 'AT_LIMIT'
        elif item['needs_attention_count'] or item['blocked_count'] or item['overdue_count']:
            params['needs_attention'] = 1
        elif item['ready_to_run_count']:
            params['ready_to_run'] = 1
        rows.append(
            {
                'key': item['key'],
                'dispatch_owner': item['dispatch_owner'],
                'total_operations': item['total_operations'],
                'ready_to_run_count': item['ready_to_run_count'],
                'blocked_count': item['blocked_count'],
                'overdue_count': item['overdue_count'],
                'needs_attention_count': item['needs_attention_count'],
                'over_capacity_count': item['over_capacity_count'],
                'at_limit_count': item['at_limit_count'],
                'total_scheduled_hours': str(item['total_scheduled_hours']),
                'peak_load_ratio': str(item['peak_load_ratio']),
                'affected_sales_order_count': len(item['affected_sales_order_ids']),
                'sample_order_codes': sorted(item['sample_order_codes'])[:3],
                'focus_url': _build_planning_url('/production-planning', params),
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_dispatch_owner_capacity_watch_score(row),
            str(row.get('dispatch_owner') or '').lower(),
        ),
    )
    return rows[:limit]


def _get_step_watch_score(item):
    return (
        int(item.get('unscheduled_count') or 0) * 65
        + int(item.get('blocked_count') or 0) * 45
        + int(item.get('overdue_count') or 0) * 35
        + int(item.get('wait_material_count') or 0) * 30
        + int(item.get('affected_sales_order_count') or 0) * 20
        + int(item.get('total_operations') or 0) * 5
    )


def _build_planner_step_watch(cards, *, limit=6):
    groups = {}
    for card in cards:
        step_code = str(card.get('operation', {}).get('step_code') or '').strip().upper()
        if not step_code:
            continue
        item = groups.setdefault(
            step_code,
            {
                'key': step_code,
                'step_code': step_code,
                'step_name': str(card.get('operation', {}).get('step_name') or '').strip(),
                'total_operations': 0,
                'ready_to_run_count': 0,
                'unscheduled_count': 0,
                'blocked_count': 0,
                'overdue_count': 0,
                'wait_material_count': 0,
                'affected_order_ids': set(),
                'affected_sales_order_ids': set(),
                'total_scheduled_hours': Decimal('0'),
                'sample_order_codes': set(),
            },
        )
        item['total_operations'] += 1
        if _is_ready_to_run_card(card):
            item['ready_to_run_count'] += 1
        if str(card.get('bucket', {}).get('key') or '').strip().upper() == 'UNSCHEDULED':
            item['unscheduled_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'BLOCKED':
            item['blocked_count'] += 1
        if card.get('exceptions', {}).get('risk_state') == 'OVERDUE':
            item['overdue_count'] += 1
        if str(card.get('materials', {}).get('material_readiness') or '').strip().upper() != 'READY':
            item['wait_material_count'] += 1
        try:
            item['total_scheduled_hours'] += Decimal(str(card.get('capacity', {}).get('scheduled_hours') or 0))
        except (InvalidOperation, TypeError, ValueError):
            pass
        order_id = card.get('order', {}).get('id')
        if order_id:
            item['affected_order_ids'].add(order_id)
        sales_order_id = card.get('sales', {}).get('sales_order_id')
        if sales_order_id:
            item['affected_sales_order_ids'].add(sales_order_id)
        order_code = str(card.get('order', {}).get('code') or '').strip()
        if order_code:
            item['sample_order_codes'].add(order_code)

    rows = []
    for item in groups.values():
        params = {'step_code': item['step_code']}
        if item['unscheduled_count']:
            params['bucket_key'] = 'UNSCHEDULED'
        elif item['blocked_count'] or item['overdue_count']:
            params['needs_attention'] = 1
        elif item['wait_material_count']:
            params['has_material_wait'] = 1
        elif item['ready_to_run_count']:
            params['ready_to_run'] = 1
        rows.append(
            {
                'key': item['key'],
                'step_code': item['step_code'],
                'step_name': item['step_name'] or None,
                'total_operations': item['total_operations'],
                'ready_to_run_count': item['ready_to_run_count'],
                'unscheduled_count': item['unscheduled_count'],
                'blocked_count': item['blocked_count'],
                'overdue_count': item['overdue_count'],
                'wait_material_count': item['wait_material_count'],
                'affected_order_count': len(item['affected_order_ids']),
                'affected_sales_order_count': len(item['affected_sales_order_ids']),
                'total_scheduled_hours': str(item['total_scheduled_hours']),
                'sample_order_codes': sorted(item['sample_order_codes'])[:3],
                'focus_url': _build_planning_url('/production-planning', params),
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_step_watch_score(row),
            str(row.get('step_code') or '').lower(),
        ),
    )
    return rows[:limit]


def _get_rebalance_summary_score(item):
    severity_weight = (
        int(item.get('critical_count') or 0) * 80
        + int(item.get('warning_count') or 0) * 40
        + int(item.get('info_count') or 0) * 15
    )
    return severity_weight + int(item.get('total_suggestions') or 0) * 10


def _build_planner_rebalance_summary(suggestions, *, limit=6):
    kind_labels = {
        'ASSIGN_WORK_CENTER': 'Gan work center',
        'ASSIGN_MACHINE': 'Gan may',
        'MOVE_WORK_CENTER': 'Doi work center',
        'MOVE_SHIFT': 'Doi ca',
        'MOVE_DAY': 'Doi ngay',
    }
    groups = {}
    for suggestion in suggestions:
        kind = str(suggestion.get('kind') or '').strip().upper()
        if not kind:
            continue
        item = groups.setdefault(
            kind,
            {
                'key': kind,
                'kind': kind,
                'kind_label': kind_labels.get(kind, kind.replace('_', ' ').title()),
                'total_suggestions': 0,
                'critical_count': 0,
                'warning_count': 0,
                'info_count': 0,
                'sample_order_codes': set(),
                'sample_titles': set(),
                'suggestion_keys': [],
                'focus_url': '',
            },
        )
        item['total_suggestions'] += 1
        severity = str(suggestion.get('severity') or '').strip().lower()
        if severity == 'critical':
            item['critical_count'] += 1
        elif severity == 'warning':
            item['warning_count'] += 1
        else:
            item['info_count'] += 1
        order_code = str(suggestion.get('order_code') or '').strip()
        if order_code:
            item['sample_order_codes'].add(order_code)
        title = str(suggestion.get('title') or '').strip()
        if title:
            item['sample_titles'].add(title)
        suggestion_key = str(suggestion.get('key') or '').strip()
        if suggestion_key:
            item['suggestion_keys'].append(suggestion_key)
        if not item['focus_url'] and suggestion.get('focus_url'):
            item['focus_url'] = str(suggestion.get('focus_url'))

    rows = []
    for item in groups.values():
        dominant_severity = 'info'
        if item['critical_count']:
            dominant_severity = 'critical'
        elif item['warning_count']:
            dominant_severity = 'warning'
        rows.append(
            {
                'key': item['key'],
                'kind': item['kind'],
                'kind_label': item['kind_label'],
                'dominant_severity': dominant_severity,
                'total_suggestions': item['total_suggestions'],
                'critical_count': item['critical_count'],
                'warning_count': item['warning_count'],
                'info_count': item['info_count'],
                'sample_order_codes': sorted(item['sample_order_codes'])[:3],
                'sample_titles': sorted(item['sample_titles'])[:2],
                'suggestion_keys': item['suggestion_keys'][:12],
                'focus_url': item['focus_url'] or '/production-planning',
            }
        )
    rows = sorted(
        rows,
        key=lambda row: (
            -_get_rebalance_summary_score(row),
            str(row.get('kind') or '').lower(),
        ),
    )
    return rows[:limit]


def _build_planning_summary(cards, *, today):
    bucket_counts = {key: 0 for key in PLANNING_BUCKETS}
    risk_counts = {
        'DONE': 0,
        'UNSCHEDULED': 0,
        'OVERDUE': 0,
        'BLOCKED': 0,
        'AT_RISK': 0,
        'ON_TRACK': 0,
    }
    shift_loads = {
        key: _build_shift_load_item(key)
        for key in PLANNING_SHIFT_FILTERS
    }
    capacity_state_counts = {key: 0 for key in PLANNING_CAPACITY_STATES}
    unique_order_ids = set()
    affected_sales_order_ids = set()
    lead_days = []
    total_runtime_hours = Decimal('0')
    total_setup_hours = Decimal('0')
    total_scheduled_hours = Decimal('0')
    over_capacity_slot_keys = set()
    for card in cards:
        unique_order_ids.add(card['order']['id'])
        bucket_counts[card['bucket']['key']] = bucket_counts.get(card['bucket']['key'], 0) + 1
        risk_counts[card['exceptions']['risk_state']] = risk_counts.get(card['exceptions']['risk_state'], 0) + 1
        shift_key = _get_planning_shift_key(card['operation'].get('planned_shift'))
        _accumulate_shift_load(shift_loads[shift_key], card)
        capacity_state_key = str(card['capacity'].get('capacity_state') or '').strip().upper()
        if capacity_state_key in capacity_state_counts:
            capacity_state_counts[capacity_state_key] += 1
        total_runtime_hours += Decimal(str(card['capacity'].get('runtime_hours') or 0))
        total_setup_hours += Decimal(str(card['capacity'].get('setup_hours') or 0))
        total_scheduled_hours += Decimal(str(card['capacity'].get('scheduled_hours') or 0))
        if card['capacity'].get('over_capacity'):
            over_capacity_slot_keys.add(
                f"{card['capacity'].get('work_center_code') or card['capacity'].get('machine_code') or 'UNASSIGNED'}|{card['operation'].get('planned_date') or ''}|{card['capacity'].get('shift_key') or 'UNASSIGNED'}"
            )
        if card['exceptions']['risk_state'] in {'OVERDUE', 'BLOCKED', 'UNSCHEDULED', 'AT_RISK'} and card['sales'].get('sales_order_id'):
            affected_sales_order_ids.add(card['sales']['sales_order_id'])
        planned_end_date = card['order'].get('planned_end_date')
        if planned_end_date:
            try:
                planned_end = date.fromisoformat(str(planned_end_date))
            except (TypeError, ValueError):
                planned_end = None
            if planned_end is not None:
                lead_days.append((planned_end - today).days)
    avg_days_to_deadline = round(sum(lead_days) / len(lead_days), 2) if lead_days else None
    return {
        'total_orders': len(unique_order_ids),
        'total_operations': len(cards),
        'overdue_operations': sum(1 for card in cards if card['exceptions']['risk_state'] == 'OVERDUE'),
        'ready_to_run_count': sum(1 for card in cards if _is_ready_to_run_card(card)),
        'wait_material_count': sum(1 for card in cards if card['materials']['material_readiness'] != 'READY'),
        'wait_previous_step_count': sum(1 for card in cards if card['exceptions']['dependency_state'] == 'WAIT_PREVIOUS_STEP'),
        'machine_down_count': sum(1 for card in cards if card['exceptions']['block_reason_code'] == ProductionOperationBlockReason.MACHINE_DOWN),
        'over_capacity_count': sum(1 for card in cards if card['capacity']['capacity_state'] == 'OVER_CAPACITY'),
        'at_limit_count': sum(1 for card in cards if card['capacity']['capacity_state'] == 'AT_LIMIT'),
        'unassigned_machine_count': sum(1 for card in cards if card['capacity']['capacity_state'] == 'UNASSIGNED_MACHINE'),
        'unassigned_work_center_count': sum(1 for card in cards if card['capacity']['capacity_state'] == 'UNASSIGNED_WORK_CENTER'),
        'unscheduled_count': sum(1 for card in cards if card['exceptions']['risk_state'] == 'UNSCHEDULED'),
        'blocked_count': sum(1 for card in cards if card['exceptions']['risk_state'] == 'BLOCKED'),
        'in_progress_count': sum(1 for card in cards if card['operation']['status'] == ProductionOperationStatus.IN_PROGRESS),
        'handover_ready_count': sum(1 for card in cards if card['shop_floor']['handover_status'] == ProductionOperationHandoverStatus.READY),
        'handover_accepted_count': sum(1 for card in cards if card['shop_floor']['handover_status'] == ProductionOperationHandoverStatus.ACCEPTED),
        'affected_sales_order_count': len(affected_sales_order_ids),
        'avg_days_to_deadline': avg_days_to_deadline,
        'bucket_counts': bucket_counts,
        'risk_counts': risk_counts,
        'capacity_state_counts': capacity_state_counts,
        'total_runtime_hours': str(total_runtime_hours),
        'total_setup_hours': str(total_setup_hours),
        'total_scheduled_hours': str(total_scheduled_hours),
        'over_capacity_slot_count': len(over_capacity_slot_keys),
        'shift_loads': _finalize_shift_loads(shift_loads.values(), include_empty=True),
    }


def _build_rebalance_suggestions(cards, *, work_center_groups):
    suggestions = []
    editable_cards = [
        card for card in cards
        if card['order'].get('status') in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}
        and card['operation'].get('status') not in {ProductionOperationStatus.DONE, ProductionOperationStatus.SKIPPED}
    ]
    step_work_centers = {}
    step_machines = {}
    for card in editable_cards:
        step_code = str(card['operation'].get('step_code') or '').strip().upper()
        work_center_code = str(card['capacity'].get('work_center_code') or '').strip().upper()
        work_center_name = str(card['capacity'].get('work_center_name') or '').strip()
        machine_code = str(card['capacity'].get('machine_code') or '').strip().upper()
        machine_name = str(card['capacity'].get('machine_name') or '').strip()
        if step_code and work_center_code:
            item = step_work_centers.setdefault((step_code, work_center_code), {'code': work_center_code, 'name': work_center_name, 'count': 0})
            item['count'] += 1
        if step_code and work_center_code and machine_code:
            item = step_machines.setdefault((step_code, work_center_code, machine_code), {'code': machine_code, 'name': machine_name, 'count': 0})
            item['count'] += 1

    work_center_candidates_by_step = {}
    for (step_code, _work_center_code), item in step_work_centers.items():
        work_center_candidates_by_step.setdefault(step_code, []).append(item)
    for step_code in work_center_candidates_by_step:
        work_center_candidates_by_step[step_code] = sorted(
            work_center_candidates_by_step[step_code],
            key=lambda candidate: (-candidate['count'], candidate['code']),
        )

    machine_candidates_by_step_wc = {}
    for (step_code, work_center_code, _machine_code), item in step_machines.items():
        machine_candidates_by_step_wc.setdefault((step_code, work_center_code), []).append(item)
    for key in machine_candidates_by_step_wc:
        machine_candidates_by_step_wc[key] = sorted(
            machine_candidates_by_step_wc[key],
            key=lambda candidate: (-candidate['count'], candidate['code']),
        )

    def _card_priority(card):
        return (
            -(Decimal(str(card['capacity'].get('scheduled_hours') or 0))),
            -(card['operation'].get('priority_rank') or 0),
            -(card['operation'].get('dispatch_sequence') or 0),
            str(card['order'].get('code') or ''),
        )

    seen_card_kinds = set()
    for card in sorted(editable_cards, key=_card_priority):
        step_code = str(card['operation'].get('step_code') or '').strip().upper()
        current_wc = str(card['capacity'].get('work_center_code') or '').strip().upper()
        current_machine = str(card['capacity'].get('machine_code') or '').strip().upper()
        card_kind_key = None
        if card['capacity'].get('capacity_state') == 'UNASSIGNED_WORK_CENTER':
            card_kind_key = (card['card_key'], 'ASSIGN_WORK_CENTER')
            if card_kind_key in seen_card_kinds:
                continue
            target = next(iter(work_center_candidates_by_step.get(step_code, [])), None)
            if target:
                machine_target = next(iter(machine_candidates_by_step_wc.get((step_code, target['code']), [])), None)
                suggestions.append({
                    'key': f"assign-wc-{card['card_key']}",
                    'kind': 'ASSIGN_WORK_CENTER',
                    'severity': 'warning',
                    'title': f"Gan work center cho {card['order']['code']} / {card['operation']['step_code']}",
                    'description': f"Cong doan chua gan work center. Goi y gan {target['name'] or target['code']} de planner de theo doi tai va dispatch.",
                    'card_key': card['card_key'],
                    'order_id': card['order']['id'],
                    'order_code': card['order']['code'],
                    'operation_id': card['operation']['id'],
                    'operation_code': card['operation']['step_code'],
                    'focus_url': _build_planning_url('/production-planning', {'focus_operation_id': card['operation']['id']}),
                    'focus_filters': {'focus_operation_id': card['operation']['id']},
                    'suggested_changes': {
                        'work_center_code': target['code'],
                        'work_center_name': target['name'],
                        'machine_code': machine_target['code'] if machine_target else '',
                        'machine_name': machine_target['name'] if machine_target else '',
                    },
                    'projected_source_load_ratio': None,
                    'projected_target_load_ratio': None,
                    'source': {
                        'planned_date': card['operation'].get('planned_date'),
                        'shift_key': card['capacity'].get('shift_key'),
                        'work_center_code': '',
                        'work_center_name': '',
                        'machine_code': current_machine,
                        'machine_name': card['capacity'].get('machine_name'),
                        'capacity_state': card['capacity'].get('capacity_state'),
                    },
                    'target': {
                        'planned_date': card['operation'].get('planned_date'),
                        'shift_key': card['capacity'].get('shift_key'),
                        'work_center_code': target['code'],
                        'work_center_name': target['name'],
                        'machine_code': machine_target['code'] if machine_target else '',
                        'machine_name': machine_target['name'] if machine_target else '',
                    },
                })
                seen_card_kinds.add(card_kind_key)
            continue

        if card['capacity'].get('capacity_state') == 'UNASSIGNED_MACHINE' and current_wc:
            card_kind_key = (card['card_key'], 'ASSIGN_MACHINE')
            if card_kind_key in seen_card_kinds:
                continue
            machine_target = next(iter(machine_candidates_by_step_wc.get((step_code, current_wc), [])), None)
            if machine_target:
                suggestions.append({
                    'key': f"assign-machine-{card['card_key']}",
                    'kind': 'ASSIGN_MACHINE',
                    'severity': 'warning',
                    'title': f"Gan may cho {card['order']['code']} / {card['operation']['step_code']}",
                    'description': f"Cong doan da co work center nhung chua gan may. Goi y gan {machine_target['name'] or machine_target['code']} de tao queue ro hon.",
                    'card_key': card['card_key'],
                    'order_id': card['order']['id'],
                    'order_code': card['order']['code'],
                    'operation_id': card['operation']['id'],
                    'operation_code': card['operation']['step_code'],
                    'focus_url': _build_planning_url('/production-planning', {'focus_operation_id': card['operation']['id'], 'work_center_code': current_wc}),
                    'focus_filters': {'focus_operation_id': card['operation']['id'], 'work_center_code': current_wc},
                    'suggested_changes': {
                        'machine_code': machine_target['code'],
                        'machine_name': machine_target['name'],
                    },
                    'projected_source_load_ratio': None,
                    'projected_target_load_ratio': None,
                    'source': {
                        'planned_date': card['operation'].get('planned_date'),
                        'shift_key': card['capacity'].get('shift_key'),
                        'work_center_code': current_wc,
                        'work_center_name': card['capacity'].get('work_center_name'),
                        'machine_code': '',
                        'machine_name': '',
                        'capacity_state': card['capacity'].get('capacity_state'),
                    },
                    'target': {
                        'planned_date': card['operation'].get('planned_date'),
                        'shift_key': card['capacity'].get('shift_key'),
                        'work_center_code': current_wc,
                        'work_center_name': card['capacity'].get('work_center_name'),
                        'machine_code': machine_target['code'],
                        'machine_name': machine_target['name'],
                    },
                })
                seen_card_kinds.add(card_kind_key)

    groups_by_key = {
        (
            str(group.get('work_center_code') or '').strip().upper(),
            str(group.get('planned_date') or ''),
            str(group.get('shift_key') or '').strip().upper(),
        ): group
        for group in work_center_groups
        if group.get('total_operations')
    }
    overloaded_groups = [
        group for group in work_center_groups
        if group.get('overloaded') or str(group.get('load_ratio') or '') not in {'', 'None'} and Decimal(str(group.get('load_ratio') or 0)) >= Decimal('0.85')
    ]
    overloaded_groups = sorted(
        overloaded_groups,
        key=lambda group: (
            0 if group.get('overloaded') else 1,
            -(Decimal(str(group.get('load_ratio') or 0))),
            group.get('planned_date') or '9999-12-31',
        ),
    )

    for group in overloaded_groups:
        eligible_cards = [
            card for card in editable_cards
            if str(card['capacity'].get('work_center_code') or '').strip().upper() == str(group.get('work_center_code') or '').strip().upper()
            and str(card['operation'].get('planned_date') or '') == str(group.get('planned_date') or '')
            and str(card['capacity'].get('shift_key') or '').strip().upper() == str(group.get('shift_key') or '').strip().upper()
        ]
        if not eligible_cards:
            continue
        candidate = sorted(
            eligible_cards,
            key=lambda card: (
                -(card['operation'].get('priority_rank') or 0),
                -(card['operation'].get('dispatch_sequence') or 0),
                -(Decimal(str(card['capacity'].get('scheduled_hours') or 0))),
            ),
        )[0]
        kind_key = (candidate['card_key'], 'RELIEVE_CAPACITY')
        if kind_key in seen_card_kinds:
            continue
        step_code = str(candidate['operation'].get('step_code') or '').strip().upper()
        current_date = str(candidate['operation'].get('planned_date') or '')
        current_shift = str(candidate['capacity'].get('shift_key') or '').strip().upper()
        current_wc = str(candidate['capacity'].get('work_center_code') or '').strip().upper()
        card_hours = Decimal(str(candidate['capacity'].get('scheduled_hours') or 0))

        candidate_targets = []
        step_targets = work_center_candidates_by_step.get(step_code, [])
        for target_wc in step_targets:
            target_group = groups_by_key.get((target_wc['code'], current_date, current_shift))
            if target_group and target_wc['code'] != current_wc:
                candidate_targets.append(('MOVE_WORK_CENTER', target_group))
        for shift_key in PLANNING_SHIFT_FILTERS:
            if shift_key in {'UNASSIGNED', current_shift}:
                continue
            target_group = groups_by_key.get((current_wc, current_date, shift_key))
            if target_group:
                candidate_targets.append(('MOVE_SHIFT', target_group))
        if current_date:
            for offset_days in range(1, 4):
                target_date = (date.fromisoformat(current_date) + timedelta(days=offset_days)).isoformat()
                target_group = groups_by_key.get((current_wc, target_date, current_shift))
                if target_group:
                    candidate_targets.append(('MOVE_DAY', target_group))

        chosen_target = None
        chosen_kind = None
        for target_kind, target_group in candidate_targets:
            capacity_hours = Decimal(str(target_group.get('capacity_hours') or 0))
            target_load = Decimal(str(target_group.get('scheduled_hours') or 0))
            if capacity_hours <= 0:
                continue
            projected_ratio = _get_capacity_ratio(target_load + card_hours, capacity_hours)
            if projected_ratio is None or projected_ratio > Decimal('1.00'):
                continue
            chosen_target = target_group
            chosen_kind = target_kind
            break
        if not chosen_target or not chosen_kind:
            continue

        source_capacity = Decimal(str(group.get('capacity_hours') or 0))
        source_load = Decimal(str(group.get('scheduled_hours') or 0))
        projected_source_ratio = _get_capacity_ratio(max(Decimal('0'), source_load - card_hours), source_capacity)
        target_capacity = Decimal(str(chosen_target.get('capacity_hours') or 0))
        target_load = Decimal(str(chosen_target.get('scheduled_hours') or 0))
        projected_target_ratio = _get_capacity_ratio(target_load + card_hours, target_capacity)
        target_wc = str(chosen_target.get('work_center_code') or '').strip().upper()
        target_machine = next(iter(machine_candidates_by_step_wc.get((step_code, target_wc), [])), None)
        changes = {}
        if chosen_kind == 'MOVE_SHIFT' and chosen_target.get('shift_key') != current_shift:
            changes['planned_shift'] = chosen_target.get('shift_key')
        if chosen_kind == 'MOVE_DAY' and chosen_target.get('planned_date') != current_date:
            changes['planned_date'] = chosen_target.get('planned_date')
        if chosen_kind == 'MOVE_WORK_CENTER' and target_wc and target_wc != current_wc:
            changes['work_center_code'] = chosen_target.get('work_center_code')
            changes['work_center_name'] = chosen_target.get('work_center_name')
            if target_machine:
                changes['machine_code'] = target_machine['code']
                changes['machine_name'] = target_machine['name']
        if not changes:
            continue
        suggestions.append({
            'key': f"rebalance-{chosen_kind.lower()}-{candidate['card_key']}",
            'kind': chosen_kind,
            'severity': 'critical' if group.get('overloaded') else 'warning',
            'title': f"Giam tai {group.get('work_center_name') or group.get('work_center_code')} cho {candidate['order']['code']}",
            'description': f"Goi y doi {candidate['operation']['step_code']} sang {(chosen_target.get('work_center_name') or chosen_target.get('work_center_code') or '')} {(chosen_target.get('planned_date') or '')} {chosen_target.get('shift_label') or ''} de ha tai slot hien tai.",
            'card_key': candidate['card_key'],
            'order_id': candidate['order']['id'],
            'order_code': candidate['order']['code'],
            'operation_id': candidate['operation']['id'],
            'operation_code': candidate['operation']['step_code'],
            'focus_url': _build_planning_url('/production-planning', {
                'focus_operation_id': candidate['operation']['id'],
                'planned_date': current_date,
                'planned_shift': current_shift,
                'work_center_code': current_wc,
            }),
            'focus_filters': {
                'focus_operation_id': candidate['operation']['id'],
                'planned_date': current_date,
                'planned_shift': current_shift,
                'work_center_code': current_wc,
            },
            'suggested_changes': changes,
            'projected_source_load_ratio': str(projected_source_ratio) if projected_source_ratio is not None else None,
            'projected_target_load_ratio': str(projected_target_ratio) if projected_target_ratio is not None else None,
            'source': {
                'planned_date': current_date or None,
                'shift_key': current_shift,
                'work_center_code': current_wc,
                'work_center_name': candidate['capacity'].get('work_center_name'),
                'machine_code': candidate['capacity'].get('machine_code'),
                'machine_name': candidate['capacity'].get('machine_name'),
                'capacity_state': candidate['capacity'].get('capacity_state'),
            },
            'target': {
                'planned_date': chosen_target.get('planned_date'),
                'shift_key': chosen_target.get('shift_key'),
                'work_center_code': chosen_target.get('work_center_code'),
                'work_center_name': chosen_target.get('work_center_name'),
                'machine_code': target_machine['code'] if target_machine else '',
                'machine_name': target_machine['name'] if target_machine else '',
            },
        })
        seen_card_kinds.add(kind_key)

    severity_order = {'critical': 0, 'warning': 1, 'info': 2}
    suggestions = sorted(
        suggestions,
        key=lambda item: (
            severity_order.get(item['severity'], 99),
            0 if item['kind'] in {'MOVE_WORK_CENTER', 'MOVE_SHIFT', 'MOVE_DAY'} else 1,
            item['order_code'],
            item['operation_code'],
        ),
    )
    return suggestions[:10]


def _serialize_planning_exception_groups(cards):
    counts = {
        'OVERDUE': sum(1 for card in cards if card['exceptions']['risk_state'] == 'OVERDUE'),
        'WAIT_MATERIAL': sum(1 for card in cards if card['materials']['material_readiness'] != 'READY'),
        'WAIT_PREVIOUS_STEP': sum(1 for card in cards if card['exceptions']['dependency_state'] == 'WAIT_PREVIOUS_STEP'),
        'UNSCHEDULED': sum(1 for card in cards if card['bucket']['key'] == 'UNSCHEDULED'),
        'READY_TO_RUN': sum(1 for card in cards if _is_ready_to_run_card(card)),
    }
    return [
        {
            'key': 'OVERDUE',
            'label': 'Cong doan qua han',
            'count': counts['OVERDUE'],
            'severity': 'critical',
            'description': 'Khoanh ngay nhom qua han de doi ngay, doi ca va giam ap luc tre giao.',
            'filters': {'bucket_key': 'OVERDUE', 'needs_attention': 1},
            'primary_action': {
                'label': 'Khoanh tren planner',
                'url': _build_planning_url('/production-planning', {'bucket_key': 'OVERDUE', 'needs_attention': 1}),
            },
            'secondary_action': {
                'label': 'Mở Đơn hàng xuất',
                'url': '/sales-orders?section=delivery-planning',
            },
        },
        {
            'key': 'WAIT_MATERIAL',
            'label': 'Cho vat tu',
            'count': counts['WAIT_MATERIAL'],
            'severity': 'warning',
            'description': 'Can mo issue overview va doi chieu cap vat tu truoc khi day len line.',
            'filters': {'has_material_wait': 1, 'needs_attention': 1},
            'primary_action': {
                'label': 'Loc thieu vat tu',
                'url': _build_planning_url('/production-planning', {'has_material_wait': 1, 'needs_attention': 1}),
            },
            'secondary_action': {
                'label': 'Mo Material Issues',
                'url': '/material-issues',
            },
        },
        {
            'key': 'WAIT_PREVIOUS_STEP',
            'label': 'Cho cong doan truoc',
            'count': counts['WAIT_PREVIOUS_STEP'],
            'severity': 'warning',
            'description': 'Dung theo doi ban giao cong doan de tranh keo line sau khi line truoc chua xong.',
            'filters': {'has_previous_wait': 1, 'needs_attention': 1},
            'primary_action': {
                'label': 'Loc cho ban giao',
                'url': _build_planning_url('/production-planning', {'has_previous_wait': 1, 'needs_attention': 1}),
            },
            'secondary_action': {
                'label': 'Mo Production Orders',
                'url': '/production-orders',
            },
        },
        {
            'key': 'UNSCHEDULED',
            'label': 'Chua xep lich',
            'count': counts['UNSCHEDULED'],
            'severity': 'info',
            'description': 'Chot ngay va ca cho cac cong doan dang troi de planner de theo doi hon.',
            'filters': {'bucket_key': 'UNSCHEDULED'},
            'primary_action': {
                'label': 'Loc chua xep',
                'url': _build_planning_url('/production-planning', {'bucket_key': 'UNSCHEDULED'}),
            },
            'secondary_action': {
                'label': 'Mo danh sach LSX',
                'url': '/production-orders',
            },
        },
        {
            'key': 'READY_TO_RUN',
            'label': 'San chay theo ca',
            'count': counts['READY_TO_RUN'],
            'severity': 'success',
            'description': 'Nhung cong doan da du dieu kien co the day len dispatch hoac giao ca ngay.',
            'filters': {'ready_to_run': 1},
            'primary_action': {
                'label': 'Loc san chay',
                'url': _build_planning_url('/production-planning', {'ready_to_run': 1}),
            },
            'secondary_action': {
                'label': 'Mở Quét QR kiện',
                'url': '/shipments/scan?role=supervisor&preset=overview&focus=session',
            },
        },
    ]


def _resolve_operation_update_inputs(data, *, operation):
    next_status = data.get('status') or operation.status
    if next_status not in dict(ProductionOperationStatus.CHOICES):
        raise ValidationError({'error': 'Trang thai cong doan khong hop le.'})
    if 'status' in data and next_status == ProductionOperationStatus.SKIPPED:
        raise ValidationError({'error': SKIP_OPERATION_REQUIRED_MESSAGE})

    completed_qty = data.get('completed_qty')
    scrap_qty = data.get('scrap_qty')
    try:
        completed_qty_value = Decimal(str(completed_qty)) if completed_qty not in (None, '') else None
        scrap_qty_value = Decimal(str(scrap_qty)) if scrap_qty not in (None, '') else None
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValidationError({'error': 'So luong hoan thanh/phe pham khong hop le.'}) from exc

    planned_date = _parse_optional_date(data.get('planned_date'), field_label='planned_date') if 'planned_date' in data else operation.planned_date
    priority_rank_value = _parse_optional_int(data.get('priority_rank'), field_label='priority_rank') if 'priority_rank' in data else operation.priority_rank
    if 'priority_rank' in data and priority_rank_value is None:
        priority_rank_value = 100
    dispatch_sequence_value = _parse_optional_int(data.get('dispatch_sequence'), field_label='dispatch_sequence') if 'dispatch_sequence' in data else operation.dispatch_sequence
    if 'dispatch_sequence' in data and dispatch_sequence_value is None:
        dispatch_sequence_value = 100
    estimated_runtime_hours_value = _parse_optional_decimal(data.get('estimated_runtime_hours'), field_label='estimated_runtime_hours') if 'estimated_runtime_hours' in data else Decimal(str(operation.estimated_runtime_hours or 0))
    if 'estimated_runtime_hours' in data and estimated_runtime_hours_value is None:
        estimated_runtime_hours_value = Decimal('0')
    setup_minutes_value = _parse_optional_int(data.get('setup_minutes'), field_label='setup_minutes') if 'setup_minutes' in data else operation.setup_minutes
    if 'setup_minutes' in data and setup_minutes_value is None:
        setup_minutes_value = 0

    planned_shift_value = operation.planned_shift
    if 'planned_shift' in data:
        planned_shift_value = str(data.get('planned_shift') or '').strip().upper()
        if planned_shift_value and planned_shift_value not in dict(ProductionPlanningShift.CHOICES):
            raise ValidationError({'error': 'Ca ke hoach khong hop le.'})

    work_center_code_value = str(data.get('work_center_code') if 'work_center_code' in data else (operation.work_center_code or '')).strip().upper()
    work_center_name_value = str(data.get('work_center_name') if 'work_center_name' in data else (operation.work_center_name or '')).strip()
    machine_code_value = str(data.get('machine_code') if 'machine_code' in data else (operation.machine_code or '')).strip().upper()
    machine_name_value = str(data.get('machine_name') if 'machine_name' in data else (operation.machine_name or '')).strip()
    if machine_code_value and not work_center_code_value:
        raise ValidationError({'error': 'Can gan work center truoc khi chon may.'})

    block_reason_code_value = operation.block_reason_code
    if 'block_reason_code' in data:
        block_reason_code_value = str(data.get('block_reason_code') or '').strip().upper()
        if block_reason_code_value and block_reason_code_value not in dict(ProductionOperationBlockReason.CHOICES):
            raise ValidationError({'error': 'Ly do nghen khong hop le.'})

    block_reason_note_value = operation.block_reason_note
    if 'block_reason_note' in data:
        block_reason_note_value = str(data.get('block_reason_note') or '').strip()
    if block_reason_note_value and len(block_reason_note_value) > 255:
        raise ValidationError({'error': 'Ghi chu nghen khong duoc vuot qua 255 ky tu.'})
    if block_reason_code_value == ProductionOperationBlockReason.OTHER and not block_reason_note_value:
        raise ValidationError({'error': 'Vui long mo ta ro ly do nghen khi chon Khac.'})
    if next_status in {ProductionOperationStatus.DONE, ProductionOperationStatus.SKIPPED} and block_reason_code_value:
        block_reason_code_value = ''
        block_reason_note_value = ''

    note_value = str(data.get('note') if 'note' in data else (operation.note or '')).strip()
    return {
        'status': next_status,
        'completed_qty': completed_qty_value,
        'scrap_qty': scrap_qty_value,
        'planned_date': planned_date,
        'planned_shift': planned_shift_value,
        'priority_rank': priority_rank_value,
        'dispatch_sequence': dispatch_sequence_value,
        'work_center_code': work_center_code_value,
        'work_center_name': work_center_name_value,
        'machine_code': machine_code_value,
        'machine_name': machine_name_value,
        'estimated_runtime_hours': estimated_runtime_hours_value,
        'setup_minutes': setup_minutes_value,
        'block_reason_code': block_reason_code_value,
        'block_reason_note': block_reason_note_value,
        'note': note_value,
    }


def _apply_operation_preview_values(operation, *, values):
    operation.status = values['status']
    if values['completed_qty'] is not None:
        operation.completed_qty = values['completed_qty']
    if values['scrap_qty'] is not None:
        operation.scrap_qty = values['scrap_qty']
    operation.planned_date = values['planned_date']
    operation.planned_shift = values['planned_shift']
    operation.priority_rank = values['priority_rank']
    operation.dispatch_sequence = values['dispatch_sequence']
    operation.work_center_code = values['work_center_code']
    operation.work_center_name = values['work_center_name']
    operation.machine_code = values['machine_code']
    operation.machine_name = values['machine_name']
    operation.estimated_runtime_hours = values['estimated_runtime_hours']
    operation.setup_minutes = values['setup_minutes']
    operation.block_reason_code = values['block_reason_code']
    operation.block_reason_note = values['block_reason_note']
    operation.note = values['note']
    return operation


def _normalize_operation_pairs(items, *, required_message):
    if not isinstance(items, list) or not items:
        raise ValidationError({'error': required_message})
    if len(items) > 50:
        raise ValidationError({'error': 'Chi duoc xu ly toi da 50 cong doan trong mot lan.'})

    normalized_pairs = []
    seen_pairs = set()
    order_ids = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValidationError({'error': 'Danh sach cong doan khong hop le.'})
        try:
            order_id = int(item.get('order_id'))
            operation_id = int(item.get('operation_id'))
        except (TypeError, ValueError) as exc:
            raise ValidationError({'error': 'order_id hoac operation_id khong hop le.'}) from exc
        pair = (order_id, operation_id)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        normalized_pairs.append(pair)
        order_ids.add(order_id)
    if not normalized_pairs:
        raise ValidationError({'error': 'Khong co cong doan hop le de xu ly.'})
    return normalized_pairs, order_ids


def _normalize_operation_change_items(
    items,
    *,
    required_message,
    change_key='changes',
    max_items=50,
):
    if not isinstance(items, list) or not items:
        raise ValidationError({'error': required_message})
    if len(items) > max_items:
        raise ValidationError({'error': 'Chi duoc xu ly toi da 50 cong doan trong mot lan.'})

    normalized_items = []
    seen_pairs = set()
    order_ids = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValidationError({'error': 'Danh sach cong doan khong hop le.'})
        try:
            order_id = int(item.get('order_id'))
            operation_id = int(item.get('operation_id'))
        except (TypeError, ValueError) as exc:
            raise ValidationError({'error': 'order_id hoac operation_id khong hop le.'}) from exc
        changes = item.get(change_key)
        if not isinstance(changes, dict):
            raise ValidationError({'error': f'{change_key} khong hop le.'})
        pair = (order_id, operation_id)
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        order_ids.add(order_id)
        normalized_items.append({
            'order_id': order_id,
            'operation_id': operation_id,
            'changes': changes,
            'meta': {
                'suggestion_key': str(item.get('suggestion_key') or '').strip(),
                'suggestion_kind': str(item.get('suggestion_kind') or '').strip().upper(),
                'suggestion_title': str(item.get('suggestion_title') or '').strip(),
                'severity': str(item.get('severity') or '').strip().lower(),
            },
        })
    if not normalized_items:
        raise ValidationError({'error': 'Khong co cong doan hop le de xu ly.'})
    return normalized_items, order_ids


def _summarize_preview_rows(rows):
    shift_items = {key: _build_shift_load_item(key) for key in PLANNING_SHIFT_FILTERS}
    for card in rows:
        shift_key = _get_planning_shift_key(card['operation'].get('planned_shift'))
        _accumulate_shift_load(shift_items[shift_key], card)
    return {
        'total_operations': len(rows),
        'ready_to_run_count': sum(1 for card in rows if _is_ready_to_run_card(card)),
        'needs_attention_count': sum(1 for card in rows if card['exceptions']['needs_attention']),
        'blocked_count': sum(1 for card in rows if card['exceptions']['risk_state'] == 'BLOCKED'),
        'overdue_count': sum(1 for card in rows if card['exceptions']['risk_state'] == 'OVERDUE'),
        'machine_down_count': sum(1 for card in rows if card['exceptions']['block_reason_code'] == ProductionOperationBlockReason.MACHINE_DOWN),
        'over_capacity_count': sum(1 for card in rows if card['capacity']['capacity_state'] == 'OVER_CAPACITY'),
        'at_limit_count': sum(1 for card in rows if card['capacity']['capacity_state'] == 'AT_LIMIT'),
        'unassigned_machine_count': sum(1 for card in rows if card['capacity']['capacity_state'] == 'UNASSIGNED_MACHINE'),
        'unassigned_work_center_count': sum(1 for card in rows if card['capacity']['capacity_state'] == 'UNASSIGNED_WORK_CENTER'),
        'handover_ready_count': sum(1 for card in rows if card['shop_floor']['handover_status'] == ProductionOperationHandoverStatus.READY),
        'handover_accepted_count': sum(1 for card in rows if card['shop_floor']['handover_status'] == ProductionOperationHandoverStatus.ACCEPTED),
        'negative_delivery_gap_count': sum(
            1
            for card in rows
            if card['exceptions'].get('delivery_gap_days') is not None and card['exceptions']['delivery_gap_days'] < 0
        ),
        'total_runtime_hours': str(sum(Decimal(str(card['capacity'].get('runtime_hours') or 0)) for card in rows)),
        'total_setup_hours': str(sum(Decimal(str(card['capacity'].get('setup_hours') or 0)) for card in rows)),
        'total_scheduled_hours': str(sum(Decimal(str(card['capacity'].get('scheduled_hours') or 0)) for card in rows)),
        'shift_loads': _finalize_shift_loads(shift_items.values(), include_empty=True),
    }


def _build_preview_capacity_windows(rows):
    windows = []
    for row in _build_capacity_calendar(rows):
        for shift in row['shifts']:
            if not shift['total_operations']:
                continue
            score = (
                shift['over_capacity_count'] * 100
                + shift['at_limit_count'] * 60
                + shift['needs_attention_count'] * 20
                + shift['blocked_count'] * 15
                + int(Decimal(str(shift.get('load_ratio') or 0)) * 100)
            )
            windows.append({
                'date': row['date'],
                'date_label': row['date_label'],
                'shift': shift,
                'score': score,
            })
    return sorted(
        windows,
        key=lambda item: (
            -item['score'],
            item['date'] or '9999-12-31',
            item['shift']['sort_order'],
        ),
    )[:6]


def _matches_planning_filter(
    card,
    *,
    step_code,
    planned_shift,
    handover_status,
    dispatch_owner,
    work_center_code,
    machine_code,
    capacity_state,
    risk_state,
    material_readiness,
    dependency_state,
    bucket_key,
    order_status,
    ready_to_run_only,
    needs_attention_only,
    has_material_wait,
    has_previous_wait,
):
    operation = card['operation']
    materials = card['materials']
    exceptions = card['exceptions']
    if step_code and str(operation.get('step_code') or '').strip().upper() != step_code:
        return False
    if planned_shift:
        operation_shift = str(operation.get('planned_shift') or '').strip().upper()
        if planned_shift == 'UNASSIGNED':
            if operation_shift:
                return False
        elif operation_shift != planned_shift:
            return False
    if handover_status:
        card_handover_status = str(card['shop_floor'].get('handover_status') or '').strip().upper()
        if handover_status == 'NONE':
            if card_handover_status:
                return False
        elif card_handover_status != handover_status:
            return False
    if dispatch_owner:
        owner_value = str(card['shop_floor'].get('dispatch_owner') or '').strip().lower()
        if dispatch_owner not in owner_value:
            return False
    if work_center_code:
        work_center_value = str(operation.get('work_center_code') or '').strip().lower()
        if work_center_code not in work_center_value:
            return False
    if machine_code:
        machine_value = str(operation.get('machine_code') or '').strip().lower()
        if machine_code not in machine_value:
            return False
    if capacity_state and str(card.get('capacity', {}).get('capacity_state') or '').strip().upper() != capacity_state:
        return False
    if risk_state and str(exceptions.get('risk_state') or '').strip().upper() != risk_state:
        return False
    if material_readiness and str(materials.get('material_readiness') or '').strip().upper() != material_readiness:
        return False
    if dependency_state and str(exceptions.get('dependency_state') or '').strip().upper() != dependency_state:
        return False
    if bucket_key and str(card['bucket'].get('key') or '').strip().upper() != bucket_key:
        return False
    if order_status and str(card['order'].get('status') or '').strip().upper() != order_status:
        return False
    if ready_to_run_only and not bool(materials.get('ready_to_run')):
        return False
    if needs_attention_only and not bool(exceptions.get('needs_attention')):
        return False
    if has_material_wait and str(materials.get('material_readiness') or '').strip().upper() == 'READY':
        return False
    if has_previous_wait and str(exceptions.get('dependency_state') or '').strip().upper() != 'WAIT_PREVIOUS_STEP':
        return False
    return True


def _serialize_planning_card(order, operation, *, snapshot, today):
    setattr(operation, '_planning_snapshot', snapshot)
    operation_payload = ProductionOperationSerializer(operation).data
    customer = getattr(getattr(order, 'sales_order', None), 'customer', None)
    planned_date = getattr(operation, 'planned_date', None)
    issue_rows = list(order.issues.all())
    receipt_rows = list(order.receipts.all())
    bucket_key = _get_planning_bucket(planned_date, today=today)
    bucket_meta = PLANNING_BUCKETS[bucket_key]
    bucket_date = planned_date.isoformat() if planned_date else None
    overdue_days = 0
    if planned_date and planned_date < today:
        overdue_days = (today - planned_date).days
    delivery_due_date = getattr(order, 'planned_end_date', None)
    days_to_delivery = None
    delivery_gap_days = None
    if delivery_due_date:
        days_to_delivery = (delivery_due_date - today).days
        if planned_date:
            delivery_gap_days = (delivery_due_date - planned_date).days
    ready_to_run = (
        snapshot['material_readiness'] == 'READY'
        and snapshot['dependency_state'] in {'ROOT', 'CLEAR'}
        and not str(operation.block_reason_code or '').strip()
        and operation.status in {ProductionOperationStatus.PENDING, ProductionOperationStatus.READY}
    )

    sales_order_code = getattr(getattr(order, 'sales_order', None), 'code', '') or ''
    product_code = (order.product_snapshot or {}).get('code') or getattr(getattr(order, 'product', None), 'code', '') or ''
    customer_code = getattr(customer, 'code', '') if customer else ''
    customer_name = getattr(customer, 'name', '') if customer else ''
    sales_link_params = {}
    if sales_order_code:
        sales_link_params['sales_order_code'] = sales_order_code
    if product_code:
        sales_link_params['finished_product_code'] = product_code
    sales_link_base_params = {'section': 'delivery-planning'}
    sales_fulfillment_url = '/sales-orders'
    if sales_link_params:
        sales_fulfillment_url = f"{sales_fulfillment_url}?{urlencode({**sales_link_base_params, **sales_link_params})}"
    else:
        sales_fulfillment_url = f"{sales_fulfillment_url}?{urlencode(sales_link_base_params)}"
    scan_center_params = {
        'role': 'operator',
        'preset': 'overview',
        'focus': 'session',
        'planner_operation_ids': str(operation.id),
        'planner_order_ids': str(order.id),
        'planner_step_code': operation.step_code,
        'planner_shift': operation.planned_shift or '',
        'planner_return_to': _build_planning_url('/production-planning', {'production_order_id': order.id, 'focus_operation_id': operation.id}),
    }
    scan_center_url = _build_planning_url('/shipments/scan', scan_center_params)

    return {
        'card_key': f'operation-{operation.id}',
        'bucket': {
            'key': bucket_key,
            'label': bucket_meta['label'],
            'sort_order': bucket_meta['sort'],
            'date': bucket_date,
        },
        'order': {
            'id': order.id,
            'code': order.code,
            'status': order.status,
            'product_id': getattr(order, 'product_id', None),
            'product_code': product_code or None,
            'product_name': (order.product_snapshot or {}).get('name') or getattr(getattr(order, 'product', None), 'name', None),
            'planned_qty': str(order.planned_qty),
            'produced_qty': str(order.produced_qty),
            'remaining_qty': str(order.remaining_qty),
            'planned_start_date': order.planned_start_date,
            'planned_end_date': order.planned_end_date,
            'reference': order.reference,
        },
        'operation': operation_payload,
        'sales': {
            'sales_order_id': getattr(order, 'sales_order_id', None),
            'sales_order_code': sales_order_code or None,
            'sales_order_line_id': getattr(order, 'sales_order_line_id', None),
            'sales_order_line_number': getattr(getattr(order, 'sales_order_line', None), 'line_number', None),
            'customer_code': customer_code or None,
            'customer_name': customer_name or None,
            'delivery_due_date': order.planned_end_date,
        },
        'materials': {
            'material_readiness': snapshot['material_readiness'],
            'material_readiness_label': PLANNING_READINESS_LABELS.get(snapshot['material_readiness'], snapshot['material_readiness']),
            'remaining_issue_qty': str(snapshot['remaining_issue_qty']),
            'remaining_issue_line_count': snapshot['remaining_issue_line_count'],
            'issue_count': len(issue_rows),
            'receipt_count': len(receipt_rows),
            'ready_to_run': ready_to_run,
        },
        'exceptions': {
            'risk_state': snapshot['risk_state'],
            'risk_state_label': PLANNING_RISK_LABELS.get(snapshot['risk_state'], snapshot['risk_state']),
            'dependency_state': snapshot['dependency_state'],
            'dependency_state_label': PLANNING_DEPENDENCY_LABELS.get(snapshot['dependency_state'], snapshot['dependency_state']),
            'block_reason_code': operation.block_reason_code or '',
            'block_reason_label': snapshot['block_reason_label'],
            'block_reason_note': operation.block_reason_note or '',
            'overdue_days': overdue_days,
            'days_to_delivery': days_to_delivery,
            'delivery_gap_days': delivery_gap_days,
            'is_overdue': bucket_key == 'OVERDUE',
            'is_unscheduled': bucket_key == 'UNSCHEDULED',
            'needs_attention': snapshot['risk_state'] in {'OVERDUE', 'BLOCKED', 'UNSCHEDULED', 'AT_RISK'},
        },
        'shop_floor': {
            'dispatch_owner': operation.dispatch_owner or '',
            'handover_status': operation.handover_status or '',
            'handover_status_label': getattr(operation, 'get_handover_status_display', lambda: '')() or '',
            'handover_receiver': operation.handover_receiver or '',
            'handover_note': operation.handover_note or '',
            'handover_at': operation.handover_at,
        },
        'capacity': {
            'work_center_code': operation.work_center_code or '',
            'work_center_name': operation.work_center_name or '',
            'machine_code': operation.machine_code or '',
            'machine_name': operation.machine_name or '',
            'shift_key': _get_planning_shift_key(operation.planned_shift),
            'shift_label': PLANNING_SHIFT_FILTERS[_get_planning_shift_key(operation.planned_shift)]['label'],
            'runtime_hours': str(getattr(operation, 'estimated_runtime_hours', 0) or 0),
            'setup_hours': str(Decimal(str(getattr(operation, 'setup_minutes', 0) or 0)) / Decimal('60')),
            'scheduled_hours': str(Decimal(str(getattr(operation, 'estimated_runtime_hours', 0) or 0)) + (Decimal(str(getattr(operation, 'setup_minutes', 0) or 0)) / Decimal('60'))),
            'shift_capacity_hours': '0',
            'work_center_load_hours': '0',
            'machine_load_hours': '0',
            'work_center_load_ratio': None,
            'machine_load_ratio': None,
            'capacity_state': 'BALANCED',
            'capacity_state_label': PLANNING_CAPACITY_STATES['BALANCED']['label'],
            'over_capacity': False,
            'unassigned_machine': False,
            'unassigned_work_center': False,
        },
        'actions': {
            'production_order_url': f'/production-orders?focus_id={order.id}',
            'sales_fulfillment_url': sales_fulfillment_url,
            'material_issue_url': f'/material-issues?production_order={order.id}',
            'production_receipt_url': f'/production-receipts?production_order={order.id}',
            'scan_center_url': scan_center_url,
        },
    }


def _serialize_production_receipt_scan_match(line):
    receipt = getattr(line, 'receipt', None)
    order = getattr(receipt, 'production_order', None)
    product_snapshot = getattr(line, 'product_snapshot', None) or {}
    product = getattr(line, 'product', None)
    inventory_tx = getattr(line, 'inventory_transaction', None)
    trace_code = _build_production_receipt_line_trace_code(line)
    return {
        'receipt_line_id': line.id,
        'line_number': line.line_number,
        'production_order_id': getattr(order, 'id', None),
        'production_order_code': getattr(order, 'code', None),
        'order_date': getattr(order, 'order_date', None),
        'receipt_date': getattr(receipt, 'receipt_date', None),
        'receipt_status': getattr(receipt, 'status', None),
        'product_id': getattr(line, 'product_id', None),
        'product_code': product_snapshot.get('code') or getattr(product, 'code', None),
        'product_name': product_snapshot.get('name') or getattr(product, 'name', None),
        'quantity': line.quantity,
        'unit_cost': line.unit_cost,
        'line_total': line.line_total,
        'bundle_count': getattr(line, 'bundle_count', None),
        'units_per_bundle': getattr(line, 'units_per_bundle', None),
        'pallet_count': getattr(line, 'pallet_count', None),
        'bundles_per_pallet': getattr(line, 'bundles_per_pallet', None),
        'packaging_summary': _build_production_receipt_packaging_summary(line),
        'inventory_transaction_id': getattr(line, 'inventory_transaction_id', None),
        'inventory_transaction_code': getattr(inventory_tx, 'code', None),
        'trace_code': trace_code,
        'qr_value': trace_code,
    }


class SearchTextMixin:
    search_text_field = 'search_text'

    def check_module_read_permission(self):
        if not _can_manage_production(self.request.user):
            raise PermissionDenied('Bạn không có quyền xem dữ liệu sản xuất.')

    def apply_search(self, queryset):
        self.check_module_read_permission()
        search_raw = (self.request.query_params.get('q') or self.request.query_params.get('search') or '').strip()
        if not search_raw:
            return queryset
        normalized = unidecode(search_raw).lower().strip()
        tokens = [token for token in normalized.split() if token]
        if not tokens:
            return queryset
        field_name = self.search_text_field
        query = Q(**{f'{field_name}__icontains': tokens[0]})
        for token in tokens[1:]:
            query &= Q(**{f'{field_name}__icontains': token})
        return queryset.filter(query).distinct()


def _parse_date_filter(value):
    value = str(value or '').strip()
    if not value:
        return None
    return parse_date(value)


def _split_filter_values(value):
    return [item.strip() for item in str(value or '').split(',') if item.strip()]


def _active_bucket_queryset(queryset):
    return (
        queryset
        .filter(Q(hold_reason='') | Q(hold_reason__isnull=True))
        .exclude(
            Q(planning_status=ProductionDemandPlanningStatus.CANCELLED)
            | Q(production_status=ProductionDemandProductionStatus.CANCELLED)
        )
    )


def _apply_production_demand_bucket(queryset, bucket, today=None):
    bucket_value = str(bucket or '').strip().lower()
    if not bucket_value:
        return queryset
    today_value = today or timezone.localdate()
    if bucket_value == 'held':
        return queryset.exclude(hold_reason='')
    if bucket_value == 'cancelled':
        return queryset.filter(
            Q(planning_status=ProductionDemandPlanningStatus.CANCELLED)
            | Q(production_status=ProductionDemandProductionStatus.CANCELLED)
        )
    active = _active_bucket_queryset(queryset)
    if bucket_value == 'no_date':
        return active.filter(planning_due_date__isnull=True)
    if bucket_value == 'overdue':
        return active.filter(planning_due_date__lt=today_value)
    if bucket_value == 'due_today':
        return active.filter(planning_due_date=today_value)
    if bucket_value == 'upcoming_7':
        return active.filter(
            planning_due_date__gt=today_value,
            planning_due_date__lte=today_value + timedelta(days=7),
        )
    if bucket_value == 'not_due':
        return active.filter(planning_due_date__gt=today_value + timedelta(days=7))
    return queryset


def _production_demand_summary(queryset, today=None):
    today_value = today or timezone.localdate()
    active = _active_bucket_queryset(queryset)
    return {
        'total': queryset.count(),
        'held': queryset.exclude(hold_reason='').count(),
        'cancelled': queryset.filter(
            Q(planning_status=ProductionDemandPlanningStatus.CANCELLED)
            | Q(production_status=ProductionDemandProductionStatus.CANCELLED)
        ).count(),
        'no_date': active.filter(planning_due_date__isnull=True).count(),
        'overdue': active.filter(planning_due_date__lt=today_value).count(),
        'due_today': active.filter(planning_due_date=today_value).count(),
        'upcoming_7_days': active.filter(
            planning_due_date__gt=today_value,
            planning_due_date__lte=today_value + timedelta(days=7),
        ).count(),
        'not_due': active.filter(planning_due_date__gt=today_value + timedelta(days=7)).count(),
        'partially_planned': queryset.filter(planning_status=ProductionDemandPlanningStatus.PARTIALLY_PLANNED).count(),
        'fully_planned': queryset.filter(planning_status=ProductionDemandPlanningStatus.FULLY_PLANNED).count(),
        'no_production_needed': queryset.filter(planning_status=ProductionDemandPlanningStatus.NO_PRODUCTION_NEEDED).count(),
        'not_released': queryset.filter(production_status=ProductionDemandProductionStatus.NOT_RELEASED).count(),
        'in_progress': queryset.filter(production_status=ProductionDemandProductionStatus.IN_PROGRESS).count(),
        'completed': queryset.filter(production_status=ProductionDemandProductionStatus.COMPLETED).count(),
    }


class ProductionDemandViewSet(SearchTextMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = ProductionDemandSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['planning_due_date', 'delivery_date', 'priority', 'product_code', 'created_at']
    ordering = ['planning_due_date', 'delivery_date', 'id']

    def get_serializer_class(self):
        if getattr(self, 'action', None) == 'retrieve':
            return ProductionDemandDetailSerializer
        return super().get_serializer_class()

    def _linked_orders_prefetch(self):
        return Prefetch(
            'production_orders',
            queryset=ProductionOrder.objects.order_by('-order_date', '-id').prefetch_related('operations'),
        )

    def _base_queryset(self):
        queryset = ProductionDemand.objects.select_related(
            'sales_order',
            'sales_order__customer',
            'sales_order_line',
            'delivery_plan',
            'product',
            'assigned_planner',
        )
        if getattr(self, 'action', None) == 'retrieve':
            queryset = queryset.prefetch_related(self._linked_orders_prefetch())
        return queryset

    def _apply_filters(self, queryset, *, include_planning_bucket=True):
        params = self.request.query_params
        exact_filters = {
            'planning_status': 'planning_status',
            'production_status': 'production_status',
            'product_kind': 'product_kind',
            'priority': 'priority',
            'assigned_planner': 'assigned_planner_id',
            'sales_order': 'sales_order_id',
            'sales_order_line': 'sales_order_line_id',
            'delivery_plan': 'delivery_plan_id',
            'product': 'product_id',
        }
        for param_name, field_name in exact_filters.items():
            values = _split_filter_values(params.get(param_name))
            if not values:
                continue
            if len(values) == 1:
                queryset = queryset.filter(**{field_name: values[0]})
            else:
                queryset = queryset.filter(**{f'{field_name}__in': values})

        product_code = str(params.get('product_code') or '').strip()
        if product_code:
            queryset = queryset.filter(product_code__icontains=product_code)

        customer_value = str(params.get('customer') or '').strip()
        if customer_value:
            if customer_value.isdigit():
                queryset = queryset.filter(
                    Q(customer_id_snapshot=int(customer_value))
                    | Q(sales_order__customer_id=int(customer_value))
                )
            else:
                queryset = queryset.filter(
                    Q(customer_name_snapshot__icontains=customer_value)
                    | Q(sales_order__customer__name__icontains=customer_value)
                    | Q(sales_order__customer__code__icontains=customer_value)
                )

        delivery_date_from = _parse_date_filter(params.get('delivery_date_from'))
        if delivery_date_from:
            queryset = queryset.filter(delivery_date__gte=delivery_date_from)
        delivery_date_to = _parse_date_filter(params.get('delivery_date_to'))
        if delivery_date_to:
            queryset = queryset.filter(delivery_date__lte=delivery_date_to)
        planning_due_date_from = _parse_date_filter(params.get('planning_due_date_from'))
        if planning_due_date_from:
            queryset = queryset.filter(planning_due_date__gte=planning_due_date_from)
        planning_due_date_to = _parse_date_filter(params.get('planning_due_date_to'))
        if planning_due_date_to:
            queryset = queryset.filter(planning_due_date__lte=planning_due_date_to)

        if include_planning_bucket:
            queryset = _apply_production_demand_bucket(queryset, params.get('planning_bucket'))
        return self.apply_search(queryset)

    def get_queryset(self):
        return self._apply_filters(self._base_queryset(), include_planning_bucket=True)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        queryset = self._apply_filters(self._base_queryset(), include_planning_bucket=False)
        return Response(_production_demand_summary(queryset))

    @action(detail=True, methods=['post'])
    def create_order(self, request, pk=None):
        if not _can_manage_production(request.user):
            raise PermissionDenied('Ban khong co quyen tao lenh san xuat tu nhu cau san xuat.')

        demand = self.get_object()
        serializer = ProductionDemandCreateOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            with transaction.atomic():
                order = create_production_order_from_demand(
                    demand,
                    data['qty'],
                    planned_start_date=data.get('planned_start_date'),
                    planned_end_date=data.get('planned_end_date'),
                    user=request.user,
                )
                note = str(data.get('note') or '').strip()
                if note:
                    order.notes = note
                    order.save(update_fields=['notes', 'updated_at'])

                demand.refresh_from_db()
                order.refresh_from_db()
                _log_production_audit(
                    request,
                    action='CREATE',
                    entity_type='ProductionOrder',
                    entity_id=int(order.id),
                    entity_code=order.code,
                    old_values={},
                    new_values={
                        'status': order.status,
                        'product': order.product_id,
                        'planned_qty': str(order.planned_qty),
                        'production_demand': demand.id,
                        'production_demand_code': demand.demand_code,
                    },
                )
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        order = ProductionOrder.objects.select_related(
            'production_demand',
            'sales_order',
            'sales_order__customer',
            'sales_order_line',
            'product',
            'target_warehouse',
            'target_location',
            'created_by',
            'updated_by',
            'owner',
            'team',
        ).prefetch_related(
            'operations',
            'material_requirements',
            'material_requirements__material_product',
        ).get(pk=order.pk)
        demand = self._base_queryset().prefetch_related(self._linked_orders_prefetch()).get(pk=demand.pk)
        return Response(
            {
                'message': 'Da tao lenh san xuat.',
                'production_order_id': order.id,
                'production_order_code': order.code,
                'operation_count': order.operations.count(),
                'production_order': ProductionOrderSerializer(order).data,
                'production_demand': ProductionDemandDetailSerializer(demand).data,
            },
            status=status.HTTP_201_CREATED,
        )


class ProductionOrderViewSet(SearchTextMixin, viewsets.ModelViewSet):
    serializer_class = ProductionOrderSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'order_date', 'planned_start_date', 'planned_end_date', 'status', 'planned_qty', 'produced_qty', 'created_at']
    ordering = ['-order_date', '-id']

    def get_queryset(self):
        queryset = ProductionOrder.objects.select_related(
            'production_demand',
            'sales_order',
            'sales_order__customer',
            'sales_order_line',
            'product',
            'target_warehouse',
            'target_location',
            'submitted_by',
            'approved_by',
            'rejected_by',
            'released_by',
            'completed_by',
            'cancelled_by',
            'created_by',
            'updated_by',
            'owner',
            'team',
        ).prefetch_related(
            'operations',
            'material_requirements',
            'material_requirements__material_product',
            'issues',
            'receipts',
        )
        user = self.request.user
        if not getattr(user, 'is_superuser', False):
            if getattr(user, 'teams', None):
                team_ids = list(user.teams.values_list('id', flat=True))
                queryset = queryset.filter(Q(owner=user) | Q(team_id__in=team_ids) | Q(owner__isnull=True))
            else:
                queryset = queryset.filter(Q(owner=user) | Q(owner__isnull=True))

        status_value = (self.request.query_params.get('status') or '').strip()
        if status_value:
            queryset = queryset.filter(status=status_value)
        source_type = (self.request.query_params.get('source_type') or '').strip().upper()
        if source_type == 'DEMAND':
            queryset = queryset.filter(production_demand__isnull=False)
        elif source_type == 'MANUAL':
            queryset = queryset.filter(production_demand__isnull=True)
        product_id = self.request.query_params.get('product')
        if product_id:
            queryset = queryset.filter(product_id=product_id)
        sales_order_id = self.request.query_params.get('sales_order')
        if sales_order_id:
            queryset = queryset.filter(sales_order_id=sales_order_id)
        order_date_from = self.request.query_params.get('order_date_from')
        if order_date_from:
            queryset = queryset.filter(order_date__gte=order_date_from)
        order_date_to = self.request.query_params.get('order_date_to')
        if order_date_to:
            queryset = queryset.filter(order_date__lte=order_date_to)
        planned_end_date_from = self.request.query_params.get('planned_end_date_from')
        if planned_end_date_from:
            queryset = queryset.filter(planned_end_date__gte=planned_end_date_from)
        planned_end_date_to = self.request.query_params.get('planned_end_date_to')
        if planned_end_date_to:
            queryset = queryset.filter(planned_end_date__lte=planned_end_date_to)
        has_overdue_plan = str(self.request.query_params.get('has_overdue_plan') or '').strip().lower() in {'1', 'true', 'yes'}
        if has_overdue_plan:
            queryset = queryset.filter(
                status__in=[ProductionOrderStatus.APPROVED, ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS],
                planned_end_date__lt=timezone.localdate(),
            )
        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_production(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo lệnh sản xuất.')
        order_date = serializer.validated_data.get('order_date') or timezone.localdate()
        code = get_next_production_order_code(order_date)
        order = serializer.save(
            code=code,
            created_by=self.request.user,
            updated_by=self.request.user,
            owner=self.request.user,
        )
        _log_production_audit(
            self.request,
            action='CREATE',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={},
            new_values={'status': order.status, 'product': order.product_id, 'planned_qty': str(order.planned_qty)},
        )
        recompute_linked_production_demand(order, user=self.request.user)

    def perform_update(self, serializer):
        if not can_edit_production_order(self.request.user, serializer.instance):
            raise PermissionDenied('Chỉ được sửa lệnh sản xuất ở trạng thái Nháp hoặc Từ chối.')
        previous = serializer.instance
        old_demand_id = previous.production_demand_id
        old_values = {
            'status': previous.status,
            'product': previous.product_id,
            'planned_qty': str(previous.planned_qty),
            'version': previous.version,
        }
        order = serializer.save(updated_by=self.request.user)
        _log_production_audit(
            self.request,
            action='UPDATE',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values=old_values,
            new_values={'status': order.status, 'product': order.product_id, 'planned_qty': str(order.planned_qty), 'version': order.version},
        )
        recompute_linked_production_demand(order, user=self.request.user)
        if old_demand_id and old_demand_id != order.production_demand_id:
            recompute_production_demand_by_id(old_demand_id, user=self.request.user)

    def destroy(self, request, *args, **kwargs):
        order = self.get_object()
        if order.status not in {ProductionOrderStatus.DRAFT, ProductionOrderStatus.REJECTED}:
            return Response({'error': 'Chỉ được xóa lệnh sản xuất ở trạng thái Nháp hoặc Từ chối.'}, status=status.HTTP_400_BAD_REQUEST)
        if order.issues.exclude(status=ProductionIssueStatus.CANCELLED).exists() or order.receipts.exclude(status=ProductionReceiptStatus.CANCELLED).exists():
            return Response({'error': 'Lệnh sản xuất đã phát sinh cấp vật tư hoặc nhập thành phẩm, không thể xóa.'}, status=status.HTTP_400_BAD_REQUEST)
        old_values = {'code': order.code, 'status': order.status}
        demand_id = order.production_demand_id
        response = super().destroy(request, *args, **kwargs)
        recompute_production_demand_by_id(demand_id, user=request.user)
        _log_production_audit(
            request,
            action='DELETE',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values=old_values,
            new_values={},
        )
        return response

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        order = self.get_object()
        if not can_submit_production_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        old_status = order.status
        order.status = ProductionOrderStatus.SUBMITTED
        order.submitted_by = request.user
        order.submitted_at = timezone.now()
        order.approved_by = None
        order.approved_at = None
        order.rejected_by = None
        order.rejected_at = None
        order.reject_reason = ''
        order.save(update_fields=['status', 'submitted_by', 'submitted_at', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'reject_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='ProductionOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='SUBMIT',
            user=request.user,
            level=1,
        )
        _log_production_audit(
            request,
            action='SUBMIT',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status},
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'SUBMIT', triggered_by=request.user)
        recompute_linked_production_demand(order, user=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        order = self.get_object()
        if not can_approve_production_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        old_status = order.status
        order.status = ProductionOrderStatus.APPROVED
        order.approved_by = request.user
        order.approved_at = timezone.now()
        order.rejected_by = None
        order.rejected_at = None
        order.reject_reason = ''
        order.save(update_fields=['status', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'reject_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='ProductionOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='APPROVE',
            user=request.user,
            level=1,
        )
        _log_production_audit(
            request,
            action='APPROVE',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status},
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'APPROVE', triggered_by=request.user)
        recompute_linked_production_demand(order, user=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        order = self.get_object()
        if not can_reject_production_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': 'Bắt buộc nhập lý do từ chối.'}, status=status.HTTP_400_BAD_REQUEST)
        old_status = order.status
        order.status = ProductionOrderStatus.REJECTED
        order.rejected_by = request.user
        order.rejected_at = timezone.now()
        order.reject_reason = reason
        order.save(update_fields=['status', 'rejected_by', 'rejected_at', 'reject_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='ProductionOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='REJECT',
            user=request.user,
            comments=reason,
            level=1,
        )
        _log_production_audit(
            request,
            action='REJECT',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status, 'reason': reason},
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'REJECT', triggered_by=request.user)
        recompute_linked_production_demand(order, user=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def release(self, request, pk=None):
        order = self.get_object()
        if not can_release_production_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            with transaction.atomic():
                order = ProductionOrder.objects.select_for_update().get(pk=order.pk)
                if not can_release_production_order(request.user, order):
                    return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
                old_status = order.status
                recompute_linked_production_demand(order, user=request.user)
                validate_production_order_can_release(order)
                now = timezone.now()
                order.status = ProductionOrderStatus.RELEASED
                order.released_by = request.user
                order.released_at = now
                order.save(update_fields=['status', 'released_by', 'released_at', 'updated_at'])
                advance_ready_operations(order)
                demand = recompute_linked_production_demand(order, user=request.user)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        _log_production_audit(
            request,
            action='RELEASE',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status},
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'RELEASE', triggered_by=request.user)
        response_data = {'status': order.status}
        if demand is not None:
            response_data['production_demand'] = ProductionDemandSerializer(demand).data
        return Response(response_data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        order = self.get_object()
        if not can_cancel_production_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = (request.data.get('reason') or request.data.get('cancel_reason') or '').strip()
        if not reason:
            return Response({'error': 'Bắt buộc nhập lý do hủy lệnh sản xuất.'}, status=status.HTTP_400_BAD_REQUEST)
        if order.issues.exclude(status=ProductionIssueStatus.CANCELLED).exists() or order.receipts.exclude(status=ProductionReceiptStatus.CANCELLED).exists():
            return Response({'error': 'Lệnh sản xuất đã phát sinh cấp vật tư hoặc nhập thành phẩm, không thể hủy.'}, status=status.HTTP_400_BAD_REQUEST)
        old_status = order.status
        order.status = ProductionOrderStatus.CANCELLED
        order.cancelled_by = request.user
        order.cancelled_at = timezone.now()
        order.cancel_reason = reason
        order.save(update_fields=['status', 'cancelled_by', 'cancelled_at', 'cancel_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='ProductionOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='CANCEL',
            user=request.user,
            comments=reason,
            level=1,
        )
        _log_production_audit(
            request,
            action='CANCEL',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status, 'reason': reason},
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'CANCEL', triggered_by=request.user)
        demand = recompute_linked_production_demand(order, user=request.user)
        response_data = {'status': order.status}
        if demand is not None:
            response_data['production_demand'] = ProductionDemandSerializer(demand).data
        return Response(response_data)

    @action(detail=True, methods=['post'])
    def update_operation(self, request, pk=None):
        order = self.get_object()
        if order.status not in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}:
            return Response({'error': 'Chỉ lệnh đã phát lệnh hoặc đang làm mới được cập nhật công đoạn.'}, status=status.HTTP_400_BAD_REQUEST)
        operation_id = request.data.get('operation_id')
        if not operation_id:
            return Response({'error': 'Thiếu operation_id.'}, status=status.HTTP_400_BAD_REQUEST)
        operation = order.operations.filter(pk=operation_id).first()
        if not operation:
            return Response({'error': 'Không tìm thấy công đoạn thuộc lệnh này.'}, status=status.HTTP_404_NOT_FOUND)

        next_status = request.data.get('status') or operation.status
        if next_status not in dict(ProductionOperationStatus.CHOICES):
            return Response({'error': 'Trạng thái công đoạn không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        if 'status' in request.data and next_status == ProductionOperationStatus.SKIPPED:
            return Response({'error': SKIP_OPERATION_REQUIRED_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
        completed_qty = request.data.get('completed_qty')
        scrap_qty = request.data.get('scrap_qty')
        try:
            completed_qty_value = Decimal(str(completed_qty)) if completed_qty not in (None, '') else None
            scrap_qty_value = Decimal(str(scrap_qty)) if scrap_qty not in (None, '') else None
        except (InvalidOperation, TypeError, ValueError):
            return Response({'error': 'Số lượng hoàn thành/phế phẩm không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        old_values = {
            'status': operation.status,
            'completed_qty': str(operation.completed_qty),
            'scrap_qty': str(operation.scrap_qty),
            'planned_date': operation.planned_date.isoformat() if operation.planned_date else None,
            'planned_shift': operation.planned_shift or '',
            'priority_rank': operation.priority_rank,
            'dispatch_sequence': operation.dispatch_sequence,
            'work_center_code': operation.work_center_code or '',
            'work_center_name': operation.work_center_name or '',
            'machine_code': operation.machine_code or '',
            'machine_name': operation.machine_name or '',
            'estimated_runtime_hours': str(operation.estimated_runtime_hours or 0),
            'setup_minutes': operation.setup_minutes,
            'block_reason_code': operation.block_reason_code or '',
            'block_reason_note': operation.block_reason_note or '',
            'note': operation.note or '',
        }
        try:
            planned_date = _parse_optional_date(request.data.get('planned_date'), field_label='planned_date') if 'planned_date' in request.data else operation.planned_date
            priority_rank_value = _parse_optional_int(request.data.get('priority_rank'), field_label='priority_rank') if 'priority_rank' in request.data else operation.priority_rank
            dispatch_sequence_value = _parse_optional_int(request.data.get('dispatch_sequence'), field_label='dispatch_sequence') if 'dispatch_sequence' in request.data else operation.dispatch_sequence
            estimated_runtime_hours_value = _parse_optional_decimal(request.data.get('estimated_runtime_hours'), field_label='estimated_runtime_hours') if 'estimated_runtime_hours' in request.data else Decimal(str(operation.estimated_runtime_hours or 0))
            setup_minutes_value = _parse_optional_int(request.data.get('setup_minutes'), field_label='setup_minutes') if 'setup_minutes' in request.data else operation.setup_minutes
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        if 'priority_rank' in request.data and priority_rank_value is None:
            priority_rank_value = 100
        if 'dispatch_sequence' in request.data and dispatch_sequence_value is None:
            dispatch_sequence_value = 100
        if 'estimated_runtime_hours' in request.data and estimated_runtime_hours_value is None:
            estimated_runtime_hours_value = Decimal('0')
        if 'setup_minutes' in request.data and setup_minutes_value is None:
            setup_minutes_value = 0

        planned_shift_value = operation.planned_shift
        if 'planned_shift' in request.data:
            planned_shift_value = str(request.data.get('planned_shift') or '').strip().upper()
            if planned_shift_value and planned_shift_value not in dict(ProductionPlanningShift.CHOICES):
                return Response({'error': 'Ca ke hoach khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        work_center_code_value = str(request.data.get('work_center_code') if 'work_center_code' in request.data else (operation.work_center_code or '')).strip().upper()
        work_center_name_value = str(request.data.get('work_center_name') if 'work_center_name' in request.data else (operation.work_center_name or '')).strip()
        machine_code_value = str(request.data.get('machine_code') if 'machine_code' in request.data else (operation.machine_code or '')).strip().upper()
        machine_name_value = str(request.data.get('machine_name') if 'machine_name' in request.data else (operation.machine_name or '')).strip()
        if machine_code_value and not work_center_code_value:
            return Response({'error': 'Can gan work center truoc khi chon may.'}, status=status.HTTP_400_BAD_REQUEST)

        block_reason_code_value = operation.block_reason_code
        if 'block_reason_code' in request.data:
            block_reason_code_value = str(request.data.get('block_reason_code') or '').strip().upper()
            if block_reason_code_value and block_reason_code_value not in dict(ProductionOperationBlockReason.CHOICES):
                return Response({'error': 'Ly do nghen khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)

        block_reason_note_value = operation.block_reason_note
        if 'block_reason_note' in request.data:
            block_reason_note_value = str(request.data.get('block_reason_note') or '').strip()

        if block_reason_note_value and len(block_reason_note_value) > 255:
            return Response({'error': 'Ghi chu nghen khong duoc vuot qua 255 ky tu.'}, status=status.HTTP_400_BAD_REQUEST)
        if block_reason_code_value == ProductionOperationBlockReason.OTHER and not block_reason_note_value:
            return Response({'error': 'Vui long mo ta ro ly do nghen khi chon Khac.'}, status=status.HTTP_400_BAD_REQUEST)
        if next_status in {ProductionOperationStatus.DONE, ProductionOperationStatus.SKIPPED} and block_reason_code_value:
            block_reason_code_value = ''
            block_reason_note_value = ''

        try:
            operation_rows = list(order.operations.all().order_by('sequence'))
            validate_operation_status_transition(operation, next_status, operations=operation_rows)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        update_operation_status(
            operation,
            status=next_status,
            completed_qty=completed_qty_value,
            scrap_qty=scrap_qty_value,
            note=(request.data.get('note') or operation.note or '').strip(),
        )
        planning_update_fields = []
        if operation.planned_date != planned_date:
            operation.planned_date = planned_date
            planning_update_fields.append('planned_date')
        if operation.planned_shift != planned_shift_value:
            operation.planned_shift = planned_shift_value
            planning_update_fields.append('planned_shift')
        if operation.priority_rank != priority_rank_value:
            operation.priority_rank = priority_rank_value
            planning_update_fields.append('priority_rank')
        if operation.dispatch_sequence != dispatch_sequence_value:
            operation.dispatch_sequence = dispatch_sequence_value
            planning_update_fields.append('dispatch_sequence')
        if operation.work_center_code != work_center_code_value:
            operation.work_center_code = work_center_code_value
            planning_update_fields.append('work_center_code')
        if operation.work_center_name != work_center_name_value:
            operation.work_center_name = work_center_name_value
            planning_update_fields.append('work_center_name')
        if operation.machine_code != machine_code_value:
            operation.machine_code = machine_code_value
            planning_update_fields.append('machine_code')
        if operation.machine_name != machine_name_value:
            operation.machine_name = machine_name_value
            planning_update_fields.append('machine_name')
        if operation.estimated_runtime_hours != estimated_runtime_hours_value:
            operation.estimated_runtime_hours = estimated_runtime_hours_value
            planning_update_fields.append('estimated_runtime_hours')
        if operation.setup_minutes != setup_minutes_value:
            operation.setup_minutes = setup_minutes_value
            planning_update_fields.append('setup_minutes')
        if operation.block_reason_code != block_reason_code_value:
            operation.block_reason_code = block_reason_code_value
            planning_update_fields.append('block_reason_code')
        if operation.block_reason_note != block_reason_note_value:
            operation.block_reason_note = block_reason_note_value
            planning_update_fields.append('block_reason_note')
        if planning_update_fields:
            planning_update_fields.append('updated_at')
            operation.save(update_fields=planning_update_fields)
        if next_status in {ProductionOperationStatus.DONE, ProductionOperationStatus.SKIPPED}:
            advance_ready_operations(order)
        sync_order_status_and_demand_counters(order, actor=request.user)
        if hasattr(order, '_prefetched_objects_cache'):
            order._prefetched_objects_cache = {}
        order.save(update_fields=['updated_at'])
        operation.refresh_from_db()
        operation.production_order = order
        snapshot = build_operation_planning_snapshot(operation, order=order)
        setattr(operation, '_planning_snapshot', snapshot)
        _log_production_audit(
            request,
            action='UPDATE',
            entity_type='ProductionOperation',
            entity_id=int(operation.id),
            entity_code=f'{order.code}-OP{operation.sequence}',
            old_values=old_values,
            new_values={
                'status': operation.status,
                'completed_qty': str(operation.completed_qty),
                'scrap_qty': str(operation.scrap_qty),
                'planned_date': operation.planned_date.isoformat() if operation.planned_date else None,
                'planned_shift': operation.planned_shift or '',
                'priority_rank': operation.priority_rank,
                'dispatch_sequence': operation.dispatch_sequence,
                'work_center_code': operation.work_center_code or '',
                'work_center_name': operation.work_center_name or '',
                'machine_code': operation.machine_code or '',
                'machine_name': operation.machine_name or '',
                'estimated_runtime_hours': str(operation.estimated_runtime_hours or 0),
                'setup_minutes': operation.setup_minutes,
                'block_reason_code': operation.block_reason_code or '',
                'block_reason_note': operation.block_reason_note or '',
                'note': operation.note or '',
                'risk_state': snapshot['risk_state'],
                'material_readiness': snapshot['material_readiness'],
                'dependency_state': snapshot['dependency_state'],
            },
        )
        return Response({
            'order_status': ProductionOrder.objects.get(pk=order.id).status,
            'operation': ProductionOperationSerializer(operation).data,
        })

    @action(detail=True, methods=['post'])
    def skip_operation(self, request, pk=None):
        if not _can_manage_production(request.user):
            return Response({'error': 'Khong co quyen bo qua cong doan san xuat.'}, status=status.HTTP_403_FORBIDDEN)
        order = self.get_object()
        if order.status not in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}:
            return Response({'error': 'Chi lenh da phat lenh hoac dang lam moi duoc bo qua cong doan.'}, status=status.HTTP_400_BAD_REQUEST)
        operation_id = request.data.get('operation_id')
        if not operation_id:
            return Response({'error': 'Thieu operation_id.'}, status=status.HTTP_400_BAD_REQUEST)
        reason = request.data.get('reason')

        with transaction.atomic():
            locked_order = ProductionOrder.objects.select_for_update().get(pk=order.pk)
            operation = locked_order.operations.select_for_update().filter(pk=operation_id).first()
            if not operation:
                return Response({'error': 'Khong tim thay cong doan thuoc lenh nay.'}, status=status.HTTP_404_NOT_FOUND)
            try:
                result = skip_production_operation(operation, request.user, reason)
            except ValueError as exc:
                return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        skipped_operation = result['operation']
        refreshed_order = result['order']
        refreshed_operations = list(refreshed_order.operations.all().order_by('sequence'))
        refreshed_requirements = list(refreshed_order.material_requirements.all())
        snapshot = build_operation_planning_snapshot(
            skipped_operation,
            order=refreshed_order,
            requirements=refreshed_requirements,
            operations=refreshed_operations,
            today=timezone.localdate(),
        )
        setattr(skipped_operation, '_planning_snapshot', snapshot)
        response_data = {
            'message': 'Da bo qua cong doan.',
            'order_status': refreshed_order.status,
            'operation': ProductionOperationSerializer(skipped_operation).data,
        }
        if result.get('production_demand') is not None:
            response_data['production_demand'] = ProductionDemandSerializer(result['production_demand']).data
        return Response(response_data)

    def _preview_change_items(self, change_items):
        order_ids = {item['order_id'] for item in change_items}
        order_queryset = self.filter_queryset(self.get_queryset()).filter(pk__in=order_ids)
        orders = {order.id: order for order in order_queryset}
        if len(orders) != len(order_ids):
            raise ValidationError({'error': 'Co lenh san xuat khong con ton tai hoac ban khong co quyen truy cap.'})

        grouped_items = {}
        for item in change_items:
            grouped_items.setdefault(item['order_id'], []).append(item)

        current_cards = []
        preview_cards = []
        operation_rows = []
        today = timezone.localdate()

        for order_id, items in grouped_items.items():
            order = orders[order_id]
            if order.status not in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}:
                raise ValidationError({'error': f'Lenh {order.code} chua o trang thai duoc phep mo phong cong doan.'})

            operations = list(order.operations.all().order_by('sequence'))
            requirements = list(order.material_requirements.all())
            operation_map = {operation.id: operation for operation in operations}
            preview_operations = []
            preview_by_id = {}

            for operation in operations:
                preview_operation = copy(operation)
                preview_operation.production_order = order
                preview_operations.append(preview_operation)
                preview_by_id[operation.id] = preview_operation

            for item in items:
                operation = operation_map.get(item['operation_id'])
                if not operation:
                    raise ValidationError({'error': f'Khong tim thay cong doan {item["operation_id"]} trong lenh {order.code}.'})
                values = _resolve_operation_update_inputs(item['changes'], operation=operation)
                try:
                    validate_operation_status_transition(operation, values['status'], operations=operations)
                except ValueError as exc:
                    raise ValidationError({'error': str(exc)}) from exc
                item['resolved_values'] = values
                _apply_operation_preview_values(preview_by_id[operation.id], values=values)

            for item in items:
                operation = operation_map[item['operation_id']]
                current_snapshot = build_operation_planning_snapshot(
                    operation,
                    order=order,
                    requirements=requirements,
                    operations=operations,
                    today=today,
                )
                current_card = _serialize_planning_card(order, operation, snapshot=current_snapshot, today=today)
                preview_snapshot = build_operation_planning_snapshot(
                    preview_by_id[item['operation_id']],
                    order=order,
                    requirements=requirements,
                    operations=preview_operations,
                    today=today,
                )
                preview_card = _serialize_planning_card(order, preview_by_id[item['operation_id']], snapshot=preview_snapshot, today=today)
                current_cards.append(current_card)
                preview_cards.append(preview_card)
                current_gap = current_card['exceptions'].get('delivery_gap_days')
                preview_gap = preview_card['exceptions'].get('delivery_gap_days')
                row = {
                    'order_id': order.id,
                    'order_code': order.code,
                    'operation_id': operation.id,
                    'current': current_card,
                    'preview': preview_card,
                    'impact': {
                        'bucket_changed': current_card['bucket']['key'] != preview_card['bucket']['key'],
                        'risk_changed': current_card['exceptions']['risk_state'] != preview_card['exceptions']['risk_state'],
                        'ready_to_run_changed': bool(current_card['materials']['ready_to_run']) != bool(preview_card['materials']['ready_to_run']),
                        'needs_attention_changed': bool(current_card['exceptions']['needs_attention']) != bool(preview_card['exceptions']['needs_attention']),
                        'delivery_gap_delta': (
                            preview_gap - current_gap
                            if current_gap is not None and preview_gap is not None
                            else None
                        ),
                        'handover_status_changed': current_card['shop_floor']['handover_status'] != preview_card['shop_floor']['handover_status'],
                    },
                }
                meta = item.get('meta') or {}
                if any(meta.get(key) for key in ('suggestion_key', 'suggestion_kind', 'suggestion_title', 'severity')):
                    row['scenario'] = {
                        'suggestion_key': meta.get('suggestion_key') or '',
                        'suggestion_kind': meta.get('suggestion_kind') or '',
                        'suggestion_title': meta.get('suggestion_title') or '',
                        'severity': meta.get('severity') or '',
                    }
                operation_rows.append(row)

        _annotate_capacity_context(current_cards)
        preview_capacity_context = _annotate_capacity_context(preview_cards)
        for item in operation_rows:
            current_ratio = item['current']['capacity'].get('work_center_load_ratio')
            preview_ratio = item['preview']['capacity'].get('work_center_load_ratio')
            item['impact']['capacity_state_changed'] = item['current']['capacity']['capacity_state'] != item['preview']['capacity']['capacity_state']
            item['impact']['work_center_changed'] = item['current']['capacity']['work_center_code'] != item['preview']['capacity']['work_center_code']
            item['impact']['machine_changed'] = item['current']['capacity']['machine_code'] != item['preview']['capacity']['machine_code']
            item['impact']['work_center_load_ratio_delta'] = (
                float(preview_ratio) - float(current_ratio)
                if current_ratio is not None and preview_ratio is not None
                else None
            )

        current_summary = _summarize_preview_rows(current_cards)
        preview_summary = _summarize_preview_rows(preview_cards)
        operation_rows = sorted(
            operation_rows,
            key=lambda item: (
                0 if item['impact']['risk_changed'] else 1,
                0 if item['impact']['bucket_changed'] else 1,
                item['preview']['operation'].get('planned_date') or '9999-12-31',
                item['preview']['operation'].get('priority_rank') or 99999,
            ),
        )
        machine_queue_highlights = sorted(
            preview_capacity_context['machine_queues'],
            key=lambda queue: (
                0 if queue.get('overloaded') else 1,
                -(Decimal(str(queue.get('load_ratio') or 0))),
                queue.get('planned_date') or '9999-12-31',
                queue.get('sort_order') or 99999,
            ),
        )[:6]
        return {
            'current_summary': current_summary,
            'preview_summary': preview_summary,
            'summary_delta': {
                'ready_to_run_delta': preview_summary['ready_to_run_count'] - current_summary['ready_to_run_count'],
                'needs_attention_delta': preview_summary['needs_attention_count'] - current_summary['needs_attention_count'],
                'over_capacity_delta': preview_summary['over_capacity_count'] - current_summary['over_capacity_count'],
                'at_limit_delta': preview_summary['at_limit_count'] - current_summary['at_limit_count'],
                'negative_delivery_gap_delta': preview_summary['negative_delivery_gap_count'] - current_summary['negative_delivery_gap_count'],
                'total_scheduled_hours_delta': str(
                    Decimal(str(preview_summary['total_scheduled_hours']))
                    - Decimal(str(current_summary['total_scheduled_hours']))
                ),
                'machine_down_delta': preview_summary['machine_down_count'] - current_summary['machine_down_count'],
            },
            'operations': operation_rows,
            'capacity_windows': _build_preview_capacity_windows(preview_cards),
            'machine_queue_highlights': machine_queue_highlights,
        }

    def _apply_change_items(self, request, change_items, *, batch_context_key, order_error_label='cap nhat cong doan'):
        order_ids = {item['order_id'] for item in change_items}
        order_queryset = self.filter_queryset(self.get_queryset()).filter(pk__in=order_ids)
        orders = {order.id: order for order in order_queryset}
        if len(orders) != len(order_ids):
            raise ValidationError({'error': 'Co lenh san xuat khong con ton tai hoac ban khong co quyen truy cap.'})

        targets = []
        for item in change_items:
            order = orders[item['order_id']]
            if order.status not in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}:
                raise ValidationError({'error': f'Lenh {order.code} chua o trang thai duoc phep {order_error_label}.'})
            operation = order.operations.filter(pk=item['operation_id']).first()
            if not operation:
                raise ValidationError({'error': f'Khong tim thay cong doan {item["operation_id"]} trong lenh {order.code}.'})
            values = _resolve_operation_update_inputs(item['changes'], operation=operation)
            try:
                operation_rows = list(order.operations.all().order_by('sequence'))
                validate_operation_status_transition(operation, values['status'], operations=operation_rows)
            except ValueError as exc:
                raise ValidationError({'error': str(exc)}) from exc
            targets.append({
                'order': order,
                'operation': operation,
                'values': values,
                'meta': item.get('meta') or {},
            })

        updated_by_order = {}
        batch_size = len(targets)
        with transaction.atomic():
            for target in targets:
                order = target['order']
                operation = target['operation']
                values = target['values']
                old_values = {
                    'status': operation.status,
                    'completed_qty': str(operation.completed_qty),
                    'scrap_qty': str(operation.scrap_qty),
                    'planned_date': operation.planned_date.isoformat() if operation.planned_date else None,
                    'planned_shift': operation.planned_shift or '',
                    'priority_rank': operation.priority_rank,
                    'dispatch_sequence': operation.dispatch_sequence,
                    'work_center_code': operation.work_center_code or '',
                    'work_center_name': operation.work_center_name or '',
                    'machine_code': operation.machine_code or '',
                    'machine_name': operation.machine_name or '',
                    'estimated_runtime_hours': str(operation.estimated_runtime_hours or 0),
                    'setup_minutes': operation.setup_minutes,
                    'block_reason_code': operation.block_reason_code or '',
                    'block_reason_note': operation.block_reason_note or '',
                    'note': operation.note or '',
                }

                update_operation_status(
                    operation,
                    status=values['status'],
                    completed_qty=values['completed_qty'],
                    scrap_qty=values['scrap_qty'],
                    note=values['note'],
                )
                planning_update_fields = []
                if operation.planned_date != values['planned_date']:
                    operation.planned_date = values['planned_date']
                    planning_update_fields.append('planned_date')
                if operation.planned_shift != values['planned_shift']:
                    operation.planned_shift = values['planned_shift']
                    planning_update_fields.append('planned_shift')
                if operation.priority_rank != values['priority_rank']:
                    operation.priority_rank = values['priority_rank']
                    planning_update_fields.append('priority_rank')
                if operation.dispatch_sequence != values['dispatch_sequence']:
                    operation.dispatch_sequence = values['dispatch_sequence']
                    planning_update_fields.append('dispatch_sequence')
                if operation.work_center_code != values['work_center_code']:
                    operation.work_center_code = values['work_center_code']
                    planning_update_fields.append('work_center_code')
                if operation.work_center_name != values['work_center_name']:
                    operation.work_center_name = values['work_center_name']
                    planning_update_fields.append('work_center_name')
                if operation.machine_code != values['machine_code']:
                    operation.machine_code = values['machine_code']
                    planning_update_fields.append('machine_code')
                if operation.machine_name != values['machine_name']:
                    operation.machine_name = values['machine_name']
                    planning_update_fields.append('machine_name')
                if operation.estimated_runtime_hours != values['estimated_runtime_hours']:
                    operation.estimated_runtime_hours = values['estimated_runtime_hours']
                    planning_update_fields.append('estimated_runtime_hours')
                if operation.setup_minutes != values['setup_minutes']:
                    operation.setup_minutes = values['setup_minutes']
                    planning_update_fields.append('setup_minutes')
                if operation.block_reason_code != values['block_reason_code']:
                    operation.block_reason_code = values['block_reason_code']
                    planning_update_fields.append('block_reason_code')
                if operation.block_reason_note != values['block_reason_note']:
                    operation.block_reason_note = values['block_reason_note']
                    planning_update_fields.append('block_reason_note')
                if planning_update_fields:
                    planning_update_fields.append('updated_at')
                    operation.save(update_fields=planning_update_fields)
                updated_by_order.setdefault(order.id, []).append({
                    'old_values': old_values,
                    'operation_id': operation.id,
                    'meta': target['meta'],
                })

            response_rows = []
            for order_id, rows in updated_by_order.items():
                order = orders[order_id]
                advance_ready_operations(order)
                sync_order_status_and_demand_counters(order, actor=request.user)
                if hasattr(order, '_prefetched_objects_cache'):
                    order._prefetched_objects_cache = {}
                order.save(update_fields=['updated_at'])
                refreshed_order = ProductionOrder.objects.get(pk=order_id)
                refreshed_operations = list(refreshed_order.operations.all().order_by('sequence'))
                refreshed_requirements = list(refreshed_order.material_requirements.all())
                refreshed_map = {candidate.id: candidate for candidate in refreshed_operations}
                for row in rows:
                    refreshed_operation = refreshed_map[row['operation_id']]
                    refreshed_operation.production_order = refreshed_order
                    snapshot = build_operation_planning_snapshot(
                        refreshed_operation,
                        order=refreshed_order,
                        requirements=refreshed_requirements,
                        operations=refreshed_operations,
                        today=timezone.localdate(),
                    )
                    setattr(refreshed_operation, '_planning_snapshot', snapshot)
                    new_values = {
                        'status': refreshed_operation.status,
                        'completed_qty': str(refreshed_operation.completed_qty),
                        'scrap_qty': str(refreshed_operation.scrap_qty),
                        'planned_date': refreshed_operation.planned_date.isoformat() if refreshed_operation.planned_date else None,
                        'planned_shift': refreshed_operation.planned_shift or '',
                        'priority_rank': refreshed_operation.priority_rank,
                        'dispatch_sequence': refreshed_operation.dispatch_sequence,
                        'work_center_code': refreshed_operation.work_center_code or '',
                        'work_center_name': refreshed_operation.work_center_name or '',
                        'machine_code': refreshed_operation.machine_code or '',
                        'machine_name': refreshed_operation.machine_name or '',
                        'estimated_runtime_hours': str(refreshed_operation.estimated_runtime_hours or 0),
                        'setup_minutes': refreshed_operation.setup_minutes,
                        'block_reason_code': refreshed_operation.block_reason_code or '',
                        'block_reason_note': refreshed_operation.block_reason_note or '',
                        'note': refreshed_operation.note or '',
                        'risk_state': snapshot['risk_state'],
                        'material_readiness': snapshot['material_readiness'],
                        'dependency_state': snapshot['dependency_state'],
                        batch_context_key: batch_size,
                    }
                    meta = row.get('meta') or {}
                    if meta.get('suggestion_key'):
                        new_values['suggestion_key'] = meta['suggestion_key']
                    if meta.get('suggestion_kind'):
                        new_values['suggestion_kind'] = meta['suggestion_kind']
                    if meta.get('suggestion_title'):
                        new_values['suggestion_title'] = meta['suggestion_title']
                    _log_production_audit(
                        request,
                        action='UPDATE',
                        entity_type='ProductionOperation',
                        entity_id=int(refreshed_operation.id),
                        entity_code=f'{refreshed_order.code}-OP{refreshed_operation.sequence}',
                        old_values=row['old_values'],
                        new_values=new_values,
                    )
                    response_row = {
                        'order_id': refreshed_order.id,
                        'order_code': refreshed_order.code,
                        'operation': ProductionOperationSerializer(refreshed_operation).data,
                    }
                    if any(meta.get(key) for key in ('suggestion_key', 'suggestion_kind', 'suggestion_title', 'severity')):
                        response_row['scenario'] = {
                            'suggestion_key': meta.get('suggestion_key') or '',
                            'suggestion_kind': meta.get('suggestion_kind') or '',
                            'suggestion_title': meta.get('suggestion_title') or '',
                            'severity': meta.get('severity') or '',
                        }
                    response_rows.append(response_row)

        return {
            'updated_count': len(response_rows),
            'order_ids': sorted(updated_by_order.keys()),
            'operations': response_rows,
        }

    @action(detail=True, methods=['post'])
    def preview_operation_update(self, request, pk=None):
        order = self.get_object()
        operation_id = request.data.get('operation_id')
        if not operation_id:
            return Response({'error': 'Thieu operation_id.'}, status=status.HTTP_400_BAD_REQUEST)
        operation = order.operations.filter(pk=operation_id).first()
        if not operation:
            return Response({'error': 'Khong tim thay cong doan thuoc lenh nay.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            values = _resolve_operation_update_inputs(request.data, operation=operation)
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)

        today = timezone.localdate()
        requirements = list(order.material_requirements.all())
        operations = list(order.operations.all().order_by('sequence'))
        try:
            validate_operation_status_transition(operation, values['status'], operations=operations)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        current_snapshot = build_operation_planning_snapshot(
            operation,
            order=order,
            requirements=requirements,
            operations=operations,
            today=today,
        )
        current_card = _serialize_planning_card(order, operation, snapshot=current_snapshot, today=today)
        _annotate_capacity_context([current_card])

        preview_operation = ProductionOperation.objects.get(pk=operation.pk)
        preview_operation.production_order = order
        _apply_operation_preview_values(preview_operation, values=values)
        preview_operations = [
            preview_operation if int(candidate.id) == int(operation.id) else candidate
            for candidate in operations
        ]
        preview_snapshot = build_operation_planning_snapshot(
            preview_operation,
            order=order,
            requirements=requirements,
            operations=preview_operations,
            today=today,
        )
        preview_card = _serialize_planning_card(order, preview_operation, snapshot=preview_snapshot, today=today)
        _annotate_capacity_context([preview_card])
        current_days = current_card['exceptions'].get('days_to_delivery')
        preview_days = preview_card['exceptions'].get('days_to_delivery')
        current_delivery_gap = current_card['exceptions'].get('delivery_gap_days')
        preview_delivery_gap = preview_card['exceptions'].get('delivery_gap_days')
        return Response({
            'current': current_card,
            'preview': preview_card,
            'impact': {
                'bucket_changed': current_card['bucket']['key'] != preview_card['bucket']['key'],
                'risk_changed': current_card['exceptions']['risk_state'] != preview_card['exceptions']['risk_state'],
                'ready_to_run_changed': bool(current_card['materials']['ready_to_run']) != bool(preview_card['materials']['ready_to_run']),
                'needs_attention_changed': bool(current_card['exceptions']['needs_attention']) != bool(preview_card['exceptions']['needs_attention']),
                'days_to_delivery_delta': (
                    preview_days - current_days
                    if current_days is not None and preview_days is not None
                    else None
                ),
                'delivery_gap_delta': (
                    preview_delivery_gap - current_delivery_gap
                    if current_delivery_gap is not None and preview_delivery_gap is not None
                    else None
                ),
                'handover_status_changed': current_card['shop_floor']['handover_status'] != preview_card['shop_floor']['handover_status'],
                'capacity_state_changed': current_card['capacity']['capacity_state'] != preview_card['capacity']['capacity_state'],
                'work_center_changed': current_card['capacity']['work_center_code'] != preview_card['capacity']['work_center_code'],
                'machine_changed': current_card['capacity']['machine_code'] != preview_card['capacity']['machine_code'],
                'work_center_load_ratio_delta': (
                    float(preview_card['capacity']['work_center_load_ratio']) - float(current_card['capacity']['work_center_load_ratio'])
                    if current_card['capacity'].get('work_center_load_ratio') is not None and preview_card['capacity'].get('work_center_load_ratio') is not None
                    else None
                ),
            },
        })

    @action(detail=False, methods=['post'])
    def preview_bulk_update_operations(self, request):
        items = request.data.get('items')
        changes = request.data.get('changes') or {}
        if not isinstance(changes, dict):
            return Response({'error': 'changes khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)

        allowed_fields = {
            'status',
            'completed_qty',
            'scrap_qty',
            'planned_date',
            'planned_shift',
            'priority_rank',
            'dispatch_sequence',
            'work_center_code',
            'work_center_name',
            'machine_code',
            'machine_name',
            'estimated_runtime_hours',
            'setup_minutes',
            'block_reason_code',
            'block_reason_note',
            'note',
        }
        if not any(field in changes for field in allowed_fields):
            return Response({'error': 'Chua co thay doi nao de mo phong hang loat.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            normalized_pairs, _order_ids = _normalize_operation_pairs(
                items,
                required_message='Can chon it nhat mot cong doan de mo phong hang loat.',
            )
            preview_data = self._preview_change_items([
                {
                    'order_id': order_id,
                    'operation_id': operation_id,
                    'changes': changes,
                    'meta': {},
                }
                for order_id, operation_id in normalized_pairs
            ])
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        return Response(preview_data)

    @action(detail=False, methods=['post'])
    def preview_rebalance_suggestions(self, request):
        try:
            change_items, _order_ids = _normalize_operation_change_items(
                request.data.get('items'),
                required_message='Can chon it nhat mot goi y rebalance de mo phong.',
                change_key='suggested_changes',
            )
            preview_data = self._preview_change_items(change_items)
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        return Response(preview_data)

    @action(detail=False, methods=['post'])
    def bulk_update_operations(self, request):
        items = request.data.get('items')
        changes = request.data.get('changes') or {}
        if not isinstance(items, list) or not items:
            return Response({'error': 'Can chon it nhat mot cong doan de cap nhat hang loat.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(items) > 50:
            return Response({'error': 'Chi duoc cap nhat toi da 50 cong doan trong mot lan.'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(changes, dict):
            return Response({'error': 'changes khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)

        allowed_fields = {
            'status',
            'completed_qty',
            'scrap_qty',
            'planned_date',
            'planned_shift',
            'priority_rank',
            'dispatch_sequence',
            'work_center_code',
            'work_center_name',
            'machine_code',
            'machine_name',
            'estimated_runtime_hours',
            'setup_minutes',
            'block_reason_code',
            'block_reason_note',
            'note',
        }
        if not any(field in changes for field in allowed_fields):
            return Response({'error': 'Chua co thay doi nao de ap dung hang loat.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            normalized_pairs, _order_ids = _normalize_operation_pairs(
                items,
                required_message='Can chon it nhat mot cong doan de cap nhat hang loat.',
            )
            response_data = self._apply_change_items(
                request,
                [
                    {
                        'order_id': order_id,
                        'operation_id': operation_id,
                        'changes': changes,
                        'meta': {},
                    }
                    for order_id, operation_id in normalized_pairs
                ],
                batch_context_key='bulk_batch_size',
                order_error_label='cap nhat cong doan hang loat',
            )
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        return Response(response_data)

    @action(detail=False, methods=['post'])
    def apply_rebalance_suggestions(self, request):
        try:
            change_items, _order_ids = _normalize_operation_change_items(
                request.data.get('items'),
                required_message='Can chon it nhat mot goi y rebalance de ap dung.',
                change_key='suggested_changes',
            )
            response_data = self._apply_change_items(
                request,
                change_items,
                batch_context_key='scenario_batch_size',
                order_error_label='ap dung goi y rebalance',
            )
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)
        return Response(response_data)

    @action(detail=False, methods=['post'])
    def shop_floor_signal(self, request):
        signal_code = str(request.data.get('signal_code') or '').strip().upper()
        dispatch_owner = str(request.data.get('dispatch_owner') or '').strip()
        note = str(request.data.get('note') or '').strip()
        status_override = str(request.data.get('status') or '').strip().upper()
        handover_status = str(request.data.get('handover_status') or '').strip().upper()
        if not signal_code:
            return Response({'error': 'Thiếu signal_code.'}, status=status.HTTP_400_BAD_REQUEST)
        if note and len(note) > 255:
            return Response({'error': 'Ghi chu floor khong duoc vuot qua 255 ky tu.'}, status=status.HTTP_400_BAD_REQUEST)
        if status_override and status_override not in dict(ProductionOperationStatus.CHOICES):
            return Response({'error': 'Trang thai cong doan khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        if status_override == ProductionOperationStatus.SKIPPED:
            return Response({'error': SKIP_OPERATION_REQUIRED_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
        if handover_status and handover_status not in dict(ProductionOperationHandoverStatus.CHOICES):
            return Response({'error': 'Trang thai handover khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)

        resolved_signal_code = '' if signal_code in {'CLEAR', 'CLEAR_TO_RUN', 'READY'} else signal_code
        if resolved_signal_code and resolved_signal_code not in dict(ProductionOperationBlockReason.CHOICES):
            return Response({'error': 'signal_code khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        if not status_override and signal_code in {'CLEAR_TO_RUN', 'READY'}:
            status_override = ProductionOperationStatus.READY

        try:
            normalized_pairs, order_ids = _normalize_operation_pairs(
                request.data.get('items'),
                required_message='Can chon it nhat mot cong doan de gui tin hieu floor.',
            )
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)

        order_queryset = self.filter_queryset(self.get_queryset()).filter(pk__in=order_ids)
        orders = {order.id: order for order in order_queryset}
        if len(orders) != len(order_ids):
            return Response({'error': 'Co lenh san xuat khong con ton tai hoac ban khong co quyen truy cap.'}, status=status.HTTP_404_NOT_FOUND)

        updated_rows = []
        with transaction.atomic():
            touched_orders = set()
            for order_id, operation_id in normalized_pairs:
                order = orders[order_id]
                if order.status not in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}:
                    return Response(
                        {'error': f'Lenh {order.code} chua o trang thai duoc phep nhan tin hieu floor.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                operation = order.operations.select_for_update().filter(pk=operation_id).first()
                if not operation:
                    return Response({'error': f'Khong tim thay cong doan {operation_id} trong lenh {order.code}.'}, status=status.HTTP_404_NOT_FOUND)

                old_values = {
                    'status': operation.status,
                    'block_reason_code': operation.block_reason_code or '',
                    'block_reason_note': operation.block_reason_note or '',
                    'dispatch_owner': operation.dispatch_owner or '',
                    'handover_status': operation.handover_status or '',
                    'handover_note': operation.handover_note or '',
                }

                if status_override:
                    try:
                        operation_rows = list(order.operations.all().order_by('sequence'))
                        validate_operation_status_transition(operation, status_override, operations=operation_rows)
                    except ValueError as exc:
                        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                    update_operation_status(
                        operation,
                        status=status_override,
                        completed_qty=None,
                        scrap_qty=None,
                        note=operation.note or '',
                    )
                    if status_override in {ProductionOperationStatus.DONE, ProductionOperationStatus.SKIPPED}:
                        advance_ready_operations(order)
                update_fields = []
                if operation.block_reason_code != resolved_signal_code:
                    operation.block_reason_code = resolved_signal_code
                    update_fields.append('block_reason_code')
                next_note = note if resolved_signal_code else ''
                if operation.block_reason_note != next_note:
                    operation.block_reason_note = next_note
                    update_fields.append('block_reason_note')
                if dispatch_owner and operation.dispatch_owner != dispatch_owner:
                    operation.dispatch_owner = dispatch_owner
                    update_fields.append('dispatch_owner')
                next_handover_status = handover_status or operation.handover_status or ProductionOperationHandoverStatus.ACTIVE
                if operation.handover_status != next_handover_status:
                    operation.handover_status = next_handover_status
                    update_fields.append('handover_status')
                if note and operation.handover_note != note:
                    operation.handover_note = note
                    update_fields.append('handover_note')
                if update_fields:
                    operation.handover_at = timezone.now()
                    update_fields.extend(['handover_at', 'updated_at'])
                    operation.save(update_fields=update_fields)

                sync_order_status_and_demand_counters(order, actor=request.user)
                touched_orders.add(order.id)
                refreshed_order = ProductionOrder.objects.get(pk=order.id)
                refreshed_operation = refreshed_order.operations.get(pk=operation.id)
                refreshed_operations = list(refreshed_order.operations.all().order_by('sequence'))
                refreshed_requirements = list(refreshed_order.material_requirements.all())
                snapshot = build_operation_planning_snapshot(
                    refreshed_operation,
                    order=refreshed_order,
                    requirements=refreshed_requirements,
                    operations=refreshed_operations,
                    today=timezone.localdate(),
                )
                setattr(refreshed_operation, '_planning_snapshot', snapshot)
                _log_production_audit(
                    request,
                    action='SIGNAL',
                    entity_type='ProductionOperation',
                    entity_id=int(refreshed_operation.id),
                    entity_code=f'{refreshed_order.code}-OP{refreshed_operation.sequence}',
                    old_values=old_values,
                    new_values={
                        'status': refreshed_operation.status,
                        'block_reason_code': refreshed_operation.block_reason_code or '',
                        'block_reason_note': refreshed_operation.block_reason_note or '',
                        'dispatch_owner': refreshed_operation.dispatch_owner or '',
                        'handover_status': refreshed_operation.handover_status or '',
                        'handover_note': refreshed_operation.handover_note or '',
                        'signal_code': signal_code,
                    },
                )
                updated_rows.append({
                    'order_id': refreshed_order.id,
                    'order_code': refreshed_order.code,
                    'operation': ProductionOperationSerializer(refreshed_operation).data,
                })

            for order_id in touched_orders:
                orders[order_id].save(update_fields=['updated_at'])

        return Response({
            'updated_count': len(updated_rows),
            'order_ids': sorted(order_ids),
            'operations': updated_rows,
        })

    @action(detail=False, methods=['post'])
    def shop_floor_handover(self, request):
        handover_status = str(request.data.get('handover_status') or '').strip().upper()
        dispatch_owner = str(request.data.get('dispatch_owner') or '').strip()
        handover_receiver = str(request.data.get('handover_receiver') or '').strip()
        handover_note = str(request.data.get('handover_note') or '').strip()
        clear_previous_wait = str(request.data.get('clear_previous_wait') or '').strip().lower() in {'1', 'true', 'yes'}
        set_ready = str(request.data.get('set_ready') or '').strip().lower() in {'1', 'true', 'yes'}
        if handover_status not in dict(ProductionOperationHandoverStatus.CHOICES):
            return Response({'error': 'handover_status khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        if handover_note and len(handover_note) > 255:
            return Response({'error': 'Ghi chu handover khong duoc vuot qua 255 ky tu.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            normalized_pairs, order_ids = _normalize_operation_pairs(
                request.data.get('items'),
                required_message='Can chon it nhat mot cong doan de chot handover.',
            )
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)

        order_queryset = self.filter_queryset(self.get_queryset()).filter(pk__in=order_ids)
        orders = {order.id: order for order in order_queryset}
        if len(orders) != len(order_ids):
            return Response({'error': 'Co lenh san xuat khong con ton tai hoac ban khong co quyen truy cap.'}, status=status.HTTP_404_NOT_FOUND)

        updated_rows = []
        with transaction.atomic():
            touched_orders = set()
            timestamp = timezone.now()
            for order_id, operation_id in normalized_pairs:
                order = orders[order_id]
                if order.status not in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}:
                    return Response(
                        {'error': f'Lenh {order.code} chua o trang thai duoc phep chot handover.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                operation = order.operations.select_for_update().filter(pk=operation_id).first()
                if not operation:
                    return Response({'error': f'Khong tim thay cong doan {operation_id} trong lenh {order.code}.'}, status=status.HTTP_404_NOT_FOUND)

                old_values = {
                    'status': operation.status,
                    'block_reason_code': operation.block_reason_code or '',
                    'block_reason_note': operation.block_reason_note or '',
                    'dispatch_owner': operation.dispatch_owner or '',
                    'handover_status': operation.handover_status or '',
                    'handover_receiver': operation.handover_receiver or '',
                    'handover_note': operation.handover_note or '',
                }

                if set_ready and operation.status == ProductionOperationStatus.PENDING:
                    try:
                        operation_rows = list(order.operations.all().order_by('sequence'))
                        validate_operation_status_transition(operation, ProductionOperationStatus.READY, operations=operation_rows)
                    except ValueError as exc:
                        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                    update_operation_status(
                        operation,
                        status=ProductionOperationStatus.READY,
                        completed_qty=None,
                        scrap_qty=None,
                        note=operation.note or '',
                    )

                update_fields = []
                if dispatch_owner and operation.dispatch_owner != dispatch_owner:
                    operation.dispatch_owner = dispatch_owner
                    update_fields.append('dispatch_owner')
                if operation.handover_status != handover_status:
                    operation.handover_status = handover_status
                    update_fields.append('handover_status')
                if handover_receiver and operation.handover_receiver != handover_receiver:
                    operation.handover_receiver = handover_receiver
                    update_fields.append('handover_receiver')
                if operation.handover_note != handover_note:
                    operation.handover_note = handover_note
                    update_fields.append('handover_note')
                if clear_previous_wait and operation.block_reason_code == ProductionOperationBlockReason.WAIT_PREVIOUS_STEP:
                    operation.block_reason_code = ''
                    operation.block_reason_note = ''
                    update_fields.extend(['block_reason_code', 'block_reason_note'])
                operation.handover_at = timestamp
                update_fields.extend(['handover_at', 'updated_at'])
                operation.save(update_fields=list(dict.fromkeys(update_fields)))

                sync_order_status_and_demand_counters(order, actor=request.user)
                touched_orders.add(order.id)
                refreshed_order = ProductionOrder.objects.get(pk=order.id)
                refreshed_operation = refreshed_order.operations.get(pk=operation.id)
                refreshed_operations = list(refreshed_order.operations.all().order_by('sequence'))
                refreshed_requirements = list(refreshed_order.material_requirements.all())
                snapshot = build_operation_planning_snapshot(
                    refreshed_operation,
                    order=refreshed_order,
                    requirements=refreshed_requirements,
                    operations=refreshed_operations,
                    today=timezone.localdate(),
                )
                setattr(refreshed_operation, '_planning_snapshot', snapshot)
                _log_production_audit(
                    request,
                    action='HANDOVER',
                    entity_type='ProductionOperation',
                    entity_id=int(refreshed_operation.id),
                    entity_code=f'{refreshed_order.code}-OP{refreshed_operation.sequence}',
                    old_values=old_values,
                    new_values={
                        'status': refreshed_operation.status,
                        'block_reason_code': refreshed_operation.block_reason_code or '',
                        'dispatch_owner': refreshed_operation.dispatch_owner or '',
                        'handover_status': refreshed_operation.handover_status or '',
                        'handover_receiver': refreshed_operation.handover_receiver or '',
                        'handover_note': refreshed_operation.handover_note or '',
                        'handover_at': refreshed_operation.handover_at.isoformat() if refreshed_operation.handover_at else None,
                    },
                )
                updated_rows.append({
                    'order_id': refreshed_order.id,
                    'order_code': refreshed_order.code,
                    'operation': ProductionOperationSerializer(refreshed_operation).data,
                })

            for order_id in touched_orders:
                orders[order_id].save(update_fields=['updated_at'])

        return Response({
            'updated_count': len(updated_rows),
            'order_ids': sorted(order_ids),
            'operations': updated_rows,
        })

    @action(detail=True, methods=['post'])
    def issue_materials(self, request, pk=None):
        order = self.get_object()
        if not can_issue_materials(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)

        raw_items = request.data.get('items')
        if not isinstance(raw_items, list):
            raw_items = [request.data] if request.data.get('material_requirement') else []

        issue_date_raw = request.data.get('issue_date') or timezone.localdate().isoformat()
        try:
            issue_date_value = date.fromisoformat(str(issue_date_raw))
        except (TypeError, ValueError):
            return Response({'error': 'Ngày cấp vật tư không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        reference = str(request.data.get('reference') or order.code or '').strip()
        reason = str(request.data.get('reason') or 'Cấp vật tư cho sản xuất').strip()
        note = str(request.data.get('note') or '').strip()

        from inventory.serializers import InventoryTransactionSerializer

        with transaction.atomic():
            order_locked = ProductionOrder.objects.select_for_update().get(pk=order.pk)
            if order_locked.status not in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}:
                raise ValidationError({'error': 'Lệnh sản xuất hiện không thể cấp vật tư thêm.'})
            requirement_map = {
                item.id: item
                for item in ProductionMaterialRequirement.objects.select_for_update()
                .filter(production_order=order_locked)
                .select_related('material_product')
            }
            if not raw_items:
                raw_items = [
                    {
                        'material_requirement': requirement.id,
                        'quantity': str(requirement.remaining_issue_qty),
                        'warehouse': requirement.source_warehouse_id,
                        'location': requirement.source_location_id,
                        'unit_cost': str((requirement.product_snapshot or {}).get('cost_price') or 0),
                    }
                    for requirement in requirement_map.values()
                    if requirement.remaining_issue_qty > 0 and requirement.source_warehouse_id
                ]
            if not raw_items:
                raise ValidationError({'error': 'Không có vật tư khả dụng để cấp phát.'})

            issue = ProductionIssue.objects.create(
                code=get_next_production_issue_code(issue_date_value),
                production_order=order_locked,
                issue_date=issue_date_value,
                reference=reference,
                note=note,
                posted_by=request.user,
                created_by=request.user,
                updated_by=request.user,
            )
            seen_requirement_ids = set()
            for index, item in enumerate(raw_items, start=1):
                requirement_id = item.get('material_requirement')
                if not requirement_id:
                    raise ValidationError({'error': f'Dòng {index}: thiếu material_requirement.'})
                try:
                    requirement_id = int(requirement_id)
                except (TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: material_requirement không hợp lệ.'})
                if requirement_id in seen_requirement_ids:
                    raise ValidationError({'error': f'Dòng {index}: material_requirement bị lặp trong cùng chứng từ.'})
                seen_requirement_ids.add(requirement_id)
                requirement = requirement_map.get(requirement_id)
                if not requirement:
                    raise ValidationError({'error': f'Dòng {index}: yêu cầu vật tư không tồn tại.'})
                try:
                    quantity = Decimal(str(item.get('quantity') or requirement.remaining_issue_qty))
                except (InvalidOperation, TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: quantity không hợp lệ.'})
                if quantity <= 0:
                    raise ValidationError({'error': f'Dòng {index}: quantity phải > 0.'})
                if quantity > requirement.remaining_issue_qty:
                    raise ValidationError({'error': f'Dòng {index}: chỉ còn {requirement.remaining_issue_qty} để cấp, yêu cầu={quantity}.'})
                warehouse_id = item.get('warehouse') or requirement.source_warehouse_id
                location_id = item.get('location') or requirement.source_location_id
                if not warehouse_id:
                    raise ValidationError({'error': f'Dòng {index}: thiếu kho xuất vật tư.'})
                try:
                    unit_cost = Decimal(str(item.get('unit_cost') or (requirement.product_snapshot or {}).get('cost_price') or 0))
                except (InvalidOperation, TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: unit_cost không hợp lệ.'})

                serializer = InventoryTransactionSerializer(data={
                    'transaction_type': 'ISSUE',
                    'transaction_date': item.get('issue_date') or issue_date_raw,
                    'product': requirement.material_product_id,
                    'warehouse': warehouse_id,
                    'location': location_id,
                    'quantity': str(quantity),
                    'unit_cost': str(unit_cost),
                    'reference': str(item.get('reference') or reference).strip(),
                    'reason': str(item.get('reason') or reason).strip(),
                    'note': str(item.get('note') or '').strip(),
                })
                serializer.is_valid(raise_exception=True)
                inventory_tx = serializer.save(
                    created_by=request.user,
                    updated_by=request.user,
                    posted_by=request.user,
                    production_order=order_locked,
                    production_issue=issue,
                )
                ProductionIssueLine.objects.create(
                    issue=issue,
                    line_number=index,
                    material_requirement=requirement,
                    material_product=requirement.material_product,
                    product_snapshot=requirement.product_snapshot or build_material_product_snapshot(requirement.material_product),
                    warehouse_id=warehouse_id,
                    location_id=location_id,
                    quantity=quantity,
                    unit_cost=unit_cost,
                    note=str(item.get('note') or requirement.note or '').strip(),
                    inventory_transaction=inventory_tx,
                )
                add_issued_qty(requirement, quantity)
            issue.recalc_totals()
            sync_order_status_and_demand_counters(order_locked, actor=request.user)

        _log_production_audit(
            request,
            action='ISSUE',
            entity_type='ProductionIssue',
            entity_id=int(issue.id),
            entity_code=issue.code,
            old_values={},
            new_values={
                'production_order': order.id,
                'production_order_code': order.code,
                'status': issue.status,
                'total_qty': str(issue.total_qty),
                'total_amount': str(issue.total_amount),
            },
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'ISSUE', triggered_by=request.user)
        return Response(ProductionIssueSerializer(issue).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def receive_output(self, request, pk=None):
        order = self.get_object()
        if not can_receive_output(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)

        raw_items = request.data.get('items')
        if not isinstance(raw_items, list):
            raw_items = [request.data]

        receipt_date_raw = request.data.get('receipt_date') or timezone.localdate().isoformat()
        try:
            receipt_date_value = date.fromisoformat(str(receipt_date_raw))
        except (TypeError, ValueError):
            return Response({'error': 'Ngày nhập thành phẩm không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        warehouse_id = request.data.get('warehouse') or getattr(order, 'target_warehouse_id', None)
        location_id = request.data.get('location') or getattr(order, 'target_location_id', None)
        if not warehouse_id:
            return Response({'error': 'Thiếu kho nhập thành phẩm.'}, status=status.HTTP_400_BAD_REQUEST)
        reference = str(request.data.get('reference') or order.code or '').strip()
        reason = str(request.data.get('reason') or 'Nhập kho thành phẩm từ sản xuất').strip()
        note = str(request.data.get('note') or '').strip()

        from inventory.serializers import InventoryTransactionSerializer

        with transaction.atomic():
            order_locked = ProductionOrder.objects.select_for_update().get(pk=order.pk)
            if order_locked.status not in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}:
                raise ValidationError({'error': 'Lệnh sản xuất hiện không thể nhập thành phẩm thêm.'})
            receipt = ProductionReceipt.objects.create(
                code=get_next_production_receipt_code(receipt_date_value),
                production_order=order_locked,
                receipt_date=receipt_date_value,
                reference=reference,
                warehouse_id=warehouse_id,
                location_id=location_id,
                note=note,
                posted_by=request.user,
                created_by=request.user,
                updated_by=request.user,
            )
            remaining_receivable_qty = Decimal(str(order_locked.remaining_qty or 0))
            allocated_receipt_qty = Decimal('0')
            for index, item in enumerate(raw_items, start=1):
                try:
                    quantity = Decimal(str(item.get('quantity') or (remaining_receivable_qty - allocated_receipt_qty)))
                except (InvalidOperation, TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: quantity không hợp lệ.'})
                if quantity <= 0:
                    raise ValidationError({'error': f'Dòng {index}: quantity phải > 0.'})
                remaining_qty = remaining_receivable_qty - allocated_receipt_qty
                if quantity > remaining_qty:
                    raise ValidationError({'error': f'Dòng {index}: chỉ còn {remaining_qty} để nhập, yêu cầu={quantity}.'})
                product_id = item.get('product') or order_locked.product_id
                if int(product_id) != int(order_locked.product_id):
                    raise ValidationError({'error': f'Dòng {index}: chỉ được nhập đúng thành phẩm của lệnh sản xuất.'})
                try:
                    unit_cost = Decimal(str(item.get('unit_cost') or order_locked.unit_cost_estimate or 0))
                    bundle_count = int(item.get('bundle_count')) if item.get('bundle_count') not in (None, '') else None
                    pallet_count = int(item.get('pallet_count')) if item.get('pallet_count') not in (None, '') else None
                    units_per_bundle = (
                        Decimal(str(item.get('units_per_bundle')))
                        if item.get('units_per_bundle') not in (None, '')
                        else None
                    )
                    bundles_per_pallet = (
                        Decimal(str(item.get('bundles_per_pallet')))
                        if item.get('bundles_per_pallet') not in (None, '')
                        else None
                    )
                except (InvalidOperation, TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: unit_cost hoặc thông tin đóng gói không hợp lệ.'})
                if bundle_count is not None and bundle_count <= 0:
                    raise ValidationError({'error': f'Dòng {index}: bundle_count phải > 0.'})
                if pallet_count is not None and pallet_count <= 0:
                    raise ValidationError({'error': f'Dòng {index}: pallet_count phải > 0.'})
                if units_per_bundle is not None and units_per_bundle <= 0:
                    raise ValidationError({'error': f'Dòng {index}: units_per_bundle phải > 0.'})
                if bundles_per_pallet is not None and bundles_per_pallet <= 0:
                    raise ValidationError({'error': f'Dòng {index}: bundles_per_pallet phải > 0.'})

                serializer = InventoryTransactionSerializer(data={
                    'transaction_type': 'RECEIPT',
                    'transaction_date': item.get('receipt_date') or receipt_date_raw,
                    'product': order_locked.product_id,
                    'warehouse': warehouse_id,
                    'location': location_id,
                    'quantity': str(quantity),
                    'unit_cost': str(unit_cost),
                    'reference': str(item.get('reference') or reference).strip(),
                    'reason': str(item.get('reason') or reason).strip(),
                    'note': str(item.get('note') or '').strip(),
                })
                serializer.is_valid(raise_exception=True)
                inventory_tx = serializer.save(
                    created_by=request.user,
                    updated_by=request.user,
                    posted_by=request.user,
                    production_order=order_locked,
                    production_receipt=receipt,
                )
                ProductionReceiptLine.objects.create(
                    receipt=receipt,
                    line_number=index,
                    product=order_locked.product,
                    product_snapshot=order_locked.product_snapshot or {},
                    quantity=quantity,
                    bundle_count=bundle_count,
                    units_per_bundle=units_per_bundle,
                    pallet_count=pallet_count,
                    bundles_per_pallet=bundles_per_pallet,
                    unit_cost=unit_cost,
                    note=str(item.get('note') or '').strip(),
                    inventory_transaction=inventory_tx,
                )
                add_produced_qty(order_locked, quantity)
                allocated_receipt_qty += quantity
            receipt.recalc_totals()
            if receipt.total_qty and receipt.total_amount and receipt.total_qty > 0:
                actual_unit_cost = (Decimal(str(receipt.total_amount)) / Decimal(str(receipt.total_qty))).quantize(Decimal('0.01'))
                product = order_locked.product
                if product and actual_unit_cost > 0 and Decimal(str(product.cost_price or 0)) != actual_unit_cost:
                    product.cost_price = actual_unit_cost
                    product.save(update_fields=['cost_price', 'updated_at'])
            sync_order_status_and_demand_counters(order_locked, actor=request.user)

        _log_production_audit(
            request,
            action='RECEIVE',
            entity_type='ProductionReceipt',
            entity_id=int(receipt.id),
            entity_code=receipt.code,
            old_values={},
            new_values={
                'production_order': order.id,
                'production_order_code': order.code,
                'status': receipt.status,
                'total_qty': str(receipt.total_qty),
                'total_amount': str(receipt.total_amount),
            },
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'RECEIVE', triggered_by=request.user)
        return Response(ProductionReceiptSerializer(receipt).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def approval_history(self, request, pk=None):
        order = self.get_object()
        history = ApprovalHistory.objects.filter(
            entity_type='ProductionOrder',
            entity_id=order.id,
        ).order_by('-created_at').select_related('user')
        return Response([_serialize_approval_history_item(item) for item in history])

    @action(detail=True, methods=['get'])
    def issue_overview(self, request, pk=None):
        order = self.get_object()
        issues = order.issues.select_related('posted_by', 'cancelled_by').prefetch_related('lines', 'lines__material_product').order_by('-issue_date', '-id')
        return Response({'count': issues.count(), 'results': ProductionIssueSerializer(issues, many=True).data})

    @action(detail=True, methods=['get'])
    def receipt_overview(self, request, pk=None):
        order = self.get_object()
        receipts = order.receipts.select_related('warehouse', 'location').prefetch_related('lines', 'lines__product').order_by('-receipt_date', '-id')
        return Response({'count': receipts.count(), 'results': ProductionReceiptSerializer(receipts, many=True).data})

    @action(detail=True, methods=['get'])
    def next_states(self, request, pk=None):
        order = self.get_object()
        mapping = {
            ProductionOrderStatus.DRAFT: [ProductionOrderStatus.SUBMITTED, ProductionOrderStatus.CANCELLED],
            ProductionOrderStatus.SUBMITTED: [ProductionOrderStatus.APPROVED, ProductionOrderStatus.REJECTED, ProductionOrderStatus.CANCELLED],
            ProductionOrderStatus.APPROVED: [ProductionOrderStatus.RELEASED, ProductionOrderStatus.CANCELLED],
            ProductionOrderStatus.REJECTED: [ProductionOrderStatus.SUBMITTED, ProductionOrderStatus.CANCELLED],
            ProductionOrderStatus.RELEASED: [ProductionOrderStatus.IN_PROGRESS, ProductionOrderStatus.COMPLETED],
            ProductionOrderStatus.IN_PROGRESS: [ProductionOrderStatus.COMPLETED],
            ProductionOrderStatus.COMPLETED: [],
            ProductionOrderStatus.CANCELLED: [],
        }
        return Response({'current': order.status, 'next_states': mapping.get(order.status, [])})

    @action(detail=False, methods=['get'])
    def summary(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        today = timezone.localdate()
        active_qs = queryset.filter(status__in=[ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS])
        planned_total_active = Decimal(str(active_qs.aggregate(total=Sum('planned_qty')).get('total') or 0))
        produced_total_active = Decimal(str(active_qs.aggregate(total=Sum('produced_qty')).get('total') or 0))
        ready_operations = ProductionOperation.objects.filter(
            production_order_id__in=active_qs.values('id'),
            status=ProductionOperationStatus.READY,
        ).count()
        planner_digest = {
            'overdue_operations': 0,
            'ready_to_run_count': 0,
            'wait_material_count': 0,
            'wait_previous_step_count': 0,
            'machine_down_count': 0,
            'over_capacity_count': 0,
            'at_limit_count': 0,
            'over_capacity_slot_count': 0,
            'unscheduled_count': 0,
            'blocked_count': 0,
            'handover_ready_count': 0,
            'handover_accepted_count': 0,
            'unassigned_machine_count': 0,
            'unassigned_work_center_count': 0,
            'affected_sales_order_count': 0,
            'hot_dispatch_owner': None,
            'hot_sales_order': None,
            'hot_material_wait': None,
            'hot_work_center': None,
            'hot_machine': None,
            'hot_delivery_date': None,
            'hot_unscheduled_step': None,
            'hot_shift_watch': None,
            'hot_date_watch': None,
            'hot_owner_capacity': None,
            'hot_step_watch': None,
            'hot_rebalance_summary': None,
        }
        affected_sales_order_ids = set()
        summary_cards = []
        active_orders = list(active_qs)
        for order in active_orders:
            operations = list(order.operations.all().order_by('sequence'))
            requirements = list(order.material_requirements.all())
            order_needs_attention = False
            for operation in operations:
                snapshot = build_operation_planning_snapshot(
                    operation,
                    order=order,
                    requirements=requirements,
                    operations=operations,
                    today=today,
                )
                summary_cards.append(_serialize_planning_card(order, operation, snapshot=snapshot, today=today))
                if snapshot['risk_state'] == 'OVERDUE':
                    planner_digest['overdue_operations'] += 1
                if _is_ready_to_run_operation(operation, snapshot=snapshot):
                    planner_digest['ready_to_run_count'] += 1
                if snapshot['material_readiness'] != 'READY':
                    planner_digest['wait_material_count'] += 1
                if snapshot['dependency_state'] == 'WAIT_PREVIOUS_STEP':
                    planner_digest['wait_previous_step_count'] += 1
                if str(getattr(operation, 'block_reason_code', '') or '').strip().upper() == ProductionOperationBlockReason.MACHINE_DOWN:
                    planner_digest['machine_down_count'] += 1
                if snapshot['risk_state'] == 'UNSCHEDULED':
                    planner_digest['unscheduled_count'] += 1
                if snapshot['risk_state'] == 'BLOCKED':
                    planner_digest['blocked_count'] += 1
                if str(getattr(operation, 'handover_status', '') or '').strip().upper() == ProductionOperationHandoverStatus.READY:
                    planner_digest['handover_ready_count'] += 1
                if str(getattr(operation, 'handover_status', '') or '').strip().upper() == ProductionOperationHandoverStatus.ACCEPTED:
                    planner_digest['handover_accepted_count'] += 1
                if snapshot['risk_state'] in {'OVERDUE', 'BLOCKED', 'UNSCHEDULED', 'AT_RISK'}:
                    order_needs_attention = True
            if order_needs_attention and getattr(order, 'sales_order_id', None):
                affected_sales_order_ids.add(order.sales_order_id)
        capacity_context = _annotate_capacity_context(summary_cards)
        capacity_calendar = _build_capacity_calendar(summary_cards)
        shift_watch = _build_planner_shift_watch(summary_cards, capacity_calendar)
        date_watch = _build_planner_date_watch(summary_cards, capacity_calendar)
        dispatch_owner_capacity_watch = _build_planner_dispatch_owner_capacity_watch(summary_cards)
        step_watch = _build_planner_step_watch(summary_cards)
        rebalance_summary = _build_planner_rebalance_summary(
            _build_rebalance_suggestions(summary_cards, work_center_groups=capacity_context['work_center_groups']),
            limit=1,
        )
        planner_digest['over_capacity_count'] = capacity_context['summary']['over_capacity_count']
        planner_digest['at_limit_count'] = capacity_context['summary']['capacity_state_counts'].get('AT_LIMIT', 0)
        planner_digest['over_capacity_slot_count'] = capacity_context['summary']['over_capacity_slot_count']
        planner_digest['unassigned_machine_count'] = capacity_context['summary']['unassigned_machine_count']
        planner_digest['unassigned_work_center_count'] = capacity_context['summary']['unassigned_work_center_count']
        planner_digest['affected_sales_order_count'] = len(affected_sales_order_ids)
        planner_digest['hot_over_capacity_window'] = _build_planner_window_focus(capacity_calendar, target_state='OVER_CAPACITY')
        planner_digest['hot_at_limit_window'] = _build_planner_window_focus(capacity_calendar, target_state='AT_LIMIT')
        planner_digest['hot_machine_queue'] = _build_planner_queue_focus(capacity_context['machine_queues'])
        dispatch_owner_groups = _build_planner_dispatch_owner_groups(summary_cards, limit=1)
        sales_watch = _build_planner_sales_watch(summary_cards, limit=1)
        material_watch = _build_planner_material_watch(active_orders, summary_cards, limit=1)
        work_center_watch = _build_planner_work_center_watch(capacity_context['work_center_groups'], limit=1)
        machine_watch = _build_planner_machine_watch(capacity_context['machine_queues'], limit=1)
        delivery_watch = _build_planner_delivery_watch(summary_cards, limit=1)
        unscheduled_watch = _build_planner_unscheduled_watch(summary_cards, limit=1)
        planner_digest['hot_dispatch_owner'] = dispatch_owner_groups[0] if dispatch_owner_groups else None
        planner_digest['hot_sales_order'] = sales_watch[0] if sales_watch else None
        planner_digest['hot_material_wait'] = material_watch[0] if material_watch else None
        planner_digest['hot_work_center'] = work_center_watch[0] if work_center_watch else None
        planner_digest['hot_machine'] = machine_watch[0] if machine_watch else None
        planner_digest['hot_delivery_date'] = delivery_watch[0] if delivery_watch else None
        planner_digest['hot_unscheduled_step'] = unscheduled_watch[0] if unscheduled_watch else None
        planner_digest['hot_shift_watch'] = shift_watch[0] if shift_watch else None
        planner_digest['hot_date_watch'] = date_watch[0] if date_watch else None
        planner_digest['hot_owner_capacity'] = dispatch_owner_capacity_watch[0] if dispatch_owner_capacity_watch else None
        planner_digest['hot_step_watch'] = step_watch[0] if step_watch else None
        planner_digest['hot_rebalance_summary'] = rebalance_summary[0] if rebalance_summary else None
        return Response({
            'total_orders': int(queryset.count()),
            'draft_count': int(queryset.filter(status=ProductionOrderStatus.DRAFT).count()),
            'submitted_count': int(queryset.filter(status=ProductionOrderStatus.SUBMITTED).count()),
            'approved_count': int(queryset.filter(status=ProductionOrderStatus.APPROVED).count()),
            'released_count': int(queryset.filter(status=ProductionOrderStatus.RELEASED).count()),
            'in_progress_count': int(queryset.filter(status=ProductionOrderStatus.IN_PROGRESS).count()),
            'completed_count': int(queryset.filter(status=ProductionOrderStatus.COMPLETED).count()),
            'cancelled_count': int(queryset.filter(status=ProductionOrderStatus.CANCELLED).count()),
            'pending_approval_count': int(queryset.filter(status=ProductionOrderStatus.SUBMITTED).count()),
            'active_count': int(active_qs.count()),
            'overdue_plan_count': int(queryset.filter(status__in=[ProductionOrderStatus.APPROVED, ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS], planned_end_date__lt=today).count()),
            'active_remaining_qty': str(planned_total_active - produced_total_active if planned_total_active > produced_total_active else Decimal('0')),
            'ready_operation_count': int(ready_operations),
            'planner_digest': planner_digest,
        })

    @action(detail=False, methods=['get'])
    def planning_board(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        customer_query = str(request.query_params.get('customer') or '').strip()
        sales_order_code = str(request.query_params.get('sales_order_code') or '').strip()
        delivery_due_date_value = str(request.query_params.get('delivery_due_date') or '').strip()
        finished_product_code = str(request.query_params.get('finished_product_code') or '').strip()
        material_product_code = str(request.query_params.get('material_product_code') or '').strip()
        if customer_query:
            queryset = queryset.filter(
                Q(sales_order__customer__code__icontains=customer_query)
                | Q(sales_order__customer__name__icontains=customer_query)
            )
        if sales_order_code:
            queryset = queryset.filter(sales_order__code__icontains=sales_order_code)
        if delivery_due_date_value:
            try:
                delivery_due_date = date.fromisoformat(delivery_due_date_value)
            except (TypeError, ValueError):
                return Response({'error': 'delivery_due_date khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
            queryset = queryset.filter(planned_end_date=delivery_due_date)
        if finished_product_code:
            queryset = queryset.filter(
                Q(product__code__icontains=finished_product_code)
                | Q(product_snapshot__code__icontains=finished_product_code)
            )
        if material_product_code:
            queryset = queryset.filter(
                Q(material_requirements__internal_product_code__icontains=material_product_code)
                | Q(material_requirements__material_product__code__icontains=material_product_code)
            ).distinct()

        try:
            planned_date_from = _parse_optional_date(request.query_params.get('planned_date_from'), field_label='planned_date_from')
            planned_date_to = _parse_optional_date(request.query_params.get('planned_date_to'), field_label='planned_date_to')
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)

        step_code = str(request.query_params.get('step_code') or '').strip().upper()
        planned_shift = str(request.query_params.get('planned_shift') or '').strip().upper()
        handover_status = str(request.query_params.get('handover_status') or '').strip().upper()
        dispatch_owner = str(request.query_params.get('dispatch_owner') or '').strip().lower()
        work_center_code = str(request.query_params.get('work_center_code') or '').strip().lower()
        machine_code = str(request.query_params.get('machine_code') or '').strip().lower()
        capacity_state = str(request.query_params.get('capacity_state') or '').strip().upper()
        risk_state = str(request.query_params.get('risk_state') or '').strip().upper()
        material_readiness = str(request.query_params.get('material_readiness') or '').strip().upper()
        dependency_state = str(request.query_params.get('dependency_state') or '').strip().upper()
        bucket_key = str(request.query_params.get('bucket_key') or '').strip().upper()
        order_status = str(request.query_params.get('order_status') or '').strip().upper()
        production_order_id = request.query_params.get('production_order_id')
        ready_to_run_only = str(request.query_params.get('ready_to_run') or '').strip().lower() in {'1', 'true', 'yes'}
        needs_attention_only = str(request.query_params.get('needs_attention') or '').strip().lower() in {'1', 'true', 'yes'}
        has_material_wait = str(request.query_params.get('has_material_wait') or '').strip().lower() in {'1', 'true', 'yes'}
        has_previous_wait = str(request.query_params.get('has_previous_wait') or '').strip().lower() in {'1', 'true', 'yes'}
        today = timezone.localdate()
        if bucket_key and bucket_key not in PLANNING_BUCKETS:
            return Response({'error': 'Nhom bucket planner khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        if handover_status and handover_status not in PLANNING_HANDOVER_FILTERS:
            return Response({'error': 'Trang thai handover planner khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        if capacity_state and capacity_state not in PLANNING_CAPACITY_STATES:
            return Response({'error': 'Trang thai cong suat planner khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        if order_status and order_status not in dict(ProductionOrderStatus.CHOICES):
            return Response({'error': 'Trang thai lenh san xuat khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        if production_order_id:
            try:
                queryset = queryset.filter(pk=int(production_order_id))
            except (TypeError, ValueError):
                return Response({'error': 'production_order_id khong hop le.'}, status=status.HTTP_400_BAD_REQUEST)
        if order_status:
            queryset = queryset.filter(status=order_status)

        orders = list(queryset)
        raw_cards = []
        for order in orders:
            operations = list(order.operations.all())
            requirements = list(order.material_requirements.all())
            for operation in operations:
                if (planned_date_from or planned_date_to) and operation.planned_date is None:
                    continue
                if planned_date_from and operation.planned_date and operation.planned_date < planned_date_from:
                    continue
                if planned_date_to and operation.planned_date and operation.planned_date > planned_date_to:
                    continue

                snapshot = build_operation_planning_snapshot(
                    operation,
                    order=order,
                    requirements=requirements,
                    operations=operations,
                    today=today,
                )
                raw_cards.append(_serialize_planning_card(order, operation, snapshot=snapshot, today=today))

        capacity_context = _annotate_capacity_context(raw_cards)

        lane_map = {}
        cards = []
        for card in raw_cards:
            operation = card['operation']
            if not _matches_planning_filter(
                card,
                step_code=step_code,
                planned_shift=planned_shift,
                handover_status=handover_status,
                dispatch_owner=dispatch_owner,
                work_center_code=work_center_code,
                machine_code=machine_code,
                capacity_state=capacity_state,
                risk_state=risk_state,
                material_readiness=material_readiness,
                dependency_state=dependency_state,
                bucket_key=bucket_key,
                order_status=order_status,
                ready_to_run_only=ready_to_run_only,
                needs_attention_only=needs_attention_only,
                has_material_wait=has_material_wait,
                has_previous_wait=has_previous_wait,
            ):
                continue
            cards.append(card)
            lane_key = f"{operation.get('step_code')}:{operation.get('step_name')}"
            lane = lane_map.setdefault(
                lane_key,
                {
                    'key': lane_key,
                    'step_code': operation.get('step_code'),
                    'step_name': operation.get('step_name'),
                    'sequence': operation.get('sequence'),
                    'total_cards': 0,
                    'buckets': {},
                    'shift_loads': {},
                },
            )
            lane['total_cards'] += 1
            lane_shift_key = _get_planning_shift_key(card['operation'].get('planned_shift'))
            lane_shift_load = lane['shift_loads'].setdefault(lane_shift_key, _build_shift_load_item(lane_shift_key))
            _accumulate_shift_load(lane_shift_load, card)
            bucket = lane['buckets'].setdefault(
                card['bucket']['key'],
                {
                    'key': card['bucket']['key'],
                    'label': card['bucket']['label'],
                    'sort_order': card['bucket']['sort_order'],
                    'count': 0,
                    'cards': [],
                },
            )
            bucket['count'] += 1
            bucket['cards'].append(card)

        for lane in lane_map.values():
            lane['buckets'] = sorted(
                lane['buckets'].values(),
                key=lambda item: (item['sort_order'], item['label']),
            )
            lane['shift_loads'] = _finalize_shift_loads(lane['shift_loads'].values(), include_empty=False)
            lane['bucket_count'] = len(lane['buckets'])
        lanes = sorted(lane_map.values(), key=lambda item: (item['sequence'], item['step_name']))

        scope_summary = _build_planning_summary(raw_cards, today=today)
        risky_cards = [
            card for card in cards
            if card['exceptions']['risk_state'] in {'OVERDUE', 'BLOCKED', 'UNSCHEDULED', 'AT_RISK'}
        ]
        risk_priority = {
            'OVERDUE': 1,
            'BLOCKED': 2,
            'UNSCHEDULED': 3,
            'AT_RISK': 4,
            'ON_TRACK': 5,
            'DONE': 6,
        }
        watchlist = sorted(
            risky_cards,
            key=lambda item: (
                risk_priority.get(item['exceptions']['risk_state'], 99),
                item['operation'].get('planned_date') or '9999-12-31',
                item['order'].get('planned_end_date') or '9999-12-31',
                item['operation'].get('priority_rank') or 99999,
            ),
        )[:8]
        affected_sales_order_count = len({
            card['sales']['sales_order_id']
            for card in risky_cards
            if card['sales'].get('sales_order_id')
        })
        shift_loads = {
            key: _build_shift_load_item(key)
            for key in PLANNING_SHIFT_FILTERS
        }
        dispatch_groups = {
            key: _build_dispatch_group_item(key)
            for key in PLANNING_SHIFT_FILTERS
        }
        for card in cards:
            shift_key = _get_planning_shift_key(card['operation'].get('planned_shift'))
            _accumulate_shift_load(shift_loads[shift_key], card)
            _accumulate_dispatch_group(dispatch_groups[shift_key], card)
        summary = _build_planning_summary(cards, today=today)
        summary['affected_sales_order_count'] = affected_sales_order_count
        exception_groups = _serialize_planning_exception_groups(cards)
        visible_card_keys = {card['card_key'] for card in cards}
        work_center_groups = [
            {
                **group,
                'cards': [card for card in group['cards'] if card['card_key'] in visible_card_keys],
            }
            for group in capacity_context['work_center_groups']
            if any(card['card_key'] in visible_card_keys for card in group['cards'])
        ]
        machine_queues = [
            {
                **queue,
                'cards': [card for card in queue['cards'] if card['card_key'] in visible_card_keys],
            }
            for queue in capacity_context['machine_queues']
            if any(card['card_key'] in visible_card_keys for card in queue['cards'])
        ]
        capacity_calendar = _build_capacity_calendar(cards)
        rebalance_suggestions = _build_rebalance_suggestions(cards, work_center_groups=work_center_groups)
        dispatch_owner_groups = _build_planner_dispatch_owner_groups(cards)
        sales_watch = _build_planner_sales_watch(cards)
        material_watch = _build_planner_material_watch(orders, cards)
        work_center_watch = _build_planner_work_center_watch(work_center_groups)
        machine_watch = _build_planner_machine_watch(machine_queues)
        delivery_watch = _build_planner_delivery_watch(cards)
        unscheduled_watch = _build_planner_unscheduled_watch(cards)
        shift_watch = _build_planner_shift_watch(cards, capacity_calendar)
        date_watch = _build_planner_date_watch(cards, capacity_calendar)
        dispatch_owner_capacity_watch = _build_planner_dispatch_owner_capacity_watch(cards)
        step_watch = _build_planner_step_watch(cards)
        rebalance_summary = _build_planner_rebalance_summary(rebalance_suggestions)

        return Response({
            'summary': {
                **summary,
                'shift_loads': _finalize_shift_loads(shift_loads.values(), include_empty=True),
            },
            'scope_summary': scope_summary,
            'lanes': lanes,
            'watchlist': watchlist,
            'exception_groups': exception_groups,
            'dispatch_groups': _finalize_dispatch_groups(dispatch_groups.values()),
            'work_center_groups': work_center_groups,
            'machine_queues': machine_queues,
            'capacity_calendar': capacity_calendar,
            'rebalance_suggestions': rebalance_suggestions,
            'dispatch_owner_groups': dispatch_owner_groups,
            'sales_watch': sales_watch,
            'material_watch': material_watch,
            'work_center_watch': work_center_watch,
            'machine_watch': machine_watch,
            'delivery_watch': delivery_watch,
            'unscheduled_watch': unscheduled_watch,
            'shift_watch': shift_watch,
            'date_watch': date_watch,
            'dispatch_owner_capacity_watch': dispatch_owner_capacity_watch,
            'step_watch': step_watch,
            'rebalance_summary': rebalance_summary,
        })


class ProductionIssueViewSet(SearchTextMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = ProductionIssueSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'issue_date', 'status', 'total_qty', 'total_amount', 'created_at']
    ordering = ['-issue_date', '-id']

    def get_queryset(self):
        queryset = ProductionIssue.objects.select_related(
            'production_order',
            'production_order__product',
            'posted_by',
            'cancelled_by',
        ).prefetch_related('lines', 'lines__material_product', 'lines__warehouse', 'lines__location')
        user = self.request.user
        if not getattr(user, 'is_superuser', False):
            if getattr(user, 'teams', None):
                team_ids = list(user.teams.values_list('id', flat=True))
                queryset = queryset.filter(
                    Q(production_order__owner=user)
                    | Q(production_order__team_id__in=team_ids)
                    | Q(production_order__owner__isnull=True)
                )
            else:
                queryset = queryset.filter(Q(production_order__owner=user) | Q(production_order__owner__isnull=True))
        status_value = (self.request.query_params.get('status') or '').strip()
        if status_value:
            queryset = queryset.filter(status=status_value)
        production_order_id = self.request.query_params.get('production_order')
        if production_order_id:
            queryset = queryset.filter(production_order_id=production_order_id)
        return self.apply_search(queryset)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        issue = self.get_object()
        if not can_cancel_production_issue(request.user, issue):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = (request.data.get('reason') or request.data.get('cancel_reason') or '').strip()
        if not reason:
            return Response({'error': 'Bắt buộc nhập lý do hủy cấp vật tư.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            locked_issue = (
                ProductionIssue.objects.select_for_update()
                .select_related('production_order')
                .prefetch_related('lines', 'lines__material_requirement', 'lines__inventory_transaction')
                .get(pk=issue.pk)
            )
            if locked_issue.status != ProductionIssueStatus.POSTED:
                return Response({'error': 'Chứng từ cấp vật tư không còn hiệu lực để hủy.'}, status=status.HTTP_400_BAD_REQUEST)
            for line in locked_issue.lines.all():
                tx = getattr(line, 'inventory_transaction', None)
                if tx and tx.status != 'CANCELLED':
                    tx.status = 'CANCELLED'
                    tx.cancelled_at = timezone.now()
                    tx.cancelled_by = request.user
                    tx.cancel_reason = reason
                    tx.updated_by = request.user
                    tx.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_by', 'updated_at'])
                if line.material_requirement_id:
                    subtract_issued_qty(line.material_requirement, line.quantity)
            locked_issue.status = ProductionIssueStatus.CANCELLED
            locked_issue.cancelled_at = timezone.now()
            locked_issue.cancelled_by = request.user
            locked_issue.cancel_reason = reason
            locked_issue.updated_by = request.user
            locked_issue.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_by', 'updated_at'])
            sync_order_status_and_demand_counters(locked_issue.production_order, actor=request.user)

        _log_production_audit(
            request,
            action='CANCEL',
            entity_type='ProductionIssue',
            entity_id=int(issue.id),
            entity_code=issue.code,
            old_values={'status': ProductionIssueStatus.POSTED},
            new_values={'status': ProductionIssueStatus.CANCELLED, 'reason': reason},
        )
        return Response({'status': ProductionIssueStatus.CANCELLED})

    @action(detail=True, methods=['get'])
    def lifecycle_history(self, request, pk=None):
        issue = self.get_object()
        history = AuditLog.objects.filter(
            entity_type='ProductionIssue',
            entity_id=issue.id,
        ).order_by('-created_at').select_related('user')
        return Response([_serialize_audit_timeline_item(item) for item in history])

    @action(detail=True, methods=['get'])
    def next_states(self, request, pk=None):
        issue = self.get_object()
        mapping = {
            ProductionIssueStatus.POSTED: [ProductionIssueStatus.CANCELLED],
            ProductionIssueStatus.CANCELLED: [],
        }
        return Response({'current': issue.status, 'next_states': mapping.get(issue.status, [])})


class ProductionReceiptViewSet(SearchTextMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = ProductionReceiptSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'receipt_date', 'status', 'total_qty', 'total_amount', 'created_at']
    ordering = ['-receipt_date', '-id']

    def get_queryset(self):
        queryset = ProductionReceipt.objects.select_related(
            'production_order',
            'production_order__product',
            'warehouse',
            'location',
            'posted_by',
            'cancelled_by',
        ).prefetch_related('lines', 'lines__product', 'lines__inventory_transaction')
        user = self.request.user
        if not getattr(user, 'is_superuser', False):
            if getattr(user, 'teams', None):
                team_ids = list(user.teams.values_list('id', flat=True))
                queryset = queryset.filter(
                    Q(production_order__owner=user)
                    | Q(production_order__team_id__in=team_ids)
                    | Q(production_order__owner__isnull=True)
                )
            else:
                queryset = queryset.filter(Q(production_order__owner=user) | Q(production_order__owner__isnull=True))
        status_value = (self.request.query_params.get('status') or '').strip()
        if status_value:
            queryset = queryset.filter(status=status_value)
        production_order_id = self.request.query_params.get('production_order')
        if production_order_id:
            queryset = queryset.filter(production_order_id=production_order_id)
        return self.apply_search(queryset)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        receipt = self.get_object()
        if not can_cancel_production_receipt(request.user, receipt):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = (request.data.get('reason') or request.data.get('cancel_reason') or '').strip()
        if not reason:
            return Response({'error': 'Bắt buộc nhập lý do hủy nhập thành phẩm.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            locked_receipt = (
                ProductionReceipt.objects.select_for_update()
                .select_related('production_order')
                .prefetch_related('lines', 'lines__inventory_transaction')
                .get(pk=receipt.pk)
            )
            if locked_receipt.status != ProductionReceiptStatus.POSTED:
                return Response({'error': 'Phiếu nhập thành phẩm không còn hiệu lực để hủy.'}, status=status.HTTP_400_BAD_REQUEST)
            for line in locked_receipt.lines.all():
                tx = getattr(line, 'inventory_transaction', None)
                if tx and tx.status != 'CANCELLED':
                    tx.status = 'CANCELLED'
                    tx.cancelled_at = timezone.now()
                    tx.cancelled_by = request.user
                    tx.cancel_reason = reason
                    tx.updated_by = request.user
                    tx.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_by', 'updated_at'])
                subtract_produced_qty(locked_receipt.production_order, line.quantity)
            locked_receipt.status = ProductionReceiptStatus.CANCELLED
            locked_receipt.cancelled_at = timezone.now()
            locked_receipt.cancelled_by = request.user
            locked_receipt.cancel_reason = reason
            locked_receipt.updated_by = request.user
            locked_receipt.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_by', 'updated_at'])
            sync_order_status_and_demand_counters(locked_receipt.production_order, actor=request.user)

        _log_production_audit(
            request,
            action='CANCEL',
            entity_type='ProductionReceipt',
            entity_id=int(receipt.id),
            entity_code=receipt.code,
            old_values={'status': ProductionReceiptStatus.POSTED},
            new_values={'status': ProductionReceiptStatus.CANCELLED, 'reason': reason},
        )
        return Response({'status': ProductionReceiptStatus.CANCELLED})

    @action(detail=True, methods=['post'])
    def scan_receipt_qr(self, request, pk=None):
        receipt = self.get_object()
        if not _can_manage_production(request.user):
            return Response({'error': 'Bạn không có quyền quét QR thành phẩm.'}, status=status.HTTP_403_FORBIDDEN)
        scan_value = str(request.data.get('scan_value') or request.data.get('qr_value') or request.data.get('trace_code') or '').strip()
        if not scan_value:
            return Response({'error': 'Thiếu QR gốc hoặc mã hàng để quét.'}, status=status.HTTP_400_BAD_REQUEST)

        normalized_scan = scan_value.casefold()
        lines = list(
            ProductionReceiptLine.objects.filter(receipt=receipt)
            .select_related('receipt', 'receipt__production_order', 'product', 'inventory_transaction')
            .order_by('line_number', 'id')
        )
        matched_line = next(
            (line for line in lines if _build_production_receipt_line_trace_code(line).casefold() == normalized_scan),
            None,
        )
        match_mode = 'ROOT_QR'
        if not matched_line:
            product_matches = [
                line
                for line in lines
                if ((line.product_snapshot or {}).get('code') or getattr(getattr(line, 'product', None), 'code', '') or '').casefold() == normalized_scan
            ]
            if len(product_matches) == 1:
                matched_line = product_matches[0]
                match_mode = 'PRODUCT_CODE'
        if not matched_line:
            return Response({'error': 'Không tìm thấy dòng thành phẩm phù hợp trong phiếu nhập này.'}, status=status.HTTP_404_NOT_FOUND)

        match_payload = _serialize_production_receipt_scan_match(matched_line)
        AuditLog.objects.create(
            user=request.user,
            action='SCAN',
            entity_type='ProductionReceipt',
            entity_id=receipt.id,
            entity_code=receipt.code,
            old_values={},
            new_values={
                'scan_status': 'MATCHED',
                'match_mode': match_mode,
                'trace_code': match_payload['trace_code'],
                'product_code': match_payload['product_code'],
            },
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(
            {
                'scan_status': 'MATCHED',
                'match_mode': match_mode,
                'receipt_id': receipt.id,
                'receipt_code': receipt.code,
                'match': match_payload,
            }
        )

    @action(detail=True, methods=['get'])
    def lifecycle_history(self, request, pk=None):
        receipt = self.get_object()
        history = AuditLog.objects.filter(
            entity_type='ProductionReceipt',
            entity_id=receipt.id,
        ).order_by('-created_at').select_related('user')
        return Response([_serialize_audit_timeline_item(item) for item in history])

    @action(detail=True, methods=['get'])
    def next_states(self, request, pk=None):
        receipt = self.get_object()
        mapping = {
            ProductionReceiptStatus.POSTED: [ProductionReceiptStatus.CANCELLED],
            ProductionReceiptStatus.CANCELLED: [],
        }
        return Response({'current': receipt.status, 'next_states': mapping.get(receipt.status, [])})
