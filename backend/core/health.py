import os
import shutil

from django.conf import settings
from django.db import connection
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


def _database_check():
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return {'status': 'ok'}


def _media_check():
    media_root = settings.MEDIA_ROOT
    if os.path.exists(media_root):
        writable = os.access(media_root, os.W_OK)
        return {
            'status': 'ok' if writable else 'warning',
            'path': str(media_root),
            'writable': writable,
        }
    return {'status': 'warning', 'message': 'Media directory does not exist', 'path': str(media_root)}


def _disk_check():
    base_path = str(settings.BASE_DIR.anchor or settings.BASE_DIR)
    stat = shutil.disk_usage(base_path)
    free_gb = stat.free / (1024**3)
    return {
        'status': 'ok' if free_gb > 1 else 'warning',
        'free_gb': round(free_gb, 2),
        'total_gb': round(stat.total / (1024**3), 2),
    }


def _memory_check():
    try:
        import psutil  # type: ignore[reportMissingImports]
    except ImportError:
        return {'status': 'skipped', 'message': 'psutil not installed'}
    mem = psutil.virtual_memory()
    return {
        'status': 'ok' if mem.percent < 90 else 'warning',
        'percent': mem.percent,
        'available_gb': round(mem.available / (1024**3), 2),
    }


def _queue_check():
    result = {'status': 'ok', 'cluster_name': settings.Q_CLUSTER.get('name', 'unknown')}
    try:
        from django_q.models import OrmQ
        result['queued_items'] = OrmQ.objects.count()
        queue_limit = int(settings.Q_CLUSTER.get('queue_limit') or 0)
        if queue_limit and result['queued_items'] > queue_limit:
            result['status'] = 'warning'
            result['message'] = 'Queue depth is above configured queue_limit'
    except Exception as exc:
        result = {'status': 'warning', 'message': f'Queue stats unavailable: {exc}'}
    return result


def _data_check():
    from .models import AuditLog, Comment, Customer, Notification, User
    return {
        'status': 'ok',
        'users': User.objects.count(),
        'customers': Customer.objects.count(),
        'audit_logs': AuditLog.objects.count(),
        'comments': Comment.objects.count(),
        'notifications': Notification.objects.count(),
    }


def _compose_health(include_extended=False):
    checks = {}
    status = 'healthy'
    checkers = [
        ('database', _database_check),
        ('media', _media_check),
    ]
    if include_extended:
        checkers.extend([
            ('disk', _disk_check),
            ('memory', _memory_check),
            ('queue', _queue_check),
            ('data', _data_check),
        ])
    for key, checker in checkers:
        try:
            result = checker()
        except Exception as exc:
            result = {'status': 'error', 'message': str(exc)}
        checks[key] = result
        if result.get('status') == 'error':
            status = 'unhealthy'
    return {
        'status': status,
        'app_env': getattr(settings, 'APP_ENV', 'unknown'),
        'server_time': timezone.now(),
        'checks': checks,
    }


@api_view(['GET'])
@permission_classes([AllowAny])
def live_check(request):
    return Response({
        'status': 'alive',
        'app_env': getattr(settings, 'APP_ENV', 'unknown'),
        'server_time': timezone.now(),
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def ready_check(request):
    return Response(_compose_health(include_extended=False))


@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    """Detailed system health check for monitoring dashboards."""
    include_extended = str(request.query_params.get('verbose') or '1').strip().lower() not in ('0', 'false', 'no')
    return Response(_compose_health(include_extended=include_extended))
