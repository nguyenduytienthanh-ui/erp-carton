from django.urls import path, include, re_path
from rest_framework.routers import DefaultRouter
from .views import (
    ProductCategoryViewSet,
    ProductUnitViewSet,
    ProductWaveViewSet,
    ProductBoxTypeViewSet,
    ProductViewSet,
)
from core.views import export_products_excel_view

router = DefaultRouter()
router.register(r'categories', ProductCategoryViewSet, basename='productcategory')
router.register(r'units', ProductUnitViewSet, basename='productunit')
router.register(r'waves', ProductWaveViewSet, basename='wave')
router.register(r'box-types', ProductBoxTypeViewSet, basename='boxtype')
router.register(r'products', ProductViewSet, basename='product')

# Bắt cả export-excel và export-excel/ (Django có thể truyền remainder không có trailing slash)
urlpatterns = [
    re_path(r'^export-excel/?$', export_products_excel_view, name='products-export-excel'),
    path('', include(router.urls)),
]

