from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)
from .views import (
    UserViewSet, RoleViewSet, PermissionViewSet,
    TeamViewSet, SettingViewSet, CustomTokenObtainPairView,
    CustomerViewSet
)

router = DefaultRouter()
router.register('users', UserViewSet)
router.register('roles', RoleViewSet)
router.register('permissions', PermissionViewSet)
router.register('teams', TeamViewSet)
router.register('settings', SettingViewSet)
router.register('customers', CustomerViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
]
