"""
FilterSet chuẩn cho Master Data (dùng chung).
CharFilter(code, name), BooleanFilter(is_active), DateFilter(created_at range) timezone-aware.
Ví dụ: /api/product-categories?search=giay&is_active=true&created_at__gte=2025-01-01&ordering=code
"""
from datetime import datetime, time
import django_filters
from django.conf import settings
from django.utils import timezone as django_tz

from .models import ProductCategory, ProductUnit, ProductWave, ProductBoxType


def _parse_date_to_range(value, end_of_day=False):
    """
    Parse date string (YYYY-MM-DD) -> datetime (timezone-aware nếu USE_TZ=True).
    end_of_day=False: 00:00:00; end_of_day=True: 23:59:59.999999 (theo timezone hiện tại).
    """
    if not value:
        return None
    if hasattr(value, 'date'):
        d = value.date() if hasattr(value, 'date') else value
    else:
        try:
            d = datetime.strptime(str(value).strip()[:10], '%Y-%m-%d').date()
        except (ValueError, TypeError):
            return None
    t = time.max if end_of_day else time.min
    dt = datetime.combine(d, t)
    if getattr(settings, 'USE_TZ', True):
        dt = django_tz.make_aware(dt, django_tz.get_current_timezone())
    return dt


def filter_created_at_gte(queryset, name, value):
    dt = _parse_date_to_range(value, end_of_day=False)
    return queryset.filter(created_at__gte=dt) if dt else queryset


def filter_created_at_lte(queryset, name, value):
    dt = _parse_date_to_range(value, end_of_day=True)
    return queryset.filter(created_at__lte=dt) if dt else queryset


class ProductCategoryFilter(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name='code', lookup_expr='icontains')
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    is_active = django_filters.BooleanFilter(field_name='is_active')
    parent = django_filters.NumberFilter(field_name='parent__id')
    created_at__gte = django_filters.CharFilter(method=filter_created_at_gte)
    created_at__lte = django_filters.CharFilter(method=filter_created_at_lte)

    class Meta:
        model = ProductCategory
        fields = ['code', 'name', 'is_active', 'parent', 'created_at__gte', 'created_at__lte']


class ProductUnitFilter(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name='code', lookup_expr='icontains')
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    is_active = django_filters.BooleanFilter(field_name='is_active')
    created_at__gte = django_filters.CharFilter(method=filter_created_at_gte)
    created_at__lte = django_filters.CharFilter(method=filter_created_at_lte)

    class Meta:
        model = ProductUnit
        fields = ['code', 'name', 'is_active', 'created_at__gte', 'created_at__lte']


class ProductWaveFilter(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name='code', lookup_expr='icontains')
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    is_active = django_filters.BooleanFilter(field_name='is_active')
    created_at__gte = django_filters.CharFilter(method=filter_created_at_gte)
    created_at__lte = django_filters.CharFilter(method=filter_created_at_lte)

    class Meta:
        model = ProductWave
        fields = ['code', 'name', 'is_active', 'created_at__gte', 'created_at__lte']


class ProductBoxTypeFilter(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name='code', lookup_expr='icontains')
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    is_active = django_filters.BooleanFilter(field_name='is_active')
    created_at__gte = django_filters.CharFilter(method=filter_created_at_gte)
    created_at__lte = django_filters.CharFilter(method=filter_created_at_lte)

    class Meta:
        model = ProductBoxType
        fields = ['code', 'name', 'is_active', 'created_at__gte', 'created_at__lte']
