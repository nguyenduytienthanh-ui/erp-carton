export interface ColumnPermission {
  id: number;
  page: string;
  column: string;
  column_label: string;
  allowed_roles: string[];
  allowed_users_list: Array<{ id: number; username: string; email: string }>;
  is_restricted: boolean;
  is_active: boolean;
}

export interface AvailableColumnsResponse {
  page: string;
  available_columns: string[];
  restricted_columns: string[];
  user_roles: string[];
  user_id: number;
}
