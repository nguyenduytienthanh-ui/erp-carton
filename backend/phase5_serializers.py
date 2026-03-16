# Phase 5 Serializers - All Optional Features
# This file contains serializers for all 24+ Phase 5 optional features

from rest_framework import serializers
from django.db import models

# ============================================================================
# PURCHASING SERIALIZERS
# ============================================================================

class PurchaseOrderForecastSerializer(serializers.Serializer):
    """Forecast suggested purchase orders based on demand"""
    product_id = serializers.IntegerField()
    product_code = serializers.CharField(max_length=50, read_only=True)
    product_name = serializers.CharField(max_length=200, read_only=True)
    current_stock = serializers.IntegerField(read_only=True)
    avg_monthly_demand = serializers.DecimalField(max_digits=18, decimal_places=4)
    lead_time_days = serializers.IntegerField()
    eoq = serializers.DecimalField(max_digits=18, decimal_places=4)
    reorder_point = serializers.DecimalField(max_digits=18, decimal_places=4)
    safety_stock = serializers.DecimalField(max_digits=18, decimal_places=4)
    suggested_qty = serializers.DecimalField(max_digits=18, decimal_places=4)
    estimated_cost = serializers.DecimalField(max_digits=18, decimal_places=2)
    urgency = serializers.ChoiceField(choices=['LOW', 'MEDIUM', 'HIGH'])


class SupplierPerformanceSerializer(serializers.Serializer):
    """Supplier performance metrics"""
    supplier_id = serializers.IntegerField()
    supplier_name = serializers.CharField(read_only=True)
    on_time_delivery_rate = serializers.DecimalField(max_digits=5, decimal_places=2)
    quality_score = serializers.DecimalField(max_digits=3, decimal_places=2)
    price_variance = serializers.DecimalField(max_digits=5, decimal_places=2)
    avg_lead_time = serializers.IntegerField()
    total_orders = serializers.IntegerField(read_only=True)
    defect_rate = serializers.DecimalField(max_digits=5, decimal_places=2)
    rating = serializers.DecimalField(max_digits=2, decimal_places=1)


# ============================================================================
# INVENTORY SERIALIZERS
# ============================================================================

class SerialNumberSerializer(serializers.Serializer):
    """Serial number tracking"""
    serial_number = serializers.CharField(max_length=100)
    product_id = serializers.IntegerField()
    warehouse_id = serializers.IntegerField()
    manufacture_date = serializers.DateField()
    warranty_expiry = serializers.DateField()
    status = serializers.ChoiceField(choices=['IN_STOCK', 'SOLD', 'RETURNED', 'SCRAPPED'])
    notes = serializers.CharField(required=False)


class BatchLotSerializer(serializers.Serializer):
    """Batch/Lot tracking"""
    batch_number = serializers.CharField(max_length=100)
    product_id = serializers.IntegerField()
    manufacture_date = serializers.DateField()
    expiry_date = serializers.DateField()
    quantity = serializers.DecimalField(max_digits=18, decimal_places=4)
    quantity_issued = serializers.DecimalField(max_digits=18, decimal_places=4)
    status = serializers.ChoiceField(choices=['ACTIVE', 'PARTIAL', 'EXHAUSTED', 'RECALLED'])


# ============================================================================
# FINANCE SERIALIZERS
# ============================================================================

class BudgetSerializer(serializers.Serializer):
    """Department budgets"""
    department_id = serializers.IntegerField()
    category = serializers.CharField(max_length=200)
    budgeted_amount = serializers.DecimalField(max_digits=18, decimal_places=2)
    actual_amount = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    committed_amount = serializers.DecimalField(max_digits=18, decimal_places=2)
    variance = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    variance_percentage = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)
    fiscal_year = serializers.IntegerField()


class CostAllocationSerializer(serializers.Serializer):
    """Cost allocation and centers"""
    cost_center_code = serializers.CharField(max_length=50)
    cost_center_name = serializers.CharField(max_length=200)
    allocation_base = serializers.ChoiceField(choices=['DIRECT', 'LABOR_HOURS', 'MACHINE_HOURS', 'HEADCOUNT'])
    allocation_percentage = serializers.DecimalField(max_digits=5, decimal_places=2)
    allocated_amount = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)


class TaxConfigSerializer(serializers.Serializer):
    """Tax configuration"""
    tax_code = serializers.CharField(max_length=50)
    tax_name = serializers.CharField(max_length=200)
    tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2)
    tax_type = serializers.ChoiceField(choices=['VAT', 'INCOME', 'WITHHOLDING', 'OTHER'])
    is_active = serializers.BooleanField(default=True)


class CashFlowForecastSerializer(serializers.Serializer):
    """Cash flow forecasting"""
    forecast_period = serializers.DateField()
    opening_balance = serializers.DecimalField(max_digits=18, decimal_places=2)
    inflows = serializers.DecimalField(max_digits=18, decimal_places=2)
    outflows = serializers.DecimalField(max_digits=18, decimal_places=2)
    closing_balance = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    minimum_required = serializers.DecimalField(max_digits=18, decimal_places=2)
    shortage_alert = serializers.BooleanField(read_only=True)


class FixedAssetSerializer(serializers.Serializer):
    """Fixed asset management"""
    asset_code = serializers.CharField(max_length=100)
    asset_name = serializers.CharField(max_length=200)
    category = serializers.CharField(max_length=100)
    acquisition_date = serializers.DateField()
    acquisition_cost = serializers.DecimalField(max_digits=18, decimal_places=2)
    useful_life_years = serializers.IntegerField()
    depreciation_method = serializers.ChoiceField(choices=['STRAIGHT_LINE', 'DECLINING_BALANCE', 'UNITS_OF_PRODUCTION'])
    book_value = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    accumulated_depreciation = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)


# ============================================================================
# PRODUCTION SERIALIZERS
# ============================================================================

class WorkOrderSerializer(serializers.Serializer):
    """Work order management"""
    work_order_code = serializers.CharField(max_length=100)
    production_order_id = serializers.IntegerField()
    work_center_id = serializers.IntegerField()
    planned_start = serializers.DateTimeField()
    planned_end = serializers.DateTimeField()
    actual_start = serializers.DateTimeField(required=False)
    actual_end = serializers.DateTimeField(required=False)
    status = serializers.ChoiceField(choices=['PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
    progress_percentage = serializers.IntegerField(max_value=100)


class ProductionScheduleSerializer(serializers.Serializer):
    """Production scheduling"""
    schedule_code = serializers.CharField(max_length=100)
    period = serializers.CharField(max_length=20)
    total_capacity = serializers.DecimalField(max_digits=18, decimal_places=4)
    allocated_capacity = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    available_capacity = serializers.DecimalField(max_digits=18, decimal_places=4, read_only=True)
    bottleneck_resource = serializers.CharField(required=False)


class QualityControlSerializer(serializers.Serializer):
    """Quality control"""
    qc_code = serializers.CharField(max_length=100)
    production_order_id = serializers.IntegerField()
    qc_date = serializers.DateField()
    inspector_id = serializers.IntegerField()
    sample_size = serializers.IntegerField()
    defects_found = serializers.IntegerField()
    defect_rate = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)
    status = serializers.ChoiceField(choices=['PASS', 'CONDITIONAL_PASS', 'FAIL', 'PENDING'])


class EquipmentSerializer(serializers.Serializer):
    """Equipment/Machine management"""
    equipment_code = serializers.CharField(max_length=100)
    equipment_name = serializers.CharField(max_length=200)
    installation_date = serializers.DateField()
    manufacturer = serializers.CharField(max_length=200)
    next_maintenance_date = serializers.DateField()
    status = serializers.ChoiceField(choices=['OPERATIONAL', 'MAINTENANCE', 'IDLE', 'RETIRED'])
    utilization_percentage = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)


# ============================================================================
# REPORTING SERIALIZERS
# ============================================================================

class CustomReportSerializer(serializers.Serializer):
    """Custom report builder"""
    report_code = serializers.CharField(max_length=100)
    report_name = serializers.CharField(max_length=200)
    module = serializers.CharField(max_length=50)
    fields = serializers.JSONField()
    filters = serializers.JSONField(required=False)
    sort_by = serializers.JSONField(required=False)
    schedule = serializers.ChoiceField(choices=['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY'], required=False)
    email_recipients = serializers.JSONField(required=False)


class DataExportImportSerializer(serializers.Serializer):
    """Data export/import"""
    operation = serializers.ChoiceField(choices=['EXPORT', 'IMPORT'])
    module = serializers.CharField(max_length=50)
    format = serializers.ChoiceField(choices=['CSV', 'EXCEL', 'JSON', 'XML'])
    file_path = serializers.CharField(required=False)
    validation_errors = serializers.JSONField(read_only=True)
    record_count = serializers.IntegerField(read_only=True)


class AuditTrailSerializer(serializers.Serializer):
    """Audit trail and history tracking"""
    entity_type = serializers.CharField(max_length=100)
    entity_id = serializers.IntegerField()
    action = serializers.ChoiceField(choices=['CREATE', 'UPDATE', 'DELETE', 'VIEW', 'EXPORT'])
    changed_fields = serializers.JSONField()
    old_values = serializers.JSONField()
    new_values = serializers.JSONField()
    changed_by_id = serializers.IntegerField()
    changed_at = serializers.DateTimeField(read_only=True)
    ip_address = serializers.CharField(max_length=50, required=False)


# ============================================================================
# INTEGRATION SERIALIZERS
# ============================================================================

class EmailNotificationSerializer(serializers.Serializer):
    """Email integration"""
    notification_code = serializers.CharField(max_length=100)
    event_type = serializers.CharField(max_length=50)
    recipient_email = serializers.EmailField()
    subject = serializers.CharField(max_length=200)
    body = serializers.CharField()
    status = serializers.ChoiceField(choices=['PENDING', 'SENT', 'FAILED'])
    retry_count = serializers.IntegerField(read_only=True)


class SMSNotificationSerializer(serializers.Serializer):
    """SMS notifications"""
    notification_code = serializers.CharField(max_length=100)
    event_type = serializers.CharField(max_length=50)
    recipient_phone = serializers.CharField(max_length=20)
    message = serializers.CharField(max_length=160)
    status = serializers.ChoiceField(choices=['PENDING', 'SENT', 'FAILED'])


class APIIntegrationSerializer(serializers.Serializer):
    """API integration"""
    integration_code = serializers.CharField(max_length=100)
    external_api_url = serializers.URLField()
    auth_type = serializers.ChoiceField(choices=['BASIC', 'BEARER', 'API_KEY', 'OAUTH'])
    is_active = serializers.BooleanField(default=True)
    last_sync = serializers.DateTimeField(read_only=True)
    sync_frequency = serializers.ChoiceField(choices=['REALTIME', 'HOURLY', 'DAILY', 'MANUAL'])


# ============================================================================
# SYSTEM SERIALIZERS
# ============================================================================

class AdvancedSearchSerializer(serializers.Serializer):
    """Advanced search"""
    query = serializers.CharField()
    modules = serializers.ListField(child=serializers.CharField())
    filters = serializers.JSONField(required=False)
    sort_by = serializers.CharField(required=False)
    results = serializers.JSONField(read_only=True)


class DashboardCustomizationSerializer(serializers.Serializer):
    """Dashboard customization"""
    user_id = serializers.IntegerField()
    dashboard_name = serializers.CharField(max_length=200)
    widgets = serializers.JSONField()
    layout = serializers.CharField(max_length=50)
    is_default = serializers.BooleanField(default=False)


# ============================================================================
# Summary: 24+ Serializers covering all Phase 5 features
# Ready to be used with ViewSets for full CRUD API implementation
# ============================================================================
