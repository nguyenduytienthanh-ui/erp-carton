import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type { PaginatedResponse } from '../types/sales';
import type { OutboundShipment } from '../types/shipments';

const SALES_SHIPMENTS = API_ENDPOINTS.SALES_SHIPMENTS;

type ShipmentPayload = Record<string, unknown>;
type ShipmentActionResponse = Record<string, unknown>;

export const shipmentsApi = {
  getShipments: async (params?: Record<string, unknown>): Promise<PaginatedResponse<OutboundShipment>> => {
    const response = await axiosInstance.get<PaginatedResponse<OutboundShipment>>(SALES_SHIPMENTS, { params });
    return response.data;
  },

  getShipment: async (id: number): Promise<OutboundShipment> => {
    const response = await axiosInstance.get<OutboundShipment>(`${SALES_SHIPMENTS}${id}/`);
    return response.data;
  },

  createShipment: async (data: ShipmentPayload): Promise<OutboundShipment> => {
    const response = await axiosInstance.post<OutboundShipment>(SALES_SHIPMENTS, data);
    return response.data;
  },

  updateShipment: async (id: number, data: ShipmentPayload): Promise<OutboundShipment> => {
    const response = await axiosInstance.put<OutboundShipment>(`${SALES_SHIPMENTS}${id}/`, data);
    return response.data;
  },

  deleteShipment: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.delete<{ status: string }>(`${SALES_SHIPMENTS}${id}/`);
    return response.data;
  },

  submitShipment: async (id: number): Promise<ShipmentActionResponse> => {
    const response = await axiosInstance.post<ShipmentActionResponse>(`${SALES_SHIPMENTS}${id}/submit_shipment/`);
    return response.data;
  },

  approveShipment: async (id: number): Promise<ShipmentActionResponse> => {
    const response = await axiosInstance.post<ShipmentActionResponse>(`${SALES_SHIPMENTS}${id}/approve_shipment/`);
    return response.data;
  },

  packShipment: async (id: number): Promise<ShipmentActionResponse> => {
    const response = await axiosInstance.post<ShipmentActionResponse>(`${SALES_SHIPMENTS}${id}/pack_shipment/`);
    return response.data;
  },

  sendShipment: async (id: number): Promise<ShipmentActionResponse> => {
    const response = await axiosInstance.post<ShipmentActionResponse>(`${SALES_SHIPMENTS}${id}/send_shipment/`);
    return response.data;
  },

  confirmDelivery: async (id: number, data: ShipmentPayload): Promise<ShipmentActionResponse> => {
    const response = await axiosInstance.post<ShipmentActionResponse>(`${SALES_SHIPMENTS}${id}/confirm_delivery/`, data);
    return response.data;
  },

  cancelShipment: async (id: number): Promise<ShipmentActionResponse> => {
    const response = await axiosInstance.post<ShipmentActionResponse>(`${SALES_SHIPMENTS}${id}/cancel_shipment/`);
    return response.data;
  },
};
