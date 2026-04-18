import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  AttendanceRecord,
  AttendanceRecordPayload,
  BonusPenaltyRecord,
  BonusPenaltyRecordPayload,
  Employee,
  EmployeeProfileHistory,
  EmployeeProfileHistoryPayload,
  EmployeePayload,
  PaginatedResponse,
  PayrollRecord,
  SalaryAdvanceApprovalHistoryItem,
  SalaryAdvanceApprovalSlaOverviewResponse,
  SalaryAdvanceApprovalSlaPolicy,
  SalaryAdvanceApprovalSlaReminderHistoryResponse,
  SalaryAdvanceApprovalQueueResponse,
  SalaryAdvanceRecord,
  SalaryAdvanceRecordPayload,
  WorkforceMonthCloseCheckResponse,
} from '../types/workforce';

export const workforceApi = {
  getEmployees: async (params?: Record<string, unknown>): Promise<PaginatedResponse<Employee>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.WORKFORCE_EMPLOYEES, { params });
    return response.data;
  },

  createEmployee: async (payload: EmployeePayload): Promise<Employee> => {
    const response = await axiosInstance.post(API_ENDPOINTS.WORKFORCE_EMPLOYEES, payload);
    return response.data;
  },

  updateEmployee: async (id: number, payload: Partial<EmployeePayload>): Promise<Employee> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.WORKFORCE_EMPLOYEES}${id}/`, payload);
    return response.data;
  },

  deleteEmployee: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.WORKFORCE_EMPLOYEES}${id}/`);
  },
  getEmployeeProfileHistories: async (params?: Record<string, unknown>): Promise<PaginatedResponse<EmployeeProfileHistory>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.WORKFORCE_EMPLOYEE_PROFILE_HISTORIES, { params });
    return response.data;
  },
  createEmployeeProfileHistory: async (payload: EmployeeProfileHistoryPayload): Promise<EmployeeProfileHistory> => {
    const response = await axiosInstance.post(API_ENDPOINTS.WORKFORCE_EMPLOYEE_PROFILE_HISTORIES, payload);
    return response.data;
  },
  updateEmployeeProfileHistory: async (
    id: number,
    payload: Partial<EmployeeProfileHistoryPayload>
  ): Promise<EmployeeProfileHistory> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.WORKFORCE_EMPLOYEE_PROFILE_HISTORIES}${id}/`, payload);
    return response.data;
  },
  deleteEmployeeProfileHistory: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.WORKFORCE_EMPLOYEE_PROFILE_HISTORIES}${id}/`);
  },

  getAttendanceRecords: async (params?: Record<string, unknown>): Promise<PaginatedResponse<AttendanceRecord>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.WORKFORCE_ATTENDANCE_RECORDS, { params });
    return response.data;
  },

  createAttendanceRecord: async (payload: AttendanceRecordPayload): Promise<AttendanceRecord> => {
    const response = await axiosInstance.post(API_ENDPOINTS.WORKFORCE_ATTENDANCE_RECORDS, payload);
    return response.data;
  },

  updateAttendanceRecord: async (
    id: number,
    payload: Partial<AttendanceRecordPayload>
  ): Promise<AttendanceRecord> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.WORKFORCE_ATTENDANCE_RECORDS}${id}/`, payload);
    return response.data;
  },

  deleteAttendanceRecord: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.WORKFORCE_ATTENDANCE_RECORDS}${id}/`);
  },

  getBonusPenaltyRecords: async (
    params?: Record<string, unknown>
  ): Promise<PaginatedResponse<BonusPenaltyRecord>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.WORKFORCE_BONUS_PENALTY_RECORDS, { params });
    return response.data;
  },

  createBonusPenaltyRecord: async (payload: BonusPenaltyRecordPayload): Promise<BonusPenaltyRecord> => {
    const response = await axiosInstance.post(API_ENDPOINTS.WORKFORCE_BONUS_PENALTY_RECORDS, payload);
    return response.data;
  },

  updateBonusPenaltyRecord: async (
    id: number,
    payload: Partial<BonusPenaltyRecordPayload>
  ): Promise<BonusPenaltyRecord> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.WORKFORCE_BONUS_PENALTY_RECORDS}${id}/`, payload);
    return response.data;
  },

  deleteBonusPenaltyRecord: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.WORKFORCE_BONUS_PENALTY_RECORDS}${id}/`);
  },

  getSalaryAdvances: async (params?: Record<string, unknown>): Promise<PaginatedResponse<SalaryAdvanceRecord>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.WORKFORCE_SALARY_ADVANCES, { params });
    return response.data;
  },

  createSalaryAdvance: async (payload: SalaryAdvanceRecordPayload): Promise<SalaryAdvanceRecord> => {
    const response = await axiosInstance.post(API_ENDPOINTS.WORKFORCE_SALARY_ADVANCES, payload);
    return response.data;
  },

  updateSalaryAdvance: async (
    id: number,
    payload: Partial<SalaryAdvanceRecordPayload>
  ): Promise<SalaryAdvanceRecord> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.WORKFORCE_SALARY_ADVANCES}${id}/`, payload);
    return response.data;
  },

  deleteSalaryAdvance: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.WORKFORCE_SALARY_ADVANCES}${id}/`);
  },
  getSalaryAdvanceApprovalQueue: async (): Promise<SalaryAdvanceApprovalQueueResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.WORKFORCE_SALARY_ADVANCE_APPROVAL_QUEUE);
    return response.data as SalaryAdvanceApprovalQueueResponse;
  },
  getSalaryAdvanceApprovalHistory: async (id: number): Promise<SalaryAdvanceApprovalHistoryItem[]> => {
    const response = await axiosInstance.get(
      API_ENDPOINTS.WORKFORCE_SALARY_ADVANCE_APPROVAL_HISTORY.replace('{id}', String(id))
    );
    return response.data as SalaryAdvanceApprovalHistoryItem[];
  },
  getSalaryAdvanceApprovalSlaOverview: async (): Promise<SalaryAdvanceApprovalSlaOverviewResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.WORKFORCE_SALARY_ADVANCE_APPROVAL_SLA_OVERVIEW);
    return response.data as SalaryAdvanceApprovalSlaOverviewResponse;
  },
  getSalaryAdvanceApprovalSlaReminderHistory: async (params?: { days?: number }): Promise<SalaryAdvanceApprovalSlaReminderHistoryResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.WORKFORCE_SALARY_ADVANCE_APPROVAL_SLA_REMINDER_HISTORY, { params });
    return response.data as SalaryAdvanceApprovalSlaReminderHistoryResponse;
  },
  getSalaryAdvanceApprovalSlaPolicy: async (): Promise<SalaryAdvanceApprovalSlaPolicy> => {
    const response = await axiosInstance.get(API_ENDPOINTS.WORKFORCE_SALARY_ADVANCE_APPROVAL_SLA_POLICY);
    return response.data as SalaryAdvanceApprovalSlaPolicy;
  },
  saveSalaryAdvanceApprovalSlaPolicy: async (payload: Partial<SalaryAdvanceApprovalSlaPolicy>): Promise<{ success: boolean; policy: SalaryAdvanceApprovalSlaPolicy }> => {
    const response = await axiosInstance.post(API_ENDPOINTS.WORKFORCE_SALARY_ADVANCE_APPROVAL_SLA_POLICY, payload);
    return response.data as { success: boolean; policy: SalaryAdvanceApprovalSlaPolicy };
  },
  remindSalaryAdvancePendingApprovals: async (payload?: { dry_run?: boolean }): Promise<{
    success: boolean;
    dry_run: boolean;
    sent_count: number;
    sent_usernames: string[];
    overview: SalaryAdvanceApprovalSlaOverviewResponse;
  }> => {
    const response = await axiosInstance.post(API_ENDPOINTS.WORKFORCE_SALARY_ADVANCE_REMIND_PENDING_APPROVALS, payload || {});
    return response.data as {
      success: boolean;
      dry_run: boolean;
      sent_count: number;
      sent_usernames: string[];
      overview: SalaryAdvanceApprovalSlaOverviewResponse;
    };
  },
  submitSalaryAdvanceApproval: async (id: number): Promise<{ success: boolean; approval_status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_SALARY_ADVANCES}${id}/submit_approval/`);
    return response.data as { success: boolean; approval_status: string };
  },
  approveSalaryAdvanceLevel1: async (id: number): Promise<{ success: boolean; approval_status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_SALARY_ADVANCES}${id}/approve_level1/`);
    return response.data as { success: boolean; approval_status: string };
  },
  approveSalaryAdvanceLevel2: async (id: number): Promise<{ success: boolean; approval_status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_SALARY_ADVANCES}${id}/approve_level2/`);
    return response.data as { success: boolean; approval_status: string };
  },
  rejectSalaryAdvanceApproval: async (id: number, reason: string): Promise<{ success: boolean; approval_status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_SALARY_ADVANCES}${id}/reject_approval/`, { reason });
    return response.data as { success: boolean; approval_status: string };
  },
  postSalaryAdvanceDisbursement: async (
    id: number,
    payload: { source_type: 'CASH' | 'BANK'; source_cash_account?: number | null; source_bank_account?: number | null }
  ): Promise<{ success: boolean; transaction_id: number; disbursement_status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_SALARY_ADVANCES}${id}/post_disbursement/`, payload);
    return response.data as { success: boolean; transaction_id: number; disbursement_status: string };
  },
  reverseSalaryAdvanceDisbursement: async (
    id: number
  ): Promise<{ success: boolean; transaction_id: number; disbursement_status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_SALARY_ADVANCES}${id}/reverse_disbursement/`);
    return response.data as { success: boolean; transaction_id: number; disbursement_status: string };
  },

  getPayrollRecords: async (params?: Record<string, unknown>): Promise<PaginatedResponse<PayrollRecord>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.WORKFORCE_PAYROLL_RECORDS, { params });
    return response.data;
  },

  calculatePayrollMonth: async (month: string, overwrite = true): Promise<{ success: boolean; month: string; count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_PAYROLL_RECORDS}calculate_month/`, {
      month,
      overwrite,
    });
    return response.data;
  },

  lockPayroll: async (
    id: number,
    payload?: {
      source_type?: 'CASH' | 'BANK';
      source_cash_account?: number | null;
      source_bank_account?: number | null;
      save_as_default?: boolean;
    }
  ): Promise<{ success: boolean; status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_PAYROLL_RECORDS}${id}/lock/`, payload || {});
    return response.data;
  },

  getPayrollPostingDefaults: async (): Promise<{
    source_type?: 'CASH' | 'BANK';
    source_cash_account?: number | null;
    source_bank_account?: number | null;
  }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.WORKFORCE_PAYROLL_RECORDS}posting_defaults/`);
    return response.data as {
      source_type?: 'CASH' | 'BANK';
      source_cash_account?: number | null;
      source_bank_account?: number | null;
    };
  },

  unlockPayroll: async (id: number): Promise<{ success: boolean; status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_PAYROLL_RECORDS}${id}/unlock/`);
    return response.data;
  },

  getPayrollLockedMonths: async (): Promise<{ months: string[] }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.WORKFORCE_PAYROLL_RECORDS}locked_months/`);
    return response.data as { months: string[] };
  },

  getPayrollMonthCloseCheck: async (month: string): Promise<WorkforceMonthCloseCheckResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.WORKFORCE_PAYROLL_RECORDS}preclose_check/`, {
      params: { month },
    });
    return response.data as WorkforceMonthCloseCheckResponse;
  },

  lockPayrollMonth: async (month: string): Promise<{ success: boolean; months: string[] }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_PAYROLL_RECORDS}lock_month/`, { month });
    return response.data as { success: boolean; months: string[] };
  },

  unlockPayrollMonth: async (month: string): Promise<{ success: boolean; months: string[] }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_PAYROLL_RECORDS}unlock_month/`, { month });
    return response.data as { success: boolean; months: string[] };
  },
};

