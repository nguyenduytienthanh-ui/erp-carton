from decimal import Decimal

from django.utils import timezone

from production.models import (
    ProductionOperation,
    ProductionOperationStatus,
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


def rebuild_production_operations(order):
    order.operations.all().delete()
    snapshot = order.product_snapshot or {}
    operations = []
    sequence = 1
    for step_code, step_name, source_field in STEP_DEFINITIONS:
        raw_rate = snapshot.get(source_field)
        try:
            rate = Decimal(str(raw_rate or 0))
        except Exception:
            rate = Decimal('0')
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
                status=ProductionOperationStatus.PENDING,
            )
        )
        sequence += 1
    if operations:
        ProductionOperation.objects.bulk_create(operations)


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


def estimate_material_requirement_cost(requirement):
    snapshot_cost = Decimal(str((requirement.product_snapshot or {}).get('cost_price') or 0))
    return round_money(snapshot_cost * Decimal(str(requirement.required_qty or 0)))
