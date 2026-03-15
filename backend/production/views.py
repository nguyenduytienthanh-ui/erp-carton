from datetime import date
from decimal import Decimal, InvalidOperation

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
from production.models import (
    ProductionIssue,
    ProductionIssueLine,
    ProductionIssueStatus,
    ProductionMaterialRequirement,
    ProductionOperation,
    ProductionOperationStatus,
    ProductionOrder,
    ProductionOrderStatus,
    ProductionReceipt,
    ProductionReceiptLine,
    ProductionReceiptStatus,
)
from production.permissions import (
    can_approve_production_order,
    can_cancel_production_issue,
    can_cancel_production_order,
    can_cancel_production_receipt,
    can_edit_production_order,
    can_issue_materials,
    can_manage_production,
    can_receive_output,
    can_reject_production_order,
    can_release_production_order,
    can_submit_production_order,
)
from production.serializers import (
    ProductionIssueSerializer,
    ProductionOrderSerializer,
    ProductionReceiptSerializer,
)
from production.services import (
    add_issued_qty,
    add_produced_qty,
    build_material_product_snapshot,
    get_next_production_issue_code,
    get_next_production_order_code,
    get_next_production_receipt_code,
    subtract_issued_qty,
    subtract_produced_qty,
    sync_production_order_status,
    update_operation_status,
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


def _can_manage_production(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'PRODUCTION', 'MANAGE', strict=True):
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


def _log_production_audit(request, *, action, entity_type, entity_id, entity_code, old_values, new_values):
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


class SearchTextMixin:
    search_text_field = 'search_text'

    def check_module_read_permission(self):
        if not _can_manage_production(self.request.user):
            raise PermissionDenied('Bạn không có quyền xem dữ liệu sản xuất.')

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


class ProductionOrderViewSet(SearchTextMixin, viewsets.ModelViewSet):
    serializer_class = ProductionOrderSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'order_date', 'planned_start_date', 'planned_end_date', 'status', 'planned_qty', 'produced_qty', 'created_at']
    ordering = ['-order_date', '-id']

    def get_queryset(self):
        queryset = ProductionOrder.objects.select_related(
            'sales_order',
            'sales_order_line',
            'product',
            'target_warehouse',
            'target_location',
            'submitted_by',
            'approved_by',
            'rejected_by',
            'released_by',
            'completed_by',
            'cancelled_by',
            'created_by',
            'updated_by',
            'owner',
            'team',
        ).prefetch_related(
            'operations',
            'material_requirements',
            'material_requirements__material_product',
            'issues',
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
        product_id = self.request.query_params.get('product')
        if product_id:
            queryset = queryset.filter(product_id=product_id)
        sales_order_id = self.request.query_params.get('sales_order')
        if sales_order_id:
            queryset = queryset.filter(sales_order_id=sales_order_id)
        order_date_from = self.request.query_params.get('order_date_from')
        if order_date_from:
            queryset = queryset.filter(order_date__gte=order_date_from)
        order_date_to = self.request.query_params.get('order_date_to')
        if order_date_to:
            queryset = queryset.filter(order_date__lte=order_date_to)
        planned_end_date_from = self.request.query_params.get('planned_end_date_from')
        if planned_end_date_from:
            queryset = queryset.filter(planned_end_date__gte=planned_end_date_from)
        planned_end_date_to = self.request.query_params.get('planned_end_date_to')
        if planned_end_date_to:
            queryset = queryset.filter(planned_end_date__lte=planned_end_date_to)
        has_overdue_plan = str(self.request.query_params.get('has_overdue_plan') or '').strip().lower() in {'1', 'true', 'yes'}
        if has_overdue_plan:
            queryset = queryset.filter(
                status__in=[ProductionOrderStatus.APPROVED, ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS],
                planned_end_date__lt=timezone.localdate(),
            )
        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_production(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo lệnh sản xuất.')
        order_date = serializer.validated_data.get('order_date') or timezone.localdate()
        code = get_next_production_order_code(order_date)
        order = serializer.save(
            code=code,
            created_by=self.request.user,
            updated_by=self.request.user,
            owner=self.request.user,
        )
        _log_production_audit(
            self.request,
            action='CREATE',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={},
            new_values={'status': order.status, 'product': order.product_id, 'planned_qty': str(order.planned_qty)},
        )

    def perform_update(self, serializer):
        if not can_edit_production_order(self.request.user, serializer.instance):
            raise PermissionDenied('Chỉ được sửa lệnh sản xuất ở trạng thái Nháp hoặc Từ chối.')
        previous = serializer.instance
        old_values = {
            'status': previous.status,
            'product': previous.product_id,
            'planned_qty': str(previous.planned_qty),
            'version': previous.version,
        }
        order = serializer.save(updated_by=self.request.user)
        _log_production_audit(
            self.request,
            action='UPDATE',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values=old_values,
            new_values={'status': order.status, 'product': order.product_id, 'planned_qty': str(order.planned_qty), 'version': order.version},
        )

    def destroy(self, request, *args, **kwargs):
        order = self.get_object()
        if order.status not in {ProductionOrderStatus.DRAFT, ProductionOrderStatus.REJECTED}:
            return Response({'error': 'Chỉ được xóa lệnh sản xuất ở trạng thái Nháp hoặc Từ chối.'}, status=status.HTTP_400_BAD_REQUEST)
        if order.issues.exclude(status=ProductionIssueStatus.CANCELLED).exists() or order.receipts.exclude(status=ProductionReceiptStatus.CANCELLED).exists():
            return Response({'error': 'Lệnh sản xuất đã phát sinh cấp vật tư hoặc nhập thành phẩm, không thể xóa.'}, status=status.HTTP_400_BAD_REQUEST)
        old_values = {'code': order.code, 'status': order.status}
        response = super().destroy(request, *args, **kwargs)
        _log_production_audit(
            request,
            action='DELETE',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values=old_values,
            new_values={},
        )
        return response

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        order = self.get_object()
        if not can_submit_production_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        old_status = order.status
        order.status = ProductionOrderStatus.SUBMITTED
        order.submitted_by = request.user
        order.submitted_at = timezone.now()
        order.approved_by = None
        order.approved_at = None
        order.rejected_by = None
        order.rejected_at = None
        order.reject_reason = ''
        order.save(update_fields=['status', 'submitted_by', 'submitted_at', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'reject_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='ProductionOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='SUBMIT',
            user=request.user,
            level=1,
        )
        _log_production_audit(
            request,
            action='SUBMIT',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status},
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'SUBMIT', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        order = self.get_object()
        if not can_approve_production_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        old_status = order.status
        order.status = ProductionOrderStatus.APPROVED
        order.approved_by = request.user
        order.approved_at = timezone.now()
        order.rejected_by = None
        order.rejected_at = None
        order.reject_reason = ''
        order.save(update_fields=['status', 'approved_by', 'approved_at', 'rejected_by', 'rejected_at', 'reject_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='ProductionOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='APPROVE',
            user=request.user,
            level=1,
        )
        _log_production_audit(
            request,
            action='APPROVE',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status},
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'APPROVE', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        order = self.get_object()
        if not can_reject_production_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': 'Bắt buộc nhập lý do từ chối.'}, status=status.HTTP_400_BAD_REQUEST)
        old_status = order.status
        order.status = ProductionOrderStatus.REJECTED
        order.rejected_by = request.user
        order.rejected_at = timezone.now()
        order.reject_reason = reason
        order.save(update_fields=['status', 'rejected_by', 'rejected_at', 'reject_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='ProductionOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='REJECT',
            user=request.user,
            comments=reason,
            level=1,
        )
        _log_production_audit(
            request,
            action='REJECT',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status, 'reason': reason},
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'REJECT', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def release(self, request, pk=None):
        order = self.get_object()
        if not can_release_production_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        old_status = order.status
        now = timezone.now()
        order.status = ProductionOrderStatus.RELEASED
        order.released_by = request.user
        order.released_at = now
        order.save(update_fields=['status', 'released_by', 'released_at', 'updated_at'])
        order.operations.filter(status=ProductionOperationStatus.PENDING).update(status=ProductionOperationStatus.READY, updated_at=now)
        _log_production_audit(
            request,
            action='RELEASE',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status},
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'RELEASE', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        order = self.get_object()
        if not can_cancel_production_order(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = (request.data.get('reason') or request.data.get('cancel_reason') or '').strip()
        if not reason:
            return Response({'error': 'Bắt buộc nhập lý do hủy lệnh sản xuất.'}, status=status.HTTP_400_BAD_REQUEST)
        if order.issues.exclude(status=ProductionIssueStatus.CANCELLED).exists() or order.receipts.exclude(status=ProductionReceiptStatus.CANCELLED).exists():
            return Response({'error': 'Lệnh sản xuất đã phát sinh cấp vật tư hoặc nhập thành phẩm, không thể hủy.'}, status=status.HTTP_400_BAD_REQUEST)
        old_status = order.status
        order.status = ProductionOrderStatus.CANCELLED
        order.cancelled_by = request.user
        order.cancelled_at = timezone.now()
        order.cancel_reason = reason
        order.save(update_fields=['status', 'cancelled_by', 'cancelled_at', 'cancel_reason', 'updated_at'])
        ApprovalHistory.objects.create(
            entity_type='ProductionOrder',
            entity_id=order.id,
            entity_code=order.code,
            action='REJECT',
            user=request.user,
            comments=reason,
            level=1,
        )
        _log_production_audit(
            request,
            action='CANCEL',
            entity_type='ProductionOrder',
            entity_id=int(order.id),
            entity_code=order.code,
            old_values={'status': old_status},
            new_values={'status': order.status, 'reason': reason},
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'CANCEL', triggered_by=request.user)
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def update_operation(self, request, pk=None):
        order = self.get_object()
        if order.status not in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}:
            return Response({'error': 'Chỉ lệnh đã phát lệnh hoặc đang làm mới được cập nhật công đoạn.'}, status=status.HTTP_400_BAD_REQUEST)
        operation_id = request.data.get('operation_id')
        if not operation_id:
            return Response({'error': 'Thiếu operation_id.'}, status=status.HTTP_400_BAD_REQUEST)
        operation = order.operations.filter(pk=operation_id).first()
        if not operation:
            return Response({'error': 'Không tìm thấy công đoạn thuộc lệnh này.'}, status=status.HTTP_404_NOT_FOUND)

        next_status = request.data.get('status') or operation.status
        if next_status not in dict(ProductionOperationStatus.CHOICES):
            return Response({'error': 'Trạng thái công đoạn không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        completed_qty = request.data.get('completed_qty')
        scrap_qty = request.data.get('scrap_qty')
        try:
            completed_qty_value = Decimal(str(completed_qty)) if completed_qty not in (None, '') else None
            scrap_qty_value = Decimal(str(scrap_qty)) if scrap_qty not in (None, '') else None
        except (InvalidOperation, TypeError, ValueError):
            return Response({'error': 'Số lượng hoàn thành/phế phẩm không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        old_status = operation.status
        update_operation_status(
            operation,
            status=next_status,
            completed_qty=completed_qty_value,
            scrap_qty=scrap_qty_value,
            note=(request.data.get('note') or operation.note or '').strip(),
        )
        sync_production_order_status(order, actor=request.user)
        _log_production_audit(
            request,
            action='UPDATE',
            entity_type='ProductionOperation',
            entity_id=int(operation.id),
            entity_code=f'{order.code}-OP{operation.sequence}',
            old_values={'status': old_status},
            new_values={'status': operation.status, 'completed_qty': str(operation.completed_qty), 'scrap_qty': str(operation.scrap_qty)},
        )
        return Response({
            'order_status': ProductionOrder.objects.get(pk=order.id).status,
            'operation': {
                'id': operation.id,
                'status': operation.status,
                'completed_qty': str(operation.completed_qty),
                'scrap_qty': str(operation.scrap_qty),
                'started_at': operation.started_at,
                'finished_at': operation.finished_at,
                'note': operation.note,
            },
        })

    @action(detail=True, methods=['post'])
    def issue_materials(self, request, pk=None):
        order = self.get_object()
        if not can_issue_materials(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)

        raw_items = request.data.get('items')
        if not isinstance(raw_items, list):
            raw_items = [request.data] if request.data.get('material_requirement') else []

        issue_date_raw = request.data.get('issue_date') or timezone.localdate().isoformat()
        try:
            issue_date_value = date.fromisoformat(str(issue_date_raw))
        except (TypeError, ValueError):
            return Response({'error': 'Ngày cấp vật tư không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        reference = str(request.data.get('reference') or order.code or '').strip()
        reason = str(request.data.get('reason') or 'Cấp vật tư cho sản xuất').strip()
        note = str(request.data.get('note') or '').strip()

        from inventory.serializers import InventoryTransactionSerializer

        with transaction.atomic():
            order_locked = ProductionOrder.objects.select_for_update().get(pk=order.pk)
            if order_locked.status not in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}:
                raise ValidationError({'error': 'Lệnh sản xuất hiện không thể cấp vật tư thêm.'})
            requirement_map = {
                item.id: item
                for item in ProductionMaterialRequirement.objects.select_for_update()
                .filter(production_order=order_locked)
                .select_related('material_product')
            }
            if not raw_items:
                raw_items = [
                    {
                        'material_requirement': requirement.id,
                        'quantity': str(requirement.remaining_issue_qty),
                        'warehouse': requirement.source_warehouse_id,
                        'location': requirement.source_location_id,
                        'unit_cost': str((requirement.product_snapshot or {}).get('cost_price') or 0),
                    }
                    for requirement in requirement_map.values()
                    if requirement.remaining_issue_qty > 0 and requirement.source_warehouse_id
                ]
            if not raw_items:
                raise ValidationError({'error': 'Không có vật tư khả dụng để cấp phát.'})

            issue = ProductionIssue.objects.create(
                code=get_next_production_issue_code(issue_date_value),
                production_order=order_locked,
                issue_date=issue_date_value,
                reference=reference,
                note=note,
                posted_by=request.user,
                created_by=request.user,
                updated_by=request.user,
            )
            seen_requirement_ids = set()
            for index, item in enumerate(raw_items, start=1):
                requirement_id = item.get('material_requirement')
                if not requirement_id:
                    raise ValidationError({'error': f'Dòng {index}: thiếu material_requirement.'})
                try:
                    requirement_id = int(requirement_id)
                except (TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: material_requirement không hợp lệ.'})
                if requirement_id in seen_requirement_ids:
                    raise ValidationError({'error': f'Dòng {index}: material_requirement bị lặp trong cùng chứng từ.'})
                seen_requirement_ids.add(requirement_id)
                requirement = requirement_map.get(requirement_id)
                if not requirement:
                    raise ValidationError({'error': f'Dòng {index}: yêu cầu vật tư không tồn tại.'})
                try:
                    quantity = Decimal(str(item.get('quantity') or requirement.remaining_issue_qty))
                except (InvalidOperation, TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: quantity không hợp lệ.'})
                if quantity <= 0:
                    raise ValidationError({'error': f'Dòng {index}: quantity phải > 0.'})
                if quantity > requirement.remaining_issue_qty:
                    raise ValidationError({'error': f'Dòng {index}: chỉ còn {requirement.remaining_issue_qty} để cấp, yêu cầu={quantity}.'})
                warehouse_id = item.get('warehouse') or requirement.source_warehouse_id
                location_id = item.get('location') or requirement.source_location_id
                if not warehouse_id:
                    raise ValidationError({'error': f'Dòng {index}: thiếu kho xuất vật tư.'})
                try:
                    unit_cost = Decimal(str(item.get('unit_cost') or (requirement.product_snapshot or {}).get('cost_price') or 0))
                except (InvalidOperation, TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: unit_cost không hợp lệ.'})

                serializer = InventoryTransactionSerializer(data={
                    'transaction_type': 'ISSUE',
                    'transaction_date': item.get('issue_date') or issue_date_raw,
                    'product': requirement.material_product_id,
                    'warehouse': warehouse_id,
                    'location': location_id,
                    'quantity': str(quantity),
                    'unit_cost': str(unit_cost),
                    'reference': str(item.get('reference') or reference).strip(),
                    'reason': str(item.get('reason') or reason).strip(),
                    'note': str(item.get('note') or '').strip(),
                })
                serializer.is_valid(raise_exception=True)
                inventory_tx = serializer.save(
                    created_by=request.user,
                    updated_by=request.user,
                    posted_by=request.user,
                    production_order=order_locked,
                    production_issue=issue,
                )
                ProductionIssueLine.objects.create(
                    issue=issue,
                    line_number=index,
                    material_requirement=requirement,
                    material_product=requirement.material_product,
                    product_snapshot=requirement.product_snapshot or build_material_product_snapshot(requirement.material_product),
                    warehouse_id=warehouse_id,
                    location_id=location_id,
                    quantity=quantity,
                    unit_cost=unit_cost,
                    note=str(item.get('note') or requirement.note or '').strip(),
                    inventory_transaction=inventory_tx,
                )
                add_issued_qty(requirement, quantity)
            issue.recalc_totals()
            sync_production_order_status(order_locked, actor=request.user)

        _log_production_audit(
            request,
            action='ISSUE',
            entity_type='ProductionIssue',
            entity_id=int(issue.id),
            entity_code=issue.code,
            old_values={},
            new_values={
                'production_order': order.id,
                'production_order_code': order.code,
                'status': issue.status,
                'total_qty': str(issue.total_qty),
                'total_amount': str(issue.total_amount),
            },
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'ISSUE', triggered_by=request.user)
        return Response(ProductionIssueSerializer(issue).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def receive_output(self, request, pk=None):
        order = self.get_object()
        if not can_receive_output(request.user, order):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)

        raw_items = request.data.get('items')
        if not isinstance(raw_items, list):
            raw_items = [request.data]

        receipt_date_raw = request.data.get('receipt_date') or timezone.localdate().isoformat()
        try:
            receipt_date_value = date.fromisoformat(str(receipt_date_raw))
        except (TypeError, ValueError):
            return Response({'error': 'Ngày nhập thành phẩm không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        warehouse_id = request.data.get('warehouse') or getattr(order, 'target_warehouse_id', None)
        location_id = request.data.get('location') or getattr(order, 'target_location_id', None)
        if not warehouse_id:
            return Response({'error': 'Thiếu kho nhập thành phẩm.'}, status=status.HTTP_400_BAD_REQUEST)
        reference = str(request.data.get('reference') or order.code or '').strip()
        reason = str(request.data.get('reason') or 'Nhập kho thành phẩm từ sản xuất').strip()
        note = str(request.data.get('note') or '').strip()

        from inventory.serializers import InventoryTransactionSerializer

        with transaction.atomic():
            order_locked = ProductionOrder.objects.select_for_update().get(pk=order.pk)
            if order_locked.status not in {ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS}:
                raise ValidationError({'error': 'Lệnh sản xuất hiện không thể nhập thành phẩm thêm.'})
            receipt = ProductionReceipt.objects.create(
                code=get_next_production_receipt_code(receipt_date_value),
                production_order=order_locked,
                receipt_date=receipt_date_value,
                reference=reference,
                warehouse_id=warehouse_id,
                location_id=location_id,
                note=note,
                posted_by=request.user,
                created_by=request.user,
                updated_by=request.user,
            )
            for index, item in enumerate(raw_items, start=1):
                try:
                    quantity = Decimal(str(item.get('quantity') or order_locked.remaining_qty))
                except (InvalidOperation, TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: quantity không hợp lệ.'})
                if quantity <= 0:
                    raise ValidationError({'error': f'Dòng {index}: quantity phải > 0.'})
                if quantity > order_locked.remaining_qty:
                    raise ValidationError({'error': f'Dòng {index}: chỉ còn {order_locked.remaining_qty} để nhập, yêu cầu={quantity}.'})
                product_id = item.get('product') or order_locked.product_id
                if int(product_id) != int(order_locked.product_id):
                    raise ValidationError({'error': f'Dòng {index}: chỉ được nhập đúng thành phẩm của lệnh sản xuất.'})
                try:
                    unit_cost = Decimal(str(item.get('unit_cost') or order_locked.unit_cost_estimate or 0))
                except (InvalidOperation, TypeError, ValueError):
                    raise ValidationError({'error': f'Dòng {index}: unit_cost không hợp lệ.'})

                serializer = InventoryTransactionSerializer(data={
                    'transaction_type': 'RECEIPT',
                    'transaction_date': item.get('receipt_date') or receipt_date_raw,
                    'product': order_locked.product_id,
                    'warehouse': warehouse_id,
                    'location': location_id,
                    'quantity': str(quantity),
                    'unit_cost': str(unit_cost),
                    'reference': str(item.get('reference') or reference).strip(),
                    'reason': str(item.get('reason') or reason).strip(),
                    'note': str(item.get('note') or '').strip(),
                })
                serializer.is_valid(raise_exception=True)
                inventory_tx = serializer.save(
                    created_by=request.user,
                    updated_by=request.user,
                    posted_by=request.user,
                    production_order=order_locked,
                    production_receipt=receipt,
                )
                ProductionReceiptLine.objects.create(
                    receipt=receipt,
                    line_number=index,
                    product=order_locked.product,
                    product_snapshot=order_locked.product_snapshot or {},
                    quantity=quantity,
                    unit_cost=unit_cost,
                    note=str(item.get('note') or '').strip(),
                    inventory_transaction=inventory_tx,
                )
                add_produced_qty(order_locked, quantity)
            receipt.recalc_totals()
            sync_production_order_status(order_locked, actor=request.user)

        _log_production_audit(
            request,
            action='RECEIVE',
            entity_type='ProductionReceipt',
            entity_id=int(receipt.id),
            entity_code=receipt.code,
            old_values={},
            new_values={
                'production_order': order.id,
                'production_order_code': order.code,
                'status': receipt.status,
                'total_qty': str(receipt.total_qty),
                'total_amount': str(receipt.total_amount),
            },
        )
        generate_tasks_for_entity('ProductionOrder', order.id, order.code, 'RECEIVE', triggered_by=request.user)
        return Response(ProductionReceiptSerializer(receipt).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def approval_history(self, request, pk=None):
        order = self.get_object()
        history = ApprovalHistory.objects.filter(
            entity_type='ProductionOrder',
            entity_id=order.id,
        ).order_by('-created_at').select_related('user')
        return Response([
            {
                'action': item.get_action_display(),
                'user': getattr(item.user, 'username', None),
                'comments': item.comments,
                'created_at': item.created_at,
            }
            for item in history
        ])

    @action(detail=True, methods=['get'])
    def issue_overview(self, request, pk=None):
        order = self.get_object()
        issues = order.issues.select_related('posted_by', 'cancelled_by').prefetch_related('lines', 'lines__material_product').order_by('-issue_date', '-id')
        return Response({'count': issues.count(), 'results': ProductionIssueSerializer(issues, many=True).data})

    @action(detail=True, methods=['get'])
    def receipt_overview(self, request, pk=None):
        order = self.get_object()
        receipts = order.receipts.select_related('warehouse', 'location').prefetch_related('lines', 'lines__product').order_by('-receipt_date', '-id')
        return Response({'count': receipts.count(), 'results': ProductionReceiptSerializer(receipts, many=True).data})

    @action(detail=True, methods=['get'])
    def next_states(self, request, pk=None):
        order = self.get_object()
        mapping = {
            ProductionOrderStatus.DRAFT: [ProductionOrderStatus.SUBMITTED, ProductionOrderStatus.CANCELLED],
            ProductionOrderStatus.SUBMITTED: [ProductionOrderStatus.APPROVED, ProductionOrderStatus.REJECTED, ProductionOrderStatus.CANCELLED],
            ProductionOrderStatus.APPROVED: [ProductionOrderStatus.RELEASED, ProductionOrderStatus.CANCELLED],
            ProductionOrderStatus.REJECTED: [ProductionOrderStatus.SUBMITTED, ProductionOrderStatus.CANCELLED],
            ProductionOrderStatus.RELEASED: [ProductionOrderStatus.IN_PROGRESS, ProductionOrderStatus.COMPLETED],
            ProductionOrderStatus.IN_PROGRESS: [ProductionOrderStatus.COMPLETED],
            ProductionOrderStatus.COMPLETED: [],
            ProductionOrderStatus.CANCELLED: [],
        }
        return Response({'current': order.status, 'next_states': mapping.get(order.status, [])})

    @action(detail=False, methods=['get'])
    def summary(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        today = timezone.localdate()
        active_qs = queryset.filter(status__in=[ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS])
        planned_total_active = Decimal(str(active_qs.aggregate(total=Sum('planned_qty')).get('total') or 0))
        produced_total_active = Decimal(str(active_qs.aggregate(total=Sum('produced_qty')).get('total') or 0))
        ready_operations = ProductionOperation.objects.filter(
            production_order_id__in=active_qs.values('id'),
            status=ProductionOperationStatus.READY,
        ).count()
        return Response({
            'total_orders': int(queryset.count()),
            'draft_count': int(queryset.filter(status=ProductionOrderStatus.DRAFT).count()),
            'submitted_count': int(queryset.filter(status=ProductionOrderStatus.SUBMITTED).count()),
            'approved_count': int(queryset.filter(status=ProductionOrderStatus.APPROVED).count()),
            'released_count': int(queryset.filter(status=ProductionOrderStatus.RELEASED).count()),
            'in_progress_count': int(queryset.filter(status=ProductionOrderStatus.IN_PROGRESS).count()),
            'completed_count': int(queryset.filter(status=ProductionOrderStatus.COMPLETED).count()),
            'cancelled_count': int(queryset.filter(status=ProductionOrderStatus.CANCELLED).count()),
            'pending_approval_count': int(queryset.filter(status=ProductionOrderStatus.SUBMITTED).count()),
            'active_count': int(active_qs.count()),
            'overdue_plan_count': int(queryset.filter(status__in=[ProductionOrderStatus.APPROVED, ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS], planned_end_date__lt=today).count()),
            'active_remaining_qty': str(planned_total_active - produced_total_active if planned_total_active > produced_total_active else Decimal('0')),
            'ready_operation_count': int(ready_operations),
        })


class ProductionIssueViewSet(SearchTextMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = ProductionIssueSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'issue_date', 'status', 'total_qty', 'total_amount', 'created_at']
    ordering = ['-issue_date', '-id']

    def get_queryset(self):
        queryset = ProductionIssue.objects.select_related(
            'production_order',
            'production_order__product',
            'posted_by',
            'cancelled_by',
        ).prefetch_related('lines', 'lines__material_product', 'lines__warehouse', 'lines__location')
        user = self.request.user
        if not getattr(user, 'is_superuser', False):
            if getattr(user, 'teams', None):
                team_ids = list(user.teams.values_list('id', flat=True))
                queryset = queryset.filter(
                    Q(production_order__owner=user)
                    | Q(production_order__team_id__in=team_ids)
                    | Q(production_order__owner__isnull=True)
                )
            else:
                queryset = queryset.filter(Q(production_order__owner=user) | Q(production_order__owner__isnull=True))
        status_value = (self.request.query_params.get('status') or '').strip()
        if status_value:
            queryset = queryset.filter(status=status_value)
        production_order_id = self.request.query_params.get('production_order')
        if production_order_id:
            queryset = queryset.filter(production_order_id=production_order_id)
        return self.apply_search(queryset)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        issue = self.get_object()
        if not can_cancel_production_issue(request.user, issue):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = (request.data.get('reason') or request.data.get('cancel_reason') or '').strip()
        if not reason:
            return Response({'error': 'Bắt buộc nhập lý do hủy cấp vật tư.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            locked_issue = (
                ProductionIssue.objects.select_for_update()
                .select_related('production_order')
                .prefetch_related('lines', 'lines__material_requirement', 'lines__inventory_transaction')
                .get(pk=issue.pk)
            )
            if locked_issue.status != ProductionIssueStatus.POSTED:
                return Response({'error': 'Chứng từ cấp vật tư không còn hiệu lực để hủy.'}, status=status.HTTP_400_BAD_REQUEST)
            for line in locked_issue.lines.all():
                tx = getattr(line, 'inventory_transaction', None)
                if tx and tx.status != 'CANCELLED':
                    tx.status = 'CANCELLED'
                    tx.cancelled_at = timezone.now()
                    tx.cancelled_by = request.user
                    tx.cancel_reason = reason
                    tx.updated_by = request.user
                    tx.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_by', 'updated_at'])
                if line.material_requirement_id:
                    subtract_issued_qty(line.material_requirement, line.quantity)
            locked_issue.status = ProductionIssueStatus.CANCELLED
            locked_issue.cancelled_at = timezone.now()
            locked_issue.cancelled_by = request.user
            locked_issue.cancel_reason = reason
            locked_issue.updated_by = request.user
            locked_issue.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_by', 'updated_at'])
            sync_production_order_status(locked_issue.production_order, actor=request.user)

        _log_production_audit(
            request,
            action='CANCEL',
            entity_type='ProductionIssue',
            entity_id=int(issue.id),
            entity_code=issue.code,
            old_values={'status': ProductionIssueStatus.POSTED},
            new_values={'status': ProductionIssueStatus.CANCELLED, 'reason': reason},
        )
        return Response({'status': ProductionIssueStatus.CANCELLED})


class ProductionReceiptViewSet(SearchTextMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = ProductionReceiptSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'receipt_date', 'status', 'total_qty', 'total_amount', 'created_at']
    ordering = ['-receipt_date', '-id']

    def get_queryset(self):
        queryset = ProductionReceipt.objects.select_related(
            'production_order',
            'production_order__product',
            'warehouse',
            'location',
            'posted_by',
            'cancelled_by',
        ).prefetch_related('lines', 'lines__product')
        user = self.request.user
        if not getattr(user, 'is_superuser', False):
            if getattr(user, 'teams', None):
                team_ids = list(user.teams.values_list('id', flat=True))
                queryset = queryset.filter(
                    Q(production_order__owner=user)
                    | Q(production_order__team_id__in=team_ids)
                    | Q(production_order__owner__isnull=True)
                )
            else:
                queryset = queryset.filter(Q(production_order__owner=user) | Q(production_order__owner__isnull=True))
        status_value = (self.request.query_params.get('status') or '').strip()
        if status_value:
            queryset = queryset.filter(status=status_value)
        production_order_id = self.request.query_params.get('production_order')
        if production_order_id:
            queryset = queryset.filter(production_order_id=production_order_id)
        return self.apply_search(queryset)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        receipt = self.get_object()
        if not can_cancel_production_receipt(request.user, receipt):
            return Response({'error': 'Không có quyền hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        reason = (request.data.get('reason') or request.data.get('cancel_reason') or '').strip()
        if not reason:
            return Response({'error': 'Bắt buộc nhập lý do hủy nhập thành phẩm.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            locked_receipt = (
                ProductionReceipt.objects.select_for_update()
                .select_related('production_order')
                .prefetch_related('lines', 'lines__inventory_transaction')
                .get(pk=receipt.pk)
            )
            if locked_receipt.status != ProductionReceiptStatus.POSTED:
                return Response({'error': 'Phiếu nhập thành phẩm không còn hiệu lực để hủy.'}, status=status.HTTP_400_BAD_REQUEST)
            for line in locked_receipt.lines.all():
                tx = getattr(line, 'inventory_transaction', None)
                if tx and tx.status != 'CANCELLED':
                    tx.status = 'CANCELLED'
                    tx.cancelled_at = timezone.now()
                    tx.cancelled_by = request.user
                    tx.cancel_reason = reason
                    tx.updated_by = request.user
                    tx.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_by', 'updated_at'])
                subtract_produced_qty(locked_receipt.production_order, line.quantity)
            locked_receipt.status = ProductionReceiptStatus.CANCELLED
            locked_receipt.cancelled_at = timezone.now()
            locked_receipt.cancelled_by = request.user
            locked_receipt.cancel_reason = reason
            locked_receipt.updated_by = request.user
            locked_receipt.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_by', 'updated_at'])
            sync_production_order_status(locked_receipt.production_order, actor=request.user)

        _log_production_audit(
            request,
            action='CANCEL',
            entity_type='ProductionReceipt',
            entity_id=int(receipt.id),
            entity_code=receipt.code,
            old_values={'status': ProductionReceiptStatus.POSTED},
            new_values={'status': ProductionReceiptStatus.CANCELLED, 'reason': reason},
        )
        return Response({'status': ProductionReceiptStatus.CANCELLED})
