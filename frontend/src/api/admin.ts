import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type {
  RoleModulePermissionFreezeHistoryResponse,
  RoleModulePermissionHistoryResponse,
  RoleModulePermissionHistoryMetaResponse,
  RoleModulePermissionResponse,
  RoleModulePermissionUpdatePayload,
} from '../types/admin';

export const adminApi = {
  getRoleModulePermissions: async (): Promise<RoleModulePermissionResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.ROLE_MODULE_PERMISSIONS);
    return response.data as RoleModulePermissionResponse;
  },

  updateRoleModulePermissions: async (payload: RoleModulePermissionUpdatePayload): Promise<{ success: boolean; updated: number }> => {
    const response = await axiosInstance.post(API_ENDPOINTS.ROLE_MODULE_PERMISSIONS, payload);
    return response.data as { success: boolean; updated: number };
  },

  getRoleModulePermissionHistory: async (params?: {
    q?: string;
    user_id?: number;
    date_from?: string;
    date_to?: string;
    role_code?: string;
    changed_type?: string;
    page?: number;
    page_size?: number;
  }): Promise<RoleModulePermissionHistoryResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.ROLE_MODULE_PERMISSIONS_HISTORY, { params });
    return response.data as RoleModulePermissionHistoryResponse;
  },

  exportRoleModulePermissionHistoryExcel: async (params?: {
    q?: string;
    user_id?: number;
    date_from?: string;
    date_to?: string;
    role_code?: string;
    changed_type?: string;
  }): Promise<Blob> => {
    const response = await axiosInstance.get(API_ENDPOINTS.ROLE_MODULE_PERMISSIONS_HISTORY, {
      params: { ...params, export: 'excel' },
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  prepareFreezeModulePermissionActor: async (payload: {
    user_id: number;
    hours?: number;
    reason?: string;
  }): Promise<{
    success: boolean;
    prepare_token: string;
    target_user: { id: number; username: string; full_name: string };
    hours: number;
  }> => {
    const response = await axiosInstance.post('/roles/module_permissions_freeze_prepare/', payload);
    return response.data as {
      success: boolean;
      prepare_token: string;
      target_user: { id: number; username: string; full_name: string };
      hours: number;
    };
  },

  applyFreezeModulePermissionActor: async (payload: {
    prepare_token: string;
    confirm_text: string;
  }): Promise<{ success: boolean; user_id: number; frozen_until: string }> => {
    const response = await axiosInstance.post('/roles/module_permissions_freeze_apply/', payload);
    return response.data as { success: boolean; user_id: number; frozen_until: string };
  },

  unfreezeModulePermissionActor: async (payload: {
    user_id: number;
    confirm_text: string;
  }): Promise<{ success: boolean; user_id: number }> => {
    const response = await axiosInstance.post('/roles/module_permissions_unfreeze_actor/', payload);
    return response.data as { success: boolean; user_id: number };
  },

  getRoleModulePermissionFreezeHistory: async (params?: {
    q?: string;
    action_type?: 'LOCK' | 'ACTIVATE';
    page?: number;
    page_size?: number;
  }): Promise<RoleModulePermissionFreezeHistoryResponse> => {
    const response = await axiosInstance.get('/roles/module_permissions_freeze_history/', { params });
    return response.data as RoleModulePermissionFreezeHistoryResponse;
  },

  getRoleModulePermissionHistoryMeta: async (): Promise<RoleModulePermissionHistoryMetaResponse> => {
    const response = await axiosInstance.get('/roles/module_permissions_history_meta/');
    return response.data as RoleModulePermissionHistoryMetaResponse;
  },
};
