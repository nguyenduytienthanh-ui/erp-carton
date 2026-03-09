import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  AttendanceRecord,
  AttendanceRecordPayload,
  BonusPenaltyRecord,
  BonusPenaltyRecordPayload,
  Employee,
  EmployeePayload,
  PaginatedResponse,
  PayrollRecord,
  SalaryAdvanceRecord,
  SalaryAdvanceRecordPayload,
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

  lockPayroll: async (id: number): Promise<{ success: boolean; status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_PAYROLL_RECORDS}${id}/lock/`);
    return response.data;
  },

  unlockPayroll: async (id: number): Promise<{ success: boolean; status: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.WORKFORCE_PAYROLL_RECORDS}${id}/unlock/`);
    return response.data;
  },
};

