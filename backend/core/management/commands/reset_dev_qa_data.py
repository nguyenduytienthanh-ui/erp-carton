import json

from django.core.management.base import BaseCommand, CommandError

from core.dev_seed import DevSeedSafetyError, reset_dev_qa_data


class Command(BaseCommand):
    help = 'Reset only QA-prefixed dev data. Requires --confirm.'

    def add_arguments(self, parser):
        parser.add_argument('--confirm', action='store_true')
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--json', action='store_true')

    def handle(self, *args, **options):
        try:
            summary = reset_dev_qa_data(
                confirm=bool(options.get('confirm')),
                dry_run=bool(options.get('dry_run')),
            )
        except DevSeedSafetyError as exc:
            raise CommandError(str(exc)) from exc
        if options.get('json'):
            self.stdout.write(json.dumps(summary, ensure_ascii=False, default=str))
            return
        action = 'would reset' if options.get('dry_run') else 'reset'
        self.stdout.write(self.style.SUCCESS(f'Dev QA data {action}.'))
