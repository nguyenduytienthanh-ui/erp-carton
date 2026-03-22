import json

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from core.management.commands.bootstrap_uat_demo import USER_MATRIX
from core.views import _build_access_surface_matrix_payload


class Command(BaseCommand):
    help = 'Summarize route/API/critical-action access for the stable UAT persona matrix'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true', help='Print result as JSON')
        parser.add_argument('--strict', action='store_true', help='Exit non-zero when expected personas are missing')
        parser.add_argument('--usernames', nargs='*', help='Optional subset of usernames to inspect')

    def handle(self, *args, **options):
        user_model = get_user_model()
        requested = [str(item).strip() for item in (options.get('usernames') or []) if str(item).strip()]
        expected = requested or [str(row.get('username') or '').strip() for row in USER_MATRIX if str(row.get('username') or '').strip()]
        existing_users = {
            row.username: row
            for row in user_model.objects.filter(username__in=expected).prefetch_related('roles__permissions', 'teams')
        }
        items = []
        missing = []
        for username in expected:
            user = existing_users.get(username)
            if user is None:
                missing.append(username)
                continue
            payload = _build_access_surface_matrix_payload(user)
            items.append({
                'username': username,
                'role_names': payload['role_names'],
                'allowed_route_keys': [row['key'] for row in payload['frontend_routes'] if row['allowed']],
                'allowed_api_keys': [row['key'] for row in payload['api_surfaces'] if row['allowed']],
                'allowed_critical_action_keys': [row['key'] for row in payload.get('critical_actions', []) if row['allowed']],
                'summary': payload['summary'],
            })

        payload = {
            'expected_count': len(expected),
            'available_count': len(items),
            'missing_count': len(missing),
            'missing_usernames': missing,
            'items': items,
            'overall_status': 'ok' if not missing else 'warning',
        }

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"UAT access matrix: {payload['overall_status'].upper()}")
            self.stdout.write(f"- available personas: {payload['available_count']}/{payload['expected_count']}")
            if missing:
                self.stdout.write(f"- missing personas: {', '.join(missing)}")
            for item in items:
                self.stdout.write(
                    f"* {item['username']}: routes={item['summary']['allowed_route_count']}, "
                    f"apis={item['summary']['allowed_api_surface_count']}, "
                    f"critical_actions={item['summary'].get('allowed_critical_action_count', 0)}"
                )

        if options.get('strict') and missing:
            raise CommandError(f'Missing expected UAT personas: {", ".join(missing)}')
