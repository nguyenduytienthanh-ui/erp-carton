import axiosInstance from './axios';
import type { TaskPriority } from './tasks';

export type WftTrigger = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'POST' | 'VOID' | 'RELEASE' | 'ISSUE' | 'RECEIVE' | 'CANCEL' | 'MANUAL';

export const WFT_TRIGGER_LABELS: Record<WftTrigger, string> = {
  SUBMIT: 'Nộp duyệt',
  APPROVE: 'Phê duyệt',
  REJECT: 'Từ chối',
  POST: 'Đăng sổ (Post)',
  VOID: 'Hủy (Void)',
  RELEASE: 'Phát lệnh',
  ISSUE: 'Cấp vật tư',
  RECEIVE: 'Ghi nhận nhập/nhận',
  CANCEL: 'Hủy chứng từ',
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
  current_task_priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | null;
  current_task_is_blocking: boolean;
  current_task_is_pinned: boolean;
  current_task_due_date: string | null;
  sla_state: 'OVERDUE' | 'DUE_TODAY' | 'AT_RISK' | 'ON_TRACK';
  updated_at: string | null;
}

export interface WorkflowPipelineColumn {
  id: string;
  template_id: number | null;
  title: string;
  wip_limit?: number | null;
  is_over_wip?: boolean;
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

export interface WorkflowPipelineStepMetric {
  template_id: number;
  title: string;
  sort_order: number;
  target_cycle_time_hours: number | null;
  total_tasks: number;
  done_tasks: number;
  in_progress_tasks: number;
  todo_tasks: number;
  failed_tasks: number;
  overdue_open_tasks: number;
  breached_count: number;
  avg_cycle_time_hours: number;
  p95_cycle_time_hours: number;
  breach_rate_percent: number;
}

export interface WorkflowPipelineAnalyticsResponse {
  entity_type: string;
  trigger: string;
  window_days: number;
  summary: {
    entities_total: number;
    entities_completed: number;
    completion_rate: number;
    avg_lead_time_hours: number;
    avg_open_age_hours: number;
    total_tasks: number;
    open_tasks: number;
    overdue_open_tasks: number;
    failed_tasks: number;
  };
  step_metrics: WorkflowPipelineStepMetric[];
  bottlenecks: WorkflowPipelineStepMetric[];
  insights: Array<{
    severity: 'HIGH' | 'MEDIUM' | 'LOW' | string;
    type: string;
    step_title: string;
    message: string;
    suggested_action?: string;
  }>;
  action_counts: Record<string, number>;
  meta?: {
    message?: string;
  };
  generated_at: string;
}

export interface WorkflowPipelineAutomationResult {
  success: boolean;
  entity_type: string;
  trigger: string;
  auto_started_count: number;
  overdue_reminded_count: number;
  notifications_sent: number;
  message: string;
}

export interface WorkflowPlaybookSuggestionItem {
  entity_type: string;
  trigger: WftTrigger | string;
  title_template: string;
  description_template: string;
  assign_rule: Record<string, unknown>;
  due_in_days: number;
  priority: TaskPriority;
  is_blocking: boolean;
  blocks_action: string;
  tags: string[];
  depends_on_previous: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface WorkflowPlaybookSuggestionResponse {
  entity_type: string;
  scenario: string;
  name?: string;
  description?: string;
  available_scenarios: string[];
  items: WorkflowPlaybookSuggestionItem[];
  meta?: { message?: string };
}

export interface WorkflowPlaybookApplyResult {
  success: boolean;
  entity_type: string;
  scenario: string;
  name?: string;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  template_ids: number[];
}

export interface WorkflowPipelineBulkActionResult {
  success: boolean;
  action: 'ADVANCE' | 'FAIL' | 'RETRY_FAILED' | string;
  total: number;
  success_count: number;
  failed_count: number;
  results: Array<{
    entity_id: number;
    entity_code?: string;
    success: boolean;
    message?: string;
    error?: string;
  }>;
}

export interface WorkflowInsightExecutionResult {
  success: boolean;
  entity_type: string;
  trigger: string;
  message: string;
  auto_started_count?: number;
  overdue_reminded_count?: number;
  notifications_sent?: number;
  manual_action?: boolean;
}

export interface WorkflowInsightBatchExecutionResult {
  success: boolean;
  entity_type: string;
  trigger: string;
  total: number;
  success_count: number;
  failed_count: number;
  results: Array<{
    index: number;
    insight_type: string;
    suggested_action: string;
    success: boolean;
    message?: string;
    error?: string;
    manual_action?: boolean;
    auto_started_count?: number;
    overdue_reminded_count?: number;
    notifications_sent?: number;
  }>;
}

export interface WorkflowInsightExecutionHistoryItem {
  id: number;
  actor: string;
  actor_username: string;
  insight_type: string;
  suggested_action: string;
  message: string;
  success: boolean;
  manual_action: boolean;
  created_at: string | null;
}

export interface WorkflowPipelineLiveUpdatesResponse {
  has_changes: boolean;
  latest_at: string | null;
  server_time: string;
  event_changed_count: number;
  template_changed_count: number;
  entity_type: string;
  trigger: string;
}

export interface WorkflowAutomationProfileConfig {
  name: string;
  remind_overdue: boolean;
  auto_start_ready: boolean;
  reminder_cooldown_hours: number;
}

export interface WorkflowAutomationProfilesResponse {
  entity_type: string;
  trigger: string;
  profiles: Record<'MORNING' | 'MIDDAY' | 'EOD' | 'CUSTOM', WorkflowAutomationProfileConfig>;
}

export interface WorkflowAutomationRunProfileResponse {
  success: boolean;
  profile_key: 'MORNING' | 'MIDDAY' | 'EOD' | 'CUSTOM' | string;
  profile: WorkflowAutomationProfileConfig;
  result: WorkflowPipelineAutomationResult;
}

export interface WorkflowAutomationRunHistoryItem {
  id: number;
  actor: string;
  profile_key: string;
  run_mode?: 'MANUAL_PROFILE' | 'SCHEDULE' | string;
  auto_started_count: number;
  overdue_reminded_count: number;
  notifications_sent: number;
  message: string;
  created_at: string | null;
}

export interface WorkflowAutomationScheduleSlot {
  profile_key: 'MORNING' | 'MIDDAY' | 'EOD' | 'CUSTOM';
  time: string; // HH:mm
  active: boolean;
}

export interface WorkflowAutomationScheduleConfig {
  entity_type: string;
  trigger: string;
  enabled: boolean;
  slots: WorkflowAutomationScheduleSlot[];
}

export interface WorkflowSchedulerJobStatus {
  enabled: boolean;
  name: string;
  interval_minutes: number;
  next_run: string | null;
  schedule_id: number | null;
  lock_active?: boolean;
}

export interface WorkflowSchedulerHealth {
  hours_window: number;
  status_counts: {
    SUCCESS: number;
    FAILED: number;
    SKIPPED_LOCKED: number;
  };
  last_status: string;
  last_run_at: string | null;
  consecutive_failures: number;
  failure_threshold?: number;
  auto_disabled?: boolean;
  scheduler_enabled?: boolean | null;
  avg_success_duration_ms: number;
  recent_errors: Array<{ created_at: string | null; message: string }>;
  lock_active: boolean;
  recommended_actions?: string[];
}

export interface WorkflowSchedulerPolicy {
  failure_threshold: number;
  presets?: Record<'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE', { failure_threshold: number }>;
}

export interface WorkflowSchedulerIncidentItem {
  id: number;
  status: string;
  event_type?: string;
  actor: string;
  message: string;
  run_mode: string;
  duration_ms: number;
  policy_diff?: {
    old_failure_threshold?: number | null;
    new_failure_threshold?: number | null;
  };
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

  getPipelineLiveUpdates(params: {
    entity_type: string;
    trigger: WftTrigger | string;
    since?: string;
  }) {
    return axiosInstance
      .get<WorkflowPipelineLiveUpdatesResponse>('/workflow-task-templates/pipeline_live_updates/', { params })
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

  getPipelineAnalytics(params?: {
    entity_type?: string;
    trigger?: WftTrigger | string;
    days?: number;
  }) {
    return axiosInstance
      .get<WorkflowPipelineAnalyticsResponse>('/workflow-task-templates/pipeline_analytics/', { params })
      .then((r) => r.data);
  },

  runPipelineAutomation(params: {
    entity_type: string;
    trigger: WftTrigger | string;
    remind_overdue?: boolean;
    auto_start_ready?: boolean;
    reminder_cooldown_hours?: number;
  }) {
    return axiosInstance
      .post<WorkflowPipelineAutomationResult>('/workflow-task-templates/run_automation/', params)
      .then((r) => r.data);
  },

  getAutomationProfiles(params: {
    entity_type: string;
    trigger: WftTrigger | string;
  }) {
    return axiosInstance
      .get<WorkflowAutomationProfilesResponse>('/workflow-task-templates/automation_profiles/', { params })
      .then((r) => r.data);
  },

  saveAutomationProfiles(params: {
    entity_type: string;
    trigger: WftTrigger | string;
    profiles: Record<'MORNING' | 'MIDDAY' | 'EOD' | 'CUSTOM', WorkflowAutomationProfileConfig>;
  }) {
    return axiosInstance
      .post<WorkflowAutomationProfilesResponse & { success: boolean }>('/workflow-task-templates/automation_profiles/', params)
      .then((r) => r.data);
  },

  runAutomationProfile(params: {
    entity_type: string;
    trigger: WftTrigger | string;
    profile_key: 'MORNING' | 'MIDDAY' | 'EOD' | 'CUSTOM';
  }) {
    return axiosInstance
      .post<WorkflowAutomationRunProfileResponse>('/workflow-task-templates/run_automation_profile/', params)
      .then((r) => r.data);
  },

  getAutomationRunHistory(params: {
    entity_type: string;
    trigger: WftTrigger | string;
    limit?: number;
    run_mode?: 'ALL' | 'MANUAL_PROFILE' | 'SCHEDULE';
  }) {
    return axiosInstance
      .get<{ items: WorkflowAutomationRunHistoryItem[]; total: number }>(
        '/workflow-task-templates/automation_run_history/',
        { params }
      )
      .then((r) => r.data);
  },

  getAutomationSchedule(params: {
    entity_type: string;
    trigger: WftTrigger | string;
  }) {
    return axiosInstance
      .get<WorkflowAutomationScheduleConfig>('/workflow-task-templates/automation_schedule/', { params })
      .then((r) => r.data);
  },

  saveAutomationSchedule(params: {
    entity_type: string;
    trigger: WftTrigger | string;
    enabled: boolean;
    slots: WorkflowAutomationScheduleSlot[];
  }) {
    return axiosInstance
      .post<WorkflowAutomationScheduleConfig & { success: boolean }>(
        '/workflow-task-templates/automation_schedule/',
        params
      )
      .then((r) => r.data);
  },

  runDueAutomationSchedule(params?: {
    dry_run?: boolean;
    entity_type?: string;
    trigger?: WftTrigger | string;
  }) {
    return axiosInstance
      .post<{
        success: boolean;
        user_id: number;
        username: string;
        now: string;
        executed_count: number;
        executed: Array<{
          combo_key: string;
          entity_type: string;
          trigger: string;
          profile_key: string;
          time: string;
          result: WorkflowPipelineAutomationResult;
        }>;
      }>('/workflow-task-templates/run_due_automation_schedule/', params ?? {})
      .then((r) => r.data);
  },

  getSchedulerJobStatus() {
    return axiosInstance
      .get<WorkflowSchedulerJobStatus>('/workflow-task-templates/scheduler_job_status/')
      .then((r) => r.data);
  },

  saveSchedulerJobStatus(params: {
    enabled: boolean;
    interval_minutes: number;
  }) {
    return axiosInstance
      .post<WorkflowSchedulerJobStatus & { success: boolean }>(
        '/workflow-task-templates/scheduler_job_status/',
        params
      )
      .then((r) => r.data);
  },

  getSchedulerHealth(params?: { hours?: number }) {
    return axiosInstance
      .get<WorkflowSchedulerHealth>('/workflow-task-templates/scheduler_health/', { params })
      .then((r) => r.data);
  },

  getSchedulerPolicy() {
    return axiosInstance
      .get<WorkflowSchedulerPolicy>('/workflow-task-templates/scheduler_policy/')
      .then((r) => r.data);
  },

  saveSchedulerPolicy(params: {
    failure_threshold: number;
  }) {
    return axiosInstance
      .post<WorkflowSchedulerPolicy & { success: boolean }>(
        '/workflow-task-templates/scheduler_policy/',
        params
      )
      .then((r) => r.data);
  },

  applySchedulerPolicyPreset(params: {
    preset_key: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  }) {
    return axiosInstance
      .post<{ success: boolean; preset_key: string; failure_threshold: number }>(
        '/workflow-task-templates/scheduler_apply_policy_preset/',
        params
      )
      .then((r) => r.data);
  },

  notifySchedulerAdmins(params: {
    message: string;
  }) {
    return axiosInstance
      .post<{ success: boolean; notified_admin_count: number }>(
        '/workflow-task-templates/scheduler_notify_admins/',
        params
      )
      .then((r) => r.data);
  },

  getSchedulerIncidents(params?: {
    status?: 'ALL' | 'SUCCESS' | 'FAILED' | 'SKIPPED_LOCKED';
    limit?: number;
  }) {
    return axiosInstance
      .get<{ items: WorkflowSchedulerIncidentItem[]; total: number }>(
        '/workflow-task-templates/scheduler_incidents/',
        { params }
      )
      .then((r) => r.data);
  },

  simulateSchedulerFailure(params?: {
    reason?: string;
  }) {
    return axiosInstance
      .post<{
        success: boolean;
        simulated: boolean;
        reason: string;
        auto_recovery?: {
          evaluated?: boolean;
          disabled?: boolean;
          consecutive_failures?: number;
        };
      }>('/workflow-task-templates/scheduler_simulate_failure/', params ?? {})
      .then((r) => r.data);
  },

  recoverScheduler(params?: {
    interval_minutes?: number;
    clear_lock?: boolean;
  }) {
    return axiosInstance
      .post<{
        success: boolean;
        enabled: boolean;
        interval_minutes: number;
        next_run: string | null;
        lock_active: boolean;
      }>('/workflow-task-templates/scheduler_recover/', params ?? {})
      .then((r) => r.data);
  },

  getPlaybookSuggestions(params: {
    entity_type: string;
    scenario?: string;
  }) {
    return axiosInstance
      .get<WorkflowPlaybookSuggestionResponse>('/workflow-task-templates/playbook_suggestions/', { params })
      .then((r) => r.data);
  },

  applyPlaybook(params: {
    entity_type: string;
    scenario?: string;
    overwrite_existing?: boolean;
  }) {
    return axiosInstance
      .post<WorkflowPlaybookApplyResult>('/workflow-task-templates/apply_playbook/', params)
      .then((r) => r.data);
  },

  bulkPipelineAction(params: {
    entity_type: string;
    trigger: WftTrigger | string;
    action: 'ADVANCE' | 'FAIL' | 'RETRY_FAILED';
    note?: string;
    items: Array<{ entity_id: number; entity_code?: string }>;
  }) {
    return axiosInstance
      .post<WorkflowPipelineBulkActionResult>('/workflow-task-templates/bulk_pipeline_action/', params)
      .then((r) => r.data);
  },

  executeInsightAction(params: {
    entity_type: string;
    trigger: WftTrigger | string;
    insight_type: string;
    suggested_action: string;
  }) {
    return axiosInstance
      .post<WorkflowInsightExecutionResult>('/workflow-task-templates/execute_insight_action/', params)
      .then((r) => r.data);
  },

  executeInsightBatch(params: {
    entity_type: string;
    trigger: WftTrigger | string;
    stop_on_error?: boolean;
    items: Array<{ insight_type: string; suggested_action: string }>;
  }) {
    return axiosInstance
      .post<WorkflowInsightBatchExecutionResult>('/workflow-task-templates/execute_insight_batch/', params)
      .then((r) => r.data);
  },

  getInsightExecutionHistory(params: {
    entity_type: string;
    trigger: WftTrigger | string;
    limit?: number;
    actor_query?: string;
    suggested_action?: string;
    success?: boolean;
  }) {
    return axiosInstance
      .get<{ items: WorkflowInsightExecutionHistoryItem[]; total: number }>(
        '/workflow-task-templates/insight_execution_history/',
        { params }
      )
      .then((r) => r.data);
  },
};
