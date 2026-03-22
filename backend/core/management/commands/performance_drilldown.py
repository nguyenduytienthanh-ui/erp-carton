from __future__ import annotations

import json
import time

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import AuditLog, Notification, Task, UserSession, WorkflowPipelineEvent
from core.release_readiness import get_performance_readiness_payload


def _safe_explain(queryset):
    try:
        return str(queryset.explain() or '').strip()
    except Exception as exc:  # pragma: no cover - depends on db backend
        return f'Explain unavailable: {exc}'


SURFACE_INDEX_HINTS = {
    'audit_logs': ['auditlog_created_desc_idx', 'auditlog_type_created_idx'],
    'active_sessions': ['usersession_active_last_idx', 'usersession_user_active_idx'],
}


def _measure_surface(*, key, label, route, queryset, count_value, threshold_ms, sample_size):
    sample_queryset = queryset.values_list('pk', flat=True)[:sample_size]

    count_started = time.perf_counter()
    queryset.count()
    count_ms = round((time.perf_counter() - count_started) * 1000, 2)

    sample_started = time.perf_counter()
    sample_ids = list(sample_queryset)
    sample_ms = round((time.perf_counter() - sample_started) * 1000, 2)

    explain_text = _safe_explain(sample_queryset)
    slow_signals = []
    if threshold_ms > 0 and count_ms >= threshold_ms:
        slow_signals.append('count_query')
    if threshold_ms > 0 and sample_ms >= threshold_ms:
        slow_signals.append('sample_query')

    return {
        'key': key,
        'label': label,
        'route': route,
        'count': int(count_value),
        'sample_size': int(sample_size),
        'sample_ids': sample_ids,
        'count_query_ms': count_ms,
        'sample_query_ms': sample_ms,
        'index_hints': SURFACE_INDEX_HINTS.get(key, []),
        'explain_excerpt': explain_text[:2000],
        'slow_signals': slow_signals,
        'status': 'warning' if slow_signals else 'ok',
    }


def _surface_queryset(key):
    if key == 'audit_logs':
        return AuditLog.objects.order_by('-created_at', '-id')
    if key == 'notifications':
        return Notification.objects.order_by('-created_at', '-id')
    if key == 'active_sessions':
        return UserSession.objects.filter(is_active=True).order_by('-last_active', '-id')
    if key == 'tasks':
        return Task.objects.order_by('-updated_at', '-id')
    if key == 'workflow_events':
        return WorkflowPipelineEvent.objects.order_by('-created_at', '-id')
    if key == 'purchase_orders':
        from purchasing.models import PurchaseOrder

        return PurchaseOrder.objects.order_by('-id')
    if key == 'production_orders':
        from production.models import ProductionOrder

        return ProductionOrder.objects.order_by('-id')
    if key == 'sales_orders':
        from sales.models import SalesOrder

        return SalesOrder.objects.order_by('-id')
    raise LookupError(f'Unsupported performance surface: {key}')


class Command(BaseCommand):
    help = 'Measure count/sample latency and explain excerpts for flagged large-data surfaces'

    def add_arguments(self, parser):
        parser.add_argument('--include-all', action='store_true', help='Inspect all tracked surfaces, not only warning/critical ones')
        parser.add_argument('--sample-size', type=int, default=25, help='How many ids to fetch in the sample query')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')

    def handle(self, *args, **options):
        include_all = bool(options.get('include_all'))
        sample_size = max(1, min(int(options.get('sample_size') or 25), 200))

        readiness_payload = get_performance_readiness_payload()
        threshold_ms = int(readiness_payload.get('slow_query_threshold_ms') or 0)
        datasets = list(readiness_payload.get('datasets') or [])
        selected = [
            item for item in datasets
            if include_all or str(item.get('risk_band') or 'ok') in {'warning', 'critical'}
        ]
        if not selected and datasets:
            selected = sorted(datasets, key=lambda item: int(item.get('count') or 0), reverse=True)[:3]

        surfaces = []
        warnings = []
        for item in selected:
            key = str(item.get('key') or '').strip()
            if not key:
                continue
            try:
                queryset = _surface_queryset(key)
            except (LookupError, ImportError):
                continue
            surfaces.append(_measure_surface(
                key=key,
                label=str(item.get('label') or key),
                route=str(item.get('route') or ''),
                queryset=queryset,
                count_value=int(item.get('count') or 0),
                threshold_ms=threshold_ms,
                sample_size=sample_size,
            ))

        slow_surface_count = len([item for item in surfaces if item['slow_signals']])
        if slow_surface_count > 0:
            warnings.append('At least one sampled surface crossed the configured slow-query threshold.')
        elif surfaces:
            warnings.append('Capture drilldown output in the release packet even when timings are acceptable.')

        payload = {
            'generated_at': timezone.now(),
            'include_all': include_all,
            'sample_size': sample_size,
            'slow_query_threshold_ms': threshold_ms,
            'surface_count': len(surfaces),
            'slow_surface_count': slow_surface_count,
            'surfaces': surfaces,
            'recommended_commands': [
                'python manage.py performance_readiness --json',
                'python manage.py performance_drilldown --json',
                'python manage.py performance_drilldown --include-all --json',
            ],
            'warnings': warnings,
            'status': 'warning' if slow_surface_count > 0 else 'ok',
        }

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Performance drilldown: {payload['status'].upper()}")
            self.stdout.write(f"- surfaces: {payload['surface_count']}")
            self.stdout.write(f"- slow surfaces: {payload['slow_surface_count']}")
