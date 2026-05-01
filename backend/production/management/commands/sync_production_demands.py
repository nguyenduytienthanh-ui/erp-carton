import json

from django.core.management.base import BaseCommand, CommandError

from sales.models import SalesOrder, SalesOrderStatus
from production.demand_services import sync_production_demands_for_sales_order


def _empty_summary(dry_run=False):
    return {
        'dry_run': bool(dry_run),
        'order_count': 0,
        'created': 0,
        'updated': 0,
        'cancelled': 0,
        'held': 0,
        'skipped': 0,
        'errors': 0,
        'would_create': 0,
        'would_update': 0,
        'would_cancel': 0,
        'would_hold': 0,
        'details': [],
    }


def _merge_summary(target, order, result):
    target['order_count'] += 1
    for key in (
        'created',
        'updated',
        'cancelled',
        'held',
        'skipped',
        'errors',
        'would_create',
        'would_update',
        'would_cancel',
        'would_hold',
    ):
        target[key] += result.get(key, 0)
    target['details'].append({
        'order_id': order.id,
        'order_code': order.code,
        'result': result,
    })


class Command(BaseCommand):
    help = 'Sync ProductionDemand rows from SalesOrder lines and delivery plans.'

    def add_arguments(self, parser):
        parser.add_argument('--order-id', type=int)
        parser.add_argument('--order-code')
        parser.add_argument('--all-approved', action='store_true')
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--json', action='store_true')

    def handle(self, *args, **options):
        selectors = [
            bool(options.get('order_id')),
            bool(options.get('order_code')),
            bool(options.get('all_approved')),
        ]
        if sum(selectors) != 1:
            raise CommandError('Provide exactly one selector: --order-id, --order-code, or --all-approved.')

        dry_run = bool(options.get('dry_run'))
        output_json = bool(options.get('json'))
        summary = _empty_summary(dry_run=dry_run)

        if options.get('order_id'):
            orders = [SalesOrder.objects.get(pk=options['order_id'])]
        elif options.get('order_code'):
            orders = [SalesOrder.objects.get(code=options['order_code'])]
        else:
            orders = list(
                SalesOrder.objects
                .filter(status__in=[SalesOrderStatus.APPROVED, SalesOrderStatus.POSTED])
                .exclude(status=SalesOrderStatus.VOID)
                .order_by('order_date', 'id')
            )

        for order in orders:
            result = sync_production_demands_for_sales_order(order, dry_run=dry_run)
            _merge_summary(summary, order, result)

        if output_json:
            self.stdout.write(json.dumps(summary, ensure_ascii=False, default=str))
            return

        self.stdout.write(self.style.SUCCESS(
            'Production demands synced: '
            f"orders={summary['order_count']}, "
            f"created={summary['created']}, updated={summary['updated']}, "
            f"cancelled={summary['cancelled']}, held={summary['held']}, "
            f"would_create={summary['would_create']}, would_update={summary['would_update']}, "
            f"would_cancel={summary['would_cancel']}, would_hold={summary['would_hold']}"
        ))

