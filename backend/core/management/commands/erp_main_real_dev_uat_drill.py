from __future__ import annotations

import json
import re
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from core.models import Customer
from inventory.models import (
    InventoryTransaction,
    InventoryTransactionStatus,
    InventoryTransactionType,
    Stocktake,
    StocktakeLine,
    StocktakeStatus,
    Warehouse,
    WarehouseLocation,
)
from inventory.serializers import build_inventory_source_audit
from products.models import Operation, Product, ProductOperation, ProductRoutingStep, ProductUnit
from products.readiness import build_product_routing_readiness
from production.demand_services import extract_product_snapshot_summary
from production.models import (
    ProductionDemand,
    ProductionDemandPlanningStatus,
    ProductionDemandPriority,
    ProductionDemandProductionStatus,
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
from production.services import build_ready_to_dispatch_advisory
from sales.models import SalesOrder, SalesOrderDeliveryPlan, SalesOrderLine, SalesOrderStatus


DEFAULT_PREFIX = 'QA_UAT9H_'
SAFE_DB_NAME = 'erp_dev_clean'
PREFIX_PATTERN = re.compile(r'^QA_UAT[A-Z0-9_]*_$')

SCENARIOS = (
    'product_readiness',
    'sales_snapshot_v2',
    'production_handoff',
    'planning_dispatch',
    'inventory_ledger_nxt_source_audit',
    'ops_release_readiness',
)

PLANNED_DATA_COUNTS = {
    'customers': 1,
    'product_units': 1,
    'operations': 2,
    'work_centers': 1,
    'machines': 1,
    'warehouses': 2,
    'warehouse_locations': 2,
    'products': 4,
    'product_operations': 3,
    'product_routing_steps': 3,
    'sales_orders': 1,
    'sales_order_lines': 1,
    'sales_order_delivery_plans': 1,
    'production_demands': 1,
    'production_orders': 1,
    'production_operations': 5,
    'production_material_requirements': 1,
    'stocktakes': 1,
    'stocktake_lines': 1,
    'inventory_transactions': 5,
}


def _database_name() -> str:
    return str(connection.settings_dict.get('NAME') or '')


def _is_safe_write_database(name: str) -> bool:
    normalized = str(name or '').strip().lower()
    return normalized == SAFE_DB_NAME or normalized.startswith('test_')


def _validate_prefix(prefix: str) -> str:
    value = str(prefix or '').strip().upper()
    if not PREFIX_PATTERN.match(value):
        raise CommandError('Prefix must start with QA_UAT, use uppercase letters/numbers/underscore, and end with underscore.')
    if len(value) > 9:
        raise CommandError('Prefix must be 9 characters or fewer so all compact UAT master codes remain prefixed.')
    return value


def _code(prefix: str, suffix: str, max_length: int = 50) -> str:
    value = f'{prefix}{suffix}'.upper()
    if len(value) > max_length:
        raise CommandError(f'Generated code exceeds max length {max_length}: {value}')
    return value


def _scenario_rows(status: str) -> list[dict]:
    return [
        {
            'key': key,
            'status': status,
            'write_required': status == 'created',
        }
        for key in SCENARIOS
    ]


def _bump(summary: dict, key: str, created: bool):
    bucket = 'created' if created else 'updated'
    summary.setdefault(key, {'created': 0, 'updated': 0})
    summary[key][bucket] += 1


def _upsert(summary: dict, key: str, model, *, lookup: dict, defaults: dict):
    obj, created = model.objects.update_or_create(**lookup, defaults=defaults)
    _bump(summary, key, created)
    return obj


def _upsert_filtered(summary: dict, key: str, model, *, filters: dict, create_values: dict, defaults: dict):
    obj = model.objects.filter(**filters).first()
    created = obj is None
    if created:
        obj = model.objects.create(**create_values, **defaults)
    else:
        for attr, value in defaults.items():
            setattr(obj, attr, value)
        obj.save()
    _bump(summary, key, created)
    return obj


def _replace_product_routing(summary: dict, product: Product, operations: list[tuple[Operation, int]]):
    ProductRoutingStep.objects.filter(product=product).delete()
    ProductOperation.objects.filter(product=product).delete()
    product_operations = []
    for index, (operation, rate) in enumerate(operations, start=1):
        product_operation = ProductOperation.objects.create(
            product=product,
            operation=operation,
            sequence=index * 10,
            standard_rate_per_hour=rate,
            is_active=True,
        )
        ProductRoutingStep.objects.create(
            product=product,
            operation=operation,
            product_operation=product_operation,
            step_no=index * 10,
            display_order=index * 10,
            standard_rate_per_hour=rate,
            is_active=True,
        )
        product_operations.append(product_operation)
    summary['product_operations'] = {
        'created': summary.get('product_operations', {}).get('created', 0) + len(product_operations),
        'updated': summary.get('product_operations', {}).get('updated', 0),
    }
    summary['product_routing_steps'] = {
        'created': summary.get('product_routing_steps', {}).get('created', 0) + len(product_operations),
        'updated': summary.get('product_routing_steps', {}).get('updated', 0),
    }


def _build_sales_snapshot_summary(line: SalesOrderLine) -> dict:
    summary = extract_product_snapshot_summary(line)
    return {
        'customer_id_snapshot': summary['customer_id_snapshot'],
        'customer_name_snapshot': summary['customer_name_snapshot'],
        'product_code': summary['product_code'],
        'product_name': summary['product_name'],
        'product_kind': summary['product_kind'],
        'unit_name': summary['unit_name'],
        'size_order': summary['size_order'],
        'size_production': summary['size_production'],
        'print_colors': summary['print_colors'],
        'operations_summary': summary['operations_summary'],
        'routing_summary': summary['routing_summary'],
    }


def _create_drill_data(prefix: str) -> dict:
    today = timezone.localdate()
    summary: dict = {}

    unit = _upsert_filtered(
        summary,
        'product_units',
        ProductUnit,
        filters={'code': _code(prefix, 'U', 10), 'deleted_at__isnull': True},
        create_values={'code': _code(prefix, 'U', 10)},
        defaults={'name': f'{prefix}Unit', 'is_active': True, 'sort_order': 900},
    )
    op_print = _upsert(
        summary,
        'operations',
        Operation,
        lookup={'code': _code(prefix, 'IN', 30)},
        defaults={'name': f'{prefix}Print', 'sequence': 10, 'is_active': True},
    )
    op_finish = _upsert(
        summary,
        'operations',
        Operation,
        lookup={'code': _code(prefix, 'BE', 30)},
        defaults={'name': f'{prefix}Finish', 'sequence': 20, 'is_active': True},
    )
    work_center = _upsert(
        summary,
        'work_centers',
        ProductionWorkCenter,
        lookup={'code': _code(prefix, 'WC', 40)},
        defaults={'name': f'{prefix}Work center', 'default_capacity_hours': Decimal('8'), 'is_active': True},
    )
    machine = _upsert(
        summary,
        'machines',
        ProductionMachine,
        lookup={'code': _code(prefix, 'MC', 40)},
        defaults={
            'name': f'{prefix}Machine',
            'work_center': work_center,
            'default_capacity_hours': Decimal('8'),
            'is_active': True,
        },
    )
    wh_main = _upsert_filtered(
        summary,
        'warehouses',
        Warehouse,
        filters={'code': _code(prefix, 'WH1', 20), 'deleted_at__isnull': True},
        create_values={'code': _code(prefix, 'WH1', 20)},
        defaults={'name': f'{prefix}Kho UAT 1', 'is_active': True},
    )
    wh_target = _upsert_filtered(
        summary,
        'warehouses',
        Warehouse,
        filters={'code': _code(prefix, 'WH2', 20), 'deleted_at__isnull': True},
        create_values={'code': _code(prefix, 'WH2', 20)},
        defaults={'name': f'{prefix}Kho UAT 2', 'is_active': True},
    )
    loc_main = _upsert_filtered(
        summary,
        'warehouse_locations',
        WarehouseLocation,
        filters={'warehouse': wh_main, 'code': _code(prefix, 'L1', 30), 'deleted_at__isnull': True},
        create_values={'warehouse': wh_main, 'code': _code(prefix, 'L1', 30)},
        defaults={'name': f'{prefix}Vi tri 1', 'is_active': True},
    )
    loc_target = _upsert_filtered(
        summary,
        'warehouse_locations',
        WarehouseLocation,
        filters={'warehouse': wh_target, 'code': _code(prefix, 'L2', 30), 'deleted_at__isnull': True},
        create_values={'warehouse': wh_target, 'code': _code(prefix, 'L2', 30)},
        defaults={'name': f'{prefix}Vi tri 2', 'is_active': True},
    )
    customer = _upsert(
        summary,
        'customers',
        Customer,
        lookup={'code': _code(prefix, 'CUS', 50)},
        defaults={'name': f'{prefix}Customer', 'status': 'APPROVED', 'is_active': True},
    )

    product_common = {
        'unit': unit,
        'status': 'ACTIVE',
        'is_active': True,
        'product_kind': Product.ProductKind.SPECIFIC,
        'sale_price': Decimal('10000'),
        'cost_price': Decimal('7000'),
        'size_order': '300x200x150',
        'size_production': '305x205x155',
    }
    product_ready = _upsert(
        summary,
        'products',
        Product,
        lookup={'code': _code(prefix, 'PROD_READY', 50)},
        defaults={
            **product_common,
            'name': f'{prefix}Ready product',
            'process_in': 18000,
            'process_be': 9000,
            'film_code': _code(prefix, 'FILM', 50),
            'color_count': 2,
            'print_color_1': 'Black',
            'print_color_2': 'Blue',
        },
    )
    product_warning = _upsert(
        summary,
        'products',
        Product,
        lookup={'code': _code(prefix, 'PROD_WARN', 50)},
        defaults={
            **product_common,
            'name': f'{prefix}Warning product',
            'process_in': 12000,
            'film_code': '',
            'color_count': 0,
            'print_color_1': '',
            'print_color_2': '',
        },
    )
    product_blocker = _upsert(
        summary,
        'products',
        Product,
        lookup={'code': _code(prefix, 'PROD_BLOCK', 50)},
        defaults={**product_common, 'name': f'{prefix}Blocker product', 'process_in': None, 'process_be': None},
    )
    material_product = _upsert(
        summary,
        'products',
        Product,
        lookup={'code': _code(prefix, 'MAT', 50)},
        defaults={**product_common, 'name': f'{prefix}Material product', 'process_in': None, 'process_be': None},
    )

    _replace_product_routing(summary, product_ready, [(op_print, 18000), (op_finish, 9000)])
    _replace_product_routing(summary, product_warning, [(op_print, 12000)])
    ProductRoutingStep.objects.filter(product=product_blocker).delete()
    ProductOperation.objects.filter(product=product_blocker).delete()

    order = _upsert(
        summary,
        'sales_orders',
        SalesOrder,
        lookup={'code': _code(prefix, 'SO001', 50)},
        defaults={
            'doc_type': 'SO',
            'order_date': today,
            'delivery_date': today + timedelta(days=14),
            'status': SalesOrderStatus.APPROVED,
            'customer': customer,
            'currency': 'VND',
            'exchange_rate': Decimal('1'),
            'reference': _code(prefix, 'REFSO', 50),
            'notes': f'{prefix}real-dev UAT sales snapshot drill',
        },
    )
    line = _upsert(
        summary,
        'sales_order_lines',
        SalesOrderLine,
        lookup={'sales_order': order, 'line_number': 1},
        defaults={
            'product': product_ready,
            'qty': Decimal('10'),
            'unit_price': Decimal('10000'),
            'note': f'{prefix}snapshot drill line',
        },
    )
    snapshot_before = dict(line.product_snapshot or {})
    line.qty = Decimal('12')
    line.unit_price = Decimal('11000')
    line.note = f'{prefix}snapshot stable after qty price note update'
    line.save()
    line.refresh_from_db()
    order.recalc_totals()
    snapshot_stable = snapshot_before == dict(line.product_snapshot or {})
    _upsert(
        summary,
        'sales_order_delivery_plans',
        SalesOrderDeliveryPlan,
        lookup={'line': line, 'delivery_date': today + timedelta(days=14)},
        defaults={'qty': Decimal('12'), 'note': f'{prefix}delivery plan'},
    )

    demand_payload = {
        **_build_sales_snapshot_summary(line),
        'demand_code': _code(prefix, 'DEMAND001', 50),
        'sales_order': order,
        'sales_order_line': line,
        'product': product_ready,
        'qty_required': Decimal('12'),
        'qty_planned': Decimal('12'),
        'order_date': today,
        'delivery_date': today + timedelta(days=14),
        'production_due_date': today + timedelta(days=10),
        'planning_due_date': today + timedelta(days=5),
        'planning_status': ProductionDemandPlanningStatus.FULLY_PLANNED,
        'production_status': ProductionDemandProductionStatus.NOT_RELEASED,
        'priority': ProductionDemandPriority.NORMAL,
        'notes': f'{prefix}production handoff drill',
        'source': _code(prefix, 'SOURCE', 50),
    }
    demand = _upsert(
        summary,
        'production_demands',
        ProductionDemand,
        lookup={'demand_key': _code(prefix, 'DEMANDKEY001', 200)},
        defaults=demand_payload,
    )
    order_snapshot = dict(line.product_snapshot or {})
    production_order = _upsert(
        summary,
        'production_orders',
        ProductionOrder,
        lookup={'code': _code(prefix, 'MO001', 50)},
        defaults={
            'doc_type': 'MO',
            'order_date': today,
            'planned_start_date': today + timedelta(days=1),
            'planned_end_date': today + timedelta(days=3),
            'status': ProductionOrderStatus.RELEASED,
            'reference': order.code,
            'sales_order': order,
            'sales_order_line': line,
            'production_demand': demand,
            'product': product_ready,
            'product_snapshot': order_snapshot,
            'planned_qty': Decimal('12'),
            'target_warehouse': wh_main,
            'target_location': loc_main,
            'notes': f'{prefix}planning dispatch drill',
        },
    )
    operation_rows = (
        (10, 'READY', ProductionOperationStatus.READY, '', today + timedelta(days=1), ProductionShift.MORNING),
        (20, 'WAIT', ProductionOperationStatus.PENDING, ProductionOperationBlockReason.WAIT_PREVIOUS_STEP, today + timedelta(days=1), ProductionShift.AFTERNOON),
        (30, 'BLOCK', ProductionOperationStatus.PENDING, ProductionOperationBlockReason.WAIT_MATERIAL, None, ''),
        (40, 'DONE', ProductionOperationStatus.DONE, '', today + timedelta(days=2), ProductionShift.MORNING),
        (50, 'SKIP', ProductionOperationStatus.SKIPPED, '', today + timedelta(days=2), ProductionShift.AFTERNOON),
    )
    operations = []
    for sequence, suffix, status, block_reason, planned_date, planned_shift in operation_rows:
        operation, created = ProductionOperation.objects.update_or_create(
            production_order=production_order,
            sequence=sequence,
            defaults={
                'step_code': _code(prefix, f'OP{suffix}', 30),
                'step_name': f'{prefix}Operation {suffix}',
                'rate_per_hour': Decimal('1000'),
                'planned_qty': Decimal('12'),
                'status': status,
                'block_reason_code': block_reason,
                'planned_date': planned_date,
                'planned_shift': planned_shift,
                'machine_code': machine.code,
                'machine_name': machine.name,
                'work_center_code': work_center.code,
                'work_center_name': work_center.name,
                'dispatch_sequence': sequence,
            },
        )
        operations.append(operation)
        _bump(summary, 'production_operations', created)
    _upsert(
        summary,
        'production_material_requirements',
        ProductionMaterialRequirement,
        lookup={'production_order': production_order, 'line_number': 1},
        defaults={
            'material_product': material_product,
            'internal_product_code': material_product.code,
            'product_snapshot': {'code': material_product.code, 'name': material_product.name},
            'required_qty': Decimal('24'),
            'issued_qty': Decimal('0'),
            'source_warehouse': wh_main,
            'source_location': loc_main,
            'note': f'{prefix}material warning drill',
        },
    )

    stocktake = _upsert(
        summary,
        'stocktakes',
        Stocktake,
        lookup={'code': _code(prefix, 'STK001', 50)},
        defaults={'warehouse': wh_main, 'count_date': today, 'status': StocktakeStatus.COMPLETED, 'note': f'{prefix}stocktake source audit'},
    )
    stocktake_line = _upsert(
        summary,
        'stocktake_lines',
        StocktakeLine,
        lookup={'stocktake': stocktake, 'line_number': 1},
        defaults={'product': product_ready, 'warehouse': wh_main, 'system_qty': Decimal('10'), 'count_qty': Decimal('12'), 'note': f'{prefix}stocktake variance'},
    )
    inventory_rows = (
        ('INV_PURCHASE', InventoryTransactionType.RECEIPT, f'GRN-{prefix}001', product_ready, wh_main, loc_main, None, None, {'quantity': Decimal('50')}),
        ('INV_PRODUCTION', InventoryTransactionType.ISSUE, f'PMI-{prefix}001', material_product, wh_main, loc_main, None, None, {'production_order': production_order, 'quantity': Decimal('5')}),
        ('INV_STOCKTAKE', InventoryTransactionType.ADJUSTMENT_IN, f'STKT-{prefix}001', product_ready, wh_main, loc_main, None, None, {'stocktake': stocktake, 'stocktake_line': stocktake_line, 'quantity': Decimal('2')}),
        ('INV_TRANSFER', InventoryTransactionType.TRANSFER, f'TRN-{prefix}001', product_ready, wh_main, loc_main, wh_target, loc_target, {'quantity': Decimal('3')}),
        ('INV_MANUAL', InventoryTransactionType.ADJUSTMENT_OUT, f'{prefix}MANUAL001', product_blocker, wh_main, loc_main, None, None, {'quantity': Decimal('1')}),
    )
    transactions = []
    for suffix, tx_type, reference, product, warehouse, location, target_warehouse, target_location, extra in inventory_rows:
        transaction_obj = _upsert(
            summary,
            'inventory_transactions',
            InventoryTransaction,
            lookup={'code': _code(prefix, suffix, 50)},
            defaults={
                'transaction_type': tx_type,
                'status': InventoryTransactionStatus.POSTED,
                'transaction_date': today,
                'reference': reference,
                'reason': f'{prefix}source audit drill',
                'product': product,
                'warehouse': warehouse,
                'location': location,
                'target_warehouse': target_warehouse,
                'target_location': target_location,
                'unit_cost': Decimal('1000'),
                **extra,
            },
        )
        transactions.append(transaction_obj)

    product_readiness = {
        'ready': build_product_routing_readiness(product_ready)['status'],
        'warning': build_product_routing_readiness(product_warning)['status'],
        'blocker': build_product_routing_readiness(product_blocker)['status'],
    }
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
        'data_counts': summary,
        'object_codes': {
            'products': [product_ready.code, product_warning.code, product_blocker.code, material_product.code],
            'sales_order': order.code,
            'production_demand': demand.demand_code,
            'production_order': production_order.code,
            'inventory_transactions': [tx.code for tx in transactions],
        },
        'scenario_results': {
            'product_readiness': product_readiness,
            'sales_snapshot_v2': {'snapshot_stable_after_qty_price_note_update': snapshot_stable},
            'production_handoff': {
                'demand_code': demand.demand_code,
                'production_order_code': production_order.code,
                'snapshot_product_code': order_snapshot.get('code') or order_snapshot.get('product_code'),
            },
            'planning_dispatch': planning_readiness,
            'inventory_ledger_nxt_source_audit': source_audit,
            'ops_release_readiness': {'data_created_only': True},
        },
    }


def _build_payload(prefix: str, *, mode: str, write_result: dict | None = None) -> dict:
    db_name = _database_name()
    payload = {
        'pack': 'ERP Main Real-Dev UAT Drill v1',
        'command': 'erp_main_real_dev_uat_drill',
        'mode': mode,
        'prefix': prefix,
        'database': {
            'name': db_name,
            'write_safe': _is_safe_write_database(db_name),
            'required_dev_name': SAFE_DB_NAME,
        },
        'overall_status': 'ok',
        'scenarios': _scenario_rows('created' if mode == 'write' else 'planned'),
        'planned_data_counts': PLANNED_DATA_COUNTS,
        'safety': {
            'default_writes_db': False,
            'write_requires_confirm_flag': True,
            'cleanup_enabled': False,
            'sensitive_values_printed': False,
            'qc_printing_in_scope': False,
        },
        'next_steps': [
            'Run with --confirm-write only after backup and explicit approval.',
            'Keep prefixed UAT data for audit; cleanup requires separate approval.',
        ],
    }
    if write_result:
        payload['write_result'] = write_result
    return payload


def _render_markdown(payload: dict) -> str:
    lines = [
        f"# {payload['pack']}",
        '',
        f"- Status: {str(payload['overall_status']).upper()}",
        f"- Mode: {payload['mode']}",
        f"- Prefix: `{payload['prefix']}`",
        f"- DB: `{payload['database']['name']}`",
        f"- Write safe DB: {payload['database']['write_safe']}",
        '',
        '## Scenarios',
    ]
    for scenario in payload['scenarios']:
        lines.append(f"- {scenario['key']}: {str(scenario['status']).upper()}")
    lines.extend(['', '## Planned data counts'])
    for key, count in payload['planned_data_counts'].items():
        lines.append(f"- {key}: {count}")
    if payload.get('write_result'):
        lines.extend(['', '## Write result'])
        for key, counts in payload['write_result']['data_counts'].items():
            lines.append(f"- {key}: created={counts.get('created', 0)}, updated={counts.get('updated', 0)}")
        lines.append('')
        lines.append('## Scenario result')
        for key, value in payload['write_result']['scenario_results'].items():
            lines.append(f"- {key}: {json.dumps(value, ensure_ascii=False, default=str)}")
    lines.extend([
        '',
        '## Safety',
        '- Default run is dry-run/read-only.',
        '- DB write requires --confirm-write.',
        '- Cleanup is not part of this command.',
        '- QC Printing is outside this ERP main drill.',
    ])
    return '\n'.join(lines)


class Command(BaseCommand):
    help = 'Prepare or create controlled ERP main real-dev UAT drill data with a required QA_UAT prefix'

    def add_arguments(self, parser):
        parser.add_argument('--prefix', default=DEFAULT_PREFIX, help='Required controlled UAT prefix, default QA_UAT9H_')
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')
        parser.add_argument('--dry-run', action='store_true', help='Explicit read-only mode; this is also the default')
        parser.add_argument('--confirm-write', action='store_true', help='Create/update controlled prefixed UAT drill data')

    def handle(self, *args, **options):
        prefix = _validate_prefix(options.get('prefix') or DEFAULT_PREFIX)
        confirm_write = bool(options.get('confirm_write'))
        explicit_dry_run = bool(options.get('dry_run'))
        if confirm_write and explicit_dry_run:
            raise CommandError('Use either --dry-run or --confirm-write, not both.')

        mode = 'write' if confirm_write else 'dry_run'
        if confirm_write and not _is_safe_write_database(_database_name()):
            raise CommandError(f'Refusing to write UAT drill data outside {SAFE_DB_NAME} or Django test databases.')

        write_result = None
        if confirm_write:
            with transaction.atomic():
                write_result = _create_drill_data(prefix)

        payload = _build_payload(prefix, mode=mode, write_result=write_result)
        if options['format'] == 'json':
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(_render_markdown(payload))
