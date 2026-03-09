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
APPROVAL_SLA_SCHEDULE_NAME = 'FINANCE_ADVANCE_APPROVAL_SLA_REMINDER'
APPROVAL_SLA_ENTITY_TYPE = 'FinanceAdvanceApprovalPending'
APPROVAL_SLA_POLICY_KEY = 'FINANCE_ADVANCE_APPROVAL_SLA_POLICY'
EXECUTIVE_AUTO_SCHEDULE_NAME = 'FINANCE_EXECUTIVE_AUTO_EXECUTE'
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


def _can_receive_finance_approval_l2(user) -> bool:
    if not getattr(user, 'is_active', False):
        return False
    if getattr(user, 'is_superuser', False):
        return True
    role_names = _user_role_names(user)
    l2_roles = {
        'admin',
        'manager',
        'finance-manager',
        'finance_director',
        'giam-doc',
        'pho-giam-doc',
    }
    return any(role in l2_roles for role in role_names)


def _default_policy() -> dict:
    return dict(REMINDER_POLICY_PRESETS['balanced'])


def _default_approval_sla_policy() -> dict:
    return {
        'sla_hours_l1': 8,
        'sla_hours_l2': 16,
        'remind_every_hours': 4,
        'escalation_hours_l1': 24,
        'escalation_hours_l2': 36,
        'escalation_cooldown_hours': 12,
        'window_days': 30,
    }


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


def get_approval_sla_policy() -> dict:
    row = Setting.objects.filter(key=APPROVAL_SLA_POLICY_KEY, is_active=True).first()
    if not row:
        return _default_approval_sla_policy()
    try:
        import json
        parsed = json.loads(str(row.value or '{}'))
    except Exception:
        return _default_approval_sla_policy()
    if not isinstance(parsed, dict):
        return _default_approval_sla_policy()
    policy = _default_approval_sla_policy()
    for key in [
        'sla_hours_l1',
        'sla_hours_l2',
        'remind_every_hours',
        'escalation_hours_l1',
        'escalation_hours_l2',
        'escalation_cooldown_hours',
        'window_days',
    ]:
        try:
            policy[key] = max(1, int(parsed.get(key, policy[key])))
        except Exception:
            pass
    policy['window_days'] = min(policy['window_days'], 365)
    return policy


def save_approval_sla_policy(policy: dict) -> dict:
    normalized = _default_approval_sla_policy()
    if isinstance(policy, dict):
        for key in [
            'sla_hours_l1',
            'sla_hours_l2',
            'remind_every_hours',
            'escalation_hours_l1',
            'escalation_hours_l2',
            'escalation_cooldown_hours',
            'window_days',
        ]:
            try:
                normalized[key] = max(1, int(policy.get(key, normalized[key])))
            except Exception:
                pass
    normalized['window_days'] = min(normalized['window_days'], 365)
    import json
    Setting.objects.update_or_create(
        key=APPROVAL_SLA_POLICY_KEY,
        defaults={
            'value': json.dumps(normalized),
            'data_type': 'json',
            'description': 'Policy SLA duyệt phiếu tạm ứng tài chính',
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


def build_finance_approval_sla_overview(policy: dict | None = None) -> dict:
    policy = policy or get_approval_sla_policy()
    now_dt = timezone.now()
    l1_hours = int(policy.get('sla_hours_l1') or 8)
    l2_hours = int(policy.get('sla_hours_l2') or 16)
    pending_l1 = AdvanceTransaction.objects.filter(approval_status=AdvanceTransaction.APPROVAL_PENDING_L1, is_active=True)
    pending_l2 = AdvanceTransaction.objects.filter(approval_status=AdvanceTransaction.APPROVAL_PENDING_L2, is_active=True)
    escal_l1_hours = int(policy.get('escalation_hours_l1') or 24)
    escal_l2_hours = int(policy.get('escalation_hours_l2') or 36)
    overdue_l1_count = 0
    overdue_l2_count = 0
    escal_l1_count = 0
    escal_l2_count = 0
    by_submitter: dict[str, dict] = {}
    for row in pending_l1:
        base_dt = row.submitted_at or row.updated_at
        if not base_dt:
            continue
        wait_hours = max(0.0, (now_dt - base_dt).total_seconds() / 3600.0)
        if wait_hours >= l1_hours:
            overdue_l1_count += 1
        if wait_hours >= escal_l1_hours:
            escal_l1_count += 1
        submitter = row.submitted_by.username if row.submitted_by_id and row.submitted_by else ''
        if submitter:
            bucket = by_submitter.get(submitter)
            if bucket is None:
                bucket = {'username': submitter, 'pending_count': 0, 'total_amount': Decimal('0'), 'max_wait_hours': 0.0}
                by_submitter[submitter] = bucket
            bucket['pending_count'] += 1
            bucket['total_amount'] += Decimal(str(row.amount or 0))
            bucket['max_wait_hours'] = max(float(bucket['max_wait_hours']), float(wait_hours))
    for row in pending_l2:
        base_dt = row.approved_level1_at or row.submitted_at or row.updated_at
        if not base_dt:
            continue
        wait_hours = max(0.0, (now_dt - base_dt).total_seconds() / 3600.0)
        if wait_hours >= l2_hours:
            overdue_l2_count += 1
        if wait_hours >= escal_l2_hours:
            escal_l2_count += 1
        submitter = row.submitted_by.username if row.submitted_by_id and row.submitted_by else ''
        if submitter:
            bucket = by_submitter.get(submitter)
            if bucket is None:
                bucket = {'username': submitter, 'pending_count': 0, 'total_amount': Decimal('0'), 'max_wait_hours': 0.0}
                by_submitter[submitter] = bucket
            bucket['pending_count'] += 1
            bucket['total_amount'] += Decimal(str(row.amount or 0))
            bucket['max_wait_hours'] = max(float(bucket['max_wait_hours']), float(wait_hours))

    window_days = int(policy.get('window_days') or 30)
    cutoff_dt = now_dt - timedelta(days=window_days)
    approved_qs = AdvanceTransaction.objects.filter(
        approval_status=AdvanceTransaction.APPROVAL_APPROVED,
        submitted_at__isnull=False,
        updated_at__gte=cutoff_dt,
    )
    lead_hours = []
    for row in approved_qs:
        end_dt = row.approved_level2_at or row.approved_level1_at
        if not end_dt or not row.submitted_at:
            continue
        lead_hours.append(max(0.0, (end_dt - row.submitted_at).total_seconds() / 3600.0))
    avg_lead_hours = round(sum(lead_hours) / len(lead_hours), 2) if lead_hours else 0.0
    top_blocked_submitters = sorted(
        by_submitter.values(),
        key=lambda x: (-int(x['pending_count']), -float(x['max_wait_hours']), x['username']),
    )[:5]
    for row in top_blocked_submitters:
        row['total_amount'] = str(row['total_amount'])
        row['max_wait_hours'] = round(float(row['max_wait_hours']), 2)
    return {
        'policy': policy,
        'pending_l1_count': int(pending_l1.count()),
        'pending_l2_count': int(pending_l2.count()),
        'overdue_l1_count': int(overdue_l1_count),
        'overdue_l2_count': int(overdue_l2_count),
        'escalation_l1_count': int(escal_l1_count),
        'escalation_l2_count': int(escal_l2_count),
        'approved_window_days': window_days,
        'approved_count': int(len(lead_hours)),
        'avg_lead_hours': avg_lead_hours,
        'top_blocked_submitters': top_blocked_submitters,
    }


def run_finance_approval_sla_reminder_job(dry_run: bool = False) -> dict:
    policy = get_approval_sla_policy()
    overview = build_finance_approval_sla_overview(policy=policy)
    now_dt = timezone.now()
    remind_every_hours = int(policy.get('remind_every_hours') or 4)
    escalation_cooldown_hours = int(policy.get('escalation_cooldown_hours') or 12)
    cooldown_cutoff = now_dt - timedelta(hours=max(1, remind_every_hours))
    escalation_cutoff = now_dt - timedelta(hours=max(1, escalation_cooldown_hours))
    User = get_user_model()
    recipients_l1 = [u for u in User.objects.filter(is_active=True) if _can_receive_finance_reminder(u)]
    recipients_l2 = [u for u in User.objects.filter(is_active=True) if _can_receive_finance_approval_l2(u)]
    sent_usernames: list[str] = []
    sent_count = 0
    escalated_usernames: list[str] = []
    escalated_count = 0
    payload_text = (
        f"Pending L1: {overview['pending_l1_count']} (quá SLA: {overview['overdue_l1_count']}), "
        f"Pending L2: {overview['pending_l2_count']} (quá SLA: {overview['overdue_l2_count']})."
    )
    for user in recipients_l1:
        has_overdue = overview['overdue_l1_count'] > 0
        if not has_overdue:
            continue
        exists_recent = user.notifications.filter(
            notification_type='due_date',
            entity_type=APPROVAL_SLA_ENTITY_TYPE,
            entity_id=1,
            created_at__gte=cooldown_cutoff,
        ).exists()
        if exists_recent:
            continue
        if dry_run:
            sent_count += 1
            sent_usernames.append(str(user.username))
            continue
        create_notification(
            recipient=user,
            notification_type='due_date',
            title='SLA duyệt phiếu tạm ứng tài chính (L1)',
            message=payload_text,
            entity_type=APPROVAL_SLA_ENTITY_TYPE,
            entity_id=1,
            actor=None,
        )
        sent_count += 1
        sent_usernames.append(str(user.username))
    for user in recipients_l2:
        has_overdue = overview['overdue_l2_count'] > 0
        if not has_overdue:
            continue
        exists_recent = user.notifications.filter(
            notification_type='due_date',
            entity_type=APPROVAL_SLA_ENTITY_TYPE,
            entity_id=2,
            created_at__gte=cooldown_cutoff,
        ).exists()
        if exists_recent:
            continue
        if dry_run:
            sent_count += 1
            sent_usernames.append(str(user.username))
            continue
        create_notification(
            recipient=user,
            notification_type='due_date',
            title='SLA duyệt phiếu tạm ứng tài chính (L2)',
            message=payload_text,
            entity_type=APPROVAL_SLA_ENTITY_TYPE,
            entity_id=2,
            actor=None,
        )
        sent_count += 1
        sent_usernames.append(str(user.username))
    # Escalation: notify manager-level recipients for long-overdue pending approvals.
    manager_recipients = [u for u in recipients_l2 if _can_receive_finance_approval_l2(u)]
    if overview['escalation_l1_count'] > 0 or overview['escalation_l2_count'] > 0:
        esc_message = (
            f"Escalation SLA duyệt - L1 quá ngưỡng: {overview['escalation_l1_count']}, "
            f"L2 quá ngưỡng: {overview['escalation_l2_count']}."
        )
        for user in manager_recipients:
            exists_recent = user.notifications.filter(
                notification_type='due_date',
                entity_type=APPROVAL_SLA_ENTITY_TYPE,
                entity_id=99,
                created_at__gte=escalation_cutoff,
            ).exists()
            if exists_recent:
                continue
            if dry_run:
                escalated_count += 1
                escalated_usernames.append(str(user.username))
                continue
            create_notification(
                recipient=user,
                notification_type='due_date',
                title='Escalation duyệt phiếu tạm ứng tài chính',
                message=esc_message,
                entity_type=APPROVAL_SLA_ENTITY_TYPE,
                entity_id=99,
                actor=None,
            )
            escalated_count += 1
            escalated_usernames.append(str(user.username))
    return {
        'success': True,
        'dry_run': bool(dry_run),
        'sent_count': int(sent_count),
        'sent_usernames': sorted(set(sent_usernames)),
        'escalated_count': int(escalated_count),
        'escalated_usernames': sorted(set(escalated_usernames)),
        'overview': overview,
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


def ensure_approval_sla_schedule(minutes: int = 60) -> dict:
    try:
        from django_q.models import Schedule
    except Exception:
        return {'success': False, 'error': 'DJANGO_Q_UNAVAILABLE'}

    interval = max(15, min(int(minutes or 60), 1440))
    schedule, created = Schedule.objects.get_or_create(
        name=APPROVAL_SLA_SCHEDULE_NAME,
        defaults={
            'func': 'finance.reminders.run_finance_approval_sla_reminder_job',
            'schedule_type': Schedule.MINUTES,
            'minutes': interval,
            'repeats': -1,
            'next_run': timezone.now(),
            'cluster': 'default',
        },
    )
    if not created:
        updated = False
        if schedule.func != 'finance.reminders.run_finance_approval_sla_reminder_job':
            schedule.func = 'finance.reminders.run_finance_approval_sla_reminder_job'
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


def ensure_executive_auto_schedule(minutes: int = 30) -> dict:
    try:
        from django_q.models import Schedule
    except Exception:
        return {'success': False, 'error': 'DJANGO_Q_UNAVAILABLE'}

    interval = max(10, min(int(minutes or 30), 1440))
    schedule, created = Schedule.objects.get_or_create(
        name=EXECUTIVE_AUTO_SCHEDULE_NAME,
        defaults={
            'func': 'finance.views.run_executive_auto_execute_job',
            'schedule_type': Schedule.MINUTES,
            'minutes': interval,
            'repeats': -1,
            'next_run': timezone.now(),
            'cluster': 'default',
        },
    )
    if not created:
        updated = False
        if schedule.func != 'finance.views.run_executive_auto_execute_job':
            schedule.func = 'finance.views.run_executive_auto_execute_job'
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
