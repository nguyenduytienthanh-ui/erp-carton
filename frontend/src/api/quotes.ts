import { axiosInstance } from './config';
import { PaginatedResponse } from '../types/common';

export const quotesApi = {
  // Lấy danh sách báo giá
  getQuotes: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const response = await axiosInstance.get('api/sales/quotes/', { params });
    return response.data;
  },

  // Lấy chi tiết báo giá
  getQuote: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`api/sales/quotes/${id}/`);
    return response.data;
  },

  // Tạo báo giá mới
  createQuote: async (data: any): Promise<any> => {
    const response = await axiosInstance.post('api/sales/quotes/', data);
    return response.data;
  },

  // Cập nhật báo giá
  updateQuote: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.put(`api/sales/quotes/${id}/`, data);
    return response.data;
  },

  // Xóa báo giá
  deleteQuote: async (id: number): Promise<any> => {
    const response = await axiosInstance.delete(`api/sales/quotes/${id}/`);
    return response.data;
  },

  // Gửi báo giá cho khách (để chờ)
  submitQuote: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`api/sales/quotes/${id}/submit/`);
    return response.data;
  },

  // Chuyển báo giá thành đơn bán
  convertToOrder: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`api/sales/quotes/${id}/convert_to_order/`);
    return response.data;
  },

  // Từ chối báo giá
  rejectQuote: async (id: number, reason: string): Promise<any> => {
    const response = await axiosInstance.post(`api/sales/quotes/${id}/reject/`, { reason });
    return response.data;
  },

  // Xuất PDF
  getPdf: async (id: number): Promise<Blob> => {
    const response = await axiosInstance.get(`api/sales/quotes/${id}/quote_pdf/`, { responseType: 'blob' });
    return response.data;
  },
};
