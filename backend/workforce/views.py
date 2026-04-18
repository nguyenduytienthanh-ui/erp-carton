from decimal import Decimal, ROUND_HALF_UP
from datetime import date, timedelta
import json

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from unidecode import unidecode

from core.permissions import check_action_permission
from core.models import ApprovalHistory, AuditLog, Notification, Setting
from finance.models import BankAccount, CashAccount, CashTransaction, TransactionCategory

from .models import (
    AttendanceRecord,
    BonusPenaltyRecord,
    Employee,
    EmployeeProfileHistory,
    PayrollRecord,
    SalaryAdvanceRecord,
)
from .serializers import (
    AttendanceRecordSerializer,
    BonusPenaltyRecordSerializer,
    EmployeeSerializer,
    EmployeeProfileHistorySerializer,
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
WORKFORCE_PAYROLL_POSTING_DEFAULT_KEY = 'WORKFORCE_PAYROLL_POSTING_DEFAULT'
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


def _get_json_setting(key: str) -> dict:
    row = Setting.objects.filter(key=key, is_active=True).first()
    if not row:
        return {}
    try:
        payload = json.loads(str(row.value or '{}'))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _save_json_setting(key: str, payload: dict, description: str):
    Setting.objects.update_or_create(
        key=key,
        defaults={
            'value': json.dumps(payload or {}),
            'data_type': 'json',
            'description': description,
            'is_active': True,
        },
    )


def _resolve_cash_bank_source(payload: dict | None, *, setting_key: str = '') -> tuple[dict | None, str]:
    raw = payload or {}
    if not raw and setting_key:
        raw = _get_json_setting(setting_key)
    source_type = str(raw.get('source_type') or '').strip().upper()
    if source_type not in {CashTransaction.SOURCE_CASH, CashTransaction.SOURCE_BANK}:
        return None, 'Chưa cấu hình nguồn tiền hợp lệ.'
    if source_type == CashTransaction.SOURCE_CASH:
        source_cash_id = raw.get('source_cash_account')
        if not str(source_cash_id or '').isdigit():
            return None, 'Phải chọn tài khoản quỹ nguồn.'
        account = CashAccount.objects.filter(pk=int(source_cash_id), is_active=True).first()
        if account is None:
            return None, 'Tài khoản quỹ nguồn không còn hiệu lực.'
        return {
            'source_type': CashTransaction.SOURCE_CASH,
            'source_cash_account': account,
            'source_bank_account': None,
            'source_cash_account_id': int(account.id),
            'source_bank_account_id': None,
        }, ''
    source_bank_id = raw.get('source_bank_account')
    if not str(source_bank_id or '').isdigit():
        return None, 'Phải chọn tài khoản ngân hàng nguồn.'
    bank = BankAccount.objects.filter(pk=int(source_bank_id), is_active=True).first()
    if bank is None:
        return None, 'Tài khoản ngân hàng nguồn không còn hiệu lực.'
    return {
        'source_type': CashTransaction.SOURCE_BANK,
        'source_cash_account': None,
        'source_bank_account': bank,
        'source_cash_account_id': None,
        'source_bank_account_id': int(bank.id),
    }, ''


def _employee_dependency_summary(employee: Employee) -> list[dict]:
    checks = [
        ('attendance_records', 'chấm công'),
        ('bonus_penalty_records', 'thưởng/phạt'),
        ('salary_advances', 'ứng lương'),
        ('payroll_records', 'bảng lương'),
        ('profile_histories', 'lịch sử hiệu lực'),
    ]
    results: list[dict] = []
    for relation_name, label in checks:
        try:
            count = getattr(employee, relation_name).count()
        except Exception:
            count = 0
        if count > 0:
            results.append({'code': relation_name, 'label': label, 'count': int(count)})
    return results


def _ensure_workforce_month_unlocked(month: str, message: str):
    normalized = _normalize_month(month)
    if not normalized:
        return
    if normalized in _get_locked_workforce_months():
        raise PermissionDenied(message)


def _ensure_workforce_months_unlocked(months: list[str], message: str):
    for month in months:
        _ensure_workforce_month_unlocked(month, message)


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


def _workforce_approval_history_label(action: str, level: int = 1) -> str:
    normalized = str(action or '').upper()
    if normalized == 'SUBMIT':
        return 'Gửi duyệt'
    if normalized == 'RESUBMIT':
        return 'Gửi lại'
    if normalized == 'APPROVE' and int(level or 1) >= 2:
        return 'Duyệt cấp 2'
    if normalized == 'APPROVE':
        return 'Duyệt cấp 1'
    if normalized == 'REJECT':
        return 'Từ chối'
    if normalized == 'REVOKE':
        return 'Thu hồi'
    return normalized or 'Cập nhật'


def _serialize_workforce_approval_history_row(item: ApprovalHistory) -> dict:
    action_key = str(item.action or '').upper()
    if action_key == 'APPROVE':
        action_key = 'APPROVE_L2' if int(item.level or 1) >= 2 else 'APPROVE_L1'
    return {
        'action': action_key,
        'action_label': _workforce_approval_history_label(item.action, int(item.level or 1)),
        'level': int(item.level or 1),
        'user': getattr(item.user, 'username', None),
        'comments': item.comments,
        'created_at': item.created_at,
    }


def _serialize_workforce_approval_history_log(log: AuditLog) -> dict | None:
    old_values = log.old_values or {}
    new_values = log.new_values or {}
    changed_fields = {str(field) for field in (log.changed_fields or [])}
    old_status = str(old_values.get('approval_status') or '').upper()
    new_status = str(new_values.get('approval_status') or '').upper()
    action = ''
    level = 1
    if new_status == SalaryAdvanceRecord.APPROVAL_PENDING_L1:
        action = 'RESUBMIT' if old_status == SalaryAdvanceRecord.APPROVAL_REJECTED else 'SUBMIT'
    elif new_status == SalaryAdvanceRecord.APPROVAL_PENDING_L2 or 'approved_level1_at' in changed_fields:
        action = 'APPROVE_L1'
        level = 1
    elif new_status == SalaryAdvanceRecord.APPROVAL_APPROVED:
        action = 'APPROVE_L2' if 'approved_level2_at' in changed_fields else 'APPROVE_L1'
        level = 2 if action == 'APPROVE_L2' else 1
    elif new_status == SalaryAdvanceRecord.APPROVAL_REJECTED:
        action = 'REJECT'
        level = 2 if old_status == SalaryAdvanceRecord.APPROVAL_PENDING_L2 else 1
    if not action:
        return None
    base_action = 'APPROVE' if action.startswith('APPROVE') else action
    return {
        'action': action,
        'action_label': _workforce_approval_history_label(base_action, level),
        'level': level,
        'user': getattr(log.user, 'username', None),
        'comments': str(new_values.get('rejection_reason') or ''),
        'created_at': log.created_at,
    }


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


def _ensure_finance_month_unlocked_for_payroll(month: str):
    normalized = _normalize_month(month)
    if normalized and normalized in _get_locked_finance_months():
        raise PermissionDenied(f'Tháng tài chính {normalized} đang khóa, không thể đồng bộ hạch toán lương.')


def _workforce_close_check_entry(code: str, severity: str, title: str, message: str, count: int = 0, items: list[dict] | None = None) -> dict:
    return {
        'code': code,
        'severity': severity,
        'title': title,
        'message': message,
        'count': int(count or 0),
        'items': items or [],
    }


def _build_workforce_month_close_check(month: str) -> dict:
    month = _normalize_month(month)
    blockers: list[dict] = []
    warnings: list[dict] = []
    if not month:
        return {
            'month': '',
            'is_ready': False,
            'blockers': [
                _workforce_close_check_entry(
                    code='INVALID_MONTH',
                    severity='blocker',
                    title='Tháng không hợp lệ',
                    message='month phải có dạng YYYY-MM.',
                )
            ],
            'warnings': [],
        }

    active_employees = Employee.objects.filter(is_active=True).exclude(status=Employee.STATUS_RESIGNED).order_by('code')
    attendance_qs = AttendanceRecord.objects.filter(month=month, is_active=True).select_related('employee')
    payroll_qs = PayrollRecord.objects.filter(month=month).select_related('employee')
    approved_undeducted_advances = list(
        SalaryAdvanceRecord.objects
        .filter(
            month=month,
            is_active=True,
            approval_status=SalaryAdvanceRecord.APPROVAL_APPROVED,
            status=SalaryAdvanceRecord.STATUS_UNDEDUCTED,
        )
        .select_related('employee')
        .order_by('employee__code', 'id')
    )

    attendance_employee_ids = set(attendance_qs.values_list('employee_id', flat=True))
    payroll_employee_ids = set(payroll_qs.values_list('employee_id', flat=True))

    missing_attendance_qs = active_employees.exclude(id__in=attendance_employee_ids)
    if missing_attendance_qs.exists():
        sample_items = [
            {'employee_id': int(row.id), 'employee_code': row.code, 'employee_name': row.name}
            for row in missing_attendance_qs[:10]
        ]
        blockers.append(_workforce_close_check_entry(
            code='MISSING_ATTENDANCE',
            severity='blocker',
            title='Thiếu chấm công',
            message='Còn nhân viên đang làm chưa có dữ liệu chấm công trong tháng.',
            count=missing_attendance_qs.count(),
            items=sample_items,
        ))

    missing_payroll_qs = attendance_qs.exclude(employee_id__in=payroll_employee_ids)
    if missing_payroll_qs.exists():
        sample_items = [
            {'employee_id': int(row.employee_id), 'employee_code': row.employee.code, 'employee_name': row.employee.name}
            for row in missing_payroll_qs[:10]
        ]
        blockers.append(_workforce_close_check_entry(
            code='MISSING_PAYROLL',
            severity='blocker',
            title='Thiếu bản ghi lương',
            message='Đã có chấm công nhưng chưa sinh đủ bản ghi lương cho tháng.',
            count=missing_payroll_qs.count(),
            items=sample_items,
        ))

    unlocked_payroll_qs = payroll_qs.exclude(status=PayrollRecord.STATUS_LOCKED)
    if unlocked_payroll_qs.exists():
        sample_items = [
            {'payroll_id': int(row.id), 'employee_code': row.employee.code, 'employee_name': row.employee.name}
            for row in unlocked_payroll_qs[:10]
        ]
        blockers.append(_workforce_close_check_entry(
            code='UNLOCKED_PAYROLL',
            severity='blocker',
            title='Còn bảng lương chưa khóa',
            message='Tất cả bản ghi lương trong tháng phải được khóa trước khi khóa kỳ.',
            count=unlocked_payroll_qs.count(),
            items=sample_items,
        ))

    disbursed_undeducted_advances = [row for row in approved_undeducted_advances if _is_salary_advance_disbursed(row)]
    disbursed_ids = {int(row.id) for row in disbursed_undeducted_advances}
    approved_not_disbursed_advances = [row for row in approved_undeducted_advances if int(row.id) not in disbursed_ids]

    if disbursed_undeducted_advances:
        sample_items = [
            {
                'advance_id': int(row.id),
                'employee_code': row.employee.code,
                'employee_name': row.employee.name,
                'amount': str(row.amount),
            }
            for row in disbursed_undeducted_advances[:10]
        ]
        blockers.append(_workforce_close_check_entry(
            code='UNDEDUCTED_DISBURSED_ADVANCES',
            severity='blocker',
            title='Ứng lương đã chi chưa khấu trừ',
            message='Còn phiếu ứng lương đã chi tiền thực tế nhưng chưa được khấu trừ vào bảng lương tháng.',
            count=len(disbursed_undeducted_advances),
            items=sample_items,
        ))

    if approved_not_disbursed_advances:
        sample_items = [
            {
                'advance_id': int(row.id),
                'employee_code': row.employee.code,
                'employee_name': row.employee.name,
                'amount': str(row.amount),
            }
            for row in approved_not_disbursed_advances[:10]
        ]
        warnings.append(_workforce_close_check_entry(
            code='APPROVED_ADVANCES_NOT_DISBURSED',
            severity='warning',
            title='Ứng lương đã duyệt nhưng chưa chi',
            message='Có phiếu ứng lương đã duyệt nhưng chưa có chứng từ chi tiền thực tế; các phiếu này sẽ chưa bị khấu trừ.',
            count=len(approved_not_disbursed_advances),
            items=sample_items,
        ))

    if not payroll_qs.exists():
        warnings.append(_workforce_close_check_entry(
            code='NO_PAYROLL_ROWS',
            severity='warning',
            title='Chưa có bản ghi lương',
            message='Tháng này hiện chưa có bản ghi lương nào. Nên tính lương trước khi khóa kỳ.',
        ))

    return {
        'month': month,
        'is_ready': len(blockers) == 0,
        'blockers': blockers,
        'warnings': warnings,
    }


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


def _month_from_date_value(value) -> str:
    if value:
        try:
            return value.strftime('%Y-%m')
        except Exception:
            return ''
    return ''


def _current_month_key() -> str:
    return timezone.localdate().strftime('%Y-%m')


def _default_profile_effective_month(employee: Employee) -> str:
    return _month_from_date_value(getattr(employee, 'start_date', None)) or _current_month_key()


def _upsert_employee_profile_history(employee: Employee, effective_month: str, actor, note: str = '') -> EmployeeProfileHistory:
    normalized_month = _normalize_month(effective_month) or _default_profile_effective_month(employee)
    history, created = EmployeeProfileHistory.objects.get_or_create(
        employee=employee,
        effective_month=normalized_month,
        defaults={
            'salary_basic': employee.salary_basic,
            'department': employee.department,
            'position': employee.position,
            'status': employee.status,
            'note': note or '',
            'created_by': actor,
            'updated_by': actor,
        },
    )
    if not created:
        history.salary_basic = employee.salary_basic
        history.department = employee.department
        history.position = employee.position
        history.status = employee.status
        if note:
            history.note = note
        history.updated_by = actor
        history.save()
    return history


def _resolve_employee_profile_for_month(employee: Employee, month: str) -> dict:
    normalized_month = _normalize_month(month)
    history = (
        EmployeeProfileHistory.objects
        .filter(employee=employee, effective_month__lte=normalized_month)
        .order_by('-effective_month', '-id')
        .first()
    )
    if history:
        return {
            'effective_month': history.effective_month,
            'salary_basic': Decimal(str(history.salary_basic or 0)),
            'department': history.department,
            'position': history.position,
            'status': history.status,
        }
    return {
        'effective_month': '',
        'salary_basic': Decimal(str(employee.salary_basic or 0)),
        'department': employee.department,
        'position': employee.position,
        'status': employee.status,
    }


def _sync_employee_current_snapshot_from_history(employee: Employee, actor):
    current_month = _current_month_key()
    latest = (
        EmployeeProfileHistory.objects
        .filter(employee=employee, effective_month__lte=current_month)
        .order_by('-effective_month', '-id')
        .first()
    )
    if latest is None:
        return
    changed_fields: list[str] = []
    if str(employee.salary_basic or 0) != str(latest.salary_basic or 0):
        employee.salary_basic = latest.salary_basic
        changed_fields.append('salary_basic')
    if (employee.department or '') != (latest.department or ''):
        employee.department = latest.department
        changed_fields.append('department')
    if (employee.position or '') != (latest.position or ''):
        employee.position = latest.position
        changed_fields.append('position')
    if (employee.status or '') != (latest.status or ''):
        employee.status = latest.status
        changed_fields.append('status')
    if changed_fields:
        employee.updated_by = actor
        changed_fields.extend(['updated_by', 'updated_at', 'search_text'])
        employee.save(update_fields=changed_fields)


def _apply_payroll_profile_snapshot(record: PayrollRecord, profile: dict):
    record.profile_effective_month = str(profile.get('effective_month') or '')
    record.employee_department_snapshot = str(profile.get('department') or '')
    record.employee_position_snapshot = str(profile.get('position') or '')


def _salary_advance_disbursement_marker(row: SalaryAdvanceRecord) -> str:
    return f'[SALADV:{row.id}]'


def _get_salary_advance_disbursement_tx(row: SalaryAdvanceRecord, *, lock_for_update: bool = False):
    qs = CashTransaction.objects.filter(reason__icontains=_salary_advance_disbursement_marker(row)).order_by('-id')
    if lock_for_update:
        qs = qs.select_for_update()
    return qs.first()


def _is_salary_advance_disbursed(row: SalaryAdvanceRecord) -> bool:
    return _get_salary_advance_disbursement_tx(row) is not None


def _ensure_salary_advance_disbursement_category(actor):
    category, _ = TransactionCategory.objects.get_or_create(
        code='SALADV_DISB',
        defaults={
            'name': 'Chi ứng lương',
            'category_type': TransactionCategory.TYPE_EXPENSE,
            'color': '#cf1322',
            'note': 'Danh mục hệ thống cho chi tiền ứng lương',
            'is_system': True,
            'is_active': True,
            'created_by': actor,
            'updated_by': actor,
        },
    )
    if not category.is_active:
        category.is_active = True
        category.updated_by = actor
        category.save(update_fields=['is_active', 'updated_by', 'updated_at', 'search_text'])
    return category


class SearchTextMixin:
    search_text_field = 'search_text'

    def check_module_read_permission(self):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền xem dữ liệu nhân sự.')

    def apply_search(self, queryset):
        self.check_module_read_permission()
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
        profile_effective_month = str(serializer.validated_data.pop('profile_effective_month', '') or '').strip()
        instance = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        history = _upsert_employee_profile_history(
            instance,
            profile_effective_month or _default_profile_effective_month(instance),
            self.request.user,
            note='Khởi tạo hồ sơ hiệu lực ban đầu',
        )
        _log_workforce_audit(
            self.request.user, action='CREATE', entity_type='WorkforceEmployee',
            entity_id=int(instance.id), entity_code=instance.code or str(instance.id),
            old_values={},
            new_values={
                'code': instance.code,
                'name': instance.name,
                'department': instance.department,
                'status': instance.status,
                'profile_effective_month': history.effective_month,
            },
            changed_fields=['code', 'name', 'department', 'status', 'profile_effective_month'],
        )

    def perform_update(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật nhân viên.')
        old = serializer.instance
        profile_effective_month = str(serializer.validated_data.pop('profile_effective_month', '') or '').strip()
        history_changed = any(field in serializer.validated_data for field in {'salary_basic', 'department', 'position', 'status'})
        old_snap = {'code': old.code, 'name': old.name, 'department': old.department, 'status': old.status, 'salary_basic': str(old.salary_basic or 0)}
        instance = serializer.save(updated_by=self.request.user)
        if history_changed or not instance.profile_histories.exists():
            _upsert_employee_profile_history(
                instance,
                profile_effective_month or _current_month_key(),
                self.request.user,
                note='Cập nhật từ hồ sơ nhân viên',
            )
        _log_workforce_audit(
            self.request.user, action='UPDATE', entity_type='WorkforceEmployee',
            entity_id=int(instance.id), entity_code=instance.code or str(instance.id),
            old_values=old_snap,
            new_values={'code': instance.code, 'name': instance.name, 'department': instance.department, 'status': instance.status, 'salary_basic': str(instance.salary_basic or 0)},
            changed_fields=list(serializer.validated_data.keys()),
        )

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu nhân sự.'}, status=403)
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'No IDs provided'}, status=400)
        employees = list(Employee.objects.filter(id__in=ids))
        blocking = []
        for employee in employees:
            deps = _employee_dependency_summary(employee)
            if deps:
                blocking.append({
                    'id': int(employee.id),
                    'code': employee.code,
                    'name': employee.name,
                    'dependencies': deps,
                })
        if blocking:
            return Response({
                'error': 'Có nhân viên đã phát sinh dữ liệu, không được xóa cứng.',
                'items': blocking,
            }, status=400)
        deleted_count, _ = Employee.objects.filter(id__in=[row.id for row in employees]).delete()
        return Response({'success': True, 'count': deleted_count})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu nhân sự.'}, status=403)
        instance = self.get_object()
        dependencies = _employee_dependency_summary(instance)
        if dependencies:
            return Response({
                'error': 'Nhân viên đã phát sinh dữ liệu, không được xóa cứng.',
                'dependencies': dependencies,
            }, status=400)
        snap = {'code': instance.code, 'name': instance.name}
        response = super().destroy(request, *args, **kwargs)
        _log_workforce_audit(
            request.user, action='DELETE', entity_type='WorkforceEmployee',
            entity_id=int(instance.id), entity_code=instance.code or str(instance.id),
            old_values=snap, new_values={}, changed_fields=['deleted'],
        )
        return response


class EmployeeProfileHistoryViewSet(SearchTextMixin, viewsets.ModelViewSet):
    queryset = EmployeeProfileHistory.objects.select_related('employee')
    serializer_class = EmployeeProfileHistorySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ['effective_month', 'employee__code', 'salary_basic', 'created_at']
    ordering = ['employee__code', '-effective_month']

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params
        employee_id = (params.get('employee') or '').strip()
        if employee_id.isdigit():
            queryset = queryset.filter(employee_id=int(employee_id))
        effective_month = _normalize_month(str(params.get('effective_month') or '').strip())
        if effective_month:
            queryset = queryset.filter(effective_month=effective_month)
        return self.apply_search(queryset)

    def perform_create(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền tạo lịch sử hiệu lực nhân sự.')
        instance = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        _sync_employee_current_snapshot_from_history(instance.employee, self.request.user)
        _log_workforce_audit(
            self.request.user,
            action='CREATE',
            entity_type='WorkforceEmployeeProfileHistory',
            entity_id=int(instance.id),
            entity_code=f'{instance.employee.code}-{instance.effective_month}',
            old_values={},
            new_values={
                'employee_id': int(instance.employee_id),
                'effective_month': instance.effective_month,
                'salary_basic': str(instance.salary_basic),
                'department': instance.department,
                'position': instance.position,
                'status': instance.status,
            },
            changed_fields=['employee_id', 'effective_month', 'salary_basic', 'department', 'position', 'status'],
        )

    def perform_update(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật lịch sử hiệu lực nhân sự.')
        old = serializer.instance
        old_snap = {
            'employee_id': int(old.employee_id),
            'effective_month': old.effective_month,
            'salary_basic': str(old.salary_basic),
            'department': old.department,
            'position': old.position,
            'status': old.status,
        }
        instance = serializer.save(updated_by=self.request.user)
        _sync_employee_current_snapshot_from_history(instance.employee, self.request.user)
        _log_workforce_audit(
            self.request.user,
            action='UPDATE',
            entity_type='WorkforceEmployeeProfileHistory',
            entity_id=int(instance.id),
            entity_code=f'{instance.employee.code}-{instance.effective_month}',
            old_values=old_snap,
            new_values={
                'employee_id': int(instance.employee_id),
                'effective_month': instance.effective_month,
                'salary_basic': str(instance.salary_basic),
                'department': instance.department,
                'position': instance.position,
                'status': instance.status,
            },
            changed_fields=list(serializer.validated_data.keys()),
        )

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa lịch sử hiệu lực nhân sự.'}, status=403)
        instance = self.get_object()
        employee = instance.employee
        snap = {
            'employee_id': int(instance.employee_id),
            'effective_month': instance.effective_month,
            'salary_basic': str(instance.salary_basic),
        }
        response = super().destroy(request, *args, **kwargs)
        _sync_employee_current_snapshot_from_history(employee, request.user)
        _log_workforce_audit(
            request.user,
            action='DELETE',
            entity_type='WorkforceEmployeeProfileHistory',
            entity_id=int(instance.id),
            entity_code=f'{employee.code}-{snap["effective_month"]}',
            old_values=snap,
            new_values={},
            changed_fields=['deleted'],
        )
        return response


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
        _ensure_workforce_month_unlocked(
            serializer.validated_data.get('month', ''),
            'Tháng lương đã khóa kỳ, không thể tạo dữ liệu chấm công.',
        )
        instance = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        _log_workforce_audit(
            self.request.user, action='CREATE', entity_type='WorkforceAttendance',
            entity_id=int(instance.id), entity_code=f'{instance.employee_id}-{instance.month}',
            old_values={},
            new_values={'month': instance.month, 'actual_days': str(instance.actual_days), 'standard_days': str(instance.standard_days)},
            changed_fields=['month', 'actual_days', 'standard_days'],
        )

    def perform_update(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật dữ liệu chấm công.')
        _ensure_workforce_months_unlocked(
            [serializer.instance.month, serializer.validated_data.get('month', serializer.instance.month)],
            'Tháng lương đã khóa kỳ, không thể cập nhật dữ liệu chấm công.',
        )
        old = serializer.instance
        old_snap = {'month': old.month, 'actual_days': str(old.actual_days), 'standard_days': str(old.standard_days)}
        instance = serializer.save(updated_by=self.request.user)
        _log_workforce_audit(
            self.request.user, action='UPDATE', entity_type='WorkforceAttendance',
            entity_id=int(instance.id), entity_code=f'{instance.employee_id}-{instance.month}',
            old_values=old_snap,
            new_values={'month': instance.month, 'actual_days': str(instance.actual_days), 'standard_days': str(instance.standard_days)},
            changed_fields=list(serializer.validated_data.keys()),
        )

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu chấm công.'}, status=403)
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'No IDs provided'}, status=400)
        rows = list(AttendanceRecord.objects.filter(id__in=ids))
        for row in rows:
            _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể xóa dữ liệu chấm công.')
        deleted_ids = [int(row.id) for row in rows]
        deleted_count, _ = AttendanceRecord.objects.filter(id__in=ids).delete()
        if deleted_ids:
            _log_workforce_audit(
                request.user,
                action='DELETE',
                entity_type='WorkforceAttendanceBulkDelete',
                entity_id=0,
                entity_code='bulk_delete',
                old_values={'ids': deleted_ids},
                new_values={},
                changed_fields=['deleted_ids'],
            )
        return Response({'success': True, 'count': deleted_count})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu chấm công.'}, status=403)
        instance = self.get_object()
        _ensure_workforce_month_unlocked(instance.month, 'Tháng lương đã khóa kỳ, không thể xóa dữ liệu chấm công.')
        snap = {'month': instance.month, 'employee_id': instance.employee_id}
        response = super().destroy(request, *args, **kwargs)
        _log_workforce_audit(
            request.user, action='DELETE', entity_type='WorkforceAttendance',
            entity_id=int(instance.id), entity_code=f'{instance.employee_id}-{instance.month}',
            old_values=snap, new_values={}, changed_fields=['deleted'],
        )
        return response


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
        _ensure_workforce_month_unlocked(
            serializer.validated_data.get('month', ''),
            'Tháng lương đã khóa kỳ, không thể tạo dữ liệu thưởng phạt.',
        )
        instance = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        _log_workforce_audit(
            self.request.user, action='CREATE', entity_type='WorkforceBonusPenalty',
            entity_id=int(instance.id), entity_code=str(instance.id),
            old_values={},
            new_values={'month': instance.month, 'record_type': instance.record_type, 'amount': str(instance.amount), 'reason': instance.reason},
            changed_fields=['month', 'record_type', 'amount', 'reason'],
        )

    def perform_update(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật dữ liệu thưởng phạt.')
        _ensure_workforce_months_unlocked(
            [serializer.instance.month, serializer.validated_data.get('month', serializer.instance.month)],
            'Tháng lương đã khóa kỳ, không thể cập nhật dữ liệu thưởng phạt.',
        )
        old = serializer.instance
        old_snap = {'month': old.month, 'record_type': old.record_type, 'amount': str(old.amount)}
        instance = serializer.save(updated_by=self.request.user)
        _log_workforce_audit(
            self.request.user, action='UPDATE', entity_type='WorkforceBonusPenalty',
            entity_id=int(instance.id), entity_code=str(instance.id),
            old_values=old_snap,
            new_values={'month': instance.month, 'record_type': instance.record_type, 'amount': str(instance.amount)},
            changed_fields=list(serializer.validated_data.keys()),
        )

    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu thưởng phạt.'}, status=403)
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'No IDs provided'}, status=400)
        rows = list(BonusPenaltyRecord.objects.filter(id__in=ids))
        for row in rows:
            _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể xóa dữ liệu thưởng phạt.')
        deleted_ids = [int(row.id) for row in rows]
        deleted_count, _ = BonusPenaltyRecord.objects.filter(id__in=ids).delete()
        if deleted_ids:
            _log_workforce_audit(
                request.user,
                action='DELETE',
                entity_type='WorkforceBonusPenaltyBulkDelete',
                entity_id=0,
                entity_code='bulk_delete',
                old_values={'ids': deleted_ids},
                new_values={},
                changed_fields=['deleted_ids'],
            )
        return Response({'success': True, 'count': deleted_count})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa dữ liệu thưởng phạt.'}, status=403)
        instance = self.get_object()
        _ensure_workforce_month_unlocked(instance.month, 'Tháng lương đã khóa kỳ, không thể xóa dữ liệu thưởng phạt.')
        snap = {'month': instance.month, 'record_type': instance.record_type, 'amount': str(instance.amount)}
        response = super().destroy(request, *args, **kwargs)
        _log_workforce_audit(
            request.user, action='DELETE', entity_type='WorkforceBonusPenalty',
            entity_id=int(instance.id), entity_code=str(instance.id),
            old_values=snap, new_values={}, changed_fields=['deleted'],
        )
        return response


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
            status=SalaryAdvanceRecord.STATUS_UNDEDUCTED,
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
        old = serializer.instance
        old_snap = {
            'employee_id': int(old.employee_id),
            'month': old.month,
            'amount': str(old.amount),
            'status': old.status,
            'approval_status': old.approval_status,
        }
        instance = serializer.save(
            updated_by=self.request.user,
            status=serializer.instance.status,
            required_approval_level=_salary_advance_required_level(amount),
        )
        _log_workforce_audit(
            self.request.user,
            action='UPDATE',
            entity_type='WorkforceSalaryAdvanceApproval',
            entity_id=int(instance.id),
            entity_code=str(instance.id),
            old_values=old_snap,
            new_values={
                'employee_id': int(instance.employee_id),
                'month': instance.month,
                'amount': str(instance.amount),
                'status': instance.status,
                'approval_status': instance.approval_status,
                'required_approval_level': instance.required_approval_level,
            },
            changed_fields=list(serializer.validated_data.keys()),
        )

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
        deleted_ids = list(rows.values_list('id', flat=True))
        deleted_count, _ = rows.delete()
        if deleted_ids:
            _log_workforce_audit(
                request.user,
                action='DELETE',
                entity_type='WorkforceSalaryAdvanceApprovalBulkDelete',
                entity_id=0,
                entity_code='bulk_delete',
                old_values={'ids': [int(item) for item in deleted_ids]},
                new_values={},
                changed_fields=['deleted_ids'],
            )
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
        snap = {
            'employee_id': int(row.employee_id),
            'month': row.month,
            'amount': str(row.amount),
            'status': row.status,
        }
        response = super().destroy(request, *args, **kwargs)
        _log_workforce_audit(
            request.user,
            action='DELETE',
            entity_type='WorkforceSalaryAdvanceApproval',
            entity_id=int(row.id),
            entity_code=str(row.id),
            old_values=snap,
            new_values={},
            changed_fields=['deleted'],
        )
        return response

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
        with transaction.atomic():
            try:
                row = SalaryAdvanceRecord.objects.select_for_update().get(pk=pk)
            except SalaryAdvanceRecord.DoesNotExist:
                return Response({'error': 'Không tìm thấy bản ghi ứng lương.'}, status=404)
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
            ApprovalHistory.objects.create(
                entity_type='SalaryAdvanceRecord',
                entity_id=row.id,
                entity_code=str(row.id),
                action='RESUBMIT' if old_status == SalaryAdvanceRecord.APPROVAL_REJECTED else 'SUBMIT',
                user=request.user,
                level=1,
            )
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
        with transaction.atomic():
            try:
                row = SalaryAdvanceRecord.objects.select_for_update().get(pk=pk)
            except SalaryAdvanceRecord.DoesNotExist:
                return Response({'error': 'Không tìm thấy bản ghi ứng lương.'}, status=404)
            if row.submitted_by_id and row.submitted_by_id == request.user.id:
                return Response({'error': 'Người gửi duyệt không thể tự phê duyệt ứng lương của mình.'}, status=403)
            _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể duyệt ứng lương.')
            if row.approval_status != SalaryAdvanceRecord.APPROVAL_PENDING_L1:
                return Response({'error': 'Ứng lương không ở trạng thái chờ duyệt cấp 1.'}, status=400)
            old_status = row.approval_status
            row.approval_status = SalaryAdvanceRecord.APPROVAL_APPROVED if int(row.required_approval_level or 1) <= 1 else SalaryAdvanceRecord.APPROVAL_PENDING_L2
            row.approved_level1_at = timezone.now()
            row.approved_level1_by = request.user
            row.updated_by = request.user
            row.save(update_fields=['approval_status', 'approved_level1_at', 'approved_level1_by', 'updated_by', 'updated_at', 'search_text'])
            ApprovalHistory.objects.create(
                entity_type='SalaryAdvanceRecord',
                entity_id=row.id,
                entity_code=str(row.id),
                action='APPROVE',
                user=request.user,
                level=1,
            )
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
        with transaction.atomic():
            try:
                row = SalaryAdvanceRecord.objects.select_for_update().get(pk=pk)
            except SalaryAdvanceRecord.DoesNotExist:
                return Response({'error': 'Không tìm thấy bản ghi ứng lương.'}, status=404)
            if row.submitted_by_id and row.submitted_by_id == request.user.id:
                return Response({'error': 'Người gửi duyệt không thể tự phê duyệt ứng lương của mình.'}, status=403)
            if row.approved_level1_by_id and row.approved_level1_by_id == request.user.id and int(row.required_approval_level or 1) >= 2:
                return Response({'error': 'Người đã duyệt cấp 1 không thể đồng thời duyệt cấp 2 cho cùng bản ghi.'}, status=403)
            _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể duyệt ứng lương.')
            if row.approval_status != SalaryAdvanceRecord.APPROVAL_PENDING_L2:
                return Response({'error': 'Ứng lương không ở trạng thái chờ duyệt cấp 2.'}, status=400)
            old_status = row.approval_status
            row.approval_status = SalaryAdvanceRecord.APPROVAL_APPROVED
            row.approved_level2_at = timezone.now()
            row.approved_level2_by = request.user
            row.updated_by = request.user
            row.save(update_fields=['approval_status', 'approved_level2_at', 'approved_level2_by', 'updated_by', 'updated_at', 'search_text'])
            ApprovalHistory.objects.create(
                entity_type='SalaryAdvanceRecord',
                entity_id=row.id,
                entity_code=str(row.id),
                action='APPROVE',
                user=request.user,
                level=2,
            )
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
        reason = str(request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': 'reason là bắt buộc khi từ chối.'}, status=400)
        with transaction.atomic():
            try:
                row = SalaryAdvanceRecord.objects.select_for_update().get(pk=pk)
            except SalaryAdvanceRecord.DoesNotExist:
                return Response({'error': 'Không tìm thấy bản ghi ứng lương.'}, status=404)
            _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể từ chối duyệt ứng lương.')
            if row.approval_status not in {SalaryAdvanceRecord.APPROVAL_PENDING_L1, SalaryAdvanceRecord.APPROVAL_PENDING_L2}:
                return Response({'error': 'Ứng lương không ở trạng thái chờ duyệt.'}, status=400)
            old_status = row.approval_status
            row.approval_status = SalaryAdvanceRecord.APPROVAL_REJECTED
            row.rejected_at = timezone.now()
            row.rejected_by = request.user
            row.rejection_reason = reason[:255]
            row.updated_by = request.user
            row.save(update_fields=['approval_status', 'rejected_at', 'rejected_by', 'rejection_reason', 'updated_by', 'updated_at', 'search_text'])
            ApprovalHistory.objects.create(
                entity_type='SalaryAdvanceRecord',
                entity_id=row.id,
                entity_code=str(row.id),
                action='REJECT',
                user=request.user,
                comments=row.rejection_reason,
                level=1 if old_status == SalaryAdvanceRecord.APPROVAL_PENDING_L1 else 2,
            )
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

    @action(detail=True, methods=['get'])
    def approval_history(self, request, pk=None):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xem lịch sử duyệt ứng lương.'}, status=403)
        row = self.get_object()
        history_rows = list(
            ApprovalHistory.objects.filter(
                entity_type='SalaryAdvanceRecord',
                entity_id=row.id,
            ).order_by('-created_at').select_related('user')
        )
        if history_rows:
            return Response([_serialize_workforce_approval_history_row(item) for item in history_rows])
        audit_rows = (
            AuditLog.objects.filter(
                entity_type='WorkforceSalaryAdvanceApproval',
                entity_id=row.id,
            ).order_by('-created_at', '-id').select_related('user')
        )
        return Response([
            serialized
            for serialized in (_serialize_workforce_approval_history_log(log) for log in audit_rows)
            if serialized
        ])

    @action(detail=True, methods=['post'])
    def post_disbursement(self, request, pk=None):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền chi tiền ứng lương.'}, status=403)
        source_type = str(request.data.get('source_type') or CashTransaction.SOURCE_CASH).strip().upper()
        source_cash_account_id = request.data.get('source_cash_account')
        source_bank_account_id = request.data.get('source_bank_account')
        with transaction.atomic():
            try:
                row = SalaryAdvanceRecord.objects.select_for_update().select_related('employee').get(pk=pk)
            except SalaryAdvanceRecord.DoesNotExist:
                return Response({'error': 'Không tìm thấy bản ghi ứng lương.'}, status=404)
            if row.approval_status != SalaryAdvanceRecord.APPROVAL_APPROVED:
                return Response({'error': 'Chỉ được chi tiền cho ứng lương đã duyệt.'}, status=400)
            _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể chi tiền ứng lương.')
            finance_month = row.advance_date.strftime('%Y-%m') if row.advance_date else ''
            _ensure_finance_month_unlocked_for_payroll(finance_month)
            existing = _get_salary_advance_disbursement_tx(row, lock_for_update=True)
            if existing:
                return Response({'error': 'Bản ghi này đã có chứng từ chi tiền.'}, status=400)

            source_cash = None
            source_bank = None
            if source_type == CashTransaction.SOURCE_CASH:
                if not str(source_cash_account_id or '').isdigit():
                    return Response({'error': 'source_cash_account là bắt buộc khi chi từ quỹ.'}, status=400)
                source_cash = CashAccount.objects.filter(pk=int(source_cash_account_id), is_active=True).first()
                if source_cash is None:
                    return Response({'error': 'Tài khoản quỹ nguồn không hợp lệ hoặc đã ngừng sử dụng.'}, status=400)
                available = source_cash.current_balance_as_of(up_to_date=row.advance_date)
                if Decimal(str(row.amount or 0)) > available:
                    return Response({'error': f'Quỹ nguồn không đủ số dư khả dụng. Khả dụng hiện tại: {available:,.0f}.'}, status=400)
            elif source_type == CashTransaction.SOURCE_BANK:
                if not str(source_bank_account_id or '').isdigit():
                    return Response({'error': 'source_bank_account là bắt buộc khi chi từ ngân hàng.'}, status=400)
                source_bank = BankAccount.objects.filter(pk=int(source_bank_account_id), is_active=True).first()
                if source_bank is None:
                    return Response({'error': 'Tài khoản ngân hàng nguồn không hợp lệ hoặc đã ngừng sử dụng.'}, status=400)
            else:
                return Response({'error': 'source_type không hợp lệ.'}, status=400)

            category = _ensure_salary_advance_disbursement_category(request.user)
            marker = _salary_advance_disbursement_marker(row)
            tx = CashTransaction.objects.create(
                transaction_type=CashTransaction.TYPE_EXPENSE,
                source_type=source_type,
                source_cash_account=source_cash,
                source_bank_account=source_bank,
                category=category,
                transaction_date=row.advance_date,
                amount=row.amount,
                object_name=row.employee.name,
                reason=f'{marker} Chi ứng lương tháng {row.month} - {row.employee.code}',
                note=f'Tự động sinh từ phiếu ứng lương #{row.id}',
                created_by=request.user,
            )
            _log_workforce_audit(
                request.user,
                action='CREATE',
                entity_type='WorkforceSalaryAdvanceDisbursement',
                entity_id=int(row.id),
                entity_code=str(row.id),
                old_values={},
                new_values={'cash_transaction_id': int(tx.id), 'amount': str(row.amount)},
                changed_fields=['cash_transaction_id', 'amount'],
            )
        return Response({'success': True, 'transaction_id': int(tx.id), 'disbursement_status': 'DISBURSED'})

    @action(detail=True, methods=['post'])
    def reverse_disbursement(self, request, pk=None):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền hủy chi tiền ứng lương.'}, status=403)
        with transaction.atomic():
            try:
                row = SalaryAdvanceRecord.objects.select_for_update().get(pk=pk)
            except SalaryAdvanceRecord.DoesNotExist:
                return Response({'error': 'Không tìm thấy bản ghi ứng lương.'}, status=404)
            _ensure_workforce_month_unlocked(row.month, 'Tháng lương đã khóa kỳ, không thể hủy chi tiền ứng lương.')
            if row.status == SalaryAdvanceRecord.STATUS_DEDUCTED:
                return Response({'error': 'Ứng lương đã bị khấu trừ vào lương, không thể hủy chứng từ chi.'}, status=400)
            tx = _get_salary_advance_disbursement_tx(row, lock_for_update=True)
            if tx is None:
                return Response({'error': 'Bản ghi này chưa có chứng từ chi tiền.'}, status=400)
            finance_month = tx.transaction_date.strftime('%Y-%m') if tx.transaction_date else ''
            _ensure_finance_month_unlocked_for_payroll(finance_month)
            tx_id = int(tx.id)
            tx.delete()
            _log_workforce_audit(
                request.user,
                action='DELETE',
                entity_type='WorkforceSalaryAdvanceDisbursement',
                entity_id=int(row.id),
                entity_code=str(row.id),
                old_values={'cash_transaction_id': tx_id},
                new_values={},
                changed_fields=['cash_transaction_id'],
            )
        return Response({'success': True, 'transaction_id': tx_id, 'disbursement_status': 'NOT_DISBURSED'})

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
    def approval_sla_reminder_history(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xem lịch sử nhắc SLA duyệt ứng lương.'}, status=403)
        days_raw = str(request.query_params.get('days') or '30').strip()
        try:
            days = max(1, min(int(days_raw), 180))
        except Exception:
            days = 30
        cutoff = timezone.now() - timedelta(days=days)
        qs = (
            Notification.objects
            .filter(
                notification_type='due_date',
                entity_type='WorkforceSalaryAdvanceApprovalPending',
                created_at__gte=cutoff,
            )
            .select_related('recipient')
            .order_by('-created_at', '-id')
        )
        grouped = {}
        for row in qs:
            level_key = int(row.entity_id or 0)
            item = grouped.get(level_key)
            if item is None:
                level_label = 'ESCALATION' if level_key == 99 else ('L2' if level_key == 2 else 'L1')
                item = {
                    'level_key': level_key,
                    'level_label': level_label,
                    'latest_created_at': row.created_at,
                    'sent_count': 0,
                    'unread_count': 0,
                    'sample_recipients': [],
                }
                grouped[level_key] = item
            item['sent_count'] += 1
            if not row.is_read:
                item['unread_count'] += 1
            if len(item['sample_recipients']) < 8:
                item['sample_recipients'].append(str(row.recipient.username))
            if row.created_at and row.created_at > item['latest_created_at']:
                item['latest_created_at'] = row.created_at

        items = []
        total_sent = 0
        total_unread = 0
        for item in sorted(grouped.values(), key=lambda x: (-int(x['sent_count']), int(x['level_key']))):
            sent_count = int(item['sent_count'])
            unread_count = int(item['unread_count'])
            read_count = max(0, sent_count - unread_count)
            item['read_count'] = read_count
            item['read_rate'] = round((read_count / sent_count) * 100, 2) if sent_count > 0 else 0.0
            item['latest_created_at'] = item['latest_created_at'].isoformat() if item.get('latest_created_at') else ''
            total_sent += sent_count
            total_unread += unread_count
            items.append(item)
        total_read = max(0, total_sent - total_unread)
        overall_read_rate = round((total_read / total_sent) * 100, 2) if total_sent > 0 else 0.0
        return Response({
            'days': days,
            'summary': {
                'total_sent': total_sent,
                'total_read': total_read,
                'total_unread': total_unread,
                'overall_read_rate': overall_read_rate,
            },
            'items': items,
        })

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
            changed_fields=[
                'sla_hours_l1',
                'sla_hours_l2',
                'remind_every_hours',
                'escalation_hours_l1',
                'escalation_hours_l2',
                'escalation_cooldown_hours',
                'window_days',
            ],
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
        month_value = serializer.validated_data.get('month', '')
        _ensure_workforce_month_unlocked(
            month_value,
            'Tháng lương đã khóa kỳ, không thể tạo bản ghi mới.',
        )
        employee = serializer.validated_data.get('employee')
        instance = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        if employee and month_value:
            profile = _resolve_employee_profile_for_month(employee, month_value)
            _apply_payroll_profile_snapshot(instance, profile)
            instance.save(update_fields=[
                'profile_effective_month',
                'employee_department_snapshot',
                'employee_position_snapshot',
                'updated_at',
                'search_text',
            ])
        _log_workforce_audit(
            self.request.user, action='CREATE', entity_type='WorkforcePayroll',
            entity_id=int(instance.id), entity_code=f'{instance.employee_id}-{instance.month}',
            old_values={},
            new_values={'month': instance.month, 'net_pay': str(instance.net_pay), 'status': instance.status},
            changed_fields=['month', 'net_pay', 'status'],
        )

    def perform_update(self, serializer):
        if not _can_manage_workforce(self.request.user):
            raise PermissionDenied('Bạn không có quyền cập nhật bản ghi lương.')
        month_value = serializer.validated_data.get('month', serializer.instance.month)
        _ensure_workforce_month_unlocked(
            month_value,
            'Tháng lương đã khóa kỳ, không thể cập nhật.',
        )
        old = serializer.instance
        old_snap = {'month': old.month, 'net_pay': str(old.net_pay), 'status': old.status}
        instance = serializer.save(updated_by=self.request.user)
        profile = _resolve_employee_profile_for_month(instance.employee, instance.month)
        _apply_payroll_profile_snapshot(instance, profile)
        instance.save(update_fields=[
            'profile_effective_month',
            'employee_department_snapshot',
            'employee_position_snapshot',
            'updated_by',
            'updated_at',
            'search_text',
        ])
        _log_workforce_audit(
            self.request.user, action='UPDATE', entity_type='WorkforcePayroll',
            entity_id=int(instance.id), entity_code=f'{instance.employee_id}-{instance.month}',
            old_values=old_snap,
            new_values={'month': instance.month, 'net_pay': str(instance.net_pay), 'status': instance.status},
            changed_fields=list(serializer.validated_data.keys()),
        )

    @staticmethod
    def _round_money(value: Decimal) -> Decimal:
        return value.quantize(Decimal('1'), rounding=ROUND_HALF_UP)

    @staticmethod
    def _payroll_marker(record: PayrollRecord) -> str:
        return f'[PAYROLL:{record.id}]'

    def _post_payroll_to_finance(self, record: PayrollRecord, actor, source_payload: dict | None = None):
        marker = self._payroll_marker(record)
        with transaction.atomic():
            existing = CashTransaction.objects.select_for_update().filter(reason__icontains=marker).first()
            if existing:
                return {'created': False, 'transaction_id': existing.id, 'message': 'Đã có giao dịch lương cho bản ghi này.'}
            source_config, error = _resolve_cash_bank_source(source_payload, setting_key=WORKFORCE_PAYROLL_POSTING_DEFAULT_KEY)
            if source_config is None:
                return {'created': False, 'error': error or 'Chưa cấu hình nguồn tiền hạch toán lương.'}

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

            if source_config.get('source_type') == CashTransaction.SOURCE_CASH and source_config.get('source_cash_account') is not None:
                available = source_config['source_cash_account'].current_balance_as_of(up_to_date=tx_date)
                if Decimal(str(record.net_pay or 0)) > available:
                    return {
                        'created': False,
                        'error': f'Quỹ chi lương không đủ số dư khả dụng. Khả dụng hiện tại: {available:,.0f}.',
                    }

            tx = CashTransaction.objects.create(
                transaction_type=CashTransaction.TYPE_EXPENSE,
                source_type=source_config['source_type'],
                source_cash_account=source_config['source_cash_account'],
                source_bank_account=source_config['source_bank_account'],
                category=payroll_category,
                transaction_date=tx_date,
                amount=record.net_pay,
                object_name=record.employee.name,
                reason=f'{marker} Chi lương tháng {record.month} - {record.employee.code}',
                note=f'Tự động hạch toán khi khóa bảng lương bởi {actor.username}',
                created_by=actor,
            )
        return {
            'created': True,
            'transaction_id': tx.id,
            'message': 'Đã hạch toán lương sang tài chính.',
            'source_type': source_config['source_type'],
            'source_cash_account_id': source_config['source_cash_account_id'],
            'source_bank_account_id': source_config['source_bank_account_id'],
        }

    @action(detail=False, methods=['get'])
    def posting_defaults(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xem cấu hình chi lương.'}, status=403)
        return Response(_get_json_setting(WORKFORCE_PAYROLL_POSTING_DEFAULT_KEY))

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

        attendance_qs = (
            AttendanceRecord.objects
            .select_related('employee')
            .prefetch_related('overtime_items')
            .filter(month=month, is_active=True)
            .order_by('employee__code', 'id')
        )
        if not attendance_qs.exists():
            return Response({'error': 'Không có bảng chấm công hợp lệ để tính lương.'}, status=400)

        created_count = 0
        with transaction.atomic():
            if overwrite:
                PayrollRecord.objects.filter(month=month, status=PayrollRecord.STATUS_UNLOCKED).delete()

            for attendance in attendance_qs:
                employee = attendance.employee
                standard_days = Decimal(str(attendance.standard_days or 0))
                actual_days = Decimal(str(attendance.actual_days or 0))
                paid_leave = Decimal(str(attendance.paid_leave or 0))
                profile = _resolve_employee_profile_for_month(employee, month)
                basic_salary = Decimal(str(profile.get('salary_basic') or 0))
                if standard_days <= 0:
                    continue

                payable_days = min(standard_days, actual_days + paid_leave)
                salary_by_attendance = self._round_money((basic_salary * payable_days) / standard_days)

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

                approved_advance_rows = list(
                    SalaryAdvanceRecord.objects
                    .filter(
                        employee=employee,
                        month=month,
                        is_active=True,
                        status=SalaryAdvanceRecord.STATUS_UNDEDUCTED,
                        approval_status=SalaryAdvanceRecord.APPROVAL_APPROVED,
                    )
                    .order_by('id')
                )
                advance_deduction = sum(
                    (Decimal(str(row.amount or 0)) for row in approved_advance_rows if _is_salary_advance_disbursed(row)),
                    Decimal('0'),
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
                _apply_payroll_profile_snapshot(payroll, profile)
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
            _log_workforce_audit(
                request.user,
                action='UPDATE',
                entity_type='WorkforcePayrollCalculateMonth',
                entity_id=0,
                entity_code=month,
                old_values={},
                new_values={'month': month, 'count': created_count, 'overwrite': bool(overwrite)},
                changed_fields=['month', 'count', 'overwrite'],
            )

        return Response({'success': True, 'month': month, 'count': created_count})

    @action(detail=True, methods=['post'])
    def lock(self, request, pk=None):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền khóa bảng lương.'}, status=403)
        source_payload = {
            'source_type': request.data.get('source_type'),
            'source_cash_account': request.data.get('source_cash_account'),
            'source_bank_account': request.data.get('source_bank_account'),
        }
        has_explicit_source = any(source_payload.get(key) not in (None, '', 0, '0') for key in source_payload)
        with transaction.atomic():
            try:
                record = PayrollRecord.objects.select_for_update().select_related('employee').get(pk=pk)
            except PayrollRecord.DoesNotExist:
                return Response({'error': 'Không tìm thấy bản ghi lương.'}, status=404)
            _ensure_workforce_month_unlocked(record.month, 'Tháng lương đã khóa kỳ, không thể thao tác khóa/mở khóa bản ghi.')
            _ensure_finance_month_unlocked_for_payroll(record.month)
            posting = self._post_payroll_to_finance(record, request.user, source_payload if has_explicit_source else None)
            if posting.get('error'):
                return Response({'error': posting['error']}, status=400)
            old_status = record.status
            record.status = PayrollRecord.STATUS_LOCKED
            record.updated_by = request.user
            record.save(update_fields=['status', 'updated_by', 'updated_at'])
            deductible_advances = list(SalaryAdvanceRecord.objects.filter(
                employee=record.employee,
                month=record.month,
                approval_status=SalaryAdvanceRecord.APPROVAL_APPROVED,
                status=SalaryAdvanceRecord.STATUS_UNDEDUCTED,
                is_active=True,
            ).order_by('id'))
            deductible_ids = [int(row.id) for row in deductible_advances if _is_salary_advance_disbursed(row)]
            if deductible_ids:
                SalaryAdvanceRecord.objects.filter(id__in=deductible_ids).update(
                    status=SalaryAdvanceRecord.STATUS_DEDUCTED,
                    updated_by=request.user,
                )
            if bool(request.data.get('save_as_default')) and has_explicit_source and not posting.get('error'):
                _save_json_setting(
                    WORKFORCE_PAYROLL_POSTING_DEFAULT_KEY,
                    {
                        'source_type': posting.get('source_type'),
                        'source_cash_account': posting.get('source_cash_account_id'),
                        'source_bank_account': posting.get('source_bank_account_id'),
                    },
                    'Nguồn tiền mặc định khi khóa bảng lương và hạch toán sang tài chính',
                )
        _log_workforce_audit(
            request.user, action='UPDATE', entity_type='WorkforcePayroll',
            entity_id=int(record.id), entity_code=f'{record.employee_id}-{record.month}',
            old_values={'status': old_status},
            new_values={'status': record.status, 'finance_posting_created': bool(posting.get('created')), 'finance_transaction_id': posting.get('transaction_id')},
            changed_fields=['status'],
        )
        return Response({'success': True, 'status': record.status, 'finance_posting': posting})

    @action(detail=True, methods=['post'])
    def unlock(self, request, pk=None):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền mở khóa bảng lương.'}, status=403)
        with transaction.atomic():
            try:
                record = PayrollRecord.objects.select_for_update().select_related('employee').get(pk=pk)
            except PayrollRecord.DoesNotExist:
                return Response({'error': 'Không tìm thấy bản ghi lương.'}, status=404)
            _ensure_workforce_month_unlocked(record.month, 'Tháng lương đã khóa kỳ, không thể thao tác khóa/mở khóa bản ghi.')
            _ensure_finance_month_unlocked_for_payroll(record.month)
            marker = self._payroll_marker(record)
            finance_tx = CashTransaction.objects.select_for_update().filter(reason__icontains=marker).first()
            if finance_tx is not None:
                finance_tx.delete()
            old_status = record.status
            record.status = PayrollRecord.STATUS_UNLOCKED
            record.updated_by = request.user
            record.save(update_fields=['status', 'updated_by', 'updated_at'])
            SalaryAdvanceRecord.objects.filter(
                employee=record.employee,
                month=record.month,
                approval_status=SalaryAdvanceRecord.APPROVAL_APPROVED,
                status=SalaryAdvanceRecord.STATUS_DEDUCTED,
                is_active=True,
            ).update(status=SalaryAdvanceRecord.STATUS_UNDEDUCTED, updated_by=request.user)
        _log_workforce_audit(
            request.user, action='UPDATE', entity_type='WorkforcePayroll',
            entity_id=int(record.id), entity_code=f'{record.employee_id}-{record.month}',
            old_values={'status': old_status},
            new_values={'status': record.status, 'finance_reversed': bool(finance_tx is not None)},
            changed_fields=['status', 'finance_reversed'],
        )
        return Response({'success': True, 'status': record.status})

    def destroy(self, request, *args, **kwargs):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xóa bản ghi lương.'}, status=403)
        instance = self.get_object()
        _ensure_workforce_month_unlocked(
            instance.month,
            'Tháng lương đã khóa kỳ, không thể xóa bản ghi.',
        )
        snap = {'month': instance.month, 'employee_id': int(instance.employee_id), 'net_pay': str(instance.net_pay), 'status': instance.status}
        response = super().destroy(request, *args, **kwargs)
        _log_workforce_audit(
            request.user,
            action='DELETE',
            entity_type='WorkforcePayroll',
            entity_id=int(instance.id),
            entity_code=f'{instance.employee_id}-{instance.month}',
            old_values=snap,
            new_values={},
            changed_fields=['deleted'],
        )
        return response

    @action(detail=False, methods=['get'])
    def locked_months(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền xem danh sách tháng đã khóa.'}, status=403)
        return Response({'months': sorted(_get_locked_workforce_months())})

    @action(detail=False, methods=['get'])
    def preclose_check(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền kiểm tra đóng kỳ lương.'}, status=403)
        month = _normalize_month(str(request.query_params.get('month') or ''))
        if not month:
            return Response({'error': 'month phải có dạng YYYY-MM'}, status=400)
        return Response(_build_workforce_month_close_check(month))

    @action(detail=False, methods=['post'])
    def lock_month(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền khóa kỳ lương.'}, status=403)
        month = _normalize_month(str(request.data.get('month') or ''))
        if not month:
            return Response({'error': 'month phải có dạng YYYY-MM'}, status=400)
        checklist = _build_workforce_month_close_check(month)
        if checklist.get('blockers'):
            return Response(
                {
                    'error': 'Chưa thể khóa kỳ lương vì còn vướng kiểm tra đóng kỳ.',
                    'checklist': checklist,
                },
                status=400,
            )
        months = _get_locked_workforce_months()
        old_months = sorted(months)
        months.add(month)
        _save_locked_workforce_months(months)
        _log_workforce_audit(
            request.user,
            action='UPDATE',
            entity_type='WorkforcePayrollMonthLock',
            entity_id=0,
            entity_code=WORKFORCE_LOCKED_MONTHS_KEY,
            old_values={'months': old_months},
            new_values={'months': sorted(months), 'action': 'lock', 'month': month},
            changed_fields=['months'],
        )
        return Response({'success': True, 'months': sorted(months)})

    @action(detail=False, methods=['post'])
    def unlock_month(self, request):
        if not _can_manage_workforce(request.user):
            return Response({'error': 'Bạn không có quyền mở khóa kỳ lương.'}, status=403)
        month = _normalize_month(str(request.data.get('month') or ''))
        if not month:
            return Response({'error': 'month phải có dạng YYYY-MM'}, status=400)
        months = _get_locked_workforce_months()
        old_months = sorted(months)
        months.discard(month)
        _save_locked_workforce_months(months)
        _log_workforce_audit(
            request.user,
            action='UPDATE',
            entity_type='WorkforcePayrollMonthLock',
            entity_id=0,
            entity_code=WORKFORCE_LOCKED_MONTHS_KEY,
            old_values={'months': old_months},
            new_values={'months': sorted(months), 'action': 'unlock', 'month': month},
            changed_fields=['months'],
        )
        return Response({'success': True, 'months': sorted(months)})
