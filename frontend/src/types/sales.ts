export type SalesOrderStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'POSTED' | 'VOID';
export type SalesOrderDeliveryRule = 'FULL_REQUIRED' | 'PARTIAL_ALLOWED';

export interface DeliveryCarrier {
  id: number;
  code: string;
  name: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  note?: string;
  is_internal: boolean;
  is_active: boolean;
  sort_order: number;
  delivery_plan_usage_count?: number;
  shipment_usage_count?: number;
  legacy_shipment_usage_count?: number;
  total_usage_count?: number;
  created_at?: string;
  updated_at?: string;
}

export type SalesProductKind = 'SPECIFIC' | 'GENERIC';
export type SalesSnapshotStepType = 'REQUIRED' | 'OPTIONAL' | 'CHOOSE_ONE' | 'PARALLEL';

export interface SalesSnapshotOperation {
  operation_code?: string;
  operation_name?: string;
  sequence?: number;
  standard_rate_per_hour?: number;
  applied_rate_per_hour?: number;
  note?: string;
  source?: string;
  is_overridden?: boolean;
  override_reason?: string;
}

export interface SalesSnapshotRoutingStep {
  id?: number | null;
  route_step_id?: number | null;
  operation_id?: number | null;
  product_operation_id?: number | null;
  step_no?: number;
  display_step?: number;
  display_order?: number;
  operation_code?: string;
  operation_name?: string;
  standard_rate_per_hour?: number;
  applied_rate_per_hour?: number;
  note?: string;
  step_type?: SalesSnapshotStepType | string;
  group_code?: string;
  is_required?: boolean;
  allow_parallel?: boolean;
  source?: string;
  is_overridden?: boolean;
  override_reason?: string;
}

export interface SalesOrderLineProductSnapshot {
  schema_version?: number;
  source?: string;
  snapshot_created_at?: string;
  product_id?: number;
  product_code?: string;
  product_name?: string;
  code?: string;
  name?: string;
  product_kind?: SalesProductKind | string;
  requires_order_spec?: boolean;
  requires_order_operations_review?: boolean;
  order_spec_confirmed?: boolean;
  order_operations_reviewed?: boolean;
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
  print_color_1?: string;
  print_color_2?: string;
  print_color_3?: string;
  print_color_4?: string;
  print_color_5?: string;
  print_colors?: string[];
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
  operations?: SalesSnapshotOperation[];
  routing_schema_version?: number;
  routing_steps?: SalesSnapshotRoutingStep[];
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
  planned_carrier?: number | null;
  planned_carrier_name?: string;
  delivery_rule?: SalesOrderDeliveryRule;
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
  confirmed_at?: string | null;
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
      planned_carrier?: number | null;
      planned_carrier_name?: string;
      delivery_rule?: SalesOrderDeliveryRule;
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

export interface DeliveryPlanningSummaryRow {
  group_key: string;
  delivery_date: string;
  customer_id?: number | null;
  customer_name: string;
  planned_carrier_name: string;
  note_preview: string;
  note_count: number;
  plan_count: number;
  order_count: number;
  sku_count: number;
  sku_preview: string[];
  planned_qty_total: string;
  shipped_qty_total: string;
  delivered_qty_total: string;
  remaining_shipment_qty_total: string;
  remaining_qty_total: string;
  overdue_count: number;
  due_today_count: number;
  due_soon_count: number;
  awaiting_shipment_count: number;
  awaiting_delivery_confirmation_count: number;
  completed_count: number;
  has_full_required_items: boolean;
  has_unassigned_carrier: boolean;
  attention_status: string;
}

export interface DeliveryPlanningGroupItem {
  delivery_plan_id: number;
  sales_order_id: number;
  sales_order_code: string;
  line_id: number;
  line_number: number;
  product_code?: string | null;
  product_name?: string | null;
  delivery_date: string;
  planned_carrier_name: string;
  delivery_rule: SalesOrderDeliveryRule;
  note: string;
  qty: string;
  shipped_qty: string;
  delivered_qty: string;
  remaining_shipment_qty: string;
  remaining_qty: string;
  shipment_status?: string | null;
  shipment_id?: number | null;
  shipment_code?: string | null;
}

export interface DeliveryPlanningSummaryResponse {
  count: number;
  group_by: string;
  summary: {
    group_count: number;
    overdue_groups: number;
    due_today_groups: number;
    due_soon_groups: number;
    unassigned_carrier_groups: number;
    full_required_groups: number;
    awaiting_shipment_groups: number;
    awaiting_delivery_confirmation_groups: number;
    completed_groups: number;
  };
  results: DeliveryPlanningSummaryRow[];
}

export interface DeliveryPlanningGroupItemsResponse {
  count: number;
  results: DeliveryPlanningGroupItem[];
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

export interface ShipmentScanResolveResponse {
  order_id: number | null;
  order_code?: string | null;
  shipment_id: number | null;
  shipment_code?: string | null;
  shipment_status?: string | null;
  shipment_date?: string | null;
  reference?: string | null;
  carrier_name?: string | null;
  tracking_number?: string | null;
  vehicle_no?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  loading_reference?: string | null;
  handover_receiver_name?: string | null;
  handover_receiver_phone?: string | null;
  loading_confirmed_at?: string | null;
  delivery_reference?: string | null;
  customer_receiver_name?: string | null;
  customer_receiver_phone?: string | null;
  delivery_confirmed_at?: string | null;
  matched_by?: 'package_code' | 'label_qr_value' | string;
  can_manage_execution: boolean;
  package: SalesOrderShipmentPackageItem;
  packages: SalesOrderShipmentPackageItem[];
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

export type SalesDiscountType = 'PERCENTAGE' | 'FIXED';
export type SalesDiscountApplicability =
  | 'ALL_PRODUCTS'
  | 'SPECIFIC_PRODUCTS'
  | 'SPECIFIC_CUSTOMERS'
  | 'VOLUME_BASED';
export type SalesDiscountStatus = 'ACTIVE' | 'INACTIVE';

export interface SalesDiscountRule {
  id: number;
  code: string;
  name: string;
  type: SalesDiscountType;
  value: string;
  applicable_to: SalesDiscountApplicability;
  min_order_value: string;
  min_quantity?: string | null;
  max_discount_amount?: string | null;
  start_date: string;
  end_date?: string | null;
  status: SalesDiscountStatus;
  usage_count: number;
  total_discount_value: string;
  note: string;
  created_by?: number | null;
  created_by_name?: string | null;
  updated_by?: number | null;
  created_at: string;
  updated_at: string;
  is_currently_active: boolean;
}

export interface SalesDiscountSummary {
  total_count: number;
  active_count: number;
  inactive_count: number;
  currently_active_count: number;
  scheduled_count: number;
  expired_count: number;
  total_usage: number;
  total_discount_value: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ── Material Plan types ────────────────────────────────────────────────────────

export type SalesLineMaterialPlanStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'PARTIAL_ORDERED'
  | 'PARTIAL_RECEIVED'
  | 'READY';

export interface SalesLineMaterialPlanItem {
  id: number;
  template_group: number | null;
  template_option: number | null;
  group_code_snapshot: string;
  group_name_snapshot: string;
  material_role: string;
  selection_rule: string;
  material_product: number;
  material_product_code: string;
  material_product_name: string;
  material_product_unit_name: string | null;
  spec_snapshot: Record<string, unknown>;
  is_selected: boolean;
  required_qty: string;
  ordered_qty_cache: string;
  received_qty_cache: string;
  available_qty_cache: string;
  short_qty_cache: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface SalesLineMaterialPlan {
  id: number;
  sales_order: number;
  sales_order_code: string;
  sales_order_line: number;
  sales_order_line_number: number;
  finished_product: number;
  finished_product_code: string;
  finished_product_name: string;
  template: number | null;
  ordered_finished_qty: string;
  status: SalesLineMaterialPlanStatus;
  note: string;
  confirmed_by: number | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  items: SalesLineMaterialPlanItem[];
}

export interface SalesMaterialCommandCenterRow {
  plan_id: number;
  sales_order_id: number;
  sales_order_code: string;
  sales_order_line_id: number;
  sales_order_line_number: number;
  customer_name: string;
  finished_product_code: string;
  finished_product_name: string;
  ordered_finished_qty: string;
  plan_status: SalesLineMaterialPlanStatus;
  has_shortage: boolean;
  has_overdue_delivery: boolean;
  ready_for_delivery: boolean;
  delivery_plans: Array<{
    delivery_date: string;
    qty: string;
    is_overdue: boolean;
    days_until_due: number | null;
  }>;
  material_groups: Array<{
    group_code: string;
    group_name: string;
    material_role: string;
    selection_rule: string;
    selected_option: SalesLineMaterialPlanItem | null;
    options: SalesLineMaterialPlanItem[];
    is_shortage: boolean;
    short_qty: string;
  }>;
  production_summary: {
    has_production_order: boolean;
    active_count: number;
    completed_count: number;
    overdue_plan_count: number;
  };
}

export interface SalesMaterialCommandCenterSummary {
  total: number;
  has_shortage: number;
  has_overdue_delivery: number;
  ready_for_delivery: number;
  status_breakdown: Record<SalesLineMaterialPlanStatus, number>;
}

export interface SalesMaterialCommandCenterResponse {
  count: number;
  summary: SalesMaterialCommandCenterSummary;
  results: SalesMaterialCommandCenterRow[];
}

export type { ProductCategory, ProductUnit } from './product';
