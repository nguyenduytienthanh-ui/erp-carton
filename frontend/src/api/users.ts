import axiosInstance from './axios';

export interface UserMention {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  roles?: Array<{ id: number; code: string; name: string }>;
  teams?: Array<{ id: number; code: string; name: string }>;
}

export interface UserDirectoryFilters {
  search?: string;
  role?: number;
  team?: number;
  is_active?: boolean;
}

export interface UserRoleOption {
  id: number;
  code: string;
  name: string;
}

export interface UserTeamOption {
  id: number;
  code: string;
  name: string;
}

export interface CurrentUserProfile {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_staff: boolean;
  is_active: boolean;
  is_locked: boolean;
  roles?: Array<{
    id: number;
    code: string;
    name: string;
    permissions?: Array<{
      id: number;
      code: string;
      resource: string;
      action: string;
      name: string;
    }>;
  }>;
}

export function getUserDisplayName(u: UserMention): string {
  const full = `${u.first_name} ${u.last_name}`.trim();
  return full || u.username;
}

export const usersApi = {
  me: async (): Promise<CurrentUserProfile> => {
    const response = await axiosInstance.get('/users/me/');
    return response.data as CurrentUserProfile;
  },
  list: async (filters: UserDirectoryFilters = {}): Promise<UserMention[]> => {
    const response = await axiosInstance.get('/users/', {
      params: {
        search: filters.search || undefined,
        role: filters.role || undefined,
        team: filters.team || undefined,
        page_size: 30,
        is_active: filters.is_active ?? true,
      },
    });
    return (response.data.results ?? response.data) as UserMention[];
  },
  listRoles: async (): Promise<UserRoleOption[]> => {
    const response = await axiosInstance.get('/roles/', { params: { page_size: 200, is_active: true } });
    return (response.data.results ?? response.data) as UserRoleOption[];
  },
  listTeams: async (): Promise<UserTeamOption[]> => {
    const response = await axiosInstance.get('/teams/', { params: { page_size: 200, is_active: true } });
    return (response.data.results ?? response.data) as UserTeamOption[];
  },
};
