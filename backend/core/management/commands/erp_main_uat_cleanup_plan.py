from __future__ import annotations

import json
import re

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.models import Q

from core.models import Customer
from inventory.models import InventoryTransaction, Stocktake, StocktakeLine, Warehouse, WarehouseLocation
from products.models import Operation, Product, ProductOperation, ProductRoutingStep, ProductUnit
from production.models import (
    ProductionDemand,
    ProductionMachine,
    ProductionMaterialRequirement,
    ProductionOperation,
    ProductionOrder,
    ProductionWorkCenter,
)
from sales.models import SalesOrder, SalesOrderDeliveryPlan, SalesOrderLine


DEFAULT_PREFIX = 'QA_UAT9H_'
PREFIX_PATTERN = re.compile(r'^QA_UAT[A-Z0-9]+_$')

DEPENDENCY_ORDER = (
    'support_audit_refs',
    'inventory_transactions',
    'stocktake_lines',
    'stocktakes',
    'production_material_requirements',
    'production_operations',
    'production_orders',
    'production_demands',
    'sales_order_delivery_plans',
    'sales_order_lines',
    'sales_orders',
    'product_routing_steps',
    'product_operations',
    'products',
    'warehouse_locations',
    'warehouses',
    'machines',
    'work_centers',
    'operations',
    'product_units',
    'customers',
)


def _validate_prefix(prefix: str) -> str:
    value = str(prefix or '').strip().upper()
    if value in {'QA_', 'QA_UAT_'} or not PREFIX_PATTERN.match(value):
        raise CommandError('Prefix must be a specific QA_UAT marker such as QA_UAT9H_.')
    if len(value) > 16:
        raise CommandError('Prefix is too long for compact UAT cleanup planning.')
    return value


def _ids(queryset) -> list[int]:
    return list(queryset.values_list('id', flat=True))


def _text_prefix_query(prefix: str, fields: tuple[str, ...]) -> Q:
    query = Q()
    for field in fields:
        query |= Q(**{f'{field}__icontains': prefix})
    return query


def _group(key: str, queryset, selector: str, *, cleanup_candidate: bool = True) -> dict:
    return {
        'key': key,
        'count': queryset.count(),
        'cleanup_candidate': cleanup_candidate,
        'selector': selector,
    }


def build_cleanup_plan(prefix: str) -> dict:
    prefix = _validate_prefix(prefix)

    customer_qs = Customer.objects.filter(code__startswith=prefix)
    product_unit_qs = ProductUnit.objects.filter(code__startswith=prefix)
    operation_qs = Operation.objects.filter(code__startswith=prefix)
    work_center_qs = ProductionWorkCenter.objects.filter(code__startswith=prefix)
    machine_qs = ProductionMachine.objects.filter(code__startswith=prefix)
    warehouse_qs = Warehouse.objects.filter(code__startswith=prefix)
    warehouse_location_qs = WarehouseLocation.objects.filter(code__startswith=prefix)
    product_qs = Product.objects.filter(code__startswith=prefix)

    customer_ids = _ids(customer_qs)
    operation_ids = _ids(operation_qs)
    work_center_ids = _ids(work_center_qs)
    machine_ids = _ids(machine_qs)
    warehouse_ids = _ids(warehouse_qs)
    warehouse_location_ids = _ids(warehouse_location_qs)
    product_ids = _ids(product_qs)

    product_operation_qs = ProductOperation.objects.filter(
        Q(product_id__in=product_ids) | Q(operation_id__in=operation_ids)
    ).distinct()
    product_routing_step_qs = ProductRoutingStep.objects.filter(
        Q(product_id__in=product_ids) | Q(operation_id__in=operation_ids)
    ).distinct()

    sales_order_qs = SalesOrder.objects.filter(
        Q(code__startswith=prefix)
        | Q(reference__icontains=prefix)
        | Q(notes__icontains=prefix)
        | Q(customer_id__in=customer_ids)
    ).distinct()
    sales_order_ids = _ids(sales_order_qs)
    sales_order_line_qs = SalesOrderLine.objects.filter(
        Q(sales_order_id__in=sales_order_ids) | Q(product_id__in=product_ids)
    ).distinct()
    sales_order_line_ids = _ids(sales_order_line_qs)
    sales_order_delivery_plan_qs = SalesOrderDeliveryPlan.objects.filter(line_id__in=sales_order_line_ids).distinct()

    production_demand_qs = ProductionDemand.objects.filter(
        Q(demand_code__startswith=prefix)
        | Q(demand_key__startswith=prefix)
        | Q(source__icontains=prefix)
        | Q(notes__icontains=prefix)
        | Q(sales_order_id__in=sales_order_ids)
        | Q(sales_order_line_id__in=sales_order_line_ids)
        | Q(product_id__in=product_ids)
    ).distinct()
    production_demand_ids = _ids(production_demand_qs)
    production_order_qs = ProductionOrder.objects.filter(
        Q(code__startswith=prefix)
        | Q(reference__icontains=prefix)
        | Q(notes__icontains=prefix)
        | Q(production_demand_id__in=production_demand_ids)
        | Q(sales_order_id__in=sales_order_ids)
        | Q(sales_order_line_id__in=sales_order_line_ids)
        | Q(product_id__in=product_ids)
    ).distinct()
    production_order_ids = _ids(production_order_qs)
    production_operation_qs = ProductionOperation.objects.filter(
        Q(production_order_id__in=production_order_ids)
        | Q(step_code__startswith=prefix)
        | Q(step_name__icontains=prefix)
        | Q(machine_code__startswith=prefix)
        | Q(work_center_code__startswith=prefix)
    ).distinct()
    production_material_requirement_qs = ProductionMaterialRequirement.objects.filter(
        Q(production_order_id__in=production_order_ids)
        | Q(material_product_id__in=product_ids)
        | Q(note__icontains=prefix)
    ).distinct()

    stocktake_qs = Stocktake.objects.filter(
        Q(code__startswith=prefix) | Q(note__icontains=prefix) | Q(warehouse_id__in=warehouse_ids)
    ).distinct()
    stocktake_ids = _ids(stocktake_qs)
    stocktake_line_qs = StocktakeLine.objects.filter(
        Q(stocktake_id__in=stocktake_ids)
        | Q(product_id__in=product_ids)
        | Q(warehouse_id__in=warehouse_ids)
        | Q(note__icontains=prefix)
    ).distinct()
    stocktake_line_ids = _ids(stocktake_line_qs)
    inventory_transaction_qs = InventoryTransaction.objects.filter(
        Q(code__startswith=prefix)
        | _text_prefix_query(prefix, ('reference', 'reason', 'note'))
        | Q(product_id__in=product_ids)
        | Q(warehouse_id__in=warehouse_ids)
        | Q(location_id__in=warehouse_location_ids)
        | Q(target_warehouse_id__in=warehouse_ids)
        | Q(target_location_id__in=warehouse_location_ids)
        | Q(sales_order_id__in=sales_order_ids)
        | Q(sales_order_line_id__in=sales_order_line_ids)
        | Q(production_order_id__in=production_order_ids)
        | Q(stocktake_id__in=stocktake_ids)
        | Q(stocktake_line_id__in=stocktake_line_ids)
    ).distinct()

    groups = [
        _group('inventory_transactions', inventory_transaction_qs, 'code/reference/reason/note prefix or FK to QA_UAT9H_ product/order/stocktake/warehouse'),
        _group('stocktake_lines', stocktake_line_qs, 'FK to QA_UAT9H_ stocktake/product/warehouse or note prefix'),
        _group('stocktakes', stocktake_qs, 'code/note prefix or QA_UAT9H_ warehouse FK'),
        _group('production_material_requirements', production_material_requirement_qs, 'FK to QA_UAT9H_ production order/material product or note prefix'),
        _group('production_operations', production_operation_qs, 'FK to QA_UAT9H_ production order or operation/resource code prefix'),
        _group('production_orders', production_order_qs, 'code/reference/note prefix or FK to QA_UAT9H_ demand/sales/product'),
        _group('production_demands', production_demand_qs, 'demand code/key/source/note prefix or FK to QA_UAT9H_ sales/product'),
        _group('sales_order_delivery_plans', sales_order_delivery_plan_qs, 'FK to QA_UAT9H_ sales order line'),
        _group('sales_order_lines', sales_order_line_qs, 'FK to QA_UAT9H_ sales order/product'),
        _group('sales_orders', sales_order_qs, 'code/reference/notes prefix or QA_UAT9H_ customer FK'),
        _group('product_routing_steps', product_routing_step_qs, 'FK to QA_UAT9H_ product/operation'),
        _group('product_operations', product_operation_qs, 'FK to QA_UAT9H_ product/operation'),
        _group('products', product_qs, 'product code prefix'),
        _group('warehouse_locations', warehouse_location_qs, 'warehouse location code prefix'),
        _group('warehouses', warehouse_qs, 'warehouse code prefix'),
        _group('machines', machine_qs, 'machine code prefix'),
        _group('work_centers', work_center_qs, 'work center code prefix'),
        _group('operations', operation_qs, 'operation code prefix'),
        _group('product_units', product_unit_qs, 'product unit code prefix'),
        _group('customers', customer_qs, 'customer code prefix'),
    ]
    blocked_or_unsafe_groups = [
        {
            'key': 'support_audit_refs',
            'count': None,
            'cleanup_candidate': False,
            'reason': 'Generic audit/support references are not included without explicit FK-safe review.',
        },
        {
            'key': 'broad_qa_seed_data',
            'count': None,
            'cleanup_candidate': False,
            'reason': 'QA_ seed, TMP, QA_8A2F_, QA_7E2_, test DB, and non-prefixed data are outside this plan.',
        },
    ]
    total_candidates = sum(int(group['count']) for group in groups)
    return {
        'pack': 'ERP Main UAT Data Cleanup Plan v1',
        'command': 'erp_main_uat_cleanup_plan',
        'mode': 'read_only_cleanup_plan',
        'overall_status': 'ok' if total_candidates else 'warning',
        'prefix': prefix,
        'database': {
            'name': str(connection.settings_dict.get('NAME') or ''),
        },
        'cleanup_status': 'not_performed',
        'actual_cleanup_requires': [
            'separate VANG approval',
            'fresh verified backup',
            'rerun dry-run count',
            'separate command/change with explicit delete path',
        ],
        'candidate_summary': {
            'total_candidate_rows': total_candidates,
            'group_count': len(groups),
        },
        'candidate_groups': groups,
        'blocked_or_unsafe_groups': blocked_or_unsafe_groups,
        'dependency_order': list(DEPENDENCY_ORDER),
        'safety': {
            'writes_database': False,
            'delete_path_available': False,
            'confirm_delete_available': False,
            'cleanup_performed': False,
            'broad_prefix_allowed': False,
            'backup_restore_runs': False,
            'migration_runs': False,
            'deploy_runs': False,
            'credential_values_printed': False,
            'qc_printing_in_scope': False,
        },
    }


def render_markdown(payload: dict) -> str:
    lines = [
        f"# {payload['pack']}",
        '',
        f"- Status: {str(payload['overall_status']).upper()}",
        f"- Mode: {payload['mode']}",
        f"- Prefix: `{payload['prefix']}`",
        f"- DB: `{payload['database']['name']}`",
        f"- Cleanup status: {payload['cleanup_status']}",
        f"- Total candidate rows: {payload['candidate_summary']['total_candidate_rows']}",
        '',
        '## Candidate cleanup scope',
    ]
    for group in payload['candidate_groups']:
        lines.append(f"- {group['key']}: {group['count']} ({group['selector']})")

    lines.extend(['', '## Blocked / unsafe groups'])
    for group in payload['blocked_or_unsafe_groups']:
        lines.append(f"- {group['key']}: {group['reason']}")

    lines.extend(['', '## Dependency order'])
    for index, key in enumerate(payload['dependency_order'], start=1):
        lines.append(f"{index}. {key}")

    lines.extend(['', '## Gate for actual cleanup'])
    for item in payload['actual_cleanup_requires']:
        lines.append(f"- {item}")

    lines.extend([
        '',
        '## Safety',
        '- This command is read-only.',
        '- No delete path exists in this milestone.',
        '- No cleanup runs from this command.',
        '- Broad QA_ prefixes are rejected.',
        '- No backup, restore, migration, deployment, or QC Printing action runs from this command.',
        '- No credential values are printed.',
    ])
    return '\n'.join(lines)


class Command(BaseCommand):
    help = 'Build a read-only cleanup count/scope plan for ERP main UAT data'

    def add_arguments(self, parser):
        parser.add_argument('--prefix', default=DEFAULT_PREFIX, help='Specific UAT prefix, default QA_UAT9H_')
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')

    def handle(self, *args, **options):
        payload = build_cleanup_plan(options['prefix'])
        if options['format'] == 'json':
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(render_markdown(payload))
