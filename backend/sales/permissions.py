"""
Sales permission helpers.

All business gates use explicit resource/action permissions plus staff/superuser.
Role-name fallbacks are intentionally not used here.
"""
from core.permissions import check_action_permission


SALES_ORDER_ACTIONS = ('VIEW', 'SUBMIT', 'APPROVE', 'REJECT', 'POST', 'VOID')
INVENTORY_SCAN_ACTIONS = ('VIEW', 'MANAGE', 'RESERVE', 'TRANSFER', 'ADJUST', 'STOCKTAKE')


def _is_staff_or_superuser(user):
    return bool(user and (getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False)))


def _has_action(user, resource, action):
    if not user or not user.is_authenticated:
        return False
    if _is_staff_or_superuser(user):
        return True
    return check_action_permission(user, resource, action, strict=True)


def can_access_sales_orders(user):
    if not user or not user.is_authenticated:
        return False
    if _is_staff_or_superuser(user):
        return True
    return any(check_action_permission(user, 'SALESORDER', action, strict=True) for action in SALES_ORDER_ACTIONS)


def can_manage_sales_order_draft(user):
    return _has_action(user, 'SALESORDER', 'SUBMIT')


def can_edit_sales_order(user, order):
    return order.status == 'DRAFT' and can_manage_sales_order_draft(user)


def can_submit_sales_order(user, order):
    return order.status == 'DRAFT' and _has_action(user, 'SALESORDER', 'SUBMIT')


def can_approve_sales_order(user, order):
    return order.status == 'SUBMITTED' and _has_action(user, 'SALESORDER', 'APPROVE')


def can_reject_sales_order(user, order):
    return order.status == 'SUBMITTED' and _has_action(user, 'SALESORDER', 'REJECT')


def can_post_sales_order(user, order):
    return order.status == 'APPROVED' and _has_action(user, 'SALESORDER', 'POST')


def can_void_sales_order(user, order):
    return order.status in ('APPROVED', 'POSTED') and _has_action(user, 'SALESORDER', 'VOID')


def can_manage_quote(user):
    return can_manage_sales_order_draft(user)


def can_convert_quote(user):
    return can_manage_quote(user)


def can_use_sales_scan_center(user):
    if not user or not user.is_authenticated:
        return False
    if _is_staff_or_superuser(user):
        return True
    return any(check_action_permission(user, 'INVENTORY', action, strict=True) for action in INVENTORY_SCAN_ACTIONS)


def can_manage_inventory_execution(user):
    return _has_action(user, 'INVENTORY', 'MANAGE')


def can_manage_legacy_shipment(user, action):
    action_key = str(action or '').upper()
    if action_key in {'CREATE', 'UPDATE', 'PARTIAL_UPDATE', 'SUBMIT_SHIPMENT', 'SUBMIT'}:
        return _has_action(user, 'SALESORDER', 'SUBMIT')
    if action_key in {'APPROVE_SHIPMENT', 'APPROVE'}:
        return _has_action(user, 'SALESORDER', 'APPROVE')
    if action_key in {'PACK_SHIPMENT', 'SEND_SHIPMENT', 'CONFIRM_DELIVERY', 'PACK', 'SEND', 'DELIVER'}:
        return can_manage_inventory_execution(user)
    if action_key in {'DESTROY', 'CANCEL_SHIPMENT', 'CANCEL', 'VOID'}:
        return _has_action(user, 'SALESORDER', 'VOID') or can_manage_inventory_execution(user)
    return False


def can_manage_delivery_carrier(user):
    return _has_action(user, 'DELIVERYCARRIER', 'EDIT')
