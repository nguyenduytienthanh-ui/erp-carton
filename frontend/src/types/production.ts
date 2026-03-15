export type ProductionOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'RELEASED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export type ProductionOperationStatus = 'PENDING' | 'READY' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED';
export type ProductionIssueStatus = 'POSTED' | 'CANCELLED';
export type ProductionReceiptStatus = 'POSTED' | 'CANCELLED';

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ProductionOperation {
  id: number;
  sequence: number;
  step_code: string;
  step_name: string;
  source_field?: string;
  rate_per_hour: string;
  planned_qty: string;
  completed_qty: string;
  scrap_qty: string;
  status: ProductionOperationStatus;
  started_at?: string | null;
  finished_at?: string | null;
  note?: string;
  created_at: string;
  updated_at: string;
}

export interface ProductionMaterialRequirement {
  id?: number;
  line_number?: number;
  material_product: number;
  material_product_code?: string | null;
  material_product_name?: string | null;
  internal_product_code?: string;
  product_snapshot?: Record<string, unknown>;
  required_qty: string;
  issued_qty?: string;
  remaining_issue_qty?: string;
  source_warehouse?: number | null;
  source_warehouse_name?: string | null;
  source_location?: number | null;
  source_location_name?: string | null;
  note?: string;
}

export interface ProductionOrder {
  id: number;
  code: string;
  doc_type: string;
  order_date: string;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  status: ProductionOrderStatus;
  reference?: string;
  sales_order?: number | null;
  sales_order_code?: string | null;
  sales_order_line?: number | null;
  sales_order_line_number?: number | null;
  product: number;
  product_code?: string | null;
  product_name?: string | null;
  product_snapshot?: Record<string, unknown>;
  planned_qty: string;
  produced_qty: string;
  remaining_qty?: string;
  scrap_qty: string;
  unit_cost_estimate: string;
  estimated_output_value: string;
  target_warehouse?: number | null;
  target_warehouse_name?: string | null;
  target_location?: number | null;
  target_location_name?: string | null;
  notes?: string;
  reject_reason?: string;
  cancel_reason?: string;
  version?: number;
  material_requirements: ProductionMaterialRequirement[];
  operations: ProductionOperation[];
  created_at: string;
  updated_at: string;
}

export interface ProductionIssueLine {
  id: number;
  line_number: number;
  material_requirement?: number | null;
  material_requirement_line_number?: number | null;
  material_product: number;
  material_product_code?: string | null;
  material_product_name?: string | null;
  product_snapshot?: Record<string, unknown>;
  warehouse?: number | null;
  warehouse_name?: string | null;
  location?: number | null;
  location_name?: string | null;
  quantity: string;
  unit_cost: string;
  line_total: string;
  note?: string;
  inventory_transaction?: number | null;
  inventory_transaction_code?: string | null;
}

export interface ProductionIssue {
  id: number;
  code: string;
  production_order: number;
  production_order_code?: string | null;
  issue_date: string;
  status: ProductionIssueStatus;
  reference?: string;
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
  lines: ProductionIssueLine[];
}

export interface ProductionReceiptLine {
  id: number;
  line_number: number;
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

export interface ProductionReceipt {
  id: number;
  code: string;
  production_order: number;
  production_order_code?: string | null;
  receipt_date: string;
  status: ProductionReceiptStatus;
  reference?: string;
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
  lines: ProductionReceiptLine[];
}

export interface ProductionOrderFormValues {
  order_date: string;
  planned_start_date?: string | null;
  planned_end_date?: string | null;
  reference?: string;
  sales_order?: number | null;
  sales_order_line?: number | null;
  product: number;
  planned_qty: number;
  unit_cost_estimate?: number;
  target_warehouse?: number | null;
  target_location?: number | null;
  notes?: string;
  version?: number;
  material_requirements?: Array<{
    line_number?: number;
    material_product: number;
    required_qty: number;
    source_warehouse?: number | null;
    source_location?: number | null;
    note?: string;
  }>;
}

export interface ProductionApprovalHistoryItem {
  action: string;
  user?: string | null;
  comments?: string | null;
  created_at: string;
}
