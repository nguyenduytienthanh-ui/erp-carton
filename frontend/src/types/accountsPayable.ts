export type PayableDocumentStatus = 'POSTED' | 'PARTIAL_PAID' | 'PAID' | 'OVERDUE' | 'WRITTEN_OFF' | 'CANCELLED';

export interface PayableLineItem {
  id?: number;
  line_number: number;
  description: string;
  amount: number;
  paid_amount?: number;
  outstanding_amount?: number;
}

export interface PayablePayment {
  id?: number;
  settlement_date: string;
  amount: number;
  payment_method: string;
  reference?: string;
  note?: string;
  created_by_name?: string;
}

export interface PayableDocument {
  id?: number;
  code: string;
  supplier_id: number | null;
  supplier_name?: string;
  supplier_code?: string;
  bill_date: string;
  bill_number: string;
  due_date: string;
  purchase_order?: number | null;
  purchase_order_code?: string | null;
  
  amount: number;
  paid_amount: number;
  outstanding_amount: number;
  
  status: PayableDocumentStatus;
  days_overdue?: number;
  
  line_items?: PayableLineItem[];
  payments?: PayablePayment[];
  
  note?: string;
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PaymentSchedule {
  due_date: string;
  amount_due: number;
  status: 'pending' | 'partial' | 'paid';
  documents_count: number;
}
