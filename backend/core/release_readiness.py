from __future__ import annotations

import json
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from core.models import AuditLog, Customer, Notification, Task, User, UserSession, WorkflowPipelineEvent


def _get_backup_cloud_sync_config():
    deployment_mode = str(getattr(settings, 'DEPLOYMENT_MODE', 'colocated') or 'colocated').strip().lower()
    app_env = str(getattr(settings, 'APP_ENV', 'development') or 'development').strip().lower()
    enabled = bool(getattr(settings, 'BACKUP_CLOUD_SYNC_ENABLED', False))
    provider = str(getattr(settings, 'BACKUP_CLOUD_PROVIDER', '') or '').strip().lower()
    destination = str(getattr(settings, 'BACKUP_RCLONE_DESTINATION', '') or '').strip()
    required = enabled or (deployment_mode == 'hybrid' and app_env == 'production')
    return {
        'deployment_mode': deployment_mode,
        'app_env': app_env,
        'enabled': enabled,
        'required': required,
        'provider': provider,
        'destination': destination,
        'stale_hours': int(getattr(settings, 'BACKUP_CLOUD_SYNC_STALE_HOURS', 0) or 0),
    }


def _normalize_command_status(value, *, allow_skipped=False):
    allowed = {'ok', 'warning', 'error'}
    if allow_skipped:
        allowed = allowed | {'skipped'}
    normalized = str(value or '').strip().lower()
    return normalized if normalized in allowed else 'warning'


def get_pending_migration_rows():
    executor = MigrationExecutor(connection)
    plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    rows = []
    for migration, backwards in plan:
        if backwards:
            continue
        rows.append({
            'app': migration.app_label,
            'name': migration.name,
        })
    return rows


def get_pending_migration_summary():
    rows = get_pending_migration_rows()
    by_app = {}
    for row in rows:
        by_app.setdefault(row['app'], []).append(row['name'])
    return {
        'pending_count': len(rows),
        'apps': [
            {
                'app': app,
                'count': len(names),
                'migrations': names,
            }
            for app, names in sorted(by_app.items())
        ],
        'items': rows,
    }


def _serialize_backup_dir(entry: Path):
    stat = entry.stat()
    current_tz = timezone.get_current_timezone()
    created_at = datetime.fromtimestamp(stat.st_mtime, tz=current_tz)
    age_hours = round(max((timezone.now() - created_at).total_seconds() / 3600, 0), 2)
    manifest_payload = _load_json_file(entry / 'backup_manifest.json')
    restore_dry_run_payload = _load_json_file(entry / 'restore_dry_run.json')
    restore_last_run_payload = _load_json_file(entry / 'restore_last_run.json')
    cloud_sync_payload = _load_json_file(entry / 'cloud_sync.json')
    restore_drill_status = str((restore_dry_run_payload or {}).get('status') or '').strip().lower()
    if restore_drill_status not in {'ok', 'warning', 'error'}:
        restore_drill_status = 'warning'
    cloud_sync_status = _normalize_command_status((cloud_sync_payload or {}).get('status'), allow_skipped=True)
    cloud_sync_mode = str((cloud_sync_payload or {}).get('mode') or '').strip().lower()
    return {
        'path': str(entry),
        'name': entry.name,
        'created_at': created_at,
        'age_hours': age_hours,
        'has_database_dump': (entry / 'database.sql').exists(),
        'has_media': (entry / 'media').exists(),
        'has_manifest': (entry / 'backup_info.txt').exists(),
        'has_backup_manifest': manifest_payload is not None,
        'backup_manifest': manifest_payload,
        'latest_restore_dry_run': restore_dry_run_payload,
        'latest_restore_run': restore_last_run_payload,
        'restore_drill_status': 'ok' if restore_drill_status == 'ok' else 'warning',
        'latest_cloud_sync': cloud_sync_payload,
        'cloud_sync_status': cloud_sync_status,
        'cloud_sync_mode': cloud_sync_mode,
        'cloud_sync_verified': bool(cloud_sync_payload and cloud_sync_mode == 'sync' and cloud_sync_status == 'ok'),
    }


def _load_json_file(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, TypeError, ValueError):
        return None


def get_backup_inventory_payload():
    backup_root = Path(getattr(settings, 'BACKUP_ROOT', Path(settings.BASE_DIR) / 'backups'))
    retention_days = int(getattr(settings, 'BACKUP_RETENTION_DAYS', 0) or 0)
    stale_hours = int(getattr(settings, 'BACKUP_STALE_HOURS', 0) or 0)
    cloud_sync_config = _get_backup_cloud_sync_config()
    if not backup_root.exists():
        return {
            'root': str(backup_root),
            'exists': False,
            'backup_count': 0,
            'latest_backup': None,
            'cloud_sync_required': cloud_sync_config['required'],
            'cloud_sync_enabled': cloud_sync_config['enabled'],
            'cloud_sync_provider': cloud_sync_config['provider'],
            'cloud_sync_destination': cloud_sync_config['destination'],
            'cloud_sync_status': 'warning' if cloud_sync_config['required'] else 'ok',
            'latest_cloud_sync': None,
            'retention_days': retention_days,
            'stale_hours': stale_hours,
            'status': 'warning',
            'message': f'Backup root does not exist: {backup_root}',
        }

    backup_dirs = sorted(
        [entry for entry in backup_root.iterdir() if entry.is_dir()],
        key=lambda entry: entry.stat().st_mtime,
        reverse=True,
    )
    latest_backup = _serialize_backup_dir(backup_dirs[0]) if backup_dirs else None
    is_stale = False
    if latest_backup is None:
        is_stale = True
    elif stale_hours > 0 and float(latest_backup['age_hours']) > stale_hours:
        is_stale = True
    cloud_sync_status = 'ok'
    if cloud_sync_config['required']:
        if latest_backup is None:
            cloud_sync_status = 'warning'
        elif not latest_backup.get('cloud_sync_verified'):
            cloud_sync_status = 'warning'

    return {
        'root': str(backup_root),
        'exists': True,
        'backup_count': len(backup_dirs),
        'latest_backup': latest_backup,
        'latest_restore_dry_run': latest_backup.get('latest_restore_dry_run') if latest_backup else None,
        'restore_drill_status': latest_backup.get('restore_drill_status', 'warning') if latest_backup else 'warning',
        'latest_cloud_sync': latest_backup.get('latest_cloud_sync') if latest_backup else None,
        'cloud_sync_required': cloud_sync_config['required'],
        'cloud_sync_enabled': cloud_sync_config['enabled'],
        'cloud_sync_provider': cloud_sync_config['provider'],
        'cloud_sync_destination': cloud_sync_config['destination'],
        'cloud_sync_status': cloud_sync_status,
        'cloud_sync_stale_hours': cloud_sync_config['stale_hours'],
        'retention_days': retention_days,
        'stale_hours': stale_hours,
        'status': 'warning' if is_stale else 'ok',
        'message': (
            'No backups found yet'
            if latest_backup is None
            else f"Latest backup age: {latest_backup['age_hours']}h"
        ),
    }


def get_alert_channel_status_payload():
    required_channel_count = max(0, int(getattr(settings, 'ALERT_REQUIRED_CHANNEL_COUNT', 0) or 0))
    required_channels = [
        str(item).strip().lower()
        for item in (getattr(settings, 'ALERT_REQUIRED_CHANNELS', []) or [])
        if str(item).strip().lower() in {'email', 'slack', 'telegram', 'sentry'}
    ]
    default_from_email = str(getattr(settings, 'DEFAULT_FROM_EMAIL', '') or '').strip()
    server_email = str(getattr(settings, 'SERVER_EMAIL', '') or '').strip()
    incident_runbook = str(getattr(settings, 'INCIDENT_RUNBOOK_URL', '') or '').strip()
    incident_contacts = list(getattr(settings, 'INCIDENT_CONTACT_EMAILS', []) or [])
    channels = [
        {
            'key': 'sentry',
            'label': 'Sentry',
            'configured': bool(getattr(settings, 'SENTRY_DSN', '')),
            'summary': 'SENTRY_DSN',
        },
        {
            'key': 'email',
            'label': 'Email',
            'configured': bool(getattr(settings, 'ALERT_EMAIL_RECIPIENTS', [])),
            'summary': f"{len(list(getattr(settings, 'ALERT_EMAIL_RECIPIENTS', []) or []))} recipient(s)",
        },
        {
            'key': 'slack',
            'label': 'Slack',
            'configured': bool(getattr(settings, 'ALERT_SLACK_WEBHOOK_URL', '')),
            'summary': 'Webhook configured' if bool(getattr(settings, 'ALERT_SLACK_WEBHOOK_URL', '')) else 'Webhook missing',
        },
        {
            'key': 'telegram',
            'label': 'Telegram',
            'configured': bool(getattr(settings, 'ALERT_TELEGRAM_BOT_TOKEN', '') and getattr(settings, 'ALERT_TELEGRAM_CHAT_ID', '')),
            'summary': 'Bot token + chat id' if bool(getattr(settings, 'ALERT_TELEGRAM_BOT_TOKEN', '') and getattr(settings, 'ALERT_TELEGRAM_CHAT_ID', '')) else 'Telegram config missing',
        },
    ]
    configured_count = len([row for row in channels if row['configured']])
    missing_required_channels = [
        row['key']
        for row in channels
        if row['key'] in required_channels and not row['configured']
    ]
    warnings = []
    if getattr(settings, 'APP_ENV', 'development') == 'production' and configured_count == 0:
        warnings.append('No production alert channels are configured')
    if required_channel_count > 0 and configured_count < required_channel_count:
        warnings.append(
            f'Configured alert channels ({configured_count}) are below the required minimum ({required_channel_count}).'
        )
    if missing_required_channels:
        warnings.append(
            f"Required alert channels are missing: {', '.join(missing_required_channels)}"
        )
    if not any(row['key'] == 'email' and row['configured'] for row in channels):
        warnings.append('Email escalation recipients are not configured')
    if any(row['key'] == 'email' and row['configured'] for row in channels) and not default_from_email:
        warnings.append('DEFAULT_FROM_EMAIL is empty while email alerts are enabled')
    if any(row['key'] == 'email' and row['configured'] for row in channels) and not server_email:
        warnings.append('SERVER_EMAIL is empty while email alerts are enabled')
    if getattr(settings, 'APP_ENV', 'development') == 'production' and not incident_runbook:
        warnings.append('INCIDENT_RUNBOOK_URL is empty')
    if getattr(settings, 'APP_ENV', 'development') == 'production' and not incident_contacts:
        warnings.append('INCIDENT_CONTACT_EMAILS is empty')
    return {
        'app_env': str(getattr(settings, 'APP_ENV', 'development') or 'development'),
        'channels': channels,
        'configured_count': configured_count,
        'required_channel_count': required_channel_count,
        'required_channels': required_channels,
        'missing_required_channels': missing_required_channels,
        'default_from_email_configured': bool(default_from_email),
        'server_email_configured': bool(server_email),
        'incident_runbook_configured': bool(incident_runbook),
        'incident_contact_count': len(incident_contacts),
        'recommended_command': 'python manage.py alert_channel_readiness --json',
        'warning_count': len(warnings),
        'warnings': warnings,
        'status': 'warning' if warnings else 'ok',
    }


def get_alert_readiness_payload(hours=24):
    safe_hours = max(1, min(int(hours or 24), 168))
    channel_status = get_alert_channel_status_payload()
    delivery = get_alert_delivery_health_payload(hours=max(24, safe_hours))
    email_delivery = get_email_delivery_health_payload(hours=safe_hours)
    warnings = list(channel_status.get('warnings') or [])
    if delivery['status'] != 'ok':
        warnings.extend(item for item in delivery.get('warnings', []) if item not in warnings)
    if email_delivery['status_counts']['FAILED'] > 0:
        warnings.append('Recent email delivery failures exist in the lookback window.')
    return {
        'generated_at': timezone.now(),
        'config': channel_status,
        'delivery': delivery,
        'email_delivery': email_delivery,
        'incident_response': {
            'runbook_url': str(getattr(settings, 'INCIDENT_RUNBOOK_URL', '') or ''),
            'contacts': list(getattr(settings, 'INCIDENT_CONTACT_EMAILS', []) or []),
        },
        'recommended_commands': [
            'python manage.py alert_channel_readiness --json',
            'python manage.py send_test_alert --json',
        ],
        'warnings': warnings,
        'overall_status': 'warning' if warnings else 'ok',
    }


def _serialize_audit_log_record(log):
    payload = log.new_values or {}
    return {
        'id': int(log.id),
        'created_at': log.created_at,
        'action': str(log.action or ''),
        'entity_type': str(log.entity_type or ''),
        'entity_code': str(log.entity_code or ''),
        'user_id': int(log.user_id or 0) if getattr(log, 'user_id', None) else None,
        'user_label': (
            log.user.get_full_name() or log.user.username
            if getattr(log, 'user', None) is not None
            else None
        ),
        'payload': payload,
    }


def get_latest_audit_retention_run_payload():
    log = (
        AuditLog.objects
        .filter(entity_type='AuditRetention', action__in=['DRY_RUN', 'PURGE'])
        .select_related('user')
        .order_by('-created_at', '-id')
        .first()
    )
    if log is None:
        return None
    return _serialize_audit_log_record(log)


def get_alert_delivery_health_payload(hours=168):
    safe_hours = max(1, min(int(hours or 168), 24 * 30))
    cutoff = timezone.now() - timedelta(hours=safe_hours)
    configured = get_alert_channel_status_payload()
    logs = list(
        AuditLog.objects
        .filter(entity_type='AlertDelivery', created_at__gte=cutoff)
        .select_related('user')
        .order_by('-created_at', '-id')[:300]
    )
    status_counts = {'SUCCESS': 0, 'FAILED': 0, 'SKIPPED': 0}
    channel_summary = {}
    recent_results = []
    latest_successful_test_at = None
    latest_failed_test_at = None
    successful_test_channels = set()
    for log in logs:
        payload = log.new_values or {}
        status_value = str(payload.get('status') or '').upper()
        channel = str(payload.get('channel') or 'unknown').strip().lower()
        is_test = bool(payload.get('is_test'))
        if status_value in status_counts:
            status_counts[status_value] += 1
        row = channel_summary.setdefault(channel, {
            'channel': channel,
            'success_count': 0,
            'failed_count': 0,
            'skipped_count': 0,
            'latest_status': None,
            'latest_event_at': None,
            'latest_test_success_at': None,
        })
        if status_value == 'SUCCESS':
            row['success_count'] += 1
            if is_test:
                row['latest_test_success_at'] = log.created_at
                successful_test_channels.add(channel)
                if latest_successful_test_at is None:
                    latest_successful_test_at = log.created_at
        elif status_value == 'FAILED':
            row['failed_count'] += 1
            if is_test and latest_failed_test_at is None:
                latest_failed_test_at = log.created_at
        else:
            row['skipped_count'] += 1
        if row['latest_event_at'] is None:
            row['latest_event_at'] = log.created_at
            row['latest_status'] = status_value or 'UNKNOWN'
        if len(recent_results) < 12:
            recent_results.append({
                'created_at': log.created_at,
                'channel': channel,
                'status': status_value or 'UNKNOWN',
                'severity': str(payload.get('severity') or ''),
                'title': str(payload.get('title') or ''),
                'message': str(payload.get('message') or ''),
                'is_test': is_test,
            })

    warnings = []
    configured_channels = [
        str(item.get('key') or '').strip().lower()
        for item in configured['channels']
        if item.get('configured')
    ]
    if configured['configured_count'] == 0:
        warnings.append('No alert channels are configured for delivery.')
    elif status_counts['SUCCESS'] == 0:
        warnings.append('No successful alert delivery has been recorded in the lookback window.')
    if configured_channels and not successful_test_channels.intersection(configured_channels):
        warnings.append('No successful alert drill has been recorded for currently configured channels.')

    return {
        'hours_window': safe_hours,
        'configured_count': configured['configured_count'],
        'configured_channels': configured_channels,
        'status_counts': status_counts,
        'channel_summary': sorted(channel_summary.values(), key=lambda row: row['channel']),
        'recent_results': recent_results,
        'latest_successful_test_at': latest_successful_test_at,
        'latest_failed_test_at': latest_failed_test_at,
        'warning_count': len(warnings),
        'warnings': warnings,
        'status': 'warning' if warnings else 'ok',
    }


def get_email_delivery_health_payload(hours=24):
    safe_hours = max(1, min(int(hours or 24), 168))
    cutoff = timezone.now() - timedelta(hours=safe_hours)
    logs = list(
        AuditLog.objects
        .filter(entity_type='MailDelivery', created_at__gte=cutoff)
        .select_related('user')
        .order_by('-created_at', '-id')[:200]
    )
    status_counts = {'SUCCESS': 0, 'FAILED': 0, 'SKIPPED': 0}
    latest_failure = None
    for log in logs:
        payload = log.new_values or {}
        status_value = str(payload.get('status') or '').upper()
        if status_value in status_counts:
            status_counts[status_value] += 1
        if latest_failure is None and status_value == 'FAILED':
            latest_failure = {
                'created_at': log.created_at,
                'message': str(payload.get('message') or ''),
                'recipient_email': str(payload.get('recipient_email') or ''),
            }
    delivered_total = status_counts['SUCCESS'] + status_counts['FAILED']
    failure_rate_pct = round((status_counts['FAILED'] / delivered_total) * 100, 2) if delivered_total else 0.0
    status_value = 'warning' if status_counts['FAILED'] > 0 else 'ok'
    return {
        'hours_window': safe_hours,
        'status_counts': status_counts,
        'failure_rate_pct': failure_rate_pct,
        'latest_failure': latest_failure,
        'status': status_value,
    }


def _run_git_command(args, cwd: Path):
    try:
        result = subprocess.run(
            ['git', *args],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return {'ok': False, 'stdout': '', 'stderr': 'git unavailable'}
    return {
        'ok': result.returncode == 0,
        'stdout': str(result.stdout or '').strip(),
        'stderr': str(result.stderr or '').strip(),
    }


def get_release_hygiene_payload():
    repo_root = Path(settings.BASE_DIR).parent
    branch_result = _run_git_command(['rev-parse', '--abbrev-ref', 'HEAD'], repo_root)
    commit_result = _run_git_command(['rev-parse', 'HEAD'], repo_root)
    tag_result = _run_git_command(['describe', '--tags', '--abbrev=0'], repo_root)
    status_result = _run_git_command(['status', '--short'], repo_root)

    counts = {
        'modified': 0,
        'added': 0,
        'deleted': 0,
        'renamed': 0,
        'conflicts': 0,
        'untracked': 0,
    }
    changed_files = []
    artifact_candidates = []
    migration_candidates = []
    status_lines = [line for line in str(status_result.get('stdout') or '').splitlines() if line.strip()]
    for line in status_lines:
        code = (line[:2] or '').strip()
        raw_path = str(line[2:] if len(line) > 2 else line).strip()
        path_value = raw_path.split('->')[-1].strip()
        normalized_path = path_value.replace('\\', '/')
        if code == '??':
            counts['untracked'] += 1
        elif 'U' in code:
            counts['conflicts'] += 1
        else:
            if 'M' in code:
                counts['modified'] += 1
            if 'A' in code:
                counts['added'] += 1
            if 'D' in code:
                counts['deleted'] += 1
            if 'R' in code:
                counts['renamed'] += 1
        changed_files.append({
            'code': code or '??',
            'path': normalized_path,
        })
        lower_path = normalized_path.lower()
        if '/migrations/' in lower_path and lower_path.endswith('.py') and not lower_path.endswith('__init__.py'):
            migration_candidates.append(normalized_path)
        if (
            lower_path.endswith('.log')
            or lower_path.endswith('/restore_dry_run.json')
            or lower_path.endswith('/restore_last_run.json')
            or lower_path.endswith('go_live_handoff_latest.json')
            or lower_path.endswith('release_lock_latest.json')
        ):
            artifact_candidates.append(normalized_path)

    warnings = []
    total_changes = sum(counts.values())
    if not branch_result['ok'] or not commit_result['ok']:
        warnings.append('Git metadata is unavailable for release hygiene checks.')
    if total_changes > 0:
        warnings.append(f'Repository still has {total_changes} uncommitted changes.')
    if counts['conflicts'] > 0:
        warnings.append('Repository has unresolved merge conflicts.')
    if migration_candidates:
        warnings.append('Release branch still has migration files in the open change set.')
    if artifact_candidates:
        warnings.append('Generated artifacts/logs are still present in the working tree.')

    return {
        'repo_root': str(repo_root),
        'branch': branch_result['stdout'],
        'commit_sha': commit_result['stdout'],
        'latest_tag': tag_result['stdout'] if tag_result['ok'] else '',
        'git_available': bool(branch_result['ok'] and commit_result['ok']),
        'counts': counts,
        'total_changes': total_changes,
        'open_changes': changed_files[:80],
        'migration_candidates': sorted(dict.fromkeys(migration_candidates)),
        'artifact_candidates': sorted(dict.fromkeys(artifact_candidates)),
        'recommended_commands': [
            'git status --short',
            'git diff --stat',
            'python manage.py cleanup_release_artifacts --json',
            'python manage.py release_lockfile --json',
            'git tag <release-version>',
        ],
        'warnings': warnings,
        'status': 'warning' if warnings else 'ok',
    }


def _performance_dataset_row(*, key, label, count, route, recommendation, warning_rows, critical_rows):
    risk_band = 'ok'
    if count >= critical_rows:
        risk_band = 'critical'
    elif count >= warning_rows:
        risk_band = 'warning'
    return {
        'key': key,
        'label': label,
        'count': int(count),
        'route': route,
        'risk_band': risk_band,
        'status': 'warning' if risk_band in {'warning', 'critical'} else 'ok',
        'recommendation': recommendation,
    }


def get_performance_readiness_payload():
    warning_rows = max(1, int(getattr(settings, 'LARGE_DATA_WARNING_ROWS', 1000) or 1000))
    critical_rows = max(warning_rows + 1, int(getattr(settings, 'LARGE_DATA_CRITICAL_ROWS', 10000) or 10000))

    rows = [
        _performance_dataset_row(
            key='audit_logs',
            label='Audit logs',
            count=AuditLog.objects.count(),
            route='/admin/audit-center',
            recommendation='Review retention cadence and export strategy before large-volume cutover.',
            warning_rows=warning_rows,
            critical_rows=critical_rows,
        ),
        _performance_dataset_row(
            key='notifications',
            label='Notifications',
            count=Notification.objects.count(),
            route='/notifications',
            recommendation='Verify inbox pagination and unread badge queries on staging.',
            warning_rows=warning_rows,
            critical_rows=critical_rows,
        ),
        _performance_dataset_row(
            key='active_sessions',
            label='Active sessions',
            count=UserSession.objects.filter(is_active=True).count(),
            route='/admin/users',
            recommendation='Recheck session cleanup and account lock workflows with real concurrency.',
            warning_rows=warning_rows,
            critical_rows=critical_rows,
        ),
        _performance_dataset_row(
            key='tasks',
            label='Workflow tasks',
            count=Task.objects.count(),
            route='/task-inbox',
            recommendation='Confirm task inbox filters and pagination under heavy assignment volume.',
            warning_rows=warning_rows,
            critical_rows=critical_rows,
        ),
        _performance_dataset_row(
            key='workflow_events',
            label='Workflow pipeline events',
            count=WorkflowPipelineEvent.objects.count(),
            route='/workflow-analytics',
            recommendation='Validate analytics queries, debounce, and chart loading on large timelines.',
            warning_rows=warning_rows,
            critical_rows=critical_rows,
        ),
    ]

    optional_models = [
        ('purchase_orders', 'Purchase orders', '/purchase-orders', 'Recheck list filters, status tabs, and receiving flows on staging.'),
        ('production_orders', 'Production orders', '/production-orders', 'Validate active board filters and dashboard refresh on production-like volume.'),
        ('sales_orders', 'Sales orders', '/sales-orders', 'Review posting/void lists and customer search behavior with real data.'),
    ]
    for key, label, route, recommendation in optional_models:
        try:
            if key == 'purchase_orders':
                from purchasing.models import PurchaseOrder

                count = PurchaseOrder.objects.count()
            elif key == 'production_orders':
                from production.models import ProductionOrder

                count = ProductionOrder.objects.count()
            else:
                from sales.models import SalesOrder

                count = SalesOrder.objects.count()
        except Exception:
            continue
        rows.append(
            _performance_dataset_row(
                key=key,
                label=label,
                count=count,
                route=route,
                recommendation=recommendation,
                warning_rows=warning_rows,
                critical_rows=critical_rows,
            )
        )

    warning_count = len([row for row in rows if row['risk_band'] == 'warning'])
    critical_count = len([row for row in rows if row['risk_band'] == 'critical'])
    warnings = []
    if critical_count > 0:
        warnings.append('At least one large-data surface is already above the critical rehearsal threshold.')
    elif warning_count > 0:
        warnings.append('Large-data rehearsal should focus on the flagged command centers before production cutover.')

    return {
        'warning_rows': warning_rows,
        'critical_rows': critical_rows,
        'slow_query_threshold_ms': int(getattr(settings, 'DB_SLOW_QUERY_THRESHOLD_MS', 0) or 0),
        'datasets': rows,
        'summary': {
            'tracked_dataset_count': len(rows),
            'warning_count': warning_count,
            'critical_count': critical_count,
        },
        'recommended_commands': [
            'python manage.py performance_readiness --json',
            'python manage.py performance_drilldown --json',
            'python manage.py release_readiness --json',
        ],
        'warnings': warnings,
        'status': 'warning' if warnings else 'ok',
    }


def get_uat_user_matrix_snapshot():
    try:
        from core.management.commands.bootstrap_uat_demo import USER_MATRIX
    except Exception:
        USER_MATRIX = []
    expected_usernames = [str(row.get('username') or '') for row in USER_MATRIX if str(row.get('username') or '')]
    existing_usernames = set(User.objects.filter(username__in=expected_usernames).values_list('username', flat=True))
    missing_usernames = [username for username in expected_usernames if username not in existing_usernames]
    return {
        'expected_count': len(expected_usernames),
        'available_count': len(existing_usernames),
        'missing_count': len(missing_usernames),
        'missing_usernames': missing_usernames,
    }


def get_critical_data_snapshot():
    snapshots = [
        {'key': 'users', 'label': 'Users', 'count': User.objects.count()},
        {'key': 'customers', 'label': 'Customers', 'count': Customer.objects.count()},
        {'key': 'notifications', 'label': 'Notifications', 'count': Notification.objects.count()},
        {'key': 'audit_logs', 'label': 'Audit logs', 'count': AuditLog.objects.count()},
        {'key': 'active_sessions', 'label': 'Active sessions', 'count': UserSession.objects.filter(is_active=True).count()},
    ]

    try:
        from finance.models import AdvanceTransaction
        snapshots.append({'key': 'advance_transactions', 'label': 'Advance transactions', 'count': AdvanceTransaction.objects.count()})
    except Exception:
        pass
    try:
        from purchasing.models import PurchaseOrder, PurchaseReceipt, PurchaseRequest, PurchaseReturn
        snapshots.extend([
            {'key': 'purchase_requests', 'label': 'Purchase requests', 'count': PurchaseRequest.objects.count()},
            {'key': 'purchase_orders', 'label': 'Purchase orders', 'count': PurchaseOrder.objects.count()},
            {'key': 'purchase_receipts', 'label': 'Purchase receipts', 'count': PurchaseReceipt.objects.count()},
            {'key': 'purchase_returns', 'label': 'Purchase returns', 'count': PurchaseReturn.objects.count()},
        ])
    except Exception:
        pass
    try:
        from production.models import ProductionIssue, ProductionOrder, ProductionReceipt
        snapshots.extend([
            {'key': 'production_orders', 'label': 'Production orders', 'count': ProductionOrder.objects.count()},
            {'key': 'production_issues', 'label': 'Production issues', 'count': ProductionIssue.objects.count()},
            {'key': 'production_receipts', 'label': 'Production receipts', 'count': ProductionReceipt.objects.count()},
        ])
    except Exception:
        pass
    try:
        from sales.models import SalesOrder
        snapshots.append({'key': 'sales_orders', 'label': 'Sales orders', 'count': SalesOrder.objects.count()})
    except Exception:
        pass
    try:
        from workforce.models import SalaryAdvanceRecord
        snapshots.append({'key': 'salary_advances', 'label': 'Salary advances', 'count': SalaryAdvanceRecord.objects.count()})
    except Exception:
        pass

    return snapshots
