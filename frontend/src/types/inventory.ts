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

export type StocktakeStatus = 'DRAFT' | 'COMPLETED' | 'CANCELLED';

export interface StocktakeLine {
  id: number;
  stocktake: number;
  product: number;
  product_code: string;
  product_name: string;
  warehouse: number;
  line_number: number;
  system_qty: string;
  count_qty: string;
  variance_qty: string;
  note: string;
}

export interface Stocktake {
  id: number;
  code: string;
  warehouse: number;
  warehouse_name: string;
  count_date: string;
  status: StocktakeStatus;
  note: string;
  created_at: string;
  updated_at: string;
  created_by?: number | null;
  completed_at?: string | null;
  completed_by?: number | null;
  lines: StocktakeLine[];
}

export type StocktakeFormLine = { product_id: number; count_qty: number | string; note?: string };

/** Phiếu xuất / Giao hàng (danh sách + chi tiết) */
export type OutboundShipmentStatus = 'POSTED' | 'CANCELLED';

export interface OutboundShipment {
  id: number;
  code: string;
  sales_order: number | null;
  sales_order_code: string | null;
  shipment_date: string;
  status: OutboundShipmentStatus;
  reference: string;
  carrier_name: string;
  tracking_number: string;
  vehicle_no: string;
  driver_name: string;
  driver_phone: string;
  note: string;
  loading_reference: string;
  handover_receiver_name: string;
  handover_receiver_phone: string;
  handover_proof_url: string;
  loading_confirmation_note: string;
  loading_confirmed_at: string | null;
  loading_confirmed_by: number | null;
  loading_confirmed_by_name: string | null;
  delivery_reference: string;
  customer_receiver_name: string;
  customer_receiver_phone: string;
  delivery_proof_url: string;
  delivery_confirmation_note: string;
  delivered_at_actual: string | null;
  delivery_confirmed_at: string | null;
  delivery_confirmed_by: number | null;
  delivery_confirmed_by_name: string | null;
  total_qty: string;
  item_count: number;
  package_count: number;
  total_gross_weight_kg: string;
  verified_package_count: number;
  loaded_package_count: number;
  posted_at: string;
  created_at: string;
  updated_at: string;
}
