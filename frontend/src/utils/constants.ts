export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api';

export const PAGES = {
  PRODUCTS_LIST: 'products-list',
  PRODUCTS_FORM: 'products-form',
  CUSTOMERS_LIST: 'customers-list',
  ORDERS_LIST: 'orders-list',
  SALES_ORDERS: 'sales-orders',
  DASHBOARD: 'dashboard',
  REPORTS_CENTER: 'reports-center',
  SETTINGS: 'settings',
  WORKFORCE_EMPLOYEES: 'workforce-employees',
  FINANCE_BANK_ACCOUNTS: 'finance-bank-accounts',
  FINANCE_TRANSACTION_CATEGORIES: 'finance-transaction-categories',
  FINANCE_CASH_BOOK: 'finance-cash-book',
  FINANCE_ADVANCE_TRANSACTIONS: 'finance-advance-transactions',
  FINANCE_RECEIVABLES: 'finance-receivables',
  FINANCE_PAYABLES: 'finance-payables',
  FINANCE_BANK_RECONCILIATION: 'finance-bank-recon',
  PURCHASING_SUPPLIERS: 'purchasing-suppliers',
  PURCHASING_MATERIAL_PRICES: 'purchasing-material-prices',
  PURCHASING_ORDERS: 'purchasing-orders',
  PURCHASING_RECEIPTS: 'purchasing-receipts',
  PURCHASING_RETURNS: 'purchasing-returns',
  PRODUCTION_ORDERS: 'production-orders',
  INVENTORY_WAREHOUSES: 'inventory-warehouses',
  INVENTORY_LOCATIONS: 'inventory-locations',
  INVENTORY_STOCK: 'inventory-stock',
  INVENTORY_TRANSACTIONS: 'inventory-transactions',
  INVENTORY_RESERVATIONS: 'inventory-reservations',
  INVENTORY_STOCK_ALERTS: 'inventory-stock-alerts',
  INVENTORY_WAREHOUSE_TRANSFERS: 'inventory-warehouse-transfers',
  EXECUTIVE_COCKPIT: 'executive-cockpit',
  ADMIN_MODULE_PERMISSIONS: 'admin-module-permissions',
  ADMIN_MODULE_PERMISSION_HISTORY: 'admin-module-permission-history',
};

export const API_ENDPOINTS = {
  // Auth
  LOGIN: '/auth/login/',
  LOGOUT: '/auth/logout/',
  REFRESH: '/auth/refresh/',

  // Products
  PRODUCTS: '/products/products/',
  CATEGORIES: '/products/categories/',
  UNITS: '/products/units/',
  WAVES: '/products/waves/',
  BOX_TYPES: '/products/box-types/',
  PRICINGS: '/products/pricings/',

  // Xuất Excel: dùng ExportExcelMixin.export_data (chuẩn duy nhất)
  EXPORT_PRODUCTS: '/products/products/export_data/',
  IMPORT_PRODUCTS: '/products/products/import_excel/',
  DOWNLOAD_TEMPLATE: '/products/products/download_import_template/',
  CATEGORY_TREE: '/products/categories/tree/',

  // Customers: chuẩn export_data + import_excel
  CUSTOMERS: '/customers/',
  EXPORT_CUSTOMERS: '/customers/export_data/',
  IMPORT_CUSTOMERS: '/customers/import_excel/',
  DOWNLOAD_CUSTOMER_TEMPLATE: '/customers/download_import_template/',

  // Workforce
  WORKFORCE_EMPLOYEES: '/workforce/employees/',
  WORKFORCE_EMPLOYEE_PROFILE_HISTORIES: '/workforce/employee-profile-histories/',
  WORKFORCE_ATTENDANCE_RECORDS: '/workforce/attendance-records/',
  WORKFORCE_BONUS_PENALTY_RECORDS: '/workforce/bonus-penalty-records/',
  WORKFORCE_SALARY_ADVANCES: '/workforce/salary-advances/',
  WORKFORCE_PAYROLL_RECORDS: '/workforce/payroll-records/',
  WORKFORCE_SALARY_ADVANCE_APPROVAL_QUEUE: '/workforce/salary-advances/approval_queue/',
  WORKFORCE_SALARY_ADVANCE_APPROVAL_SLA_OVERVIEW: '/workforce/salary-advances/approval_sla_overview/',
  WORKFORCE_SALARY_ADVANCE_REMIND_PENDING_APPROVALS: '/workforce/salary-advances/remind_pending_approvals/',
  WORKFORCE_SALARY_ADVANCE_APPROVAL_SLA_REMINDER_HISTORY: '/workforce/salary-advances/approval_sla_reminder_history/',
  WORKFORCE_SALARY_ADVANCE_APPROVAL_SLA_POLICY: '/workforce/salary-advances/approval_sla_policy/',

  // Finance
  FINANCE_BANK_ACCOUNTS: '/finance/bank-accounts/',
  FINANCE_TRANSACTION_CATEGORIES: '/finance/transaction-categories/',
  FINANCE_CASH_ACCOUNTS: '/finance/cash-accounts/',
  FINANCE_CASH_TRANSACTIONS: '/finance/cash-transactions/',
  FINANCE_ADVANCE_TRANSACTIONS: '/finance/advance-transactions/',
  FINANCE_ADVANCE_SETTLEMENTS: '/finance/advance-settlements/',
  FINANCE_RECEIVABLES: '/finance/receivables/',
  FINANCE_PAYABLES: '/finance/payables/',
  FINANCE_ADVANCE_OVERDUE_REPORT: '/finance/advance-transactions/overdue_report/',
  FINANCE_ADVANCE_OVERDUE_OVERVIEW: '/finance/advance-transactions/overdue_overview/',
  FINANCE_ADVANCE_REMIND_OVERDUE: '/finance/advance-transactions/remind_overdue/',
  FINANCE_ADVANCE_REMINDER_HISTORY: '/finance/advance-transactions/reminder_history/',
  FINANCE_ADVANCE_REMINDER_POLICY: '/finance/advance-transactions/reminder_policy/',
  FINANCE_ADVANCE_REMINDER_POLICY_HISTORY: '/finance/advance-transactions/reminder_policy_history/',
  FINANCE_ADVANCE_REMINDER_POLICY_ROLLBACK: '/finance/advance-transactions/reminder_policy_rollback/',
  FINANCE_ADVANCE_REMINDER_POLICY_SIMULATE: '/finance/advance-transactions/reminder_policy_simulate/',
  FINANCE_ADVANCE_APPROVAL_QUEUE: '/finance/advance-transactions/approval_queue/',
  FINANCE_ADVANCE_APPROVAL_SLA_OVERVIEW: '/finance/advance-transactions/approval_sla_overview/',
  FINANCE_ADVANCE_REMIND_PENDING_APPROVALS: '/finance/advance-transactions/remind_pending_approvals/',
  FINANCE_ADVANCE_APPROVAL_SLA_REMINDER_HISTORY: '/finance/advance-transactions/approval_sla_reminder_history/',
  FINANCE_ADVANCE_APPROVAL_SLA_POLICY: '/finance/advance-transactions/approval_sla_policy/',
  FINANCE_EXECUTIVE_KPI: '/finance/advance-transactions/executive_kpi/',
  FINANCE_CROSS_MODULE_READINESS: '/finance/advance-transactions/cross_module_readiness/',
  FINANCE_CROSS_MODULE_BOOTSTRAP: '/finance/advance-transactions/cross_module_bootstrap/',
  FINANCE_CROSS_MODULE_BOOTSTRAP_HISTORY: '/finance/advance-transactions/cross_module_bootstrap_history/',
  FINANCE_EXECUTIVE_AUTO_POLICY: '/finance/advance-transactions/executive_auto_policy/',
  FINANCE_EXECUTIVE_AUTO_EXECUTE: '/finance/advance-transactions/executive_auto_execute/',
  FINANCE_EXECUTIVE_AUTO_HISTORY: '/finance/advance-transactions/executive_auto_history/',
  FINANCE_EXECUTIVE_AUTO_GOVERNANCE: '/finance/advance-transactions/executive_auto_governance/',
  FINANCE_ADVANCE_SUBMIT_APPROVAL: '/finance/advance-transactions/{id}/submit_approval/',
  FINANCE_ADVANCE_APPROVE_LEVEL1: '/finance/advance-transactions/{id}/approve_level1/',
  FINANCE_ADVANCE_APPROVE_LEVEL2: '/finance/advance-transactions/{id}/approve_level2/',
  FINANCE_ADVANCE_REJECT_APPROVAL: '/finance/advance-transactions/{id}/reject_approval/',
  FINANCE_LOCKED_MONTHS: '/finance/cash-transactions/locked_months/',
  FINANCE_LOCK_MONTH: '/finance/cash-transactions/lock_month/',
  FINANCE_UNLOCK_MONTH: '/finance/cash-transactions/unlock_month/',
  FINANCE_PAYROLL_RECONCILIATION: '/finance/cash-transactions/payroll_reconciliation/',
  FINANCE_CASH_FLOW_SUMMARY: '/finance/cash-transactions/cash_flow_summary/',
  FINANCE_GENERAL_LEDGER: '/finance/cash-transactions/general_ledger/',

  // Inventory
  INVENTORY_WAREHOUSES: '/inventory/warehouses/',
  INVENTORY_LOCATIONS: '/inventory/locations/',
  INVENTORY_TRANSACTIONS: '/inventory/transactions/',
  INVENTORY_RESERVATIONS: '/inventory/reservations/',
  INVENTORY_STOCK: '/inventory/stock/',
  INVENTORY_NXT_REPORT: '/inventory/transactions/nxt_report/',
  INVENTORY_STOCKTAKES: '/inventory/stocktakes/',
  INVENTORY_SHIPMENTS: '/inventory/shipments/',
  PURCHASING_SUPPLIERS: '/purchasing/suppliers/',
  PURCHASING_MATERIAL_PRICES: '/purchasing/material-prices/',
  PURCHASING_ORDERS: '/purchasing/orders/',
  PURCHASING_RECEIPTS: '/purchasing/receipts/',
  PURCHASING_REQUESTS: '/purchasing/requests/',
  PRODUCTION_ORDERS: '/production/orders/',
  PRODUCTION_ISSUES: '/production/issues/',
  PRODUCTION_RECEIPTS: '/production/receipts/',
  SALES_ORDERS: '/sales/orders/',
  SALES_QUOTES: '/sales/quotes/',

  // Admin
  ROLES: '/roles/',
  ROLE_MODULE_PERMISSIONS: '/roles/module_permissions/',
  ROLE_MODULE_PERMISSIONS_HISTORY: '/roles/module_permissions_history/',
};

export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  USER: 'user',
};

export const PRODUCT_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  DISCONTINUED: 'DISCONTINUED',
};

export const PRODUCT_STATUS_LABELS = {
  DRAFT: 'Nháp',
  ACTIVE: 'Đang bán',
  DISCONTINUED: 'Ngừng SX',
};

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  SalesOrder: 'Đơn hàng',
  Supplier: 'Nhà cung cấp',
  PurchaseOrder: 'Đơn mua',
  PurchaseReceipt: 'Phiếu nhập mua',
  ProductionOrder: 'Lệnh sản xuất',
  ProductionIssue: 'Cấp vật tư',
  ProductionReceipt: 'Nhập kho thành phẩm',
  Product: 'Sản phẩm',
  Customer: 'Khách hàng',
  Task: 'Nhiệm vụ',
};

export const getEntityTypeLabel = (entityType: string | null | undefined): string => {
  if (!entityType) return 'Đối tượng';
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
};
