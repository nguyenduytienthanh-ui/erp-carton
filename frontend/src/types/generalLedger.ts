export type GeneralLedgerAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface GeneralLedgerAccount {
  id?: number;
  code: string;
  name: string;
  account_type: GeneralLedgerAccountType;
  description?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface GeneralLedgerEntry {
  id?: number;
  account: number;
  account_name?: string;
  account_code?: string;
  account_type?: GeneralLedgerAccountType;
  posting_date: string;
  debit_amount: number;
  credit_amount: number;
  document_type: string;
  document_id?: number;
  document_code?: string;
  description?: string;
  created_by?: number;
  created_by_name?: string;
  created_at?: string;
}

export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_type: GeneralLedgerAccountType | '';
  debit: string;
  credit: string;
}

export interface AccountBalance {
  debit_total: string;
  credit_total: string;
  balance: string;
}
