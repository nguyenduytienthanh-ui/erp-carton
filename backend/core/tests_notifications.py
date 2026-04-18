from django.test import TestCase
from django.utils import timezone as django_timezone
from rest_framework.test import APIClient

from core.models import Notification, User


class NotificationApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='notify_user', password='pass')
        self.actor = User.objects.create_user(username='notify_actor', password='pass')
        self.client.force_authenticate(user=self.user)

    def test_mark_many_read(self):
        n1 = Notification.objects.create(
            recipient=self.user,
            notification_type='system',
            title='N1',
            message='msg1',
            actor=self.actor,
            is_read=False,
        )
        n2 = Notification.objects.create(
            recipient=self.user,
            notification_type='assignment',
            title='N2',
            message='msg2',
            actor=self.actor,
            is_read=False,
        )
        res = self.client.post('/api/notifications/mark_many_read/', {'ids': [n1.id, n2.id]}, format='json')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data['success'])
        self.assertEqual(data['count'], 2)
        n1.refresh_from_db()
        n2.refresh_from_db()
        self.assertTrue(n1.is_read)
        self.assertTrue(n2.is_read)

    def test_live_updates_detects_new_notifications(self):
        checkpoint = django_timezone.now().isoformat()
        Notification.objects.create(
            recipient=self.user,
            notification_type='system',
            title='After checkpoint',
            message='msg',
            actor=self.actor,
        )
        res = self.client.get('/api/notifications/live_updates/', {'since': checkpoint})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data['has_changes'])
        self.assertGreaterEqual(int(data['changed_count']), 1)
        self.assertGreaterEqual(int(data['unread_count']), 1)
