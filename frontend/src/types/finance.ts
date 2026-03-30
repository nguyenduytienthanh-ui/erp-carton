export type TransactionCategoryType = 'INCOME' | 'EXPENSE';
export type CashAccountType = 'CASH' | 'FUND';
export type CashTransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type CashTransactionSourceType = 'CASH' | 'BANK';
export type AdvanceTransactionType = 'PURCHASE' | 'SALARY' | 'OTHER';
export type AdvanceTransactionStatus = 'OPEN' | 'PARTIAL' | 'SETTLED' | 'CANCELLED';
export type AdvanceTransactionSourceType = 'CASH' | 'BANK';
export type AdvanceApprovalStatus = 'DRAFT' | 'PENDING_L1' | 'PENDING_L2' | 'APPROVED' | 'REJECTED';
export type DisbursementStatus = 'NOT_DISBURSED' | 'DISBURSED';
export type ReceivableStatus = 'OPEN' | 'PARTIAL' | 'SETTLED' | 'CANCELLED';
export type PayableStatus = 'OPEN' | 'PARTIAL' | 'SETTLED' | 'CANCELLED';

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
  current_balance?: string;
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
  reference?: string;
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
  approval_status: AdvanceApprovalStatus;
  required_approval_level: number;
  submitted_at?: string | null;
  submitted_by?: number | null;
  approved_level1_at?: string | null;
  approved_level1_by?: number | null;
  approved_level2_at?: string | null;
  approved_level2_by?: number | null;
  rejected_at?: string | null;
  rejected_by?: number | null;
  rejection_reason: string;
  is_active: boolean;
  total_spent: string;
  total_refund: string;
  remaining_amount: string;
  disbursement_status: DisbursementStatus;
  disbursement_transaction_id?: number | null;
  disbursed_at?: string | null;
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

export interface ReceivableSettlement {
  id: number;
  receivable_document: number;
  receivable_code?: string;
  customer_name?: string | null;
  settlement_date: string;
  amount: string;
  source_type: CashTransactionSourceType;
  source_cash_account?: number | null;
  source_cash_account_name?: string | null;
  source_bank_account?: number | null;
  source_bank_account_code?: string | null;
  cash_transaction_id?: number | null;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface ReceivableDocument {
  id: number;
  code: string;
  source_sales_order?: number | null;
  source_sales_order_code?: string | null;
  customer?: number | null;
  customer_code?: string | null;
  customer_name?: string | null;
  customer_snapshot?: Record<string, unknown>;
  document_date: string;
  due_date: string;
  currency: string;
  exchange_rate: string;
  subtotal_amount: string;
  tax_amount: string;
  total_amount: string;
  settled_amount: string;
  remaining_amount: string;
  days_overdue: number;
  status: ReceivableStatus;
  reference: string;
  note: string;
  version?: number;
  created_at: string;
  updated_at: string;
  settlements: ReceivableSettlement[];
}

export interface PayableSettlement {
  id: number;
  payable_document: number;
  payable_code?: string;
  supplier_name?: string | null;
  settlement_date: string;
  amount: string;
  source_type: CashTransactionSourceType;
  source_cash_account?: number | null;
  source_cash_account_name?: string | null;
  source_bank_account?: number | null;
  source_bank_account_code?: string | null;
  cash_transaction_id?: number | null;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface PayableDocument {
  id: number;
  code: string;
  source_purchase_receipt?: number | null;
  source_purchase_receipt_code?: string | null;
  source_purchase_order_code?: string | null;
  supplier?: number | null;
  supplier_code?: string | null;
  supplier_name?: string | null;
  supplier_snapshot?: Record<string, unknown>;
  document_date: string;
  due_date: string;
  vendor_invoice_no: string;
  vendor_invoice_date?: string | null;
  currency: string;
  exchange_rate: string;
  subtotal_amount: string;
  tax_amount: string;
  total_amount: string;
  settled_amount: string;
  remaining_amount: string;
  days_overdue: number;
  status: PayableStatus;
  reference: string;
  note: string;
  version?: number;
  created_at: string;
  updated_at: string;
  settlements: PayableSettlement[];
}

export type BudgetPlanStatus = 'ON_TRACK' | 'OVER_BUDGET';

export interface BudgetPlan {
  id: number;
  department: string;
  category: string;
  fiscal_year: number;
  budgeted_amount: string;
  actual_amount: string;
  committed_amount: string;
  available: string;
  status: BudgetPlanStatus;
  variance_percentage: number;
  note: string;
  is_active: boolean;
  created_by?: number | null;
  updated_by?: number | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetVarianceDepartmentRow {
  department: string;
  budgeted_amount: string;
  actual_amount: string;
  committed_amount: string;
  available_amount: string;
}

export interface BudgetVarianceAnalysisResponse {
  total_count: number;
  over_budget_count: number;
  on_track_count: number;
  active_count: number;
  total_budgeted: string;
  total_actual: string;
  total_committed: string;
  total_available: string;
  utilization_percentage: string | number;
  departments: BudgetVarianceDepartmentRow[];
}

export interface ArApSummaryResponse {
  count: number;
  open_count: number;
  partial_count: number;
  settled_count: number;
  cancelled_count: number;
  overdue_count: number;
  total_amount: string;
  settled_amount: string;
  remaining_amount: string;
  overdue_amount: string;
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

export interface BankReconciliationRecord {
  id: number;
  code: string;
  statement_date: string;
  statement_balance: string;
  bank_account: number;
  bank_account_code?: string;
  bank_account_name?: string;
  book_balance: string;
  delta: string;
  status: string;
  reference: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface BankReconciliationPayload {
  statement_date: string;
  bank_account: number;
  statement_balance: number;
  book_balance: number;
  reference?: string;
  note?: string;
}

export interface FinanceMonthCloseCheckItem {
  code: string;
  severity: 'blocker' | 'warning';
  title: string;
  message: string;
  count: number;
  items: Array<Record<string, unknown>>;
}

export interface FinanceMonthCloseCheckResponse {
  month: string;
  is_ready: boolean;
  blockers: FinanceMonthCloseCheckItem[];
  warnings: FinanceMonthCloseCheckItem[];
}

export interface FinanceMonthlySummaryResponse {
  month: string;
  total_income: string;
  total_expense: string;
  total_transfer: string;
  cash_delta: string;
  total_advance: string;
  total_settlement_spent: string;
  total_settlement_refund: string;
  advance_net_delta: string;
  transactions_count: number;
  advances_count: number;
  settlements_count: number;
}

export interface FinanceTrend12mItem {
  month: string;
  total_income: string;
  total_expense: string;
  cash_delta: string;
  total_advance: string;
  total_settlement_spent: string;
  total_settlement_refund: string;
  advance_net_delta: string;
}

export interface FinanceTrend12mResponse {
  end_month: string;
  items: FinanceTrend12mItem[];
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

export interface AdvanceApprovalQueueItem {
  id: number;
  code: string;
  recipient_name: string;
  amount: string;
  advance_date: string;
  approval_status: AdvanceApprovalStatus;
  required_approval_level: number;
}

export interface AdvanceApprovalQueueResponse {
  pending_l1_count: number;
  pending_l2_count: number;
  items: AdvanceApprovalQueueItem[];
}

export interface AdvanceApprovalHistoryItem {
  action: string;
  action_label?: string;
  level?: number;
  user?: string | null;
  comments?: string | null;
  created_at: string;
}

export interface AdvanceApprovalSlaPolicy {
  sla_hours_l1: number;
  sla_hours_l2: number;
  remind_every_hours: number;
  escalation_hours_l1: number;
  escalation_hours_l2: number;
  escalation_cooldown_hours: number;
  window_days: number;
}

export interface AdvanceApprovalSlaOverviewResponse {
  policy: AdvanceApprovalSlaPolicy;
  pending_l1_count: number;
  pending_l2_count: number;
  overdue_l1_count: number;
  overdue_l2_count: number;
  escalation_l1_count?: number;
  escalation_l2_count?: number;
  approved_window_days: number;
  approved_count: number;
  avg_lead_hours: number;
  top_blocked_submitters?: Array<{
    username: string;
    pending_count: number;
    total_amount: string;
    max_wait_hours: number;
  }>;
}

export interface AdvanceApprovalSlaReminderHistoryItem {
  level_key: number;
  level_label: string;
  latest_created_at: string;
  sent_count: number;
  unread_count: number;
  read_count: number;
  read_rate: number;
  sample_recipients: string[];
}

export interface AdvanceApprovalSlaReminderHistoryResponse {
  days: number;
  summary: {
    total_sent: number;
    total_read: number;
    total_unread: number;
    overall_read_rate: number;
  };
  items: AdvanceApprovalSlaReminderHistoryItem[];
}

export interface ExecutiveKpiResponse {
  as_of: string;
  finance_sla: AdvanceApprovalSlaOverviewResponse;
  workforce_sla: {
    pending_l1_count: number;
    pending_l2_count: number;
    overdue_l1_count: number;
    overdue_l2_count: number;
    escalation_l1_count?: number;
    escalation_l2_count?: number;
    avg_lead_hours: number;
  };
  finance_overdue_90: {
    as_of: string;
    threshold_days: number;
    count: number;
    total_remaining: string;
    max_days_overdue: number;
  };
  trend_6m: Array<{
    month: string;
    finance_pending: number;
    workforce_pending: number;
  }>;
  risk_score: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  risk_contributors: Array<{
    key: string;
    label: string;
    count: number;
    weight: number;
    impact_score: number;
  }>;
  recommendations: Array<{
    code: string;
    title: string;
    priority: 'P0' | 'P1' | 'P2' | 'P3';
    description: string;
  }>;
  risk_trend: {
    mom_delta_pending: number;
    wow_delta_pending: number;
    current_pending_total: number;
    previous_month_pending_total: number;
    previous_week_pending_total: number;
  };
  early_warning: {
    is_triggered: boolean;
    score_to_next_level: number;
    target_level: 'MEDIUM' | 'HIGH';
    hint: string;
  };
  priority_queue: Array<{
    code: string;
    title: string;
    owner: string;
    impact_score: number;
    quick_action: string;
  }>;
  auto_policy: ExecutiveAutoPolicy;
}

export interface ExecutiveAutoPolicy {
  enabled: boolean;
  cooldown_minutes: number;
  auto_run_finance_sla: boolean;
  auto_run_workforce_sla: boolean;
  only_when_early_warning: boolean;
  last_run_at: string;
}

export interface ExecutiveAutoHistoryItem {
  id: number;
  created_at: string;
  username: string;
  source: string;
  force_run: boolean;
  success: boolean;
  skipped: boolean;
  reason: string;
  finance_sent_count: number;
  workforce_sent_count: number;
}

export interface ExecutiveAutoHistoryResponse {
  count: number;
  items: ExecutiveAutoHistoryItem[];
}

export interface ExecutiveAutoGovernanceSummary {
  total_runs: number;
  success_runs: number;
  skipped_runs: number;
  failed_runs: number;
  finance_sent_total: number;
  workforce_sent_total: number;
  sent_total: number;
  success_rate: number;
  skipped_rate: number;
  failed_rate: number;
  avg_sent_per_run: number;
}

export interface ExecutiveAutoGovernancePeriodItem extends ExecutiveAutoGovernanceSummary {
  period_key: string;
  period_start: string;
  period_end: string;
}

export interface ExecutiveAutoGovernanceSkipReasonItem {
  reason: string;
  count: number;
}

export interface ExecutiveAutoGovernanceActionItem extends ExecutiveAutoGovernanceSummary {
  action: 'BOTH' | 'FINANCE_ONLY' | 'WORKFORCE_ONLY' | 'NO_SENT';
}

export interface ExecutiveAutoGovernanceResponse {
  filters: {
    days: number;
    group_by: 'day' | 'week';
    from_date: string;
    to_date: string;
  };
  summary: ExecutiveAutoGovernanceSummary;
  by_period: ExecutiveAutoGovernancePeriodItem[];
  skip_reasons: ExecutiveAutoGovernanceSkipReasonItem[];
  action_effectiveness: ExecutiveAutoGovernanceActionItem[];
}

export interface CrossModuleReadinessCheck {
  code: string;
  label: string;
  ok: boolean;
  current: number;
  recommended_min: number;
  weight: number;
  hint: string;
}

export interface CrossModuleReadinessResponse {
  as_of: string;
  readiness_score: number;
  readiness_level: 'READY' | 'PARTIAL' | 'BOOTSTRAP_NEEDED';
  checks: CrossModuleReadinessCheck[];
  warnings: Array<{
    code: string;
    label: string;
    hint: string;
  }>;
  summary: {
    users_total: number;
    users_staff_total: number;
    roles_total: number;
    finance_advances_total: number;
    finance_advances_active: number;
    workforce_salary_advances_total: number;
    payroll_records_total: number;
    role_permission_audits_total: number;
    operations_log_total: number;
    pipeline_events_total: number;
  };
}

export interface CrossModuleBootstrapResponse {
  dry_run: boolean;
  created: Record<string, number>;
  skipped: Record<string, number>;
  notes: string[];
  created_total: number;
  skipped_total: number;
  readiness_after: CrossModuleReadinessResponse;
}

export interface CrossModuleBootstrapHistoryItem {
  id: number;
  created_at: string;
  username: string;
  dry_run: boolean;
  created_total: number;
  skipped_total: number;
  created: Record<string, number>;
  skipped: Record<string, number>;
  readiness_before: CrossModuleReadinessResponse;
  readiness_after: CrossModuleReadinessResponse;
  readiness_delta: number;
  improved: boolean;
  level_before: string;
  level_after: string;
  notes: string[];
}

export interface CrossModuleBootstrapHistoryResponse {
  count: number;
  filters?: {
    days?: number;
    username?: string;
    dry_run?: 'true' | 'false' | '';
  };
  items: CrossModuleBootstrapHistoryItem[];
}
