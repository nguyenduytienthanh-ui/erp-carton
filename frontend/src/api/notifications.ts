import axiosInstance from './axios';

export type NotificationType =
  | 'mention'
  | 'comment'
  | 'approval_request'
  | 'approval_approved'
  | 'approval_rejected'
  | 'assignment'
  | 'due_date'
  | 'system';

export interface NotificationItem {
  id: number;
  recipient: number;
  notification_type: NotificationType | string;
  type_display: string;
  title: string;
  message: string;
  entity_type: string;
  entity_id: number | null;
  actor: number | null;
  actor_username: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationLiveUpdatesResponse {
  has_changes: boolean;
  latest_at: string | null;
  server_time: string;
  changed_count: number;
  unread_count: number;
}

export const notificationsApi = {
  list(params?: {
    unread?: boolean;
    type?: string;
    q?: string;
    page_size?: number;
  }) {
    const toFlag = (v?: boolean) => (v ? '1' : undefined);
    return axiosInstance
      .get<NotificationItem[] | { results: NotificationItem[]; count: number }>('/notifications/', {
        params: {
          ...params,
          unread: toFlag(params?.unread),
          page_size: params?.page_size ?? 100,
        },
      })
      .then((r) => {
        const data = r.data;
        return (Array.isArray(data) ? data : data.results ?? []) as NotificationItem[];
      });
  },

  unread() {
    return axiosInstance.get<NotificationItem[]>('/notifications/unread/').then((r) => r.data);
  },

  unreadCount() {
    return axiosInstance.get<{ count: number }>('/notifications/unread_count/').then((r) => r.data);
  },

  markRead(id: number) {
    return axiosInstance.post<{ success: boolean }>(`/notifications/${id}/mark_read/`).then((r) => r.data);
  },

  markAllRead() {
    return axiosInstance.post<{ success: boolean; count: number }>('/notifications/mark_all_read/').then((r) => r.data);
  },

  markManyRead(ids: number[]) {
    return axiosInstance.post<{ success: boolean; count: number }>('/notifications/mark_many_read/', { ids }).then((r) => r.data);
  },

  liveUpdates(params: { since?: string; unread?: boolean; type?: string; q?: string }) {
    const toFlag = (v?: boolean) => (v ? '1' : undefined);
    return axiosInstance
      .get<NotificationLiveUpdatesResponse>('/notifications/live_updates/', {
        params: {
          ...params,
          unread: toFlag(params.unread),
        },
      })
      .then((r) => r.data);
  },
};
