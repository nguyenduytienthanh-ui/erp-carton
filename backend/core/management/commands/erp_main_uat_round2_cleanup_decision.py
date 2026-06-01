from __future__ import annotations

import json

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.management.commands.erp_main_uat_cleanup_execute import build_cleanup_execute_payload
from core.management.commands.erp_main_uat_cleanup_plan import build_cleanup_plan
from core.management.commands.erp_main_uat_round2_operator_evidence import (
    DEFAULT_BACKUP_PATH,
    EXPECTED_ROUND2_ROWS,
    build_operator_evidence_pack,
)
from core.management.commands.erp_main_uat_round2_real_dev_drill import (
    DEFAULT_PREFIX as ROUND2_PREFIX,
    LEGACY_CLEANUP_PREFIX,
)
from core.management.commands.erp_main_shop_floor_handoff_real_dev_drill import DEFAULT_PREFIX as SHOP_FLOOR_PREFIX


DECISION_OPTIONS = (
    {
        'key': 'keep_for_audit',
        'label': 'Keep QA_UAT2R_ for audit/training/debug',
        'recommended_when': 'operators or managers still need retained real-dev evidence',
        'requires_future_write': False,
    },
    {
        'key': 'defer_cleanup',
        'label': 'Defer cleanup until evidence is signed off',
        'recommended_when': 'evidence is useful but cleanup timing is not decided',
        'requires_future_write': False,
    },
    {
        'key': 'prepare_cleanup',
        'label': 'Prepare a separate VANG cleanup milestone',
        'recommended_when': 'evidence is accepted and QA_UAT2R_ no longer needs to remain live',
        'requires_future_write': True,
    },
)


def _validate_prefix(prefix: str) -> str:
    value = str(prefix or '').strip().upper()
    if value != ROUND2_PREFIX:
        raise CommandError('Prefix must be exactly QA_UAT2R_ for Round 2 cleanup decision.')
    return value


def _decision_recommendation(operator_payload: dict, cleanup_plan: dict, dry_run: dict) -> dict:
    retained_rows = int(operator_payload.get('data_retained', {}).get('qa_uat2r', {}).get('total_rows') or 0)
    plan_total = int(cleanup_plan.get('candidate_summary', {}).get('total_candidate_rows') or 0)
    dry_run_total = int(dry_run.get('candidate_summary', {}).get('total_candidate_rows') or 0)
    evidence_ok = operator_payload.get('overall_status') == 'ok'
    scope_matches = retained_rows == plan_total == dry_run_total == EXPECTED_ROUND2_ROWS
    if evidence_ok and scope_matches:
        status = 'ready_for_decision'
        recommended = 'defer_cleanup'
        reason = 'QA_UAT2R_ evidence is complete, but cleanup should stay separate until business sign-off.'
    elif retained_rows == 0:
        status = 'warning'
        recommended = 'investigate_before_cleanup'
        reason = 'QA_UAT2R_ retained data is not present; do not approve cleanup until scope is understood.'
    elif scope_matches:
        status = 'warning'
        recommended = 'hold_cleanup'
        reason = 'QA_UAT2R_ scope matches 38 rows, but operator evidence/readiness is not OK.'
    else:
        status = 'warning'
        recommended = 'hold_cleanup'
        reason = 'QA_UAT2R_ counts do not match the expected 38-row scope.'
    return {
        'status': status,
        'recommended_decision': recommended,
        'reason': reason,
        'decision_options': list(DECISION_OPTIONS),
        'business_signoff_required_before_cleanup': True,
    }


def _candidate_groups_for_prefix(cleanup_plan: dict, prefix: str) -> list[dict]:
    groups = []
    for group in cleanup_plan.get('candidate_groups') or []:
        copied = dict(group)
        selector = str(copied.get('selector') or '')
        copied['selector'] = selector.replace(LEGACY_CLEANUP_PREFIX, prefix)
        groups.append(copied)
    return groups


def _future_cleanup_gate(dry_run: dict, backup_path: str) -> dict:
    return {
        'actual_cleanup_is_separate_vang_milestone': True,
        'fresh_backup_required_for_actual_cleanup': True,
        'decision_backup_path_for_read_only_gate_only': backup_path,
        'current_dry_run': {
            'candidate_total': dry_run.get('candidate_summary', {}).get('total_candidate_rows'),
            'expected_total': dry_run.get('candidate_summary', {}).get('expected_total'),
            'expected_total_matches': dry_run.get('candidate_summary', {}).get('expected_total_matches'),
            'backup_verified': dry_run.get('gates', {}).get('backup_verified'),
            'no_pending_migrations': dry_run.get('gates', {}).get('no_pending_migrations'),
            'confirm_delete': dry_run.get('gates', {}).get('confirm_delete'),
            'writes_database': dry_run.get('safety', {}).get('writes_database'),
        },
        'required_future_steps': [
            'create a new pre-cleanup backup',
            'verify database.sql size > 0',
            'verify backup_manifest.json status ok',
            'verify restore_dry_run.json status ok',
            'confirm release_readiness OK',
            'confirm no pending migrations',
            f'rerun dry-run and require expected total {EXPECTED_ROUND2_ROWS}',
            'run --confirm-delete exactly once only after separate approval',
        ],
    }


def build_cleanup_decision_pack(prefix: str = ROUND2_PREFIX, *, backup_path: str = DEFAULT_BACKUP_PATH) -> dict:
    prefix = _validate_prefix(prefix)
    operator_payload = build_operator_evidence_pack(prefix, backup_path=backup_path)
    cleanup_plan = build_cleanup_plan(prefix)
    dry_run = build_cleanup_execute_payload(
        prefix,
        confirm_delete=False,
        expected_total=EXPECTED_ROUND2_ROWS,
        backup_path=backup_path,
    )
    legacy_plan = build_cleanup_plan(LEGACY_CLEANUP_PREFIX)
    decision = _decision_recommendation(operator_payload, cleanup_plan, dry_run)
    future_gate = _future_cleanup_gate(dry_run, backup_path)
    plan_total = int(cleanup_plan.get('candidate_summary', {}).get('total_candidate_rows') or 0)
    dry_run_total = int(dry_run.get('candidate_summary', {}).get('total_candidate_rows') or 0)
    overall_ok = (
        operator_payload.get('overall_status') == 'ok'
        and plan_total == EXPECTED_ROUND2_ROWS
        and dry_run_total == EXPECTED_ROUND2_ROWS
        and dry_run.get('candidate_summary', {}).get('expected_total_matches') is True
        and dry_run.get('safety', {}).get('writes_database') is False
        and decision['status'] == 'ready_for_decision'
    )
    return {
        'generated_at': timezone.now(),
        'pack': 'ERP Main UAT Round 2 Cleanup Decision Plan v1',
        'command': 'erp_main_uat_round2_cleanup_decision',
        'mode': 'read_only_cleanup_decision',
        'overall_status': 'ok' if overall_ok else 'warning',
        'prefix': prefix,
        'operator_evidence': {
            'command': operator_payload.get('command'),
            'overall_status': operator_payload.get('overall_status'),
            'module_count': len(operator_payload.get('module_evidence') or []),
            'source_breakdown': operator_payload.get('source_breakdown') or {},
        },
        'data_status': {
            'qa_uat2r': {
                **operator_payload.get('data_retained', {}).get('qa_uat2r', {}),
                'cleanup_candidate_rows': plan_total,
                'dry_run_candidate_rows': dry_run_total,
            },
            'qa_shf1': {
                **operator_payload.get('data_retained', {}).get('qa_shf1', {}),
                'cleanup_round2_scope': False,
            },
            'qa_uat9h': {
                **operator_payload.get('data_retained', {}).get('qa_uat9h', {}),
                'cleanup_plan_candidate_rows': int(legacy_plan.get('candidate_summary', {}).get('total_candidate_rows') or 0),
            },
        },
        'cleanup_decision': decision,
        'cleanup_scope': {
            'allowed_prefix': prefix,
            'exact_prefix_required': True,
            'fk_safe_linkage_from_cleanup_plan': True,
            'expected_total': EXPECTED_ROUND2_ROWS,
            'candidate_groups': _candidate_groups_for_prefix(cleanup_plan, prefix),
            'blocked_or_unsafe_groups': cleanup_plan.get('blocked_or_unsafe_groups') or [],
            'dependency_order': cleanup_plan.get('dependency_order') or [],
        },
        'do_not_touch': [
            SHOP_FLOOR_PREFIX,
            LEGACY_CLEANUP_PREFIX,
            'broad QA_ seed data',
            'non-prefixed business data',
            'support/audit refs blocked_or_unsafe groups',
            'QC Printing',
        ],
        'future_cleanup_gate': future_gate,
        'safety': {
            'writes_database': False,
            'cleanup_runs': False,
            'confirm_delete_runs': False,
            'confirm_write_runs': False,
            'backup_created': False,
            'restore_runs': False,
            'migration_runs': False,
            'deploy_runs': False,
            'direct_sql_used': False,
            'credentials_printed': False,
            'qc_printing_in_scope': False,
        },
        'recommended_read_only_commands': [
            'backend/.venv/Scripts/python.exe manage.py erp_main_uat_round2_cleanup_decision --format markdown',
            'backend/.venv/Scripts/python.exe manage.py erp_main_uat_round2_cleanup_decision --format json',
            'backend/.venv/Scripts/python.exe manage.py erp_main_uat_round2_operator_evidence --format markdown',
            f'backend/.venv/Scripts/python.exe manage.py erp_main_uat_cleanup_plan --prefix {prefix} --format markdown',
            f'backend/.venv/Scripts/python.exe manage.py erp_main_uat_cleanup_execute --prefix {prefix} --format json --expected-total {EXPECTED_ROUND2_ROWS} --backup-path "{backup_path}"',
        ],
        'next_step': 'Approve checkpoint tag for this decision milestone, or approve a separate VANG cleanup milestone later.',
    }


def render_markdown(payload: dict) -> str:
    data = payload['data_status']
    decision = payload['cleanup_decision']
    gate = payload['future_cleanup_gate']['current_dry_run']
    lines = [
        f"# {payload['pack']}",
        '',
        f"- Status: {str(payload['overall_status']).upper()}",
        f"- Mode: {payload['mode']}",
        f"- Prefix: `{payload['prefix']}`",
        f"- Writes database: {payload['safety']['writes_database']}",
        f"- Recommended decision: {decision['recommended_decision']}",
        f"- Reason: {decision['reason']}",
        '',
        '## Data status',
        f"- QA_UAT2R_: {data['qa_uat2r'].get('status')} retained_rows={data['qa_uat2r'].get('total_rows')} cleanup_candidates={data['qa_uat2r'].get('cleanup_candidate_rows')}",
        f"- QA_SHF1_: {data['qa_shf1'].get('status')} cleanup_round2_scope={data['qa_shf1'].get('cleanup_round2_scope')}",
        f"- QA_UAT9H_: {data['qa_uat9h'].get('status')} cleanup_candidates={data['qa_uat9h'].get('cleanup_plan_candidate_rows')}",
        '',
        '## Cleanup decision options',
    ]
    for option in decision['decision_options']:
        lines.append(f"- {option['key']}: {option['label']} (future_write={option['requires_future_write']})")

    lines.extend([
        '',
        '## Future cleanup scope',
        f"- Allowed prefix: {payload['cleanup_scope']['allowed_prefix']}",
        f"- Expected total: {payload['cleanup_scope']['expected_total']}",
        f"- Candidate groups: {len(payload['cleanup_scope']['candidate_groups'])}",
        f"- Blocked/unsafe groups: {', '.join(group['key'] for group in payload['cleanup_scope']['blocked_or_unsafe_groups'])}",
        '',
        '## Do not touch',
    ])
    lines.extend(f"- {item}" for item in payload['do_not_touch'])
    lines.extend([
        '',
        '## Future cleanup gate',
        '- Actual cleanup is a separate VANG milestone.',
        '- A fresh backup is required for actual cleanup.',
        f"- Current read-only dry-run candidate total: {gate['candidate_total']}",
        f"- Current read-only expected total matches: {gate['expected_total_matches']}",
        f"- Current read-only backup verified: {gate['backup_verified']}",
        f"- Current read-only writes_database: {gate['writes_database']}",
        '',
        '## Safety',
        '- This command is read-only.',
        '- No cleanup, confirm-delete, confirm-write, backup creation, restore, migration, deploy, direct SQL, credentials, or QC Printing action runs.',
        '',
        '## Recommended read-only commands',
    ])
    lines.extend(f"- `{command}`" for command in payload['recommended_read_only_commands'])
    lines.extend(['', f"Next step: {payload['next_step']}"])
    return '\n'.join(lines)


def render_json(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=True, indent=2, default=str)


class Command(BaseCommand):
    help = 'Build a read-only cleanup decision report for ERP main UAT Round 2'

    def add_arguments(self, parser):
        parser.add_argument('--prefix', default=ROUND2_PREFIX, help='Must be exactly QA_UAT2R_')
        parser.add_argument('--backup-path', default=DEFAULT_BACKUP_PATH, help='Post-UAT backup path used for read-only dry-run gate')
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')

    def handle(self, *args, **options):
        payload = build_cleanup_decision_pack(
            options.get('prefix') or '',
            backup_path=options.get('backup_path') or '',
        )
        if options['format'] == 'json':
            self.stdout.write(render_json(payload))
        else:
            self.stdout.write(render_markdown(payload))
