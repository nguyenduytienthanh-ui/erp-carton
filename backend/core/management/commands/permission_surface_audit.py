from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.management.commands.bootstrap_uat_demo import USER_MATRIX
from core.views import _build_access_surface_matrix_payload


def _coverage_entry(row):
    return {
        'key': str(row.get('key') or ''),
        'label': str(row.get('label') or row.get('key') or ''),
        'route': str(row.get('path') or row.get('path_prefix') or ''),
        'capability': str(row.get('capability') or ''),
        'persona_usernames': [],
    }


def _serialize_coverage(section_map, threshold):
    items = []
    for item in sorted(section_map.values(), key=lambda row: row['key']):
        coverage_count = len(item['persona_usernames'])
        if coverage_count == 0:
            status_value = 'error'
        elif coverage_count <= threshold:
            status_value = 'warning'
        else:
            status_value = 'ok'
        items.append({
            **item,
            'coverage_count': coverage_count,
            'status': status_value,
        })
    return items


class Command(BaseCommand):
    help = 'Audit how many stable UAT personas cover each route, API surface, and critical action'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true', help='Print result as JSON')
        parser.add_argument('--strict', action='store_true', help='Exit non-zero when personas are missing or surfaces are uncovered')
        parser.add_argument('--low-coverage-threshold', type=int, default=1, help='Warn when coverage_count is at or below this threshold')

    def handle(self, *args, **options):
        threshold = max(1, int(options.get('low_coverage_threshold') or 1))
        expected = [str(row.get('username') or '').strip() for row in USER_MATRIX if str(row.get('username') or '').strip()]
        user_model = get_user_model()
        users = {
            item.username: item
            for item in user_model.objects.filter(username__in=expected).prefetch_related('roles__permissions', 'teams')
        }

        missing = []
        personas = []
        coverage = {
            'frontend_routes': {},
            'api_surfaces': {},
            'critical_actions': {},
        }

        for username in expected:
            user = users.get(username)
            if user is None:
                missing.append(username)
                continue

            payload = _build_access_surface_matrix_payload(user)
            personas.append({
                'username': username,
                'role_names': payload['role_names'],
                'allowed_route_count': payload['summary'].get('allowed_route_count', 0),
                'allowed_api_surface_count': payload['summary'].get('allowed_api_surface_count', 0),
                'allowed_critical_action_count': payload['summary'].get('allowed_critical_action_count', 0),
            })

            for section_name in ('frontend_routes', 'api_surfaces', 'critical_actions'):
                for row in payload.get(section_name, []):
                    key = str(row.get('key') or '').strip()
                    if not key:
                        continue
                    entry = coverage[section_name].setdefault(key, _coverage_entry(row))
                    if row.get('allowed') and username not in entry['persona_usernames']:
                        entry['persona_usernames'].append(username)

        frontend_rows = _serialize_coverage(coverage['frontend_routes'], threshold)
        api_rows = _serialize_coverage(coverage['api_surfaces'], threshold)
        critical_rows = _serialize_coverage(coverage['critical_actions'], threshold)

        summary = {
            'low_coverage_threshold': threshold,
            'frontend_routes_total': len(frontend_rows),
            'api_surfaces_total': len(api_rows),
            'critical_actions_total': len(critical_rows),
            'uncovered_routes': len([row for row in frontend_rows if row['coverage_count'] == 0]),
            'uncovered_api_surfaces': len([row for row in api_rows if row['coverage_count'] == 0]),
            'uncovered_critical_actions': len([row for row in critical_rows if row['coverage_count'] == 0]),
            'low_coverage_routes': len([row for row in frontend_rows if 0 < row['coverage_count'] <= threshold]),
            'low_coverage_api_surfaces': len([row for row in api_rows if 0 < row['coverage_count'] <= threshold]),
            'low_coverage_critical_actions': len([row for row in critical_rows if 0 < row['coverage_count'] <= threshold]),
        }

        warnings = []
        if missing:
            warnings.append('Some expected UAT personas are missing from the environment.')
        if summary['uncovered_routes'] or summary['uncovered_api_surfaces'] or summary['uncovered_critical_actions']:
            warnings.append('At least one surface is not covered by any stable UAT persona.')
        if summary['low_coverage_routes'] or summary['low_coverage_api_surfaces'] or summary['low_coverage_critical_actions']:
            warnings.append('Some surfaces are covered by too few personas and should be retested during UAT.')

        payload = {
            'generated_at': timezone.now(),
            'expected_count': len(expected),
            'available_count': len(personas),
            'missing_count': len(missing),
            'missing_usernames': missing,
            'persona_summary': personas,
            'coverage': {
                'frontend_routes': frontend_rows,
                'api_surfaces': api_rows,
                'critical_actions': critical_rows,
            },
            'summary': summary,
            'recommended_commands': [
                'python manage.py uat_access_matrix --json',
                'python manage.py permission_surface_audit --json',
            ],
            'warnings': warnings,
            'overall_status': 'warning' if warnings else 'ok',
        }

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Permission surface audit: {payload['overall_status'].upper()}")
            self.stdout.write(f"- personas: {payload['available_count']}/{payload['expected_count']}")
            self.stdout.write(f"- uncovered routes/apis/actions: {summary['uncovered_routes']}/{summary['uncovered_api_surfaces']}/{summary['uncovered_critical_actions']}")
            self.stdout.write(f"- low coverage routes/apis/actions: {summary['low_coverage_routes']}/{summary['low_coverage_api_surfaces']}/{summary['low_coverage_critical_actions']}")

        if options.get('strict') and warnings:
            raise CommandError('; '.join(warnings))
