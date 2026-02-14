"""
ViewSet SalesOrder: CRUD, filter/search/ordering, data scope, workflow actions.
Permission matrix: EDIT chỉ Draft; POST chỉ role Finance; void bắt buộc lý do.
Performance: select_related/prefetch_related.
"""
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
import django_filters
from django.utils import timezone
from django.db.models import Q

from core.mixins import get_client_ip
from core.models import AuditLog, ApprovalHistory
from sales.models import SalesOrder, SalesOrderStatus
from sales.serializers import SalesOrderSerializer
from sales.filters import SalesOrderFilter
from sales.services import (
    get_next_sales_order_code,
    post_sales_order,
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
        ).prefetch_related('lines', 'lines__product')
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
        serializer.save(
            code=code,
            created_by=self.request.user,
            updated_by=self.request.user,
            owner=self.request.user,
        )

    def perform_update(self, serializer):
        if not can_edit_sales_order(self.request.user, serializer.instance):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Chỉ được sửa đơn ở trạng thái Nháp.')
        serializer.save(updated_by=self.request.user)

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
        return Response({'status': order.status})

    @action(detail=True, methods=['post'])
    def post_document(self, request, pk=None):
        """Post atomic + idempotent."""
        order = self.get_object()
        if not can_post_sales_order(request.user, order):
            return Response({'error': 'Không có quyền (cần role Finance) hoặc trạng thái không hợp lệ.'}, status=status.HTTP_403_FORBIDDEN)
        ok, msg = post_sales_order(order, request.user, request)
        if not ok:
            return Response({'error': msg}, status=status.HTTP_400_BAD_REQUEST)
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
        return Response({'status': order.status})

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
