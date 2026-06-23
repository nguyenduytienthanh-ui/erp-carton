from datetime import date
from decimal import Decimal, InvalidOperation

from django.apps import apps
from django.core.exceptions import FieldError
from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from unidecode import unidecode

from core.mixins import get_client_ip
from core.models import ApprovalHistory, AuditLog
from core.permissions import check_action_permission
from core.workflow_services import generate_tasks_for_entity
from purchasing.models import (
    MaterialPurchasePrice,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseOrderStatus,
    PurchaseReceipt,
    PurchaseReceiptLine,
    PurchaseReceiptStatus,
    PurchaseRequest,
    PurchaseRequestLine,
    PurchaseRequestStatus,
    PurchaseReturn,
    PurchaseReturnStatus,
    Supplier,
)
from purchasing.permissions import (
    can_approve_purchase_order,
    can_cancel_purchase_order,
    can_cancel_purchase_receipt,
    can_create_supplier,
    can_delete_supplier,
    can_edit_supplier,
    can_edit_purchase_order,
    can_receive_purchase_order,
    can_reject_purchase_order,
    can_submit_purchase_order,
    can_view_supplier,
)
from purchasing.serializers import (
    MaterialPurchasePriceSerializer,
    PurchaseOrderSerializer,
    PurchaseReceiptSerializer,
    PurchaseRequestSerializer,
    SupplierSerializer,
)
from purchasing.services import (
    add_received_qty,
    build_supplier_snapshot,
    get_next_purchase_order_code,
    get_next_purchase_receipt_code,
    subtract_received_qty,
    sync_purchase_order_receipt_status,
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


def _can_manage_procurement(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'PURCHASING', 'MANAGE', strict=True):
        return True
    return any(
        role in {
            'admin',
            'manager',
            'ops-manager',
            'operation-manager',
            'product-manager',
            'finance-manager',
            'quan-ly',
            'quanly',
        }
        for role in _user_role_names(user)
    )


def _log_procurement_audit(request, *, action, entity_type, entity_id, entity_code, old_values, new_values):
    AuditLog.objects.create(
        user=request.user,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_code=entity_code,
        old_values=old_values,
        new_values=new_values,
        ip_address=get_client_ip(request),
        user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:500],
    )


def _approval_action_label(action):
    return {
        'CREATE': 'Đã tạo',
        'UPDATE': 'Đã cập nhật',
        'SUBMIT': 'Gửi duyệt',
        'APPROVE': 'Đã duyệt',
        'REJECT': 'Từ chối',
        'REVOKE': 'Thu hồi',
        'RESUBMIT': 'Gửi lại',
        'RECEIVE': 'Đã ghi sổ',
        'POST': 'Đã vào sổ',
        'CANCEL': 'Đã hủy',
    }.get(str(action or '').upper(), str(action or ''))


def _serialize_approval_history_item(item):
    return {
        'action': item.action,
        'action_label': _approval_action_label(item.action),
        'user': getattr(item.user, 'username', None),
        'comments': item.comments,
        'created_at': item.created_at,
    }


def _serialize_audit_timeline_item(item):
    new_values = item.new_values if isinstance(item.new_values, dict) else {}
    comments = ''
    action = str(item.action or '').upper()
    if action in {'RECEIVE', 'POST'}:
        qty = new_values.get('total_qty')
        amount = new_values.get('total_amount')
        segments = []
        if qty not in (None, ''):
            segments.append(f'Số lượng {qty}')
        if amount not in (None, ''):
            segments.append(f'Giá trị {amount}')
        comments = ', '.join(segments)
    elif action in {'CANCEL', 'REJECT'}:
        comments = str(new_values.get('reason') or new_values.get('cancel_reason') or '').strip()
    elif action == 'CREATE':
        comments = str(new_values.get('reference') or '').strip()

    return {
        'action': item.action,
        'action_label': _approval_action_label(item.action),
        'user': getattr(item.user, 'username', None),
        'comments': comments,
        'created_at': item.created_at,
    }


class SearchTextMixin:
    search_text_field = 'search_text'

    def check_module_read_permission(self):
        if not _can_manage_procurement(self.request.user):
            raise PermissionDenied('Bạn không có quyền xem dữ liệu mua hàng.')

    def apply_search(self, queryset):
        self.check_module_read_permission()
        search_raw = (self.request.query_params.get('q') or self.request.query_params.get('search') or '').strip()
        if not search_raw:
            return queryset

        normalized = unidecode(search_raw).lower().strip()
        tokens = [token for token in normalized.split() if token]
        if not tokens:
            return queryset

        field_name = self.search_text_field
        query = Q(**{f'{field_name}__icontains': tokens[0]})
        for token in tokens[1:]:
            query &= Q(**{f'{field_name}__icontains': token})
        return queryset.filter(query).distinct()


SUPPLIER_ACTION_PERMISSION_MAP = {
    'list': 'VIEW',
    'retrieve': 'VIEW',
    'metadata': 'VIEW',
    'create': 'CREATE',
    'update': 'EDIT',
    'partial_update': 'EDIT',
    'destroy': 'DELETE',
}

SUPPLIER_PERMISSION_MESSAGES = {
    'VIEW': 'Bạn không có quyền xem nhà cung cấp.',
    'CREATE': 'Bạn không có quyền tạo nhà cung cấp.',
    'EDIT': 'Bạn không có quyền cập nhật nhà cung cấp.',
    'DELETE': 'Bạn không có quyền xóa cứng nhà cung cấp.',
    'IMPORT': 'Bạn không có quyền nhập dữ liệu nhà cung cấp.',
    'EXPORT': 'Bạn không có quyền xuất dữ liệu nhà cung cấp.',
}

SUPPLIER_PERMISSION_CHECKERS = {
    'VIEW': can_view_supplier,
    'CREATE': can_create_supplier,
    'EDIT': can_edit_supplier,
    'DELETE': can_delete_supplier,
}

SUPPLIER_DELETE_RELATION_CHECKS = (
    ('purchasing', 'PurchaseOrder', 'đơn mua', {'supplier_id': 'id'}),
    ('purchasing', 'PurchaseReceipt', 'phiếu nhập mua', {'purchase_order__supplier_id': 'id'}),
    ('purchasing', 'MaterialPurchasePrice', 'bảng giá mua', {'supplier_id': 'id'}),
    ('purchasing', 'PurchaseReturn', 'phiếu trả hàng', {'supplier_id': 'id'}),
    ('finance', 'PayableDocument', 'chứng từ phải trả', {'supplier_id': 'id'}),
    ('core', 'ApprovalHistory', 'lịch sử phê duyệt', {'entity_type': 'literal:Supplier', 'entity_id': 'id'}),
    ('core', 'Task', 'công việc liên quan', {'entity_type': 'literal:Supplier', 'entity_id': 'id'}),
)

SUPPLIER_DELETE_BLOCKED_MESSAGE = 'Không thể xóa nhà cung cấp đã phát sinh chứng từ. Hãy chuyển sang Ngừng sử dụng.'


def _supplier_delete_blockers(supplier):
    blockers = []
    for app_label, model_name, label, filter_map in SUPPLIER_DELETE_RELATION_CHECKS:
        try:
            model = apps.get_model(app_label, model_name)
        except LookupError:
            continue
        filters = {}
        for field_name, source in filter_map.items():
            if isinstance(source, str) and source.startswith('literal:'):
                filters[field_name] = source.removeprefix('literal:')
            else:
                filters[field_name] = getattr(supplier, source)
        try:
            if model.objects.filter(**filters).exists() and label not in blockers:
                blockers.append(label)
        except FieldError:
            continue
    return blockers


class SupplierViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'name', 'company_name', 'payment_terms_days', 'rating', 'created_at', 'updated_at']
    ordering = ['code']

    def check_permissions(self, request):
        super().check_permissions(request)
        required_action = SUPPLIER_ACTION_PERMISSION_MAP.get(getattr(self, 'action', None), 'VIEW')
        checker = SUPPLIER_PERMISSION_CHECKERS.get(required_action, can_view_supplier)
        if not checker(request.user):
            message = SUPPLIER_PERMISSION_MESSAGES.get(required_action, 'Bạn không có quyền thao tác nhà cung cấp.')
            raise PermissionDenied(message)

    def check_module_read_permission(self):
        if not can_view_supplier(self.request.user):
            raise PermissionDenied(SUPPLIER_PERMISSION_MESSAGES['VIEW'])

    def get_queryset(self):
        queryset = super().get_queryset()
        is_active = self.request.query_params.get('is_active')
        if is_active in ('true', 'false'):
            queryset = queryset.filter(is_active=(is_active == 'true'))
        is_preferred = self.request.query_params.get('is_preferred')
        if is_preferred in ('true', 'false'):
            queryset = queryset.filter(is_preferred=(is_preferred == 'true'))
        has_contact = self.request.query_params.get('has_contact')
        if has_contact in ('true', 'false'):
            contact_filter = Q(contact_person__gt='') | Q(phone__gt='') | Q(email__gt='') | Q(contact_phone__gt='')
            queryset = queryset.filter(contact_filter if has_contact == 'true' else ~contact_filter)
        missing_profile = self.request.query_params.get('missing_profile')
        if str(missing_profile or '').lower() in {'1', 'true', 'yes'}:
            queryset = queryset.filter(
                Q(tax_code='') |
                (Q(contact_person='') & Q(phone='') & Q(email='') & Q(contact_phone=''))
            )
        for field in ('code', 'name', 'company_name', 'phone', 'email', 'contact_person'):
            value = (self.request.query_params.get(field) or '').strip()
            if value:
                queryset = queryset.filter(**{f'{field}__icontains': value})
        tax_code = (self.request.query_params.get('tax_code') or '').strip()
        if tax_code:
            lookup = 'tax_code__iexact' if str(self.request.query_params.get('tax_code_exact') or '').lower() in {'1', 'true', 'yes'} else 'tax_code__icontains'
            queryset = queryset.filter(**{lookup: tax_code})
        rating_min = self.request.query_params.get('rating_min')
        if rating_min not in (None, ''):
            try:
                queryset = queryset.filter(rating__gte=int(rating_min))
            except (TypeError, ValueError):
                pass
        rating_max = self.request.query_params.get('rating_max')
        if rating_max not in (None, ''):
            try:
                queryset = queryset.filter(rating__lte=int(rating_max))
            except (TypeError, ValueError):
                pass
        payment_terms_days = self.request.query_params.get('payment_terms_days')
        if payment_terms_days not in (None, ''):
            try:
                queryset = queryset.filter(payment_terms_days=int(payment_terms_days))
            except (TypeError, ValueError):
                pass
        return self.apply_search(queryset)

    def _get_delete_blockers(self, supplier):
        return _supplier_delete_blockers(supplier)

    def perform_create(self, serializer):
        if not can_create_supplier(self.request.user):
            raise PermissionDenied(SUPPLIER_PERMISSION_MESSAGES['CREATE'])
        supplier = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        _log_procurement_audit(
            self.request,
            action='CREATE',
            entity_type='Supplier',
            entity_id=int(supplier.id),
            entity_code=supplier.code,
            old_values={},
            new_values={'code': supplier.code, 'name': supplier.name, 'is_active': supplier.is_active},
        )

    def perform_update(self, serializer):
        if not can_edit_supplier(self.request.user):
            raise PermissionDenied(SUPPLIER_PERMISSION_MESSAGES['EDIT'])
        previous = serializer.instance
        old_values = {
            'code': previous.code,
            'name': previous.name,
            'company_name': previous.company_name,
            'is_active': previous.is_active,
        }
        supplier = serializer.save(updated_by=self.request.user)
        _log_procurement_audit(
            self.request,
            action='UPDATE',
            entity_type='Supplier',
            entity_id=int(supplier.id),
            entity_code=supplier.code,
            old_values=old_values,
            new_values={
                'code': supplier.code,
                'name': supplier.name,
                'company_name': supplier.company_name,
                'is_active': supplier.is_active,
            },
        )

    def destroy(self, request, *args, **kwargs):
        if not can_delete_supplier(request.user):
            raise PermissionDenied(SUPPLIER_PERMISSION_MESSAGES['DELETE'])
        supplier = self.get_object()
        blockers = self._get_delete_blockers(supplier)
        if blockers:
            return Response(
                {
                    'error': 'Không thể xóa nhà cung cấp đã phát sinh chứng từ. Hãy chuyển sang Ngưng sử dụng.',
                    'blockers': blockers,
                    'related_records': blockers,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        old_values = {'code': supplier.code, 'name': supplier.name}
        response = super().destroy(request, *args, **kwargs)
        _log_procurement_audit(
            request,
            action='DELETE',
            entity_type='Supplier',
            entity_id=int(supplier.id),
            entity_code=supplier.code,
            old_values=old_values,
            new_values={},
        )
        return response


class MaterialPurchasePriceViewSet(viewsets.ModelViewSet):
    queryset = MaterialPurchasePrice.objects.select_related('product', 'supplier', 'product__unit')
    serializer_class = MaterialPurchasePriceSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter, filters.SearchFilter]
    ordering_fields = ['effective_from', 'effective_to', 'unit_price', 'created_at']
    ordering = ['-effective_from', 'product__code']
    search_fields = ['product__code', 'product__name', 'note']

    def get_queryset(self):
        qs = super().get_queryset()
        if not _can_manage_procurement(self.request.user):
            raise PermissionDenied('Bạn không có quyền xem bảng giá nguyên vật liệu.')
        product = self.request.query_params.get('product')
        if product:
            qs = qs.filter(product_id=product)
        supplier = self.request.query_params.get('supplier')
        if supplier:
            qs = qs.filter(supplier_id=supplier)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PurchaseOrderViewSet(SearchTextMixin, viewsets.ModelViewSet):
    serializer_class = PurchaseOrderSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'order_date', 'expected_receipt_date', 'status', 'total', 'created_at']
    ordering = ['-order_date', '-id']

    def get_queryset(self):
        queryset = PurchaseOrder.objects.select_related(
            'supplier',
            'warehouse',
            'location',
            'created_by',
            'updated_by',
            'submitted_by',
            'approved_by',
            'rejected_by',
            'cancelled_by',
            'owner',
            'team',
        ).prefetch_related(
            'lines',
            'lines__product',
            'receipts',
        )
        user = self.request.user
        if not getattr(user, 'is_superuser', False):
            if getattr(user, 'teams', None):
                team_ids = list(user.teams.values_list('id', flat=True))
                queryset = queryset.filter(Q(owner=user) | Q(team_id__in=team_ids) | Q(owner__isnull=True))
            else:
                queryset = queryset.filter(Q(owner=user) | Q(owner__isnull=True))

        status_value = (self.request.query_params.get('status') or '').strip()
        if status_value:
            queryset = queryset.filter(status=status_value)
        supplier_id = self.request.query_params.get('supplier')
        if supplier_id:
            queryset = queryset.filter(supplier_id=supplier_id)
        warehouse_id = self.request.query_params.get('warehouse')
        if warehouse_id:
            queryset = queryset.filter(warehouse_id=warehouse_id)
        order_date_from = self.request.query_params.get('order_date_from')
        if order_date_from:
            queryset = queryset.filter(order_date__gte=order_date_from)
        order_date_to = self.request.query_params.get('order_date_to')
        if order_date_to:
            queryset = queryset.filter(order_date__lte=order_date_to)
        expected_receipt_date_from = self.request.query_params.get('expected_receipt_date_from')
        if expected_receipt_date_from:
            queryset = queryset.filter(expected_receipt_date__gte=expected_receipt_date_from)
        expected_receipt_date_to = self.request.query_params.get('expected_receipt_date_to')
        if expected_receipt_date_to:
            queryset = queryset.filter(expected_receipt_date__lte=expected_receipt_date_to)
        has_overdue_receipt = str(self.request.query_params.get('has_overdue_receipt') or '').strip().lower() in {'1', 'true', 'yes'}
        if has_overdue_receipt:
            queryset = queryset.filter(
                status__in=[PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIAL_RECEIVED],
                expected_receipt_date__lt=timezone.localdate(),
            )
        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_procurement(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo đơn mua.')
        order_date = serializer.validated_data.get('order_date') or timezone.localdate()
        code = get_next_purchase_order_code(order_date)
        order = serializer.save(
            code=code,
            created_by=self.request.user,
            updated_by=self.request.user,
            owner=self.request.user,
        )
        _log_procurement_audit(
            self.request,
            action='CREATE',
            entity_type='PurchaseOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={},
            new_values={'status': order.status, 'supplier': order.supplier_id, 'total': str(order.total)},
        )

    def perform_update(self, serializer):
        if not can_edit_purchase_order(self.request.user, serializer.instance):
            raise PermissionDenied('Chỉ được sửa đơn mua ở trạng thái Nháp hoặc Từ chối.')
        previous = serializer.instance
        old_values = {
            'status': previous.status,
            'supplier': previous.supplier_id,
            'total': str(previous.total),
            'version': previous.version,
        }
        order = serializer.save(updated_by=self.request.user)
        _log_procurement_audit(
            self.request,
            action='UPDATE',
            entity_type='PurchaseOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values=old_values,
            new_values={'status': order.status, 'supplier': order.supplier_id, 'total': str(order.total), 'version': order.version},
        )

    def destroy(self, request, *args, **kwargs):
        order = self.get_object()
        if order.status not in {PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.REJECTED}:
            return Response({'error': 'Chỉ được xóa đơn mua ở trạng thái Nháp hoặc Từ chối.'}, status=status.HTTP_400_BAD_REQUEST)
        if order.receipts.exclude(status=PurchaseReceiptStatus.CANCELLED).exists():
            return Response({'error': 'Đơn mua đã phát sinh phiếu nhập, không thể xóa.'}, status=status.HTTP_400_BAD_REQUEST)
        old_values = {'code': order.code, 'status': order.status}
        response = super().destroy(request, *args, **kwargs)
        _log_procurement_audit(
            request,
            action='DELETE',
            entity_type='PurchaseOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values=old_values,
            new_values={},
        )
        return response

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        order = self.get_object()
        if not can_submit_purchase_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        old_status = order.status
        order.status = PurchaseOrderStatus.SUBMITTED
        order.submitted_by = request.user
        order.submitted_at = timezone.now()
        order.approved_by = None
        order.approved_at = None
        order.rejected_by = None
        order.rejected_at = None
        order.reject_reason = ''
        order.save(update_fields=[
            'status',
            'submitted_by',
            'submitted_at',
            'approved_by',
            'approved_at',
            'rejected_by',
            'rejected_at',
            'reject_reason',
            'updated_at',
        ])
        ApprovalHistory.objects.create(
            entity_type='PurchaseOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='SUBMIT',
            user=request.user,
            level=1,
        )
        _log_procurement_audit(
            request,
            action='SUBMIT',
            entity_type='PurchaseOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status},
        )
        generate_tasks_for_entity('PurchaseOrder', order.id, order.code, 'SUBMIT', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        order = self.get_object()
        if not can_approve_purchase_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        old_status = order.status
        order.status = PurchaseOrderStatus.APPROVED
        order.approved_by = request.user
        order.approved_at = timezone.now()
        order.rejected_by = None
        order.rejected_at = None
        order.reject_reason = ''
        order.save(update_fields=['status', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'reject_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='PurchaseOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='APPROVE',
            user=request.user,
            level=1,
        )
        _log_procurement_audit(
            request,
            action='APPROVE',
            entity_type='PurchaseOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status},
        )
        generate_tasks_for_entity('PurchaseOrder', order.id, order.code, 'APPROVE', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        order = self.get_object()
        if not can_reject_purchase_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': 'Bắt buộc nhập lý do từ chối.'}, status=status.HTTP_400_BAD_REQUEST)
        old_status = order.status
        order.status = PurchaseOrderStatus.REJECTED
        order.rejected_by = request.user
        order.rejected_at = timezone.now()
        order.reject_reason = reason
        order.save(update_fields=['status', 'rejected_by', 'rejected_at', 'reject_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='PurchaseOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='REJECT',
            user=request.user,
            comments=reason,
            level=1,
        )
        _log_procurement_audit(
            request,
            action='REJECT',
            entity_type='PurchaseOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status, 'reason': reason},
        )
        generate_tasks_for_entity('PurchaseOrder', order.id, order.code, 'REJECT', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        order = self.get_object()
        if not can_cancel_purchase_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = (request.data.get('reason') or request.data.get('cancel_reason') or '').strip()
        if not reason:
            return Response({'error': 'Bắt buộc nhập lý do hủy đơn mua.'}, status=status.HTTP_400_BAD_REQUEST)
        if order.receipts.exclude(status=PurchaseReceiptStatus.CANCELLED).exists():
            return Response({'error': 'Đơn mua đã phát sinh phiếu nhập, không thể hủy.'}, status=status.HTTP_400_BAD_REQUEST)
        old_status = order.status
        order.status = PurchaseOrderStatus.CANCELLED
        order.cancelled_by = request.user
        order.cancelled_at = timezone.now()
        order.cancel_reason = reason
        order.save(update_fields=['status', 'cancelled_by', 'cancelled_at', 'cancel_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='PurchaseOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='REJECT',
            user=request.user,
            comments=reason,
            level=1,
        )
        _log_procurement_audit(
            request,
            action='CANCEL',
            entity_type='PurchaseOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status, 'reason': reason},
        )
        generate_tasks_for_entity('PurchaseOrder', order.id, order.code, 'CANCEL', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        order = self.get_object()
        if not can_receive_purchase_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)

        raw_items = request.data.get('items')
        if not isinstance(raw_items, list):
            raw_items = [request.data] if request.data.get('purchase_order_line') else []

        receipt_date_raw = request.data.get('receipt_date') or timezone.localdate().isoformat()
        try:
            receipt_date_value = date.fromisoformat(str(receipt_date_raw))
        except (TypeError, ValueError):
            return Response({'error': 'Ngày nhận hàng không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        warehouse_id = request.data.get('warehouse') or getattr(order, 'warehouse_id', None)
        location_id = request.data.get('location') or getattr(order, 'location_id', None)
        if not warehouse_id:
            return Response({'error': 'Thiếu kho nhận hàng.'}, status=status.HTTP_400_BAD_REQUEST)

        from inventory.serializers import InventoryTransactionSerializer

        common_reference = str(request.data.get('reference') or order.reference or order.code or '').strip()
        common_reason = str(request.data.get('reason') or 'Nhập kho từ đơn mua').strip()
        common_note = str(request.data.get('note') or '').strip()

        with transaction.atomic():
            order_locked = (
                PurchaseOrder.objects.select_for_update()
                .get(pk=order.pk)
            )
            if order_locked.status not in {PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIAL_RECEIVED}:
                raise ValidationError({'error': 'Đơn mua hiện không thể nhập kho thêm.'})

            line_map = {
                line.id: line
                for line in PurchaseOrderLine.objects.select_for_update().filter(purchase_order=order_locked).select_related('product')
            }
            if not raw_items:
                raw_items = [
                    {
                        'purchase_order_line': line.id,
                        'quantity': str(line.remaining_qty),
                        'unit_cost': str(line.unit_price),
                    }
                    for line in line_map.values()
                    if line.remaining_qty > 0
                ]
            if not raw_items:
                raise ValidationError({'error': 'Đơn mua đã nhập đủ, không còn dòng nào để nhận hàng.'})

            receipt = PurchaseReceipt.objects.create(
                code=get_next_purchase_receipt_code(receipt_date_value),
                purchase_order=order_locked,
                receipt_date=receipt_date_value,
                reference=common_reference,
                supplier_snapshot=build_supplier_snapshot(order_locked.supplier),
                warehouse_id=warehouse_id,
                location_id=location_id,
                note=common_note,
                posted_by=request.user,
                created_by=request.user,
                updated_by=request.user,
            )

            created_lines = []
            seen_line_ids = set()
            for index, item in enumerate(raw_items, start=1):
                line_id = item.get('purchase_order_line') or item.get('line_id')
                if not line_id:
                    raise ValidationError({'error': f'Dòng {index}: thiếu purchase_order_line.'})
                try:
                    line_id = int(line_id)
                except (TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: purchase_order_line không hợp lệ.'})
                if line_id in seen_line_ids:
                    raise ValidationError({'error': f'Dòng {index}: purchase_order_line bị lặp trong cùng phiếu nhập.'})
                seen_line_ids.add(line_id)
                line = line_map.get(line_id)
                if not line:
                    raise ValidationError({'error': f'Dòng {index}: dòng đơn mua không tồn tại.'})
                try:
                    quantity = Decimal(str(item.get('quantity') or line.remaining_qty))
                except (InvalidOperation, TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: quantity không hợp lệ.'})
                if quantity <= 0:
                    raise ValidationError({'error': f'Dòng {index}: quantity phải > 0.'})
                if quantity > line.remaining_qty:
                    raise ValidationError(
                        {'error': f'Dòng {index}: chỉ còn {line.remaining_qty} để nhận, yêu cầu={quantity}.'}
                    )
                try:
                    unit_cost = Decimal(str(item.get('unit_cost') or line.unit_price or 0))
                except (InvalidOperation, TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: unit_cost không hợp lệ.'})

                serializer = InventoryTransactionSerializer(data={
                    'transaction_type': 'RECEIPT',
                    'transaction_date': item.get('receipt_date') or receipt_date_raw,
                    'product': line.product_id,
                    'warehouse': warehouse_id,
                    'location': location_id,
                    'quantity': str(quantity),
                    'unit_cost': str(unit_cost),
                    'reference': str(item.get('reference') or common_reference).strip(),
                    'reason': str(item.get('reason') or common_reason).strip(),
                    'note': str(item.get('note') or '').strip(),
                })
                serializer.is_valid(raise_exception=True)
                inventory_tx = serializer.save(
                    created_by=request.user,
                    updated_by=request.user,
                    posted_by=request.user,
                    purchase_order=order_locked,
                    purchase_order_line=line,
                    purchase_receipt=receipt,
                )

                receipt_line = PurchaseReceiptLine.objects.create(
                    receipt=receipt,
                    line_number=index,
                    purchase_order_line=line,
                    product=line.product,
                    product_snapshot=line.product_snapshot or {},
                    quantity=quantity,
                    unit_cost=unit_cost,
                    note=str(item.get('note') or line.note or '').strip(),
                    inventory_transaction=inventory_tx,
                )
                add_received_qty(line, quantity)
                created_lines.append(receipt_line)

            receipt.recalc_totals()
            sync_purchase_order_receipt_status(order_locked)
            try:
                from finance.services import build_payable_from_purchase_receipt

                build_payable_from_purchase_receipt(receipt, actor=request.user)
            except Exception:
                raise

        _log_procurement_audit(
            request,
            action='RECEIVE',
            entity_type='PurchaseReceipt',
            entity_id=int(receipt.id),
            entity_code=receipt.code,
            old_values={},
            new_values={
                'purchase_order': order.id,
                'purchase_order_code': order.code,
                'receipt_status': receipt.status,
                'total_qty': str(receipt.total_qty),
                'total_amount': str(receipt.total_amount),
            },
        )
        generate_tasks_for_entity('PurchaseOrder', order.id, order.code, 'RECEIVE', triggered_by=request.user)
        return Response(PurchaseReceiptSerializer(receipt).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def approval_history(self, request, pk=None):
        order = self.get_object()
        history = ApprovalHistory.objects.filter(
            entity_type='PurchaseOrder',
            entity_id=order.id,
        ).order_by('-created_at').select_related('user')
        return Response([_serialize_approval_history_item(item) for item in history])

    @action(detail=True, methods=['get'])
    def receipt_overview(self, request, pk=None):
        order = self.get_object()
        receipts = order.receipts.select_related('warehouse', 'location').prefetch_related('lines', 'lines__product').order_by('-receipt_date', '-id')
        return Response({
            'count': receipts.count(),
            'results': PurchaseReceiptSerializer(receipts, many=True).data,
        })

    @action(detail=True, methods=['get'])
    def next_states(self, request, pk=None):
        order = self.get_object()
        mapping = {
            PurchaseOrderStatus.DRAFT: [PurchaseOrderStatus.SUBMITTED, PurchaseOrderStatus.CANCELLED],
            PurchaseOrderStatus.SUBMITTED: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.REJECTED, PurchaseOrderStatus.CANCELLED],
            PurchaseOrderStatus.APPROVED: [PurchaseOrderStatus.PARTIAL_RECEIVED, PurchaseOrderStatus.RECEIVED, PurchaseOrderStatus.CANCELLED],
            PurchaseOrderStatus.REJECTED: [PurchaseOrderStatus.SUBMITTED, PurchaseOrderStatus.CANCELLED],
            PurchaseOrderStatus.PARTIAL_RECEIVED: [PurchaseOrderStatus.RECEIVED],
            PurchaseOrderStatus.RECEIVED: [],
            PurchaseOrderStatus.CANCELLED: [],
        }
        return Response({'current': order.status, 'next_states': mapping.get(order.status, [])})

    @action(detail=False, methods=['get'])
    def summary(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        today = timezone.localdate()
        open_receipt_qs = queryset.filter(status__in=[PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIAL_RECEIVED])
        open_value = Decimal(str(open_receipt_qs.aggregate(total=Sum('total')).get('total') or 0))
        return Response({
            'total_orders': int(queryset.count()),
            'draft_count': int(queryset.filter(status=PurchaseOrderStatus.DRAFT).count()),
            'submitted_count': int(queryset.filter(status=PurchaseOrderStatus.SUBMITTED).count()),
            'approved_count': int(queryset.filter(status=PurchaseOrderStatus.APPROVED).count()),
            'partial_received_count': int(queryset.filter(status=PurchaseOrderStatus.PARTIAL_RECEIVED).count()),
            'received_count': int(queryset.filter(status=PurchaseOrderStatus.RECEIVED).count()),
            'cancelled_count': int(queryset.filter(status=PurchaseOrderStatus.CANCELLED).count()),
            'pending_approval_count': int(queryset.filter(status=PurchaseOrderStatus.SUBMITTED).count()),
            'waiting_receipt_count': int(open_receipt_qs.count()),
            'overdue_receipt_count': int(open_receipt_qs.filter(expected_receipt_date__lt=today).count()),
            'open_value': str(open_value),
        })


class PurchaseReceiptViewSet(SearchTextMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = PurchaseReceiptSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'receipt_date', 'status', 'total_qty', 'total_amount', 'created_at']
    ordering = ['-receipt_date', '-id']

    def get_queryset(self):
        queryset = PurchaseReceipt.objects.select_related(
            'purchase_order',
            'purchase_order__supplier',
            'warehouse',
            'location',
            'posted_by',
            'cancelled_by',
        ).prefetch_related('lines', 'lines__product', 'lines__purchase_order_line')
        user = self.request.user
        if not getattr(user, 'is_superuser', False):
            if getattr(user, 'teams', None):
                team_ids = list(user.teams.values_list('id', flat=True))
                queryset = queryset.filter(
                    Q(purchase_order__owner=user)
                    | Q(purchase_order__team_id__in=team_ids)
                    | Q(purchase_order__owner__isnull=True)
                )
            else:
                queryset = queryset.filter(Q(purchase_order__owner=user) | Q(purchase_order__owner__isnull=True))

        status_value = (self.request.query_params.get('status') or '').strip()
        if status_value:
            queryset = queryset.filter(status=status_value)
        supplier_id = self.request.query_params.get('supplier')
        if supplier_id:
            queryset = queryset.filter(purchase_order__supplier_id=supplier_id)
        purchase_order_id = self.request.query_params.get('purchase_order')
        if purchase_order_id:
            queryset = queryset.filter(purchase_order_id=purchase_order_id)
        warehouse_id = self.request.query_params.get('warehouse')
        if warehouse_id:
            queryset = queryset.filter(warehouse_id=warehouse_id)
        receipt_date_from = self.request.query_params.get('receipt_date_from')
        if receipt_date_from:
            queryset = queryset.filter(receipt_date__gte=receipt_date_from)
        receipt_date_to = self.request.query_params.get('receipt_date_to')
        if receipt_date_to:
            queryset = queryset.filter(receipt_date__lte=receipt_date_to)
        return self.apply_search(queryset)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        receipt = self.get_object()
        if not can_cancel_purchase_receipt(request.user, receipt):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = (request.data.get('reason') or request.data.get('cancel_reason') or '').strip()
        if not reason:
            return Response({'error': 'Bắt buộc nhập lý do hủy phiếu nhập.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            locked_receipt = (
                PurchaseReceipt.objects.select_for_update()
                .select_related('purchase_order')
                .prefetch_related('lines', 'lines__purchase_order_line', 'lines__inventory_transaction')
                .get(pk=receipt.pk)
            )
            if locked_receipt.status != PurchaseReceiptStatus.POSTED:
                return Response({'error': 'Phiếu nhập không còn hiệu lực để hủy.'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                from finance.services import cancel_payable_for_purchase_receipt

                cancel_payable_for_purchase_receipt(locked_receipt, actor=request.user, reason=reason)
            except ValueError as exc:
                return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            for line in locked_receipt.lines.all():
                tx = getattr(line, 'inventory_transaction', None)
                if tx and tx.status != 'CANCELLED':
                    tx.status = 'CANCELLED'
                    tx.cancelled_at = timezone.now()
                    tx.cancelled_by = request.user
                    tx.cancel_reason = reason
                    tx.updated_by = request.user
                    tx.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_by', 'updated_at'])
                if line.purchase_order_line_id:
                    subtract_received_qty(line.purchase_order_line, line.quantity)

            locked_receipt.status = PurchaseReceiptStatus.CANCELLED
            locked_receipt.cancelled_at = timezone.now()
            locked_receipt.cancelled_by = request.user
            locked_receipt.cancel_reason = reason
            locked_receipt.updated_by = request.user
            locked_receipt.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_by', 'updated_at'])
            sync_purchase_order_receipt_status(locked_receipt.purchase_order)

        _log_procurement_audit(
            request,
            action='CANCEL',
            entity_type='PurchaseReceipt',
            entity_id=int(receipt.id),
            entity_code=receipt.code,
            old_values={'status': PurchaseReceiptStatus.POSTED},
            new_values={'status': PurchaseReceiptStatus.CANCELLED, 'reason': reason},
        )
        return Response({'status': PurchaseReceiptStatus.CANCELLED})

    @action(detail=True, methods=['get'])
    def lifecycle_history(self, request, pk=None):
        receipt = self.get_object()
        history = AuditLog.objects.filter(
            entity_type='PurchaseReceipt',
            entity_id=receipt.id,
        ).order_by('-created_at').select_related('user')
        return Response([_serialize_audit_timeline_item(item) for item in history])

    @action(detail=True, methods=['get'])
    def next_states(self, request, pk=None):
        receipt = self.get_object()
        mapping = {
            PurchaseReceiptStatus.POSTED: [PurchaseReceiptStatus.CANCELLED],
            PurchaseReceiptStatus.CANCELLED: [],
        }
        return Response({'current': receipt.status, 'next_states': mapping.get(receipt.status, [])})


class PurchaseRequestViewSet(viewsets.ModelViewSet):
    """Yêu cầu mua (Purchase Request) – CRUD."""
    serializer_class = PurchaseRequestSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter, filters.SearchFilter]
    search_fields = ['code', 'reference', 'notes']
    ordering_fields = ['code', 'request_date', 'status', 'created_at']
    ordering = ['-request_date', '-id']

    def get_queryset(self):
        qs = PurchaseRequest.objects.select_related(
            'requested_by', 'approved_by', 'rejected_by', 'created_by', 'updated_by',
        ).prefetch_related('lines', 'lines__product')
        if not _can_manage_procurement(self.request.user):
            raise PermissionDenied('Bạn không có quyền quản lý mua hàng.')
        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        date_gte = self.request.query_params.get('request_date__gte')
        date_lte = self.request.query_params.get('request_date__lte')
        if date_gte:
            qs = qs.filter(request_date__gte=date_gte)
        if date_lte:
            qs = qs.filter(request_date__lte=date_lte)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        if serializer.instance.status != PurchaseRequestStatus.DRAFT:
            raise PermissionDenied('Chỉ được sửa yêu cầu mua ở trạng thái Nháp.')
        serializer.save(updated_by=self.request.user)

    def perform_destroy(self, instance):
        if instance.status != PurchaseRequestStatus.DRAFT:
            raise PermissionDenied('Chỉ được xóa yêu cầu mua ở trạng thái Nháp.')
        instance.delete()

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """DRAFT -> SUBMITTED (gửi duyệt)."""
        pr = self.get_object()
        if pr.status != PurchaseRequestStatus.DRAFT:
            return Response({'error': 'Chỉ gửi duyệt yêu cầu ở trạng thái Nháp.'}, status=400)
        old_status = pr.status
        pr.status = PurchaseRequestStatus.SUBMITTED
        pr.requested_by = request.user
        pr.save(update_fields=['status', 'requested_by', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='PurchaseRequest',
            entity_id=pr.id,
            entity_code=pr.code,
            action='SUBMIT',
            user=request.user,
            level=1,
        )
        _log_procurement_audit(
            request,
            action='SUBMIT',
            entity_type='PurchaseRequest',
            entity_id=int(pr.id),
            entity_code=pr.code,
            old_values={'status': old_status},
            new_values={'status': pr.status},
        )
        return Response({'status': pr.status})

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """SUBMITTED -> APPROVED."""
        pr = self.get_object()
        if pr.status != PurchaseRequestStatus.SUBMITTED:
            return Response({'error': 'Chỉ duyệt yêu cầu đã gửi.'}, status=400)
        old_status = pr.status
        pr.status = PurchaseRequestStatus.APPROVED
        pr.approved_by = request.user
        pr.approved_at = timezone.now()
        pr.rejected_by = None
        pr.rejected_at = None
        pr.reject_reason = ''
        pr.save(update_fields=['status', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'reject_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='PurchaseRequest',
            entity_id=pr.id,
            entity_code=pr.code,
            action='APPROVE',
            user=request.user,
            level=1,
        )
        _log_procurement_audit(
            request,
            action='APPROVE',
            entity_type='PurchaseRequest',
            entity_id=int(pr.id),
            entity_code=pr.code,
            old_values={'status': old_status},
            new_values={'status': pr.status},
        )
        return Response({'status': pr.status})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """SUBMITTED -> REJECTED. Body: { reason }."""
        pr = self.get_object()
        if pr.status != PurchaseRequestStatus.SUBMITTED:
            return Response({'error': 'Chỉ từ chối yêu cầu đã gửi.'}, status=400)
        reason = (request.data.get('reason') or '').strip() or 'Từ chối'
        old_status = pr.status
        pr.status = PurchaseRequestStatus.REJECTED
        pr.rejected_by = request.user
        pr.rejected_at = timezone.now()
        pr.reject_reason = reason
        pr.approved_by = None
        pr.approved_at = None
        pr.save(update_fields=['status', 'rejected_by', 'rejected_at', 'reject_reason', 'approved_by', 'approved_at', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='PurchaseRequest',
            entity_id=pr.id,
            entity_code=pr.code,
            action='REJECT',
            user=request.user,
            comments=reason,
            level=1,
        )
        _log_procurement_audit(
            request,
            action='REJECT',
            entity_type='PurchaseRequest',
            entity_id=int(pr.id),
            entity_code=pr.code,
            old_values={'status': old_status},
            new_values={'status': pr.status, 'reason': reason},
        )
        return Response({'status': pr.status})

    @action(detail=True, methods=['get'])
    def approval_history(self, request, pk=None):
        pr = self.get_object()
        history = ApprovalHistory.objects.filter(
            entity_type='PurchaseRequest',
            entity_id=pr.id,
        ).order_by('-created_at').select_related('user')
        return Response([_serialize_approval_history_item(item) for item in history])


# Purchase Return ViewSet
from purchasing.serializers import PurchaseReturnSerializer


class PurchaseReturnViewSet(viewsets.ModelViewSet):
    """Purchase Returns to Supplier."""
    queryset = PurchaseReturn.objects.select_related('supplier', 'purchase_order')
    serializer_class = PurchaseReturnSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['code', 'reference', 'supplier__name']
    ordering_fields = ['return_date', 'status', 'created_at']
    ordering = ['-return_date']

    def get_queryset(self):
        qs = super().get_queryset()
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def submit_return(self, request, pk=None):
        """DRAFT -> SUBMITTED."""
        ret = self.get_object()
        if ret.status != PurchaseReturnStatus.DRAFT:
            return Response({'error': 'Chỉ gửi duyệt phiếu trả ở trạng thái Nháp.'}, status=400)
        previous_status = ret.status
        ret.status = PurchaseReturnStatus.SUBMITTED
        ret.submitted_by = request.user
        ret.submitted_at = timezone.now()
        ret.save(update_fields=['status', 'submitted_by', 'submitted_at', 'updated_at'])
        ApprovalHistory.objects.create(
            user=request.user,
            action='SUBMIT',
            entity_type='PurchaseReturn',
            entity_id=ret.id,
            comments='Gửi duyệt phiếu trả hàng',
        )
        _log_procurement_audit(
            request,
            action='SUBMIT',
            entity_type='PurchaseReturn',
            entity_id=int(ret.id),
            entity_code=ret.code,
            old_values={'status': previous_status},
            new_values={'status': ret.status},
        )
        return Response({'status': ret.status})

    @action(detail=True, methods=['post'])
    def approve_return(self, request, pk=None):
        """SUBMITTED -> APPROVED."""
        ret = self.get_object()
        if ret.status != PurchaseReturnStatus.SUBMITTED:
            return Response({'error': 'Chỉ duyệt phiếu trả đã gửi.'}, status=400)
        previous_status = ret.status
        ret.status = PurchaseReturnStatus.APPROVED
        ret.approved_by = request.user
        ret.approved_at = timezone.now()
        ret.save(update_fields=['status', 'approved_by', 'approved_at', 'updated_at'])
        ApprovalHistory.objects.create(
            user=request.user,
            action='APPROVE',
            entity_type='PurchaseReturn',
            entity_id=ret.id,
            comments='Duyệt phiếu trả hàng',
        )
        _log_procurement_audit(
            request,
            action='APPROVE',
            entity_type='PurchaseReturn',
            entity_id=int(ret.id),
            entity_code=ret.code,
            old_values={'status': previous_status},
            new_values={'status': ret.status},
        )
        generate_tasks_for_entity('PurchaseReturn', ret.id, ret.code, 'APPROVE', triggered_by=request.user)
        return Response({'status': ret.status})

    @action(detail=True, methods=['post'])
    def post_return(self, request, pk=None):
        """APPROVED -> POSTED (reverse inventory & AP)."""
        ret = self.get_object()
        if ret.status != PurchaseReturnStatus.APPROVED:
            return Response({'error': 'Chỉ post phiếu trả đã duyệt.'}, status=400)
        
        previous_status = ret.status

        with transaction.atomic():
            from inventory.serializers import InventoryTransactionSerializer
            from finance.models import PayableDocument, PayableStatus
            from finance.services import refresh_payable_status

            warehouse_id = getattr(ret.purchase_order, 'warehouse_id', None)
            location_id = getattr(ret.purchase_order, 'location_id', None)
            for line in ret.lines.all():
                if line.product:
                    if not warehouse_id:
                        raise ValidationError({'error': 'Thiếu kho nguồn để post phiếu trả hàng. Vui lòng khai báo kho trên đơn mua liên quan.'})
                    serializer = InventoryTransactionSerializer(data={
                        'transaction_type': 'ISSUE',
                        'transaction_date': ret.return_date,
                        'product': line.product_id,
                        'warehouse': warehouse_id,
                        'location': location_id,
                        'quantity': str(line.qty),
                        'unit_cost': str(line.unit_price or 0),
                        'reference': ret.code,
                        'reason': ret.return_reason,
                        'note': line.note or ret.return_notes or '',
                    })
                    serializer.is_valid(raise_exception=True)
                    serializer.save(
                        created_by=request.user,
                        updated_by=request.user,
                        posted_by=request.user,
                        purchase_order=ret.purchase_order,
                    )

            reduction_amount = Decimal(str(ret.total or 0))
            payable_qs = PayableDocument.objects.select_for_update().exclude(status=PayableStatus.CANCELLED)
            if ret.purchase_order_id:
                payable_qs = payable_qs.filter(source_purchase_receipt__purchase_order_id=ret.purchase_order_id)
            else:
                payable_qs = payable_qs.filter(supplier_id=ret.supplier_id)

            payable_docs = list(payable_qs.order_by('due_date', 'id'))
            if reduction_amount > 0:
                if not payable_docs:
                    raise ValidationError({'error': 'Không tìm thấy công nợ phải trả phù hợp để giảm khi post phiếu trả hàng.'})

                remaining_to_reduce = reduction_amount
                for payable in payable_docs:
                    total_amount = Decimal(str(payable.total_amount or 0))
                    settled_amount = Decimal(str(payable.settled_amount or 0))
                    reducible_amount = total_amount - settled_amount
                    if reducible_amount <= 0:
                        continue
                    applied = reducible_amount if reducible_amount <= remaining_to_reduce else remaining_to_reduce
                    if applied <= 0:
                        continue

                    old_total = total_amount
                    new_total = total_amount - applied
                    if old_total > 0:
                        ratio = new_total / old_total
                        payable.subtotal_amount = (Decimal(str(payable.subtotal_amount or 0)) * ratio).quantize(Decimal('0.01'))
                        payable.tax_amount = (Decimal(str(payable.tax_amount or 0)) * ratio).quantize(Decimal('0.01'))
                    payable.total_amount = new_total.quantize(Decimal('0.01'))
                    payable.reference = (payable.reference or '')[:200]
                    payable.note = ((payable.note or '').strip() + f'\n[Giảm tự động từ trả hàng {ret.code}] -{applied:,.2f}').strip()
                    payable.updated_by = request.user
                    payable.save(update_fields=['subtotal_amount', 'tax_amount', 'total_amount', 'note', 'updated_by', 'updated_at'])
                    if payable.total_amount <= 0 and settled_amount <= 0:
                        payable.status = PayableStatus.CANCELLED
                        payable.save(update_fields=['status', 'updated_at'])
                    else:
                        refresh_payable_status(payable, actor=request.user)

                    remaining_to_reduce -= applied
                    if remaining_to_reduce <= 0:
                        break

                if remaining_to_reduce > 0:
                    raise ValidationError({
                        'error': (
                            'Tổng công nợ phải trả khả dụng không đủ để giảm theo giá trị trả hàng. '
                            f'Còn chưa phân bổ: {remaining_to_reduce:,.2f}'
                        )
                    })
            
            ret.status = PurchaseReturnStatus.POSTED
            ret.posted_by = request.user
            ret.posted_at = timezone.now()
            ret.save(update_fields=['status', 'posted_by', 'posted_at', 'updated_at'])

        _log_procurement_audit(
            request,
            action='POST',
            entity_type='PurchaseReturn',
            entity_id=int(ret.id),
            entity_code=ret.code,
            old_values={'status': previous_status},
            new_values={
                'status': ret.status,
                'total_amount': str(ret.total or 0),
            },
        )

        return Response({'status': ret.status})

    @action(detail=True, methods=['post'])
    def cancel_return(self, request, pk=None):
        """Cancel return - any status -> CANCELLED."""
        ret = self.get_object()
        reason = (request.data.get('reason') or '').strip() or 'Hủy phiếu trả'
        previous_status = ret.status
        ret.status = PurchaseReturnStatus.CANCELLED
        ret.cancelled_by = request.user
        ret.cancelled_at = timezone.now()
        ret.cancel_reason = reason
        ret.save(update_fields=['status', 'cancelled_by', 'cancelled_at', 'cancel_reason', 'updated_at'])
        _log_procurement_audit(
            request,
            action='CANCEL',
            entity_type='PurchaseReturn',
            entity_id=int(ret.id),
            entity_code=ret.code,
            old_values={'status': previous_status},
            new_values={'status': ret.status, 'reason': reason},
        )
        return Response({'status': ret.status})

    @action(detail=True, methods=['get'])
    def approval_history(self, request, pk=None):
        ret = self.get_object()
        history = ApprovalHistory.objects.filter(
            entity_type='PurchaseReturn',
            entity_id=ret.id,
        ).select_related('user').order_by('-created_at')
        return Response([_serialize_approval_history_item(item) for item in history])

    @action(detail=True, methods=['get'])
    def lifecycle_history(self, request, pk=None):
        ret = self.get_object()
        history = AuditLog.objects.filter(
            entity_type='PurchaseReturn',
            entity_id=ret.id,
        ).order_by('-created_at').select_related('user')
        return Response([_serialize_audit_timeline_item(item) for item in history])

    @action(detail=True, methods=['get'])
    def next_states(self, request, pk=None):
        ret = self.get_object()
        mapping = {
            PurchaseReturnStatus.DRAFT: [PurchaseReturnStatus.SUBMITTED, PurchaseReturnStatus.CANCELLED],
            PurchaseReturnStatus.SUBMITTED: [PurchaseReturnStatus.APPROVED, PurchaseReturnStatus.CANCELLED],
            PurchaseReturnStatus.APPROVED: [PurchaseReturnStatus.POSTED, PurchaseReturnStatus.CANCELLED],
            PurchaseReturnStatus.POSTED: [],
            PurchaseReturnStatus.CANCELLED: [],
        }
        return Response({'current': ret.status, 'next_states': mapping.get(ret.status, [])})
