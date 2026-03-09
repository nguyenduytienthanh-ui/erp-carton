from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Sum
from django.utils import timezone

from core.models import Setting
from core.notifications import create_notification
from core.permissions import check_action_permission
from finance.models import AdvanceTransaction


REMINDER_SCHEDULE_NAME = 'FINANCE_ADVANCE_OVERDUE_DAILY_REMINDER'
REMINDER_ENTITY_TYPE = 'FinanceAdvanceOverdueDaily'
REMINDER_POLICY_SETTING_KEY = 'FINANCE_ADVANCE_REMINDER_POLICY'
REMINDER_POLICY_PRESETS = {
    'conservative': {
        'default_threshold_days': 120,
        'cooldown_hours': 48,
        'role_threshold_days': {},
        'user_threshold_days': {},
    },
    'balanced': {
        'default_threshold_days': 90,
        'cooldown_hours': 24,
        'role_threshold_days': {},
        'user_threshold_days': {},
    },
    'aggressive': {
        'default_threshold_days': 60,
        'cooldown_hours': 12,
        'role_threshold_days': {},
        'user_threshold_days': {},
    },
}


def _user_role_names(user) -> set[str]:
    try:
        pairs = user.roles.values_list('name', 'code')
    except Exception:
        return set()
    names: set[str] = set()
    for name, code in pairs:
        if name:
            names.add(str(name).strip().lower())
        if code:
            names.add(str(code).strip().lower())
    return names


def _can_receive_finance_reminder(user) -> bool:
    if not getattr(user, 'is_active', False):
        return False
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


def _default_policy() -> dict:
    return dict(REMINDER_POLICY_PRESETS['balanced'])


def get_reminder_policy_presets() -> dict:
    return {key: dict(value) for key, value in REMINDER_POLICY_PRESETS.items()}


def _normalize_threshold_map(raw_map) -> dict:
    if not isinstance(raw_map, dict):
        return {}
    normalized = {}
    for key, value in raw_map.items():
        key_text = str(key).strip()
        value_text = str(value).strip()
        if not key_text or not value_text.isdigit():
            continue
        normalized[key_text] = max(1, min(int(value_text), 3650))
    return normalized


def normalize_reminder_policy(policy: dict | None) -> dict:
    normalized = _default_policy()
    if not isinstance(policy, dict):
        return normalized

    default_threshold_raw = policy.get('default_threshold_days')
    cooldown_raw = policy.get('cooldown_hours')
    try:
        normalized['default_threshold_days'] = max(
            1,
            min(int(90 if default_threshold_raw in (None, '') else default_threshold_raw), 3650),
        )
    except (TypeError, ValueError):
        normalized['default_threshold_days'] = 90
    try:
        normalized['cooldown_hours'] = max(
            0,
            min(int(24 if cooldown_raw in (None, '') else cooldown_raw), 168),
        )
    except (TypeError, ValueError):
        normalized['cooldown_hours'] = 24

    role_map = _normalize_threshold_map(policy.get('role_threshold_days'))
    normalized['role_threshold_days'] = {str(k).strip().lower(): int(v) for k, v in role_map.items()}
    normalized['user_threshold_days'] = _normalize_threshold_map(policy.get('user_threshold_days'))
    return normalized


def get_reminder_policy() -> dict:
    row = Setting.objects.filter(key=REMINDER_POLICY_SETTING_KEY, is_active=True).first()
    if not row:
        return _default_policy()
    try:
        import json
        parsed = json.loads(str(row.value or '{}'))
    except Exception:
        return _default_policy()
    if not isinstance(parsed, dict):
        return _default_policy()
    return normalize_reminder_policy(parsed)


def save_reminder_policy(policy: dict) -> dict:
    normalized = normalize_reminder_policy(policy)
    import json
    Setting.objects.update_or_create(
        key=REMINDER_POLICY_SETTING_KEY,
        defaults={
            'value': json.dumps(normalized),
            'data_type': 'json',
            'description': 'Policy nhắc quá hạn tạm ứng theo user/role và cooldown',
            'is_active': True,
        },
    )
    return normalized


def _resolve_threshold_days_for_user(user, policy: dict) -> int:
    username = str(getattr(user, 'username', '') or '').strip()
    user_map = policy.get('user_threshold_days') if isinstance(policy, dict) else {}
    if isinstance(user_map, dict) and username in user_map:
        return int(user_map[username])
    default_threshold = int(policy.get('default_threshold_days') or 90) if isinstance(policy, dict) else 90
    role_map = policy.get('role_threshold_days') if isinstance(policy, dict) else {}
    if not isinstance(role_map, dict) or not role_map:
        return default_threshold
    role_names = _user_role_names(user)
    matched_values = [int(v) for k, v in role_map.items() if str(k).strip().lower() in role_names]
    if matched_values:
        return min(matched_values)
    return default_threshold


def build_overdue_snapshot(as_of: date | None = None, threshold_days: int = 90) -> dict:
    as_of = as_of or timezone.localdate()
    threshold_days = max(1, int(threshold_days or 90))
    cutoff = as_of.fromordinal(as_of.toordinal() - threshold_days)
    qs = AdvanceTransaction.objects.filter(
        is_active=True,
        status__in=[AdvanceTransaction.STATUS_OPEN, AdvanceTransaction.STATUS_PARTIAL],
        advance_date__lte=cutoff,
    )
    count = 0
    total_remaining = Decimal('0')
    max_days_overdue = 0
    for adv in qs:
        spent = Decimal(str(adv.settlements.aggregate(total=Sum('spent_amount')).get('total') or 0))
        refund = Decimal(str(adv.settlements.aggregate(total=Sum('refund_amount')).get('total') or 0))
        remaining = Decimal(str(adv.amount or 0)) - spent - refund
        if remaining <= 0:
            continue
        days_overdue = (as_of - adv.advance_date).days
        count += 1
        total_remaining += remaining
        if days_overdue > max_days_overdue:
            max_days_overdue = days_overdue
    return {
        'as_of': as_of.isoformat(),
        'threshold_days': threshold_days,
        'count': count,
        'total_remaining': str(total_remaining),
        'max_days_overdue': max_days_overdue,
    }


def run_daily_overdue_reminder_job(
    threshold_days: int | None = None,
    as_of: str | None = None,
    recipient_usernames: list[str] | None = None,
    policy_override: dict | None = None,
    dry_run: bool = False,
) -> dict:
    if as_of:
        try:
            y, m, d = as_of.split('-', 2)
            as_of_date = date(int(y), int(m), int(d))
        except Exception:
            as_of_date = timezone.localdate()
    else:
        as_of_date = timezone.localdate()

    policy = normalize_reminder_policy(policy_override) if isinstance(policy_override, dict) else get_reminder_policy()

    entity_id = int(as_of_date.strftime('%Y%m%d'))
    User = get_user_model()
    recipients = [u for u in User.objects.filter(is_active=True) if _can_receive_finance_reminder(u)]
    requested_usernames = []
    if recipient_usernames:
        requested_usernames = [str(item).strip() for item in recipient_usernames if str(item).strip()]
        if requested_usernames:
            requested_set = set(requested_usernames)
            recipients = [u for u in recipients if str(u.username) in requested_set]
    sent_count = 0
    would_send_count = 0
    skipped_cooldown_usernames: list[str] = []
    skipped_no_overdue_usernames: list[str] = []
    sent_usernames: list[str] = []
    would_send_usernames: list[str] = []
    snapshots_by_threshold: dict[int, dict] = {}
    cooldown_hours = int(policy.get('cooldown_hours') if policy.get('cooldown_hours') is not None else 24)
    now_dt = timezone.now()
    cooldown_cutoff = now_dt - timedelta(hours=max(0, cooldown_hours))
    for user in recipients:
        current_threshold = int(threshold_days) if threshold_days is not None else _resolve_threshold_days_for_user(user, policy)
        snapshot = snapshots_by_threshold.get(current_threshold)
        if snapshot is None:
            snapshot = build_overdue_snapshot(as_of=as_of_date, threshold_days=current_threshold)
            snapshots_by_threshold[current_threshold] = snapshot
        count = int(snapshot['count'])
        if count <= 0:
            skipped_no_overdue_usernames.append(str(user.username))
            continue
        exists = user.notifications.filter(
            notification_type='due_date',
            entity_type=REMINDER_ENTITY_TYPE,
            entity_id=entity_id,
        ).exists()
        if exists:
            continue
        if cooldown_hours > 0:
            latest = (
                user.notifications
                .filter(notification_type='due_date', entity_type=REMINDER_ENTITY_TYPE)
                .order_by('-created_at', '-id')
                .first()
            )
            if latest and latest.created_at and latest.created_at >= cooldown_cutoff:
                skipped_cooldown_usernames.append(str(user.username))
                continue
        title = f'Cảnh báo tạm ứng quá hạn >= {current_threshold} ngày'
        message = (
            f"Có {count} phiếu tạm ứng quá hạn >= {current_threshold} ngày, "
            f"tổng còn phải quyết toán: {snapshot['total_remaining']} VND. "
            f"Phiếu lâu nhất quá hạn {snapshot['max_days_overdue']} ngày."
        )
        if dry_run:
            would_send_count += 1
            would_send_usernames.append(str(user.username))
            continue
        create_notification(
            recipient=user,
            notification_type='due_date',
            title=title,
            message=message,
            entity_type=REMINDER_ENTITY_TYPE,
            entity_id=entity_id,
            actor=None,
        )
        sent_count += 1
        sent_usernames.append(str(user.username))
    aggregate_snapshot = {
        'as_of': as_of_date.isoformat(),
        'threshold_days': int(threshold_days) if threshold_days is not None else None,
        'count_by_threshold': {
            str(k): int(v.get('count') or 0) for k, v in snapshots_by_threshold.items()
        },
    }
    return {
        'success': True,
        'sent_count': sent_count,
        'sent_usernames': sent_usernames,
        'requested_usernames': requested_usernames,
        'skipped_cooldown_usernames': skipped_cooldown_usernames,
        'skipped_no_overdue_usernames': skipped_no_overdue_usernames,
        'policy': policy,
        'dry_run': bool(dry_run),
        'would_send_count': would_send_count,
        'would_send_usernames': would_send_usernames,
        'snapshot': aggregate_snapshot,
    }


def ensure_overdue_reminder_schedule(minutes: int = 1440) -> dict:
    try:
        from django_q.models import Schedule
    except Exception:
        return {'success': False, 'error': 'DJANGO_Q_UNAVAILABLE'}

    interval = max(60, min(int(minutes or 1440), 10080))
    schedule, created = Schedule.objects.get_or_create(
        name=REMINDER_SCHEDULE_NAME,
        defaults={
            'func': 'finance.reminders.run_daily_overdue_reminder_job',
            'schedule_type': Schedule.MINUTES,
            'minutes': interval,
            'repeats': -1,
            'next_run': timezone.now(),
            'cluster': 'default',
        },
    )
    if not created:
        updated = False
        if schedule.func != 'finance.reminders.run_daily_overdue_reminder_job':
            schedule.func = 'finance.reminders.run_daily_overdue_reminder_job'
            updated = True
        if schedule.schedule_type != Schedule.MINUTES:
            schedule.schedule_type = Schedule.MINUTES
            updated = True
        if int(schedule.minutes or 0) != interval:
            schedule.minutes = interval
            updated = True
        if schedule.repeats == 0:
            schedule.repeats = -1
            updated = True
        if not schedule.next_run:
            schedule.next_run = timezone.now()
            updated = True
        if updated:
            schedule.save()
    return {'success': True, 'created': created, 'schedule_id': schedule.id, 'minutes': int(schedule.minutes or interval)}
