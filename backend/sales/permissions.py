"""
Permission matrix theo action + theo status.
- EDIT: chỉ khi status = DRAFT.
- SUBMIT: DRAFT → SUBMITTED (role có thể bất kỳ).
- APPROVE/REJECT: chỉ role có quyền (vd Manager).
- POST: chỉ role Finance (SalesOrder.POST).
- VOID: có thể APPROVED hoặc POSTED, cần SalesOrder.VOID; void phải có lý do.
"""
from core.permissions import check_action_permission


def can_edit_sales_order(user, order):
    """Chỉ được sửa khi DRAFT."""
    return order.status == 'DRAFT'


def can_submit_sales_order(user, order):
    return order.status == 'DRAFT' and check_action_permission(user, 'SalesOrder', 'SUBMIT')


def can_approve_sales_order(user, order):
    return order.status == 'SUBMITTED' and check_action_permission(user, 'SalesOrder', 'APPROVE')


def can_reject_sales_order(user, order):
    return order.status == 'SUBMITTED' and check_action_permission(user, 'SalesOrder', 'REJECT')


def can_post_sales_order(user, order):
    """POST chỉ role Finance (SalesOrder.POST)."""
    return order.status == 'APPROVED' and check_action_permission(user, 'SalesOrder', 'POST')


def can_void_sales_order(user, order):
    """Void: APPROVED hoặc POSTED; bắt buộc có lý do (check ở view)."""
    return order.status in ('APPROVED', 'POSTED') and check_action_permission(user, 'SalesOrder', 'VOID')
