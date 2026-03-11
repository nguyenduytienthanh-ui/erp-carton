export type InventoryTransactionType =
  | 'RECEIPT'
  | 'ISSUE'
  | 'TRANSFER'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT';

export type InventoryTransactionStatus = 'POSTED' | 'CANCELLED';
export type InventoryReservationStatus = 'OPEN' | 'RELEASED' | 'FULFILLED' | 'CANCELLED';
export type WarehouseLocationType = 'STORAGE' | 'STAGING' | 'SHIPPING' | 'RETURN' | 'PRODUCTION' | 'OTHER';

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  address: string;
  manager?: number | null;
  manager_name?: string | null;
  note: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WarehouseLocation {
  id: number;
  warehouse: number;
  warehouse_name?: string;
  code: string;
  name: string;
  parent?: number | null;
  parent_name?: string | null;
  location_type: WarehouseLocationType;
  allow_mixed_products: boolean;
  is_active: boolean;
  sort_order: number;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryTransaction {
  id: number;
  code: string;
  transaction_type: InventoryTransactionType;
  status: InventoryTransactionStatus;
  transaction_date: string;
  reference: string;
  reason: string;
  note: string;
  product: number;
  product_code?: string;
  product_name?: string;
  warehouse?: number | null;
  warehouse_name?: string | null;
  location?: number | null;
  location_name?: string | null;
  target_warehouse?: number | null;
  target_warehouse_name?: string | null;
  target_location?: number | null;
  target_location_name?: string | null;
  quantity: string;
  unit_cost: string;
  amount?: string;
  sales_order?: number | null;
  sales_order_code?: string | null;
  sales_order_line?: number | null;
  reservation?: number | null;
  reservation_code?: string | null;
  posted_at: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryReservation {
  id: number;
  code: string;
  status: InventoryReservationStatus;
  reservation_date: string;
  sales_order?: number | null;
  sales_order_code?: string | null;
  sales_order_line?: number | null;
  product: number;
  product_code?: string;
  product_name?: string;
  warehouse: number;
  warehouse_name?: string;
  location?: number | null;
  location_name?: string | null;
  reserved_qty: string;
  released_qty: string;
  fulfilled_qty: string;
  active_qty: string;
  reference: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryStockRow {
  product_id: number;
  product_code: string;
  product_name: string;
  unit_name?: string | null;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  warehouse_sort_order?: number;
  warehouse_is_active?: boolean;
  location_id?: number | null;
  location_code?: string | null;
  location_name?: string | null;
  location_type?: WarehouseLocationType | null;
  location_sort_order?: number | null;
  location_is_active?: boolean | null;
  min_stock: string;
  on_hand: string;
  reserved: string;
  available: string;
  is_below_min: boolean;
}

export interface InventoryStockSummary {
  stock_rows: number;
  below_min_count: number;
  total_on_hand_qty: string;
  total_reserved_qty: string;
  total_available_qty: string;
}

export interface InventorySalesOrderLineOption {
  id: number;
  line_number: number;
  product: number;
  product_code?: string;
  product_name?: string;
  qty: string;
  reserved_qty_total?: string;
  shipped_qty_total?: string;
  remaining_reservation_qty?: string;
}

export interface InventorySalesOrderOption {
  id: number;
  code: string;
  customer_name?: string | null;
  status: string;
}

export interface InventorySalesOrderDetail extends InventorySalesOrderOption {
  lines: InventorySalesOrderLineOption[];
}
