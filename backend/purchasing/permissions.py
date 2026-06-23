from core.permissions import check_action_permission, user_has_supplier_permission


def can_view_supplier(user):
    return user_has_supplier_permission(user, 'VIEW', strict=True)


def can_create_supplier(user):
    return user_has_supplier_permission(user, 'CREATE', strict=True)


def can_edit_supplier(user):
    return user_has_supplier_permission(user, 'EDIT', strict=True)


def can_import_supplier(user):
    return user_has_supplier_permission(user, 'IMPORT', strict=True)


def can_export_supplier(user):
    return user_has_supplier_permission(user, 'EXPORT', strict=True)


def can_delete_supplier(user):
    return user_has_supplier_permission(user, 'DELETE', strict=True)


def can_manage_supplier(user):
    return can_create_supplier(user) or can_edit_supplier(user)


def can_edit_purchase_order(user, order):
    return order.status in {'DRAFT', 'REJECTED'} and check_action_permission(user, 'PURCHASING', 'MANAGE', strict=True)


def can_submit_purchase_order(user, order):
    return order.status in {'DRAFT', 'REJECTED'} and check_action_permission(user, 'PURCHASEORDER', 'SUBMIT', strict=True)


def can_approve_purchase_order(user, order):
    return order.status == 'SUBMITTED' and check_action_permission(user, 'PURCHASEORDER', 'APPROVE', strict=True)


def can_reject_purchase_order(user, order):
    return order.status == 'SUBMITTED' and check_action_permission(user, 'PURCHASEORDER', 'REJECT', strict=True)


def can_receive_purchase_order(user, order):
    return order.status in {'APPROVED', 'PARTIAL_RECEIVED'} and check_action_permission(user, 'PURCHASEORDER', 'RECEIVE', strict=True)


def can_cancel_purchase_order(user, order):
    return order.status in {'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'} and check_action_permission(user, 'PURCHASEORDER', 'CANCEL', strict=True)


def can_cancel_purchase_receipt(user, receipt):
    return receipt.status == 'POSTED' and check_action_permission(user, 'PURCHASEORDER', 'CANCEL', strict=True)
