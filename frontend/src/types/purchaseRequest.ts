export type PurchaseRequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface PurchaseRequestLine {
  id?: number;
  line_number: number;
  product_id: number;
  product_code?: string;
  product_name?: string;
  qty: number;
  note?: string;
}

export interface PurchaseRequest {
  id?: number;
  code: string;
  request_date: string;
  status: PurchaseRequestStatus;
  reference?: string;
  lines?: PurchaseRequestLine[];
  notes?: string;
  
  // Approval workflow
  requested_by_name?: string;
  approved_by_name?: string;
  approved_at?: string;
  rejected_by_name?: string;
  rejected_at?: string;
  reject_reason?: string;
  
  // Audit
  created_by_name?: string;
  created_at?: string;
  updated_at?: string;
}
