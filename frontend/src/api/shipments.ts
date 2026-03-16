import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type { PaginatedResponse } from '../types/sales';

const SALES_SHIPMENTS = API_ENDPOINTS.SALES_SHIPMENTS;

export const shipmentsApi = {
  getShipments: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const response = await axiosInstance.get(SALES_SHIPMENTS, { params });
    return response.data;
  },

  getShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`${SALES_SHIPMENTS}${id}/`);
    return response.data;
  },

  createShipment: async (data: any): Promise<any> => {
    const response = await axiosInstance.post(SALES_SHIPMENTS, data);
    return response.data;
  },

  updateShipment: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.put(`${SALES_SHIPMENTS}${id}/`, data);
    return response.data;
  },

  deleteShipment: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.delete(`${SALES_SHIPMENTS}${id}/`);
    return response.data;
  },

  submitShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`${SALES_SHIPMENTS}${id}/submit_shipment/`);
    return response.data;
  },

  approveShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`${SALES_SHIPMENTS}${id}/approve_shipment/`);
    return response.data;
  },

  packShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`${SALES_SHIPMENTS}${id}/pack_shipment/`);
    return response.data;
  },

  sendShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`${SALES_SHIPMENTS}${id}/send_shipment/`);
    return response.data;
  },

  confirmDelivery: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.post(`${SALES_SHIPMENTS}${id}/confirm_delivery/`, data);
    return response.data;
  },

  cancelShipment: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`${SALES_SHIPMENTS}${id}/cancel_shipment/`);
    return response.data;
  },
};
