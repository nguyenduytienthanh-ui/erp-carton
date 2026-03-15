import { axiosInstance, API_ENDPOINTS } from './config';
import { PaginatedResponse } from '../types/common';

export const shipmentsApi = {
  // CRUD
  getShipments: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const response = await axiosInstance.get('api/sales/shipments/', { params });
    return response.data;
  },

  getShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`api/sales/shipments/${id}/`);
    return response.data;
  },

  createShipment: async (data: any): Promise<any> => {
    const response = await axiosInstance.post('api/sales/shipments/', data);
    return response.data;
  },

  updateShipment: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.put(`api/sales/shipments/${id}/`, data);
    return response.data;
  },

  deleteShipment: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.delete(`api/sales/shipments/${id}/`);
    return response.data;
  },

  // Workflow actions
  submitShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`api/sales/shipments/${id}/submit_shipment/`);
    return response.data;
  },

  approveShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`api/sales/shipments/${id}/approve_shipment/`);
    return response.data;
  },

  packShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`api/sales/shipments/${id}/pack_shipment/`);
    return response.data;
  },

  sendShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`api/sales/shipments/${id}/send_shipment/`);
    return response.data;
  },

  confirmDelivery: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.post(`api/sales/shipments/${id}/confirm_delivery/`, data);
    return response.data;
  },

  cancelShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`api/sales/shipments/${id}/cancel_shipment/`);
    return response.data;
  },
};
