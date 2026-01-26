import django_filters
from .models import Customer

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
