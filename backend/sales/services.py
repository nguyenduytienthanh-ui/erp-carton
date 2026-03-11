"""
Services chứng từ: code theo kỳ, snapshot, post atomic + idempotent.
"""
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.conf import settings

from core.models import WorkflowDefinition, ApprovalHistory, AuditLog, Task
from core.mixins import get_client_ip
from products.price_services import resolve_product_price_as_of
from sales.models import (
    SalesOrder,
    SalesOrderLine,
    SalesOrderPostingLog,
    PeriodSequence,
    SalesOrderStatus,
    SalesOrderDeliveryPlan,
)


AUTO_SHIPMENT_PLAN_NOTE = '[AUTO-SHIP]'


def _normalize_price_as_of(as_of_datetime):
    if as_of_datetime is None:
        return timezone.now()
    if isinstance(as_of_datetime, datetime):
        value = as_of_datetime
    else:
        value = datetime.combine(as_of_datetime, time.max)
    if timezone.is_naive(value):
        value = timezone.make_aware(value, timezone.get_current_timezone())
    return value


def build_sales_order_line_trace_code(order, product, line_number):
    product_code = getattr(product, 'code', '') or ''
    order_code = getattr(order, 'code', '') or ''
    order_date = getattr(order, 'order_date', None)
    order_date_token = order_date.strftime('%Y%m%d') if order_date else timezone.localdate().strftime('%Y%m%d')
    line_token = str(line_number or 0).zfill(3)
    return f'{product_code}|{order_date_token}|{order_code}|L{line_token}'


def build_sales_order_line_package_trace_code(line_trace_code, package_index):
    base_code = str(line_trace_code or '').strip()
    package_token = str(package_index or 0).zfill(3)
    return f'{base_code}|C{package_token}' if base_code else f'C{package_token}'


def build_shipment_package_trace_code(line_trace_code, shipment_code, package_index):
    base_code = str(line_trace_code or '').strip()
    shipment_token = str(shipment_code or '').strip()
    package_token = str(package_index or 0).zfill(3)
    if base_code and shipment_token:
        return f'{base_code}|{shipment_token}|C{package_token}'
    if base_code:
        return f'{base_code}|C{package_token}'
    if shipment_token:
        return f'{shipment_token}|C{package_token}'
    return f'C{package_token}'


def build_shipment_package_code(shipment_code, line_number, package_index):
    shipment_token = str(shipment_code or '').strip()
    line_token = str(line_number or 0).zfill(3)
    package_token = str(package_index or 0).zfill(3)
    return f'{shipment_token}-L{line_token}-P{package_token}' if shipment_token else f'L{line_token}-P{package_token}'


def build_sales_order_line_product_snapshot(product, as_of_datetime=None):
    if not product:
        return {}
    as_of = _normalize_price_as_of(as_of_datetime)
    bundle = None
    primary_product = None
    base_pricing = resolve_product_price_as_of(product, as_of)
    resolved_cost_price = base_pricing['cost_price'] or Decimal('0')
    resolved_sale_price = base_pricing['sale_price'] or Decimal('0')
    resolved_commission_per_unit = base_pricing['commission_per_unit'] or Decimal('0')
    resolved_commission_percent = base_pricing['commission_percent'] or Decimal('0')
    bundle_components = []
    bundle_pricing_mode = None
    bundle_commission_mode = None
    bundle_delivery_rule = None
    bundle_primary_product_id = None
    bundle_primary_product_name = None
    try:
        bundle = product.bundle_config
    except Exception:
        bundle = None
    if bundle and bundle.is_active:
        primary_product = bundle.get_primary_product()
        resolved_cost_price = bundle.resolve_cost_price(as_of)
        resolved_sale_price = bundle.resolve_sale_price(as_of)
        resolved_commission_per_unit = bundle.resolve_commission_per_unit(as_of)
        resolved_commission_percent = bundle.resolve_commission_percent(as_of)
        bundle_pricing_mode = bundle.pricing_mode
        bundle_commission_mode = bundle.get_commission_mode()
        bundle_delivery_rule = bundle.delivery_rule
        bundle_primary_product_id = primary_product.id if primary_product else None
        bundle_primary_product_name = primary_product.name if primary_product else None
        bundle_components = [
            {
                'component_product_id': component.component_product_id,
                'component_product_code': component.component_product.code,
                'component_product_name': component.component_product.name,
                'qty_per_bundle': str(component.qty_per_bundle or 0),
                'unit_name': getattr(getattr(component.component_product, 'unit', None), 'name', None),
                'is_required': component.is_required,
            }
            for component in bundle.get_active_components()
        ]
    return {
        'product_id': product.id,
        'code': product.code,
        'name': product.name,
        'category_id': product.category_id,
        'category_name': getattr(getattr(product, 'category', None), 'name', None),
        'unit_id': product.unit_id,
        'unit_name': getattr(getattr(product, 'unit', None), 'name', None),
        'description': product.description or '',
        'size_order': product.size_order or '',
        'size_production': product.size_production or '',
        'wave_id': product.wave_id,
        'wave_code': getattr(getattr(product, 'wave', None), 'code', None),
        'wave_name': getattr(getattr(product, 'wave', None), 'name', None),
        'box_type_id': product.box_type_id,
        'box_type_code': getattr(getattr(product, 'box_type', None), 'code', None),
        'box_type_name': getattr(getattr(product, 'box_type', None), 'name', None),
        'standalone_cost_price': str(base_pricing['cost_price'] or 0),
        'standalone_sale_price': str(base_pricing['sale_price'] or 0),
        'standalone_commission_per_unit': str(base_pricing['commission_per_unit'] or 0),
        'standalone_commission_percent': str(base_pricing['commission_percent'] or 0),
        'cost_price': str(resolved_cost_price),
        'sale_price': str(resolved_sale_price),
        'min_stock': str(product.min_stock or 0),
        'delivery_tolerance': product.delivery_tolerance or '',
        'commission_per_unit': str(resolved_commission_per_unit),
        'commission_percent': str(resolved_commission_percent),
        'process_xa': product.process_xa,
        'process_in': product.process_in,
        'process_boi': product.process_boi,
        'process_can_mang': product.process_can_mang,
        'process_be': product.process_be,
        'process_chap': product.process_chap,
        'process_dong': product.process_dong,
        'process_dan': product.process_dan,
        'process_khac': product.process_khac,
        'film_code': product.film_code or '',
        'film_file_url': product.film_file_url or '',
        'color_count': product.color_count,
        'mold_code': product.mold_code or '',
        'mold_file_url': product.mold_file_url or '',
        'waterproof': product.waterproof or '',
        'note_other': product.note_other or '',
        'note': product.note or '',
        'parent_id': product.parent_id,
        'parent_name': getattr(getattr(product, 'parent', None), 'name', None),
        'component_quantity': product.component_quantity,
        'is_set': product.is_set,
        'bundle_id': bundle.id if bundle else None,
        'bundle_pricing_mode': bundle_pricing_mode,
        'bundle_commission_mode': bundle_commission_mode,
        'bundle_delivery_rule': bundle_delivery_rule,
        'bundle_primary_product_id': bundle_primary_product_id,
        'bundle_primary_product_name': bundle_primary_product_name,
        'bundle_components': bundle_components,
        'status': product.status,
        'owner_id': product.owner_id,
        'owner_name': getattr(getattr(product, 'owner', None), 'username', None),
        'team_id': product.team_id,
        'team_name': getattr(getattr(product, 'team', None), 'name', None),
        'is_active': product.is_active,
    }


def merge_sales_order_line_product_snapshot(product, overrides=None, *, unit_price=None, as_of_datetime=None):
    snapshot = build_sales_order_line_product_snapshot(product, as_of_datetime=as_of_datetime)
    overrides = overrides or {}
    editable_keys = {
        'description',
        'size_order',
        'size_production',
        'sale_price',
        'delivery_tolerance',
        'commission_per_unit',
        'commission_percent',
        'process_xa',
        'process_in',
        'process_boi',
        'process_can_mang',
        'process_be',
        'process_chap',
        'process_dong',
        'process_dan',
        'process_khac',
        'film_code',
        'film_file_url',
        'color_count',
        'mold_code',
        'mold_file_url',
        'waterproof',
        'note_other',
        'note',
        'unit_name',
    }
    for key, value in overrides.items():
        if key in editable_keys and value is not None:
            snapshot[key] = value
    if unit_price is not None:
        snapshot['sale_price'] = str(unit_price)
    return snapshot


def get_next_sales_order_code(order_date):
    """SO-YYYYMM-NNNNN theo kỳ (doc_type + YYYYMM)."""
    period = order_date.strftime('%Y%m')
    seq, _ = PeriodSequence.objects.get_or_create(
        doc_type='SO',
        period=period,
        defaults={'current_number': 0, 'padding': 5},
    )
    return seq.get_next_code()


def build_posted_snapshot(order):
    """Snapshot customer + lines khi Posted để master đổi không ảnh hưởng chứng từ cũ."""
    customer = order.customer
    customer_snap = {}
    if customer:
        customer_snap = {
            'id': customer.id,
            'code': customer.code,
            'name': customer.name,
            'company_name': getattr(customer, 'company_name', '') or '',
            'tax_code': getattr(customer, 'tax_code', '') or '',
            'address': getattr(customer, 'address', '') or '',
        }
    lines_snap = []
    for line in order.lines.select_related('product').prefetch_related('delivery_plans').order_by('line_number'):
        p = line.product
        line_snapshot = getattr(line, 'product_snapshot', None) or {}
        plans = [
            {
                'delivery_date': pl.delivery_date.isoformat() if pl.delivery_date else None,
                'qty': str(pl.qty),
                'shipped_qty': str(pl.shipped_qty),
                'delivered_qty': str(pl.delivered_qty),
                'remaining_qty': str(pl.remaining_qty),
                'remaining_shipment_qty': str(pl.remaining_shipment_qty),
                'note': pl.note or '',
            }
            for pl in line.delivery_plans.all().order_by('delivery_date', 'id')
        ]
        lines_snap.append({
            'line_number': line.line_number,
            'product_id': line_snapshot.get('product_id', p.id),
            'product_code': line.internal_product_code or line_snapshot.get('code', p.code),
            'product_name': line_snapshot.get('name', p.name),
            'trace_code': line.trace_code,
            'product_snapshot': line_snapshot,
            'qty': str(line.qty),
            'unit_price': str(line.unit_price),
            'discount_pct': str(line.discount_pct),
            'tax_pct': str(line.tax_pct),
            'line_total': str(line.line_total),
            'delivery_plans': plans,
        })
    return {'customer': customer_snap, 'lines': lines_snap, 'total': str(order.total)}


def get_sales_order_line_shipped_qty(line, *, exclude_transaction_id=None):
    from inventory.models import InventoryTransaction, InventoryTransactionStatus, InventoryTransactionType

    if not getattr(line, 'id', None):
        return Decimal('0')
    qs = InventoryTransaction.objects.filter(
        sales_order_line=line,
        transaction_type=InventoryTransactionType.ISSUE,
        status=InventoryTransactionStatus.POSTED,
    )
    if exclude_transaction_id:
        qs = qs.exclude(pk=exclude_transaction_id)
    agg = qs.aggregate(total=Sum('quantity'))
    return agg.get('total') or Decimal('0')


def ensure_sales_order_line_shipment_allowed(line, quantity, *, exclude_transaction_id=None):
    quantity = Decimal(str(quantity or 0))
    if quantity <= 0:
        return
    current_shipped = get_sales_order_line_shipped_qty(line, exclude_transaction_id=exclude_transaction_id)
    ordered_qty = Decimal(str(getattr(line, 'qty', 0) or 0))
    if current_shipped + quantity > ordered_qty:
        remaining = ordered_qty - current_shipped
        raise ValueError(
            f'Dòng {line.line_number} chỉ còn được xuất {remaining}, yêu cầu={quantity}.'
        )


def apply_delivery_plan_shipment(line, quantity, *, actor=None, shipment_date=None):
    quantity = Decimal(str(quantity or 0))
    if quantity <= 0:
        return []
    shipment_date = shipment_date or timezone.localdate()
    touched_plan_ids = []
    remaining = quantity
    plans = list(line.delivery_plans.all().order_by('delivery_date', 'id'))
    for plan in plans:
        plan_remaining = plan.remaining_shipment_qty
        if plan_remaining <= 0:
            continue
        allocate_qty = min(plan_remaining, remaining)
        if allocate_qty <= 0:
            continue
        plan.shipped_qty = (plan.shipped_qty or Decimal('0')) + allocate_qty
        plan.save(update_fields=['shipped_qty', 'updated_at'])
        touched_plan_ids.append(plan.id)
        remaining -= allocate_qty
        if remaining <= 0:
            break

    if remaining > 0:
        auto_plan = SalesOrderDeliveryPlan.objects.create(
            line=line,
            delivery_date=shipment_date,
            qty=remaining,
            shipped_qty=remaining,
            delivered_qty=Decimal('0'),
            note=f'{AUTO_SHIPMENT_PLAN_NOTE} Tự động tạo từ xuất kho.',
        )
        touched_plan_ids.append(auto_plan.id)

    if actor:
        sync_sales_order_delivery_tasks(actor=actor, order_ids=[line.sales_order_id], days_ahead=14)
    return touched_plan_ids


def reverse_delivery_plan_shipment(line, quantity, *, actor=None):
    quantity = Decimal(str(quantity or 0))
    if quantity <= 0:
        return []
    touched_plan_ids = []
    remaining = quantity
    plans = list(line.delivery_plans.filter(shipped_qty__gt=0).order_by('-delivery_date', '-id'))
    for plan in plans:
        allocated_qty = min(plan.shipped_qty or Decimal('0'), remaining)
        if allocated_qty <= 0:
            continue
        plan.shipped_qty = max(Decimal('0'), (plan.shipped_qty or Decimal('0')) - allocated_qty)
        if plan.delivered_qty > plan.shipped_qty:
            plan.delivered_qty = plan.shipped_qty
        if (plan.note or '').startswith(AUTO_SHIPMENT_PLAN_NOTE) and (plan.shipped_qty or Decimal('0')) <= 0 and (plan.delivered_qty or Decimal('0')) <= 0:
            touched_plan_ids.append(plan.id)
            plan.delete()
        else:
            plan.save(update_fields=['shipped_qty', 'delivered_qty', 'updated_at'])
            touched_plan_ids.append(plan.id)
        remaining -= allocated_qty
        if remaining <= 0:
            break

    if actor:
        sync_sales_order_delivery_tasks(actor=actor, order_ids=[line.sales_order_id], days_ahead=14)
    return touched_plan_ids


def apply_delivery_plan_delivery(line, quantity, *, actor=None, delivery_date=None):
    quantity = Decimal(str(quantity or 0))
    if quantity <= 0:
        return []
    delivery_date = delivery_date or timezone.localdate()
    touched_plan_ids = []
    remaining = quantity
    plans = list(line.delivery_plans.filter(shipped_qty__gt=0).order_by('delivery_date', 'id'))
    for plan in plans:
        deliverable_qty = min(plan.qty or Decimal('0'), plan.shipped_qty or Decimal('0')) - (plan.delivered_qty or Decimal('0'))
        if deliverable_qty <= 0:
            continue
        allocate_qty = min(deliverable_qty, remaining)
        if allocate_qty <= 0:
            continue
        plan.delivered_qty = (plan.delivered_qty or Decimal('0')) + allocate_qty
        plan.save(update_fields=['delivered_qty', 'updated_at'])
        touched_plan_ids.append(plan.id)
        remaining -= allocate_qty
        if remaining <= 0:
            break

    if remaining > 0:
        auto_plan = SalesOrderDeliveryPlan.objects.create(
            line=line,
            delivery_date=delivery_date,
            qty=remaining,
            shipped_qty=remaining,
            delivered_qty=remaining,
            note='[AUTO-DELIVERY] Tự động tạo từ xác nhận giao xong.',
        )
        touched_plan_ids.append(auto_plan.id)

    if actor:
        sync_sales_order_delivery_tasks(actor=actor, order_ids=[line.sales_order_id], days_ahead=14)
    return touched_plan_ids


def get_sales_order_void_blockers(order):
    from inventory.models import InventoryReservation, InventoryReservationStatus, InventoryTransaction, InventoryTransactionStatus

    blockers = []
    open_reservations = InventoryReservation.objects.filter(
        sales_order=order,
        status=InventoryReservationStatus.OPEN,
    )
    if open_reservations.filter(reserved_qty__gt=0).exists():
        blockers.append('Đơn còn reservation OPEN, cần release/hủy reservation trước khi void.')
    active_shipments = InventoryTransaction.objects.filter(
        sales_order=order,
        transaction_type='ISSUE',
        status=InventoryTransactionStatus.POSTED,
    )
    if active_shipments.exists():
        blockers.append('Đơn đã có phiếu xuất kho POSTED, cần hủy/chứng từ đảo trước khi void.')
    return blockers


def post_sales_order(order, user, request=None):
    """
    Post atomic + idempotent.
    Nếu đã posted_at/post_number thì không tạo double; return (True, message) hoặc (False, error).
    """
    if order.posted_at is not None and order.post_number:
        return True, 'Already posted (idempotent).'
    if order.status != SalesOrderStatus.APPROVED:
        return False, 'Chỉ đơn đã duyệt mới được vào sổ.'
    with transaction.atomic():
        order = SalesOrder.objects.select_for_update().get(pk=order.pk)
        if order.posted_at is not None:
            return True, 'Already posted (idempotent).'
        now = timezone.now()
        order.post_number = order.code
        order.posted_at = now
        order.posted_by = user
        order.status = SalesOrderStatus.POSTED
        order.posted_snapshot = build_posted_snapshot(order)
        order.version += 1
        order.save(update_fields=[
            'post_number', 'posted_at', 'posted_by', 'status',
            'posted_snapshot', 'version', 'updated_at',
        ])
        SalesOrderPostingLog.objects.create(
            sales_order=order,
            posted_by=user,
            post_number=order.post_number,
            snapshot_saved=True,
        )
        ip = get_client_ip(request) if request else None
        ua = (request.META.get('HTTP_USER_AGENT') or '')[:500] if request else ''
        AuditLog.objects.create(
            user=user,
            action='POST',
            entity_type='SalesOrder',
            entity_id=order.id,
            entity_code=order.code,
            old_values={'status': SalesOrderStatus.APPROVED},
            new_values={'status': SalesOrderStatus.POSTED, 'post_number': order.post_number},
            ip_address=ip,
            user_agent=ua,
        )
    return True, 'Posted.'


def workflow_can_transition(entity_type, from_status, to_status):
    """Kiểm tra chuyển trạng thái hợp lệ (WorkflowDefinition)."""
    wf = WorkflowDefinition.objects.filter(entity_type=entity_type, is_active=True).first()
    if not wf:
        return False
    return wf.can_transition(from_status, to_status)


def workflow_get_next_states(entity_type, current_status):
    """Lấy danh sách trạng thái có thể chuyển đến."""
    wf = WorkflowDefinition.objects.filter(entity_type=entity_type, is_active=True).first()
    if not wf:
        return []
    return wf.get_next_states(current_status)


def sync_sales_order_delivery_tasks(actor=None, order_ids=None, days_ahead=2):
    """
    Đồng bộ Task nhắc giao hàng theo kế hoạch giao (delivery plan).
    - Tạo/cập nhật task cho kế hoạch sắp đến hạn hoặc đã quá hạn.
    - Tự hoàn tất task nếu kế hoạch đã giao đủ.
    """
    try:
        days_ahead = int(days_ahead)
    except (TypeError, ValueError):
        days_ahead = 2
    days_ahead = max(0, min(days_ahead, 30))
    today = timezone.localdate()
    due_until = today + timedelta(days=days_ahead)

    orders_qs = SalesOrder.objects.select_related('owner', 'created_by')
    if order_ids:
        orders_qs = orders_qs.filter(id__in=order_ids)
    orders_by_id = {o.id: o for o in orders_qs}

    plans_qs = SalesOrderDeliveryPlan.objects.select_related(
        'line',
        'line__sales_order',
        'line__product',
        'line__sales_order__owner',
        'line__sales_order__created_by',
    )
    if order_ids:
        plans_qs = plans_qs.filter(line__sales_order_id__in=order_ids)

    created = 0
    updated = 0
    completed = 0
    skipped = 0

    planned_order_ids = set()
    for plan in plans_qs:
        order = plan.line.sales_order
        planned_order_ids.add(order.id)
        if order.status in [SalesOrderStatus.VOID]:
            skipped += 1
            continue
        source_key = f"sales-delivery-plan:{plan.id}"
        task = Task.objects.filter(source_key=source_key).order_by('-id').first()
        should_track = (plan.delivery_date and plan.delivery_date <= due_until and plan.remaining_qty > 0)

        if not should_track:
            if task and task.status not in [Task.STATUS_DONE, Task.STATUS_CANCELLED]:
                task.status = Task.STATUS_DONE
                task.completed_at = timezone.now()
                task.save(update_fields=['status', 'completed_at', 'updated_at'])
                completed += 1
            continue

        priority = 'HIGH' if plan.delivery_date < today else 'MEDIUM'
        assigned_to = order.owner or order.created_by
        title = f"[Giao hàng] {order.code} - Dòng {plan.line.line_number}"
        description = (
            f"Mã hàng: {plan.line.product.code} - {plan.line.product.name}\n"
            f"Kế hoạch: {plan.qty} | Đã xuất: {plan.shipped_qty} | Đã giao: {plan.delivered_qty} | Còn giao: {plan.remaining_qty}\n"
            f"Ngày giao: {plan.delivery_date.isoformat()}\n"
            f"Ghi chú: {plan.note or '-'}"
        )
        payload = {
            'title': title,
            'description': description,
            'priority': priority,
            'due_date': plan.delivery_date,
            'assigned_to': assigned_to,
            'assigned_by': actor or assigned_to,
            'entity_type': 'SalesOrder',
            'entity_id': order.id,
            'entity_code': order.code,
            'source_key': source_key,
            'tags': ['delivery-plan', 'sales-order'],
        }

        if task:
            changed = False
            for key, value in payload.items():
                if getattr(task, key) != value:
                    setattr(task, key, value)
                    changed = True
            if task.status in [Task.STATUS_DONE, Task.STATUS_CANCELLED]:
                task.status = Task.STATUS_TODO
                task.completed_at = None
                changed = True
            if changed:
                task.save()
                updated += 1
            else:
                skipped += 1
        else:
            Task.objects.create(**payload)
            created += 1

    # Fallback: đơn có delivery_date tổng nhưng chưa tách delivery_plans vẫn cần nhắc việc.
    for order_id, order in orders_by_id.items():
        if order_id in planned_order_ids:
            continue
        if not order.delivery_date or order.status in [SalesOrderStatus.VOID]:
            continue
        source_key = f"sales-delivery-order:{order.id}"
        task = Task.objects.filter(source_key=source_key).order_by('-id').first()
        should_track = order.delivery_date <= due_until
        if not should_track:
            if task and task.status not in [Task.STATUS_DONE, Task.STATUS_CANCELLED]:
                task.status = Task.STATUS_DONE
                task.completed_at = timezone.now()
                task.save(update_fields=['status', 'completed_at', 'updated_at'])
                completed += 1
            continue

        priority = 'HIGH' if order.delivery_date < today else 'MEDIUM'
        assigned_to = order.owner or order.created_by
        payload = {
            'title': f"[Giao hàng] {order.code}",
            'description': f"Đơn hàng đến hạn giao ngày {order.delivery_date.isoformat()} (chưa tách theo dòng).",
            'priority': priority,
            'due_date': order.delivery_date,
            'assigned_to': assigned_to,
            'assigned_by': actor or assigned_to,
            'entity_type': 'SalesOrder',
            'entity_id': order.id,
            'entity_code': order.code,
            'source_key': source_key,
            'tags': ['delivery-order', 'sales-order'],
        }
        if task:
            changed = False
            for key, value in payload.items():
                if getattr(task, key) != value:
                    setattr(task, key, value)
                    changed = True
            if task.status in [Task.STATUS_DONE, Task.STATUS_CANCELLED]:
                task.status = Task.STATUS_TODO
                task.completed_at = None
                changed = True
            if changed:
                task.save()
                updated += 1
            else:
                skipped += 1
        else:
            Task.objects.create(**payload)
            created += 1

    return {
        'created': created,
        'updated': updated,
        'completed': completed,
        'skipped': skipped,
        'days_ahead': days_ahead,
    }
