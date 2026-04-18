import json

from django.core.management.base import BaseCommand, CommandError

from core.release_readiness import get_release_hygiene_payload


class Command(BaseCommand):
    help = 'Inspect git/release hygiene signals before cutting a release branch or tag'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true', help='Print result as JSON')
        parser.add_argument('--strict', action='store_true', help='Exit non-zero on warnings')

    def handle(self, *args, **options):
        payload = get_release_hygiene_payload()

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Release hygiene: {str(payload['status']).upper()}")
            self.stdout.write(f"- branch: {payload.get('branch') or 'unknown'}")
            self.stdout.write(f"- total changes: {payload.get('total_changes', 0)}")
            self.stdout.write(f"- migration candidates: {len(payload.get('migration_candidates') or [])}")
            self.stdout.write(f"- artifact candidates: {len(payload.get('artifact_candidates') or [])}")
            if payload.get('warnings'):
                self.stdout.write('Warnings:')
                for item in payload['warnings']:
                    self.stdout.write(f'  - {item}')

        if options.get('strict') and str(payload.get('status') or '').lower() != 'ok':
            raise CommandError(f"Release hygiene failed with status {payload.get('status')}")
