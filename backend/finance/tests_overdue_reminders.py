from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from core.models import Notification, User
from finance.models import AdvanceTransaction, CashAccount
from finance.reminders import (
    ensure_overdue_reminder_schedule,
    run_daily_overdue_reminder_job,
    save_reminder_policy,
)


class FinanceOverdueReminderJobTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = User.objects.create_user(username='finance_staff', password='pass', is_staff=True, is_active=True)
        self.staff_2 = User.objects.create_user(username='finance_staff_2', password='pass', is_staff=True, is_active=True)
        self.normal = User.objects.create_user(username='normal_user', password='pass', is_staff=False, is_active=True)
        self.client.force_authenticate(self.staff)
        self.cash_account = CashAccount.objects.create(
            name='Quy nhac qua han',
            account_type=CashAccount.TYPE_CASH,
            balance=Decimal('50000000'),
            is_active=True,
            created_by=self.staff,
            updated_by=self.staff,
        )

    def test_run_daily_overdue_reminder_creates_notification_and_is_idempotent(self):
        as_of = date.today()
        AdvanceTransaction.objects.create(
            code='TA901',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=as_of - timedelta(days=100),
            recipient_name='Nguoi qua han',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('2000000'),
            purpose='Tam ung qua han',
            status=AdvanceTransaction.STATUS_OPEN,
            approval_status=AdvanceTransaction.APPROVAL_APPROVED,
            is_active=True,
            created_by=self.staff,
            updated_by=self.staff,
        )

        first = run_daily_overdue_reminder_job(threshold_days=90, as_of=as_of.isoformat())
        self.assertTrue(first['success'])
        self.assertEqual(first['sent_count'], 2)
        self.assertEqual(Notification.objects.filter(recipient=self.staff).count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.staff_2).count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.normal).count(), 0)

        second = run_daily_overdue_reminder_job(threshold_days=90, as_of=as_of.isoformat())
        self.assertTrue(second['success'])
        self.assertEqual(second['sent_count'], 0)
        self.assertEqual(Notification.objects.filter(recipient=self.staff).count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.staff_2).count(), 1)

    def test_ensure_overdue_reminder_schedule(self):
        result = ensure_overdue_reminder_schedule()
        self.assertTrue(result.get('success'))

    def test_remind_overdue_action(self):
        as_of = date.today()
        AdvanceTransaction.objects.create(
            code='TA902',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=as_of - timedelta(days=100),
            recipient_name='Nguoi qua han api',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('1500000'),
            purpose='Tam ung qua han API',
            status=AdvanceTransaction.STATUS_OPEN,
            approval_status=AdvanceTransaction.APPROVAL_APPROVED,
            is_active=True,
            created_by=self.staff,
            updated_by=self.staff,
        )
        response = self.client.post(
            '/api/finance/advance-transactions/remind_overdue/',
            {'threshold_days': 90, 'as_of': as_of.isoformat()},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertGreaterEqual(payload['sent_count'], 1)
        self.assertIn('sent_usernames', payload)

    def test_reminder_history_action(self):
        save_reminder_policy({
            'default_threshold_days': 90,
            'cooldown_hours': 0,
        })
        as_of = date.today()
        AdvanceTransaction.objects.create(
            code='TA903',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=as_of - timedelta(days=100),
            recipient_name='Nguoi qua han history',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('1100000'),
            purpose='Tam ung history',
            status=AdvanceTransaction.STATUS_OPEN,
            approval_status=AdvanceTransaction.APPROVAL_APPROVED,
            is_active=True,
            created_by=self.staff,
            updated_by=self.staff,
        )
        first_day = as_of.isoformat()
        second_day = (as_of + timedelta(days=1)).isoformat()
        self.client.post('/api/finance/advance-transactions/remind_overdue/', {'threshold_days': 90, 'as_of': first_day}, format='json')
        self.client.post('/api/finance/advance-transactions/remind_overdue/', {'threshold_days': 90, 'as_of': second_day}, format='json')

        history_resp = self.client.get('/api/finance/advance-transactions/reminder_history/', {'days': 60})
        self.assertEqual(history_resp.status_code, 200)
        history = history_resp.json()
        self.assertGreaterEqual(history['count'], 2)
        self.assertGreaterEqual(history['items'][0]['sent_count'], 1)
        self.assertIn('summary', history)
        self.assertIn('overall_read_rate', history['summary'])
        self.assertIn('top_unread_recipients', history['summary'])
        self.assertGreaterEqual(len(history['summary']['top_unread_recipients']), 1)
        filtered_resp = self.client.get(
            '/api/finance/advance-transactions/reminder_history/',
            {'days': 60, 'as_of_from': first_day, 'as_of_to': first_day, 'unread_only': 'true'},
        )
        self.assertEqual(filtered_resp.status_code, 200)
        filtered = filtered_resp.json()
        self.assertGreaterEqual(filtered['count'], 1)
        self.assertTrue(filtered.get('filters', {}).get('unread_only'))
        export_resp = self.client.get(
            '/api/finance/advance-transactions/reminder_history/',
            {'days': 60, 'export': 'excel'},
        )
        self.assertEqual(export_resp.status_code, 200)
        self.assertIn(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            export_resp.get('Content-Type', ''),
        )

    def test_remind_overdue_action_supports_target_recipients(self):
        as_of = date.today()
        AdvanceTransaction.objects.create(
            code='TA904',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=as_of - timedelta(days=100),
            recipient_name='Nguoi qua han target',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('1200000'),
            purpose='Tam ung target',
            status=AdvanceTransaction.STATUS_OPEN,
            approval_status=AdvanceTransaction.APPROVAL_APPROVED,
            is_active=True,
            created_by=self.staff,
            updated_by=self.staff,
        )
        response = self.client.post(
            '/api/finance/advance-transactions/remind_overdue/',
            {
                'threshold_days': 90,
                'as_of': as_of.isoformat(),
                'recipient_usernames': [self.staff_2.username, self.normal.username],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['sent_count'], 1)
        self.assertEqual(Notification.objects.filter(recipient=self.staff_2).count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.normal).count(), 0)

    def test_policy_user_threshold_and_cooldown(self):
        save_reminder_policy({
            'default_threshold_days': 120,
            'cooldown_hours': 24,
            'user_threshold_days': {
                self.staff.username: 90,
                self.staff_2.username: 120,
            },
        })
        as_of = date.today()
        AdvanceTransaction.objects.create(
            code='TA905',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=as_of - timedelta(days=100),
            recipient_name='Nguoi qua han policy',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('1300000'),
            purpose='Tam ung policy',
            status=AdvanceTransaction.STATUS_OPEN,
            approval_status=AdvanceTransaction.APPROVAL_APPROVED,
            is_active=True,
            created_by=self.staff,
            updated_by=self.staff,
        )
        first = run_daily_overdue_reminder_job(threshold_days=None, as_of=as_of.isoformat())
        self.assertEqual(first['sent_count'], 1)
        self.assertEqual(Notification.objects.filter(recipient=self.staff).count(), 1)
        self.assertEqual(Notification.objects.filter(recipient=self.staff_2).count(), 0)

        second = run_daily_overdue_reminder_job(threshold_days=None, as_of=(as_of + timedelta(days=1)).isoformat())
        self.assertEqual(second['sent_count'], 0)
        self.assertIn(self.staff.username, second.get('skipped_cooldown_usernames', []))

    def test_reminder_policy_endpoint(self):
        get_resp = self.client.get('/api/finance/advance-transactions/reminder_policy/')
        self.assertEqual(get_resp.status_code, 200)
        payload = get_resp.json()
        self.assertIn('default_threshold_days', payload)
        self.assertIn('presets', payload)
        self.assertIn('balanced', payload.get('presets', {}))
        self.assertIn('recommendation', payload)
        self.assertIn('recommended_preset_key', payload.get('recommendation', {}))
        old_default_threshold = int(payload.get('default_threshold_days') or 90)
        post_resp = self.client.post(
            '/api/finance/advance-transactions/reminder_policy/',
            {
                'default_threshold_days': 95,
                'cooldown_hours': 12,
                'role_threshold_days': {'finance-manager': 70},
                'user_threshold_days': {self.staff.username: 60},
            },
            format='json',
        )
        self.assertEqual(post_resp.status_code, 200)
        posted = post_resp.json()
        self.assertTrue(posted.get('success'))
        self.assertEqual(posted.get('policy', {}).get('cooldown_hours'), 12)
        history_resp = self.client.get('/api/finance/advance-transactions/reminder_policy_history/', {'limit': 5})
        self.assertEqual(history_resp.status_code, 200)
        history_payload = history_resp.json()
        self.assertGreaterEqual(history_payload.get('count', 0), 1)
        self.assertEqual(history_payload.get('items', [])[0].get('username'), self.staff.username)
        latest_audit_log_id = int(history_payload.get('items', [])[0].get('id'))
        rollback_resp = self.client.post(
            '/api/finance/advance-transactions/reminder_policy_rollback/',
            {'audit_log_id': latest_audit_log_id},
            format='json',
        )
        self.assertEqual(rollback_resp.status_code, 200)
        rollback_payload = rollback_resp.json()
        self.assertTrue(rollback_payload.get('success'))
        self.assertEqual(
            int(rollback_payload.get('policy', {}).get('default_threshold_days') or 0),
            old_default_threshold,
        )

    def test_reminder_policy_simulate_endpoint(self):
        as_of = date.today()
        AdvanceTransaction.objects.create(
            code='TA906',
            advance_type=AdvanceTransaction.TYPE_OTHER,
            advance_date=as_of - timedelta(days=100),
            recipient_name='Nguoi qua han simulate',
            source_type=AdvanceTransaction.SOURCE_CASH,
            source_cash_account=self.cash_account,
            amount=Decimal('1400000'),
            purpose='Tam ung simulate',
            status=AdvanceTransaction.STATUS_OPEN,
            approval_status=AdvanceTransaction.APPROVAL_APPROVED,
            is_active=True,
            created_by=self.staff,
            updated_by=self.staff,
        )
        resp = self.client.post(
            '/api/finance/advance-transactions/reminder_policy_simulate/',
            {
                'as_of': as_of.isoformat(),
                'policy': {
                    'default_threshold_days': 120,
                    'cooldown_hours': 24,
                    'role_threshold_days': {},
                    'user_threshold_days': {},
                },
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertTrue(payload.get('dry_run'))
        self.assertEqual(int(payload.get('would_send_count') or 0), 0)
        self.assertEqual(Notification.objects.count(), 0)

        resp_2 = self.client.post(
            '/api/finance/advance-transactions/reminder_policy_simulate/',
            {
                'as_of': as_of.isoformat(),
                'policy': {
                    'default_threshold_days': 90,
                    'cooldown_hours': 24,
                    'role_threshold_days': {},
                    'user_threshold_days': {},
                },
            },
            format='json',
        )
        self.assertEqual(resp_2.status_code, 200)
        payload_2 = resp_2.json()
        self.assertTrue(payload_2.get('dry_run'))
        self.assertGreaterEqual(int(payload_2.get('would_send_count') or 0), 1)
        self.assertEqual(Notification.objects.count(), 0)