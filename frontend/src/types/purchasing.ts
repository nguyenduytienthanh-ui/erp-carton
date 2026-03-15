export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PARTIAL_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

export type PurchaseReceiptStatus = 'POSTED' | 'CANCELLED';

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface MaterialPurchasePrice {
  id: number;
  product: number;
  product_code?: string;
  product_name?: string;
  supplier?: number | null;
  supplier_code?: string;
  supplier_name?: string;
  unit_price: string;
  currency: string;
  uom: string;
  effective_from: string;
  effective_to?: string | null;
  min_quantity?: string | null;
  note?: string;
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  company_name: string;
  tax_code: string;
  phone: string;
  email: string;
  address: string;
  contact_person: string;
  contact_phone: string;
  payment_terms_days: number;
  is_preferred: boolean;
  rating: number;
  note: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderLine {
  id?: number;
  line_number?: number;
  product: number;
  product_code?: string | null;
  product_name?: string | null;
  internal_product_code?: string;
  product_snapshot?: Record<string, unknown>;
  uom?: string;
  qty: string;
  received_qty?: string;
  remaining_qty?: string;
  unit_price: string;
  discount_pct?: string;
  tax_pct?: string;
  line_subtotal?: string;
  discount_amount?: string;
  tax_amount?: string;
  line_total?: string;
  note?: string;
}

export interface PurchaseOrder {
  id: number;
  code: string;
  doc_type: string;
  order_date: string;
  expected_receipt_date?: string | null;
  status: PurchaseOrderStatus;
  reference?: string;
  supplier: number;
  supplier_name?: string | null;
  supplier_snapshot?: Record<string, unknown>;
  warehouse?: number | null;
  warehouse_name?: string | null;
  location?: number | null;
  location_name?: string | null;
  currency: string;
  exchange_rate: string;
  payment_terms_days: number;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  notes?: string;
  reject_reason?: string;
  cancel_reason?: string;
  version?: number;
  lines: PurchaseOrderLine[];
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderFormValues {
  order_date: string;
  expected_receipt_date?: string | null;
  supplier: number | null;
  warehouse?: number | null;
  location?: number | null;
  reference?: string;
  currency?: string;
  exchange_rate?: number;
  payment_terms_days?: number;
  notes?: string;
  version?: number;
  lines: Array<{
    line_number?: number;
    product: number;
    uom?: string;
    product_snapshot?: Record<string, unknown>;
    qty: number;
    unit_price: number;
    discount_pct?: number;
    tax_pct?: number;
    note?: string;
  }>;
}

export interface PurchaseReceiptLine {
  id: number;
  line_number: number;
  purchase_order_line?: number | null;
  purchase_order_line_number?: number | null;
  product: number;
  product_code?: string | null;
  product_name?: string | null;
  product_snapshot?: Record<string, unknown>;
  quantity: string;
  unit_cost: string;
  line_total: string;
  note?: string;
  inventory_transaction?: number | null;
  inventory_transaction_code?: string | null;
}

export interface PurchaseReceipt {
  id: number;
  code: string;
  purchase_order: number;
  purchase_order_code?: string | null;
  receipt_date: string;
  status: PurchaseReceiptStatus;
  reference?: string;
  supplier_snapshot?: Record<string, unknown>;
  supplier_name?: string | null;
  warehouse?: number | null;
  warehouse_name?: string | null;
  location?: number | null;
  location_name?: string | null;
  total_qty: string;
  total_amount: string;
  note?: string;
  posted_at: string;
  posted_by?: number | null;
  cancelled_at?: string | null;
  cancelled_by?: number | null;
  cancel_reason?: string;
  created_at: string;
  updated_at: string;
  lines: PurchaseReceiptLine[];
}

export interface PurchaseApprovalHistoryItem {
  action: string;
  user?: string | null;
  comments?: string | null;
  created_at: string;
}

/** Yêu cầu mua (Purchase Request) */
export type PurchaseRequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface PurchaseRequestLine {
  id: number;
  line_number: number;
  product: number;
  product_code?: string;
  product_name?: string;
  qty: string;
  note: string;
}

export interface PurchaseRequest {
  id: number;
  code: string;
  request_date: string;
  status: PurchaseRequestStatus;
  reference: string;
  notes: string;
  requested_by: number | null;
  requested_by_name: string | null;
  approved_by: number | null;
  approved_at: string | null;
  rejected_by: number | null;
  rejected_at: string | null;
  reject_reason: string;
  created_by: number | null;
  created_at: string;
  updated_by: number | null;
  updated_at: string;
  lines?: PurchaseRequestLine[];
}

export type PurchaseReturnStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED' | 'CANCELLED';

export interface PurchaseReturnLine {
  id: number;
  line_number: number;
  product: number;
  product_code?: string;
  product_name?: string;
  qty: string;
  unit_price: string;
  tax_pct: string;
  note: string;
}

export interface PurchaseReturn {
  id: number;
  code: string;
  return_date: string;
  status: PurchaseReturnStatus;
  reference: string;
  purchase_order?: number | null;
  purchase_order_code?: string | null;
  supplier: number;
  supplier_name?: string;
  subtotal: string;
  tax_total: string;
  total: string;
  return_reason: string;
  return_notes: string;
  submitted_by?: number | null;
  submitted_at?: string | null;
  approved_by?: number | null;
  approved_at?: string | null;
  posted_by?: number | null;
  posted_at?: string | null;
  cancelled_by?: number | null;
  cancelled_at?: string | null;
  cancel_reason?: string;
  created_by?: number | null;
  created_at: string;
  updated_by?: number | null;
  updated_at: string;
  lines?: PurchaseReturnLine[];
}

