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
class Round2Scenario:
    key: str
    domain: str
    title: str
    objective: str
    priority: str
    classifications: tuple[str, ...]
    evidence: tuple[EvidenceCheck, ...]
    operator_checklist: tuple[str, ...]
    real_dev_gate: str
    risk_focus: str


CLASSIFICATION_LABELS = {
    'mock_no_db': 'mock/no-DB',
    'read_only_command': 'read-only command',
    'real_dev_db_gate': 'real-dev DB requires separate gate',
}

RECENT_MILESTONES = (
    'Product readiness',
    'SalesOrder snapshot v2',
    'Sales to Production handoff',
    'PlanningBoard READY/WARNING/BLOCKER',
    'Shop-floor handoff/audit',
    'ProductionOrder audit UI',
    'PlanningBoard operator/mobile UX',
    'Inventory NXT source breakdown',
    'Release readiness',
)

ROUND2_SCENARIOS: tuple[Round2Scenario, ...] = (
    Round2Scenario(
        key='product_readiness_round2',
        domain='Product',
        title='Product readiness advisory recheck',
        objective='Reconfirm routing, resource, and print metadata readiness stays visible and advisory.',
        priority='P1',
        classifications=('mock_no_db', 'read_only_command'),
        evidence=(
            EvidenceCheck(
                key='backend_product_readiness',
                label='Product readiness backend regressions',
                path='backend/products/tests.py',
                contains=(
                    'test_product_readiness_ready_when_routing_resource_and_print_metadata_exist',
                    'test_product_readiness_marks_missing_routing_and_operations_as_blocker',
                    'test_product_readiness_marks_missing_print_metadata_as_warning',
                ),
            ),
            EvidenceCheck(
                key='frontend_product_readiness_mock',
                label='Product readiness Playwright mock',
                path='frontend/tests/e2e/product-readiness-ui.spec.ts',
                contains=('product form displays routing readiness without blocking edits',),
            ),
        ),
        operator_checklist=(
            'Open product readiness evidence in mock/no-DB UI.',
            'Confirm READY/WARNING/BLOCKER explain gaps without blocking edits.',
        ),
        real_dev_gate='Only if users request fresh product UAT data; requires separate backup/gate approval.',
        risk_focus='Product master gaps can still reach Sales or Production if advisory signals are hard to notice.',
    ),
    Round2Scenario(
        key='sales_snapshot_delivery_round2',
        domain='Sales',
        title='Sales snapshot v2 and delivery touchpoint',
        objective='Reconfirm SalesOrder snapshot stability after qty/price/note edits and delivery/shipping touchpoints.',
        priority='P1',
        classifications=('mock_no_db', 'read_only_command', 'real_dev_db_gate'),
        evidence=(
            EvidenceCheck(
                key='backend_sales_snapshot',
                label='Sales snapshot backend regressions',
                path='backend/sales/tests.py',
                contains=(
                    'test_snapshot_is_not_refreshed_when_updating_qty_price_note',
                    'test_update_same_product_persists_confirmation_flags_but_blocks_forbidden_snapshot_fields',
                    'test_create_order_with_split_delivery_plans',
                    'test_create_shipment_and_progress_workflow',
                ),
            ),
            EvidenceCheck(
                key='frontend_sales_snapshot_mock',
                label='Sales snapshot Playwright mock',
                path='frontend/tests/e2e/sales-snapshot-readiness-ui.spec.ts',
                contains=('sales order form shows snapshot readiness advisory without blocking edits',),
            ),
        ),
        operator_checklist=(
            'Review SalesOrder line snapshot fields before and after qty/price/note edits.',
            'Check delivery plan or shipping touchpoint evidence without posting new stock.',
        ),
        real_dev_gate='Fresh Sales round requires new prefix, verified backup, and explicit real-dev approval.',
        risk_focus='Silent snapshot refresh or shipment linkage drift can break downstream traceability.',
    ),
    Round2Scenario(
        key='production_execution_audit_round2',
        domain='Production',
        title='Production handoff and execution audit',
        objective='Reconfirm demand/order snapshot context plus operation update, skip, done, and audit payload visibility.',
        priority='P1',
        classifications=('mock_no_db', 'read_only_command', 'real_dev_db_gate'),
        evidence=(
            EvidenceCheck(
                key='backend_production_handoff',
                label='Production demand/order and execution audit regressions',
                path='backend/production/tests.py',
                contains=(
                    'test_create_order_from_demand_links_order_snapshot_operations_and_materials',
                    'test_production_order_detail_returns_execution_handoff_last_action_payload',
                    'test_skip_ready_operation_requires_reason_fields_and_audit',
                    'test_update_operation_supports_planning_fields_and_audits_reschedule',
                ),
            ),
            EvidenceCheck(
                key='frontend_production_order_audit',
                label='ProductionOrder execution audit Playwright mock',
                path='frontend/tests/e2e/production-order-execution-audit-ui.spec.ts',
                contains=(
                    'production order list and detail show execution audit payload',
                    'production-order-execution-audit-panel',
                ),
            ),
        ),
        operator_checklist=(
            'Open ProductionOrder detail audit payload from mock evidence.',
            'Confirm skip/update/done audit rows show actor, time, note, and last action.',
        ),
        real_dev_gate='Use a new controlled write command only after backup, release readiness, and prefix gates pass.',
        risk_focus='Execution actions may be hard to audit if operator context is missing or stale.',
    ),
    Round2Scenario(
        key='planning_shop_floor_mobile_round2',
        domain='Planning',
        title='PlanningBoard shop-floor and mobile/tablet usability',
        objective='Reconfirm READY/WARNING/BLOCKER, advisory-only behavior, drawer/modal layout, and mobile/tablet usability.',
        priority='P1',
        classifications=('mock_no_db', 'read_only_command'),
        evidence=(
            EvidenceCheck(
                key='backend_planning_advisory',
                label='PlanningBoard advisory regressions',
                path='backend/production/tests.py',
                contains=(
                    'test_planning_board_returns_ready_to_dispatch_advisory',
                    'test_planning_board_dispatch_scenarios_keep_advisory_only_signals',
                ),
            ),
            EvidenceCheck(
                key='frontend_planning_tablet',
                label='PlanningBoard desktop/tablet Playwright mock',
                path='frontend/tests/e2e/planning-ready-to-dispatch-ui.spec.ts',
                contains=(
                    'planning board shows ready-to-dispatch badges, panel, and quick filter',
                    'tablet viewport keeps PlanningBoard filters and audit drawer within screen',
                ),
            ),
            EvidenceCheck(
                key='frontend_shop_floor_mobile',
                label='Shop-floor mobile viewport Playwright mock',
                path='frontend/tests/e2e/shop-floor-handoff-drill.spec.ts',
                contains=('mobile viewport keeps PlanningBoard shop-floor actions touch friendly',),
            ),
        ),
        operator_checklist=(
            'Run mock viewport checks for desktop/tablet/mobile PlanningBoard.',
            'Confirm advisory-only labels remain visible in card, drawer, and action groups.',
        ),
        real_dev_gate='No DB needed unless a new real device or real data drill is explicitly approved.',
        risk_focus='Shop-floor users can misread advisory states or lose primary actions on smaller screens.',
    ),
    Round2Scenario(
        key='shop_floor_handoff_round2',
        domain='Shop-floor',
        title='Shop-floor handoff retained-data report',
        objective='Reconfirm MACHINE_DOWN, WAIT_MATERIAL, CLEAR_TO_RUN, handover, skip, done/update, and execution audit.',
        priority='P1',
        classifications=('mock_no_db', 'read_only_command', 'real_dev_db_gate'),
        evidence=(
            EvidenceCheck(
                key='backend_shop_floor_regressions',
                label='Shop-floor signal/handover/skip/update regressions',
                path='backend/production/tests.py',
                contains=(
                    'test_shop_floor_signal_updates_block_owner_and_audit',
                    'test_shop_floor_signal_wait_material_keeps_audit_context',
                    'test_shop_floor_handover_sets_ready_and_clears_previous_wait',
                    'test_bulk_preview_and_shop_floor_reject_skipped_status',
                ),
            ),
            EvidenceCheck(
                key='backend_shop_floor_existing_report',
                label='Existing QA_SHF1_ read-only report regression',
                path='backend/core/tests_uat_scenario_pack.py',
                contains=('test_shop_floor_real_dev_drill_reports_existing_prefixed_data_read_only',),
            ),
            EvidenceCheck(
                key='frontend_shop_floor_mock',
                label='PlanningBoard and ProductionOrder shop-floor Playwright mock',
                path='frontend/tests/e2e/shop-floor-handoff-drill.spec.ts',
                contains=('shop-floor handoff drill covers PlanningBoard actions and ProductionOrder audit detail',),
            ),
        ),
        operator_checklist=(
            'Use read-only existing report for retained QA_SHF1_ data.',
            'Do not run confirm-write again for QA_SHF1_.',
        ),
        real_dev_gate='Any new shop-floor write requires a new prefix, verified backup, and explicit approval.',
        risk_focus='Retained drill data can be confused with a fresh UAT write if command mode is not explicit.',
    ),
    Round2Scenario(
        key='inventory_nxt_source_round2',
        domain='Inventory',
        title='Inventory NXT source breakdown and CSV',
        objective='Reconfirm NXT totals remain stable while source groups, document types, warnings, CSV, and warehouse filters are readable.',
        priority='P1',
        classifications=('mock_no_db', 'read_only_command', 'real_dev_db_gate'),
        evidence=(
            EvidenceCheck(
                key='backend_inventory_source_breakdown',
                label='Inventory NXT source breakdown backend regressions',
                path='backend/inventory/tests_inventory.py',
                contains=(
                    'test_nxt_report_source_breakdown_keeps_totals_and_transfer_direction',
                    'test_transaction_list_filters_by_involved_warehouse_and_source_type',
                    'test_transaction_source_audit_payload_and_extended_source_filters',
                ),
            ),
            EvidenceCheck(
                key='frontend_inventory_nxt_source',
                label='Inventory NXT source breakdown UI/CSV Playwright mock',
                path='frontend/tests/e2e/inventory-ledger-audit-ux.spec.ts',
                contains=(
                    'inventory ledger exposes audit filters and NXT panel',
                    'inventory-nxt-source-breakdown-10-1',
                    'inventory-nxt-export-csv',
                ),
            ),
        ),
        operator_checklist=(
            'Check PURCHASE/PRODUCTION/STOCKTAKE/TRANSFER/MANUAL source groups.',
            'Compare CSV source columns with unchanged opening/in/out/closing totals.',
        ),
        real_dev_gate='Inventory real-data audit drill needs a fresh backup and explicit DB approval.',
        risk_focus='Users can misread source movement while the numeric NXT totals remain correct.',
    ),
    Round2Scenario(
        key='ops_readiness_round2',
        domain='Ops',
        title='Ops release readiness read-only gate',
        objective='Reconfirm no pending migrations, Django check, release readiness, and backup/restore/alert readiness remain OK.',
        priority='P1',
        classifications=('read_only_command', 'real_dev_db_gate'),
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
                key='backend_cleanup_plan_read_only',
                label='UAT cleanup plan read-only safety regressions',
                path='backend/core/tests_uat_scenario_pack.py',
                contains=(
                    'test_cleanup_plan_is_read_only_and_blocks_broad_prefixes',
                    'test_cleanup_execute_dry_run_is_default_and_does_not_write',
                ),
            ),
        ),
        operator_checklist=(
            'Run migrate --plan, check, and release_readiness only after approval.',
            'Treat backup, restore, cleanup, deploy, and real-dev write as separate VANG approvals.',
        ),
        real_dev_gate='Backup, restore, cleanup, deploy, smoke server, or real-dev write must be approved separately.',
        risk_focus='Ops drift can make a broad UAT run unsafe even when feature evidence is green.',
    ),
)


def _repo_root() -> Path:
    return Path(settings.BASE_DIR).parent


def _check_evidence(repo_root: Path, evidence: EvidenceCheck) -> dict:
    path = repo_root / evidence.path
    exists = path.exists()
    content = path.read_text(encoding='utf-8', errors='ignore') if exists else ''
    missing_patterns = [item for item in evidence.contains if item not in content]
    return {
        'key': evidence.key,
        'label': evidence.label,
        'path': evidence.path.replace('\\', '/'),
        'status': 'ok' if exists and not missing_patterns else 'warning',
        'exists': exists,
        'missing_patterns': missing_patterns,
    }


def _classification_counts(scenarios: list[dict]) -> dict:
    counts = {key: 0 for key in CLASSIFICATION_LABELS}
    for scenario in scenarios:
        for key in scenario['classifications']:
            counts[key] += 1
    return counts


def _domain_counts(scenarios: list[dict]) -> dict:
    counts: dict[str, int] = {}
    for scenario in scenarios:
        counts[scenario['domain']] = counts.get(scenario['domain'], 0) + 1
    return counts


def build_uat_round2_scenario_pack(repo_root: Path | None = None) -> dict:
    root = repo_root or _repo_root()
    scenario_rows = []
    for scenario in ROUND2_SCENARIOS:
        evidence_rows = [_check_evidence(root, item) for item in scenario.evidence]
        warning_evidence = [item for item in evidence_rows if item['status'] != 'ok']
        scenario_rows.append({
            'key': scenario.key,
            'domain': scenario.domain,
            'title': scenario.title,
            'objective': scenario.objective,
            'priority': scenario.priority,
            'status': 'ok' if not warning_evidence else 'warning',
            'classifications': list(scenario.classifications),
            'classification_labels': [CLASSIFICATION_LABELS[item] for item in scenario.classifications],
            'evidence': evidence_rows,
            'operator_checklist': list(scenario.operator_checklist),
            'real_dev_gate': scenario.real_dev_gate,
            'risk_focus': scenario.risk_focus,
        })

    summary = {
        'scenario_count': len(scenario_rows),
        'ok_count': len([item for item in scenario_rows if item['status'] == 'ok']),
        'warning_count': len([item for item in scenario_rows if item['status'] == 'warning']),
        'classification_counts': _classification_counts(scenario_rows),
        'domain_counts': _domain_counts(scenario_rows),
    }
    return {
        'generated_at': timezone.now(),
        'pack': 'ERP Main UAT Round 2 Scenario Selection v1',
        'command': 'erp_main_uat_round2_scenarios',
        'mode': 'read_only_static_repository_check',
        'overall_status': 'ok' if summary['warning_count'] == 0 else 'warning',
        'context': {
            'previous_checkpoint': 'checkpoint-9q-inventory-nxt-source-breakdown-v1',
            'previous_head': '56d001d Add inventory NXT source breakdown UI',
            'recent_milestones': list(RECENT_MILESTONES),
            'qa_uat9h_status': 'cleaned_up_post_count_0',
            'qa_shf1_status': 'retained_for_shop_floor_audit',
        },
        'summary': summary,
        'classification_reference': CLASSIFICATION_LABELS,
        'scenarios': scenario_rows,
        'recommended_read_only_commands': [
            'python manage.py erp_main_uat_round2_scenarios --format markdown',
            'python manage.py erp_main_uat_round2_scenarios --format json',
            'python manage.py erp_main_uat_scenarios --format markdown',
            'python manage.py erp_main_shop_floor_handoff_drill --format markdown',
            'python manage.py erp_main_shop_floor_handoff_real_dev_drill --prefix QA_SHF1_ --format markdown --backup-path <verified-backup-path>',
            'python manage.py erp_main_uat_cleanup_plan --prefix QA_UAT9H_ --format markdown',
            'python manage.py release_readiness',
        ],
        'real_dev_db_gate_requirements': [
            'Separate VANG approval is required before any real-dev DB write.',
            'Use a fresh, specific prefix for new Round 2 data.',
            'Create and verify a fresh backup before any write.',
            'Require migrate --plan with no pending migrations.',
            'Require manage.py check PASS and release_readiness OK.',
            'Run dry-run/report first and do not run any confirm-write path unless explicitly approved.',
            'No cleanup or restore is part of Round 2 scenario selection.',
        ],
        'safety': {
            'writes_database': False,
            'creates_uat_data': False,
            'confirm_write_runs': False,
            'cleanup_runs': False,
            'backup_restore_runs': False,
            'migration_runs': False,
            'deploy_runs': False,
            'smoke_http_runs': False,
            'credentials_printed': False,
            'qc_printing_in_scope': False,
        },
        'out_of_scope': [
            'real-dev UAT execution',
            'new DB data creation',
            'confirm-write paths',
            'backup, restore, cleanup, deploy, or migration execution',
            'production posting, material reservation, costing, valuation, tax, or accounting changes',
            'QC Printing',
        ],
        'next_step': 'Approve G2 Playwright Round 2 mock coverage refresh, or approve a separate gated real-dev UAT planning step.',
    }


def render_markdown(payload: dict) -> str:
    lines = [
        f"# {payload['pack']}",
        '',
        f"- Status: {str(payload['overall_status']).upper()}",
        f"- Mode: {payload['mode']}",
        f"- Scenarios: {payload['summary']['ok_count']}/{payload['summary']['scenario_count']} OK",
        f"- Previous checkpoint: `{payload['context']['previous_checkpoint']}`",
        f"- QA_UAT9H_: {payload['context']['qa_uat9h_status']}",
        f"- QA_SHF1_: {payload['context']['qa_shf1_status']}",
        '',
        '## Classification reference',
    ]
    for key, label in payload['classification_reference'].items():
        lines.append(f"- {key}: {label}")

    lines.extend(['', '## Round 2 scenarios'])
    for scenario in payload['scenarios']:
        lines.extend([
            '',
            f"### {scenario['domain']} - {scenario['title']}",
            f"- Key: {scenario['key']}",
            f"- Priority: {scenario['priority']}",
            f"- Status: {str(scenario['status']).upper()}",
            f"- Objective: {scenario['objective']}",
            f"- Classification: {', '.join(scenario['classification_labels'])}",
            f"- Real-dev gate: {scenario['real_dev_gate']}",
            f"- Risk focus: {scenario['risk_focus']}",
            '- Evidence:',
        ])
        for evidence in scenario['evidence']:
            suffix = ''
            if evidence['missing_patterns']:
                suffix = f" missing={len(evidence['missing_patterns'])}"
            lines.append(f"  - {str(evidence['status']).upper()}: {evidence['label']} ({evidence['path']}){suffix}")
        lines.append('- Operator checklist:')
        for index, step in enumerate(scenario['operator_checklist'], start=1):
            lines.append(f"  {index}. {step}")

    lines.extend(['', '## Recommended read-only commands'])
    lines.extend([f"- `{item}`" for item in payload['recommended_read_only_commands']])
    lines.extend(['', '## Real-dev DB gate requirements'])
    lines.extend([f"- {item}" for item in payload['real_dev_db_gate_requirements']])
    lines.extend(['', '## Safety'])
    lines.extend([f"- {key}: {value}" for key, value in payload['safety'].items()])
    lines.extend(['', '## Out of scope'])
    lines.extend([f"- {item}" for item in payload['out_of_scope']])
    lines.extend(['', f"Next step: {payload['next_step']}"])
    return '\n'.join(lines)


class Command(BaseCommand):
    help = 'Print a read-only ERP main UAT Round 2 scenario selection pack'

    def add_arguments(self, parser):
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')
        parser.add_argument('--strict', action='store_true', help='Exit non-zero when any Round 2 evidence is missing')

    def handle(self, *args, **options):
        payload = build_uat_round2_scenario_pack()
        if options['format'] == 'json':
            self.stdout.write(json.dumps(payload, ensure_ascii=True, indent=2, default=str))
        else:
            self.stdout.write(render_markdown(payload))

        if options.get('strict') and payload['overall_status'] != 'ok':
            raise CommandError('ERP main UAT Round 2 scenario pack has missing evidence.')
