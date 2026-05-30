from collections import Counter, defaultdict
from datetime import datetime as dt_parse
from decimal import Decimal

import django_filters
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import filters, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.mixins import get_client_ip
from core.models import AuditLog
from core.permissions import check_action_permission
from inventory.filters import (
    InventoryReservationFilter,
    InventoryTransactionFilter,
    OutboundShipmentFilter,
    WarehouseFilter,
    WarehouseLocationFilter,
)
from inventory.models import (
    InventoryReservation,
    InventoryReservationStatus,
    InventoryTransaction,
    InventoryTransactionStatus,
    InventoryTransactionType,
    OutboundShipment,
    StockAlert,
    Stocktake,
    StocktakeStatus,
    Warehouse,
    WarehouseLocation,
)
from inventory.serializers import (
    InventoryReservationSerializer,
    InventoryTransactionSerializer,
    OutboundShipmentSerializer,
    SOURCE_TYPE_LABELS,
    SOURCE_TYPE_MANUAL,
    SOURCE_TYPE_PRODUCTION,
    SOURCE_TYPE_PURCHASE,
    SOURCE_TYPE_STOCKTAKE,
    SOURCE_TYPE_TRANSFER,
    StockAlertSerializer,
    StocktakeSerializer,
    WarehouseLocationSerializer,
    WarehouseSerializer,
    build_inventory_source_audit,
)
from inventory.services import build_stock_balance_map
from inventory.services import apply_reservation_fulfillment, cancel_inventory_transaction_record
from products.models import Product
from sales.services import apply_delivery_plan_shipment


NXT_SOURCE_TYPES = (
    SOURCE_TYPE_PURCHASE,
    SOURCE_TYPE_PRODUCTION,
    SOURCE_TYPE_STOCKTAKE,
    SOURCE_TYPE_TRANSFER,
    SOURCE_TYPE_MANUAL,
)


def _empty_nxt_source_bucket():
    return {
        'in_qty': Decimal('0'),
        'out_qty': Decimal('0'),
        'count': 0,
        'source_document_types': Counter(),
        'source_warnings': Counter(),
    }


def _empty_nxt_source_breakdown():
    return {source_type: _empty_nxt_source_bucket() for source_type in NXT_SOURCE_TYPES}


def _normalize_nxt_source_audit(tx):
    audit = build_inventory_source_audit(tx)
    source_type = audit.get('type') or SOURCE_TYPE_MANUAL
    if source_type in NXT_SOURCE_TYPES:
        return audit

    warning_flags = list(audit.get('warning_flags') or [])
    warning_flags.append(f'NXT_SOURCE_COLLAPSED_{source_type}')
    normalized = dict(audit)
    normalized['type'] = SOURCE_TYPE_MANUAL
    normalized['warning_flags'] = warning_flags
    return normalized


def _serialize_nxt_source_breakdown(source_breakdown):
    serialized = {}
    for source_type in NXT_SOURCE_TYPES:
        bucket = source_breakdown.get(source_type) or _empty_nxt_source_bucket()
        in_qty = bucket['in_qty']
        out_qty = bucket['out_qty']
        serialized[source_type] = {
            'source_type': source_type,
            'source_label': SOURCE_TYPE_LABELS.get(source_type, source_type),
            'in_qty': str(in_qty),
            'out_qty': str(out_qty),
            'net_qty': str(in_qty - out_qty),
            'count': bucket['count'],
            'source_document_types': dict(bucket['source_document_types']),
            'source_warnings': dict(bucket['source_warnings']),
        }
    return serialized


def _flatten_nxt_source_counter(source_breakdown, counter_key):
    summary = Counter()
    for bucket in source_breakdown.values():
        summary.update(bucket[counter_key])
    return dict(summary)


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


def _can_manage_inventory(user):
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'INVENTORY', 'MANAGE', strict=True):
        return True
    role_names = _user_role_names(user)
    allowed_roles = {
        'admin',
        'manager',
        'operation-manager',
        'ops-manager',
        'product-manager',
        'sales-manager',
        'quan-ly',
        'quanly',
    }
    return any(role in allowed_roles for role in role_names)


def _can_manage_stocktake(user):
    """Cho phép nếu có INVENTORY:MANAGE hoặc INVENTORY:STOCKTAKE."""
    if _can_manage_inventory(user):
        return True
    if check_action_permission(user, 'INVENTORY', 'STOCKTAKE', strict=True):
        return True
    return False


class InventoryManagePermissionMixin:
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not _can_manage_inventory(request.user):
            raise PermissionDenied('Bạn không có quyền quản lý kho.')


class WarehouseViewSet(InventoryManagePermissionMixin, viewsets.ModelViewSet):
    serializer_class = WarehouseSerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = WarehouseFilter
    search_fields = ['code', 'name', 'address', 'note']
    ordering_fields = ['code', 'name', 'sort_order', 'created_at']
    ordering = ['sort_order', 'code']

    def get_queryset(self):
        return Warehouse.objects.filter(deleted_at__isnull=True).select_related('manager')

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        if instance.transactions.filter(status=InventoryTransactionStatus.POSTED).exists():
            raise ValidationError('Kho đã có giao dịch kho, không thể xóa.')
        if instance.reservations.filter(status=InventoryReservationStatus.OPEN).exists():
            raise ValidationError('Kho đang có reservation mở, không thể xóa.')
        if instance.locations.filter(deleted_at__isnull=True).exists():
            raise ValidationError('Kho còn vị trí hoạt động, hãy xóa/vô hiệu hóa vị trí trước.')
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.is_active = False
        instance.save(update_fields=['deleted_at', 'deleted_by', 'is_active', 'updated_at'])

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        ids = request.data.get('ids') or []
        updated = self.get_queryset().filter(id__in=ids).update(is_active=True, updated_by_id=request.user.id)
        return Response({'updated': updated})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        ids = request.data.get('ids') or []
        updated = self.get_queryset().filter(id__in=ids).update(is_active=False, updated_by_id=request.user.id)
        return Response({'updated': updated})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        ids = request.data.get('ids') or []
        deleted = 0
        for item in self.get_queryset().filter(id__in=ids):
            self.perform_destroy(item)
            deleted += 1
        return Response({'deleted': deleted})


class WarehouseLocationViewSet(InventoryManagePermissionMixin, viewsets.ModelViewSet):
    serializer_class = WarehouseLocationSerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = WarehouseLocationFilter
    search_fields = ['code', 'name', 'note', 'warehouse__code', 'warehouse__name']
    ordering_fields = ['warehouse__code', 'code', 'name', 'sort_order', 'created_at']
    ordering = ['warehouse__sort_order', 'warehouse__code', 'sort_order', 'code']

    def get_queryset(self):
        return WarehouseLocation.objects.filter(deleted_at__isnull=True).select_related('warehouse', 'parent')

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save()

    def perform_destroy(self, instance):
        if instance.transactions.filter(status=InventoryTransactionStatus.POSTED).exists():
            raise ValidationError('Vị trí đã có giao dịch kho, không thể xóa.')
        if instance.reservations.filter(status=InventoryReservationStatus.OPEN).exists():
            raise ValidationError('Vị trí đang có reservation mở, không thể xóa.')
        if instance.children.filter(deleted_at__isnull=True).exists():
            raise ValidationError('Vị trí còn vị trí con hoạt động.')
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.is_active = False
        instance.save(update_fields=['deleted_at', 'deleted_by', 'is_active', 'updated_at'])

    @action(detail=False, methods=['post'])
    def bulk_activate(self, request):
        ids = request.data.get('ids') or []
        updated = self.get_queryset().filter(id__in=ids).update(is_active=True, updated_by_id=request.user.id)
        return Response({'updated': updated})

    @action(detail=False, methods=['post'])
    def bulk_deactivate(self, request):
        ids = request.data.get('ids') or []
        updated = self.get_queryset().filter(id__in=ids).update(is_active=False, updated_by_id=request.user.id)
        return Response({'updated': updated})

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        ids = request.data.get('ids') or []
        deleted = 0
        for item in self.get_queryset().filter(id__in=ids):
            self.perform_destroy(item)
            deleted += 1
        return Response({'deleted': deleted})


class InventoryTransactionViewSet(InventoryManagePermissionMixin, viewsets.ModelViewSet):
    serializer_class = InventoryTransactionSerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = InventoryTransactionFilter
    search_fields = ['code', 'reference', 'reason', 'note', 'product__code', 'product__name']
    ordering_fields = ['transaction_date', 'code', 'transaction_type', 'quantity', 'created_at']
    ordering = ['-transaction_date', '-id']
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        return InventoryTransaction.objects.select_related(
            'product',
            'warehouse',
            'location',
            'target_warehouse',
            'target_location',
            'sales_order',
            'sales_order_line',
            'purchase_order',
            'purchase_receipt',
            'production_order',
            'production_issue',
            'production_receipt',
            'reservation',
            'shipment_batch',
            'stocktake',
            'stocktake_line',
            'posted_by',
            'cancelled_by',
        )

    def perform_create(self, serializer):
        with transaction.atomic():
            tx = serializer.save(
                created_by=self.request.user,
                updated_by=self.request.user,
                posted_by=self.request.user,
            )
            if tx.reservation and tx.transaction_type == 'ISSUE' and tx.status == InventoryTransactionStatus.POSTED:
                apply_reservation_fulfillment(tx.reservation, tx.quantity or Decimal('0'), actor=self.request.user)
            if tx.transaction_type == 'ISSUE' and tx.sales_order_line_id and tx.status == InventoryTransactionStatus.POSTED:
                apply_delivery_plan_shipment(
                    tx.sales_order_line,
                    tx.quantity or Decimal('0'),
                    actor=self.request.user,
                    shipment_date=tx.transaction_date,
                )

    @action(detail=False, methods=['get'])
    def nxt_report(self, request):
        """Báo cáo Nhập Xuất Tồn theo kỳ. GET ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&warehouse=id (optional)"""
        date_from_s = (request.query_params.get('date_from') or '').strip()
        date_to_s = (request.query_params.get('date_to') or '').strip()
        if not date_from_s or not date_to_s:
            return Response({'error': 'date_from và date_to bắt buộc (YYYY-MM-DD).'}, status=400)
        try:
            date_from = dt_parse.strptime(date_from_s, '%Y-%m-%d').date()
            date_to = dt_parse.strptime(date_to_s, '%Y-%m-%d').date()
        except ValueError:
            return Response({'error': 'date_from, date_to phải đúng định dạng YYYY-MM-DD.'}, status=400)
        if date_from > date_to:
            return Response({'error': 'date_from không được lớn hơn date_to.'}, status=400)

        def _parse_positive_int(value):
            if value and str(value).isdigit():
                return int(value)
            return None

        warehouse_id = _parse_positive_int(request.query_params.get('warehouse') or request.query_params.get('warehouse_id'))
        product_id = _parse_positive_int(request.query_params.get('product') or request.query_params.get('product_id'))

        base = InventoryTransaction.objects.filter(
            status=InventoryTransactionStatus.POSTED,
            transaction_date__lte=date_to,
        )
        if product_id:
            base = base.filter(product_id=product_id)
        if warehouse_id:
            base = base.filter(Q(warehouse_id=warehouse_id) | Q(target_warehouse_id=warehouse_id))

        opening_in = defaultdict(Decimal)
        opening_out = defaultdict(Decimal)
        period_in = defaultdict(Decimal)
        period_out = defaultdict(Decimal)
        period_source_breakdown = defaultdict(_empty_nxt_source_breakdown)

        def _add_source_movement(tx, movement_warehouse_id, direction):
            audit = _normalize_nxt_source_audit(tx)
            source_type = audit.get('type') or SOURCE_TYPE_MANUAL
            bucket = period_source_breakdown[(tx.product_id, movement_warehouse_id)][source_type]
            qty = tx.quantity or Decimal('0')
            if direction == 'in':
                bucket['in_qty'] += qty
            else:
                bucket['out_qty'] += qty
            bucket['count'] += 1
            document_type = audit.get('document_type')
            if document_type:
                bucket['source_document_types'][document_type] += 1
            for warning in audit.get('warning_flags') or []:
                bucket['source_warnings'][warning] += 1

        def _add_movement(bucket, tx, movement_warehouse_id, source_direction=None):
            if not movement_warehouse_id:
                return
            if warehouse_id and movement_warehouse_id != warehouse_id:
                return
            bucket[(tx.product_id, movement_warehouse_id)] += tx.quantity or Decimal('0')
            if source_direction:
                _add_source_movement(tx, movement_warehouse_id, source_direction)

        for tx in base.select_related(
            'purchase_order',
            'purchase_receipt',
            'production_order',
            'production_issue',
            'production_receipt',
            'stocktake',
            'reservation',
            'shipment_batch',
            'sales_order',
        ):
            if tx.transaction_date < date_from:
                in_bucket = opening_in
                out_bucket = opening_out
                in_source_direction = None
                out_source_direction = None
            elif date_from <= tx.transaction_date <= date_to:
                in_bucket = period_in
                out_bucket = period_out
                in_source_direction = 'in'
                out_source_direction = 'out'
            else:
                continue

            if tx.transaction_type in {InventoryTransactionType.RECEIPT, InventoryTransactionType.ADJUSTMENT_IN}:
                _add_movement(in_bucket, tx, tx.warehouse_id, in_source_direction)
            elif tx.transaction_type in {InventoryTransactionType.ISSUE, InventoryTransactionType.ADJUSTMENT_OUT}:
                _add_movement(out_bucket, tx, tx.warehouse_id, out_source_direction)
            elif tx.transaction_type == InventoryTransactionType.TRANSFER:
                _add_movement(out_bucket, tx, tx.warehouse_id, out_source_direction)
                _add_movement(in_bucket, tx, tx.target_warehouse_id, in_source_direction)

        keys = set(opening_in) | set(opening_out) | set(period_in) | set(period_out)
        product_ids = [k[0] for k in keys if k[0]]
        warehouse_ids = [k[1] for k in keys if k[1]]
        products = {p.id: (p.code or '', p.name or '') for p in Product.objects.filter(id__in=product_ids).only('id', 'code', 'name')}
        warehouses = {w.id: (w.code or '', w.name or '') for w in Warehouse.objects.filter(id__in=warehouse_ids, deleted_at__isnull=True).only('id', 'code', 'name')}
        warehouses[0] = ('-', '-')

        rows = []
        for (pid, wid) in sorted(keys):
            opening = opening_in.get((pid, wid), Decimal('0')) - opening_out.get((pid, wid), Decimal('0'))
            in_p = period_in.get((pid, wid), Decimal('0'))
            out_p = period_out.get((pid, wid), Decimal('0'))
            closing = opening + in_p - out_p
            p_code, p_name = products.get(pid, ('', ''))
            w_code, w_name = warehouses.get(wid, ('-', '-'))
            rows.append({
                'product_id': pid,
                'product_code': p_code,
                'product_name': p_name,
                'warehouse_id': wid or None,
                'warehouse_code': w_code,
                'warehouse_name': w_name,
                'opening_qty': str(opening),
                'in_qty': str(in_p),
                'out_qty': str(out_p),
                'closing_qty': str(closing),
                'source_breakdown': _serialize_nxt_source_breakdown(period_source_breakdown.get((pid, wid), {})),
                'source_document_types': _flatten_nxt_source_counter(period_source_breakdown.get((pid, wid), {}), 'source_document_types'),
                'source_warnings': _flatten_nxt_source_counter(period_source_breakdown.get((pid, wid), {}), 'source_warnings'),
            })
        return Response({'date_from': date_from_s, 'date_to': date_to_s, 'results': rows})

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        tx = self.get_object()
        reason = (request.data.get('reason') or request.data.get('cancel_reason') or '').strip()
        try:
            cancel_inventory_transaction_record(tx, actor=request.user, reason=reason)
        except ValueError as exc:
            detail = str(exc)
            if 'lý do' in detail.lower():
                raise ValidationError({'reason': detail}) from exc
            raise ValidationError(detail) from exc
        AuditLog.objects.create(
            user=request.user,
            action='VOID',
            entity_type='InventoryTransaction',
            entity_id=tx.id,
            entity_code=tx.code,
            old_values={'status': InventoryTransactionStatus.POSTED},
            new_values={'status': InventoryTransactionStatus.CANCELLED, 'reason': reason},
            changed_fields=['status', 'cancel_reason'],
            ip_address=get_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response({'status': tx.status})


class InventoryReservationViewSet(InventoryManagePermissionMixin, viewsets.ModelViewSet):
    serializer_class = InventoryReservationSerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = InventoryReservationFilter
    search_fields = ['code', 'reference', 'note', 'product__code', 'product__name', 'sales_order__code']
    ordering_fields = ['reservation_date', 'code', 'reserved_qty', 'created_at']
    ordering = ['-reservation_date', '-id']
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        return InventoryReservation.objects.select_related(
            'product',
            'warehouse',
            'location',
            'sales_order',
            'sales_order_line',
        )

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def release(self, request, pk=None):
        reservation = self.get_object()
        if reservation.status != InventoryReservationStatus.OPEN:
            raise ValidationError('Chỉ release reservation đang mở.')
        qty = request.data.get('qty')
        try:
            release_qty = Decimal(str(qty or reservation.active_qty))
        except Exception as exc:
            raise ValidationError({'qty': 'Số lượng release không hợp lệ.'}) from exc
        if release_qty <= 0 or release_qty > reservation.active_qty:
            raise ValidationError({'qty': f'Số lượng release phải > 0 và <= {reservation.active_qty}.'})
        reservation.released_qty = (reservation.released_qty or Decimal('0')) + release_qty
        if reservation.active_qty <= 0:
            reservation.status = InventoryReservationStatus.RELEASED
        reservation.updated_by = request.user
        reservation.save(update_fields=['released_qty', 'status', 'updated_by', 'updated_at'])
        return Response({'status': reservation.status, 'active_qty': reservation.active_qty})

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        reservation = self.get_object()
        if reservation.status != InventoryReservationStatus.OPEN:
            raise ValidationError('Chỉ hủy reservation đang mở.')
        reason = (request.data.get('reason') or request.data.get('cancel_reason') or '').strip()
        if not reason:
            raise ValidationError({'reason': 'Hủy reservation bắt buộc có lý do.'})
        reservation.status = InventoryReservationStatus.CANCELLED
        reservation.cancel_reason = reason
        reservation.cancelled_at = timezone.now()
        reservation.cancelled_by = request.user
        reservation.updated_by = request.user
        reservation.save(
            update_fields=[
                'status',
                'cancel_reason',
                'cancelled_at',
                'cancelled_by',
                'updated_by',
                'updated_at',
            ]
        )
        return Response({'status': reservation.status})


class StocktakePermissionMixin:
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not _can_manage_stocktake(request.user):
            raise PermissionDenied('Bạn không có quyền kiểm tồn.')


class StocktakeViewSet(StocktakePermissionMixin, viewsets.ModelViewSet):
    serializer_class = StocktakeSerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['warehouse', 'status']
    ordering_fields = ['count_date', 'code', 'created_at']
    ordering = ['-count_date', '-id']

    def get_queryset(self):
        return Stocktake.objects.select_related(
            'warehouse',
            'created_by',
            'completed_by',
            'adjustment_posted_by',
        ).prefetch_related('lines', 'lines__product', 'lines__warehouse')

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        if serializer.instance.status != StocktakeStatus.DRAFT:
            raise ValidationError('Chỉ được sửa phiếu kiểm tồn ở trạng thái Nháp.')
        serializer.save()

    def perform_destroy(self, instance):
        if instance.status != StocktakeStatus.DRAFT:
            raise ValidationError('Chỉ được xóa phiếu kiểm tồn ở trạng thái Nháp.')
        instance.delete()

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        stocktake = self.get_object()
        if stocktake.status != StocktakeStatus.DRAFT:
            return Response({'error': 'Chỉ hoàn tất phiếu ở trạng thái Nháp.'}, status=400)
        stocktake.status = StocktakeStatus.COMPLETED
        stocktake.completed_at = timezone.now()
        stocktake.completed_by = request.user
        stocktake.save(update_fields=['status', 'completed_at', 'completed_by', 'updated_at'])
        return Response({'status': stocktake.status})

    def _build_adjustment_preview(self, stocktake, reason=''):
        lines = []
        total_in_lines = 0
        total_out_lines = 0
        skipped_zero_lines = 0
        blocked_lines = 0

        for line in stocktake.lines.all().order_by('line_number', 'id'):
            variance = line.variance_qty
            base = {
                'line_id': line.id,
                'line_number': line.line_number,
                'product': line.product_id,
                'product_code': getattr(line.product, 'code', ''),
                'product_name': getattr(line.product, 'name', ''),
                'warehouse': line.warehouse_id,
                'warehouse_code': getattr(line.warehouse, 'code', ''),
                'warehouse_name': getattr(line.warehouse, 'name', ''),
                'system_qty': str(line.system_qty or Decimal('0')),
                'count_qty': str(line.count_qty or Decimal('0')),
                'variance_qty': str(variance),
            }
            if variance == 0:
                skipped_zero_lines += 1
                lines.append({
                    **base,
                    'status': 'SKIPPED',
                    'adjustment_type': None,
                    'adjustment_qty': '0',
                    'blocked_reason': '',
                })
                continue

            tx_type = InventoryTransactionType.ADJUSTMENT_IN if variance > 0 else InventoryTransactionType.ADJUSTMENT_OUT
            qty = variance if variance > 0 else abs(variance)
            payload = {
                'transaction_type': tx_type,
                'transaction_date': stocktake.count_date,
                'reference': stocktake.code,
                'reason': reason or f'Stocktake {stocktake.code}',
                'product': line.product_id,
                'warehouse': line.warehouse_id,
                'quantity': qty,
            }
            serializer = InventoryTransactionSerializer(data=payload, context=self.get_serializer_context())
            if serializer.is_valid():
                if tx_type == InventoryTransactionType.ADJUSTMENT_IN:
                    total_in_lines += 1
                else:
                    total_out_lines += 1
                lines.append({
                    **base,
                    'status': 'READY',
                    'adjustment_type': tx_type,
                    'adjustment_qty': str(qty),
                    'blocked_reason': '',
                    '_payload': payload,
                })
            else:
                blocked_lines += 1
                lines.append({
                    **base,
                    'status': 'BLOCKED',
                    'adjustment_type': tx_type,
                    'adjustment_qty': str(qty),
                    'blocked_reason': serializer.errors,
                    '_payload': payload,
                })

        can_post = (
            stocktake.status == StocktakeStatus.COMPLETED
            and stocktake.adjustment_posted_at is None
            and blocked_lines == 0
        )
        return {
            'stocktake': stocktake.id,
            'stocktake_code': stocktake.code,
            'status': stocktake.status,
            'adjustment_posted_at': stocktake.adjustment_posted_at,
            'can_post': can_post,
            'total_in_lines': total_in_lines,
            'total_out_lines': total_out_lines,
            'skipped_zero_lines': skipped_zero_lines,
            'blocked_lines': blocked_lines,
            'transaction_count': total_in_lines + total_out_lines,
            'lines': lines,
        }

    def _public_adjustment_preview(self, preview):
        public_lines = []
        for line in preview.get('lines', []):
            public_lines.append({key: value for key, value in line.items() if key != '_payload'})
        return {**preview, 'lines': public_lines}

    @action(detail=True, methods=['post'])
    def preview_adjustments(self, request, pk=None):
        stocktake = self.get_object()
        if stocktake.status != StocktakeStatus.COMPLETED:
            raise ValidationError({'status': 'Chá»‰ preview Ä‘iá»u chá»‰nh cho phiáº¿u kiá»ƒm tá»“n Ä‘Ă£ hoĂ n táº¥t.'})
        return Response(self._public_adjustment_preview(self._build_adjustment_preview(stocktake)))

    @action(detail=True, methods=['post'])
    def post_adjustments(self, request, pk=None):
        if not _can_manage_inventory(request.user):
            raise PermissionDenied('Báº¡n khĂ´ng cĂ³ quyá»n ghi Ä‘iá»u chá»‰nh tá»“n kho.')
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            raise ValidationError({'reason': 'Ghi Ä‘iá»u chá»‰nh tá»“n báº¯t buá»™c cĂ³ lĂ½ do.'})
        with transaction.atomic():
            locked_stocktake = Stocktake.objects.select_for_update().get(pk=pk)
            self.check_object_permissions(request, locked_stocktake)
            stocktake = (
                Stocktake.objects.select_related('warehouse')
                .prefetch_related('lines', 'lines__product', 'lines__warehouse')
                .get(pk=locked_stocktake.pk)
            )
            self.check_object_permissions(request, stocktake)
            if stocktake.status != StocktakeStatus.COMPLETED:
                raise ValidationError({'status': 'Chá»‰ ghi Ä‘iá»u chá»‰nh cho phiáº¿u kiá»ƒm tá»“n Ä‘Ă£ hoĂ n táº¥t.'})
            if stocktake.adjustment_posted_at:
                raise ValidationError({'adjustment_posted_at': 'Phiáº¿u kiá»ƒm tá»“n nĂ y Ä‘Ă£ ghi Ä‘iá»u chá»‰nh tá»“n.'})

            preview = self._build_adjustment_preview(stocktake, reason=reason)
            if preview['blocked_lines']:
                raise ValidationError({
                    'blocked_lines': preview['blocked_lines'],
                    'lines': self._public_adjustment_preview(preview)['lines'],
                })

            created_transactions = []
            for line_preview in preview['lines']:
                payload = line_preview.get('_payload')
                if not payload or line_preview.get('status') != 'READY':
                    continue
                serializer = InventoryTransactionSerializer(data=payload, context=self.get_serializer_context())
                serializer.is_valid(raise_exception=True)
                stocktake_line = stocktake.lines.get(id=line_preview['line_id'])
                tx = serializer.save(
                    created_by=request.user,
                    updated_by=request.user,
                    posted_by=request.user,
                    stocktake=stocktake,
                    stocktake_line=stocktake_line,
                )
                created_transactions.append(tx)

            stocktake.adjustment_posted_at = timezone.now()
            stocktake.adjustment_posted_by = request.user
            stocktake.save(update_fields=['adjustment_posted_at', 'adjustment_posted_by', 'updated_at'])

            AuditLog.objects.create(
                user=request.user,
                action='POST',
                entity_type='Stocktake',
                entity_id=stocktake.id,
                entity_code=stocktake.code,
                old_values={'adjustment_posted_at': None},
                new_values={
                    'adjustment_posted_at': stocktake.adjustment_posted_at.isoformat(),
                    'reason': reason,
                    'transaction_count': len(created_transactions),
                    'total_in_lines': preview['total_in_lines'],
                    'total_out_lines': preview['total_out_lines'],
                    'skipped_zero_lines': preview['skipped_zero_lines'],
                },
                changed_fields=['adjustment_posted_at', 'adjustment_posted_by'],
                ip_address=get_client_ip(request),
                user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
            )

        response = self._public_adjustment_preview(preview)
        response.update({
            'status': 'POSTED',
            'adjustment_posted_at': stocktake.adjustment_posted_at,
            'adjustment_posted_by': stocktake.adjustment_posted_by_id,
            'transaction_ids': [tx.id for tx in created_transactions],
        })
        return Response(response)


class OutboundShipmentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Danh sách phiếu xuất / giao hàng (read-only)."""
    permission_classes = [IsAuthenticated]
    serializer_class = OutboundShipmentSerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = OutboundShipmentFilter
    ordering_fields = ['shipment_date', 'code', 'id']
    ordering = ['-shipment_date', '-id']

    def get_queryset(self):
        return OutboundShipment.objects.select_related(
            'sales_order', 'loading_confirmed_by', 'delivery_confirmed_by'
        ).prefetch_related('packages', 'transactions').order_by('-shipment_date', '-id')


class InventoryStockViewSet(InventoryManagePermissionMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = Product.objects.all()

    def list(self, request, *args, **kwargs):
        q = (request.query_params.get('q') or '').strip().lower()
        product_ids = request.query_params.getlist('product') or None
        warehouse_ids = request.query_params.getlist('warehouse') or None
        location_ids = request.query_params.getlist('location') or None
        warehouse_id_set = {int(value) for value in warehouse_ids or [] if str(value).isdigit()}
        location_id_set = {int(value) for value in location_ids or [] if str(value).isdigit()}
        below_min_only = str(request.query_params.get('below_min_only') or '').lower() in {'1', 'true', 'yes'}

        balances = build_stock_balance_map(
            product_ids=product_ids or None,
            warehouse_ids=warehouse_ids or None,
            location_ids=location_ids or None,
        )
        product_id_values = [key[0] for key in balances.keys()]
        product_map = {
            product.id: product
            for product in Product.objects.select_related('unit').filter(id__in=product_id_values)
        }
        warehouse_map = {
            warehouse.id: warehouse
            for warehouse in Warehouse.objects.filter(id__in={key[1] for key in balances.keys() if key[1]})
        }
        location_map = {
            location.id: location
            for location in WarehouseLocation.objects.filter(id__in={key[2] for key in balances.keys() if key[2]})
        }

        rows = []
        for key, balance in balances.items():
            product = product_map.get(key[0])
            warehouse = warehouse_map.get(key[1])
            location = location_map.get(key[2]) if key[2] else None
            if not product or not warehouse:
                continue
            if warehouse_id_set and warehouse.id not in warehouse_id_set:
                continue
            if location_id_set and (not location or location.id not in location_id_set):
                continue
            on_hand = balance['on_hand']
            reserved = balance['reserved']
            available = on_hand - reserved
            row = {
                'product_id': product.id,
                'product_code': product.code,
                'product_name': product.name,
                'unit_name': getattr(getattr(product, 'unit', None), 'name', None),
                'warehouse_id': warehouse.id,
                'warehouse_code': warehouse.code,
                'warehouse_name': warehouse.name,
                'warehouse_sort_order': warehouse.sort_order,
                'warehouse_is_active': warehouse.is_active,
                'location_id': location.id if location else None,
                'location_code': location.code if location else None,
                'location_name': location.name if location else None,
                'location_type': getattr(location, 'location_type', None),
                'location_sort_order': getattr(location, 'sort_order', None),
                'location_is_active': getattr(location, 'is_active', None),
                'min_stock': product.min_stock,
                'on_hand': on_hand,
                'reserved': reserved,
                'available': available,
                'is_below_min': available < (product.min_stock or Decimal('0')),
            }
            if q:
                haystack = ' '.join(
                    str(v or '').lower()
                    for v in [row['product_code'], row['product_name'], row['warehouse_code'], row['warehouse_name'], row['location_code'], row['location_name']]
                )
                if q not in haystack:
                    continue
            if below_min_only and not row['is_below_min']:
                continue
            rows.append(row)

        rows.sort(key=lambda item: (item['warehouse_code'] or '', item['product_code'] or '', item['location_code'] or ''))
        page = self.paginate_queryset(rows)
        if page is not None:
            return self.get_paginated_response(page)
        return Response(rows)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        balances = build_stock_balance_map()
        total_rows = 0
        below_min_count = 0
        total_reserved = Decimal('0')
        total_on_hand = Decimal('0')
        product_ids = {key[0] for key in balances.keys()}
        product_map = {product.id: product for product in Product.objects.filter(id__in=product_ids)}
        for key, balance in balances.items():
            product = product_map.get(key[0])
            if not product:
                continue
            total_rows += 1
            total_on_hand += balance['on_hand']
            total_reserved += balance['reserved']
            if (balance['on_hand'] - balance['reserved']) < (product.min_stock or Decimal('0')):
                below_min_count += 1
        return Response(
            {
                'stock_rows': total_rows,
                'below_min_count': below_min_count,
                'total_on_hand_qty': total_on_hand,
                'total_reserved_qty': total_reserved,
                'total_available_qty': total_on_hand - total_reserved,
            }
        )


class StockAlertViewSet(InventoryManagePermissionMixin, viewsets.ModelViewSet):
    serializer_class = StockAlertSerializer
    filter_backends = [django_filters.rest_framework.DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['status']
    ordering_fields = ['triggered_at', 'product__code', 'alert_type']
    ordering = ['-triggered_at']

    def get_queryset(self):
        return StockAlert.objects.select_related('product', 'acknowledged_by')

    def perform_create(self, serializer):
        serializer.save()

    @action(detail=True, methods=['post'])
    def acknowledge_alert(self, request, pk=None):
        alert = self.get_object()
        if alert.status == 'ACKNOWLEDGED':
            return Response({'status': alert.status, 'message': 'Cảnh báo đã được xác nhận trước đó.'}, status=400)
        alert.status = 'ACKNOWLEDGED'
        alert.acknowledged_by = request.user
        alert.acknowledged_at = timezone.now()
        alert.save(update_fields=['status', 'acknowledged_by', 'acknowledged_at', 'updated_at'])
        serializer = self.get_serializer(alert)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def check_low_stock(self, request):
        balances = build_stock_balance_map()
        product_ids = {key[0] for key in balances.keys()}
        products = Product.objects.filter(id__in=product_ids).select_related('unit')
        created_count = 0
        for product in products:
            product_balance = sum(
                balance['on_hand']
                for (pid, _, _), balance in balances.items()
                if pid == product.id
            )
            min_stock = product.min_stock or Decimal('0')
            if product_balance < min_stock:
                existing_active = StockAlert.objects.filter(
                    product=product,
                    status='ACTIVE'
                ).exists()
                if not existing_active:
                    alert_type = 'OUT_OF_STOCK' if product_balance == 0 else 'LOW_STOCK'
                    StockAlert.objects.create(
                        product=product,
                        alert_type=alert_type,
                        status='ACTIVE',
                        current_qty=product_balance,
                        min_stock=min_stock,
                    )
                    created_count += 1
        return Response({
            'message': f'Kiểm tra tồn kho hoàn tất. Đã tạo {created_count} cảnh báo mới.',
            'alerts_created': created_count,
        })


# Warehouse Transfer ViewSet
from inventory.models import WarehouseTransfer, WarehouseTransferLine
from inventory.serializers import WarehouseTransferSerializer


class WarehouseTransferViewSet(InventoryManagePermissionMixin, viewsets.ModelViewSet):
    """Warehouse Transfers - chuyển hàng giữa kho."""
    queryset = WarehouseTransfer.objects.select_related('from_warehouse', 'to_warehouse', 'created_by', 'submitted_by', 'posted_by', 'cancelled_by')
    serializer_class = WarehouseTransferSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['code', 'reference']
    ordering_fields = ['transfer_date', 'status']
    ordering = ['-transfer_date']

    def get_queryset(self):
        qs = super().get_queryset()
        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        if serializer.instance.status != 'DRAFT':
            raise ValidationError('Chỉ được sửa transfer ở trạng thái Nháp.')
        serializer.save()

    @action(detail=True, methods=['post'])
    def submit_transfer(self, request, pk=None):
        """DRAFT -> SUBMITTED."""
        transfer = self.get_object()
        if transfer.status != 'DRAFT':
            return Response({'error': 'Chỉ gửi duyệt transfer ở trạng thái Nháp.'}, status=400)
        if not transfer.lines.exists():
            return Response({'error': 'Transfer phải có ít nhất 1 dòng hàng.'}, status=400)
        transfer.status = 'SUBMITTED'
        transfer.submitted_by = request.user
        transfer.submitted_at = timezone.now()
        transfer.save(update_fields=['status', 'submitted_by', 'submitted_at'])
        AuditLog.objects.create(
            user=request.user, action='SUBMIT', entity_type='WarehouseTransfer',
            entity_id=transfer.id, entity_code=transfer.code,
            old_values={'status': 'DRAFT'},
            new_values={'status': 'SUBMITTED'},
            changed_fields=['status'],
            ip_address=get_client_ip(request), user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response({'status': transfer.status})

    @action(detail=True, methods=['post'])
    def post_transfer(self, request, pk=None):
        """SUBMITTED -> IN_TRANSIT."""
        transfer = self.get_object()
        if transfer.status != 'SUBMITTED':
            return Response({'error': 'Chỉ post transfer đã gửi.'}, status=400)
        from inventory.serializers import InventoryTransactionSerializer
        with transaction.atomic():
            locked_transfer = WarehouseTransfer.objects.select_for_update().prefetch_related('lines').get(pk=transfer.pk)
            for line in locked_transfer.lines.select_related('product').all():
                serializer = InventoryTransactionSerializer(data={
                    'transaction_type': InventoryTransactionType.ISSUE,
                    'transaction_date': locked_transfer.transfer_date,
                    'reference': locked_transfer.code,
                    'reason': f'Xuất chuyển kho {locked_transfer.code}',
                    'note': line.note or locked_transfer.note or '',
                    'product': line.product_id,
                    'warehouse': locked_transfer.from_warehouse_id,
                    'quantity': str(line.qty),
                    'unit_cost': str(getattr(line.product, 'cost_price', Decimal('0')) or 0),
                })
                serializer.is_valid(raise_exception=True)
                serializer.save(
                    created_by=request.user,
                    updated_by=request.user,
                    posted_by=request.user,
                )
            locked_transfer.status = 'IN_TRANSIT'
            locked_transfer.posted_by = request.user
            locked_transfer.posted_at = timezone.now()
            locked_transfer.save(update_fields=['status', 'posted_by', 'posted_at'])
        AuditLog.objects.create(
            user=request.user, action='POST', entity_type='WarehouseTransfer',
            entity_id=transfer.id, entity_code=transfer.code,
            old_values={'status': 'SUBMITTED'},
            new_values={'status': 'IN_TRANSIT'},
            changed_fields=['status'],
            ip_address=get_client_ip(request), user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response({'status': 'IN_TRANSIT'})

    @action(detail=True, methods=['post'])
    def receive_transfer(self, request, pk=None):
        """IN_TRANSIT -> RECEIVED (update received_qty for each line)."""
        transfer = self.get_object()
        if transfer.status != 'IN_TRANSIT':
            return Response({'error': 'Chỉ nhận transfer đang vận chuyển.'}, status=400)
        
        lines_data = request.data.get('lines', [])
        from inventory.serializers import InventoryTransactionSerializer
        with transaction.atomic():
            locked_transfer = WarehouseTransfer.objects.select_for_update().prefetch_related('lines').get(pk=transfer.pk)
            line_payloads = {int(item.get('id')): item for item in lines_data if item.get('id')}
            for line in locked_transfer.lines.select_related('product').all():
                payload = line_payloads.get(line.id, {})
                received_qty = Decimal(str(payload.get('received_qty') or line.qty))
                if received_qty < 0 or received_qty > line.qty:
                    raise ValidationError({'received_qty': f'Số lượng nhận của dòng {line.line_number} phải từ 0 đến {line.qty}.'})
                line.received_qty = received_qty
                line.save(update_fields=['received_qty'])
                if received_qty > 0:
                    serializer = InventoryTransactionSerializer(data={
                        'transaction_type': InventoryTransactionType.RECEIPT,
                        'transaction_date': locked_transfer.transfer_date,
                        'reference': locked_transfer.code,
                        'reason': f'Nhập chuyển kho {locked_transfer.code}',
                        'note': line.note or locked_transfer.note or '',
                        'product': line.product_id,
                        'warehouse': locked_transfer.to_warehouse_id,
                        'quantity': str(received_qty),
                        'unit_cost': str(getattr(line.product, 'cost_price', Decimal('0')) or 0),
                    })
                    serializer.is_valid(raise_exception=True)
                    serializer.save(
                        created_by=request.user,
                        updated_by=request.user,
                        posted_by=request.user,
                    )

            locked_transfer.status = 'RECEIVED'
            locked_transfer.save(update_fields=['status'])
        
        AuditLog.objects.create(
            user=request.user, action='UPDATE', entity_type='WarehouseTransfer',
            entity_id=transfer.id, entity_code=transfer.code,
            old_values={'status': 'IN_TRANSIT'},
            new_values={'status': 'RECEIVED'},
            changed_fields=['status', 'received_qty'],
            ip_address=get_client_ip(request), user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response({'status': 'RECEIVED'})

    @action(detail=True, methods=['post'])
    def cancel_transfer(self, request, pk=None):
        """Cancel transfer."""
        transfer = self.get_object()
        if transfer.status == 'RECEIVED':
            return Response({'error': 'Transfer đã nhận hoàn tất, không thể hủy.'}, status=400)
        reason = (request.data.get('reason') or '').strip() or 'Hủy chuyển kho'
        from inventory.serializers import InventoryTransactionSerializer
        with transaction.atomic():
            locked_transfer = WarehouseTransfer.objects.select_for_update().prefetch_related('lines').get(pk=transfer.pk)
            if locked_transfer.status == 'IN_TRANSIT':
                for line in locked_transfer.lines.select_related('product').all():
                    serializer = InventoryTransactionSerializer(data={
                        'transaction_type': InventoryTransactionType.RECEIPT,
                        'transaction_date': timezone.localdate().isoformat(),
                        'reference': locked_transfer.code,
                        'reason': f'Hoàn nhập do hủy chuyển kho {locked_transfer.code}',
                        'note': line.note or locked_transfer.note or reason,
                        'product': line.product_id,
                        'warehouse': locked_transfer.from_warehouse_id,
                        'quantity': str(line.qty),
                        'unit_cost': str(getattr(line.product, 'cost_price', Decimal('0')) or 0),
                    })
                    serializer.is_valid(raise_exception=True)
                    serializer.save(
                        created_by=request.user,
                        updated_by=request.user,
                        posted_by=request.user,
                    )
            locked_transfer.status = 'CANCELLED'
            locked_transfer.cancelled_by = request.user
            locked_transfer.cancelled_at = timezone.now()
            locked_transfer.cancel_reason = reason
            locked_transfer.save(update_fields=['status', 'cancelled_by', 'cancelled_at', 'cancel_reason'])
        AuditLog.objects.create(
            user=request.user, action='VOID', entity_type='WarehouseTransfer',
            entity_id=transfer.id, entity_code=transfer.code,
            old_values={'status': transfer.status},
            new_values={'status': 'CANCELLED', 'reason': reason},
            changed_fields=['status', 'cancel_reason'],
            ip_address=get_client_ip(request), user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
        )
        return Response({'status': 'CANCELLED'})
