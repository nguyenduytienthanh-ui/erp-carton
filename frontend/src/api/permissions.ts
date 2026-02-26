import axiosInstance from './axios';
import type { AvailableColumnsResponse } from '../types/permissions';

export const permissionsApi = {
  /**
   * Lấy danh sách cột user được phép xem
   */
  getAvailableColumns: async (page: string): Promise<AvailableColumnsResponse> => {
    try {
      const response = await axiosInstance.get(
        `/column-permissions/${page}/available/`
      );
      return response.data;
    } catch {
      return { page, user_id: 0, available_columns: [], restricted_columns: [], user_roles: [] };
    }
  },
};
