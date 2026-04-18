"""FilterSet SalesOrder: code, date, status, team, customer."""
from datetime import datetime, time, timedelta
import django_filters
from django.conf import settings
from django.db import models
from django.utils import timezone as django_tz
from sales.models import SalesOrder, SalesOrderStatus, Quote, QuoteStatus


def _parse_date(value, end_of_day=False):
    if not value:
        return None
    try:
        d = datetime.strptime(str(value).strip()[:10], '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None
    t = time.max if end_of_day else time.min
    dt = datetime.combine(d, t)
    if getattr(settings, 'USE_TZ', True):
        dt = django_tz.make_aware(dt, django_tz.get_current_timezone())
    return dt


class SalesOrderFilter(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name='code', lookup_expr='icontains')
    status = django_filters.ChoiceFilter(choices=SalesOrderStatus.CHOICES)
    customer = django_filters.NumberFilter(field_name='customer_id')
    team = django_filters.NumberFilter(field_name='team_id')
    owner = django_filters.NumberFilter(field_name='owner_id')
    order_date__gte = django_filters.CharFilter(method='filter_date_gte')
    order_date__lte = django_filters.CharFilter(method='filter_date_lte')
    header_delivery_date__gte = django_filters.CharFilter(method='filter_header_delivery_date_gte')
    header_delivery_date__lte = django_filters.CharFilter(method='filter_header_delivery_date_lte')
    delivery_date__gte = django_filters.CharFilter(method='filter_delivery_date_gte')
    delivery_date__lte = django_filters.CharFilter(method='filter_delivery_date_lte')
    has_overdue_delivery = django_filters.CharFilter(method='filter_has_overdue_delivery')
    has_due_soon_delivery = django_filters.CharFilter(method='filter_has_due_soon_delivery')

    class Meta:
        model = SalesOrder
        fields = [
            'code', 'status', 'customer', 'team', 'owner',
            'order_date__gte', 'order_date__lte',
            'header_delivery_date__gte', 'header_delivery_date__lte',
            'delivery_date__gte', 'delivery_date__lte',
            'has_overdue_delivery', 'has_due_soon_delivery',
        ]

    def filter_date_gte(self, qs, name, value):
        dt = _parse_date(value, False)
        return qs.filter(order_date__gte=dt.date() if hasattr(dt, 'date') else dt) if dt else qs

    def filter_date_lte(self, qs, name, value):
        dt = _parse_date(value, True)
        return qs.filter(order_date__lte=dt.date() if hasattr(dt, 'date') else dt) if dt else qs

    def filter_header_delivery_date_gte(self, qs, name, value):
        dt = _parse_date(value, False)
        return qs.filter(delivery_date__gte=dt.date() if hasattr(dt, 'date') else dt) if dt else qs

    def filter_header_delivery_date_lte(self, qs, name, value):
        dt = _parse_date(value, True)
        return qs.filter(delivery_date__lte=dt.date() if hasattr(dt, 'date') else dt) if dt else qs

    def filter_delivery_date_gte(self, qs, name, value):
        dt = _parse_date(value, False)
        if not dt:
            return qs
        v = dt.date() if hasattr(dt, 'date') else dt
        return qs.filter(lines__delivery_plans__delivery_date__gte=v).distinct()

    def filter_delivery_date_lte(self, qs, name, value):
        dt = _parse_date(value, True)
        if not dt:
            return qs
        v = dt.date() if hasattr(dt, 'date') else dt
        return qs.filter(lines__delivery_plans__delivery_date__lte=v).distinct()

    def filter_has_overdue_delivery(self, qs, name, value):
        flag = str(value).strip().lower() in ['1', 'true', 'yes']
        if not flag:
            return qs
        today = django_tz.localdate()
        return qs.filter(
            lines__delivery_plans__delivery_date__lt=today,
            lines__delivery_plans__qty__gt=0,
            lines__delivery_plans__delivered_qty__lt=models.F('lines__delivery_plans__qty'),
        ).distinct()

    def filter_has_due_soon_delivery(self, qs, name, value):
        flag = str(value).strip().lower() in ['1', 'true', 'yes']
        if not flag:
            return qs
        days = self.request.query_params.get('due_soon_days') if self.request else None
        try:
            days = int(days or 3)
        except (TypeError, ValueError):
            days = 3
        days = max(0, min(days, 30))
        today = django_tz.localdate()
        due_until = today + timedelta(days=days)
        return qs.filter(
            lines__delivery_plans__delivery_date__gte=today,
            lines__delivery_plans__delivery_date__lte=due_until,
            lines__delivery_plans__qty__gt=0,
            lines__delivery_plans__delivered_qty__lt=models.F('lines__delivery_plans__qty'),
        ).distinct()


class QuoteFilter(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=QuoteStatus.CHOICES)
    customer = django_filters.NumberFilter(field_name='customer_id')
    quote_date__gte = django_filters.DateFilter(field_name='quote_date', lookup_expr='gte')
    quote_date__lte = django_filters.DateFilter(field_name='quote_date', lookup_expr='lte')
    valid_until__gte = django_filters.DateFilter(field_name='valid_until', lookup_expr='gte')
    valid_until__lte = django_filters.DateFilter(field_name='valid_until', lookup_expr='lte')

    class Meta:
        model = Quote
        fields = ['status', 'customer', 'quote_date__gte', 'quote_date__lte', 'valid_until__gte', 'valid_until__lte']
