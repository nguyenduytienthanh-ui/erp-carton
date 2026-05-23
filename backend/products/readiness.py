from production.models import ProductionMachine, ProductionWorkCenter
from sales.services import build_snapshot_operations_from_product, build_snapshot_routing_steps_from_product


READINESS_READY = 'READY'
READINESS_WARNING = 'WARNING'
READINESS_BLOCKER = 'BLOCKER'

SEVERITY_ORDER = {
    READINESS_READY: 0,
    READINESS_WARNING: 1,
    READINESS_BLOCKER: 2,
}

PRINT_OPERATION_CODES = {'IN'}


def _print_colors(product):
    return [
        str(getattr(product, field_name, '') or '').strip()
        for field_name in product.PRINT_COLOR_FIELDS
        if str(getattr(product, field_name, '') or '').strip()
    ]


def _has_print_process(product, operations, routing_steps):
    operation_codes = {
        str(item.get('operation_code') or '').strip().upper()
        for item in [*(operations or []), *(routing_steps or [])]
        if isinstance(item, dict)
    }
    return bool(operation_codes & PRINT_OPERATION_CODES) or bool(getattr(product, 'process_in', None) or 0)


def _issue(code, severity, category, message, *, details=None):
    return {
        'code': code,
        'severity': severity,
        'category': category,
        'message': message,
        'workflow_blocking': False,
        'details': details or {},
    }


def _status_from_issues(issues):
    status = READINESS_READY
    for item in issues:
        severity = item.get('severity') or READINESS_READY
        if SEVERITY_ORDER.get(severity, 0) > SEVERITY_ORDER.get(status, 0):
            status = severity
    return status


def build_product_routing_readiness(product):
    operations = build_snapshot_operations_from_product(product)
    routing_steps = build_snapshot_routing_steps_from_product(product)
    print_colors = _print_colors(product)
    active_work_center_count = ProductionWorkCenter.objects.filter(is_active=True).count()
    active_machine_count = ProductionMachine.objects.filter(
        is_active=True,
        work_center__is_active=True,
    ).count()
    issues = []

    if not routing_steps:
        issues.append(_issue(
            'ROUTING_MISSING',
            READINESS_BLOCKER,
            'routing',
            'San pham chua co routing/cong doan hieu luc.',
        ))
    if not operations:
        issues.append(_issue(
            'OPERATIONS_MISSING',
            READINESS_BLOCKER,
            'routing',
            'San pham chua co danh sach cong doan hieu luc.',
        ))

    if active_work_center_count <= 0:
        issues.append(_issue(
            'WORK_CENTER_CATALOG_MISSING',
            READINESS_WARNING,
            'resource',
            'Chua co work center dang hoat dong cho lap ke hoach.',
        ))
    if active_machine_count <= 0:
        issues.append(_issue(
            'MACHINE_CATALOG_MISSING',
            READINESS_WARNING,
            'resource',
            'Chua co machine dang hoat dong cho lap ke hoach.',
        ))

    if _has_print_process(product, operations, routing_steps):
        if not str(getattr(product, 'film_code', '') or '').strip():
            issues.append(_issue(
                'PRINT_FILM_CODE_MISSING',
                READINESS_WARNING,
                'print_metadata',
                'San pham co cong doan in nhung chua co ma film.',
            ))
        if not print_colors and int(getattr(product, 'color_count', 0) or 0) <= 0:
            issues.append(_issue(
                'PRINT_COLORS_MISSING',
                READINESS_WARNING,
                'print_metadata',
                'San pham co cong doan in nhung chua co thong tin mau in.',
            ))

    status = _status_from_issues(issues)
    blocker_count = sum(1 for item in issues if item['severity'] == READINESS_BLOCKER)
    warning_count = sum(1 for item in issues if item['severity'] == READINESS_WARNING)
    return {
        'product_id': product.id,
        'product_code': product.code or '',
        'product_name': product.name or '',
        'status': status,
        'is_ready': status == READINESS_READY,
        'workflow_blocking': False,
        'summary': {
            'blocker_count': blocker_count,
            'warning_count': warning_count,
            'issue_count': len(issues),
            'operation_count': len(operations or []),
            'routing_step_count': len(routing_steps or []),
            'active_work_center_count': active_work_center_count,
            'active_machine_count': active_machine_count,
            'print_color_count': len(print_colors),
        },
        'issues': issues,
        'rules': {
            'missing_routing_or_operations': READINESS_BLOCKER,
            'missing_work_center_or_machine': READINESS_WARNING,
            'missing_print_metadata': READINESS_WARNING,
            'workflow_enforced': False,
        },
    }
