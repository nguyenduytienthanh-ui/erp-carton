import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  InventoryReservation,
  InventorySalesOrderDetail,
  InventorySalesOrderOption,
  InventoryStockRow,
  InventoryStockSummary,
  InventoryTransaction,
  PaginatedResponse,
  Warehouse,
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

  searchSalesOrders: async (params?: Record<string, unknown>): Promise<PaginatedResponse<InventorySalesOrderOption>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.SALES_ORDERS, { params });
    return response.data;
  },
  getSalesOrder: async (id: number): Promise<InventorySalesOrderDetail> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.SALES_ORDERS}${id}/`);
    return response.data;
  },
};
