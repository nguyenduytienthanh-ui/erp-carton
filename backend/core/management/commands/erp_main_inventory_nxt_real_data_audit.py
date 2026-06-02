from __future__ import annotations

import json
from collections import Counter, defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.utils import timezone

from core.management.commands.erp_main_uat_round2_real_dev_drill import (
    DEFAULT_PREFIX,
    PLANNED_DATA_COUNTS,
    SOURCE_GROUPS,
    _prefixed_counts,
    _total_count,
)
from inventory.models import InventoryTransaction, InventoryTransactionStatus, InventoryTransactionType, Warehouse
from inventory.serializers import build_inventory_source_audit
from inventory.views import (
    NXT_SOURCE_TYPES,
    _empty_nxt_source_breakdown,
    _flatten_nxt_source_counter,
    _normalize_nxt_source_audit,
    _serialize_nxt_source_breakdown,
)
from products.models import Product


EXPECTED_INVENTORY_TRANSACTIONS = PLANNED_DATA_COUNTS['inventory_transactions']
EXPECTED_ROUND2_ROWS = sum(PLANNED_DATA_COUNTS.values())


def _validate_prefix(prefix: str) -> str:
    value = str(prefix or '').strip().upper()
    if value != DEFAULT_PREFIX:
        raise CommandError('Prefix must be exactly QA_UAT2R_ for Inventory NXT real-data audit.')
    return value


def _decimal(value) -> Decimal:
    return Decimal(str(value or '0'))


def _decimal_str(value) -> str:
    value = _decimal(value)
    if value == value.to_integral_value():
        return str(value.quantize(Decimal('1')))
    return format(value.normalize(), 'f')


def _prefixed_transactions(prefix: str) -> list[InventoryTransaction]:
    return list(
        InventoryTransaction.objects.filter(code__startswith=prefix)
        .select_related(
            'product',
            'warehouse',
            'target_warehouse',
            'purchase_order',
            'purchase_receipt',
            'production_order',
            'production_issue',
            'production_receipt',
            'stocktake',
            'reservation',
            'shipment_batch',
            'sales_order',
        )
        .order_by('transaction_date', 'code', 'id')
    )


def _movement_targets(tx: InventoryTransaction) -> list[dict]:
    if tx.transaction_type in {InventoryTransactionType.RECEIPT, InventoryTransactionType.ADJUSTMENT_IN}:
        return [{'direction': 'in', 'warehouse_id': tx.warehouse_id, 'warehouse_code': getattr(tx.warehouse, 'code', '')}]
    if tx.transaction_type in {InventoryTransactionType.ISSUE, InventoryTransactionType.ADJUSTMENT_OUT}:
        return [{'direction': 'out', 'warehouse_id': tx.warehouse_id, 'warehouse_code': getattr(tx.warehouse, 'code', '')}]
    if tx.transaction_type == InventoryTransactionType.TRANSFER:
        return [
            {'direction': 'out', 'warehouse_id': tx.warehouse_id, 'warehouse_code': getattr(tx.warehouse, 'code', '')},
            {'direction': 'in', 'warehouse_id': tx.target_warehouse_id, 'warehouse_code': getattr(tx.target_warehouse, 'code', '')},
        ]
    return []


def _transaction_audit_rows(transactions: list[InventoryTransaction]) -> list[dict]:
    rows = []
    for tx in transactions:
        audit = build_inventory_source_audit(tx)
        normalized = _normalize_nxt_source_audit(tx)
        rows.append({
            'code': tx.code,
            'transaction_type': tx.transaction_type,
            'status': tx.status,
            'transaction_date': str(tx.transaction_date),
            'product_code': getattr(tx.product, 'code', ''),
            'quantity': _decimal_str(tx.quantity),
            'raw_source_type': audit.get('type'),
            'nxt_source_type': normalized.get('type'),
            'document_type': normalized.get('document_type'),
            'source_code': normalized.get('code') or '',
            'reference': normalized.get('reference') or '',
            'warning_flags': list(normalized.get('warning_flags') or []),
            'movements': _movement_targets(tx),
            'source_audit_status': 'pass' if normalized.get('type') in NXT_SOURCE_TYPES else 'warning',
        })
    return rows


def _derive_scope(transactions: list[InventoryTransaction]) -> dict:
    if not transactions:
        return {
            'status': 'warning',
            'date_from': '',
            'date_to': '',
            'product_ids': [],
            'warehouse_ids': [],
            'summary': 'No QA_UAT2R_ inventory transactions found.',
        }

    dates = [tx.transaction_date for tx in transactions if tx.transaction_date]
    product_ids = sorted({tx.product_id for tx in transactions if tx.product_id})
    warehouse_ids = sorted({
        warehouse_id
        for tx in transactions
        for warehouse_id in (tx.warehouse_id, tx.target_warehouse_id)
        if warehouse_id
    })
    if not dates or not product_ids or not warehouse_ids:
        return {
            'status': 'warning',
            'date_from': str(min(dates)) if dates else '',
            'date_to': str(max(dates)) if dates else '',
            'product_ids': product_ids,
            'warehouse_ids': warehouse_ids,
            'summary': 'Cannot safely derive date/product/warehouse scope from QA_UAT2R_ transactions.',
        }
    return {
        'status': 'ok',
        'date_from': str(min(dates)),
        'date_to': str(max(dates)),
        'product_ids': product_ids,
        'warehouse_ids': warehouse_ids,
        'summary': 'Scope derived from retained QA_UAT2R_ inventory transactions.',
    }


def _add_source_movement(period_source_breakdown, tx, movement_warehouse_id, direction):
    audit = _normalize_nxt_source_audit(tx)
    source_type = audit.get('type') or 'MANUAL'
    bucket = period_source_breakdown[(tx.product_id, movement_warehouse_id)][source_type]
    qty = tx.quantity or Decimal('0')
    if direction == 'in':
        bucket['in_qty'] += qty
    else:
        bucket['out_qty'] += qty
    bucket['count'] += 1
    document_type = audit.get('document_type')
    if document_type:
        bucket['source_document_types'][document_type] += 1
    for warning in audit.get('warning_flags') or []:
        bucket['source_warnings'][warning] += 1


def _build_nxt_rows(scope: dict) -> list[dict]:
    if scope['status'] != 'ok':
        return []
    date_from = timezone.datetime.strptime(scope['date_from'], '%Y-%m-%d').date()
    date_to = timezone.datetime.strptime(scope['date_to'], '%Y-%m-%d').date()
    product_ids = scope['product_ids']
    warehouse_ids = scope['warehouse_ids']

    base = InventoryTransaction.objects.filter(
        status=InventoryTransactionStatus.POSTED,
        product_id__in=product_ids,
        transaction_date__lte=date_to,
    ).filter(Q(warehouse_id__in=warehouse_ids) | Q(target_warehouse_id__in=warehouse_ids))

    opening_in = defaultdict(Decimal)
    opening_out = defaultdict(Decimal)
    period_in = defaultdict(Decimal)
    period_out = defaultdict(Decimal)
    period_source_breakdown = defaultdict(_empty_nxt_source_breakdown)

    def add_movement(bucket, tx, movement_warehouse_id, source_direction=None):
        if not movement_warehouse_id or movement_warehouse_id not in warehouse_ids:
            return
        bucket[(tx.product_id, movement_warehouse_id)] += tx.quantity or Decimal('0')
        if source_direction:
            _add_source_movement(period_source_breakdown, tx, movement_warehouse_id, source_direction)

    for tx in base.select_related(
        'purchase_order',
        'purchase_receipt',
        'production_order',
        'production_issue',
        'production_receipt',
        'stocktake',
        'reservation',
        'shipment_batch',
        'sales_order',
    ):
        if tx.transaction_date < date_from:
            in_bucket = opening_in
            out_bucket = opening_out
            in_source_direction = None
            out_source_direction = None
        elif date_from <= tx.transaction_date <= date_to:
            in_bucket = period_in
            out_bucket = period_out
            in_source_direction = 'in'
            out_source_direction = 'out'
        else:
            continue

        if tx.transaction_type in {InventoryTransactionType.RECEIPT, InventoryTransactionType.ADJUSTMENT_IN}:
            add_movement(in_bucket, tx, tx.warehouse_id, in_source_direction)
        elif tx.transaction_type in {InventoryTransactionType.ISSUE, InventoryTransactionType.ADJUSTMENT_OUT}:
            add_movement(out_bucket, tx, tx.warehouse_id, out_source_direction)
        elif tx.transaction_type == InventoryTransactionType.TRANSFER:
            add_movement(out_bucket, tx, tx.warehouse_id, out_source_direction)
            add_movement(in_bucket, tx, tx.target_warehouse_id, in_source_direction)

    keys = set(opening_in) | set(opening_out) | set(period_in) | set(period_out)
    products = {p.id: (p.code or '', p.name or '') for p in Product.objects.filter(id__in=product_ids).only('id', 'code', 'name')}
    warehouses = {w.id: (w.code or '', w.name or '') for w in Warehouse.objects.filter(id__in=warehouse_ids).only('id', 'code', 'name')}
    rows = []
    for pid, wid in sorted(keys):
        opening = opening_in.get((pid, wid), Decimal('0')) - opening_out.get((pid, wid), Decimal('0'))
        in_qty = period_in.get((pid, wid), Decimal('0'))
        out_qty = period_out.get((pid, wid), Decimal('0'))
        closing = opening + in_qty - out_qty
        product_code, product_name = products.get(pid, ('', ''))
        warehouse_code, warehouse_name = warehouses.get(wid, ('', ''))
        source_breakdown = period_source_breakdown.get((pid, wid), {})
        rows.append({
            'product_id': pid,
            'product_code': product_code,
            'product_name': product_name,
            'warehouse_id': wid,
            'warehouse_code': warehouse_code,
            'warehouse_name': warehouse_name,
            'opening_qty': str(opening),
            'in_qty': str(in_qty),
            'out_qty': str(out_qty),
            'closing_qty': str(closing),
            'source_breakdown': _serialize_nxt_source_breakdown(source_breakdown),
            'source_document_types': _flatten_nxt_source_counter(source_breakdown, 'source_document_types'),
            'source_warnings': _flatten_nxt_source_counter(source_breakdown, 'source_warnings'),
        })
    return rows


def _source_results(nxt_rows: list[dict], transaction_audit: list[dict]) -> dict:
    transaction_codes = defaultdict(list)
    for row in transaction_audit:
        transaction_codes[row['nxt_source_type']].append(row['code'])

    results = {}
    for source_type in SOURCE_GROUPS:
        in_qty = Decimal('0')
        out_qty = Decimal('0')
        count = 0
        document_types = Counter()
        warnings = Counter()
        for row in nxt_rows:
            item = row['source_breakdown'].get(source_type) or {}
            in_qty += _decimal(item.get('in_qty'))
            out_qty += _decimal(item.get('out_qty'))
            count += int(item.get('count') or 0)
            document_types.update(item.get('source_document_types') or {})
            warnings.update(item.get('source_warnings') or {})
        results[source_type] = {
            'status': 'pass' if count > 0 else 'warning',
            'in_qty': _decimal_str(in_qty),
            'out_qty': _decimal_str(out_qty),
            'net_qty': _decimal_str(in_qty - out_qty),
            'movement_count': count,
            'transaction_codes': transaction_codes.get(source_type, []),
            'source_document_types': dict(document_types),
            'source_warnings': dict(warnings),
        }
    return results


def _totals_reconciliation(nxt_rows: list[dict]) -> dict:
    row_checks = []
    total_opening = Decimal('0')
    total_in = Decimal('0')
    total_out = Decimal('0')
    total_closing = Decimal('0')
    total_source_in = Decimal('0')
    total_source_out = Decimal('0')

    for row in nxt_rows:
        opening = _decimal(row['opening_qty'])
        in_qty = _decimal(row['in_qty'])
        out_qty = _decimal(row['out_qty'])
        closing = _decimal(row['closing_qty'])
        source_in = sum(_decimal(item.get('in_qty')) for item in row['source_breakdown'].values())
        source_out = sum(_decimal(item.get('out_qty')) for item in row['source_breakdown'].values())
        row_checks.append({
            'product_code': row['product_code'],
            'warehouse_code': row['warehouse_code'],
            'opening_qty': _decimal_str(opening),
            'in_qty': _decimal_str(in_qty),
            'out_qty': _decimal_str(out_qty),
            'closing_qty': _decimal_str(closing),
            'source_in_qty': _decimal_str(source_in),
            'source_out_qty': _decimal_str(source_out),
            'source_in_matches_total': source_in == in_qty,
            'source_out_matches_total': source_out == out_qty,
            'closing_matches_formula': closing == opening + in_qty - out_qty,
        })
        total_opening += opening
        total_in += in_qty
        total_out += out_qty
        total_closing += closing
        total_source_in += source_in
        total_source_out += source_out

    return {
        'status': 'pass' if row_checks and all(
            item['source_in_matches_total']
            and item['source_out_matches_total']
            and item['closing_matches_formula']
            for item in row_checks
        ) else 'warning',
        'opening_qty': _decimal_str(total_opening),
        'in_qty': _decimal_str(total_in),
        'out_qty': _decimal_str(total_out),
        'closing_qty': _decimal_str(total_closing),
        'source_in_qty': _decimal_str(total_source_in),
        'source_out_qty': _decimal_str(total_source_out),
        'source_in_matches_total': total_source_in == total_in,
        'source_out_matches_total': total_source_out == total_out,
        'net_qty': _decimal_str(total_in - total_out),
        'row_checks': row_checks,
    }


def _report_warnings(source_results: dict, scope: dict, transaction_audit: list[dict], total_rows: int) -> list[str]:
    warnings = []
    if total_rows != EXPECTED_ROUND2_ROWS:
        warnings.append(f'QA_UAT2R_ scoped row count is {total_rows}; expected {EXPECTED_ROUND2_ROWS}.')
    if scope['status'] != 'ok':
        warnings.append(scope['summary'])
    for source_type, result in source_results.items():
        if result['status'] != 'pass':
            warnings.append(f'{source_type} source group is missing from NXT rows.')
    source_warning_flags = sorted({
        warning
        for row in transaction_audit
        for warning in row.get('warning_flags') or []
    })
    for warning in source_warning_flags:
        warnings.append(f'Source warning present: {warning}.')
    return warnings


def build_nxt_real_data_audit_pack(prefix: str = DEFAULT_PREFIX) -> dict:
    prefix = _validate_prefix(prefix)
    counts = _prefixed_counts(prefix)
    total_rows = _total_count(counts)
    transactions = _prefixed_transactions(prefix)
    scope = _derive_scope(transactions)
    transaction_audit = _transaction_audit_rows(transactions)
    nxt_rows = _build_nxt_rows(scope)
    source_results = _source_results(nxt_rows, transaction_audit)
    totals = _totals_reconciliation(nxt_rows)
    warnings = _report_warnings(source_results, scope, transaction_audit, total_rows)
    all_sources_pass = all(result['status'] == 'pass' for result in source_results.values())
    data_ok = total_rows == EXPECTED_ROUND2_ROWS and len(transactions) == EXPECTED_INVENTORY_TRANSACTIONS
    overall_ok = data_ok and scope['status'] == 'ok' and all_sources_pass and totals['status'] == 'pass'
    return {
        'generated_at': timezone.now(),
        'pack': 'Inventory NXT Real-Data Audit Drill v1',
        'command': 'erp_main_inventory_nxt_real_data_audit',
        'mode': 'read_only_nxt_real_data_audit',
        'overall_status': 'ok' if overall_ok else 'warning',
        'prefix': prefix,
        'data_status': {
            'status': 'retained_for_audit' if total_rows else 'not_present',
            'round2_scoped_rows': total_rows,
            'expected_round2_rows': EXPECTED_ROUND2_ROWS,
            'inventory_transactions': len(transactions),
            'expected_inventory_transactions': EXPECTED_INVENTORY_TRANSACTIONS,
            'counts': counts,
        },
        'scope': scope,
        'transaction_audit': transaction_audit,
        'nxt_rows': nxt_rows,
        'source_results': source_results,
        'totals_reconciliation': totals,
        'warnings': warnings,
        'cleanup_note': 'QA_UAT2R_ is retained; this command does not cleanup data.',
        'safety': {
            'writes_database': False,
            'creates_uat_data': False,
            'cleanup_runs': False,
            'confirm_write_available': False,
            'confirm_delete_available': False,
            'backup_created': False,
            'restore_runs': False,
            'migration_runs': False,
            'deploy_runs': False,
            'direct_sql_used': False,
            'credentials_printed': False,
            'qc_printing_in_scope': False,
        },
        'next_step': 'Review report, then approve checkpoint tag or frontend/CSV evidence sync if needed.',
    }


def render_markdown(payload: dict) -> str:
    lines = [
        f"# {payload['pack']}",
        '',
        f"- Status: {str(payload['overall_status']).upper()}",
        f"- Mode: {payload['mode']}",
        f"- Prefix: `{payload['prefix']}`",
        f"- Writes database: {payload['safety']['writes_database']}",
        f"- Round 2 scoped rows: {payload['data_status']['round2_scoped_rows']}",
        f"- Inventory transactions: {payload['data_status']['inventory_transactions']}",
        f"- Date range: {payload['scope']['date_from']} - {payload['scope']['date_to']}",
        f"- Cleanup note: {payload['cleanup_note']}",
        '',
        '## Source group result',
    ]
    for source_type in SOURCE_GROUPS:
        result = payload['source_results'][source_type]
        lines.append(
            f"- {source_type}: {str(result['status']).upper()} "
            f"in={result['in_qty']} out={result['out_qty']} net={result['net_qty']} "
            f"movements={result['movement_count']}"
        )
        if result['source_document_types']:
            lines.append(f"  - Documents: {json.dumps(result['source_document_types'], ensure_ascii=True, sort_keys=True)}")
        if result['source_warnings']:
            lines.append(f"  - Warnings: {json.dumps(result['source_warnings'], ensure_ascii=True, sort_keys=True)}")

    totals = payload['totals_reconciliation']
    lines.extend([
        '',
        '## Totals reconciliation',
        f"- Status: {str(totals['status']).upper()}",
        f"- opening={totals['opening_qty']} in={totals['in_qty']} out={totals['out_qty']} closing={totals['closing_qty']}",
        f"- source_in={totals['source_in_qty']} source_out={totals['source_out_qty']}",
        f"- source in matches total: {totals['source_in_matches_total']}",
        f"- source out matches total: {totals['source_out_matches_total']}",
        '',
        '## Warnings',
    ])
    if payload['warnings']:
        lines.extend(f"- {item}" for item in payload['warnings'])
    else:
        lines.append('- none')

    lines.extend([
        '',
        '## Safety',
        '- This command is read-only and has no confirm-write or confirm-delete option.',
        '- It does not create, update, delete, cleanup, backup, restore, migrate, deploy, use direct SQL, print credentials, or touch QC Printing.',
        '',
        f"Next step: {payload['next_step']}",
    ])
    return '\n'.join(lines)


def render_json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=True, indent=2, default=str)


class Command(BaseCommand):
    help = 'Build a read-only Inventory NXT real-data audit report for retained QA_UAT2R_ data'

    def add_arguments(self, parser):
        parser.add_argument('--prefix', default=DEFAULT_PREFIX, help='Must be exactly QA_UAT2R_')
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')

    def handle(self, *args, **options):
        payload = build_nxt_real_data_audit_pack(options.get('prefix') or '')
        if options['format'] == 'json':
            self.stdout.write(render_json(payload))
        else:
            self.stdout.write(render_markdown(payload))
