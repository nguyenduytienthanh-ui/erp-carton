import { axiosInstance } from './config';
import { PaginatedResponse } from '../types/common';

export const generalLedgerApi = {
  // Accounts
  getAccounts: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const response = await axiosInstance.get('api/finance/general-ledger-accounts/', { params });
    return response.data;
  },

  getAccount: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`api/finance/general-ledger-accounts/${id}/`);
    return response.data;
  },

  createAccount: async (data: any): Promise<any> => {
    const response = await axiosInstance.post('api/finance/general-ledger-accounts/', data);
    return response.data;
  },

  updateAccount: async (id: number, data: any): Promise<any> => {
    const response = await axiosInstance.put(`api/finance/general-ledger-accounts/${id}/`, data);
    return response.data;
  },

  deleteAccount: async (id: number): Promise<any> => {
    const response = await axiosInstance.delete(`api/finance/general-ledger-accounts/${id}/`);
    return response.data;
  },

  // GL Entries
  getEntries: async (params?: Record<string, unknown>): Promise<PaginatedResponse<any>> => {
    const response = await axiosInstance.get('api/finance/general-ledger/', { params });
    return response.data;
  },

  getEntry: async (id: number): Promise<any> => {
    const response = await axiosInstance.get(`api/finance/general-ledger/${id}/`);
    return response.data;
  },

  // Reports
  getTrialBalance: async (params?: Record<string, unknown>): Promise<any[]> => {
    const response = await axiosInstance.get('api/finance/general-ledger/trial_balance/', { params });
    return response.data;
  },

  getAccountBalance: async (accountId: number, dateFrom?: string, dateTo?: string): Promise<any> => {
    const response = await axiosInstance.get('api/finance/general-ledger/account_balance/', {
      params: {
        account_id: accountId,
        date_from: dateFrom,
        date_to: dateTo,
      },
    });
    return response.data;
  },
};
