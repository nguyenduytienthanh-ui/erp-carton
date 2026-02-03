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

  // ============ KÍCH THƯỚC ============
  size_order?: string;
  size_production?: string;
  wave_type?: string;
  box_type?: string;

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

  // ============ IN ẤN ============
  film_code?: string;
  film_file_url?: string;
  color_count?: number;

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
  components?: Product[];

  // ============ TRẠNG THÁI ============
  status: 'DRAFT' | 'ACTIVE' | 'DISCONTINUED';

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
  category?: number;
  unit: number;
  description?: string;

  size_order?: string;
  size_production?: string;
  wave_type?: string;
  box_type?: string;

  cost_price: number;
  sale_price: number;
  min_stock: number;

  delivery_tolerance?: string;
  commission_per_unit?: number;
  commission_percent?: number;

  process_xa?: number;
  process_in?: number;
  process_boi?: number;
  process_can_mang?: number;
  process_be?: number;
  process_chap?: number;
  process_dong?: number;
  process_dan?: number;
  process_khac?: number;

  film_code?: string;
  film_file_url?: string;
  color_count?: number;
  mold_code?: string;
  mold_file_url?: string;
  waterproof?: string;

  note_other?: string;
  note?: string;

  is_set?: boolean;
  parent?: number;
  component_quantity?: number;

  status: string;
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
