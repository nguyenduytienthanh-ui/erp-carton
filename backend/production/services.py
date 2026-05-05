from datetime import timedelta
from decimal import Decimal
from functools import lru_cache

from django.db import transaction
from django.utils import timezone

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


def get_shift_label(value):
    shift_key = str(value or '').strip().upper()
    shift = _get_shift_catalog_map().get(shift_key)
    if shift:
        return str(shift.name or shift.short_label or shift_key)
    return dict(ProductionPlanningShift.CHOICES).get(shift_key, '')


def get_block_reason_label(value):
    return dict(ProductionOperationBlockReason.CHOICES).get(str(value or ''), '')


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


def get_operation_dependency_state(operation, operations=None):
    operation_rows = list(operations if operations is not None else operation.production_order.operations.all())
    previous = None
    next_step = None
    for index, candidate in enumerate(operation_rows):
        if int(getattr(candidate, 'id', 0) or 0) != int(getattr(operation, 'id', 0) or 0):
            continue
        if index > 0:
            previous = operation_rows[index - 1]
        if index + 1 < len(operation_rows):
            next_step = operation_rows[index + 1]
        break
    if previous is None:
        return 'ROOT', None, next_step
    if previous.status in {ProductionOperationStatus.DONE, ProductionOperationStatus.SKIPPED}:
        return 'CLEAR', previous, next_step
    return 'WAIT_PREVIOUS_STEP', previous, next_step


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


def build_operation_planning_snapshot(operation, *, order=None, requirements=None, operations=None, today=None):
    production_order = order or operation.production_order
    current_date = today or timezone.localdate()
    operation_rows = list(operations if operations is not None else production_order.operations.all())
    requirement_rows = list(requirements if requirements is not None else production_order.material_requirements.all())
    material_readiness = get_order_material_readiness(production_order, requirements=requirement_rows)
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


def estimate_material_requirement_cost(requirement):
    snapshot_cost = Decimal(str((requirement.product_snapshot or {}).get('cost_price') or 0))
    return round_money(snapshot_cost * Decimal(str(requirement.required_qty or 0)))
