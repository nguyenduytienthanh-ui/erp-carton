"""
ViewSet SalesOrder: CRUD, filter/search/ordering, data scope, workflow actions.
Permission matrix: EDIT chỉ Draft; POST chỉ role Finance; void bắt buộc lý do.
Performance: select_related/prefetch_related.
"""
from io import BytesIO

from django.http import HttpResponse
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.permissions import DjangoObjectPermissions
from django_filters.rest_framework import DjangoFilterBackend
import django_filters
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.db.models import F, Q, Sum
from django.db import transaction
from django.apps import apps
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from core.mixins import get_client_ip
from core.models import AuditLog, ApprovalHistory, Attachment
from core.permissions import check_action_permission
from core.workflow_services import generate_tasks_for_entity
from sales.models import SalesOrder, SalesOrderStatus, Quote, QuoteStatus, OutboundShipment, OutboundShipmentStatus, ShipmentLine
from sales.serializers import SalesOrderSerializer, QuoteSerializer, OutboundShipmentSerializer, ShipmentLineSerializer
from sales.filters import SalesOrderFilter, QuoteFilter
from sales.services import (
    apply_delivery_plan_delivery,
    apply_delivery_plan_shipment,
    build_shipment_package_code,
    build_shipment_package_trace_code,
    build_sales_order_line_package_trace_code,
    get_sales_order_void_blockers,
    get_next_sales_order_code,
    post_sales_order,
    sync_sales_order_delivery_tasks,
    workflow_can_transition,
    workflow_get_next_states,
)
from sales.permissions import (
    can_edit_sales_order,
    can_submit_sales_order,
    can_approve_sales_order,
    can_reject_sales_order,
    can_post_sales_order,
    can_void_sales_order,
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


def _create_outbound_shipment_audit_log(*, request, shipment, action, old_status=None):
    payload = {
        'user': request.user,
        'action': action,
        'entity_type': 'OutboundShipment',
        'entity_id': shipment.id,
        'entity_code': shipment.code or '',
        'new_values': {'status': shipment.status},
        'changed_fields': ['status'],
        'ip_address': get_client_ip(request),
        'user_agent': (request.META.get('HTTP_USER_AGENT') or '')[:500],
    }
    if old_status is not None:
        payload['old_values'] = {'status': old_status}
    AuditLog.objects.create(**payload)


def _can_manage_inventory_execution(user):
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'INVENTORY', 'MANAGE', strict=True):
        return True
    return any(
        role in {
            'admin',
            'manager',
            'operation-manager',
            'ops-manager',
            'product-manager',
            'sales-manager',
            'quan-ly',
            'quanly',
        }
        for role in _user_role_names(user)
    )


def _draw_pdf_qr(pdf_canvas, value, *, x, y, size):
    qr_widget = QrCodeWidget(value or '-')
    bounds = qr_widget.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(qr_widget)
    renderPDF.draw(drawing, pdf_canvas, x, y)


def _sales_order_pdf_response(filename, build_callback):
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    build_callback(pdf)
    pdf.save()
    buffer.seek(0)
    response = HttpResponse(buffer.read(), content_type='application/pdf')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def _build_invoice_pdf(pdf_canvas, order):
    """Vẽ nội dung hóa đơn đơn hàng (header, khách hàng, bảng dòng, tổng)."""
    from reportlab.platypus import Table, TableStyle

    w, h = A4
    margin = 40
    y = h - margin
    pdf_canvas.setFont('Helvetica-Bold', 14)
    pdf_canvas.drawString(margin, y, 'HOA DON BAN HANG')
    y -= 24
    pdf_canvas.setFont('Helvetica', 10)
    pdf_canvas.drawString(margin, y, f'Ma don: {order.code}')
    pdf_canvas.drawString(margin + 220, y, f'Ngay don: {order.order_date}')
    y -= 18
    cust = order.customer
    cust_name = (cust.name if cust else '') or (getattr(cust, 'company_name', None) or '')
    cust_addr = (getattr(cust, 'address', None) or '') if cust else ''
    pdf_canvas.drawString(margin, y, f'Khach hang: {cust_name}')
    y -= 14
    if cust_addr:
        pdf_canvas.drawString(margin, y, f'Dia chi: {cust_addr[:80]}')
        y -= 14
    y -= 10
    # Table header
    col_widths = [30, 70, 180, 50, 70, 85]
    row_h = 18
    headers = ['STT', 'Ma SP', 'Ten san pham', 'SL', 'Don gia', 'Thanh tien']
    data = [headers]
    for line in order.lines.order_by('line_number'):
        snap = getattr(line, 'product_snapshot', None) or {}
        code = line.internal_product_code or snap.get('code') or getattr(line.product, 'code', '')
        name = snap.get('name') or getattr(line.product, 'name', '') or ''
        if len(name) > 32:
            name = name[:29] + '...'
        data.append([
            str(line.line_number),
            code[:14],
            name,
            str(line.qty),
            f'{line.unit_price:,.0f}',
            f'{line.line_total:,.0f}',
        ])
    t = Table(data, colWidths=col_widths, rowHeights=[row_h] * len(data))
    t.setStyle(TableStyle([
        ('FONT', (0, 0), (-1, 0), 'Helvetica-Bold', 9),
        ('FONT', (0, 1), (-1, -1), 'Helvetica', 9),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('ALIGN', (3, 0), (-1, -1), 'RIGHT'),
    ]))
    t.wrapOn(pdf_canvas, w - 2 * margin, h)
    t.drawOn(pdf_canvas, margin, y - len(data) * row_h - 10)
    y = y - len(data) * row_h - 24
    pdf_canvas.setFont('Helvetica', 10)
    pdf_canvas.drawString(margin + 350, y, f'Tong cong: {order.total:,.0f} {order.currency}')
    if order.discount_total and order.discount_total != 0:
        y -= 14
        pdf_canvas.drawString(margin + 350, y, f'Giam tru: {order.discount_total:,.0f}')
    if order.tax_total and order.tax_total != 0:
        y -= 14
        pdf_canvas.drawString(margin + 350, y, f'Thue: {order.tax_total:,.0f}')
    if order.notes:
        y -= 20
        pdf_canvas.setFont('Helvetica', 9)
        pdf_canvas.drawString(margin, y, f'Ghi chu: {order.notes[:120]}')


def _build_quote_pdf(pdf_canvas, quote):
    """Vẽ nội dung PDF báo giá (header, khách hàng, bảng dòng, tổng)."""
    from reportlab.platypus import Table, TableStyle
    w, h = A4
    margin = 40
    y = h - margin
    pdf_canvas.setFont('Helvetica-Bold', 14)
    pdf_canvas.drawString(margin, y, 'BAO GIA')
    y -= 24
    pdf_canvas.setFont('Helvetica', 10)
    pdf_canvas.drawString(margin, y, f'Ma: {quote.code}')
    pdf_canvas.drawString(margin + 180, y, f'Ngay: {quote.quote_date}')
    if quote.valid_until:
        pdf_canvas.drawString(margin + 320, y, f'Het han: {quote.valid_until}')
    y -= 18
    cust = quote.customer
    cust_name = (cust.name if cust else '') or (getattr(cust, 'company_name', None) or '')
    cust_addr = (getattr(cust, 'address', None) or '') if cust else ''
    pdf_canvas.drawString(margin, y, f'Khach hang: {cust_name}')
    y -= 14
    if cust_addr:
        pdf_canvas.drawString(margin, y, f'Dia chi: {cust_addr[:80]}')
        y -= 14
    y -= 10
    col_widths = [30, 70, 160, 50, 70, 70, 85]
    row_h = 18
    headers = ['STT', 'Ma SP', 'Ten', 'SL', 'Don gia', 'CK%', 'Thanh tien']
    data = [headers]
    for line in quote.lines.order_by('line_number'):
        code = getattr(line.product, 'code', '') or ''
        name = (getattr(line.product, 'name', '') or '')[:28]
        data.append([
            str(line.line_number),
            code[:14],
            name,
            str(line.qty),
            f'{line.unit_price:,.0f}',
            f'{line.discount_pct or 0}',
            f'{line.line_total:,.0f}',
        ])
    t = Table(data, colWidths=col_widths, rowHeights=[row_h] * len(data))
    t.setStyle(TableStyle([
        ('FONT', (0, 0), (-1, 0), 'Helvetica-Bold', 9),
        ('FONT', (0, 1), (-1, -1), 'Helvetica', 9),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('ALIGN', (3, 0), (-1, -1), 'RIGHT'),
    ]))
    t.wrapOn(pdf_canvas, w - 2 * margin, h)
    t.drawOn(pdf_canvas, margin, y - len(data) * row_h - 10)
    y = y - len(data) * row_h - 24
    pdf_canvas.setFont('Helvetica', 10)
    pdf_canvas.drawString(margin + 380, y, f'Tong: {quote.total:,.0f} {quote.currency}')
    if quote.notes:
        y -= 18
        pdf_canvas.setFont('Helvetica', 9)
        pdf_canvas.drawString(margin, y, f'Ghi chu: {(quote.notes or "")[:120]}')


def _build_package_summary(packages):
    live = [p for p in packages if p.status != 'CANCELLED']
    return {
        'package_count': len(live),
        'verified_package_count': sum(1 for p in live if p.verified_at),
        'loaded_package_count': sum(1 for p in live if p.loaded_at),
        'pending_verify_count': sum(1 for p in live if not p.verified_at),
        'pending_load_count': sum(1 for p in live if p.verified_at and not p.loaded_at),
        'total_gross_weight_kg': sum((p.gross_weight_kg or Decimal('0')) for p in live),
    }


LOAD_PROOF_ATTACHMENT_PREFIX = '[LOAD_PROOF]'
DELIVERY_PROOF_ATTACHMENT_PREFIX = '[DELIVERY_PROOF]'


def _latest_shipment_attachment_url(request, shipment_id, prefix):
    attachment = (
        Attachment.objects.filter(
            entity_type='OutboundShipment',
            entity_id=shipment_id,
            description__startswith=prefix,
        )
        .exclude(file='')
        .order_by('-uploaded_at', '-id')
        .first()
    )
    if not attachment or not attachment.file:
        return ''
    try:
        return request.build_absolute_uri(attachment.file.url)
    except Exception:
        return ''


class SalesOrderViewSet(viewsets.ModelViewSet):
    serializer_class = SalesOrderSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        django_filters.rest_framework.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = SalesOrderFilter
    search_fields = ['code', 'reference', 'notes']
    ordering_fields = ['code', 'order_date', 'status', 'total', 'created_at']
    ordering = ['-order_date', '-id']

    def get_queryset(self):
        qs = SalesOrder.objects.select_related(
            'customer', 'owner', 'team', 'created_by', 'updated_by',
            'submitted_by', 'approved_by', 'rejected_by', 'posted_by', 'voided_by',
        ).prefetch_related('lines', 'lines__product', 'lines__delivery_plans')
        user = self.request.user
        if user.is_superuser:
            return qs
        if getattr(user, 'teams', None):
            team_ids = list(user.teams.values_list('id', flat=True))
            return qs.filter(Q(owner=user) | Q(team_id__in=team_ids) | Q(owner__isnull=True))
        return qs.filter(Q(owner=user) | Q(owner__isnull=True))

    def perform_create(self, serializer):
        order_date = serializer.validated_data.get('order_date') or timezone.now().date()
        code = get_next_sales_order_code(order_date)
        order = serializer.save(
            code=code,
            created_by=self.request.user,
            updated_by=self.request.user,
            owner=self.request.user,
        )
        sync_sales_order_delivery_tasks(actor=self.request.user, order_ids=[order.id], days_ahead=14)

    def perform_update(self, serializer):
        if not can_edit_sales_order(self.request.user, serializer.instance):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Chỉ được sửa đơn ở trạng thái Nháp.')
        order = serializer.save(updated_by=self.request.user)
        sync_sales_order_delivery_tasks(actor=self.request.user, order_ids=[order.id], days_ahead=14)

    def perform_destroy(self, instance):
        if instance.status != SalesOrderStatus.DRAFT:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Chỉ được xóa đơn Nháp.')
        instance.delete()

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        order = self.get_object()
        if not can_submit_sales_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        if not workflow_can_transition('SalesOrder', order.status, SalesOrderStatus.SUBMITTED):
            return Response({'error': 'Chuyển trạng thái không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        order.status = SalesOrderStatus.SUBMITTED
        order.submitted_by = request.user
        order.submitted_at = timezone.now()
        order.save(update_fields=['status', 'submitted_by', 'submitted_at', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='SalesOrder', entity_id=order.id, entity_code=order.code,
            action='SUBMIT', user=request.user, level=1,
        )
        AuditLog.objects.create(
            user=request.user, action='SUBMIT', entity_type='SalesOrder',
            entity_id=order.id, entity_code=order.code,
            old_values={'status': SalesOrderStatus.DRAFT},
            new_values={'status': SalesOrderStatus.SUBMITTED},
            ip_address=get_client_ip(request), user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        generate_tasks_for_entity('SalesOrder', order.id, order.code, 'SUBMIT', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        order = self.get_object()
        if not can_approve_sales_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        if not workflow_can_transition('SalesOrder', order.status, SalesOrderStatus.APPROVED):
            return Response({'error': 'Chuyển trạng thái không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        order.status = SalesOrderStatus.APPROVED
        order.approved_by = request.user
        order.approved_at = timezone.now()
        order.rejected_by = None
        order.rejected_at = None
        order.reject_reason = ''
        order.save(update_fields=['status', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'reject_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='SalesOrder', entity_id=order.id, entity_code=order.code,
            action='APPROVE', user=request.user, level=1,
        )
        AuditLog.objects.create(
            user=request.user, action='APPROVE', entity_type='SalesOrder',
            entity_id=order.id, entity_code=order.code,
            old_values={'status': SalesOrderStatus.SUBMITTED},
            new_values={'status': SalesOrderStatus.APPROVED},
            ip_address=get_client_ip(request), user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        generate_tasks_for_entity('SalesOrder', order.id, order.code, 'APPROVE', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        order = self.get_object()
        if not can_reject_sales_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = request.data.get('reason', '')
        if not workflow_can_transition('SalesOrder', order.status, SalesOrderStatus.REJECTED):
            return Response({'error': 'Chuyển trạng thái không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        order.status = SalesOrderStatus.REJECTED
        order.rejected_by = request.user
        order.rejected_at = timezone.now()
        order.reject_reason = reason
        order.save(update_fields=['status', 'rejected_by', 'rejected_at', 'reject_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='SalesOrder', entity_id=order.id, entity_code=order.code,
            action='REJECT', user=request.user, comments=reason, level=1,
        )
        AuditLog.objects.create(
            user=request.user, action='REJECT', entity_type='SalesOrder',
            entity_id=order.id, entity_code=order.code,
            old_values={'status': SalesOrderStatus.SUBMITTED},
            new_values={'status': SalesOrderStatus.REJECTED, 'reason': reason},
            ip_address=get_client_ip(request), user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        generate_tasks_for_entity('SalesOrder', order.id, order.code, 'REJECT', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def confirm_order(self, request, pk=None):
        """Confirm order with customer (xác nhận đơn hàng với khách hàng)."""
        order = self.get_object()
        if not can_edit_sales_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        if order.status not in [SalesOrderStatus.DRAFT, SalesOrderStatus.SUBMITTED]:
            return Response({'error': 'Chỉ có thể xác nhận đơn hàng ở trạng thái Nháp hoặc Đã gửi.'}, status=status.HTTP_400_BAD_REQUEST)
        order.confirmed_by = request.user
        order.confirmed_at = timezone.now()
        order.save(update_fields=['confirmed_by', 'confirmed_at', 'updated_at'])
        AuditLog.objects.create(
            user=request.user, action='CONFIRM', entity_type='SalesOrder',
            entity_id=order.id, entity_code=order.code,
            old_values={'confirmed_at': None},
            new_values={'confirmed_at': order.confirmed_at.isoformat()},
            ip_address=get_client_ip(request), user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        generate_tasks_for_entity('SalesOrder', order.id, order.code, 'CONFIRM', triggered_by=request.user)
        return Response({'status': 'Xác nhận', 'confirmed_at': order.confirmed_at})

    @action(detail=True, methods=['post'])
    def post_document(self, request, pk=None):
        """Post atomic + idempotent."""
        order = self.get_object()
        if not can_post_sales_order(request.user, order):
            return Response({'error': 'Không có quyền (cần role Finance) hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        ok, msg = post_sales_order(order, request.user, request)
        if not ok:
            return Response({'error': msg}, status=status.HTTP_400_BAD_REQUEST)
        generate_tasks_for_entity('SalesOrder', order.id, order.code, 'POST', triggered_by=request.user)
        return Response({'status': order.status, 'post_number': order.post_number, 'message': msg})

    @action(detail=True, methods=['post'])
    def void(self, request, pk=None):
        """Void: bắt buộc void_reason (lý do)."""
        order = self.get_object()
        if not can_void_sales_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        void_reason = (request.data.get('void_reason') or request.data.get('reason') or '').strip()
        if not void_reason:
            return Response({'error': 'Void bắt buộc phải có lý do (void_reason).'}, status=status.HTTP_400_BAD_REQUEST)
        blockers = get_sales_order_void_blockers(order)
        if blockers:
            return Response({'error': ' '.join(blockers)}, status=status.HTTP_400_BAD_REQUEST)
        old_status = order.status
        order.status = SalesOrderStatus.VOID
        order.voided_by = request.user
        order.voided_at = timezone.now()
        order.void_reason = void_reason
        order.save(update_fields=['status', 'voided_by', 'voided_at', 'void_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='SalesOrder', entity_id=order.id, entity_code=order.code,
            action='REJECT', user=request.user, comments=void_reason, level=1,
        )
        AuditLog.objects.create(
            user=request.user, action='VOID', entity_type='SalesOrder',
            entity_id=order.id, entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': SalesOrderStatus.VOID, 'reason': void_reason},
            ip_address=get_client_ip(request), user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        try:
            from finance.services import cancel_receivable_for_sales_order

            cancel_receivable_for_sales_order(order, actor=request.user, reason=void_reason)
        except Exception as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        generate_tasks_for_entity('SalesOrder', order.id, order.code, 'VOID', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['get'])
    def invoice_pdf(self, request, pk=None):
        """GET: Tải PDF hóa đơn đơn hàng (header, khách hàng, dòng hàng, tổng)."""
        order = self.get_object()
        safe_code = (order.code or 'order').replace(' ', '_')
        return _sales_order_pdf_response(
            f'hoa_don_{safe_code}.pdf',
            lambda c: _build_invoice_pdf(c, order),
        )

    @action(detail=True, methods=['get'])
    def approval_history(self, request, pk=None):
        order = self.get_object()
        history = ApprovalHistory.objects.filter(
            entity_type='SalesOrder', entity_id=order.id,
        ).order_by('-created_at').select_related('user')
        data = [
            {'action': h.get_action_display(), 'user': h.user.username if h.user else None, 'comments': h.comments, 'created_at': h.created_at}
            for h in history
        ]
        return Response(data)

    @action(detail=True, methods=['get'])
    def next_states(self, request, pk=None):
        order = self.get_object()
        next_states = workflow_get_next_states('SalesOrder', order.status)
        return Response({'current': order.status, 'next_states': next_states})

    @action(detail=False, methods=['get'])
    def summary(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        today = timezone.localdate()
        due_soon_until = today + timedelta(days=3)
        active_orders = queryset.exclude(status=SalesOrderStatus.VOID)
        delivery_plans = apps.get_model('sales', 'SalesOrderDeliveryPlan').objects.filter(
            line__sales_order_id__in=active_orders.values('id'),
            delivered_qty__lt=F('qty'),
        )
        posted_total = Decimal(str(queryset.filter(status=SalesOrderStatus.POSTED).aggregate(total=Sum('total')).get('total') or 0))
        return Response({
            'total_orders': int(queryset.count()),
            'draft_count': int(queryset.filter(status=SalesOrderStatus.DRAFT).count()),
            'submitted_count': int(queryset.filter(status=SalesOrderStatus.SUBMITTED).count()),
            'approved_count': int(queryset.filter(status=SalesOrderStatus.APPROVED).count()),
            'posted_count': int(queryset.filter(status=SalesOrderStatus.POSTED).count()),
            'void_count': int(queryset.filter(status=SalesOrderStatus.VOID).count()),
            'pending_approval_count': int(queryset.filter(status=SalesOrderStatus.SUBMITTED).count()),
            'overdue_delivery_count': int(delivery_plans.filter(delivery_date__lt=today).count()),
            'due_today_count': int(delivery_plans.filter(delivery_date=today).count()),
            'due_soon_count': int(delivery_plans.filter(delivery_date__gte=today, delivery_date__lte=due_soon_until).count()),
            'posted_total': str(posted_total),
        })

    @action(detail=True, methods=['get'])
    def delivery_overview(self, request, pk=None):
        order = self.get_object()
        today = timezone.localdate()
        try:
            due_soon_days = int(request.query_params.get('due_soon_days', 3) or 3)
        except (TypeError, ValueError):
            due_soon_days = 3
        due_soon_days = max(0, min(due_soon_days, 30))
        due_soon_until = today + timedelta(days=due_soon_days)
        items = []
        for line in order.lines.all().order_by('line_number'):
            for plan in line.delivery_plans.all().order_by('delivery_date', 'id'):
                snapshot = getattr(line, 'product_snapshot', None) or {}
                items.append({
                    'delivery_plan_id': plan.id,
                    'line_id': line.id,
                    'line_number': line.line_number,
                    'product_id': line.product_id,
                    'product_code': line.internal_product_code or snapshot.get('code') or getattr(line.product, 'code', None),
                    'product_name': snapshot.get('name') or getattr(line.product, 'name', None),
                    'delivery_date': plan.delivery_date,
                    'qty': plan.qty,
                    'shipped_qty': plan.shipped_qty,
                    'delivered_qty': plan.delivered_qty,
                    'remaining_shipment_qty': plan.remaining_shipment_qty,
                    'remaining_qty': plan.remaining_qty,
                    'is_completed': plan.is_completed,
                    'is_overdue': (not plan.is_completed) and (plan.delivery_date < today),
                    'is_due_soon': (not plan.is_completed) and (today <= plan.delivery_date <= due_soon_until),
                    'note': plan.note,
                })
        return Response({'count': len(items), 'results': items})

    @action(detail=True, methods=['get'])
    def reservation_overview(self, request, pk=None):
        order = self.get_object()
        InventoryReservation = apps.get_model('inventory', 'InventoryReservation')
        reservations = InventoryReservation.objects.filter(
            sales_order=order,
        ).select_related('product', 'warehouse', 'location', 'sales_order_line').order_by('-reservation_date', '-id')
        items = [
            {
                'id': reservation.id,
                'code': reservation.code,
                'status': reservation.status,
                'reservation_date': reservation.reservation_date,
                'sales_order_line_id': reservation.sales_order_line_id,
                'line_number': getattr(reservation.sales_order_line, 'line_number', None),
                'product_id': reservation.product_id,
                'product_code': getattr(reservation.product, 'code', None),
                'product_name': getattr(reservation.product, 'name', None),
                'warehouse_id': reservation.warehouse_id,
                'warehouse_code': getattr(reservation.warehouse, 'code', None),
                'warehouse_name': getattr(reservation.warehouse, 'name', None),
                'location_id': reservation.location_id,
                'location_code': getattr(reservation.location, 'code', None),
                'location_name': getattr(reservation.location, 'name', None),
                'reserved_qty': reservation.reserved_qty,
                'released_qty': reservation.released_qty,
                'fulfilled_qty': reservation.fulfilled_qty,
                'active_qty': reservation.active_qty,
                'reference': reservation.reference,
                'note': reservation.note,
            }
            for reservation in reservations
        ]
        return Response({'count': len(items), 'results': items})

    @action(detail=True, methods=['get'])
    def shipment_overview(self, request, pk=None):
        order = self.get_object()
        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        OutboundShipmentPackage = apps.get_model('inventory', 'OutboundShipmentPackage')
        shipments = OutboundShipment.objects.filter(
            sales_order=order,
        ).select_related(
            'loading_confirmed_by',
            'delivery_confirmed_by',
        ).prefetch_related(
            'transactions',
            'transactions__sales_order_line',
            'packages',
        ).order_by('-shipment_date', '-id')
        items = []
        for shipment in shipments:
            posted_transactions = [tx for tx in shipment.transactions.all() if tx.status == 'POSTED']
            package_summary = _build_package_summary(list(shipment.packages.all()))
            items.append(
                {
                    'id': shipment.id,
                    'shipment_id': shipment.id,
                    'shipment_code': shipment.code,
                    'status': shipment.status,
                    'shipment_date': shipment.shipment_date,
                    'reference': shipment.reference,
                    'carrier_name': shipment.carrier_name,
                    'tracking_number': shipment.tracking_number,
                    'vehicle_no': shipment.vehicle_no,
                    'driver_name': shipment.driver_name,
                    'driver_phone': shipment.driver_phone,
                    'note': shipment.note,
                    'loading_reference': shipment.loading_reference,
                    'handover_receiver_name': shipment.handover_receiver_name,
                    'handover_receiver_phone': shipment.handover_receiver_phone,
                    'handover_proof_url': shipment.handover_proof_url,
                    'loading_confirmation_note': shipment.loading_confirmation_note,
                    'loading_confirmed_at': shipment.loading_confirmed_at,
                    'loading_confirmed_by': shipment.loading_confirmed_by_id,
                    'loading_confirmed_by_name': (
                        getattr(shipment.loading_confirmed_by, 'full_name', None) or getattr(shipment.loading_confirmed_by, 'username', None)
                        if getattr(shipment, 'loading_confirmed_by', None)
                        else None
                    ),
                    'delivery_reference': shipment.delivery_reference,
                    'customer_receiver_name': shipment.customer_receiver_name,
                    'customer_receiver_phone': shipment.customer_receiver_phone,
                    'delivery_proof_url': shipment.delivery_proof_url,
                    'delivery_confirmation_note': shipment.delivery_confirmation_note,
                    'delivered_at_actual': shipment.delivered_at_actual,
                    'delivery_confirmed_at': shipment.delivery_confirmed_at,
                    'delivery_confirmed_by': shipment.delivery_confirmed_by_id,
                    'delivery_confirmed_by_name': (
                        getattr(shipment.delivery_confirmed_by, 'full_name', None) or getattr(shipment.delivery_confirmed_by, 'username', None)
                        if getattr(shipment, 'delivery_confirmed_by', None)
                        else None
                    ),
                    'cancelled_at': shipment.cancelled_at,
                    'cancel_reason': shipment.cancel_reason,
                    'item_count': len(posted_transactions),
                    'line_count': len({tx.sales_order_line_id for tx in posted_transactions if tx.sales_order_line_id}),
                    'total_qty': sum((tx.quantity or Decimal('0')) for tx in posted_transactions),
                    **package_summary,
                }
            )
        return Response({'count': len(items), 'results': items})

    @action(detail=True, methods=['get'])
    def shipment_detail(self, request, pk=None):
        order = self.get_object()
        shipment_id = request.query_params.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        shipment = OutboundShipment.objects.filter(
            pk=shipment_id,
            sales_order=order,
        ).select_related(
            'loading_confirmed_by',
            'delivery_confirmed_by',
        ).prefetch_related(
            'transactions',
            'transactions__product',
            'transactions__sales_order_line',
            'packages',
        ).first()
        if not shipment:
            return Response({'error': 'Không tìm thấy shipment thuộc đơn hàng này.'}, status=status.HTTP_404_NOT_FOUND)
        package_count_map = {}
        package_defaults_map = {}
        for package in shipment.packages.filter(status='ACTIVE'):
            package_count_map[package.inventory_transaction_id] = package_count_map.get(package.inventory_transaction_id, 0) + 1
            package_defaults_map.setdefault(
                package.inventory_transaction_id,
                {
                    'package_type': package.package_type,
                    'gross_weight_kg': package.gross_weight_kg,
                    'length_cm': package.length_cm,
                    'width_cm': package.width_cm,
                    'height_cm': package.height_cm,
                    'package_note': package.note,
                },
            )
        items = []
        for tx in shipment.transactions.all():
            if tx.status != 'POSTED' or tx.transaction_type != 'ISSUE':
                continue
            line = getattr(tx, 'sales_order_line', None)
            snapshot = getattr(line, 'product_snapshot', None) or {}
            package_defaults = package_defaults_map.get(tx.id) or {}
            items.append(
                {
                    'transaction_id': tx.id,
                    'transaction_code': tx.code,
                    'line_id': getattr(line, 'id', None),
                    'line_number': getattr(line, 'line_number', None),
                    'product_id': tx.product_id,
                    'product_code': getattr(line, 'internal_product_code', None) or snapshot.get('code') or getattr(tx.product, 'code', None),
                    'product_name': snapshot.get('name') or getattr(tx.product, 'name', None),
                    'quantity': tx.quantity,
                    'trace_code': getattr(line, 'trace_code', '') or '',
                    'existing_package_count': package_count_map.get(tx.id, 0),
                    'package_type': package_defaults.get('package_type') or '',
                    'gross_weight_kg': package_defaults.get('gross_weight_kg') or Decimal('0'),
                    'length_cm': package_defaults.get('length_cm') or Decimal('0'),
                    'width_cm': package_defaults.get('width_cm') or Decimal('0'),
                    'height_cm': package_defaults.get('height_cm') or Decimal('0'),
                    'package_note': package_defaults.get('package_note') or '',
                }
            )
        package_summary = _build_package_summary(list(shipment.packages.all()))
        return Response(
            {
                'shipment_id': shipment.id,
                'shipment_code': shipment.code,
                'shipment_date': shipment.shipment_date,
                'status': shipment.status,
                'loading_reference': shipment.loading_reference,
                'handover_receiver_name': shipment.handover_receiver_name,
                'handover_receiver_phone': shipment.handover_receiver_phone,
                'handover_proof_url': shipment.handover_proof_url,
                'loading_confirmation_note': shipment.loading_confirmation_note,
                'loading_confirmed_at': shipment.loading_confirmed_at,
                'loading_confirmed_by': shipment.loading_confirmed_by_id,
                'loading_confirmed_by_name': (
                    getattr(shipment.loading_confirmed_by, 'full_name', None) or getattr(shipment.loading_confirmed_by, 'username', None)
                    if getattr(shipment, 'loading_confirmed_by', None)
                    else None
                ),
                'delivery_reference': shipment.delivery_reference,
                'customer_receiver_name': shipment.customer_receiver_name,
                'customer_receiver_phone': shipment.customer_receiver_phone,
                'delivery_proof_url': shipment.delivery_proof_url,
                'delivery_confirmation_note': shipment.delivery_confirmation_note,
                'delivered_at_actual': shipment.delivered_at_actual,
                'delivery_confirmed_at': shipment.delivery_confirmed_at,
                'delivery_confirmed_by': shipment.delivery_confirmed_by_id,
                'delivery_confirmed_by_name': (
                    getattr(shipment.delivery_confirmed_by, 'full_name', None) or getattr(shipment.delivery_confirmed_by, 'username', None)
                    if getattr(shipment, 'delivery_confirmed_by', None)
                    else None
                ),
                **package_summary,
                'items': items,
            }
        )

    @action(detail=True, methods=['get'])
    def shipment_package_overview(self, request, pk=None):
        order = self.get_object()
        shipment_id = request.query_params.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        OutboundShipmentPackage = apps.get_model('inventory', 'OutboundShipmentPackage')
        packages = (
            OutboundShipmentPackage.objects.filter(
                shipment_id=shipment_id,
                shipment__sales_order=order,
            )
            .select_related('inventory_transaction__product', 'sales_order_line', 'shipment', 'verified_by', 'loaded_by')
            .order_by('inventory_transaction_id', 'package_no', 'id')
        )
        items = [
            {
                'id': package.id,
                'shipment_id': package.shipment_id,
                'shipment_code': getattr(package.shipment, 'code', None),
                'transaction_id': package.inventory_transaction_id,
                'line_id': package.sales_order_line_id,
                'line_number': getattr(package.sales_order_line, 'line_number', None),
                'product_code': getattr(getattr(package.inventory_transaction, 'product', None), 'code', None),
                'product_name': getattr(getattr(package.inventory_transaction, 'product', None), 'name', None),
                'status': package.status,
                'package_no': package.package_no,
                'total_packages': package.total_packages,
                'quantity': package.quantity,
                'package_type': package.package_type,
                'gross_weight_kg': package.gross_weight_kg,
                'length_cm': package.length_cm,
                'width_cm': package.width_cm,
                'height_cm': package.height_cm,
                'package_code': package.package_code,
                'label_qr_value': package.label_qr_value,
                'note': package.note,
                'verified_at': package.verified_at,
                'verified_by': package.verified_by_id,
                'verified_by_name': (
                    getattr(package.verified_by, 'full_name', None) or getattr(package.verified_by, 'username', None)
                    if getattr(package, 'verified_by', None)
                    else None
                ),
                'loaded_at': package.loaded_at,
                'loaded_by': package.loaded_by_id,
                'loaded_by_name': (
                    getattr(package.loaded_by, 'full_name', None) or getattr(package.loaded_by, 'username', None)
                    if getattr(package, 'loaded_by', None)
                    else None
                ),
                'cancel_reason': package.cancel_reason,
            }
            for package in packages
        ]
        return Response({'count': len(items), 'results': items, **_build_package_summary(list(packages))})

    @action(detail=True, methods=['post'])
    def scan_shipment_package(self, request, pk=None):
        order = self.get_object()
        if not _can_manage_inventory_execution(request.user):
            return Response({'error': 'Bạn không có quyền scan kiện.'}, status=status.HTTP_403_FORBIDDEN)
        shipment_id = request.data.get('shipment_id')
        scan_value = str(request.data.get('scan_value') or request.data.get('package_code') or request.data.get('qr_value') or '').strip()
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        if not scan_value:
            return Response({'error': 'Thiếu mã kiện/QR để scan.'}, status=status.HTTP_400_BAD_REQUEST)

        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        OutboundShipmentPackage = apps.get_model('inventory', 'OutboundShipmentPackage')
        from django.db import transaction

        with transaction.atomic():
            shipment = (
                OutboundShipment.objects.select_for_update()
                .filter(pk=shipment_id, sales_order=order)
                .prefetch_related('packages')
                .first()
            )
            if not shipment:
                return Response({'error': 'Không tìm thấy shipment thuộc đơn hàng này.'}, status=status.HTTP_404_NOT_FOUND)
            if shipment.loading_confirmed_at:
                return Response({'error': 'Shipment đã xác nhận bàn giao xe, không thể scan lại kiện.'}, status=status.HTTP_400_BAD_REQUEST)
            package = (
                OutboundShipmentPackage.objects.select_for_update()
                .filter(
                    shipment=shipment,
                    status='ACTIVE',
                )
                .filter(Q(package_code__iexact=scan_value) | Q(label_qr_value__iexact=scan_value))
                .first()
            )
            if not package:
                return Response({'error': 'Không tìm thấy kiện phù hợp trong shipment này.'}, status=status.HTTP_404_NOT_FOUND)

            if not package.verified_at:
                package.verified_at = timezone.now()
                package.verified_by = request.user
                package.updated_by = request.user
                package.save(update_fields=['verified_at', 'verified_by', 'updated_by', 'updated_at'])
                scan_status = 'VERIFIED'
            else:
                scan_status = 'ALREADY_VERIFIED'

            active_packages = list(shipment.packages.filter(status='ACTIVE'))

        AuditLog.objects.create(
            user=request.user,
            action='SCAN',
            entity_type='OutboundShipmentPackage',
            entity_id=package.id,
            entity_code=package.package_code,
            old_values={},
            new_values={'shipment_id': shipment.id, 'shipment_code': shipment.code, 'scan_status': scan_status},
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(
            {
                'scan_status': scan_status,
                'shipment_id': shipment.id,
                'shipment_code': shipment.code,
                'package': {
                    'id': package.id,
                    'package_code': package.package_code,
                    'label_qr_value': package.label_qr_value,
                    'package_no': package.package_no,
                    'total_packages': package.total_packages,
                    'quantity': package.quantity,
                    'package_type': package.package_type,
                    'gross_weight_kg': package.gross_weight_kg,
                    'loaded_at': package.loaded_at,
                    'verified_at': package.verified_at,
                    'verified_by_name': (
                        getattr(package.verified_by, 'full_name', None) or getattr(package.verified_by, 'username', None)
                        if getattr(package, 'verified_by', None)
                        else None
                    ),
                    'line_number': getattr(getattr(package, 'sales_order_line', None), 'line_number', None),
                    'product_code': getattr(getattr(getattr(package, 'inventory_transaction', None), 'product', None), 'code', None),
                    'product_name': getattr(getattr(getattr(package, 'inventory_transaction', None), 'product', None), 'name', None),
                },
                **_build_package_summary(active_packages),
            }
        )

    @action(detail=True, methods=['post'])
    def mark_shipment_packages_loaded(self, request, pk=None):
        order = self.get_object()
        if not _can_manage_inventory_execution(request.user):
            return Response({'error': 'Bạn không có quyền xác nhận bốc xếp.'}, status=status.HTTP_403_FORBIDDEN)
        shipment_id = request.data.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        raw_package_ids = request.data.get('package_ids') or []
        if raw_package_ids and not isinstance(raw_package_ids, list):
            return Response({'error': 'package_ids phải là danh sách.'}, status=status.HTTP_400_BAD_REQUEST)

        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        OutboundShipmentPackage = apps.get_model('inventory', 'OutboundShipmentPackage')
        from django.db import transaction

        with transaction.atomic():
            shipment = (
                OutboundShipment.objects.select_for_update()
                .filter(pk=shipment_id, sales_order=order)
                .prefetch_related('packages')
                .first()
            )
            if not shipment:
                return Response({'error': 'Không tìm thấy shipment thuộc đơn hàng này.'}, status=status.HTTP_404_NOT_FOUND)
            if shipment.loading_confirmed_at:
                return Response({'error': 'Shipment đã xác nhận bàn giao xe, không thể bốc xếp lại.'}, status=status.HTTP_400_BAD_REQUEST)
            package_qs = OutboundShipmentPackage.objects.select_for_update().filter(shipment=shipment, status='ACTIVE')
            if raw_package_ids:
                package_qs = package_qs.filter(id__in=raw_package_ids)
            packages = list(package_qs)
            if not packages:
                return Response({'error': 'Không có kiện hợp lệ để xác nhận bốc xếp.'}, status=status.HTTP_400_BAD_REQUEST)
            unverified = [package.package_code for package in packages if not package.verified_at]
            if unverified:
                return Response(
                    {'error': f'Còn kiện chưa verify nên chưa thể bốc xếp: {", ".join(unverified[:5])}'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            now = timezone.now()
            updated_count = 0
            for package in packages:
                if package.loaded_at:
                    continue
                package.loaded_at = now
                package.loaded_by = request.user
                package.updated_by = request.user
                package.save(update_fields=['loaded_at', 'loaded_by', 'updated_by', 'updated_at'])
                updated_count += 1
            active_packages = list(shipment.packages.filter(status='ACTIVE'))

        AuditLog.objects.create(
            user=request.user,
            action='LOAD',
            entity_type='OutboundShipment',
            entity_id=shipment.id,
            entity_code=shipment.code,
            old_values={},
            new_values={'loaded_package_count_delta': updated_count, 'selected_package_count': len(packages)},
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(
            {
                'shipment_id': shipment.id,
                'shipment_code': shipment.code,
                'loaded_count': updated_count,
                **_build_package_summary(active_packages),
            }
        )

    @action(detail=True, methods=['post'])
    def confirm_shipment_loading(self, request, pk=None):
        order = self.get_object()
        if not _can_manage_inventory_execution(request.user):
            return Response({'error': 'Bạn không có quyền xác nhận bàn giao xe.'}, status=status.HTTP_403_FORBIDDEN)
        shipment_id = request.data.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        receiver_name = str(request.data.get('handover_receiver_name') or '').strip()
        receiver_phone = str(request.data.get('handover_receiver_phone') or '').strip()
        proof_url = str(request.data.get('handover_proof_url') or '').strip()
        confirmation_note = str(request.data.get('loading_confirmation_note') or request.data.get('note') or '').strip()
        loading_reference = str(request.data.get('loading_reference') or '').strip()
        if not receiver_name:
            return Response({'error': 'Bàn giao xe bắt buộc có người nhận.'}, status=status.HTTP_400_BAD_REQUEST)

        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        from django.db import transaction

        with transaction.atomic():
            shipment = (
                OutboundShipment.objects.select_for_update()
                .filter(pk=shipment_id, sales_order=order)
                .prefetch_related('packages', 'transactions', 'transactions__sales_order_line')
                .first()
            )
            if not shipment:
                return Response({'error': 'Không tìm thấy shipment thuộc đơn hàng này.'}, status=status.HTTP_404_NOT_FOUND)
            active_packages = list(shipment.packages.filter(status='ACTIVE'))
            if not active_packages:
                return Response({'error': 'Shipment chưa có kiện active để xác nhận bàn giao.'}, status=status.HTTP_400_BAD_REQUEST)
            if shipment.loading_confirmed_at:
                return Response({'error': 'Shipment đã xác nhận bàn giao xe trước đó.'}, status=status.HTTP_400_BAD_REQUEST)
            pending_loaded = [package.package_code for package in active_packages if not package.loaded_at]
            if pending_loaded:
                return Response(
                    {'error': f'Còn kiện chưa bốc xếp xong: {", ".join(pending_loaded[:5])}'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not proof_url:
                proof_url = _latest_shipment_attachment_url(request, shipment.id, LOAD_PROOF_ATTACHMENT_PREFIX)

            shipment.loading_reference = loading_reference or shipment.loading_reference or f'LOAD-{shipment.code}'
            shipment.handover_receiver_name = receiver_name
            shipment.handover_receiver_phone = receiver_phone
            shipment.handover_proof_url = proof_url
            shipment.loading_confirmation_note = confirmation_note
            shipment.loading_confirmed_at = timezone.now()
            shipment.loading_confirmed_by = request.user
            shipment.updated_by = request.user
            shipment.save(
                update_fields=[
                    'loading_reference',
                    'handover_receiver_name',
                    'handover_receiver_phone',
                    'handover_proof_url',
                    'loading_confirmation_note',
                    'loading_confirmed_at',
                    'loading_confirmed_by',
                    'updated_by',
                    'updated_at',
                ]
            )

        AuditLog.objects.create(
            user=request.user,
            action='CONFIRM_LOADING',
            entity_type='OutboundShipment',
            entity_id=shipment.id,
            entity_code=shipment.code,
            old_values={},
            new_values={
                'loading_reference': shipment.loading_reference,
                'receiver_name': shipment.handover_receiver_name,
                'receiver_phone': shipment.handover_receiver_phone,
            },
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(
            {
                'shipment_id': shipment.id,
                'shipment_code': shipment.code,
                'loading_reference': shipment.loading_reference,
                'handover_receiver_name': shipment.handover_receiver_name,
                'handover_receiver_phone': shipment.handover_receiver_phone,
                'handover_proof_url': shipment.handover_proof_url,
                'loading_confirmation_note': shipment.loading_confirmation_note,
                'loading_confirmed_at': shipment.loading_confirmed_at,
                'loading_confirmed_by': shipment.loading_confirmed_by_id,
                'loading_confirmed_by_name': getattr(request.user, 'full_name', None) or getattr(request.user, 'username', None),
                **_build_package_summary(active_packages),
            }
        )

    @action(detail=True, methods=['post'])
    def confirm_shipment_delivery(self, request, pk=None):
        order = self.get_object()
        if not _can_manage_inventory_execution(request.user):
            return Response({'error': 'Bạn không có quyền xác nhận giao hàng.'}, status=status.HTTP_403_FORBIDDEN)
        shipment_id = request.data.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        customer_receiver_name = str(request.data.get('customer_receiver_name') or '').strip()
        customer_receiver_phone = str(request.data.get('customer_receiver_phone') or '').strip()
        delivery_proof_url = str(request.data.get('delivery_proof_url') or '').strip()
        delivery_confirmation_note = str(request.data.get('delivery_confirmation_note') or request.data.get('note') or '').strip()
        delivery_reference = str(request.data.get('delivery_reference') or '').strip()
        delivered_at_actual_raw = str(request.data.get('delivered_at_actual') or '').strip()
        if not customer_receiver_name:
            return Response({'error': 'Xác nhận giao xong bắt buộc có người nhận cuối.'}, status=status.HTTP_400_BAD_REQUEST)

        delivered_at_actual = timezone.now()
        if delivered_at_actual_raw:
            parsed_delivered_at = parse_datetime(delivered_at_actual_raw)
            if not parsed_delivered_at:
                return Response({'error': 'delivered_at_actual không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
            if timezone.is_naive(parsed_delivered_at):
                parsed_delivered_at = timezone.make_aware(parsed_delivered_at, timezone.get_current_timezone())
            delivered_at_actual = parsed_delivered_at

        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        from django.db import transaction

        with transaction.atomic():
            shipment = (
                OutboundShipment.objects.select_for_update()
                .filter(pk=shipment_id, sales_order=order)
                .prefetch_related('packages')
                .first()
            )
            if not shipment:
                return Response({'error': 'Không tìm thấy shipment thuộc đơn hàng này.'}, status=status.HTTP_404_NOT_FOUND)
            active_packages = list(shipment.packages.filter(status='ACTIVE'))
            if not active_packages:
                return Response({'error': 'Shipment chưa có kiện active để xác nhận giao xong.'}, status=status.HTTP_400_BAD_REQUEST)
            if not shipment.loading_confirmed_at:
                return Response({'error': 'Cần xác nhận bàn giao xe trước khi xác nhận giao xong.'}, status=status.HTTP_400_BAD_REQUEST)
            if shipment.delivery_confirmed_at:
                return Response({'error': 'Shipment đã được xác nhận giao xong trước đó.'}, status=status.HTTP_400_BAD_REQUEST)
            if not delivery_proof_url:
                delivery_proof_url = _latest_shipment_attachment_url(request, shipment.id, DELIVERY_PROOF_ATTACHMENT_PREFIX)

            delivery_allocations = {}
            for tx in shipment.transactions.all():
                if tx.status != 'POSTED' or tx.transaction_type != 'ISSUE' or not tx.sales_order_line_id:
                    continue
                delivery_allocations[tx.sales_order_line] = delivery_allocations.get(tx.sales_order_line, Decimal('0')) + Decimal(str(tx.quantity or 0))

            for line, qty in delivery_allocations.items():
                apply_delivery_plan_delivery(
                    line,
                    qty,
                    actor=request.user,
                    delivery_date=delivered_at_actual.date(),
                )

            shipment.delivery_reference = delivery_reference or shipment.delivery_reference or f'DEL-{shipment.code}'
            shipment.customer_receiver_name = customer_receiver_name
            shipment.customer_receiver_phone = customer_receiver_phone
            shipment.delivery_proof_url = delivery_proof_url
            shipment.delivery_confirmation_note = delivery_confirmation_note
            shipment.delivered_at_actual = delivered_at_actual
            shipment.delivery_confirmed_at = timezone.now()
            shipment.delivery_confirmed_by = request.user
            shipment.updated_by = request.user
            shipment.save(
                update_fields=[
                    'delivery_reference',
                    'customer_receiver_name',
                    'customer_receiver_phone',
                    'delivery_proof_url',
                    'delivery_confirmation_note',
                    'delivered_at_actual',
                    'delivery_confirmed_at',
                    'delivery_confirmed_by',
                    'updated_by',
                    'updated_at',
                ]
            )

        AuditLog.objects.create(
            user=request.user,
            action='CONFIRM_DELIVERY',
            entity_type='OutboundShipment',
            entity_id=shipment.id,
            entity_code=shipment.code,
            old_values={},
            new_values={
                'delivery_reference': shipment.delivery_reference,
                'customer_receiver_name': shipment.customer_receiver_name,
                'customer_receiver_phone': shipment.customer_receiver_phone,
                'delivered_at_actual': shipment.delivered_at_actual.isoformat() if shipment.delivered_at_actual else None,
            },
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(
            {
                'shipment_id': shipment.id,
                'shipment_code': shipment.code,
                'delivery_reference': shipment.delivery_reference,
                'customer_receiver_name': shipment.customer_receiver_name,
                'customer_receiver_phone': shipment.customer_receiver_phone,
                'delivery_proof_url': shipment.delivery_proof_url,
                'delivery_confirmation_note': shipment.delivery_confirmation_note,
                'delivered_at_actual': shipment.delivered_at_actual,
                'delivery_confirmed_at': shipment.delivery_confirmed_at,
                'delivery_confirmed_by': shipment.delivery_confirmed_by_id,
                'delivery_confirmed_by_name': getattr(request.user, 'full_name', None) or getattr(request.user, 'username', None),
                **_build_package_summary(active_packages),
            }
        )

    @action(detail=True, methods=['post'])
    def cancel_shipment(self, request, pk=None):
        order = self.get_object()
        if not _can_manage_inventory_execution(request.user):
            return Response({'error': 'Bạn không có quyền hủy shipment.'}, status=status.HTTP_403_FORBIDDEN)
        shipment_id = request.data.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        reason = (request.data.get('reason') or request.data.get('cancel_reason') or '').strip()
        if not reason:
            return Response({'error': 'Hủy shipment bắt buộc có lý do.'}, status=status.HTTP_400_BAD_REQUEST)

        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        from inventory.services import cancel_inventory_transaction_record
        from django.db import transaction

        with transaction.atomic():
            shipment = (
                OutboundShipment.objects.select_for_update()
                .filter(pk=shipment_id, sales_order=order)
                .prefetch_related('transactions', 'transactions__reservation', 'transactions__sales_order_line')
                .first()
            )
            if not shipment:
                return Response({'error': 'Không tìm thấy shipment thuộc đơn hàng này.'}, status=status.HTTP_404_NOT_FOUND)
            if shipment.status != 'POSTED':
                return Response({'error': 'Chỉ hủy được shipment đang POSTED.'}, status=status.HTTP_400_BAD_REQUEST)
            if shipment.loading_confirmed_at:
                return Response({'error': 'Shipment đã xác nhận bàn giao xe, không thể hủy.'}, status=status.HTTP_400_BAD_REQUEST)

            posted_transactions = [tx for tx in shipment.transactions.all() if tx.status == 'POSTED']
            if not posted_transactions:
                return Response({'error': 'Shipment không còn giao dịch POSTED để hủy.'}, status=status.HTTP_400_BAD_REQUEST)

            cancelled_count = 0
            for tx in posted_transactions:
                cancel_inventory_transaction_record(tx, actor=request.user, reason=reason)
                cancelled_count += 1
            shipment.refresh_from_db()

        AuditLog.objects.create(
            user=request.user,
            action='CANCEL',
            entity_type='OutboundShipment',
            entity_id=shipment.id,
            entity_code=shipment.code,
            old_values={'status': 'POSTED'},
            new_values={'status': shipment.status, 'reason': reason, 'cancelled_count': cancelled_count},
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response(
            {
                'status': shipment.status,
                'shipment_id': shipment.id,
                'shipment_code': shipment.code,
                'cancelled_count': cancelled_count,
            }
        )

    @action(detail=True, methods=['post'])
    def pack_shipment(self, request, pk=None):
        order = self.get_object()
        if not _can_manage_inventory_execution(request.user):
            return Response({'error': 'Bạn không có quyền đóng gói shipment.'}, status=status.HTTP_403_FORBIDDEN)
        shipment_id = request.data.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        raw_items = request.data.get('items')
        if not isinstance(raw_items, list) or not raw_items:
            return Response({'error': 'Cần ít nhất 1 dòng đóng gói.'}, status=status.HTTP_400_BAD_REQUEST)
        replace_existing = request.data.get('replace_existing', True)

        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        OutboundShipmentPackage = apps.get_model('inventory', 'OutboundShipmentPackage')
        from django.db import transaction

        with transaction.atomic():
            shipment = (
                OutboundShipment.objects.select_for_update()
                .filter(pk=shipment_id, sales_order=order)
                .prefetch_related('transactions', 'transactions__sales_order_line', 'transactions__product', 'packages')
                .first()
            )
            if not shipment:
                return Response({'error': 'Không tìm thấy shipment thuộc đơn hàng này.'}, status=status.HTTP_404_NOT_FOUND)
            if shipment.status != 'POSTED':
                return Response({'error': 'Chỉ đóng gói được shipment đang POSTED.'}, status=status.HTTP_400_BAD_REQUEST)
            if shipment.loading_confirmed_at:
                return Response({'error': 'Shipment đã xác nhận bàn giao xe, không thể đóng gói lại.'}, status=status.HTTP_400_BAD_REQUEST)
            if replace_existing:
                shipment.packages.all().delete()
            elif shipment.packages.exists():
                return Response({'error': 'Shipment đã có package records. Hãy bật replace_existing để đóng gói lại.'}, status=status.HTTP_400_BAD_REQUEST)

            tx_map = {tx.id: tx for tx in shipment.transactions.all() if tx.status == 'POSTED' and tx.transaction_type == 'ISSUE'}
            created = []
            for index, item in enumerate(raw_items, start=1):
                transaction_id = item.get('transaction_id')
                tx = tx_map.get(transaction_id)
                if not tx:
                    raise ValidationError({'error': f'Dòng {index}: transaction_id không thuộc shipment này.'})
                try:
                    package_count = int(item.get('package_count') or 0)
                except (TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: package_count không hợp lệ.'})
                if package_count <= 0:
                    raise ValidationError({'error': f'Dòng {index}: package_count phải > 0.'})
                if package_count > 200:
                    raise ValidationError({'error': f'Dòng {index}: package_count quá lớn.'})

                total_qty = Decimal(str(tx.quantity or 0))
                package_type = (item.get('package_type') or '').strip()
                try:
                    gross_weight_kg = Decimal(str(item.get('gross_weight_kg') or 0))
                    length_cm = Decimal(str(item.get('length_cm') or 0))
                    width_cm = Decimal(str(item.get('width_cm') or 0))
                    height_cm = Decimal(str(item.get('height_cm') or 0))
                except (TypeError, ValueError, InvalidOperation):
                    raise ValidationError({'error': f'Dòng {index}: thông số kiện không hợp lệ.'})
                if gross_weight_kg < 0 or length_cm < 0 or width_cm < 0 or height_cm < 0:
                    raise ValidationError({'error': f'Dòng {index}: thông số kiện không được âm.'})
                base_qty = (total_qty / Decimal(package_count)) if package_count else Decimal('0')
                rounded_base_qty = base_qty.quantize(Decimal('0.0001'))
                allocated_qty = Decimal('0')
                line = getattr(tx, 'sales_order_line', None)
                for package_no in range(1, package_count + 1):
                    package_qty = rounded_base_qty
                    if package_no == package_count:
                        package_qty = total_qty - allocated_qty
                    allocated_qty += package_qty
                    package = OutboundShipmentPackage.objects.create(
                        shipment=shipment,
                        inventory_transaction=tx,
                        sales_order_line=line,
                        package_no=package_no,
                        total_packages=package_count,
                        quantity=package_qty,
                        package_type=package_type,
                        gross_weight_kg=gross_weight_kg,
                        length_cm=length_cm,
                        width_cm=width_cm,
                        height_cm=height_cm,
                        package_code=build_shipment_package_code(shipment.code, getattr(line, 'line_number', None), package_no),
                        label_qr_value=build_shipment_package_trace_code(getattr(line, 'trace_code', ''), shipment.code, package_no),
                        note=(item.get('note') or '').strip(),
                        created_by=request.user,
                        updated_by=request.user,
                    )
                    created.append(
                        {
                            'id': package.id,
                            'transaction_id': tx.id,
                            'package_code': package.package_code,
                            'label_qr_value': package.label_qr_value,
                            'quantity': package.quantity,
                        }
                    )

        return Response(
            {
                'shipment_id': shipment.id,
                'shipment_code': shipment.code,
                'package_count': len(created),
                'results': created,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'])
    def ship(self, request, pk=None):
        order = self.get_object()
        if not _can_manage_inventory_execution(request.user):
            return Response({'error': 'Bạn không có quyền thực hiện xuất kho.'}, status=status.HTTP_403_FORBIDDEN)
        if order.status not in [SalesOrderStatus.APPROVED, SalesOrderStatus.POSTED]:
            return Response({'error': 'Chỉ đơn đã duyệt hoặc đã post mới được xuất kho.'}, status=status.HTTP_400_BAD_REQUEST)

        raw_items = request.data.get('items')
        if not isinstance(raw_items, list):
            raw_items = [request.data] if request.data.get('reservation_id') else []
        if not raw_items:
            return Response({'error': 'Cần ít nhất 1 reservation để xuất kho.'}, status=status.HTTP_400_BAD_REQUEST)

        InventoryReservation = apps.get_model('inventory', 'InventoryReservation')
        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        from inventory.serializers import InventoryTransactionSerializer
        from inventory.services import apply_reservation_fulfillment, get_next_inventory_shipment_code

        seen_reservation_ids = set()
        created_items = []
        transaction_date = request.data.get('transaction_date') or timezone.localdate().isoformat()
        common_reference = (request.data.get('reference') or order.code or '').strip()
        common_reason = (request.data.get('reason') or 'Xuất kho theo đơn hàng').strip()
        common_note = (request.data.get('note') or '').strip()
        shipment_carrier_name = (request.data.get('carrier_name') or '').strip()
        shipment_tracking_number = (request.data.get('tracking_number') or '').strip()
        shipment_vehicle_no = (request.data.get('vehicle_no') or '').strip()
        shipment_driver_name = (request.data.get('driver_name') or '').strip()
        shipment_driver_phone = (request.data.get('driver_phone') or '').strip()
        try:
            shipment_date_value = date.fromisoformat(str(transaction_date))
        except (TypeError, ValueError):
            return Response({'error': 'Ngày shipment không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        from django.db import transaction
        with transaction.atomic():
            shipment_batch = OutboundShipment.objects.create(
                code=get_next_inventory_shipment_code(shipment_date_value),
                sales_order=order,
                shipment_date=shipment_date_value,
                reference=common_reference,
                carrier_name=shipment_carrier_name,
                tracking_number=shipment_tracking_number,
                vehicle_no=shipment_vehicle_no,
                driver_name=shipment_driver_name,
                driver_phone=shipment_driver_phone,
                note=common_note,
                posted_by=request.user,
                created_by=request.user,
                updated_by=request.user,
            )
            for index, item in enumerate(raw_items, start=1):
                reservation_id = item.get('reservation_id')
                if not reservation_id:
                    raise ValidationError({'error': f'Dòng {index}: thiếu reservation_id.'})
                if reservation_id in seen_reservation_ids:
                    raise ValidationError({'error': f'Dòng {index}: reservation bị lặp trong cùng chứng từ xuất.'})
                seen_reservation_ids.add(reservation_id)

                reservation = InventoryReservation.objects.select_for_update().filter(
                    pk=reservation_id,
                    sales_order=order,
                ).first()
                if not reservation:
                    raise ValidationError({'error': f'Dòng {index}: reservation không thuộc đơn hàng này.'})
                try:
                    quantity = Decimal(str(item.get('quantity') or reservation.active_qty))
                except (InvalidOperation, TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: quantity không hợp lệ.'})
                if quantity <= 0:
                    raise ValidationError({'error': f'Dòng {index}: quantity phải > 0.'})

                serializer = InventoryTransactionSerializer(data={
                    'transaction_type': 'ISSUE',
                    'transaction_date': item.get('transaction_date') or transaction_date,
                    'product': reservation.product_id,
                    'warehouse': reservation.warehouse_id,
                    'location': reservation.location_id,
                    'quantity': str(quantity),
                    'unit_cost': str(item.get('unit_cost') or 0),
                    'sales_order': order.id,
                    'sales_order_line': reservation.sales_order_line_id,
                    'reservation': reservation.id,
                    'reference': (item.get('reference') or common_reference or order.code or '').strip(),
                    'reason': (item.get('reason') or common_reason).strip(),
                    'note': (item.get('note') or common_note).strip(),
                })
                serializer.is_valid(raise_exception=True)
                shipment = serializer.save(
                    created_by=request.user,
                    updated_by=request.user,
                    posted_by=request.user,
                    shipment_batch=shipment_batch,
                )
                apply_reservation_fulfillment(reservation, shipment.quantity or Decimal('0'), actor=request.user)
                if reservation.sales_order_line_id:
                    apply_delivery_plan_shipment(
                        reservation.sales_order_line,
                        shipment.quantity or Decimal('0'),
                        actor=request.user,
                        shipment_date=shipment.transaction_date,
                    )
                created_items.append({
                    'id': shipment.id,
                    'code': shipment.code,
                    'shipment_id': shipment_batch.id,
                    'shipment_code': shipment_batch.code,
                    'reservation_code': reservation.code,
                    'quantity': shipment.quantity,
                })
        return Response(
            {
                'created_count': len(created_items),
                'shipment_id': shipment_batch.id,
                'shipment_code': shipment_batch.code,
                'results': created_items,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['get'])
    def packing_slip_pdf(self, request, pk=None):
        order = self.get_object()
        InventoryReservation = apps.get_model('inventory', 'InventoryReservation')
        InventoryTransaction = apps.get_model('inventory', 'InventoryTransaction')
        reservation_map = {
            item['sales_order_line_id']: item
            for item in InventoryReservation.objects.filter(sales_order=order)
            .values('sales_order_line_id')
            .annotate(reserved_qty_total=Sum('reserved_qty'))
        }
        shipment_map = {
            item['sales_order_line_id']: item['shipped_qty_total']
            for item in InventoryTransaction.objects.filter(
                sales_order=order,
                transaction_type='ISSUE',
                status='POSTED',
            ).values('sales_order_line_id').annotate(shipped_qty_total=Sum('quantity'))
        }
        lines = list(order.lines.all().order_by('line_number'))
        shipments = list(
            InventoryTransaction.objects.filter(
                sales_order=order,
                transaction_type='ISSUE',
            ).select_related('warehouse', 'location', 'reservation', 'sales_order_line').order_by('-transaction_date', '-id')[:10]
        )

        def build(pdf):
            width, height = A4
            pdf.setTitle(f'Packing Slip {order.code}')
            y = height - 20 * mm
            pdf.setFont('Helvetica-Bold', 15)
            pdf.drawString(18 * mm, y, f'PACKING SLIP - {order.code}')
            y -= 8 * mm
            pdf.setFont('Helvetica', 10)
            pdf.drawString(18 * mm, y, f'Khach hang: {getattr(order.customer, "name", "-") or "-"}')
            pdf.drawString(110 * mm, y, f'Ngay don: {order.order_date}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Trang thai: {order.status}')
            pdf.drawString(110 * mm, y, f'Ngay giao: {order.delivery_date or "-"}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Tham chieu: {order.reference or "-"}')
            pdf.drawString(110 * mm, y, f'Post #: {order.post_number or "-"}')
            y -= 10 * mm

            headers = ['#', 'San pham', 'SL dat', 'Reserved', 'Shipped', 'Con reserve', 'Trace']
            widths = [10 * mm, 56 * mm, 20 * mm, 20 * mm, 20 * mm, 22 * mm, 42 * mm]
            x = 18 * mm
            pdf.setFillColor(colors.HexColor('#f0f0f0'))
            pdf.rect(x, y - 6 * mm, sum(widths), 7 * mm, fill=1, stroke=0)
            pdf.setFillColor(colors.black)
            pdf.setFont('Helvetica-Bold', 9)
            cursor = x + 1.5 * mm
            for header, col_width in zip(headers, widths):
                pdf.drawString(cursor, y - 3.5 * mm, header)
                cursor += col_width
            y -= 9 * mm

            pdf.setFont('Helvetica', 8)
            for line in lines:
                snapshot = getattr(line, 'product_snapshot', None) or {}
                reserved_qty = (reservation_map.get(line.id) or {}).get('reserved_qty_total') or Decimal('0')
                shipped_qty = shipment_map.get(line.id) or Decimal('0')
                remaining_reserve = (line.qty or Decimal('0')) - reserved_qty
                if y < 45 * mm:
                    pdf.showPage()
                    y = height - 20 * mm
                    pdf.setFont('Helvetica', 8)
                values = [
                    str(line.line_number),
                    f'{line.internal_product_code or snapshot.get("code") or ""} - {snapshot.get("name") or getattr(line.product, "name", "")}',
                    str(line.qty or 0),
                    str(reserved_qty),
                    str(shipped_qty),
                    str(remaining_reserve if remaining_reserve > 0 else Decimal("0")),
                    line.trace_code or '',
                ]
                cursor = x + 1.5 * mm
                row_height = 8 * mm
                pdf.rect(x, y - 6 * mm, sum(widths), row_height, stroke=1, fill=0)
                for value, col_width in zip(values, widths):
                    text = str(value)
                    if len(text) > 34:
                        text = text[:31] + '...'
                    pdf.drawString(cursor, y - 3.5 * mm, text)
                    cursor += col_width
                y -= row_height

            y -= 4 * mm
            pdf.setFont('Helvetica-Bold', 10)
            pdf.drawString(18 * mm, y, 'Phieu xuat kho gan nhat')
            y -= 6 * mm
            pdf.setFont('Helvetica', 8)
            if not shipments:
                pdf.drawString(18 * mm, y, 'Chua co phieu xuat kho.')
            else:
                for shipment in shipments:
                    if y < 20 * mm:
                        pdf.showPage()
                        y = height - 20 * mm
                        pdf.setFont('Helvetica', 8)
                    shipment_line = getattr(getattr(shipment, 'sales_order_line', None), 'line_number', '-')
                    shipment_loc = ' / '.join(filter(None, [getattr(getattr(shipment, 'warehouse', None), 'name', None), getattr(getattr(shipment, 'location', None), 'name', None)])) or '-'
                    pdf.drawString(
                        18 * mm,
                        y,
                        f'{shipment.code} | Line {shipment_line} | {shipment.quantity} | {shipment_loc} | {shipment.transaction_date}'
                    )
                    y -= 5 * mm

        return _sales_order_pdf_response(f'packing_slip_{order.code}.pdf', build)

    @action(detail=True, methods=['get'])
    def shipment_packing_slip_pdf(self, request, pk=None):
        order = self.get_object()
        shipment_id = request.query_params.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        shipment = OutboundShipment.objects.filter(
            pk=shipment_id,
            sales_order=order,
        ).prefetch_related(
            'packages',
            'transactions',
            'transactions__product',
            'transactions__warehouse',
            'transactions__location',
            'transactions__reservation',
            'transactions__sales_order_line',
        ).first()
        if not shipment:
            return Response({'error': 'Không tìm thấy shipment thuộc đơn hàng này.'}, status=status.HTTP_404_NOT_FOUND)
        shipment_items = [tx for tx in shipment.transactions.all() if tx.status == 'POSTED' and tx.transaction_type == 'ISSUE']
        package_count_map = {}
        for package in shipment.packages.filter(status='ACTIVE').only('inventory_transaction_id'):
            package_count_map[package.inventory_transaction_id] = package_count_map.get(package.inventory_transaction_id, 0) + 1

        def build(pdf):
            width, height = A4
            pdf.setTitle(f'Shipment Packing Slip {shipment.code}')
            y = height - 20 * mm
            pdf.setFont('Helvetica-Bold', 15)
            pdf.drawString(18 * mm, y, f'SHIPMENT PACKING SLIP - {shipment.code}')
            y -= 8 * mm
            pdf.setFont('Helvetica', 10)
            pdf.drawString(18 * mm, y, f'Don hang: {order.code}')
            pdf.drawString(110 * mm, y, f'Ngay xuat: {shipment.shipment_date}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Khach hang: {getattr(order.customer, "name", "-") or "-"}')
            pdf.drawString(110 * mm, y, f'Tracking: {shipment.tracking_number or "-"}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Nha van chuyen: {shipment.carrier_name or "-"}')
            pdf.drawString(110 * mm, y, f'Xe: {shipment.vehicle_no or "-"}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Tai xe: {shipment.driver_name or "-"}')
            pdf.drawString(110 * mm, y, f'DT tai xe: {shipment.driver_phone or "-"}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Tham chieu: {shipment.reference or "-"}')
            y -= 10 * mm

            headers = ['#', 'San pham', 'Kho / vi tri', 'Reserve', 'SL xuat', 'So kien', 'Trace']
            widths = [10 * mm, 48 * mm, 34 * mm, 24 * mm, 18 * mm, 18 * mm, 34 * mm]
            x = 18 * mm
            pdf.setFillColor(colors.HexColor('#f0f0f0'))
            pdf.rect(x, y - 6 * mm, sum(widths), 7 * mm, fill=1, stroke=0)
            pdf.setFillColor(colors.black)
            pdf.setFont('Helvetica-Bold', 9)
            cursor = x + 1.5 * mm
            for header, col_width in zip(headers, widths):
                pdf.drawString(cursor, y - 3.5 * mm, header)
                cursor += col_width
            y -= 9 * mm

            pdf.setFont('Helvetica', 8)
            for tx in shipment_items:
                if y < 25 * mm:
                    pdf.showPage()
                    y = height - 20 * mm
                    pdf.setFont('Helvetica', 8)
                line = getattr(tx, 'sales_order_line', None)
                snapshot = getattr(line, 'product_snapshot', None) or {}
                values = [
                    str(getattr(line, 'line_number', '-') or '-'),
                    f'{getattr(line, "internal_product_code", "") or snapshot.get("code") or getattr(tx.product, "code", "")} - {snapshot.get("name") or getattr(tx.product, "name", "")}',
                    ' / '.join(filter(None, [getattr(getattr(tx, 'warehouse', None), 'name', None), getattr(getattr(tx, 'location', None), 'name', None)])) or '-',
                    getattr(getattr(tx, 'reservation', None), 'code', None) or '-',
                    str(tx.quantity or 0),
                    str(package_count_map.get(tx.id, 0)),
                    getattr(line, 'trace_code', '') or '',
                ]
                cursor = x + 1.5 * mm
                row_height = 8 * mm
                pdf.rect(x, y - 6 * mm, sum(widths), row_height, stroke=1, fill=0)
                for value, col_width in zip(values, widths):
                    text = str(value)
                    if len(text) > 34:
                        text = text[:31] + '...'
                    pdf.drawString(cursor, y - 3.5 * mm, text)
                    cursor += col_width
                y -= row_height

            y -= 4 * mm
            pdf.setFont('Helvetica', 9)
            pdf.drawString(18 * mm, y, f'Ghi chu shipment: {shipment.note or "-"}')
            y -= 5 * mm
            pdf.drawString(18 * mm, y, f'Tong so kien: {sum(package_count_map.values())}')

        return _sales_order_pdf_response(f'shipment_packing_slip_{shipment.code}.pdf', build)

    @action(detail=True, methods=['get'])
    def shipment_package_labels_pdf(self, request, pk=None):
        order = self.get_object()
        shipment_id = request.query_params.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        OutboundShipmentPackage = apps.get_model('inventory', 'OutboundShipmentPackage')
        packages = list(
            OutboundShipmentPackage.objects.filter(
                shipment_id=shipment_id,
                shipment__sales_order=order,
                status='ACTIVE',
            )
            .select_related('shipment', 'sales_order_line', 'inventory_transaction__product')
            .order_by('inventory_transaction_id', 'package_no', 'id')
        )
        if not packages:
            return Response({'error': 'Shipment chưa có package records để in tem.'}, status=status.HTTP_400_BAD_REQUEST)
        shipment = packages[0].shipment

        def build(pdf):
            width, height = A4
            label_width = 90 * mm
            label_height = 45 * mm
            margin_x = 12 * mm
            margin_y = 15 * mm
            gap_x = 8 * mm
            gap_y = 8 * mm
            x_positions = [margin_x, margin_x + label_width + gap_x]
            y = height - margin_y - label_height

            for index, package in enumerate(packages):
                col = index % 2
                if index > 0 and col == 0:
                    y -= label_height + gap_y
                    if y < 15 * mm:
                        pdf.showPage()
                        y = height - margin_y - label_height
                x = x_positions[col]
                line = getattr(package, 'sales_order_line', None)
                tx_product = getattr(getattr(package, 'inventory_transaction', None), 'product', None)
                snapshot = getattr(line, 'product_snapshot', None) or {}
                product_code = getattr(line, 'internal_product_code', None) or snapshot.get('code') or getattr(tx_product, 'code', '')
                product_name = snapshot.get('name') or getattr(tx_product, 'name', '')
                pdf.setStrokeColor(colors.black)
                pdf.rect(x, y, label_width, label_height, stroke=1, fill=0)
                pdf.setFont('Helvetica-Bold', 11)
                pdf.drawString(x + 4 * mm, y + label_height - 8 * mm, shipment.code)
                pdf.setFont('Helvetica-Bold', 10)
                pdf.drawString(x + 4 * mm, y + label_height - 15 * mm, f'Line {getattr(line, "line_number", "-")}: {product_code}')
                pdf.setFont('Helvetica', 8)
                if len(product_name) > 32:
                    product_name = product_name[:29] + '...'
                pdf.drawString(x + 4 * mm, y + label_height - 21 * mm, product_name)
                pdf.drawString(x + 4 * mm, y + label_height - 27 * mm, f'Kien {package.package_no}/{package.total_packages} | SL kien: {package.quantity}')
                package_meta = []
                if package.package_type:
                    package_meta.append(package.package_type)
                if package.gross_weight_kg:
                    package_meta.append(f'{package.gross_weight_kg}kg')
                if package.length_cm or package.width_cm or package.height_cm:
                    package_meta.append(f'{package.length_cm}x{package.width_cm}x{package.height_cm}cm')
                pdf.drawString(x + 4 * mm, y + label_height - 33 * mm, (' | '.join(package_meta) or f'Ma kien: {package.package_code}')[:42])
                pdf.drawString(x + 4 * mm, y + label_height - 39 * mm, f'Ma kien: {package.package_code}'[:42])
                pdf.drawString(x + 4 * mm, y + 6 * mm, str(package.label_qr_value)[:44])
                _draw_pdf_qr(pdf, package.label_qr_value, x=x + label_width - 27 * mm, y=y + 6 * mm, size=20 * mm)

        return _sales_order_pdf_response(f'shipment_package_labels_{shipment.code}.pdf', build)

    @action(detail=True, methods=['get'])
    def shipment_packing_manifest_pdf(self, request, pk=None):
        order = self.get_object()
        shipment_id = request.query_params.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        OutboundShipmentPackage = apps.get_model('inventory', 'OutboundShipmentPackage')
        packages = list(
            OutboundShipmentPackage.objects.filter(
                shipment_id=shipment_id,
                shipment__sales_order=order,
                status='ACTIVE',
            )
            .select_related('shipment', 'inventory_transaction__product', 'sales_order_line')
            .order_by('package_no', 'id')
        )
        if not packages:
            return Response({'error': 'Shipment chưa có package records để in manifest.'}, status=status.HTTP_400_BAD_REQUEST)
        shipment = packages[0].shipment
        total_weight = sum((package.gross_weight_kg or Decimal('0')) for package in packages)

        def build(pdf):
            width, height = A4
            pdf.setTitle(f'Shipment Manifest {shipment.code}')
            y = height - 20 * mm
            pdf.setFont('Helvetica-Bold', 15)
            pdf.drawString(18 * mm, y, f'PACKING MANIFEST - {shipment.code}')
            y -= 8 * mm
            pdf.setFont('Helvetica', 10)
            pdf.drawString(18 * mm, y, f'Don hang: {order.code}')
            pdf.drawString(110 * mm, y, f'Ngay xuat: {shipment.shipment_date}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Khach hang: {getattr(order.customer, "name", "-") or "-"}')
            pdf.drawString(110 * mm, y, f'Carrier: {shipment.carrier_name or "-"}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Tracking: {shipment.tracking_number or "-"}')
            pdf.drawString(110 * mm, y, f'Tong kien: {len(packages)}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Tong KL: {total_weight} kg')
            y -= 10 * mm

            headers = ['Kien', 'Line', 'San pham', 'Loai kien', 'SL', 'KL(kg)', 'Kich thuoc(cm)', 'Trang thai']
            widths = [20 * mm, 10 * mm, 42 * mm, 22 * mm, 14 * mm, 18 * mm, 30 * mm, 28 * mm]
            x = 18 * mm
            pdf.setFillColor(colors.HexColor('#f0f0f0'))
            pdf.rect(x, y - 6 * mm, sum(widths), 7 * mm, fill=1, stroke=0)
            pdf.setFillColor(colors.black)
            pdf.setFont('Helvetica-Bold', 8)
            cursor = x + 1.5 * mm
            for header, col_width in zip(headers, widths):
                pdf.drawString(cursor, y - 3.5 * mm, header)
                cursor += col_width
            y -= 9 * mm
            pdf.setFont('Helvetica', 8)
            for package in packages:
                if y < 25 * mm:
                    pdf.showPage()
                    y = height - 20 * mm
                    pdf.setFont('Helvetica', 8)
                line = getattr(package, 'sales_order_line', None)
                product = getattr(getattr(package, 'inventory_transaction', None), 'product', None)
                values = [
                    package.package_code,
                    str(getattr(line, 'line_number', '-') or '-'),
                    f'{getattr(product, "code", "")} - {getattr(product, "name", "")}',
                    package.package_type or '-',
                    str(package.quantity or 0),
                    str(package.gross_weight_kg or 0),
                    f'{package.length_cm}x{package.width_cm}x{package.height_cm}',
                    'Loaded' if package.loaded_at else ('Verified' if package.verified_at else 'Pending'),
                ]
                cursor = x + 1.5 * mm
                row_height = 8 * mm
                pdf.rect(x, y - 6 * mm, sum(widths), row_height, stroke=1, fill=0)
                for value, col_width in zip(values, widths):
                    text = str(value)
                    if len(text) > 28:
                        text = text[:25] + '...'
                    pdf.drawString(cursor, y - 3.5 * mm, text)
                    cursor += col_width
                y -= row_height

        return _sales_order_pdf_response(f'shipment_packing_manifest_{shipment.code}.pdf', build)

    @action(detail=True, methods=['get'])
    def shipment_loading_handover_pdf(self, request, pk=None):
        order = self.get_object()
        shipment_id = request.query_params.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        shipment = (
            OutboundShipment.objects.filter(pk=shipment_id, sales_order=order)
            .select_related('loading_confirmed_by')
            .prefetch_related('packages', 'packages__inventory_transaction__product', 'packages__sales_order_line')
            .first()
        )
        if not shipment:
            return Response({'error': 'Không tìm thấy shipment thuộc đơn hàng này.'}, status=status.HTTP_404_NOT_FOUND)
        if not shipment.loading_confirmed_at:
            return Response({'error': 'Shipment chưa được xác nhận bàn giao xe.'}, status=status.HTTP_400_BAD_REQUEST)
        packages = list(shipment.packages.filter(status='ACTIVE').order_by('package_no', 'id'))
        package_summary = _build_package_summary(packages)

        def build(pdf):
            width, height = A4
            pdf.setTitle(f'Loading Handover {shipment.code}')
            y = height - 20 * mm
            pdf.setFont('Helvetica-Bold', 15)
            pdf.drawString(18 * mm, y, f'LOADING HANDOVER - {shipment.code}')
            y -= 8 * mm
            pdf.setFont('Helvetica', 10)
            pdf.drawString(18 * mm, y, f'Don hang: {order.code}')
            pdf.drawString(110 * mm, y, f'Ngay xuat: {shipment.shipment_date}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Nha van chuyen: {shipment.carrier_name or "-"}')
            pdf.drawString(110 * mm, y, f'Tracking: {shipment.tracking_number or "-"}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Xe / tai xe: {shipment.vehicle_no or "-"} / {shipment.driver_name or "-"}')
            pdf.drawString(110 * mm, y, f'SDT tai xe: {shipment.driver_phone or "-"}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Ma ban giao: {shipment.loading_reference or "-"}')
            pdf.drawString(110 * mm, y, f'Nguoi nhan: {shipment.handover_receiver_name or "-"}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'SDT nguoi nhan: {shipment.handover_receiver_phone or "-"}')
            pdf.drawString(
                110 * mm,
                y,
                f'Xac nhan boi: {getattr(shipment.loading_confirmed_by, "full_name", None) or getattr(shipment.loading_confirmed_by, "username", None) or "-"}'
            )
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Thong tin proof: {shipment.handover_proof_url or "-"}'[:90])
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Ghi chu: {shipment.loading_confirmation_note or "-"}'[:110])
            y -= 10 * mm

            headers = ['Kien', 'Line', 'San pham', 'Kg', 'Trang thai load']
            widths = [36 * mm, 12 * mm, 72 * mm, 20 * mm, 34 * mm]
            x = 18 * mm
            pdf.setFillColor(colors.HexColor('#f0f0f0'))
            pdf.rect(x, y - 6 * mm, sum(widths), 7 * mm, fill=1, stroke=0)
            pdf.setFillColor(colors.black)
            pdf.setFont('Helvetica-Bold', 8)
            cursor = x + 1.5 * mm
            for header, col_width in zip(headers, widths):
                pdf.drawString(cursor, y - 3.5 * mm, header)
                cursor += col_width
            y -= 9 * mm

            pdf.setFont('Helvetica', 8)
            for package in packages:
                if y < 28 * mm:
                    pdf.showPage()
                    y = height - 20 * mm
                    pdf.setFont('Helvetica', 8)
                product = getattr(getattr(package, 'inventory_transaction', None), 'product', None)
                line = getattr(package, 'sales_order_line', None)
                values = [
                    package.package_code,
                    str(getattr(line, 'line_number', '-') or '-'),
                    f'{getattr(product, "code", "")} - {getattr(product, "name", "")}',
                    str(package.gross_weight_kg or 0),
                    'Loaded' if package.loaded_at else 'Pending',
                ]
                cursor = x + 1.5 * mm
                row_height = 8 * mm
                pdf.rect(x, y - 6 * mm, sum(widths), row_height, stroke=1, fill=0)
                for value, col_width in zip(values, widths):
                    text = str(value)
                    if len(text) > 34:
                        text = text[:31] + '...'
                    pdf.drawString(cursor, y - 3.5 * mm, text)
                    cursor += col_width
                y -= row_height

            y -= 4 * mm
            pdf.setFont('Helvetica-Bold', 9)
            pdf.drawString(18 * mm, y, f'Tong kien: {package_summary["package_count"]}')
            pdf.drawString(60 * mm, y, f'Da load: {package_summary["loaded_package_count"]}')
            pdf.drawString(110 * mm, y, f'Tong kg: {package_summary["total_gross_weight_kg"]}')

        return _sales_order_pdf_response(f'shipment_loading_handover_{shipment.code}.pdf', build)

    @action(detail=True, methods=['get'])
    def shipment_delivery_proof_pdf(self, request, pk=None):
        order = self.get_object()
        shipment_id = request.query_params.get('shipment_id')
        if not shipment_id:
            return Response({'error': 'Thiếu shipment_id.'}, status=status.HTTP_400_BAD_REQUEST)
        OutboundShipment = apps.get_model('inventory', 'OutboundShipment')
        shipment = (
            OutboundShipment.objects.filter(pk=shipment_id, sales_order=order)
            .select_related('delivery_confirmed_by', 'loading_confirmed_by')
            .prefetch_related('packages', 'packages__inventory_transaction__product', 'packages__sales_order_line')
            .first()
        )
        if not shipment:
            return Response({'error': 'Không tìm thấy shipment thuộc đơn hàng này.'}, status=status.HTTP_404_NOT_FOUND)
        if not shipment.delivery_confirmed_at:
            return Response({'error': 'Shipment chưa được xác nhận giao xong.'}, status=status.HTTP_400_BAD_REQUEST)
        packages = list(shipment.packages.filter(status='ACTIVE').order_by('package_no', 'id'))
        package_summary = _build_package_summary(packages)

        def build(pdf):
            width, height = A4
            pdf.setTitle(f'Delivery Proof {shipment.code}')
            y = height - 20 * mm
            pdf.setFont('Helvetica-Bold', 15)
            pdf.drawString(18 * mm, y, f'PROOF OF DELIVERY - {shipment.code}')
            y -= 8 * mm
            pdf.setFont('Helvetica', 10)
            pdf.drawString(18 * mm, y, f'Don hang: {order.code}')
            pdf.drawString(110 * mm, y, f'Ngay xuat: {shipment.shipment_date}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Khach hang: {getattr(order.customer, "name", "-") or "-"}')
            pdf.drawString(110 * mm, y, f'Ma POD: {shipment.delivery_reference or "-"}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Nha van chuyen: {shipment.carrier_name or "-"}')
            pdf.drawString(110 * mm, y, f'Tracking: {shipment.tracking_number or "-"}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Nguoi nhan cuoi: {shipment.customer_receiver_name or "-"}')
            pdf.drawString(110 * mm, y, f'SDT nguoi nhan: {shipment.customer_receiver_phone or "-"}')
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Giao xong luc: {shipment.delivered_at_actual or "-"}')
            pdf.drawString(
                110 * mm,
                y,
                f'Xac nhan boi: {getattr(shipment.delivery_confirmed_by, "full_name", None) or getattr(shipment.delivery_confirmed_by, "username", None) or "-"}'
            )
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Link proof: {shipment.delivery_proof_url or "-"}'[:110])
            y -= 6 * mm
            pdf.drawString(18 * mm, y, f'Ghi chu: {shipment.delivery_confirmation_note or "-"}'[:110])
            y -= 10 * mm

            headers = ['Kien', 'Line', 'San pham', 'SL', 'Kg', 'Trang thai']
            widths = [34 * mm, 12 * mm, 68 * mm, 18 * mm, 18 * mm, 30 * mm]
            x = 18 * mm
            pdf.setFillColor(colors.HexColor('#f0f0f0'))
            pdf.rect(x, y - 6 * mm, sum(widths), 7 * mm, fill=1, stroke=0)
            pdf.setFillColor(colors.black)
            pdf.setFont('Helvetica-Bold', 8)
            cursor = x + 1.5 * mm
            for header, col_width in zip(headers, widths):
                pdf.drawString(cursor, y - 3.5 * mm, header)
                cursor += col_width
            y -= 9 * mm

            pdf.setFont('Helvetica', 8)
            for package in packages:
                if y < 28 * mm:
                    pdf.showPage()
                    y = height - 20 * mm
                    pdf.setFont('Helvetica', 8)
                product = getattr(getattr(package, 'inventory_transaction', None), 'product', None)
                line = getattr(package, 'sales_order_line', None)
                values = [
                    package.package_code,
                    str(getattr(line, 'line_number', '-') or '-'),
                    f'{getattr(product, "code", "")} - {getattr(product, "name", "")}',
                    str(package.quantity or 0),
                    str(package.gross_weight_kg or 0),
                    'Delivered' if shipment.delivery_confirmed_at else 'Loaded',
                ]
                cursor = x + 1.5 * mm
                row_height = 8 * mm
                pdf.rect(x, y - 6 * mm, sum(widths), row_height, stroke=1, fill=0)
                for value, col_width in zip(values, widths):
                    text = str(value)
                    if len(text) > 34:
                        text = text[:31] + '...'
                    pdf.drawString(cursor, y - 3.5 * mm, text)
                    cursor += col_width
                y -= row_height

            y -= 4 * mm
            pdf.setFont('Helvetica-Bold', 9)
            pdf.drawString(18 * mm, y, f'Tong kien: {package_summary["package_count"]}')
            pdf.drawString(60 * mm, y, f'Da verify: {package_summary["verified_package_count"]}')
            pdf.drawString(110 * mm, y, f'Tong kg: {package_summary["total_gross_weight_kg"]}')

        return _sales_order_pdf_response(f'shipment_delivery_proof_{shipment.code}.pdf', build)

    @action(detail=True, methods=['get'])
    def trace_labels_pdf(self, request, pk=None):
        order = self.get_object()
        label_mode = str(request.query_params.get('label_mode') or 'copies').strip().lower()
        try:
            copies_per_line = int(request.query_params.get('copies_per_line', 1) or 1)
        except (TypeError, ValueError):
            copies_per_line = 1
        copies_per_line = max(1, min(copies_per_line, 50))
        try:
            packages_per_line = int(request.query_params.get('packages_per_line', 1) or 1)
        except (TypeError, ValueError):
            packages_per_line = 1
        packages_per_line = max(1, min(packages_per_line, 200))
        raw_line_ids = request.query_params.get('line_ids', '')
        line_ids = []
        for token in str(raw_line_ids or '').split(','):
            token = token.strip()
            if token.isdigit():
                line_ids.append(int(token))
        lines_qs = order.lines.all().order_by('line_number')
        if line_ids:
            lines_qs = lines_qs.filter(id__in=line_ids)
        lines = list(lines_qs)

        label_entries = []
        for line in lines:
            if label_mode == 'cartons':
                for package_index in range(1, packages_per_line + 1):
                    label_entries.append(
                        {
                            'line': line,
                            'qr_value': build_sales_order_line_package_trace_code(line.trace_code, package_index),
                            'label_caption': f'Kien {package_index}/{packages_per_line}',
                            'label_mode': 'cartons',
                        }
                    )
            else:
                for copy_index in range(1, copies_per_line + 1):
                    label_entries.append(
                        {
                            'line': line,
                            'qr_value': line.trace_code or '',
                            'label_caption': f'Ban in {copy_index}/{copies_per_line}',
                            'label_mode': 'copies',
                        }
                    )

        def build(pdf):
            width, height = A4
            label_width = 90 * mm
            label_height = 45 * mm
            margin_x = 12 * mm
            margin_y = 15 * mm
            gap_x = 8 * mm
            gap_y = 8 * mm
            x_positions = [margin_x, margin_x + label_width + gap_x]
            y = height - margin_y - label_height

            for index, entry in enumerate(label_entries):
                col = index % 2
                if index > 0 and col == 0:
                    y -= label_height + gap_y
                    if y < 15 * mm:
                        pdf.showPage()
                        y = height - margin_y - label_height
                x = x_positions[col]
                line = entry['line']
                snapshot = getattr(line, 'product_snapshot', None) or {}
                pdf.setStrokeColor(colors.black)
                pdf.rect(x, y, label_width, label_height, stroke=1, fill=0)
                pdf.setFont('Helvetica-Bold', 11)
                pdf.drawString(x + 4 * mm, y + label_height - 8 * mm, order.code)
                pdf.setFont('Helvetica-Bold', 10)
                pdf.drawString(x + 4 * mm, y + label_height - 15 * mm, f'Line {line.line_number}: {line.internal_product_code or snapshot.get("code") or ""}')
                pdf.setFont('Helvetica', 8)
                name_text = snapshot.get('name') or getattr(line.product, 'name', '')
                if len(name_text) > 32:
                    name_text = name_text[:29] + '...'
                pdf.drawString(x + 4 * mm, y + label_height - 21 * mm, name_text)
                pdf.drawString(x + 4 * mm, y + label_height - 27 * mm, f'{entry["label_caption"]} | SL don: {line.qty}')
                pdf.drawString(x + 4 * mm, y + label_height - 33 * mm, f'Kich thuoc: {snapshot.get("size_order") or "-"}')
                trace_value = entry['qr_value']
                pdf.drawString(x + 4 * mm, y + 6 * mm, str(trace_value)[:44])
                _draw_pdf_qr(pdf, trace_value, x=x + label_width - 27 * mm, y=y + 6 * mm, size=20 * mm)

        return _sales_order_pdf_response(f'trace_labels_{order.code}.pdf', build)

    @action(detail=False, methods=['post'])
    def sync_delivery_tasks(self, request):
        days_ahead = request.data.get('days_ahead', 7)
        ids = request.data.get('order_ids')
        if not isinstance(ids, list):
            ids = None
        result = sync_sales_order_delivery_tasks(
            actor=request.user,
            order_ids=ids,
            days_ahead=days_ahead,
        )
        return Response(result)


class QuoteViewSet(viewsets.ModelViewSet):
    """Báo giá (Quote) – CRUD."""
    serializer_class = QuoteSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [
        django_filters.rest_framework.DjangoFilterBackend,
        filters.SearchFilter,
        filters.OrderingFilter,
    ]
    filterset_class = QuoteFilter
    search_fields = ['code', 'reference', 'notes']
    ordering_fields = ['code', 'quote_date', 'status', 'total', 'created_at']
    ordering = ['-quote_date', '-id']

    def get_queryset(self):
        return Quote.objects.select_related('customer', 'created_by', 'updated_by').prefetch_related(
            'lines', 'lines__product',
        )

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        if serializer.instance.status != QuoteStatus.DRAFT:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Chỉ được sửa báo giá ở trạng thái Nháp.')
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        if instance.status != QuoteStatus.DRAFT:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Chỉ được xóa báo giá ở trạng thái Nháp.')
        instance.delete()

    @action(detail=True, methods=['post'])
    def send(self, request, pk=None):
        """DRAFT -> SENT (gửi báo giá cho khách)."""
        quote = self.get_object()
        if quote.status != QuoteStatus.DRAFT:
            return Response({'error': 'Chỉ gửi báo giá ở trạng thái Nháp.'}, status=status.HTTP_400_BAD_REQUEST)
        quote.status = QuoteStatus.SENT
        quote.save(update_fields=['status', 'updated_at'])
        return Response({'status': quote.status})

    @action(detail=True, methods=['post'])
    def accept(self, request, pk=None):
        """SENT -> ACCEPTED (khách chấp nhận)."""
        quote = self.get_object()
        if quote.status != QuoteStatus.SENT:
            return Response({'error': 'Chỉ chấp nhận báo giá đã gửi.'}, status=status.HTTP_400_BAD_REQUEST)
        quote.status = QuoteStatus.ACCEPTED
        quote.save(update_fields=['status', 'updated_at'])
        return Response({'status': quote.status})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """SENT -> REJECTED. Body: { reason }."""
        quote = self.get_object()
        if quote.status != QuoteStatus.SENT:
            return Response({'error': 'Chỉ từ chối báo giá đã gửi.'}, status=status.HTTP_400_BAD_REQUEST)
        quote.status = QuoteStatus.REJECTED
        quote.save(update_fields=['status', 'updated_at'])
        return Response({'status': quote.status})

    @action(detail=True, methods=['post'])
    def convert_to_order(self, request, pk=None):
        """Tạo đơn hàng từ báo giá (chỉ khi ACCEPTED). Trả về order_id, order_code."""
        from django.db import transaction
        from sales.models import SalesOrderLine
        from sales.document_policy import calc_line_totals
        quote = self.get_object()
        if quote.status != QuoteStatus.ACCEPTED:
            return Response({'error': 'Chỉ chuyển thành đơn hàng khi báo giá đã được chấp nhận.'}, status=400)
        today = timezone.now().date()
        order_code = get_next_sales_order_code(today)
        with transaction.atomic():
            order = SalesOrder.objects.create(
                code=order_code,
                doc_type='SO',
                order_date=today,
                delivery_date=None,
                status=SalesOrderStatus.DRAFT,
                reference=quote.code or '',
                customer=quote.customer,
                currency=quote.currency or 'VND',
                subtotal=quote.subtotal,
                discount_total=quote.discount_total,
                tax_total=quote.tax_total,
                total=quote.total,
                notes=quote.notes or '',
                created_by=request.user,
                updated_by=request.user,
                owner=request.user,
            )
            for i, qline in enumerate(quote.lines.all().order_by('line_number'), start=1):
                sub, disc, tax, total = calc_line_totals(
                    qline.qty, qline.unit_price, qline.discount_pct, qline.tax_pct,
                )
                product = qline.product
                uom = getattr(getattr(product, 'unit', None), 'code', '') or ''
                SalesOrderLine.objects.create(
                    sales_order=order,
                    line_number=i,
                    product=product,
                    internal_product_code=getattr(product, 'code', '') or '',
                    uom=uom,
                    qty=qline.qty,
                    unit_price=qline.unit_price,
                    discount_pct=qline.discount_pct,
                    tax_pct=qline.tax_pct,
                    line_subtotal=sub,
                    discount_amount=disc,
                    tax_amount=tax,
                    line_total=total,
                    note=qline.note or '',
                )
        return Response({'order_id': order.id, 'order_code': order.code})

    @action(detail=True, methods=['get'])
    def quote_pdf(self, request, pk=None):
        """GET: Tải PDF báo giá."""
        quote = self.get_object()
        safe_code = (quote.code or 'quote').replace(' ', '_')
        return _sales_order_pdf_response(
            f'bao_gia_{safe_code}.pdf',
            lambda c: _build_quote_pdf(c, quote),
        )


# ============== OUTBOUND SHIPMENTS ==============
class ShipmentViewSet(viewsets.ModelViewSet):
    """
    Outbound Shipment Management
    Workflow: DRAFT -> SUBMITTED -> APPROVED -> PACKED -> IN_TRANSIT -> DELIVERED
    """
    queryset = OutboundShipment.objects.all().prefetch_related('lines')
    serializer_class = OutboundShipmentSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ['status', 'customer', 'shipment_date']
    search_fields = ['code', 'customer__name', 'reference', 'tracking_number']
    ordering_fields = ['shipment_date', 'status', 'created_at']
    ordering = ['-shipment_date']
    
    def get_permissions(self):
        """Check sales.manage_shipment permission"""
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAuthenticated(), DjangoObjectPermissions()]
        return [IsAuthenticated()]
    
    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    
    @action(detail=True, methods=['post'])
    def submit_shipment(self, request, pk=None):
        """Submit shipment for approval (DRAFT -> SUBMITTED)"""
        shipment = self.get_object()
        if shipment.status != OutboundShipmentStatus.DRAFT:
            return Response(
                {'error': f'Can only submit DRAFT shipments. Current status: {shipment.status}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            with transaction.atomic():
                previous_status = shipment.status
                shipment.status = OutboundShipmentStatus.SUBMITTED
                shipment.submitted_by = request.user
                shipment.submitted_at = timezone.now()
                shipment.save()
                _create_outbound_shipment_audit_log(
                    request=request,
                    shipment=shipment,
                    action='SUBMIT',
                    old_status=previous_status,
                )
            
            serializer = self.get_serializer(shipment)
            return Response(serializer.data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def approve_shipment(self, request, pk=None):
        """Approve shipment (SUBMITTED -> APPROVED)"""
        shipment = self.get_object()
        if shipment.status != OutboundShipmentStatus.SUBMITTED:
            return Response(
                {'error': f'Can only approve SUBMITTED shipments. Current status: {shipment.status}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            with transaction.atomic():
                previous_status = shipment.status
                shipment.status = OutboundShipmentStatus.APPROVED
                shipment.approved_by = request.user
                shipment.approved_at = timezone.now()
                shipment.save()
                _create_outbound_shipment_audit_log(
                    request=request,
                    shipment=shipment,
                    action='APPROVE',
                    old_status=previous_status,
                )
            
            serializer = self.get_serializer(shipment)
            return Response(serializer.data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def pack_shipment(self, request, pk=None):
        """Pack shipment (APPROVED -> PACKED)"""
        shipment = self.get_object()
        if shipment.status != OutboundShipmentStatus.APPROVED:
            return Response(
                {'error': f'Can only pack APPROVED shipments. Current status: {shipment.status}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            with transaction.atomic():
                previous_status = shipment.status
                shipment.status = OutboundShipmentStatus.PACKED
                shipment.packed_by = request.user
                shipment.packed_at = timezone.now()
                shipment.save()
                _create_outbound_shipment_audit_log(
                    request=request,
                    shipment=shipment,
                    action='UPDATE',
                    old_status=previous_status,
                )
            
            serializer = self.get_serializer(shipment)
            return Response(serializer.data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def send_shipment(self, request, pk=None):
        """Send shipment (PACKED -> IN_TRANSIT)"""
        shipment = self.get_object()
        if shipment.status != OutboundShipmentStatus.PACKED:
            return Response(
                {'error': f'Can only send PACKED shipments. Current status: {shipment.status}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            with transaction.atomic():
                previous_status = shipment.status
                shipment.status = OutboundShipmentStatus.IN_TRANSIT
                shipment.save()
                _create_outbound_shipment_audit_log(
                    request=request,
                    shipment=shipment,
                    action='UPDATE',
                    old_status=previous_status,
                )
            
            serializer = self.get_serializer(shipment)
            return Response(serializer.data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def confirm_delivery(self, request, pk=None):
        """Confirm delivery (IN_TRANSIT -> DELIVERED)"""
        shipment = self.get_object()
        if shipment.status != OutboundShipmentStatus.IN_TRANSIT:
            return Response(
                {'error': f'Can only confirm delivery for IN_TRANSIT shipments. Current status: {shipment.status}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        actual_delivery_date = request.data.get('actual_delivery_date')
        delivered_by = str(request.data.get('delivered_by') or '').strip()
        delivery_notes = str(request.data.get('delivery_notes') or '').strip()
        
        try:
            with transaction.atomic():
                previous_status = shipment.status
                shipment.status = OutboundShipmentStatus.DELIVERED
                shipment.actual_delivery_date = actual_delivery_date or timezone.now().date()
                shipment.delivered_by = delivered_by
                shipment.delivery_notes = delivery_notes
                shipment.delivered_by_user = request.user
                shipment.save()
                _create_outbound_shipment_audit_log(
                    request=request,
                    shipment=shipment,
                    action='UPDATE',
                    old_status=previous_status,
                )
            
            serializer = self.get_serializer(shipment)
            return Response(serializer.data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def cancel_shipment(self, request, pk=None):
        """Cancel shipment"""
        shipment = self.get_object()
        if shipment.status == OutboundShipmentStatus.DELIVERED:
            return Response(
                {'error': 'Cannot cancel DELIVERED shipments'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            with transaction.atomic():
                previous_status = shipment.status
                shipment.status = OutboundShipmentStatus.CANCELLED
                shipment.save()
                _create_outbound_shipment_audit_log(
                    request=request,
                    shipment=shipment,
                    action='VOID',
                    old_status=previous_status,
                )
            
            serializer = self.get_serializer(shipment)
            return Response(serializer.data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
