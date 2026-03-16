import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';

export interface CustomReportItem {
  id?: number;
  code?: string;
  name?: string;
  report_type?: string;
  description?: string;
  status?: string;
  [key: string]: unknown;
}

export const reportsApi = {
  getCustomReports: async (): Promise<CustomReportItem[]> => {
    const response = await axiosInstance.get(API_ENDPOINTS.REPORTS_CUSTOM);
    const data = response.data;
    if (Array.isArray(data)) return data;
    if (data?.results && Array.isArray(data.results)) return data.results;
    return [];
  },
  generateCustomReport: async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.REPORTS_CUSTOM}generate_report/`, payload);
    return response.data;
  },
  scheduleCustomReport: async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.REPORTS_CUSTOM}schedule_report/`, payload);
    return response.data;
  },
};
