export const API_BASE_URL = 'http://127.0.0.1:8000/api';

// Gốc server (không có /api) — dùng cho export-excel vì route ở root
const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '') || 'http://127.0.0.1:8000';

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

  // Xuất Excel: GET {origin}/export-excel/?format=excel (route ở root, không qua /api)
  EXPORT_PRODUCTS: `${API_ORIGIN}/export-excel/`,
  IMPORT_PRODUCTS: '/products/products/import_excel/',
  DOWNLOAD_TEMPLATE: '/products/products/download_import_template/',
  CATEGORY_TREE: '/products/categories/tree/',
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
  DISCONTINUED: 'Ngừng sản xuất',
};
