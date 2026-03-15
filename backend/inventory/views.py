from datetime import datetime as dt_parse
from decimal import Decimal

import django_filters
from django.db import transaction
from django.db.models import Sum
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
    Stocktake,
    StocktakeStatus,
    Warehouse,
    WarehouseLocation,
)
from inventory.serializers import (
    InventoryReservationSerializer,
    InventoryTransactionSerializer,
    OutboundShipmentSerializer,
    StocktakeSerializer,
    WarehouseLocationSerializer,
    WarehouseSerializer,
)
from inventory.services import build_stock_balance_map
from inventory.services import apply_reservation_fulfillment, cancel_inventory_transaction_record
from products.models import Product
from sales.services import apply_delivery_plan_shipment


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
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

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
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

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
            'reservation',
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
        warehouse_id = request.query_params.get('warehouse') or request.query_params.get('warehouse_id')
        if warehouse_id and str(warehouse_id).isdigit():
            warehouse_id = int(warehouse_id)
        else:
            warehouse_id = None

        base = InventoryTransaction.objects.filter(status=InventoryTransactionStatus.POSTED)
        if warehouse_id:
            base = base.filter(warehouse_id=warehouse_id)
        in_types = [InventoryTransactionType.RECEIPT, InventoryTransactionType.ADJUSTMENT_IN]
        out_types = [InventoryTransactionType.ISSUE, InventoryTransactionType.ADJUSTMENT_OUT]

        def _agg(qs, key_fields):
            return {
                (r['product_id'], r['warehouse_id'] or 0): Decimal(str(r['total'] or 0))
                for r in qs.values('product_id', 'warehouse_id').annotate(total=Sum('quantity'))
            }

        opening_in = _agg(base.filter(transaction_type__in=in_types, transaction_date__lt=date_from), ('product_id', 'warehouse_id'))
        opening_out = _agg(base.filter(transaction_type__in=out_types, transaction_date__lt=date_from), ('product_id', 'warehouse_id'))
        period_in = _agg(base.filter(transaction_type__in=in_types, transaction_date__gte=date_from, transaction_date__lte=date_to), ('product_id', 'warehouse_id'))
        period_out = _agg(base.filter(transaction_type__in=out_types, transaction_date__gte=date_from, transaction_date__lte=date_to), ('product_id', 'warehouse_id'))

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
            action='CANCEL',
            entity_type='InventoryTransaction',
            entity_id=tx.id,
            entity_code=tx.code,
            old_values={'status': InventoryTransactionStatus.POSTED},
            new_values={'status': InventoryTransactionStatus.CANCELLED, 'reason': reason},
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
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

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
        return Stocktake.objects.select_related('warehouse', 'created_by', 'completed_by').prefetch_related('lines', 'lines__product')

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
