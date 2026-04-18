export type TransactionType = 'RECEIPT' | 'PAYMENT';
export type TransactionStatus = 'PENDING' | 'RECONCILED' | 'CANCELLED';

export interface BankTransaction {
  id?: number;
  code?: string;
  transaction_date: string;
  transaction_type: TransactionType;
  amount: number;
  bank_account_id: number;
  bank_account_name?: string;
  description: string;
  category_id?: number;
  category_name?: string;
  reference?: string;
  status: TransactionStatus;
  reconciled_at?: string;
  created_by_name?: string;
  created_at?: string;
}

export interface CashBook {
  id?: number;
  bank_account_id: number;
  bank_account_name?: string;
  opening_balance: number;
  total_receipts: number;
  total_payments: number;
  closing_balance: number;
  statement_balance?: number;
  reconciliation_status?: string;
  as_of_date: string;
}
