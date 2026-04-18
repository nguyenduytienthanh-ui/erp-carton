import axiosInstance from './axios';
import type { UserPreferences, PreferencesConfig } from '../types/preferences';

export const preferencesApi = {
  /**
   * Lấy config cho page
   */
  getConfig: async (page: string): Promise<PreferencesConfig> => {
    try {
      const response = await axiosInstance.get(`/preferences/${page}/`);
      return (response.data.config ?? {}) as PreferencesConfig;
    } catch {
      return {};
    }
  },

  /**
   * Lưu config cho page
   */
  saveConfig: async (page: string, config: PreferencesConfig): Promise<UserPreferences> => {
    const response = await axiosInstance.post(`/preferences/${page}/`, { config });
    return response.data as UserPreferences;
  },

  /**
   * Xóa config cho page
   */
  deleteConfig: async (page: string): Promise<void> => {
    await axiosInstance.delete(`/preferences/${page}/`);
  },
};
