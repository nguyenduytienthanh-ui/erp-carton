import axiosInstance from './axios';
import type { PaginatedResponse } from '../types/finance';
import type {
  ReceivableDocument as ReceivableDocumentView,
  ReceivablePayment,
} from '../types/accountsReceivable';
import type {
  ReceivableDocument as ReceivableDocumentRecord,
  ReceivableSettlement,
} from '../types/finance';

type ReceivablePaymentPayload = Record<string, unknown>;
type ActionResponse = Record<string, unknown>;

const mapReceivableStatus = (status: string, daysOverdue?: number): string => {
  if (status === 'CANCELLED') return 'CANCELLED';
  if ((daysOverdue || 0) > 0 && status !== 'SETTLED') return 'OVERDUE';
  if (status === 'OPEN') return 'POSTED';
  if (status === 'PARTIAL') return 'PARTIAL_PAID';
  if (status === 'SETTLED') return 'PAID';
  return status;
};

const transformSettlement = (item: ReceivableSettlement): ReceivablePayment => ({
  id: item.id,
  settlement_date: item.settlement_date,
  amount: Number(item.amount || 0),
  payment_method: item.source_type,
  reference: item.source_bank_account_code || item.source_cash_account_name || '',
  note: item.note || '',
  created_by_name: '',
});

const transformReceivable = (item: ReceivableDocumentRecord): ReceivableDocumentView => ({
  id: item.id,
  code: item.code,
  customer_id: item.customer ?? null,
  customer_name: item.customer_name ?? '',
  customer_code: item.customer_code ?? '',
  invoice_date: item.document_date,
  invoice_number: item.reference || item.code,
  due_date: item.due_date,
  sales_order: item.source_sales_order ?? null,
  sales_order_code: item.source_sales_order_code ?? null,
  amount: Number(item.total_amount || 0),
  paid_amount: Number(item.settled_amount || 0),
  outstanding_amount: Number(item.remaining_amount || 0),
  status: mapReceivableStatus(item.status, item.days_overdue) as ReceivableDocumentView['status'],
  days_overdue: item.days_overdue || 0,
  payments: Array.isArray(item.settlements) ? item.settlements.map(transformSettlement) : [],
  note: item.note || '',
  created_at: item.created_at,
  updated_at: item.updated_at,
});

export const accountsReceivableApi = {
  getReceivables: async (params?: Record<string, unknown>): Promise<PaginatedResponse<ReceivableDocumentView>> => {
    const normalizedParams = {
      ...params,
      search: params?.search || params?.q,
      customer: params?.customer_id || params?.customer,
      overdue_only: params?.aging_bucket ? 'true' : undefined,
    };
    const response = await axiosInstance.get<PaginatedResponse<ReceivableDocumentRecord>>('/finance/receivables/', { params: normalizedParams });
    return {
      ...response.data,
      results: (response.data?.results || []).map(transformReceivable),
    };
  },

  getReceivable: async (id: number): Promise<ReceivableDocumentView> => {
    const response = await axiosInstance.get<ReceivableDocumentRecord>(`/finance/receivables/${id}/`);
    return transformReceivable(response.data);
  },

  deleteReceivable: async (id: number): Promise<ActionResponse> => {
    const response = await axiosInstance.post<ActionResponse>(`/finance/receivables/${id}/cancel/`, { reason: 'Há»§y tá»« giao diá»‡n' });
    return response.data;
  },

  receivePayment: async (id: number, data: ReceivablePaymentPayload): Promise<ReceivableDocumentView> => {
    const response = await axiosInstance.post<ReceivableDocumentRecord>(`/finance/receivables/${id}/collect/`, data);
    return transformReceivable(response.data);
  },

  cancelReceivable: async (id: number, reason: string): Promise<ActionResponse> => {
    const response = await axiosInstance.post<ActionResponse>(`/finance/receivables/${id}/cancel/`, { reason });
    return response.data;
  },

  getPayments: async (id: number): Promise<ReceivablePayment[]> => {
    const response = await axiosInstance.get<ReceivableSettlement[]>(`/finance/receivables/${id}/settlements/`);
    return (response.data || []).map(transformSettlement);
  },
};
