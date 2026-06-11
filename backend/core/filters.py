import re
from datetime import datetime, time
import django_filters
from django.conf import settings
from django.db.models import Q
from django.utils import timezone as django_tz

from .models import Customer, Team, Role
from products.models import Product


def _parse_date_to_range(value, end_of_day=False):
    """Parse YYYY-MM-DD -> datetime (timezone-aware nếu USE_TZ=True)."""
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


class TeamFilter(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name='code', lookup_expr='icontains')
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    is_active = django_filters.BooleanFilter(field_name='is_active')
    created_at__gte = django_filters.CharFilter(method=filter_created_at_gte)
    created_at__lte = django_filters.CharFilter(method=filter_created_at_lte)

    class Meta:
        model = Team
        fields = ['code', 'name', 'is_active', 'created_at__gte', 'created_at__lte']


class RoleFilter(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name='code', lookup_expr='icontains')
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    is_active = django_filters.BooleanFilter(field_name='is_active')
    created_at__gte = django_filters.CharFilter(method=filter_created_at_gte)
    created_at__lte = django_filters.CharFilter(method=filter_created_at_lte)

    class Meta:
        model = Role
        fields = ['code', 'name', 'is_active', 'created_at__gte', 'created_at__lte']


class CustomerFilter(django_filters.FilterSet):
    # Global search
    q = django_filters.CharFilter(method='filter_search', label='Search')
    
    # Text filters
    name = django_filters.CharFilter(lookup_expr='icontains')
    company_name = django_filters.CharFilter(lookup_expr='icontains')
    phone = django_filters.CharFilter(lookup_expr='icontains')
    email = django_filters.CharFilter(lookup_expr='icontains')
    
    # Date range
    created_at__gte = django_filters.DateFilter(field_name='created_at', lookup_expr='gte')
    created_at__lte = django_filters.DateFilter(field_name='created_at', lookup_expr='lte')

    # Status (DRAFT, PENDING_APPROVAL, APPROVED, REJECTED)
    status = django_filters.ChoiceFilter(choices=Customer.STATUS_CHOICES)

    # Code filter
    code = django_filters.CharFilter(lookup_expr='icontains')

    class Meta:
        model = Customer
        fields = ['is_active', 'status']
    
    def filter_search(self, queryset, name, value):
        from django.db.models import Q
        return queryset.filter(
            Q(code__icontains=value) |
            Q(name__icontains=value) |
            Q(company_name__icontains=value) |
            Q(phone__icontains=value) |
            Q(email__icontains=value)
        )


def _size_dim_pattern(position, value_str):
    """Vị trí 0=Dài, 1=Rộng, 2=Cao. Trả về regex pattern để match số = value_str tại vị trí đó (DxRxC)."""
    sep = r'\s*[xX*×·]\s*'
    if position == 0:
        return r'^\s*' + re.escape(value_str) + r'(?=' + sep + r'|\s*$)'
    if position == 1:
        return r'^\s*\d+' + sep + re.escape(value_str) + r'(?=' + sep + r'|\s*$)'
    return r'^\s*\d+' + sep + r'\d+' + sep + re.escape(value_str) + r'\s*$'


class ProductFilter(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name='code', lookup_expr='icontains')
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    description = django_filters.CharFilter(field_name='description', lookup_expr='icontains')
    category = django_filters.NumberFilter(field_name='category__id')
    unit = django_filters.NumberFilter(field_name='unit__id')
    status = django_filters.ChoiceFilter(choices=Product._meta.get_field('status').choices)
    item_type = django_filters.ChoiceFilter(choices=Product._meta.get_field('item_type').choices)
    wave = django_filters.NumberFilter(field_name='wave__id')
    box_type = django_filters.NumberFilter(field_name='box_type__id')
    min_cost_price = django_filters.NumberFilter(field_name='cost_price', lookup_expr='gte')
    max_cost_price = django_filters.NumberFilter(field_name='cost_price', lookup_expr='lte')
    min_sale_price = django_filters.NumberFilter(field_name='sale_price', lookup_expr='gte')
    max_sale_price = django_filters.NumberFilter(field_name='sale_price', lookup_expr='lte')
    owner = django_filters.NumberFilter(field_name='owner__id')
    team = django_filters.NumberFilter(field_name='team__id')
    is_active = django_filters.BooleanFilter(field_name='is_active')
    parent__isnull = django_filters.BooleanFilter(field_name='parent__isnull')
    created_from = django_filters.DateFilter(field_name='created_at', lookup_expr='gte')
    created_to = django_filters.DateFilter(field_name='created_at', lookup_expr='lte')
    # Kích thước PO/SX (số tại vị trí 0,1,2 trong size_order / size_production)
    size_po_dai = django_filters.NumberFilter(method='filter_size_po_dai')
    size_po_rong = django_filters.NumberFilter(method='filter_size_po_rong')
    size_po_cao = django_filters.NumberFilter(method='filter_size_po_cao')
    size_sx_dai = django_filters.NumberFilter(method='filter_size_sx_dai')
    size_sx_rong = django_filters.NumberFilter(method='filter_size_sx_rong')
    size_sx_cao = django_filters.NumberFilter(method='filter_size_sx_cao')
    waterproof = django_filters.ChoiceFilter(choices=Product.WATERPROOF_CHOICES)
    co_cm = django_filters.BooleanFilter(method='filter_co_cm')
    note = django_filters.CharFilter(field_name='note', lookup_expr='icontains')

    class Meta:
        model = Product
        fields = [
            'code', 'name', 'description', 'category', 'unit', 'status', 'item_type', 'wave', 'box_type',
            'min_cost_price', 'max_cost_price', 'min_sale_price', 'max_sale_price',
            'owner', 'team', 'is_active', 'parent__isnull', 'created_from', 'created_to',
            'size_po_dai', 'size_po_rong', 'size_po_cao', 'size_sx_dai', 'size_sx_rong', 'size_sx_cao',
            'waterproof', 'co_cm', 'note',
        ]

    def _filter_size_dim(self, queryset, field_name, position, value):
        if value is None:
            return queryset
        try:
            value_str = str(int(value))
        except (TypeError, ValueError):
            return queryset
        try:
            pattern = _size_dim_pattern(position, value_str)
            regex = re.compile(pattern)
            pk_list = []
            # values_list tránh lỗi 500 khi queryset có annotate/order_by (vd: search rank)
            for pk, raw in queryset.values_list('pk', field_name).iterator(chunk_size=500):
                raw = (raw or '').strip()
                if raw and regex.match(raw):
                    pk_list.append(pk)
            if not pk_list:
                return queryset.none()
            return queryset.filter(pk__in=pk_list)
        except Exception:
            return queryset

    def filter_size_po_dai(self, queryset, name, value):
        return self._filter_size_dim(queryset, 'size_order', 0, value)

    def filter_size_po_rong(self, queryset, name, value):
        return self._filter_size_dim(queryset, 'size_order', 1, value)

    def filter_size_po_cao(self, queryset, name, value):
        return self._filter_size_dim(queryset, 'size_order', 2, value)

    def filter_size_sx_dai(self, queryset, name, value):
        return self._filter_size_dim(queryset, 'size_production', 0, value)

    def filter_size_sx_rong(self, queryset, name, value):
        return self._filter_size_dim(queryset, 'size_production', 1, value)

    def filter_size_sx_cao(self, queryset, name, value):
        return self._filter_size_dim(queryset, 'size_production', 2, value)

    def filter_co_cm(self, queryset, name, value):
        if value is True:
            return queryset.filter(process_can_mang__gt=0)
        if value is False:
            return queryset.filter(Q(process_can_mang__isnull=True) | Q(process_can_mang=0))
        return queryset
