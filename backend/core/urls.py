from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    UserViewSet, RoleViewSet, PermissionViewSet,
    TeamViewSet, SettingViewSet, CustomTokenObtainPairView,
    CustomerViewSet, ExportTemplateViewSet, SavedViewViewSet, AttachmentViewSet, CommentViewSet, ActivityStreamViewSet, NotificationViewSet, UserSessionViewSet,
    UserPreferencesViewSet,
    ColumnPermissionViewSet,
)
from products.views import (
    ProductCategoryViewSet,
    ProductUnitViewSet,
    ProductWaveViewSet,
    ProductBoxTypeViewSet,
    ProductViewSet,
)
from sales.views import SalesOrderViewSet

router = DefaultRouter()
router.register(r'column-permissions', ColumnPermissionViewSet, basename='column-permission')
router.register(r'users', UserViewSet)
router.register(r'roles', RoleViewSet)
router.register(r'permissions', PermissionViewSet)
router.register(r'teams', TeamViewSet)
router.register(r'settings', SettingViewSet)
router.register(r'customers', CustomerViewSet, basename='customer')
router.register(r'export-templates', ExportTemplateViewSet)
router.register(r'saved-views', SavedViewViewSet, basename='savedview')
router.register(r'attachments', AttachmentViewSet, basename='attachment')
router.register(r'comments', CommentViewSet, basename='comment')
router.register(r'activity', ActivityStreamViewSet, basename='activity')
router.register(r'notifications', NotificationViewSet, basename='notification')
router.register(r'sessions', UserSessionViewSet, basename='session')
# Sản phẩm: đăng ký chung một router để tránh lỗi "drf_format_suffix already registered"
router.register(r'products/categories', ProductCategoryViewSet, basename='productcategory')
router.register(r'products/units', ProductUnitViewSet, basename='productunit')
router.register(r'products/waves', ProductWaveViewSet, basename='wave')
router.register(r'products/box-types', ProductBoxTypeViewSet, basename='boxtype')
router.register(r'products/products', ProductViewSet, basename='product')
router.register(r'sales/orders', SalesOrderViewSet, basename='salesorder')

urlpatterns = [
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('preferences/<str:page>/', UserPreferencesViewSet.as_view(actions={'get': 'page_config', 'post': 'page_config', 'delete': 'page_config'}), name='userpreferences-page-config'),
    path('', include(router.urls)),
]