from decimal import Decimal
from datetime import date
import json

from django.db import transaction
from django.db.models import Q, Sum
from django.http import HttpResponse
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from unidecode import unidecode
from openpyxl import Workbook

from core.permissions import check_action_permission
from core.models import AuditLog, Notification, Setting
from workforce.models import PayrollRecord

from .models import (
    AdvanceSettlement,
    AdvanceTransaction,
    BankAccount,
    CashAccount,
    CashTransaction,
    TransactionCategory,
)
from .reminders import (
    REMINDER_POLICY_SETTING_KEY,
    get_reminder_policy,
    get_reminder_policy_presets,
    run_daily_overdue_reminder_job,
    save_reminder_policy,
)
from .serializers import (
    AdvanceSettlementSerializer,
    AdvanceTransactionSerializer,
    BankAccountSerializer,
    CashAccountSerializer,
    CashTransactionSerializer,
    TransactionCategorySerializer,
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


def _can_manage_finance(user):
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'FINANCE', 'MANAGE', strict=True):
        return True
    role_names = _user_role_names(user)
    allowed_roles = {
        'admin',
        'manager',
        'accountant',
        'finance',
        'finance-manager',
        'quan-ly',
        'quanly',
    }
    return any(role in allowed_roles for role in role_names)


FINANCE_LOCKED_MONTHS_KEY = 'FINANCE_LOCKED_MONTHS'


def _normalize_month(value: str) -> str:
    raw = (value or '').strip()
    if len(raw) != 7 or '-' not in raw:
        return ''
    y, m = raw.split('-', 1)
    if not (y.isdigit() and m.isdigit()):
        return ''
    y_int = int(y)
    m_int = int(m)
    if y_int < 2000 or y_int > 3000 or m_int < 1 or m_int > 12:
        return ''
    return f'{y_int}-{str(m_int).zfill(2)}'


def _month_from_date_obj(value) -> str:
    if not value:
        return ''
    try:
        return f'{value.year}-{str(value.month).zfill(2)}'
    except Exception:
        return ''


def _get_locked_finance_months() -> set[str]:
    row = Setting.objects.filter(key=FINANCE_LOCKED_MONTHS_KEY, is_active=True).first()
    if not row:
        return set()
    try:
        parsed = json.loads(str(row.value or '{}'))
    except Exception:
        return set()
    months = parsed.get('months') if isinstance(parsed, dict) else []
    if not isinstance(months, list):
        return set()
    return {m for m in (_normalize_month(str(item)) for item in months) if m}


def _save_locked_finance_months(months: set[str]):
    payload = json.dumps({'months': sorted(months)})
    Setting.objects.update_or_create(
        key=FINANCE_LOCKED_MONTHS_KEY,
        defaults={
            'value': payload,
            'data_type': 'json',
            'description': 'Danh sách tháng tài chính đã khóa (YYYY-MM)',
            'is_active': True,
        },
    )


def _ensure_finance_month_unlocked(month: str, message: str):
    normalized = _normalize_month(month)
    if not normalized:
        return
    if normalized in _get_locked_finance_months():
        raise PermissionDenied(message)


class SearchTextMixin:
    search_text_field = 'search_text'

    def apply_search(self, queryset):
        search_raw = (self.request.query_params.get('q') or self.request.query_params.get('search') or '').strip()
        if not search_raw:
            return queryset

        normalized = unidecode(search_raw).lower().strip()
        exact_search = self.request.query_params.get('exact_search') in ('1', 'true', 'True')
        field_name = self.search_text_field

        if exact_search:
            query = Q(**{f'{field_name}__icontains': normalized})
            if search_raw != normalized:
                query |= Q(**{f'{field_name}__icontains': search_raw})
            return queryset.filter(query).distinct()

        tokens = [token for token in normalized.split() if token]
        if not tokens:
            return queryset

        query = Q(**{f'{field_name}__icontains': tokens[0]})
        for token in tokens[1:]:
            query &= Q(**{f'{field_name}__icontains': token})
        return queryset.filter(query).distinct()


class TransactionCategoryViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = TransactionCategory.objects.all()
    serializer_class = TransactionCategorySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'name', 'category_type', 'created_at']
    ordering = ['code']

    def get_queryset(self):
        queryset = super().get_queryset()
        category_type = (self.request.query_params.get('category_type') or '').strip()
        if category_type:
            queryset = queryset.filter(category_type=category_type)
        is_active = self.request.query_params.get('is_active')
        if is_active in ('true', 'false'):
            queryset = queryset.filter(is_active=(is_active == 'true'))
        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo loại thu chi.')
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật loại thu chi.')
        serializer.save(updated_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xóa loại thu chi.'}, status=403)
        return super().destroy(request, *args, **kwargs)


class BankAccountViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = BankAccount.objects.all()
    serializer_class = BankAccountSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'account_number', 'bank_name', 'created_at']
    ordering = ['code']

    def get_queryset(self):
        queryset = super().get_queryset()
        is_active = self.request.query_params.get('is_active')
        if is_active in ('true', 'false'):
            queryset = queryset.filter(is_active=(is_active == 'true'))
        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo tài khoản ngân hàng.')
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật tài khoản ngân hàng.')
        serializer.save(updated_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xóa tài khoản ngân hàng.'}, status=403)
        return super().destroy(request, *args, **kwargs)


class CashAccountViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = CashAccount.objects.all()
    serializer_class = CashAccountSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['name', 'account_type', 'balance', 'created_at']
    ordering = ['name']

    def get_queryset(self):
        queryset = super().get_queryset()
        account_type = (self.request.query_params.get('account_type') or '').strip()
        if account_type:
            queryset = queryset.filter(account_type=account_type)
        is_active = self.request.query_params.get('is_active')
        if is_active in ('true', 'false'):
            queryset = queryset.filter(is_active=(is_active == 'true'))
        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo tài khoản quỹ.')
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật tài khoản quỹ.')
        serializer.save(updated_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xóa tài khoản quỹ.'}, status=403)
        return super().destroy(request, *args, **kwargs)


class CashTransactionViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = CashTransaction.objects.select_related(
        'category',
        'source_cash_account',
        'source_bank_account',
        'target_cash_account',
    )
    serializer_class = CashTransactionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['transaction_date', 'amount', 'transaction_type', 'created_at']
    ordering = ['-transaction_date', '-id']

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        transaction_type = (params.get('transaction_type') or '').strip()
        if transaction_type:
            queryset = queryset.filter(transaction_type=transaction_type)

        source_type = (params.get('source_type') or '').strip()
        if source_type:
            queryset = queryset.filter(source_type=source_type)

        source_cash_account = (params.get('source_cash_account') or '').strip()
        if source_cash_account.isdigit():
            queryset = queryset.filter(source_cash_account_id=int(source_cash_account))

        month = (params.get('month') or '').strip()
        if len(month) == 7 and '-' in month:
            year_str, month_str = month.split('-', 1)
            if year_str.isdigit() and month_str.isdigit():
                queryset = queryset.filter(
                    transaction_date__year=int(year_str),
                    transaction_date__month=int(month_str),
                )

        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo giao dịch tài chính.')
        tx_date = serializer.validated_data.get('transaction_date')
        _ensure_finance_month_unlocked(
            _month_from_date_obj(tx_date),
            'Tháng tài chính đã khóa, không thể thêm giao dịch.',
        )
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật giao dịch tài chính.')
        tx_date = serializer.validated_data.get('transaction_date', serializer.instance.transaction_date)
        _ensure_finance_month_unlocked(
            _month_from_date_obj(tx_date),
            'Tháng tài chính đã khóa, không thể cập nhật giao dịch.',
        )
        serializer.save()

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xóa giao dịch tài chính.'}, status=403)
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'No IDs provided'}, status=400)
        locked_months = _get_locked_finance_months()
        if locked_months:
            txs = CashTransaction.objects.filter(id__in=ids)
            for tx in txs:
                month = _month_from_date_obj(tx.transaction_date)
                if month in locked_months:
                    return Response({'error': f'Tháng {month} đã khóa, không thể xóa giao dịch.'}, status=400)
        deleted_count, _ = CashTransaction.objects.filter(id__in=ids).delete()
        return Response({'success': True, 'count': deleted_count})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xóa giao dịch tài chính.'}, status=403)
        instance = self.get_object()
        _ensure_finance_month_unlocked(
            _month_from_date_obj(instance.transaction_date),
            'Tháng tài chính đã khóa, không thể xóa giao dịch.',
        )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'])
    def locked_months(self, request):
        months = sorted(_get_locked_finance_months())
        return Response({'months': months})

    @action(detail=False, methods=['post'])
    def lock_month(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền khóa sổ tài chính.'}, status=403)
        month = _normalize_month(str(request.data.get('month') or ''))
        if not month:
            return Response({'error': 'month phải có dạng YYYY-MM'}, status=400)
        months = _get_locked_finance_months()
        months.add(month)
        _save_locked_finance_months(months)
        return Response({'success': True, 'months': sorted(months)})

    @action(detail=False, methods=['post'])
    def unlock_month(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền mở khóa sổ tài chính.'}, status=403)
        month = _normalize_month(str(request.data.get('month') or ''))
        if not month:
            return Response({'error': 'month phải có dạng YYYY-MM'}, status=400)
        months = _get_locked_finance_months()
        months.discard(month)
        _save_locked_finance_months(months)
        return Response({'success': True, 'months': sorted(months)})

    @action(detail=False, methods=['get'])
    def payroll_reconciliation(self, request):
        month = _normalize_month(str(request.query_params.get('month') or ''))
        if not month:
            return Response({'error': 'month phải có dạng YYYY-MM'}, status=400)

        payroll_qs = PayrollRecord.objects.filter(month=month, status=PayrollRecord.STATUS_LOCKED)
        payroll_total = Decimal(str(payroll_qs.aggregate(total=Sum('net_pay')).get('total') or 0))
        payroll_count = payroll_qs.count()

        y, m = month.split('-', 1)
        tx_qs = CashTransaction.objects.filter(
            transaction_type=CashTransaction.TYPE_EXPENSE,
            transaction_date__year=int(y),
            transaction_date__month=int(m),
            reason__icontains='[PAYROLL:',
        )
        posted_total = Decimal(str(tx_qs.aggregate(total=Sum('amount')).get('total') or 0))
        posted_count = tx_qs.count()
        delta = payroll_total - posted_total

        return Response({
            'month': month,
            'payroll_total': str(payroll_total),
            'payroll_count': payroll_count,
            'posted_total': str(posted_total),
            'posted_count': posted_count,
            'delta': str(delta),
            'is_balanced': delta == 0,
        })

    @action(detail=False, methods=['get'])
    def monthly_summary(self, request):
        month = (request.query_params.get('month') or '').strip()
        if len(month) != 7 or '-' not in month:
            return Response({'error': 'month phải có dạng YYYY-MM'}, status=400)
        year_str, month_str = month.split('-', 1)
        if not (year_str.isdigit() and month_str.isdigit()):
            return Response({'error': 'month phải có dạng YYYY-MM'}, status=400)
        year = int(year_str)
        month_num = int(month_str)
        if month_num < 1 or month_num > 12:
            return Response({'error': 'month không hợp lệ'}, status=400)

        tx_qs = CashTransaction.objects.filter(
            transaction_date__year=year,
            transaction_date__month=month_num,
        )
        total_income = Decimal(str(
            tx_qs.filter(transaction_type=CashTransaction.TYPE_INCOME).aggregate(total=Sum('amount')).get('total') or 0
        ))
        total_expense = Decimal(str(
            tx_qs.filter(transaction_type=CashTransaction.TYPE_EXPENSE).aggregate(total=Sum('amount')).get('total') or 0
        ))
        total_transfer = Decimal(str(
            tx_qs.filter(transaction_type=CashTransaction.TYPE_TRANSFER).aggregate(total=Sum('amount')).get('total') or 0
        ))

        advance_qs = AdvanceTransaction.objects.filter(
            advance_date__year=year,
            advance_date__month=month_num,
            is_active=True,
        )
        total_advance = Decimal(str(advance_qs.aggregate(total=Sum('amount')).get('total') or 0))

        settlement_qs = AdvanceSettlement.objects.filter(
            settlement_date__year=year,
            settlement_date__month=month_num,
        )
        total_settlement_spent = Decimal(str(settlement_qs.aggregate(total=Sum('spent_amount')).get('total') or 0))
        total_settlement_refund = Decimal(str(settlement_qs.aggregate(total=Sum('refund_amount')).get('total') or 0))

        data = {
            'month': month,
            'total_income': str(total_income),
            'total_expense': str(total_expense),
            'total_transfer': str(total_transfer),
            'cash_delta': str(total_income - total_expense),
            'total_advance': str(total_advance),
            'total_settlement_spent': str(total_settlement_spent),
            'total_settlement_refund': str(total_settlement_refund),
            'advance_net_delta': str(total_advance - total_settlement_spent - total_settlement_refund),
            'transactions_count': tx_qs.count(),
            'advances_count': advance_qs.count(),
            'settlements_count': settlement_qs.count(),
        }

        if request.query_params.get('export') == 'excel':
            wb = Workbook()
            ws = wb.active
            ws.title = f'BaoCao-{month}'
            ws.append(['Chỉ tiêu', 'Giá trị'])
            ws.append(['Tháng', month])
            ws.append(['Tổng thu', float(total_income)])
            ws.append(['Tổng chi', float(total_expense)])
            ws.append(['Tổng chuyển', float(total_transfer)])
            ws.append(['Chênh lệch thu-chi', float(total_income - total_expense)])
            ws.append(['Tổng tạm ứng', float(total_advance)])
            ws.append(['Tổng chi quyết toán', float(total_settlement_spent)])
            ws.append(['Tổng hoàn ứng', float(total_settlement_refund)])
            ws.append(['Chênh lệch tạm ứng', float(total_advance - total_settlement_spent - total_settlement_refund)])
            ws.append(['Số giao dịch', tx_qs.count()])
            ws.append(['Số phiếu tạm ứng', advance_qs.count()])
            ws.append(['Số phiếu quyết toán', settlement_qs.count()])

            response = HttpResponse(
                content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
            response['Content-Disposition'] = f'attachment; filename="bao_cao_tai_chinh_{month}.xlsx"'
            wb.save(response)
            return response

        return Response(data)

    @action(detail=False, methods=['get'])
    def trend_12m(self, request):
        end_month = (request.query_params.get('end_month') or '').strip()
        if not end_month:
            today = date.today()
            end_year = today.year
            end_month_num = today.month
            end_month = f'{end_year}-{str(end_month_num).zfill(2)}'
        else:
            if len(end_month) != 7 or '-' not in end_month:
                return Response({'error': 'end_month phải có dạng YYYY-MM'}, status=400)
            y, m = end_month.split('-', 1)
            if not (y.isdigit() and m.isdigit()):
                return Response({'error': 'end_month phải có dạng YYYY-MM'}, status=400)
            end_year = int(y)
            end_month_num = int(m)
            if end_month_num < 1 or end_month_num > 12:
                return Response({'error': 'end_month không hợp lệ'}, status=400)

        months: list[tuple[int, int, str]] = []
        y = end_year
        m = end_month_num
        for _ in range(12):
            months.append((y, m, f'{y}-{str(m).zfill(2)}'))
            m -= 1
            if m == 0:
                y -= 1
                m = 12
        months.reverse()

        items = []
        for y_item, m_item, month_key in months:
            tx_qs = CashTransaction.objects.filter(
                transaction_date__year=y_item,
                transaction_date__month=m_item,
            )
            total_income = Decimal(str(
                tx_qs.filter(transaction_type=CashTransaction.TYPE_INCOME).aggregate(total=Sum('amount')).get('total') or 0
            ))
            total_expense = Decimal(str(
                tx_qs.filter(transaction_type=CashTransaction.TYPE_EXPENSE).aggregate(total=Sum('amount')).get('total') or 0
            ))

            advance_qs = AdvanceTransaction.objects.filter(
                advance_date__year=y_item,
                advance_date__month=m_item,
                is_active=True,
            )
            total_advance = Decimal(str(advance_qs.aggregate(total=Sum('amount')).get('total') or 0))

            settlement_qs = AdvanceSettlement.objects.filter(
                settlement_date__year=y_item,
                settlement_date__month=m_item,
            )
            total_settlement_spent = Decimal(str(settlement_qs.aggregate(total=Sum('spent_amount')).get('total') or 0))
            total_settlement_refund = Decimal(str(settlement_qs.aggregate(total=Sum('refund_amount')).get('total') or 0))

            items.append({
                'month': month_key,
                'total_income': str(total_income),
                'total_expense': str(total_expense),
                'cash_delta': str(total_income - total_expense),
                'total_advance': str(total_advance),
                'total_settlement_spent': str(total_settlement_spent),
                'total_settlement_refund': str(total_settlement_refund),
                'advance_net_delta': str(total_advance - total_settlement_spent - total_settlement_refund),
            })

        return Response({'end_month': end_month, 'items': items})


def refresh_advance_status(advance: AdvanceTransaction, user):
    totals = advance.settlements.aggregate(
        spent_total=Sum('spent_amount'),
        refund_total=Sum('refund_amount'),
    )
    spent_total = Decimal(str(totals.get('spent_total') or 0))
    refund_total = Decimal(str(totals.get('refund_total') or 0))
    handled_total = spent_total + refund_total
    amount = Decimal(str(advance.amount or 0))

    if advance.status == AdvanceTransaction.STATUS_CANCELLED:
        return
    if handled_total <= 0:
        new_status = AdvanceTransaction.STATUS_OPEN
    elif handled_total < amount:
        new_status = AdvanceTransaction.STATUS_PARTIAL
    else:
        new_status = AdvanceTransaction.STATUS_SETTLED
    if advance.status != new_status:
        advance.status = new_status
        advance.updated_by = user
        advance.save(update_fields=['status', 'updated_by', 'updated_at', 'search_text'])


def _recommend_reminder_policy_preset() -> dict:
    presets = get_reminder_policy_presets()
    cutoff = date.today().fromordinal(date.today().toordinal() - 30)
    qs = Notification.objects.filter(
        notification_type='due_date',
        entity_type='FinanceAdvanceOverdueDaily',
        created_at__date__gte=cutoff,
    )
    total_sent = int(qs.count() or 0)
    total_unread = int(qs.filter(is_read=False).count() or 0)
    unread_rate = round((total_unread / total_sent) * 100, 2) if total_sent > 0 else 0

    recommended_key = 'balanced'
    reason = 'Dữ liệu ổn định, ưu tiên cân bằng tần suất và độ phủ nhắc.'
    if total_sent < 10:
        recommended_key = 'balanced'
        reason = 'Dữ liệu lịch sử còn ít, ưu tiên preset cân bằng.'
    elif unread_rate >= 55:
        recommended_key = 'conservative'
        reason = 'Tỷ lệ chưa đọc cao, nên giảm tần suất để tránh quá tải thông báo.'
    elif unread_rate <= 20 and total_sent >= 20:
        recommended_key = 'aggressive'
        reason = 'Tỷ lệ đọc cao, có thể tăng tần suất để bám sát xử lý quá hạn.'

    return {
        'recommended_preset_key': recommended_key,
        'reason': reason,
        'metrics': {
            'total_sent_30d': total_sent,
            'total_unread_30d': total_unread,
            'unread_rate_30d': unread_rate,
        },
        'preset': dict(presets.get(recommended_key) or {}),
    }


class AdvanceTransactionViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = AdvanceTransaction.objects.select_related('source_cash_account', 'source_bank_account')
    serializer_class = AdvanceTransactionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['advance_date', 'code', 'amount', 'status', 'created_at']
    ordering = ['-advance_date', '-id']

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        advance_type = (params.get('advance_type') or '').strip()
        if advance_type:
            queryset = queryset.filter(advance_type=advance_type)

        status_param = (params.get('status') or '').strip()
        if status_param:
            queryset = queryset.filter(status=status_param)

        month = (params.get('month') or '').strip()
        if len(month) == 7 and '-' in month:
            year_str, month_str = month.split('-', 1)
            if year_str.isdigit() and month_str.isdigit():
                queryset = queryset.filter(
                    advance_date__year=int(year_str),
                    advance_date__month=int(month_str),
                )

        is_active = params.get('is_active')
        if is_active in ('true', 'false'):
            queryset = queryset.filter(is_active=(is_active == 'true'))

        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo phiếu tạm ứng.')
        adv_date = serializer.validated_data.get('advance_date')
        _ensure_finance_month_unlocked(
            _month_from_date_obj(adv_date),
            'Tháng tài chính đã khóa, không thể thêm phiếu tạm ứng.',
        )
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật phiếu tạm ứng.')
        adv_date = serializer.validated_data.get('advance_date', serializer.instance.advance_date)
        _ensure_finance_month_unlocked(
            _month_from_date_obj(adv_date),
            'Tháng tài chính đã khóa, không thể cập nhật phiếu tạm ứng.',
        )
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xóa phiếu tạm ứng.'}, status=403)
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'No IDs provided'}, status=400)
        locked_months = _get_locked_finance_months()
        if locked_months:
            txs = AdvanceTransaction.objects.filter(id__in=ids)
            for tx in txs:
                month = _month_from_date_obj(tx.advance_date)
                if month in locked_months:
                    return Response({'error': f'Tháng {month} đã khóa, không thể xóa phiếu tạm ứng.'}, status=400)
        deleted_count, _ = AdvanceTransaction.objects.filter(id__in=ids).delete()
        return Response({'success': True, 'count': deleted_count})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xóa phiếu tạm ứng.'}, status=403)
        instance = self.get_object()
        _ensure_finance_month_unlocked(
            _month_from_date_obj(instance.advance_date),
            'Tháng tài chính đã khóa, không thể xóa phiếu tạm ứng.',
        )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'])
    def overdue_report(self, request):
        as_of_raw = (request.query_params.get('as_of') or '').strip()
        overdue_days_raw = (request.query_params.get('overdue_days') or '30').strip()
        try:
            overdue_days = int(overdue_days_raw)
        except ValueError:
            return Response({'error': 'overdue_days phải là số nguyên.'}, status=400)
        overdue_days = max(1, min(3650, overdue_days))

        if as_of_raw:
            try:
                y, m, d = as_of_raw.split('-', 2)
                as_of = date(int(y), int(m), int(d))
            except Exception:
                return Response({'error': 'as_of phải có dạng YYYY-MM-DD'}, status=400)
        else:
            as_of = date.today()
        cutoff_date = as_of.fromordinal(as_of.toordinal() - overdue_days)

        qs = AdvanceTransaction.objects.filter(
            is_active=True,
            status__in=[AdvanceTransaction.STATUS_OPEN, AdvanceTransaction.STATUS_PARTIAL],
            advance_date__lte=cutoff_date,
        ).select_related('source_cash_account', 'source_bank_account')

        items = []
        total_amount = Decimal('0')
        total_handled = Decimal('0')
        total_remaining = Decimal('0')
        for adv in qs:
            spent = Decimal(str(adv.settlements.aggregate(total=Sum('spent_amount')).get('total') or 0))
            refund = Decimal(str(adv.settlements.aggregate(total=Sum('refund_amount')).get('total') or 0))
            handled = spent + refund
            amount = Decimal(str(adv.amount or 0))
            remaining = amount - handled
            if remaining <= 0:
                continue
            days_overdue = (as_of - adv.advance_date).days
            total_amount += amount
            total_handled += handled
            total_remaining += remaining
            items.append({
                'id': adv.id,
                'code': adv.code,
                'advance_type': adv.advance_type,
                'advance_date': adv.advance_date.isoformat() if adv.advance_date else '',
                'recipient_name': adv.recipient_name,
                'status': adv.status,
                'amount': str(amount),
                'spent_amount': str(spent),
                'refund_amount': str(refund),
                'handled_amount': str(handled),
                'remaining_amount': str(remaining),
                'days_overdue': days_overdue,
                'source_type': adv.source_type,
                'source_cash_account_name': adv.source_cash_account.name if adv.source_cash_account_id else '',
                'source_bank_account_code': adv.source_bank_account.code if adv.source_bank_account_id else '',
                'purpose': adv.purpose,
            })

        items.sort(key=lambda x: (-int(x['days_overdue']), x['advance_date'], x['code']))
        summary = {
            'as_of': as_of.isoformat(),
            'overdue_days': overdue_days,
            'count': len(items),
            'total_amount': str(total_amount),
            'total_handled': str(total_handled),
            'total_remaining': str(total_remaining),
        }

        if (request.query_params.get('export') or '').strip().lower() == 'excel':
            wb = Workbook()
            ws = wb.active
            ws.title = 'TamUngQuaHan'
            ws.append([
                'Ma tam ung',
                'Ngay tam ung',
                'Nguoi nhan',
                'Loai',
                'Trang thai',
                'So tien',
                'Da xu ly',
                'Con lai',
                'So ngay qua han',
                'Muc dich',
            ])
            for row in items:
                ws.append([
                    row['code'],
                    row['advance_date'],
                    row['recipient_name'],
                    row['advance_type'],
                    row['status'],
                    float(row['amount']),
                    float(row['handled_amount']),
                    float(row['remaining_amount']),
                    int(row['days_overdue']),
                    row['purpose'],
                ])
            response = HttpResponse(
                content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
            response['Content-Disposition'] = f'attachment; filename=\"bao_cao_tam_ung_qua_han_{as_of.isoformat()}.xlsx\"'
            wb.save(response)
            return response

        return Response({'summary': summary, 'items': items})

    @action(detail=False, methods=['get'])
    def overdue_overview(self, request):
        as_of_raw = (request.query_params.get('as_of') or '').strip()
        if as_of_raw:
            try:
                y, m, d = as_of_raw.split('-', 2)
                as_of = date(int(y), int(m), int(d))
            except Exception:
                return Response({'error': 'as_of phải có dạng YYYY-MM-DD'}, status=400)
        else:
            as_of = date.today()

        base_qs = AdvanceTransaction.objects.filter(
            is_active=True,
            status__in=[AdvanceTransaction.STATUS_OPEN, AdvanceTransaction.STATUS_PARTIAL],
            advance_date__lt=as_of,
        ).select_related('source_cash_account', 'source_bank_account')

        entries: list[dict] = []
        for adv in base_qs:
            spent = Decimal(str(adv.settlements.aggregate(total=Sum('spent_amount')).get('total') or 0))
            refund = Decimal(str(adv.settlements.aggregate(total=Sum('refund_amount')).get('total') or 0))
            handled = spent + refund
            amount = Decimal(str(adv.amount or 0))
            remaining = amount - handled
            if remaining <= 0:
                continue
            days_overdue = (as_of - adv.advance_date).days
            entries.append({
                'id': adv.id,
                'code': adv.code,
                'advance_date': adv.advance_date.isoformat() if adv.advance_date else '',
                'recipient_name': adv.recipient_name,
                'status': adv.status,
                'amount': str(amount),
                'remaining_amount': str(remaining),
                'days_overdue': days_overdue,
            })

        def bucket_stats(threshold: int) -> dict:
            bucket_items = [item for item in entries if int(item['days_overdue']) >= threshold]
            total_remaining = Decimal('0')
            for item in bucket_items:
                total_remaining += Decimal(str(item['remaining_amount']))
            return {
                'threshold_days': threshold,
                'count': len(bucket_items),
                'total_remaining': str(total_remaining),
            }

        buckets = [
            bucket_stats(30),
            bucket_stats(60),
            bucket_stats(90),
        ]
        top_urgent = sorted(entries, key=lambda x: (-int(x['days_overdue']), x['advance_date'], x['code']))[:10]
        return Response({
            'as_of': as_of.isoformat(),
            'buckets': buckets,
            'top_urgent': top_urgent,
        })

    @action(detail=False, methods=['post'])
    def remind_overdue(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền gửi nhắc quá hạn.'}, status=403)
        threshold_days_raw = request.data.get('threshold_days')
        threshold_days = None if threshold_days_raw in (None, '') else threshold_days_raw
        as_of = (request.data.get('as_of') or '').strip() or None
        recipient_usernames_raw = request.data.get('recipient_usernames')
        recipient_usernames = None
        if isinstance(recipient_usernames_raw, list):
            recipient_usernames = [str(item).strip() for item in recipient_usernames_raw if str(item).strip()]
        elif isinstance(recipient_usernames_raw, str):
            recipient_usernames = [part.strip() for part in recipient_usernames_raw.split(',') if part.strip()]
        try:
            result = run_daily_overdue_reminder_job(
                threshold_days=None if threshold_days is None else int(threshold_days),
                as_of=as_of,
                recipient_usernames=recipient_usernames,
            )
        except ValueError:
            return Response({'error': 'threshold_days phải là số nguyên.'}, status=400)
        return Response(result)

    @action(detail=False, methods=['get'])
    def reminder_policy(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xem policy nhắc quá hạn.'}, status=403)
        policy = get_reminder_policy()
        policy['presets'] = get_reminder_policy_presets()
        policy['recommendation'] = _recommend_reminder_policy_preset()
        return Response(policy)

    @reminder_policy.mapping.post
    def save_reminder_policy_action(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền cập nhật policy nhắc quá hạn.'}, status=403)
        payload = request.data if isinstance(request.data, dict) else {}
        old_policy = get_reminder_policy()
        try:
            policy = save_reminder_policy(payload)
        except Exception:
            return Response({'error': 'Dữ liệu policy không hợp lệ.'}, status=400)
        setting_row = Setting.objects.filter(key=REMINDER_POLICY_SETTING_KEY).first()
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='FinanceAdvanceReminderPolicy',
            entity_id=int(setting_row.id if setting_row else 0),
            entity_id_str=str(setting_row.id if setting_row else ''),
            entity_code=REMINDER_POLICY_SETTING_KEY,
            old_values=old_policy,
            new_values=policy,
            changed_fields=['default_threshold_days', 'cooldown_hours', 'role_threshold_days', 'user_threshold_days'],
        )
        return Response({'success': True, 'policy': policy})

    @action(detail=False, methods=['get'])
    def reminder_policy_history(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xem lịch sử policy nhắc quá hạn.'}, status=403)
        limit_raw = (request.query_params.get('limit') or '20').strip()
        try:
            limit = int(limit_raw)
        except ValueError:
            return Response({'error': 'limit phải là số nguyên.'}, status=400)
        limit = max(1, min(limit, 100))
        logs = (
            AuditLog.objects
            .filter(entity_type='FinanceAdvanceReminderPolicy', action='UPDATE')
            .select_related('user')
            .order_by('-created_at', '-id')[:limit]
        )
        items = []
        for row in logs:
            old_values = row.old_values if isinstance(row.old_values, dict) else {}
            new_values = row.new_values if isinstance(row.new_values, dict) else {}
            items.append({
                'id': int(row.id),
                'created_at': row.created_at.isoformat() if row.created_at else '',
                'username': str(row.user.username) if row.user else '',
                'old_values': old_values,
                'new_values': new_values,
                'changed_fields': row.changed_fields if isinstance(row.changed_fields, list) else [],
            })
        return Response({'count': len(items), 'items': items})

    @action(detail=False, methods=['post'])
    def reminder_policy_rollback(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền rollback policy nhắc quá hạn.'}, status=403)
        audit_log_id_raw = request.data.get('audit_log_id')
        try:
            audit_log_id = int(audit_log_id_raw)
        except (TypeError, ValueError):
            return Response({'error': 'audit_log_id phải là số nguyên.'}, status=400)
        target_log = (
            AuditLog.objects
            .filter(id=audit_log_id, entity_type='FinanceAdvanceReminderPolicy', action='UPDATE')
            .first()
        )
        if not target_log:
            return Response({'error': 'Không tìm thấy bản ghi lịch sử policy.'}, status=404)
        target_policy = target_log.old_values if isinstance(target_log.old_values, dict) else {}
        if not target_policy:
            return Response({'error': 'Bản ghi lịch sử không chứa policy cũ hợp lệ.'}, status=400)
        old_policy = get_reminder_policy()
        try:
            policy = save_reminder_policy(target_policy)
        except Exception:
            return Response({'error': 'Rollback policy thất bại do dữ liệu không hợp lệ.'}, status=400)
        setting_row = Setting.objects.filter(key=REMINDER_POLICY_SETTING_KEY).first()
        AuditLog.objects.create(
            user=request.user,
            action='UPDATE',
            entity_type='FinanceAdvanceReminderPolicy',
            entity_id=int(setting_row.id if setting_row else 0),
            entity_id_str=str(setting_row.id if setting_row else ''),
            entity_code=REMINDER_POLICY_SETTING_KEY,
            old_values=old_policy,
            new_values=policy,
            changed_fields=['default_threshold_days', 'cooldown_hours', 'role_threshold_days', 'user_threshold_days'],
        )
        return Response({
            'success': True,
            'policy': policy,
            'rolled_back_to_audit_log_id': audit_log_id,
        })

    @action(detail=False, methods=['post'])
    def reminder_policy_simulate(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền mô phỏng policy nhắc quá hạn.'}, status=403)
        payload = request.data if isinstance(request.data, dict) else {}
        threshold_days_raw = payload.get('threshold_days')
        threshold_days = None if threshold_days_raw in (None, '') else threshold_days_raw
        as_of = (payload.get('as_of') or '').strip() or None
        recipient_usernames_raw = payload.get('recipient_usernames')
        policy_override = payload.get('policy')
        if policy_override is not None and not isinstance(policy_override, dict):
            return Response({'error': 'policy phải là object JSON.'}, status=400)

        recipient_usernames = None
        if isinstance(recipient_usernames_raw, list):
            recipient_usernames = [str(item).strip() for item in recipient_usernames_raw if str(item).strip()]
        elif isinstance(recipient_usernames_raw, str):
            recipient_usernames = [part.strip() for part in recipient_usernames_raw.split(',') if part.strip()]
        try:
            result = run_daily_overdue_reminder_job(
                threshold_days=None if threshold_days is None else int(threshold_days),
                as_of=as_of,
                recipient_usernames=recipient_usernames,
                policy_override=policy_override,
                dry_run=True,
            )
        except ValueError:
            return Response({'error': 'threshold_days phải là số nguyên.'}, status=400)
        return Response(result)

    @action(detail=False, methods=['get'])
    def reminder_history(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xem lịch sử nhắc quá hạn.'}, status=403)
        days_raw = (request.query_params.get('days') or '30').strip()
        try:
            days = int(days_raw)
        except ValueError:
            return Response({'error': 'days phải là số nguyên.'}, status=400)
        days = max(1, min(days, 365))
        cutoff = date.today().fromordinal(date.today().toordinal() - days)

        as_of_from = (request.query_params.get('as_of_from') or '').strip()
        as_of_to = (request.query_params.get('as_of_to') or '').strip()
        entity_from = None
        entity_to = None
        if as_of_from:
            try:
                y, m, d = as_of_from.split('-', 2)
                entity_from = int(f'{int(y):04d}{int(m):02d}{int(d):02d}')
            except Exception:
                return Response({'error': 'as_of_from phải có dạng YYYY-MM-DD'}, status=400)
        if as_of_to:
            try:
                y, m, d = as_of_to.split('-', 2)
                entity_to = int(f'{int(y):04d}{int(m):02d}{int(d):02d}')
            except Exception:
                return Response({'error': 'as_of_to phải có dạng YYYY-MM-DD'}, status=400)
        unread_only = str(request.query_params.get('unread_only') or '').strip().lower() in {'1', 'true', 'yes'}

        qs = (
            Notification.objects
            .filter(
                notification_type='due_date',
                entity_type='FinanceAdvanceOverdueDaily',
                created_at__date__gte=cutoff,
            )
            .select_related('recipient')
            .order_by('-created_at', '-id')
        )
        if entity_from is not None:
            qs = qs.filter(entity_id__gte=entity_from)
        if entity_to is not None:
            qs = qs.filter(entity_id__lte=entity_to)

        grouped = {}
        recipient_stats = {}
        for n in qs:
            key = int(n.entity_id or 0)
            entry = grouped.get(key)
            if entry is None:
                entry = {
                    'entity_id': key,
                    'title': n.title,
                    'message': n.message,
                    'created_at': n.created_at,
                    'sent_count': 0,
                    'unread_count': 0,
                    'recipient_names': [],
                }
                grouped[key] = entry
            entry['sent_count'] += 1
            if not n.is_read:
                entry['unread_count'] += 1
            if len(entry['recipient_names']) < 5:
                entry['recipient_names'].append(n.recipient.username)
            if n.created_at and n.created_at > entry['created_at']:
                entry['created_at'] = n.created_at

            recipient_key = n.recipient.username
            stat = recipient_stats.get(recipient_key)
            if stat is None:
                stat = {
                    'username': recipient_key,
                    'total_received': 0,
                    'unread_count': 0,
                }
                recipient_stats[recipient_key] = stat
            stat['total_received'] += 1
            if not n.is_read:
                stat['unread_count'] += 1

        items = sorted(grouped.values(), key=lambda x: x['created_at'], reverse=True)
        total_sent = 0
        total_unread = 0
        for item in items:
            item['created_at'] = item['created_at'].isoformat() if item['created_at'] else ''
            if item['entity_id'] > 0:
                entity_str = str(item['entity_id']).zfill(8)
                item['as_of'] = f'{entity_str[0:4]}-{entity_str[4:6]}-{entity_str[6:8]}'
            else:
                item['as_of'] = ''
            sent_count = int(item.get('sent_count') or 0)
            unread_count = int(item.get('unread_count') or 0)
            read_count = max(0, sent_count - unread_count)
            read_rate = round((read_count / sent_count) * 100, 2) if sent_count > 0 else 0
            unread_rate = round((unread_count / sent_count) * 100, 2) if sent_count > 0 else 0
            item['read_count'] = read_count
            item['read_rate'] = read_rate
            item['unread_rate'] = unread_rate
            total_sent += sent_count
            total_unread += unread_count
        if unread_only:
            items = [item for item in items if int(item['unread_count']) > 0]

        if (request.query_params.get('export') or '').strip().lower() == 'excel':
            wb = Workbook()
            ws = wb.active
            ws.title = 'LichSuNhacQuaHan'
            ws.append([
                'Ngay nhac (as_of)',
                'Tieu de',
                'Da gui',
                'Da doc',
                'Chua doc',
                'Ty le da doc (%)',
                'Ty le chua doc (%)',
                'Nguoi nhan mau',
                'Thoi diem tao ban ghi',
            ])
            for item in items[:200]:
                ws.append([
                    item.get('as_of', ''),
                    item.get('title', ''),
                    int(item.get('sent_count') or 0),
                    int(item.get('read_count') or 0),
                    int(item.get('unread_count') or 0),
                    float(item.get('read_rate') or 0),
                    float(item.get('unread_rate') or 0),
                    ', '.join(item.get('recipient_names') or []),
                    item.get('created_at', ''),
                ])
            response = HttpResponse(
                content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
            response['Content-Disposition'] = 'attachment; filename="lich_su_nhac_qua_han.xlsx"'
            wb.save(response)
            return response

        total_read = max(0, total_sent - total_unread)
        overall_read_rate = round((total_read / total_sent) * 100, 2) if total_sent > 0 else 0
        top_unread_recipients = sorted(
            recipient_stats.values(),
            key=lambda x: (-int(x.get('unread_count') or 0), -int(x.get('total_received') or 0), str(x.get('username') or '')),
        )
        if unread_only:
            top_unread_recipients = [item for item in top_unread_recipients if int(item.get('unread_count') or 0) > 0]
        for item in top_unread_recipients:
            total_received = int(item.get('total_received') or 0)
            unread_count = int(item.get('unread_count') or 0)
            item['read_count'] = max(0, total_received - unread_count)
            item['unread_rate'] = round((unread_count / total_received) * 100, 2) if total_received > 0 else 0
        return Response({
            'days': days,
            'count': len(items),
            'filters': {
                'as_of_from': as_of_from,
                'as_of_to': as_of_to,
                'unread_only': unread_only,
            },
            'summary': {
                'total_sent': total_sent,
                'total_read': total_read,
                'total_unread': total_unread,
                'overall_read_rate': overall_read_rate,
                'top_unread_recipients': top_unread_recipients[:10],
            },
            'items': items[:50],
        })


class AdvanceSettlementViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = AdvanceSettlement.objects.select_related('advance_transaction')
    serializer_class = AdvanceSettlementSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['settlement_date', 'spent_amount', 'refund_amount', 'created_at']
    ordering = ['-settlement_date', '-id']

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        advance_id = (params.get('advance_transaction') or '').strip()
        if advance_id.isdigit():
            queryset = queryset.filter(advance_transaction_id=int(advance_id))

        month = (params.get('month') or '').strip()
        if len(month) == 7 and '-' in month:
            year_str, month_str = month.split('-', 1)
            if year_str.isdigit() and month_str.isdigit():
                queryset = queryset.filter(
                    settlement_date__year=int(year_str),
                    settlement_date__month=int(month_str),
                )
        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo quyết toán.')
        settlement_date = serializer.validated_data.get('settlement_date')
        _ensure_finance_month_unlocked(
            _month_from_date_obj(settlement_date),
            'Tháng tài chính đã khóa, không thể thêm quyết toán.',
        )
        with transaction.atomic():
            settlement = serializer.save(created_by=self.request.user, updated_by=self.request.user)
            refresh_advance_status(settlement.advance_transaction, self.request.user)

    def perform_update(self, serializer):
        if not _can_manage_finance(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật quyết toán.')
        settlement_date = serializer.validated_data.get('settlement_date', serializer.instance.settlement_date)
        _ensure_finance_month_unlocked(
            _month_from_date_obj(settlement_date),
            'Tháng tài chính đã khóa, không thể cập nhật quyết toán.',
        )
        with transaction.atomic():
            settlement = serializer.save(updated_by=self.request.user)
            refresh_advance_status(settlement.advance_transaction, self.request.user)

    def perform_destroy(self, instance):
        _ensure_finance_month_unlocked(
            _month_from_date_obj(instance.settlement_date),
            'Tháng tài chính đã khóa, không thể xóa quyết toán.',
        )
        advance = instance.advance_transaction
        with transaction.atomic():
            instance.delete()
            refresh_advance_status(advance, self.request.user)

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xóa quyết toán.'}, status=403)
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'No IDs provided'}, status=400)

        with transaction.atomic():
            settlements = list(AdvanceSettlement.objects.filter(id__in=ids).select_related('advance_transaction'))
            locked_months = _get_locked_finance_months()
            for settlement in settlements:
                month = _month_from_date_obj(settlement.settlement_date)
                if month in locked_months:
                    return Response({'error': f'Tháng {month} đã khóa, không thể xóa quyết toán.'}, status=400)
            advance_ids = {item.advance_transaction_id for item in settlements}
            deleted_count, _ = AdvanceSettlement.objects.filter(id__in=ids).delete()
            for advance in AdvanceTransaction.objects.filter(id__in=advance_ids):
                refresh_advance_status(advance, request.user)
        return Response({'success': True, 'count': deleted_count})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_finance(request.user):
            return Response({'error': 'Bạn không có quyền xóa quyết toán.'}, status=403)
        return super().destroy(request, *args, **kwargs)
