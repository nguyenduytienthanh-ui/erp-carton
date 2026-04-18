import json

from django.core.management.base import BaseCommand, CommandError

from core.release_readiness import get_performance_readiness_payload


class Command(BaseCommand):
    help = 'Summarize large-data readiness for command centers before production cutover'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true', help='Print result as JSON')
        parser.add_argument('--strict', action='store_true', help='Exit non-zero on warnings')

    def handle(self, *args, **options):
        payload = get_performance_readiness_payload()

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Performance readiness: {str(payload['status']).upper()}")
            self.stdout.write(
                f"- datasets tracked: {payload['summary']['tracked_dataset_count']} "
                f"(warning={payload['summary']['warning_count']}, critical={payload['summary']['critical_count']})"
            )
            self.stdout.write(f"- slow query threshold: {payload.get('slow_query_threshold_ms', 0)}ms")
            if payload.get('warnings'):
                self.stdout.write('Warnings:')
                for item in payload['warnings']:
                    self.stdout.write(f'  - {item}')

        if options.get('strict') and str(payload.get('status') or '').lower() != 'ok':
            raise CommandError(f"Performance readiness failed with status {payload.get('status')}")
