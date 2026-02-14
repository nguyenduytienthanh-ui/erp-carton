"""FilterSet SalesOrder: code, date, status, team, customer."""
from datetime import datetime, time
import django_filters
from django.conf import settings
from django.utils import timezone as django_tz
from sales.models import SalesOrder, SalesOrderStatus


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

    class Meta:
        model = SalesOrder
        fields = ['code', 'status', 'customer', 'team', 'owner', 'order_date__gte', 'order_date__lte']

    def filter_date_gte(self, qs, name, value):
        dt = _parse_date(value, False)
        return qs.filter(order_date__gte=dt.date() if hasattr(dt, 'date') else dt) if dt else qs

    def filter_date_lte(self, qs, name, value):
        dt = _parse_date(value, True)
        return qs.filter(order_date__lte=dt.date() if hasattr(dt, 'date') else dt) if dt else qs
