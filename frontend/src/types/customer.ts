/** Customer — khách hàng, có approval flow (DRAFT → PENDING_APPROVAL → APPROVED/REJECTED) */
export interface Customer {
  id: number;
  code: string;
  name: string;
  company_name?: string;
  tax_code?: string;
  phone?: string;
  email?: string;
  address?: string;
  contact_person?: string;
  contact_phone?: string;
  payment_terms?: number;
  credit_limit?: number;
  is_active: boolean;
  status: CustomerStatus;
  owner?: number;
  owner_name?: string;
  team?: number;
  team_name?: string;
  approved_by?: number;
  approved_at?: string;
  rejected_by?: number;
  rejected_at?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
  created_by?: number;
  created_by_username?: string;
  updated_by?: number;
  updated_by_username?: string;
}

export type CustomerStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  DRAFT: 'Nháp',
  PENDING_APPROVAL: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
};

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface CustomerFormData {
  code?: string;
  name: string;
  company_name?: string;
  tax_code?: string;
  phone?: string;
  email?: string;
  address?: string;
  contact_person?: string;
  contact_phone?: string;
  payment_terms?: number;
  credit_limit?: number;
  is_active: boolean;
  owner?: number;
  team?: number;
}

export interface ApprovalHistoryItem {
  action: string;
  user: string | null;
  comments?: string;
  level: number;
  created_at: string;
}
