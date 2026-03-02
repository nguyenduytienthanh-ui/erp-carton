"""
Dịch vụ sinh task tự động từ WorkflowTaskTemplate.
"""
from datetime import timedelta
from django.utils import timezone
from typing import Optional


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
            'cards': [],
        })
    columns.extend([
        {'id': 'done', 'template_id': None, 'title': 'Done', 'cards': []},
        {'id': 'failed', 'template_id': None, 'title': 'Failed', 'cards': []},
    ])

    col_index = {col['id']: col for col in columns}
    card_count = 0
    today = timezone.localdate()

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
            'current_task_due_date': current_task.due_date.isoformat() if current_task and current_task.due_date else None,
            'sla_state': (
                'OVERDUE'
                if current_task and current_task.due_date and current_task.due_date < today
                else 'DUE_TODAY'
                if current_task and current_task.due_date and current_task.due_date == today
                else 'ON_TRACK'
            ),
            'updated_at': meta.get('updated_at'),
        }
        target_col['cards'].append(card)
        card_count += 1

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
