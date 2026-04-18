from __future__ import annotations

import json
import logging
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from core.models import AuditLog

logger = logging.getLogger(__name__)

try:
    import sentry_sdk
except Exception:  # pragma: no cover - optional dependency
    sentry_sdk = None


ALERT_CHANNELS = ('email', 'slack', 'telegram', 'sentry')


def _alert_timeout_seconds() -> int:
    return max(1, int(getattr(settings, 'ALERT_HTTP_TIMEOUT_SECONDS', 10) or 10))


def _configured_channels():
    return {
        'email': bool(list(getattr(settings, 'ALERT_EMAIL_RECIPIENTS', []) or [])),
        'slack': bool(str(getattr(settings, 'ALERT_SLACK_WEBHOOK_URL', '') or '').strip()),
        'telegram': bool(
            str(getattr(settings, 'ALERT_TELEGRAM_BOT_TOKEN', '') or '').strip()
            and str(getattr(settings, 'ALERT_TELEGRAM_CHAT_ID', '') or '').strip()
        ),
        'sentry': bool(str(getattr(settings, 'SENTRY_DSN', '') or '').strip() and sentry_sdk),
    }


def _record_alert_delivery_audit(*, channel: str, status_value: str, title: str, message: str, severity: str, is_test: bool, actor=None, detail: str = '', metadata=None):
    try:
        AuditLog.objects.create(
            user=actor if getattr(actor, 'is_authenticated', False) else None,
            action='DELIVER',
            entity_type='AlertDelivery',
            entity_id=0,
            entity_id_str=channel,
            entity_code=str(channel or '').upper(),
            old_values={},
            new_values={
                'channel': str(channel or '').lower(),
                'status': str(status_value or '').upper(),
                'title': str(title or '')[:200],
                'message': str(message or '')[:500],
                'severity': str(severity or 'warning').lower(),
                'is_test': bool(is_test),
                'detail': str(detail or '')[:500],
                'metadata': metadata or {},
                'delivered_at': timezone.now().isoformat(),
            },
            changed_fields=['status'],
        )
    except Exception:
        logger.exception('Failed to record alert delivery audit for channel %s', channel)


def _send_email_alert(*, title: str, message: str, severity: str):
    recipients = list(getattr(settings, 'ALERT_EMAIL_RECIPIENTS', []) or [])
    if not recipients:
        return {'status': 'SKIPPED', 'detail': 'ALERT_EMAIL_RECIPIENTS is empty.'}
    subject = f"[ERP Carton][{severity.upper()}] {title}"
    send_mail(
        subject=subject,
        message=message,
        from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
        recipient_list=recipients,
        fail_silently=False,
    )
    return {'status': 'SUCCESS', 'detail': f'Email sent to {len(recipients)} recipient(s).'}


def _send_slack_alert(*, title: str, message: str, severity: str):
    webhook_url = str(getattr(settings, 'ALERT_SLACK_WEBHOOK_URL', '') or '').strip()
    if not webhook_url:
        return {'status': 'SKIPPED', 'detail': 'ALERT_SLACK_WEBHOOK_URL is empty.'}
    payload = json.dumps({
        'text': f"[{severity.upper()}] {title}\n{message}",
    }).encode('utf-8')
    request = Request(
        webhook_url,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    with urlopen(request, timeout=_alert_timeout_seconds()) as response:
        response.read()
        code = getattr(response, 'status', None) or response.getcode()
    return {'status': 'SUCCESS', 'detail': f'Slack webhook responded with HTTP {code}.'}


def _send_telegram_alert(*, title: str, message: str, severity: str):
    token = str(getattr(settings, 'ALERT_TELEGRAM_BOT_TOKEN', '') or '').strip()
    chat_id = str(getattr(settings, 'ALERT_TELEGRAM_CHAT_ID', '') or '').strip()
    if not token or not chat_id:
        return {'status': 'SKIPPED', 'detail': 'Telegram bot token or chat id is missing.'}
    payload = urlencode({
        'chat_id': chat_id,
        'text': f"[{severity.upper()}] {title}\n{message}",
    }).encode('utf-8')
    request = Request(
        f'https://api.telegram.org/bot{token}/sendMessage',
        data=payload,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        method='POST',
    )
    with urlopen(request, timeout=_alert_timeout_seconds()) as response:
        response.read()
        code = getattr(response, 'status', None) or response.getcode()
    return {'status': 'SUCCESS', 'detail': f'Telegram API responded with HTTP {code}.'}


def _send_sentry_alert(*, title: str, message: str, severity: str):
    if not str(getattr(settings, 'SENTRY_DSN', '') or '').strip():
        return {'status': 'SKIPPED', 'detail': 'SENTRY_DSN is empty.'}
    if sentry_sdk is None:
        return {'status': 'SKIPPED', 'detail': 'sentry_sdk is not installed.'}
    sentry_sdk.capture_message(f"[{severity.upper()}] {title}: {message}", level=str(severity or 'warning').lower())
    return {'status': 'SUCCESS', 'detail': 'Alert captured by Sentry.'}


def send_operational_alert(*, title: str, message: str, severity: str = 'warning', channels=None, actor=None, metadata=None, is_test: bool = False):
    normalized_channels = [
        str(item).strip().lower()
        for item in (channels or ALERT_CHANNELS)
        if str(item).strip().lower() in ALERT_CHANNELS
    ]
    if not normalized_channels:
        normalized_channels = list(ALERT_CHANNELS)

    sender_map = {
        'email': _send_email_alert,
        'slack': _send_slack_alert,
        'telegram': _send_telegram_alert,
        'sentry': _send_sentry_alert,
    }
    results = []
    status_counts = {'SUCCESS': 0, 'FAILED': 0, 'SKIPPED': 0}
    for channel in normalized_channels:
        sender = sender_map[channel]
        try:
            result = sender(title=title, message=message, severity=severity)
        except Exception as exc:
            logger.exception('Operational alert delivery failed for %s', channel)
            result = {'status': 'FAILED', 'detail': str(exc)}
        status_value = str(result.get('status') or 'FAILED').upper()
        if status_value not in status_counts:
            status_value = 'FAILED'
        status_counts[status_value] += 1
        _record_alert_delivery_audit(
            channel=channel,
            status_value=status_value,
            title=title,
            message=message,
            severity=severity,
            is_test=is_test,
            actor=actor,
            detail=str(result.get('detail') or ''),
            metadata=metadata,
        )
        results.append({
            'channel': channel,
            'status': status_value,
            'detail': str(result.get('detail') or ''),
        })

    configured = _configured_channels()
    overall_status = 'ok' if status_counts['SUCCESS'] > 0 and status_counts['FAILED'] == 0 else 'warning'
    if status_counts['SUCCESS'] == 0:
        overall_status = 'warning' if status_counts['SKIPPED'] > 0 else 'error'
    if status_counts['FAILED'] > 0 and status_counts['SUCCESS'] == 0:
        overall_status = 'error'

    return {
        'title': title,
        'message': message,
        'severity': str(severity or 'warning').lower(),
        'is_test': bool(is_test),
        'requested_channels': normalized_channels,
        'configured_channels': [channel for channel, is_configured in configured.items() if is_configured],
        'status_counts': status_counts,
        'overall_status': overall_status,
        'results': results,
    }
