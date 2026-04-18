# Phase 5 Serializers - All Optional Features
# This file contains serializers for all 24+ Phase 5 optional features

from rest_framework import serializers
from django.db import models
from core.models import CustomReportDefinition, CustomReportRun
from finance.models import BudgetPlan
from sales.models import SalesDiscountRule

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


class SalesDiscountRuleSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    is_currently_active = serializers.SerializerMethodField()

    class Meta:
        model = SalesDiscountRule
        fields = [
            'id',
            'code',
            'name',
            'type',
            'value',
            'applicable_to',
            'min_order_value',
            'min_quantity',
            'max_discount_amount',
            'start_date',
            'end_date',
            'status',
            'usage_count',
            'total_discount_value',
            'note',
            'created_by',
            'created_by_name',
            'updated_by',
            'created_at',
            'updated_at',
            'is_currently_active',
        ]
        read_only_fields = [
            'usage_count',
            'total_discount_value',
            'created_by',
            'created_by_name',
            'updated_by',
            'created_at',
            'updated_at',
            'is_currently_active',
        ]

    def get_created_by_name(self, obj):
        user = getattr(obj, 'created_by', None)
        return getattr(user, 'full_name', None) or getattr(user, 'username', None)

    def get_is_currently_active(self, obj):
        return bool(getattr(obj, 'is_currently_active', False))

    def validate_value(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError('Gia tri chiet khau phai lon hon 0.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        discount_type = attrs.get('type', getattr(self.instance, 'type', SalesDiscountRule.TYPE_PERCENTAGE))
        value = attrs.get('value', getattr(self.instance, 'value', 0))
        start_date = attrs.get('start_date', getattr(self.instance, 'start_date', None))
        end_date = attrs.get('end_date', getattr(self.instance, 'end_date', None))
        if discount_type == SalesDiscountRule.TYPE_PERCENTAGE and value > 100:
            raise serializers.ValidationError({'value': 'Chiet khau phan tram khong duoc vuot qua 100.'})
        if end_date and start_date and end_date < start_date:
            raise serializers.ValidationError({'end_date': 'Ngay ket thuc phai lon hon hoac bang ngay bat dau.'})
        return attrs


class BudgetPlanSerializer(serializers.ModelSerializer):
    available = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    variance_percentage = serializers.SerializerMethodField()

    class Meta:
        model = BudgetPlan
        fields = [
            'id',
            'department',
            'category',
            'fiscal_year',
            'budgeted_amount',
            'actual_amount',
            'committed_amount',
            'available',
            'status',
            'variance_percentage',
            'note',
            'is_active',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'available',
            'status',
            'variance_percentage',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]

    def get_available(self, obj):
        return obj.available_amount

    def get_status(self, obj):
        return obj.status

    def get_variance_percentage(self, obj):
        budget = float(obj.budgeted_amount or 0)
        if budget <= 0:
            return 0
        consumed = float((obj.actual_amount or 0) + (obj.committed_amount or 0))
        return round((consumed / budget) * 100, 2)

    def validate_budgeted_amount(self, value):
        if value is None or value < 0:
            raise serializers.ValidationError('Ngan sach khong duoc am.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        actual_amount = attrs.get('actual_amount', getattr(self.instance, 'actual_amount', 0))
        committed_amount = attrs.get('committed_amount', getattr(self.instance, 'committed_amount', 0))
        if actual_amount is not None and actual_amount < 0:
            raise serializers.ValidationError({'actual_amount': 'Da su dung khong duoc am.'})
        if committed_amount is not None and committed_amount < 0:
            raise serializers.ValidationError({'committed_amount': 'Cam ket khong duoc am.'})
        return attrs


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

class CustomReportRunSerializer(serializers.ModelSerializer):
    generated_by_name = serializers.SerializerMethodField()
    report_code = serializers.CharField(source='report.code', read_only=True)
    report_name = serializers.CharField(source='report.name', read_only=True)

    class Meta:
        model = CustomReportRun
        fields = [
            'id',
            'report',
            'report_code',
            'report_name',
            'trigger_type',
            'status',
            'period_start',
            'period_end',
            'summary',
            'row_count',
            'duration_ms',
            'error_message',
            'generated_by',
            'generated_by_name',
            'generated_at',
        ]
        read_only_fields = fields

    def get_generated_by_name(self, obj):
        user = getattr(obj, 'generated_by', None)
        return getattr(user, 'full_name', None) or getattr(user, 'username', None)


class CustomReportDefinitionSerializer(serializers.ModelSerializer):
    generated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CustomReportDefinition
        fields = [
            'id',
            'code',
            'name',
            'report_type',
            'description',
            'status',
            'is_system',
            'period_start',
            'period_end',
            'config',
            'schedule_frequency',
            'schedule_enabled',
            'schedule_time',
            'schedule_day_of_week',
            'schedule_day_of_month',
            'schedule_recipients',
            'schedule_name',
            'next_run_at',
            'last_generated_at',
            'last_generated_by',
            'generated_by_name',
            'last_run_status',
            'last_run_error',
            'last_run_summary',
            'run_count',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'schedule_name',
            'next_run_at',
            'last_generated_at',
            'last_generated_by',
            'generated_by_name',
            'last_run_status',
            'last_run_error',
            'last_run_summary',
            'run_count',
            'created_by',
            'updated_by',
            'created_at',
            'updated_at',
        ]

    def get_generated_by_name(self, obj):
        user = getattr(obj, 'last_generated_by', None)
        return getattr(user, 'full_name', None) or getattr(user, 'username', None)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        period_start = attrs.get('period_start', getattr(self.instance, 'period_start', None))
        period_end = attrs.get('period_end', getattr(self.instance, 'period_end', None))
        if period_start and period_end and period_end < period_start:
            raise serializers.ValidationError({'period_end': 'Ngay ket thuc phai lon hon hoac bang ngay bat dau.'})

        schedule_enabled = attrs.get('schedule_enabled', getattr(self.instance, 'schedule_enabled', False))
        schedule_frequency = attrs.get('schedule_frequency', getattr(self.instance, 'schedule_frequency', CustomReportDefinition.SCHEDULE_NONE))
        schedule_day_of_week = attrs.get('schedule_day_of_week', getattr(self.instance, 'schedule_day_of_week', None))
        schedule_day_of_month = attrs.get('schedule_day_of_month', getattr(self.instance, 'schedule_day_of_month', None))
        if schedule_enabled and schedule_frequency == CustomReportDefinition.SCHEDULE_NONE:
            raise serializers.ValidationError({'schedule_frequency': 'Can chon tan suat lap lich khi bat scheduler.'})
        if schedule_frequency == CustomReportDefinition.SCHEDULE_WEEKLY and schedule_day_of_week is not None:
            if int(schedule_day_of_week) < 0 or int(schedule_day_of_week) > 6:
                raise serializers.ValidationError({'schedule_day_of_week': 'Thu trong tuan phai nam trong khoang 0-6.'})
        if schedule_frequency == CustomReportDefinition.SCHEDULE_MONTHLY and schedule_day_of_month is not None:
            if int(schedule_day_of_month) < 1 or int(schedule_day_of_month) > 31:
                raise serializers.ValidationError({'schedule_day_of_month': 'Ngay trong thang phai nam trong khoang 1-31.'})
        return attrs


class CustomReportDetailSerializer(CustomReportDefinitionSerializer):
    recent_runs = serializers.SerializerMethodField()

    class Meta(CustomReportDefinitionSerializer.Meta):
        fields = CustomReportDefinitionSerializer.Meta.fields + ['recent_runs']

    def get_recent_runs(self, obj):
        runs = obj.runs.select_related('generated_by').order_by('-generated_at', '-id')[:10]
        return CustomReportRunSerializer(runs, many=True).data


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
