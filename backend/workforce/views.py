from decimal import Decimal, ROUND_HALF_UP
from datetime import date
import json

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from unidecode import unidecode

from core.permissions import check_action_permission
from core.models import AuditLog, Setting
from finance.models import CashAccount, CashTransaction, TransactionCategory

from .models import (
    AttendanceRecord,
    BonusPenaltyRecord,
    Employee,
    PayrollRecord,
    SalaryAdvanceRecord,
)
from .serializers import (
    AttendanceRecordSerializer,
    BonusPenaltyRecordSerializer,
    EmployeeSerializer,
    PayrollRecordSerializer,
    SalaryAdvanceRecordSerializer,
)
from .reminders import (
    build_salary_advance_approval_sla_overview,
    get_approval_sla_policy as get_salary_advance_approval_sla_policy,
    run_salary_advance_approval_sla_reminder_job,
    save_approval_sla_policy as save_salary_advance_approval_sla_policy,
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


def _can_manage_workforce(user):
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    if check_action_permission(user, 'WORKFORCE', 'MANAGE', strict=True):
        return True
    role_names = _user_role_names(user)
    allowed_roles = {
        'admin',
        'manager',
        'hr',
        'hr-manager',
        'human-resources',
        'payroll',
        'accountant',
        'quan-ly',
        'quanly',
    }
    return any(role in allowed_roles for role in role_names)


WORKFORCE_LOCKED_MONTHS_KEY = 'WORKFORCE_LOCKED_PAYROLL_MONTHS'
WORKFORCE_SALARY_ADVANCE_APPROVAL_LEVEL2_THRESHOLD_KEY = 'WORKFORCE_SALARY_ADVANCE_APPROVAL_LEVEL2_THRESHOLD'


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


def _get_locked_workforce_months() -> set[str]:
    row = Setting.objects.filter(key=WORKFORCE_LOCKED_MONTHS_KEY, is_active=True).first()
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


def _save_locked_workforce_months(months: set[str]):
    payload = json.dumps({'months': sorted(months)})
    Setting.objects.update_or_create(
        key=WORKFORCE_LOCKED_MONTHS_KEY,
        defaults={
            'value': payload,
            'data_type': 'json',
            'description': 'Danh sách tháng bảng lương đã khóa (YYYY-MM)',
            'is_active': True,
        },
    )


def _ensure_workforce_month_unlocked(month: str, message: str):
    normalized = _normalize_month(month)
    if not normalized:
        return
    if normalized in _get_locked_workforce_months():
        raise PermissionDenied(message)


def _log_workforce_audit(user, action: str, entity_type: str, entity_id: int, entity_code: str, old_values: dict, new_values: dict, changed_fields: list[str]):
    AuditLog.objects.create(
        user=user,
        action=action,
        entity_type=entity_type,
        entity_id=int(entity_id or 0),
        entity_id_str=str(entity_id or ''),
        entity_code=str(entity_code or ''),
        old_values=old_values if isinstance(old_values, dict) else {},
        new_values=new_values if isinstance(new_values, dict) else {},
        changed_fields=changed_fields if isinstance(changed_fields, list) else [],
    )


def _can_approve_workforce_level2(user) -> bool:
    if getattr(user, 'is_superuser', False):
        return True
    role_names = _user_role_names(user)
    l2_roles = {
        'admin',
        'manager',
        'hr-manager',
        'payroll-manager',
        'giam-doc',
        'pho-giam-doc',
    }
    return any(role in l2_roles for role in role_names)


def _get_salary_advance_level2_threshold() -> Decimal:
    row = Setting.objects.filter(key=WORKFORCE_SALARY_ADVANCE_APPROVAL_LEVEL2_THRESHOLD_KEY, is_active=True).first()
    if not row:
        return Decimal('5000000')
    try:
        raw = Decimal(str(row.value or '5000000'))
        return raw if raw > 0 else Decimal('5000000')
    except Exception:
        return Decimal('5000000')


def _salary_advance_required_level(amount: Decimal) -> int:
    return 2 if Decimal(str(amount or 0)) >= _get_salary_advance_level2_threshold() else 1


class SearchTextMixin:
    search_text_field = 'search_text'

    def apply_search(self, queryset):
        request = self.request
        search_raw = (request.query_params.get('q') or request.query_params.get('search') or '').strip()
        if not search_raw:
            return queryset

        normalized = unidecode(search_raw).lower().strip()
        exact_search = request.query_params.get('exact_search') in ('1', 'true', 'True')
        field_name = self.search_text_field

        if exact_search:
            q_exact = Q(**{f'{field_name}__icontains': normalized})
            if search_raw != normalized:
                q_exact |= Q(**{f'{field_name}__icontains': search_raw})
            return queryset.filter(q_exact).distinct()

        tokens = [token for token in normalized.split() if token]
        if not tokens:
            return queryset

        query = Q(**{f'{field_name}__icontains': tokens[0]})
        for token in tokens[1:]:
            query &= Q(**{f'{field_name}__icontains': token})
        return queryset.filter(query).distinct()


class EmployeeViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = Employee.objects.all()
    serializer_class = EmployeeSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['code', 'name', 'department', 'position', 'salary_basic', 'created_at']
    ordering = ['code']

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        is_active = params.get('is_active')
        if is_active in ('true', 'false'):
            queryset = queryset.filter(is_active=(is_active == 'true'))

        status_param = (params.get('status') or '').strip()
        if status_param:
            queryset = queryset.filter(status=status_param)

        department = (params.get('department') or '').strip()
        if department:
            queryset = queryset.filter(department__icontains=department)

        position = (params.get('position') or '').strip()
        if position:
            queryset = queryset.filter(position__icontains=position)

        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo nhân viên.')
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật nhân viên.')
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu nhân sự.'}, status=403)
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'No IDs provided'}, status=400)
        deleted_count, _ = Employee.objects.filter(id__in=ids).delete()
        return Response({'success': True, 'count': deleted_count})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu nhân sự.'}, status=403)
        return super().destroy(request, *args, **kwargs)


class AttendanceRecordViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = AttendanceRecord.objects.select_related('employee').prefetch_related('overtime_items')
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['month', 'employee__code', 'actual_days', 'created_at']
    ordering = ['-month', 'employee__code']

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        month = (params.get('month') or '').strip()
        if month:
            queryset = queryset.filter(month=month)

        employee_id = (params.get('employee') or '').strip()
        if employee_id.isdigit():
            queryset = queryset.filter(employee_id=int(employee_id))

        is_active = params.get('is_active')
        if is_active in ('true', 'false'):
            queryset = queryset.filter(is_active=(is_active == 'true'))

        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo dữ liệu chấm công.')
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật dữ liệu chấm công.')
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu chấm công.'}, status=403)
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'No IDs provided'}, status=400)
        deleted_count, _ = AttendanceRecord.objects.filter(id__in=ids).delete()
        return Response({'success': True, 'count': deleted_count})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu chấm công.'}, status=403)
        return super().destroy(request, *args, **kwargs)


class BonusPenaltyRecordViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = BonusPenaltyRecord.objects.select_related('employee')
    serializer_class = BonusPenaltyRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['month', 'record_date', 'employee__code', 'amount', 'created_at']
    ordering = ['-record_date', '-id']

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        month = (params.get('month') or '').strip()
        if month:
            queryset = queryset.filter(month=month)

        record_type = (params.get('record_type') or '').strip()
        if record_type:
            queryset = queryset.filter(record_type=record_type)

        employee_id = (params.get('employee') or '').strip()
        if employee_id.isdigit():
            queryset = queryset.filter(employee_id=int(employee_id))

        is_active = params.get('is_active')
        if is_active in ('true', 'false'):
            queryset = queryset.filter(is_active=(is_active == 'true'))

        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo dữ liệu thưởng phạt.')
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật dữ liệu thưởng phạt.')
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu thưởng phạt.'}, status=403)
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'No IDs provided'}, status=400)
        deleted_count, _ = BonusPenaltyRecord.objects.filter(id__in=ids).delete()
        return Response({'success': True, 'count': deleted_count})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu thưởng phạt.'}, status=403)
        return super().destroy(request, *args, **kwargs)


class SalaryAdvanceRecordViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = SalaryAdvanceRecord.objects.select_related('employee')
    serializer_class = SalaryAdvanceRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['month', 'advance_date', 'employee__code', 'amount', 'created_at']
    ordering = ['-advance_date', '-id']

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        month = (params.get('month') or '').strip()
        if month:
            queryset = queryset.filter(month=month)

        status_param = (params.get('status') or '').strip()
        if status_param:
            queryset = queryset.filter(status=status_param)
        approval_status = (params.get('approval_status') or '').strip()
        if approval_status:
            queryset = queryset.filter(approval_status=approval_status)

        employee_id = (params.get('employee') or '').strip()
        if employee_id.isdigit():
            queryset = queryset.filter(employee_id=int(employee_id))

        is_active = params.get('is_active')
        if is_active in ('true', 'false'):
            queryset = queryset.filter(is_active=(is_active == 'true'))

        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo dữ liệu ứng lương.')
        month_value = serializer.validated_data.get('month', '')
        _ensure_workforce_month_unlocked(month_value, 'Tháng lương đã khóa kỳ, không thể tạo ứng lương.')
        amount = Decimal(str(serializer.validated_data.get('amount') or 0))
        required_level = _salary_advance_required_level(amount)
        record = serializer.save(
            created_by=self.request.user,
            updated_by=self.request.user,
            approval_status=SalaryAdvanceRecord.APPROVAL_DRAFT,
            required_approval_level=required_level,
        )
        _log_workforce_audit(
            self.request.user,
            action='CREATE',
            entity_type='WorkforceSalaryAdvanceApproval',
            entity_id=int(record.id),
            entity_code=str(record.id),
            old_values={},
            new_values={'approval_status': record.approval_status, 'required_approval_level': record.required_approval_level},
            changed_fields=['approval_status', 'required_approval_level'],
        )

    def perform_update(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật dữ liệu ứng lương.')
        month_value = serializer.validated_data.get('month', serializer.instance.month)
        _ensure_workforce_month_unlocked(month_value, 'Tháng lương đã khóa kỳ, không thể cập nhật ứng lương.')
        if serializer.instance.approval_status in {
            SalaryAdvanceRecord.APPROVAL_PENDING_L1,
            SalaryAdvanceRecord.APPROVAL_PENDING_L2,
            SalaryAdvanceRecord.APPROVAL_APPROVED,
        }:
            raise PermissionDenied('Ứng lương đã gửi duyệt/đã duyệt, không thể chỉnh sửa trực tiếp.')
        amount = Decimal(str(serializer.validated_data.get('amount', serializer.instance.amount) or 0))
        serializer.save(updated_by=self.request.user, required_approval_level=_salary_advance_required_level(amount))

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu ứng lương.'}, status=403)
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'No IDs provided'}, status=400)
        rows = SalaryAdvanceRecord.objects.filter(id__in=ids)
        for row in rows:
            _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể xóa ứng lương.')
            if row.approval_status in {
                SalaryAdvanceRecord.APPROVAL_PENDING_L1,
                SalaryAdvanceRecord.APPROVAL_PENDING_L2,
                SalaryAdvanceRecord.APPROVAL_APPROVED,
            }:
                return Response({'error': f'Ứng lương #{row.id} đã gửi duyệt/đã duyệt, không thể xóa.'}, status=400)
        deleted_count, _ = rows.delete()
        return Response({'success': True, 'count': deleted_count})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu ứng lương.'}, status=403)
        row = self.get_object()
        _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể xóa ứng lương.')
        if row.approval_status in {
            SalaryAdvanceRecord.APPROVAL_PENDING_L1,
            SalaryAdvanceRecord.APPROVAL_PENDING_L2,
            SalaryAdvanceRecord.APPROVAL_APPROVED,
        }:
            return Response({'error': 'Ứng lương đã gửi duyệt/đã duyệt, không thể xóa.'}, status=400)
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'])
    def approval_queue(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xem hàng đợi duyệt ứng lương.'}, status=403)
        pending_l1 = SalaryAdvanceRecord.objects.filter(approval_status=SalaryAdvanceRecord.APPROVAL_PENDING_L1, is_active=True)
        pending_l2 = SalaryAdvanceRecord.objects.filter(approval_status=SalaryAdvanceRecord.APPROVAL_PENDING_L2, is_active=True)
        if not _can_approve_workforce_level2(request.user):
            pending_l2 = pending_l2.none()
        rows = []
        for row in list(pending_l1.select_related('employee').order_by('-advance_date', '-id')[:10]) + list(pending_l2.select_related('employee').order_by('-advance_date', '-id')[:10]):
            rows.append({
                'id': int(row.id),
                'employee_code': row.employee.code if row.employee_id else '',
                'employee_name': row.employee.name if row.employee_id else '',
                'amount': str(row.amount),
                'month': row.month,
                'approval_status': row.approval_status,
                'required_approval_level': int(row.required_approval_level or 1),
            })
        return Response({
            'pending_l1_count': int(pending_l1.count()),
            'pending_l2_count': int(pending_l2.count()),
            'items': rows,
        })

    @action(detail=True, methods=['post'])
    def submit_approval(self, request, pk=None):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền gửi duyệt ứng lương.'}, status=403)
        row = self.get_object()
        _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể gửi duyệt ứng lương.')
        if row.approval_status in {
            SalaryAdvanceRecord.APPROVAL_PENDING_L1,
            SalaryAdvanceRecord.APPROVAL_PENDING_L2,
            SalaryAdvanceRecord.APPROVAL_APPROVED,
        }:
            return Response({'error': 'Ứng lương đang chờ duyệt hoặc đã duyệt.'}, status=400)
        old_status = row.approval_status
        row.approval_status = SalaryAdvanceRecord.APPROVAL_PENDING_L1
        row.submitted_at = timezone.now()
        row.submitted_by = request.user
        row.rejected_at = None
        row.rejected_by = None
        row.rejection_reason = ''
        row.required_approval_level = _salary_advance_required_level(Decimal(str(row.amount or 0)))
        row.updated_by = request.user
        row.save(update_fields=[
            'approval_status',
            'submitted_at',
            'submitted_by',
            'rejected_at',
            'rejected_by',
            'rejection_reason',
            'required_approval_level',
            'updated_by',
            'updated_at',
            'search_text',
        ])
        _log_workforce_audit(
            request.user,
            action='UPDATE',
            entity_type='WorkforceSalaryAdvanceApproval',
            entity_id=int(row.id),
            entity_code=str(row.id),
            old_values={'approval_status': old_status},
            new_values={'approval_status': row.approval_status, 'required_approval_level': row.required_approval_level},
            changed_fields=['approval_status', 'required_approval_level'],
        )
        return Response({'success': True, 'approval_status': row.approval_status, 'required_approval_level': row.required_approval_level})

    @action(detail=True, methods=['post'])
    def approve_level1(self, request, pk=None):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền duyệt cấp 1 ứng lương.'}, status=403)
        row = self.get_object()
        _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể duyệt ứng lương.')
        if row.approval_status != SalaryAdvanceRecord.APPROVAL_PENDING_L1:
            return Response({'error': 'Ứng lương không ở trạng thái chờ duyệt cấp 1.'}, status=400)
        old_status = row.approval_status
        row.approval_status = SalaryAdvanceRecord.APPROVAL_APPROVED if int(row.required_approval_level or 1) <= 1 else SalaryAdvanceRecord.APPROVAL_PENDING_L2
        row.approved_level1_at = timezone.now()
        row.approved_level1_by = request.user
        row.updated_by = request.user
        row.save(update_fields=['approval_status', 'approved_level1_at', 'approved_level1_by', 'updated_by', 'updated_at', 'search_text'])
        _log_workforce_audit(
            request.user,
            action='UPDATE',
            entity_type='WorkforceSalaryAdvanceApproval',
            entity_id=int(row.id),
            entity_code=str(row.id),
            old_values={'approval_status': old_status},
            new_values={'approval_status': row.approval_status},
            changed_fields=['approval_status', 'approved_level1_at'],
        )
        return Response({'success': True, 'approval_status': row.approval_status})

    @action(detail=True, methods=['post'])
    def approve_level2(self, request, pk=None):
        if not _can_manage_workforce(request.user) or not _can_approve_workforce_level2(request.user):
            return Response({'error': 'Bạn không có quyền duyệt cấp 2 ứng lương.'}, status=403)
        row = self.get_object()
        _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể duyệt ứng lương.')
        if row.approval_status != SalaryAdvanceRecord.APPROVAL_PENDING_L2:
            return Response({'error': 'Ứng lương không ở trạng thái chờ duyệt cấp 2.'}, status=400)
        old_status = row.approval_status
        row.approval_status = SalaryAdvanceRecord.APPROVAL_APPROVED
        row.approved_level2_at = timezone.now()
        row.approved_level2_by = request.user
        row.updated_by = request.user
        row.save(update_fields=['approval_status', 'approved_level2_at', 'approved_level2_by', 'updated_by', 'updated_at', 'search_text'])
        _log_workforce_audit(
            request.user,
            action='UPDATE',
            entity_type='WorkforceSalaryAdvanceApproval',
            entity_id=int(row.id),
            entity_code=str(row.id),
            old_values={'approval_status': old_status},
            new_values={'approval_status': row.approval_status},
            changed_fields=['approval_status', 'approved_level2_at'],
        )
        return Response({'success': True, 'approval_status': row.approval_status})

    @action(detail=True, methods=['post'])
    def reject_approval(self, request, pk=None):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền từ chối duyệt ứng lương.'}, status=403)
        row = self.get_object()
        _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể từ chối duyệt ứng lương.')
        if row.approval_status not in {SalaryAdvanceRecord.APPROVAL_PENDING_L1, SalaryAdvanceRecord.APPROVAL_PENDING_L2}:
            return Response({'error': 'Ứng lương không ở trạng thái chờ duyệt.'}, status=400)
        reason = str(request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': 'reason là bắt buộc khi từ chối.'}, status=400)
        old_status = row.approval_status
        row.approval_status = SalaryAdvanceRecord.APPROVAL_REJECTED
        row.rejected_at = timezone.now()
        row.rejected_by = request.user
        row.rejection_reason = reason[:255]
        row.updated_by = request.user
        row.save(update_fields=['approval_status', 'rejected_at', 'rejected_by', 'rejection_reason', 'updated_by', 'updated_at', 'search_text'])
        _log_workforce_audit(
            request.user,
            action='UPDATE',
            entity_type='WorkforceSalaryAdvanceApproval',
            entity_id=int(row.id),
            entity_code=str(row.id),
            old_values={'approval_status': old_status},
            new_values={'approval_status': row.approval_status, 'rejection_reason': row.rejection_reason},
            changed_fields=['approval_status', 'rejection_reason'],
        )
        return Response({'success': True, 'approval_status': row.approval_status})

    @action(detail=False, methods=['get'])
    def approval_sla_overview(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xem SLA duyệt ứng lương.'}, status=403)
        return Response(build_salary_advance_approval_sla_overview())

    @action(detail=False, methods=['post'])
    def remind_pending_approvals(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền gửi nhắc SLA duyệt ứng lương.'}, status=403)
        dry_run = str(request.data.get('dry_run') or '').strip().lower() in {'1', 'true', 'yes'}
        return Response(run_salary_advance_approval_sla_reminder_job(dry_run=dry_run))

    @action(detail=False, methods=['get'])
    def approval_sla_policy(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xem policy SLA duyệt ứng lương.'}, status=403)
        return Response(get_salary_advance_approval_sla_policy())

    @approval_sla_policy.mapping.post
    def save_approval_sla_policy_action(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền cập nhật policy SLA duyệt ứng lương.'}, status=403)
        payload = request.data if isinstance(request.data, dict) else {}
        old_policy = get_salary_advance_approval_sla_policy()
        policy = save_salary_advance_approval_sla_policy(payload)
        _log_workforce_audit(
            request.user,
            action='UPDATE',
            entity_type='WorkforceSalaryAdvanceApprovalSlaPolicy',
            entity_id=0,
            entity_code='WORKFORCE_SALARY_ADVANCE_APPROVAL_SLA_POLICY',
            old_values=old_policy,
            new_values=policy,
            changed_fields=['sla_hours_l1', 'sla_hours_l2', 'remind_every_hours', 'window_days'],
        )
        return Response({'success': True, 'policy': policy})


class PayrollRecordViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = PayrollRecord.objects.select_related('employee')
    serializer_class = PayrollRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['month', 'employee__code', 'net_pay', 'status', 'created_at']
    ordering = ['-month', 'employee__code']

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params

        month = (params.get('month') or '').strip()
        if month:
            queryset = queryset.filter(month=month)

        status_param = (params.get('status') or '').strip()
        if status_param:
            queryset = queryset.filter(status=status_param)

        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo bản ghi lương.')
        _ensure_workforce_month_unlocked(
            serializer.validated_data.get('month', ''),
            'Tháng lương đã khóa kỳ, không thể tạo bản ghi mới.',
        )
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật bản ghi lương.')
        month_value = serializer.validated_data.get('month', serializer.instance.month)
        _ensure_workforce_month_unlocked(
            month_value,
            'Tháng lương đã khóa kỳ, không thể cập nhật.',
        )
        serializer.save(updated_by=self.request.user)

    @staticmethod
    def _round_money(value: Decimal) -> Decimal:
        return value.quantize(Decimal('1'), rounding=ROUND_HALF_UP)

    @staticmethod
    def _payroll_marker(record: PayrollRecord) -> str:
        return f'[PAYROLL:{record.id}]'

    def _post_payroll_to_finance(self, record: PayrollRecord, actor):
        marker = self._payroll_marker(record)
        existing = CashTransaction.objects.filter(reason__icontains=marker).first()
        if existing:
            return {'created': False, 'transaction_id': existing.id, 'message': 'Đã có giao dịch lương cho bản ghi này.'}

        source_cash = CashAccount.objects.filter(is_active=True).order_by('id').first()
        if source_cash is None:
            return {'created': False, 'message': 'Không có tài khoản quỹ đang hoạt động để hạch toán lương.'}

        payroll_category, _ = TransactionCategory.objects.get_or_create(
            code='PAYROLL_EXPENSE',
            defaults={
                'name': 'Chi lương',
                'category_type': TransactionCategory.TYPE_EXPENSE,
                'color': '#cf1322',
                'note': 'Danh mục hệ thống cho hạch toán lương',
                'is_system': True,
                'is_active': True,
                'created_by': actor,
                'updated_by': actor,
            },
        )
        if not payroll_category.is_active:
            payroll_category.is_active = True
            payroll_category.updated_by = actor
            payroll_category.save(update_fields=['is_active', 'updated_by', 'updated_at', 'search_text'])

        tx_date = date.today()
        month_raw = (record.month or '').strip()
        if len(month_raw) == 7 and '-' in month_raw:
            year_str, month_str = month_raw.split('-', 1)
            if year_str.isdigit() and month_str.isdigit():
                try:
                    tx_date = date(int(year_str), int(month_str), 1)
                except ValueError:
                    tx_date = date.today()

        tx = CashTransaction.objects.create(
            transaction_type=CashTransaction.TYPE_EXPENSE,
            source_type=CashTransaction.SOURCE_CASH,
            source_cash_account=source_cash,
            category=payroll_category,
            transaction_date=tx_date,
            amount=record.net_pay,
            object_name=record.employee.name,
            reason=f'{marker} Chi lương tháng {record.month} - {record.employee.code}',
            note=f'Tự động hạch toán khi khóa bảng lương bởi {actor.username}',
            created_by=actor,
        )
        return {'created': True, 'transaction_id': tx.id, 'message': 'Đã hạch toán lương sang sổ quỹ.'}

    @action(detail=False, methods=['post'])
    def calculate_month(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền tính lương.'}, status=403)
        month = (request.data.get('month') or '').strip()
        overwrite = bool(request.data.get('overwrite', True))
        if not month:
            return Response({'error': 'month is required (YYYY-MM)'}, status=400)
        try:
            _ensure_workforce_month_unlocked(month, 'Tháng lương đã khóa kỳ, không thể tính lại.')
        except PermissionDenied as exc:
            return Response({'error': str(exc)}, status=400)

        employees = Employee.objects.filter(is_active=True).exclude(status=Employee.STATUS_RESIGNED).order_by('code')
        if not employees.exists():
            return Response({'error': 'Không có nhân viên hợp lệ để tính lương.'}, status=400)

        created_count = 0
        with transaction.atomic():
            if overwrite:
                PayrollRecord.objects.filter(month=month, status=PayrollRecord.STATUS_UNLOCKED).delete()

            for employee in employees:
                attendance = (
                    AttendanceRecord.objects
                    .prefetch_related('overtime_items')
                    .filter(employee=employee, month=month, is_active=True)
                    .first()
                )
                if attendance is None:
                    continue

                standard_days = Decimal(str(attendance.standard_days or 0))
                actual_days = Decimal(str(attendance.actual_days or 0))
                basic_salary = Decimal(str(employee.salary_basic or 0))
                if standard_days <= 0:
                    continue

                salary_by_attendance = self._round_money((basic_salary * actual_days) / standard_days)

                overtime_amount = Decimal('0')
                hourly_rate = Decimal('0')
                if standard_days > 0:
                    hourly_rate = basic_salary / (standard_days * Decimal('8'))
                for item in attendance.overtime_items.all():
                    item_hours = Decimal(str(item.hours or 0))
                    item_rate = Decimal(str(item.rate or 0))
                    overtime_amount += hourly_rate * item_hours * item_rate
                overtime_pay = self._round_money(overtime_amount)

                bonus_penalty_qs = BonusPenaltyRecord.objects.filter(employee=employee, month=month, is_active=True)
                total_bonus = Decimal('0')
                total_penalty = Decimal('0')
                for record in bonus_penalty_qs:
                    amount = Decimal(str(record.amount or 0))
                    if record.calculation_type == BonusPenaltyRecord.CALC_DAILY_RATIO and standard_days > 0:
                        amount = amount * (actual_days / standard_days)
                    amount = self._round_money(amount)
                    if record.record_type == BonusPenaltyRecord.TYPE_BONUS:
                        total_bonus += amount
                    else:
                        total_penalty += amount

                advance_deduction = (
                    SalaryAdvanceRecord.objects
                    .filter(
                        employee=employee,
                        month=month,
                        is_active=True,
                        status=SalaryAdvanceRecord.STATUS_UNDEDUCTED,
                        approval_status=SalaryAdvanceRecord.APPROVAL_APPROVED,
                    )
                    .aggregate(total=Sum('amount'))
                    .get('total') or Decimal('0')
                )
                advance_deduction = self._round_money(Decimal(str(advance_deduction)))

                total_income = self._round_money(salary_by_attendance + overtime_pay + total_bonus)
                total_deductions = self._round_money(total_penalty + advance_deduction)
                net_pay = self._round_money(total_income - total_deductions)

                payroll, created = PayrollRecord.objects.get_or_create(
                    employee=employee,
                    month=month,
                    defaults={'created_by': request.user},
                )
                payroll.standard_days = standard_days
                payroll.actual_days = actual_days
                payroll.basic_salary = basic_salary
                payroll.salary_by_attendance = salary_by_attendance
                payroll.overtime_pay = overtime_pay
                payroll.total_bonus = total_bonus
                payroll.total_penalty = total_penalty
                payroll.advance_deduction = advance_deduction
                payroll.total_income = total_income
                payroll.total_deductions = total_deductions
                payroll.net_pay = net_pay
                payroll.status = PayrollRecord.STATUS_UNLOCKED
                payroll.updated_by = request.user
                if payroll.created_by_id is None:
                    payroll.created_by = request.user
                payroll.save()
                created_count += 1

            SalaryAdvanceRecord.objects.filter(
                month=month,
                status=SalaryAdvanceRecord.STATUS_UNDEDUCTED,
                approval_status=SalaryAdvanceRecord.APPROVAL_APPROVED,
                is_active=True,
                employee__is_active=True,
            ).update(status=SalaryAdvanceRecord.STATUS_DEDUCTED, updated_by=request.user)

        return Response({'success': True, 'month': month, 'count': created_count})

    @action(detail=True, methods=['post'])
    def lock(self, request, pk=None):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền khóa bảng lương.'}, status=403)
        record = self.get_object()
        _ensure_workforce_month_unlocked(record.month, 'Tháng lương đã khóa kỳ, không thể thao tác khóa/mở khóa bản ghi.')
        record.status = PayrollRecord.STATUS_LOCKED
        record.updated_by = request.user
        record.save(update_fields=['status', 'updated_by', 'updated_at'])
        posting = self._post_payroll_to_finance(record, request.user)
        return Response({'success': True, 'status': record.status, 'finance_posting': posting})

    @action(detail=True, methods=['post'])
    def unlock(self, request, pk=None):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền mở khóa bảng lương.'}, status=403)
        record = self.get_object()
        _ensure_workforce_month_unlocked(record.month, 'Tháng lương đã khóa kỳ, không thể thao tác khóa/mở khóa bản ghi.')
        record.status = PayrollRecord.STATUS_UNLOCKED
        record.updated_by = request.user
        record.save(update_fields=['status', 'updated_by', 'updated_at'])
        return Response({'success': True, 'status': record.status})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa bản ghi lương.'}, status=403)
        instance = self.get_object()
        _ensure_workforce_month_unlocked(
            instance.month,
            'Tháng lương đã khóa kỳ, không thể xóa bản ghi.',
        )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'])
    def locked_months(self, request):
        return Response({'months': sorted(_get_locked_workforce_months())})

    @action(detail=False, methods=['post'])
    def lock_month(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền khóa kỳ lương.'}, status=403)
        month = _normalize_month(str(request.data.get('month') or ''))
        if not month:
            return Response({'error': 'month phải có dạng YYYY-MM'}, status=400)
        months = _get_locked_workforce_months()
        months.add(month)
        _save_locked_workforce_months(months)
        return Response({'success': True, 'months': sorted(months)})

    @action(detail=False, methods=['post'])
    def unlock_month(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền mở khóa kỳ lương.'}, status=403)
        month = _normalize_month(str(request.data.get('month') or ''))
        if not month:
            return Response({'error': 'month phải có dạng YYYY-MM'}, status=400)
        months = _get_locked_workforce_months()
        months.discard(month)
        _save_locked_workforce_months(months)
        return Response({'success': True, 'months': sorted(months)})
