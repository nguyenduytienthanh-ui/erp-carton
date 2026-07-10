import axiosInstance from './axios';
import type { PaginatedResponse } from '../types/finance';
import type {
  AccountBalance,
  GeneralLedgerAccount,
  GeneralLedgerEntry,
  TrialBalanceRow,
} from '../types/generalLedger';

export const generalLedgerApi = {
  // Accounts
  getAccounts: async (params?: Record<string, unknown>): Promise<PaginatedResponse<GeneralLedgerAccount>> => {
    const response = await axiosInstance.get('/finance/general-ledger-accounts/', { params });
    return response.data;
  },

  getAccount: async (id: number): Promise<GeneralLedgerAccount> => {
    const response = await axiosInstance.get(`/finance/general-ledger-accounts/${id}/`);
    return response.data;
  },

  createAccount: async (data: GeneralLedgerAccount): Promise<GeneralLedgerAccount> => {
    const response = await axiosInstance.post('/finance/general-ledger-accounts/', data);
    return response.data;
  },

  updateAccount: async (id: number, data: Partial<GeneralLedgerAccount>): Promise<GeneralLedgerAccount> => {
    const response = await axiosInstance.put(`/finance/general-ledger-accounts/${id}/`, data);
    return response.data;
  },

  deleteAccount: async (id: number): Promise<void> => {
    const response = await axiosInstance.delete(`/finance/general-ledger-accounts/${id}/`);
    return response.data;
  },

  // GL Entries
  getEntries: async (params?: Record<string, unknown>): Promise<PaginatedResponse<GeneralLedgerEntry>> => {
    const response = await axiosInstance.get('/finance/general-ledger/', { params });
    return response.data;
  },

  getEntry: async (id: number): Promise<GeneralLedgerEntry> => {
    const response = await axiosInstance.get(`/finance/general-ledger/${id}/`);
    return response.data;
  },

  // Reports
  getTrialBalance: async (params?: Record<string, unknown>): Promise<TrialBalanceRow[]> => {
    const response = await axiosInstance.get('/finance/general-ledger/trial_balance/', { params });
    return response.data;
  },

  getAccountBalance: async (accountId: number, dateFrom?: string, dateTo?: string): Promise<AccountBalance> => {
    const response = await axiosInstance.get('/finance/general-ledger/account_balance/', {
      params: {
        account_id: accountId,
        date_from: dateFrom,
        date_to: dateTo,
      },
    });
    return response.data;
  },
};
