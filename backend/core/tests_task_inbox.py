from datetime import date, timedelta
from django.test import TestCase
from django.utils import timezone as django_timezone
from rest_framework.test import APIClient

from core.models import Task, TaskWatcher, User, Team


class TaskInboxApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.manager = User.objects.create_user(username='manager', password='pass')
        self.member = User.objects.create_user(username='member', password='pass')
        self.other = User.objects.create_user(username='other', password='pass')

        team = Team.objects.create(name='Team A', code='TEAM_A')
        self.manager.teams.add(team)
        self.member.teams.add(team)

        self.t1 = Task.objects.create(
            entity_type='Product',
            entity_id=1,
            entity_code='P-001',
            title='Task assigned to manager',
            assigned_to=self.manager,
            assigned_by=self.member,
            due_date=date.today() + timedelta(days=2),
        )
        self.t2 = Task.objects.create(
            entity_type='Product',
            entity_id=2,
            entity_code='P-002',
            title='Task assigned to member',
            assigned_to=self.member,
            assigned_by=self.manager,
            due_date=date.today() - timedelta(days=1),
        )
        self.t3 = Task.objects.create(
            entity_type='Product',
            entity_id=3,
            entity_code='P-003',
            title='Task watched by manager',
            assigned_to=self.other,
            assigned_by=self.other,
        )
        TaskWatcher.objects.create(task=self.t3, user=self.manager)

    def test_my_summary_counts(self):
        self.client.force_authenticate(user=self.manager)
        res = self.client.get('/api/tasks/my_summary/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreaterEqual(data['assigned_to_me'], 1)
        self.assertGreaterEqual(data['created_by_me'], 1)
        self.assertGreaterEqual(data['watching'], 1)
        self.assertGreaterEqual(data['team_members'], 1)
        self.assertGreaterEqual(data['overdue'], 1)

    def test_filter_watching(self):
        self.client.force_authenticate(user=self.manager)
        res = self.client.get('/api/tasks/', {'watching': '1'})
        self.assertEqual(res.status_code, 200)
        raw = res.json()
        data = raw.get('results', raw) if isinstance(raw, dict) else raw
        ids = [item['id'] for item in data]
        self.assertIn(self.t3.id, ids)

    def test_watch_unwatch_actions(self):
        self.client.force_authenticate(user=self.manager)
        res_watch = self.client.post(f'/api/tasks/{self.t1.id}/watch/')
        self.assertEqual(res_watch.status_code, 200)
        self.assertTrue(TaskWatcher.objects.filter(task=self.t1, user=self.manager).exists())

        res_unwatch = self.client.post(f'/api/tasks/{self.t1.id}/unwatch/')
        self.assertEqual(res_unwatch.status_code, 200)
        self.assertFalse(TaskWatcher.objects.filter(task=self.t1, user=self.manager).exists())

    def test_bulk_action_start_success(self):
        self.client.force_authenticate(user=self.manager)
        task = Task.objects.create(
            entity_type='Product',
            entity_id=99,
            entity_code='P-099',
            title='Bulk start test',
            assigned_to=self.manager,
            assigned_by=self.member,
            status=Task.STATUS_TODO,
        )
        res = self.client.post('/api/tasks/bulk_action/', {
            'action': 'START',
            'task_ids': [task.id],
        }, format='json')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data['success_count'], 1)
        self.assertEqual(data['failed_count'], 0)
        task.refresh_from_db()
        self.assertEqual(task.status, Task.STATUS_IN_PROGRESS)

    def test_bulk_action_complete_partial_with_invalid(self):
        self.client.force_authenticate(user=self.manager)
        open_task = Task.objects.create(
            entity_type='Product',
            entity_id=100,
            entity_code='P-100',
            title='Bulk complete valid',
            assigned_to=self.manager,
            assigned_by=self.member,
            status=Task.STATUS_IN_PROGRESS,
        )
        done_task = Task.objects.create(
            entity_type='Product',
            entity_id=101,
            entity_code='P-101',
            title='Bulk complete done',
            assigned_to=self.manager,
            assigned_by=self.member,
            status=Task.STATUS_DONE,
        )
        res = self.client.post('/api/tasks/bulk_action/', {
            'action': 'COMPLETE',
            'task_ids': [open_task.id, done_task.id],
        }, format='json')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data['success_count'], 1)
        self.assertEqual(data['failed_count'], 1)
        open_task.refresh_from_db()
        done_task.refresh_from_db()
        self.assertEqual(open_task.status, Task.STATUS_DONE)
        self.assertEqual(done_task.status, Task.STATUS_DONE)

    def test_bulk_history_and_clear(self):
        self.client.force_authenticate(user=self.manager)
        task = Task.objects.create(
            entity_type='Product',
            entity_id=110,
            entity_code='P-110',
            title='Bulk history test',
            assigned_to=self.manager,
            assigned_by=self.member,
            status=Task.STATUS_TODO,
        )
        res_run = self.client.post('/api/tasks/bulk_action/', {
            'action': 'START',
            'task_ids': [task.id],
        }, format='json')
        self.assertEqual(res_run.status_code, 200)

        res_history = self.client.get('/api/tasks/bulk_history/', {'action': 'START', 'result': 'SUCCESS'})
        self.assertEqual(res_history.status_code, 200)
        history = res_history.json()
        self.assertGreaterEqual(history.get('total', 0), 1)

        res_clear = self.client.post('/api/tasks/clear_bulk_history/', {}, format='json')
        self.assertEqual(res_clear.status_code, 200)
        clear_data = res_clear.json()
        self.assertTrue(clear_data.get('success'))

    def test_live_updates_detects_task_changes(self):
        self.client.force_authenticate(user=self.manager)
        checkpoint = django_timezone.now().isoformat()
        self.t1.start()
        res = self.client.get('/api/tasks/live_updates/', {
            'since': checkpoint,
            'mine': '1',
            'is_open': '1',
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get('has_changes'))
        self.assertGreaterEqual(int(data.get('task_changed_count') or 0), 1)
