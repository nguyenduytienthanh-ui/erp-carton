import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  MaterialPurchasePrice,
  PurchaseForecastRow,
  PaginatedResponse,
  PurchaseApprovalHistoryItem,
  PurchaseOrder,
  CreatePurchaseOrderFromForecastPayload,
  PurchaseOrderFormValues,
  PurchaseReceipt,
  PurchaseRequest,
  PurchaseRequestLine,
  PurchaseReturn,
  PurchaseReturnLine,
  PurchaseWorkflowStateSummary,
  SupplierAnalyticsRow,
  Supplier,
} from '../types/purchasing';


type SupplierPayload = Omit<Supplier, 'id' | 'created_at' | 'updated_at'>;
type PurchaseOrderPayload = Omit<PurchaseOrderFormValues, never>;
type PurchaseReturnPayload = {
  return_date: string;
  supplier: number;
  return_reason: string;
  return_notes: string;
  reference?: string;
  purchase_order?: number | null;
  lines?: Array<Partial<Omit<PurchaseReturnLine, 'id'>>>;
};


export const purchasingApi = {
  getSuppliers: async (params?: Record<string, unknown>): Promise<PaginatedResponse<Supplier>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PURCHASING_SUPPLIERS, { params });
    return response.data;
  },
  createSupplier: async (payload: SupplierPayload): Promise<Supplier> => {
    const response = await axiosInstance.post(API_ENDPOINTS.PURCHASING_SUPPLIERS, payload);
    return response.data;
  },
  updateSupplier: async (id: number, payload: Partial<SupplierPayload>): Promise<Supplier> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.PURCHASING_SUPPLIERS}${id}/`, payload);
    return response.data;
  },
  deleteSupplier: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.PURCHASING_SUPPLIERS}${id}/`);
  },

  getMaterialPrices: async (params?: Record<string, unknown>): Promise<PaginatedResponse<MaterialPurchasePrice>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PURCHASING_MATERIAL_PRICES, { params });
    return response.data;
  },
  createMaterialPrice: async (
    payload: Omit<MaterialPurchasePrice, 'id' | 'created_at' | 'updated_at'>
  ): Promise<MaterialPurchasePrice> => {
    const response = await axiosInstance.post(API_ENDPOINTS.PURCHASING_MATERIAL_PRICES, payload);
    return response.data;
  },
  updateMaterialPrice: async (
    id: number,
    payload: Partial<Omit<MaterialPurchasePrice, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<MaterialPurchasePrice> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.PURCHASING_MATERIAL_PRICES}${id}/`, payload);
    return response.data;
  },
  deleteMaterialPrice: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.PURCHASING_MATERIAL_PRICES}${id}/`);
  },

  getOrders: async (params?: Record<string, unknown>): Promise<PaginatedResponse<PurchaseOrder>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PURCHASING_ORDERS, { params });
    return response.data;
  },
  getOrderSummary: async (params?: Record<string, unknown>): Promise<{
    total_orders: number;
    draft_count: number;
    submitted_count: number;
    approved_count: number;
    partial_received_count: number;
    received_count: number;
    cancelled_count: number;
    pending_approval_count: number;
    waiting_receipt_count: number;
    overdue_receipt_count: number;
    open_value: string;
  }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_ORDERS}summary/`, { params });
    return response.data;
  },
  getOrder: async (id: number): Promise<PurchaseOrder> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_ORDERS}${id}/`);
    return response.data;
  },
  createOrder: async (payload: PurchaseOrderPayload): Promise<PurchaseOrder> => {
    const response = await axiosInstance.post(API_ENDPOINTS.PURCHASING_ORDERS, payload);
    return response.data;
  },
  updateOrder: async (id: number, payload: Partial<PurchaseOrderPayload>): Promise<PurchaseOrder> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.PURCHASING_ORDERS}${id}/`, payload);
    return response.data;
  },
  deleteOrder: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.PURCHASING_ORDERS}${id}/`);
  },
  submitOrder: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_ORDERS}${id}/submit/`);
    return response.data;
  },
  approveOrder: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_ORDERS}${id}/approve/`);
    return response.data;
  },
  rejectOrder: async (id: number, reason: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_ORDERS}${id}/reject/`, { reason });
    return response.data;
  },
  cancelOrder: async (id: number, reason: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_ORDERS}${id}/cancel/`, { reason });
    return response.data;
  },
  receiveOrder: async (
    id: number,
    payload: {
      receipt_date?: string;
      warehouse?: number | null;
      location?: number | null;
      reference?: string;
      reason?: string;
      note?: string;
      items?: Array<{
        purchase_order_line: number;
        quantity?: string;
        unit_cost?: string;
        note?: string;
      }>;
    }
  ): Promise<PurchaseReceipt> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_ORDERS}${id}/receive/`, payload);
    return response.data;
  },
  getOrderReceiptOverview: async (id: number): Promise<{ count: number; results: PurchaseReceipt[] }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_ORDERS}${id}/receipt_overview/`);
    return response.data;
  },
  getOrderApprovalHistory: async (id: number): Promise<PurchaseApprovalHistoryItem[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_ORDERS}${id}/approval_history/`);
    return response.data;
  },
  getPurchaseRequestApprovalHistory: async (id: number): Promise<PurchaseApprovalHistoryItem[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_REQUESTS}${id}/approval_history/`);
    return response.data;
  },
  getOrderNextStates: async (id: number): Promise<{ current: string; next_states: string[] }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_ORDERS}${id}/next_states/`);
    return response.data;
  },

  getReceipts: async (params?: Record<string, unknown>): Promise<PaginatedResponse<PurchaseReceipt>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PURCHASING_RECEIPTS, { params });
    return response.data;
  },
  getReceipt: async (id: number): Promise<PurchaseReceipt> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_RECEIPTS}${id}/`);
    return response.data;
  },
  getReceiptLifecycleHistory: async (id: number): Promise<PurchaseApprovalHistoryItem[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_RECEIPTS}${id}/lifecycle_history/`);
    return response.data;
  },
  getReceiptNextStates: async (id: number): Promise<PurchaseWorkflowStateSummary> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_RECEIPTS}${id}/next_states/`);
    return response.data;
  },
  cancelReceipt: async (id: number, reason: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_RECEIPTS}${id}/cancel/`, { reason });
    return response.data;
  },

  getPurchaseRequests: async (params?: Record<string, unknown>): Promise<PaginatedResponse<PurchaseRequest>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PURCHASING_REQUESTS, { params });
    return response.data;
  },
  getPurchaseRequest: async (id: number): Promise<PurchaseRequest> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_REQUESTS}${id}/`);
    return response.data;
  },
  createPurchaseRequest: async (
    payload: Partial<PurchaseRequest> & { request_date: string; lines?: Partial<PurchaseRequestLine>[] }
  ): Promise<PurchaseRequest> => {
    const response = await axiosInstance.post(API_ENDPOINTS.PURCHASING_REQUESTS, payload);
    return response.data;
  },
  updatePurchaseRequest: async (id: number, payload: Partial<PurchaseRequest>): Promise<PurchaseRequest> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.PURCHASING_REQUESTS}${id}/`, payload);
    return response.data;
  },
  deletePurchaseRequest: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.PURCHASING_REQUESTS}${id}/`);
  },
  submitPurchaseRequest: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_REQUESTS}${id}/submit/`);
    return response.data;
  },
  approvePurchaseRequest: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_REQUESTS}${id}/approve/`);
    return response.data;
  },
  rejectPurchaseRequest: async (id: number, reason?: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_REQUESTS}${id}/reject/`, { reason: reason ?? '' });
    return response.data;
  },

  // Purchase Returns
  getPurchaseReturns: async (params?: Record<string, unknown>): Promise<PaginatedResponse<PurchaseReturn>> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns')}`, { params });
    return response.data;
  },
  getPurchaseReturn: async (id: number): Promise<PurchaseReturn> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns')}${id}/`);
    return response.data;
  },
  createPurchaseReturn: async (payload: PurchaseReturnPayload): Promise<PurchaseReturn> => {
    const response = await axiosInstance.post(API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns'), payload);
    return response.data;
  },
  updatePurchaseReturn: async (id: number, payload: PurchaseReturnPayload): Promise<PurchaseReturn> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns')}${id}/`, payload);
    return response.data;
  },
  deletePurchaseReturn: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns')}${id}/`);
  },
  submitPurchaseReturn: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns')}${id}/submit_return/`);
    return response.data;
  },
  approvePurchaseReturn: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns')}${id}/approve_return/`);
    return response.data;
  },
  postPurchaseReturn: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns')}${id}/post_return/`);
    return response.data;
  },
  cancelPurchaseReturn: async (id: number, reason?: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns')}${id}/cancel_return/`, { reason: reason ?? '' });
    return response.data;
  },
  getPurchaseReturnApprovalHistory: async (id: number): Promise<PurchaseApprovalHistoryItem[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns')}${id}/approval_history/`);
    return response.data;
  },
  getPurchaseReturnLifecycleHistory: async (id: number): Promise<PurchaseApprovalHistoryItem[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns')}${id}/lifecycle_history/`);
    return response.data;
  },
  getPurchaseReturnNextStates: async (id: number): Promise<PurchaseWorkflowStateSummary> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_ORDERS.replace('orders', 'returns')}${id}/next_states/`);
    return response.data;
  },

  getPurchaseOrderForecast: async (params?: { lead_time?: number; months?: number }): Promise<PurchaseForecastRow[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PURCHASING_FORECAST}forecast/`, { params });
    return Array.isArray(response.data) ? response.data : response.data?.results ?? [];
  },
  createPurchaseOrderFromForecast: async (payload: CreatePurchaseOrderFromForecastPayload): Promise<PurchaseOrder> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PURCHASING_FORECAST}create_po_from_forecast/`, payload);
    return response.data;
  },
  getSupplierAnalytics: async (): Promise<SupplierAnalyticsRow[]> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PURCHASING_SUPPLIER_ANALYTICS);
    return Array.isArray(response.data) ? response.data : response.data?.results ?? [];
  },
};

export const suppliersApi = {
  getSuppliers: purchasingApi.getSuppliers,
  createSupplier: purchasingApi.createSupplier,
  updateSupplier: purchasingApi.updateSupplier,
  deleteSupplier: purchasingApi.deleteSupplier,
};
