import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  Customer,
  CustomerFormData,
  PaginatedResponse,
  ApprovalHistoryItem,
} from '../types/customer';

export interface ActivityItem {
  type: 'audit' | 'comment';
  action: string;
  user: string | null;
  timestamp: string;
  details?: {
    old_values?: Record<string, unknown> | null;
    new_values?: Record<string, unknown> | null;
    changed_fields?: string[];
    content?: string;
    mentions?: string[];
  };
}

export const customersApi = {
  getCustomers: async (params?: Record<string, unknown>): Promise<PaginatedResponse<Customer>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.CUSTOMERS, { params });
    return response.data;
  },

  getCustomer: async (id: number): Promise<Customer> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.CUSTOMERS}${id}/`);
    return response.data;
  },

  createCustomer: async (data: CustomerFormData): Promise<Customer> => {
    const response = await axiosInstance.post(API_ENDPOINTS.CUSTOMERS, data);
    return response.data;
  },

  updateCustomer: async (id: number, data: Partial<CustomerFormData>): Promise<Customer> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.CUSTOMERS}${id}/`, data);
    return response.data;
  },

  deleteCustomer: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.CUSTOMERS}${id}/`);
  },

  bulkDelete: async (ids: number[]): Promise<{ success: boolean; count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.CUSTOMERS}bulk_delete/`, { ids });
    return response.data;
  },

  bulkActivate: async (ids: number[], isActive: boolean): Promise<{ success: boolean; count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.CUSTOMERS}bulk_activate/`, {
      ids,
      is_active: isActive,
    });
    return response.data;
  },

  submitForApproval: async (id: number): Promise<{ success: boolean; status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.CUSTOMERS}${id}/submit_for_approval/`);
    return response.data;
  },

  approve: async (id: number): Promise<{ success: boolean; status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.CUSTOMERS}${id}/approve/`);
    return response.data;
  },

  reject: async (id: number, reason: string): Promise<{ success: boolean; status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.CUSTOMERS}${id}/reject/`, { reason });
    return response.data;
  },

  getApprovalHistory: async (id: number): Promise<ApprovalHistoryItem[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.CUSTOMERS}${id}/approval_history/`);
    return response.data;
  },

  getActivityByEntity: async (entityType: string, entityId: number): Promise<ActivityItem[]> => {
    const response = await axiosInstance.get('/activity/by_entity/', {
      params: { entity_type: entityType, entity_id: entityId },
    });
    return response.data;
  },

  /** Export Excel/PDF theo chuẩn export_data (ExportExcelMixin + ExportTemplate) */
  exportCustomers: async (format: 'excel' | 'pdf', params?: Record<string, unknown>): Promise<Blob> => {
    const q = { format: format === 'pdf' ? 'pdf' : 'excel', ...params };
    const response = await axiosInstance.get(API_ENDPOINTS.EXPORT_CUSTOMERS, {
      params: q,
      responseType: 'blob',
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      const text = await (response.data as Blob).text();
      let msg = format === 'pdf' ? 'Xuất PDF thất bại' : 'Xuất Excel thất bại';
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
    const response = await axiosInstance.get(API_ENDPOINTS.DOWNLOAD_CUSTOMER_TEMPLATE, {
      responseType: 'blob',
      validateStatus: () => true,
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

  /** Import Excel theo format chuẩn: { total_rows, success_count, error_count, errors:[{row, error}], log_id } */
  importCustomers: async (file: File, options?: { updateIfExists?: boolean }): Promise<{
    total_rows: number;
    success_count: number;
    error_count: number;
    errors: Array<{ row?: number; error?: string } | string>;
    log_id?: number;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.updateIfExists) {
      formData.append('update_if_exists', 'true');
    }
    const response = await axiosInstance.post(API_ENDPOINTS.IMPORT_CUSTOMERS, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    const data = response.data;
    const errors = data.errors || [];
    const totalRows = data.total_rows ?? data.total ?? 0;
    const successCount = data.success_count ?? data.imported ?? data.success ?? 0;
    const errorCount = data.error_count ?? errors.length;
    return {
      total_rows: totalRows,
      success_count: successCount,
      error_count: errorCount,
      errors: errors.map((e: { row?: number; error?: string }) =>
        typeof e === 'object' && e !== null
          ? (e.row ? `Dòng ${e.row}: ${e.error || ''}` : String(e.error || ''))
          : String(e)
      ),
      log_id: data.log_id,
    };
  },
};
