export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'RESIGNED';

export interface Employee {
  id: number;
  code: string;
  name: string;
  cccd: string;
  birth_date: string | null;
  gender: string;
  address: string;
  phone: string;
  email: string;
  department: string;
  position: string;
  start_date: string | null;
  status: EmployeeStatus;
  salary_basic: string;
  bank_account_number: string;
  bank_name: string;
  bank_branch: string;
  note: string;
  profile_effective_month?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmployeePayload {
  code: string;
  name: string;
  cccd: string;
  birth_date: string | null;
  gender: string;
  address: string;
  phone: string;
  email: string;
  department: string;
  position: string;
  start_date: string | null;
  status: EmployeeStatus;
  salary_basic: number;
  bank_account_number: string;
  bank_name: string;
  bank_branch: string;
  note: string;
  profile_effective_month?: string;
  is_active: boolean;
}

export interface EmployeeProfileHistory {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  effective_month: string;
  salary_basic: string;
  department: string;
  position: string;
  status: EmployeeStatus;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface EmployeeProfileHistoryPayload {
  employee: number;
  effective_month: string;
  salary_basic: number;
  department: string;
  position: string;
  status: EmployeeStatus;
  note: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type AttendanceDayType = 'WEEKDAY' | 'SUNDAY' | 'HOLIDAY';
export type AttendanceShift = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT' | 'FULLDAY';

export interface AttendanceOvertimeItem {
  id?: number;
  attendance?: number;
  overtime_date: string;
  day_type: AttendanceDayType;
  shift: AttendanceShift;
  hours: string;
  rate: string;
  note: string;
}

export interface AttendanceRecord {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  month: string;
  standard_days: string;
  actual_days: string;
  paid_leave: string;
  unpaid_leave: string;
  note: string;
  is_active: boolean;
  overtime_items: AttendanceOvertimeItem[];
  total_overtime_hours: string;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRecordPayload {
  employee: number;
  month: string;
  standard_days: number;
  actual_days: number;
  paid_leave: number;
  unpaid_leave: number;
  note: string;
  is_active: boolean;
  overtime_items: Array<{
    overtime_date: string;
    day_type: AttendanceDayType;
    shift: AttendanceShift;
    hours: number;
    rate: number;
    note: string;
  }>;
}

export type BonusPenaltyType = 'BONUS' | 'PENALTY';
export type BonusPenaltyCalculationType = 'FIXED' | 'DAILY_RATIO';

export interface BonusPenaltyRecord {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  month: string;
  record_type: BonusPenaltyType;
  reason: string;
  amount: string;
  calculation_type: BonusPenaltyCalculationType;
  record_date: string;
  approved_by_name: string;
  note: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BonusPenaltyRecordPayload {
  employee: number;
  month: string;
  record_type: BonusPenaltyType;
  reason: string;
  amount: number;
  calculation_type: BonusPenaltyCalculationType;
  record_date: string;
  approved_by_name: string;
  note: string;
  is_active: boolean;
}

export type SalaryAdvanceStatus = 'UNDEDUCTED' | 'DEDUCTED';
export type SalaryAdvanceApprovalStatus = 'DRAFT' | 'PENDING_L1' | 'PENDING_L2' | 'APPROVED' | 'REJECTED';
export type SalaryAdvanceDisbursementStatus = 'NOT_DISBURSED' | 'DISBURSED';

export interface SalaryAdvanceRecord {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  advance_date: string;
  month: string;
  amount: string;
  reason: string;
  approved_by_name: string;
  note: string;
  status: SalaryAdvanceStatus;
  approval_status: SalaryAdvanceApprovalStatus;
  required_approval_level: number;
  disbursement_status: SalaryAdvanceDisbursementStatus;
  disbursement_transaction_id?: number | null;
  disbursed_at?: string | null;
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
  created_at: string;
  updated_at: string;
}

export interface SalaryAdvanceRecordPayload {
  employee: number;
  advance_date: string;
  month: string;
  amount: number;
  reason: string;
  approved_by_name: string;
  note: string;
  is_active: boolean;
}

export interface SalaryAdvanceApprovalQueueItem {
  id: number;
  employee_code: string;
  employee_name: string;
  amount: string;
  month: string;
  approval_status: SalaryAdvanceApprovalStatus;
  required_approval_level: number;
}

export interface SalaryAdvanceApprovalQueueResponse {
  pending_l1_count: number;
  pending_l2_count: number;
  items: SalaryAdvanceApprovalQueueItem[];
}

export interface SalaryAdvanceApprovalHistoryItem {
  action: string;
  action_label?: string;
  level?: number;
  user?: string | null;
  comments?: string | null;
  created_at: string;
}

export interface SalaryAdvanceApprovalSlaPolicy {
  sla_hours_l1: number;
  sla_hours_l2: number;
  remind_every_hours: number;
  escalation_hours_l1: number;
  escalation_hours_l2: number;
  escalation_cooldown_hours: number;
  window_days: number;
}

export interface SalaryAdvanceApprovalSlaOverviewResponse {
  policy: SalaryAdvanceApprovalSlaPolicy;
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

export interface SalaryAdvanceApprovalSlaReminderHistoryItem {
  level_key: number;
  level_label: string;
  latest_created_at: string;
  sent_count: number;
  unread_count: number;
  read_count: number;
  read_rate: number;
  sample_recipients: string[];
}

export interface SalaryAdvanceApprovalSlaReminderHistoryResponse {
  days: number;
  summary: {
    total_sent: number;
    total_read: number;
    total_unread: number;
    overall_read_rate: number;
  };
  items: SalaryAdvanceApprovalSlaReminderHistoryItem[];
}

export type PayrollStatus = 'UNLOCKED' | 'LOCKED';

export interface PayrollRecord {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  employee_department: string;
  employee_position: string;
  month: string;
  profile_effective_month: string;
  standard_days: string;
  actual_days: string;
  basic_salary: string;
  salary_by_attendance: string;
  overtime_pay: string;
  total_bonus: string;
  total_penalty: string;
  advance_deduction: string;
  total_income: string;
  total_deductions: string;
  net_pay: string;
  status: PayrollStatus;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface WorkforceMonthCloseCheckItem {
  code: string;
  severity: 'blocker' | 'warning';
  title: string;
  message: string;
  count: number;
  items: Array<Record<string, unknown>>;
}

export interface WorkforceMonthCloseCheckResponse {
  month: string;
  is_ready: boolean;
  blockers: WorkforceMonthCloseCheckItem[];
  warnings: WorkforceMonthCloseCheckItem[];
}
