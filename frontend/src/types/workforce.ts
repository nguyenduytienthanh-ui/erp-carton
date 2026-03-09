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
  is_active: boolean;
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

