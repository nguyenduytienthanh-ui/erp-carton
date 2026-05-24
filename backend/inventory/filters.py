from datetime import datetime, time

import django_filters
from django.conf import settings
from django.db.models import Q
from django.utils import timezone as django_tz

from inventory.models import (
    InventoryReservation,
    InventoryTransaction,
    InventoryTransactionType,
    OutboundShipment,
    Warehouse,
    WarehouseLocation,
)


def _parse_date_to_range(value, end_of_day=False):
    if not value:
        return None
    if hasattr(value, 'date'):
        d = value.date() if hasattr(value, 'date') else value
    else:
        try:
            d = datetime.strptime(str(value).strip()[:10], '%Y-%m-%d').date()
        except (ValueError, TypeError):
            return None
    dt = datetime.combine(d, time.max if end_of_day else time.min)
    if getattr(settings, 'USE_TZ', True):
        dt = django_tz.make_aware(dt, django_tz.get_current_timezone())
    return dt


def filter_created_at_gte(queryset, name, value):
    dt = _parse_date_to_range(value, end_of_day=False)
    return queryset.filter(created_at__gte=dt) if dt else queryset


def filter_created_at_lte(queryset, name, value):
    dt = _parse_date_to_range(value, end_of_day=True)
    return queryset.filter(created_at__lte=dt) if dt else queryset


def _transfer_reference_q():
    return Q(transaction_type=InventoryTransactionType.TRANSFER) | Q(reference__istartswith='TRN-')


class WarehouseFilter(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name='code', lookup_expr='icontains')
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    is_active = django_filters.BooleanFilter(field_name='is_active')
    created_at__gte = django_filters.CharFilter(method=filter_created_at_gte)
    created_at__lte = django_filters.CharFilter(method=filter_created_at_lte)

    class Meta:
        model = Warehouse
        fields = ['code', 'name', 'is_active', 'created_at__gte', 'created_at__lte']


class WarehouseLocationFilter(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name='code', lookup_expr='icontains')
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    warehouse = django_filters.NumberFilter(field_name='warehouse__id')
    location_type = django_filters.CharFilter(field_name='location_type', lookup_expr='iexact')
    is_active = django_filters.BooleanFilter(field_name='is_active')
    created_at__gte = django_filters.CharFilter(method=filter_created_at_gte)
    created_at__lte = django_filters.CharFilter(method=filter_created_at_lte)

    class Meta:
        model = WarehouseLocation
        fields = ['code', 'name', 'warehouse', 'location_type', 'is_active', 'created_at__gte', 'created_at__lte']


class InventoryTransactionFilter(django_filters.FilterSet):
    product = django_filters.NumberFilter(field_name='product__id')
    warehouse = django_filters.NumberFilter(field_name='warehouse__id')
    warehouse_involved = django_filters.NumberFilter(method='filter_warehouse_involved')
    location = django_filters.NumberFilter(field_name='location__id')
    target_warehouse = django_filters.NumberFilter(field_name='target_warehouse__id')
    target_location = django_filters.NumberFilter(field_name='target_location__id')
    sales_order = django_filters.NumberFilter(field_name='sales_order__id')
    reservation = django_filters.NumberFilter(field_name='reservation__id')
    shipment_batch = django_filters.NumberFilter(field_name='shipment_batch__id')
    stocktake = django_filters.NumberFilter(field_name='stocktake__id')
    source_type = django_filters.CharFilter(method='filter_source_type')
    transaction_type = django_filters.CharFilter(field_name='transaction_type', lookup_expr='iexact')
    status = django_filters.CharFilter(field_name='status', lookup_expr='iexact')
    transaction_date__gte = django_filters.DateFilter(field_name='transaction_date', lookup_expr='gte')
    transaction_date__lte = django_filters.DateFilter(field_name='transaction_date', lookup_expr='lte')

    def filter_warehouse_involved(self, queryset, name, value):
        return queryset.filter(Q(warehouse_id=value) | Q(target_warehouse_id=value))

    def filter_source_type(self, queryset, name, value):
        source_type = str(value or '').strip().upper()
        if source_type == 'STOCKTAKE':
            return queryset.filter(stocktake_id__isnull=False)
        if source_type == 'PURCHASE':
            return queryset.filter(
                Q(purchase_order_id__isnull=False)
                | Q(purchase_order_line_id__isnull=False)
                | Q(purchase_receipt_id__isnull=False)
                | Q(reference__istartswith='PO-')
                | Q(reference__istartswith='GRN-')
            )
        if source_type == 'PRODUCTION':
            return queryset.filter(
                Q(production_order_id__isnull=False)
                | Q(production_issue_id__isnull=False)
                | Q(production_receipt_id__isnull=False)
                | Q(reference__istartswith='MO-')
                | Q(reference__istartswith='PMI-')
                | Q(reference__istartswith='FGR-')
            )
        if source_type == 'TRANSFER':
            return queryset.filter(_transfer_reference_q())
        if source_type == 'RESERVATION':
            return queryset.filter(reservation_id__isnull=False)
        if source_type == 'SALES':
            return queryset.filter(Q(sales_order_id__isnull=False) | Q(sales_order_line_id__isnull=False))
        if source_type == 'SHIPMENT':
            return queryset.filter(shipment_batch_id__isnull=False)
        if source_type == 'MANUAL':
            return queryset.filter(
                stocktake_id__isnull=True,
                reservation_id__isnull=True,
                sales_order_id__isnull=True,
                sales_order_line_id__isnull=True,
                shipment_batch_id__isnull=True,
                purchase_order_id__isnull=True,
                purchase_order_line_id__isnull=True,
                purchase_receipt_id__isnull=True,
                production_order_id__isnull=True,
                production_issue_id__isnull=True,
                production_receipt_id__isnull=True,
            ).exclude(_transfer_reference_q()).exclude(
                Q(reference__istartswith='PO-')
                | Q(reference__istartswith='GRN-')
                | Q(reference__istartswith='MO-')
                | Q(reference__istartswith='PMI-')
                | Q(reference__istartswith='FGR-')
            )
        return queryset

    class Meta:
        model = InventoryTransaction
        fields = [
            'product',
            'warehouse',
            'warehouse_involved',
            'location',
            'target_warehouse',
            'target_location',
            'sales_order',
            'reservation',
            'shipment_batch',
            'stocktake',
            'source_type',
            'transaction_type',
            'status',
            'transaction_date__gte',
            'transaction_date__lte',
        ]


class InventoryReservationFilter(django_filters.FilterSet):
    product = django_filters.NumberFilter(field_name='product__id')
    warehouse = django_filters.NumberFilter(field_name='warehouse__id')
    location = django_filters.NumberFilter(field_name='location__id')
    sales_order = django_filters.NumberFilter(field_name='sales_order__id')
    status = django_filters.CharFilter(field_name='status', lookup_expr='iexact')
    reservation_date__gte = django_filters.DateFilter(field_name='reservation_date', lookup_expr='gte')
    reservation_date__lte = django_filters.DateFilter(field_name='reservation_date', lookup_expr='lte')

    class Meta:
        model = InventoryReservation
        fields = [
            'product',
            'warehouse',
            'location',
            'sales_order',
            'status',
            'reservation_date__gte',
            'reservation_date__lte',
        ]


class OutboundShipmentFilter(django_filters.FilterSet):
    status = django_filters.CharFilter(field_name='status', lookup_expr='iexact')
    sales_order = django_filters.NumberFilter(field_name='sales_order__id')
    shipment_date__gte = django_filters.DateFilter(field_name='shipment_date', lookup_expr='gte')
    shipment_date__lte = django_filters.DateFilter(field_name='shipment_date', lookup_expr='lte')

    class Meta:
        model = OutboundShipment
        fields = ['status', 'sales_order', 'shipment_date__gte', 'shipment_date__lte']
