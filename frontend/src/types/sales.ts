export type SalesOrderStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'POSTED' | 'VOID';

export interface SalesOrderLineProductSnapshot {
  product_id?: number;
  code?: string;
  name?: string;
  category_id?: number | null;
  category_name?: string | null;
  unit_id?: number | null;
  unit_name?: string | null;
  description?: string;
  size_order?: string;
  size_production?: string;
  wave_id?: number | null;
  wave_code?: string | null;
  wave_name?: string | null;
  box_type_id?: number | null;
  box_type_code?: string | null;
  box_type_name?: string | null;
  standalone_cost_price?: string;
  standalone_sale_price?: string;
  standalone_commission_per_unit?: string;
  standalone_commission_percent?: string;
  cost_price?: string;
  sale_price?: string;
  min_stock?: string;
  delivery_tolerance?: string;
  commission_per_unit?: string;
  commission_percent?: string;
  process_xa?: number | null;
  process_in?: number | null;
  process_boi?: number | null;
  process_can_mang?: number | null;
  process_be?: number | null;
  process_chap?: number | null;
  process_dong?: number | null;
  process_dan?: number | null;
  process_khac?: number | null;
  film_code?: string;
  film_file_url?: string;
  color_count?: number | null;
  mold_code?: string;
  mold_file_url?: string;
  waterproof?: string;
  note_other?: string;
  note?: string;
  parent_id?: number | null;
  parent_name?: string | null;
  component_quantity?: number | null;
  is_set?: boolean;
  bundle_id?: number | null;
  bundle_pricing_mode?: string | null;
  bundle_commission_mode?: string | null;
  bundle_delivery_rule?: string | null;
  bundle_primary_product_id?: number | null;
  bundle_primary_product_name?: string | null;
  bundle_components?: Array<{
    component_product_id: number;
    component_product_code?: string;
    component_product_name?: string;
    qty_per_bundle?: string;
    unit_name?: string | null;
    is_required?: boolean;
  }>;
  status?: string;
  owner_id?: number | null;
  owner_name?: string | null;
  team_id?: number | null;
  team_name?: string | null;
  is_active?: boolean;
}

export interface SalesOrderDeliveryPlan {
  id?: number;
  delivery_date: string;
  qty: string;
  shipped_qty?: string;
  delivered_qty?: string;
  remaining_shipment_qty?: string;
  remaining_qty?: string;
  is_completed?: boolean;
  note?: string;
}

export interface SalesOrderLine {
  id?: number;
  line_number: number;
  product: number;
  internal_product_code?: string;
  trace_code?: string;
  qr_value?: string;
  product_code?: string;
  product_name?: string;
  product_name_snapshot?: string;
  product_snapshot?: SalesOrderLineProductSnapshot;
  uom?: string;
  qty: string;
  unit_price: string;
  discount_pct?: string;
  tax_pct?: string;
  line_subtotal?: string;
  discount_amount?: string;
  tax_amount?: string;
  line_total?: string;
  note?: string;
  planned_qty_total?: string;
  unplanned_qty?: string;
  reserved_qty_total?: string;
  shipped_qty_total?: string;
  remaining_reservation_qty?: string;
  delivery_schedule_summary?: string;
  commission_per_unit_snapshot?: string;
  commission_percent_snapshot?: string;
  delivered_qty_total?: string;
  delivery_plans?: SalesOrderDeliveryPlan[];
}

export interface SalesOrder {
  id: number;
  code: string;
  doc_type: string;
  order_date: string;
  delivery_date?: string | null;
  status: SalesOrderStatus;
  reference?: string;
  customer?: number | null;
  customer_name?: string | null;
  currency: string;
  exchange_rate: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  notes?: string;
  reject_reason?: string;
  void_reason?: string;
  post_number?: string;
  version?: number;
  lines: SalesOrderLine[];
  created_at: string;
  updated_at: string;
}

export interface SalesOrderFormValues {
  order_date: string;
  version?: number;
  delivery_date?: string | null;
  reference?: string;
  customer?: number | null;
  currency?: string;
  exchange_rate?: number;
  notes?: string;
  lines: Array<{
    line_number?: number;
    product: number;
    uom?: string;
    product_snapshot?: SalesOrderLineProductSnapshot;
    qty: number;
    unit_price: number;
    discount_pct?: number;
    tax_pct?: number;
    note?: string;
    delivery_plans?: Array<{
      delivery_date: string;
      qty: number;
      shipped_qty?: number;
      delivered_qty?: number;
      note?: string;
    }>;
  }>;
}

export interface SalesOrderDeliveryOverviewItem {
  delivery_plan_id: number;
  line_id: number;
  line_number: number;
  product_id: number;
  product_code?: string | null;
  product_name?: string | null;
  delivery_date: string;
  qty: string;
  shipped_qty: string;
  delivered_qty: string;
  remaining_shipment_qty: string;
  remaining_qty: string;
  is_completed: boolean;
  is_overdue: boolean;
  is_due_soon: boolean;
  note?: string;
}

export interface SalesOrderReservationOverviewItem {
  id: number;
  code: string;
  status: string;
  reservation_date: string;
  sales_order_line_id?: number | null;
  line_number?: number | null;
  product_id: number;
  product_code?: string | null;
  product_name?: string | null;
  warehouse_id?: number | null;
  warehouse_code?: string | null;
  warehouse_name?: string | null;
  location_id?: number | null;
  location_code?: string | null;
  location_name?: string | null;
  reserved_qty: string;
  released_qty: string;
  fulfilled_qty: string;
  active_qty: string;
  reference?: string;
  note?: string;
}

export interface SalesOrderShipmentOverviewItem {
  id: number;
  shipment_id: number;
  shipment_code: string;
  status: string;
  shipment_date: string;
  reference?: string;
  carrier_name?: string | null;
  tracking_number?: string | null;
  vehicle_no?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  loading_reference?: string | null;
  handover_receiver_name?: string | null;
  handover_receiver_phone?: string | null;
  handover_proof_url?: string | null;
  loading_confirmation_note?: string | null;
  loading_confirmed_at?: string | null;
  loading_confirmed_by?: number | null;
  loading_confirmed_by_name?: string | null;
  delivery_reference?: string | null;
  customer_receiver_name?: string | null;
  customer_receiver_phone?: string | null;
  delivery_proof_url?: string | null;
  delivery_confirmation_note?: string | null;
  delivered_at_actual?: string | null;
  delivery_confirmed_at?: string | null;
  delivery_confirmed_by?: number | null;
  delivery_confirmed_by_name?: string | null;
  item_count?: number;
  line_count?: number;
  total_qty?: string;
  package_count?: number;
  total_gross_weight_kg?: string;
  verified_package_count?: number;
  loaded_package_count?: number;
  pending_verify_count?: number;
  pending_load_count?: number;
  note?: string;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
}

export interface SalesOrderShipmentDetailItem {
  transaction_id: number;
  transaction_code: string;
  line_id?: number | null;
  line_number?: number | null;
  product_id: number;
  product_code?: string | null;
  product_name?: string | null;
  quantity: string;
  trace_code?: string | null;
  existing_package_count?: number;
  package_type?: string | null;
  gross_weight_kg?: string;
  length_cm?: string;
  width_cm?: string;
  height_cm?: string;
  package_note?: string | null;
}

export interface SalesOrderShipmentDetail {
  shipment_id: number;
  shipment_code: string;
  shipment_date: string;
  status: string;
  loading_reference?: string | null;
  handover_receiver_name?: string | null;
  handover_receiver_phone?: string | null;
  handover_proof_url?: string | null;
  loading_confirmation_note?: string | null;
  loading_confirmed_at?: string | null;
  loading_confirmed_by?: number | null;
  loading_confirmed_by_name?: string | null;
  delivery_reference?: string | null;
  customer_receiver_name?: string | null;
  customer_receiver_phone?: string | null;
  delivery_proof_url?: string | null;
  delivery_confirmation_note?: string | null;
  delivered_at_actual?: string | null;
  delivery_confirmed_at?: string | null;
  delivery_confirmed_by?: number | null;
  delivery_confirmed_by_name?: string | null;
  package_count: number;
  total_gross_weight_kg?: string;
  verified_package_count?: number;
  loaded_package_count?: number;
  pending_verify_count?: number;
  pending_load_count?: number;
  items: SalesOrderShipmentDetailItem[];
}

export interface SalesOrderShipmentPackageItem {
  id: number;
  shipment_id: number;
  shipment_code?: string | null;
  transaction_id: number;
  line_id?: number | null;
  line_number?: number | null;
  product_code?: string | null;
  product_name?: string | null;
  status: string;
  package_no: number;
  total_packages: number;
  quantity: string;
  package_type?: string | null;
  gross_weight_kg?: string;
  length_cm?: string;
  width_cm?: string;
  height_cm?: string;
  package_code: string;
  label_qr_value: string;
  note?: string | null;
  verified_at?: string | null;
  verified_by?: number | null;
  verified_by_name?: string | null;
  loaded_at?: string | null;
  loaded_by?: number | null;
  loaded_by_name?: string | null;
  cancel_reason?: string | null;
}

export interface ShipmentPackageOverviewResponse {
  count: number;
  results: SalesOrderShipmentPackageItem[];
  package_count: number;
  verified_package_count: number;
  loaded_package_count: number;
  pending_verify_count: number;
  pending_load_count: number;
  total_gross_weight_kg?: string;
}

export interface ShipmentPackageScanResponse {
  scan_status: string;
  shipment_id: number;
  shipment_code: string;
  package: SalesOrderShipmentPackageItem;
  package_count: number;
  verified_package_count: number;
  loaded_package_count: number;
  pending_verify_count: number;
  pending_load_count: number;
  total_gross_weight_kg?: string;
}

export interface ShipmentPackageLoadResponse {
  shipment_id: number;
  shipment_code: string;
  loaded_count: number;
  package_count: number;
  verified_package_count: number;
  loaded_package_count: number;
  pending_verify_count: number;
  pending_load_count: number;
  total_gross_weight_kg?: string;
}

export interface ShipmentLoadingConfirmationResponse {
  shipment_id: number;
  shipment_code: string;
  loading_reference?: string | null;
  handover_receiver_name?: string | null;
  handover_receiver_phone?: string | null;
  handover_proof_url?: string | null;
  loading_confirmation_note?: string | null;
  loading_confirmed_at?: string | null;
  loading_confirmed_by?: number | null;
  loading_confirmed_by_name?: string | null;
  package_count: number;
  verified_package_count: number;
  loaded_package_count: number;
  pending_verify_count: number;
  pending_load_count: number;
  total_gross_weight_kg?: string;
}

export interface ShipmentDeliveryConfirmationResponse {
  shipment_id: number;
  shipment_code: string;
  delivery_reference?: string | null;
  customer_receiver_name?: string | null;
  customer_receiver_phone?: string | null;
  delivery_proof_url?: string | null;
  delivery_confirmation_note?: string | null;
  delivered_at_actual?: string | null;
  delivery_confirmed_at?: string | null;
  delivery_confirmed_by?: number | null;
  delivery_confirmed_by_name?: string | null;
  package_count: number;
  verified_package_count: number;
  loaded_package_count: number;
  pending_verify_count: number;
  pending_load_count: number;
  total_gross_weight_kg?: string;
}

/** Báo giá (Quote) */
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export interface QuoteLine {
  id: number;
  line_number: number;
  product: number;
  product_code?: string;
  product_name?: string;
  qty: string;
  unit_price: string;
  discount_pct: string;
  tax_pct: string;
  line_subtotal: string;
  discount_amount: string;
  tax_amount: string;
  line_total: string;
  note: string;
}

export interface Quote {
  id: number;
  code: string;
  quote_date: string;
  valid_until: string | null;
  status: QuoteStatus;
  reference: string;
  customer: number | null;
  customer_name: string | null;
  currency: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  notes: string;
  created_by: number | null;
  created_at: string;
  updated_by: number | null;
  updated_at: string;
  lines?: QuoteLine[];
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
