export const API_BASE_URL = 'http://127.0.0.1:8000/api';

export const PAGES = {
  PRODUCTS_LIST: 'products-list',
  PRODUCTS_FORM: 'products-form',
  CUSTOMERS_LIST: 'customers-list',
  ORDERS_LIST: 'orders-list',
  DASHBOARD: 'dashboard',
  SETTINGS: 'settings',
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
