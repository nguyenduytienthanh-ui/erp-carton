import type {
  WorkflowSchedulerHealth,
  WorkflowSchedulerIncidentItem,
  WorkflowSchedulerJobStatus,
} from '../api/workflowTaskTemplates';
import type {
  AdvanceApprovalQueueResponse,
  AdvanceApprovalSlaOverviewResponse,
} from './finance';
import type {
  SalaryAdvanceApprovalQueueResponse,
  SalaryAdvanceApprovalSlaOverviewResponse,
} from './workforce';

export interface RoleModulePermissionItem {
  role_id: number;
  role_code: string;
  role_name: string;
  is_active: boolean;
  workforce_manage: boolean;
  finance_manage: boolean;
  purchasing_manage: boolean;
  purchasing_view: boolean;
  inventory_view: boolean;
  inventory_manage: boolean;
  inventory_adjust: boolean;
  inventory_stocktake: boolean;
  inventory_transfer: boolean;
  inventory_reserve: boolean;
  production_manage: boolean;
  ops_view: boolean;
  reports_view: boolean;
  customer_view: boolean;
  customer_create: boolean;
  customer_edit: boolean;
  customer_submit: boolean;
  customer_approve: boolean;
  customer_reject: boolean;
  customer_import: boolean;
  customer_export: boolean;
  customer_assign: boolean;
  customer_delete: boolean;
  workflow_view: boolean;
  workflow_manage: boolean;
  operations_log_view: boolean;
  rbac_audit_view: boolean;
  rbac_manage: boolean;
}

export interface SystemHealthCheck {
  status: string;
  message?: string;
  [key: string]: unknown;
}

export interface SystemHealthResponse {
  status: string;
  app_env: string;
  server_time: string;
  checks: Record<string, SystemHealthCheck>;
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
    purchasing_view: boolean;
    inventory_view: boolean;
    inventory_manage: boolean;
    inventory_adjust: boolean;
    inventory_stocktake: boolean;
    inventory_transfer: boolean;
    inventory_reserve: boolean;
    production_manage: boolean;
    ops_view: boolean;
    reports_view: boolean;
    customer_view: boolean;
    customer_create: boolean;
    customer_edit: boolean;
    customer_submit: boolean;
    customer_approve: boolean;
    customer_reject: boolean;
    customer_import: boolean;
    customer_export: boolean;
    customer_assign: boolean;
    customer_delete: boolean;
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

export interface AdminObservabilityCapabilities {
  can_view_operations_log: boolean;
  can_view_workflow: boolean;
  can_manage_workflow: boolean;
  can_simulate_scheduler_failure: boolean;
  can_manage_user_directory: boolean;
  can_view_rbac_audit: boolean;
  can_manage_module_permissions: boolean;
}

export interface AdminObservabilityFinanceOverdueSnapshot {
  as_of: string;
  threshold_days: number;
  count: number;
  total_remaining: string;
  max_days_overdue: number;
}

export interface AdminObservabilityPurchasingOrderSummary {
  total_orders: number;
  draft_count: number;
  submitted_count: number;
  approved_count: number;
  partial_received_count: number;
  received_count: number;
  cancelled_count: number;
  pending_approval_count: number;
  waiting_receipt_count: number;
  overdue_receipt_count: number;
  open_value: string;
}

export interface AdminObservabilityPurchasingRequestSummary {
  total_requests: number;
  draft_count: number;
  submitted_count: number;
  approved_count: number;
  rejected_count: number;
}

export interface AdminObservabilityRecentPurchaseOrder {
  id: number;
  code: string;
  status: string;
  supplier_name: string;
  expected_receipt_date: string | null;
  total: string;
  owner_name: string;
}

export interface AdminObservabilityRecentPurchaseRequest {
  id: number;
  code: string;
  status: string;
  request_date: string | null;
  requester_name: string;
  line_count: number;
}

export interface AdminObservabilityProductionOrderSummary {
  total_orders: number;
  draft_count: number;
  submitted_count: number;
  approved_count: number;
  released_count: number;
  in_progress_count: number;
  completed_count: number;
  cancelled_count: number;
  pending_approval_count: number;
  active_count: number;
  overdue_plan_count: number;
  active_remaining_qty: string;
  ready_operation_count: number;
}

export interface AdminObservabilityRecentProductionOrder {
  id: number;
  code: string;
  status: string;
  product_name: string;
  planned_end_date: string | null;
  planned_qty: string;
  produced_qty: string;
  owner_name: string;
}

export interface AdminObservabilityBusinessFlows {
  finance: {
    queue: AdvanceApprovalQueueResponse;
    sla: AdvanceApprovalSlaOverviewResponse;
    overdue_snapshot_90d: AdminObservabilityFinanceOverdueSnapshot;
  } | null;
  workforce: {
    queue: SalaryAdvanceApprovalQueueResponse;
    sla: SalaryAdvanceApprovalSlaOverviewResponse;
  } | null;
  purchasing: {
    order_summary: AdminObservabilityPurchasingOrderSummary;
    request_summary: AdminObservabilityPurchasingRequestSummary;
    recent_orders: AdminObservabilityRecentPurchaseOrder[];
    recent_requests: AdminObservabilityRecentPurchaseRequest[];
  } | null;
  production: {
    order_summary: AdminObservabilityProductionOrderSummary;
    recent_orders: AdminObservabilityRecentProductionOrder[];
  } | null;
}

export interface AdminObservabilityApprovalAuditDomain {
  domain: 'finance' | 'workforce' | 'purchasing' | 'production';
  label: string;
  pending_now: number;
  submitted_7d: number;
  approved_7d: number;
  rejected_7d: number;
  last_event_at: string | null;
  route: string;
}

export interface AdminObservabilityApprovalAuditHotItem {
  id: string;
  domain: 'finance' | 'workforce' | 'purchasing' | 'production';
  entity_id: number | null;
  entity_code: string;
  title: string;
  amount_label: string;
  status_label: string;
  aging_hint: string;
  age_days: number;
  priority_score: number;
  route: string;
  status_action: string;
}

export interface AdminObservabilityApprovalQueueRow {
  id: string;
  domain: 'finance' | 'workforce' | 'purchasing' | 'production';
  entity_id: number | null;
  entity_code: string;
  title: string;
  amount_label: string;
  status_label: string;
  aging_hint: string;
  age_days: number;
  priority_score: number;
  priority_band: 'critical' | 'high' | 'normal';
  is_multilevel: boolean;
  route: string;
  status_action: string;
}

export interface AdminObservabilityApprovalQueueSummary {
  total_pending: number;
  critical_queue_count: number;
  stale_queue_count: number;
  multi_level_queue_count: number;
  domain_pending_counts: {
    finance: number;
    workforce: number;
    purchasing: number;
    production: number;
  };
  priority_band_counts: {
    critical: number;
    high: number;
    normal: number;
  };
}

export interface AdminObservabilityApprovalAuditTimelinePoint {
  date: string;
  submitted: number;
  approved: number;
  rejected: number;
}

export interface AdminObservabilityApprovalAuditItem {
  id: string;
  domain: 'finance' | 'workforce' | 'purchasing' | 'production';
  action: string;
  action_label: string;
  entity_id?: number | null;
  entity_code: string;
  summary: string;
  comments: string;
  actor_label: string;
  created_at: string | null;
  route: string;
}

export interface AdminAuditSpotlightDomain {
  domain: 'finance' | 'workforce' | 'purchasing' | 'production' | 'governance' | 'workflow';
  label: string;
  events_24h: number;
  sensitive_events_24h: number;
  high_severity_events_24h: number;
  actors_24h: number;
  last_event_at: string | null;
  route: string;
}

export interface AdminAuditSpotlightActor {
  actor_id: number | null;
  username: string;
  full_name: string;
  event_count: number;
  sensitive_event_count: number;
  high_severity_event_count: number;
  domains: string[];
  last_event_at: string | null;
}

export interface AdminAuditHotEntity {
  key: string;
  domain: 'finance' | 'workforce' | 'purchasing' | 'production' | 'governance' | 'workflow';
  entity_type: string;
  entity_id: number | null;
  entity_id_str: string;
  entity_code: string;
  summary: string;
  route: string;
  event_count: number;
  sensitive_event_count: number;
  high_severity_event_count: number;
  last_event_at: string | null;
  last_actor_label: string;
  latest_action_label: string;
}

export interface AdminAuditTimelinePoint {
  date: string;
  total_events: number;
  sensitive_events: number;
  high_severity_events: number;
}

export interface AdminAuditSpotlightItem {
  id: string;
  domain: 'finance' | 'workforce' | 'purchasing' | 'production' | 'governance' | 'workflow';
  severity: 'error' | 'warning' | 'info' | 'success';
  action: string;
  action_label: string;
  entity_type: string;
  entity_id: number | null;
  entity_id_str: string;
  entity_code: string;
  summary: string;
  comments: string;
  actor_label: string;
  actor_username: string;
  created_at: string | null;
  route: string;
  changed_fields: string[];
}

export interface AdminObservabilityStatusCounts {
  SUCCESS: number;
  FAILED: number;
  SKIPPED: number;
}

export interface ReleaseHygienePayload {
  repo_root: string;
  branch: string;
  commit_sha: string;
  latest_tag: string;
  git_available: boolean;
  counts: {
    modified: number;
    added: number;
    deleted: number;
    renamed: number;
    conflicts: number;
    untracked: number;
  };
  total_changes: number;
  open_changes: Array<{
    code: string;
    path: string;
  }>;
  migration_candidates: string[];
  artifact_candidates: string[];
  recommended_commands: string[];
  warnings: string[];
  status: string;
}

export interface PerformanceReadinessPayload {
  warning_rows: number;
  critical_rows: number;
  slow_query_threshold_ms: number;
  datasets: Array<{
    key: string;
    label: string;
    count: number;
    route: string;
    risk_band: string;
    status: string;
    recommendation: string;
  }>;
  summary: {
    tracked_dataset_count: number;
    warning_count: number;
    critical_count: number;
  };
  recommended_commands: string[];
  warnings: string[];
  status: string;
}

export interface AdminObservabilityMonitoringPayload {
  backup: {
    status: string;
    message: string;
    backup_count: number;
    latest_backup: {
      path: string;
      name: string;
      age_hours: number;
      has_database_dump: boolean;
      has_media: boolean;
      has_manifest: boolean;
      has_backup_manifest: boolean;
      restore_drill_status: string;
    } | null;
    restore_drill_status: string;
  };
  email_delivery: {
    hours_window: number;
    status_counts: AdminObservabilityStatusCounts;
    failure_rate_pct: number;
    latest_failure: {
      created_at: string | null;
      message: string;
      recipient_email: string;
    } | null;
    status: string;
  };
  alert_channels: {
    app_env?: string;
    channels: Array<{
      key: string;
      label: string;
      configured: boolean;
      summary?: string;
    }>;
    configured_count: number;
    required_channel_count?: number;
    required_channels?: string[];
    missing_required_channels?: string[];
    default_from_email_configured?: boolean;
    server_email_configured?: boolean;
    incident_runbook_configured?: boolean;
    incident_contact_count?: number;
    recommended_command?: string;
    warning_count: number;
    warnings: string[];
    status: string;
  };
  alert_readiness?: {
    generated_at: string;
    config: AdminObservabilityMonitoringPayload['alert_channels'];
    delivery: {
      status: string;
      warnings: string[];
      status_counts: AdminObservabilityStatusCounts;
    };
    email_delivery: {
      status: string;
      status_counts: AdminObservabilityStatusCounts;
      failure_rate_pct: number;
    };
    incident_response: {
      runbook_url: string;
      contacts: string[];
    };
    recommended_commands: string[];
    warnings: string[];
    overall_status: string;
  };
  alert_delivery: {
    hours_window: number;
    configured_count: number;
    configured_channels: string[];
    status_counts: AdminObservabilityStatusCounts;
    warning_count: number;
    warnings: string[];
    status: string;
  };
  alert_drill: {
    recommended_command: string;
  };
  database: {
    slow_query_threshold_ms: number;
  };
  performance: PerformanceReadinessPayload;
  release_hygiene: ReleaseHygienePayload;
  go_live_handoff: {
    recommended_command: string;
  };
  incident_response: {
    runbook_url: string;
    contacts: string[];
  };
}

export interface ReleaseCleanupPreviewResponse {
  generated_at: string;
  mode: string;
  artifact_count: number;
  existing_count: number;
  removed_count: number;
  missing_count: number;
  blocked_count: number;
  remaining_count: number;
  items: Array<{
    path: string;
    category: string;
    exists: boolean;
    removed: boolean;
    status: string;
  }>;
  recommended_commands: string[];
  warnings: string[];
  status: string;
}

export interface AdminPerformanceDrilldownResponse {
  generated_at: string;
  include_all: boolean;
  sample_size: number;
  slow_query_threshold_ms: number;
  surface_count: number;
  slow_surface_count: number;
  surfaces: Array<{
    key: string;
    label: string;
    route: string;
    count: number;
    sample_size: number;
    sample_ids: number[];
    count_query_ms: number;
    sample_query_ms: number;
    explain_excerpt: string;
    slow_signals: string[];
    status: string;
  }>;
  recommended_commands: string[];
  warnings: string[];
  status: string;
}

export interface AccessGovernanceSurfaceAuditResponse {
  generated_at: string;
  expected_count: number;
  available_count: number;
  missing_count: number;
  missing_usernames: string[];
  persona_summary: Array<{
    username: string;
    role_names: string[];
    allowed_route_count: number;
    allowed_api_surface_count: number;
    allowed_critical_action_count: number;
  }>;
  coverage: {
    frontend_routes: Array<{
      key: string;
      label: string;
      route: string;
      capability: string;
      persona_usernames: string[];
      coverage_count: number;
      status: string;
    }>;
    api_surfaces: Array<{
      key: string;
      label: string;
      route: string;
      capability: string;
      persona_usernames: string[];
      coverage_count: number;
      status: string;
    }>;
    critical_actions: Array<{
      key: string;
      label: string;
      route: string;
      capability: string;
      persona_usernames: string[];
      coverage_count: number;
      status: string;
    }>;
  };
  summary: {
    low_coverage_threshold: number;
    frontend_routes_total: number;
    api_surfaces_total: number;
    critical_actions_total: number;
    uncovered_routes: number;
    uncovered_api_surfaces: number;
    uncovered_critical_actions: number;
    low_coverage_routes: number;
    low_coverage_api_surfaces: number;
    low_coverage_critical_actions: number;
  };
  recommended_commands: string[];
  warnings: string[];
  overall_status: string;
}

export interface AdminAuditRetentionRunPayload {
  id: number;
  created_at: string | null;
  action: string;
  entity_type: string;
  entity_code: string;
  user_id: number | null;
  user_label: string | null;
  payload: Record<string, unknown>;
}

export interface AdminAuditWorkspaceResponse {
  hours_window: number;
  total_events: number;
  sensitive_events: number;
  high_severity_events: number;
  domains: AdminAuditSpotlightDomain[];
  top_actors: AdminAuditSpotlightActor[];
  hot_entities: AdminAuditHotEntity[];
  timeline_7d: AdminAuditTimelinePoint[];
  recent_activity: AdminAuditSpotlightItem[];
  retention_policy: {
    retention_days: number;
    total_events: number;
    expired_events: number;
    oldest_event_at: string | null;
    purge_recommended: boolean;
    last_run: AdminAuditRetentionRunPayload | null;
    recommended_command: string;
  };
  export_options: {
    formats: string[];
    max_rows: number;
  };
  incident_response: {
    runbook_url: string;
    contacts: string[];
    bundle_command: string;
  };
  generated_at: string;
}

export interface AdminObservabilityWorkspaceResponse {
  capabilities: AdminObservabilityCapabilities;
  health: SystemHealthResponse;
  monitoring: AdminObservabilityMonitoringPayload;
  workflow: {
    job_status: WorkflowSchedulerJobStatus | null;
    health: WorkflowSchedulerHealth | null;
    incidents: {
      items: WorkflowSchedulerIncidentItem[];
      total: number;
    };
  };
  access_exception: {
    summary: AccessExceptionWorkspaceResponse['summary'] | null;
    scheduler_status: AccessExceptionSchedulerStatus | null;
    automation_policy: AccessExceptionAutomationPolicy | null;
    recent_activity: AccessExceptionActivityItem[];
  };
  access_review: {
    recent_activity: AccessReviewActivityItem[];
  };
  provisioning: {
    recent_activity: UserProvisioningActivityItem[];
  };
  offboarding: {
    recent_activity: UserOffboardingActivityItem[];
  };
  governance: {
    recent_activity: GovernanceActivityItem[];
    rbac_history_meta: RoleModulePermissionHistoryMetaResponse | null;
  };
  business_flows: AdminObservabilityBusinessFlows;
  approval_audit: {
    domains: AdminObservabilityApprovalAuditDomain[];
    recent_activity: AdminObservabilityApprovalAuditItem[];
    hot_items: AdminObservabilityApprovalAuditHotItem[];
    queue_rows: AdminObservabilityApprovalQueueRow[];
    queue_summary: AdminObservabilityApprovalQueueSummary;
    timeline_7d: AdminObservabilityApprovalAuditTimelinePoint[];
  };
  audit_spotlight: AdminAuditWorkspaceResponse;
  generated_at: string;
}

export interface GovernancePermissionItem {
  id: number;
  code: string;
  name: string;
  resource: string;
  action: string;
}

export interface GovernanceRoleItem {
  id: number;
  code: string;
  name: string;
  description: string;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  permissions: GovernancePermissionItem[];
  permission_count: number;
  user_count: number;
  active_user_count: number;
  last_activity_at?: string | null;
  last_activity_action?: string | null;
  module_keys: string[];
}

export interface GovernanceTeamItem {
  id: number;
  code: string;
  name: string;
  description: string;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  user_count: number;
  active_user_count: number;
  locked_user_count: number;
  last_activity_at?: string | null;
  last_activity_action?: string | null;
}

export interface GovernanceRoleTemplate {
  key: string;
  name: string;
  description: string;
  tone: string;
  focus_modules: string[];
  permission_ids: number[];
  permissions: GovernancePermissionItem[];
  missing_permissions: string[];
}

export interface GovernanceTeamPreset {
  key: string;
  code: string;
  name: string;
  description: string;
  tone: string;
}

export interface GovernanceWatchlistItem {
  kind: 'role' | 'team' | 'user' | string;
  severity: 'warning' | 'error' | 'info' | string;
  title: string;
  description: string;
  entity_id: number;
  route: string;
}

export interface GovernanceActivityItem {
  id: number;
  timestamp: string;
  kind: 'role' | 'team' | 'assignment' | 'module' | 'catalog' | string;
  kind_label: string;
  action: string;
  summary: string;
  severity: string;
  route: string;
  changed_fields: string[];
  entity_type: string;
  entity_id: number;
  entity_code: string;
  actor: {
    id: number | null;
    username: string;
    full_name: string;
  };
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
}

export interface RoleGovernanceSummaryResponse {
  summary: {
    total_roles: number;
    active_roles: number;
    inactive_roles: number;
    roles_without_users: number;
    roles_without_permissions: number;
    sensitive_roles: number;
    average_permissions_per_role: number;
    total_teams: number;
    active_teams: number;
    inactive_teams: number;
    empty_teams: number;
    users_without_role: number;
    users_without_team: number;
    locked_users: number;
    recent_events_7d: number;
  };
  module_coverage: Array<{
    key: string;
    label: string;
    changed_type: string;
    active_role_count: number;
  }>;
  role_templates: GovernanceRoleTemplate[];
  team_presets: GovernanceTeamPreset[];
  watchlist: GovernanceWatchlistItem[];
  top_roles: Array<{
    id: number;
    code: string;
    name: string;
    is_active: boolean;
    permission_count: number;
    user_count: number;
    module_keys: string[];
  }>;
  top_teams: Array<{
    id: number;
    code: string;
    name: string;
    is_active: boolean;
    user_count: number;
    active_user_count: number;
    locked_user_count: number;
  }>;
  permissions: GovernancePermissionItem[];
}

export interface RoleGovernanceActivityResponse {
  items: GovernanceActivityItem[];
  total: number;
  kind: string;
}

export interface OnboardingNotificationTypeOption {
  value: string;
  label: string;
  default_selected: boolean;
}

export interface OnboardingStudioRoleOption {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  permission_count: number;
  user_count: number;
  module_keys: string[];
}

export interface OnboardingStudioTeamOption {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
  user_count: number;
  locked_user_count: number;
}

export interface OnboardingStudioWorkflowTemplateOption {
  id: number;
  entity_type: string;
  trigger: string;
  title_template: string;
  due_in_days: number;
  priority: string;
  is_active: boolean;
  sort_order: number;
}

export interface OnboardingStudioPreset {
  key: string;
  name: string;
  description: string;
  is_active: boolean;
  tone: string;
  access_strategy: 'merge' | 'replace';
  role_ids: number[];
  team_ids: number[];
  workflow_template_ids: number[];
  task_owner_mode: 'target_user' | 'template_rule';
  checklist: string[];
  email_notifications_enabled: boolean;
  email_notification_types: string[];
  roles: OnboardingStudioRoleOption[];
  teams: OnboardingStudioTeamOption[];
  workflow_templates: OnboardingStudioWorkflowTemplateOption[];
  role_count: number;
  team_count: number;
  workflow_template_count: number;
  checklist_count: number;
  missing_role_ids: number[];
  missing_team_ids: number[];
  missing_workflow_template_ids: number[];
  inactive_role_ids: number[];
  inactive_team_ids: number[];
  inactive_workflow_template_ids: number[];
  has_issues: boolean;
}

export interface OnboardingStudioWatchlistItem {
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  description: string;
  preset_key: string;
  route: string;
}

export interface OnboardingStudioActivityItem {
  id: number;
  timestamp: string;
  kind: 'preset' | 'rollout' | string;
  action: string;
  summary: string;
  route: string;
  changed_fields: string[];
  entity_code: string;
  actor: {
    id: number | null;
    username: string;
    full_name: string;
  };
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
}

export interface OnboardingStudioSummaryResponse {
  summary: {
    total_presets: number;
    active_presets: number;
    presets_with_tasks: number;
    presets_with_notifications: number;
    users_without_role: number;
    users_without_team: number;
    applied_30d: number;
    tasks_created_30d: number;
  };
  presets: OnboardingStudioPreset[];
  watchlist: OnboardingStudioWatchlistItem[];
  notification_type_options: OnboardingNotificationTypeOption[];
  recent_activity: OnboardingStudioActivityItem[];
}

export interface OnboardingStudioPreviewResponse {
  preset: OnboardingStudioPreset;
  target_user: {
    id: number;
    username: string;
    full_name: string;
    email: string;
    is_active: boolean;
    is_locked: boolean;
    roles: Array<{ id: number; code: string; name: string }>;
    teams: Array<{ id: number; code: string; name: string }>;
  };
  access_strategy: 'merge' | 'replace';
  roles_before: Array<{ id: number; code: string; name: string }>;
  roles_after: Array<{ id: number; code: string; name: string }>;
  teams_before: Array<{ id: number; code: string; name: string }>;
  teams_after: Array<{ id: number; code: string; name: string }>;
  notification_before: {
    email_notifications_enabled: boolean;
    email_notification_types: string[];
  };
  notification_after: {
    email_notifications_enabled: boolean;
    email_notification_types: string[];
  };
  checklist: string[];
  task_preview: Array<{
    template_id: number;
    template_title: string;
    entity_type: string;
    trigger: string;
    title: string;
    description: string;
    priority: string;
    is_blocking: boolean;
    assigned_to: string | null;
    due_date: string | null;
    source_key: string;
    depends_on_source_key: string | null;
    would_skip: boolean;
  }>;
  summary: {
    role_additions: number;
    team_additions: number;
    task_total: number;
    task_existing: number;
    task_new: number;
  };
}

export interface ApplyOnboardingPresetResponse {
  success: boolean;
  preset_key: string;
  access_strategy: 'merge' | 'replace';
  changed_fields: string[];
  user: OnboardingStudioPreviewResponse['target_user'];
  roles_before: Array<{ id: number; code: string; name: string }>;
  roles_after: Array<{ id: number; code: string; name: string }>;
  teams_before: Array<{ id: number; code: string; name: string }>;
  teams_after: Array<{ id: number; code: string; name: string }>;
  notification_before: {
    email_notifications_enabled: boolean;
    email_notification_types: string[];
  };
  notification_after: {
    email_notifications_enabled: boolean;
    email_notification_types: string[];
  };
  checklist: string[];
  tasks_created: Array<{ id: number; title: string; source_key: string }>;
  tasks_skipped: Array<{ id: number; title: string; source_key: string }>;
}

export interface OnboardingStudioActivityResponse {
  items: OnboardingStudioActivityItem[];
  total: number;
}

export interface UserProvisioningActivityItem {
  id: number;
  timestamp: string;
  summary: string;
  route: string;
  changed_fields: string[];
  entity_code: string;
  actor: {
    id: number | null;
    username: string;
    full_name: string;
  };
  credentials: {
    password_mode: 'generated' | 'custom' | string;
    must_rotate_password: boolean;
  };
  provisioning: {
    preset_key: string;
    roles_count: number;
    teams_count: number;
    tasks_created_count: number;
    security_task_created: boolean;
  };
}

export interface UserProvisioningWatchlistItem {
  id: number;
  username: string;
  full_name: string;
  email: string;
  date_joined: string;
  state: 'ready' | 'access-gap' | 'security-followup' | 'onboarding-in-flight' | string;
  state_label: string;
  severity: 'success' | 'info' | 'warning' | 'error' | string;
  summary: string;
  route: string;
  preset_key: string;
  is_provisioned: boolean;
  role_count: number;
  team_count: number;
  open_task_count: number;
  onboarding_open_task_count: number;
  onboarding_done_task_count: number;
  has_security_followup: boolean;
}

export interface UserProvisioningWorkspaceResponse {
  summary: {
    active_presets: number;
    ready_presets: number;
    active_roles: number;
    active_teams: number;
    users_created_30d: number;
    locked_users_30d: number;
    provisioned_30d: number;
    onboarding_rollouts_30d: number;
    attention_accounts: number;
    security_followups: number;
    onboarding_in_flight: number;
    access_gaps: number;
  };
  presets: OnboardingStudioPreset[];
  watchlist: UserProvisioningWatchlistItem[];
  recent_activity: UserProvisioningActivityItem[];
  credential_policy: {
    default_password_mode: 'generated' | 'custom' | string;
    minimum_password_hint: string;
    secure_share_hint: string;
    rotation_deadline_days: number;
    recommended_share_channels: string[];
  };
}

export interface UserProvisioningPreviewResponse {
  profile: {
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    full_name: string;
    phone: string;
    is_active: boolean;
    is_staff: boolean;
  };
  availability: {
    username_available: boolean;
    email_available: boolean;
    username_suggestions: string[];
  };
  preset: OnboardingStudioPreset | null;
  roles: Array<{ id: number; code: string; name: string }>;
  teams: Array<{ id: number; code: string; name: string }>;
  notification_plan: {
    email_notifications_enabled: boolean;
    email_notification_types: string[];
  };
  task_preview: Array<{
    template_id: number;
    template_title: string;
    entity_type: string;
    trigger: string;
    title: string;
    description: string;
    priority: string;
    is_blocking: boolean;
    assigned_to: string | null;
    due_date: string | null;
    source_key: string;
    depends_on_source_key: string | null;
    would_skip: boolean;
  }>;
  security_task_preview: {
    title: string;
    description: string;
    priority: string;
    is_blocking: boolean;
    assigned_to: string;
    due_date: string | null;
    source_key: string;
    would_skip: boolean;
  } | null;
  summary: {
    role_count: number;
    team_count: number;
    task_total: number;
    workflow_task_total: number;
    security_task_total: number;
    create_tasks: boolean;
  };
  preflight_checks: Array<{
    key: string;
    title: string;
    status: 'ready' | 'warning' | 'blocked' | 'info' | string;
    description: string;
  }>;
  warnings: string[];
}

export interface UserProvisioningResponse {
  success: boolean;
  user: {
    id: number;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    full_name?: string;
    phone?: string;
    is_active: boolean;
    is_staff: boolean;
    is_locked: boolean;
    roles: Array<{ id: number; code: string; name: string }>;
    teams: Array<{ id: number; code: string; name: string }>;
  };
  credentials: {
    username: string;
    temporary_password: string;
    password_mode: 'generated' | 'custom' | string;
    must_rotate_password: boolean;
    secure_share_hint: string;
  };
  preset: OnboardingStudioPreset | null;
  roles: Array<{ id: number; code: string; name: string }>;
  teams: Array<{ id: number; code: string; name: string }>;
  notification_plan: {
    email_notifications_enabled: boolean;
    email_notification_types: string[];
  };
  tasks_created: Array<{ id: number; title: string; source_key: string }>;
  tasks_skipped: Array<{ id: number; title: string; source_key: string }>;
  security_task_created: { id: number; title: string; source_key: string } | null;
  security_task_skipped: { id: number; title: string; source_key: string } | null;
}

export interface UserProvisioningActivityResponse {
  items: UserProvisioningActivityItem[];
  total: number;
}

export interface UserLifecycleCandidateItem {
  id: number;
  username: string;
  full_name: string;
  email: string;
  is_active: boolean;
  is_locked: boolean;
  active_session_count: number;
  role_count: number;
  team_count: number;
  open_task_count: number;
  blocking_task_count: number;
  overdue_task_count: number;
  last_seen_at?: string | null;
}

export interface UserOffboardingWatchlistItem {
  id: number;
  username: string;
  full_name: string;
  email: string;
  state: 'session-cleanup' | 'task-handoff' | 'access-retained' | 'ready' | string;
  state_label: string;
  severity: 'success' | 'info' | 'warning' | 'error' | string;
  summary: string;
  active_session_count: number;
  open_task_count: number;
  role_count: number;
  team_count: number;
  is_active: boolean;
  is_locked: boolean;
  last_seen_at?: string | null;
  route: string;
}

export interface UserOffboardingActivityItem {
  id: number;
  timestamp: string;
  summary: string;
  route: string;
  entity_code: string;
  changed_fields: string[];
  actor: {
    id: number | null;
    username: string;
    full_name: string;
  };
  cleanup: {
    tasks_transferred_count: number;
    sessions_revoked_count: number;
    revoke_access: boolean;
    transfer_target_username: string;
  };
  account_state: {
    is_active: boolean;
    is_locked: boolean;
  };
}

export interface UserOffboardingWorkspaceResponse {
  summary: {
    candidate_users: number;
    review_queue: number;
    session_cleanup: number;
    task_handoffs: number;
    access_retained: number;
    ready_accounts: number;
  };
  candidates: UserLifecycleCandidateItem[];
  watchlist: UserOffboardingWatchlistItem[];
  recent_activity: UserOffboardingActivityItem[];
  policy: {
    require_task_handoff: boolean;
    default_deactivate_account: boolean;
    default_lock_account: boolean;
    default_revoke_access: boolean;
    default_revoke_sessions: boolean;
  };
}

export interface UserOffboardingPreviewResponse {
  user: UserProvisioningResponse['user'] & {
    active_session_count?: number;
    last_seen_at?: string | null;
    last_login_at?: string | null;
    last_seen_ip?: string | null;
    role_count?: number;
    team_count?: number;
  };
  access: {
    roles: Array<{ id: number; code: string; name: string }>;
    teams: Array<{ id: number; code: string; name: string }>;
    role_count: number;
    team_count: number;
  };
  sessions: {
    active_session_count: number;
    last_seen_at?: string | null;
    last_login_at?: string | null;
    last_seen_ip?: string | null;
  };
  tasks: {
    open_task_count: number;
    blocking_task_count: number;
    overdue_task_count: number;
  };
  transfer_target: {
    id: number;
    username: string;
    full_name: string;
  } | null;
  actions: {
    deactivate_account: boolean;
    lock_account: boolean;
    revoke_access: boolean;
    revoke_sessions: boolean;
    transfer_open_tasks: boolean;
  };
  preflight_checks: Array<{
    key: string;
    title: string;
    status: 'ready' | 'warning' | 'blocked' | 'info' | string;
    description: string;
  }>;
  warnings: string[];
}

export interface UserOffboardingResponse {
  success: boolean;
  user: UserOffboardingPreviewResponse['user'];
  cleanup: {
    tasks_transferred_count: number;
    sessions_revoked_count: number;
    revoke_access: boolean;
    transfer_target: {
      id: number;
      username: string;
      full_name: string;
    } | null;
  };
  actions: {
    deactivate_account: boolean;
    lock_account: boolean;
    revoke_access: boolean;
    revoke_sessions: boolean;
  };
}

export interface UserOffboardingActivityResponse {
  items: UserOffboardingActivityItem[];
  total: number;
}

export interface AccessReviewScopeOption {
  value: 'all_active' | 'dormant' | 'privileged' | 'unassigned' | 'locked' | string;
  label: string;
  description: string;
}

export interface AccessReviewActionOption {
  value: 'certify' | 'revoke_access' | 'lock_account' | string;
  label: string;
  description: string;
  impact: string;
}

export interface AccessReviewTargetUser {
  id: number;
  username: string;
  full_name: string;
  email: string;
  is_active: boolean;
  is_locked: boolean;
  is_staff: boolean;
  is_privileged: boolean;
  is_dormant: boolean;
  active_session_count: number;
  last_seen_at?: string | null;
  roles: Array<{ id: number; code: string; name: string }>;
  teams: Array<{ id: number; code: string; name: string }>;
  role_count: number;
  team_count: number;
  reasons: string[];
  risk_level: 'info' | 'warning' | 'error' | string;
  impact: string;
}

export interface AccessReviewCampaign {
  key: string;
  name: string;
  description: string;
  is_active: boolean;
  tone: string;
  scope: AccessReviewScopeOption['value'];
  scope_label: string;
  review_action: AccessReviewActionOption['value'];
  review_action_label: string;
  role_ids: number[];
  team_ids: number[];
  inactivity_days: number;
  include_locked: boolean;
  only_active_users: boolean;
  checklist: string[];
  roles: OnboardingStudioRoleOption[];
  teams: OnboardingStudioTeamOption[];
  role_count: number;
  team_count: number;
  checklist_count: number;
  matched_user_count: number;
  privileged_match_count: number;
  preview_users: AccessReviewTargetUser[];
  missing_role_ids: number[];
  missing_team_ids: number[];
  inactive_role_ids: number[];
  inactive_team_ids: number[];
  has_findings: boolean;
  warnings: string[];
}

export interface AccessReviewWatchlistItem {
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  description: string;
  campaign_key: string;
  matched_user_count: number;
  route: string;
}

export interface AccessReviewActivityItem {
  id: number;
  timestamp: string;
  kind: 'campaign' | 'review' | string;
  action: string;
  summary: string;
  route: string;
  changed_fields: string[];
  entity_code: string;
  actor: {
    id: number | null;
    username: string;
    full_name: string;
  };
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
}

export interface AccessReviewWorkspaceResponse {
  summary: {
    total_campaigns: number;
    active_campaigns: number;
    campaigns_with_findings: number;
    review_queue: number;
    destructive_campaigns: number;
    privileged_users: number;
    dormant_users: number;
  };
  campaigns: AccessReviewCampaign[];
  watchlist: AccessReviewWatchlistItem[];
  scope_options: AccessReviewScopeOption[];
  action_options: AccessReviewActionOption[];
  roles: OnboardingStudioRoleOption[];
  teams: OnboardingStudioTeamOption[];
  recent_activity: AccessReviewActivityItem[];
}

export interface AccessReviewPreviewResponse {
  campaign: AccessReviewCampaign;
  selection_mode: 'campaign' | 'manual' | string;
  selected_user_ids: number[];
  target_users: AccessReviewTargetUser[];
  skipped_users: AccessReviewTargetUser[];
  summary: {
    matched_users: number;
    selected_users: number;
    skipped_users: number;
    privileged_users: number;
    locked_users: number;
    dormant_users: number;
    users_with_access: number;
    destructive_review: boolean;
  };
  preflight_checks: Array<{
    key: string;
    title: string;
    status: 'ready' | 'warning' | 'blocked' | 'info' | string;
    description: string;
  }>;
  manual_selection_required: boolean;
  warnings: string[];
}

export interface ApplyAccessReviewResponse {
  success: boolean;
  campaign: AccessReviewCampaign;
  applied_user_ids: number[];
  skipped_user_ids: number[];
  affected_users: AccessReviewTargetUser[];
  summary: {
    processed_users: number;
    skipped_users: number;
    certified_users: number;
    access_revoked_users: number;
    accounts_locked: number;
  };
  note: string;
}

export interface AccessReviewActivityResponse {
  items: AccessReviewActivityItem[];
  total: number;
}

export interface AccessExceptionApproverCandidate {
  id: number;
  username: string;
  full_name: string;
  email: string;
  is_staff: boolean;
  active_session_count: number;
  role_count: number;
  team_count: number;
  teams?: Array<{ id: number; code: string; name: string; is_active?: boolean }>;
  is_out_of_office?: boolean;
  availability_label?: string;
  availability_window?: string;
}

export interface AccessExceptionPolicyPack {
  key: string;
  name: string;
  description: string;
  tone: string;
  risk_level: 'standard' | 'elevated' | 'critical' | string;
  requires_approval: boolean;
  approval_stage_count: number;
  approval_sla_hours: number;
  stage_one_label: string;
  stage_two_label: string;
  default_duration_days: number;
  max_duration_days: number;
  checklist: string[];
  department_key: string;
  department_label: string;
  preferred_team_tokens: string[];
  routing_summary: string;
  stage_one_strategy_label: string;
  stage_two_strategy_label: string;
  require_independent_stage_two: boolean;
}

export interface AccessExceptionApprovalStage {
  level: number;
  label: string;
  status: 'pending' | 'queued' | 'approved' | 'rejected' | string;
  started_at: string | null;
  decided_at: string | null;
  decision: string;
  decision_note: string;
  approver: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  } | null;
}

export interface AccessExceptionApproverReference {
  id: number;
  username: string;
  full_name: string;
  email: string;
  team_count?: number;
  teams?: Array<{ id: number; code: string; name: string; is_active?: boolean }>;
  is_out_of_office?: boolean;
  availability_label?: string;
  availability_window?: string;
}

export interface AccessExceptionRoutingRecommendation {
  department_key: string;
  department_label: string;
  routing_summary: string;
  stage_one_strategy_label: string;
  stage_two_strategy_label: string;
  routing_rule_active: boolean;
  routing_rule_notes: string;
  routing_rule_pack_keys: string[];
  target_teams: Array<{ id: number; code: string; name: string; is_active?: boolean }>;
  preferred_team_tokens: string[];
  suggested_stage_one_approver: AccessExceptionApproverReference | null;
  suggested_stage_two_approver: AccessExceptionApproverReference | null;
  selected_stage_one_approver: AccessExceptionApproverReference | null;
  selected_stage_two_approver: AccessExceptionApproverReference | null;
  selected_stage_one_source: string;
  selected_stage_two_source: string;
  selected_stage_one_source_label: string;
  selected_stage_two_source_label: string;
  selected_stage_one_resolution_kind: string;
  selected_stage_two_resolution_kind: string;
  selected_stage_one_resolution_label: string;
  selected_stage_two_resolution_label: string;
  selected_stage_one_coverage_note: string;
  selected_stage_two_coverage_note: string;
  auto_selected_stage_one: boolean;
  auto_selected_stage_two: boolean;
  warnings: string[];
}

export interface AccessExceptionRoutingRule {
  department_key: string;
  department_label: string;
  pack_keys: string[];
  is_active: boolean;
  stage_one_mode: string;
  stage_two_mode: string;
  stage_one_primary_user_id: number | null;
  stage_one_delegate_user_id: number | null;
  stage_one_rotation_user_ids: number[];
  stage_two_primary_user_id: number | null;
  stage_two_delegate_user_id: number | null;
  stage_two_rotation_user_ids: number[];
  fallback_team_tokens: string[];
  notes: string;
  stage_one_primary_approver: AccessExceptionApproverReference | null;
  stage_one_delegate_approver: AccessExceptionApproverReference | null;
  stage_one_rotation_approvers: AccessExceptionApproverReference[];
  stage_two_primary_approver: AccessExceptionApproverReference | null;
  stage_two_delegate_approver: AccessExceptionApproverReference | null;
  stage_two_rotation_approvers: AccessExceptionApproverReference[];
  configured_stage_one: boolean;
  configured_stage_two: boolean;
}

export interface AccessExceptionPolicy {
  key: string;
  pack_key: string;
  name: string;
  description: string;
  is_active: boolean;
  tone: string;
  risk_level: 'standard' | 'elevated' | 'critical' | string;
  approval_stage_count: number;
  approval_sla_hours: number;
  stage_one_label: string;
  stage_two_label: string;
  default_duration_days: number;
  max_duration_days: number;
  requires_approval: boolean;
  department_key: string;
  department_label: string;
  preferred_team_tokens: string[];
  routing_summary: string;
  stage_one_strategy_label: string;
  stage_two_strategy_label: string;
  require_independent_stage_two: boolean;
  role_ids: number[];
  team_ids: number[];
  checklist: string[];
  roles: Array<{ id: number; code: string; name: string; is_active?: boolean }>;
  teams: Array<{ id: number; code: string; name: string; is_active?: boolean }>;
  role_count: number;
  team_count: number;
  checklist_count: number;
  pending_request_count: number;
  active_request_count: number;
  expired_request_count: number;
  stale_pending_request_count: number;
  overdue_request_count: number;
  expired_access_request_count: number;
  self_approval_request_count: number;
  high_risk_request_count: number;
  critical_risk_request_count: number;
  out_of_office_request_count: number;
  unticketed_request_count: number;
  expiring_without_renewal_count: number;
  missing_role_ids: number[];
  missing_team_ids: number[];
  inactive_role_ids: number[];
  inactive_team_ids: number[];
  risk_score: number;
  risk: {
    label: string;
    description: string;
    severity: 'info' | 'warning' | 'error' | string;
  };
  debt_score: number;
  debt_status: 'healthy' | 'watch' | 'critical' | string;
  debt_label: string;
  debt_severity: 'success' | 'warning' | 'error' | string;
  debt_reasons: string[];
  has_findings: boolean;
  warnings: string[];
}

export interface AccessExceptionRequest {
  key: string;
  request_kind: 'grant' | 'renewal' | string;
  request_kind_label: string;
  parent_request_key: string;
  renewed_by_request_key: string;
  policy_pack_key: string;
  policy_key: string;
  policy_name: string;
  policy_risk_level: 'standard' | 'elevated' | 'critical' | string;
  policy_tone: string;
  requires_approval: boolean;
  approval_stage_count: number;
  approval_sla_hours: number;
  stage_one_label: string;
  stage_two_label: string;
  duration_days: number;
  justification: string;
  ticket_ref: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | string;
  status_label: string;
  lifecycle_state: 'pending' | 'active' | 'expiring' | 'expired' | 'rejected' | 'revoked' | string;
  severity: 'info' | 'warning' | 'error' | 'success' | string;
  decision_note: string;
  requested_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  revoked_at: string | null;
  renewed_at: string | null;
  expires_at: string | null;
  planned_expires_at: string | null;
  role_ids: number[];
  team_ids: number[];
  reminder_offsets_sent: number[];
  granted_role_count: number;
  granted_team_count: number;
  policy: {
    key: string;
    name: string;
    risk_level: string;
    tone: string;
    is_active: boolean;
  };
  target_user: {
    id: number;
    username: string;
    full_name: string;
    email: string;
    is_active: boolean;
    is_locked: boolean;
    role_count: number;
    team_count: number;
  };
  approver: AccessExceptionApproverReference | null;
  stage_two_approver: AccessExceptionApproverReference | null;
  active_approver: AccessExceptionApproverReference | null;
  requested_by: {
    id: number;
    username: string;
    full_name: string;
  } | null;
  approved_by: {
    id: number;
    username: string;
    full_name: string;
  } | null;
  rejected_by: {
    id: number;
    username: string;
    full_name: string;
  } | null;
  revoked_by: {
    id: number;
    username: string;
    full_name: string;
  } | null;
  roles: Array<{ id: number; code: string; name: string }>;
  teams: Array<{ id: number; code: string; name: string }>;
  role_count: number;
  team_count: number;
  approval_task: {
    id: number;
    title: string;
    status: string;
    is_open: boolean;
  } | null;
  has_self_approval: boolean;
  access_still_present: boolean;
  has_open_renewal: boolean;
  current_stage: number;
  total_stages: number;
  current_stage_label: string;
  routing: {
    department_key: string;
    department_label: string;
    summary: string;
    stage_one_strategy_label: string;
    stage_two_strategy_label: string;
    stage_one_source: string;
    stage_two_source: string;
    stage_one_source_label: string;
    stage_two_source_label: string;
    stage_one_resolution_kind: string;
    stage_two_resolution_kind: string;
    stage_one_resolution_label: string;
    stage_two_resolution_label: string;
    stage_one_coverage_note: string;
    stage_two_coverage_note: string;
    target_team_codes: string[];
    auto_selected_stage_one: boolean;
    auto_selected_stage_two: boolean;
  };
  continuity: {
    reroute_count: number;
    last_rerouted_at: string | null;
    last_reroute_note: string;
    last_rerouted_by: {
      id: number;
      username: string;
      full_name: string;
    } | null;
    last_reroute_from_approver: {
      id: number;
      username: string;
      full_name: string;
      email: string;
    } | null;
  };
  approval_stage_started_at: string | null;
  approval_stage_due_at: string | null;
  is_stage_overdue: boolean;
  approval_path: AccessExceptionApprovalStage[];
  risk_score: number;
  risk_band: 'low' | 'guarded' | 'high' | 'critical' | string;
  risk_label: string;
  risk_severity: 'info' | 'warning' | 'error' | string;
  risk_reasons: string[];
  can_approve: boolean;
  can_reject: boolean;
  can_revoke: boolean;
  can_renew: boolean;
  can_reroute: boolean;
}

export interface AccessExceptionWatchlistItem {
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  description: string;
  route: string;
  policy_key: string | null;
  request_key: string | null;
  lifecycle_state: string;
}

export interface AccessExceptionActivityItem {
  id: number;
  timestamp: string;
  kind: 'policy' | 'request' | 'automation' | 'availability' | 'simulation' | 'remediation' | string;
  action: string;
  summary: string;
  route: string;
  changed_fields: string[];
  entity_code: string;
  actor: {
    id: number | null;
    username: string;
    full_name: string;
  };
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
}

export interface AccessExceptionAutomationPolicy {
  enabled: boolean;
  auto_revoke_expired: boolean;
  reminder_offsets_days: number[];
  renewal_window_days: number;
  notify_target_user: boolean;
  notify_requested_by: boolean;
  notify_approver: boolean;
  approval_warning_window_hours: number;
  approval_escalation_delay_hours: number;
  notify_requester_for_sla: boolean;
  notify_active_approver_for_sla: boolean;
  notify_directory_owners_for_sla: boolean;
  continuity_drill_enabled: boolean;
  continuity_drill_interval_days: number;
  continuity_drill_warning_days: number;
  notify_directory_owners_for_continuity: boolean;
  auto_prepare_playbooks: boolean;
}

export interface AccessExceptionSchedulerStatus {
  available: boolean;
  enabled: boolean;
  name: string;
  interval_minutes: number;
  next_run: string | null;
  schedule_id: number | null;
  lock_active: boolean;
}

export interface AccessExceptionAutomationCandidate {
  request_key: string;
  request_kind: string;
  target_user: {
    id: number;
    username: string;
    full_name: string;
    email?: string;
  };
  policy: {
    key: string;
    name: string;
    risk_level: string;
    tone: string;
  };
  lifecycle_state: string;
  status_label: string;
  planned_expires_at: string | null;
  days_to_expiry: number;
  has_open_renewal: boolean;
  renewed_by_request_key: string;
  child_request_keys: string[];
  severity: string;
  reminder_offset_days?: number;
  access_still_present?: boolean;
}

export interface AccessExceptionAutomationPreviewResponse {
  generated_at: string;
  policy: AccessExceptionAutomationPolicy;
  scope: 'all' | 'reminders' | 'expiry' | 'approvals' | 'continuity' | string;
  summary: {
    monitored_requests: number;
    reminders_due: number;
    renewal_candidates: number;
    expired_with_access: number;
    auto_revokes_due: number;
    sla_warnings_due: number;
    sla_escalations_due: number;
    continuity_drills_due: number;
    playbooks_prepared: number;
  };
  reminder_candidates: AccessExceptionAutomationCandidate[];
  expired_candidates: AccessExceptionAutomationCandidate[];
  renewal_candidates: AccessExceptionAutomationCandidate[];
  sla_warning_candidates: AccessExceptionSlaRadarItem[];
  sla_escalation_candidates: AccessExceptionSlaRadarItem[];
  continuity_drill_candidates: AccessExceptionContinuityDrillItem[];
  processed: {
    run_mode: string;
    dry_run: boolean;
    reminders_sent: number;
    notifications_created: number;
    requests_auto_revoked: number;
    sla_warnings_sent: number;
    sla_escalations_sent: number;
    continuity_drills_run: number;
    playbooks_prepared: number;
    revoked_request_keys: string[];
    reminded_request_keys: string[];
    sla_warning_request_keys: string[];
    sla_escalation_request_keys: string[];
    continuity_drill_department_keys: string[];
  };
  scheduler_status?: AccessExceptionSchedulerStatus;
}

export interface AccessExceptionRoutingCoverageSummary {
  departments_total: number;
  departments_stage_one_ready: number;
  departments_stage_two_ready: number;
  departments_with_backlog: number;
  departments_with_overdue: number;
  coverage_gaps: number;
  fallback_pending_requests: number;
  near_sla_requests: number;
}

export interface AccessExceptionRoutingCoverageRow {
  department_key: string;
  department_label: string;
  pack_keys: string[];
  active_policy_count: number;
  critical_policy_count: number;
  approval_policy_count: number;
  multi_stage_policy_count: number;
  pending_request_count: number;
  near_sla_request_count: number;
  overdue_request_count: number;
  fallback_request_count: number;
  warnings_due: number;
  escalations_due: number;
  stage_one_required: boolean;
  stage_two_required: boolean;
  stage_one_ready: boolean;
  stage_two_ready: boolean;
  stage_one_mode: string;
  stage_two_mode: string;
  routing_rule_active: boolean;
  notes: string;
  status: 'healthy' | 'warning' | 'error' | string;
  warnings: string[];
  warning_count: number;
}

export interface AccessExceptionSlaRadarItem {
  request_key: string;
  request_kind: string;
  request_kind_label: string;
  policy: {
    key: string;
    name: string;
    risk_level: string;
    tone: string;
  };
  target_user: {
    id: number;
    username: string;
    full_name: string;
    email?: string;
  };
  department_key: string;
  department_label: string;
  stage_label: string;
  current_stage: number;
  total_stages: number;
  active_approver: {
    id: number;
    username: string;
    full_name: string;
    email?: string;
  } | null;
  approval_stage_started_at: string | null;
  approval_stage_due_at: string | null;
  hours_to_due: number;
  hours_overdue: number;
  status: 'near-due' | 'overdue' | string;
  severity: 'warning' | 'error' | string;
  routing_source: string;
  routing_source_label: string;
  warning_sent: boolean;
  escalation_sent: boolean;
  warning_due: boolean;
  escalation_due: boolean;
}

export interface AccessExceptionSlaRadarResponse {
  generated_at: string;
  warning_window_hours: number;
  escalation_delay_hours: number;
  summary: {
    tracked_pending: number;
    near_due: number;
    overdue: number;
    warnings_due: number;
    escalations_due: number;
  };
  items: AccessExceptionSlaRadarItem[];
}

export interface AccessExceptionApproverCapacitySummary {
  total_approvers: number;
  overloaded_approvers: number;
  at_risk_approvers: number;
  pending_assignments: number;
  overdue_assignments: number;
  single_threaded_departments: number;
  coverage_gap_departments: number;
  out_of_office_approvers: number;
}

export interface AccessExceptionApproverCapacityRow {
  approver_id: number;
  approver: AccessExceptionApproverReference | null;
  is_staff: boolean;
  active_session_count: number;
  is_out_of_office: boolean;
  availability_label: string;
  availability_window: string;
  role_count: number;
  team_count: number;
  teams: Array<{ id: number; code: string; name: string; is_active?: boolean }>;
  pending_request_count: number;
  near_sla_request_count: number;
  overdue_request_count: number;
  stage_one_queue_count: number;
  stage_two_queue_count: number;
  primary_department_count: number;
  delegate_department_count: number;
  stage_one_primary_departments: string[];
  stage_two_primary_departments: string[];
  stage_one_delegate_departments: string[];
  stage_two_delegate_departments: string[];
  single_threaded_departments: string[];
  coverage_gap_departments: string[];
  pending_departments: string[];
  load_score: number;
  status: 'healthy' | 'warning' | 'critical' | string;
  warnings: string[];
}

export interface AccessExceptionWorkloadRecommendation {
  id: string;
  kind: string;
  stage: number;
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  description: string;
  department_key: string;
  department_label: string;
  route: string;
  current_owner: AccessExceptionApproverReference | null;
  recommended_primary_approver: AccessExceptionApproverReference | null;
  recommended_delegate_approver: AccessExceptionApproverReference | null;
  rationale: string;
  action_label: string;
}

export interface AccessExceptionApproverAvailabilitySummary {
  tracked_approvers: number;
  out_of_office_approvers: number;
  covered_out_of_office_approvers: number;
  out_of_office_coverage_gaps: number;
  impacted_requests: number;
}

export interface AccessExceptionApproverAvailabilityRow {
  user_id: number;
  is_out_of_office: boolean;
  starts_at: string | null;
  ends_at: string | null;
  backup_user_id: number | null;
  label: string;
  notes: string;
  approver: AccessExceptionApproverReference | null;
  backup_approver: AccessExceptionApproverReference | null;
  is_currently_out_of_office: boolean;
  coverage_status: 'ready' | 'covered' | 'warning' | 'critical' | string;
  coverage_status_label: string;
  window_label: string;
  primary_departments: string[];
  delegate_departments: string[];
  rotation_departments: string[];
  impacted_request_count: number;
}

export interface AccessExceptionContinuitySummary {
  impacted_requests: number;
  ready_to_reroute: number;
  needs_manual: number;
  impacted_departments: number;
}

export interface AccessExceptionContinuityAnalyticsSummary {
  departments_tracked: number;
  departments_due: number;
  departments_overdue: number;
  departments_ready: number;
  departments_with_manual_gap: number;
}

export interface AccessExceptionContinuityAnalyticsRow {
  department_key: string;
  department_label: string;
  pending_request_count: number;
  impacted_request_count: number;
  ready_to_reroute_count: number;
  manual_gap_requests: number;
  out_of_office_owner_count: number;
  out_of_office_owner_names: string[];
  last_drill_at: string | null;
  days_since_last_drill: number | null;
  drill_status: 'ready' | 'due' | 'overdue' | 'standby' | string;
  drill_status_label: string;
  preparedness_score: number;
  request_keys: string[];
  critical_policy_count: number;
  approval_policy_count: number;
  stage_one_ready: boolean;
  stage_two_ready: boolean;
  stage_two_required: boolean;
  suggested_focus: string;
  route: string;
}

export interface AccessExceptionContinuityRunbookRow {
  request_key: string;
  department_key: string;
  department_label: string;
  current_stage: number;
  total_stages: number;
  stage_label: string;
  target_user: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  };
  policy: {
    key: string;
    name: string;
    risk_level: string;
    tone: string;
    is_active?: boolean;
  };
  active_approver: AccessExceptionApproverReference | null;
  availability_label: string;
  availability_window: string;
  continuity_note: string;
  suggested_approver: AccessExceptionApproverReference | null;
  suggested_source_label: string;
  suggested_resolution_label: string;
  suggested_coverage_note: string;
  reroute_count: number;
  last_rerouted_at: string | null;
  status: 'ready-to-reroute' | 'needs-manual' | string;
  status_label: string;
  route: string;
}

export interface AccessExceptionContinuityDrillItem {
  id: string;
  department_key: string;
  department_label: string;
  severity: 'info' | 'warning' | 'error' | string;
  status: 'due' | 'overdue' | string;
  status_label: string;
  pending_request_count: number;
  impacted_request_count: number;
  ready_to_reroute_count: number;
  manual_gap_requests: number;
  out_of_office_owner_count: number;
  last_drill_at: string | null;
  days_since_last_drill: number | null;
  suggested_focus: string;
  route: string;
}

export interface AccessExceptionContinuityDrillPreview {
  generated_at: string;
  summary: {
    drills_due: number;
    drills_overdue: number;
    playbooks_prepared: number;
  };
  items: AccessExceptionContinuityDrillItem[];
}

export interface AccessExceptionAbsenceSimulationImpactedRow {
  request_key: string;
  department_key: string;
  department_label: string;
  stage_label: string;
  current_stage: number;
  total_stages: number;
  target_user: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  };
  policy: {
    key: string;
    name: string;
    risk_level: string;
    tone: string;
  };
  active_approver: AccessExceptionApproverReference | null;
  continuity_note: string;
  suggested_approver: AccessExceptionApproverReference | null;
  suggested_source_label: string;
  suggested_resolution_label: string;
  suggested_coverage_note: string;
  status: 'ready-to-reroute' | 'needs-manual' | string;
  status_label: string;
  route: string;
}

export interface AccessExceptionAbsenceSimulationPlaybookItem {
  id: string;
  kind: string;
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  description: string;
  route: string;
  department_key: string;
  request_key: string | null;
  action_label: string;
}

export interface AccessExceptionAbsenceSimulationResponse {
  generated_at: string;
  simulation_label: string;
  department_key: string;
  duration_hours: number;
  simulated_approvers: AccessExceptionApproverReference[];
  summary: {
    impacted_requests: number;
    ready_to_reroute: number;
    needs_manual: number;
    departments_impacted: number;
    playbooks_prepared: number;
  };
  impacted_requests: AccessExceptionAbsenceSimulationImpactedRow[];
  continuity_analytics: AccessExceptionContinuityAnalyticsRow[];
  playbooks: AccessExceptionAbsenceSimulationPlaybookItem[];
}

export interface AccessExceptionGuidedRemediationSummary {
  total_actions: number;
  critical_actions: number;
  policy_actions: number;
  request_actions: number;
}

export interface AccessExceptionGuidedRemediationItem {
  id: string;
  kind: 'policy' | 'request' | string;
  action_type: 'policy_enable_approval' | 'policy_upgrade_stage_two' | 'request_revoke' | 'request_reroute' | string;
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  description: string;
  action_label: string;
  policy_key: string | null;
  policy_name: string;
  request_key: string | null;
  request_status: string;
  department_key: string;
  department_label: string;
  target_user: {
    id: number;
    username: string;
    full_name: string;
    email: string;
    is_active?: boolean;
    is_locked?: boolean;
    role_count?: number;
    team_count?: number;
  } | null;
  suggested_approver: AccessExceptionApproverReference | null;
  suggested_source_label: string;
  suggested_resolution_label: string;
  suggested_note: string;
  route: string;
}

export interface AccessExceptionWorkspaceResponse {
  summary: {
    total_policies: number;
    active_policies: number;
    critical_policies: number;
    requests_pending: number;
    requests_active: number;
    expiring_requests: number;
    expired_requests: number;
    requests_with_access: number;
    high_risk_requests: number;
    critical_risk_requests: number;
    policy_debt_watchlist: number;
    policy_debt_critical: number;
    review_queue: number;
    routing_departments: number;
    routing_coverage_gaps: number;
    sla_requests_near_due: number;
    sla_requests_overdue: number;
    sla_escalations_due: number;
    overloaded_approvers: number;
    backup_gap_departments: number;
    out_of_office_approvers: number;
    out_of_office_coverage_gaps: number;
    continuity_impacted_requests: number;
    continuity_manual_reroutes: number;
    continuity_departments_due: number;
    continuity_departments_overdue: number;
    continuity_drills_due: number;
    continuity_playbooks_prepared: number;
    guided_remediation_actions: number;
    guided_remediation_critical: number;
  };
  policies: AccessExceptionPolicy[];
  policy_packs: AccessExceptionPolicyPack[];
  routing_rules: AccessExceptionRoutingRule[];
  routing_coverage_summary: AccessExceptionRoutingCoverageSummary;
  routing_coverage: AccessExceptionRoutingCoverageRow[];
  approver_capacity_summary: AccessExceptionApproverCapacitySummary;
  approver_capacity: AccessExceptionApproverCapacityRow[];
  approver_availability_summary: AccessExceptionApproverAvailabilitySummary;
  approver_availability: AccessExceptionApproverAvailabilityRow[];
  workload_recommendations: AccessExceptionWorkloadRecommendation[];
  requests: AccessExceptionRequest[];
  sla_radar: AccessExceptionSlaRadarResponse;
  continuity_summary: AccessExceptionContinuitySummary;
  continuity_runbook: AccessExceptionContinuityRunbookRow[];
  continuity_analytics_summary: AccessExceptionContinuityAnalyticsSummary;
  continuity_analytics: AccessExceptionContinuityAnalyticsRow[];
  continuity_drill_preview: AccessExceptionContinuityDrillPreview;
  guided_remediation_summary: AccessExceptionGuidedRemediationSummary;
  guided_remediation: AccessExceptionGuidedRemediationItem[];
  watchlist: AccessExceptionWatchlistItem[];
  roles: OnboardingStudioRoleOption[];
  teams: OnboardingStudioTeamOption[];
  approver_candidates: AccessExceptionApproverCandidate[];
  automation_policy: AccessExceptionAutomationPolicy;
  scheduler_status: AccessExceptionSchedulerStatus;
  automation_preview: AccessExceptionAutomationPreviewResponse;
  recent_activity: AccessExceptionActivityItem[];
}

export interface AccessExceptionPreviewResponse {
  policy: Pick<
    AccessExceptionPolicy,
    | 'key'
    | 'name'
    | 'description'
    | 'tone'
    | 'risk_level'
    | 'pack_key'
    | 'approval_stage_count'
    | 'approval_sla_hours'
    | 'stage_one_label'
    | 'stage_two_label'
    | 'default_duration_days'
    | 'max_duration_days'
    | 'requires_approval'
    | 'role_ids'
    | 'team_ids'
    | 'checklist'
  >;
  target_user: OnboardingStudioPreviewResponse['target_user'];
  approver: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  } | null;
  stage_two_approver: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  } | null;
  requester: {
    id: number;
    username: string;
    full_name: string;
  };
  duration_days: number;
  expires_at: string | null;
  roles_before: Array<{ id: number; code: string; name: string }>;
  roles_after: Array<{ id: number; code: string; name: string }>;
  teams_before: Array<{ id: number; code: string; name: string }>;
  teams_after: Array<{ id: number; code: string; name: string }>;
  checklist: string[];
  approval_path: AccessExceptionApprovalStage[];
  routing_recommendation: AccessExceptionRoutingRecommendation | null;
  preflight_checks: Array<{
    key: string;
    title: string;
    status: 'ready' | 'warning' | 'blocked' | 'info' | string;
    description: string;
  }>;
  warnings: string[];
  summary: {
    role_additions: number;
    team_additions: number;
    already_granted: boolean;
    privileged_target: boolean;
    approval_stage_count: number;
  };
  justification: string;
  ticket_ref: string;
  can_submit_request: boolean;
}

export interface AccessExceptionActivityResponse {
  items: AccessExceptionActivityItem[];
  total: number;
}
