from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    UserViewSet, RoleViewSet, PermissionViewSet,
    TeamViewSet, SettingViewSet, CustomTokenObtainPairView,
    CustomerViewSet, ExportTemplateViewSet, SavedViewViewSet, AttachmentViewSet, CommentViewSet, ActivityStreamViewSet, NotificationViewSet, UserSessionViewSet,
    UserPreferencesViewSet,
    ColumnPermissionViewSet,
    TaskViewSet,
    WorkflowTaskTemplateViewSet,
)
from products.views import (
    ProductCategoryViewSet,
    ProductUnitViewSet,
    ProductWaveViewSet,
    ProductBoxTypeViewSet,
    ProductViewSet,
)
from inventory.views import (
    WarehouseViewSet,
    WarehouseLocationViewSet,
    InventoryTransactionViewSet,
    InventoryReservationViewSet,
    InventoryStockViewSet,
    StockAlertViewSet,
    StocktakeViewSet,
    OutboundShipmentViewSet,
    WarehouseTransferViewSet,
)
from sales.views import SalesOrderViewSet, QuoteViewSet, ShipmentViewSet
from purchasing.views import (
    MaterialPurchasePriceViewSet,
    SupplierViewSet,
    PurchaseOrderViewSet,
    PurchaseReceiptViewSet,
    PurchaseRequestViewSet,
    PurchaseReturnViewSet,
)
from production.views import ProductionOrderViewSet, ProductionIssueViewSet, ProductionReceiptViewSet
from workforce.views import (
    AttendanceRecordViewSet,
    BonusPenaltyRecordViewSet,
    EmployeeViewSet,
    EmployeeProfileHistoryViewSet,
    PayrollRecordViewSet,
    SalaryAdvanceRecordViewSet,
)
from finance.views import (
    AdvanceSettlementViewSet,
    AdvanceTransactionViewSet,
    BankAccountViewSet,
    CashAccountViewSet,
    CashTransactionViewSet,
    PayableDocumentViewSet,
    ReceivableDocumentViewSet,
    TransactionCategoryViewSet,
)

router = DefaultRouter()
router.register(r'column-permissions', ColumnPermissionViewSet, basename='column-permission')
router.register(r'users', UserViewSet)
router.register(r'roles', RoleViewSet)
router.register(r'permissions', PermissionViewSet)
router.register(r'teams', TeamViewSet)
router.register(r'settings', SettingViewSet)
router.register(r'customers', CustomerViewSet, basename='customer')
router.register(r'export-templates', ExportTemplateViewSet)
router.register(r'saved-views', SavedViewViewSet, basename='savedview')
router.register(r'attachments', AttachmentViewSet, basename='attachment')
router.register(r'comments', CommentViewSet, basename='comment')
router.register(r'activity', ActivityStreamViewSet, basename='activity')
router.register(r'notifications', NotificationViewSet, basename='notification')
router.register(r'sessions', UserSessionViewSet, basename='session')
# Sản phẩm: đăng ký chung một router để tránh lỗi "drf_format_suffix already registered"
router.register(r'products/categories', ProductCategoryViewSet, basename='productcategory')
router.register(r'products/units', ProductUnitViewSet, basename='productunit')
router.register(r'products/waves', ProductWaveViewSet, basename='wave')
router.register(r'products/box-types', ProductBoxTypeViewSet, basename='boxtype')
router.register(r'products/products', ProductViewSet, basename='product')
router.register(r'inventory/warehouses', WarehouseViewSet, basename='inventory-warehouse')
router.register(r'inventory/locations', WarehouseLocationViewSet, basename='inventory-location')
router.register(r'inventory/transactions', InventoryTransactionViewSet, basename='inventory-transaction')
router.register(r'inventory/reservations', InventoryReservationViewSet, basename='inventory-reservation')
router.register(r'inventory/stock', InventoryStockViewSet, basename='inventory-stock')
router.register(r'inventory/stock-alerts', StockAlertViewSet, basename='inventory-stock-alert')
router.register(r'inventory/stocktakes', StocktakeViewSet, basename='inventory-stocktake')
router.register(r'inventory/shipments', OutboundShipmentViewSet, basename='inventory-shipment')
router.register(r'inventory/warehouse-transfers', WarehouseTransferViewSet, basename='inventory-warehouse-transfer')
router.register(r'purchasing/suppliers', SupplierViewSet, basename='purchasing-supplier')
router.register(r'purchasing/material-prices', MaterialPurchasePriceViewSet, basename='purchasing-material-price')
router.register(r'purchasing/orders', PurchaseOrderViewSet, basename='purchasing-order')
router.register(r'purchasing/receipts', PurchaseReceiptViewSet, basename='purchasing-receipt')
router.register(r'purchasing/requests', PurchaseRequestViewSet, basename='purchasing-request')
router.register(r'purchasing/returns', PurchaseReturnViewSet, basename='purchasing-return')
router.register(r'production/orders', ProductionOrderViewSet, basename='production-order')
router.register(r'production/issues', ProductionIssueViewSet, basename='production-issue')
router.register(r'production/receipts', ProductionReceiptViewSet, basename='production-receipt')
router.register(r'sales/orders', SalesOrderViewSet, basename='salesorder')
router.register(r'sales/quotes', QuoteViewSet, basename='quote')
router.register(r'sales/shipments', ShipmentViewSet, basename='sales-shipment')
router.register(r'tasks', TaskViewSet, basename='task')
router.register(r'workflow-task-templates', WorkflowTaskTemplateViewSet, basename='workflowtasktemplate')
router.register(r'workforce/employees', EmployeeViewSet, basename='workforce-employee')
router.register(r'workforce/employee-profile-histories', EmployeeProfileHistoryViewSet, basename='workforce-employee-profile-history')
router.register(r'workforce/attendance-records', AttendanceRecordViewSet, basename='workforce-attendance-record')
router.register(r'workforce/bonus-penalty-records', BonusPenaltyRecordViewSet, basename='workforce-bonus-penalty-record')
router.register(r'workforce/salary-advances', SalaryAdvanceRecordViewSet, basename='workforce-salary-advance')
router.register(r'workforce/payroll-records', PayrollRecordViewSet, basename='workforce-payroll-record')
router.register(r'finance/bank-accounts', BankAccountViewSet, basename='finance-bank-account')
router.register(r'finance/transaction-categories', TransactionCategoryViewSet, basename='finance-transaction-category')
router.register(r'finance/cash-accounts', CashAccountViewSet, basename='finance-cash-account')
router.register(r'finance/cash-transactions', CashTransactionViewSet, basename='finance-cash-transaction')
router.register(r'finance/advance-transactions', AdvanceTransactionViewSet, basename='finance-advance-transaction')
router.register(r'finance/advance-settlements', AdvanceSettlementViewSet, basename='finance-advance-settlement')
router.register(r'finance/receivables', ReceivableDocumentViewSet, basename='finance-receivable')
router.register(r'finance/payables', PayableDocumentViewSet, basename='finance-payable')

urlpatterns = [
    path('auth/login/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('preferences/<str:page>/', UserPreferencesViewSet.as_view(actions={'get': 'page_config', 'post': 'page_config', 'delete': 'page_config'}), name='userpreferences-page-config'),
    path('', include(router.urls)),
]