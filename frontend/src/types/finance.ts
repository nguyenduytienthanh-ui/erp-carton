export type TransactionCategoryType = 'INCOME' | 'EXPENSE';
export type CashAccountType = 'CASH' | 'FUND';
export type CashTransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type CashTransactionSourceType = 'CASH' | 'BANK';
export type AdvanceTransactionType = 'PURCHASE' | 'SALARY' | 'OTHER';
export type AdvanceTransactionStatus = 'OPEN' | 'PARTIAL' | 'SETTLED' | 'CANCELLED';
export type AdvanceTransactionSourceType = 'CASH' | 'BANK';

export interface BankAccount {
  id: number;
  code: string;
  account_number: string;
  account_name: string;
  bank_name: string;
  branch: string;
  note: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TransactionCategory {
  id: number;
  code: string;
  name: string;
  category_type: TransactionCategoryType;
  color: string;
  note: string;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CashAccount {
  id: number;
  name: string;
  account_type: CashAccountType;
  balance: string;
  note: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CashTransaction {
  id: number;
  transaction_type: CashTransactionType;
  source_type: CashTransactionSourceType;
  source_cash_account: number | null;
  source_bank_account: number | null;
  target_cash_account: number | null;
  source_cash_account_name?: string;
  source_bank_account_code?: string;
  target_cash_account_name?: string;
  category: number | null;
  category_code?: string;
  category_name?: string;
  transaction_date: string;
  amount: string;
  object_name: string;
  reason: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface AdvanceTransaction {
  id: number;
  code: string;
  advance_type: AdvanceTransactionType;
  advance_date: string;
  recipient_name: string;
  source_type: AdvanceTransactionSourceType;
  source_cash_account: number | null;
  source_bank_account: number | null;
  source_cash_account_name?: string;
  source_bank_account_code?: string;
  amount: string;
  purpose: string;
  note: string;
  status: AdvanceTransactionStatus;
  is_active: boolean;
  total_spent: string;
  total_refund: string;
  remaining_amount: string;
  created_at: string;
  updated_at: string;
}

export interface AdvanceSettlement {
  id: number;
  advance_transaction: number;
  advance_code?: string;
  advance_recipient_name?: string;
  settlement_date: string;
  spent_amount: string;
  refund_amount: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface AdvanceOverdueItem {
  id: number;
  code: string;
  advance_type: AdvanceTransactionType;
  advance_date: string;
  recipient_name: string;
  status: AdvanceTransactionStatus;
  amount: string;
  spent_amount: string;
  refund_amount: string;
  handled_amount: string;
  remaining_amount: string;
  days_overdue: number;
  source_type: AdvanceTransactionSourceType;
  source_cash_account_name: string;
  source_bank_account_code: string;
  purpose: string;
}

export interface AdvanceOverdueSummary {
  as_of: string;
  overdue_days: number;
  count: number;
  total_amount: string;
  total_handled: string;
  total_remaining: string;
}

export interface AdvanceOverdueReportResponse {
  summary: AdvanceOverdueSummary;
  items: AdvanceOverdueItem[];
}

export interface FinanceLockedMonthsResponse {
  months: string[];
}

export interface PayrollReconciliationResponse {
  month: string;
  payroll_total: string;
  payroll_count: number;
  posted_total: string;
  posted_count: number;
  delta: string;
  is_balanced: boolean;
}

export interface AdvanceOverdueBucket {
  threshold_days: number;
  count: number;
  total_remaining: string;
}

export interface AdvanceOverdueOverviewItem {
  id: number;
  code: string;
  advance_date: string;
  recipient_name: string;
  status: AdvanceTransactionStatus;
  amount: string;
  remaining_amount: string;
  days_overdue: number;
}

export interface AdvanceOverdueOverviewResponse {
  as_of: string;
  buckets: AdvanceOverdueBucket[];
  top_urgent: AdvanceOverdueOverviewItem[];
}

export interface AdvanceReminderHistoryItem {
  entity_id: number;
  as_of: string;
  title: string;
  message: string;
  created_at: string;
  sent_count: number;
  read_count: number;
  unread_count: number;
  read_rate: number;
  unread_rate: number;
  recipient_names: string[];
}

export interface AdvanceReminderHistoryResponse {
  days: number;
  count: number;
  filters?: {
    as_of_from?: string;
    as_of_to?: string;
    unread_only?: boolean;
  };
  summary?: {
    total_sent: number;
    total_read: number;
    total_unread: number;
    overall_read_rate: number;
    top_unread_recipients?: Array<{
      username: string;
      total_received: number;
      read_count: number;
      unread_count: number;
      unread_rate: number;
    }>;
  };
  items: AdvanceReminderHistoryItem[];
}

export interface AdvanceReminderPolicy {
  default_threshold_days: number;
  cooldown_hours: number;
  role_threshold_days: Record<string, number>;
  user_threshold_days: Record<string, number>;
  presets?: Record<
    string,
    {
      default_threshold_days: number;
      cooldown_hours: number;
      role_threshold_days: Record<string, number>;
      user_threshold_days: Record<string, number>;
    }
  >;
  recommendation?: {
    recommended_preset_key: string;
    reason: string;
    metrics: {
      total_sent_30d: number;
      total_unread_30d: number;
      unread_rate_30d: number;
    };
    preset: {
      default_threshold_days: number;
      cooldown_hours: number;
      role_threshold_days: Record<string, number>;
      user_threshold_days: Record<string, number>;
    };
  };
}

export interface AdvanceReminderPolicyHistoryItem {
  id: number;
  created_at: string;
  username: string;
  old_values: Partial<AdvanceReminderPolicy>;
  new_values: Partial<AdvanceReminderPolicy>;
  changed_fields: string[];
}

export interface AdvanceReminderPolicyHistoryResponse {
  count: number;
  items: AdvanceReminderPolicyHistoryItem[];
}

export interface AdvanceReminderPolicySimulationResponse {
  success: boolean;
  dry_run: boolean;
  would_send_count: number;
  would_send_usernames: string[];
  skipped_cooldown_usernames?: string[];
  skipped_no_overdue_usernames?: string[];
  policy?: AdvanceReminderPolicy;
  snapshot?: {
    as_of: string;
    threshold_days: number | null;
    count_by_threshold: Record<string, number>;
  };
}
