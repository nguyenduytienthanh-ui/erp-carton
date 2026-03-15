import { axiosInstance } from './config';
import { PaginatedResponse } from '../types/common';

export const accountsReceivableApi = {
  // Lấy danh sách công nợ phải thu
  getReceivables: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const response = await axiosInstance.get('api/finance/receivables/', { params });
    return response.data;
  },

  // Lấy chi tiết một công nợ
  getReceivable: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`api/finance/receivables/${id}/`);
    return response.data;
  },

  // Tạo công nợ mới
  createReceivable: async (data: any): Promise<any> => {
    const response = await axiosInstance.post('api/finance/receivables/', data);
    return response.data;
  },

  // Cập nhật công nợ
  updateReceivable: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.put(`api/finance/receivables/${id}/`, data);
    return response.data;
  },

  // Xóa công nợ
  deleteReceivable: async (id: number): Promise<any> => {
    const response = await axiosInstance.delete(`api/finance/receivables/${id}/`);
    return response.data;
  },

  // Ghi nhận thanh toán
  receivePayment: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.post(`api/finance/receivables/${id}/receive_payment/`, data);
    return response.data;
  },

  // Hủy công nợ
  cancelReceivable: async (id: number, reason: string): Promise<any> => {
    const response = await axiosInstance.post(`api/finance/receivables/${id}/cancel/`, { reason });
    return response.data;
  },

  // Lấy danh sách thanh toán cho công nợ
  getPayments: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`api/finance/receivables/${id}/settlements/`);
    return response.data;
  },
};
