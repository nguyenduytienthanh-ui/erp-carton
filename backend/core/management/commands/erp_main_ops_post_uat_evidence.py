from __future__ import annotations

import json
import subprocess
from io import StringIO
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.management.commands.erp_main_inventory_nxt_real_data_audit import build_nxt_real_data_audit_pack
from core.management.commands.erp_main_shop_floor_handoff_real_dev_drill import (
    DEFAULT_PREFIX as SHOP_FLOOR_PREFIX,
)
from core.management.commands.erp_main_uat_round2_cleanup_decision import build_cleanup_decision_pack
from core.management.commands.erp_main_uat_round2_operator_evidence import (
    DEFAULT_BACKUP_PATH,
    EXPECTED_ROUND2_ROWS,
    build_operator_evidence_pack,
)
from core.management.commands.erp_main_uat_round2_real_dev_drill import (
    DEFAULT_PREFIX as ROUND2_PREFIX,
    LEGACY_CLEANUP_PREFIX,
)
from core.release_readiness import get_alert_readiness_payload, get_pending_migration_summary


MILESTONE = 'Ops Release Readiness Post-UAT Evidence v1'
COMMAND_NAME = 'erp_main_ops_post_uat_evidence'
LATEST_CHECKPOINT_TAG = 'checkpoint-9v-inventory-nxt-real-data-audit-drill-v1'
LATEST_CHECKPOINT_HEAD = '85e4784'
SOURCE_GROUPS = ('PURCHASE', 'PRODUCTION', 'STOCKTAKE', 'TRANSFER', 'MANUAL')
MODULES = ('Product', 'Sales', 'Production', 'Planning', 'Shop-floor', 'Inventory', 'Ops')


def _repo_root() -> Path:
    return Path(settings.BASE_DIR).resolve().parent


def _run_git(args: list[str], repo_root: Path) -> str:
    try:
        result = subprocess.run(
            ['git', *args],
            cwd=repo_root,
            check=False,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ''
    if result.returncode != 0:
        return ''
    return result.stdout.strip()


def _ahead_behind(status_line: str) -> dict:
    ahead = 0
    behind = 0
    marker = status_line.split('[', 1)[1].split(']', 1)[0] if '[' in status_line and ']' in status_line else ''
    for chunk in marker.split(','):
        parts = chunk.strip().split()
        if len(parts) == 2 and parts[0] == 'ahead':
            ahead = int(parts[1])
        if len(parts) == 2 and parts[0] == 'behind':
            behind = int(parts[1])
    return {'ahead': ahead, 'behind': behind}


def _git_evidence(repo_root: Path | None = None) -> dict:
    root = repo_root or _repo_root()
    status_output = _run_git(['status', '--short', '--branch'], root)
    status_lines = [line for line in status_output.splitlines() if line.strip()]
    status_line = status_lines[0] if status_lines else ''
    dirty_files = [line for line in status_lines[1:] if line.strip()]
    tags_at_head = [
        tag for tag in _run_git(['tag', '--points-at', 'HEAD'], root).splitlines()
        if tag.strip()
    ]
    checkpoint_tags = [tag for tag in tags_at_head if tag.startswith('checkpoint-9')]
    sync = _ahead_behind(status_line)
    return {
        'repo_root': str(root),
        'branch': _run_git(['rev-parse', '--abbrev-ref', 'HEAD'], root),
        'head': _run_git(['rev-parse', '--short', 'HEAD'], root),
        'head_message': _run_git(['log', '-1', '--oneline'], root),
        'status_line': status_line,
        'clean': not dirty_files,
        'dirty_files': dirty_files,
        'ahead': sync['ahead'],
        'behind': sync['behind'],
        'synced_with_origin': sync['ahead'] == 0 and sync['behind'] == 0,
        'tags_at_head': tags_at_head,
        'latest_checkpoint_tag': checkpoint_tags[0] if checkpoint_tags else '',
        'expected_checkpoint_tag': LATEST_CHECKPOINT_TAG,
        'expected_checkpoint_head': LATEST_CHECKPOINT_HEAD,
    }


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        return {'status': 'invalid_json'}


def _backup_evidence(path: str = DEFAULT_BACKUP_PATH) -> dict:
    bundle = Path(str(path or '').strip())
    database_sql = bundle / 'database.sql'
    manifest_path = bundle / 'backup_manifest.json'
    restore_path = bundle / 'restore_dry_run.json'
    database_size = database_sql.stat().st_size if database_sql.exists() else 0
    manifest = _read_json(manifest_path)
    restore = _read_json(restore_path)
    manifest_status = str(manifest.get('status') or '')
    restore_status = str(restore.get('status') or ('not_present' if not restore_path.exists() else ''))
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
        'database_sql': {
            'exists': database_sql.exists(),
            'size': database_size,
        },
        'manifest_status': manifest_status,
        'restore_dry_run_status': restore_status,
        'errors': errors,
        'safety': {
            'backup_created': False,
            'restore_runs': False,
        },
    }


def _migration_evidence() -> dict:
    summary = get_pending_migration_summary()
    pending_count = int(summary.get('pending_count') or 0)
    return {
        'status': 'ok' if pending_count == 0 else 'warning',
        'pending_count': pending_count,
        'apps': summary.get('apps') or [],
        'items': summary.get('items') or [],
        'migration_runs': False,
    }


def _safe_release_readiness() -> dict:
    stdout = StringIO()
    try:
        call_command('release_readiness', stdout=stdout)
    except Exception as exc:
        return {
            'status': 'error',
            'summary': f'release_readiness failed: {exc.__class__.__name__}',
            'checks': {},
        }
    lines = [line.strip() for line in stdout.getvalue().splitlines() if line.strip()]
    first_line = lines[0] if lines else 'Release readiness: UNKNOWN'
    status = first_line.split(':', 1)[1].strip().lower() if ':' in first_line else 'warning'
    checks = {}
    for line in lines[1:]:
        if line.startswith('- ') and ':' in line:
            key, value = line[2:].split(':', 1)
            checks[key.strip().replace(' ', '_')] = value.strip()
    return {
        'status': status,
        'summary': first_line,
        'checks': checks,
    }


def _safe_alert_readiness() -> dict:
    try:
        payload = get_alert_readiness_payload(hours=24)
    except Exception as exc:
        return {
            'status': 'error',
            'summary': f'alert_channel_readiness failed: {exc.__class__.__name__}',
            'configured_count': 0,
            'delivery_status': 'error',
            'email_delivery_status': 'error',
            'warning_count': 1,
        }
    return {
        'status': payload.get('overall_status') or 'warning',
        'summary': f"Alert channel readiness: {str(payload.get('overall_status') or 'warning').upper()}",
        'configured_count': payload.get('config', {}).get('configured_count'),
        'delivery_status': payload.get('delivery', {}).get('status'),
        'email_delivery_status': payload.get('email_delivery', {}).get('status'),
        'warning_count': len(payload.get('warnings') or []),
    }


def _safe_operator_evidence(backup_path: str) -> dict:
    try:
        payload = build_operator_evidence_pack(ROUND2_PREFIX, backup_path=backup_path)
    except Exception as exc:
        return {
            'status': 'warning',
            'summary': f'operator evidence unavailable: {exc.__class__.__name__}',
            'module_evidence': [],
            'data_retained': {},
            'source_breakdown': {},
            'safety': {'writes_database': False},
        }
    module_statuses = {
        row.get('domain'): row.get('status')
        for row in payload.get('module_evidence') or []
    }
    return {
        'status': payload.get('overall_status') or 'warning',
        'summary': f"operator evidence {payload.get('overall_status') or 'warning'}",
        'module_evidence': payload.get('module_evidence') or [],
        'module_statuses': module_statuses,
        'data_retained': payload.get('data_retained') or {},
        'source_breakdown': payload.get('source_breakdown') or {},
        'safety': payload.get('safety') or {'writes_database': False},
    }


def _safe_nxt_real_data_audit() -> dict:
    try:
        payload = build_nxt_real_data_audit_pack(ROUND2_PREFIX)
    except Exception as exc:
        return {
            'status': 'warning',
            'summary': f'NXT real-data audit unavailable: {exc.__class__.__name__}',
            'source_results': {},
            'totals_reconciliation': {},
            'safety': {'writes_database': False},
        }
    source_results = {
        source: (payload.get('source_results') or {}).get(source, {}).get('status')
        for source in SOURCE_GROUPS
    }
    return {
        'status': payload.get('overall_status') or 'warning',
        'summary': f"NXT real-data audit {payload.get('overall_status') or 'warning'}",
        'data_status': payload.get('data_status') or {},
        'source_results': source_results,
        'totals_reconciliation': payload.get('totals_reconciliation') or {},
        'safety': payload.get('safety') or {'writes_database': False},
    }


def _safe_cleanup_decision(backup_path: str) -> dict:
    try:
        payload = build_cleanup_decision_pack(ROUND2_PREFIX, backup_path=backup_path)
    except Exception as exc:
        return {
            'status': 'warning',
            'summary': f'cleanup decision unavailable: {exc.__class__.__name__}',
            'cleanup_decision': {'recommended_decision': 'hold_cleanup'},
            'data_status': {},
            'safety': {'writes_database': False},
        }
    decision = payload.get('cleanup_decision') or {}
    return {
        'status': payload.get('overall_status') or 'warning',
        'summary': f"cleanup decision {decision.get('recommended_decision') or 'unknown'}",
        'cleanup_decision': decision,
        'data_status': payload.get('data_status') or {},
        'future_cleanup_gate': payload.get('future_cleanup_gate') or {},
        'safety': payload.get('safety') or {'writes_database': False},
    }


def _data_status(operator: dict, cleanup: dict, nxt: dict) -> dict:
    retained = operator.get('data_retained') or {}
    cleanup_data = cleanup.get('data_status') or {}
    qa_uat2r = retained.get('qa_uat2r') or cleanup_data.get('qa_uat2r') or {}
    qa_shf1 = retained.get('qa_shf1') or cleanup_data.get('qa_shf1') or {}
    qa_uat9h = retained.get('qa_uat9h') or cleanup_data.get('qa_uat9h') or {}
    return {
        'qa_uat2r': {
            'prefix': ROUND2_PREFIX,
            'status': qa_uat2r.get('status') or 'unknown',
            'total_rows': int(qa_uat2r.get('total_rows') or nxt.get('data_status', {}).get('round2_scoped_rows') or 0),
            'expected_rows': EXPECTED_ROUND2_ROWS,
            'cleanup_status': 'deferred_future_vang',
        },
        'qa_shf1': {
            'prefix': SHOP_FLOOR_PREFIX,
            'status': qa_shf1.get('status') or 'retained_for_shop_floor_audit',
            'cleanup_round2_scope': bool(qa_shf1.get('cleanup_round2_scope', False)),
        },
        'qa_uat9h': {
            'prefix': LEGACY_CLEANUP_PREFIX,
            'status': qa_uat9h.get('status') or 'cleaned_up_post_count_0',
            'candidate_total': int(qa_uat9h.get('candidate_total') or qa_uat9h.get('cleanup_plan_candidate_rows') or 0),
        },
    }


def _release_checklist(git: dict, migrations: dict, release: dict, alert: dict, backup: dict, data: dict) -> list[dict]:
    return [
        {
            'key': 'repo_clean_synced',
            'status': 'pass' if git.get('clean') and git.get('synced_with_origin') else 'warning',
            'evidence': f"{git.get('branch')} {git.get('head')} clean={git.get('clean')} ahead={git.get('ahead')} behind={git.get('behind')}",
        },
        {
            'key': 'no_pending_migrations',
            'status': 'pass' if migrations.get('pending_count') == 0 else 'warning',
            'evidence': f"pending_count={migrations.get('pending_count')}",
        },
        {
            'key': 'release_readiness',
            'status': 'pass' if release.get('status') == 'ok' else 'warning',
            'evidence': release.get('summary'),
        },
        {
            'key': 'alert_delivery',
            'status': 'pass' if alert.get('status') == 'ok' else 'warning',
            'evidence': f"delivery={alert.get('delivery_status')} email={alert.get('email_delivery_status')}",
        },
        {
            'key': 'post_uat_backup_verified',
            'status': 'pass' if backup.get('verified') else 'warning',
            'evidence': f"database.sql size={backup.get('database_sql', {}).get('size')} manifest={backup.get('manifest_status')} restore={backup.get('restore_dry_run_status')}",
        },
        {
            'key': 'audit_data_retained',
            'status': 'pass' if data['qa_uat2r']['total_rows'] == EXPECTED_ROUND2_ROWS else 'warning',
            'evidence': f"QA_UAT2R_ rows={data['qa_uat2r']['total_rows']} QA_SHF1_ status={data['qa_shf1']['status']}",
        },
        {
            'key': 'cleanup_deferred',
            'status': 'pass',
            'evidence': 'QA_UAT2R_ cleanup is deferred and requires a separate VANG approval.',
        },
        {
            'key': 'real_deploy_gate',
            'status': 'planned',
            'evidence': 'Before real deploy: fresh backup, restore drill, release_readiness OK, operator sign-off, rollback/stop plan.',
        },
    ]


def _all_statuses_ok(*items: dict) -> bool:
    return all(str(item.get('status') or '').lower() == 'ok' for item in items)


def build_ops_post_uat_evidence_pack(*, backup_path: str = DEFAULT_BACKUP_PATH, repo_root: Path | None = None) -> dict:
    git = _git_evidence(repo_root)
    migrations = _migration_evidence()
    release = _safe_release_readiness()
    alert = _safe_alert_readiness()
    backup = _backup_evidence(backup_path)
    operator = _safe_operator_evidence(backup_path)
    nxt = _safe_nxt_real_data_audit()
    cleanup = _safe_cleanup_decision(backup_path)
    data = _data_status(operator, cleanup, nxt)
    checklist = _release_checklist(git, migrations, release, alert, backup, data)
    module_statuses = operator.get('module_statuses') or {}
    source_results = nxt.get('source_results') or {}
    modules_pass = all(module_statuses.get(module) == 'pass' for module in MODULES)
    sources_pass = all(source_results.get(source) == 'pass' for source in SOURCE_GROUPS)
    totals = nxt.get('totals_reconciliation') or {}
    totals_pass = totals.get('status') == 'pass'
    checklist_pass = all(item['status'] in {'pass', 'planned'} for item in checklist)
    evidence_ok = (
        git.get('clean')
        and git.get('synced_with_origin')
        and migrations.get('pending_count') == 0
        and _all_statuses_ok(release, alert, backup, operator, nxt, cleanup)
        and data['qa_uat2r']['total_rows'] == EXPECTED_ROUND2_ROWS
        and data['qa_uat9h']['candidate_total'] == 0
        and modules_pass
        and sources_pass
        and totals_pass
        and checklist_pass
    )
    return {
        'generated_at': timezone.now(),
        'pack': MILESTONE,
        'command': COMMAND_NAME,
        'mode': 'read_only_ops_post_uat_evidence',
        'overall_status': 'ok' if evidence_ok else 'warning',
        'git': git,
        'migrations': migrations,
        'release_readiness': release,
        'alert_channel_readiness': alert,
        'backup_evidence': backup,
        'operator_evidence': {
            'status': operator.get('status'),
            'module_statuses': module_statuses,
            'source_breakdown': operator.get('source_breakdown') or {},
        },
        'nxt_real_data_audit': {
            'status': nxt.get('status'),
            'source_results': source_results,
            'totals_reconciliation': {
                'status': totals.get('status'),
                'source_in_matches_total': totals.get('source_in_matches_total'),
                'source_out_matches_total': totals.get('source_out_matches_total'),
                'net_qty': totals.get('net_qty'),
            },
        },
        'cleanup_decision': {
            'status': cleanup.get('status'),
            'recommended_decision': cleanup.get('cleanup_decision', {}).get('recommended_decision'),
            'requires_future_vang': True,
        },
        'data_status': data,
        'release_checklist': checklist,
        'evidence_commands': [
            'backend/.venv/Scripts/python.exe manage.py erp_main_ops_post_uat_evidence --format markdown',
            'backend/.venv/Scripts/python.exe manage.py erp_main_ops_post_uat_evidence --format json',
            'backend/.venv/Scripts/python.exe manage.py release_readiness',
            'backend/.venv/Scripts/python.exe manage.py alert_channel_readiness',
            'backend/.venv/Scripts/python.exe manage.py erp_main_uat_round2_operator_evidence --format markdown',
            'backend/.venv/Scripts/python.exe manage.py erp_main_inventory_nxt_real_data_audit --prefix QA_UAT2R_ --format markdown',
            'backend/.venv/Scripts/python.exe manage.py erp_main_uat_round2_cleanup_decision --format markdown',
        ],
        'deploy_release_gate': {
            'real_deploy_not_run': True,
            'fresh_backup_required_before_real_deploy': True,
            'restore_dry_run_required': True,
            'release_readiness_must_be_ok': True,
            'alert_delivery_must_be_ok': True,
            'rollback_stop_plan_required': True,
            'separate_vang_approval_required': True,
        },
        'safety': {
            'writes_database': False,
            'creates_uat_data': False,
            'backup_created': False,
            'restore_runs': False,
            'cleanup_runs': False,
            'confirm_delete_runs': False,
            'confirm_write_runs': False,
            'migration_runs': False,
            'deploy_runs': False,
            'direct_sql_used': False,
            'credentials_printed': False,
            'qc_printing_in_scope': False,
        },
        'next_step': 'Approve checkpoint tag for this milestone, or approve a separate real release/deploy readiness gate later.',
    }


def render_markdown(payload: dict) -> str:
    data = payload['data_status']
    lines = [
        f"# {payload['pack']}",
        '',
        f"- Status: {str(payload['overall_status']).upper()}",
        f"- Mode: {payload['mode']}",
        f"- Writes database: {payload['safety']['writes_database']}",
        f"- Backup created: {payload['safety']['backup_created']}",
        f"- Cleanup runs: {payload['safety']['cleanup_runs']}",
        f"- Deploy runs: {payload['safety']['deploy_runs']}",
        '',
        '## Repo and git',
        f"- Repo root: {payload['git']['repo_root']}",
        f"- Branch: {payload['git']['branch']}",
        f"- HEAD: {payload['git']['head_message']}",
        f"- Clean/synced: clean={payload['git']['clean']} ahead={payload['git']['ahead']} behind={payload['git']['behind']}",
        f"- Latest checkpoint at HEAD: {payload['git'].get('latest_checkpoint_tag') or 'not detected'}",
        '',
        '## DB, readiness, alert',
        f"- Pending migrations: {payload['migrations']['pending_count']}",
        f"- Release readiness: {payload['release_readiness']['status']} ({payload['release_readiness']['summary']})",
        f"- Alert readiness: {payload['alert_channel_readiness']['status']} delivery={payload['alert_channel_readiness']['delivery_status']} email={payload['alert_channel_readiness']['email_delivery_status']}",
        '',
        '## Backup evidence',
        f"- Path: {payload['backup_evidence']['path']}",
        f"- Status: {payload['backup_evidence']['status']}",
        f"- database.sql: exists={payload['backup_evidence']['database_sql']['exists']} size={payload['backup_evidence']['database_sql']['size']}",
        f"- backup_manifest.json: {payload['backup_evidence']['manifest_status']}",
        f"- restore_dry_run.json: {payload['backup_evidence']['restore_dry_run_status']}",
        '',
        '## Data and audit retained',
        f"- QA_UAT2R_: {data['qa_uat2r']['status']} rows={data['qa_uat2r']['total_rows']} cleanup={data['qa_uat2r']['cleanup_status']}",
        f"- QA_SHF1_: {data['qa_shf1']['status']} cleanup_round2_scope={data['qa_shf1']['cleanup_round2_scope']}",
        f"- QA_UAT9H_: {data['qa_uat9h']['status']} candidates={data['qa_uat9h']['candidate_total']}",
        '',
        '## UAT evidence by module',
    ]
    for module in MODULES:
        lines.append(f"- {module}: {str(payload['operator_evidence']['module_statuses'].get(module) or 'missing').upper()}")

    lines.extend([
        '',
        '## Inventory NXT source result',
    ])
    for source in SOURCE_GROUPS:
        lines.append(f"- {source}: {str(payload['nxt_real_data_audit']['source_results'].get(source) or 'missing').upper()}")
    totals = payload['nxt_real_data_audit']['totals_reconciliation']
    lines.extend([
        f"- Totals reconciliation: {str(totals.get('status') or 'missing').upper()} source_in_matches_total={totals.get('source_in_matches_total')} source_out_matches_total={totals.get('source_out_matches_total')}",
        '',
        '## Release checklist',
    ])
    for item in payload['release_checklist']:
        lines.append(f"- {item['key']}: {str(item['status']).upper()} - {item['evidence']}")

    lines.extend([
        '',
        '## Cleanup and deploy status',
        f"- QA_UAT2R_ cleanup decision: {payload['cleanup_decision']['recommended_decision']} (future VANG required)",
        '- Real deploy was not run.',
        '- Real release/deploy requires separate approval, fresh backup, restore dry-run, release_readiness OK, alert delivery OK, and rollback/stop plan.',
        '',
        '## Evidence commands',
    ])
    lines.extend(f"- `{command}`" for command in payload['evidence_commands'])
    lines.extend([
        '',
        '## Safety',
        '- This command is read-only and has no confirm-delete or confirm-write option.',
        '- No DB data is created, updated, deleted, cleaned up, restored, migrated, deployed, or backed up.',
        '- No direct SQL, credentials, or QC Printing action is in scope.',
        '',
        f"Next step: {payload['next_step']}",
    ])
    return '\n'.join(lines)


def render_json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=True, indent=2, default=str)


class Command(BaseCommand):
    help = 'Build a read-only post-UAT Ops release readiness evidence report'

    def add_arguments(self, parser):
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')
        parser.add_argument('--backup-path', default=DEFAULT_BACKUP_PATH, help='Verified post-UAT backup bundle path')

    def handle(self, *args, **options):
        payload = build_ops_post_uat_evidence_pack(backup_path=options.get('backup_path') or DEFAULT_BACKUP_PATH)
        if options['format'] == 'json':
            self.stdout.write(render_json(payload))
        else:
            self.stdout.write(render_markdown(payload))
