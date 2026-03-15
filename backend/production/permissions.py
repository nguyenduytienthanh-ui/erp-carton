from core.permissions import check_action_permission


def can_manage_production(user):
    return check_action_permission(user, 'PRODUCTION', 'MANAGE', strict=True)


def can_edit_production_order(user, order):
    return order.status in {'DRAFT', 'REJECTED'} and can_manage_production(user)


def can_submit_production_order(user, order):
    return order.status in {'DRAFT', 'REJECTED'} and check_action_permission(user, 'PRODUCTIONORDER', 'SUBMIT', strict=True)


def can_approve_production_order(user, order):
    return order.status == 'SUBMITTED' and check_action_permission(user, 'PRODUCTIONORDER', 'APPROVE', strict=True)


def can_reject_production_order(user, order):
    return order.status == 'SUBMITTED' and check_action_permission(user, 'PRODUCTIONORDER', 'REJECT', strict=True)


def can_release_production_order(user, order):
    return order.status == 'APPROVED' and check_action_permission(user, 'PRODUCTIONORDER', 'RELEASE', strict=True)


def can_issue_materials(user, order):
    return order.status in {'RELEASED', 'IN_PROGRESS'} and check_action_permission(user, 'PRODUCTIONORDER', 'ISSUE', strict=True)


def can_receive_output(user, order):
    return order.status in {'RELEASED', 'IN_PROGRESS'} and check_action_permission(user, 'PRODUCTIONORDER', 'RECEIVE', strict=True)


def can_cancel_production_order(user, order):
    return order.status in {'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED'} and check_action_permission(user, 'PRODUCTIONORDER', 'CANCEL', strict=True)


def can_cancel_production_issue(user, issue):
    return issue.status == 'POSTED' and check_action_permission(user, 'PRODUCTIONORDER', 'CANCEL', strict=True)


def can_cancel_production_receipt(user, receipt):
    return receipt.status == 'POSTED' and check_action_permission(user, 'PRODUCTIONORDER', 'CANCEL', strict=True)
