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

OPERATOR_WORDING = {
    'floor_signal': 'Tín hiệu sàn máy',
    'machine_down': 'Báo máy dừng',
    'wait_material': 'Chờ vật tư',
    'clear_to_run': 'Sẵn chạy',
    'handover': 'Bàn giao',
    'handover_ready': 'Bàn giao sẵn sàng',
    'handover_accepted': 'Đã nhận bàn giao',
    'result_update': 'Cập nhật kết quả',
    'skip_with_reason': 'Bỏ qua có lý do',
    'done_update': 'Hoàn tất/cập nhật',
    'advisory_only': 'Chỉ cảnh báo, không chặn workflow',
    'execution_audit': 'Audit thực thi',
}

SCENARIOS: tuple[DrillScenario, ...] = (
    DrillScenario(
        key='receive_work_from_planning_board',
        title='Nhận việc từ PlanningBoard và đối chiếu Audit thực thi',
        operator_goal='Operator tìm đúng công việc, xem READY/WARNING/BLOCKER, rồi đối chiếu cùng công đoạn ở ProductionOrder detail.',
        entrypoints=('/production-planning', '/production-orders'),
        steps=(
            'Mở PlanningBoard và chọn một thẻ công đoạn READY.',
            'Mở drawer công đoạn, xem khu READY/WARNING/BLOCKER và Audit thực thi.',
            'Mở ProductionOrder detail và đối chiếu execution_handoff/audit fields.',
        ),
        expected_result='Trạng thái, bàn giao, thao tác gần nhất, người thao tác, thời điểm và note hiển thị nhất quán ở hai màn.',
        audit_focus='execution_handoff là Chỉ cảnh báo, không chặn workflow.',
        evidence=FRONTEND_EVIDENCE,
    ),
    DrillScenario(
        key='ready_warning_blocker_advisory',
        title='READY / WARNING / BLOCKER là chỉ cảnh báo',
        operator_goal='Planner/operator phân biệt việc sẵn chạy, cảnh báo và blocker mà không thêm luật hard-block mới.',
        entrypoints=('/production-planning',),
        steps=(
            'Rà thẻ READY, WARNING và BLOCKER trên PlanningBoard.',
            'Lọc theo readiness và xem hướng dẫn hành động tiếp theo.',
            'Xác nhận công đoạn bị dependency block không đi qua shortcut Sẵn chạy/Bàn giao.',
        ),
        expected_result='Nhãn Chỉ cảnh báo, không chặn workflow giải thích bước tiếp theo; validation dependency hiện có vẫn là gate.',
        audit_focus='workflow_blocking remains false in execution_handoff and ready-to-dispatch rules.',
        evidence=(
            BACKEND_EVIDENCE[3],
            FRONTEND_EVIDENCE[0],
        ),
    ),
    DrillScenario(
        key='machine_down_signal',
        title='Tín hiệu sàn máy - Báo máy dừng',
        operator_goal='Operator báo máy dừng với người phụ trách và note, đồng thời giữ Audit thực thi.',
        entrypoints=('/production-planning', 'POST /api/production/orders/shop_floor_signal/'),
        steps=(
            'Chọn một công đoạn hợp lệ.',
            'Bấm Báo máy dừng và gửi signal_code MACHINE_DOWN với note/owner.',
            'Refresh PlanningBoard và ProductionOrder detail.',
        ),
        expected_result='Công đoạn có MACHINE_DOWN, note/owner hiển thị rõ, latest audit action là SIGNAL.',
        audit_focus='Audit thực thi lưu action SIGNAL và note context.',
        evidence=(
            BACKEND_EVIDENCE[0],
            FRONTEND_EVIDENCE[0],
        ),
    ),
    DrillScenario(
        key='wait_material_signal',
        title='Tín hiệu sàn máy - Chờ vật tư',
        operator_goal='Operator báo Chờ vật tư mà không posting inventory hoặc reservation.',
        entrypoints=('/production-planning', 'POST /api/production/orders/shop_floor_signal/'),
        steps=(
            'Chọn một công đoạn hợp lệ.',
            'Bấm Chờ vật tư và gửi signal_code WAIT_MATERIAL với note.',
            'Xác nhận Chờ vật tư hiển thị như chỉ cảnh báo/action item.',
        ),
        expected_result='Operation carries WAIT_MATERIAL note and latest audit action SIGNAL; no inventory movement is posted.',
        audit_focus='Signal chỉ cập nhật block/bàn giao/audit fields, không costing, valuation hoặc material reservation.',
        evidence=(
            BACKEND_EVIDENCE[1],
            FRONTEND_EVIDENCE[0],
        ),
    ),
    DrillScenario(
        key='clear_to_run_and_handover',
        title='Sẵn chạy và Bàn giao',
        operator_goal='Operator đánh dấu công đoạn đủ điều kiện là Sẵn chạy, sau đó ghi Bàn giao sẵn sàng/Đã nhận bàn giao với receiver/note.',
        entrypoints=('/production-planning', 'POST /api/production/orders/shop_floor_handover/'),
        steps=(
            'Chọn công đoạn không bị dependency block.',
            'Bấm Sẵn chạy hoặc Bàn giao sẵn sàng.',
            'Bấm Đã nhận bàn giao với receiver/note và clear previous wait khi hợp lệ.',
        ),
        expected_result='Bàn giao, thời điểm, receiver, note và latest audit action HANDOVER hiển thị rõ.',
        audit_focus='Dependency-blocked operations remain protected by existing validation.',
        evidence=(
            BACKEND_EVIDENCE[2],
            FRONTEND_EVIDENCE[0],
        ),
    ),
    DrillScenario(
        key='skip_with_reason',
        title='Cập nhật kết quả - Bỏ qua có lý do',
        operator_goal='Operator chỉ bỏ qua công đoạn qua nút Bỏ qua và phải nhập lý do rõ ràng.',
        entrypoints=('/production-planning', 'POST /api/production/orders/{id}/skip_operation/'),
        steps=(
            'Mở detail của công đoạn đã chọn.',
            'Dùng hành động Bỏ qua và nhập lý do.',
            'Xác nhận bulk/update status không đi đường SKIPPED sai luồng.',
        ),
        expected_result='Công đoạn thành SKIPPED, lý do/người/thời điểm hiển thị, latest audit action là SKIP_OPERATION.',
        audit_focus='Bỏ qua có lý do là thao tác explicit và auditable.',
        evidence=(
            BACKEND_EVIDENCE[3],
            FRONTEND_EVIDENCE[0],
        ),
    ),
    DrillScenario(
        key='done_update_audit',
        title='Cập nhật kết quả - Hoàn tất/cập nhật',
        operator_goal='Operator hoàn tất/cập nhật công đoạn với số lượng và note, đồng thời giữ Audit thực thi.',
        entrypoints=('/production-planning', 'POST /api/production/orders/{id}/update_operation/'),
        steps=(
            'Mở công đoạn đủ điều kiện.',
            'Cập nhật trạng thái, completed quantity và note.',
            'Rà audit row ở ProductionOrder detail.',
        ),
        expected_result='Latest audit action là UPDATE và thông tin hoàn tất hiển thị, không có posting/costing side effects.',
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
        'operator_wording': OPERATOR_WORDING,
        'scenarios': scenario_rows,
        'operator_checklist': [
            'PlanningBoard: nhóm Tín hiệu sàn máy gồm Báo máy dừng, Chờ vật tư và Sẵn chạy.',
            'Bàn giao: dùng Bàn giao sẵn sàng hoặc Đã nhận bàn giao cho công đoạn đủ điều kiện.',
            'Cập nhật kết quả: dùng Bỏ qua có lý do hoặc Hoàn tất/cập nhật, luôn kiểm tra note/số lượng trước khi lưu.',
            'Luôn đọc nhãn Chỉ cảnh báo, không chặn workflow trước khi thao tác.',
            'Đối chiếu Audit thực thi: ai thao tác, lúc nào, note/lý do, last action và execution_handoff.',
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
        '## Operator wording',
    ]
    for key, value in payload['operator_wording'].items():
        lines.append(f"- {key}: {value}")
    lines.extend([
        '',
        '## Shop-floor drill scenarios',
    ])
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


def _safe_for_stdout(text: str, stdout) -> str:
    stream = getattr(stdout, '_out', stdout)
    encoding = getattr(stream, 'encoding', None)
    if not encoding:
        return text
    try:
        text.encode(encoding)
    except UnicodeEncodeError:
        return text.encode('ascii', errors='backslashreplace').decode('ascii')
    return text


class Command(BaseCommand):
    help = 'Print a read-only ERP main shop-floor handoff drill pack with repository evidence checks'

    def add_arguments(self, parser):
        parser.add_argument('--format', choices=['markdown', 'json'], default='markdown', help='Output format')
        parser.add_argument('--strict', action='store_true', help='Exit non-zero when any scenario evidence is missing')

    def handle(self, *args, **options):
        payload = build_shop_floor_handoff_drill_pack()
        if options['format'] == 'json':
            self.stdout.write(json.dumps(payload, ensure_ascii=True, indent=2, default=str))
        else:
            self.stdout.write(_safe_for_stdout(render_markdown(payload), self.stdout))

        if options.get('strict') and payload['overall_status'] != 'ok':
            raise CommandError('Shop-floor handoff drill pack has missing evidence.')
