from __future__ import annotations

import logging
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

from core.models import Setting
from core.notifications import create_notification
from core.permissions import check_action_permission

from workforce.models import SalaryAdvanceRecord

logger = logging.getLogger(__name__)


APPROVAL_SLA_SCHEDULE_NAME = 'WORKFORCE_SALARY_ADVANCE_APPROVAL_SLA_REMINDER'
APPROVAL_SLA_ENTITY_TYPE = 'WorkforceSalaryAdvanceApprovalPending'
APPROVAL_SLA_POLICY_KEY = 'WORKFORCE_SALARY_ADVANCE_APPROVAL_SLA_POLICY'


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


def _can_manage_workforce(user) -> bool:
    if not getattr(user, 'is_active', False):
        return False
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
        'payroll-manager',
        'quan-ly',
        'quanly',
    }
    return any(role in allowed_roles for role in role_names)


def _can_approve_workforce_l2(user) -> bool:
    if not getattr(user, 'is_active', False):
        return False
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
        except Exception as exc:
            logger.warning('workforce.reminders: invalid value for policy key %s — %s', key, exc)
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
            except Exception as exc:
                logger.warning('workforce.reminders: invalid value for save policy key %s — %s', key, exc)
    normalized['window_days'] = min(normalized['window_days'], 365)
    import json

    Setting.objects.update_or_create(
        key=APPROVAL_SLA_POLICY_KEY,
        defaults={
            'value': json.dumps(normalized),
            'data_type': 'json',
            'description': 'Policy SLA duyệt ứng lương',
            'is_active': True,
        },
    )
    return normalized


def build_salary_advance_approval_sla_overview(policy: dict | None = None) -> dict:
    policy = policy or get_approval_sla_policy()
    now_dt = timezone.now()
    l1_hours = int(policy.get('sla_hours_l1') or 8)
    l2_hours = int(policy.get('sla_hours_l2') or 16)
    pending_l1 = SalaryAdvanceRecord.objects.filter(approval_status=SalaryAdvanceRecord.APPROVAL_PENDING_L1, is_active=True)
    pending_l2 = SalaryAdvanceRecord.objects.filter(approval_status=SalaryAdvanceRecord.APPROVAL_PENDING_L2, is_active=True)
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
                bucket = {'username': submitter, 'pending_count': 0, 'total_amount': 0.0, 'max_wait_hours': 0.0}
                by_submitter[submitter] = bucket
            bucket['pending_count'] += 1
            bucket['total_amount'] += float(row.amount or 0)
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
                bucket = {'username': submitter, 'pending_count': 0, 'total_amount': 0.0, 'max_wait_hours': 0.0}
                by_submitter[submitter] = bucket
            bucket['pending_count'] += 1
            bucket['total_amount'] += float(row.amount or 0)
            bucket['max_wait_hours'] = max(float(bucket['max_wait_hours']), float(wait_hours))

    window_days = int(policy.get('window_days') or 30)
    cutoff_dt = now_dt - timedelta(days=window_days)
    approved_qs = SalaryAdvanceRecord.objects.filter(
        approval_status=SalaryAdvanceRecord.APPROVAL_APPROVED,
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
        row['total_amount'] = f"{row['total_amount']:.2f}"
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


def run_salary_advance_approval_sla_reminder_job(dry_run: bool = False) -> dict:
    policy = get_approval_sla_policy()
    overview = build_salary_advance_approval_sla_overview(policy=policy)
    now_dt = timezone.now()
    remind_every_hours = int(policy.get('remind_every_hours') or 4)
    escalation_cooldown_hours = int(policy.get('escalation_cooldown_hours') or 12)
    cooldown_cutoff = now_dt - timedelta(hours=max(1, remind_every_hours))
    escalation_cutoff = now_dt - timedelta(hours=max(1, escalation_cooldown_hours))
    User = get_user_model()
    recipients_l1 = [u for u in User.objects.filter(is_active=True) if _can_manage_workforce(u)]
    recipients_l2 = [u for u in User.objects.filter(is_active=True) if _can_approve_workforce_l2(u)]
    sent_count = 0
    sent_usernames: list[str] = []
    escalated_count = 0
    escalated_usernames: list[str] = []
    message = (
        f"Pending L1: {overview['pending_l1_count']} (quá SLA: {overview['overdue_l1_count']}), "
        f"Pending L2: {overview['pending_l2_count']} (quá SLA: {overview['overdue_l2_count']})."
    )
    for user in recipients_l1:
        if overview['overdue_l1_count'] <= 0:
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
            title='SLA duyệt ứng lương (L1)',
            message=message,
            entity_type=APPROVAL_SLA_ENTITY_TYPE,
            entity_id=1,
            actor=None,
        )
        sent_count += 1
        sent_usernames.append(str(user.username))
    for user in recipients_l2:
        if overview['overdue_l2_count'] <= 0:
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
            title='SLA duyệt ứng lương (L2)',
            message=message,
            entity_type=APPROVAL_SLA_ENTITY_TYPE,
            entity_id=2,
            actor=None,
        )
        sent_count += 1
        sent_usernames.append(str(user.username))
    # Escalation reminders to level-2 approvers / managers.
    if overview['escalation_l1_count'] > 0 or overview['escalation_l2_count'] > 0:
        esc_message = (
            f"Escalation SLA duyệt ứng lương - L1 quá ngưỡng: {overview['escalation_l1_count']}, "
            f"L2 quá ngưỡng: {overview['escalation_l2_count']}."
        )
        for user in recipients_l2:
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
                title='Escalation duyệt ứng lương',
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


def ensure_salary_advance_approval_sla_schedule(minutes: int = 60) -> dict:
    try:
        from django_q.models import Schedule
    except Exception:
        return {'success': False, 'error': 'DJANGO_Q_UNAVAILABLE'}

    interval = max(15, min(int(minutes or 60), 1440))
    schedule, created = Schedule.objects.get_or_create(
        name=APPROVAL_SLA_SCHEDULE_NAME,
        defaults={
            'func': 'workforce.reminders.run_salary_advance_approval_sla_reminder_job',
            'schedule_type': Schedule.MINUTES,
            'minutes': interval,
            'repeats': -1,
            'next_run': timezone.now(),
            'cluster': 'default',
        },
    )
    if not created:
        updated = False
        if schedule.func != 'workforce.reminders.run_salary_advance_approval_sla_reminder_job':
            schedule.func = 'workforce.reminders.run_salary_advance_approval_sla_reminder_job'
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
