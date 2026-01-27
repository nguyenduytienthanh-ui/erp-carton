from django.contrib import admin
from django.urls import path, include
from core.views import customer_export_view

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/customers/export/', customer_export_view, name='customer-export-direct'),
    path('api/', include('core.urls')),
]