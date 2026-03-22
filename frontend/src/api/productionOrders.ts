import axiosInstance from './axios';
import type { PaginatedResponse } from '../types/production';
import type {
  ProductionIssue,
  ProductionOrder,
} from '../types/productionOrders';

type ProductionOrderPayload = Partial<ProductionOrder> & Record<string, unknown>;
type ProductionIssuePayload = Partial<ProductionIssue> & Record<string, unknown>;
type ActionResponse = Record<string, unknown>;

export const productionOrdersApi = {
  getOrders: async (params?: Record<string, unknown>): Promise<PaginatedResponse<ProductionOrder>> => {
    const response = await axiosInstance.get<PaginatedResponse<ProductionOrder>>('api/production/orders/', { params });
    return response.data;
  },

  getOrder: async (id: number): Promise<ProductionOrder> => {
    const response = await axiosInstance.get<ProductionOrder>(`api/production/orders/${id}/`);
    return response.data;
  },

  createOrder: async (data: ProductionOrderPayload): Promise<ProductionOrder> => {
    const response = await axiosInstance.post<ProductionOrder>('api/production/orders/', data);
    return response.data;
  },

  updateOrder: async (id: number, data: ProductionOrderPayload): Promise<ProductionOrder> => {
    const response = await axiosInstance.put<ProductionOrder>(`api/production/orders/${id}/`, data);
    return response.data;
  },

  deleteOrder: async (id: number): Promise<ActionResponse> => {
    const response = await axiosInstance.delete<ActionResponse>(`api/production/orders/${id}/`);
    return response.data;
  },

  startProduction: async (id: number): Promise<ActionResponse> => {
    const response = await axiosInstance.post<ActionResponse>(`api/production/orders/${id}/start_production/`);
    return response.data;
  },

  completeProduction: async (id: number, data: Record<string, unknown>): Promise<ActionResponse> => {
    const response = await axiosInstance.post<ActionResponse>(`api/production/orders/${id}/complete_production/`, data);
    return response.data;
  },

  cancelOrder: async (id: number, reason: string): Promise<ActionResponse> => {
    const response = await axiosInstance.post<ActionResponse>(`api/production/orders/${id}/cancel/`, { reason });
    return response.data;
  },

  issueMaterials: async (_id: number, data: ProductionIssuePayload): Promise<ProductionIssue> => {
    const response = await axiosInstance.post<ProductionIssue>('api/production/issues/', data);
    return response.data;
  },

  getIssues: async (params?: Record<string, unknown>): Promise<PaginatedResponse<ProductionIssue>> => {
    const response = await axiosInstance.get<PaginatedResponse<ProductionIssue>>('api/production/issues/', { params });
    return response.data;
  },
};
