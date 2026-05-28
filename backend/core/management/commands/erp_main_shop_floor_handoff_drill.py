from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone


@dataclass(frozen=True)
class EvidenceCheck:
    key: str
    label: str
    path: str
    contains: tuple[str, ...]


@dataclass(frozen=True)
class DrillScenario:
    key: str
    title: str
    operator_goal: str
    entrypoints: tuple[str, ...]
    steps: tuple[str, ...]
    expected_result: str
    audit_focus: str
    evidence: tuple[EvidenceCheck, ...]


BACKEND_EVIDENCE = (
    EvidenceCheck(
        key='backend_shop_floor_signal_machine_down',
        label='Machine down shop-floor signal audit regression',
        path='backend/production/tests.py',
        contains=('test_shop_floor_signal_updates_block_owner_and_audit',),
    ),
    EvidenceCheck(
        key='backend_shop_floor_signal_wait_material',
        label='Wait material shop-floor signal audit regression',
        path='backend/production/tests.py',
        contains=('test_shop_floor_signal_wait_material_keeps_audit_context',),
    ),
    EvidenceCheck(
        key='backend_shop_floor_handover',
        label='Handover ready/accepted audit regression',
        path='backend/production/tests.py',
        contains=('test_shop_floor_handover_sets_ready_and_clears_previous_wait',),
    ),
    EvidenceCheck(
        key='backend_skip_operation',
        label='Skip operation reason/audit regression',
        path='backend/production/tests.py',
        contains=(
            'test_skip_ready_operation_requires_reason_fields_and_audit',
            'test_update_operation_rejects_skipped_status_and_requires_skip_action',
            'test_bulk_preview_and_shop_floor_reject_skipped_status',
        ),
    ),
    EvidenceCheck(
        key='backend_update_operation_audit',
        label='Update/done operation audit regression',
        path='backend/production/tests.py',
        contains=(
            'test_update_operation_supports_planning_fields_and_audits_reschedule',
            'test_update_operation_requires_note_for_other_block_reason_and_clears_block_when_done',
        ),
    ),
)

FRONTEND_EVIDENCE = (
    EvidenceCheck(
        key='frontend_shop_floor_drill',
        label='PlanningBoard and ProductionOrder shop-floor handoff mock drill',
        path='frontend/tests/e2e/shop-floor-handoff-drill.spec.ts',
        contains=(
            'shop-floor handoff drill covers PlanningBoard actions and ProductionOrder audit detail',
            'production-planning-signal-machine-down',
            'production-planning-signal-wait-material',
            'production-order-execution-audit-panel',
        ),
    ),
)

SCENARIOS: tuple[DrillScenario, ...] = (
    DrillScenario(
        key='receive_work_from_planning_board',
        title='Receive work from PlanningBoard and verify ProductionOrder audit',
        operator_goal='Operator can find assigned work, inspect readiness, then compare the same operation in ProductionOrder detail.',
        entrypoints=('/production-planning', '/production-orders'),
        steps=(
            'Open PlanningBoard and select a READY operation card.',
            'Open the operation detail drawer and review ready-to-dispatch and execution handoff panels.',
            'Open the ProductionOrder detail panel and compare execution_handoff audit fields.',
        ),
        expected_result='The same status, handover, latest action, actor, timestamp, and note are visible in both screens.',
        audit_focus='execution_handoff is advisory/read-only and does not hard-block production workflow.',
        evidence=FRONTEND_EVIDENCE,
    ),
    DrillScenario(
        key='ready_warning_blocker_advisory',
        title='READY / WARNING / BLOCKER are advisory',
        operator_goal='Planner and operator can distinguish ready work from warning/blocker work without introducing new hard workflow rules.',
        entrypoints=('/production-planning',),
        steps=(
            'Review READY, WARNING, and BLOCKER cards on PlanningBoard.',
            'Filter by dispatch readiness and inspect action guidance.',
            'Confirm blocker dependency work cannot be started through quick ready/handover shortcuts.',
        ),
        expected_result='Advisory labels explain what to do next; existing dependency validation remains the gate.',
        audit_focus='workflow_blocking remains false in execution_handoff and ready-to-dispatch rules.',
        evidence=(
            BACKEND_EVIDENCE[3],
            FRONTEND_EVIDENCE[0],
        ),
    ),
    DrillScenario(
        key='machine_down_signal',
        title='Report machine down',
        operator_goal='Operator can report a stopped machine with owner and note while preserving audit.',
        entrypoints=('/production-planning', 'POST /api/production/orders/shop_floor_signal/'),
        steps=(
            'Select a valid operation.',
            'Send signal_code MACHINE_DOWN with note and dispatch owner.',
            'Refresh PlanningBoard and ProductionOrder detail.',
        ),
        expected_result='Operation is blocked with MACHINE_DOWN, note/owner are visible, latest audit action is SIGNAL.',
        audit_focus='AuditLog entity_type ProductionOperation stores action SIGNAL and note context.',
        evidence=(
            BACKEND_EVIDENCE[0],
            FRONTEND_EVIDENCE[0],
        ),
    ),
    DrillScenario(
        key='wait_material_signal',
        title='Report waiting material',
        operator_goal='Operator can report material wait without posting inventory or reserving stock.',
        entrypoints=('/production-planning', 'POST /api/production/orders/shop_floor_signal/'),
        steps=(
            'Select a valid operation.',
            'Send signal_code WAIT_MATERIAL with note.',
            'Confirm material wait is shown as an advisory/action item.',
        ),
        expected_result='Operation carries WAIT_MATERIAL note and latest audit action SIGNAL; no inventory movement is posted.',
        audit_focus='Signal updates only operation block/handover audit fields, not costing, valuation, or material reservation.',
        evidence=(
            BACKEND_EVIDENCE[1],
            FRONTEND_EVIDENCE[0],
        ),
    ),
    DrillScenario(
        key='clear_to_run_and_handover',
        title='Clear to run and handover accepted',
        operator_goal='Operator can mark an eligible operation ready, then record handover ready/accepted with receiver and note.',
        entrypoints=('/production-planning', 'POST /api/production/orders/shop_floor_handover/'),
        steps=(
            'Select an operation not blocked by dependency.',
            'Send CLEAR_TO_RUN or handover READY.',
            'Send handover ACCEPTED with receiver/note and clear previous wait when valid.',
        ),
        expected_result='Handover fields, timestamp, receiver, note, and latest audit action HANDOVER are visible.',
        audit_focus='Dependency-blocked operations remain protected by existing validation.',
        evidence=(
            BACKEND_EVIDENCE[2],
            FRONTEND_EVIDENCE[0],
        ),
    ),
    DrillScenario(
        key='skip_with_reason',
        title='Skip operation with required reason',
        operator_goal='Operator can skip a valid operation only through the skip path and with a clear reason.',
        entrypoints=('/production-planning', 'POST /api/production/orders/{id}/skip_operation/'),
        steps=(
            'Open a selected operation detail.',
            'Use the Skip action and enter a reason.',
            'Confirm bulk/update status paths reject SKIPPED.',
        ),
        expected_result='Operation becomes SKIPPED, reason/actor/time are visible, latest audit action is SKIP_OPERATION.',
        audit_focus='Skip is explicit and auditable; it does not silently go through bulk/update status.',
        evidence=(
            BACKEND_EVIDENCE[3],
            FRONTEND_EVIDENCE[0],
        ),
    ),
    DrillScenario(
        key='done_update_audit',
        title='Done/update operation audit',
        operator_goal='Operator can complete/update an operation with quantity and note while preserving execution audit.',
        entrypoints=('/production-planning', 'POST /api/production/orders/{id}/update_operation/'),
        steps=(
            'Open an eligible operation.',
            'Update status, completed quantity, and note.',
            'Review ProductionOrder detail audit row.',
        ),
        expected_result='Latest audit action is UPDATE and completion information is visible without posting/costing side effects.',
        audit_focus='No production posting, material reservation, costing, valuation, tax, or accounting action runs.',
        evidence=(
            BACKEND_EVIDENCE[4],
            FRONTEND_EVIDENCE[0],
        ),
    ),
)


def _repo_root() -> Path:
    return Path(settings.BASE_DIR).parent


def _check_evidence(repo_root: Path, evidence: EvidenceCheck) -> dict:
    path = repo_root / evidence.path
    exists = path.exists()
    content = path.read_text(encoding='utf-8', errors='ignore') if exists else ''
    missing_patterns = [item for item in evidence.contains if item not in content]
    status = 'ok' if exists and not missing_patterns else 'warning'
    return {
        'key': evidence.key,
        'label': evidence.label,
        'path': evidence.path.replace('\\', '/'),
        'status': status,
        'exists': exists,
        'missing_patterns': missing_patterns,
    }


def build_shop_floor_handoff_drill_pack(repo_root: Path | None = None) -> dict:
    root = repo_root or _repo_root()
    scenario_rows = []
    for scenario in SCENARIOS:
        evidence_rows = [_check_evidence(root, item) for item in scenario.evidence]
        warning_evidence = [item for item in evidence_rows if item['status'] != 'ok']
        scenario_rows.append({
            'key': scenario.key,
            'title': scenario.title,
            'operator_goal': scenario.operator_goal,
            'entrypoints': list(scenario.entrypoints),
            'steps': list(scenario.steps),
            'expected_result': scenario.expected_result,
            'audit_focus': scenario.audit_focus,
            'status': 'ok' if not warning_evidence else 'warning',
            'evidence': evidence_rows,
        })

    summary = {
        'scenario_count': len(scenario_rows),
        'ok_count': len([item for item in scenario_rows if item['status'] == 'ok']),
        'warning_count': len([item for item in scenario_rows if item['status'] == 'warning']),
    }
    return {
        'generated_at': timezone.now(),
        'pack': 'Production Execution Shop-Floor Handoff Drill v1',
        'command': 'erp_main_shop_floor_handoff_drill',
        'mode': 'read_only_static_repository_check',
        'overall_status': 'ok' if summary['warning_count'] == 0 else 'warning',
        'summary': summary,
        'scenarios': scenario_rows,
        'operator_checklist': [
            'Select READY, WARNING, and BLOCKER operations on PlanningBoard and confirm the next action is understandable.',
            'Send MACHINE_DOWN and WAIT_MATERIAL signals only for selected operations that are allowed by current workflow.',
            'Use handover READY/ACCEPTED for eligible operations and record receiver/note context.',
            'Use Skip only through the skip action and enter a clear reason.',
            'Open ProductionOrder detail and compare latest action, actor, timestamp, note, and advisory-only status.',
        ],
        'recommended_commands': [
            'python manage.py erp_main_shop_floor_handoff_drill --format markdown',
            'python manage.py erp_main_shop_floor_handoff_drill --format json',
            'python manage.py test production.tests --keepdb',
            'npx playwright test tests/e2e/shop-floor-handoff-drill.spec.ts',
        ],
        'safety': {
            'writes_database': False,
            'creates_uat_data': False,
            'backup_restore_runs': False,
            'migration_runs': False,
            'deploy_runs': False,
            'cleanup_runs': False,
            'production_posting_runs': False,
            'material_reservation_runs': False,
            'costing_valuation_tax_runs': False,
            'credential_values_printed': False,
            'qc_printing_in_scope': False,
        },
        'safety_notes': [
            'This command is read-only and checks repository evidence only.',
            'No real-dev drill, backup, restore, migration, deploy, cleanup, production posting, reservation, costing, valuation, or tax action runs from this command.',
            'QC Printing is outside this ERP main drill pack.',
        ],
    }


def render_markdown(payload: dict) -> str:
    lines = [
        f"# {payload['pack']}",
        '',
        f"- Status: {str(payload['overall_status']).upper()}",
        f"- Mode: {payload['mode']}",
        f"- Scenarios: {payload['summary']['ok_count']}/{payload['summary']['scenario_count']} OK",
        '',
        '## Shop-floor drill scenarios',
    ]
    for scenario in payload['scenarios']:
        lines.extend([
            '',
            f"### {scenario['title']}",
            f"- Key: {scenario['key']}",
            f"- Status: {str(scenario['status']).upper()}",
            f"- Operator goal: {scenario['operator_goal']}",
            f"- Entrypoints: {', '.join(scenario['entrypoints'])}",
            f"- Expected result: {scenario['expected_result']}",
            f"- Audit focus: {scenario['audit_focus']}",
            '- Steps:',
        ])
        for index, step in enumerate(scenario['steps'], start=1):
            lines.append(f"  {index}. {step}")
        lines.append('- Evidence:')
        for evidence in scenario['evidence']:
            suffix = ''
            if evidence['missing_patterns']:
                suffix = f" missing={len(evidence['missing_patterns'])}"
            lines.append(f"  - {str(evidence['status']).upper()}: {evidence['label']} ({evidence['path']}){suffix}")

    lines.extend([
        '',
        '## Operator checklist',
    ])
    lines.extend([f"- [ ] {item}" for item in payload['operator_checklist']])
    lines.extend([
        '',
        '## Recommended commands',
    ])
    lines.extend([f"- `{item}`" for item in payload['recommended_commands']])
    lines.extend([
        '',
        '## Safety',
    ])
    for key, value in payload['safety'].items():
        lines.append(f"- {key}: {value}")
    lines.extend([
        '',
        '## Safety notes',
    ])
    lines.extend([f"- {item}" for item in payload['safety_notes']])
    return '\n'.join(lines)


class Command(BaseCommand):
    help = 'Print a read-only ERP main shop-floor handoff drill pack with repository evidence checks'

    def add_arguments(self, parser):
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')
        parser.add_argument('--strict', action='store_true', help='Exit non-zero when any scenario evidence is missing')

    def handle(self, *args, **options):
        payload = build_shop_floor_handoff_drill_pack()
        if options['format'] == 'json':
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(render_markdown(payload))

        if options.get('strict') and payload['overall_status'] != 'ok':
            raise CommandError('Shop-floor handoff drill pack has missing evidence.')
