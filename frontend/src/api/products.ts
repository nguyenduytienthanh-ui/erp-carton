import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  Product,
  ProductCategory,
  ProductBundleDefinition,
  ProductBundleUpsertPayload,
  ProductUnit,
  PaginatedResponse,
  ProductFormData,
  ProductRoutingReadiness,
} from '../types/product';
import type { ActivityItem } from '../utils/historyUtils';

export type { ActivityItem } from '../utils/historyUtils';

export interface PriceChangeRecord {
  id: number;
  product: number;
  product_code?: string;
  record_scope?: 'PRODUCT' | 'BUNDLE_FIXED';
  old_cost_price?: string | null;
  new_cost_price?: string | null;
  old_sale_price?: string | null;
  new_sale_price?: string | null;
  old_commission_per_unit?: string | null;
  new_commission_per_unit?: string | null;
  old_commission_percent?: string | null;
  new_commission_percent?: string | null;
  delta_cost?: string | null;
  delta_sale?: string | null;
  delta_cost_percent?: string | null;
  delta_sale_percent?: string | null;
  reason?: string;
  source?: string;
  effective_at?: string | null;
  applied_at?: string | null;
  batch_code?: string;
  status: 'PENDING_APPROVAL' | 'APPROVED_SCHEDULED' | 'REJECTED' | 'ACTIVE_APPLIED' | 'SUPERSEDED';
  reject_reason?: string;
  submitted_by_name?: string | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  created_at: string;
}

export interface BundlePriceChangeRecord extends Omit<PriceChangeRecord, 'product'> {
  bundle: number;
  sellable_product: number;
}

export interface BulkPriceChangeItemInput {
  product_id: number;
  new_cost_price?: number | null;
  new_sale_price?: number | null;
  new_commission_per_unit?: number | null;
  new_commission_percent?: number | null;
}

export interface BulkPriceChangePreviewItem {
  product_id: number;
  product_code: string;
  product_name: string;
  old_cost_price: string;
  new_cost_price: string;
  old_sale_price: string;
  new_sale_price: string;
  old_commission_per_unit: string;
  new_commission_per_unit: string;
  old_commission_percent: string;
  new_commission_percent: string;
  delta_cost: string;
  delta_cost_percent: string;
  delta_sale: string;
  delta_sale_percent: string;
}

export interface BulkPriceChangeSubmitResult {
  batch_code: string;
  total: number;
  auto_approve: boolean;
  items: PriceChangeRecord[];
  preview: BulkPriceChangePreviewItem[];
}

type QueryParams = Record<string, unknown>;

export interface ProductImportResult {
  total_rows: number;
  success_count: number;
  error_count: number;
  errors: Array<{ row?: number; error?: string } | string>;
  log_id?: number;
  [key: string]: unknown;
}

export const productsApi = {
  // ===== PRODUCTS CRUD =====
  getProducts: async (params?: QueryParams): Promise<PaginatedResponse<Product>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PRODUCTS, { params });
    return response.data;
  },

  getProduct: async (id: number): Promise<Product> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTS}${id}/`);
    return response.data;
  },

  getProductReadiness: async (id: number): Promise<ProductRoutingReadiness> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTS}${id}/readiness/`);
    return response.data;
  },

  createProduct: async (data: ProductFormData): Promise<Product> => {
    const response = await axiosInstance.post(API_ENDPOINTS.PRODUCTS, data);
    return response.data;
  },

  updateProduct: async (id: number, data: Partial<ProductFormData>): Promise<Product> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.PRODUCTS}${id}/`, data);
    return response.data;
  },

  deleteProduct: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.PRODUCTS}${id}/`);
  },

  bulkDeleteProducts: async (ids: number[]): Promise<{ message: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTS}bulk_delete/`, { ids });
    return response.data;
  },

  // Upload PDF file (phim, khuôn)
  uploadFile: async (file: File, fieldName: string): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('field_name', fieldName);

    const response = await axiosInstance.post('/products/products/upload_file/', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Get components of a product (thùng con, lót, khay)
  getComponents: async (parentId: number): Promise<Product[]> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PRODUCTS, {
      params: { parent: parentId },
    });
    return response.data.results;
  },

  getProductBundle: async (productId: number): Promise<ProductBundleDefinition> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTS}${productId}/bundle/`);
    return response.data;
  },

  upsertProductBundle: async (
    productId: number,
    data: ProductBundleUpsertPayload
  ): Promise<ProductBundleDefinition> => {
    const response = await axiosInstance.put(`${API_ENDPOINTS.PRODUCTS}${productId}/bundle/`, data);
    return response.data;
  },

  deleteProductBundle: async (productId: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.PRODUCTS}${productId}/bundle/`);
  },

  // ===== CATEGORIES =====
  getCategories: async (params?: QueryParams): Promise<PaginatedResponse<ProductCategory>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.CATEGORIES, { params });
    return response.data;
  },

  getCategoryTree: async (): Promise<ProductCategory[]> => {
    const response = await axiosInstance.get(API_ENDPOINTS.CATEGORY_TREE);
    return response.data;
  },

  getCategory: async (id: number): Promise<ProductCategory> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.CATEGORIES}${id}/`);
    return response.data;
  },

  createCategory: async (data: Partial<ProductCategory>): Promise<ProductCategory> => {
    const response = await axiosInstance.post(API_ENDPOINTS.CATEGORIES, data);
    return response.data;
  },

  updateCategory: async (id: number, data: Partial<ProductCategory>): Promise<ProductCategory> => {
    const response = await axiosInstance.put(`${API_ENDPOINTS.CATEGORIES}${id}/`, data);
    return response.data;
  },

  deleteCategory: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.CATEGORIES}${id}/`);
  },

  // ===== UNITS =====
  getUnits: async (params?: QueryParams): Promise<PaginatedResponse<ProductUnit>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.UNITS, { params });
    return response.data;
  },

  getUnit: async (id: number): Promise<ProductUnit> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.UNITS}${id}/`);
    return response.data;
  },

  createUnit: async (data: Partial<ProductUnit>): Promise<ProductUnit> => {
    const response = await axiosInstance.post(API_ENDPOINTS.UNITS, data);
    return response.data;
  },

  updateUnit: async (id: number, data: Partial<ProductUnit>): Promise<ProductUnit> => {
    const response = await axiosInstance.put(`${API_ENDPOINTS.UNITS}${id}/`, data);
    return response.data;
  },

  deleteUnit: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.UNITS}${id}/`);
  },

  // ===== WAVES =====
  getWaves: async (params?: { page_size?: number }): Promise<PaginatedResponse<{ id: number; code: string; name: string }>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.WAVES, { params });
    return response.data;
  },

  // ===== BOX TYPES =====
  getBoxTypes: async (params?: { page_size?: number }): Promise<PaginatedResponse<{ id: number; code: string; name: string }>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.BOX_TYPES, { params });
    return response.data;
  },

  // ===== EXPORT / IMPORT =====
  exportProducts: async (format: 'excel' | 'pdf', params?: QueryParams): Promise<Blob> => {
    const response = await axiosInstance.get(API_ENDPOINTS.EXPORT_PRODUCTS, {
      params: { format, ...params },
      responseType: 'blob',
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      const text = await (response.data as Blob).text();
      let msg = 'Xuất Excel thất bại';
      try {
        const json = JSON.parse(text);
        msg = json.detail || json.error || msg;
      } catch {
        if (text) msg = text.slice(0, 200);
      }
      throw new Error(msg);
    }
    return response.data as Blob;
  },

  downloadTemplate: async (): Promise<Blob> => {
    const response = await axiosInstance.get(API_ENDPOINTS.DOWNLOAD_TEMPLATE, {
      responseType: 'blob',
    });
    if (response.status < 200 || response.status >= 300) {
      const text = await (response.data as Blob).text();
      let msg = 'Tải template thất bại';
      try {
        const json = JSON.parse(text);
        msg = json.detail || json.error || msg;
      } catch {
        if (text) msg = text.slice(0, 200);
      }
      throw new Error(msg);
    }
    return response.data as Blob;
  },

  importProducts: async (file: File, options?: { updateIfExists?: boolean }): Promise<ProductImportResult> => {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.updateIfExists) {
      formData.append('update_if_exists', 'true');
    }
    const response = await axiosInstance.post(API_ENDPOINTS.IMPORT_PRODUCTS, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    const data = response.data as ProductImportResult;
    return {
      ...data,
      total_rows: data.total_rows ?? 0,
      success_count: data.success_count ?? 0,
      error_count: data.error_count ?? 0,
      errors: Array.isArray(data.errors) ? data.errors : [],
    };
  },

  getActivityByEntity: async (entityType: string, entityId: number): Promise<ActivityItem[]> => {
    const response = await axiosInstance.get('/activity/by_entity/', {
      params: { entity_type: entityType, entity_id: entityId },
    });
    return response.data;
  },

  getPriceChanges: async (productId: number): Promise<PriceChangeRecord[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTS}${productId}/price_changes/`);
    return response.data;
  },

  getBundlePriceChanges: async (productId: number): Promise<BundlePriceChangeRecord[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTS}${productId}/bundle_price_changes/`);
    return response.data;
  },

  submitPriceChange: async (
    productId: number,
    data: {
      new_cost_price?: number;
      new_sale_price?: number;
      new_commission_per_unit?: number;
      new_commission_percent?: number;
      reason: string;
      effective_at?: string;
      batch_code?: string;
    }
  ): Promise<PriceChangeRecord> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTS}${productId}/submit_price_change/`, data);
    return response.data;
  },

  approvePriceChange: async (productId: number, changeId: number): Promise<PriceChangeRecord> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTS}${productId}/approve_price_change/`, { change_id: changeId });
    return response.data;
  },

  rejectPriceChange: async (productId: number, changeId: number, rejectReason: string): Promise<PriceChangeRecord> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTS}${productId}/reject_price_change/`, {
      change_id: changeId,
      reject_reason: rejectReason,
    });
    return response.data;
  },

  submitBundlePriceChange: async (
    productId: number,
    data: {
      new_cost_price?: number;
      new_sale_price?: number;
      new_commission_per_unit?: number;
      new_commission_percent?: number;
      reason: string;
      effective_at?: string;
      batch_code?: string;
    }
  ): Promise<BundlePriceChangeRecord> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTS}${productId}/submit_bundle_price_change/`, data);
    return response.data;
  },

  approveBundlePriceChange: async (productId: number, changeId: number): Promise<BundlePriceChangeRecord> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTS}${productId}/approve_bundle_price_change/`, { change_id: changeId });
    return response.data;
  },

  rejectBundlePriceChange: async (productId: number, changeId: number, rejectReason: string): Promise<BundlePriceChangeRecord> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTS}${productId}/reject_bundle_price_change/`, {
      change_id: changeId,
      reject_reason: rejectReason,
    });
    return response.data;
  },

  bulkPricePreview: async (items: BulkPriceChangeItemInput[]): Promise<{ total: number; items: BulkPriceChangePreviewItem[] }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTS}bulk_price_preview/`, { items });
    return response.data;
  },

  bulkPriceSubmit: async (payload: {
    items: BulkPriceChangeItemInput[];
    reason: string;
    effective_at?: string;
    auto_approve?: boolean;
    batch_code?: string;
  }): Promise<BulkPriceChangeSubmitResult> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTS}bulk_price_submit/`, payload);
    return response.data;
  },
};
