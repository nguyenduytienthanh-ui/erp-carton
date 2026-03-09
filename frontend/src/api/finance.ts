import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  AdvanceOverdueOverviewResponse,
  AdvanceReminderPolicy,
  AdvanceReminderPolicyHistoryResponse,
  AdvanceReminderPolicySimulationResponse,
  AdvanceReminderHistoryResponse,
  AdvanceOverdueReportResponse,
  AdvanceSettlement,
  AdvanceTransaction,
  BankAccount,
  CashAccount,
  CashTransaction,
  FinanceLockedMonthsResponse,
  PaginatedResponse,
  PayrollReconciliationResponse,
  TransactionCategory,
} from '../types/finance';

type BankAccountPayload = Omit<BankAccount, 'id' | 'created_at' | 'updated_at'>;
type TransactionCategoryPayload = Omit<TransactionCategory, 'id' | 'created_at' | 'updated_at' | 'is_system'>;
type CashAccountPayload = Omit<CashAccount, 'id' | 'created_at' | 'updated_at'>;
type CashTransactionPayload = Omit<CashTransaction, 'id' | 'created_at' | 'updated_at'>;
type AdvanceTransactionPayload = Omit<
  AdvanceTransaction,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'source_cash_account_name'
  | 'source_bank_account_code'
  | 'total_spent'
  | 'total_refund'
  | 'remaining_amount'
>;
type AdvanceSettlementPayload = Omit<
  AdvanceSettlement,
  'id' | 'created_at' | 'updated_at' | 'advance_code' | 'advance_recipient_name'
>;

export const financeApi = {
  getBankAccounts: async (params?: Record<string, unknown>): Promise<PaginatedResponse<BankAccount>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_BANK_ACCOUNTS, { params });
    return response.data;
  },
  createBankAccount: async (payload: BankAccountPayload): Promise<BankAccount> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_BANK_ACCOUNTS, payload);
    return response.data;
  },
  updateBankAccount: async (id: number, payload: Partial<BankAccountPayload>): Promise<BankAccount> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.FINANCE_BANK_ACCOUNTS}${id}/`, payload);
    return response.data;
  },
  deleteBankAccount: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.FINANCE_BANK_ACCOUNTS}${id}/`);
  },

  getTransactionCategories: async (
    params?: Record<string, unknown>
  ): Promise<PaginatedResponse<TransactionCategory>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_TRANSACTION_CATEGORIES, { params });
    return response.data;
  },
  createTransactionCategory: async (payload: TransactionCategoryPayload): Promise<TransactionCategory> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_TRANSACTION_CATEGORIES, payload);
    return response.data;
  },
  updateTransactionCategory: async (
    id: number,
    payload: Partial<TransactionCategoryPayload>
  ): Promise<TransactionCategory> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.FINANCE_TRANSACTION_CATEGORIES}${id}/`, payload);
    return response.data;
  },
  deleteTransactionCategory: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.FINANCE_TRANSACTION_CATEGORIES}${id}/`);
  },

  getCashAccounts: async (params?: Record<string, unknown>): Promise<PaginatedResponse<CashAccount>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_CASH_ACCOUNTS, { params });
    return response.data;
  },
  createCashAccount: async (payload: CashAccountPayload): Promise<CashAccount> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_CASH_ACCOUNTS, payload);
    return response.data;
  },
  updateCashAccount: async (id: number, payload: Partial<CashAccountPayload>): Promise<CashAccount> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.FINANCE_CASH_ACCOUNTS}${id}/`, payload);
    return response.data;
  },
  deleteCashAccount: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.FINANCE_CASH_ACCOUNTS}${id}/`);
  },

  getCashTransactions: async (
    params?: Record<string, unknown>
  ): Promise<PaginatedResponse<CashTransaction>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_CASH_TRANSACTIONS, { params });
    return response.data;
  },
  createCashTransaction: async (payload: CashTransactionPayload): Promise<CashTransaction> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_CASH_TRANSACTIONS, payload);
    return response.data;
  },
  updateCashTransaction: async (
    id: number,
    payload: Partial<CashTransactionPayload>
  ): Promise<CashTransaction> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.FINANCE_CASH_TRANSACTIONS}${id}/`, payload);
    return response.data;
  },
  deleteCashTransaction: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.FINANCE_CASH_TRANSACTIONS}${id}/`);
  },

  getAdvanceTransactions: async (
    params?: Record<string, unknown>
  ): Promise<PaginatedResponse<AdvanceTransaction>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_ADVANCE_TRANSACTIONS, { params });
    return response.data;
  },
  createAdvanceTransaction: async (payload: AdvanceTransactionPayload): Promise<AdvanceTransaction> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_ADVANCE_TRANSACTIONS, payload);
    return response.data;
  },
  updateAdvanceTransaction: async (
    id: number,
    payload: Partial<AdvanceTransactionPayload>
  ): Promise<AdvanceTransaction> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.FINANCE_ADVANCE_TRANSACTIONS}${id}/`, payload);
    return response.data;
  },
  deleteAdvanceTransaction: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.FINANCE_ADVANCE_TRANSACTIONS}${id}/`);
  },

  getAdvanceSettlements: async (params?: Record<string, unknown>): Promise<PaginatedResponse<AdvanceSettlement>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_ADVANCE_SETTLEMENTS, { params });
    return response.data;
  },
  createAdvanceSettlement: async (payload: AdvanceSettlementPayload): Promise<AdvanceSettlement> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_ADVANCE_SETTLEMENTS, payload);
    return response.data;
  },
  updateAdvanceSettlement: async (
    id: number,
    payload: Partial<AdvanceSettlementPayload>
  ): Promise<AdvanceSettlement> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.FINANCE_ADVANCE_SETTLEMENTS}${id}/`, payload);
    return response.data;
  },
  deleteAdvanceSettlement: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.FINANCE_ADVANCE_SETTLEMENTS}${id}/`);
  },

  getAdvanceOverdueReport: async (params?: {
    as_of?: string;
    overdue_days?: number;
  }): Promise<AdvanceOverdueReportResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_ADVANCE_OVERDUE_REPORT, { params });
    return response.data as AdvanceOverdueReportResponse;
  },

  exportAdvanceOverdueReportExcel: async (params?: {
    as_of?: string;
    overdue_days?: number;
  }): Promise<Blob> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_ADVANCE_OVERDUE_REPORT, {
      params: { ...params, export: 'excel' },
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  getAdvanceOverdueOverview: async (params?: {
    as_of?: string;
  }): Promise<AdvanceOverdueOverviewResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_ADVANCE_OVERDUE_OVERVIEW, { params });
    return response.data as AdvanceOverdueOverviewResponse;
  },

  remindOverdueAdvances: async (payload?: {
    threshold_days?: number;
    as_of?: string;
    recipient_usernames?: string[];
  }): Promise<{
    success: boolean;
    sent_count: number;
    sent_usernames?: string[];
    requested_usernames?: string[];
  }> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_ADVANCE_REMIND_OVERDUE, payload || {});
    return response.data as {
      success: boolean;
      sent_count: number;
      sent_usernames?: string[];
      requested_usernames?: string[];
    };
  },

  getAdvanceReminderHistory: async (params?: {
    days?: number;
    as_of_from?: string;
    as_of_to?: string;
    unread_only?: boolean;
  }): Promise<AdvanceReminderHistoryResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_ADVANCE_REMINDER_HISTORY, { params });
    return response.data as AdvanceReminderHistoryResponse;
  },

  exportAdvanceReminderHistoryExcel: async (params?: {
    days?: number;
    as_of_from?: string;
    as_of_to?: string;
    unread_only?: boolean;
  }): Promise<Blob> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_ADVANCE_REMINDER_HISTORY, {
      params: { ...(params || {}), export: 'excel' },
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  getFinanceLockedMonths: async (): Promise<FinanceLockedMonthsResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_LOCKED_MONTHS);
    return response.data as FinanceLockedMonthsResponse;
  },

  lockFinanceMonth: async (month: string): Promise<FinanceLockedMonthsResponse> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_LOCK_MONTH, { month });
    return response.data as FinanceLockedMonthsResponse;
  },

  unlockFinanceMonth: async (month: string): Promise<FinanceLockedMonthsResponse> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_UNLOCK_MONTH, { month });
    return response.data as FinanceLockedMonthsResponse;
  },

  getPayrollReconciliation: async (month: string): Promise<PayrollReconciliationResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_PAYROLL_RECONCILIATION, { params: { month } });
    return response.data as PayrollReconciliationResponse;
  },

  getAdvanceReminderPolicy: async (): Promise<AdvanceReminderPolicy> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_ADVANCE_REMINDER_POLICY);
    return response.data as AdvanceReminderPolicy;
  },

  saveAdvanceReminderPolicy: async (payload: Partial<AdvanceReminderPolicy>): Promise<{
    success: boolean;
    policy: AdvanceReminderPolicy;
  }> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_ADVANCE_REMINDER_POLICY, payload);
    return response.data as { success: boolean; policy: AdvanceReminderPolicy };
  },

  getAdvanceReminderPolicyHistory: async (params?: {
    limit?: number;
  }): Promise<AdvanceReminderPolicyHistoryResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.FINANCE_ADVANCE_REMINDER_POLICY_HISTORY, { params });
    return response.data as AdvanceReminderPolicyHistoryResponse;
  },

  rollbackAdvanceReminderPolicy: async (payload: {
    audit_log_id: number;
  }): Promise<{
    success: boolean;
    policy: AdvanceReminderPolicy;
    rolled_back_to_audit_log_id: number;
  }> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_ADVANCE_REMINDER_POLICY_ROLLBACK, payload);
    return response.data as {
      success: boolean;
      policy: AdvanceReminderPolicy;
      rolled_back_to_audit_log_id: number;
    };
  },

  simulateAdvanceReminderPolicy: async (payload: {
    threshold_days?: number;
    as_of?: string;
    recipient_usernames?: string[];
    policy?: Partial<AdvanceReminderPolicy>;
  }): Promise<AdvanceReminderPolicySimulationResponse> => {
    const response = await axiosInstance.post(API_ENDPOINTS.FINANCE_ADVANCE_REMINDER_POLICY_SIMULATE, payload);
    return response.data as AdvanceReminderPolicySimulationResponse;
  },
};

