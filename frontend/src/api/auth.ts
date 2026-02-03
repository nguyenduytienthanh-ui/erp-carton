import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';
import type { LoginRequest, LoginResponse } from '../types/auth';

export const authApi = {
  // Đăng nhập
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await axiosInstance.post(API_ENDPOINTS.LOGIN, data);
    return response.data;
  },

  // Đăng xuất
  logout: async (): Promise<void> => {
    await axiosInstance.post(API_ENDPOINTS.LOGOUT);
  },

  // Refresh token
  refresh: async (refreshToken: string): Promise<{ access: string }> => {
    const response = await axiosInstance.post(API_ENDPOINTS.REFRESH, {
      refresh: refreshToken,
    });
    return response.data;
  },
};
