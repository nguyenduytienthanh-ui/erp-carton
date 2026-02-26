import axiosInstance from './axios';

export interface UserMention {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
}

export function getUserDisplayName(u: UserMention): string {
  const full = `${u.first_name} ${u.last_name}`.trim();
  return full || u.username;
}

export const usersApi = {
  list: async (search?: string): Promise<UserMention[]> => {
    const response = await axiosInstance.get('/users/', {
      params: { search: search || undefined, page_size: 30, is_active: true },
    });
    return (response.data.results ?? response.data) as UserMention[];
  },
};
