import django_filters
from .models import Customer
from products.models import Product

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
    
    class Meta:
        model = Customer
        fields = ['is_active']
    
    def filter_search(self, queryset, name, value):
        from django.db.models import Q
        return queryset.filter(
            Q(code__icontains=value) |
            Q(name__icontains=value) |
            Q(company_name__icontains=value) |
            Q(phone__icontains=value) |
            Q(email__icontains=value)
        )


class ProductFilter(django_filters.FilterSet):
    code = django_filters.CharFilter(field_name='code', lookup_expr='icontains')
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    description = django_filters.CharFilter(field_name='description', lookup_expr='icontains')
    category = django_filters.NumberFilter(field_name='category__id')
    unit = django_filters.NumberFilter(field_name='unit__id')
    status = django_filters.ChoiceFilter(choices=Product._meta.get_field('status').choices)
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

    class Meta:
        model = Product
        fields = [
            'code', 'name', 'description', 'category', 'unit', 'status',
            'min_cost_price', 'max_cost_price', 'min_sale_price', 'max_sale_price',
            'owner', 'team', 'is_active', 'parent__isnull', 'created_from', 'created_to'
        ]
