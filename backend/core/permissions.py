"""
Permissions theo action (resource + action).
Ví dụ: kho chỉ view, admin mới deactivate/export/import.
Kiểm tra user có role chứa permission (resource, action) tương ứng.
"""
from django.conf import settings
from rest_framework.permissions import BasePermission


# Strict mode: không cấu hình permission = từ chối (default-allow = False)
PERMISSION_STRICT_DEFAULT = getattr(settings, 'PERMISSION_STRICT_DEFAULT', False)

CUSTOMER_PERMISSION_DEFINITIONS = (
    {
        'field': 'customer_view',
        'label': 'Khách hàng - xem',
        'resource': 'CUSTOMER',
        'action': 'VIEW',
        'changed_type': 'customer_view',
        'code': 'CUSTOMER_VIEW',
        'name': 'View customers',
    },
    {
        'field': 'customer_create',
        'label': 'Khách hàng - thêm mới',
        'resource': 'CUSTOMER',
        'action': 'CREATE',
        'changed_type': 'customer_create',
        'code': 'CUSTOMER_CREATE',
        'name': 'Create customers',
    },
    {
        'field': 'customer_edit',
        'label': 'Khách hàng - sửa/trạng thái',
        'resource': 'CUSTOMER',
        'action': 'EDIT',
        'changed_type': 'customer_edit',
        'code': 'CUSTOMER_EDIT',
        'name': 'Edit customers',
    },
    {
        'field': 'customer_submit',
        'label': 'Khách hàng - trình duyệt',
        'resource': 'CUSTOMER',
        'action': 'SUBMIT',
        'changed_type': 'customer_submit',
        'code': 'CUSTOMER_SUBMIT',
        'name': 'Submit customers for approval',
    },
    {
        'field': 'customer_approve',
        'label': 'Khách hàng - duyệt',
        'resource': 'CUSTOMER',
        'action': 'APPROVE',
        'changed_type': 'customer_approve',
        'code': 'CUSTOMER_APPROVE',
        'name': 'Approve customers',
    },
    {
        'field': 'customer_reject',
        'label': 'Khách hàng - từ chối',
        'resource': 'CUSTOMER',
        'action': 'REJECT',
        'changed_type': 'customer_reject',
        'code': 'CUSTOMER_REJECT',
        'name': 'Reject customers',
    },
    {
        'field': 'customer_import',
        'label': 'Khách hàng - nhập Excel',
        'resource': 'CUSTOMER',
        'action': 'IMPORT',
        'changed_type': 'customer_import',
        'code': 'CUSTOMER_IMPORT',
        'name': 'Import customers',
    },
    {
        'field': 'customer_export',
        'label': 'Khách hàng - xuất dữ liệu',
        'resource': 'CUSTOMER',
        'action': 'EXPORT',
        'changed_type': 'customer_export',
        'code': 'CUSTOMER_EXPORT',
        'name': 'Export customers',
    },
    {
        'field': 'customer_assign',
        'label': 'Khách hàng - phân công owner/team',
        'resource': 'CUSTOMER',
        'action': 'ASSIGN',
        'changed_type': 'customer_assign',
        'code': 'CUSTOMER_ASSIGN',
        'name': 'Assign customer owner or team',
    },
    {
        'field': 'customer_delete',
        'label': 'Khách hàng - xóa cứng',
        'resource': 'CUSTOMER',
        'action': 'DELETE',
        'changed_type': 'customer_delete',
        'code': 'CUSTOMER_DELETE',
        'name': 'Hard delete customers',
    },
)


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


def user_has_customer_permission(user, action, *, strict=True):
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    return check_action_permission(user, 'CUSTOMER', action, strict=strict)
