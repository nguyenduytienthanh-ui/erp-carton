import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  PaginatedResponse,
  ProductionApprovalHistoryItem,
  ProductionIssue,
  ProductionOrder,
  ProductionOrderFormValues,
  ProductionReceipt,
  ProductionWorkflowStateSummary,
} from '../types/production';


type ProductionOrderPayload = Omit<ProductionOrderFormValues, never>;


export const productionApi = {
  getOrders: async (params?: Record<string, unknown>): Promise<PaginatedResponse<ProductionOrder>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PRODUCTION_ORDERS, { params });
    return response.data;
  },
  getIssues: async (params?: Record<string, unknown>): Promise<PaginatedResponse<ProductionIssue>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PRODUCTION_ISSUES, { params });
    return response.data;
  },
  getReceipts: async (params?: Record<string, unknown>): Promise<PaginatedResponse<ProductionReceipt>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PRODUCTION_RECEIPTS, { params });
    return response.data;
  },
  getReceipt: async (id: number): Promise<ProductionReceipt> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_RECEIPTS}${id}/`);
    return response.data;
  },
  getIssue: async (id: number): Promise<ProductionIssue> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_ISSUES}${id}/`);
    return response.data;
  },
  getOrderSummary: async (params?: Record<string, unknown>): Promise<{
    total_orders: number;
    draft_count: number;
    submitted_count: number;
    approved_count: number;
    released_count: number;
    in_progress_count: number;
    completed_count: number;
    cancelled_count: number;
    pending_approval_count: number;
    active_count: number;
    overdue_plan_count: number;
    active_remaining_qty: string;
    ready_operation_count: number;
  }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_ORDERS}summary/`, { params });
    return response.data;
  },
  getOrder: async (id: number): Promise<ProductionOrder> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/`);
    return response.data;
  },
  createOrder: async (payload: ProductionOrderPayload): Promise<ProductionOrder> => {
    const response = await axiosInstance.post(API_ENDPOINTS.PRODUCTION_ORDERS, payload);
    return response.data;
  },
  updateOrder: async (id: number, payload: Partial<ProductionOrderPayload>): Promise<ProductionOrder> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/`, payload);
    return response.data;
  },
  deleteOrder: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/`);
  },
  submitOrder: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/submit/`);
    return response.data;
  },
  approveOrder: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/approve/`);
    return response.data;
  },
  rejectOrder: async (id: number, reason: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/reject/`, { reason });
    return response.data;
  },
  releaseOrder: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/release/`);
    return response.data;
  },
  cancelOrder: async (id: number, reason: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/cancel/`, { reason });
    return response.data;
  },
  updateOperation: async (
    id: number,
    payload: {
      operation_id: number;
      status?: string;
      completed_qty?: string;
      scrap_qty?: string;
      note?: string;
    }
  ): Promise<{
    order_status: string;
    operation: {
      id: number;
      status: string;
      completed_qty: string;
      scrap_qty: string;
      started_at?: string | null;
      finished_at?: string | null;
      note?: string;
    };
  }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/update_operation/`, payload);
    return response.data;
  },
  issueMaterials: async (
    id: number,
    payload: {
      issue_date?: string;
      reference?: string;
      reason?: string;
      note?: string;
      items?: Array<{
        material_requirement: number;
        warehouse?: number | null;
        location?: number | null;
        quantity?: string;
        unit_cost?: string;
        note?: string;
      }>;
    }
  ): Promise<ProductionIssue> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/issue_materials/`, payload);
    return response.data;
  },
  receiveOutput: async (
    id: number,
    payload: {
      receipt_date?: string;
      warehouse?: number | null;
      location?: number | null;
      reference?: string;
      reason?: string;
      note?: string;
      items?: Array<{
        product?: number;
        quantity?: string;
        unit_cost?: string;
        note?: string;
      }>;
    }
  ): Promise<ProductionReceipt> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/receive_output/`, payload);
    return response.data;
  },
  getOrderIssueOverview: async (id: number): Promise<{ count: number; results: ProductionIssue[] }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/issue_overview/`);
    return response.data;
  },
  getOrderReceiptOverview: async (id: number): Promise<{ count: number; results: ProductionReceipt[] }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/receipt_overview/`);
    return response.data;
  },
  getOrderApprovalHistory: async (id: number): Promise<ProductionApprovalHistoryItem[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/approval_history/`);
    return response.data;
  },
  getOrderNextStates: async (id: number): Promise<ProductionWorkflowStateSummary> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/next_states/`);
    return response.data;
  },
  getIssueLifecycleHistory: async (id: number): Promise<ProductionApprovalHistoryItem[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_ISSUES}${id}/lifecycle_history/`);
    return response.data;
  },
  getIssueNextStates: async (id: number): Promise<ProductionWorkflowStateSummary> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_ISSUES}${id}/next_states/`);
    return response.data;
  },
  getReceiptLifecycleHistory: async (id: number): Promise<ProductionApprovalHistoryItem[]> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_RECEIPTS}${id}/lifecycle_history/`);
    return response.data;
  },
  getReceiptNextStates: async (id: number): Promise<ProductionWorkflowStateSummary> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_RECEIPTS}${id}/next_states/`);
    return response.data;
  },
  cancelIssue: async (id: number, reason: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ISSUES}${id}/cancel/`, { reason });
    return response.data;
  },
  cancelReceipt: async (id: number, reason: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_RECEIPTS}${id}/cancel/`, { reason });
    return response.data;
  },
};
