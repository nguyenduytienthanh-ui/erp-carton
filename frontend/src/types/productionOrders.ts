export type ProductionOrderStatus = 'DRAFT' | 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type ProductionIssueType = 'MATERIAL' | 'COMPONENT' | 'RETURN';

export interface ProductionOrderLine {
  id?: number;
  line_number: number;
  product_id: number;
  product_code?: string;
  product_name?: string;
  quantity: number;
  uom?: string;
  notes?: string;
}

export interface ProductionIssue {
  id?: number;
  production_order_id: number;
  production_order_code?: string;
  product_id: number;
  product_code?: string;
  product_name?: string;
  quantity_issued: number;
  issue_type: ProductionIssueType;
  warehouse_from?: number;
  warehouse_to?: number;
  issued_at: string;
  issued_by_name?: string;
  note?: string;
}

export interface ProductionOrder {
  id?: number;
  code: string;
  product_id: number;
  product_code?: string;
  product_name?: string;
  
  quantity: number;
  uom?: string;
  
  status: ProductionOrderStatus;
  start_date?: string;
  end_date?: string;
  target_end_date: string;
  
  // Tiến độ
  completed_quantity?: number;
  progress_percentage?: number;
  
  // Công đoạn
  routing?: Array<Record<string, unknown>>;
  bom?: Array<Record<string, unknown>>;
  
  // Người dùng
  created_by_name?: string;
  started_by_name?: string;
  completed_by_name?: string;
  
  // Thời gian
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  completed_at?: string;
  
  // Ghi chú
  notes?: string;
  
  // Phát hành
  issues?: ProductionIssue[];
}

export interface ProductionStats {
  total_orders: number;
  in_progress: number;
  completed: number;
  overdue: number;
  total_quantity: number;
  completed_quantity: number;
}
