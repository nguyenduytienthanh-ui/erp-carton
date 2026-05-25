from datetime import timedelta
from decimal import Decimal
from functools import lru_cache

from django.db import transaction
from django.utils import timezone

from core.models import AuditLog
from inventory.services import build_stock_balance_map
from products.readiness import build_product_routing_readiness
from production.models import (
    ProductionDemand,
    ProductionDemandPlanningStatus,
    ProductionDemandProductionStatus,
    ProductionMaterialRequirement,
    ProductionOperationBlockReason,
    ProductionShift as ProductionPlanningShift,
    ProductionOperation,
    ProductionOperationStatus,
    ProductionOrder,
    ProductionOrderStatus,
)
from sales.document_policy import round_money, round_qty
from sales.models import PeriodSequence
from sales.services import build_sales_order_line_product_snapshot


STEP_DEFINITIONS = [
    ('XA', 'Xả', 'process_xa'),
    ('IN', 'In', 'process_in'),
    ('BOI', 'Bồi', 'process_boi'),
    ('CAN_MANG', 'Cán màng', 'process_can_mang'),
    ('BE', 'Bế', 'process_be'),
    ('CHAP', 'Chạp', 'process_chap'),
    ('DONG', 'Đóng', 'process_dong'),
    ('DAN', 'Dán', 'process_dan'),
    ('KHAC', 'Khác', 'process_khac'),
]

READY_TO_DISPATCH_READY = 'READY'
READY_TO_DISPATCH_WARNING = 'WARNING'
READY_TO_DISPATCH_BLOCKER = 'BLOCKER'

READY_TO_DISPATCH_SEVERITY_ORDER = {
    READY_TO_DISPATCH_READY: 0,
    READY_TO_DISPATCH_WARNING: 1,
    READY_TO_DISPATCH_BLOCKER: 2,
}


@lru_cache(maxsize=1)
def _get_shift_catalog_map():
    # Nhánh hiện tại không còn catalog Shift động ở core, nên planner dùng bộ ca mặc định của ProductionShift.
    return {}


def build_production_product_snapshot(product, *, order_date=None, sales_order_line=None):
    if sales_order_line and getattr(sales_order_line, 'product_snapshot', None):
        snapshot = dict(sales_order_line.product_snapshot or {})
        snapshot.setdefault('product_id', getattr(product, 'id', None))
        snapshot.setdefault('code', getattr(product, 'code', None))
        snapshot.setdefault('name', getattr(product, 'name', None))
        return snapshot
    if not product:
        return {}
    return build_sales_order_line_product_snapshot(product, as_of_datetime=order_date)


def build_material_product_snapshot(product):
    if not product:
        return {}
    return {
        'product_id': product.id,
        'code': product.code,
        'name': product.name,
        'unit_id': product.unit_id,
        'unit_code': getattr(getattr(product, 'unit', None), 'code', None),
        'unit_name': getattr(getattr(product, 'unit', None), 'name', None),
        'category_id': product.category_id,
        'category_name': getattr(getattr(product, 'category', None), 'name', None),
        'cost_price': str(product.cost_price or 0),
        'sale_price': str(product.sale_price or 0),
        'description': product.description or '',
    }


def build_default_material_requirements(product, planned_qty):
    if not product:
        return []
    quantity = Decimal(str(planned_qty or 0))
    children = list(
        product.components.filter(
            is_active=True,
        ).select_related('unit', 'category').order_by('code', 'id')
    )
    requirements = []
    for index, child in enumerate(children, start=1):
        required_qty = round_qty(quantity * Decimal(str(child.component_quantity or 1)))
        requirements.append({
            'line_number': index,
            'material_product': child,
            'internal_product_code': getattr(child, 'code', '') or '',
            'product_snapshot': build_material_product_snapshot(child),
            'required_qty': required_qty,
            'issued_qty': Decimal('0'),
            'source_warehouse': None,
            'source_location': None,
            'note': f'Tự động từ thành phần {product.code}',
        })
    return requirements


def get_next_production_order_code(order_date):
    period = order_date.strftime('%Y%m')
    seq, _ = PeriodSequence.objects.get_or_create(
        doc_type='MO',
        period=period,
        defaults={'current_number': 0, 'padding': 5},
    )
    return seq.get_next_code()


def get_next_production_issue_code(issue_date):
    period = issue_date.strftime('%Y%m')
    seq, _ = PeriodSequence.objects.get_or_create(
        doc_type='PMI',
        period=period,
        defaults={'current_number': 0, 'padding': 5},
    )
    return seq.get_next_code()


def get_next_production_receipt_code(receipt_date):
    period = receipt_date.strftime('%Y%m')
    seq, _ = PeriodSequence.objects.get_or_create(
        doc_type='FGR',
        period=period,
        defaults={'current_number': 0, 'padding': 5},
    )
    return seq.get_next_code()


def build_production_order_trace_code(order, product=None):
    product_obj = product or getattr(order, 'product', None)
    product_code = getattr(product_obj, 'code', '') or ''
    order_code = getattr(order, 'code', '') or ''
    order_date = getattr(order, 'order_date', None)
    order_date_token = order_date.strftime('%Y%m%d') if order_date else timezone.localdate().strftime('%Y%m%d')
    return f'{product_code}|{order_date_token}|{order_code}'


def _to_decimal(value):
    try:
        return Decimal(str(value or 0))
    except Exception:
        return Decimal('0')


def _positive_int_or_none(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _snapshot_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {'1', 'true', 'yes', 'y', 'on'}:
            return True
        if normalized in {'0', 'false', 'no', 'n', 'off', ''}:
            return False
    return bool(value)


def _operation_rate(payload):
    return round_qty(_to_decimal(
        payload.get('applied_rate_per_hour')
        or payload.get('standard_rate_per_hour')
        or payload.get('rate_per_hour')
        or 0
    ))


def _build_operation_from_routing_step(order, item, sequence):
    step_code = str(item.get('operation_code') or '').strip()
    if not step_code or _snapshot_bool(item.get('is_active'), True) is False:
        return None
    return ProductionOperation(
        production_order=order,
        sequence=sequence,
        step_code=step_code,
        step_name=str(item.get('operation_name') or step_code).strip(),
        source_field='routing_steps',
        route_step_no=_positive_int_or_none(item.get('step_no')),
        display_step=_positive_int_or_none(item.get('display_step')),
        display_order=_positive_int_or_none(item.get('display_order')),
        step_type=str(item.get('step_type') or 'REQUIRED').strip(),
        group_code=str(item.get('group_code') or '').strip(),
        is_required=_snapshot_bool(item.get('is_required'), True),
        allow_parallel=_snapshot_bool(item.get('allow_parallel'), False),
        source_operation_code=step_code,
        rate_per_hour=_operation_rate(item),
        planned_qty=round_qty(order.planned_qty or 0),
        priority_rank=sequence * 10,
        status=ProductionOperationStatus.PENDING,
    )


def _build_operation_from_snapshot_operation(order, item, sequence):
    step_code = str(item.get('operation_code') or '').strip()
    if not step_code or _snapshot_bool(item.get('is_active'), True) is False:
        return None
    route_step_no = _positive_int_or_none(item.get('sequence')) or sequence
    return ProductionOperation(
        production_order=order,
        sequence=sequence,
        step_code=step_code,
        step_name=str(item.get('operation_name') or step_code).strip(),
        source_field='operations',
        route_step_no=route_step_no,
        display_step=sequence,
        display_order=route_step_no,
        step_type='REQUIRED',
        is_required=True,
        allow_parallel=False,
        source_operation_code=step_code,
        rate_per_hour=_operation_rate(item),
        planned_qty=round_qty(order.planned_qty or 0),
        priority_rank=sequence * 10,
        status=ProductionOperationStatus.PENDING,
    )


def _build_legacy_operations(order, snapshot):
    operations = []
    sequence = 1
    for step_code, step_name, source_field in STEP_DEFINITIONS:
        rate = _to_decimal(snapshot.get(source_field))
        if rate <= 0:
            continue
        operations.append(
            ProductionOperation(
                production_order=order,
                sequence=sequence,
                step_code=step_code,
                step_name=step_name,
                source_field=source_field,
                rate_per_hour=round_qty(rate),
                planned_qty=round_qty(order.planned_qty or 0),
                priority_rank=sequence * 10,
                status=ProductionOperationStatus.PENDING,
            )
        )
        sequence += 1
    return operations


def rebuild_production_operations(order):
    if order.pk and order.operations.filter(status__in=[ProductionOperationStatus.IN_PROGRESS, ProductionOperationStatus.DONE]).exists():
        raise ValueError('Khong the tao lai cong doan khi lenh da co cong doan dang chay hoac da hoan thanh.')
    order.operations.all().delete()
    snapshot = order.product_snapshot or {}
    operations = []
    sequence = 1
    for item in snapshot.get('routing_steps') or []:
        if not isinstance(item, dict):
            continue
        operation = _build_operation_from_routing_step(order, item, sequence)
        if operation is None:
            continue
        operations.append(operation)
        sequence += 1
    if not operations:
        sequence = 1
        for item in snapshot.get('operations') or []:
            if not isinstance(item, dict):
                continue
            operation = _build_operation_from_snapshot_operation(order, item, sequence)
            if operation is None:
                continue
            operations.append(operation)
            sequence += 1
    if not operations:
        operations = _build_legacy_operations(order, snapshot)
    if operations:
        ProductionOperation.objects.bulk_create(operations)


def _planning_status_from_date(planning_due_date):
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


def recompute_production_demand_counters(demand, user=None):
    orders = list(demand.production_orders.all())
    planned_statuses = {
        ProductionOrderStatus.DRAFT,
        ProductionOrderStatus.SUBMITTED,
        ProductionOrderStatus.APPROVED,
        ProductionOrderStatus.RELEASED,
        ProductionOrderStatus.IN_PROGRESS,
        ProductionOrderStatus.COMPLETED,
    }
    released_statuses = {
        ProductionOrderStatus.RELEASED,
        ProductionOrderStatus.IN_PROGRESS,
        ProductionOrderStatus.COMPLETED,
    }
    counted_completion_statuses = planned_statuses
    qty_planned = round_qty(sum(
        _to_decimal(order.planned_qty)
        for order in orders
        if order.status in planned_statuses
    ))
    qty_released = round_qty(sum(
        _to_decimal(order.planned_qty)
        for order in orders
        if order.status in released_statuses
    ))
    qty_completed = round_qty(sum(
        _to_decimal(order.produced_qty)
        for order in orders
        if order.status in counted_completion_statuses
    ))
    qty_required = _to_decimal(demand.qty_required)

    if demand.planning_status == ProductionDemandPlanningStatus.CANCELLED:
        planning_status = ProductionDemandPlanningStatus.CANCELLED
    elif demand.planning_status == ProductionDemandPlanningStatus.NO_PRODUCTION_NEEDED and qty_planned <= 0:
        planning_status = ProductionDemandPlanningStatus.NO_PRODUCTION_NEEDED
    elif qty_required > 0 and qty_planned >= qty_required:
        planning_status = ProductionDemandPlanningStatus.FULLY_PLANNED
    elif qty_planned > 0:
        planning_status = ProductionDemandPlanningStatus.PARTIALLY_PLANNED
    else:
        planning_status = _planning_status_from_date(demand.planning_due_date)

    if demand.production_status == ProductionDemandProductionStatus.CANCELLED:
        production_status = ProductionDemandProductionStatus.CANCELLED
    elif qty_required > 0 and qty_completed >= qty_required:
        production_status = ProductionDemandProductionStatus.COMPLETED
    elif qty_completed > 0:
        production_status = ProductionDemandProductionStatus.PARTIALLY_COMPLETED
    elif any(order.status == ProductionOrderStatus.IN_PROGRESS for order in orders):
        production_status = ProductionDemandProductionStatus.IN_PROGRESS
    elif qty_required > 0 and qty_released >= qty_required:
        production_status = ProductionDemandProductionStatus.FULLY_RELEASED
    elif qty_released > 0:
        production_status = ProductionDemandProductionStatus.PARTIALLY_RELEASED
    else:
        production_status = ProductionDemandProductionStatus.NOT_RELEASED

    demand.qty_planned = qty_planned
    demand.qty_released = qty_released
    demand.qty_completed = qty_completed
    demand.planning_status = planning_status
    demand.production_status = production_status
    update_fields = [
        'qty_planned',
        'qty_released',
        'qty_completed',
        'planning_status',
        'production_status',
        'updated_at',
    ]
    if user is not None:
        demand.updated_by = user
        update_fields.append('updated_by')
    demand.save(update_fields=update_fields)
    return demand


def recompute_production_demand_by_id(demand_id, user=None):
    if not demand_id:
        return None
    queryset = ProductionDemand.objects
    if transaction.get_connection().in_atomic_block:
        queryset = queryset.select_for_update(of=('self',))
    demand = queryset.get(pk=demand_id)
    return recompute_production_demand_counters(demand, user=user)


def recompute_linked_production_demand(order, user=None):
    return recompute_production_demand_by_id(getattr(order, 'production_demand_id', None), user=user)


def validate_production_order_can_release(order):
    if order.status != ProductionOrderStatus.APPROVED:
        raise ValueError('Lenh san xuat phai o trang thai da duyet truoc khi phat hanh.')
    planned_qty = round_qty(order.planned_qty)
    if planned_qty <= 0:
        raise ValueError('So luong ke hoach phai > 0.')
    if not order.planned_start_date or not order.planned_end_date:
        raise ValueError('Lenh san xuat thieu ngay bat dau hoac ngay ket thuc ke hoach.')
    if order.planned_end_date < order.planned_start_date:
        raise ValueError('Ngay ket thuc ke hoach khong duoc truoc ngay bat dau.')
    snapshot = order.product_snapshot or {}
    if not snapshot:
        raise ValueError('Lenh san xuat thieu snapshot san pham.')
    if not order.operations.exists():
        raise ValueError('Lenh san xuat chua co cong doan san xuat.')

    product_kind = str(snapshot.get('product_kind') or '').upper()
    if product_kind == 'GENERIC':
        if _snapshot_bool(snapshot.get('requires_order_spec'), False) and not _snapshot_bool(snapshot.get('order_spec_confirmed'), False):
            raise ValueError('San pham generic chua xac nhan quy cach dat hang.')
        if _snapshot_bool(snapshot.get('requires_order_operations_review'), False) and not _snapshot_bool(snapshot.get('order_operations_reviewed'), False):
            raise ValueError('San pham generic chua xac nhan cong doan dat hang.')

    if order.production_demand_id:
        queryset = ProductionDemand.objects
        if transaction.get_connection().in_atomic_block:
            queryset = queryset.select_for_update(of=('self',))
        demand = queryset.get(pk=order.production_demand_id)
        if (
            demand.planning_status == ProductionDemandPlanningStatus.CANCELLED
            or demand.production_status == ProductionDemandProductionStatus.CANCELLED
        ):
            raise ValueError('Nhu cau san xuat da bi huy.')
        if str(demand.hold_reason or '').strip():
            raise ValueError('Nhu cau san xuat dang tam giu.')
        released_statuses = {
            ProductionOrderStatus.RELEASED,
            ProductionOrderStatus.IN_PROGRESS,
            ProductionOrderStatus.COMPLETED,
        }
        already_released = round_qty(sum(
            _to_decimal(item.planned_qty)
            for item in demand.production_orders.exclude(pk=order.pk)
            if item.status in released_statuses
        ))
        qty_required = _to_decimal(demand.qty_required)
        if qty_required > 0 and round_qty(already_released + planned_qty) > qty_required:
            raise ValueError('Phat hanh vuot qua so luong con lai can release cua nhu cau.')
    return True


def _validate_demand_can_create_order(demand, qty):
    if (
        demand.planning_status == ProductionDemandPlanningStatus.CANCELLED
        or demand.production_status == ProductionDemandProductionStatus.CANCELLED
    ):
        raise ValueError('Nhu cau san xuat da bi huy.')
    if str(demand.hold_reason or '').strip():
        raise ValueError('Nhu cau san xuat dang tam giu.')
    planned_qty = round_qty(qty)
    if planned_qty <= 0:
        raise ValueError('So luong tao lenh phai > 0.')
    if planned_qty > demand.qty_remaining_to_plan:
        raise ValueError('So luong tao lenh vuot qua so luong con lai can lap ke hoach.')

    line = getattr(demand, 'sales_order_line', None)
    snapshot = getattr(line, 'product_snapshot', None) or {}
    product_kind = str(snapshot.get('product_kind') or demand.product_kind or '').upper()
    if product_kind == 'GENERIC':
        if _snapshot_bool(snapshot.get('requires_order_spec'), False) and not _snapshot_bool(snapshot.get('order_spec_confirmed'), False):
            raise ValueError('San pham generic chua xac nhan quy cach dat hang.')
        if _snapshot_bool(snapshot.get('requires_order_operations_review'), False) and not _snapshot_bool(snapshot.get('order_operations_reviewed'), False):
            raise ValueError('San pham generic chua xac nhan cong doan dat hang.')
    return planned_qty


def build_production_order_payload_from_demand(demand, qty, planned_start_date=None, planned_end_date=None):
    line = getattr(demand, 'sales_order_line', None)
    product = getattr(demand, 'product', None) or getattr(line, 'product', None)
    if product is None:
        raise ValueError('Nhu cau san xuat khong co san pham.')
    planned_qty = round_qty(qty)
    order_date = timezone.localdate()
    product_snapshot = build_production_product_snapshot(
        product,
        order_date=order_date,
        sales_order_line=line,
    )
    return {
        'order_date': order_date,
        'planned_start_date': planned_start_date or demand.planning_due_date,
        'planned_end_date': planned_end_date or demand.production_due_date,
        'status': ProductionOrderStatus.DRAFT,
        'production_demand': demand,
        'sales_order': demand.sales_order,
        'sales_order_line': line,
        'product': product,
        'product_snapshot': product_snapshot,
        'planned_qty': planned_qty,
        'unit_cost_estimate': Decimal(str((product_snapshot or {}).get('cost_price') or 0)),
    }


def _create_default_material_requirement_rows(order):
    for item in build_default_material_requirements(order.product, order.planned_qty):
        ProductionMaterialRequirement.objects.create(
            production_order=order,
            **item,
        )


def create_production_order_from_demand(demand, qty, planned_start_date=None, planned_end_date=None, user=None):
    with transaction.atomic():
        locked_demand = (
            ProductionDemand.objects
            .select_for_update(of=('self',))
            .select_related('sales_order', 'sales_order_line', 'sales_order_line__product', 'product')
            .get(pk=demand.pk)
        )
        recompute_production_demand_counters(locked_demand, user=user)
        locked_demand.refresh_from_db()
        planned_qty = _validate_demand_can_create_order(locked_demand, qty)
        payload = build_production_order_payload_from_demand(
            locked_demand,
            planned_qty,
            planned_start_date=planned_start_date,
            planned_end_date=planned_end_date,
        )
        payload['code'] = get_next_production_order_code(payload['order_date'])
        payload['created_by'] = user
        payload['updated_by'] = user
        payload['owner'] = user
        order = ProductionOrder.objects.create(**payload)
        _create_default_material_requirement_rows(order)
        rebuild_production_operations(order)
        order.save(update_fields=['unit_cost_estimate', 'estimated_output_value', 'updated_at'])
        recompute_production_demand_counters(locked_demand, user=user)
    return order


def add_issued_qty(requirement, quantity):
    requirement.issued_qty = round_qty(Decimal(str(requirement.issued_qty or 0)) + Decimal(str(quantity or 0)))
    requirement.save(update_fields=['issued_qty'])
    return requirement.issued_qty


def subtract_issued_qty(requirement, quantity):
    next_value = Decimal(str(requirement.issued_qty or 0)) - Decimal(str(quantity or 0))
    requirement.issued_qty = round_qty(next_value if next_value > 0 else Decimal('0'))
    requirement.save(update_fields=['issued_qty'])
    return requirement.issued_qty


def add_produced_qty(order, quantity):
    order.produced_qty = round_qty(Decimal(str(order.produced_qty or 0)) + Decimal(str(quantity or 0)))
    order.save(update_fields=['produced_qty'])
    return order.produced_qty


def subtract_produced_qty(order, quantity):
    next_value = Decimal(str(order.produced_qty or 0)) - Decimal(str(quantity or 0))
    order.produced_qty = round_qty(next_value if next_value > 0 else Decimal('0'))
    order.save(update_fields=['produced_qty'])
    return order.produced_qty


def sync_production_order_status(order, *, actor=None):
    active_issue_exists = order.issues.filter(status='POSTED').exists()
    active_receipt_exists = order.receipts.filter(status='POSTED').exists()
    operation_progress_exists = order.operations.filter(
        status__in=[ProductionOperationStatus.IN_PROGRESS, ProductionOperationStatus.DONE]
    ).exists()
    planned_qty = Decimal(str(order.planned_qty or 0))
    produced_qty = Decimal(str(order.produced_qty or 0))
    next_status = order.status
    completed_at = order.completed_at
    completed_by = order.completed_by

    if order.status in {ProductionOrderStatus.CANCELLED, ProductionOrderStatus.REJECTED}:
        return order.status

    if planned_qty > 0 and produced_qty >= planned_qty:
        next_status = ProductionOrderStatus.COMPLETED
        if completed_at is None:
            completed_at = timezone.now()
            completed_by = actor
    elif active_issue_exists or active_receipt_exists or operation_progress_exists:
        next_status = ProductionOrderStatus.IN_PROGRESS
        completed_at = None
        completed_by = None
    elif order.released_at:
        next_status = ProductionOrderStatus.RELEASED
        completed_at = None
        completed_by = None
    elif order.approved_at:
        next_status = ProductionOrderStatus.APPROVED
        completed_at = None
        completed_by = None

    updates = []
    if next_status != order.status:
        order.status = next_status
        updates.append('status')
    if completed_at != order.completed_at:
        order.completed_at = completed_at
        updates.append('completed_at')
    if completed_by != order.completed_by:
        order.completed_by = completed_by
        updates.append('completed_by')
    if updates:
        updates.append('updated_at')
        order.save(update_fields=updates)
    return order.status


def sync_order_status_and_demand_counters(order, *, actor=None):
    status = sync_production_order_status(order, actor=actor)
    recompute_linked_production_demand(order, user=actor)
    return status


def update_operation_status(operation, *, status=None, completed_qty=None, scrap_qty=None, note=None):
    update_fields = []
    if status and status != operation.status:
        operation.status = status
        update_fields.append('status')
        if status == ProductionOperationStatus.IN_PROGRESS and operation.started_at is None:
            operation.started_at = timezone.now()
            update_fields.append('started_at')
        if status in {ProductionOperationStatus.DONE, ProductionOperationStatus.SKIPPED}:
            operation.finished_at = timezone.now()
            update_fields.append('finished_at')
    if completed_qty is not None:
        operation.completed_qty = round_qty(completed_qty)
        update_fields.append('completed_qty')
    if scrap_qty is not None:
        operation.scrap_qty = round_qty(scrap_qty)
        update_fields.append('scrap_qty')
    if note is not None:
        operation.note = note
        update_fields.append('note')
    if update_fields:
        update_fields.append('updated_at')
        operation.save(update_fields=update_fields)
    return operation


def get_operation_dependency_group(operation):
    for field_name in ('display_step', 'route_step_no', 'sequence'):
        value = getattr(operation, field_name, None)
        if value is None:
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            continue
    return 0


def _operation_dependency_sort_key(operation):
    display_order = getattr(operation, 'display_order', None)
    try:
        display_order_value = int(display_order) if display_order is not None else int(getattr(operation, 'sequence', 0) or 0)
    except (TypeError, ValueError):
        display_order_value = int(getattr(operation, 'sequence', 0) or 0)
    return (
        get_operation_dependency_group(operation),
        display_order_value,
        int(getattr(operation, 'sequence', 0) or 0),
        int(getattr(operation, 'id', 0) or 0),
    )


def _ordered_dependency_operations(operations):
    return sorted(list(operations), key=_operation_dependency_sort_key)


def _operation_dependency_groups(operations):
    groups = []
    for operation in _ordered_dependency_operations(operations):
        group_key = get_operation_dependency_group(operation)
        if not groups or groups[-1][0] != group_key:
            groups.append((group_key, []))
        groups[-1][1].append(operation)
    return groups


def _operation_identity_matches(left, right):
    left_id = getattr(left, 'id', None)
    right_id = getattr(right, 'id', None)
    if left_id is not None and right_id is not None:
        return int(left_id) == int(right_id)
    return int(getattr(left, 'sequence', 0) or 0) == int(getattr(right, 'sequence', 0) or 0)


def _is_operation_dependency_complete(operation):
    return getattr(operation, 'status', None) in {
        ProductionOperationStatus.DONE,
        ProductionOperationStatus.SKIPPED,
    }


def _find_operation_dependency_group(operation, groups):
    for index, (_group_key, group_operations) in enumerate(groups):
        for candidate in group_operations:
            if _operation_identity_matches(candidate, operation):
                return index, group_operations
    return None, []


def can_start_production_operation(operation, *, operations=None):
    operation_rows = list(
        operations
        if operations is not None
        else ProductionOperation.objects.filter(production_order=operation.production_order).order_by('sequence')
    )
    dependency_state, previous_step, _next_step = get_operation_dependency_state(operation, operations=operation_rows)
    if dependency_state in {'ROOT', 'CLEAR'}:
        return True, ''
    previous_label = getattr(previous_step, 'step_name', None) or getattr(previous_step, 'step_code', None) or 'cong doan truoc'
    return False, f'Cong doan nay dang cho {previous_label} hoan thanh.'


def validate_operation_status_transition(operation, next_status, *, operations=None):
    if not next_status or next_status == getattr(operation, 'status', None):
        return True
    if next_status in {
        ProductionOperationStatus.READY,
        ProductionOperationStatus.IN_PROGRESS,
        ProductionOperationStatus.DONE,
        ProductionOperationStatus.SKIPPED,
    }:
        can_start, reason = can_start_production_operation(operation, operations=operations)
        if not can_start:
            raise ValueError(reason)
    return True


def advance_ready_operations(order, *, operations=None):
    operation_rows = list(
        operations
        if operations is not None
        else ProductionOperation.objects.filter(production_order=order).order_by('sequence')
    )
    groups = _operation_dependency_groups(operation_rows)
    for _group_key, group_operations in groups:
        if all(_is_operation_dependency_complete(operation) for operation in group_operations):
            continue
        pending_ids = [
            operation.id
            for operation in group_operations
            if operation.id and operation.status == ProductionOperationStatus.PENDING
        ]
        if not pending_ids:
            return 0
        updated_count = ProductionOperation.objects.filter(
            production_order=order,
            id__in=pending_ids,
            status=ProductionOperationStatus.PENDING,
        ).update(
            status=ProductionOperationStatus.READY,
            updated_at=timezone.now(),
        )
        for operation in group_operations:
            if operation.id in pending_ids:
                operation.status = ProductionOperationStatus.READY
        return updated_count
    return 0


def get_shift_label(value):
    shift_key = str(value or '').strip().upper()
    shift = _get_shift_catalog_map().get(shift_key)
    if shift:
        return str(shift.name or shift.short_label or shift_key)
    return dict(ProductionPlanningShift.CHOICES).get(shift_key, '')


def get_block_reason_label(value):
    return dict(ProductionOperationBlockReason.CHOICES).get(str(value or ''), '')


EXECUTION_HANDOFF_AUDIT_ACTIONS = {
    'UPDATE',
    'SIGNAL',
    'HANDOVER',
    'SKIP_OPERATION',
}

EXECUTION_HANDOFF_ACTION_LABELS = {
    'UPDATE': 'Cap nhat cong doan',
    'SIGNAL': 'Tin hieu shop floor',
    'HANDOVER': 'Chot handover',
    'SKIP_OPERATION': 'Bo qua cong doan',
}


def _display_user(user):
    if not user:
        return ''
    full_name = str(getattr(user, 'get_full_name', lambda: '')() or '').strip()
    return full_name or getattr(user, 'username', '') or ''


def _execution_state(operation):
    if str(getattr(operation, 'block_reason_code', '') or '').strip():
        return 'blocked'
    if str(getattr(operation, 'handover_status', '') or '').strip():
        return 'handover'
    return str(getattr(operation, 'status', '') or '').strip().lower().replace('_', '-')


def _audit_last_note(audit_log):
    if audit_log is None:
        return ''
    new_values = audit_log.new_values if isinstance(audit_log.new_values, dict) else {}
    action = str(getattr(audit_log, 'action', '') or '').strip().upper()
    if action == 'HANDOVER':
        return str(new_values.get('handover_note') or '').strip()
    if action == 'SIGNAL':
        return str(new_values.get('block_reason_note') or new_values.get('handover_note') or new_values.get('signal_code') or '').strip()
    if action == 'SKIP_OPERATION':
        return str(new_values.get('reason') or '').strip()
    if action == 'UPDATE':
        return str(
            new_values.get('block_reason_note')
            or new_values.get('note')
            or new_values.get('status')
            or ''
        ).strip()
    return ''


def build_operation_execution_handoff(operation, *, latest_audit=None):
    status_value = str(getattr(operation, 'status', '') or '').strip()
    handover_status = str(getattr(operation, 'handover_status', '') or '').strip()
    block_reason_code = str(getattr(operation, 'block_reason_code', '') or '').strip()
    skipped_by = getattr(operation, 'skipped_by', None)
    action = str(getattr(latest_audit, 'action', '') or '').strip().upper() if latest_audit else ''
    return {
        'state': _execution_state(operation),
        'status': status_value,
        'status_label': getattr(operation, 'get_status_display', lambda: '')() or '',
        'is_active_execution': status_value in {ProductionOperationStatus.READY, ProductionOperationStatus.IN_PROGRESS},
        'is_terminal': status_value in {ProductionOperationStatus.DONE, ProductionOperationStatus.SKIPPED},
        'is_blocked': bool(block_reason_code),
        'block_reason_code': block_reason_code,
        'block_reason_label': get_block_reason_label(block_reason_code),
        'block_reason_note': getattr(operation, 'block_reason_note', '') or '',
        'dispatch_owner': getattr(operation, 'dispatch_owner', '') or '',
        'handover_status': handover_status,
        'handover_status_label': getattr(operation, 'get_handover_status_display', lambda: '')() or '',
        'handover_receiver': getattr(operation, 'handover_receiver', '') or '',
        'handover_note': getattr(operation, 'handover_note', '') or '',
        'handover_at': getattr(operation, 'handover_at', None),
        'skip_reason': getattr(operation, 'skip_reason', '') or '',
        'skipped_at': getattr(operation, 'skipped_at', None),
        'skipped_by': getattr(operation, 'skipped_by_id', None),
        'skipped_by_display': _display_user(skipped_by),
        'last_action': action,
        'last_action_label': EXECUTION_HANDOFF_ACTION_LABELS.get(action, action),
        'last_actor': _display_user(getattr(latest_audit, 'user', None)) if latest_audit else '',
        'last_at': getattr(latest_audit, 'created_at', None) if latest_audit else None,
        'last_note': _audit_last_note(latest_audit),
        'audit_available': latest_audit is not None,
        'advisory_only': True,
        'workflow_blocking': False,
    }


def attach_execution_handoff_payloads(operations):
    operation_rows = [operation for operation in operations if getattr(operation, 'id', None)]
    if not operation_rows:
        return operations
    operation_ids = [int(operation.id) for operation in operation_rows]
    latest_by_operation = {}
    audit_rows = (
        AuditLog.objects
        .filter(
            entity_type='ProductionOperation',
            entity_id__in=operation_ids,
            action__in=EXECUTION_HANDOFF_AUDIT_ACTIONS,
        )
        .select_related('user')
        .order_by('entity_id', '-created_at', '-id')
    )
    for audit in audit_rows:
        latest_by_operation.setdefault(int(audit.entity_id), audit)
    for operation in operation_rows:
        setattr(
            operation,
            '_execution_handoff',
            build_operation_execution_handoff(
                operation,
                latest_audit=latest_by_operation.get(int(operation.id)),
            ),
        )
    return operations


def get_shift_capacity_hours(value):
    shift_key = str(value or '').strip().upper()
    shift = _get_shift_catalog_map().get(shift_key)
    if shift is not None:
        return Decimal(str(getattr(shift, 'capacity_hours', 0) or 0))
    return {
        ProductionPlanningShift.MORNING: Decimal('8'),
        ProductionPlanningShift.AFTERNOON: Decimal('8'),
        ProductionPlanningShift.EVENING: Decimal('6'),
        ProductionPlanningShift.NIGHT: Decimal('8'),
        ProductionPlanningShift.FULLDAY: Decimal('16'),
    }.get(shift_key, Decimal('0'))


def get_operation_runtime_hours(operation):
    return Decimal(str(getattr(operation, 'estimated_runtime_hours', 0) or 0))


def get_operation_setup_hours(operation):
    return Decimal(str(getattr(operation, 'setup_minutes', 0) or 0)) / Decimal('60')


def get_operation_scheduled_hours(operation):
    return round_qty(get_operation_runtime_hours(operation) + get_operation_setup_hours(operation))


def get_order_material_readiness(order, requirements=None):
    requirement_rows = list(requirements if requirements is not None else order.material_requirements.all())
    if not requirement_rows:
        return 'READY'
    remaining_exists = False
    partial_exists = False
    for requirement in requirement_rows:
        required_qty = Decimal(str(getattr(requirement, 'required_qty', 0) or 0))
        issued_qty = Decimal(str(getattr(requirement, 'issued_qty', 0) or 0))
        if issued_qty > 0:
            partial_exists = True
        if issued_qty < required_qty:
            remaining_exists = True
    if not remaining_exists:
        return 'READY'
    return 'PARTIAL' if partial_exists else 'WAITING'


def _ready_to_dispatch_issue(code, severity, category, message, *, details=None):
    return {
        'code': code,
        'severity': severity,
        'category': category,
        'message': message,
        'workflow_blocking': False,
        'details': details or {},
    }


def _ready_to_dispatch_status_from_issues(issues):
    status = READY_TO_DISPATCH_READY
    for item in issues:
        severity = item.get('severity') or READY_TO_DISPATCH_READY
        if READY_TO_DISPATCH_SEVERITY_ORDER.get(severity, 0) > READY_TO_DISPATCH_SEVERITY_ORDER.get(status, 0):
            status = severity
    return status


def _requirement_remaining_issue_qty(requirement):
    remaining = getattr(requirement, 'remaining_issue_qty', None)
    if remaining is not None:
        return Decimal(str(remaining or 0))
    required_qty = Decimal(str(getattr(requirement, 'required_qty', 0) or 0))
    issued_qty = Decimal(str(getattr(requirement, 'issued_qty', 0) or 0))
    remaining = required_qty - issued_qty
    return round_qty(remaining if remaining > 0 else Decimal('0'))


def _stock_available_for_requirement(requirement, stock_balances):
    product_id = getattr(requirement, 'material_product_id', None)
    warehouse_id = getattr(requirement, 'source_warehouse_id', None)
    if not product_id or not warehouse_id:
        return None
    location_id = getattr(requirement, 'source_location_id', None)
    if location_id:
        row = stock_balances.get((int(product_id), int(warehouse_id), int(location_id)), {})
        return Decimal(str(row.get('on_hand', 0) or 0)) - Decimal(str(row.get('reserved', 0) or 0))
    available_qty = Decimal('0')
    for (row_product_id, row_warehouse_id, _row_location_id), row in stock_balances.items():
        if int(row_product_id) == int(product_id) and int(row_warehouse_id) == int(warehouse_id):
            available_qty += Decimal(str(row.get('on_hand', 0) or 0)) - Decimal(str(row.get('reserved', 0) or 0))
    return available_qty


def build_material_source_readiness_issues(requirements, *, stock_balances=None):
    requirement_rows = [
        requirement
        for requirement in requirements
        if _requirement_remaining_issue_qty(requirement) > 0
    ]
    issues = []
    if not requirement_rows:
        return issues

    if stock_balances is None:
        product_ids = {
            getattr(requirement, 'material_product_id', None)
            for requirement in requirement_rows
            if getattr(requirement, 'material_product_id', None)
        }
        warehouse_ids = {
            getattr(requirement, 'source_warehouse_id', None)
            for requirement in requirement_rows
            if getattr(requirement, 'source_warehouse_id', None)
        }
        stock_balances = build_stock_balance_map(
            product_ids=product_ids or None,
            warehouse_ids=warehouse_ids or None,
        ) if product_ids and warehouse_ids else {}

    for requirement in requirement_rows:
        remaining_qty = round_qty(_requirement_remaining_issue_qty(requirement))
        details = {
            'requirement_id': getattr(requirement, 'id', None),
            'material_product_id': getattr(requirement, 'material_product_id', None),
            'source_warehouse_id': getattr(requirement, 'source_warehouse_id', None),
            'source_location_id': getattr(requirement, 'source_location_id', None),
            'remaining_issue_qty': str(remaining_qty),
        }
        if not getattr(requirement, 'source_warehouse_id', None):
            issues.append(_ready_to_dispatch_issue(
                'MATERIAL_SOURCE_MISSING',
                READY_TO_DISPATCH_WARNING,
                'material',
                'Chua xac dinh kho nguon cho vat tu chua cap.',
                details=details,
            ))
            continue

        available_qty = _stock_available_for_requirement(requirement, stock_balances)
        if available_qty is not None:
            available_qty = round_qty(available_qty)
            details['available_qty'] = str(available_qty)
            if available_qty < remaining_qty:
                issues.append(_ready_to_dispatch_issue(
                    'MATERIAL_SOURCE_STOCK_LOW',
                    READY_TO_DISPATCH_WARNING,
                    'material',
                    'Ton kha dung tai kho nguon khong du cho vat tu chua cap.',
                    details=details,
                ))
    return issues


def build_ready_to_dispatch_advisory(
    *,
    operation_status,
    block_reason_code,
    dependency_state,
    material_readiness,
    product_readiness=None,
    capacity_state='BALANCED',
    planned_date=None,
    planned_shift=None,
    material_source_issues=None,
):
    issues = []
    normalized_status = str(operation_status or '').strip().upper()
    normalized_block_reason = str(block_reason_code or '').strip().upper()
    normalized_dependency = str(dependency_state or '').strip().upper()
    normalized_material = str(material_readiness or '').strip().upper()
    normalized_capacity = str(capacity_state or '').strip().upper() or 'BALANCED'

    if normalized_status in {ProductionOperationStatus.DONE, ProductionOperationStatus.SKIPPED}:
        issues.append(_ready_to_dispatch_issue(
            'OPERATION_INACTIVE',
            READY_TO_DISPATCH_BLOCKER,
            'operation',
            'Cong doan da dong hoac da bo qua, khong con nam trong hang dispatch.',
        ))

    product_status = str((product_readiness or {}).get('status') or READY_TO_DISPATCH_READY).strip().upper()
    if product_status == READY_TO_DISPATCH_BLOCKER:
        issues.append(_ready_to_dispatch_issue(
            'PRODUCT_READINESS_BLOCKER',
            READY_TO_DISPATCH_BLOCKER,
            'product',
            'Product/routing readiness dang co loi chan.',
            details={'product_readiness_status': product_status},
        ))
    elif product_status == READY_TO_DISPATCH_WARNING:
        issues.append(_ready_to_dispatch_issue(
            'PRODUCT_READINESS_WARNING',
            READY_TO_DISPATCH_WARNING,
            'product',
            'Product/routing readiness dang co canh bao.',
            details={'product_readiness_status': product_status},
        ))

    if normalized_dependency == 'WAIT_PREVIOUS_STEP':
        issues.append(_ready_to_dispatch_issue(
            'WAIT_PREVIOUS_STEP',
            READY_TO_DISPATCH_BLOCKER,
            'dependency',
            'Cong doan dang cho cong doan truoc hoan tat.',
        ))
    if normalized_block_reason:
        issues.append(_ready_to_dispatch_issue(
            'BLOCK_REASON_ACTIVE',
            READY_TO_DISPATCH_BLOCKER,
            'operation',
            'Cong doan dang co ly do khoa/canh bao tren shop floor.',
            details={'block_reason_code': normalized_block_reason},
        ))
    if normalized_material and normalized_material != 'READY':
        issues.append(_ready_to_dispatch_issue(
            'MATERIAL_NOT_READY',
            READY_TO_DISPATCH_WARNING,
            'material',
            'Vat tu chua duoc cap day du.',
            details={'material_readiness': normalized_material},
        ))
    if not planned_date or not str(planned_shift or '').strip():
        issues.append(_ready_to_dispatch_issue(
            'SCHEDULE_MISSING',
            READY_TO_DISPATCH_WARNING,
            'planning',
            'Cong doan chua co ngay hoac ca san xuat.',
        ))

    capacity_issue_map = {
        'UNASSIGNED_WORK_CENTER': (
            'WORK_CENTER_MISSING',
            'resource',
            'Cong doan chua gan to/work center.',
        ),
        'UNASSIGNED_MACHINE': (
            'MACHINE_MISSING',
            'resource',
            'Cong doan chua gan may.',
        ),
        'OVER_CAPACITY': (
            'CAPACITY_OVER_CAPACITY',
            'capacity',
            'Tai cong suat dang vuot gio kha dung.',
        ),
        'AT_LIMIT': (
            'CAPACITY_AT_LIMIT',
            'capacity',
            'Tai cong suat dang gan cham nguong.',
        ),
    }
    if normalized_capacity in capacity_issue_map:
        code, category, message = capacity_issue_map[normalized_capacity]
        issues.append(_ready_to_dispatch_issue(
            code,
            READY_TO_DISPATCH_WARNING,
            category,
            message,
            details={'capacity_state': normalized_capacity},
        ))

    for issue in material_source_issues or []:
        issues.append(issue)

    advisory_status = _ready_to_dispatch_status_from_issues(issues)
    blocker_count = sum(1 for item in issues if item.get('severity') == READY_TO_DISPATCH_BLOCKER)
    warning_count = sum(1 for item in issues if item.get('severity') == READY_TO_DISPATCH_WARNING)
    return {
        'status': advisory_status,
        'is_ready': advisory_status == READY_TO_DISPATCH_READY,
        'workflow_blocking': False,
        'summary': {
            'blocker_count': blocker_count,
            'warning_count': warning_count,
            'issue_count': len(issues),
            'product_readiness_status': product_status,
            'material_readiness': normalized_material,
            'dependency_state': normalized_dependency,
            'capacity_state': normalized_capacity,
        },
        'issues': issues,
        'rules': {
            'advisory_only': True,
            'workflow_enforced': False,
            'product_readiness_blocker': READY_TO_DISPATCH_BLOCKER,
            'dependency_wait_previous_step': READY_TO_DISPATCH_BLOCKER,
            'block_reason_active': READY_TO_DISPATCH_BLOCKER,
            'operation_done_or_skipped': READY_TO_DISPATCH_BLOCKER,
            'material_or_capacity_warning': READY_TO_DISPATCH_WARNING,
        },
    }


def get_operation_dependency_state(operation, operations=None):
    operation_rows = list(
        operations
        if operations is not None
        else ProductionOperation.objects.filter(production_order=operation.production_order).order_by('sequence')
    )
    groups = _operation_dependency_groups(operation_rows)
    group_index, _group_operations = _find_operation_dependency_group(operation, groups)
    if group_index is None:
        return 'ROOT', None, None
    next_step = groups[group_index + 1][1][0] if group_index + 1 < len(groups) else None
    if group_index == 0:
        return 'ROOT', None, next_step
    previous_groups = groups[:group_index]
    previous_step = previous_groups[-1][1][-1] if previous_groups else None
    for _previous_key, previous_operations in previous_groups:
        for previous_operation in previous_operations:
            if not _is_operation_dependency_complete(previous_operation):
                return 'WAIT_PREVIOUS_STEP', previous_operation, next_step
    return 'CLEAR', previous_step, next_step


def get_operation_risk_state(operation, *, material_readiness=None, dependency_state=None, today=None):
    current_date = today or timezone.localdate()
    if operation.status in {ProductionOperationStatus.DONE, ProductionOperationStatus.SKIPPED}:
        return 'DONE'
    if not getattr(operation, 'planned_date', None):
        return 'UNSCHEDULED'
    if operation.planned_date < current_date:
        return 'OVERDUE'
    if (
        str(getattr(operation, 'block_reason_code', '') or '').strip()
        or dependency_state == 'WAIT_PREVIOUS_STEP'
        or material_readiness in {'WAITING', 'PARTIAL'}
    ):
        return 'BLOCKED'
    if operation.planned_date == current_date and operation.status == ProductionOperationStatus.PENDING:
        return 'AT_RISK'
    return 'ON_TRACK'


def build_operation_planning_snapshot(
    operation,
    *,
    order=None,
    requirements=None,
    operations=None,
    today=None,
    include_dispatch_readiness=False,
):
    production_order = order or operation.production_order
    current_date = today or timezone.localdate()
    operation_rows = list(operations if operations is not None else production_order.operations.all())
    requirement_rows = list(requirements if requirements is not None else production_order.material_requirements.all())
    material_readiness = get_order_material_readiness(production_order, requirements=requirement_rows)
    product_readiness = None
    material_source_issues = []
    if include_dispatch_readiness:
        product_readiness = build_product_routing_readiness(production_order.product) if production_order.product_id else None
        material_source_issues = build_material_source_readiness_issues(requirement_rows)
    dependency_state, previous_step, next_step = get_operation_dependency_state(operation, operations=operation_rows)
    risk_state = get_operation_risk_state(
        operation,
        material_readiness=material_readiness,
        dependency_state=dependency_state,
        today=current_date,
    )
    remaining_issue_qty = Decimal('0')
    remaining_issue_line_count = 0
    for requirement in requirement_rows:
        required_qty = Decimal(str(getattr(requirement, 'required_qty', 0) or 0))
        issued_qty = Decimal(str(getattr(requirement, 'issued_qty', 0) or 0))
        remaining = required_qty - issued_qty
        if remaining > 0:
            remaining_issue_line_count += 1
            remaining_issue_qty += remaining
    return {
        'planned_shift_label': get_shift_label(getattr(operation, 'planned_shift', '')),
        'block_reason_label': get_block_reason_label(getattr(operation, 'block_reason_code', '')),
        'material_readiness': material_readiness,
        'product_readiness': product_readiness,
        'material_source_issues': material_source_issues,
        'dependency_state': dependency_state,
        'risk_state': risk_state,
        'previous_step_code': getattr(previous_step, 'step_code', None),
        'previous_step_name': getattr(previous_step, 'step_name', None),
        'next_step_code': getattr(next_step, 'step_code', None),
        'next_step_name': getattr(next_step, 'step_name', None),
        'remaining_issue_qty': round_qty(remaining_issue_qty),
        'remaining_issue_line_count': remaining_issue_line_count,
        'scheduled_hours': get_operation_scheduled_hours(operation),
        'runtime_hours': get_operation_runtime_hours(operation),
        'setup_hours': get_operation_setup_hours(operation),
        'shift_capacity_hours': get_shift_capacity_hours(getattr(operation, 'planned_shift', '')),
    }


def validate_skip_production_operation(operation, user, reason):
    reason_text = str(reason or '').strip()
    if not reason_text:
        raise ValueError('Bat buoc nhap ly do bo qua cong doan.')
    max_length = ProductionOperation._meta.get_field('skip_reason').max_length
    if len(reason_text) > max_length:
        raise ValueError(f'Ly do bo qua cong doan khong duoc vuot qua {max_length} ky tu.')
    if not getattr(operation, 'production_order_id', None):
        raise ValueError('Cong doan khong thuoc lenh san xuat hop le.')
    if operation.status not in {
        ProductionOperationStatus.PENDING,
        ProductionOperationStatus.READY,
        ProductionOperationStatus.IN_PROGRESS,
    }:
        if operation.status == ProductionOperationStatus.DONE:
            raise ValueError('Cong doan da hoan thanh, khong the bo qua.')
        if operation.status == ProductionOperationStatus.SKIPPED:
            raise ValueError('Cong doan da duoc bo qua truoc do.')
        raise ValueError('Trang thai cong doan khong cho phep bo qua.')
    return reason_text


def skip_production_operation(operation, user, reason):
    reason_text = validate_skip_production_operation(operation, user, reason)
    order = operation.production_order
    operation_rows = list(order.operations.all().order_by('sequence'))
    dependency_state, previous_step, _next_step = get_operation_dependency_state(operation, operations=operation_rows)
    previous_status = operation.status
    previous_block_reason_code = operation.block_reason_code or ''
    previous_block_reason_note = operation.block_reason_note or ''
    now = timezone.now()

    operation.status = ProductionOperationStatus.SKIPPED
    if operation.finished_at is None:
        operation.finished_at = now
    operation.skipped_at = now
    operation.skipped_by = user
    operation.skip_reason = reason_text
    operation.block_reason_code = ''
    operation.block_reason_note = ''
    operation.save(update_fields=[
        'status',
        'finished_at',
        'skipped_at',
        'skipped_by',
        'skip_reason',
        'block_reason_code',
        'block_reason_note',
        'updated_at',
    ])

    advance_ready_operations(order)
    sync_order_status_and_demand_counters(order, actor=user)
    demand = None
    if getattr(order, 'production_demand_id', None):
        demand = ProductionDemand.objects.filter(pk=order.production_demand_id).first()

    audit = AuditLog.objects.create(
        user=user,
        action='SKIP_OPERATION',
        entity_type='ProductionOperation',
        entity_id=int(operation.id),
        entity_code=f'{order.code}-OP{operation.sequence}',
        old_values={
            'status': previous_status,
            'block_reason_code': previous_block_reason_code,
            'block_reason_note': previous_block_reason_note,
        },
        new_values={
            'operation_id': int(operation.id),
            'operation_code': operation.step_code or '',
            'operation_name': operation.step_name or '',
            'production_order_id': int(order.id),
            'production_order_code': order.code or '',
            'previous_status': previous_status,
            'new_status': operation.status,
            'reason': reason_text,
            'dependency_state': dependency_state,
            'route_step_no': operation.route_step_no,
            'display_step': operation.display_step,
            'group_code': operation.group_code or '',
            'skipped_by': getattr(user, 'username', '') if user else '',
            'skipped_at': now.isoformat(),
            'previous_step_code': getattr(previous_step, 'step_code', None),
            'previous_step_name': getattr(previous_step, 'step_name', None),
        },
        changed_fields=[
            'status',
            'finished_at',
            'skipped_at',
            'skipped_by',
            'skip_reason',
            'block_reason_code',
            'block_reason_note',
        ],
    )
    operation.refresh_from_db()
    order.refresh_from_db()
    return {
        'operation': operation,
        'order': order,
        'production_demand': demand,
        'audit': audit,
    }


def estimate_material_requirement_cost(requirement):
    snapshot_cost = Decimal(str((requirement.product_snapshot or {}).get('cost_price') or 0))
    return round_money(snapshot_cost * Decimal(str(requirement.required_qty or 0)))
