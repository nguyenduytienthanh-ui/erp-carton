import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  InventoryReservation,
  InventoryForecastRow,
  InventorySalesOrderDetail,
  InventorySalesOrderOption,
  InventoryStockRow,
  InventoryStockSummary,
  InventoryTransaction,
  OutboundShipment,
  PaginatedResponse,
  StockAlert,
  Stocktake,
  StocktakeFormLine,
  Warehouse,
  WarehouseTransfer,
  WarehouseTransferLine,
  WarehouseLocation,
} from '../types/inventory';

type WarehousePayload = Omit<Warehouse, 'id' | 'created_at' | 'updated_at' | 'manager_name'>;
type WarehouseLocationPayload = Omit<WarehouseLocation, 'id' | 'created_at' | 'updated_at' | 'warehouse_name' | 'parent_name'>;
type InventoryTransactionPayload = Omit<
  InventoryTransaction,
  | 'id'
  | 'code'
  | 'status'
  | 'amount'
  | 'posted_at'
  | 'created_at'
  | 'updated_at'
  | 'product_code'
  | 'product_name'
  | 'warehouse_name'
  | 'location_name'
  | 'target_warehouse_name'
  | 'target_location_name'
  | 'sales_order_code'
  | 'reservation_code'
>;
type InventoryReservationPayload = Omit<
  InventoryReservation,
  | 'id'
  | 'code'
  | 'status'
  | 'released_qty'
  | 'fulfilled_qty'
  | 'active_qty'
  | 'created_at'
  | 'updated_at'
  | 'sales_order_code'
  | 'product_code'
  | 'product_name'
  | 'warehouse_name'
  | 'location_name'
>;
type WarehouseTransferPayload = Pick<
  WarehouseTransfer,
  'transfer_date' | 'from_warehouse' | 'to_warehouse' | 'reference' | 'note'
> & {
  lines: Array<Partial<WarehouseTransferLine>>;
};

export const inventoryApi = {
  getWarehouses: async (params?: Record<string, unknown>): Promise<PaginatedResponse<Warehouse>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.INVENTORY_WAREHOUSES, { params });
    return response.data;
  },
  createWarehouse: async (payload: WarehousePayload): Promise<Warehouse> => {
    const response = await axiosInstance.post(API_ENDPOINTS.INVENTORY_WAREHOUSES, payload);
    return response.data;
  },
  updateWarehouse: async (id: number, payload: Partial<WarehousePayload>): Promise<Warehouse> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.INVENTORY_WAREHOUSES}${id}/`, payload);
    return response.data;
  },
  deleteWarehouse: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.INVENTORY_WAREHOUSES}${id}/`);
  },

  getLocations: async (params?: Record<string, unknown>): Promise<PaginatedResponse<WarehouseLocation>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.INVENTORY_LOCATIONS, { params });
    return response.data;
  },
  createLocation: async (payload: WarehouseLocationPayload): Promise<WarehouseLocation> => {
    const response = await axiosInstance.post(API_ENDPOINTS.INVENTORY_LOCATIONS, payload);
    return response.data;
  },
  updateLocation: async (id: number, payload: Partial<WarehouseLocationPayload>): Promise<WarehouseLocation> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.INVENTORY_LOCATIONS}${id}/`, payload);
    return response.data;
  },
  deleteLocation: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.INVENTORY_LOCATIONS}${id}/`);
  },

  getTransactions: async (params?: Record<string, unknown>): Promise<PaginatedResponse<InventoryTransaction>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.INVENTORY_TRANSACTIONS, { params });
    return response.data;
  },
  createTransaction: async (payload: InventoryTransactionPayload): Promise<InventoryTransaction> => {
    const response = await axiosInstance.post(API_ENDPOINTS.INVENTORY_TRANSACTIONS, payload);
    return response.data;
  },
  cancelTransaction: async (id: number, reason: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.INVENTORY_TRANSACTIONS}${id}/cancel/`, { reason });
    return response.data;
  },

  getReservations: async (params?: Record<string, unknown>): Promise<PaginatedResponse<InventoryReservation>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.INVENTORY_RESERVATIONS, { params });
    return response.data;
  },
  createReservation: async (payload: InventoryReservationPayload): Promise<InventoryReservation> => {
    const response = await axiosInstance.post(API_ENDPOINTS.INVENTORY_RESERVATIONS, payload);
    return response.data;
  },
  releaseReservation: async (id: number, qty?: string): Promise<{ status: string; active_qty: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.INVENTORY_RESERVATIONS}${id}/release/`, qty ? { qty } : {});
    return response.data;
  },
  cancelReservation: async (id: number, reason: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.INVENTORY_RESERVATIONS}${id}/cancel/`, { reason });
    return response.data;
  },

  getStock: async (params?: Record<string, unknown>): Promise<PaginatedResponse<InventoryStockRow>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.INVENTORY_STOCK, { params });
    return response.data;
  },
  getStockSummary: async (): Promise<InventoryStockSummary> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.INVENTORY_STOCK}summary/`);
    return response.data;
  },
  getInventoryForecast: async (params?: { months?: number; lead_time?: number }): Promise<InventoryForecastRow[]> => {
    const response = await axiosInstance.get(API_ENDPOINTS.INVENTORY_FORECAST, { params });
    return Array.isArray(response.data) ? response.data : response.data?.results ?? [];
  },
  getNxtReport: async (params: { date_from: string; date_to: string; warehouse?: number }): Promise<{
    date_from: string;
    date_to: string;
    results: Array<{
      product_id: number;
      product_code: string;
      product_name: string;
      warehouse_id: number | null;
      warehouse_code: string;
      warehouse_name: string;
      opening_qty: string;
      in_qty: string;
      out_qty: string;
      closing_qty: string;
    }>;
  }> => {
    const response = await axiosInstance.get(API_ENDPOINTS.INVENTORY_NXT_REPORT, { params });
    return response.data;
  },

  getStocktakes: async (params?: Record<string, unknown>): Promise<PaginatedResponse<Stocktake>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.INVENTORY_STOCKTAKES, { params });
    return response.data;
  },
  getStocktake: async (id: number): Promise<Stocktake> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.INVENTORY_STOCKTAKES}${id}/`);
    return response.data;
  },
  createStocktake: async (payload: { warehouse: number; count_date: string; note?: string; lines_data: StocktakeFormLine[] }): Promise<Stocktake> => {
    const response = await axiosInstance.post(API_ENDPOINTS.INVENTORY_STOCKTAKES, payload);
    return response.data;
  },
  updateStocktake: async (id: number, payload: Partial<{ warehouse: number; count_date: string; note: string; lines_data: StocktakeFormLine[] }>): Promise<Stocktake> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.INVENTORY_STOCKTAKES}${id}/`, payload);
    return response.data;
  },
  deleteStocktake: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.INVENTORY_STOCKTAKES}${id}/`);
  },
  completeStocktake: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.INVENTORY_STOCKTAKES}${id}/complete/`);
    return response.data;
  },

  getShipments: async (params?: Record<string, unknown>): Promise<PaginatedResponse<OutboundShipment>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.INVENTORY_SHIPMENTS, { params });
    return response.data;
  },
  getShipment: async (id: number): Promise<OutboundShipment> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.INVENTORY_SHIPMENTS}${id}/`);
    return response.data;
  },

  searchSalesOrders: async (params?: Record<string, unknown>): Promise<PaginatedResponse<InventorySalesOrderOption>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.SALES_ORDERS, { params });
    return response.data;
  },
  getSalesOrder: async (id: number): Promise<InventorySalesOrderDetail> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/`);
    return response.data;
  },

  // Stock Alerts
  getStockAlerts: async (params?: Record<string, unknown>): Promise<PaginatedResponse<StockAlert>> => {
    const response = await axiosInstance.get('api/inventory/stock-alerts/', { params });
    return response.data;
  },
  acknowledgeAlert: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`api/inventory/stock-alerts/${id}/acknowledge_alert/`);
    return response.data;
  },
  checkLowStock: async (): Promise<{ created: number }> => {
    const response = await axiosInstance.post('api/inventory/stock-alerts/check_low_stock/');
    return response.data;
  },

  // Warehouse Transfers
  getWarehouseTransfers: async (params?: Record<string, unknown>): Promise<PaginatedResponse<WarehouseTransfer>> => {
    const response = await axiosInstance.get('api/inventory/warehouse-transfers/', { params });
    return response.data;
  },
  getWarehouseTransfer: async (id: number): Promise<WarehouseTransfer> => {
    const response = await axiosInstance.get(`api/inventory/warehouse-transfers/${id}/`);
    return response.data;
  },
  createWarehouseTransfer: async (payload: WarehouseTransferPayload): Promise<WarehouseTransfer> => {
    const response = await axiosInstance.post('api/inventory/warehouse-transfers/', payload);
    return response.data;
  },
  updateWarehouseTransfer: async (id: number, payload: WarehouseTransferPayload): Promise<WarehouseTransfer> => {
    const response = await axiosInstance.patch(`api/inventory/warehouse-transfers/${id}/`, payload);
    return response.data;
  },
  deleteWarehouseTransfer: async (id: number): Promise<void> => {
    await axiosInstance.delete(`api/inventory/warehouse-transfers/${id}/`);
  },
  submitTransfer: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`api/inventory/warehouse-transfers/${id}/submit_transfer/`);
    return response.data;
  },
  postTransfer: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`api/inventory/warehouse-transfers/${id}/post_transfer/`);
    return response.data;
  },
  receiveTransfer: async (id: number): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`api/inventory/warehouse-transfers/${id}/receive_transfer/`);
    return response.data;
  },
  cancelTransfer: async (id: number, reason?: string): Promise<{ status: string }> => {
    const response = await axiosInstance.post(`api/inventory/warehouse-transfers/${id}/cancel_transfer/`, { reason: reason ?? '' });
    return response.data;
  },
};

export const warehouseApi = {
  getWarehouses: inventoryApi.getWarehouses,
};
