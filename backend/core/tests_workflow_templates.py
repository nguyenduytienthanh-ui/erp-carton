"""
Tests for WorkflowTaskTemplate: generate, idempotency, preview.
"""
from django.test import TestCase
from core.models import User, WorkflowTaskTemplate, Task
from core.serializers import WorkflowTaskTemplateSerializer
from core.workflow_services import (
    generate_tasks_for_entity,
    preview_tasks_for_entity,
    build_workflow_pipeline_board,
    advance_pipeline_step,
    move_pipeline_card,
    get_pipeline_timeline,
    auto_advance_pipeline_from_completed_task,
    retry_pipeline_from_failed,
)
from sales.models import SalesOrder, SalesOrderStatus
from datetime import date


def _make_user(username='testuser'):
    return User.objects.create_user(username=username, password='pass')


def _make_template(entity_type='SalesOrder', trigger='SUBMIT', title='Task {entity_code}', **kwargs):
    defaults = dict(
        entity_type=entity_type,
        trigger=trigger,
        title_template=title,
        description_template='Mô tả cho {entity_code}',
        due_in_days=3,
        priority='MEDIUM',
        is_active=True,
    )
    defaults.update(kwargs)
    return WorkflowTaskTemplate.objects.create(**defaults)


class GenerateTasksTest(TestCase):
    def setUp(self):
        self.user = _make_user()

    def test_generates_task_from_template(self):
        tmpl = _make_template(title='Kiểm tra đơn {entity_code}')
        created = generate_tasks_for_entity('SalesOrder', 1, 'SO-001', 'SUBMIT', triggered_by=self.user)
        self.assertEqual(len(created), 1)
        task = created[0]
        self.assertEqual(task.title, 'Kiểm tra đơn SO-001')
        self.assertEqual(task.entity_type, 'SalesOrder')
        self.assertEqual(task.entity_id, 1)
        self.assertEqual(task.entity_code, 'SO-001')
        self.assertEqual(task.source_key, f'wft-{tmpl.id}-SalesOrder-1')

    def test_idempotency_no_duplicate(self):
        _make_template()
        generate_tasks_for_entity('SalesOrder', 1, 'SO-001', 'SUBMIT', triggered_by=self.user)
        # Gọi lại lần 2 — không tạo thêm
        created_second = generate_tasks_for_entity('SalesOrder', 1, 'SO-001', 'SUBMIT', triggered_by=self.user)
        self.assertEqual(len(created_second), 0)
        self.assertEqual(Task.objects.filter(entity_type='SalesOrder', entity_id=1).count(), 1)

    def test_different_entity_gets_own_task(self):
        _make_template()
        generate_tasks_for_entity('SalesOrder', 1, 'SO-001', 'SUBMIT', triggered_by=self.user)
        created2 = generate_tasks_for_entity('SalesOrder', 2, 'SO-002', 'SUBMIT', triggered_by=self.user)
        self.assertEqual(len(created2), 1)
        self.assertEqual(Task.objects.filter(entity_type='SalesOrder').count(), 2)

    def test_inactive_template_skipped(self):
        _make_template(is_active=False)
        created = generate_tasks_for_entity('SalesOrder', 1, 'SO-001', 'SUBMIT', triggered_by=self.user)
        self.assertEqual(len(created), 0)

    def test_wrong_trigger_skipped(self):
        _make_template(trigger='APPROVE')
        created = generate_tasks_for_entity('SalesOrder', 1, 'SO-001', 'SUBMIT', triggered_by=self.user)
        self.assertEqual(len(created), 0)

    def test_multiple_templates_same_trigger(self):
        _make_template(title='Task A {entity_code}', sort_order=1)
        _make_template(title='Task B {entity_code}', sort_order=2)
        created = generate_tasks_for_entity('SalesOrder', 1, 'SO-001', 'SUBMIT', triggered_by=self.user)
        self.assertEqual(len(created), 2)
        titles = [t.title for t in created]
        self.assertIn('Task A SO-001', titles)
        self.assertIn('Task B SO-001', titles)

    def test_preview_returns_would_skip_false_when_not_exists(self):
        _make_template(title='Preview {entity_code}')
        preview = preview_tasks_for_entity('SalesOrder', 1, 'SO-001', 'SUBMIT')
        self.assertEqual(len(preview), 1)
        self.assertFalse(preview[0]['would_skip'])
        self.assertEqual(preview[0]['title'], 'Preview SO-001')

    def test_preview_returns_would_skip_true_when_exists(self):
        _make_template()
        generate_tasks_for_entity('SalesOrder', 1, 'SO-001', 'SUBMIT', triggered_by=self.user)
        preview = preview_tasks_for_entity('SalesOrder', 1, 'SO-001', 'SUBMIT')
        self.assertTrue(preview[0]['would_skip'])

    def test_assign_rule_user(self):
        target_user = _make_user('worker')
        _make_template(assign_rule={'type': 'user', 'id': target_user.id})
        created = generate_tasks_for_entity('SalesOrder', 10, 'SO-010', 'SUBMIT', triggered_by=self.user)
        self.assertEqual(created[0].assigned_to, target_user)

    def test_second_template_depends_on_previous_task(self):
        _make_template(title='Bước 1 {entity_code}', sort_order=1, depends_on_previous=False)
        _make_template(title='Bước 2 {entity_code}', sort_order=2, depends_on_previous=True)
        created = generate_tasks_for_entity('SalesOrder', 33, 'SO-033', 'SUBMIT', triggered_by=self.user)
        self.assertEqual(len(created), 2)
        self.assertIsNone(created[0].depends_on)
        self.assertEqual(created[1].depends_on_id, created[0].id)

    def test_preview_includes_dependency_source_key(self):
        t1 = _make_template(title='Bước 1 {entity_code}', sort_order=1, depends_on_previous=False)
        t2 = _make_template(title='Bước 2 {entity_code}', sort_order=2, depends_on_previous=True)
        preview = preview_tasks_for_entity('SalesOrder', 44, 'SO-044', 'SUBMIT')
        self.assertEqual(len(preview), 2)
        self.assertEqual(preview[0]['source_key'], f'wft-{t1.id}-SalesOrder-44')
        self.assertEqual(preview[1]['source_key'], f'wft-{t2.id}-SalesOrder-44')
        self.assertEqual(preview[1]['depends_on_source_key'], preview[0]['source_key'])


class WorkflowTaskTemplateSerializerValidationTest(TestCase):
    def test_assign_rule_empty_is_normalized(self):
        serializer = WorkflowTaskTemplateSerializer(data={
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
            'title_template': 'Task {entity_code}',
            'assign_rule': {},
            'due_in_days': 3,
            'priority': 'MEDIUM',
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['assign_rule'], {})

    def test_assign_rule_user_normalizes_id_to_int(self):
        serializer = WorkflowTaskTemplateSerializer(data={
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
            'title_template': 'Task {entity_code}',
            'assign_rule': {'type': 'user', 'id': '12'},
            'due_in_days': 3,
            'priority': 'MEDIUM',
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['assign_rule'], {'type': 'user', 'id': 12})

    def test_assign_rule_role_requires_value(self):
        serializer = WorkflowTaskTemplateSerializer(data={
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
            'title_template': 'Task {entity_code}',
            'assign_rule': {'type': 'role'},
            'due_in_days': 3,
            'priority': 'MEDIUM',
        })
        self.assertFalse(serializer.is_valid())
        self.assertIn('assign_rule', serializer.errors)


class WorkflowPipelineBoardTest(TestCase):
    def setUp(self):
        self.user = _make_user('board_user')
        self.other_user = _make_user('outsider')
        self.order = SalesOrder.objects.create(
            code='SO-PIPE-001',
            order_date=date.today(),
            status=SalesOrderStatus.SUBMITTED,
            owner=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        _make_template(
            entity_type='SalesOrder',
            trigger='SUBMIT',
            title='Bước 1 {entity_code}',
            sort_order=1,
            depends_on_previous=False,
        )
        _make_template(
            entity_type='SalesOrder',
            trigger='SUBMIT',
            title='Bước 2 {entity_code}',
            sort_order=2,
            depends_on_previous=True,
        )

    def test_pipeline_board_puts_order_in_first_column_before_generation(self):
        data = build_workflow_pipeline_board(entity_type='SalesOrder', trigger='SUBMIT', limit=50)
        self.assertGreaterEqual(len(data['columns']), 3)
        first_col_cards = data['columns'][0]['cards']
        self.assertTrue(any(c['entity_id'] == self.order.id for c in first_col_cards))

    def test_pipeline_board_moves_to_done_when_all_steps_done(self):
        created = generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        for task in created:
            task.complete(user=self.user)
        data = build_workflow_pipeline_board(entity_type='SalesOrder', trigger='SUBMIT', limit=50)
        done_col = next(c for c in data['columns'] if c['id'] == 'done')
        self.assertTrue(any(c['entity_id'] == self.order.id for c in done_col['cards']))

    def test_advance_pipeline_step_success(self):
        generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        # Gate: cần assigned_to để complete step
        task = Task.objects.filter(entity_type='SalesOrder', entity_id=self.order.id).order_by('id').first()
        task.assigned_to = self.user
        task.save(update_fields=['assigned_to'])
        result = advance_pipeline_step('SalesOrder', self.order.id, self.order.code, 'SUBMIT', actor=self.user)
        self.assertTrue(result['success'])
        task.refresh_from_db()
        self.assertEqual(task.status, Task.STATUS_DONE)

    def test_move_pipeline_card_to_failed(self):
        generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        first_template = WorkflowTaskTemplate.objects.filter(entity_type='SalesOrder', trigger='SUBMIT').order_by('sort_order', 'id').first()
        result = move_pipeline_card(
            entity_type='SalesOrder',
            entity_id=self.order.id,
            entity_code=self.order.code,
            trigger='SUBMIT',
            target_column_id='failed',
            actor=self.user,
        )
        self.assertTrue(result['success'])
        task = Task.objects.get(entity_type='SalesOrder', entity_id=self.order.id, source_key=f'wft-{first_template.id}-SalesOrder-{self.order.id}')
        self.assertEqual(task.status, Task.STATUS_CANCELLED)

    def test_pipeline_timeline_has_items_after_move(self):
        generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        move_pipeline_card(
            entity_type='SalesOrder',
            entity_id=self.order.id,
            entity_code=self.order.code,
            trigger='SUBMIT',
            target_column_id='failed',
            actor=self.user,
        )
        timeline = get_pipeline_timeline('SalesOrder', self.order.id, limit=20)
        self.assertGreaterEqual(len(timeline), 1)

    def test_retry_pipeline_from_failed(self):
        generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        move_pipeline_card(
            entity_type='SalesOrder',
            entity_id=self.order.id,
            entity_code=self.order.code,
            trigger='SUBMIT',
            target_column_id='failed',
            actor=self.user,
        )
        result = retry_pipeline_from_failed(
            entity_type='SalesOrder',
            entity_id=self.order.id,
            entity_code=self.order.code,
            trigger='SUBMIT',
            actor=self.user,
        )
        self.assertTrue(result['success'])
        first = Task.objects.filter(entity_type='SalesOrder', entity_id=self.order.id).order_by('id').first()
        self.assertEqual(first.status, Task.STATUS_TODO)

    def test_pipeline_board_supports_product_entity(self):
        _make_template(
            entity_type='Product',
            trigger='MANUAL',
            title='Kiểm tra mẫu {entity_code}',
            sort_order=1,
            depends_on_previous=False,
        )
        generate_tasks_for_entity('Product', 501, 'PRD-501', 'MANUAL', triggered_by=self.user)
        data = build_workflow_pipeline_board(entity_type='Product', trigger='MANUAL', limit=50)
        self.assertGreaterEqual(len(data['columns']), 3)
        cards = []
        for col in data['columns']:
            cards.extend(col['cards'])
        self.assertTrue(any(c['entity_id'] == 501 for c in cards))

    def test_pipeline_board_returns_columns_with_no_entity_records(self):
        _make_template(
            entity_type='Customer',
            trigger='MANUAL',
            title='Check customer {entity_code}',
            sort_order=1,
            depends_on_previous=False,
        )
        data = build_workflow_pipeline_board(entity_type='Customer', trigger='MANUAL', limit=50)
        self.assertGreaterEqual(len(data['columns']), 1)
        self.assertEqual(data['meta'].get('diagnostic_code'), 'NO_ENTITY_RECORD')

    def test_advance_pipeline_denied_for_unauthorized_user(self):
        generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        task = Task.objects.filter(entity_type='SalesOrder', entity_id=self.order.id).order_by('id').first()
        task.assigned_to = self.user
        task.save(update_fields=['assigned_to'])
        result = advance_pipeline_step('SalesOrder', self.order.id, self.order.code, 'SUBMIT', actor=self.other_user)
        self.assertFalse(result['success'])
        self.assertIn('không có quyền', result['error'])

    def test_auto_advance_when_task_completed(self):
        created = generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        first = created[0]
        second = created[1]
        first.assigned_to = self.user
        first.save(update_fields=['assigned_to'])
        first.complete(user=self.user)
        result = auto_advance_pipeline_from_completed_task(first, actor=self.user)
        self.assertTrue(result['applied'])
        second.refresh_from_db()
        self.assertEqual(second.status, Task.STATUS_IN_PROGRESS)

    def test_advance_auto_assigns_actor_if_unassigned(self):
        generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        first = Task.objects.filter(entity_type='SalesOrder', entity_id=self.order.id).order_by('id').first()
        self.assertIsNone(first.assigned_to_id)
        result = advance_pipeline_step('SalesOrder', self.order.id, self.order.code, 'SUBMIT', actor=self.user)
        self.assertTrue(result['success'])
        first.refresh_from_db()
        self.assertEqual(first.assigned_to_id, self.user.id)
        self.assertEqual(first.status, Task.STATUS_DONE)

    def test_assign_rule_rejects_non_object(self):
        serializer = WorkflowTaskTemplateSerializer(data={
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
            'title_template': 'Task {entity_code}',
            'assign_rule': 'not-a-json-object',
            'due_in_days': 3,
            'priority': 'MEDIUM',
        })
        self.assertFalse(serializer.is_valid())
        self.assertIn('assign_rule', serializer.errors)
