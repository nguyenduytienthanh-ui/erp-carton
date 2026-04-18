from __future__ import annotations

import json

from django.core.management.base import BaseCommand, CommandError

from core.release_readiness import get_alert_readiness_payload


class Command(BaseCommand):
    help = 'Summarize alert channel configuration and recent delivery readiness for go-live operations'

    def add_arguments(self, parser):
        parser.add_argument('--hours', type=int, default=24, help='Hours window for recent alert delivery checks')
        parser.add_argument('--json', action='store_true', help='Print result as JSON')
        parser.add_argument('--strict', action='store_true', help='Exit non-zero when readiness is warning/error')

    def handle(self, *args, **options):
        hours = max(1, min(int(options.get('hours') or 24), 168))
        payload = get_alert_readiness_payload(hours=hours)

        if options.get('json'):
            self.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(f"Alert channel readiness: {payload['overall_status'].upper()}")
            self.stdout.write(
                f"- configured channels: {payload['config']['configured_count']} "
                f"(required min: {payload['config']['required_channel_count']})"
            )
            self.stdout.write(f"- recent delivery: {payload['delivery']['status'].upper()}")
            self.stdout.write(f"- recent email delivery: {payload['email_delivery']['status'].upper()}")
            if payload['warnings']:
                self.stdout.write('Warnings:')
                for item in payload['warnings']:
                    self.stdout.write(f'  - {item}')

        if options.get('strict') and payload['overall_status'] in {'warning', 'error'}:
            raise CommandError(f"Alert readiness failed with status {payload['overall_status']}")
