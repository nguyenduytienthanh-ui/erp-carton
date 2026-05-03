import json

from django.core.management.base import BaseCommand

from core.dev_seed import seed_dev_qa_data


class Command(BaseCommand):
    help = 'Seed deterministic QA data for clean dev databases.'

    def add_arguments(self, parser):
        parser.add_argument('--password', default=None, help='Password for UAT users. The value is never printed.')
        parser.add_argument('--reset-passwords', action='store_true')
        parser.add_argument('--json', action='store_true')

    def handle(self, *args, **options):
        summary = seed_dev_qa_data(
            password=options.get('password'),
            reset_passwords=bool(options.get('reset_passwords')),
        )
        if options.get('json'):
            self.stdout.write(json.dumps(summary, ensure_ascii=False, default=str))
            return
        self.stdout.write(self.style.SUCCESS('Dev QA data seeded.'))
