import axiosInstance from './axios';
import type { PaginatedResponse } from '../types/finance';

const mapPayableStatus = (status: string, daysOverdue?: number): string => {
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

const transformPayable = (item: any) => ({
  id: item.id,
  code: item.code,
  supplier_id: item.supplier ?? null,
  supplier_name: item.supplier_name ?? '',
  supplier_code: item.supplier_code ?? '',
  bill_date: item.document_date,
  bill_number: item.vendor_invoice_no || item.code,
  due_date: item.due_date,
  purchase_order: item.source_purchase_order_code ? null : null,
  purchase_order_code: item.source_purchase_order_code ?? null,
  amount: Number(item.total_amount || 0),
  paid_amount: Number(item.settled_amount || 0),
  outstanding_amount: Number(item.remaining_amount || 0),
  status: mapPayableStatus(item.status, item.days_overdue),
  days_overdue: item.days_overdue || 0,
  payments: Array.isArray(item.settlements) ? item.settlements.map(transformSettlement) : [],
  note: item.note || '',
  created_at: item.created_at,
  updated_at: item.updated_at,
});

export const accountsPayableApi = {
  // Lấy danh sách công nợ phải trả
  getPayables: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const normalizedParams = {
      ...params,
      search: params?.search || params?.q,
      supplier: params?.supplier_id || params?.supplier,
      overdue_only: params?.aging_bucket ? 'true' : undefined,
    };
    const response = await axiosInstance.get('/finance/payables/', { params: normalizedParams });
    return {
      ...response.data,
      results: (response.data?.results || []).map(transformPayable),
    };
  },

  // Lấy chi tiết một công nợ
  getPayable: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`/finance/payables/${id}/`);
    return transformPayable(response.data);
  },

  // Read-only backend: "xóa" sẽ map sang hủy chứng từ
  deletePayable: async (id: number): Promise<any> => {
    const response = await axiosInstance.post(`/finance/payables/${id}/cancel/`, { reason: 'Hủy từ giao diện' });
    return response.data;
  },

  // Ghi nhận thanh toán
  recordPayment: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.post(`/finance/payables/${id}/pay/`, data);
    return transformPayable(response.data);
  },

  // Hủy công nợ
  cancelPayable: async (id: number, reason: string): Promise<any> => {
    const response = await axiosInstance.post(`/finance/payables/${id}/cancel/`, { reason });
    return response.data;
  },

  // Lấy danh sách thanh toán cho công nợ
  getPayments: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`/finance/payables/${id}/settlements/`);
    return (response.data || []).map(transformSettlement);
  },
};
