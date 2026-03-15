export type QuoteStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CONVERTED' | 'EXPIRED' | 'CANCELLED';

export interface QuoteLine {
  id?: number;
  line_number: number;
  product_id: number;
  product_code?: string;
  product_name?: string;
  qty: number;
  unit_price: number;
  discount_pct?: number;
  tax_pct?: number;
  line_total?: number;
  notes?: string;
}

export interface Quote {
  id?: number;
  code: string;
  customer_id: number;
  customer_name?: string;
  customer_code?: string;
  quote_date: string;
  expiry_date: string;
  valid_until_date?: string;
  status: QuoteStatus;
  
  // Tính toán
  subtotal?: number;
  discount_amount?: number;
  tax_amount?: number;
  total?: number;
  
  // Chuyển đơn
  converted_order_id?: number | null;
  converted_order_code?: string | null;
  conversion_date?: string | null;
  
  // Thông tin
  lines?: QuoteLine[];
  notes?: string;
  
  // Audit
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
}
