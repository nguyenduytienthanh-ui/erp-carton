import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  ProductionBulkUpdateResponse,
  PaginatedResponse,
  ProductionApprovalHistoryItem,
  ProductionDemand,
  ProductionDemandQueryParams,
  ProductionDemandSummary,
  ProductionOperation,
  ProductionOrderSummary,
  ProductionIssue,
  ProductionOrder,
  ProductionOrderFormValues,
  ProductionPlanningBoardResponse,
  ProductionPlanningBulkPreviewResponse,
  ProductionPlanningPreviewResponse,
  ProductionReceipt,
  ProductionReceiptScanResponse,
  ProductionWorkflowStateSummary,
} from '../types/production';


type ProductionOrderPayload = Omit<ProductionOrderFormValues, never>;


export const productionApi = {
  getDemands: async (params?: ProductionDemandQueryParams): Promise<PaginatedResponse<ProductionDemand>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.PRODUCTION_DEMANDS, { params });
    return response.data;
  },
  getDemand: async (id: number): Promise<ProductionDemand> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_DEMANDS}${id}/`);
    return response.data;
  },
  getDemandSummary: async (params?: ProductionDemandQueryParams): Promise<ProductionDemandSummary> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_DEMANDS}summary/`, { params });
    return response.data;
  },
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
  getOrderSummary: async (params?: Record<string, unknown>): Promise<ProductionOrderSummary> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_ORDERS}summary/`, { params });
    return response.data;
  },
  getPlanningBoard: async (params?: Record<string, unknown>): Promise<ProductionPlanningBoardResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.PRODUCTION_ORDERS}planning_board/`, { params });
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
      planned_date?: string | null;
      planned_shift?: string;
      priority_rank?: number | string | null;
      dispatch_sequence?: number | string | null;
      work_center_code?: string;
      work_center_name?: string;
      machine_code?: string;
      machine_name?: string;
      estimated_runtime_hours?: number | string | null;
      setup_minutes?: number | string | null;
      block_reason_code?: string;
      block_reason_note?: string;
      note?: string;
    }
  ): Promise<{
    order_status: string;
    operation: ProductionOperation;
  }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/update_operation/`, payload);
    return response.data;
  },
  previewOperationUpdate: async (
    id: number,
    payload: {
      operation_id: number;
      status?: string;
      completed_qty?: string;
      scrap_qty?: string;
      planned_date?: string | null;
      planned_shift?: string;
      priority_rank?: number | string | null;
      dispatch_sequence?: number | string | null;
      work_center_code?: string;
      work_center_name?: string;
      machine_code?: string;
      machine_name?: string;
      estimated_runtime_hours?: number | string | null;
      setup_minutes?: number | string | null;
      block_reason_code?: string;
      block_reason_note?: string;
      note?: string;
    }
  ): Promise<ProductionPlanningPreviewResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}${id}/preview_operation_update/`, payload);
    return response.data;
  },
  previewBulkUpdateOperations: async (
    payload: {
      items: Array<{ order_id: number; operation_id: number }>;
      changes: {
        status?: string;
        completed_qty?: string;
        scrap_qty?: string;
        planned_date?: string | null;
        planned_shift?: string;
        priority_rank?: number | string | null;
        dispatch_sequence?: number | string | null;
        work_center_code?: string;
        work_center_name?: string;
        machine_code?: string;
        machine_name?: string;
        estimated_runtime_hours?: number | string | null;
        setup_minutes?: number | string | null;
        block_reason_code?: string;
        block_reason_note?: string;
        note?: string;
      };
    }
  ): Promise<ProductionPlanningBulkPreviewResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}preview_bulk_update_operations/`, payload);
    return response.data;
  },
  previewRebalanceSuggestions: async (
    payload: {
      items: Array<{
        order_id: number;
        operation_id: number;
        suggestion_key?: string;
        suggestion_kind?: string;
        suggestion_title?: string;
        severity?: string;
        suggested_changes: {
          status?: string;
          completed_qty?: string;
          scrap_qty?: string;
          planned_date?: string | null;
          planned_shift?: string;
          priority_rank?: number | string | null;
          dispatch_sequence?: number | string | null;
          work_center_code?: string;
          work_center_name?: string;
          machine_code?: string;
          machine_name?: string;
          estimated_runtime_hours?: number | string | null;
          setup_minutes?: number | string | null;
          block_reason_code?: string;
          block_reason_note?: string;
          note?: string;
        };
      }>;
    }
  ): Promise<ProductionPlanningBulkPreviewResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}preview_rebalance_suggestions/`, payload);
    return response.data;
  },
  bulkUpdateOperations: async (
    payload: {
      items: Array<{ order_id: number; operation_id: number }>;
      changes: {
        status?: string;
        completed_qty?: string;
        scrap_qty?: string;
        planned_date?: string | null;
        planned_shift?: string;
        priority_rank?: number | string | null;
        dispatch_sequence?: number | string | null;
        work_center_code?: string;
        work_center_name?: string;
        machine_code?: string;
        machine_name?: string;
        estimated_runtime_hours?: number | string | null;
        setup_minutes?: number | string | null;
        block_reason_code?: string;
        block_reason_note?: string;
        note?: string;
      };
    }
  ): Promise<ProductionBulkUpdateResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}bulk_update_operations/`, payload);
    return response.data;
  },
  applyRebalanceSuggestions: async (
    payload: {
      items: Array<{
        order_id: number;
        operation_id: number;
        suggestion_key?: string;
        suggestion_kind?: string;
        suggestion_title?: string;
        severity?: string;
        suggested_changes: {
          status?: string;
          completed_qty?: string;
          scrap_qty?: string;
          planned_date?: string | null;
          planned_shift?: string;
          priority_rank?: number | string | null;
          dispatch_sequence?: number | string | null;
          work_center_code?: string;
          work_center_name?: string;
          machine_code?: string;
          machine_name?: string;
          estimated_runtime_hours?: number | string | null;
          setup_minutes?: number | string | null;
          block_reason_code?: string;
          block_reason_note?: string;
          note?: string;
        };
      }>;
    }
  ): Promise<ProductionBulkUpdateResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}apply_rebalance_suggestions/`, payload);
    return response.data;
  },
  shopFloorSignal: async (
    payload: {
      items: Array<{ order_id: number; operation_id: number }>;
      signal_code: string;
      note?: string;
      dispatch_owner?: string;
      status?: string;
      handover_status?: string;
    }
  ): Promise<ProductionBulkUpdateResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}shop_floor_signal/`, payload);
    return response.data;
  },
  shopFloorHandover: async (
    payload: {
      items: Array<{ order_id: number; operation_id: number }>;
      handover_status: string;
      dispatch_owner?: string;
      handover_receiver?: string;
      handover_note?: string;
      clear_previous_wait?: boolean;
      set_ready?: boolean;
    }
  ): Promise<ProductionBulkUpdateResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_ORDERS}shop_floor_handover/`, payload);
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
      quantity?: string;
      unit_cost?: string;
      bundle_count?: number;
      units_per_bundle?: string;
      pallet_count?: number;
      bundles_per_pallet?: string;
      items?: Array<{
        product?: number;
        quantity?: string;
        unit_cost?: string;
        bundle_count?: number;
        units_per_bundle?: string;
        pallet_count?: number;
        bundles_per_pallet?: string;
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
  scanReceiptQr: async (id: number, payload: { scan_value: string }): Promise<ProductionReceiptScanResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.PRODUCTION_RECEIPTS}${id}/scan_receipt_qr/`, payload);
    return response.data;
  },
};
