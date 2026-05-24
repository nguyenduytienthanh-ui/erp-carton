export type InventoryTransactionType =
  | 'RECEIPT'
  | 'ISSUE'
  | 'TRANSFER'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT';

export type InventoryTransactionStatus = 'POSTED' | 'CANCELLED';
export type InventoryReservationStatus = 'OPEN' | 'RELEASED' | 'FULFILLED' | 'CANCELLED';
export type WarehouseLocationType = 'STORAGE' | 'STAGING' | 'SHIPPING' | 'RETURN' | 'PRODUCTION' | 'OTHER';
export type InventorySourceType =
  | 'PURCHASE'
  | 'PRODUCTION'
  | 'STOCKTAKE'
  | 'TRANSFER'
  | 'RESERVATION'
  | 'SHIPMENT'
  | 'SALES'
  | 'MANUAL';

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

export interface InventorySourceAuditRelated {
  purchase_order_id?: number | null;
  purchase_order_code?: string | null;
  purchase_receipt_id?: number | null;
  purchase_receipt_code?: string | null;
  production_order_id?: number | null;
  production_order_code?: string | null;
  production_issue_id?: number | null;
  production_issue_code?: string | null;
  production_receipt_id?: number | null;
  production_receipt_code?: string | null;
  stocktake_id?: number | null;
  stocktake_code?: string | null;
  reservation_id?: number | null;
  reservation_code?: string | null;
  shipment_batch_id?: number | null;
  shipment_batch_code?: string | null;
  sales_order_id?: number | null;
  sales_order_code?: string | null;
  sales_order_line_id?: number | null;
}

export interface InventorySourceAudit {
  type: InventorySourceType;
  label: string;
  document_type: string;
  code: string;
  reference: string;
  warning_flags: string[];
  related: InventorySourceAuditRelated;
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
  purchase_order?: number | null;
  purchase_order_code?: string | null;
  purchase_order_line?: number | null;
  purchase_receipt?: number | null;
  purchase_receipt_code?: string | null;
  production_order?: number | null;
  production_order_code?: string | null;
  production_issue?: number | null;
  production_issue_code?: string | null;
  production_receipt?: number | null;
  production_receipt_code?: string | null;
  reservation?: number | null;
  reservation_code?: string | null;
  shipment_batch?: number | null;
  shipment_batch_code?: string | null;
  stocktake?: number | null;
  stocktake_code?: string | null;
  stocktake_line?: number | null;
  stocktake_line_number?: number | null;
  posted_by?: number | null;
  source_type?: InventorySourceType;
  source_label?: string;
  source_code?: string;
  source_document_type?: string;
  source_warnings?: string[];
  source_audit?: InventorySourceAudit;
  cancelled_at?: string | null;
  cancelled_by?: number | null;
  cancel_reason?: string;
  posted_at: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryNxtReportRow {
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
}

export interface InventoryNxtReportResponse {
  date_from: string;
  date_to: string;
  results: InventoryNxtReportRow[];
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

export interface InventoryForecastRow {
  product_id: number;
  product_code: string;
  product_name: string;
  current_stock: number;
  abc_class: 'A' | 'B' | 'C';
  avg_monthly_usage: number;
  lead_time_days: number;
  lead_time?: number;
  eoq: number;
  reorder_point: number;
  safety_stock: number;
  status: 'OK' | 'WARNING' | 'ALERT';
  stockout_risk: 'LOW' | 'MEDIUM' | 'HIGH';
  coverage_days?: number | null;
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
  adjustment_posted_at?: string | null;
  adjustment_posted_by?: number | null;
  lines: StocktakeLine[];
}

export type StocktakeFormLine = { product_id: number; count_qty: number | string; note?: string };

export type StocktakeAdjustmentType = 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
export type StocktakeAdjustmentLineStatus = 'READY' | 'SKIPPED' | 'BLOCKED';

export interface StocktakeAdjustmentPreviewLine {
  line_id: number;
  line_number: number;
  product: number;
  product_code?: string;
  product_name?: string;
  warehouse: number;
  warehouse_code?: string;
  warehouse_name?: string;
  system_qty: string;
  count_qty: string;
  variance_qty: string;
  status: StocktakeAdjustmentLineStatus;
  adjustment_type: StocktakeAdjustmentType | null;
  adjustment_qty: string;
  blocked_reason?: unknown;
}

export interface StocktakeAdjustmentPreview {
  stocktake: number;
  stocktake_code: string;
  status: StocktakeStatus | 'POSTED';
  adjustment_posted_at?: string | null;
  adjustment_posted_by?: number | null;
  can_post: boolean;
  total_in_lines: number;
  total_out_lines: number;
  skipped_zero_lines: number;
  blocked_lines: number;
  transaction_count: number;
  transaction_ids?: number[];
  lines: StocktakeAdjustmentPreviewLine[];
}

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

export type StockAlertType = 'LOW_STOCK' | 'OUT_OF_STOCK';
export type StockAlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface StockAlert {
  id: number;
  product: number;
  product_code?: string;
  product_name?: string;
  alert_type: StockAlertType;
  status: StockAlertStatus;
  triggered_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: number | null;
  acknowledged_by_name?: string | null;
  current_qty: string;
  min_stock: string;
}

export type WarehouseTransferStatus = 'DRAFT' | 'SUBMITTED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';

export interface WarehouseTransferLine {
  id: number;
  line_number: number;
  product: number;
  product_code?: string;
  product_name?: string;
  qty: string;
  received_qty: string;
  note: string;
}

export interface WarehouseTransfer {
  id: number;
  code: string;
  transfer_date: string;
  status: WarehouseTransferStatus;
  from_warehouse: number;
  from_warehouse_code?: string;
  to_warehouse: number;
  to_warehouse_code?: string;
  reference: string;
  note: string;
  submitted_by?: number | null;
  submitted_at?: string | null;
  posted_by?: number | null;
  posted_at?: string | null;
  received_by?: number | null;
  received_at?: string | null;
  cancelled_by?: number | null;
  cancelled_at?: string | null;
  cancel_reason?: string;
  created_by?: number | null;
  created_at: string;
  updated_by?: number | null;
  updated_at: string;
  lines?: WarehouseTransferLine[];
}
