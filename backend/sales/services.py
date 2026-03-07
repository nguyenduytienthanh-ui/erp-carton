"""
Services chứng từ: code theo kỳ, snapshot, post atomic + idempotent.
"""
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from django.conf import settings

from core.models import WorkflowDefinition, ApprovalHistory, AuditLog, Task
from core.mixins import get_client_ip
from sales.models import (
    SalesOrder,
    SalesOrderLine,
    SalesOrderPostingLog,
    PeriodSequence,
    SalesOrderStatus,
    SalesOrderDeliveryPlan,
)


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
        plans = [
            {
                'delivery_date': pl.delivery_date.isoformat() if pl.delivery_date else None,
                'qty': str(pl.qty),
                'delivered_qty': str(pl.delivered_qty),
                'remaining_qty': str(pl.remaining_qty),
                'note': pl.note or '',
            }
            for pl in line.delivery_plans.all().order_by('delivery_date', 'id')
        ]
        lines_snap.append({
            'line_number': line.line_number,
            'product_id': p.id,
            'product_code': p.code,
            'product_name': p.name,
            'qty': str(line.qty),
            'unit_price': str(line.unit_price),
            'discount_pct': str(line.discount_pct),
            'tax_pct': str(line.tax_pct),
            'line_total': str(line.line_total),
            'delivery_plans': plans,
        })
    return {'customer': customer_snap, 'lines': lines_snap, 'total': str(order.total)}


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
            f"Kế hoạch: {plan.qty} | Đã giao: {plan.delivered_qty} | Còn lại: {plan.remaining_qty}\n"
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
