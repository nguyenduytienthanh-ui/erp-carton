from __future__ import annotations

import json
from decimal import Decimal
from io import StringIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from core.models import AuditLog
from inventory.models import Warehouse, WarehouseLocation
from products.models import Product, ProductUnit
from production.models import (
    ProductionHandoverStatus,
    ProductionMachine,
    ProductionMaterialRequirement,
    ProductionOperation,
    ProductionOperationBlockReason,
    ProductionOperationStatus,
    ProductionOrder,
    ProductionOrderStatus,
    ProductionShift,
    ProductionWorkCenter,
)
from production.services import (
    advance_ready_operations,
    build_operation_execution_handoff,
    skip_production_operation,
    sync_order_status_and_demand_counters,
    update_operation_status,
    validate_operation_status_transition,
)


DEFAULT_PREFIX = 'QA_SHF1_'
SAFE_DEV_DB = 'erp_dev_clean'
SCENARIOS = (
    'MACHINE_DOWN',
    'WAIT_MATERIAL',
    'CLEAR_TO_RUN',
    'HANDOVER_READY',
    'HANDOVER_ACCEPTED',
    'SKIP',
    'DONE_UPDATE',
)
PLANNED_DATA_COUNTS = {
    'users': 1,
    'product_units': 1,
    'products': 2,
    'work_centers': 1,
    'machines': 1,
    'warehouses': 1,
    'warehouse_locations': 1,
    'production_orders': 1,
    'production_operations': 7,
    'production_material_requirements': 1,
}


def _database_name() -> str:
    return str(connection.settings_dict.get('NAME') or '')


def _is_safe_write_database(name: str) -> bool:
    normalized = str(name or '').strip().lower()
    return normalized == SAFE_DEV_DB or normalized.startswith('test_')


def _validate_prefix(prefix: str) -> str:
    value = str(prefix or '').strip().upper()
    if value != DEFAULT_PREFIX:
        raise CommandError('Prefix must be exactly QA_SHF1_ for this shop-floor handoff drill milestone.')
    return value


def _code(prefix: str, suffix: str, max_length: int = 50) -> str:
    value = f'{prefix}{suffix}'.upper()
    if len(value) > max_length:
        raise CommandError(f'Generated prefixed code exceeds max length {max_length}: {value}')
    return value


def _verify_backup_path(backup_path: str | None) -> dict:
    if not backup_path:
        return {
            'path': '',
            'required_for_write': True,
            'verified': False,
            'status': 'missing',
            'checks': {
                'bundle_exists': False,
                'database_sql_exists': False,
                'database_sql_size': 0,
                'manifest_status': '',
                'restore_dry_run_status': '',
            },
            'errors': ['backup_path is required for --confirm-write'],
        }
    bundle = Path(backup_path)
    database_sql = bundle / 'database.sql'
    manifest_path = bundle / 'backup_manifest.json'
    restore_path = bundle / 'restore_dry_run.json'
    errors = []
    manifest_status = ''
    restore_status = ''
    database_size = database_sql.stat().st_size if database_sql.exists() else 0

    if not bundle.exists() or not bundle.is_dir():
        errors.append('backup bundle does not exist')
    if not database_sql.exists() or database_size <= 0:
        errors.append('database.sql missing or empty')
    if not manifest_path.exists():
        errors.append('backup_manifest.json missing')
    else:
        try:
            manifest_status = str(json.loads(manifest_path.read_text(encoding='utf-8')).get('status') or '')
        except json.JSONDecodeError:
            manifest_status = 'invalid_json'
        if manifest_status.lower() != 'ok':
            errors.append('backup_manifest.json status is not ok')
    if restore_path.exists():
        try:
            restore_status = str(json.loads(restore_path.read_text(encoding='utf-8')).get('status') or '')
        except json.JSONDecodeError:
            restore_status = 'invalid_json'
        if restore_status.lower() != 'ok':
            errors.append('restore_dry_run.json status is not ok')
    else:
        restore_status = 'not_present'

    return {
        'path': str(bundle),
        'required_for_write': True,
        'verified': not errors,
        'status': 'ok' if not errors else 'warning',
        'checks': {
            'bundle_exists': bundle.exists() and bundle.is_dir(),
            'database_sql_exists': database_sql.exists(),
            'database_sql_size': database_size,
            'manifest_status': manifest_status,
            'restore_dry_run_status': restore_status,
        },
        'errors': errors,
    }


def _has_pending_migrations() -> bool:
    executor = MigrationExecutor(connection)
    return bool(executor.migration_plan(executor.loader.graph.leaf_nodes()))


def _check_release_readiness() -> dict:
    stdout = StringIO()
    call_command('release_readiness', stdout=stdout)
    output = stdout.getvalue()
    first_line = output.splitlines()[0] if output.splitlines() else ''
    return {
        'status': 'ok' if first_line.strip() == 'Release readiness: OK' else 'warning',
        'summary': first_line.strip(),
    }


def _prefixed_counts(prefix: str) -> dict:
    order_ids = list(ProductionOrder.objects.filter(code__startswith=prefix).values_list('id', flat=True))
    return {
        'users': get_user_model().objects.filter(username__startswith=prefix).count(),
        'product_units': ProductUnit.objects.filter(code__startswith=prefix).count(),
        'products': Product.objects.filter(code__startswith=prefix).count(),
        'work_centers': ProductionWorkCenter.objects.filter(code__startswith=prefix).count(),
        'machines': ProductionMachine.objects.filter(code__startswith=prefix).count(),
        'warehouses': Warehouse.objects.filter(code__startswith=prefix).count(),
        'warehouse_locations': WarehouseLocation.objects.filter(code__startswith=prefix).count(),
        'production_orders': len(order_ids),
        'production_operations': ProductionOperation.objects.filter(production_order_id__in=order_ids).count(),
        'production_material_requirements': ProductionMaterialRequirement.objects.filter(production_order_id__in=order_ids).count(),
        'audit_logs': AuditLog.objects.filter(entity_code__startswith=prefix).count(),
    }


def _total_prefixed_count(counts: dict) -> int:
    return sum(int(value or 0) for value in counts.values())


def _build_scenario_rows(status: str, *, results: dict | None = None, writes_database: bool = False) -> list[dict]:
    results = results or {}
    rows = []
    for scenario in SCENARIOS:
        result = results.get(scenario, {})
        row = {
            'key': scenario,
            'status': result.get('status', status),
            'writes_database': bool(result.get('writes_database', writes_database)),
            'audit_action': result.get('audit_action', ''),
            'actor': result.get('actor', ''),
            'time': result.get('time'),
            'note': result.get('note', ''),
            'last_action': result.get('last_action', ''),
            'last_actor': result.get('last_actor', ''),
            'last_at': result.get('last_at'),
            'last_note': result.get('last_note', ''),
            'execution_handoff': result.get('execution_handoff'),
            'advisory_only': result.get('advisory_only'),
            'workflow_blocking': result.get('workflow_blocking'),
            'checks': result.get('checks', {}),
        }
        rows.append(row)
    return rows


def _latest_prefixed_audit(operation: ProductionOperation, prefix: str) -> AuditLog | None:
    return (
        AuditLog.objects
        .filter(
            entity_type='ProductionOperation',
            entity_id=int(operation.id),
            entity_code__startswith=prefix,
        )
        .select_related('user')
        .order_by('-created_at', '-id')
        .first()
    )


def _expected_existing_checks(scenario: str, operation: ProductionOperation, audit: AuditLog | None, handoff: dict, prefix: str) -> dict:
    checks = {
        'operation_present': True,
        'audit_present': audit is not None,
        'actor_present': bool(audit and audit.user and str(getattr(audit.user, 'username', '') or '').startswith(prefix)),
        'time_present': bool(audit and audit.created_at),
        'note_present': bool(handoff.get('last_note')),
        'last_action_present': bool(handoff.get('last_action')),
        'execution_handoff_present': bool(handoff),
        'advisory_only': handoff.get('advisory_only') is True,
        'workflow_blocking_false': handoff.get('workflow_blocking') is False,
    }
    if scenario == 'MACHINE_DOWN':
        checks.update({
            'block_reason_code': operation.block_reason_code == ProductionOperationBlockReason.MACHINE_DOWN,
            'audit_action': bool(audit and audit.action == 'SIGNAL'),
            'last_action': handoff.get('last_action') == 'SIGNAL',
        })
    elif scenario == 'WAIT_MATERIAL':
        checks.update({
            'block_reason_code': operation.block_reason_code == ProductionOperationBlockReason.WAIT_MATERIAL,
            'audit_action': bool(audit and audit.action == 'SIGNAL'),
            'last_action': handoff.get('last_action') == 'SIGNAL',
        })
    elif scenario == 'CLEAR_TO_RUN':
        checks.update({
            'block_reason_cleared': not operation.block_reason_code,
            'audit_action': bool(audit and audit.action == 'SIGNAL'),
            'last_action': handoff.get('last_action') == 'SIGNAL',
        })
    elif scenario == 'HANDOVER_READY':
        checks.update({
            'handover_status': operation.handover_status == ProductionHandoverStatus.READY,
            'audit_action': bool(audit and audit.action == 'HANDOVER'),
            'last_action': handoff.get('last_action') == 'HANDOVER',
        })
    elif scenario == 'HANDOVER_ACCEPTED':
        checks.update({
            'handover_status': operation.handover_status == ProductionHandoverStatus.ACCEPTED,
            'audit_action': bool(audit and audit.action == 'HANDOVER'),
            'last_action': handoff.get('last_action') == 'HANDOVER',
        })
    elif scenario == 'SKIP':
        checks.update({
            'operation_status': operation.status == ProductionOperationStatus.SKIPPED,
            'skip_reason_present': bool(operation.skip_reason),
            'audit_action': bool(audit and audit.action == 'SKIP_OPERATION'),
            'last_action': handoff.get('last_action') == 'SKIP_OPERATION',
        })
    elif scenario == 'DONE_UPDATE':
        checks.update({
            'operation_status': operation.status == ProductionOperationStatus.DONE,
            'completed_qty_present': Decimal(str(operation.completed_qty or 0)) > 0,
            'audit_action': bool(audit and audit.action == 'UPDATE'),
            'last_action': handoff.get('last_action') == 'UPDATE',
        })
    return checks


def _existing_scenario_results(prefix: str, counts: dict) -> dict:
    if _total_prefixed_count(counts) == 0:
        return {}
    results = {}
    operations = {
        operation.source_operation_code: operation
        for operation in ProductionOperation.objects
        .filter(
            production_order__code__startswith=prefix,
            source_operation_code__in=SCENARIOS,
        )
        .select_related('production_order')
        .order_by('sequence')
    }
    for scenario in SCENARIOS:
        operation = operations.get(scenario)
        if not operation:
            results[scenario] = {
                'status': 'fail',
                'writes_database': False,
                'checks': {'operation_present': False},
            }
            continue
        audit = _latest_prefixed_audit(operation, prefix)
        handoff = build_operation_execution_handoff(operation, latest_audit=audit)
        checks = _expected_existing_checks(scenario, operation, audit, handoff, prefix)
        note = handoff.get('last_note') or ''
        results[scenario] = {
            'status': 'pass' if all(checks.values()) else 'fail',
            'writes_database': False,
            'operation_id': int(operation.id),
            'operation_code': operation.step_code,
            'audit_action': audit.action if audit else '',
            'actor': getattr(audit.user, 'username', '') if audit and audit.user else '',
            'time': audit.created_at if audit else None,
            'note': note,
            'last_action': handoff.get('last_action', ''),
            'last_actor': handoff.get('last_actor', ''),
            'last_at': handoff.get('last_at'),
            'last_note': note,
            'execution_handoff': handoff,
            'advisory_only': handoff.get('advisory_only'),
            'workflow_blocking': handoff.get('workflow_blocking'),
            'checks': checks,
        }
    return results


def _create_audit(user, action: str, operation: ProductionOperation, *, old_values: dict, new_values: dict) -> AuditLog:
    order = operation.production_order
    return AuditLog.objects.create(
        user=user,
        action=action,
        entity_type='ProductionOperation',
        entity_id=int(operation.id),
        entity_code=f'{order.code}-OP{operation.sequence}',
        old_values=old_values,
        new_values=new_values,
        changed_fields=sorted(set(new_values.keys()) | set(old_values.keys())),
        ip_address=None,
        user_agent='erp_main_shop_floor_handoff_real_dev_drill',
    )


def _scenario_result(operation: ProductionOperation, audit: AuditLog, *, note: str) -> dict:
    operation.refresh_from_db()
    handoff = build_operation_execution_handoff(operation, latest_audit=audit)
    return {
        'status': 'pass',
        'operation_id': int(operation.id),
        'operation_code': operation.step_code,
        'audit_action': audit.action,
        'actor': getattr(audit.user, 'username', '') if audit.user else '',
        'time': audit.created_at,
        'note': note,
        'last_action': handoff['last_action'],
        'last_actor': handoff['last_actor'],
        'last_at': handoff['last_at'],
        'last_note': handoff['last_note'],
        'execution_handoff': handoff,
        'advisory_only': handoff['advisory_only'],
        'workflow_blocking': handoff['workflow_blocking'],
    }


def _create_drill_data(prefix: str, user) -> dict:
    today = timezone.localdate()
    unit = ProductUnit.objects.create(code=_code(prefix, 'U', 10), name=f'{prefix}Unit', is_active=True, sort_order=900)
    product = Product.objects.create(
        code=_code(prefix, 'FG', 50),
        name=f'{prefix}Finished product',
        unit=unit,
        status='ACTIVE',
        is_active=True,
        product_kind=Product.ProductKind.SPECIFIC,
        sale_price=Decimal('10000'),
        cost_price=Decimal('7000'),
        size_order='300x200x150',
        size_production='305x205x155',
        process_in=18000,
        process_be=9000,
        color_count=2,
        print_color_1='Black',
        print_color_2='Blue',
        created_by=user,
        updated_by=user,
    )
    material = Product.objects.create(
        code=_code(prefix, 'MAT', 50),
        name=f'{prefix}Material',
        unit=unit,
        status='ACTIVE',
        is_active=True,
        product_kind=Product.ProductKind.SPECIFIC,
        sale_price=Decimal('1000'),
        cost_price=Decimal('800'),
        created_by=user,
        updated_by=user,
    )
    work_center = ProductionWorkCenter.objects.create(
        code=_code(prefix, 'WC', 40),
        name=f'{prefix}Work center',
        default_capacity_hours=Decimal('8'),
        is_active=True,
        sort_order=900,
    )
    machine = ProductionMachine.objects.create(
        code=_code(prefix, 'MC', 40),
        name=f'{prefix}Machine',
        work_center=work_center,
        default_capacity_hours=Decimal('8'),
        is_active=True,
        sort_order=900,
    )
    warehouse = Warehouse.objects.create(code=_code(prefix, 'WH', 20), name=f'{prefix}Warehouse', is_active=True)
    location = WarehouseLocation.objects.create(warehouse=warehouse, code=_code(prefix, 'L1', 30), name=f'{prefix}Location', is_active=True)
    order = ProductionOrder.objects.create(
        code=_code(prefix, 'MO001', 50),
        doc_type='MO',
        order_date=today,
        planned_start_date=today,
        planned_end_date=today,
        status=ProductionOrderStatus.RELEASED,
        reference=_code(prefix, 'REF', 50),
        product=product,
        product_snapshot={'code': product.code, 'name': product.name, 'unit_name': unit.name},
        planned_qty=Decimal('10'),
        target_warehouse=warehouse,
        target_location=location,
        notes=f'{prefix}shop-floor handoff real-dev drill',
        created_by=user,
        updated_by=user,
    )
    operations = {}
    for index, scenario in enumerate(SCENARIOS, start=1):
        operation = ProductionOperation.objects.create(
            production_order=order,
            sequence=index * 10,
            step_code=_code(prefix, f'OP{index}', 30),
            step_name=f'{prefix}{scenario}',
            source_field='shop_floor_drill',
            route_step_no=1,
            display_step=1,
            display_order=index * 10,
            step_type='REQUIRED',
            group_code='SHOP_FLOOR_DRILL',
            is_required=True,
            allow_parallel=True,
            source_operation_code=scenario,
            rate_per_hour=Decimal('1000'),
            planned_qty=Decimal('10'),
            status=ProductionOperationStatus.READY,
            block_reason_code=ProductionOperationBlockReason.WAIT_MATERIAL if scenario == 'CLEAR_TO_RUN' else '',
            block_reason_note=f'{prefix}initial wait before clear' if scenario == 'CLEAR_TO_RUN' else '',
            planned_date=today,
            planned_shift=ProductionShift.MORNING,
            dispatch_owner=f'{prefix}operator',
            dispatch_sequence=index * 10,
            estimated_runtime_hours=Decimal('1.00'),
            machine_code=machine.code,
            machine_name=machine.name,
            work_center_code=work_center.code,
            work_center_name=work_center.name,
            note=f'{prefix}{scenario} operation',
        )
        operations[scenario] = operation
    ProductionMaterialRequirement.objects.create(
        production_order=order,
        line_number=1,
        material_product=material,
        internal_product_code=material.code,
        product_snapshot={'code': material.code, 'name': material.name},
        required_qty=Decimal('5'),
        issued_qty=Decimal('0'),
        source_warehouse=warehouse,
        source_location=location,
        note=f'{prefix}material wait reference',
    )
    return {
        'user': user,
        'unit': unit,
        'product': product,
        'material': material,
        'work_center': work_center,
        'machine': machine,
        'warehouse': warehouse,
        'location': location,
        'order': order,
        'operations': operations,
    }


def _run_signal(operation: ProductionOperation, user, *, signal_code: str, note: str) -> dict:
    operation.refresh_from_db()
    old_values = {
        'status': operation.status,
        'block_reason_code': operation.block_reason_code or '',
        'block_reason_note': operation.block_reason_note or '',
        'dispatch_owner': operation.dispatch_owner or '',
        'handover_status': operation.handover_status or '',
        'handover_note': operation.handover_note or '',
    }
    resolved_signal = '' if signal_code in {'CLEAR_TO_RUN', 'READY', 'CLEAR'} else signal_code
    if signal_code in {'CLEAR_TO_RUN', 'READY'}:
        validate_operation_status_transition(operation, ProductionOperationStatus.READY, operations=list(operation.production_order.operations.all().order_by('sequence')))
        update_operation_status(operation, status=ProductionOperationStatus.READY, completed_qty=None, scrap_qty=None, note=operation.note or '')
    operation.block_reason_code = resolved_signal
    operation.block_reason_note = note if resolved_signal else ''
    operation.dispatch_owner = f'{DEFAULT_PREFIX}operator'
    operation.handover_status = operation.handover_status or ProductionHandoverStatus.ACTIVE
    operation.handover_note = note
    operation.handover_at = timezone.now()
    operation.save(update_fields=[
        'block_reason_code',
        'block_reason_note',
        'dispatch_owner',
        'handover_status',
        'handover_note',
        'handover_at',
        'updated_at',
    ])
    sync_order_status_and_demand_counters(operation.production_order, actor=user)
    operation.refresh_from_db()
    audit = _create_audit(
        user,
        'SIGNAL',
        operation,
        old_values=old_values,
        new_values={
            'status': operation.status,
            'block_reason_code': operation.block_reason_code or '',
            'block_reason_note': operation.block_reason_note or '',
            'dispatch_owner': operation.dispatch_owner or '',
            'handover_status': operation.handover_status or '',
            'handover_note': operation.handover_note or '',
            'signal_code': signal_code,
        },
    )
    return _scenario_result(operation, audit, note=note or signal_code)


def _run_handover(operation: ProductionOperation, user, *, handover_status: str, note: str) -> dict:
    operation.refresh_from_db()
    old_values = {
        'status': operation.status,
        'block_reason_code': operation.block_reason_code or '',
        'handover_status': operation.handover_status or '',
        'handover_receiver': operation.handover_receiver or '',
        'handover_note': operation.handover_note or '',
    }
    operation.handover_status = handover_status
    operation.handover_receiver = f'{DEFAULT_PREFIX}receiver'
    operation.handover_note = note
    operation.handover_at = timezone.now()
    operation.save(update_fields=['handover_status', 'handover_receiver', 'handover_note', 'handover_at', 'updated_at'])
    sync_order_status_and_demand_counters(operation.production_order, actor=user)
    operation.refresh_from_db()
    audit = _create_audit(
        user,
        'HANDOVER',
        operation,
        old_values=old_values,
        new_values={
            'status': operation.status,
            'handover_status': operation.handover_status or '',
            'handover_receiver': operation.handover_receiver or '',
            'handover_note': operation.handover_note or '',
        },
    )
    return _scenario_result(operation, audit, note=note)


def _run_skip(operation: ProductionOperation, user, *, reason: str) -> dict:
    result = skip_production_operation(operation, user, reason)
    skipped_operation = result['operation']
    return _scenario_result(skipped_operation, result['audit'], note=reason)


def _run_done_update(operation: ProductionOperation, user, *, note: str) -> dict:
    operation.refresh_from_db()
    old_values = {
        'status': operation.status,
        'completed_qty': str(operation.completed_qty),
        'note': operation.note or '',
    }
    validate_operation_status_transition(operation, ProductionOperationStatus.DONE, operations=list(operation.production_order.operations.all().order_by('sequence')))
    update_operation_status(operation, status=ProductionOperationStatus.DONE, completed_qty=Decimal('3'), scrap_qty=Decimal('0'), note=note)
    advance_ready_operations(operation.production_order)
    sync_order_status_and_demand_counters(operation.production_order, actor=user)
    operation.refresh_from_db()
    audit = _create_audit(
        user,
        'UPDATE',
        operation,
        old_values=old_values,
        new_values={
            'status': operation.status,
            'completed_qty': str(operation.completed_qty),
            'note': operation.note or '',
        },
    )
    return _scenario_result(operation, audit, note=note)


def _run_workflow(data: dict, prefix: str) -> dict:
    user = data['user']
    operations = data['operations']
    return {
        'MACHINE_DOWN': _run_signal(operations['MACHINE_DOWN'], user, signal_code=ProductionOperationBlockReason.MACHINE_DOWN, note=f'{prefix}machine stopped during drill'),
        'WAIT_MATERIAL': _run_signal(operations['WAIT_MATERIAL'], user, signal_code=ProductionOperationBlockReason.WAIT_MATERIAL, note=f'{prefix}waiting material during drill'),
        'CLEAR_TO_RUN': _run_signal(operations['CLEAR_TO_RUN'], user, signal_code='CLEAR_TO_RUN', note=f'{prefix}clear to run during drill'),
        'HANDOVER_READY': _run_handover(operations['HANDOVER_READY'], user, handover_status=ProductionHandoverStatus.READY, note=f'{prefix}ready for receiver'),
        'HANDOVER_ACCEPTED': _run_handover(operations['HANDOVER_ACCEPTED'], user, handover_status=ProductionHandoverStatus.ACCEPTED, note=f'{prefix}receiver accepted handover'),
        'SKIP': _run_skip(operations['SKIP'], user, reason=f'{prefix}skip with controlled drill reason'),
        'DONE_UPDATE': _run_done_update(operations['DONE_UPDATE'], user, note=f'{prefix}done update with completed qty'),
    }


def _create_and_run_drill(prefix: str) -> dict:
    User = get_user_model()
    with transaction.atomic():
        user = User.objects.create(username=f'{prefix}operator', is_staff=True, is_active=True)
        user.set_unusable_password()
        user.save(update_fields=['password'])
        data = _create_drill_data(prefix, user)
        scenario_results = _run_workflow(data, prefix)
    counts = _prefixed_counts(prefix)
    return {
        'created_counts': counts,
        'scenario_results': scenario_results,
        'order_code': data['order'].code,
        'product_code': data['product'].code,
    }


def _assert_confirm_write_gates(prefix: str, backup: dict) -> dict:
    database_name = _database_name()
    if not _is_safe_write_database(database_name):
        raise CommandError(f'DB gate failed: {database_name} is not allowed for this dev drill.')
    if _has_pending_migrations():
        raise CommandError('Migration gate failed: pending migrations exist.')
    release = _check_release_readiness()
    if release['status'] != 'ok':
        raise CommandError(f"Release readiness gate failed: {release['summary']}")
    if not backup['verified']:
        raise CommandError('Backup gate failed: verified backup path is required for --confirm-write.')
    existing_counts = _prefixed_counts(prefix)
    if _total_prefixed_count(existing_counts) > 0:
        raise CommandError('Prefix gate failed: QA_SHF1_ data already exists; cleanup/reuse requires separate approval.')
    return {
        'database_name': database_name,
        'safe_database': True,
        'pending_migrations': False,
        'release_readiness': release,
        'backup_verified': True,
        'existing_counts': existing_counts,
    }


def build_payload(prefix: str, *, backup_path: str | None, confirm_write: bool) -> dict:
    prefix = _validate_prefix(prefix)
    backup = _verify_backup_path(backup_path)
    mode = 'confirm_write' if confirm_write else 'dry_run'
    existing_counts = _prefixed_counts(prefix)
    payload = {
        'generated_at': timezone.now(),
        'pack': 'Production Execution Shop-Floor Handoff Real-Dev Drill v1',
        'command': 'erp_main_shop_floor_handoff_real_dev_drill',
        'mode': mode,
        'prefix': prefix,
        'overall_status': 'planned',
        'backup': backup,
        'planned_data_counts': PLANNED_DATA_COUNTS,
        'existing_prefixed_counts': existing_counts,
        'scenario_results': _build_scenario_rows('planned'),
        'gates': {
            'database_name': _database_name(),
            'safe_database_required_for_write': SAFE_DEV_DB,
            'test_database_allowed': True,
            'pending_migrations_checked_on_write': True,
            'release_readiness_checked_on_write': True,
            'backup_path_required_on_write': True,
            'reject_existing_prefixed_data_on_write': True,
        },
        'safety': {
            'default_writes_database': False,
            'write_requires_confirm_write': True,
            'writes_database': False,
            'backup_required_for_write': True,
            'restore_runs': False,
            'cleanup_runs': False,
            'migration_runs': False,
            'deploy_runs': False,
            'direct_sql_used': False,
            'credentials_printed': False,
            'outside_prefix_writes_allowed': False,
            'qc_printing_in_scope': False,
        },
        'safety_notes': [
            'Dry-run is the default and does not create/update/delete database rows.',
            'Write mode requires --confirm-write, exact QA_SHF1_ prefix, safe DB, no pending migrations, release_readiness OK, and verified backup path.',
            'The command refuses to write if any QA_SHF1_ scoped data already exists.',
            'No cleanup, restore, migration, deploy, direct SQL, credentials, or QC Printing action is in scope.',
        ],
    }
    if not confirm_write:
        existing_results = _existing_scenario_results(prefix, existing_counts)
        if existing_results:
            payload['scenario_results'] = _build_scenario_rows('fail', results=existing_results)
            payload['overall_status'] = (
                'ok'
                if all(row['status'] == 'pass' for row in payload['scenario_results'])
                else 'warning'
            )
            payload['existing_data_report'] = {
                'status': 'pass' if payload['overall_status'] == 'ok' else 'warning',
                'source': 'existing_prefixed_data',
                'writes_database': False,
            }
            return payload
        payload['overall_status'] = 'ok'
        return payload

    payload['gates']['confirm_write'] = _assert_confirm_write_gates(prefix, backup)
    write_result = _create_and_run_drill(prefix)
    payload['overall_status'] = 'ok'
    payload['write_result'] = write_result
    payload['existing_prefixed_counts'] = _prefixed_counts(prefix)
    payload['scenario_results'] = _build_scenario_rows('pass', results=write_result['scenario_results'], writes_database=True)
    payload['safety']['writes_database'] = True
    return payload


def render_markdown(payload: dict) -> str:
    lines = [
        f"# {payload['pack']}",
        '',
        f"- Mode: {payload['mode']}",
        f"- Prefix: `{payload['prefix']}`",
        f"- Status: {str(payload['overall_status']).upper()}",
        f"- Backup verified: {payload['backup']['verified']}",
        '',
        '## Gates',
        f"- DB name: {payload['gates']['database_name']}",
        f"- Safe dev DB for write: {payload['gates']['safe_database_required_for_write']}",
        f"- Backup path required on write: {payload['gates']['backup_path_required_on_write']}",
        f"- Reject existing prefixed data on write: {payload['gates']['reject_existing_prefixed_data_on_write']}",
        '',
        '## Planned data',
    ]
    lines.extend([f"- {key}: {value}" for key, value in payload['planned_data_counts'].items()])
    lines.extend(['', '## Existing prefixed data'])
    lines.extend([f"- {key}: {value}" for key, value in payload['existing_prefixed_counts'].items()])
    lines.extend(['', '## Scenario report'])
    for row in payload['scenario_results']:
        checks = row.get('checks') or {}
        lines.append(
            f"- {row['key']}: {str(row['status']).upper()}"
            f" | audit={row.get('audit_action') or '-'}"
            f" | last_action={row.get('last_action') or '-'}"
            f" | actor_present={checks.get('actor_present')}"
            f" | time_present={checks.get('time_present')}"
            f" | note_present={checks.get('note_present')}"
            f" | execution_handoff={checks.get('execution_handoff_present')}"
            f" | advisory_only={row.get('advisory_only')}"
            f" | workflow_blocking={row.get('workflow_blocking')}"
        )
    lines.extend(['', '## Safety'])
    lines.extend([f"- {key}: {value}" for key, value in payload['safety'].items()])
    lines.extend(['', '## Safety notes'])
    lines.extend([f"- {item}" for item in payload['safety_notes']])
    return _legacy_console_safe('\n'.join(lines))


def render_json(payload: dict) -> str:
    return _legacy_console_safe(json.dumps(payload, ensure_ascii=True, indent=2, default=str))


def _legacy_console_safe(text: str) -> str:
    return text.encode('ascii', errors='backslashreplace').decode('ascii')


class Command(BaseCommand):
    help = 'Create or report a guarded ERP main shop-floor handoff real-dev drill with exact QA_SHF1_ prefix'

    def add_arguments(self, parser):
        parser.add_argument('--prefix', default=DEFAULT_PREFIX, help='Must be exactly QA_SHF1_')
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')
        parser.add_argument('--backup-path', default='', help='Verified pre-drill backup path required for --confirm-write')
        parser.add_argument('--confirm-write', action='store_true', help='Create controlled prefixed drill data and run the workflow')

    def handle(self, *args, **options):
        payload = build_payload(
            options.get('prefix') or '',
            backup_path=options.get('backup_path') or '',
            confirm_write=bool(options.get('confirm_write')),
        )
        if options['format'] == 'json':
            self.stdout.write(render_json(payload))
        else:
            self.stdout.write(render_markdown(payload))
