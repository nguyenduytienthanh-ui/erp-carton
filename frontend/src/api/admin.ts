import axios from 'axios';

import axiosInstance from './axios';
import { API_BASE_URL, API_ENDPOINTS } from '../utils/constants';
import type {
  AccessExceptionAbsenceSimulationResponse,
  AccessExceptionActivityResponse,
  AccessExceptionAutomationPolicy,
  AccessExceptionAutomationPreviewResponse,
  AccessExceptionPreviewResponse,
  AccessExceptionSchedulerStatus,
  AccessExceptionWorkspaceResponse,
  AccessGovernanceSurfaceAuditResponse,
  AdminAuditWorkspaceResponse,
  AdminPerformanceDrilldownResponse,
  AdminObservabilityWorkspaceResponse,
  AccessReviewActivityResponse,
  AccessReviewPreviewResponse,
  AccessReviewWorkspaceResponse,
  ApplyAccessReviewResponse,
  ApplyOnboardingPresetResponse,
  GovernanceRoleItem,
  GovernanceTeamItem,
  OnboardingStudioActivityResponse,
  OnboardingStudioPreviewResponse,
  OnboardingStudioSummaryResponse,
  RoleGovernanceActivityResponse,
  RoleGovernanceSummaryResponse,
  RoleModulePermissionFreezeHistoryResponse,
  RoleModulePermissionHistoryMetaResponse,
  RoleModulePermissionHistoryResponse,
  RoleModulePermissionResponse,
  RoleModulePermissionUpdatePayload,
  ReleaseCleanupPreviewResponse,
  SystemHealthResponse,
  UserProvisioningActivityResponse,
  UserOffboardingActivityResponse,
  UserOffboardingPreviewResponse,
  UserOffboardingResponse,
  UserOffboardingWorkspaceResponse,
  UserProvisioningPreviewResponse,
  UserProvisioningResponse,
  UserProvisioningWorkspaceResponse,
} from '../types/admin';

const SERVICE_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, '');

function normalizePaginatedResponse<T>(data: { count: number; results: T[] } | T[]): { count: number; results: T[] } {
  if (Array.isArray(data)) {
    return { count: data.length, results: data };
  }
  return data;
}

export const adminApi = {
  getSystemHealth: async (params?: { verbose?: boolean }): Promise<SystemHealthResponse> => {
    const response = await axios.get(`${SERVICE_BASE_URL}/health/`, { params });
    return response.data as SystemHealthResponse;
  },

  getAdminObservabilityWorkspace: async (params?: {
    hours?: number;
    incident_limit?: number;
    activity_limit?: number;
  }): Promise<AdminObservabilityWorkspaceResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}admin_observability_workspace/`, { params });
    return response.data as AdminObservabilityWorkspaceResponse;
  },

  runAdminObservabilityAlertDrill: async (payload?: {
    title?: string;
    message?: string;
    severity?: 'info' | 'warning' | 'error' | 'success';
    channels?: string[];
  }): Promise<{
    title: string;
    message: string;
    severity: string;
    is_test: boolean;
    requested_channels: string[];
    configured_channels: string[];
    status_counts: {
      SUCCESS: number;
      FAILED: number;
      SKIPPED: number;
    };
    overall_status: string;
    results: Array<{
      channel: string;
      status: string;
      detail: string;
    }>;
  }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}admin_observability_alert_drill/`, payload ?? {});
    return response.data as {
      title: string;
      message: string;
      severity: string;
      is_test: boolean;
      requested_channels: string[];
      configured_channels: string[];
      status_counts: {
        SUCCESS: number;
        FAILED: number;
        SKIPPED: number;
      };
      overall_status: string;
      results: Array<{
        channel: string;
        status: string;
        detail: string;
      }>;
    };
  },

  getAdminGoLiveHandoff: async (params?: {
    environment?: 'staging' | 'uat' | 'production';
  }): Promise<Record<string, unknown>> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}admin_observability_go_live_handoff/`, { params });
    return response.data as Record<string, unknown>;
  },

  getAdminAlertReadiness: async (params?: {
    hours?: number;
  }): Promise<Record<string, unknown>> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}admin_observability_alert_readiness/`, { params });
    return response.data as Record<string, unknown>;
  },

  getAdminReleaseCleanupPreview: async (): Promise<ReleaseCleanupPreviewResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}admin_observability_release_cleanup_preview/`);
    return response.data as ReleaseCleanupPreviewResponse;
  },

  getAdminReleaseLockfile: async (params?: {
    environment?: 'staging' | 'uat' | 'production';
  }): Promise<Record<string, unknown>> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}admin_observability_release_lockfile/`, { params });
    return response.data as Record<string, unknown>;
  },

  getAdminPerformanceDrilldown: async (params?: {
    include_all?: boolean;
    sample_size?: number;
  }): Promise<AdminPerformanceDrilldownResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}admin_observability_performance_drilldown/`, { params });
    return response.data as AdminPerformanceDrilldownResponse;
  },

  getAdminAuditWorkspace: async (params?: {
    hours?: number;
    limit?: number;
  }): Promise<AdminAuditWorkspaceResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}admin_audit_workspace/`, { params });
    return response.data as AdminAuditWorkspaceResponse;
  },

  getAdminAuditRetentionPreview: async (params?: {
    days?: number;
  }): Promise<{
    generated_at: string;
    mode: string;
    retention_days: number;
    cutoff: string;
    expired_count: number;
    deleted_count: number;
    status: string;
  }> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}admin_audit_retention_preview/`, { params });
    return response.data as {
      generated_at: string;
      mode: string;
      retention_days: number;
      cutoff: string;
      expired_count: number;
      deleted_count: number;
      status: string;
    };
  },

  exportAdminAuditFile: async (params?: {
    export_format?: 'csv' | 'json';
    hours?: number;
    limit?: number;
    domain?: string;
  }): Promise<Blob> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}admin_audit_export/`, {
      params,
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  listRoles: async (params?: { page_size?: number; is_active?: boolean }): Promise<GovernanceRoleItem[]> => {
    const response = await axiosInstance.get(API_ENDPOINTS.ROLES, { params });
    return normalizePaginatedResponse(response.data as { count: number; results: GovernanceRoleItem[] } | GovernanceRoleItem[]).results;
  },

  createRole: async (payload: {
    code: string;
    name: string;
    description?: string;
    is_active?: boolean;
    sort_order?: number;
    permission_ids?: number[];
  }): Promise<GovernanceRoleItem> => {
    const response = await axiosInstance.post(API_ENDPOINTS.ROLES, payload);
    return response.data as GovernanceRoleItem;
  },

  getRole: async (id: number): Promise<GovernanceRoleItem> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.ROLES}${id}/`);
    return response.data as GovernanceRoleItem;
  },

  updateRole: async (id: number, payload: Partial<{
    code: string;
    name: string;
    description: string;
    is_active: boolean;
    sort_order: number;
    permission_ids: number[];
  }>): Promise<GovernanceRoleItem> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.ROLES}${id}/`, payload);
    return response.data as GovernanceRoleItem;
  },

  bulkActivateRoles: async (ids: number[]): Promise<{ success: boolean; count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.ROLES}bulk_activate/`, { ids });
    return response.data as { success: boolean; count: number };
  },

  bulkDeactivateRoles: async (ids: number[]): Promise<{ success: boolean; count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.ROLES}bulk_deactivate/`, { ids });
    return response.data as { success: boolean; count: number };
  },

  bulkDeleteRoles: async (ids: number[]): Promise<{ success: boolean; count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.ROLES}bulk_delete/`, { ids });
    return response.data as { success: boolean; count: number };
  },

  listTeams: async (params?: { page_size?: number; is_active?: boolean }): Promise<GovernanceTeamItem[]> => {
    const response = await axiosInstance.get(API_ENDPOINTS.TEAMS, { params });
    return normalizePaginatedResponse(response.data as { count: number; results: GovernanceTeamItem[] } | GovernanceTeamItem[]).results;
  },

  createTeam: async (payload: {
    code: string;
    name: string;
    description?: string;
    is_active?: boolean;
    sort_order?: number;
  }): Promise<GovernanceTeamItem> => {
    const response = await axiosInstance.post(API_ENDPOINTS.TEAMS, payload);
    return response.data as GovernanceTeamItem;
  },

  getTeam: async (id: number): Promise<GovernanceTeamItem> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.TEAMS}${id}/`);
    return response.data as GovernanceTeamItem;
  },

  updateTeam: async (id: number, payload: Partial<{
    code: string;
    name: string;
    description: string;
    is_active: boolean;
    sort_order: number;
  }>): Promise<GovernanceTeamItem> => {
    const response = await axiosInstance.patch(`${API_ENDPOINTS.TEAMS}${id}/`, payload);
    return response.data as GovernanceTeamItem;
  },

  bulkActivateTeams: async (ids: number[]): Promise<{ success: boolean; count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.TEAMS}bulk_activate/`, { ids });
    return response.data as { success: boolean; count: number };
  },

  bulkDeactivateTeams: async (ids: number[]): Promise<{ success: boolean; count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.TEAMS}bulk_deactivate/`, { ids });
    return response.data as { success: boolean; count: number };
  },

  bulkDeleteTeams: async (ids: number[]): Promise<{ success: boolean; count: number }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.TEAMS}bulk_delete/`, { ids });
    return response.data as { success: boolean; count: number };
  },

  getRoleGovernanceSummary: async (): Promise<RoleGovernanceSummaryResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.ROLES}governance_summary/`);
    return response.data as RoleGovernanceSummaryResponse;
  },

  getRoleGovernanceActivity: async (params?: { kind?: string; limit?: number }): Promise<RoleGovernanceActivityResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.ROLES}governance_activity/`, { params });
    return response.data as RoleGovernanceActivityResponse;
  },

  getOnboardingStudioSummary: async (): Promise<OnboardingStudioSummaryResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}onboarding_studio/`);
    return response.data as OnboardingStudioSummaryResponse;
  },

  saveOnboardingPreset: async (payload: {
    key: string;
    name: string;
    description?: string;
    is_active?: boolean;
    tone?: string;
    access_strategy?: 'merge' | 'replace';
    role_ids?: number[];
    team_ids?: number[];
    workflow_template_ids?: number[];
    task_owner_mode?: 'target_user' | 'template_rule';
    checklist?: string[];
    email_notifications_enabled?: boolean;
    email_notification_types?: string[];
  }): Promise<{ success: boolean; preset: OnboardingStudioSummaryResponse['presets'][number]; action: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}onboarding_presets/`, payload);
    return response.data as { success: boolean; preset: OnboardingStudioSummaryResponse['presets'][number]; action: string };
  },

  deleteOnboardingPreset: async (key: string): Promise<{ success: boolean; key: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}onboarding_presets_delete/`, { key });
    return response.data as { success: boolean; key: string };
  },

  previewOnboardingPreset: async (payload: {
    preset_key: string;
    user_id: number;
    access_strategy?: 'merge' | 'replace';
  }): Promise<OnboardingStudioPreviewResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}onboarding_preview/`, payload);
    return response.data as OnboardingStudioPreviewResponse;
  },

  applyOnboardingPreset: async (payload: {
    preset_key: string;
    user_id: number;
    access_strategy?: 'merge' | 'replace';
    create_tasks?: boolean;
  }): Promise<ApplyOnboardingPresetResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}apply_onboarding_preset/`, payload);
    return response.data as ApplyOnboardingPresetResponse;
  },

  getOnboardingActivity: async (params?: { limit?: number }): Promise<OnboardingStudioActivityResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}onboarding_activity/`, { params });
    return response.data as OnboardingStudioActivityResponse;
  },

  getUserProvisioningWorkspace: async (): Promise<UserProvisioningWorkspaceResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}provisioning_workspace/`);
    return response.data as UserProvisioningWorkspaceResponse;
  },

  previewProvisionUser: async (payload: {
    username: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    preset_key?: string;
    role_ids?: number[];
    team_ids?: number[];
    is_active?: boolean;
    is_staff?: boolean;
    create_tasks?: boolean;
    include_security_task?: boolean;
  }): Promise<UserProvisioningPreviewResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}provisioning_preview/`, payload);
    return response.data as UserProvisioningPreviewResponse;
  },

  provisionUser: async (payload: {
    username: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    preset_key?: string;
    role_ids?: number[];
    team_ids?: number[];
    is_active?: boolean;
    is_staff?: boolean;
    create_tasks?: boolean;
    include_security_task?: boolean;
    password_mode?: 'generated' | 'custom';
    temporary_password?: string;
  }): Promise<UserProvisioningResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}provision_user/`, payload);
    return response.data as UserProvisioningResponse;
  },

  getUserProvisioningActivity: async (params?: { limit?: number }): Promise<UserProvisioningActivityResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}provisioning_activity/`, { params });
    return response.data as UserProvisioningActivityResponse;
  },

  getUserOffboardingWorkspace: async (): Promise<UserOffboardingWorkspaceResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}offboarding_workspace/`);
    return response.data as UserOffboardingWorkspaceResponse;
  },

  previewUserOffboarding: async (payload: {
    user_id: number;
    transfer_task_owner_id?: number;
    deactivate_account?: boolean;
    lock_account?: boolean;
    revoke_access?: boolean;
    revoke_sessions?: boolean;
  }): Promise<UserOffboardingPreviewResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}offboarding_preview/`, payload);
    return response.data as UserOffboardingPreviewResponse;
  },

  offboardUser: async (payload: {
    user_id: number;
    transfer_task_owner_id?: number;
    deactivate_account?: boolean;
    lock_account?: boolean;
    revoke_access?: boolean;
    revoke_sessions?: boolean;
  }): Promise<UserOffboardingResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}offboard_user/`, payload);
    return response.data as UserOffboardingResponse;
  },

  getUserOffboardingActivity: async (params?: { limit?: number }): Promise<UserOffboardingActivityResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}offboarding_activity/`, { params });
    return response.data as UserOffboardingActivityResponse;
  },

  getAccessReviewWorkspace: async (): Promise<AccessReviewWorkspaceResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}access_review_workspace/`);
    return response.data as AccessReviewWorkspaceResponse;
  },

  getAccessGovernanceSurfaceAudit: async (params?: {
    low_coverage_threshold?: number;
  }): Promise<AccessGovernanceSurfaceAuditResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}access_governance_surface_audit/`, { params });
    return response.data as AccessGovernanceSurfaceAuditResponse;
  },

  saveAccessReviewCampaign: async (payload: {
    key: string;
    name: string;
    description?: string;
    is_active?: boolean;
    tone?: string;
    scope?: 'all_active' | 'dormant' | 'privileged' | 'unassigned' | 'locked';
    review_action?: 'certify' | 'revoke_access' | 'lock_account';
    role_ids?: number[];
    team_ids?: number[];
    inactivity_days?: number;
    include_locked?: boolean;
    only_active_users?: boolean;
    checklist?: string[];
  }): Promise<{ success: boolean; campaign: AccessReviewWorkspaceResponse['campaigns'][number]; action: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_review_campaigns/`, payload);
    return response.data as { success: boolean; campaign: AccessReviewWorkspaceResponse['campaigns'][number]; action: string };
  },

  deleteAccessReviewCampaign: async (key: string): Promise<{ success: boolean; key: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_review_campaigns_delete/`, { key });
    return response.data as { success: boolean; key: string };
  },

  previewAccessReview: async (payload: {
    campaign_key: string;
    selected_user_ids?: number[];
  }): Promise<AccessReviewPreviewResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_review_preview/`, payload);
    return response.data as AccessReviewPreviewResponse;
  },

  applyAccessReview: async (payload: {
    campaign_key: string;
    selected_user_ids?: number[];
    note?: string;
  }): Promise<ApplyAccessReviewResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}apply_access_review/`, payload);
    return response.data as ApplyAccessReviewResponse;
  },

  getAccessReviewActivity: async (params?: { limit?: number }): Promise<AccessReviewActivityResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}access_review_activity/`, { params });
    return response.data as AccessReviewActivityResponse;
  },

  getAccessExceptionWorkspace: async (): Promise<AccessExceptionWorkspaceResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}access_exception_workspace/`);
    return response.data as AccessExceptionWorkspaceResponse;
  },

  saveAccessExceptionPolicy: async (payload: {
    key: string;
    pack_key?: string;
    name: string;
    description?: string;
    is_active?: boolean;
    tone?: string;
    risk_level?: 'standard' | 'elevated' | 'critical';
    approval_stage_count?: number;
    approval_sla_hours?: number;
    stage_one_label?: string;
    stage_two_label?: string;
    default_duration_days?: number;
    max_duration_days?: number;
    requires_approval?: boolean;
    role_ids?: number[];
    team_ids?: number[];
    checklist?: string[];
  }): Promise<{ success: boolean; policy: AccessExceptionWorkspaceResponse['policies'][number]; action: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_policies/`, payload);
    return response.data as { success: boolean; policy: AccessExceptionWorkspaceResponse['policies'][number]; action: string };
  },

  saveAccessExceptionRoutingRule: async (payload: {
    department_key: string;
    department_label: string;
    is_active?: boolean;
    stage_one_mode?: string;
    stage_two_mode?: string;
    stage_one_primary_user_id?: number;
    stage_one_delegate_user_id?: number;
    stage_one_rotation_user_ids?: number[];
    stage_two_primary_user_id?: number;
    stage_two_delegate_user_id?: number;
    stage_two_rotation_user_ids?: number[];
    fallback_team_tokens?: string[];
    notes?: string;
  }): Promise<{ success: boolean; rule: AccessExceptionWorkspaceResponse['routing_rules'][number]; action: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_routing_rules/`, payload);
    return response.data as { success: boolean; rule: AccessExceptionWorkspaceResponse['routing_rules'][number]; action: string };
  },

  saveAccessExceptionApproverAvailability: async (payload: {
    user_id: number;
    is_out_of_office?: boolean;
    starts_at?: string | null;
    ends_at?: string | null;
    backup_user_id?: number | null;
    label?: string;
    notes?: string;
  }): Promise<{ success: boolean; availability: AccessExceptionWorkspaceResponse['approver_availability'][number]; action: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_approver_availability/`, payload);
    return response.data as { success: boolean; availability: AccessExceptionWorkspaceResponse['approver_availability'][number]; action: string };
  },

  deleteAccessExceptionPolicy: async (key: string): Promise<{ success: boolean; key: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_policies_delete/`, { key });
    return response.data as { success: boolean; key: string };
  },

  previewAccessException: async (payload: {
    policy_key: string;
    user_id: number;
    approver_user_id?: number;
    stage_two_approver_user_id?: number;
    duration_days?: number;
    justification?: string;
    ticket_ref?: string;
  }): Promise<AccessExceptionPreviewResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_preview/`, payload);
    return response.data as AccessExceptionPreviewResponse;
  },

  createAccessExceptionRequest: async (payload: {
    policy_key: string;
    user_id: number;
    approver_user_id?: number;
    stage_two_approver_user_id?: number;
    duration_days?: number;
    justification: string;
    ticket_ref?: string;
  }): Promise<{ success: boolean; request: AccessExceptionWorkspaceResponse['requests'][number]; action: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_requests/`, payload);
    return response.data as { success: boolean; request: AccessExceptionWorkspaceResponse['requests'][number]; action: string };
  },

  createAccessExceptionRenewal: async (payload: {
    request_key: string;
    approver_user_id?: number;
    stage_two_approver_user_id?: number;
    duration_days?: number;
    justification: string;
    ticket_ref?: string;
  }): Promise<{ success: boolean; request: AccessExceptionWorkspaceResponse['requests'][number]; action: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_renewals/`, payload);
    return response.data as { success: boolean; request: AccessExceptionWorkspaceResponse['requests'][number]; action: string };
  },

  decideAccessExceptionRequest: async (payload: {
    request_key: string;
    decision: 'approve' | 'reject';
    note?: string;
  }): Promise<{ success: boolean; request: AccessExceptionWorkspaceResponse['requests'][number]; action: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_decide/`, payload);
    return response.data as { success: boolean; request: AccessExceptionWorkspaceResponse['requests'][number]; action: string };
  },

  rerouteAccessExceptionRequest: async (payload: {
    request_key: string;
    approver_user_id?: number;
    note?: string;
  }): Promise<{ success: boolean; request: AccessExceptionWorkspaceResponse['requests'][number]; action: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_reroute/`, payload);
    return response.data as { success: boolean; request: AccessExceptionWorkspaceResponse['requests'][number]; action: string };
  },

  revokeAccessExceptionRequest: async (payload: {
    request_key: string;
    note?: string;
  }): Promise<{ success: boolean; request: AccessExceptionWorkspaceResponse['requests'][number]; action: string }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_revoke/`, payload);
    return response.data as { success: boolean; request: AccessExceptionWorkspaceResponse['requests'][number]; action: string };
  },

  applyAccessExceptionGuidedRemediation: async (payload: {
    action_type: 'policy_enable_approval' | 'policy_upgrade_stage_two' | 'request_revoke' | 'request_reroute';
    policy_key?: string;
    request_key?: string;
    note?: string;
  }): Promise<{
    success: boolean;
    action_type: string;
    action: string;
    message: string;
    policy?: AccessExceptionWorkspaceResponse['policies'][number];
    request?: AccessExceptionWorkspaceResponse['requests'][number];
  }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_guided_remediation/`, payload);
    return response.data as {
      success: boolean;
      action_type: string;
      action: string;
      message: string;
      policy?: AccessExceptionWorkspaceResponse['policies'][number];
      request?: AccessExceptionWorkspaceResponse['requests'][number];
    };
  },

  getAccessExceptionActivity: async (params?: { limit?: number }): Promise<AccessExceptionActivityResponse> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}access_exception_activity/`, { params });
    return response.data as AccessExceptionActivityResponse;
  },

  getAccessExceptionAutomationPolicy: async (): Promise<AccessExceptionAutomationPolicy> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}access_exception_automation_policy/`);
    return response.data as AccessExceptionAutomationPolicy;
  },

  saveAccessExceptionAutomationPolicy: async (payload: AccessExceptionAutomationPolicy): Promise<{ success: boolean; policy: AccessExceptionAutomationPolicy }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_automation_policy/`, payload);
    return response.data as { success: boolean; policy: AccessExceptionAutomationPolicy };
  },

  previewAccessExceptionAutomation: async (payload?: {
    scope?: 'all' | 'reminders' | 'expiry' | 'approvals' | 'continuity';
  }): Promise<AccessExceptionAutomationPreviewResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_automation_preview/`, payload ?? {});
    return response.data as AccessExceptionAutomationPreviewResponse;
  },

  runAccessExceptionAutomation: async (payload?: {
    dry_run?: boolean;
    scope?: 'all' | 'reminders' | 'expiry' | 'approvals' | 'continuity';
  }): Promise<AccessExceptionAutomationPreviewResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_run_automation/`, payload ?? {});
    return response.data as AccessExceptionAutomationPreviewResponse;
  },

  simulateAccessExceptionAbsence: async (payload: {
    approver_user_ids?: number[];
    department_key?: string;
    duration_hours?: number;
  }): Promise<AccessExceptionAbsenceSimulationResponse> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_absence_simulation/`, payload);
    return response.data as AccessExceptionAbsenceSimulationResponse;
  },

  getAccessExceptionSchedulerStatus: async (): Promise<AccessExceptionSchedulerStatus> => {
    const response = await axiosInstance.get(`${API_ENDPOINTS.USERS}access_exception_scheduler_status/`);
    return response.data as AccessExceptionSchedulerStatus;
  },

  saveAccessExceptionSchedulerStatus: async (payload: {
    enabled: boolean;
    interval_minutes: number;
  }): Promise<AccessExceptionSchedulerStatus & { success: boolean }> => {
    const response = await axiosInstance.post(`${API_ENDPOINTS.USERS}access_exception_scheduler_status/`, payload);
    return response.data as AccessExceptionSchedulerStatus & { success: boolean };
  },

  getRoleModulePermissions: async (): Promise<RoleModulePermissionResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.ROLE_MODULE_PERMISSIONS);
    return response.data as RoleModulePermissionResponse;
  },

  updateRoleModulePermissions: async (payload: RoleModulePermissionUpdatePayload): Promise<{ success: boolean; updated: number }> => {
    const response = await axiosInstance.post(API_ENDPOINTS.ROLE_MODULE_PERMISSIONS, payload);
    return response.data as { success: boolean; updated: number };
  },

  getRoleModulePermissionHistory: async (params?: {
    q?: string;
    user_id?: number;
    date_from?: string;
    date_to?: string;
    role_code?: string;
    changed_type?: string;
    page?: number;
    page_size?: number;
  }): Promise<RoleModulePermissionHistoryResponse> => {
    const response = await axiosInstance.get(API_ENDPOINTS.ROLE_MODULE_PERMISSIONS_HISTORY, { params });
    return response.data as RoleModulePermissionHistoryResponse;
  },

  exportRoleModulePermissionHistoryExcel: async (params?: {
    q?: string;
    user_id?: number;
    date_from?: string;
    date_to?: string;
    role_code?: string;
    changed_type?: string;
  }): Promise<Blob> => {
    const response = await axiosInstance.get(API_ENDPOINTS.ROLE_MODULE_PERMISSIONS_HISTORY, {
      params: { ...params, export: 'excel' },
      responseType: 'blob',
    });
    return response.data as Blob;
  },

  prepareFreezeModulePermissionActor: async (payload: {
    user_id: number;
    hours?: number;
    reason?: string;
  }): Promise<{
    success: boolean;
    prepare_token: string;
    target_user: { id: number; username: string; full_name: string };
    hours: number;
  }> => {
    const response = await axiosInstance.post('/roles/module_permissions_freeze_prepare/', payload);
    return response.data as {
      success: boolean;
      prepare_token: string;
      target_user: { id: number; username: string; full_name: string };
      hours: number;
    };
  },

  applyFreezeModulePermissionActor: async (payload: {
    prepare_token: string;
    confirm_text: string;
  }): Promise<{ success: boolean; user_id: number; frozen_until: string }> => {
    const response = await axiosInstance.post('/roles/module_permissions_freeze_apply/', payload);
    return response.data as { success: boolean; user_id: number; frozen_until: string };
  },

  unfreezeModulePermissionActor: async (payload: {
    user_id: number;
    confirm_text: string;
  }): Promise<{ success: boolean; user_id: number }> => {
    const response = await axiosInstance.post('/roles/module_permissions_unfreeze_actor/', payload);
    return response.data as { success: boolean; user_id: number };
  },

  getRoleModulePermissionFreezeHistory: async (params?: {
    q?: string;
    action_type?: 'LOCK' | 'ACTIVATE';
    page?: number;
    page_size?: number;
  }): Promise<RoleModulePermissionFreezeHistoryResponse> => {
    const response = await axiosInstance.get('/roles/module_permissions_freeze_history/', { params });
    return response.data as RoleModulePermissionFreezeHistoryResponse;
  },

  getRoleModulePermissionHistoryMeta: async (): Promise<RoleModulePermissionHistoryMetaResponse> => {
    const response = await axiosInstance.get('/roles/module_permissions_history_meta/');
    return response.data as RoleModulePermissionHistoryMetaResponse;
  },
};
