import axiosInstance from './axios';

export type OperationSource = 'ALL' | 'TASK_BULK' | 'PIPELINE_EVENT' | 'INSIGHT_ACTION' | 'TASK_AUDIT' | 'AUTOMATION_RUN';
export type OperationSuccessFilter = 'ALL' | 'SUCCESS' | 'FAILED';

export interface OperationLogItem {
  id: string;
  source: Exclude<OperationSource, 'ALL'> | string;
  action: string;
  actor: string | null;
  success: boolean | null;
  message: string;
  entity_type: string;
  entity_id: number;
  entity_code: string;
  created_at: string;
  meta?: Record<string, unknown>;
}

export interface OperationLiveUpdatesResponse {
  has_changes: boolean;
  latest_at: string | null;
  server_time: string;
  changed_count: number;
}

export interface OperationsLogMetaResponse {
  actions: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
  recent_failed_count_24h: number;
}

export const operationsApi = {
  list(params?: {
    actor_query?: string;
    action?: string;
    source?: OperationSource;
    success?: OperationSuccessFilter;
    q?: string;
    limit?: number;
    include_all?: boolean;
  }) {
    const toFlag = (v?: boolean) => (v ? '1' : undefined);
    return axiosInstance
      .get<{ items: OperationLogItem[]; total: number }>('/activity/operations_log/', {
        params: {
          ...params,
          include_all: toFlag(params?.include_all),
        },
      })
      .then((r) => r.data);
  },

  liveUpdates(params: {
    since?: string;
    actor_query?: string;
    action?: string;
    source?: OperationSource;
    success?: OperationSuccessFilter;
    q?: string;
    include_all?: boolean;
  }) {
    const toFlag = (v?: boolean) => (v ? '1' : undefined);
    return axiosInstance
      .get<OperationLiveUpdatesResponse>('/activity/operations_live_updates/', {
        params: {
          ...params,
          include_all: toFlag(params.include_all),
        },
      })
      .then((r) => r.data);
  },

  meta() {
    return axiosInstance
      .get<OperationsLogMetaResponse>('/activity/operations_log_meta/')
      .then((r) => r.data);
  },
};
