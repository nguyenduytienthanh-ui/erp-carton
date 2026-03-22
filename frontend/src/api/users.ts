import axiosInstance from './axios';
import { API_ENDPOINTS } from '../utils/constants';

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
  full_name?: string;
  phone?: string;
  avatar_url?: string | null;
  is_staff: boolean;
  is_active: boolean;
  is_locked: boolean;
  teams?: Array<{
    id: number;
    code: string;
    name: string;
  }>;
  date_joined?: string;
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

export interface UpdateCurrentUserPayload {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export interface UserSessionRecord {
  id: number;
  session_key: string;
  device_info: Record<string, unknown>;
  device_summary: string;
  browser: string;
  operating_system: string;
  ip_address: string;
  login_at: string;
  last_active: string;
  logout_at: string | null;
  is_active: boolean;
  is_current: boolean;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface BulkUsersResponse {
  success: boolean;
  count: number;
  skipped_self?: number;
  strategy?: string;
}

export interface AccountActivityItem {
  id: string;
  kind: 'notification' | 'audit' | 'session' | string;
  kind_label: string;
  timestamp: string;
  title: string;
  summary: string;
  status: string;
  tone: string;
  route: string;
  meta: Record<string, unknown>;
}

export interface AccountHubTaskPreview {
  id: number;
  title: string;
  entity_type: string;
  entity_code: string;
  status: string;
  status_display: string;
  priority: string;
  priority_display: string;
  due_date: string | null;
  needs_help: boolean;
  is_blocking: boolean;
  route: string;
}

export interface AccountHubModuleAccess {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  primary_route: string;
  matched_permissions: string[];
  source_roles: string[];
}

export interface AccountHubRoleSummary {
  id: number;
  code: string;
  name: string;
  permission_count: number;
}

export interface AccountHubTeamSummary {
  id: number;
  code: string;
  name: string;
}

export interface AccountHubResponse {
  profile_completion: {
    score: number;
    completed_fields: number;
    total_fields: number;
    missing_fields: string[];
  };
  security: {
    score: number;
    level: 'good' | 'warning' | 'critical' | string;
    active_sessions: number;
    other_active_sessions: number;
    unique_ip_count: number;
    stale_session_count: number;
    last_login_at: string | null;
    current_browser: string;
    current_operating_system: string;
    recommendations: string[];
  };
  work_summary: {
    open_tasks: number;
    in_progress_tasks: number;
    overdue_tasks: number;
    needs_help_tasks: number;
    high_priority_tasks: number;
    blocking_tasks: number;
    preview: AccountHubTaskPreview[];
  };
  notification_summary: {
    unread_count: number;
    important_unread_count: number;
    recent_7d_count: number;
    last_unread_at: string | null;
  };
  access_summary: {
    enabled_module_count: number;
    permission_count: number;
    top_permissions: Array<{
      key: string;
      resource: string;
      action: string;
      code: string;
      name: string;
    }>;
    modules: AccountHubModuleAccess[];
    roles: AccountHubRoleSummary[];
    teams: AccountHubTeamSummary[];
  };
  activity_preview: AccountActivityItem[];
}

export interface AdminUserDirectoryFilters {
  search?: string;
  role?: number;
  team?: number;
  is_active?: boolean;
  is_locked?: boolean;
  attention?: 'all' | 'review' | 'unassigned' | 'locked' | 'inactive' | 'dormant';
  session_state?: 'all' | 'online' | 'offline';
  page?: number;
  page_size?: number;
}

export interface AdminUserDirectoryItem extends CurrentUserProfile {
  active_session_count: number;
  last_seen_at: string | null;
  last_login_at: string | null;
  last_seen_ip: string | null;
  role_count: number;
  team_count: number;
}

export interface AdminUserDirectorySummaryBreakdownItem {
  id: number;
  code: string;
  name: string;
  user_count: number;
}

export interface AdminUserDirectoryFocusItem {
  id: number;
  username: string;
  full_name: string;
  email: string;
  is_active: boolean;
  is_locked: boolean;
  active_session_count: number;
  last_seen_at: string | null;
  role_count: number;
  team_count: number;
  reasons: string[];
  severity: 'warning' | 'error' | string;
  route: string;
}

export interface AdminUserDirectorySummary {
  total_users: number;
  active_users: number;
  inactive_users: number;
  locked_users: number;
  staff_users: number;
  online_users: number;
  dormant_users: number;
  without_role_users: number;
  without_team_users: number;
  attention_users: number;
  role_breakdown: AdminUserDirectorySummaryBreakdownItem[];
  team_breakdown: AdminUserDirectorySummaryBreakdownItem[];
  focus_items: AdminUserDirectoryFocusItem[];
}

export interface UserAccessProfilePayload {
  role_ids?: number[];
  team_ids?: number[];
}

export interface BulkUserAccessPayload extends UserAccessProfilePayload {
  ids: number[];
  strategy: 'add' | 'replace' | 'remove';
}

export interface UserAccessActivityItem {
  id: number;
  timestamp: string;
  summary: string;
  changed_fields: string[];
  strategy: 'add' | 'replace' | 'remove' | string;
  actor: {
    id: number | null;
    username: string;
    full_name: string;
  };
  target_user: {
    id: number;
    username: string;
    full_name: string;
  };
  roles_before: Array<{ id: number; code: string; name: string }>;
  roles_after: Array<{ id: number; code: string; name: string }>;
  teams_before: Array<{ id: number; code: string; name: string }>;
  teams_after: Array<{ id: number; code: string; name: string }>;
}

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

export function getUserDisplayName(u: UserMention): string {
  const full = `${u.first_name} ${u.last_name}`.trim();
  return full || u.username;
}

export const usersApi = {
  me: async (): Promise<CurrentUserProfile> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}me/`);
    return response.data as CurrentUserProfile;
  },
  updateMe: async (payload: UpdateCurrentUserPayload): Promise<CurrentUserProfile> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.USERS}me/`, payload);
    return response.data as CurrentUserProfile;
  },
  changePassword: async (payload: ChangePasswordPayload): Promise<{ success: boolean; revoked_sessions: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}change_password/`, payload);
    return response.data as { success: boolean; revoked_sessions: number };
  },
  list: async (filters: UserDirectoryFilters = {}): Promise<UserMention[]> => {
    const response = await axiosInstance.get(API_ENDPOINTS.USERS, {
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
    const response = await axiosInstance.get(API_ENDPOINTS.ROLES, { params: { page_size: 200, is_active: true } });
    return (response.data.results ?? response.data) as UserRoleOption[];
  },
  listTeams: async (): Promise<UserTeamOption[]> => {
    const response = await axiosInstance.get('/teams/', { params: { page_size: 200, is_active: true } });
    return (response.data.results ?? response.data) as UserTeamOption[];
  },
  getAccountHub: async (): Promise<AccountHubResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}account_hub/`);
    return response.data as AccountHubResponse;
  },
  getActivityFeed: async (params?: { kind?: string; limit?: number }): Promise<{ items: AccountActivityItem[]; total: number; kind: string }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}activity_feed/`, { params });
    return response.data as { items: AccountActivityItem[]; total: number; kind: string };
  },
  getDirectory: async (filters: AdminUserDirectoryFilters = {}): Promise<PaginatedResponse<AdminUserDirectoryItem>> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}directory/`, {
      params: {
        search: filters.search || undefined,
        role: filters.role || undefined,
        team: filters.team || undefined,
        is_active: filters.is_active ?? undefined,
        is_locked: filters.is_locked ?? undefined,
        attention: filters.attention && filters.attention !== 'all' ? filters.attention : undefined,
        session_state: filters.session_state && filters.session_state !== 'all' ? filters.session_state : undefined,
        page: filters.page || undefined,
        page_size: filters.page_size || undefined,
      },
    });
    return normalizePaginatedResponse(response.data as PaginatedResponse<AdminUserDirectoryItem> | AdminUserDirectoryItem[]);
  },
  getDirectorySummary: async (filters: AdminUserDirectoryFilters = {}): Promise<AdminUserDirectorySummary> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}directory_summary/`, {
      params: {
        search: filters.search || undefined,
        role: filters.role || undefined,
        team: filters.team || undefined,
        is_active: filters.is_active ?? undefined,
        is_locked: filters.is_locked ?? undefined,
        attention: filters.attention && filters.attention !== 'all' ? filters.attention : undefined,
        session_state: filters.session_state && filters.session_state !== 'all' ? filters.session_state : undefined,
      },
    });
    return response.data as AdminUserDirectorySummary;
  },
  bulkActivate: async (payload: { ids: number[]; is_active: boolean }): Promise<BulkUsersResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}bulk_activate/`, payload);
    return response.data as BulkUsersResponse;
  },
  bulkLock: async (payload: { ids: number[]; is_locked: boolean }): Promise<BulkUsersResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}bulk_lock/`, payload);
    return response.data as BulkUsersResponse;
  },
  updateAccessProfile: async (userId: number, payload: UserAccessProfilePayload): Promise<{ success: boolean; changed_fields: string[]; user: AdminUserDirectoryItem }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}${userId}/access_profile/`, payload);
    return response.data as { success: boolean; changed_fields: string[]; user: AdminUserDirectoryItem };
  },
  bulkAccess: async (payload: BulkUserAccessPayload): Promise<BulkUsersResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}bulk_access/`, payload);
    return response.data as BulkUsersResponse;
  },
  getAccessActivity: async (params?: { user_id?: number; limit?: number }): Promise<{ items: UserAccessActivityItem[]; total: number }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}access_activity/`, { params });
    return response.data as { items: UserAccessActivityItem[]; total: number };
  },
};

export const sessionsApi = {
  list: async (params?: Record<string, unknown>): Promise<PaginatedResponse<UserSessionRecord>> => {
    const response = await axiosInstance.get(API_ENDPOINTS.SESSIONS, { params });
    return normalizePaginatedResponse(response.data as PaginatedResponse<UserSessionRecord> | UserSessionRecord[]);
  },
  revoke: async (id: number): Promise<{ success: boolean }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SESSIONS}${id}/revoke/`);
    return response.data as { success: boolean };
  },
  revokeAll: async (): Promise<{ success: boolean; count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.SESSIONS}revoke_all/`);
    return response.data as { success: boolean; count: number };
  },
};
