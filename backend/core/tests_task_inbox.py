from datetime import date, timedelta
from django.test import TestCase
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
