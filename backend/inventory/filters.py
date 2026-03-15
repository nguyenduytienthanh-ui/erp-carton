from datetime import datetime, time

import django_filters
from django.conf import settings
from django.utils import timezone as django_tz

from inventory.models import (
    InventoryReservation,
    InventoryTransaction,
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
    location = django_filters.NumberFilter(field_name='location__id')
    target_warehouse = django_filters.NumberFilter(field_name='target_warehouse__id')
    target_location = django_filters.NumberFilter(field_name='target_location__id')
    transaction_type = django_filters.CharFilter(field_name='transaction_type', lookup_expr='iexact')
    status = django_filters.CharFilter(field_name='status', lookup_expr='iexact')
    transaction_date__gte = django_filters.DateFilter(field_name='transaction_date', lookup_expr='gte')
    transaction_date__lte = django_filters.DateFilter(field_name='transaction_date', lookup_expr='lte')

    class Meta:
        model = InventoryTransaction
        fields = [
            'product',
            'warehouse',
            'location',
            'target_warehouse',
            'target_location',
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
