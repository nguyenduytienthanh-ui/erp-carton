"""
Permissions theo action (resource + action).
Ví dụ: kho chỉ view, admin mới deactivate/export/import.
Kiểm tra user có role chứa permission (resource, action) tương ứng.
"""
from django.conf import settings
from rest_framework.permissions import BasePermission


# Strict mode: không cấu hình permission = từ chối (default-allow = False)
PERMISSION_STRICT_DEFAULT = getattr(settings, 'PERMISSION_STRICT_DEFAULT', False)


class ResourceActionPermission(BasePermission):
    """
    Cho phép nếu user là superuser hoặc có ít nhất một role có permission (resource, action).
    required_permission trên view: ('Resource', 'ACTION').
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if getattr(request.user, 'is_superuser', False):
            return True
        required = getattr(view, 'required_permission', None)
        if required:
            resource, action = required
            return _user_has_perm(request.user, resource, action)
        return True

    def has_object_permission(self, request, view, obj):
        return True


def _user_has_perm(user, resource, action, strict=None):
    """
    User có permission (resource, action) thông qua roles không.
    strict: None = dùng PERMISSION_STRICT_DEFAULT; True = không cấu hình = từ chối; False = không cấu hình = cho qua.
    """
    if getattr(user, 'is_superuser', False):
        return True
    from .models import Permission
    perm = Permission.objects.filter(resource=resource.upper(), action=action.upper()).first()
    if not perm:
        use_strict = strict if strict is not None else PERMISSION_STRICT_DEFAULT
        return not use_strict  # strict=True -> deny; strict=False -> allow
    return user.roles.filter(permissions=perm).exists()


def check_action_permission(user, resource, action, strict=None):
    """
    Dùng trong view: if not check_action_permission(request.user, 'Product', 'EXPORT'): return Response(403).
    strict=True: mode strict (không cấu hình permission = từ chối).
    """
    return _user_has_perm(user, resource, action, strict=strict)
