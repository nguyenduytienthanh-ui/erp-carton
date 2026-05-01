from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from core.models import Setting
from production.models import (
    ProductionDemand,
    ProductionDemandPlanningStatus,
    ProductionDemandProductionStatus,
)
from sales.document_policy import round_qty
from sales.models import PeriodSequence, SalesOrderDeliveryPlan
from sales.services import normalize_sales_product_snapshot


PRODUCTION_DEMAND_SETTING_DEFAULTS = {
    'PRODUCTION_DEMAND_DELIVERY_BUFFER_DAYS': 2,
    'PRODUCTION_DEMAND_PLANNING_LEAD_DAYS': 5,
    'PRODUCTION_DEMAND_REMINDER_LEAD_DAYS': 1,
    'PRODUCTION_DEMAND_GENERIC_EXTRA_LEAD_DAYS': 2,
}

SYNCED_DEMAND_SOURCE = 'SALES_ORDER'
DEMAND_HOLD_REASON_SOURCE_CHANGED = 'Nguon nhu cau da thay doi, can planner kiem tra lai.'
DEMAND_CANCEL_REASON_DEFAULT = 'Sales order cancelled/rejected; planner review required.'


def _to_decimal(value):
    try:
        return Decimal(str(value or 0))
    except Exception:
        return Decimal('0')


def _to_int_setting(value, default):
    try:
        return max(int(value), 0)
    except Exception:
        return default


def _json_safe_value(value):
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return int(value)
        return str(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _compact_dict(payload):
    return {
        key: _json_safe_value(value)
        for key, value in payload.items()
        if value not in (None, '')
    }


def _result(dry_run=False):
    return {
        'dry_run': bool(dry_run),
        'created': 0,
        'updated': 0,
        'cancelled': 0,
        'held': 0,
        'skipped': 0,
        'errors': 0,
        'would_create': 0,
        'would_update': 0,
        'would_cancel': 0,
        'would_hold': 0,
        'details': [],
    }


def _merge_result(target, source):
    for key in (
        'created',
        'updated',
        'cancelled',
        'held',
        'skipped',
        'errors',
        'would_create',
        'would_update',
        'would_cancel',
        'would_hold',
    ):
        target[key] += source.get(key, 0)
    target['details'].extend(source.get('details') or [])
    return target


def build_delivery_plan_demand_key(line, delivery_plan):
    return f'SO:{line.sales_order_id}:LINE:{line.id}:PLAN:{delivery_plan.id}'


def build_default_line_demand_key(line):
    return f'SO:{line.sales_order_id}:LINE:{line.id}:DEFAULT'


def get_production_demand_settings():
    settings = dict(PRODUCTION_DEMAND_SETTING_DEFAULTS)
    rows = Setting.objects.filter(
        key__in=list(PRODUCTION_DEMAND_SETTING_DEFAULTS.keys()),
        is_active=True,
    ).values_list('key', 'value')
    for key, value in rows:
        settings[key] = _to_int_setting(value, PRODUCTION_DEMAND_SETTING_DEFAULTS[key])
    return {
        'delivery_buffer_days': settings['PRODUCTION_DEMAND_DELIVERY_BUFFER_DAYS'],
        'planning_lead_days': settings['PRODUCTION_DEMAND_PLANNING_LEAD_DAYS'],
        'reminder_lead_days': settings['PRODUCTION_DEMAND_REMINDER_LEAD_DAYS'],
        'generic_extra_lead_days': settings['PRODUCTION_DEMAND_GENERIC_EXTRA_LEAD_DAYS'],
    }


def compute_demand_dates(delivery_date, product_kind='', requires_review=False):
    if not delivery_date:
        return {
            'production_due_date': None,
            'planning_due_date': None,
            'reminder_date': None,
        }
    settings = get_production_demand_settings()
    product_kind_value = (product_kind or '').upper()
    extra_days = settings['generic_extra_lead_days'] if product_kind_value == 'GENERIC' or requires_review else 0
    production_due_date = delivery_date - timedelta(days=settings['delivery_buffer_days'])
    planning_due_date = production_due_date - timedelta(days=settings['planning_lead_days'] + extra_days)
    reminder_date = planning_due_date - timedelta(days=settings['reminder_lead_days'])
    return {
        'production_due_date': production_due_date,
        'planning_due_date': planning_due_date,
        'reminder_date': reminder_date,
    }


def _planning_status_for_payload(qty_required, qty_planned, planning_due_date):
    required = _to_decimal(qty_required)
    planned = _to_decimal(qty_planned)
    if required > 0 and planned >= required:
        return ProductionDemandPlanningStatus.FULLY_PLANNED
    if planned > 0:
        return ProductionDemandPlanningStatus.PARTIALLY_PLANNED
    if not planning_due_date:
        return ProductionDemandPlanningStatus.NOT_DUE
    today = timezone.localdate()
    if planning_due_date < today:
        return ProductionDemandPlanningStatus.OVERDUE
    if planning_due_date == today:
        return ProductionDemandPlanningStatus.DUE
    if planning_due_date <= today + timedelta(days=7):
        return ProductionDemandPlanningStatus.UPCOMING
    return ProductionDemandPlanningStatus.NOT_DUE


def _production_status_for_payload(qty_required, qty_released, qty_completed):
    required = _to_decimal(qty_required)
    released = _to_decimal(qty_released)
    completed = _to_decimal(qty_completed)
    if required > 0 and completed >= required:
        return ProductionDemandProductionStatus.COMPLETED
    if completed > 0:
        return ProductionDemandProductionStatus.PARTIALLY_COMPLETED
    if required > 0 and released >= required:
        return ProductionDemandProductionStatus.FULLY_RELEASED
    if released > 0:
        return ProductionDemandProductionStatus.PARTIALLY_RELEASED
    return ProductionDemandProductionStatus.NOT_RELEASED


def _operation_summary_items(snapshot):
    items = []
    for item in snapshot.get('operations') or []:
        if not isinstance(item, dict):
            continue
        payload = _compact_dict({
            'operation_code': item.get('operation_code'),
            'operation_name': item.get('operation_name'),
            'sequence': item.get('sequence'),
            'standard_rate_per_hour': item.get('standard_rate_per_hour'),
            'applied_rate_per_hour': item.get('applied_rate_per_hour'),
            'note': item.get('note'),
            'source': item.get('source'),
        })
        if payload.get('operation_code'):
            items.append(payload)
    return items


def _routing_summary_items(snapshot):
    items = []
    for item in snapshot.get('routing_steps') or []:
        if not isinstance(item, dict):
            continue
        payload = _compact_dict({
            'step_no': item.get('step_no'),
            'display_step': item.get('display_step'),
            'display_order': item.get('display_order'),
            'operation_code': item.get('operation_code'),
            'operation_name': item.get('operation_name'),
            'applied_rate_per_hour': item.get('applied_rate_per_hour') or item.get('standard_rate_per_hour'),
            'step_type': item.get('step_type'),
            'group_code': item.get('group_code'),
            'note': item.get('note'),
            'source': item.get('source'),
            'allow_parallel': item.get('allow_parallel'),
        })
        if payload.get('operation_code'):
            items.append(payload)
    return items


def _snapshot_print_colors(snapshot):
    colors = snapshot.get('print_colors')
    if isinstance(colors, list):
        return [str(value).strip() for value in colors if str(value or '').strip()]
    return [
        str(snapshot.get(field_name) or '').strip()
        for field_name in ('print_color_1', 'print_color_2', 'print_color_3', 'print_color_4', 'print_color_5')
        if str(snapshot.get(field_name) or '').strip()
    ]


def extract_product_snapshot_summary(line):
    snapshot = normalize_sales_product_snapshot(getattr(line, 'product_snapshot', None) or {})
    product = getattr(line, 'product', None)
    order = getattr(line, 'sales_order', None)
    customer = getattr(order, 'customer', None)
    product_kind = (
        snapshot.get('product_kind')
        or getattr(product, 'product_kind', '')
        or 'SPECIFIC'
    )
    requires_review = bool(
        snapshot.get('requires_order_spec')
        or snapshot.get('requires_order_operations_review')
    )
    return {
        'customer_id_snapshot': getattr(customer, 'id', None),
        'customer_name_snapshot': getattr(customer, 'name', '') or '',
        'product_code': (
            snapshot.get('product_code')
            or snapshot.get('code')
            or getattr(line, 'internal_product_code', '')
            or getattr(product, 'code', '')
            or ''
        ),
        'product_name': (
            snapshot.get('product_name')
            or snapshot.get('name')
            or getattr(product, 'name', '')
            or ''
        ),
        'product_kind': product_kind,
        'requires_review': requires_review,
        'unit_name': snapshot.get('unit_name') or getattr(getattr(product, 'unit', None), 'name', '') or getattr(line, 'uom', '') or '',
        'size_order': snapshot.get('size_order') or '',
        'size_production': snapshot.get('size_production') or '',
        'print_colors': _snapshot_print_colors(snapshot),
        'operations_summary': _operation_summary_items(snapshot),
        'routing_summary': _routing_summary_items(snapshot),
    }


def get_next_production_demand_code(order_date=None):
    date_value = order_date or timezone.localdate()
    period = date_value.strftime('%Y%m')
    seq, _ = PeriodSequence.objects.get_or_create(
        doc_type='PD',
        period=period,
        defaults={'current_number': 0, 'padding': 5},
    )
    return seq.get_next_code()


def build_production_demand_payload(order, line, delivery_plan=None):
    summary = extract_product_snapshot_summary(line)
    delivery_date = getattr(delivery_plan, 'delivery_date', None) if delivery_plan else getattr(order, 'delivery_date', None)
    qty_required = _to_decimal(getattr(delivery_plan, 'qty', None) if delivery_plan else getattr(line, 'qty', None))
    date_payload = compute_demand_dates(
        delivery_date,
        summary.get('product_kind'),
        summary.get('requires_review'),
    )
    return {
        'demand_key': (
            build_delivery_plan_demand_key(line, delivery_plan)
            if delivery_plan
            else build_default_line_demand_key(line)
        ),
        'sales_order': order,
        'sales_order_line': line,
        'delivery_plan': delivery_plan,
        'product': getattr(line, 'product', None),
        'customer_id_snapshot': summary['customer_id_snapshot'],
        'customer_name_snapshot': summary['customer_name_snapshot'],
        'product_code': summary['product_code'],
        'product_name': summary['product_name'],
        'product_kind': summary['product_kind'],
        'unit_name': summary['unit_name'],
        'size_order': summary['size_order'],
        'size_production': summary['size_production'],
        'print_colors': summary['print_colors'],
        'operations_summary': summary['operations_summary'],
        'routing_summary': summary['routing_summary'],
        'qty_required': round_qty(qty_required if qty_required > 0 else Decimal('0')),
        'order_date': getattr(order, 'order_date', None),
        'delivery_date': delivery_date,
        'production_due_date': date_payload['production_due_date'],
        'planning_due_date': date_payload['planning_due_date'],
        'reminder_date': date_payload['reminder_date'],
        'source': SYNCED_DEMAND_SOURCE,
    }


def demand_has_downstream(demand):
    return any(
        _to_decimal(value) > 0
        for value in (demand.qty_planned, demand.qty_released, demand.qty_completed)
    )


def _cancel_reason_text(reason):
    return str(reason or '').strip() or DEMAND_CANCEL_REASON_DEFAULT


def _notes_with_reason(notes, reason):
    reason_text = _cancel_reason_text(reason)
    marker = f'[ProductionDemand] {reason_text}'
    current = str(notes or '').strip()
    if marker in current:
        return current
    return f'{current}\n{marker}'.strip()


def cancel_production_demands_for_sales_order(order, *, user=None, reason='', dry_run=False):
    result = _result(dry_run)
    reason_text = _cancel_reason_text(reason)
    demands = ProductionDemand.objects.filter(
        sales_order=order,
        source=SYNCED_DEMAND_SOURCE,
    ).order_by('id')

    for demand in demands:
        if demand_has_downstream(demand):
            if dry_run:
                result['would_hold'] += 1
                result['details'].append({'action': 'would_hold_cancel', 'demand_key': demand.demand_key, 'id': demand.id})
                continue
            demand.hold_reason = reason_text
            demand.updated_by = user
            demand.save(update_fields=['hold_reason', 'updated_by', 'updated_at'])
            result['held'] += 1
            result['details'].append({'action': 'held_cancel', 'demand_key': demand.demand_key, 'id': demand.id})
            continue

        if (
            demand.planning_status == ProductionDemandPlanningStatus.CANCELLED
            and demand.production_status == ProductionDemandProductionStatus.CANCELLED
        ):
            result['skipped'] += 1
            result['details'].append({'action': 'skipped_cancelled', 'demand_key': demand.demand_key, 'id': demand.id})
            continue

        if dry_run:
            result['would_cancel'] += 1
            result['details'].append({'action': 'would_cancel', 'demand_key': demand.demand_key, 'id': demand.id})
            continue

        demand.planning_status = ProductionDemandPlanningStatus.CANCELLED
        demand.production_status = ProductionDemandProductionStatus.CANCELLED
        demand.notes = _notes_with_reason(demand.notes, reason_text)
        demand.updated_by = user
        demand.save(update_fields=['planning_status', 'production_status', 'notes', 'updated_by', 'updated_at'])
        result['cancelled'] += 1
        result['details'].append({'action': 'cancelled', 'demand_key': demand.demand_key, 'id': demand.id})
    return result


def _payload_for_compare(payload):
    return {
        key: value
        for key, value in payload.items()
        if key not in {'demand_key'}
    }


def _payload_changed(demand, payload):
    for key, value in _payload_for_compare(payload).items():
        if key in {'sales_order', 'sales_order_line', 'delivery_plan', 'product'}:
            current = getattr(demand, f'{key}_id')
            incoming = getattr(value, 'id', None)
            if current != incoming:
                return True
            continue
        current_value = getattr(demand, key)
        if isinstance(current_value, Decimal):
            if current_value != _to_decimal(value):
                return True
        elif current_value != value:
            return True
    return False


def _status_fields_for(demand, payload):
    qty_required = payload.get('qty_required', demand.qty_required)
    return {
        'planning_status': _planning_status_for_payload(qty_required, demand.qty_planned, payload.get('planning_due_date')),
        'production_status': _production_status_for_payload(qty_required, demand.qty_released, demand.qty_completed),
    }


def upsert_production_demand(payload, *, user=None, dry_run=False):
    result = _result(dry_run)
    demand = ProductionDemand.objects.filter(demand_key=payload['demand_key']).first()
    if demand is None:
        if dry_run:
            result['would_create'] += 1
            result['details'].append({'action': 'would_create', 'demand_key': payload['demand_key']})
            return result
        with transaction.atomic():
            create_payload = dict(payload)
            create_payload.update({
                'demand_code': get_next_production_demand_code(payload.get('order_date')),
                'planning_status': _planning_status_for_payload(payload.get('qty_required'), Decimal('0'), payload.get('planning_due_date')),
                'production_status': _production_status_for_payload(payload.get('qty_required'), Decimal('0'), Decimal('0')),
                'created_by': user,
                'updated_by': user,
            })
            demand = ProductionDemand.objects.create(**create_payload)
        result['created'] += 1
        result['details'].append({'action': 'created', 'demand_key': demand.demand_key, 'id': demand.id})
        return result

    if demand_has_downstream(demand):
        if dry_run:
            result['would_hold'] += 1
            result['details'].append({'action': 'would_hold', 'demand_key': demand.demand_key, 'id': demand.id})
            return result
        demand.hold_reason = DEMAND_HOLD_REASON_SOURCE_CHANGED
        demand.updated_by = user
        demand.save(update_fields=['hold_reason', 'updated_by'])
        result['held'] += 1
        result['details'].append({'action': 'held', 'demand_key': demand.demand_key, 'id': demand.id})
        return result

    status_payload = _status_fields_for(demand, payload)
    changed = _payload_changed(demand, payload) or any(getattr(demand, key) != value for key, value in status_payload.items()) or bool(demand.hold_reason)
    if not changed:
        result['skipped'] += 1
        result['details'].append({'action': 'skipped', 'demand_key': demand.demand_key, 'id': demand.id})
        return result
    if dry_run:
        result['would_update'] += 1
        result['details'].append({'action': 'would_update', 'demand_key': demand.demand_key, 'id': demand.id})
        return result

    for key, value in payload.items():
        if key == 'demand_key':
            continue
        setattr(demand, key, value)
    for key, value in status_payload.items():
        setattr(demand, key, value)
    demand.hold_reason = ''
    demand.updated_by = user
    demand.save()
    result['updated'] += 1
    result['details'].append({'action': 'updated', 'demand_key': demand.demand_key, 'id': demand.id})
    return result


def _cancel_or_hold_stale_demands(queryset, active_keys, *, user=None, dry_run=False):
    result = _result(dry_run)
    for demand in queryset.exclude(demand_key__in=active_keys):
        if demand_has_downstream(demand):
            if dry_run:
                result['would_hold'] += 1
                result['details'].append({'action': 'would_hold_stale', 'demand_key': demand.demand_key, 'id': demand.id})
                continue
            demand.hold_reason = DEMAND_HOLD_REASON_SOURCE_CHANGED
            demand.updated_by = user
            demand.save(update_fields=['hold_reason', 'updated_by'])
            result['held'] += 1
            result['details'].append({'action': 'held_stale', 'demand_key': demand.demand_key, 'id': demand.id})
            continue
        if dry_run:
            result['would_cancel'] += 1
            result['details'].append({'action': 'would_cancel', 'demand_key': demand.demand_key, 'id': demand.id})
            continue
        demand.planning_status = ProductionDemandPlanningStatus.CANCELLED
        demand.production_status = ProductionDemandProductionStatus.CANCELLED
        demand.updated_by = user
        demand.save(update_fields=['planning_status', 'production_status', 'updated_by'])
        result['cancelled'] += 1
        result['details'].append({'action': 'cancelled', 'demand_key': demand.demand_key, 'id': demand.id})
    return result


def _line_source_payloads(line):
    plans = list(line.delivery_plans.all().order_by('delivery_date', 'id'))
    positive_plans = [plan for plan in plans if _to_decimal(plan.qty) > 0]
    if positive_plans:
        return [
            build_production_demand_payload(line.sales_order, line, delivery_plan=plan)
            for plan in positive_plans
        ]
    if not plans and _to_decimal(line.qty) > 0:
        return [build_production_demand_payload(line.sales_order, line)]
    return []


def sync_production_demands_for_sales_line(line, *, user=None, dry_run=False):
    result = _result(dry_run)
    payloads = _line_source_payloads(line)
    active_keys = {payload['demand_key'] for payload in payloads}
    for payload in payloads:
        _merge_result(result, upsert_production_demand(payload, user=user, dry_run=dry_run))
    stale_qs = ProductionDemand.objects.filter(
        sales_order_line=line,
        source=SYNCED_DEMAND_SOURCE,
    )
    _merge_result(result, _cancel_or_hold_stale_demands(stale_qs, active_keys, user=user, dry_run=dry_run))
    return result


def sync_production_demands_for_sales_order(order, *, user=None, dry_run=False):
    result = _result(dry_run)
    active_keys = set()
    lines = (
        order.lines
        .select_related('sales_order', 'sales_order__customer', 'product', 'product__unit')
        .prefetch_related('delivery_plans')
        .order_by('line_number', 'id')
    )
    for line in lines:
        payloads = _line_source_payloads(line)
        for payload in payloads:
            active_keys.add(payload['demand_key'])
            _merge_result(result, upsert_production_demand(payload, user=user, dry_run=dry_run))
    stale_qs = ProductionDemand.objects.filter(
        sales_order=order,
        source=SYNCED_DEMAND_SOURCE,
    )
    _merge_result(result, _cancel_or_hold_stale_demands(stale_qs, active_keys, user=user, dry_run=dry_run))
    return result
