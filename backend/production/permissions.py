from core.permissions import check_action_permission, user_has_production_permission


UNSAFE_PRODUCTION_CANCEL_MESSAGE = (
    'Hủy trực tiếp chứng từ sản xuất đã post đang bị khóa để bảo toàn ledger. '
    'Cần package immutable reversal riêng.'
)


def can_view_production(user):
    return user_has_production_permission(user, 'VIEW', strict=True)


def can_manage_production(user):
    return user_has_production_permission(user, 'MANAGE', strict=True)


def can_plan_production(user):
    return user_has_production_permission(user, 'PLAN', strict=True)


def can_request_production_cancel(user):
    return user_has_production_permission(user, 'CANCEL', strict=True)


def can_edit_production_order(user, order):
    return order.status in {'DRAFT', 'REJECTED'} and can_manage_production(user)


def can_submit_production_order(user, order):
    return order.status in {'DRAFT', 'REJECTED'} and (
        can_manage_production(user) or check_action_permission(user, 'PRODUCTIONORDER', 'SUBMIT', strict=True)
    )


def can_approve_production_order(user, order):
    return order.status == 'SUBMITTED' and (
        can_manage_production(user) or check_action_permission(user, 'PRODUCTIONORDER', 'APPROVE', strict=True)
    )


def can_reject_production_order(user, order):
    return order.status == 'SUBMITTED' and (
        can_manage_production(user) or check_action_permission(user, 'PRODUCTIONORDER', 'REJECT', strict=True)
    )


def can_release_production_order(user, order):
    return order.status == 'APPROVED' and can_plan_production(user)


def can_issue_materials(user, order):
    return order.status in {'RELEASED', 'IN_PROGRESS'} and user_has_production_permission(user, 'ISSUE', strict=True)


def can_receive_output(user, order):
    return order.status in {'RELEASED', 'IN_PROGRESS'} and user_has_production_permission(user, 'RECEIVE', strict=True)


def can_cancel_production_order(user, order):
    return order.status in {'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED'} and user_has_production_permission(user, 'CANCEL', strict=True)


def can_cancel_production_issue(user, issue):
    return False


def can_cancel_production_receipt(user, receipt):
    return False
