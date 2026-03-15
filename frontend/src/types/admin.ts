export interface RoleModulePermissionItem {
  role_id: number;
  role_code: string;
  role_name: string;
  is_active: boolean;
  workforce_manage: boolean;
  finance_manage: boolean;
  purchasing_manage: boolean;
  production_manage: boolean;
  ops_view: boolean;
  reports_view: boolean;
  workflow_view: boolean;
  workflow_manage: boolean;
  operations_log_view: boolean;
  rbac_audit_view: boolean;
  rbac_manage: boolean;
}

export interface RoleModulePermissionResponse {
  items: RoleModulePermissionItem[];
  field_meta?: Array<{
    field: keyof RoleModulePermissionItem | string;
    label: string;
    changed_type: string;
  }>;
}

export interface RoleModulePermissionUpdatePayload {
  items: Array<{
    role_id: number;
    workforce_manage: boolean;
    finance_manage: boolean;
    purchasing_manage: boolean;
    production_manage: boolean;
    ops_view: boolean;
    reports_view: boolean;
    workflow_view: boolean;
    workflow_manage: boolean;
    operations_log_view: boolean;
    rbac_audit_view: boolean;
    rbac_manage: boolean;
  }>;
}

export interface RoleModulePermissionHistoryItem {
  id: number;
  created_at: string | null;
  action: string;
  entity_type: string;
  entity_code: string;
  changed_fields: string[];
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  ip_address: string | null;
  user: {
    id: number | null;
    username: string | null;
    full_name: string;
  };
}

export interface RoleModulePermissionHistoryResponse {
  count: number;
  results: RoleModulePermissionHistoryItem[];
  summary?: {
    total_events: number;
    total_role_changes: number;
    by_changed_type: Record<string, number>;
    top_actors: Array<{
      user_id: number | null;
      username: string;
      full_name: string;
      events: number;
      role_changes: number;
    }>;
    trend_12m?: Array<{
      month: string;
      events: number;
      role_changes: number;
    }>;
    anomalies_24h?: Array<{
      user_id: number | null;
      username: string;
      full_name: string;
      events_24h: number;
      role_changes_24h: number;
      severity: 'medium' | 'high';
      is_frozen?: boolean;
      frozen_until?: string | null;
    }>;
  };
}

export interface RoleModulePermissionHistoryMetaResponse {
  users: Array<{
    id: number;
    username: string;
    full_name: string;
  }>;
  changed_types: Array<{
    value: string;
    label: string;
  }>;
  anomalies_24h_count: number;
}

export interface RoleModulePermissionFreezeHistoryItem {
  id: number;
  created_at: string | null;
  action: 'LOCK' | 'ACTIVATE' | string;
  entity_code: string;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  actor: {
    id: number | null;
    username: string | null;
    full_name: string;
  };
  target_user: {
    id: number | null;
    username: string | null;
    full_name: string;
    is_active_freeze: boolean;
    frozen_until: string | null;
  };
}

export interface RoleModulePermissionFreezeHistoryResponse {
  count: number;
  results: RoleModulePermissionFreezeHistoryItem[];
}
