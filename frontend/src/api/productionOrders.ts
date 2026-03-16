import axiosInstance from './axios';
import type { PaginatedResponse } from '../types/production';

export const productionOrdersApi = {
  // Lấy danh sách lệnh sản xuất
  getOrders: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const response = await axiosInstance.get('api/production/orders/', { params });
    return response.data;
  },

  // Lấy chi tiết lệnh sản xuất
  getOrder: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`api/production/orders/${id}/`);
    return response.data;
  },

  // Tạo lệnh sản xuất mới
  createOrder: async (data: any): Promise<any> => {
    const response = await axiosInstance.post('api/production/orders/', data);
    return response.data;
  },

  // Cập nhật lệnh sản xuất
  updateOrder: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.put(`api/production/orders/${id}/`, data);
    return response.data;
  },

  // Xóa lệnh sản xuất
  deleteOrder: async (id: number): Promise<any> => {
    const response = await axiosInstance.delete(`api/production/orders/${id}/`);
    return response.data;
  },

  // Bắt đầu sản xuất
  startProduction: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`api/production/orders/${id}/start_production/`);
    return response.data;
  },

  // Hoàn thành sản xuất
  completeProduction: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.post(`api/production/orders/${id}/complete_production/`, data);
    return response.data;
  },

  // Hủy lệnh sản xuất
  cancelOrder: async (id: number, reason: string): Promise<any> => {
    const response = await axiosInstance.post(`api/production/orders/${id}/cancel/`, { reason });
    return response.data;
  },

  // Phát hành nguyên vật liệu
  issueMaterials: async (_id: number, data: any): Promise<any> => {
    const response = await axiosInstance.post(`api/production/issues/`, data);
    return response.data;
  },

  // Lấy danh sách phát hành nguyên vật liệu
  getIssues: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const response = await axiosInstance.get('api/production/issues/', { params });
    return response.data;
  },
};
