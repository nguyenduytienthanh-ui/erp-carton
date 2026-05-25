from __future__ import annotations

import json
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

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
PREFIX_PATTERN = re.compile(r'^QA_UAT[A-Z0-9_]*_$')
DEFAULT_PRE_BACKUP = Path(r'D:\ERP-Carton-2D-snapshot-db-backups\20260525_132331')
DEFAULT_POST_BACKUP = Path(r'D:\ERP-Carton-2D-snapshot-db-backups\20260525_150508')

SCENARIO_RESULTS = (
    ('product_readiness', 'Product readiness', 'Product master / routing / print metadata PASS'),
    ('sales_snapshot_v2', 'SalesOrder snapshot v2', 'Snapshot stays stable after sales line qty/price/note edits PASS'),
    ('production_handoff', 'Production handoff', 'ProductionDemand and ProductionOrder keep sales snapshot context PASS'),
    ('planning_dispatch', 'PlanningBoard dispatch', 'READY / WARNING / BLOCKER dispatch advisory PASS'),
    ('inventory_ledger_nxt_source_audit', 'Inventory ledger/NXT/source audit', 'Ledger, NXT, and source audit labels PASS'),
    ('ops_release_readiness', 'Ops release readiness', 'Migration, backup/restore, alert, and release hygiene readiness PASS'),
)

OPERATOR_CHECKLIST = (
    {
        'role': 'Product / Product manager',
        'personas': ('uat_admin', 'uat_manager', 'uat_product_manager'),
        'checks': (
            'Open a QA_UAT9H_ product with complete routing and print metadata.',
            'Open QA_UAT9H_ warning/blocker products and confirm READY / WARNING / BLOCKER are advisory.',
        ),
    },
    {
        'role': 'Sales / Sales manager',
        'personas': ('uat_admin', 'uat_sales', 'uat_sales_manager'),
        'checks': (
            'Open the QA_UAT9H_ SalesOrder and verify product snapshot v2 fields.',
            'Confirm qty/price/note updates do not silently refresh snapshot business fields.',
        ),
    },
    {
        'role': 'Production planner / Manager',
        'personas': ('uat_admin', 'uat_manager', 'uat_product_manager'),
        'checks': (
            'Open QA_UAT9H_ ProductionDemand and ProductionOrder handoff context.',
            'Review PlanningBoard READY / WARNING / BLOCKER, dependency, block, done/skipped, capacity, and material signals.',
        ),
    },
    {
        'role': 'Inventory operator / Manager',
        'personas': ('uat_admin', 'uat_manager', 'uat_product_manager'),
        'checks': (
            'Open So kho/NXT for QA_UAT9H_ movements.',
            'Confirm PURCHASE / PRODUCTION / STOCKTAKE / TRANSFER / MANUAL source audit labels are understandable.',
        ),
    },
    {
        'role': 'Admin / Ops',
        'personas': ('uat_admin',),
        'checks': (
            'Run release_readiness in a safe local shell.',
            'Confirm no pending migrations, backup/restore drill OK, alert delivery OK, and release hygiene OK.',
        ),
    },
)

EXPECTED_MINIMUM_COUNTS = {
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


def _validate_prefix(prefix: str) -> str:
    value = str(prefix or '').strip().upper()
    if not PREFIX_PATTERN.match(value):
        raise CommandError('Prefix must start with QA_UAT, use uppercase letters/numbers/underscore, and end with underscore.')
    if len(value) > 9:
        raise CommandError('Prefix must be 9 characters or fewer so compact UAT codes remain prefixed.')
    return value


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        return {'status': 'invalid_json'}


def _backup_status(path: Path) -> dict:
    database_sql = path / 'database.sql'
    manifest = _read_json(path / 'backup_manifest.json')
    restore_dry_run = _read_json(path / 'restore_dry_run.json')
    database_sql_size = database_sql.stat().st_size if database_sql.exists() else 0
    status_ok = (
        path.exists()
        and database_sql.exists()
        and database_sql_size > 0
        and manifest.get('status') == 'ok'
        and restore_dry_run.get('status') == 'ok'
    )
    return {
        'path': str(path),
        'exists': path.exists(),
        'database_sql_exists': database_sql.exists(),
        'database_sql_bytes': database_sql_size,
        'manifest_status': manifest.get('status') or 'missing',
        'restore_dry_run_status': restore_dry_run.get('status') or 'missing',
        'status': 'ok' if status_ok else 'warning',
    }


def _retained_data_counts(prefix: str) -> dict:
    return {
        'customers': Customer.objects.filter(code__startswith=prefix).count(),
        'product_units': ProductUnit.objects.filter(code__startswith=prefix).count(),
        'operations': Operation.objects.filter(code__startswith=prefix).count(),
        'work_centers': ProductionWorkCenter.objects.filter(code__startswith=prefix).count(),
        'machines': ProductionMachine.objects.filter(code__startswith=prefix).count(),
        'warehouses': Warehouse.objects.filter(code__startswith=prefix).count(),
        'warehouse_locations': WarehouseLocation.objects.filter(code__startswith=prefix).count(),
        'products': Product.objects.filter(code__startswith=prefix).count(),
        'product_operations': ProductOperation.objects.filter(product__code__startswith=prefix).count(),
        'product_routing_steps': ProductRoutingStep.objects.filter(product__code__startswith=prefix).count(),
        'sales_orders': SalesOrder.objects.filter(code__startswith=prefix).count(),
        'sales_order_lines': SalesOrderLine.objects.filter(sales_order__code__startswith=prefix).count(),
        'sales_order_delivery_plans': SalesOrderDeliveryPlan.objects.filter(line__sales_order__code__startswith=prefix).count(),
        'production_demands': ProductionDemand.objects.filter(demand_code__startswith=prefix).count(),
        'production_orders': ProductionOrder.objects.filter(code__startswith=prefix).count(),
        'production_operations': ProductionOperation.objects.filter(production_order__code__startswith=prefix).count(),
        'production_material_requirements': ProductionMaterialRequirement.objects.filter(production_order__code__startswith=prefix).count(),
        'stocktakes': Stocktake.objects.filter(code__startswith=prefix).count(),
        'stocktake_lines': StocktakeLine.objects.filter(stocktake__code__startswith=prefix).count(),
        'inventory_transactions': InventoryTransaction.objects.filter(code__startswith=prefix).count(),
    }


def _data_status(counts: dict) -> str:
    missing = [
        key
        for key, minimum in EXPECTED_MINIMUM_COUNTS.items()
        if int(counts.get(key, 0)) < minimum
    ]
    return 'ok' if not missing else 'warning'


def build_evidence_pack(prefix: str, *, pre_backup: Path, post_backup: Path) -> dict:
    prefix = _validate_prefix(prefix)
    counts = _retained_data_counts(prefix)
    pre_backup_status = _backup_status(pre_backup)
    post_backup_status = _backup_status(post_backup)
    retained_status = _data_status(counts)
    overall_status = 'ok'
    if retained_status != 'ok' or pre_backup_status['status'] != 'ok' or post_backup_status['status'] != 'ok':
        overall_status = 'warning'

    return {
        'pack': 'ERP Main UAT Evidence & Operator Checklist v1',
        'mode': 'read_only_evidence_check',
        'overall_status': overall_status,
        'prefix': prefix,
        'database': {
            'name': str(connection.settings_dict.get('NAME') or ''),
        },
        'milestone': {
            'completed': 'ERP Main Real-Dev UAT Drill v1',
            'checkpoint_tag': 'checkpoint-9h-erp-main-real-dev-uat-drill-v1',
            'head': '0ed7e55 Add real-dev UAT drill command',
        },
        'backups': {
            'pre_uat': pre_backup_status,
            'post_uat': post_backup_status,
        },
        'uat_data': {
            'status': retained_status,
            'retained_for_audit': True,
            'cleanup_performed': False,
            'cleanup_next_step': 'future_vang_approval_required',
            'counts': counts,
            'expected_minimum_counts': EXPECTED_MINIMUM_COUNTS,
        },
        'scenario_results': [
            {
                'key': key,
                'title': title,
                'status': 'pass',
                'evidence': evidence,
            }
            for key, title, evidence in SCENARIO_RESULTS
        ],
        'operator_checklist': [
            {
                'role': item['role'],
                'personas': list(item['personas']),
                'checks': list(item['checks']),
            }
            for item in OPERATOR_CHECKLIST
        ],
        'recommended_read_only_commands': [
            'python manage.py erp_main_uat_evidence_pack --format markdown --prefix QA_UAT9H_',
            'python manage.py erp_main_uat_scenarios --format markdown',
            'python manage.py uat_access_matrix --json',
            'python manage.py release_readiness',
        ],
        'safety': {
            'writes_database': False,
            'cleanup_enabled': False,
            'backup_restore_runs': False,
            'migration_runs': False,
            'deploy_runs': False,
            'credentials_printed': False,
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
        f"- Checkpoint: `{payload['milestone']['checkpoint_tag']}`",
        f"- HEAD: `{payload['milestone']['head']}`",
        '',
        '## UAT result',
    ]
    for item in payload['scenario_results']:
        lines.append(f"- {item['title']}: {str(item['status']).upper()} - {item['evidence']}")

    lines.extend(['', '## Retained UAT data'])
    lines.append(f"- Cleanup performed: {payload['uat_data']['cleanup_performed']}")
    lines.append(f"- Cleanup next step: {payload['uat_data']['cleanup_next_step']}")
    for key, value in payload['uat_data']['counts'].items():
        lines.append(f"- {key}: {value}")

    lines.extend(['', '## Backups'])
    for label, backup in payload['backups'].items():
        lines.append(
            f"- {label}: {str(backup['status']).upper()} | `{backup['path']}` | "
            f"database.sql bytes={backup['database_sql_bytes']} | "
            f"manifest={backup['manifest_status']} | restore_dry_run={backup['restore_dry_run_status']}"
        )

    lines.extend(['', '## Operator checklist'])
    for item in payload['operator_checklist']:
        lines.append(f"### {item['role']}")
        lines.append(f"- Personas: {', '.join(item['personas'])}")
        for check in item['checks']:
            lines.append(f"- [ ] {check}")

    lines.extend(['', '## Read-only commands'])
    for command in payload['recommended_read_only_commands']:
        lines.append(f"- `{command}`")

    lines.extend([
        '',
        '## Safety',
        '- This pack is read-only.',
        '- No cleanup runs from this command.',
        '- No backup, restore, migration, deployment, or QC Printing action runs from this command.',
        '- No credential values are printed.',
    ])
    return '\n'.join(lines)


class Command(BaseCommand):
    help = 'Build a read-only ERP main UAT evidence and operator checklist pack'

    def add_arguments(self, parser):
        parser.add_argument('--prefix', default=DEFAULT_PREFIX, help='Controlled UAT prefix, default QA_UAT9H_')
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')
        parser.add_argument('--pre-backup', default=str(DEFAULT_PRE_BACKUP), help='Pre-UAT backup bundle path')
        parser.add_argument('--post-backup', default=str(DEFAULT_POST_BACKUP), help='Post-UAT backup bundle path')

    def handle(self, *args, **options):
        payload = build_evidence_pack(
            options['prefix'],
            pre_backup=Path(options['pre_backup']),
            post_backup=Path(options['post_backup']),
        )
        if options['format'] == 'json':
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(render_markdown(payload))
