from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.db import connection
from django.core.cache import cache
import os

@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    """System health check"""
    
    health = {
        'status': 'healthy',
        'checks': {}
    }
    
    # 1. Database check
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        health['checks']['database'] = {'status': 'ok'}
    except Exception as e:
        health['status'] = 'unhealthy'
        health['checks']['database'] = {'status': 'error', 'message': str(e)}
    
    # 2. Media directory check
    try:
        media_root = getattr(request._request, 'settings', None)
        if hasattr(request, '_request'):
            from django.conf import settings
            if os.path.exists(settings.MEDIA_ROOT):
                health['checks']['media'] = {'status': 'ok', 'path': str(settings.MEDIA_ROOT)}
            else:
                health['checks']['media'] = {'status': 'warning', 'message': 'Media directory does not exist'}
    except Exception as e:
        health['checks']['media'] = {'status': 'error', 'message': str(e)}
    
    # 3. Disk space check
    try:
        import shutil
        stat = shutil.disk_usage('/')
        free_gb = stat.free / (1024**3)
        health['checks']['disk'] = {
            'status': 'ok' if free_gb > 1 else 'warning',
            'free_gb': round(free_gb, 2),
            'total_gb': round(stat.total / (1024**3), 2)
        }
    except Exception as e:
        health['checks']['disk'] = {'status': 'error', 'message': str(e)}
    
    # 4. Memory check
    try:
        import psutil
        mem = psutil.virtual_memory()
        health['checks']['memory'] = {
            'status': 'ok' if mem.percent < 90 else 'warning',
            'percent': mem.percent,
            'available_gb': round(mem.available / (1024**3), 2)
        }
    except ImportError:
        health['checks']['memory'] = {'status': 'skipped', 'message': 'psutil not installed'}
    except Exception as e:
        health['checks']['memory'] = {'status': 'error', 'message': str(e)}
    
    # 5. Models count
    try:
        from .models import User, Customer, AuditLog, Comment, Notification
        health['checks']['data'] = {
            'users': User.objects.count(),
            'customers': Customer.objects.count(),
            'audit_logs': AuditLog.objects.count(),
            'comments': Comment.objects.count(),
            'notifications': Notification.objects.count(),
        }
    except Exception as e:
        health['checks']['data'] = {'status': 'error', 'message': str(e)}
    
    return Response(health)
