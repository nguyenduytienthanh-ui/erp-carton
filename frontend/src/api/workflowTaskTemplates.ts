import axiosInstance from './axios';
import type { TaskPriority } from './tasks';

export type WftTrigger = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'POST' | 'VOID' | 'MANUAL';

export const WFT_TRIGGER_LABELS: Record<WftTrigger, string> = {
  SUBMIT: 'Nộp duyệt',
  APPROVE: 'Phê duyệt',
  REJECT: 'Từ chối',
  POST: 'Đăng sổ (Post)',
  VOID: 'Hủy (Void)',
  MANUAL: 'Thủ công',
};

export interface WorkflowTaskTemplateItem {
  id: number;
  entity_type: string;
  trigger: WftTrigger;
  trigger_display: string;
  title_template: string;
  description_template: string;
  assign_rule: Record<string, unknown>;
  due_in_days: number;
  priority: TaskPriority;
  priority_display: string;
  is_blocking: boolean;
  blocks_action: string;
  tags: string[];
  depends_on_previous: boolean;
  sort_order: number;
  is_active: boolean;
  created_by: number | null;
  created_by_info: { id: number; username: string; full_name: string } | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowTaskTemplatePayload {
  entity_type: string;
  trigger: WftTrigger;
  title_template: string;
  description_template?: string;
  assign_rule?: Record<string, unknown>;
  due_in_days?: number;
  priority?: TaskPriority;
  is_blocking?: boolean;
  blocks_action?: string;
  tags?: string[];
  depends_on_previous?: boolean;
  sort_order?: number;
  is_active?: boolean;
}

export interface GeneratePreviewItem {
  template_id: number;
  template_title: string;
  title: string;
  description: string;
  priority: TaskPriority;
  is_blocking: boolean;
  tags: string[];
  due_date: string | null;
  assigned_to: string | null;
  source_key: string;
  depends_on_source_key: string | null;
  would_skip: boolean;
}

export interface WorkflowPipelineCard {
  entity_id: number;
  entity_code: string;
  order_status: string;
  owner: string;
  team: string;
  current_step: string;
  current_task_status: string | null;
  current_task_id: number | null;
  current_task_due_date: string | null;
  sla_state: 'OVERDUE' | 'DUE_TODAY' | 'ON_TRACK';
  updated_at: string | null;
}

export interface WorkflowPipelineColumn {
  id: string;
  template_id: number | null;
  title: string;
  cards: WorkflowPipelineCard[];
}

export interface WorkflowPipelineBoardResponse {
  entity_type: string;
  trigger: string;
  columns: WorkflowPipelineColumn[];
  meta: {
    total_cards: number;
    template_count?: number;
    message?: string;
    diagnostic_code?: 'NO_TEMPLATE' | 'NO_ENTITY_RECORD' | string;
    hints?: string[];
  };
}

export interface WorkflowPipelineTimelineItem {
  id: number;
  action: 'ADVANCE' | 'MOVE' | 'FAIL' | 'GENERATE' | string;
  from_step: string;
  to_step: string;
  note: string;
  actor: string;
  created_at: string | null;
}

export const workflowTaskTemplatesApi = {
  list(params?: {
    entity_type?: string;
    trigger?: string;
    is_active?: boolean;
  }) {
    return axiosInstance
      .get<WorkflowTaskTemplateItem[] | { results: WorkflowTaskTemplateItem[]; count: number }>(
        '/workflow-task-templates/',
        { params }
      )
      .then((r) => {
        const data = r.data;
        return (
          Array.isArray(data)
            ? data
            : (data as { results: WorkflowTaskTemplateItem[] }).results ?? []
        ) as WorkflowTaskTemplateItem[];
      });
  },

  get(id: number) {
    return axiosInstance
      .get<WorkflowTaskTemplateItem>(`/workflow-task-templates/${id}/`)
      .then((r) => r.data);
  },

  create(payload: WorkflowTaskTemplatePayload) {
    return axiosInstance
      .post<WorkflowTaskTemplateItem>('/workflow-task-templates/', payload)
      .then((r) => r.data);
  },

  update(id: number, payload: Partial<WorkflowTaskTemplatePayload>) {
    return axiosInstance
      .patch<WorkflowTaskTemplateItem>(`/workflow-task-templates/${id}/`, payload)
      .then((r) => r.data);
  },

  delete(id: number) {
    return axiosInstance.delete(`/workflow-task-templates/${id}/`).then((r) => r.data);
  },

  previewGenerate(params: {
    entity_type: string;
    entity_id: number;
    entity_code: string;
    trigger: WftTrigger | string;
  }) {
    return axiosInstance
      .post<{ preview: GeneratePreviewItem[]; total: number }>(
        '/workflow-task-templates/preview_generate/',
        params
      )
      .then((r) => r.data);
  },

  generateForEntity(params: {
    entity_type: string;
    entity_id: number;
    entity_code: string;
    trigger: WftTrigger | string;
  }) {
    return axiosInstance
      .post<{ created_count: number; created: { id: number; title: string; source_key: string }[] }>(
        '/workflow-task-templates/generate_for_entity/',
        params
      )
      .then((r) => r.data);
  },

  getPipelineBoard(params?: {
    entity_type?: string;
    trigger?: WftTrigger | string;
    limit?: number;
  }) {
    return axiosInstance
      .get<WorkflowPipelineBoardResponse>('/workflow-task-templates/pipeline_board/', { params })
      .then((r) => r.data);
  },

  advancePipeline(params: {
    entity_type: string;
    entity_id: number;
    entity_code?: string;
    trigger: WftTrigger | string;
    note?: string;
  }) {
    return axiosInstance
      .post<{ success: boolean; message: string; completed_task_id?: number; next_task_id?: number }>(
        '/workflow-task-templates/advance_pipeline/',
        params
      )
      .then((r) => r.data);
  },

  movePipelineCard(params: {
    entity_type: string;
    entity_id: number;
    entity_code?: string;
    trigger: WftTrigger | string;
    target_column_id: string;
    note?: string;
  }) {
    return axiosInstance
      .post<{ success: boolean; message: string }>(
        '/workflow-task-templates/move_pipeline_card/',
        params
      )
      .then((r) => r.data);
  },

  getPipelineTimeline(params: {
    entity_type: string;
    entity_id: number;
    limit?: number;
  }) {
    return axiosInstance
      .get<{ items: WorkflowPipelineTimelineItem[]; total: number }>(
        '/workflow-task-templates/pipeline_timeline/',
        { params }
      )
      .then((r) => r.data);
  },

  retryPipelineFailed(params: {
    entity_type: string;
    entity_id: number;
    entity_code?: string;
    trigger: WftTrigger | string;
    note?: string;
  }) {
    return axiosInstance
      .post<{ success: boolean; message: string; task_id?: number }>(
        '/workflow-task-templates/retry_pipeline_failed/',
        params
      )
      .then((r) => r.data);
  },
};
