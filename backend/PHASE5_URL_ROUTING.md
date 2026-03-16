# Phase 5 URL Routing Configuration
# Add these routes to backend/core/urls.py or your main urls.py

"""
PHASE 5 URL PATTERNS - Add to your urlpatterns:

from rest_framework.routers import DefaultRouter
from backend.phase5_viewsets import (
    PurchaseOrderForecastViewSet,
    SupplierPerformanceViewSet,
    InventoryForecastViewSet,
    SerialNumberTrackingViewSet,
    BudgetManagementViewSet,
    CostAllocationViewSet,
    TaxManagementViewSet,
    CashFlowForecastViewSet,
    FixedAssetViewSet,
    WorkOrderViewSet,
    ProductionScheduleViewSet,
    QualityControlViewSet,
    EquipmentViewSet,
    CustomReportViewSet,
    DataExportImportViewSet,
    AuditTrailViewSet,
    EmailNotificationViewSet,
    SMSNotificationViewSet,
    AdvancedSearchViewSet,
)

router = DefaultRouter()

# Purchasing Routes
router.register(r'purchasing/forecast', PurchaseOrderForecastViewSet, basename='po-forecast')
router.register(r'purchasing/supplier-analytics', SupplierPerformanceViewSet, basename='supplier-analytics')

# Inventory Routes
router.register(r'inventory/forecast', InventoryForecastViewSet, basename='inventory-forecast')
router.register(r'inventory/serial-tracking', SerialNumberTrackingViewSet, basename='serial-tracking')

# Finance Routes
router.register(r'finance/budgets', BudgetManagementViewSet, basename='budgets')
router.register(r'finance/cost-allocation', CostAllocationViewSet, basename='cost-allocation')
router.register(r'finance/tax-management', TaxManagementViewSet, basename='tax-management')
router.register(r'finance/cash-flow', CashFlowForecastViewSet, basename='cash-flow-forecast')
router.register(r'finance/fixed-assets', FixedAssetViewSet, basename='fixed-assets')

# Production Routes
router.register(r'production/work-orders', WorkOrderViewSet, basename='work-orders')
router.register(r'production/scheduling', ProductionScheduleViewSet, basename='production-schedule')
router.register(r'production/quality-control', QualityControlViewSet, basename='quality-control')
router.register(r'production/equipment', EquipmentViewSet, basename='equipment')

# Reporting Routes
router.register(r'reports/custom', CustomReportViewSet, basename='custom-reports')
router.register(r'reports/export-import', DataExportImportViewSet, basename='export-import')
router.register(r'reports/audit-trail', AuditTrailViewSet, basename='audit-trail')

# Integration Routes
router.register(r'integration/email', EmailNotificationViewSet, basename='email-notifications')
router.register(r'integration/sms', SMSNotificationViewSet, basename='sms-notifications')

# System Routes
router.register(r'system/search', AdvancedSearchViewSet, basename='advanced-search')

urlpatterns = [
    path('api/', include(router.urls)),
]
"""

# API Endpoints Summary:
API_ENDPOINTS = {
    "PURCHASING": {
        "POST /api/purchasing/forecast/forecast/": "Generate PO forecast",
        "POST /api/purchasing/forecast/create_po_from_forecast/": "Create PO from forecast",
        "GET /api/purchasing/supplier-analytics/": "List supplier performance",
        "GET /api/purchasing/supplier-analytics/{id}/analytics/": "Get supplier analytics",
    },
    "INVENTORY": {
        "GET /api/inventory/forecast/": "List inventory forecast",
        "GET /api/inventory/forecast/abc_analysis/": "ABC analysis",
        "GET /api/inventory/serial-tracking/": "List serial numbers",
        "POST /api/inventory/serial-tracking/assign_serial/": "Assign serial number",
    },
    "FINANCE": {
        "GET /api/finance/budgets/": "List budgets",
        "GET /api/finance/budgets/variance_analysis/": "Budget variance analysis",
        "POST /api/finance/cost-allocation/allocate_costs/": "Allocate costs",
        "GET /api/finance/tax-management/": "List tax configs",
        "POST /api/finance/tax-management/calculate_tax/": "Calculate tax",
        "GET /api/finance/cash-flow/": "List cash flow forecasts",
        "GET /api/finance/cash-flow/projection/": "Get cash flow projection",
        "GET /api/finance/fixed-assets/": "List fixed assets",
        "GET /api/finance/fixed-assets/{id}/depreciation_schedule/": "Get depreciation schedule",
    },
    "PRODUCTION": {
        "GET /api/production/work-orders/": "List work orders",
        "POST /api/production/work-orders/{id}/start_work/": "Start work order",
        "POST /api/production/work-orders/{id}/complete_work/": "Complete work order",
        "GET /api/production/scheduling/": "List production schedules",
        "GET /api/production/scheduling/capacity_analysis/": "Analyze capacity",
        "GET /api/production/quality-control/": "List QC records",
        "POST /api/production/quality-control/record_inspection/": "Record inspection",
        "GET /api/production/equipment/": "List equipment",
        "POST /api/production/equipment/{id}/schedule_maintenance/": "Schedule maintenance",
    },
    "REPORTING": {
        "GET /api/reports/custom/": "List custom reports",
        "POST /api/reports/custom/generate_report/": "Generate report",
        "POST /api/reports/custom/schedule_report/": "Schedule report",
        "POST /api/reports/export-import/export_data/": "Export data",
        "POST /api/reports/export-import/import_data/": "Import data",
        "GET /api/reports/audit-trail/": "List audit trail",
        "GET /api/reports/audit-trail/user_activity/": "Get user activity",
    },
    "INTEGRATION": {
        "GET /api/integration/email/": "List email notifications",
        "POST /api/integration/email/send_email/": "Send email",
        "POST /api/integration/sms/send_sms/": "Send SMS",
    },
    "SYSTEM": {
        "GET /api/system/search/search/": "Global search",
        "GET /api/system/search/search_history/": "Get search history",
    },
}

# Total Endpoints: 50+ API endpoints covering all Phase 5 features
