import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  PaginatedResponse,
  Quote,
  QuoteLine,
  SalesOrder,
  SalesOrderDeliveryOverviewItem,
  SalesOrderFormValues,
  SalesOrderReservationOverviewItem,
  SalesOrderShipmentDetail,
  ShipmentPackageOverviewResponse,
  ShipmentPackageLoadResponse,
  ShipmentLoadingConfirmationResponse,
  ShipmentDeliveryConfirmationResponse,
  ShipmentPackageScanResponse,
  SalesOrderShipmentOverviewItem,
} from '../types/sales';

type SalesOrderPayload = Omit<SalesOrderFormValues, never>;

export const salesApi = {
  getOrders: async (params?: Record<string, unknown>): Promise<PaginatedResponse<SalesOrder>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.SALES_ORDERS, { params });
    return response.data;
  },
  getOrderSummary: async (params?: Record<string, unknown>): Promise<{
    total_orders: number;
    draft_count: number;
    submitted_count: number;
    approved_count: number;
    posted_count: number;
    void_count: number;
    pending_approval_count: number;
    overdue_delivery_count: number;
    due_today_count: number;
    due_soon_count: number;
    posted_total: string;
  }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}summary/`, { params });
    return response.data;
  },
  getOrder: async (id: number): Promise<SalesOrder> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/`);
    return response.data;
  },
  createOrder: async (payload: SalesOrderPayload): Promise<SalesOrder> => {
    const response = await axiosInstance.post(API_ENDPOINTS.SALES_ORDERS, payload);
    return response.data;
  },
  updateOrder: async (id: number, payload: Partial<SalesOrderPayload>): Promise<SalesOrder> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.SALES_ORDERS}${id}/`, payload);
    return response.data;
  },
  deleteOrder: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.SALES_ORDERS}${id}/`);
  },
  submitOrder: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/submit/`);
    return response.data;
  },
  approveOrder: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/approve/`);
    return response.data;
  },
  rejectOrder: async (id: number, reason: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/reject/`, { reason });
    return response.data;
  },
  confirmOrder: async (id: number): Promise<{ status: string; confirmed_at?: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/confirm_order/`);
    return response.data;
  },
  postOrder: async (id: number): Promise<{ status: string; post_number?: string; message?: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/post_document/`);
    return response.data;
  },
  voidOrder: async (id: number, void_reason: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/void/`, { void_reason });
    return response.data;
  },
  getDeliveryOverview: async (id: number): Promise<{ count: number; results: SalesOrderDeliveryOverviewItem[] }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/delivery_overview/`);
    return response.data;
  },
  getReservationOverview: async (id: number): Promise<{ count: number; results: SalesOrderReservationOverviewItem[] }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/reservation_overview/`);
    return response.data;
  },
  getShipmentOverview: async (id: number): Promise<{ count: number; results: SalesOrderShipmentOverviewItem[] }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/shipment_overview/`);
    return response.data;
  },
  getShipmentDetail: async (id: number, shipmentId: number): Promise<SalesOrderShipmentDetail> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/shipment_detail/`, {
      params: { shipment_id: shipmentId },
    });
    return response.data;
  },
  getShipmentPackageOverview: async (
    id: number,
    shipmentId: number
  ): Promise<ShipmentPackageOverviewResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/shipment_package_overview/`, {
      params: { shipment_id: shipmentId },
    });
    return response.data;
  },
  shipOrder: async (
    id: number,
    payload: {
      items?: Array<{
        reservation_id: number;
        quantity?: string;
      }>;
      reservation_id?: number;
      quantity?: string;
      transaction_date?: string;
      reference?: string;
      reason?: string;
      note?: string;
      carrier_name?: string;
      tracking_number?: string;
      vehicle_no?: string;
      driver_name?: string;
      driver_phone?: string;
    }
  ): Promise<{ created_count: number; shipment_id: number; shipment_code: string; results: Array<{ id: number; code: string; reservation_code: string; quantity: string }> }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/ship/`, payload);
    return response.data;
  },
  packShipment: async (
    id: number,
    payload: {
      shipment_id: number;
      replace_existing?: boolean;
      items: Array<{
        transaction_id: number;
        package_count: number;
        package_type?: string;
        gross_weight_kg?: number | string;
        length_cm?: number | string;
        width_cm?: number | string;
        height_cm?: number | string;
        note?: string;
      }>;
    }
  ): Promise<{ shipment_id: number; shipment_code: string; package_count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/pack_shipment/`, payload);
    return response.data;
  },
  cancelShipment: async (
    id: number,
    payload: { shipment_id: number; reason: string }
  ): Promise<{ status: string; shipment_id: number; shipment_code: string; cancelled_count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/cancel_shipment/`, payload);
    return response.data;
  },
  scanShipmentPackage: async (
    id: number,
    payload: { shipment_id: number; scan_value: string }
  ): Promise<ShipmentPackageScanResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/scan_shipment_package/`, payload);
    return response.data;
  },
  markShipmentPackagesLoaded: async (
    id: number,
    payload: { shipment_id: number; package_ids?: number[] }
  ): Promise<ShipmentPackageLoadResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/mark_shipment_packages_loaded/`, payload);
    return response.data;
  },
  confirmShipmentLoading: async (
    id: number,
    payload: {
      shipment_id: number;
      loading_reference?: string;
      handover_receiver_name: string;
      handover_receiver_phone?: string;
      handover_proof_url?: string;
      loading_confirmation_note?: string;
    }
  ): Promise<ShipmentLoadingConfirmationResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/confirm_shipment_loading/`, payload);
    return response.data;
  },
  confirmShipmentDelivery: async (
    id: number,
    payload: {
      shipment_id: number;
      delivery_reference?: string;
      customer_receiver_name: string;
      customer_receiver_phone?: string;
      delivery_proof_url?: string;
      delivery_confirmation_note?: string;
      delivered_at_actual?: string;
    }
  ): Promise<ShipmentDeliveryConfirmationResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_ORDERS}${id}/confirm_shipment_delivery/`, payload);
    return response.data;
  },
  downloadInvoicePdf: async (id: number): Promise<Blob> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/invoice_pdf/`, {
      responseType: 'blob',
    });
    return response.data;
  },
  downloadPackingSlipPdf: async (id: number): Promise<Blob> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/packing_slip_pdf/`, {
      responseType: 'blob',
    });
    return response.data;
  },
  downloadTraceLabelsPdf: async (
    id: number,
    params?: { copies_per_line?: number; packages_per_line?: number; label_mode?: 'copies' | 'cartons'; line_ids?: number[] }
  ): Promise<Blob> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/trace_labels_pdf/`, {
      params: {
        label_mode: params?.label_mode,
        copies_per_line: params?.copies_per_line,
        packages_per_line: params?.packages_per_line,
        line_ids: params?.line_ids?.join(',') || undefined,
      },
      responseType: 'blob',
    });
    return response.data;
  },
  downloadShipmentPackingSlipPdf: async (id: number, shipmentId: number): Promise<Blob> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/shipment_packing_slip_pdf/`, {
      params: { shipment_id: shipmentId },
      responseType: 'blob',
    });
    return response.data;
  },
  downloadShipmentPackageLabelsPdf: async (id: number, shipmentId: number): Promise<Blob> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/shipment_package_labels_pdf/`, {
      params: { shipment_id: shipmentId },
      responseType: 'blob',
    });
    return response.data;
  },
  downloadShipmentPackingManifestPdf: async (id: number, shipmentId: number): Promise<Blob> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/shipment_packing_manifest_pdf/`, {
      params: { shipment_id: shipmentId },
      responseType: 'blob',
    });
    return response.data;
  },
  downloadShipmentLoadingHandoverPdf: async (id: number, shipmentId: number): Promise<Blob> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/shipment_loading_handover_pdf/`, {
      params: { shipment_id: shipmentId },
      responseType: 'blob',
    });
    return response.data;
  },
  downloadShipmentDeliveryProofPdf: async (id: number, shipmentId: number): Promise<Blob> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/shipment_delivery_proof_pdf/`, {
      params: { shipment_id: shipmentId },
      responseType: 'blob',
    });
    return response.data;
  },

  getQuotes: async (params?: Record<string, unknown>): Promise<PaginatedResponse<Quote>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.SALES_QUOTES, { params });
    return response.data;
  },
  getQuote: async (id: number): Promise<Quote> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_QUOTES}${id}/`);
    return response.data;
  },
  createQuote: async (payload: Partial<Quote> & { quote_date: string; lines?: Partial<QuoteLine>[] }): Promise<Quote> => {
    const response = await axiosInstance.post(API_ENDPOINTS.SALES_QUOTES, payload);
    return response.data;
  },
  updateQuote: async (id: number, payload: Partial<Quote>): Promise<Quote> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.SALES_QUOTES}${id}/`, payload);
    return response.data;
  },
  deleteQuote: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.SALES_QUOTES}${id}/`);
  },
  sendQuote: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_QUOTES}${id}/send/`);
    return response.data;
  },
  acceptQuote: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_QUOTES}${id}/accept/`);
    return response.data;
  },
  rejectQuote: async (id: number, reason?: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_QUOTES}${id}/reject/`, { reason: reason ?? '' });
    return response.data;
  },
  convertQuoteToOrder: async (id: number): Promise<{ order_id: number; order_code: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SALES_QUOTES}${id}/convert_to_order/`);
    return response.data;
  },
  downloadQuotePdf: async (id: number): Promise<Blob> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_QUOTES}${id}/quote_pdf/`, {
      responseType: 'blob',
    });
    return response.data;
  },
};
