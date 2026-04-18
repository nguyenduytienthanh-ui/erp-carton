export type ReceivableDocumentStatus = 'POSTED' | 'PARTIAL_PAID' | 'PAID' | 'OVERDUE' | 'WRITTEN_OFF' | 'CANCELLED';

export interface ReceivableLineItem {
  id?: number;
  line_number: number;
  description: string;
  amount: number;
  paid_amount?: number;
  outstanding_amount?: number;
}

export interface ReceivablePayment {
  id?: number;
  settlement_date: string;
  amount: number;
  payment_method: string;
  reference?: string;
  note?: string;
  created_by_name?: string;
}

export interface ReceivableDocument {
  id?: number;
  code: string;
  customer_id: number | null;
  customer_name?: string;
  customer_code?: string;
  invoice_date: string;
  invoice_number: string;
  due_date: string;
  sales_order?: number | null;
  sales_order_code?: string | null;
  
  amount: number;
  paid_amount: number;
  outstanding_amount: number;
  
  status: ReceivableDocumentStatus;
  days_overdue?: number;
  
  line_items?: ReceivableLineItem[];
  payments?: ReceivablePayment[];
  
  note?: string;
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AgingBucket {
  bucket_name: string;
  bucket_days: string;
  invoice_count: number;
  total_outstanding: number;
  customer_count: number;
}

export interface CustomerAgingDetail {
  customer_id: number;
  customer_name: string;
  customer_code: string;
  total_outstanding: number;
  invoices: ReceivableDocument[];
}
