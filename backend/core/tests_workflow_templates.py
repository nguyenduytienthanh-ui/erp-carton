"""
Tests for WorkflowTaskTemplate: generate, idempotency, preview.
"""
from django.test import TestCase
from django.utils import timezone as django_timezone
from rest_framework.test import APIClient
from core.models import User, WorkflowTaskTemplate, Task, Notification, AuditLog, Setting
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
    get_pipeline_analytics,
    run_pipeline_automation,
    get_workflow_playbook_suggestions,
    apply_workflow_playbook,
    bulk_pipeline_action,
    execute_insight_action,
    execute_insight_actions_batch,
    get_insight_action_history,
)
from sales.models import SalesOrder, SalesOrderStatus
from datetime import date, timedelta


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

    def test_pipeline_board_marks_card_as_at_risk_when_due_tomorrow(self):
        created = generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        first = created[0]
        first.due_date = date.today() + timedelta(days=1)
        first.save(update_fields=['due_date', 'updated_at'])

        data = build_workflow_pipeline_board(entity_type='SalesOrder', trigger='SUBMIT', limit=50)
        first_col_cards = data['columns'][0]['cards']
        card = next(c for c in first_col_cards if c['entity_id'] == self.order.id)
        self.assertEqual(card['sla_state'], 'AT_RISK')

    def test_pipeline_board_marks_over_wip_when_exceed_limit(self):
        first_template = WorkflowTaskTemplate.objects.filter(
            entity_type='SalesOrder',
            trigger='SUBMIT',
        ).order_by('sort_order', 'id').first()
        first_template.tags = ['wip:1']
        first_template.save(update_fields=['tags', 'updated_at'])

        order2 = SalesOrder.objects.create(
            code='SO-PIPE-003',
            order_date=date.today(),
            status=SalesOrderStatus.SUBMITTED,
            owner=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        data = build_workflow_pipeline_board(entity_type='SalesOrder', trigger='SUBMIT', limit=50)
        first_col = data['columns'][0]
        self.assertEqual(first_col['wip_limit'], 1)
        self.assertTrue(first_col['is_over_wip'])

    def test_pipeline_analytics_returns_bottleneck_insights(self):
        first_template = WorkflowTaskTemplate.objects.filter(
            entity_type='SalesOrder',
            trigger='SUBMIT',
        ).order_by('sort_order', 'id').first()
        first_template.tags = ['wip:1']
        first_template.save(update_fields=['tags', 'updated_at'])

        order2 = SalesOrder.objects.create(
            code='SO-PIPE-004',
            order_date=date.today(),
            status=SalesOrderStatus.SUBMITTED,
            owner=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        generate_tasks_for_entity('SalesOrder', order2.id, order2.code, 'SUBMIT', triggered_by=self.user)

        analytics = get_pipeline_analytics(entity_type='SalesOrder', trigger='SUBMIT', days=30)
        self.assertIn('insights', analytics)
        self.assertTrue(any(i['type'] == 'WIP_OVERLOAD' for i in analytics['insights']))

    def test_execute_insight_action_creates_audit_log(self):
        before_count = AuditLog.objects.filter(entity_type='WorkflowAnalytics').count()
        result = execute_insight_action(
            entity_type='SalesOrder',
            trigger='SUBMIT',
            insight_type='WIP_OVERLOAD',
            suggested_action='CHECK_CAPACITY',
            actor=self.user,
        )
        self.assertTrue(result['success'])
        after_count = AuditLog.objects.filter(entity_type='WorkflowAnalytics').count()
        self.assertEqual(after_count, before_count + 1)

    def test_get_insight_action_history_returns_latest_items(self):
        execute_insight_action(
            entity_type='SalesOrder',
            trigger='SUBMIT',
            insight_type='WIP_OVERLOAD',
            suggested_action='CHECK_CAPACITY',
            actor=self.user,
        )
        data = get_insight_action_history(entity_type='SalesOrder', trigger='SUBMIT', limit=10)
        self.assertGreaterEqual(data['total'], 1)
        self.assertEqual(data['items'][0]['insight_type'], 'WIP_OVERLOAD')

    def test_get_insight_action_history_filters_by_action_and_success(self):
        execute_insight_action(
            entity_type='SalesOrder',
            trigger='SUBMIT',
            insight_type='SLA_BREACH_HIGH',
            suggested_action='RUN_AUTOMATION',
            actor=self.user,
        )
        data = get_insight_action_history(
            entity_type='SalesOrder',
            trigger='SUBMIT',
            limit=10,
            suggested_action='RUN_AUTOMATION',
            success=True,
        )
        self.assertGreaterEqual(data['total'], 1)
        self.assertTrue(all(item['suggested_action'] == 'RUN_AUTOMATION' for item in data['items']))
        self.assertTrue(all(item['success'] is True for item in data['items']))

    def test_execute_insight_actions_batch_partial(self):
        result = execute_insight_actions_batch(
            entity_type='SalesOrder',
            trigger='SUBMIT',
            items=[
                {'insight_type': 'WIP_OVERLOAD', 'suggested_action': 'RUN_AUTOMATION'},
                {'insight_type': 'SLA_BREACH_HIGH', 'suggested_action': 'INVALID_ACTION'},
            ],
            actor=self.user,
            stop_on_error=False,
        )
        self.assertTrue(result['success'])
        self.assertEqual(result['total'], 2)
        self.assertEqual(result['success_count'], 1)
        self.assertEqual(result['failed_count'], 1)

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

    def test_pipeline_analytics_includes_summary_and_steps(self):
        created = generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        first = created[0]
        first.assigned_to = self.user
        first.save(update_fields=['assigned_to'])
        first.complete(user=self.user)

        analytics = get_pipeline_analytics(entity_type='SalesOrder', trigger='SUBMIT', days=30)
        self.assertEqual(analytics['entity_type'], 'SalesOrder')
        self.assertEqual(analytics['trigger'], 'SUBMIT')
        self.assertIn('summary', analytics)
        self.assertIn('step_metrics', analytics)
        self.assertGreaterEqual(len(analytics['step_metrics']), 2)
        self.assertGreaterEqual(analytics['summary']['total_tasks'], 2)

    def test_pipeline_analytics_returns_empty_when_no_template(self):
        analytics = get_pipeline_analytics(entity_type='InventoryIssue', trigger='SUBMIT', days=30)
        self.assertEqual(analytics['summary']['entities_total'], 0)
        self.assertEqual(len(analytics['step_metrics']), 0)

    def test_run_pipeline_automation_auto_starts_ready_task(self):
        created = generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        first = created[0]
        second = created[1]
        first.complete(user=self.user)
        second.refresh_from_db()
        self.assertEqual(second.status, Task.STATUS_TODO)

        result = run_pipeline_automation(
            entity_type='SalesOrder',
            trigger='SUBMIT',
            actor=self.user,
            remind_overdue=False,
            auto_start_ready=True,
        )
        self.assertTrue(result['success'])
        self.assertGreaterEqual(result['auto_started_count'], 1)
        second.refresh_from_db()
        self.assertEqual(second.status, Task.STATUS_IN_PROGRESS)

    def test_run_pipeline_automation_sends_overdue_reminder(self):
        created = generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        first = created[0]
        first.assigned_to = self.user
        first.assigned_by = self.other_user
        first.due_date = date.today() - timedelta(days=1)
        first.save(update_fields=['assigned_to', 'assigned_by', 'due_date', 'updated_at'])

        result = run_pipeline_automation(
            entity_type='SalesOrder',
            trigger='SUBMIT',
            actor=self.user,
            remind_overdue=True,
            auto_start_ready=False,
            reminder_cooldown_hours=24,
        )
        self.assertTrue(result['success'])
        self.assertGreaterEqual(result['overdue_reminded_count'], 1)
        self.assertGreaterEqual(Notification.objects.filter(entity_type='Task', entity_id=first.id).count(), 1)

    def test_get_workflow_playbook_suggestions_returns_items(self):
        data = get_workflow_playbook_suggestions(entity_type='SalesOrder', scenario='STANDARD_ORDER')
        self.assertEqual(data['entity_type'], 'SalesOrder')
        self.assertEqual(data['scenario'], 'STANDARD_ORDER')
        self.assertGreaterEqual(len(data['items']), 1)
        self.assertEqual(data['items'][0]['depends_on_previous'], False)
        self.assertTrue(any(str(tag).startswith('sla:') for tag in data['items'][0]['tags']))

    def test_apply_workflow_playbook_creates_templates(self):
        result = apply_workflow_playbook(
            entity_type='SalesOrder',
            scenario='STANDARD_ORDER',
            actor=self.user,
            overwrite_existing=False,
        )
        self.assertTrue(result['success'])
        self.assertGreaterEqual(result['created_count'], 1)
        self.assertGreaterEqual(
            WorkflowTaskTemplate.objects.filter(entity_type='SalesOrder', trigger='SUBMIT').count(),
            1,
        )

    def test_pipeline_analytics_contains_sla_fields(self):
        analytics = get_pipeline_analytics(entity_type='SalesOrder', trigger='SUBMIT', days=30)
        self.assertGreaterEqual(len(analytics['step_metrics']), 1)
        first = analytics['step_metrics'][0]
        self.assertIn('target_cycle_time_hours', first)
        self.assertIn('breached_count', first)
        self.assertIn('breach_rate_percent', first)

    def test_bulk_pipeline_action_advance(self):
        order2 = SalesOrder.objects.create(
            code='SO-PIPE-002',
            order_date=date.today(),
            status=SalesOrderStatus.SUBMITTED,
            owner=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        generate_tasks_for_entity('SalesOrder', order2.id, order2.code, 'SUBMIT', triggered_by=self.user)

        result = bulk_pipeline_action(
            entity_type='SalesOrder',
            trigger='SUBMIT',
            action='ADVANCE',
            items=[
                {'entity_id': self.order.id, 'entity_code': self.order.code},
                {'entity_id': order2.id, 'entity_code': order2.code},
            ],
            actor=self.user,
        )
        self.assertTrue(result['success'])
        self.assertEqual(result['success_count'], 2)


class WorkflowPipelineLiveUpdatesApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('pipeline_live_user')
        self.client.force_authenticate(user=self.user)
        self.order = SalesOrder.objects.create(
            code='SO-LIVE-001',
            order_date=date.today(),
            status=SalesOrderStatus.SUBMITTED,
            owner=self.user,
            created_by=self.user,
            updated_by=self.user,
        )
        _make_template(
            entity_type='SalesOrder',
            trigger='SUBMIT',
            title='Bước live 1 {entity_code}',
            sort_order=1,
            depends_on_previous=False,
        )

    def test_pipeline_live_updates_detects_event_changes(self):
        generate_tasks_for_entity('SalesOrder', self.order.id, self.order.code, 'SUBMIT', triggered_by=self.user)
        checkpoint = django_timezone.now().isoformat()
        first_task = Task.objects.filter(entity_type='SalesOrder', entity_id=self.order.id).order_by('id').first()
        first_task.assigned_to = self.user
        first_task.save(update_fields=['assigned_to', 'updated_at'])
        advance_pipeline_step('SalesOrder', self.order.id, self.order.code, 'SUBMIT', actor=self.user)

        res = self.client.get('/api/workflow-task-templates/pipeline_live_updates/', {
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
            'since': checkpoint,
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get('has_changes'))
        self.assertGreaterEqual(int(data.get('event_changed_count') or 0), 1)


class WorkflowAutomationProfileApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = _make_user('automation_profile_user')
        self.client.force_authenticate(user=self.user)

    def test_get_and_save_automation_profiles(self):
        res_get = self.client.get('/api/workflow-task-templates/automation_profiles/', {
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
        })
        self.assertEqual(res_get.status_code, 200)
        data_get = res_get.json()
        self.assertIn('profiles', data_get)
        self.assertIn('MORNING', data_get['profiles'])

        profiles = data_get['profiles']
        profiles['MORNING']['reminder_cooldown_hours'] = 6
        profiles['MORNING']['auto_start_ready'] = False
        res_save = self.client.post('/api/workflow-task-templates/automation_profiles/', {
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
            'profiles': profiles,
        }, format='json')
        self.assertEqual(res_save.status_code, 200)
        data_save = res_save.json()
        self.assertTrue(data_save.get('success'))
        self.assertEqual(data_save['profiles']['MORNING']['reminder_cooldown_hours'], 6)

    def test_run_automation_profile_and_history(self):
        res_run = self.client.post('/api/workflow-task-templates/run_automation_profile/', {
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
            'profile_key': 'MORNING',
        }, format='json')
        self.assertEqual(res_run.status_code, 200)
        data_run = res_run.json()
        self.assertTrue(data_run.get('success'))
        self.assertEqual(data_run.get('profile_key'), 'MORNING')

        res_history = self.client.get('/api/workflow-task-templates/automation_run_history/', {
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
            'limit': 10,
        })
        self.assertEqual(res_history.status_code, 200)
        data_history = res_history.json()
        self.assertGreaterEqual(data_history.get('total', 0), 1)

    def test_save_and_run_due_automation_schedule(self):
        now_hhmm = django_timezone.localtime().strftime('%H:%M')
        res_save = self.client.post('/api/workflow-task-templates/automation_schedule/', {
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
            'enabled': True,
            'slots': [
                {'profile_key': 'MORNING', 'time': now_hhmm, 'active': True},
            ],
        }, format='json')
        self.assertEqual(res_save.status_code, 200)
        save_data = res_save.json()
        self.assertTrue(save_data.get('success'))
        self.assertTrue(save_data.get('enabled'))

        res_run = self.client.post('/api/workflow-task-templates/run_due_automation_schedule/', {
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
            'dry_run': False,
        }, format='json')
        self.assertEqual(res_run.status_code, 200)
        run_data = res_run.json()
        self.assertTrue(run_data.get('success'))
        self.assertGreaterEqual(int(run_data.get('executed_count') or 0), 1)

        res_history = self.client.get('/api/workflow-task-templates/automation_run_history/', {
            'entity_type': 'SalesOrder',
            'trigger': 'SUBMIT',
            'run_mode': 'SCHEDULE',
            'limit': 10,
        })
        self.assertEqual(res_history.status_code, 200)
        history_data = res_history.json()
        self.assertGreaterEqual(history_data.get('total', 0), 1)

    def test_scheduler_job_status_toggle(self):
        res_get = self.client.get('/api/workflow-task-templates/scheduler_job_status/')
        self.assertEqual(res_get.status_code, 200)
        data_get = res_get.json()
        self.assertIn('enabled', data_get)
        self.assertIn('interval_minutes', data_get)

        res_save = self.client.post('/api/workflow-task-templates/scheduler_job_status/', {
            'enabled': True,
            'interval_minutes': 7,
        }, format='json')
        self.assertEqual(res_save.status_code, 200)
        save_data = res_save.json()
        self.assertTrue(save_data.get('success'))
        self.assertEqual(int(save_data.get('interval_minutes') or 0), 7)

        res_recover = self.client.post('/api/workflow-task-templates/scheduler_recover/', {
            'interval_minutes': 9,
            'clear_lock': True,
        }, format='json')
        self.assertEqual(res_recover.status_code, 200)
        recover_data = res_recover.json()
        self.assertTrue(recover_data.get('success'))
        self.assertTrue(recover_data.get('enabled'))
        self.assertEqual(int(recover_data.get('interval_minutes') or 0), 9)

    def test_scheduler_health_returns_metrics(self):
        AuditLog.objects.create(
            user=self.user,
            action='UPDATE',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['job_run'],
            old_values={},
            new_values={'status': 'SUCCESS', 'duration_ms': 1200, 'message': 'ok'},
        )
        AuditLog.objects.create(
            user=self.user,
            action='UPDATE',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['job_run'],
            old_values={},
            new_values={'status': 'FAILED', 'duration_ms': 800, 'message': 'boom'},
        )
        res = self.client.get('/api/workflow-task-templates/scheduler_health/', {'hours': 24})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn('status_counts', data)
        self.assertGreaterEqual(int(data['status_counts']['SUCCESS']), 1)
        self.assertGreaterEqual(int(data['status_counts']['FAILED']), 1)

    def test_scheduler_policy_and_notify_admins(self):
        admin = _make_user('automation_admin')
        admin.is_staff = True
        admin.save(update_fields=['is_staff'])

        res_get = self.client.get('/api/workflow-task-templates/scheduler_policy/')
        self.assertEqual(res_get.status_code, 200)
        self.assertIn('failure_threshold', res_get.json())

        res_save = self.client.post('/api/workflow-task-templates/scheduler_policy/', {
            'failure_threshold': 4,
        }, format='json')
        self.assertEqual(res_save.status_code, 200)
        self.assertTrue(res_save.json().get('success'))
        setting = Setting.objects.get(key='WORKFLOW_AUTOMATION_FAILURE_THRESHOLD')
        self.assertEqual(setting.value, '4')

        before_count = Notification.objects.filter(
            recipient=admin,
            entity_type='WorkflowAutomationJob',
            entity_id=0,
        ).count()
        res_notify = self.client.post('/api/workflow-task-templates/scheduler_notify_admins/', {
            'message': 'Test cảnh báo thủ công',
        }, format='json')
        self.assertEqual(res_notify.status_code, 200)
        data_notify = res_notify.json()
        self.assertTrue(data_notify.get('success'))
        self.assertGreaterEqual(int(data_notify.get('notified_admin_count') or 0), 1)
        after_count = Notification.objects.filter(
            recipient=admin,
            entity_type='WorkflowAutomationJob',
            entity_id=0,
        ).count()
        self.assertGreater(after_count, before_count)

    def test_scheduler_policy_preset_and_incidents(self):
        res_preset = self.client.post('/api/workflow-task-templates/scheduler_apply_policy_preset/', {
            'preset_key': 'BALANCED',
        }, format='json')
        self.assertEqual(res_preset.status_code, 200)
        preset_data = res_preset.json()
        self.assertTrue(preset_data.get('success'))
        self.assertEqual(preset_data.get('failure_threshold'), 3)

        AuditLog.objects.create(
            user=self.user,
            action='UPDATE',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['job_run'],
            old_values={},
            new_values={'status': 'FAILED', 'message': 'incident test', 'run_mode': 'MANUAL_SIMULATION', 'duration_ms': 0},
        )
        res_incidents = self.client.get('/api/workflow-task-templates/scheduler_incidents/', {
            'status': 'FAILED',
            'limit': 10,
        })
        self.assertEqual(res_incidents.status_code, 200)
        incidents_data = res_incidents.json()
        self.assertGreaterEqual(incidents_data.get('total', 0), 1)
        first = incidents_data['items'][0]
        self.assertIn('event_type', first)
        self.assertIn('policy_diff', first)

    def test_scheduler_simulate_failure_requires_admin(self):
        # user thường không được phép
        res_forbidden = self.client.post('/api/workflow-task-templates/scheduler_simulate_failure/', {
            'reason': 'forbidden test',
        }, format='json')
        self.assertEqual(res_forbidden.status_code, 403)

        # staff được phép
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        res_ok = self.client.post('/api/workflow-task-templates/scheduler_simulate_failure/', {
            'reason': 'staff simulation',
        }, format='json')
        self.assertEqual(res_ok.status_code, 200)
        data_ok = res_ok.json()
        self.assertTrue(data_ok.get('success'))
        self.assertTrue(data_ok.get('simulated'))

    def test_scheduler_health_has_recommended_actions(self):
        AuditLog.objects.create(
            user=self.user,
            action='UPDATE',
            entity_type='WorkflowAutomationJob',
            entity_id=0,
            entity_id_str='global',
            entity_code='WORKFLOW_AUTOMATION_JOB',
            changed_fields=['job_run'],
            old_values={},
            new_values={'status': 'FAILED', 'message': 'lock timeout', 'run_mode': 'SCHEDULE_JOB', 'duration_ms': 100},
        )
        res = self.client.get('/api/workflow-task-templates/scheduler_health/', {'hours': 24})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn('recommended_actions', data)
        self.assertTrue(len(data.get('recommended_actions', [])) >= 1)
