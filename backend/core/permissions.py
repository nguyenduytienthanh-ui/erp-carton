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

SUPPLIER_PERMISSION_DEFINITIONS = (
    {
        'field': 'supplier_view',
        'label': 'Nhà cung cấp - xem',
        'resource': 'SUPPLIER',
        'action': 'VIEW',
        'changed_type': 'supplier_view',
        'code': 'SUPPLIER_VIEW',
        'name': 'View suppliers',
    },
    {
        'field': 'supplier_create',
        'label': 'Nhà cung cấp - thêm mới',
        'resource': 'SUPPLIER',
        'action': 'CREATE',
        'changed_type': 'supplier_create',
        'code': 'SUPPLIER_CREATE',
        'name': 'Create suppliers',
    },
    {
        'field': 'supplier_edit',
        'label': 'Nhà cung cấp - sửa/trạng thái',
        'resource': 'SUPPLIER',
        'action': 'EDIT',
        'changed_type': 'supplier_edit',
        'code': 'SUPPLIER_EDIT',
        'name': 'Edit suppliers',
    },
    {
        'field': 'supplier_import',
        'label': 'Nhà cung cấp - nhập Excel',
        'resource': 'SUPPLIER',
        'action': 'IMPORT',
        'changed_type': 'supplier_import',
        'code': 'SUPPLIER_IMPORT',
        'name': 'Import suppliers',
    },
    {
        'field': 'supplier_export',
        'label': 'Nhà cung cấp - xuất dữ liệu',
        'resource': 'SUPPLIER',
        'action': 'EXPORT',
        'changed_type': 'supplier_export',
        'code': 'SUPPLIER_EXPORT',
        'name': 'Export suppliers',
    },
    {
        'field': 'supplier_delete',
        'label': 'Nhà cung cấp - xóa cứng',
        'resource': 'SUPPLIER',
        'action': 'DELETE',
        'changed_type': 'supplier_delete',
        'code': 'SUPPLIER_DELETE',
        'name': 'Hard delete suppliers',
    },
)

PURCHASING_PERMISSION_DEFINITIONS = (
    {
        'field': 'purchasing_view',
        'label': 'Mua hĂ ng - xem',
        'resource': 'PURCHASING',
        'action': 'VIEW',
        'changed_type': 'purchasing_view',
        'code': 'PURCHASING_VIEW',
        'name': 'View purchasing module',
    },
)

PURCHASING_VIEW_IMPLIED_PERMISSIONS = (
    ('PURCHASING', 'VIEW'),
    ('PURCHASING', 'MANAGE'),
    ('PURCHASEORDER', 'SUBMIT'),
    ('PURCHASEORDER', 'APPROVE'),
    ('PURCHASEORDER', 'REJECT'),
    ('PURCHASEORDER', 'RECEIVE'),
    ('PURCHASEORDER', 'CANCEL'),
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


def user_has_supplier_permission(user, action, *, strict=True):
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    return check_action_permission(user, 'SUPPLIER', action, strict=strict)


def user_has_purchasing_permission(user, action, *, strict=True):
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return True
    normalized_action = str(action or '').strip().upper()
    if normalized_action == 'VIEW':
        return any(
            check_action_permission(user, resource, permission_action, strict=True)
            for resource, permission_action in PURCHASING_VIEW_IMPLIED_PERMISSIONS
        )
    return check_action_permission(user, 'PURCHASING', normalized_action, strict=strict)
