import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  CustomReportDefinition,
  CustomReportDetail,
  CustomReportGeneratedResult,
  CustomReportHistoryParams,
  CustomReportListParams,
  CustomReportRun,
  CustomReportSummary,
  CustomReportUpsertPayload,
  GenerateCustomReportPayload,
  PaginatedResponse,
  ScheduleCustomReportPayload,
  ScheduleCustomReportResponse,
} from '../types/reports';

function normalizePaginatedResponse<T>(data: PaginatedResponse<T> | T[]): PaginatedResponse<T> {
  if (Array.isArray(data)) {
    return {
      count: data.length,
      next: null,
      previous: null,
      results: data,
    };
  }
  return data;
}

export const reportsApi = {
  getCustomReports: async (params?: CustomReportListParams): Promise<PaginatedResponse<CustomReportDefinition>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.REPORTS_CUSTOM, { params });
    return normalizePaginatedResponse(response.data as PaginatedResponse<CustomReportDefinition> | CustomReportDefinition[]);
  },

  getCustomReportsSummary: async (params?: Omit<CustomReportListParams, 'page' | 'page_size' | 'ordering'>): Promise<CustomReportSummary> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.REPORTS_CUSTOM}summary/`, { params });
    return response.data as CustomReportSummary;
  },

  getCustomReport: async (id: number): Promise<CustomReportDetail> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.REPORTS_CUSTOM}${id}/`);
    return response.data as CustomReportDetail;
  },

  createCustomReport: async (payload: CustomReportUpsertPayload): Promise<CustomReportDefinition> => {
    const response = await axiosInstance.post(API_ENDPOINTS.REPORTS_CUSTOM, payload);
    return response.data as CustomReportDefinition;
  },

  updateCustomReport: async (
    id: number,
    payload: Partial<CustomReportUpsertPayload>
  ): Promise<CustomReportDefinition> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.REPORTS_CUSTOM}${id}/`, payload);
    return response.data as CustomReportDefinition;
  },

  deleteCustomReport: async (id: number): Promise<void> => {
    await axiosInstance.delete(`${API_ENDPOINTS.REPORTS_CUSTOM}${id}/`);
  },

  getCustomReportHistory: async (
    params?: CustomReportHistoryParams
  ): Promise<PaginatedResponse<CustomReportRun>> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.REPORTS_CUSTOM}history/`, { params });
    return normalizePaginatedResponse(response.data as PaginatedResponse<CustomReportRun> | CustomReportRun[]);
  },

  generateCustomReport: async (
    payload: GenerateCustomReportPayload
  ): Promise<CustomReportGeneratedResult> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.REPORTS_CUSTOM}generate_report/`, payload);
    return response.data as CustomReportGeneratedResult;
  },

  scheduleCustomReport: async (
    payload: ScheduleCustomReportPayload
  ): Promise<ScheduleCustomReportResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.REPORTS_CUSTOM}schedule_report/`, payload);
    return response.data as ScheduleCustomReportResponse;
  },
};
