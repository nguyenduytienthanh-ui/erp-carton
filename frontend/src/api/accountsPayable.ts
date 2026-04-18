import axiosInstance from './axios';
import type { PaginatedResponse } from '../types/finance';
import type {
  PayableDocument as PayableDocumentView,
  PayablePayment,
} from '../types/accountsPayable';
import type {
  PayableDocument as PayableDocumentRecord,
  PayableSettlement,
} from '../types/finance';

type PayablePaymentPayload = Record<string, unknown>;
type ActionResponse = Record<string, unknown>;

const mapPayableStatus = (status: string, daysOverdue?: number): string => {
  if (status === 'CANCELLED') return 'CANCELLED';
  if ((daysOverdue || 0) > 0 && status !== 'SETTLED') return 'OVERDUE';
  if (status === 'OPEN') return 'POSTED';
  if (status === 'PARTIAL') return 'PARTIAL_PAID';
  if (status === 'SETTLED') return 'PAID';
  return status;
};

const transformSettlement = (item: PayableSettlement): PayablePayment => ({
  id: item.id,
  settlement_date: item.settlement_date,
  amount: Number(item.amount || 0),
  payment_method: item.source_type,
  reference: item.source_bank_account_code || item.source_cash_account_name || '',
  note: item.note || '',
  created_by_name: '',
});

const transformPayable = (item: PayableDocumentRecord): PayableDocumentView => ({
  id: item.id,
  code: item.code,
  supplier_id: item.supplier ?? null,
  supplier_name: item.supplier_name ?? '',
  supplier_code: item.supplier_code ?? '',
  bill_date: item.document_date,
  bill_number: item.vendor_invoice_no || item.code,
  due_date: item.due_date,
  purchase_order: null,
  purchase_order_code: item.source_purchase_order_code ?? null,
  amount: Number(item.total_amount || 0),
  paid_amount: Number(item.settled_amount || 0),
  outstanding_amount: Number(item.remaining_amount || 0),
  status: mapPayableStatus(item.status, item.days_overdue) as PayableDocumentView['status'],
  days_overdue: item.days_overdue || 0,
  payments: Array.isArray(item.settlements) ? item.settlements.map(transformSettlement) : [],
  note: item.note || '',
  created_at: item.created_at,
  updated_at: item.updated_at,
});

export const accountsPayableApi = {
  getPayables: async (params?: Record<string, unknown>): Promise<PaginatedResponse<PayableDocumentView>> => {
    const normalizedParams = {
      ...params,
      search: params?.search || params?.q,
      supplier: params?.supplier_id || params?.supplier,
      overdue_only: params?.aging_bucket ? 'true' : undefined,
    };
    const response = await axiosInstance.get<PaginatedResponse<PayableDocumentRecord>>('/finance/payables/', { params: normalizedParams });
    return {
      ...response.data,
      results: (response.data?.results || []).map(transformPayable),
    };
  },

  getPayable: async (id: number): Promise<PayableDocumentView> => {
    const response = await axiosInstance.get<PayableDocumentRecord>(`/finance/payables/${id}/`);
    return transformPayable(response.data);
  },

  deletePayable: async (id: number): Promise<ActionResponse> => {
    const response = await axiosInstance.post<ActionResponse>(`/finance/payables/${id}/cancel/`, { reason: 'Há»§y tá»« giao diá»‡n' });
    return response.data;
  },

  recordPayment: async (id: number, data: PayablePaymentPayload): Promise<PayableDocumentView> => {
    const response = await axiosInstance.post<PayableDocumentRecord>(`/finance/payables/${id}/pay/`, data);
    return transformPayable(response.data);
  },

  cancelPayable: async (id: number, reason: string): Promise<ActionResponse> => {
    const response = await axiosInstance.post<ActionResponse>(`/finance/payables/${id}/cancel/`, { reason });
    return response.data;
  },

  getPayments: async (id: number): Promise<PayablePayment[]> => {
    const response = await axiosInstance.get<PayableSettlement[]>(`/finance/payables/${id}/settlements/`);
    return (response.data || []).map(transformSettlement);
  },
};
