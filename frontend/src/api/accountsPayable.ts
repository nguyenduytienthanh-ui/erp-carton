import { axiosInstance } from './config';
import { PaginatedResponse } from '../types/common';

export const accountsPayableApi = {
  // Lấy danh sách công nợ phải trả
  getPayables: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const response = await axiosInstance.get('api/finance/payables/', { params });
    return response.data;
  },

  // Lấy chi tiết một công nợ
  getPayable: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`api/finance/payables/${id}/`);
    return response.data;
  },

  // Tạo công nợ mới
  createPayable: async (data: any): Promise<any> => {
    const response = await axiosInstance.post('api/finance/payables/', data);
    return response.data;
  },

  // Cập nhật công nợ
  updatePayable: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.put(`api/finance/payables/${id}/`, data);
    return response.data;
  },

  // Xóa công nợ
  deletePayable: async (id: number): Promise<any> => {
    const response = await axiosInstance.delete(`api/finance/payables/${id}/`);
    return response.data;
  },

  // Ghi nhận thanh toán
  recordPayment: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.post(`api/finance/payables/${id}/record_payment/`, data);
    return response.data;
  },

  // Hủy công nợ
  cancelPayable: async (id: number, reason: string): Promise<any> => {
    const response = await axiosInstance.post(`api/finance/payables/${id}/cancel/`, { reason });
    return response.data;
  },

  // Lấy danh sách thanh toán cho công nợ
  getPayments: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`api/finance/payables/${id}/settlements/`);
    return response.data;
  },
};
