import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  PaginatedResponse,
  QualityImageArtifact,
  QualityImageRetentionPolicy,
  QualityInspection,
  QualityInspectionQueryParams,
  QualityStorageSettings,
  VisionInspectionJob,
} from '../types/quality';

export const qualityApi = {
  listPrintingInspections: async (
    params?: QualityInspectionQueryParams,
  ): Promise<PaginatedResponse<QualityInspection>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.QUALITY_PRINTING_INSPECTIONS, { params });
    return response.data;
  },

  getPrintingInspection: async (id: number): Promise<QualityInspection> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.QUALITY_PRINTING_INSPECTIONS}${id}/`);
    return response.data;
  },

  listVisionJobs: async (params?: Record<string, unknown>): Promise<PaginatedResponse<VisionInspectionJob>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.QUALITY_VISION_JOBS, { params });
    return response.data;
  },

  listImageArtifacts: async (params?: Record<string, unknown>): Promise<PaginatedResponse<QualityImageArtifact>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.QUALITY_IMAGE_ARTIFACTS, { params });
    return response.data;
  },

  getStorageSettings: async (): Promise<QualityStorageSettings> => {
    const response = await axiosInstance.get(API_ENDPOINTS.QUALITY_STORAGE_SETTINGS);
    return response.data;
  },

  listRetentionPolicies: async (
    params?: Record<string, unknown>,
  ): Promise<PaginatedResponse<QualityImageRetentionPolicy>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.QUALITY_IMAGE_RETENTION_POLICIES, { params });
    return response.data;
  },
};
