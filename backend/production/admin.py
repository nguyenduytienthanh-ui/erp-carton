from django.contrib import admin

from production.models import ProductionDemand


@admin.register(ProductionDemand)
class ProductionDemandAdmin(admin.ModelAdmin):
    list_display = [
        'demand_code',
        'demand_key',
        'sales_order',
        'sales_order_line',
        'delivery_plan',
        'product_code',
        'product_kind',
        'qty_required',
        'qty_planned',
        'qty_released',
        'qty_completed',
        'planning_status',
        'production_status',
        'priority',
        'planning_due_date',
        'delivery_date',
        'assigned_planner',
    ]
    list_filter = [
        'planning_status',
        'production_status',
        'priority',
        'product_kind',
        'source',
        'planning_due_date',
        'delivery_date',
    ]
    search_fields = [
        'demand_code',
        'demand_key',
        'sales_order__code',
        'product_code',
        'product_name',
        'customer_name_snapshot',
    ]
    readonly_fields = [
        'qty_remaining_to_plan',
        'qty_remaining_to_release',
        'qty_remaining_to_complete',
        'search_text',
        'created_at',
        'updated_at',
    ]

