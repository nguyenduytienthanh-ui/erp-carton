import axiosInstance from './axios';
import type { PaginatedResponse } from '../types/finance';

const mapReceivableStatus = (status: string, daysOverdue?: number): string => {
  if (status === 'CANCELLED') return 'CANCELLED';
  if ((daysOverdue || 0) > 0 && status !== 'SETTLED') return 'OVERDUE';
  if (status === 'OPEN') return 'POSTED';
  if (status === 'PARTIAL') return 'PARTIAL_PAID';
  if (status === 'SETTLED') return 'PAID';
  return status;
};

const transformSettlement = (item: any) => ({
  id: item.id,
  settlement_date: item.settlement_date,
  amount: Number(item.amount || 0),
  payment_method: item.source_type,
  reference: item.source_bank_account_code || item.source_cash_account_name || '',
  note: item.note || '',
  created_by_name: '',
});

const transformReceivable = (item: any) => ({
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
  status: mapReceivableStatus(item.status, item.days_overdue),
  days_overdue: item.days_overdue || 0,
  payments: Array.isArray(item.settlements) ? item.settlements.map(transformSettlement) : [],
  note: item.note || '',
  created_at: item.created_at,
  updated_at: item.updated_at,
});

export const accountsReceivableApi = {
  // Lấy danh sách công nợ phải thu
  getReceivables: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const normalizedParams = {
      ...params,
      search: params?.search || params?.q,
      customer: params?.customer_id || params?.customer,
      overdue_only: params?.aging_bucket ? 'true' : undefined,
    };
    const response = await axiosInstance.get('/finance/receivables/', { params: normalizedParams });
    return {
      ...response.data,
      results: (response.data?.results || []).map(transformReceivable),
    };
  },

  // Lấy chi tiết một công nợ
  getReceivable: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`/finance/receivables/${id}/`);
    return transformReceivable(response.data);
  },

  // Read-only backend: "xóa" sẽ map sang hủy chứng từ
  deleteReceivable: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`/finance/receivables/${id}/cancel/`, { reason: 'Hủy từ giao diện' });
    return response.data;
  },

  // Ghi nhận thanh toán
  receivePayment: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.post(`/finance/receivables/${id}/collect/`, data);
    return transformReceivable(response.data);
  },

  // Hủy công nợ
  cancelReceivable: async (id: number, reason: string): Promise<any> => {
    const response = await axiosInstance.post(`/finance/receivables/${id}/cancel/`, { reason });
    return response.data;
  },

  // Lấy danh sách thanh toán cho công nợ
  getPayments: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`/finance/receivables/${id}/settlements/`);
    return (response.data || []).map(transformSettlement);
  },
};
