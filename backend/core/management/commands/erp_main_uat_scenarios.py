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
class UatScenario:
    key: str
    title: str
    workflow: str
    user_goal: str
    personas: tuple[str, ...]
    evidence: tuple[EvidenceCheck, ...]
    manual_steps: tuple[str, ...]
    expected_result: str
    risk_focus: str


SCENARIOS: tuple[UatScenario, ...] = (
    UatScenario(
        key='product_readiness',
        title='Product master / routing / print readiness',
        workflow='Product master',
        user_goal='Confirm users can see whether a product is production-ready before it moves downstream.',
        personas=('uat_admin', 'uat_manager', 'uat_product_manager'),
        evidence=(
            EvidenceCheck(
                key='backend_product_readiness',
                label='Backend product readiness regression tests',
                path='backend/products/tests.py',
                contains=(
                    'test_product_readiness_ready_when_routing_resource_and_print_metadata_exist',
                    'test_product_readiness_marks_missing_routing_and_operations_as_blocker',
                    'test_product_readiness_marks_missing_print_metadata_as_warning',
                ),
            ),
            EvidenceCheck(
                key='frontend_product_readiness',
                label='Product readiness Playwright mock',
                path='frontend/tests/e2e/product-readiness-ui.spec.ts',
                contains=('product form displays routing readiness without blocking edits',),
            ),
        ),
        manual_steps=(
            'Open product form for a product with full routing and print metadata.',
            'Open product form for a product missing routing or print metadata.',
            'Confirm READY / WARNING / BLOCKER are advisory and edits are not blocked.',
        ),
        expected_result='Readiness gaps are visible and understandable without hard-blocking product edits.',
        risk_focus='Missing routing or print metadata can reach production unnoticed.',
    ),
    UatScenario(
        key='sales_snapshot_v2',
        title='SalesOrder snapshot v2',
        workflow='Sales order',
        user_goal='Confirm the sales snapshot is fixed at sales time and warnings stay advisory.',
        personas=('uat_admin', 'uat_sales', 'uat_sales_manager'),
        evidence=(
            EvidenceCheck(
                key='backend_sales_snapshot',
                label='Backend SalesOrder snapshot v2 regressions',
                path='backend/sales/tests.py',
                contains=(
                    'test_serializer_persists_product_snapshot_and_trace_code',
                    'test_snapshot_is_not_refreshed_when_updating_qty_price_note',
                    'test_update_same_product_persists_confirmation_flags_but_blocks_forbidden_snapshot_fields',
                ),
            ),
            EvidenceCheck(
                key='frontend_sales_snapshot',
                label='Sales snapshot Playwright mock',
                path='frontend/tests/e2e/sales-snapshot-readiness-ui.spec.ts',
                contains=('sales order form shows snapshot readiness advisory without blocking edits',),
            ),
        ),
        manual_steps=(
            'Create or open a SalesOrder line with product snapshot data.',
            'Change quantity, price, and notes without changing the product.',
            'Confirm snapshot business fields do not silently refresh.',
        ),
        expected_result='Snapshot v2 remains stable and warnings explain missing spec/routing handoff context.',
        risk_focus='Silent snapshot refresh can break downstream production traceability.',
    ),
    UatScenario(
        key='production_handoff',
        title='ProductionDemand / ProductionOrder handoff',
        workflow='Sales to production',
        user_goal='Confirm sales snapshot context moves into demand and production order creation.',
        personas=('uat_admin', 'uat_manager', 'uat_product_manager'),
        evidence=(
            EvidenceCheck(
                key='backend_production_handoff',
                label='Backend demand/order handoff regressions',
                path='backend/production/tests.py',
                contains=(
                    'test_create_order_from_demand_links_order_snapshot_operations_and_materials',
                    'test_sales_to_production_planning_inventory_smoke_uses_product_routing_snapshot',
                    'test_create_order_action_keeps_sales_line_snapshot_after_product_master_changes',
                ),
            ),
        ),
        manual_steps=(
            'Start from a confirmed SalesOrder line with snapshot v2.',
            'Generate ProductionDemand and create ProductionOrder.',
            'Confirm product snapshot, routing summary, and material context are retained.',
        ),
        expected_result='ProductionDemand and ProductionOrder use the sales snapshot context, not a silent product refresh.',
        risk_focus='Production handoff can drift from the customer-approved sales specification.',
    ),
    UatScenario(
        key='planning_dispatch',
        title='PlanningBoard dispatch readiness',
        workflow='Planning board',
        user_goal='Confirm dispatch users can separate READY, WARNING, and BLOCKER work.',
        personas=('uat_admin', 'uat_manager', 'uat_product_manager'),
        evidence=(
            EvidenceCheck(
                key='backend_planning_readiness',
                label='Backend ready_to_dispatch scenario regressions',
                path='backend/production/tests.py',
                contains=(
                    'test_planning_board_returns_ready_to_dispatch_advisory',
                    'test_ready_to_dispatch_warns_on_material_source_without_enforcing_dispatch_workflow',
                    'test_planning_board_dispatch_scenarios_keep_advisory_only_signals',
                ),
            ),
            EvidenceCheck(
                key='frontend_planning_readiness',
                label='PlanningBoard readiness Playwright mock',
                path='frontend/tests/e2e/planning-ready-to-dispatch-ui.spec.ts',
                contains=('planning board shows ready-to-dispatch badges, panel, and quick filter',),
            ),
        ),
        manual_steps=(
            'Open PlanningBoard with READY, WARNING, and BLOCKER cards.',
            'Filter by dispatch readiness and inspect card/detail guidance.',
            'Confirm dependency, block reason, done/skipped, queue, capacity, and material warnings are advisory.',
        ),
        expected_result='Planner sees why work is not ready without changing dispatch workflow semantics.',
        risk_focus='Daily dispatch can overload capacity or skip required predecessor/material checks.',
    ),
    UatScenario(
        key='inventory_ledger_nxt_source_audit',
        title='Inventory ledger / NXT / source audit',
        workflow='Inventory',
        user_goal='Confirm users can trace stock movement source and reconcile NXT safely.',
        personas=('uat_admin', 'uat_manager', 'uat_product_manager'),
        evidence=(
            EvidenceCheck(
                key='backend_inventory_nxt_source',
                label='Backend inventory NXT/source audit regressions',
                path='backend/inventory/tests_inventory.py',
                contains=(
                    'test_nxt_report_counts_transfer_opening_period_and_warehouse_filter',
                    'test_transaction_list_filters_by_involved_warehouse_and_source_type',
                    'test_transaction_source_audit_payload_and_extended_source_filters',
                ),
            ),
            EvidenceCheck(
                key='frontend_inventory_ledger',
                label='Inventory ledger source audit Playwright mock',
                path='frontend/tests/e2e/inventory-ledger-audit-ux.spec.ts',
                contains=('inventory ledger exposes audit filters and NXT panel',),
            ),
        ),
        manual_steps=(
            'Open So kho with purchase, production, stocktake, transfer, and manual sources.',
            'Filter by source type and involved warehouse.',
            'Export CSV and compare NXT opening, in, out, and closing totals.',
        ),
        expected_result='Ledger and NXT remain consistent while source audit labels make movement origin clear.',
        risk_focus='Users can misread manual or transfer movements if source audit is unclear.',
    ),
    UatScenario(
        key='ops_release_readiness',
        title='Deployment / Ops readiness',
        workflow='Ops',
        user_goal='Confirm release readiness basics are green before broader UAT or release handoff.',
        personas=('uat_admin',),
        evidence=(
            EvidenceCheck(
                key='backend_release_readiness',
                label='Release readiness command regressions',
                path='backend/core/tests_release_readiness.py',
                contains=(
                    'test_release_readiness_supports_json_output',
                    'test_release_readiness_reports_backup_and_alert_context',
                ),
            ),
            EvidenceCheck(
                key='backend_smoke_http',
                label='HTTP smoke command exists',
                path='backend/core/management/commands/smoke_http.py',
                contains=('Run lightweight HTTP smoke checks against backend/frontend',),
            ),
        ),
        manual_steps=(
            'Run release_readiness in a safe environment.',
            'Confirm no pending migrations and backup/restore/alert checks are OK.',
            'Only run HTTP smoke after local backend/frontend servers are explicitly approved.',
        ),
        expected_result='Ops readiness is copy-friendly and does not deploy, migrate, restore, or clean data.',
        risk_focus='Release handoff can proceed with hidden migration, backup, or alert gaps.',
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


def build_uat_scenario_pack(repo_root: Path | None = None) -> dict:
    root = repo_root or _repo_root()
    scenario_rows = []
    for scenario in SCENARIOS:
        evidence_rows = [_check_evidence(root, item) for item in scenario.evidence]
        missing_evidence = [item for item in evidence_rows if item['status'] != 'ok']
        scenario_rows.append({
            'key': scenario.key,
            'title': scenario.title,
            'workflow': scenario.workflow,
            'user_goal': scenario.user_goal,
            'personas': list(scenario.personas),
            'status': 'ok' if not missing_evidence else 'warning',
            'evidence': evidence_rows,
            'manual_steps': list(scenario.manual_steps),
            'expected_result': scenario.expected_result,
            'risk_focus': scenario.risk_focus,
        })

    summary = {
        'scenario_count': len(scenario_rows),
        'ok_count': len([item for item in scenario_rows if item['status'] == 'ok']),
        'warning_count': len([item for item in scenario_rows if item['status'] == 'warning']),
    }
    return {
        'generated_at': timezone.now(),
        'pack': 'ERP Main UAT Scenario Pack v1',
        'mode': 'read_only_static_repository_check',
        'summary': summary,
        'overall_status': 'ok' if summary['warning_count'] == 0 else 'warning',
        'scenarios': scenario_rows,
        'recommended_commands': [
            'python manage.py erp_main_uat_scenarios --format markdown',
            'python manage.py erp_main_uat_scenarios --format json',
            'python manage.py uat_access_matrix --json',
            'python manage.py release_readiness',
            'python manage.py smoke_http --backend-base http://127.0.0.1:8000 --frontend-base http://127.0.0.1:5173 --username uat_admin --password <approved-password>',
        ],
        'safety_notes': [
            'Default command is read-only and checks repository evidence only.',
            'Do not run bootstrap_uat_demo, real server smoke, backup, restore, migration, deploy, or cleanup without explicit approval.',
            'QC Printing is outside this ERP main scenario pack.',
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
        '## Scenarios',
    ]
    for scenario in payload['scenarios']:
        lines.extend([
            '',
            f"### {scenario['title']}",
            f"- Key: {scenario['key']}",
            f"- Workflow: {scenario['workflow']}",
            f"- Status: {str(scenario['status']).upper()}",
            f"- User goal: {scenario['user_goal']}",
            f"- Personas: {', '.join(scenario['personas'])}",
            f"- Expected result: {scenario['expected_result']}",
            f"- Risk focus: {scenario['risk_focus']}",
            '- Evidence:',
        ])
        for evidence in scenario['evidence']:
            suffix = ''
            if evidence['missing_patterns']:
                suffix = f" missing={len(evidence['missing_patterns'])}"
            lines.append(f"  - {str(evidence['status']).upper()}: {evidence['label']} ({evidence['path']}){suffix}")
        lines.append('- Manual UAT steps:')
        for index, step in enumerate(scenario['manual_steps'], start=1):
            lines.append(f"  {index}. {step}")

    lines.extend([
        '',
        '## Recommended commands',
    ])
    lines.extend([f"- `{item}`" for item in payload['recommended_commands']])
    lines.extend([
        '',
        '## Safety notes',
    ])
    lines.extend([f"- {item}" for item in payload['safety_notes']])
    return '\n'.join(lines)


class Command(BaseCommand):
    help = 'Print a read-only ERP main UAT scenario pack with repository evidence checks'

    def add_arguments(self, parser):
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')
        parser.add_argument('--strict', action='store_true', help='Exit non-zero when any scenario evidence is missing')

    def handle(self, *args, **options):
        payload = build_uat_scenario_pack()
        if options['format'] == 'json':
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(render_markdown(payload))

        if options.get('strict') and payload['overall_status'] != 'ok':
            raise CommandError('ERP main UAT scenario pack has missing evidence.')
