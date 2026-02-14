from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ProductCategoryViewSet,
    ProductUnitViewSet,
    ProductWaveViewSet,
    ProductBoxTypeViewSet,
    ProductViewSet,
)
router = DefaultRouter()
router.register(r'categories', ProductCategoryViewSet, basename='productcategory')
router.register(r'units', ProductUnitViewSet, basename='productunit')
router.register(r'waves', ProductWaveViewSet, basename='wave')
router.register(r'box-types', ProductBoxTypeViewSet, basename='boxtype')
router.register(r'products', ProductViewSet, basename='product')

urlpatterns = [
    path('', include(router.urls)),
]

