import json

from django.core.management.base import BaseCommand, CommandError

from core.alerting import send_operational_alert


class Command(BaseCommand):
    help = 'Send a test alert through configured monitoring channels'

    def add_arguments(self, parser):
        parser.add_argument('--title', default='ERP Carton test alert')
        parser.add_argument('--message', default='Manual alert drill from management command.')
        parser.add_argument('--severity', default='warning')
        parser.add_argument('--channels', nargs='*', help='Optional channel subset: email slack telegram sentry')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')
        parser.add_argument('--require-success', action='store_true', help='Exit non-zero when no channel succeeds')

    def handle(self, *args, **options):
        result = send_operational_alert(
            title=str(options.get('title') or 'ERP Carton test alert'),
            message=str(options.get('message') or 'Manual alert drill from management command.'),
            severity=str(options.get('severity') or 'warning').lower(),
            channels=options.get('channels') or None,
            metadata={'source': 'management_command'},
            is_test=True,
        )

        if options.get('json'):
            self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Alert drill status: {result['overall_status'].upper()}")
            for row in result['results']:
                self.stdout.write(f"- {row['channel']}: {row['status']} - {row['detail']}")

        if options.get('require_success') and int(result['status_counts']['SUCCESS']) <= 0:
            raise CommandError('No alert channel succeeded during the test drill')
