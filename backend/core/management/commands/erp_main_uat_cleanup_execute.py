from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.models import ProtectedError
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from core.management.commands.erp_main_uat_cleanup_plan import (
    CLEANUP_DEPENDENCY_ORDER,
    CLEANUP_GROUP_SELECTORS,
    DEFAULT_PREFIX,
    build_cleanup_querysets,
)


SAFE_DB_NAME = 'erp_dev_clean'


def _database_name() -> str:
    return str(connection.settings_dict.get('NAME') or '')


def _confirm_delete_database_allowed(database_name: str) -> bool:
    normalized = str(database_name or '').strip().lower()
    return normalized == SAFE_DB_NAME or normalized.startswith('test_')


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _verify_backup_path(path_value: str) -> dict:
    raw_path = str(path_value or '').strip()
    if not raw_path:
        return {
            'path': '',
            'status': 'missing',
            'verified': False,
            'database_sql_exists': False,
            'database_sql_bytes': 0,
            'manifest_status': 'missing',
            'restore_dry_run_status': 'missing',
        }

    backup_path = Path(raw_path)
    database_sql = backup_path / 'database.sql'
    manifest = _read_json(backup_path / 'backup_manifest.json')
    restore_dry_run = _read_json(backup_path / 'restore_dry_run.json')
    database_sql_bytes = database_sql.stat().st_size if database_sql.exists() else 0
    verified = (
        backup_path.exists()
        and database_sql.exists()
        and database_sql_bytes > 0
        and manifest.get('status') == 'ok'
        and restore_dry_run.get('status') == 'ok'
    )
    return {
        'path': str(backup_path),
        'status': 'ok' if verified else 'error',
        'verified': verified,
        'database_sql_exists': database_sql.exists(),
        'database_sql_bytes': database_sql_bytes,
        'manifest_status': manifest.get('status') or 'missing',
        'restore_dry_run_status': restore_dry_run.get('status') or 'missing',
    }


def _pending_migrations() -> list[str]:
    executor = MigrationExecutor(connection)
    plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    return [f'{migration.app_label}.{migration.name}' for migration, backwards in plan if not backwards]


def _scope_snapshot(prefix: str) -> tuple[str, list[dict], dict]:
    normalized_prefix, querysets = build_cleanup_querysets(prefix)
    groups = []
    scoped_objects = {}
    for key in CLEANUP_DEPENDENCY_ORDER:
        queryset = querysets[key]
        ids = list(queryset.values_list('id', flat=True))
        groups.append({
            'key': key,
            'count': len(ids),
            'cleanup_candidate': True,
            'selector': CLEANUP_GROUP_SELECTORS[key],
        })
        scoped_objects[key] = {
            'model': queryset.model,
            'ids': ids,
        }
    return normalized_prefix, groups, scoped_objects


def _delete_scoped_objects(scoped_objects: dict) -> list[dict]:
    deleted_groups = []
    try:
        with transaction.atomic():
            for key in CLEANUP_DEPENDENCY_ORDER:
                item = scoped_objects[key]
                ids = item['ids']
                planned_count = len(ids)
                deleted_count = 0
                if planned_count:
                    deleted_count, _details = item['model'].objects.filter(id__in=ids).delete()
                if deleted_count != planned_count:
                    raise CommandError(
                        f'Unsafe cleanup cascade detected for {key}: planned {planned_count}, deleted {deleted_count}.'
                    )
                deleted_groups.append({
                    'key': key,
                    'planned_count': planned_count,
                    'deleted_count': deleted_count,
                })
    except ProtectedError as exc:
        raise CommandError(f'Cleanup blocked by protected related data: {exc}') from exc
    return deleted_groups


def build_cleanup_execute_payload(
    prefix: str,
    *,
    confirm_delete: bool = False,
    expected_total: int | None = None,
    backup_path: str = '',
) -> dict:
    normalized_prefix, groups, scoped_objects = _scope_snapshot(prefix)
    total_candidates = sum(group['count'] for group in groups)
    database_name = _database_name()
    backup_gate = _verify_backup_path(backup_path)
    pending_migrations = _pending_migrations()
    expected_total_matches = expected_total is not None and int(expected_total) == total_candidates
    database_gate_ok = _confirm_delete_database_allowed(database_name)
    migration_gate_ok = len(pending_migrations) == 0

    payload = {
        'pack': 'ERP Main UAT Data Cleanup Execution v1',
        'command': 'erp_main_uat_cleanup_execute',
        'mode': 'confirm_delete' if confirm_delete else 'dry_run',
        'overall_status': 'ok',
        'prefix': normalized_prefix,
        'database': {
            'name': database_name,
            'confirm_delete_allowed': database_gate_ok,
            'required_name': SAFE_DB_NAME,
            'test_database_allowed': True,
        },
        'cleanup_status': 'not_performed',
        'candidate_summary': {
            'total_candidate_rows': total_candidates,
            'group_count': len(groups),
            'expected_total': expected_total,
            'expected_total_matches': expected_total_matches,
        },
        'candidate_groups': groups,
        'blocked_or_unsafe_groups': [
            {
                'key': 'support_audit_refs',
                'cleanup_candidate': False,
                'reason': 'Generic audit/support references stay blocked until explicit FK-safe review.',
            },
            {
                'key': 'broad_qa_seed_data',
                'cleanup_candidate': False,
                'reason': 'QA_, TMP, QA_8A2F_, QA_7E2_, seed data, test DB cleanup, and non-prefixed data are outside this command.',
            },
        ],
        'dependency_order': list(CLEANUP_DEPENDENCY_ORDER),
        'gates': {
            'confirm_delete': confirm_delete,
            'expected_total_required': confirm_delete,
            'expected_total_matches': expected_total_matches,
            'backup_verified': backup_gate['verified'],
            'database_allowed': database_gate_ok,
            'pending_migrations': pending_migrations,
            'no_pending_migrations': migration_gate_ok,
        },
        'backup': backup_gate,
        'deleted_groups': [],
        'safety': {
            'dry_run_is_default': True,
            'writes_database': False,
            'delete_requires_confirm_delete': True,
            'delete_requires_expected_total_match': True,
            'delete_requires_verified_backup': True,
            'delete_requires_safe_database': True,
            'delete_requires_no_pending_migrations': True,
            'broad_prefix_allowed': False,
            'outside_prefix_cleanup_allowed': False,
            'test_database_allowed_for_regression_tests': True,
            'backup_restore_runs': False,
            'migration_runs': False,
            'deploy_runs': False,
            'credential_values_printed': False,
            'qc_printing_in_scope': False,
        },
        'generated_at': timezone.now().isoformat(),
    }

    if not confirm_delete:
        return payload

    if expected_total is None:
        raise CommandError('Confirm delete requires --expected-total matching the dry-run candidate total.')
    if not expected_total_matches:
        raise CommandError(
            f'Expected total gate failed: expected {expected_total}, current candidate total {total_candidates}.'
        )
    if not backup_gate['verified']:
        raise CommandError('Confirm delete requires --backup-path pointing to a verified backup bundle.')
    if not database_gate_ok:
        raise CommandError(f'Confirm delete is only allowed on {SAFE_DB_NAME} or test databases.')
    if not migration_gate_ok:
        raise CommandError('Confirm delete requires no pending migrations.')

    deleted_groups = _delete_scoped_objects(scoped_objects)
    deleted_total = sum(group['deleted_count'] for group in deleted_groups)
    payload['cleanup_status'] = 'deleted'
    payload['deleted_groups'] = deleted_groups
    payload['deleted_summary'] = {
        'deleted_total': deleted_total,
        'matches_expected_total': deleted_total == expected_total,
    }
    payload['safety']['writes_database'] = True
    return payload


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
        f"- Expected total: {payload['candidate_summary']['expected_total']}",
        f"- Backup verified: {payload['backup']['verified']}",
        '',
        '## Candidate cleanup scope',
    ]
    for group in payload['candidate_groups']:
        lines.append(f"- {group['key']}: {group['count']} ({group['selector']})")

    lines.extend(['', '## Dependency order'])
    for index, key in enumerate(payload['dependency_order'], start=1):
        lines.append(f"{index}. {key}")

    lines.extend(['', '## Gates'])
    lines.append(f"- confirm_delete: {payload['gates']['confirm_delete']}")
    lines.append(f"- expected_total_matches: {payload['gates']['expected_total_matches']}")
    lines.append(f"- backup_verified: {payload['gates']['backup_verified']}")
    lines.append(f"- database_allowed: {payload['gates']['database_allowed']}")
    lines.append(f"- no_pending_migrations: {payload['gates']['no_pending_migrations']}")

    lines.extend(['', '## Blocked / unsafe groups'])
    for group in payload['blocked_or_unsafe_groups']:
        lines.append(f"- {group['key']}: {group['reason']}")

    if payload.get('deleted_groups'):
        lines.extend(['', '## Deleted groups'])
        for group in payload['deleted_groups']:
            lines.append(f"- {group['key']}: {group['deleted_count']}")

    lines.extend([
        '',
        '## Safety',
        '- Dry-run is the default.',
        '- Delete requires confirm-delete, expected total match, verified backup, safe DB, and no pending migrations.',
        '- Broad QA prefixes are rejected by prefix validation.',
        '- Data outside the scoped prefix is not part of the cleanup scope.',
        '- No backup, restore, migration, deployment, or QC Printing action runs from this command.',
        '- No credential values are printed.',
    ])
    return '\n'.join(lines)


class Command(BaseCommand):
    help = 'Dry-run or execute gated ERP main UAT data cleanup'

    def add_arguments(self, parser):
        parser.add_argument('--prefix', default=DEFAULT_PREFIX, help='Specific UAT prefix, default QA_UAT9H_')
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')
        parser.add_argument('--confirm-delete', action='store_true', help='Delete scoped UAT data after all gates pass')
        parser.add_argument('--expected-total', type=int, default=None, help='Expected candidate row count for delete gate')
        parser.add_argument('--backup-path', default='', help='Verified backup bundle path for delete gate')

    def handle(self, *args, **options):
        payload = build_cleanup_execute_payload(
            options['prefix'],
            confirm_delete=bool(options.get('confirm_delete')),
            expected_total=options.get('expected_total'),
            backup_path=options.get('backup_path') or '',
        )
        if options['format'] == 'json':
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(render_markdown(payload))
