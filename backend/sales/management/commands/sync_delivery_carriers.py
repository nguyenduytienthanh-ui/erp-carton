import json
import re

from django.core.management.base import BaseCommand
from django.db import transaction
from unidecode import unidecode

from inventory.models import OutboundShipment as InventoryOutboundShipment
from sales.models import DeliveryCarrier, OutboundShipment, SalesOrderDeliveryPlan
from sales.services import normalize_delivery_carrier_key, normalize_delivery_carrier_name


def build_delivery_carrier_code(name, existing_codes):
    raw = unidecode(normalize_delivery_carrier_name(name)).upper()
    raw = re.sub(r'[^A-Z0-9]+', '-', raw).strip('-')
    raw = raw[:22] or 'CARRIER'
    base = f'DVC-{raw}'
    candidate = base[:30]
    counter = 2
    while candidate in existing_codes:
        suffix = f'-{counter}'
        candidate = f'{base[:30 - len(suffix)]}{suffix}'
        counter += 1
    existing_codes.add(candidate)
    return candidate


class Command(BaseCommand):
    help = 'Create delivery carrier master data from snapshot text and link exact normalized matches.'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true')

    def handle(self, *args, **options):
        output_json = bool(options['json'])
        created_count = 0
        linked_plans = 0
        linked_inventory_shipments = 0
        linked_legacy_shipments = 0

        source_names = set()
        source_names.update(
            normalize_delivery_carrier_name(value)
            for value in SalesOrderDeliveryPlan.objects.exclude(planned_carrier_name='').values_list('planned_carrier_name', flat=True)
        )
        source_names.update(
            normalize_delivery_carrier_name(value)
            for value in InventoryOutboundShipment.objects.exclude(carrier_name='').values_list('carrier_name', flat=True)
        )
        source_names.update(
            normalize_delivery_carrier_name(value)
            for value in OutboundShipment.objects.exclude(carrier='').values_list('carrier', flat=True)
        )
        source_names.discard('')

        existing_carriers = list(DeliveryCarrier.objects.filter(deleted_at__isnull=True).order_by('sort_order', 'id'))
        carrier_map = {
            normalize_delivery_carrier_key(item.name): item
            for item in existing_carriers
            if normalize_delivery_carrier_key(item.name)
        }
        existing_codes = {item.code for item in existing_carriers if item.code}
        next_sort_order = max((item.sort_order for item in existing_carriers), default=0)

        with transaction.atomic():
            for name in sorted(source_names):
                key = normalize_delivery_carrier_key(name)
                if not key or key in carrier_map:
                    continue
                next_sort_order += 10
                carrier = DeliveryCarrier.objects.create(
                    code=build_delivery_carrier_code(name, existing_codes),
                    name=name,
                    sort_order=next_sort_order,
                    is_active=True,
                )
                carrier_map[key] = carrier
                created_count += 1

            for plan in SalesOrderDeliveryPlan.objects.exclude(planned_carrier_name='').filter(planned_carrier__isnull=True):
                carrier = carrier_map.get(normalize_delivery_carrier_key(plan.planned_carrier_name))
                if not carrier:
                    continue
                plan.planned_carrier = carrier
                plan.save(update_fields=['planned_carrier'])
                linked_plans += 1

            for shipment in InventoryOutboundShipment.objects.exclude(carrier_name='').filter(carrier__isnull=True):
                carrier = carrier_map.get(normalize_delivery_carrier_key(shipment.carrier_name))
                if not carrier:
                    continue
                shipment.carrier = carrier
                shipment.save(update_fields=['carrier'])
                linked_inventory_shipments += 1

            for shipment in OutboundShipment.objects.exclude(carrier='').filter(carrier_master__isnull=True):
                carrier = carrier_map.get(normalize_delivery_carrier_key(shipment.carrier))
                if not carrier:
                    continue
                shipment.carrier_master = carrier
                shipment.save(update_fields=['carrier_master'])
                linked_legacy_shipments += 1

        payload = {
            'created_count': created_count,
            'linked_plans': linked_plans,
            'linked_inventory_shipments': linked_inventory_shipments,
            'linked_legacy_shipments': linked_legacy_shipments,
            'carrier_count': DeliveryCarrier.objects.filter(deleted_at__isnull=True).count(),
        }
        if output_json:
            self.stdout.write(json.dumps(payload))
            return
        self.stdout.write(self.style.SUCCESS(
            'Delivery carriers synced: '
            f"created={created_count}, linked_plans={linked_plans}, "
            f"linked_inventory_shipments={linked_inventory_shipments}, "
            f"linked_legacy_shipments={linked_legacy_shipments}"
        ))
