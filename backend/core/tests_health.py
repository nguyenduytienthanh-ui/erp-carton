from django.test import TestCase


class HealthEndpointsTest(TestCase):
    def test_live_endpoint_returns_alive(self):
        response = self.client.get('/health/live/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get('status'), 'alive')
        self.assertTrue(response.get('X-Request-ID'))

    def test_ready_endpoint_returns_database_and_media_checks(self):
        response = self.client.get('/health/ready/')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn('database', body.get('checks', {}))
        self.assertIn('media', body.get('checks', {}))

    def test_health_endpoint_returns_extended_checks_by_default(self):
        response = self.client.get('/health/')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn('queue', body.get('checks', {}))
        self.assertIn('data', body.get('checks', {}))

    def test_health_endpoint_preserves_incoming_request_id(self):
        response = self.client.get('/health/live/', HTTP_X_REQUEST_ID='req-erp-carton-test')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get('X-Request-ID'), 'req-erp-carton-test')
