export interface ProductCategory {
  id: number;
  code: string;
  name: string;
  description?: string;
  parent?: number;
  parent_name?: string;
  children_count?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductUnit {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductWave {
  id: number;
  code: string;
  name: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductBoxType {
  id: number;
  code: string;
  name: string;
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ProductBundlePricingMode = 'PRIMARY_PRODUCT' | 'FIXED_BUNDLE' | 'SUM_COMPONENTS';
export type ProductBundleCommissionMode = 'PRIMARY_PRODUCT' | 'FIXED_VALUES' | 'SUM_COMPONENTS';
export type ProductBundleDeliveryRule = 'STRICT_FULL_SET' | 'NON_SYNC';
export type ProductOperationCode = 'XA' | 'IN' | 'CAN_MANG' | 'BOI' | 'BE' | 'CHAP' | 'DONG' | 'DAN' | 'KHAC';
export type ProductOperationNotes = Partial<Record<ProductOperationCode, string>>;

export interface ProductOperation {
  id: number | null;
  operation_id?: number | null;
  operation_code: ProductOperationCode;
  operation_name: string;
  sequence: number;
  standard_rate_per_hour: number;
  note?: string;
  is_active: boolean;
}

export interface ProductOperationInput {
  operation_code: ProductOperationCode;
  standard_rate_per_hour: number;
  note?: string;
}

export interface ProductBundleComponent {
  id: number;
  component_product: number;
  component_product_code?: string;
  component_product_name?: string;
  component_product_unit_name?: string | null;
  qty_per_bundle: string;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface ProductBundleComponentInput {
  component_product: number;
  qty_per_bundle: string;
  is_required?: boolean;
  sort_order?: number;
  is_active?: boolean;
}

export interface ProductBundleDefinition {
  id: number;
  sellable_product: number;
  sellable_product_code?: string;
  primary_product?: number | null;
  primary_product_name?: string | null;
  pricing_mode: ProductBundlePricingMode;
  fixed_cost_price?: string;
  fixed_sale_price?: string;
  commission_mode: ProductBundleCommissionMode;
  fixed_commission_per_unit?: string;
  fixed_commission_percent?: string;
  delivery_rule: ProductBundleDeliveryRule;
  note?: string;
  is_active: boolean;
  components: ProductBundleComponent[];
  resolved_cost_price?: string;
  resolved_sale_price?: string;
  resolved_commission_per_unit?: string;
  resolved_commission_percent?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ProductBundleUpsertPayload {
  sellable_product: number;
  primary_product?: number | null;
  pricing_mode: ProductBundlePricingMode;
  fixed_cost_price?: string;
  fixed_sale_price?: string;
  commission_mode: ProductBundleCommissionMode;
  fixed_commission_per_unit?: string;
  fixed_commission_percent?: string;
  delivery_rule: ProductBundleDeliveryRule;
  note?: string;
  is_active?: boolean;
  components: ProductBundleComponentInput[];
}

export type ProductKind = 'SPECIFIC' | 'GENERIC';

export interface Product {
  id: number;
  code: string;
  name: string;

  // Category & Unit
  category?: number;
  category_name?: string;
  unit: number;
  unit_name?: string;
  description?: string;
  product_kind: ProductKind;
  requires_order_spec: boolean;
  requires_order_operations_review: boolean;

  // ============ KÍCH THƯỚC ============
  size_order?: string;
  size_production?: string;
  wave?: number;
  wave_code?: string;
  wave_name?: string;
  box_type?: number;
  box_type_code?: string;
  box_type_name?: string;

  // ============ GIÁ & SỐ LƯỢNG ============
  cost_price: string;
  sale_price: string;
  min_stock: string;

  // ============ GIAO HÀNG ============
  delivery_tolerance?: string;

  // ============ HOA HỒNG ============
  commission_per_unit?: string;
  commission_percent?: string;

  // ============ CÔNG ĐOẠN SẢN XUẤT (cái/giờ) ============
  process_xa?: number | null;
  process_in?: number | null;
  process_boi?: number | null;
  process_can_mang?: number | null;
  process_be?: number | null;
  process_chap?: number | null;
  process_dong?: number | null;
  process_dan?: number | null;
  process_khac?: number | null;
  operations?: ProductOperation[];

  // ============ IN ẤN ============
  film_code?: string;
  film_file_url?: string;
  color_count?: number;
  print_color_1?: string;
  print_color_2?: string;
  print_color_3?: string;
  print_color_4?: string;
  print_color_5?: string;
  print_colors?: string[];

  // ============ BẾ ============
  mold_code?: string;
  mold_file_url?: string;

  // ============ CHỐNG THẤM ============
  waterproof?: '' | 'INSIDE' | 'OUTSIDE' | 'BOTH';

  // ============ GHI CHÚ ============
  note_other?: string;
  note?: string;

  // ============ BOM - THÙNG MẸ/CON ============
  parent?: number | null;
  parent_name?: string;
  component_quantity?: number;
  is_set?: boolean;
  bundle_id?: number | null;
  components?: Product[];
  bundle_definition?: ProductBundleDefinition | null;
  bundle_components?: ProductBundleComponent[];
  bundle_pricing_mode?: ProductBundlePricingMode | null;
  bundle_commission_mode?: ProductBundleCommissionMode | null;
  bundle_delivery_rule?: ProductBundleDeliveryRule | null;
  bundle_primary_product_id?: number | null;
  bundle_primary_product_name?: string | null;
  resolved_bundle_cost_price?: string;
  resolved_bundle_sale_price?: string;
  resolved_bundle_commission_per_unit?: string;
  resolved_bundle_commission_percent?: string;

  // ============ TRẠNG THÁI ============
  status: 'DRAFT' | 'ACTIVE' | 'DISCONTINUED';
  has_pending_price_change?: boolean;
  has_scheduled_price_change?: boolean;
  price_workflow_status?: 'PENDING_APPROVAL' | 'APPROVED_SCHEDULED' | 'ACTIVE_APPLIED';
  next_price_effective_at?: string | null;
  next_price_cost?: string | null;
  next_price_sale?: string | null;
  next_price_commission_per_unit?: string | null;
  next_price_commission_percent?: string | null;
  blocking_tasks_count?: number;

  // ============ PHÂN QUYỀN ============
  owner?: number;
  owner_name?: string;
  team?: number;
  team_name?: string;
  is_active: boolean;

  // ============ AUDIT ============
  created_at: string;
  updated_at: string;
  created_by?: number;
  created_by_name?: string;
  updated_by?: number;
  updated_by_name?: string;
}

export interface ProductFormData {
  name: string;
  code?: string;
  category?: number;
  unit: number;
  description?: string;
  product_kind?: ProductKind;
  requires_order_spec?: boolean;
  requires_order_operations_review?: boolean;

  size_order?: string;
  size_production?: string;
  wave?: number;
  box_type?: number;

  cost_price: number;
  sale_price: number;
  min_stock: number;

  delivery_tolerance?: string;
  commission_per_unit?: number;
  commission_percent?: number;

  process_xa?: number | string;
  process_in?: number | string;
  process_boi?: number | string;
  process_can_mang?: number | string;
  process_be?: number | string;
  process_chap?: number | string;
  process_dong?: number | string;
  process_dan?: number | string;
  process_khac?: number | string;
  operation_notes?: ProductOperationNotes;
  operations_input?: ProductOperationInput[];

  film_code?: string;
  film_file_url?: string;
  color_count?: number;
  print_color_1?: string;
  print_color_2?: string;
  print_color_3?: string;
  print_color_4?: string;
  print_color_5?: string;
  mold_code?: string;
  mold_file_url?: string;
  waterproof?: string;

  note_other?: string;
  note?: string;

  is_active?: boolean;
  is_set?: boolean;
  parent?: number;
  component_quantity?: number;

  status: string;
  price_change_reason?: string;
  price_effective_at?: string;
  skip_price_floor_validation?: boolean;
}

/** Dữ liệu form một thành phần con (Lót, Khay...) – nhập riêng, không kế thừa Mẹ; code tự sinh Mã Mẹ-1, Mã Mẹ-2... */
export interface ProductChildFormData {
  id?: number; /** Có khi load từ API (sửa) — dùng để update/delete */
  name: string;
  component_quantity: number; /* số lượng / bộ, bắt buộc */
  category?: number;
  unit: number; /* ĐVT bắt buộc */
  cost_price?: number;
  sale_price?: number;
  commission_per_unit?: number;
  commission_percent?: number;
  size_order?: string;
  size_production?: string;
  wave?: number;
  box_type?: number;
  delivery_tolerance?: string;
  process_xa?: number | string;
  process_in?: number | string;
  process_boi?: number | string;
  process_can_mang?: number | string;
  process_be?: number | string;
  process_chap?: number | string;
  process_dong?: number | string;
  process_dan?: number | string;
  process_khac?: number | string;
  operation_notes?: ProductOperationNotes;
  film_code?: string;
  film_file_url?: string;
  color_count?: number;
  print_color_1?: string;
  print_color_2?: string;
  print_color_3?: string;
  print_color_4?: string;
  print_color_5?: string;
  mold_code?: string;
  mold_file_url?: string;
  waterproof?: string;
  note_other?: string;
  note?: string;
  price_change_reason?: string;

  is_active?: boolean;
  status?: 'DRAFT' | 'ACTIVE' | 'DISCONTINUED';
}

export const WATERPROOF_OPTIONS = [
  { label: 'Không', value: '' },
  { label: 'Trong', value: 'INSIDE' },
  { label: 'Ngoài', value: 'OUTSIDE' },
  { label: '2 mặt', value: 'BOTH' },
];

export const BOX_TYPES = ['A1', 'A2', 'A3', 'A5', 'B1', 'B2', 'C1'];
export const WAVE_TYPES = ['A', 'B', 'C', 'E', 'BC', 'BE', 'EB'];

export interface ProductPricing {
  id: number;
  product: number;
  product_name?: string;
  customer?: number;
  customer_name?: string;
  min_quantity: string;
  unit_price: string;
  effective_from: string;
  effective_to?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
