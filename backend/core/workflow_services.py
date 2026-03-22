"""
Dịch vụ sinh task tự động từ WorkflowTaskTemplate.
"""
from datetime import timedelta
from django.utils import timezone
from django.db import models
from django.core.cache import cache
from typing import Optional
import uuid
import traceback

WORKFLOW_PLAYBOOKS = {
    'SalesOrder': {
        'STANDARD_ORDER': {
            'name': 'Quy trình đơn hàng carton chuẩn',
            'description': 'Tự động tạo chuỗi xử lý đơn hàng từ tiếp nhận đến giao hàng.',
            'items': [
                {
                    'trigger': 'SUBMIT',
                    'title_template': 'Xác nhận thông tin đơn {entity_code}',
                    'description_template': 'Kiểm tra thông tin khách hàng, quy cách, số lượng và hạn chót.',
                    'due_in_days': 1,
                    'priority': 'HIGH',
                    'is_blocking': True,
                    'blocks_action': 'APPROVE',
                    'tags': ['sales', 'xac-nhan-don', 'sla:8h'],
                },
                {
                    'trigger': 'SUBMIT',
                    'title_template': 'Lập kế hoạch vật tư cho đơn {entity_code}',
                    'description_template': 'Tính toán giấy, mực in, keo và phụ kiện theo định mức.',
                    'due_in_days': 1,
                    'priority': 'HIGH',
                    'is_blocking': True,
                    'blocks_action': 'RELEASE',
                    'tags': ['mua-hang', 'vat-tu', 'sla:12h'],
                },
                {
                    'trigger': 'SUBMIT',
                    'title_template': 'Điều độ sản xuất đơn {entity_code}',
                    'description_template': 'Xếp máy, ca sản xuất, theo dõi tiến độ và xử lý vướng mắc.',
                    'due_in_days': 2,
                    'priority': 'MEDIUM',
                    'is_blocking': True,
                    'blocks_action': 'POST',
                    'tags': ['san-xuat', 'dieu-do', 'sla:24h'],
                },
                {
                    'trigger': 'SUBMIT',
                    'title_template': 'QC thành phẩm đơn {entity_code}',
                    'description_template': 'Kiểm tra kích thước, màu in, độ bền và tỷ lệ lỗi.',
                    'due_in_days': 1,
                    'priority': 'HIGH',
                    'is_blocking': True,
                    'blocks_action': 'POST',
                    'tags': ['qc', 'chat-luong', 'sla:8h'],
                },
                {
                    'trigger': 'SUBMIT',
                    'title_template': 'Chuẩn bị giao hàng đơn {entity_code}',
                    'description_template': 'Đóng gói, lập lịch giao, xác nhận biên bản bàn giao.',
                    'due_in_days': 1,
                    'priority': 'MEDIUM',
                    'is_blocking': False,
                    'blocks_action': '',
                    'tags': ['logistics', 'giao-hang', 'sla:12h'],
                },
            ],
        },
    },
    'Product': {
        'SAMPLE_DEVELOPMENT': {
            'name': 'Quy trình làm mẫu sản phẩm',
            'description': 'Bộ mẫu quy trình từ tiếp nhận yêu cầu mẫu đến chốt mẫu.',
            'items': [
                {
                    'trigger': 'MANUAL',
                    'title_template': 'Tiếp nhận yêu cầu làm mẫu {entity_code}',
                    'description_template': 'Tổng hợp yêu cầu kỹ thuật, quy cách và hạn chót làm mẫu.',
                    'due_in_days': 1,
                    'priority': 'HIGH',
                    'is_blocking': False,
                    'blocks_action': '',
                    'tags': ['lam-mau', 'yeu-cau', 'sla:8h'],
                },
                {
                    'trigger': 'MANUAL',
                    'title_template': 'Thiết kế cấu trúc carton {entity_code}',
                    'description_template': 'Thiết kế kết cấu, chất liệu, bản vẽ và thông số kỹ thuật.',
                    'due_in_days': 2,
                    'priority': 'HIGH',
                    'is_blocking': True,
                    'blocks_action': 'APPROVE',
                    'tags': ['thiet-ke', 'ky-thuat', 'sla:16h'],
                },
                {
                    'trigger': 'MANUAL',
                    'title_template': 'Duyệt mẫu nội bộ {entity_code}',
                    'description_template': 'Đánh giá mẫu thử với bộ phận kinh doanh và kỹ thuật.',
                    'due_in_days': 1,
                    'priority': 'MEDIUM',
                    'is_blocking': True,
                    'blocks_action': 'APPROVE',
                    'tags': ['duyet-mau', 'sla:8h'],
                },
                {
                    'trigger': 'MANUAL',
                    'title_template': 'Gửi mẫu khách hàng {entity_code}',
                    'description_template': 'Bàn giao mẫu và thu thập phản hồi để điều chỉnh.',
                    'due_in_days': 2,
                    'priority': 'MEDIUM',
                    'is_blocking': False,
                    'blocks_action': '',
                    'tags': ['khach-hang', 'feedback', 'sla:16h'],
                },
                {
                    'trigger': 'MANUAL',
                    'title_template': 'Chốt mẫu và cập nhật BOM {entity_code}',
                    'description_template': 'Cập nhật BOM, thông số sản xuất và tài liệu liên quan.',
                    'due_in_days': 1,
                    'priority': 'HIGH',
                    'is_blocking': True,
                    'blocks_action': 'POST',
                    'tags': ['bom', 'chot-mau', 'sla:8h'],
                },
            ],
        },
    },
    'Customer': {
        'CUSTOMER_ONBOARDING': {
            'name': 'Quy trình khởi tạo khách hàng',
            'description': 'Quy trình tiếp nhận và kích hoạt khách hàng mới.',
            'items': [
                {
                    'trigger': 'MANUAL',
                    'title_template': 'Kiểm tra hồ sơ khách hàng {entity_code}',
                    'description_template': 'Xác minh thông tin pháp lý, MST và thông tin liên hệ.',
                    'due_in_days': 1,
                    'priority': 'MEDIUM',
                    'is_blocking': False,
                    'blocks_action': '',
                    'tags': ['khach-hang', 'ho-so', 'sla:8h'],
                },
                {
                    'trigger': 'MANUAL',
                    'title_template': 'Thẩm định hạn mức công nợ {entity_code}',
                    'description_template': 'Đánh giá hạn mức, điều khoản thanh toán và rủi ro.',
                    'due_in_days': 2,
                    'priority': 'HIGH',
                    'is_blocking': True,
                    'blocks_action': 'APPROVE',
                    'tags': ['cong-no', 'tham-dinh', 'sla:16h'],
                },
                {
                    'trigger': 'MANUAL',
                    'title_template': 'Kích hoạt khách hàng trên hệ thống {entity_code}',
                    'description_template': 'Hoàn tất cấu hình bảng giá, chính sách giao nhận và người phụ trách.',
                    'due_in_days': 1,
                    'priority': 'MEDIUM',
                    'is_blocking': False,
                    'blocks_action': '',
                    'tags': ['kich-hoat', 'master-data', 'sla:8h'],
                },
            ],
        },
    },
    'PurchaseOrder': {
        'STANDARD_PROCUREMENT': {
            'name': 'Quy trình mua hàng tiêu chuẩn',
            'description': 'Theo dõi đơn mua từ lúc gửi duyệt đến khi nhận hàng.',
            'items': [
                {
                    'trigger': 'SUBMIT',
                    'title_template': 'Rà soát nhu cầu đơn mua {entity_code}',
                    'description_template': 'Kiểm tra số lượng, giá mua, thời hạn nhận và mức độ cấp bách.',
                    'due_in_days': 1,
                    'priority': 'HIGH',
                    'is_blocking': True,
                    'blocks_action': 'APPROVE',
                    'tags': ['mua-hang', 'tham-dinh', 'sla:8h'],
                },
                {
                    'trigger': 'SUBMIT',
                    'title_template': 'Xác nhận NCC và thời gian cung ứng {entity_code}',
                    'description_template': 'Làm việc với nhà cung cấp để chốt điều kiện nhận hàng và thanh toán.',
                    'due_in_days': 1,
                    'priority': 'MEDIUM',
                    'is_blocking': True,
                    'blocks_action': 'APPROVE',
                    'tags': ['nha-cung-cap', 'lead-time', 'sla:8h'],
                },
                {
                    'trigger': 'APPROVE',
                    'title_template': 'Theo dõi nhận hàng đơn mua {entity_code}',
                    'description_template': 'Chủ động bám tiến độ, chuẩn bị kho và xử lý trường hợp giao thiếu.',
                    'due_in_days': 2,
                    'priority': 'MEDIUM',
                    'is_blocking': True,
                    'blocks_action': 'RECEIVE',
                    'tags': ['nhan-hang', 'kho', 'sla:24h'],
                },
            ],
        },
    },
    'ProductionOrder': {
        'STANDARD_PRODUCTION': {
            'name': 'Quy trình sản xuất tiêu chuẩn',
            'description': 'Theo dõi lệnh sản xuất từ phát lệnh đến nhập kho thành phẩm.',
            'items': [
                {
                    'trigger': 'RELEASE',
                    'title_template': 'Chuẩn bị vật tư cho lệnh {entity_code}',
                    'description_template': 'Kiểm tra vật tư, nguồn cấp và sẵn sàng trước khi chạy lệnh.',
                    'due_in_days': 1,
                    'priority': 'HIGH',
                    'is_blocking': True,
                    'blocks_action': 'ISSUE',
                    'tags': ['san-xuat', 'vat-tu', 'sla:8h'],
                },
                {
                    'trigger': 'RELEASE',
                    'title_template': 'Điều phối công đoạn lệnh {entity_code}',
                    'description_template': 'Theo dõi tiến độ các công đoạn và gỡ nghẽn trong suốt ca sản xuất.',
                    'due_in_days': 1,
                    'priority': 'HIGH',
                    'is_blocking': True,
                    'blocks_action': 'RECEIVE',
                    'tags': ['dieu-do', 'cong-doan', 'sla:12h'],
                },
                {
                    'trigger': 'RECEIVE',
                    'title_template': 'QC thành phẩm lệnh {entity_code}',
                    'description_template': 'Rà soát thành phẩm đã nhập kho và xác nhận chất lượng cuối.',
                    'due_in_days': 1,
                    'priority': 'MEDIUM',
                    'is_blocking': False,
                    'blocks_action': '',
                    'tags': ['qc', 'thanh-pham', 'sla:8h'],
                },
            ],
        },
    },
}


def _resolve_assigned_to(assign_rule: dict):
    """
    Giải quyết người được gán từ assign_rule JSON.
    Returns User instance hoặc None.
    """
    from core.models import User, Role

    if not assign_rule or not isinstance(assign_rule, dict):
        return None

    rule_type = assign_rule.get('type', '')

    if rule_type == 'user':
        user_id = assign_rule.get('id')
        try:
            return User.objects.get(pk=user_id, is_active=True)
        except User.DoesNotExist:
            return None

    if rule_type == 'role':
        role_value = assign_rule.get('value', '')
        try:
            role = Role.objects.get(code=role_value, is_active=True)
            user = role.user_set.filter(is_active=True).order_by('id').first()
            return user
        except Role.DoesNotExist:
            return None

    return None


def _interpolate(template: str, context: dict) -> str:
    """Nội suy {placeholder} an toàn, bỏ qua key không tìm thấy."""
    try:
        return template.format_map(context)
    except (KeyError, IndexError):
        return template


def generate_tasks_for_entity(
    entity_type: str,
    entity_id: int,
    entity_code: str,
    trigger: str,
    triggered_by=None,
) -> list:
    """
    Sinh Task từ các WorkflowTaskTemplate phù hợp.

    Idempotency: mỗi task có source_key duy nhất dạng
    ``wft-{template_id}-{entity_type}-{entity_id}``.
    Nếu task với source_key đó đã tồn tại → bỏ qua.

    Returns list of newly created Task objects.
    """
    from core.models import Task, WorkflowTaskTemplate

    templates = WorkflowTaskTemplate.objects.filter(
        entity_type=entity_type,
        trigger=trigger,
        is_active=True,
    ).order_by('sort_order', 'id')

    context = {
        'entity_code': entity_code or '',
        'entity_type': entity_type,
        'trigger': trigger,
    }

    created = []
    today = timezone.now().date()

    previous_task = None
    for tmpl in templates:
        source_key = f'wft-{tmpl.id}-{entity_type}-{entity_id}'

        existing_task = Task.objects.filter(source_key=source_key).first()
        if existing_task:
            previous_task = existing_task
            continue

        title = _interpolate(tmpl.title_template, context)
        description = _interpolate(tmpl.description_template, context)
        assigned_to = _resolve_assigned_to(tmpl.assign_rule)
        due_date = today + timedelta(days=tmpl.due_in_days) if tmpl.due_in_days else None
        depends_on_task = previous_task if tmpl.depends_on_previous else None

        task = Task.objects.create(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code or '',
            title=title,
            description=description,
            assigned_to=assigned_to,
            assigned_by=triggered_by,
            depends_on=depends_on_task,
            priority=tmpl.priority,
            is_blocking=tmpl.is_blocking,
            blocks_action=tmpl.blocks_action or '',
            tags=list(tmpl.tags or []),
            due_date=due_date,
            source_key=source_key,
        )
        created.append(task)
        previous_task = task

    return created


def preview_tasks_for_entity(
    entity_type: str,
    entity_id: int,
    entity_code: str,
    trigger: str,
) -> list:
    """
    Xem trước danh sách task sẽ được sinh (không tạo thật).
    Trả về list dict với trường ``would_skip`` nếu source_key đã tồn tại.
    """
    from core.models import Task, WorkflowTaskTemplate

    templates = WorkflowTaskTemplate.objects.filter(
        entity_type=entity_type,
        trigger=trigger,
        is_active=True,
    ).order_by('sort_order', 'id')

    context = {
        'entity_code': entity_code or '',
        'entity_type': entity_type,
        'trigger': trigger,
    }

    today = timezone.now().date()
    result = []

    previous_source_key = None
    for tmpl in templates:
        source_key = f'wft-{tmpl.id}-{entity_type}-{entity_id}'
        already_exists = Task.objects.filter(source_key=source_key).exists()
        assigned_to = _resolve_assigned_to(tmpl.assign_rule)
        due_date = (today + timedelta(days=tmpl.due_in_days)).isoformat() if tmpl.due_in_days else None
        depends_on_source_key = previous_source_key if tmpl.depends_on_previous else None

        result.append({
            'template_id': tmpl.id,
            'template_title': tmpl.title_template,
            'title': _interpolate(tmpl.title_template, context),
            'description': _interpolate(tmpl.description_template, context),
            'priority': tmpl.priority,
            'is_blocking': tmpl.is_blocking,
            'tags': tmpl.tags,
            'due_date': due_date,
            'assigned_to': assigned_to.username if assigned_to else None,
            'source_key': source_key,
            'depends_on_source_key': depends_on_source_key,
            'would_skip': already_exists,
        })
        previous_source_key = source_key

    return result


def _extract_template_id_from_source_key(source_key: str) -> Optional[int]:
    """
    Parse source_key dạng: wft-{template_id}-{entity_type}-{entity_id}
    """
    if not source_key:
        return None
    parts = source_key.split('-', 3)
    if len(parts) < 3 or parts[0] != 'wft':
        return None
    try:
        return int(parts[1])
    except (TypeError, ValueError):
        return None


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    idx = int(round((len(sorted_values) - 1) * q))
    idx = max(0, min(idx, len(sorted_values) - 1))
    return float(sorted_values[idx])


def _extract_sla_target_hours(tags: list | None) -> Optional[float]:
    """
    Đọc SLA target từ tags:
    - sla:24h
    - sla_h:24
    - sla-hour:24
    """
    if not tags:
        return None
    for raw in tags:
        tag = str(raw or '').strip().lower()
        if not tag:
            continue
        if tag.startswith('sla:') and tag.endswith('h'):
            value = tag[4:-1]
        elif tag.startswith('sla_h:'):
            value = tag[6:]
        elif tag.startswith('sla-hour:'):
            value = tag[9:]
        else:
            continue
        try:
            num = float(value)
            if num > 0:
                return num
        except ValueError:
            continue
    return None


def _extract_wip_limit(tags: list | None) -> Optional[int]:
    """
    Đọc WIP limit từ tags:
    - wip:10
    - wip_limit:10
    """
    if not tags:
        return None
    for raw in tags:
        tag = str(raw or '').strip().lower()
        if not tag:
            continue
        if tag.startswith('wip:'):
            value = tag[4:]
        elif tag.startswith('wip_limit:'):
            value = tag[10:]
        else:
            continue
        try:
            num = int(value)
            if num > 0:
                return num
        except ValueError:
            continue
    return None


def get_workflow_playbook_suggestions(entity_type: str, scenario: str | None = None) -> dict:
    """
    Lấy bộ gợi ý template workflow theo entity_type và scenario.
    """
    entity_playbooks = WORKFLOW_PLAYBOOKS.get(entity_type, {})
    if not entity_playbooks:
        return {
            'entity_type': entity_type,
            'scenario': scenario or '',
            'available_scenarios': [],
            'items': [],
            'meta': {'message': 'Chưa có playbook cho entity này.'},
        }

    available_scenarios = sorted(entity_playbooks.keys())
    chosen_scenario = scenario or available_scenarios[0]
    chosen = entity_playbooks.get(chosen_scenario)
    if not chosen:
        return {
            'entity_type': entity_type,
            'scenario': chosen_scenario,
            'available_scenarios': available_scenarios,
            'items': [],
            'meta': {'message': 'Scenario playbook không tồn tại cho entity này.'},
        }

    normalized_items = []
    for idx, item in enumerate(chosen.get('items', []), start=1):
        normalized_items.append({
            'entity_type': entity_type,
            'trigger': item.get('trigger', 'MANUAL'),
            'title_template': item.get('title_template', ''),
            'description_template': item.get('description_template', ''),
            'assign_rule': {},
            'due_in_days': int(item.get('due_in_days', 1) or 1),
            'priority': item.get('priority', 'MEDIUM'),
            'is_blocking': bool(item.get('is_blocking', False)),
            'blocks_action': item.get('blocks_action', ''),
            'tags': list(item.get('tags', [])),
            'depends_on_previous': idx > 1,
            'sort_order': idx,
            'is_active': True,
        })

    return {
        'entity_type': entity_type,
        'scenario': chosen_scenario,
        'name': chosen.get('name', chosen_scenario),
        'description': chosen.get('description', ''),
        'available_scenarios': available_scenarios,
        'items': normalized_items,
    }


def apply_workflow_playbook(
    entity_type: str,
    scenario: str | None = None,
    actor=None,
    overwrite_existing: bool = False,
) -> dict:
    """
    Áp dụng playbook vào bảng WorkflowTaskTemplate.
    """
    from core.models import WorkflowTaskTemplate

    suggestion = get_workflow_playbook_suggestions(entity_type=entity_type, scenario=scenario)
    items = suggestion.get('items', [])
    if not items:
        return {
            'success': False,
            'error': suggestion.get('meta', {}).get('message') or 'Không có dữ liệu playbook để áp dụng.',
            'created_count': 0,
            'updated_count': 0,
            'skipped_count': 0,
            'template_ids': [],
        }

    created_count = 0
    updated_count = 0
    skipped_count = 0
    template_ids = []

    for item in items:
        existing = WorkflowTaskTemplate.objects.filter(
            entity_type=entity_type,
            trigger=item['trigger'],
            title_template=item['title_template'],
            sort_order=item['sort_order'],
        ).first()
        if existing:
            if overwrite_existing:
                existing.description_template = item['description_template']
                existing.assign_rule = item['assign_rule']
                existing.due_in_days = item['due_in_days']
                existing.priority = item['priority']
                existing.is_blocking = item['is_blocking']
                existing.blocks_action = item['blocks_action']
                existing.tags = item['tags']
                existing.depends_on_previous = item['depends_on_previous']
                existing.is_active = item['is_active']
                existing.save(
                    update_fields=[
                        'description_template',
                        'assign_rule',
                        'due_in_days',
                        'priority',
                        'is_blocking',
                        'blocks_action',
                        'tags',
                        'depends_on_previous',
                        'is_active',
                        'updated_at',
                    ]
                )
                updated_count += 1
            else:
                skipped_count += 1
            template_ids.append(existing.id)
            continue

        created = WorkflowTaskTemplate.objects.create(
            entity_type=entity_type,
            trigger=item['trigger'],
            title_template=item['title_template'],
            description_template=item['description_template'],
            assign_rule=item['assign_rule'],
            due_in_days=item['due_in_days'],
            priority=item['priority'],
            is_blocking=item['is_blocking'],
            blocks_action=item['blocks_action'],
            tags=item['tags'],
            depends_on_previous=item['depends_on_previous'],
            sort_order=item['sort_order'],
            is_active=item['is_active'],
            created_by=actor,
        )
        created_count += 1
        template_ids.append(created.id)

    return {
        'success': True,
        'entity_type': entity_type,
        'scenario': suggestion.get('scenario'),
        'name': suggestion.get('name'),
        'created_count': created_count,
        'updated_count': updated_count,
        'skipped_count': skipped_count,
        'template_ids': template_ids,
    }


def build_workflow_pipeline_board(
    entity_type: str,
    trigger: str = 'SUBMIT',
    limit: int = 200,
) -> dict:
    """
    Tổng hợp board pipeline theo template workflow cho entity.
    Hỗ trợ linh hoạt SalesOrder/Product/Customer (và các entity khác có task nguồn từ template).
    """
    from core.models import Task, WorkflowTaskTemplate

    templates = list(
        WorkflowTaskTemplate.objects.filter(
            entity_type=entity_type,
            trigger=trigger,
            is_active=True,
        ).order_by('sort_order', 'id')
    )
    if not templates:
        return {
            'entity_type': entity_type,
            'trigger': trigger,
            'columns': [],
            'meta': {
                'total_cards': 0,
                'message': 'Chưa có template active cho entity/trigger này.',
                'diagnostic_code': 'NO_TEMPLATE',
                'hints': [
                    'Tạo ít nhất 1 template active cho đúng Entity + Trigger.',
                    'Kiểm tra bộ lọc trigger đang chọn trên màn Pipeline.',
                ],
            },
        }

    template_id_set = {t.id for t in templates}

    columns = []
    for tmpl in templates:
        columns.append({
            'id': f'tmpl-{tmpl.id}',
            'template_id': tmpl.id,
            'title': tmpl.title_template,
            'wip_limit': _extract_wip_limit(tmpl.tags),
            'is_over_wip': False,
            'cards': [],
        })
    columns.extend([
        {'id': 'done', 'template_id': None, 'title': 'Done', 'wip_limit': None, 'is_over_wip': False, 'cards': []},
        {'id': 'failed', 'template_id': None, 'title': 'Failed', 'wip_limit': None, 'is_over_wip': False, 'cards': []},
    ])

    col_index = {col['id']: col for col in columns}
    card_count = 0
    today = timezone.localdate()
    at_risk_date = today + timedelta(days=1)

    entities = []
    entity_meta = {}

    if entity_type == 'SalesOrder':
        from sales.models import SalesOrder, SalesOrderStatus

        sales_orders = list(
            SalesOrder.objects
            .select_related('owner', 'team')
            .exclude(status=SalesOrderStatus.DRAFT)
            .order_by('-updated_at', '-id')[:limit]
        )
        entities = [o.id for o in sales_orders]
        for order in sales_orders:
            entity_meta[order.id] = {
                'entity_code': order.code or f'#{order.id}',
                'status': order.status or '',
                'owner': order.owner.get_full_name() if order.owner else '',
                'team': order.team.name if order.team else '',
                'updated_at': order.updated_at.isoformat() if order.updated_at else None,
            }
    elif entity_type == 'PurchaseOrder':
        from purchasing.models import PurchaseOrder

        purchase_orders = list(
            PurchaseOrder.objects
            .select_related('owner', 'team')
            .exclude(status='DRAFT')
            .order_by('-updated_at', '-id')[:limit]
        )
        entities = [o.id for o in purchase_orders]
        for order in purchase_orders:
            entity_meta[order.id] = {
                'entity_code': order.code or f'#{order.id}',
                'status': order.status or '',
                'owner': order.owner.get_full_name() if order.owner else '',
                'team': order.team.name if order.team else '',
                'updated_at': order.updated_at.isoformat() if order.updated_at else None,
            }
    elif entity_type == 'ProductionOrder':
        from production.models import ProductionOrder

        production_orders = list(
            ProductionOrder.objects
            .select_related('owner', 'team')
            .exclude(status='DRAFT')
            .order_by('-updated_at', '-id')[:limit]
        )
        entities = [o.id for o in production_orders]
        for order in production_orders:
            entity_meta[order.id] = {
                'entity_code': order.code or f'#{order.id}',
                'status': order.status or '',
                'owner': order.owner.get_full_name() if order.owner else '',
                'team': order.team.name if order.team else '',
                'updated_at': order.updated_at.isoformat() if order.updated_at else None,
            }
    else:
        pipeline_tasks = (
            Task.objects
            .filter(entity_type=entity_type)
            .exclude(source_key__isnull=True)
            .order_by('-updated_at', '-id')
        )
        seen = set()
        for task in pipeline_tasks:
            template_id = _extract_template_id_from_source_key(task.source_key or '')
            if template_id not in template_id_set:
                continue
            if task.entity_id in seen:
                continue
            seen.add(task.entity_id)
            entities.append(task.entity_id)
            entity_meta[task.entity_id] = {
                'entity_code': task.entity_code or f'#{task.entity_id}',
                'status': '',
                'owner': '',
                'team': '',
                'updated_at': task.updated_at.isoformat() if task.updated_at else None,
            }
            if len(entities) >= limit:
                break

    if not entities:
        return {
            'entity_type': entity_type,
            'trigger': trigger,
            'columns': columns,
            'meta': {
                'total_cards': 0,
                'template_count': len(templates),
                'message': 'Chưa có dữ liệu pipeline cho entity/trigger này.',
                'diagnostic_code': 'NO_ENTITY_RECORD',
                'hints': [
                    'Tạo dữ liệu entity (đơn hàng/sản phẩm/khách hàng) trước.',
                    'Áp template để sinh task theo workflow.',
                    'Với SalesOrder, cần đơn hàng ngoài trạng thái nháp để lên board.',
                ],
            },
        }

    tasks = (
        Task.objects
        .select_related('assigned_to')
        .filter(entity_type=entity_type, entity_id__in=entities)
        .exclude(source_key__isnull=True)
    )

    tasks_by_entity_and_template = {}
    for task in tasks:
        template_id = _extract_template_id_from_source_key(task.source_key or '')
        if template_id is None or template_id not in template_id_set:
            continue
        tasks_by_entity_and_template[(task.entity_id, template_id)] = task

    for entity_id in entities:
        step_statuses = []
        for tmpl in templates:
            task = tasks_by_entity_and_template.get((entity_id, tmpl.id))
            if not task:
                step_statuses.append(('PENDING', None))
            else:
                step_statuses.append((task.status, task))

        if any(status == Task.STATUS_CANCELLED for status, _ in step_statuses):
            failed_idx = next((idx for idx, (status, _) in enumerate(step_statuses) if status == Task.STATUS_CANCELLED), None)
            failed_template = templates[failed_idx] if failed_idx is not None else None
            failed_task = step_statuses[failed_idx][1] if failed_idx is not None else None
            target_col = col_index['failed']
            current_step_title = failed_template.title_template if failed_template else 'Có bước thất bại'
            current_task = failed_task
        elif all(status == Task.STATUS_DONE for status, _ in step_statuses):
            target_col = col_index['done']
            current_step_title = 'Hoàn tất quy trình'
            current_task = None
        else:
            active_idx = 0
            for idx, (status, _) in enumerate(step_statuses):
                if status != Task.STATUS_DONE:
                    active_idx = idx
                    break
            active_template = templates[active_idx]
            active_status, active_task = step_statuses[active_idx]
            target_col = col_index[f'tmpl-{active_template.id}']
            current_step_title = active_template.title_template
            current_task = active_task

        meta = entity_meta.get(entity_id, {})
        card = {
            'entity_id': entity_id,
            'entity_code': meta.get('entity_code') or f'#{entity_id}',
            'order_status': meta.get('status') or '',
            'owner': meta.get('owner') or '',
            'team': meta.get('team') or '',
            'current_step': current_step_title,
            'current_task_status': current_task.status if current_task else None,
            'current_task_id': current_task.id if current_task else None,
            'current_task_priority': current_task.priority if current_task else None,
            'current_task_is_blocking': bool(current_task.is_blocking) if current_task else False,
            'current_task_is_pinned': bool(current_task.is_pinned) if current_task else False,
            'current_task_due_date': current_task.due_date.isoformat() if current_task and current_task.due_date else None,
            'sla_state': (
                'OVERDUE'
                if current_task and current_task.due_date and current_task.due_date < today
                else 'DUE_TODAY'
                if current_task and current_task.due_date and current_task.due_date == today
                else 'AT_RISK'
                if current_task and current_task.due_date and current_task.due_date <= at_risk_date
                else 'ON_TRACK'
            ),
            'updated_at': meta.get('updated_at'),
        }
        target_col['cards'].append(card)
        card_count += 1

    for col in columns:
        wip_limit = col.get('wip_limit')
        col['is_over_wip'] = bool(wip_limit and len(col['cards']) > wip_limit)

    return {
        'entity_type': entity_type,
        'trigger': trigger,
        'columns': columns,
        'meta': {'total_cards': card_count, 'template_count': len(templates)},
    }


def _get_templates_for_pipeline(entity_type: str, trigger: str):
    from core.models import WorkflowTaskTemplate

    return list(
        WorkflowTaskTemplate.objects.filter(
            entity_type=entity_type,
            trigger=trigger,
            is_active=True,
        ).order_by('sort_order', 'id')
    )


def _get_tasks_by_template(entity_type: str, entity_id: int, template_ids: set):
    from core.models import Task

    tasks = (
        Task.objects
        .select_related('depends_on', 'assigned_to')
        .filter(entity_type=entity_type, entity_id=entity_id)
        .exclude(source_key__isnull=True)
    )
    mapping = {}
    for task in tasks:
        template_id = _extract_template_id_from_source_key(task.source_key or '')
        if template_id is None or template_id not in template_ids:
            continue
        mapping[template_id] = task
    return mapping


def _log_pipeline_event(entity_type: str, entity_id: int, entity_code: str, trigger: str, action: str, from_step: str, to_step: str, note: str = '', task=None, actor=None):
    from core.models import WorkflowPipelineEvent

    WorkflowPipelineEvent.objects.create(
        entity_type=entity_type,
        entity_id=entity_id,
        entity_code=entity_code or '',
        trigger=trigger or '',
        action=action,
        from_step=from_step or '',
        to_step=to_step or '',
        note=note or '',
        task=task,
        actor=actor,
    )


def _can_operate_pipeline(entity_type: str, entity_id: int, actor, current_task=None) -> bool:
    """
    Quyền thao tác pipeline:
    - staff/superuser
    - owner chứng từ (SalesOrder.owner)
    - người được giao task hiện tại
    """
    if actor is None:
        return False
    if getattr(actor, 'is_staff', False) or getattr(actor, 'is_superuser', False):
        return True
    if current_task and current_task.assigned_to_id == actor.id:
        return True

    if entity_type == 'SalesOrder':
        from sales.models import SalesOrder

        order = SalesOrder.objects.filter(id=entity_id).only('owner_id').first()
        if order and order.owner_id == actor.id:
            return True
    if entity_type == 'PurchaseOrder':
        from purchasing.models import PurchaseOrder

        order = PurchaseOrder.objects.filter(id=entity_id).only('owner_id').first()
        if order and order.owner_id == actor.id:
            return True
    if entity_type == 'ProductionOrder':
        from production.models import ProductionOrder

        order = ProductionOrder.objects.filter(id=entity_id).only('owner_id').first()
        if order and order.owner_id == actor.id:
            return True
    return False


def advance_pipeline_step(entity_type: str, entity_id: int, entity_code: str, trigger: str, actor=None, note: str = '') -> dict:
    """
    Chuyển entity sang bước kế tiếp trong pipeline hiện hành.
    """
    from core.models import Task, WorkflowPipelineEvent

    created = generate_tasks_for_entity(
        entity_type=entity_type,
        entity_id=entity_id,
        entity_code=entity_code,
        trigger=trigger,
        triggered_by=actor,
    )
    if created:
        _log_pipeline_event(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            action=WorkflowPipelineEvent.ACTION_GENERATE,
            from_step='',
            to_step='',
            note=f'Sinh {len(created)} task theo template.',
            actor=actor,
        )

    templates = _get_templates_for_pipeline(entity_type, trigger)
    if not templates:
        return {'success': False, 'error': 'Chưa có template active cho pipeline này.'}
    template_ids = {t.id for t in templates}
    tasks_by_template = _get_tasks_by_template(entity_type, entity_id, template_ids)

    active_idx = None
    for idx, tmpl in enumerate(templates):
        task = tasks_by_template.get(tmpl.id)
        if not task or task.status != Task.STATUS_DONE:
            active_idx = idx
            break
    if active_idx is None:
        return {'success': True, 'message': 'Pipeline đã hoàn tất.'}

    current_template = templates[active_idx]
    current_task = tasks_by_template.get(current_template.id)
    if not current_task:
        return {'success': False, 'error': 'Không tìm thấy task hiện tại để chuyển bước.'}
    if not _can_operate_pipeline(entity_type, entity_id, actor, current_task=current_task):
        return {'success': False, 'error': 'Bạn không có quyền chuyển bước pipeline này.'}
    if current_task.status == Task.STATUS_CANCELLED:
        return {'success': False, 'error': 'Bước hiện tại đã bị huỷ. Hãy xử lý trạng thái thất bại trước.'}
    if current_task.needs_help:
        return {'success': False, 'error': 'Task đang cần hỗ trợ, chưa thể chuyển bước.'}
    if not current_task.assigned_to_id:
        if actor:
            # Tự gán cho người thao tác để tối ưu trải nghiệm chuyển bước nhanh.
            current_task.assigned_to = actor
            current_task.save(update_fields=['assigned_to', 'updated_at'])
        else:
            return {'success': False, 'error': 'Task chưa có người xử lý, chưa thể chuyển bước.'}

    from_step = current_template.title_template
    current_task.complete(user=actor)

    to_step = 'Done'
    next_task = None
    if active_idx + 1 < len(templates):
        next_template = templates[active_idx + 1]
        next_task = tasks_by_template.get(next_template.id)
        if next_task and next_task.status == Task.STATUS_TODO:
            next_task.start()
        to_step = next_template.title_template

    _log_pipeline_event(
        entity_type=entity_type,
        entity_id=entity_id,
        entity_code=entity_code,
        trigger=trigger,
        action=WorkflowPipelineEvent.ACTION_ADVANCE,
        from_step=from_step,
        to_step=to_step,
        note=note,
        task=current_task,
        actor=actor,
    )
    return {
        'success': True,
        'message': f'Đã chuyển từ "{from_step}" sang "{to_step}".',
        'completed_task_id': current_task.id,
        'next_task_id': next_task.id if next_task else None,
    }


def move_pipeline_card(entity_type: str, entity_id: int, entity_code: str, trigger: str, target_column_id: str, actor=None, note: str = '') -> dict:
    """
    Di chuyển card pipeline bằng thao tác kéo-thả.
    Chỉ hỗ trợ:
    - sang bước kế tiếp (tmpl-{id})
    - sang done
    - sang failed
    """
    from core.models import Task, WorkflowPipelineEvent

    templates = _get_templates_for_pipeline(entity_type, trigger)
    if not templates:
        return {'success': False, 'error': 'Chưa có template active.'}
    template_ids = {t.id for t in templates}
    tasks_by_template = _get_tasks_by_template(entity_type, entity_id, template_ids)

    active_idx = None
    for idx, tmpl in enumerate(templates):
        task = tasks_by_template.get(tmpl.id)
        if not task or task.status != Task.STATUS_DONE:
            active_idx = idx
            break
    if active_idx is None:
        active_idx = len(templates) - 1
    active_template = templates[active_idx]
    current_task = tasks_by_template.get(active_template.id)
    if not current_task:
        return {'success': False, 'error': 'Không có task hiện tại để di chuyển.'}
    if not _can_operate_pipeline(entity_type, entity_id, actor, current_task=current_task):
        return {'success': False, 'error': 'Bạn không có quyền di chuyển card pipeline này.'}

    if target_column_id == 'failed':
        if current_task.status in (Task.STATUS_DONE, Task.STATUS_CANCELLED):
            return {'success': False, 'error': 'Task hiện tại không thể chuyển failed.'}
        current_task.cancel()
        _log_pipeline_event(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            action=WorkflowPipelineEvent.ACTION_FAIL,
            from_step=active_template.title_template,
            to_step='Failed',
            note=note,
            task=current_task,
            actor=actor,
        )
        return {'success': True, 'message': 'Đã chuyển card sang Failed.'}

    if target_column_id == 'done':
        # Chỉ cho done nếu active là bước cuối
        if active_idx != len(templates) - 1:
            return {'success': False, 'error': 'Chỉ có thể kéo vào Done khi đang ở bước cuối cùng.'}
        if current_task.status != Task.STATUS_DONE:
            current_task.complete(user=actor)
        _log_pipeline_event(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            action=WorkflowPipelineEvent.ACTION_MOVE,
            from_step=active_template.title_template,
            to_step='Done',
            note=note,
            task=current_task,
            actor=actor,
        )
        return {'success': True, 'message': 'Đã hoàn tất card.'}

    if target_column_id.startswith('tmpl-'):
        try:
            target_template_id = int(target_column_id.split('-', 1)[1])
        except (TypeError, ValueError):
            return {'success': False, 'error': 'Cột đích không hợp lệ.'}
        target_idx = next((i for i, t in enumerate(templates) if t.id == target_template_id), None)
        if target_idx is None:
            return {'success': False, 'error': 'Không tìm thấy cột đích.'}
        if target_idx != active_idx + 1:
            return {'success': False, 'error': 'Chỉ cho phép kéo sang cột kế tiếp để đảm bảo quy trình.'}
        # dùng advance để đảm bảo gate check thống nhất
        return advance_pipeline_step(
            entity_type=entity_type,
            entity_id=entity_id,
            entity_code=entity_code,
            trigger=trigger,
            actor=actor,
            note=note or 'Di chuyển card sang cột kế tiếp',
        )

    return {'success': False, 'error': 'Cột đích không được hỗ trợ.'}


def get_pipeline_timeline(entity_type: str, entity_id: int, limit: int = 100) -> list:
    from core.models import WorkflowPipelineEvent

    events = (
        WorkflowPipelineEvent.objects
        .select_related('actor')
        .filter(entity_type=entity_type, entity_id=entity_id)
        .order_by('-created_at')[:limit]
    )
    return [
        {
            'id': ev.id,
            'action': ev.action,
            'from_step': ev.from_step,
            'to_step': ev.to_step,
            'note': ev.note,
            'actor': ev.actor.get_full_name() if ev.actor else '',
            'created_at': ev.created_at.isoformat() if ev.created_at else None,
        }
        for ev in events
    ]


def get_pipeline_analytics(entity_type: str, trigger: str = 'SUBMIT', days: int = 30) -> dict:
    """
    Thống kê vận hành workflow theo entity/trigger:
    - Lead time (toàn pipeline)
    - Cycle time (theo từng bước template)
    - Bottleneck và trạng thái tồn đọng
    """
    from core.models import Task, WorkflowPipelineEvent

    templates = list(
        _get_templates_for_pipeline(entity_type=entity_type, trigger=trigger)
    )
    if not templates:
        return {
            'entity_type': entity_type,
            'trigger': trigger,
            'window_days': days,
            'summary': {
                'entities_total': 0,
                'entities_completed': 0,
                'completion_rate': 0.0,
                'avg_lead_time_hours': 0.0,
                'avg_open_age_hours': 0.0,
                'total_tasks': 0,
                'open_tasks': 0,
                'overdue_open_tasks': 0,
                'failed_tasks': 0,
            },
            'step_metrics': [],
            'bottlenecks': [],
            'insights': [],
            'action_counts': {},
            'meta': {'message': 'Chưa có template active cho entity/trigger này.'},
            'generated_at': timezone.now().isoformat(),
        }

    now = timezone.now()
    today = timezone.localdate()
    window_start = now - timedelta(days=max(1, days))
    template_map = {tmpl.id: tmpl for tmpl in templates}
    template_ids = set(template_map.keys())

    tasks = (
        Task.objects
        .filter(entity_type=entity_type)
        .exclude(source_key__isnull=True)
        .only('id', 'entity_id', 'source_key', 'status', 'created_at', 'completed_at', 'due_date')
    )

    step_metrics = {
        tmpl.id: {
            'template_id': tmpl.id,
            'title': tmpl.title_template,
            'sort_order': tmpl.sort_order,
            'target_cycle_time_hours': _extract_sla_target_hours(tmpl.tags),
            'target_wip_limit': _extract_wip_limit(tmpl.tags),
            'total_tasks': 0,
            'done_tasks': 0,
            'in_progress_tasks': 0,
            'todo_tasks': 0,
            'failed_tasks': 0,
            'overdue_open_tasks': 0,
            'cycle_samples_hours': [],
            'breached_count': 0,
        }
        for tmpl in templates
    }

    entities: dict[int, dict] = {}
    total_tasks = 0
    open_tasks = 0
    failed_tasks = 0
    overdue_open_tasks = 0

    for task in tasks:
        template_id = _extract_template_id_from_source_key(task.source_key or '')
        if template_id is None or template_id not in template_ids:
            continue

        total_tasks += 1
        metric = step_metrics[template_id]
        metric['total_tasks'] += 1

        if task.status == Task.STATUS_DONE:
            metric['done_tasks'] += 1
            if task.completed_at and task.created_at and task.completed_at >= window_start:
                cycle_hours = (task.completed_at - task.created_at).total_seconds() / 3600
                if cycle_hours >= 0:
                    metric['cycle_samples_hours'].append(cycle_hours)
                    target_hours = metric.get('target_cycle_time_hours')
                    if target_hours and cycle_hours > target_hours:
                        metric['breached_count'] += 1
        elif task.status == Task.STATUS_IN_PROGRESS:
            metric['in_progress_tasks'] += 1
            open_tasks += 1
        elif task.status == Task.STATUS_TODO:
            metric['todo_tasks'] += 1
            open_tasks += 1
        elif task.status == Task.STATUS_CANCELLED:
            metric['failed_tasks'] += 1
            failed_tasks += 1

        if task.status in (Task.STATUS_TODO, Task.STATUS_IN_PROGRESS) and task.due_date and task.due_date < today:
            metric['overdue_open_tasks'] += 1
            overdue_open_tasks += 1

        entity_entry = entities.setdefault(task.entity_id, {'tasks': {}, 'min_created_at': None})
        entity_entry['tasks'][template_id] = task
        if entity_entry['min_created_at'] is None or task.created_at < entity_entry['min_created_at']:
            entity_entry['min_created_at'] = task.created_at

    lead_samples = []
    open_age_samples = []
    completed_entities = 0
    for data in entities.values():
        task_map = data['tasks']
        if len(task_map) < len(template_ids):
            if data['min_created_at']:
                open_age_samples.append((now - data['min_created_at']).total_seconds() / 3600)
            continue

        statuses = [task_map[tid].status for tid in template_ids if tid in task_map]
        if any(status == Task.STATUS_CANCELLED for status in statuses):
            if data['min_created_at']:
                open_age_samples.append((now - data['min_created_at']).total_seconds() / 3600)
            continue

        if all(status == Task.STATUS_DONE for status in statuses):
            completed_at_values = [
                task_map[tid].completed_at
                for tid in template_ids
                if tid in task_map and task_map[tid].completed_at
            ]
            if completed_at_values and data['min_created_at']:
                completed_entities += 1
                latest_completed_at = max(completed_at_values)
                if latest_completed_at >= window_start:
                    lead_samples.append((latest_completed_at - data['min_created_at']).total_seconds() / 3600)
        else:
            if data['min_created_at']:
                open_age_samples.append((now - data['min_created_at']).total_seconds() / 3600)

    step_rows = []
    for tmpl in templates:
        metric = step_metrics[tmpl.id]
        samples = metric.pop('cycle_samples_hours')
        breached_count = metric.get('breached_count', 0)
        avg_cycle = (sum(samples) / len(samples)) if samples else 0.0
        p95_cycle = _percentile(samples, 0.95)
        breach_rate = (breached_count / len(samples) * 100) if samples else 0.0
        step_rows.append({
            **metric,
            'avg_cycle_time_hours': round(avg_cycle, 2),
            'p95_cycle_time_hours': round(p95_cycle, 2),
            'breach_rate_percent': round(breach_rate, 2),
        })
    step_rows.sort(key=lambda x: (x['sort_order'], x['template_id']))

    bottlenecks = sorted(
        [row for row in step_rows if row['avg_cycle_time_hours'] > 0],
        key=lambda x: x['avg_cycle_time_hours'],
        reverse=True,
    )[:5]

    insights: list[dict] = []
    severity_rank = {'HIGH': 3, 'MEDIUM': 2, 'LOW': 1}
    for row in step_rows:
        backlog_count = int(row.get('todo_tasks', 0)) + int(row.get('in_progress_tasks', 0))
        wip_limit = row.get('target_wip_limit')
        if wip_limit and backlog_count > wip_limit:
            insights.append({
                'severity': 'HIGH',
                'type': 'WIP_OVERLOAD',
                'step_title': row.get('title', ''),
                'message': f'Bước "{row.get("title", "")}" đang quá tải WIP ({backlog_count}/{wip_limit}).',
                'suggested_action': 'RUN_AUTOMATION',
            })
        if row.get('breach_rate_percent', 0) >= 30:
            insights.append({
                'severity': 'HIGH',
                'type': 'SLA_BREACH_HIGH',
                'step_title': row.get('title', ''),
                'message': f'Tỷ lệ vi phạm SLA ở bước "{row.get("title", "")}" đang cao ({row.get("breach_rate_percent", 0)}%).',
                'suggested_action': 'REBALANCE_ASSIGNEE',
            })
        elif row.get('breach_rate_percent', 0) >= 10:
            insights.append({
                'severity': 'MEDIUM',
                'type': 'SLA_BREACH_MEDIUM',
                'step_title': row.get('title', ''),
                'message': f'Tỷ lệ vi phạm SLA ở bước "{row.get("title", "")}" cần theo dõi ({row.get("breach_rate_percent", 0)}%).',
                'suggested_action': 'CHECK_CAPACITY',
            })
        if row.get('overdue_open_tasks', 0) >= 3:
            insights.append({
                'severity': 'MEDIUM',
                'type': 'OVERDUE_CLUSTER',
                'step_title': row.get('title', ''),
                'message': f'Bước "{row.get("title", "")}" có cụm task quá hạn ({row.get("overdue_open_tasks", 0)} task).',
                'suggested_action': 'ESCALATE_OVERDUE',
            })

    insights = sorted(
        insights,
        key=lambda i: severity_rank.get(str(i.get('severity', 'LOW')), 1),
        reverse=True,
    )[:6]

    action_events = (
        WorkflowPipelineEvent.objects
        .filter(entity_type=entity_type, trigger=trigger, created_at__gte=window_start)
        .values('action')
    )
    action_counts: dict[str, int] = {}
    for item in action_events:
        action = item['action']
        action_counts[action] = action_counts.get(action, 0) + 1

    entities_total = len(entities)
    completion_rate = (completed_entities / entities_total * 100) if entities_total else 0.0
    avg_lead = (sum(lead_samples) / len(lead_samples)) if lead_samples else 0.0
    avg_open_age = (sum(open_age_samples) / len(open_age_samples)) if open_age_samples else 0.0

    return {
        'entity_type': entity_type,
        'trigger': trigger,
        'window_days': days,
        'summary': {
            'entities_total': entities_total,
            'entities_completed': completed_entities,
            'completion_rate': round(completion_rate, 2),
            'avg_lead_time_hours': round(avg_lead, 2),
            'avg_open_age_hours': round(avg_open_age, 2),
            'total_tasks': total_tasks,
            'open_tasks': open_tasks,
            'overdue_open_tasks': overdue_open_tasks,
            'failed_tasks': failed_tasks,
        },
        'step_metrics': step_rows,
        'bottlenecks': bottlenecks,
        'insights': insights,
        'action_counts': action_counts,
        'generated_at': now.isoformat(),
    }


def run_pipeline_automation(
    entity_type: str,
    trigger: str = 'SUBMIT',
    actor=None,
    remind_overdue: bool = True,
    auto_start_ready: bool = True,
    reminder_cooldown_hours: int = 24,
) -> dict:
    """
    Chạy automation vận hành cho pipeline hiện tại.

    - auto_start_ready: tự start task TODO nếu phụ thuộc đã DONE.
    - remind_overdue: gửi nhắc tự động cho task mở quá hạn.
    """
    from core.models import Notification, Task, WorkflowPipelineEvent

    templates = _get_templates_for_pipeline(entity_type=entity_type, trigger=trigger)
    if not templates:
        return {
            'success': True,
            'entity_type': entity_type,
            'trigger': trigger,
            'auto_started_count': 0,
            'overdue_reminded_count': 0,
            'notifications_sent': 0,
            'message': 'Không có template active để chạy automation.',
        }

    template_ids = {tmpl.id for tmpl in templates}
    now = timezone.now()
    today = timezone.localdate()
    cooldown_since = now - timedelta(hours=max(1, reminder_cooldown_hours))

    tasks = (
        Task.objects
        .select_related('depends_on')
        .filter(entity_type=entity_type)
        .exclude(source_key__isnull=True)
    )

    auto_started_count = 0
    overdue_reminded_count = 0
    notifications_sent = 0

    for task in tasks:
        template_id = _extract_template_id_from_source_key(task.source_key or '')
        if template_id is None or template_id not in template_ids:
            continue

        if (
            auto_start_ready
            and task.status == Task.STATUS_TODO
            and task.depends_on_id
            and task.depends_on
            and task.depends_on.status == Task.STATUS_DONE
        ):
            task.start()
            auto_started_count += 1
            _log_pipeline_event(
                entity_type=task.entity_type,
                entity_id=task.entity_id,
                entity_code=task.entity_code or '',
                trigger=trigger,
                action=WorkflowPipelineEvent.ACTION_MOVE,
                from_step='TODO',
                to_step='IN_PROGRESS',
                note='Auto-start task do bước phụ thuộc đã hoàn tất.',
                task=task,
                actor=actor,
            )

        if (
            remind_overdue
            and task.status in (Task.STATUS_TODO, Task.STATUS_IN_PROGRESS)
            and task.due_date
            and task.due_date < today
        ):
            recipients = set()
            if task.assigned_to_id:
                recipients.add(task.assigned_to_id)
            if task.assigned_by_id:
                recipients.add(task.assigned_by_id)
            if actor and actor.id in recipients:
                recipients.discard(actor.id)

            sent_for_this_task = 0
            for uid in recipients:
                duplicated_recent = Notification.objects.filter(
                    recipient_id=uid,
                    notification_type='due_date',
                    entity_type='Task',
                    entity_id=task.id,
                    created_at__gte=cooldown_since,
                    title__startswith='[AUTO-WORKFLOW]',
                ).exists()
                if duplicated_recent:
                    continue
                Notification.objects.create(
                    recipient_id=uid,
                    notification_type='due_date',
                    title=f'[AUTO-WORKFLOW] Task quá hạn: {task.title[:80]}',
                    message=(
                        f'Nhiệm vụ "{task.title}" đã quá hạn (hạn {task.due_date.strftime("%d/%m/%Y")}). '
                        'Vui lòng xử lý hoặc cập nhật người phụ trách.'
                    ),
                    entity_type='Task',
                    entity_id=task.id,
                    actor=actor,
                )
                notifications_sent += 1
                sent_for_this_task += 1
            if sent_for_this_task > 0:
                overdue_reminded_count += 1

    return {
        'success': True,
        'entity_type': entity_type,
        'trigger': trigger,
        'auto_started_count': auto_started_count,
        'overdue_reminded_count': overdue_reminded_count,
        'notifications_sent': notifications_sent,
        'message': 'Đã chạy automation workflow.',
    }


def get_default_automation_profiles() -> dict:
    return {
        'MORNING': {
            'name': 'Đầu ngày',
            'remind_overdue': True,
            'auto_start_ready': True,
            'reminder_cooldown_hours': 12,
        },
        'MIDDAY': {
            'name': 'Giữa ngày',
            'remind_overdue': True,
            'auto_start_ready': False,
            'reminder_cooldown_hours': 8,
        },
        'EOD': {
            'name': 'Cuối ngày',
            'remind_overdue': True,
            'auto_start_ready': True,
            'reminder_cooldown_hours': 4,
        },
        'CUSTOM': {
            'name': 'Tùy chỉnh',
            'remind_overdue': True,
            'auto_start_ready': True,
            'reminder_cooldown_hours': 24,
        },
    }


def merge_automation_profiles(saved_profiles: dict | None) -> dict:
    defaults = get_default_automation_profiles()
    saved_profiles = saved_profiles if isinstance(saved_profiles, dict) else {}
    merged = {}
    for key, default_item in defaults.items():
        raw = saved_profiles.get(key)
        override = raw if isinstance(raw, dict) else {}
        try:
            cooldown = int(override.get('reminder_cooldown_hours') or default_item['reminder_cooldown_hours'])
        except (TypeError, ValueError):
            cooldown = default_item['reminder_cooldown_hours']
        merged[key] = {
            'name': str(override.get('name') or default_item['name']).strip() or default_item['name'],
            'remind_overdue': bool(override.get('remind_overdue', default_item['remind_overdue'])),
            'auto_start_ready': bool(override.get('auto_start_ready', default_item['auto_start_ready'])),
            'reminder_cooldown_hours': max(1, min(168, cooldown)),
        }
    return merged


def execute_automation_profile(
    entity_type: str,
    trigger: str,
    profile_key: str,
    profile: dict,
    actor=None,
    run_mode: str = 'MANUAL_PROFILE',
) -> dict:
    from core.models import AuditLog

    profile_key = str(profile_key or '').upper()
    remind_overdue = bool(profile.get('remind_overdue', True))
    auto_start_ready = bool(profile.get('auto_start_ready', True))
    reminder_cooldown_hours = max(1, min(168, int(profile.get('reminder_cooldown_hours') or 24)))
    result = run_pipeline_automation(
        entity_type=entity_type,
        trigger=trigger,
        actor=actor,
        remind_overdue=remind_overdue,
        auto_start_ready=auto_start_ready,
        reminder_cooldown_hours=reminder_cooldown_hours,
    )
    AuditLog.objects.create(
        user=actor,
        action='UPDATE',
        entity_type='WorkflowAutomation',
        entity_id=0,
        entity_id_str=f'{entity_type}:{trigger}',
        entity_code=f'{entity_type}/{trigger}',
        changed_fields=['run_profile'],
        old_values={'profile_key': profile_key, 'run_mode': run_mode},
        new_values={
            'profile_key': profile_key,
            'profile': profile,
            'run_mode': run_mode,
            **result,
        },
    )
    return result


def run_due_automation_schedules_for_user(
    user,
    now=None,
    dry_run: bool = False,
    only_entity_type: str = '',
    only_trigger: str = '',
) -> dict:
    from core.models import UserPreferences

    now_dt = timezone.localtime(now or timezone.now())
    today_key = now_dt.strftime('%Y-%m-%d')
    now_hhmm = now_dt.strftime('%H:%M')

    profile_pref, _ = UserPreferences.objects.get_or_create(
        user=user,
        page='workflow-automation-profiles',
        defaults={'config': {}},
    )
    scheduler_pref, _ = UserPreferences.objects.get_or_create(
        user=user,
        page='workflow-automation-scheduler',
        defaults={'config': {}},
    )
    profile_map = profile_pref.config if isinstance(profile_pref.config, dict) else {}
    scheduler_map = scheduler_pref.config if isinstance(scheduler_pref.config, dict) else {}

    executed = []
    for combo_key, raw_conf in scheduler_map.items():
        if not isinstance(raw_conf, dict):
            continue
        if raw_conf.get('enabled') is not True:
            continue
        if ':' not in combo_key:
            continue
        entity_type, trigger = combo_key.split(':', 1)
        if only_entity_type and entity_type != only_entity_type:
            continue
        if only_trigger and trigger != only_trigger:
            continue
        slots = raw_conf.get('slots')
        if not isinstance(slots, list):
            continue
        last_marks = raw_conf.get('last_run_marks') if isinstance(raw_conf.get('last_run_marks'), dict) else {}
        merged_profiles = merge_automation_profiles(profile_map.get(combo_key))

        changed_marks = False
        for slot in slots:
            if not isinstance(slot, dict):
                continue
            if slot.get('active') is False:
                continue
            profile_key = str(slot.get('profile_key') or '').upper()
            if profile_key not in merged_profiles:
                continue
            time_raw = str(slot.get('time') or '').strip()
            if len(time_raw) != 5 or time_raw[2] != ':':
                continue
            # chỉ chạy khi đã qua mốc thời gian của hôm nay
            if time_raw > now_hhmm:
                continue
            run_mark_key = f'{today_key}|{profile_key}|{time_raw}'
            if run_mark_key in last_marks:
                continue
            profile = merged_profiles[profile_key]
            if dry_run:
                result = {
                    'success': True,
                    'entity_type': entity_type,
                    'trigger': trigger,
                    'auto_started_count': 0,
                    'overdue_reminded_count': 0,
                    'notifications_sent': 0,
                    'message': '[DRY-RUN] Sẽ chạy profile tự động.',
                }
            else:
                result = execute_automation_profile(
                    entity_type=entity_type,
                    trigger=trigger,
                    profile_key=profile_key,
                    profile=profile,
                    actor=user,
                    run_mode='SCHEDULE',
                )
            executed.append({
                'combo_key': combo_key,
                'entity_type': entity_type,
                'trigger': trigger,
                'profile_key': profile_key,
                'time': time_raw,
                'result': result,
            })
            last_marks[run_mark_key] = now_dt.isoformat()
            changed_marks = True

        if changed_marks and not dry_run:
            raw_conf['last_run_marks'] = last_marks
            scheduler_map[combo_key] = raw_conf

    if not dry_run:
        scheduler_pref.config = scheduler_map
        scheduler_pref.save(update_fields=['config', 'updated_at'])

    return {
        'success': True,
        'user_id': user.id,
        'username': user.username,
        'now': now_dt.isoformat(),
        'executed_count': len(executed),
        'executed': executed,
    }


def run_due_automation_schedules(now=None, dry_run: bool = False, user_ids: Optional[list[int]] = None) -> dict:
    from core.models import User

    users = User.objects.filter(is_active=True)
    if user_ids:
        users = users.filter(id__in=user_ids)
    results = []
    total_executed = 0
    for user in users:
        res = run_due_automation_schedules_for_user(user=user, now=now, dry_run=dry_run)
        results.append(res)
        total_executed += int(res.get('executed_count') or 0)
    return {
        'success': True,
        'dry_run': dry_run,
        'users_count': len(results),
        'total_executed': total_executed,
        'results': results,
    }


def run_due_automation_schedules_job(lock_timeout_sec: int = 240) -> dict:
    """
    Entry point dùng cho Django Q Schedule.
    """
    from core.models import AuditLog

    lock_key = 'workflow_automation_scheduler_job_lock'
    lock_token = str(uuid.uuid4())
    lock_timeout = max(30, min(int(lock_timeout_sec or 240), 1800))
    acquired = cache.add(lock_key, lock_token, timeout=lock_timeout)
    if not acquired:
        AuditLog.objects.create(
            user=None,
            action='UPDATE',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['job_run'],
            old_values={},
            new_values={
                'status': 'SKIPPED_LOCKED',
                'message': 'Bỏ qua vì đang có tác vụ bộ lập lịch khác chạy.',
                'lock_timeout_sec': lock_timeout,
                'run_mode': 'SCHEDULE_JOB',
            },
        )
        return {
            'success': True,
            'skipped_locked': True,
            'message': 'Bỏ qua: đang có tác vụ bộ lập lịch khác chạy.',
        }

    started_at = timezone.now()
    try:
        result = run_due_automation_schedules(now=started_at, dry_run=False, user_ids=None)
        finished_at = timezone.now()
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)
        AuditLog.objects.create(
            user=None,
            action='UPDATE',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['job_run'],
            old_values={},
            new_values={
                'status': 'SUCCESS',
                'message': 'Tác vụ bộ lập lịch đã chạy thành công.',
                'run_mode': 'SCHEDULE_JOB',
                'duration_ms': duration_ms,
                'users_count': int(result.get('users_count') or 0),
                'total_executed': int(result.get('total_executed') or 0),
            },
        )
        return {
            **result,
            'job_status': 'SUCCESS',
            'duration_ms': duration_ms,
        }
    except Exception as exc:
        finished_at = timezone.now()
        duration_ms = int((finished_at - started_at).total_seconds() * 1000)
        err_msg = str(exc)
        AuditLog.objects.create(
            user=None,
            action='UPDATE',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['job_run'],
            old_values={},
            new_values={
                'status': 'FAILED',
                'message': err_msg[:500],
                'run_mode': 'SCHEDULE_JOB',
                'duration_ms': duration_ms,
                'traceback': traceback.format_exc()[:4000],
            },
        )
        policy = get_scheduler_policy()
        auto_recovery = _maybe_auto_disable_scheduler_on_fail(
            failure_threshold=int(policy.get('failure_threshold') or 3),
            reason=err_msg[:300],
        )
        return {
            'success': False,
            'job_status': 'FAILED',
            'message': err_msg,
            'duration_ms': duration_ms,
            'auto_recovery': auto_recovery,
        }
    finally:
        # Chỉ release lock nếu token còn khớp để tránh xóa lock của job khác.
        current_token = cache.get(lock_key)
        if current_token == lock_token:
            cache.delete(lock_key)


def _maybe_auto_disable_scheduler_on_fail(failure_threshold: int = 3, reason: str = '') -> dict:
    """
    Auto-recovery policy:
    - Nếu lỗi liên tiếp >= ngưỡng thì tự tắt bộ lập lịch toàn cục.
    - Gửi cảnh báo cho staff/superuser.
    """
    from core.models import AuditLog, Notification, User

    try:
        from django_q.models import Schedule
    except Exception:
        return {
            'evaluated': False,
            'disabled': False,
            'consecutive_failures': 0,
            'error': 'django_q_unavailable',
        }

    logs = list(
        AuditLog.objects
        .filter(entity_type='WorkflowAutomationJob')
        .order_by('-created_at', '-id')[:50]
    )
    consecutive_failures = 0
    for log in logs:
        status_value = str((log.new_values or {}).get('status') or '').upper()
        if status_value == 'FAILED':
            consecutive_failures += 1
            continue
        if status_value == 'SUCCESS':
            break

    if consecutive_failures < max(1, int(failure_threshold or 3)):
        return {
            'evaluated': True,
            'disabled': False,
            'consecutive_failures': consecutive_failures,
        }

    schedule = Schedule.objects.filter(name='workflow-automation-global-scheduler').first()
    if not schedule:
        return {
            'evaluated': True,
            'disabled': False,
            'consecutive_failures': consecutive_failures,
            'error': 'schedule_not_found',
        }
    if schedule.repeats == 0:
        return {
            'evaluated': True,
            'disabled': False,
            'consecutive_failures': consecutive_failures,
            'already_disabled': True,
        }

    schedule.repeats = 0
    schedule.save(update_fields=['repeats'])
    AuditLog.objects.create(
        user=None,
        action='UPDATE',
        entity_type='WorkflowAutomationJob',
        entity_id=0,
        entity_id_str='global',
        entity_code='WORKFLOW_AUTOMATION_JOB',
        changed_fields=['auto_disable'],
        old_values={'enabled': True},
        new_values={
            'enabled': False,
            'reason': 'AUTO_DISABLED_BY_FAILURE_POLICY',
            'failure_threshold': max(1, int(failure_threshold or 3)),
            'consecutive_failures': consecutive_failures,
            'message': reason or 'Scheduler đã tự tắt do lỗi lặp lại nhiều lần.',
        },
    )
    admin_ids = list(
        User.objects.filter(
            is_active=True,
        ).filter(
            models.Q(is_staff=True) | models.Q(is_superuser=True)
        ).values_list('id', flat=True)
    )
    for uid in admin_ids:
        Notification.objects.create(
            recipient_id=uid,
            notification_type='system',
            title='⚠️ Tự động hóa bộ lập lịch đã tự tắt',
            message=(
                f'Hệ thống tự tắt bộ lập lịch do lỗi liên tiếp {consecutive_failures} lần. '
                f'Lý do gần nhất: {reason or "Không rõ"}'
            ),
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            actor=None,
        )
    return {
        'evaluated': True,
        'disabled': True,
        'consecutive_failures': consecutive_failures,
        'notified_admin_count': len(admin_ids),
    }


def get_scheduler_policy() -> dict:
    """
    Chính sách bộ lập lịch lưu trong Setting.
    """
    from core.models import Setting

    def get_int(key: str, default: int, min_v: int, max_v: int) -> int:
        row = Setting.objects.filter(key=key, is_active=True).first()
        if not row:
            return default
        try:
            value = int(str(row.value).strip())
        except (TypeError, ValueError):
            return default
        return max(min_v, min(max_v, value))

    return {
        'failure_threshold': get_int('WORKFLOW_AUTOMATION_FAILURE_THRESHOLD', 3, 1, 20),
    }


def get_scheduler_policy_presets() -> dict:
    return {
        'CONSERVATIVE': {'failure_threshold': 2},
        'BALANCED': {'failure_threshold': 3},
        'AGGRESSIVE': {'failure_threshold': 5},
    }


def notify_scheduler_admins(message: str, actor=None) -> dict:
    """
    Gửi cảnh báo thủ công cho nhóm admin/staff.
    """
    from core.models import Notification, User

    admin_ids = list(
        User.objects.filter(
            is_active=True,
        ).filter(
            models.Q(is_staff=True) | models.Q(is_superuser=True)
        ).values_list('id', flat=True)
    )
    for uid in admin_ids:
        Notification.objects.create(
            recipient_id=uid,
            notification_type='system',
            title='📣 Cảnh báo vận hành bộ lập lịch',
            message=message or 'Cảnh báo thủ công từ bảng điều khiển bộ lập lịch.',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            actor=actor,
        )
    return {
        'success': True,
        'notified_admin_count': len(admin_ids),
    }


def evaluate_scheduler_auto_recovery(reason: str = '') -> dict:
    policy = get_scheduler_policy()
    return _maybe_auto_disable_scheduler_on_fail(
        failure_threshold=int(policy.get('failure_threshold') or 3),
        reason=reason or 'Manual auto-recovery evaluation.',
    )


def simulate_scheduler_failure(reason: str = 'Mô phỏng lỗi thủ công', actor=None) -> dict:
    from core.models import AuditLog

    AuditLog.objects.create(
        user=actor,
        action='UPDATE',
        entity_type='WorkflowAutomationJob',
        entity_id=0,
        entity_id_str='global',
        entity_code='WORKFLOW_AUTOMATION_JOB',
        changed_fields=['job_run'],
        old_values={},
        new_values={
            'status': 'FAILED',
            'message': str(reason or 'Mô phỏng lỗi thủ công.'),
            'run_mode': 'MANUAL_SIMULATION',
            'duration_ms': 0,
        },
    )
    auto_recovery = evaluate_scheduler_auto_recovery(reason=str(reason or 'Mô phỏng lỗi thủ công.'))
    return {
        'success': True,
        'simulated': True,
        'reason': reason,
        'auto_recovery': auto_recovery,
    }


def execute_insight_action(
    entity_type: str,
    trigger: str,
    insight_type: str,
    suggested_action: str,
    actor=None,
) -> dict:
    """
    Thực thi hành động theo insight và ghi AuditLog truy vết.
    """
    from core.models import AuditLog

    action = (suggested_action or '').strip().upper()
    if action == 'RUN_AUTOMATION':
        result = run_pipeline_automation(
            entity_type=entity_type,
            trigger=trigger,
            actor=actor,
            remind_overdue=True,
            auto_start_ready=True,
            reminder_cooldown_hours=24,
        )
    elif action == 'ESCALATE_OVERDUE':
        result = run_pipeline_automation(
            entity_type=entity_type,
            trigger=trigger,
            actor=actor,
            remind_overdue=True,
            auto_start_ready=False,
            reminder_cooldown_hours=6,
        )
    elif action in ('REBALANCE_ASSIGNEE', 'CHECK_CAPACITY'):
        result = {
            'success': True,
            'entity_type': entity_type,
            'trigger': trigger,
            'message': f'Đã ghi nhận hành động thủ công cho {action}.',
            'manual_action': True,
        }
    else:
        return {'success': False, 'error': 'suggested_action không hợp lệ.'}

    AuditLog.objects.create(
        user=actor,
        action='UPDATE',
        entity_type='WorkflowAnalytics',
        entity_id=0,
        entity_id_str=f'{entity_type}:{trigger}',
        entity_code=f'{entity_type}/{trigger}',
        changed_fields=['insight_action'],
        old_values={
            'insight_type': insight_type,
            'suggested_action': action,
        },
        new_values=result,
    )
    return result


def execute_insight_actions_batch(
    entity_type: str,
    trigger: str,
    items: list[dict],
    actor=None,
    stop_on_error: bool = False,
) -> dict:
    """
    Thực thi nhiều insight actions theo danh sách.
    items: [{insight_type, suggested_action}]
    """
    if not isinstance(items, list) or not items:
        return {'success': False, 'error': 'Danh sách mục trống.'}

    results = []
    success_count = 0
    failed_count = 0

    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            failed_count += 1
            results.append({
                'index': idx,
                'insight_type': '',
                'suggested_action': '',
                'success': False,
                'error': 'Item không hợp lệ.',
            })
            if stop_on_error:
                break
            continue
        insight_type = str(item.get('insight_type') or '').strip()
        suggested_action = str(item.get('suggested_action') or '').strip()
        if not insight_type or not suggested_action:
            failed_count += 1
            results.append({
                'index': idx,
                'insight_type': insight_type,
                'suggested_action': suggested_action,
                'success': False,
                'error': 'insight_type và suggested_action là bắt buộc.',
            })
            if stop_on_error:
                break
            continue

        res = execute_insight_action(
            entity_type=entity_type,
            trigger=trigger,
            insight_type=insight_type,
            suggested_action=suggested_action,
            actor=actor,
        )
        if res.get('success'):
            success_count += 1
            results.append({
                'index': idx,
                'insight_type': insight_type,
                'suggested_action': suggested_action,
                'success': True,
                'message': res.get('message', ''),
                'manual_action': bool(res.get('manual_action', False)),
                'auto_started_count': int(res.get('auto_started_count') or 0),
                'overdue_reminded_count': int(res.get('overdue_reminded_count') or 0),
                'notifications_sent': int(res.get('notifications_sent') or 0),
            })
        else:
            failed_count += 1
            results.append({
                'index': idx,
                'insight_type': insight_type,
                'suggested_action': suggested_action,
                'success': False,
                'error': res.get('error') or 'Không thể thực thi gợi ý.',
            })
            if stop_on_error:
                break

    return {
        'success': True,
        'entity_type': entity_type,
        'trigger': trigger,
        'total': len(results),
        'success_count': success_count,
        'failed_count': failed_count,
        'results': results,
    }


def get_insight_action_history(
    entity_type: str,
    trigger: str,
    limit: int = 20,
    actor_query: str = '',
    suggested_action: str = '',
    success: Optional[bool] = None,
) -> dict:
    """
    Lấy lịch sử thực thi insight actions đã ghi AuditLog.
    """
    from core.models import AuditLog

    limit = max(1, min(limit, 100))
    key = f'{entity_type}:{trigger}'
    logs = (
        AuditLog.objects
        .select_related('user')
        .filter(entity_type='WorkflowAnalytics', entity_id_str=key)
        .order_by('-created_at')
    )

    actor_query = (actor_query or '').strip().lower()
    suggested_action = (suggested_action or '').strip().upper()
    if actor_query:
        logs = logs.filter(user__username__icontains=actor_query)

    items = []
    for log in logs[: max(limit * 3, limit)]:
        old_values = log.old_values or {}
        new_values = log.new_values or {}
        action_value = str(old_values.get('suggested_action', '') or '').upper()
        success_value = bool(new_values.get('success', False))
        if suggested_action and action_value != suggested_action:
            continue
        if success is not None and success_value != success:
            continue
        items.append({
            'id': log.id,
            'actor': log.user.get_full_name() if log.user else '',
            'actor_username': log.user.username if log.user else '',
            'insight_type': old_values.get('insight_type', ''),
            'suggested_action': action_value,
            'message': new_values.get('message', ''),
            'success': success_value,
            'manual_action': bool(new_values.get('manual_action', False)),
            'created_at': log.created_at.isoformat() if log.created_at else None,
        })
        if len(items) >= limit:
            break

    return {
        'entity_type': entity_type,
        'trigger': trigger,
        'items': items,
        'total': len(items),
    }


def bulk_pipeline_action(
    entity_type: str,
    trigger: str,
    action: str,
    items: list[dict],
    actor=None,
    note: str = '',
) -> dict:
    """
    Thao tác pipeline hàng loạt theo danh sách entity.
    action: ADVANCE | FAIL | RETRY_FAILED
    """
    action_normalized = (action or '').strip().upper()
    if action_normalized not in ('ADVANCE', 'FAIL', 'RETRY_FAILED'):
        return {'success': False, 'error': 'action không hợp lệ.'}
    if not items:
        return {'success': False, 'error': 'Danh sách mục trống.'}

    results = []
    success_count = 0
    failed_count = 0

    for item in items:
        try:
            entity_id = int(item.get('entity_id'))
        except (TypeError, ValueError):
            failed_count += 1
            results.append({'entity_id': item.get('entity_id'), 'success': False, 'error': 'entity_id không hợp lệ.'})
            continue
        entity_code = (item.get('entity_code') or '').strip()

        if action_normalized == 'ADVANCE':
            result = advance_pipeline_step(
                entity_type=entity_type,
                entity_id=entity_id,
                entity_code=entity_code,
                trigger=trigger,
                actor=actor,
                note=note,
            )
        elif action_normalized == 'FAIL':
            result = move_pipeline_card(
                entity_type=entity_type,
                entity_id=entity_id,
                entity_code=entity_code,
                trigger=trigger,
                target_column_id='failed',
                actor=actor,
                note=note,
            )
        else:
            result = retry_pipeline_from_failed(
                entity_type=entity_type,
                entity_id=entity_id,
                entity_code=entity_code,
                trigger=trigger,
                actor=actor,
                note=note,
            )

        item_success = bool(result.get('success'))
        if item_success:
            success_count += 1
        else:
            failed_count += 1
        results.append({
            'entity_id': entity_id,
            'entity_code': entity_code,
            'success': item_success,
            'message': result.get('message'),
            'error': result.get('error'),
        })

    return {
        'success': True,
        'action': action_normalized,
        'total': len(items),
        'success_count': success_count,
        'failed_count': failed_count,
        'results': results,
    }


def retry_pipeline_from_failed(entity_type: str, entity_id: int, entity_code: str, trigger: str, actor=None, note: str = '') -> dict:
    """
    Khôi phục bước bị Failed (CANCELLED) về TODO để xử lý lại.
    """
    from core.models import Task, WorkflowPipelineEvent

    templates = _get_templates_for_pipeline(entity_type, trigger)
    if not templates:
        return {'success': False, 'error': 'Chưa có template active.'}
    template_ids = {t.id for t in templates}
    tasks_by_template = _get_tasks_by_template(entity_type, entity_id, template_ids)

    failed_entry = None
    for tmpl in templates:
        task = tasks_by_template.get(tmpl.id)
        if task and task.status == Task.STATUS_CANCELLED:
            failed_entry = (tmpl, task)
            break
    if not failed_entry:
        return {'success': False, 'error': 'Không có bước Failed để khôi phục.'}

    failed_template, failed_task = failed_entry
    if not _can_operate_pipeline(entity_type, entity_id, actor, current_task=failed_task):
        return {'success': False, 'error': 'Bạn không có quyền khôi phục card này.'}

    failed_task.status = Task.STATUS_TODO
    failed_task.completed_at = None
    failed_task.save(update_fields=['status', 'completed_at', 'updated_at'])

    _log_pipeline_event(
        entity_type=entity_type,
        entity_id=entity_id,
        entity_code=entity_code or failed_task.entity_code or '',
        trigger=trigger,
        action=WorkflowPipelineEvent.ACTION_MOVE,
        from_step='Failed',
        to_step=failed_template.title_template,
        note=note or 'Khôi phục từ Failed để xử lý lại.',
        task=failed_task,
        actor=actor,
    )
    return {
        'success': True,
        'message': f'Đã khôi phục bước "{failed_template.title_template}" để xử lý lại.',
        'task_id': failed_task.id,
    }


def auto_advance_pipeline_from_completed_task(task, actor=None) -> dict:
    """
    Khi task thuộc pipeline được complete, tự đẩy sang bước kế tiếp.
    """
    from core.models import Task, WorkflowTaskTemplate, WorkflowPipelineEvent

    if not task or task.status != Task.STATUS_DONE:
        return {'applied': False}
    template_id = _extract_template_id_from_source_key(task.source_key or '')
    if template_id is None:
        return {'applied': False}

    current_template = WorkflowTaskTemplate.objects.filter(id=template_id).first()
    if not current_template:
        return {'applied': False}

    templates = _get_templates_for_pipeline(task.entity_type, current_template.trigger)
    if not templates:
        return {'applied': False}

    current_idx = next((i for i, t in enumerate(templates) if t.id == current_template.id), None)
    if current_idx is None:
        return {'applied': False}

    from_step = current_template.title_template

    # Nếu là bước cuối cùng -> ghi nhận hoàn tất pipeline
    if current_idx == len(templates) - 1:
        _log_pipeline_event(
            entity_type=task.entity_type,
            entity_id=task.entity_id,
            entity_code=task.entity_code or '',
            trigger=current_template.trigger,
            action=WorkflowPipelineEvent.ACTION_ADVANCE,
            from_step=from_step,
            to_step='Done',
            note='Tự động chuyển hoàn tất sau khi hoàn thành bước cuối.',
            task=task,
            actor=actor,
        )
        return {'applied': True, 'to_step': 'Done', 'next_task_id': None}

    next_template = templates[current_idx + 1]
    template_ids = {t.id for t in templates}
    tasks_by_template = _get_tasks_by_template(task.entity_type, task.entity_id, template_ids)
    next_task = tasks_by_template.get(next_template.id)
    if next_task and next_task.status == Task.STATUS_TODO:
        # Nếu có phụ thuộc, chỉ tự start khi phụ thuộc đã DONE
        if not next_task.depends_on_id or (next_task.depends_on and next_task.depends_on.status == Task.STATUS_DONE):
            next_task.start()

    _log_pipeline_event(
        entity_type=task.entity_type,
        entity_id=task.entity_id,
        entity_code=task.entity_code or '',
        trigger=current_template.trigger,
        action=WorkflowPipelineEvent.ACTION_ADVANCE,
        from_step=from_step,
        to_step=next_template.title_template,
        note='Tự động chuyển bước sau khi hoàn thành nhiệm vụ.',
        task=task,
        actor=actor,
    )
    return {
        'applied': True,
        'to_step': next_template.title_template,
        'next_task_id': next_task.id if next_task else None,
    }
