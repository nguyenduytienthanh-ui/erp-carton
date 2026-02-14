import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  Product,
  ProductCategory,
  ProductUnit,
  PaginatedResponse,
  ProductFormData,
} from '../types/product';

export const productsApi = {
  // ===== PRODUCTS CRUD =====
  getProducts: async (params?: any): Promise<PaginatedResponse<Product>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PRODUCTS, { params });
    return response.data;
  },

  getProduct: async (id: number): Promise<Product> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTS}${id}/`);
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

  // ===== CATEGORIES =====
  getCategories: async (params?: any): Promise<PaginatedResponse<ProductCategory>> => {
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
  getUnits: async (params?: any): Promise<PaginatedResponse<ProductUnit>> => {
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
  exportProducts: async (format: 'excel' | 'pdf', params?: any): Promise<Blob> => {
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

  importProducts: async (file: File, options?: { updateIfExists?: boolean }): Promise<any> => {
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
    return response.data;
  },
};
