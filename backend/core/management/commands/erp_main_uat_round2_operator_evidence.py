from __future__ import annotations

import json
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.management.commands.erp_main_shop_floor_handoff_real_dev_drill import (
    DEFAULT_PREFIX as SHOP_FLOOR_PREFIX,
    build_payload as build_shop_floor_handoff_payload,
)
from core.management.commands.erp_main_uat_cleanup_plan import build_cleanup_plan
from core.management.commands.erp_main_uat_round2_real_dev_drill import (
    DEFAULT_PREFIX as ROUND2_PREFIX,
    LEGACY_CLEANUP_PREFIX,
    SOURCE_GROUPS,
    build_payload as build_round2_real_dev_payload,
)
from core.management.commands.erp_main_uat_round2_scenarios import (
    CLASSIFICATION_LABELS,
    build_uat_round2_scenario_pack,
)


DEFAULT_BACKUP_PATH = r'D:\ERP-Carton-2D-snapshot-db-backups\20260601_112515'
CHECKPOINT_TAG = 'checkpoint-9s-erp-main-uat-round2-controlled-real-dev-drill-v1'
CHECKPOINT_HEAD = '63e69c1'
EXPECTED_ROUND2_ROWS = 38
SCENARIO_KEYS = (
    'product_readiness',
    'sales_snapshot_delivery_plan',
    'production_handoff',
    'planning_board_advisory',
    'shop_floor_retained_report',
    'inventory_nxt_source_breakdown',
    'ops_readiness',
)


def _validate_prefix(prefix: str) -> str:
    value = str(prefix or '').strip().upper()
    if value != ROUND2_PREFIX:
        raise CommandError('Prefix must be exactly QA_UAT2R_ for ERP main UAT Round 2 operator evidence.')
    return value


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        return {'status': 'invalid_json'}


def _backup_status(path: str) -> dict:
    bundle = Path(str(path or '').strip())
    database_sql = bundle / 'database.sql'
    manifest_path = bundle / 'backup_manifest.json'
    restore_path = bundle / 'restore_dry_run.json'
    database_size = database_sql.stat().st_size if database_sql.exists() else 0
    manifest_status = str(_read_json(manifest_path).get('status') or '') if manifest_path.exists() else ''
    restore_status = (
        str(_read_json(restore_path).get('status') or '')
        if restore_path.exists()
        else 'not_present'
    )
    errors = []
    if not bundle.exists() or not bundle.is_dir():
        errors.append('backup bundle does not exist')
    if not database_sql.exists() or database_size <= 0:
        errors.append('database.sql missing or empty')
    if not manifest_path.exists():
        errors.append('backup_manifest.json missing')
    elif manifest_status.lower() != 'ok':
        errors.append('backup_manifest.json status is not ok')
    if restore_path.exists() and restore_status.lower() != 'ok':
        errors.append('restore_dry_run.json status is not ok')
    return {
        'path': str(bundle),
        'status': 'ok' if not errors else 'warning',
        'verified': not errors,
        'checks': {
            'bundle_exists': bundle.exists() and bundle.is_dir(),
            'database_sql_exists': database_sql.exists(),
            'database_sql_size': database_size,
            'manifest_status': manifest_status,
            'restore_dry_run_status': restore_status,
        },
        'errors': errors,
    }


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


def _safe_shop_floor_report() -> dict:
    try:
        payload = build_shop_floor_handoff_payload(SHOP_FLOOR_PREFIX, backup_path='', confirm_write=False)
    except Exception as exc:
        return {
            'status': 'warning',
            'prefix': SHOP_FLOOR_PREFIX,
            'summary': f'QA_SHF1_ read-only report unavailable: {exc.__class__.__name__}',
            'counts': {},
            'scenario_results': [],
            'writes_database': False,
        }
    return {
        'status': 'pass' if payload.get('overall_status') == 'ok' else 'warning',
        'prefix': SHOP_FLOOR_PREFIX,
        'summary': f"QA_SHF1_ retained report {payload.get('overall_status', 'unknown')}",
        'counts': payload.get('existing_prefixed_counts') or {},
        'scenario_results': payload.get('scenario_results') or [],
        'writes_database': False,
    }


def _safe_cleanup_plan(prefix: str) -> dict:
    try:
        payload = build_cleanup_plan(prefix)
    except Exception as exc:
        return {
            'status': 'warning',
            'prefix': prefix,
            'summary': f'cleanup plan unavailable: {exc.__class__.__name__}',
            'candidate_total': None,
            'writes_database': False,
        }
    candidate_total = int(payload.get('candidate_summary', {}).get('total_candidate_rows') or 0)
    return {
        'status': 'ok',
        'prefix': prefix,
        'summary': f'{prefix} cleanup candidate rows: {candidate_total}',
        'candidate_total': candidate_total,
        'blocked_or_unsafe_groups': payload.get('blocked_or_unsafe_groups') or [],
        'writes_database': False,
    }


def _classification_by_domain(scenario_pack: dict) -> dict:
    result = {}
    for scenario in scenario_pack.get('scenarios') or []:
        labels = [
            CLASSIFICATION_LABELS.get(value, value)
            for value in scenario.get('classifications') or []
        ]
        result[scenario.get('domain')] = labels
    return result


def _module_evidence(round2_payload: dict, scenario_pack: dict) -> list[dict]:
    classifications = _classification_by_domain(scenario_pack)
    rows = []
    for row in round2_payload.get('scenario_report') or []:
        if row.get('key') not in SCENARIO_KEYS:
            continue
        rows.append({
            'domain': row.get('domain'),
            'key': row.get('key'),
            'status': row.get('status'),
            'writes_database': bool(row.get('writes_database')),
            'classification': classifications.get(row.get('domain'), []),
            'operator_result': _operator_result_for_row(row),
            'evidence_source': 'erp_main_uat_round2_real_dev_drill read-only existing-data report',
        })
    return rows


def _operator_result_for_row(row: dict) -> str:
    domain = row.get('domain')
    status = str(row.get('status') or '').upper()
    if domain == 'Product':
        return f'{status}: product readiness advisory evidence reviewed'
    if domain == 'Sales':
        return f'{status}: Sales snapshot and delivery plan evidence reviewed'
    if domain == 'Production':
        return f'{status}: Production demand/order handoff evidence reviewed'
    if domain == 'Planning':
        return f'{status}: PlanningBoard READY/WARNING/BLOCKER advisory evidence reviewed'
    if domain == 'Shop-floor':
        return f'{status}: QA_SHF1_ retained handoff/audit evidence reviewed'
    if domain == 'Inventory':
        groups = ', '.join(row.get('source_groups') or SOURCE_GROUPS)
        return f'{status}: NXT source groups reviewed ({groups})'
    if domain == 'Ops':
        return f'{status}: release readiness, migrations, backup, and cleanup evidence reviewed'
    return f'{status}: evidence reviewed'


def _scenario_classification(scenario_pack: dict) -> dict:
    return {
        'mock_no_db': [
            item['domain']
            for item in scenario_pack.get('scenarios') or []
            if 'mock_no_db' in item.get('classifications', [])
        ],
        'read_only_command': [
            item['domain']
            for item in scenario_pack.get('scenarios') or []
            if 'read_only_command' in item.get('classifications', [])
        ],
        'real_dev_db_gate': [
            item['domain']
            for item in scenario_pack.get('scenarios') or []
            if 'real_dev_db_gate' in item.get('classifications', [])
        ],
    }


def _source_breakdown_result(round2_payload: dict) -> dict:
    rows = {item.get('key'): item for item in round2_payload.get('scenario_report') or []}
    inventory = rows.get('inventory_nxt_source_breakdown') or {}
    groups = inventory.get('source_groups') or []
    return {
        'status': inventory.get('status') or 'missing',
        'groups': groups,
        'expected_groups': list(SOURCE_GROUPS),
        'all_groups_present': sorted(groups) == sorted(SOURCE_GROUPS),
    }


def build_operator_evidence_pack(prefix: str = ROUND2_PREFIX, *, backup_path: str = DEFAULT_BACKUP_PATH) -> dict:
    prefix = _validate_prefix(prefix)
    backup = _backup_status(backup_path)
    round2_payload = build_round2_real_dev_payload(prefix, backup_path=backup_path, confirm_write=False)
    scenario_pack = build_uat_round2_scenario_pack()
    shop_floor = _safe_shop_floor_report()
    round2_cleanup = _safe_cleanup_plan(prefix)
    legacy_cleanup = _safe_cleanup_plan(LEGACY_CLEANUP_PREFIX)
    release = _check_release_readiness()
    module_evidence = _module_evidence(round2_payload, scenario_pack)
    source_breakdown = _source_breakdown_result(round2_payload)
    round2_total = int(round2_payload.get('existing_prefixed_total') or 0)
    all_modules_pass = bool(module_evidence) and all(row['status'] == 'pass' for row in module_evidence)
    gates_ok = (
        round2_payload.get('overall_status') == 'ok'
        and all_modules_pass
        and round2_total == EXPECTED_ROUND2_ROWS
        and source_breakdown['all_groups_present']
        and backup['verified']
        and release.get('status') == 'ok'
        and legacy_cleanup.get('candidate_total') == 0
    )
    return {
        'generated_at': timezone.now(),
        'pack': 'ERP Main UAT Round 2 Operator Evidence Review v1',
        'command': 'erp_main_uat_round2_operator_evidence',
        'mode': 'read_only_operator_evidence',
        'overall_status': 'ok' if gates_ok else 'warning',
        'checkpoint': {
            'previous_tag': CHECKPOINT_TAG,
            'head': CHECKPOINT_HEAD,
        },
        'prefix': prefix,
        'evidence_backup': backup,
        'release_readiness': release,
        'round2_real_dev_report': {
            'command': 'erp_main_uat_round2_real_dev_drill',
            'overall_status': round2_payload.get('overall_status'),
            'mode': round2_payload.get('mode'),
            'writes_database': False,
            'existing_data_report': round2_payload.get('existing_data_report') or {},
            'gates': round2_payload.get('gates') or {},
        },
        'module_evidence': module_evidence,
        'source_breakdown': source_breakdown,
        'scenario_classification': _scenario_classification(scenario_pack),
        'data_retained': {
            'qa_uat2r': {
                'prefix': prefix,
                'status': 'retained_for_audit' if round2_total else 'not_present',
                'total_rows': round2_total,
                'expected_rows': EXPECTED_ROUND2_ROWS,
                'counts': round2_payload.get('existing_prefixed_counts') or {},
                'confirm_write_ran_exactly_once': True,
                'future_cleanup_requires_vang_approval': True,
            },
            'qa_shf1': {
                'prefix': SHOP_FLOOR_PREFIX,
                'status': 'retained_for_shop_floor_audit',
                'counts': shop_floor.get('counts') or {},
                'report_status': shop_floor.get('status'),
                'writes_database': False,
            },
            'qa_uat9h': {
                'prefix': LEGACY_CLEANUP_PREFIX,
                'status': 'cleaned_up_post_count_0' if legacy_cleanup.get('candidate_total') == 0 else 'warning_candidates_present',
                'candidate_total': legacy_cleanup.get('candidate_total'),
                'writes_database': False,
            },
        },
        'cleanup_guidance': {
            'qa_uat2r_cleanup_status': 'not_requested_retained_for_audit',
            'qa_uat2r_cleanup_candidate_rows': round2_cleanup.get('candidate_total'),
            'requires_future_vang_milestone': True,
            'backup_gate_required': True,
            'dry_run_gate_required': True,
            'confirm_delete_required': True,
        },
        'recommended_read_only_commands': [
            'backend/.venv/Scripts/python.exe manage.py erp_main_uat_round2_operator_evidence --format markdown',
            'backend/.venv/Scripts/python.exe manage.py erp_main_uat_round2_operator_evidence --format json',
            f'backend/.venv/Scripts/python.exe manage.py erp_main_uat_round2_real_dev_drill --prefix {prefix} --format markdown --backup-path "{backup_path}"',
            'backend/.venv/Scripts/python.exe manage.py erp_main_uat_round2_scenarios --format markdown',
            f'backend/.venv/Scripts/python.exe manage.py erp_main_shop_floor_handoff_real_dev_drill --prefix {SHOP_FLOOR_PREFIX} --format markdown',
            f'backend/.venv/Scripts/python.exe manage.py erp_main_uat_cleanup_plan --prefix {LEGACY_CLEANUP_PREFIX} --format markdown',
            'backend/.venv/Scripts/python.exe manage.py release_readiness',
        ],
        'safety': {
            'writes_database': False,
            'creates_uat_data': False,
            'confirm_write_runs': False,
            'historical_round2_confirm_write_total': 1,
            'cleanup_runs': False,
            'backup_restore_runs': False,
            'migration_runs': False,
            'deploy_runs': False,
            'direct_sql_used': False,
            'credentials_printed': False,
            'qc_printing_in_scope': False,
        },
        'next_step': 'Approve checkpoint tag for this milestone, or approve a future VANG cleanup milestone for QA_UAT2R_.',
    }


def render_markdown(payload: dict) -> str:
    data = payload['data_retained']
    lines = [
        f"# {payload['pack']}",
        '',
        f"- Status: {str(payload['overall_status']).upper()}",
        f"- Mode: {payload['mode']}",
        f"- Prefix: `{payload['prefix']}`",
        f"- Writes database: {payload['safety']['writes_database']}",
        f"- Backup: {payload['evidence_backup']['status']} ({payload['evidence_backup']['path']})",
        f"- Release readiness: {payload['release_readiness']['status']}",
        f"- QA_UAT2R_ retained rows: {data['qa_uat2r']['total_rows']}",
        f"- QA_SHF1_ retained report: {data['qa_shf1']['report_status']}",
        f"- QA_UAT9H_ cleanup candidates: {data['qa_uat9h']['candidate_total']}",
        '',
        '## Module evidence',
    ]
    for row in payload['module_evidence']:
        classifications = ', '.join(row['classification'])
        lines.append(
            f"- {row['domain']} / {row['key']}: {str(row['status']).upper()} "
            f"writes_database={row['writes_database']} classification={classifications}"
        )
        lines.append(f"  - {row['operator_result']}")

    lines.extend([
        '',
        '## Inventory NXT source breakdown',
        f"- Status: {str(payload['source_breakdown']['status']).upper()}",
        f"- Groups: {', '.join(payload['source_breakdown']['groups'])}",
        '',
        '## Data retained for audit',
        f"- QA_UAT2R_: {data['qa_uat2r']['status']} ({data['qa_uat2r']['total_rows']} rows)",
        f"- QA_SHF1_: {data['qa_shf1']['status']}",
        f"- QA_UAT9H_: {data['qa_uat9h']['status']}",
        '',
        '## Scenario classification',
    ])
    for key, domains in payload['scenario_classification'].items():
        lines.append(f"- {key}: {', '.join(domains)}")

    lines.extend([
        '',
        '## Cleanup guidance',
        '- QA_UAT2R_ remains retained for audit.',
        '- Future cleanup requires separate VANG approval, fresh verified backup, dry-run gate, and confirm-delete gate.',
        '- This command does not cleanup data.',
        '',
        '## Safety',
        '- This command is read-only and has no confirm-write option.',
        '- No DB data is created, updated, deleted, cleaned up, restored, migrated, deployed, or backed up.',
        '- No direct SQL, credentials, or QC Printing action is in scope.',
        '',
        '## Recommended read-only commands',
    ])
    lines.extend(f"- `{command}`" for command in payload['recommended_read_only_commands'])
    lines.extend(['', f"Next step: {payload['next_step']}"])
    return '\n'.join(lines)


def render_json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=True, indent=2, default=str)


class Command(BaseCommand):
    help = 'Build a read-only operator evidence report for ERP main UAT Round 2'

    def add_arguments(self, parser):
        parser.add_argument('--prefix', default=ROUND2_PREFIX, help='Must be exactly QA_UAT2R_')
        parser.add_argument('--backup-path', default=DEFAULT_BACKUP_PATH, help='Verified post-UAT backup bundle path')
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')

    def handle(self, *args, **options):
        payload = build_operator_evidence_pack(
            options.get('prefix') or '',
            backup_path=options.get('backup_path') or '',
        )
        if options['format'] == 'json':
            self.stdout.write(render_json(payload))
        else:
            self.stdout.write(render_markdown(payload))
