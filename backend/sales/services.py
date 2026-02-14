"""
Services chứng từ: code theo kỳ, snapshot, post atomic + idempotent.
"""
from django.db import transaction
from django.utils import timezone
from django.conf import settings

from core.models import WorkflowDefinition, ApprovalHistory, AuditLog
from core.mixins import get_client_ip
from sales.models import SalesOrder, SalesOrderLine, SalesOrderPostingLog, PeriodSequence, SalesOrderStatus


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
    for line in order.lines.select_related('product').order_by('line_number'):
        p = line.product
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
