import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Run lightweight HTTP smoke checks against backend/frontend'

    def add_arguments(self, parser):
        parser.add_argument('--backend-base', default='http://127.0.0.1:8000', help='Backend base URL')
        parser.add_argument('--frontend-base', default='', help='Optional frontend base URL')
        parser.add_argument('--username', required=True, help='Login username')
        parser.add_argument('--password', required=True, help='Login password')

    def _request_json(self, url, *, method='GET', data=None, headers=None):
        payload = None if data is None else json.dumps(data).encode('utf-8')
        request = Request(url, data=payload, headers=headers or {}, method=method)
        if payload is not None:
            request.add_header('Content-Type', 'application/json')
        with urlopen(request, timeout=20) as response:
            body = response.read().decode('utf-8')
            return response.status, json.loads(body) if body else {}

    def _request_status(self, url):
        with urlopen(url, timeout=20) as response:
            return response.status

    def handle(self, *args, **options):
        backend_base = str(options['backend_base']).rstrip('/')
        frontend_base = str(options['frontend_base']).rstrip('/')
        username = options['username']
        password = options['password']

        try:
            live_status, live_body = self._request_json(f'{backend_base}/health/live/')
            ready_status, ready_body = self._request_json(f'{backend_base}/health/ready/')
            health_status = self._request_status(f'{backend_base}/health/')
            if live_status != 200 or live_body.get('status') != 'alive':
                raise CommandError(f'Live check failed: status={live_status}, body={live_body}')
            if ready_status != 200 or ready_body.get('status') == 'unhealthy':
                raise CommandError(f'Ready check failed: status={ready_status}, body={ready_body}')
            if health_status != 200:
                raise CommandError(f'Health check failed with status {health_status}')

            login_status, login_body = self._request_json(
                f'{backend_base}/api/auth/login/',
                method='POST',
                data={'username': username, 'password': password},
            )
            if login_status != 200 or not login_body.get('access') or not login_body.get('refresh'):
                raise CommandError('Login did not return access/refresh tokens')

            auth_headers = {'Authorization': f"Bearer {login_body['access']}"}
            me_status, me_body = self._request_json(f'{backend_base}/api/users/me/', headers=auth_headers)
            if me_status != 200:
                raise CommandError(f'/api/users/me/ failed with status {me_status}')

            refresh_status, refresh_body = self._request_json(
                f'{backend_base}/api/auth/refresh/',
                method='POST',
                data={'refresh': login_body['refresh']},
            )
            if refresh_status != 200 or not refresh_body.get('access'):
                raise CommandError('Refresh token flow failed')

            ops_status, _ = self._request_json(
                f'{backend_base}/api/activity/operations_log_meta/',
                headers=auth_headers,
            )
            history_status, _ = self._request_json(
                f'{backend_base}/api/roles/module_permissions_history_meta/',
                headers=auth_headers,
            )
            logout_status, _ = self._request_json(
                f'{backend_base}/api/auth/logout/',
                method='POST',
                data={},
                headers=auth_headers,
            )

            frontend_results = {}
            if frontend_base:
                for route in ('/', '/notifications', '/operations-log', '/admin/module-permissions', '/admin/module-permissions-history'):
                    frontend_results[route] = self._request_status(f'{frontend_base}{route}')

        except HTTPError as exc:
            raise CommandError(f'HTTP error while running smoke check: {exc.code} {exc.reason}') from exc
        except URLError as exc:
            raise CommandError(f'Cannot reach target during smoke check: {exc.reason}') from exc

        result = {
            'health_live': live_status,
            'health_ready': ready_status,
            'health': health_status,
            'me_username': me_body.get('username'),
            'operations_log_meta': ops_status,
            'module_permissions_history_meta': history_status,
            'logout': logout_status,
            'frontend': frontend_results,
        }
        self.stdout.write(self.style.SUCCESS('Smoke check passed.'))
        self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
