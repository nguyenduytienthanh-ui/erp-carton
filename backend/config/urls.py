import os
from django.contrib import admin
from django.shortcuts import redirect
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from core.views import logout_view
from core.health import health_check

# In ra khi load: nếu thấy đường dẫn khác D:\ERP-Carton\... thì server đang chạy từ thư mục sai
if os.environ.get('RUN_MAIN') == 'true':
    print('[URLs] Loaded from:', os.path.abspath(__file__))

def root_redirect(request):
    """Mở http://127.0.0.1:8000/ → chuyển sang admin (tránh 404)."""
    return redirect('admin:index')

urlpatterns = [
    path('', root_redirect),
    path('admin/', admin.site.urls),
    path('health/', health_check, name='health-check'),
    path('api/auth/logout/', logout_view, name='logout'),
    path('api/', include('core.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
