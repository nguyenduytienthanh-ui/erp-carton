import axiosInstance from './axios';

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'Chờ thực hiện',
  IN_PROGRESS: 'Đang thực hiện',
  DONE: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
  URGENT: 'Khẩn cấp',
};

export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
  LOW: 'default',
  MEDIUM: 'blue',
  HIGH: 'orange',
  URGENT: 'red',
};

type UserInfo = { id: number; username: string; full_name: string };
type DependsOnInfo = { id: number; title: string; status: TaskStatus; status_display: string };

export interface TaskItem {
  id: number;
  entity_type: string;
  entity_id: number;
  entity_code: string;
  title: string;
  description: string;
  assigned_to: number | null;
  assigned_to_info: UserInfo | null;
  assigned_by: number | null;
  assigned_by_info: UserInfo | null;
  depends_on: number | null;
  depends_on_info: DependsOnInfo | null;
  status: TaskStatus;
  status_display: string;
  priority: TaskPriority;
  priority_display: string;
  is_pinned: boolean;
  tags: string[];
  is_blocking: boolean;
  blocks_action: string;
  due_date: string | null;
  completed_at: string | null;
  // Cần hỗ trợ
  needs_help: boolean;
  help_reason: string;
  help_requested_at: string | null;
  // Ghi chú tiến độ
  last_update_note: string;
  last_update_at: string | null;
  last_updated_by: number | null;
  last_updated_by_info: UserInfo | null;
  // Meta bình luận/file cho badge UI
  comment_count: number;
  attachment_count: number;
  activity_updated_at: string | null;
  watchers_count: number;
  is_watching: boolean;
  created_at: string;
  updated_at: string;
  is_open: boolean;
}

export interface TaskCreatePayload {
  entity_type: string;
  entity_id: number;
  entity_code?: string;
  title: string;
  description?: string;
  assigned_to?: number | null;
  depends_on?: number | null;
  priority?: TaskPriority;
  is_pinned?: boolean;
  tags?: string[];
  is_blocking?: boolean;
  blocks_action?: string;
  due_date?: string | null;
}

export interface OverdueReminderResult {
  success: boolean;
  sent_count: number;
  overdue_days: number;
  message: string;
}

export interface TaskMySummary {
  assigned_to_me: number;
  created_by_me: number;
  watching: number;
  team_members: number;
  overdue: number;
}

export const tasksApi = {
  list(params: {
    entity_type?: string;
    entity_id?: number;
    status?: string;
    mine?: boolean;
    created_by_me?: boolean;
    watching?: boolean;
    team_members?: boolean;
    is_open?: boolean;
    needs_help?: boolean;
    is_blocking?: boolean;
    is_overdue?: boolean;
    dependency_blocked?: boolean;
    ordering_mode?: 'quick_queue';
    q?: string;
    tag?: string;
  }) {
    return axiosInstance
      .get<TaskItem[] | { results: TaskItem[]; count: number }>('/tasks/', {
        params: {
          ...params,
          mine: params.mine ? '1' : undefined,
          page_size: 200,
        },
      })
      .then((r) => {
        const data = r.data;
        return (Array.isArray(data) ? data : (data as { results: TaskItem[] }).results ?? []) as TaskItem[];
      });
  },

  create(payload: TaskCreatePayload) {
    return axiosInstance.post<TaskItem>('/tasks/', payload).then((r) => r.data);
  },

  update(id: number, payload: Partial<TaskCreatePayload>) {
    return axiosInstance.patch<TaskItem>(`/tasks/${id}/`, payload).then((r) => r.data);
  },

  delete(id: number) {
    return axiosInstance.delete(`/tasks/${id}/`).then((r) => r.data);
  },

  start(id: number) {
    return axiosInstance.post<TaskItem>(`/tasks/${id}/start/`).then((r) => r.data);
  },

  complete(id: number) {
    return axiosInstance.post<TaskItem>(`/tasks/${id}/complete/`).then((r) => r.data);
  },

  cancel(id: number) {
    return axiosInstance.post<TaskItem>(`/tasks/${id}/cancel/`).then((r) => r.data);
  },

  unblock(id: number, reason: string) {
    return axiosInstance.post<TaskItem>(`/tasks/${id}/unblock/`, { reason }).then((r) => r.data);
  },

  requestHelp(id: number, reason: string) {
    return axiosInstance.post<TaskItem>(`/tasks/${id}/request_help/`, { reason }).then((r) => r.data);
  },

  resolveHelp(id: number) {
    return axiosInstance.post<TaskItem>(`/tasks/${id}/resolve_help/`).then((r) => r.data);
  },

  reassign(id: number, assignedTo: number | null, note?: string) {
    return axiosInstance
      .post<TaskItem>(`/tasks/${id}/reassign/`, { assigned_to: assignedTo, note: note ?? '' })
      .then((r) => r.data);
  },

  addNote(id: number, note: string) {
    return axiosInstance.post<TaskItem>(`/tasks/${id}/add_note/`, { note }).then((r) => r.data);
  },

  remindOverdue(id: number) {
    return axiosInstance.post<OverdueReminderResult>(`/tasks/${id}/remind_overdue/`).then((r) => r.data);
  },

  watch(id: number) {
    return axiosInstance.post<{ success: boolean; watching: boolean }>(`/tasks/${id}/watch/`).then((r) => r.data);
  },

  unwatch(id: number) {
    return axiosInstance.post<{ success: boolean; watching: boolean }>(`/tasks/${id}/unwatch/`).then((r) => r.data);
  },

  mySummary() {
    return axiosInstance.get<TaskMySummary>('/tasks/my_summary/').then((r) => r.data);
  },
};
