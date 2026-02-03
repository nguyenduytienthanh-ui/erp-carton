from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    UserViewSet, RoleViewSet, PermissionViewSet,
    TeamViewSet, SettingViewSet, CustomTokenObtainPairView,
    CustomerViewSet, ExportTemplateViewSet, SavedViewViewSet, AttachmentViewSet, CommentViewSet, ActivityStreamViewSet, NotificationViewSet, UserSessionViewSet,
)
router = DefaultRouter()
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

urlpatterns = [
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('', include(router.urls)),
]