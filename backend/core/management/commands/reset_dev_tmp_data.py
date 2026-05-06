import json

from django.core.management.base import BaseCommand, CommandError

from core.dev_seed import DevSeedSafetyError, TMP_DEFAULT_PREFIX, reset_dev_tmp_data


TEXT_SUMMARY_KEYS = [
    'customers',
    'products',
    'sales_orders',
    'sales_order_lines',
    'sales_order_delivery_plans',
    'production_demands',
    'production_orders',
    'production_operations',
    'production_material_requirements',
    'production_issues',
    'production_issue_lines',
    'production_receipts',
    'production_receipt_lines',
    'inventory_transactions',
    'inventory_reservations',
    'inventory_shipments',
    'inventory_shipment_packages',
    'approval_history',
    'audit_logs',
    'tasks',
]


class Command(BaseCommand):
    help = 'Dry-run or reset TMP-like dev data. Actual delete requires --confirm.'

    def add_arguments(self, parser):
        parser.add_argument('--confirm', action='store_true')
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--json', action='store_true')
        parser.add_argument('--prefix', default=TMP_DEFAULT_PREFIX)

    def handle(self, *args, **options):
        try:
            summary = reset_dev_tmp_data(
                confirm=bool(options.get('confirm')),
                dry_run=bool(options.get('dry_run')),
                prefix=options.get('prefix') or TMP_DEFAULT_PREFIX,
            )
        except DevSeedSafetyError as exc:
            raise CommandError(str(exc)) from exc

        if options.get('json'):
            self.stdout.write(json.dumps(summary, ensure_ascii=False, default=str))
            return

        if summary.get('dry_run'):
            self._write_dry_run_summary(summary)
            return

        self._write_confirm_summary(summary)

    def _write_counts(self, summary):
        printed = 0
        for key in TEXT_SUMMARY_KEYS:
            value = int(summary.get(key) or 0)
            if value <= 0:
                continue
            self.stdout.write(f'* {key}: {value}')
            printed += 1
        zero_groups = [
            key
            for key, value in summary.items()
            if isinstance(value, int) and key not in {'dry_run', 'confirmed'} and key not in TEXT_SUMMARY_KEYS and value == 0
        ]
        if zero_groups:
            self.stdout.write(f'* zero_count_groups: {len(zero_groups)}')
        if printed == 0:
            self.stdout.write('* No TMP-like rows were found.')

    def _write_dry_run_summary(self, summary):
        self.stdout.write(self.style.WARNING('Dev TMP data dry-run. No data was deleted.'))
        self.stdout.write('')
        self.stdout.write('Would delete:')
        self._write_counts(summary)
        self.stdout.write('')
        self.stdout.write('Protected:')
        self.stdout.write('* QA_ seed data is not targeted.')
        self.stdout.write('* Master data is not targeted.')
        self.stdout.write('')
        self.stdout.write('To delete, rerun with:')
        self.stdout.write('python manage.py reset_dev_tmp_data --confirm')

    def _write_confirm_summary(self, summary):
        self.stdout.write(self.style.SUCCESS('Dev TMP data reset.'))
        self.stdout.write('')
        self.stdout.write('Deleted:')
        self._write_counts(summary)
