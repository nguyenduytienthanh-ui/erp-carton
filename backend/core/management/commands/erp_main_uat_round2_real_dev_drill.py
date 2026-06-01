from __future__ import annotations

import json
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from core.management.commands.erp_main_real_dev_uat_drill import (
    PLANNED_DATA_COUNTS,
    _code,
    _create_drill_data,
)
from core.management.commands.erp_main_shop_floor_handoff_real_dev_drill import (
    DEFAULT_PREFIX as SHOP_FLOOR_PREFIX,
    build_payload as build_shop_floor_handoff_payload,
)
from core.management.commands.erp_main_uat_cleanup_plan import build_cleanup_plan
from core.models import Customer
from inventory.models import InventoryTransaction, Stocktake, StocktakeLine, Warehouse, WarehouseLocation
from inventory.serializers import build_inventory_source_audit
from products.models import Operation, Product, ProductOperation, ProductRoutingStep, ProductUnit
from products.readiness import build_product_routing_readiness
from production.models import (
    ProductionDemand,
    ProductionMachine,
    ProductionMaterialRequirement,
    ProductionOperation,
    ProductionOrder,
    ProductionWorkCenter,
)
from production.services import build_ready_to_dispatch_advisory
from sales.models import SalesOrder, SalesOrderDeliveryPlan, SalesOrderLine


DEFAULT_PREFIX = 'QA_UAT2R_'
LEGACY_CLEANUP_PREFIX = 'QA_UAT9H_'
SAFE_DEV_DB = 'erp_dev_clean'
SOURCE_GROUPS = ('PURCHASE', 'PRODUCTION', 'STOCKTAKE', 'TRANSFER', 'MANUAL')
SCENARIOS = (
    'product_readiness',
    'sales_snapshot_delivery_plan',
    'production_handoff',
    'planning_board_advisory',
    'shop_floor_retained_report',
    'inventory_nxt_source_breakdown',
    'ops_readiness',
    'cleanup_status_qa_uat9h',
)


def _database_name() -> str:
    return str(connection.settings_dict.get('NAME') or '')


def _is_safe_write_database(name: str) -> bool:
    normalized = str(name or '').strip().lower()
    return normalized == SAFE_DEV_DB or normalized.startswith('test_')


def _validate_prefix(prefix: str) -> str:
    value = str(prefix or '').strip().upper()
    if value != DEFAULT_PREFIX:
        raise CommandError('Prefix must be exactly QA_UAT2R_ for ERP main UAT Round 2.')
    return value


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        return {'status': 'invalid_json'}


def _verify_backup_path(backup_path: str | None) -> dict:
    raw_path = str(backup_path or '').strip()
    if not raw_path:
        return {
            'path': '',
            'status': 'pending',
            'verified': False,
            'required_for_write': True,
            'checks': {
                'bundle_exists': False,
                'database_sql_exists': False,
                'database_sql_size': 0,
                'manifest_status': '',
                'restore_dry_run_status': '',
            },
            'errors': ['backup_path is required for --confirm-write'],
        }

    bundle = Path(raw_path)
    database_sql = bundle / 'database.sql'
    manifest_path = bundle / 'backup_manifest.json'
    restore_path = bundle / 'restore_dry_run.json'
    database_size = database_sql.stat().st_size if database_sql.exists() else 0
    errors: list[str] = []

    if not bundle.exists() or not bundle.is_dir():
        errors.append('backup bundle does not exist')
    if not database_sql.exists() or database_size <= 0:
        errors.append('database.sql missing or empty')

    manifest_status = ''
    if not manifest_path.exists():
        errors.append('backup_manifest.json missing')
    else:
        manifest_status = str(_read_json(manifest_path).get('status') or '')
        if manifest_status.lower() != 'ok':
            errors.append('backup_manifest.json status is not ok')

    if restore_path.exists():
        restore_status = str(_read_json(restore_path).get('status') or '')
        if restore_status.lower() != 'ok':
            errors.append('restore_dry_run.json status is not ok')
    else:
        restore_status = 'not_present'

    return {
        'path': str(bundle),
        'status': 'ok' if not errors else 'warning',
        'verified': not errors,
        'required_for_write': True,
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
    try:
        call_command('release_readiness', stdout=stdout)
    except Exception as exc:
        return {
            'status': 'error',
            'summary': f'release_readiness failed: {exc.__class__.__name__}',
        }
    output = stdout.getvalue()
    first_line = output.splitlines()[0].strip() if output.splitlines() else ''
    return {
        'status': 'ok' if first_line == 'Release readiness: OK' else 'warning',
        'summary': first_line or 'release_readiness returned no output',
    }


def _prefixed_counts(prefix: str) -> dict:
    order_ids = list(ProductionOrder.objects.filter(code__startswith=prefix).values_list('id', flat=True))
    sales_order_ids = list(SalesOrder.objects.filter(code__startswith=prefix).values_list('id', flat=True))
    stocktake_ids = list(Stocktake.objects.filter(code__startswith=prefix).values_list('id', flat=True))
    product_ids = list(Product.objects.filter(code__startswith=prefix).values_list('id', flat=True))
    return {
        'customers': Customer.objects.filter(code__startswith=prefix).count(),
        'product_units': ProductUnit.objects.filter(code__startswith=prefix).count(),
        'operations': Operation.objects.filter(code__startswith=prefix).count(),
        'work_centers': ProductionWorkCenter.objects.filter(code__startswith=prefix).count(),
        'machines': ProductionMachine.objects.filter(code__startswith=prefix).count(),
        'warehouses': Warehouse.objects.filter(code__startswith=prefix).count(),
        'warehouse_locations': WarehouseLocation.objects.filter(code__startswith=prefix).count(),
        'products': len(product_ids),
        'product_operations': ProductOperation.objects.filter(product_id__in=product_ids).count(),
        'product_routing_steps': ProductRoutingStep.objects.filter(product_id__in=product_ids).count(),
        'sales_orders': len(sales_order_ids),
        'sales_order_lines': SalesOrderLine.objects.filter(sales_order_id__in=sales_order_ids).count(),
        'sales_order_delivery_plans': SalesOrderDeliveryPlan.objects.filter(line__sales_order_id__in=sales_order_ids).count(),
        'production_demands': ProductionDemand.objects.filter(demand_code__startswith=prefix).count(),
        'production_orders': len(order_ids),
        'production_operations': ProductionOperation.objects.filter(production_order_id__in=order_ids).count(),
        'production_material_requirements': ProductionMaterialRequirement.objects.filter(production_order_id__in=order_ids).count(),
        'stocktakes': len(stocktake_ids),
        'stocktake_lines': StocktakeLine.objects.filter(stocktake_id__in=stocktake_ids).count(),
        'inventory_transactions': InventoryTransaction.objects.filter(code__startswith=prefix).count(),
    }


def _total_count(counts: dict) -> int:
    return sum(int(value or 0) for value in counts.values())


def _counts_match_plan(counts: dict) -> bool:
    return all(int(counts.get(key) or 0) == int(value or 0) for key, value in PLANNED_DATA_COUNTS.items())


def _build_existing_data_result(prefix: str, counts: dict) -> dict | None:
    if not _counts_match_plan(counts):
        return None

    product_ready = Product.objects.filter(code=_code(prefix, 'PROD_READY', 50)).first()
    product_warning = Product.objects.filter(code=_code(prefix, 'PROD_WARN', 50)).first()
    product_blocker = Product.objects.filter(code=_code(prefix, 'PROD_BLOCK', 50)).first()
    if not all([product_ready, product_warning, product_blocker]):
        return None

    order = SalesOrder.objects.filter(code=_code(prefix, 'SO001', 50)).first()
    line = SalesOrderLine.objects.filter(sales_order=order, line_number=1).first() if order else None
    delivery_plan = SalesOrderDeliveryPlan.objects.filter(line=line).first() if line else None
    demand = ProductionDemand.objects.filter(demand_code=_code(prefix, 'DEMAND001', 50)).first()
    production_order = ProductionOrder.objects.filter(code=_code(prefix, 'MO001', 50)).first()
    operations = list(ProductionOperation.objects.filter(production_order=production_order).order_by('sequence')) if production_order else []
    transactions = list(InventoryTransaction.objects.filter(code__startswith=prefix).order_by('code'))
    if not all([order, line, delivery_plan, demand, production_order]) or len(operations) != 5 or len(transactions) != 5:
        return None

    product_readiness = {
        'ready': build_product_routing_readiness(product_ready)['status'],
        'warning': build_product_routing_readiness(product_warning)['status'],
        'blocker': build_product_routing_readiness(product_blocker)['status'],
    }
    order_snapshot = dict(production_order.product_snapshot or line.product_snapshot or {})
    planning_readiness = {
        operation.step_code: build_ready_to_dispatch_advisory(
            operation_status=operation.status,
            block_reason_code=operation.block_reason_code,
            dependency_state='WAIT_PREVIOUS_STEP' if operation.sequence == 20 else 'READY',
            material_readiness='WARNING' if operation.sequence == 30 else 'READY',
            product_readiness={'status': product_readiness['ready']},
            capacity_state='AT_LIMIT' if operation.sequence == 30 else 'BALANCED',
            planned_date=operation.planned_date,
            planned_shift=operation.planned_shift,
        )['status']
        for operation in operations
    }
    source_audit = {
        tx.code: build_inventory_source_audit(tx)['type']
        for tx in transactions
    }

    return {
        'source': 'existing_prefixed_data_report',
        'writes_database': False,
        'data_counts': {
            key: {'existing': int(value or 0)}
            for key, value in counts.items()
        },
        'object_codes': {
            'products': [product_ready.code, product_warning.code, product_blocker.code, _code(prefix, 'MAT', 50)],
            'sales_order': order.code,
            'production_demand': demand.demand_code,
            'production_order': production_order.code,
            'inventory_transactions': [tx.code for tx in transactions],
        },
        'scenario_results': {
            'product_readiness': product_readiness,
            'sales_snapshot_v2': {
                'snapshot_present': bool(line.product_snapshot),
                'snapshot_stable_after_qty_price_note_update': bool(line.product_snapshot)
                and (line.product_snapshot.get('code') or line.product_snapshot.get('product_code')) == product_ready.code,
                'delivery_plan_present': delivery_plan is not None,
            },
            'production_handoff': {
                'demand_code': demand.demand_code,
                'production_order_code': production_order.code,
                'snapshot_product_code': order_snapshot.get('code') or order_snapshot.get('product_code'),
            },
            'planning_dispatch': planning_readiness,
            'inventory_ledger_nxt_source_audit': source_audit,
            'ops_release_readiness': {'data_retained_for_audit': True},
        },
    }


def _existing_data_report(existing_result: dict | None, counts: dict) -> dict:
    total = _total_count(counts)
    if existing_result:
        return {
            'status': 'pass',
            'source': 'existing_prefixed_data_report',
            'writes_database': False,
            'summary': f'QA_UAT2R_ existing data complete: {total} rows',
            'counts': counts,
        }
    if total == 0:
        return {
            'status': 'planned',
            'source': 'existing_prefixed_data_report',
            'writes_database': False,
            'summary': 'QA_UAT2R_ existing data not present yet',
            'counts': counts,
        }
    return {
        'status': 'warning',
        'source': 'existing_prefixed_data_report',
        'writes_database': False,
        'summary': f'QA_UAT2R_ existing data is incomplete or unexpected: {total} rows',
        'counts': counts,
    }


def _shop_floor_report() -> dict:
    try:
        payload = build_shop_floor_handoff_payload(SHOP_FLOOR_PREFIX, backup_path='', confirm_write=False)
    except Exception as exc:
        return {
            'status': 'warning',
            'source': 'read_only_existing_report',
            'writes_database': False,
            'summary': f'shop-floor report unavailable: {exc.__class__.__name__}',
        }
    existing_report = payload.get('existing_data_report') or {}
    status = 'pass' if payload.get('overall_status') == 'ok' and existing_report.get('writes_database') is False else 'planned'
    return {
        'status': status,
        'source': 'read_only_existing_report',
        'writes_database': False,
        'summary': f"QA_SHF1_ report {payload.get('overall_status', 'unknown')}",
        'counts': payload.get('existing_prefixed_counts') or {},
    }


def _cleanup_status() -> dict:
    try:
        payload = build_cleanup_plan(LEGACY_CLEANUP_PREFIX)
    except Exception as exc:
        return {
            'status': 'warning',
            'source': 'read_only_cleanup_plan',
            'writes_database': False,
            'summary': f'cleanup status unavailable: {exc.__class__.__name__}',
        }
    candidate_total = int(payload.get('candidate_summary', {}).get('total_candidate_rows') or 0)
    return {
        'status': 'pass' if candidate_total == 0 else 'warning',
        'source': 'read_only_cleanup_plan',
        'writes_database': False,
        'summary': f'QA_UAT9H_ candidate rows: {candidate_total}',
        'candidate_total': candidate_total,
    }


def _build_scenario_report(write_result: dict | None, *, pending_migrations: bool, release: dict) -> list[dict]:
    write_scenarios = write_result.get('scenario_results', {}) if write_result else {}
    scenario_writes_database = bool(write_result and write_result.get('writes_database', True))
    source_audit = write_scenarios.get('inventory_ledger_nxt_source_audit') or {}
    source_groups = sorted(set(source_audit.values()))
    source_groups_ok = sorted(SOURCE_GROUPS) == source_groups
    status = 'pass' if write_result else 'planned'
    return [
        {
            'key': 'product_readiness',
            'domain': 'Product',
            'status': 'pass' if write_scenarios.get('product_readiness') else status,
            'writes_database': scenario_writes_database,
            'checks': write_scenarios.get('product_readiness') or {'planned': True},
        },
        {
            'key': 'sales_snapshot_delivery_plan',
            'domain': 'Sales',
            'status': 'pass' if write_scenarios.get('sales_snapshot_v2') else status,
            'writes_database': scenario_writes_database,
            'checks': write_scenarios.get('sales_snapshot_v2') or {'delivery_plan_planned': True},
        },
        {
            'key': 'production_handoff',
            'domain': 'Production',
            'status': 'pass' if write_scenarios.get('production_handoff') else status,
            'writes_database': scenario_writes_database,
            'checks': write_scenarios.get('production_handoff') or {'planned': True},
        },
        {
            'key': 'planning_board_advisory',
            'domain': 'Planning',
            'status': 'pass' if write_scenarios.get('planning_dispatch') else status,
            'writes_database': scenario_writes_database,
            'checks': write_scenarios.get('planning_dispatch') or {'ready_warning_blocker_planned': True},
        },
        {
            'key': 'shop_floor_retained_report',
            'domain': 'Shop-floor',
            **_shop_floor_report(),
        },
        {
            'key': 'inventory_nxt_source_breakdown',
            'domain': 'Inventory',
            'status': 'pass' if source_groups_ok else status,
            'writes_database': scenario_writes_database,
            'source_groups': source_groups or list(SOURCE_GROUPS),
            'checks': {
                'purchase': 'PURCHASE' in source_groups if source_groups else True,
                'production': 'PRODUCTION' in source_groups if source_groups else True,
                'stocktake': 'STOCKTAKE' in source_groups if source_groups else True,
                'transfer': 'TRANSFER' in source_groups if source_groups else True,
                'manual': 'MANUAL' in source_groups if source_groups else True,
            },
        },
        {
            'key': 'ops_readiness',
            'domain': 'Ops',
            'status': 'pass' if not pending_migrations and release.get('status') == 'ok' else 'warning',
            'writes_database': False,
            'checks': {
                'pending_migrations': pending_migrations,
                'release_readiness': release,
            },
        },
        {
            'key': 'cleanup_status_qa_uat9h',
            'domain': 'Ops',
            **_cleanup_status(),
        },
    ]


def _assert_confirm_write_gates(prefix: str, backup: dict, counts: dict, pending_migrations: bool, release: dict) -> dict:
    db_name = _database_name()
    if not _is_safe_write_database(db_name):
        raise CommandError(f'DB gate failed: {db_name} is not allowed for Round 2 drill writes.')
    if pending_migrations:
        raise CommandError('Migration gate failed: pending migrations exist.')
    if release.get('status') != 'ok':
        raise CommandError(f"Release readiness gate failed: {release.get('summary', 'unknown')}")
    if not backup.get('verified'):
        raise CommandError('Backup gate failed: verified backup path is required for --confirm-write.')
    if _total_count(counts) > 0:
        raise CommandError('Prefix gate failed: QA_UAT2R_ data already exists; cleanup/reuse requires separate approval.')
    return {
        'database_name': db_name,
        'safe_database': True,
        'pending_migrations': False,
        'release_readiness': release,
        'backup_verified': True,
        'existing_prefix_count': 0,
    }


def build_payload(prefix: str, *, backup_path: str | None, confirm_write: bool) -> dict:
    prefix = _validate_prefix(prefix)
    backup = _verify_backup_path(backup_path)
    existing_counts = _prefixed_counts(prefix)
    pending_migrations = _has_pending_migrations()
    release = _check_release_readiness()
    write_result = None
    confirm_gate = None
    if confirm_write:
        confirm_gate = _assert_confirm_write_gates(prefix, backup, existing_counts, pending_migrations, release)
        with transaction.atomic():
            write_result = _create_drill_data(prefix)
        existing_counts = _prefixed_counts(prefix)

    existing_result = _build_existing_data_result(prefix, existing_counts)
    existing_report = _existing_data_report(existing_result, existing_counts)
    scenario_source_result = write_result or existing_result
    scenario_report = _build_scenario_report(scenario_source_result, pending_migrations=pending_migrations, release=release)
    scenario_status_ok = all(item['status'] in {'pass', 'planned'} for item in scenario_report)
    existing_status_ok = existing_report['status'] in {'pass', 'planned'}
    return {
        'generated_at': timezone.now(),
        'pack': 'ERP Main UAT Round 2 Controlled Real-Dev Drill v1',
        'command': 'erp_main_uat_round2_real_dev_drill',
        'mode': 'confirm_write' if confirm_write else 'dry_run',
        'overall_status': 'ok' if scenario_status_ok and existing_status_ok else 'warning',
        'prefix': prefix,
        'backup': backup,
        'planned_data_counts': PLANNED_DATA_COUNTS,
        'existing_prefixed_counts': existing_counts,
        'existing_prefixed_total': _total_count(existing_counts),
        'existing_data_report': existing_report,
        'gates': {
            'prefix': {'status': 'ok', 'exact_required': DEFAULT_PREFIX},
            'database': {
                'name': _database_name(),
                'status': 'ok' if _is_safe_write_database(_database_name()) else 'warning',
                'safe_dev_db': SAFE_DEV_DB,
                'test_database_allowed': True,
            },
            'migration': {
                'status': 'warning' if pending_migrations else 'ok',
                'pending_migrations': pending_migrations,
            },
            'release_readiness': release,
            'backup': backup,
            'confirm_write': confirm_gate,
        },
        'scenario_report': scenario_report,
        'write_result': write_result,
        'safety': {
            'default_writes_database': False,
            'writes_database': bool(confirm_write),
            'write_requires_confirm_write': True,
            'backup_required_for_write': True,
            'reject_existing_prefixed_data_on_write': True,
            'outside_prefix_writes_allowed': False,
            'cleanup_runs': False,
            'restore_runs': False,
            'migration_runs': False,
            'deploy_runs': False,
            'direct_sql_used': False,
            'credentials_printed': False,
            'qc_printing_in_scope': False,
            'shop_floor_confirm_write_runs': False,
        },
        'next_step': (
            'Review diff and commit G1, then approve G2 backup + dry-run gate.'
            if not confirm_write
            else 'Run post-drill read-only QA and keep QA_UAT2R_ retained for audit.'
        ),
    }


def render_markdown(payload: dict) -> str:
    lines = [
        f"# {payload['pack']}",
        '',
        f"- Status: {str(payload['overall_status']).upper()}",
        f"- Mode: {payload['mode']}",
        f"- Prefix: `{payload['prefix']}`",
        f"- Writes database: {payload['safety']['writes_database']}",
        f"- Existing prefix total: {payload['existing_prefixed_total']}",
        f"- Backup gate: {payload['backup']['status']}",
        f"- DB gate: {payload['gates']['database']['status']} ({payload['gates']['database']['name']})",
        f"- Migration gate: {payload['gates']['migration']['status']}",
        f"- Release readiness gate: {payload['gates']['release_readiness']['status']}",
        '',
        '## Planned Round 2 data',
    ]
    for key, value in payload['planned_data_counts'].items():
        lines.append(f"- {key}: {value}")

    lines.extend(['', '## Existing prefixed data'])
    for key, value in payload['existing_prefixed_counts'].items():
        lines.append(f"- {key}: {value}")

    lines.extend(['', '## Scenario report'])
    for row in payload['scenario_report']:
        lines.append(f"- {row['domain']} / {row['key']}: {str(row['status']).upper()} writes_database={row['writes_database']}")

    lines.extend([
        '',
        '## Safety',
        '- Dry-run is the default and does not create, update, or delete DB rows.',
        '- DB write requires --confirm-write, exact QA_UAT2R_ prefix, safe DB, no pending migrations, release_readiness OK, verified backup, and existing prefix count 0.',
        '- Shop-floor QA_SHF1_ report is read-only; this command does not run shop-floor --confirm-write.',
        '- Cleanup status for QA_UAT9H_ is read-only; this command does not cleanup data.',
        '- No restore, migration, deploy, direct SQL, credentials, or QC Printing action is in scope.',
        '',
        f"Next step: {payload['next_step']}",
    ])
    return '\n'.join(lines)


def render_json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=True, indent=2, default=str)


class Command(BaseCommand):
    help = 'Report or run a guarded ERP main UAT Round 2 real-dev drill with exact QA_UAT2R_ prefix'

    def add_arguments(self, parser):
        parser.add_argument('--prefix', default=DEFAULT_PREFIX, help='Must be exactly QA_UAT2R_')
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')
        parser.add_argument('--backup-path', default='', help='Verified backup path required for --confirm-write')
        parser.add_argument('--confirm-write', action='store_true', help='Create controlled Round 2 prefixed drill data')

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
