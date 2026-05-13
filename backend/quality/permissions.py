from core.permissions import check_action_permission


def can_view_quality(user):
    return check_action_permission(user, 'QUALITY', 'VIEW', strict=True)


def can_create_quality(user):
    return check_action_permission(user, 'QUALITY', 'CREATE', strict=True)


def can_submit_quality(user):
    return check_action_permission(user, 'QUALITY', 'SUBMIT', strict=True)


def can_review_quality(user):
    return check_action_permission(user, 'QUALITY', 'REVIEW', strict=True)


def can_override_quality(user):
    return check_action_permission(user, 'QUALITY', 'OVERRIDE', strict=True)


def can_manage_quality_catalog(user):
    return check_action_permission(user, 'QUALITY', 'MANAGE_CATALOG', strict=True)


def can_manage_quality_storage(user):
    return check_action_permission(user, 'QUALITY', 'MANAGE_STORAGE', strict=True)
