export const API_BASE_URL = 'http://127.0.0.1:8000/api';

export const PAGES = {
  PRODUCTS_LIST: 'products-list',
  PRODUCTS_FORM: 'products-form',
  CUSTOMERS_LIST: 'customers-list',
  ORDERS_LIST: 'orders-list',
  DASHBOARD: 'dashboard',
  SETTINGS: 'settings',
  WORKFORCE_EMPLOYEES: 'workforce-employees',
  FINANCE_BANK_ACCOUNTS: 'finance-bank-accounts',
  FINANCE_TRANSACTION_CATEGORIES: 'finance-transaction-categories',
  FINANCE_CASH_BOOK: 'finance-cash-book',
  FINANCE_ADVANCE_TRANSACTIONS: 'finance-advance-transactions',
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
  WORKFORCE_ATTENDANCE_RECORDS: '/workforce/attendance-records/',
  WORKFORCE_BONUS_PENALTY_RECORDS: '/workforce/bonus-penalty-records/',
  WORKFORCE_SALARY_ADVANCES: '/workforce/salary-advances/',
  WORKFORCE_PAYROLL_RECORDS: '/workforce/payroll-records/',

  // Finance
  FINANCE_BANK_ACCOUNTS: '/finance/bank-accounts/',
  FINANCE_TRANSACTION_CATEGORIES: '/finance/transaction-categories/',
  FINANCE_CASH_ACCOUNTS: '/finance/cash-accounts/',
  FINANCE_CASH_TRANSACTIONS: '/finance/cash-transactions/',
  FINANCE_ADVANCE_TRANSACTIONS: '/finance/advance-transactions/',
  FINANCE_ADVANCE_SETTLEMENTS: '/finance/advance-settlements/',
  FINANCE_ADVANCE_OVERDUE_REPORT: '/finance/advance-transactions/overdue_report/',
  FINANCE_ADVANCE_OVERDUE_OVERVIEW: '/finance/advance-transactions/overdue_overview/',
  FINANCE_ADVANCE_REMIND_OVERDUE: '/finance/advance-transactions/remind_overdue/',
  FINANCE_ADVANCE_REMINDER_HISTORY: '/finance/advance-transactions/reminder_history/',
  FINANCE_ADVANCE_REMINDER_POLICY: '/finance/advance-transactions/reminder_policy/',
  FINANCE_ADVANCE_REMINDER_POLICY_HISTORY: '/finance/advance-transactions/reminder_policy_history/',
  FINANCE_ADVANCE_REMINDER_POLICY_ROLLBACK: '/finance/advance-transactions/reminder_policy_rollback/',
  FINANCE_ADVANCE_REMINDER_POLICY_SIMULATE: '/finance/advance-transactions/reminder_policy_simulate/',
  FINANCE_LOCKED_MONTHS: '/finance/cash-transactions/locked_months/',
  FINANCE_LOCK_MONTH: '/finance/cash-transactions/lock_month/',
  FINANCE_UNLOCK_MONTH: '/finance/cash-transactions/unlock_month/',
  FINANCE_PAYROLL_RECONCILIATION: '/finance/cash-transactions/payroll_reconciliation/',

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
  Product: 'Sản phẩm',
  Customer: 'Khách hàng',
  Task: 'Nhiệm vụ',
};

export const getEntityTypeLabel = (entityType: string | null | undefined): string => {
  if (!entityType) return 'Đối tượng';
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
};
