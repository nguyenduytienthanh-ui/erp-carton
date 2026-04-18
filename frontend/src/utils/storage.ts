import { STORAGE_KEYS } from './constants';
import type { CurrentUserProfile } from '../api/users';

export type StoredUserProfile =
  Pick<CurrentUserProfile, 'username'> &
  Partial<Omit<CurrentUserProfile, 'username'>>;

function readStoredUser(): StoredUserProfile | null {
  const rawUser = localStorage.getItem(STORAGE_KEYS.USER);
  if (!rawUser || rawUser === 'undefined' || rawUser === 'null') {
    return null;
  }

  try {
    const parsed = JSON.parse(rawUser) as StoredUserProfile | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.username !== 'string') {
      localStorage.removeItem(STORAGE_KEYS.USER);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEYS.USER);
    return null;
  }
}

export const storage = {
  // Token management
  getAccessToken: (): string | null => {
    return localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  },

  setAccessToken: (token: string): void => {
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token);
  },

  getRefreshToken: (): string | null => {
    return localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
  },

  setRefreshToken: (token: string): void => {
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, token);
  },

  // User management
  getUser: (): StoredUserProfile | null => {
    return readStoredUser();
  },

  setUser: (user: StoredUserProfile): void => {
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  },

  // Clear all
  clear: (): void => {
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
  },
};
