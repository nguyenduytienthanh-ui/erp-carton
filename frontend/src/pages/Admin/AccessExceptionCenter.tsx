import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';

import PageHeader from '../../components/PageHeader/PageHeader';
import { adminApi } from '../../api/admin';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { usersApi } from '../../api/users';
import type {
  AccessExceptionAbsenceSimulationImpactedRow,
  AccessExceptionAbsenceSimulationResponse,
  AccessExceptionActivityItem,
  AccessExceptionApproverAvailabilityRow,
  AccessExceptionApproverCapacityRow,
  AccessExceptionContinuityAnalyticsRow,
  AccessExceptionContinuityDrillItem,
  AccessExceptionAutomationPreviewResponse,
  AccessExceptionContinuityRunbookRow,
  AccessExceptionGuidedRemediationItem,
  AccessExceptionPolicy,
  AccessExceptionPreviewResponse,
  AccessExceptionRequest,
  AccessExceptionRoutingCoverageRow,
  AccessExceptionRoutingRule,
  AccessExceptionSlaRadarItem,
  AccessExceptionWorkloadRecommendation,
} from '../../types/admin';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';
import { PAGES } from '../../utils/constants';

const { Text, Paragraph } = Typography;

type PolicyFilter = 'all' | 'active' | 'inactive' | 'findings' | 'critical' | 'debt';
type RequestFilter = 'all' | 'pending' | 'active' | 'expiring' | 'expired' | 'closed' | 'high-risk';
type ActivityFilter = 'all' | 'approvals' | 'routing' | 'automation' | 'revocations';
type DecisionMode = 'approve' | 'reject' | 'revoke';

type PolicyFormValues = {
  key: string;
  pack_key?: string;
  name: string;
  description: string;
  is_active: boolean;
  tone: 'blue' | 'green' | 'gold' | 'cyan' | 'volcano' | 'purple';
  risk_level: 'standard' | 'elevated' | 'critical';
  approval_stage_count: number;
  approval_sla_hours: number;
  stage_one_label: string;
  stage_two_label: string;
  default_duration_days: number;
  max_duration_days: number;
  requires_approval: boolean;
  role_ids: number[];
  team_ids: number[];
  checklist_text: string;
};

type RequestFormValues = {
  policy_key?: string;
  user_id?: number;
  approver_user_id?: number;
  stage_two_approver_user_id?: number;
  duration_days?: number;
  justification: string;
  ticket_ref: string;
};

type RenewalFormValues = {
  approver_user_id?: number;
  stage_two_approver_user_id?: number;
  duration_days?: number;
  justification: string;
  ticket_ref: string;
};

type AutomationPolicyFormValues = {
  enabled: boolean;
  auto_revoke_expired: boolean;
  reminder_offsets_text: string;
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
};

type RoutingRuleFormValues = {
  department_key: string;
  department_label: string;
  is_active: boolean;
  stage_one_mode: string;
  stage_two_mode: string;
  stage_one_primary_user_id?: number;
  stage_one_delegate_user_id?: number;
  stage_one_rotation_user_ids: number[];
  stage_two_primary_user_id?: number;
  stage_two_delegate_user_id?: number;
  stage_two_rotation_user_ids: number[];
  fallback_team_tokens_text: string;
  notes: string;
};

type AvailabilityFormValues = {
  user_id?: number;
  is_out_of_office: boolean;
  starts_at?: string;
  ends_at?: string;
  backup_user_id?: number;
  label: string;
  notes: string;
};

type RerouteFormValues = {
  approver_user_id?: number;
  note: string;
};

type SimulationFormValues = {
  approver_user_ids: number[];
  department_key?: string;
  duration_hours: number;
};

type RerouteDialogState = {
  requestKey: string;
  requestLabel: string;
  stageLabel: string;
  currentApproverLabel: string;
  suggestedApproverId?: number;
  suggestedApproverLabel?: string;
  suggestedSourceLabel?: string;
  suggestedResolutionLabel?: string;
  suggestedCoverageNote?: string;
};
type AccessExceptionFilterSnapshot = {
  policy_search: string;
  policy_filter: PolicyFilter;
  request_search: string;
  request_filter: RequestFilter;
  activity_search: string;
  activity_filter: ActivityFilter;
};
type AccessExceptionNamedPreset = {
  id: string;
  name: string;
  filters: AccessExceptionFilterSnapshot;
};

const HERO_CARD_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #d9e7f5',
  background: 'linear-gradient(180deg, #ffffff 0%, #f4f8ff 100%)',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
};

const PANEL_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #e2e8f0',
  boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
};

const DEFAULT_POLICY_VALUES: PolicyFormValues = {
  key: '',
  pack_key: undefined,
  name: '',
  description: '',
  is_active: true,
  tone: 'cyan',
  risk_level: 'elevated',
  approval_stage_count: 1,
  approval_sla_hours: 24,
  stage_one_label: 'Quản lý phê duyệt',
  stage_two_label: '',
  default_duration_days: 7,
  max_duration_days: 14,
  requires_approval: true,
  role_ids: [],
  team_ids: [],
  checklist_text: '',
};

const DEFAULT_REQUEST_VALUES: RequestFormValues = {
  policy_key: undefined,
  user_id: undefined,
  approver_user_id: undefined,
  stage_two_approver_user_id: undefined,
  duration_days: undefined,
  justification: '',
  ticket_ref: '',
};

const DEFAULT_RENEWAL_VALUES: RenewalFormValues = {
  approver_user_id: undefined,
  stage_two_approver_user_id: undefined,
  duration_days: undefined,
  justification: '',
  ticket_ref: '',
};

const DEFAULT_AUTOMATION_POLICY_VALUES: AutomationPolicyFormValues = {
  enabled: true,
  auto_revoke_expired: true,
  reminder_offsets_text: '7, 3, 1',
  renewal_window_days: 5,
  notify_target_user: true,
  notify_requested_by: true,
  notify_approver: false,
  approval_warning_window_hours: 6,
  approval_escalation_delay_hours: 2,
  notify_requester_for_sla: true,
  notify_active_approver_for_sla: true,
  notify_directory_owners_for_sla: true,
  continuity_drill_enabled: true,
  continuity_drill_interval_days: 7,
  continuity_drill_warning_days: 2,
  notify_directory_owners_for_continuity: true,
  auto_prepare_playbooks: true,
};

const DEFAULT_ROUTING_RULE_VALUES: RoutingRuleFormValues = {
  department_key: '',
  department_label: '',
  is_active: true,
  stage_one_mode: 'directory_then_team',
  stage_two_mode: 'directory_then_independent',
  stage_one_primary_user_id: undefined,
  stage_one_delegate_user_id: undefined,
  stage_one_rotation_user_ids: [],
  stage_two_primary_user_id: undefined,
  stage_two_delegate_user_id: undefined,
  stage_two_rotation_user_ids: [],
  fallback_team_tokens_text: '',
  notes: '',
};

const DEFAULT_AVAILABILITY_VALUES: AvailabilityFormValues = {
  user_id: undefined,
  is_out_of_office: true,
  starts_at: undefined,
  ends_at: undefined,
  backup_user_id: undefined,
  label: '',
  notes: '',
};

const DEFAULT_SIMULATION_VALUES: SimulationFormValues = {
  approver_user_ids: [],
  department_key: undefined,
  duration_hours: 24,
};

function formatDateTime(value?: string | null): string {
  if (!value) return 'Chua ghi nhan';
  return dayjs(value).format('DD/MM/YYYY HH:mm');
}

function formatDateTimeLocal(value?: string | null): string | undefined {
  if (!value) return undefined;
  return dayjs(value).format('YYYY-MM-DDTHH:mm');
}

function toneColor(tone: string): string {
  if (tone === 'green') return 'green';
  if (tone === 'gold') return 'gold';
  if (tone === 'cyan') return 'cyan';
  if (tone === 'volcano') return 'volcano';
  if (tone === 'purple') return 'purple';
  return 'blue';
}

function riskColor(riskLevel: string): string {
  if (riskLevel === 'critical') return 'volcano';
  if (riskLevel === 'elevated') return 'gold';
  return 'blue';
}

function stateColor(state: string): string {
  if (state === 'active') return 'green';
  if (state === 'expiring') return 'gold';
  if (state === 'expired') return 'volcano';
  if (state === 'rejected' || state === 'revoked') return 'default';
  return 'blue';
}

function severityColor(severity: string): string {
  if (severity === 'error') return 'volcano';
  if (severity === 'warning') return 'gold';
  if (severity === 'success') return 'green';
  return 'blue';
}

function approvalStatusColor(status: string): string {
  if (status === 'approved') return 'green';
  if (status === 'rejected') return 'volcano';
  if (status === 'pending') return 'blue';
  return 'default';
}

function coverageStatusColor(status: string): string {
  if (status === 'error') return 'volcano';
  if (status === 'warning') return 'gold';
  return 'green';
}

function capacityStatusColor(status: string): string {
  if (status === 'critical') return 'volcano';
  if (status === 'warning') return 'gold';
  return 'green';
}

function availabilityStatusColor(status: string): string {
  if (status === 'critical') return 'volcano';
  if (status === 'warning') return 'gold';
  if (status === 'covered') return 'green';
  return 'blue';
}

function drillStatusColor(status: string): string {
  if (status === 'overdue') return 'volcano';
  if (status === 'due') return 'gold';
  if (status === 'ready') return 'green';
  return 'blue';
}

function requestRiskColor(riskBand: string): string {
  if (riskBand === 'critical') return 'volcano';
  if (riskBand === 'high') return 'red';
  if (riskBand === 'guarded') return 'gold';
  return 'blue';
}

function policyDebtColor(status: string): string {
  if (status === 'critical') return 'volcano';
  if (status === 'watch') return 'gold';
  return 'green';
}

function parseChecklistText(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

function buildChecklistText(items: string[]): string {
  return items.join('\n');
}

function buildTokenText(items: string[]): string {
  return items.join(', ');
}

function parseReminderOffsetsText(value: string): number[] {
  return value
    .split(/[,\n]/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .slice(0, 6);
}

function parseRoutingTokensText(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 8);
}

function renderCompactTags(items: Array<{ id: number; code: string; name: string }>, emptyLabel: string) {
  if (!items.length) return <Tag>{emptyLabel}</Tag>;
  return (
    <Space size={[6, 6]} wrap>
      {items.slice(0, 3).map((item) => (
        <Tag key={`${item.id}-${item.code}`}>{item.name || item.code}</Tag>
      ))}
      {items.length > 3 ? <Tag>+{items.length - 3}</Tag> : null}
    </Space>
  );
}

function SummaryCard({ title, value, tint }: { title: string; value: number; tint: string }) {
  return (
    <Card style={HERO_CARD_STYLE} bodyStyle={{ padding: 18 }}>
      <Statistic title={title} value={value} valueStyle={{ color: tint, fontWeight: 700 }} />
    </Card>
  );
}

export default function AccessExceptionCenter() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [searchParams] = useSearchParams();
  const focusRequestKey = searchParams.get('request_key') || '';
  const focusPolicyKey = searchParams.get('policy_key') || '';
  const focusSearch = searchParams.get('search') || '';
  const [policyDrawerOpen, setPolicyDrawerOpen] = useState(false);
  const [automationDrawerOpen, setAutomationDrawerOpen] = useState(false);
  const [routingDrawerOpen, setRoutingDrawerOpen] = useState(false);
  const [availabilityDrawerOpen, setAvailabilityDrawerOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<AccessExceptionPolicy | null>(null);
  const [editingRoutingRule, setEditingRoutingRule] = useState<AccessExceptionRoutingRule | null>(null);
  const [editingAvailability, setEditingAvailability] = useState<AccessExceptionApproverAvailabilityRow | null>(null);
  const [policyFilter, setPolicyFilter] = useState<PolicyFilter>('all');
  const [requestFilter, setRequestFilter] = useState<RequestFilter>('all');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [policySearch, setPolicySearch] = useState(() => focusPolicyKey || focusSearch);
  const [requestSearch, setRequestSearch] = useState(() => focusRequestKey || focusSearch);
  const [activitySearch, setActivitySearch] = useState(() => focusSearch);
  const [selectedPresetId, setSelectedPresetId] = useState('NONE');
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [previewData, setPreviewData] = useState<AccessExceptionPreviewResponse | null>(null);
  const [automationPreviewData, setAutomationPreviewData] = useState<AccessExceptionAutomationPreviewResponse | null>(null);
  const [simulationData, setSimulationData] = useState<AccessExceptionAbsenceSimulationResponse | null>(null);
  const [decisionState, setDecisionState] = useState<{ mode: DecisionMode; request: AccessExceptionRequest } | null>(null);
  const [renewalState, setRenewalState] = useState<AccessExceptionRequest | null>(null);
  const [rerouteState, setRerouteState] = useState<RerouteDialogState | null>(null);
  const [schedulerDraft, setSchedulerDraft] = useState<{ enabled: boolean; interval_minutes: number } | null>(null);
  const [policyForm] = Form.useForm<PolicyFormValues>();
  const [requestForm] = Form.useForm<RequestFormValues>();
  const [renewalForm] = Form.useForm<RenewalFormValues>();
  const [automationPolicyForm] = Form.useForm<AutomationPolicyFormValues>();
  const [routingForm] = Form.useForm<RoutingRuleFormValues>();
  const [availabilityForm] = Form.useForm<AvailabilityFormValues>();
  const [simulationForm] = Form.useForm<SimulationFormValues>();
  const [decisionForm] = Form.useForm<{ note: string }>();
  const [rerouteForm] = Form.useForm<RerouteFormValues>();
  const deferredPolicySearch = useDeferredValue(policySearch.trim().toLowerCase());
  const deferredRequestSearch = useDeferredValue(requestSearch.trim().toLowerCase());
  const deferredActivitySearch = useDeferredValue(activitySearch.trim().toLowerCase());
  const deferredUserSearch = useDeferredValue(userSearch.trim());
  const { config: savedConfig, saveConfig } = useUserPreferences(PAGES.ADMIN_ACCESS_EXCEPTIONS);
  const namedPresets = useMemo(() => {
    const raw = savedConfig?.saved_views;
    if (!Array.isArray(raw)) return [] as AccessExceptionNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        const name = typeof record.name === 'string' ? record.name : '';
        const filters = record.filters;
        if (!id || !name || !filters || typeof filters !== 'object') return null;
        const filterRecord = filters as Record<string, unknown>;
        const policyFilterValue = filterRecord.policy_filter;
        const requestFilterValue = filterRecord.request_filter;
        const activityFilterValue = filterRecord.activity_filter;
        if (
          policyFilterValue !== 'all'
          && policyFilterValue !== 'active'
          && policyFilterValue !== 'inactive'
          && policyFilterValue !== 'findings'
          && policyFilterValue !== 'critical'
          && policyFilterValue !== 'debt'
        ) {
          return null;
        }
        if (
          requestFilterValue !== 'all'
          && requestFilterValue !== 'pending'
          && requestFilterValue !== 'active'
          && requestFilterValue !== 'expiring'
          && requestFilterValue !== 'expired'
          && requestFilterValue !== 'closed'
          && requestFilterValue !== 'high-risk'
        ) {
          return null;
        }
        if (
          activityFilterValue !== 'all'
          && activityFilterValue !== 'approvals'
          && activityFilterValue !== 'routing'
          && activityFilterValue !== 'automation'
          && activityFilterValue !== 'revocations'
        ) {
          return null;
        }
        return {
          id,
          name,
          filters: {
            policy_search: typeof filterRecord.policy_search === 'string' ? filterRecord.policy_search : '',
            policy_filter: policyFilterValue,
            request_search: typeof filterRecord.request_search === 'string' ? filterRecord.request_search : '',
            request_filter: requestFilterValue,
            activity_search: typeof filterRecord.activity_search === 'string' ? filterRecord.activity_search : '',
            activity_filter: activityFilterValue,
          },
        } as AccessExceptionNamedPreset;
      })
      .filter((item): item is AccessExceptionNamedPreset => item !== null);
  }, [savedConfig?.saved_views]);
  const selectedPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );

  const workspaceQuery = useQuery({
    queryKey: ['admin-access-exception-workspace'],
    queryFn: adminApi.getAccessExceptionWorkspace,
  });
  const activityQuery = useQuery({
    queryKey: ['admin-access-exception-activity'],
    queryFn: () => adminApi.getAccessExceptionActivity({ limit: 40 }),
  });
  const userSearchQuery = useQuery({
    queryKey: ['admin-access-exception-users', deferredUserSearch],
    queryFn: () => usersApi.list({ is_active: true, search: deferredUserSearch || undefined }),
  });
  const workspaceData = workspaceQuery.data;
  const schedulerEnabled = schedulerDraft?.enabled ?? Boolean(workspaceData?.scheduler_status.enabled);
  const schedulerIntervalMinutes = schedulerDraft?.interval_minutes ?? Number(workspaceData?.scheduler_status.interval_minutes ?? 30);

  const selectedPolicyKey = Form.useWatch('policy_key', requestForm);
  const selectedPolicyPackKey = Form.useWatch('pack_key', policyForm);
  const policyRequiresApproval = Form.useWatch('requires_approval', policyForm);
  const policyStageCount = Number(Form.useWatch('approval_stage_count', policyForm) ?? DEFAULT_POLICY_VALUES.approval_stage_count);
  const selectedPolicy = workspaceData?.policies.find((item) => item.key === selectedPolicyKey) ?? null;

  const openPolicyEditor = useCallback((record?: AccessExceptionPolicy | null) => {
    setEditingPolicy(record ?? null);
    setPolicyDrawerOpen(true);
    if (!record) {
      policyForm.resetFields();
      policyForm.setFieldsValue(DEFAULT_POLICY_VALUES);
      return;
    }
    policyForm.setFieldsValue({
      key: record.key,
      pack_key: record.pack_key || undefined,
      name: record.name,
      description: record.description,
      is_active: record.is_active,
      tone: record.tone as PolicyFormValues['tone'],
      risk_level: record.risk_level as PolicyFormValues['risk_level'],
      approval_stage_count: record.approval_stage_count,
      approval_sla_hours: record.approval_sla_hours,
      stage_one_label: record.stage_one_label,
      stage_two_label: record.stage_two_label,
      default_duration_days: record.default_duration_days,
      max_duration_days: record.max_duration_days,
      requires_approval: record.requires_approval,
      role_ids: record.role_ids,
      team_ids: record.team_ids,
      checklist_text: buildChecklistText(record.checklist),
    });
  }, [policyForm]);

  const applyPolicyPackToForm = (packKey?: string) => {
    const selectedPack = (workspaceData?.policy_packs ?? []).find((item) => item.key === packKey);
    if (!selectedPack) return;
    const currentValues = policyForm.getFieldsValue();
    policyForm.setFieldsValue({
      pack_key: selectedPack.key,
      key: currentValues.key || selectedPack.key,
      name: currentValues.name || selectedPack.name,
      description: selectedPack.description,
      tone: selectedPack.tone as PolicyFormValues['tone'],
      risk_level: selectedPack.risk_level as PolicyFormValues['risk_level'],
      approval_stage_count: selectedPack.approval_stage_count,
      approval_sla_hours: selectedPack.approval_sla_hours,
      stage_one_label: selectedPack.stage_one_label,
      stage_two_label: selectedPack.stage_two_label,
      default_duration_days: selectedPack.default_duration_days,
      max_duration_days: selectedPack.max_duration_days,
      requires_approval: selectedPack.requires_approval,
      checklist_text: buildChecklistText(selectedPack.checklist),
    });
  };

  useEffect(() => {
    if (!selectedPolicy) return;
    if (!requestForm.getFieldValue('duration_days')) {
      requestForm.setFieldValue('duration_days', selectedPolicy.default_duration_days);
    }
    if (!selectedPolicy.requires_approval) {
      requestForm.setFieldValue('approver_user_id', undefined);
      requestForm.setFieldValue('stage_two_approver_user_id', undefined);
    }
    if (selectedPolicy.approval_stage_count <= 1) {
      requestForm.setFieldValue('stage_two_approver_user_id', undefined);
    }
  }, [requestForm, selectedPolicy]);

  useEffect(() => {
    const automationPolicy = workspaceQuery.data?.automation_policy;
    if (!automationPolicy) return;
    automationPolicyForm.setFieldsValue({
      enabled: automationPolicy.enabled,
      auto_revoke_expired: automationPolicy.auto_revoke_expired,
      reminder_offsets_text: automationPolicy.reminder_offsets_days.join(', '),
      renewal_window_days: automationPolicy.renewal_window_days,
      notify_target_user: automationPolicy.notify_target_user,
      notify_requested_by: automationPolicy.notify_requested_by,
      notify_approver: automationPolicy.notify_approver,
      approval_warning_window_hours: automationPolicy.approval_warning_window_hours,
      approval_escalation_delay_hours: automationPolicy.approval_escalation_delay_hours,
      notify_requester_for_sla: automationPolicy.notify_requester_for_sla,
      notify_active_approver_for_sla: automationPolicy.notify_active_approver_for_sla,
      notify_directory_owners_for_sla: automationPolicy.notify_directory_owners_for_sla,
      continuity_drill_enabled: automationPolicy.continuity_drill_enabled,
      continuity_drill_interval_days: automationPolicy.continuity_drill_interval_days,
      continuity_drill_warning_days: automationPolicy.continuity_drill_warning_days,
      notify_directory_owners_for_continuity: automationPolicy.notify_directory_owners_for_continuity,
      auto_prepare_playbooks: automationPolicy.auto_prepare_playbooks,
    });
  }, [automationPolicyForm, workspaceQuery.data]);

  const invalidateWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-access-exception-workspace'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-access-exception-activity'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-user-directory'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-user-directory-summary'] }),
    ]);
  };

  const exportPolicies = () => {
    if (!policies.length) {
      messageApi.warning('Chưa có chính sách phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      policies.map((policy) => ({
        'Khóa chính sách': policy.key,
        'Tên chính sách': policy.name,
        'Phòng ban': policy.department_label,
        'Mức rủi ro': policy.risk.label,
        'Trạng thái': policy.is_active ? 'Đang áp dụng' : 'Tạm dừng',
        'Hàng chờ duyệt': policy.pending_request_count,
        'Yêu cầu rủi ro cao': policy.high_risk_request_count,
        'Điểm debt': policy.debt_score,
        'SLA duyệt (giờ)': policy.approval_sla_hours,
      })),
      'access-exception-policies',
    );
  };

  const exportRequests = () => {
    if (!requests.length) {
      messageApi.warning('Chưa có yêu cầu ngoại lệ phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      requests.map((item) => ({
        'Mã yêu cầu': item.key,
        'Người nhận quyền': item.target_user.full_name || item.target_user.username,
        'Chính sách': item.policy.name,
        'Trạng thái': item.status_label,
        'Chặng duyệt hiện tại': item.current_stage_label,
        'Người duyệt hiện tại': item.active_approver?.full_name || item.active_approver?.username || '',
        'Điểm rủi ro': item.risk_score,
        'Ngày hết hạn dự kiến': formatDateTime(item.planned_expires_at),
      })),
      'access-exception-requests',
    );
  };

  const exportActivity = () => {
    if (!filteredActivity.length) {
      messageApi.warning('Chưa có hoạt động phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(
      filteredActivity.map((item) => ({
        'Thời điểm': formatDateTime(item.timestamp),
        'Loại đối tượng': item.kind,
        'Hành động': item.action,
        'Tóm tắt': item.summary,
        'Người thao tác': item.actor.full_name || item.actor.username || 'Hệ thống',
        'Mã đối tượng': item.entity_code,
      })),
      'access-exception-activity',
    );
  };

  const savePolicyMutation = useMutation({
    mutationFn: adminApi.saveAccessExceptionPolicy,
    onSuccess: async (response) => {
      messageApi.success(response.action === 'CREATE' ? 'Đã tạo chính sách ngoại lệ truy cập.' : 'Đã cập nhật chính sách ngoại lệ truy cập.');
      setPolicyDrawerOpen(false);
      setEditingPolicy(null);
      policyForm.resetFields();
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể lưu chính sách ngoại lệ truy cập.')),
  });
  const deletePolicyMutation = useMutation({
    mutationFn: adminApi.deleteAccessExceptionPolicy,
    onSuccess: async () => {
      messageApi.success('Đã xóa chính sách ngoại lệ truy cập.');
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể xóa chính sách ngoại lệ truy cập.')),
  });
  const saveRoutingRuleMutation = useMutation({
    mutationFn: adminApi.saveAccessExceptionRoutingRule,
    onSuccess: async (response) => {
      messageApi.success(response.action === 'CREATE' ? 'Đã tạo quy tắc định tuyến.' : 'Đã cập nhật quy tắc định tuyến.');
      setRoutingDrawerOpen(false);
      setEditingRoutingRule(null);
      routingForm.resetFields();
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể lưu quy tắc định tuyến.')),
  });
  const saveAvailabilityMutation = useMutation({
    mutationFn: adminApi.saveAccessExceptionApproverAvailability,
    onSuccess: async (response) => {
      messageApi.success(response.action === 'CREATE' ? 'Đã tạo coverage plan cho approver.' : 'Đã cập nhật coverage plan cho approver.');
      setAvailabilityDrawerOpen(false);
      setEditingAvailability(null);
      availabilityForm.resetFields();
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể lưu coverage plan cho approver.')),
  });
  const previewMutation = useMutation({
    mutationFn: adminApi.previewAccessException,
    onSuccess: (response) => {
      setPreviewData(response);
      messageApi.success('Bản xem trước ngoại lệ truy cập đã sẵn sàng.');
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể xem trước ngoại lệ truy cập.')),
  });
  const createRequestMutation = useMutation({
    mutationFn: adminApi.createAccessExceptionRequest,
    onSuccess: async (response) => {
      messageApi.success(response.request.lifecycle_state === 'pending' ? 'Đã gửi yêu cầu ngoại lệ.' : 'Đã cấp ngoại lệ truy cập ngay lập tức.');
      setPreviewData(null);
      requestForm.resetFields();
      requestForm.setFieldsValue(DEFAULT_REQUEST_VALUES);
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể tạo yêu cầu ngoại lệ truy cập.')),
  });
  const decideMutation = useMutation({
    mutationFn: adminApi.decideAccessExceptionRequest,
    onSuccess: async (response) => {
      if (response.action === 'UPDATE') {
        messageApi.success(`Đã đẩy yêu cầu sang ${response.request.current_stage_label || `chặng ${response.request.current_stage}`}.`);
      } else {
        messageApi.success(response.action === 'APPROVE' ? 'Đã phê duyệt ngoại lệ truy cập.' : 'Đã từ chối ngoại lệ truy cập.');
      }
      setDecisionState(null);
      decisionForm.resetFields();
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể xử lý yêu cầu.')),
  });
  const revokeMutation = useMutation({
    mutationFn: adminApi.revokeAccessExceptionRequest,
    onSuccess: async () => {
      messageApi.success('Đã thu hồi ngoại lệ truy cập.');
      setDecisionState(null);
      decisionForm.resetFields();
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể thu hồi ngoại lệ truy cập.')),
  });
  const rerouteMutation = useMutation({
    mutationFn: adminApi.rerouteAccessExceptionRequest,
    onSuccess: async () => {
      messageApi.success('Đã đổi tuyến người duyệt cho yêu cầu.');
      setRerouteState(null);
      rerouteForm.resetFields();
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể đổi tuyến yêu cầu.')),
  });
  const createRenewalMutation = useMutation({
    mutationFn: adminApi.createAccessExceptionRenewal,
    onSuccess: async (response) => {
      messageApi.success(response.request.lifecycle_state === 'pending' ? 'Đã tạo yêu cầu gia hạn.' : 'Đã gia hạn ngoại lệ ngay lập tức.');
      setRenewalState(null);
      renewalForm.resetFields();
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể tạo yêu cầu gia hạn.')),
  });
  const saveAutomationPolicyMutation = useMutation({
    mutationFn: adminApi.saveAccessExceptionAutomationPolicy,
    onSuccess: async () => {
      messageApi.success('Đã cập nhật chính sách tự động hóa.');
      setAutomationDrawerOpen(false);
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể lưu chính sách tự động hóa.')),
  });
  const previewAutomationMutation = useMutation({
    mutationFn: adminApi.previewAccessExceptionAutomation,
    onSuccess: (response) => {
      setAutomationPreviewData(response);
      messageApi.success('Bản xem trước tự động hóa đã sẵn sàng.');
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể xem trước tự động hóa.')),
  });
  const runAutomationMutation = useMutation({
    mutationFn: adminApi.runAccessExceptionAutomation,
    onSuccess: async (response) => {
      setAutomationPreviewData(response);
      messageApi.success(
        response.processed.continuity_drills_run > 0
          ? 'Tự động hóa đã chạy continuity drill.'
          : response.processed.requests_auto_revoked > 0
            ? 'Tự động hóa đã xử lý hàng chờ hết hạn.'
            : 'Tự động hóa đã chạy xong.',
      );
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể chạy tự động hóa.')),
  });
  const simulateAbsenceMutation = useMutation({
    mutationFn: adminApi.simulateAccessExceptionAbsence,
    onSuccess: (response) => {
      setSimulationData(response);
      messageApi.success('Mô phỏng vắng mặt đã sẵn sàng.');
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể chạy mô phỏng vắng mặt.')),
  });
  const saveSchedulerMutation = useMutation({
    mutationFn: adminApi.saveAccessExceptionSchedulerStatus,
    onSuccess: async () => {
      setSchedulerDraft(null);
      messageApi.success('Đã cập nhật bộ lập lịch tự động hóa.');
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể cập nhật bộ lập lịch tự động hóa.')),
  });
  const guidedRemediationMutation = useMutation({
    mutationFn: adminApi.applyAccessExceptionGuidedRemediation,
    onSuccess: async (response) => {
      messageApi.success(response.message || 'Đã áp dụng guided remediation.');
      await invalidateWorkspace();
    },
    onError: (error) => messageApi.error(getToastMessage(error, 'Không thể áp dụng guided remediation.')),
  });

  const policies = (workspaceQuery.data?.policies ?? []).filter((policy) => {
    const matchesSearch = !deferredPolicySearch || `${policy.name} ${policy.key} ${policy.description}`.toLowerCase().includes(deferredPolicySearch);
    if (!matchesSearch) return false;
    if (policyFilter === 'active') return policy.is_active;
    if (policyFilter === 'inactive') return !policy.is_active;
    if (policyFilter === 'findings') return policy.has_findings;
    if (policyFilter === 'critical') return policy.risk_level === 'critical';
    if (policyFilter === 'debt') return policy.debt_status !== 'healthy' || policy.debt_score >= 40;
    return true;
  });
  const automationSnapshot = automationPreviewData ?? workspaceQuery.data?.automation_preview ?? null;
  const requests = (workspaceQuery.data?.requests ?? []).filter((item) => {
    const matchesSearch = !deferredRequestSearch || [
      item.key,
      item.target_user.full_name,
      item.target_user.username,
      item.policy.name,
      item.current_stage_label,
      item.active_approver?.full_name,
      item.active_approver?.username,
      item.routing?.department_label,
    ].join(' ').toLowerCase().includes(deferredRequestSearch);
    if (!matchesSearch) return false;
    if (requestFilter === 'pending') return item.lifecycle_state === 'pending';
    if (requestFilter === 'active') return item.lifecycle_state === 'active';
    if (requestFilter === 'expiring') return item.lifecycle_state === 'expiring';
    if (requestFilter === 'expired') return item.lifecycle_state === 'expired';
    if (requestFilter === 'closed') return ['rejected', 'revoked', 'renewed'].includes(item.lifecycle_state);
    if (requestFilter === 'high-risk') return item.risk_score >= 60;
    return true;
  });
  const filteredActivity = (activityQuery.data?.items ?? []).filter((item) => {
    const matchesSearch = !deferredActivitySearch || [
      item.summary,
      item.actor.full_name,
      item.actor.username,
      item.kind,
      item.action,
      item.entity_code,
    ].join(' ').toLowerCase().includes(deferredActivitySearch);
    if (!matchesSearch) return false;
    if (activityFilter === 'approvals') return ['APPROVE', 'REJECT', 'CREATE', 'RENEW'].includes(item.action);
    if (activityFilter === 'routing') return ['REROUTE', 'SAVE_ROUTING_RULE', 'SAVE_AVAILABILITY'].includes(item.action) || item.kind === 'routing';
    if (activityFilter === 'automation') return ['RUN_AUTOMATION', 'SAVE_AUTOMATION_POLICY', 'SAVE_SCHEDULER_STATUS'].includes(item.action);
    if (activityFilter === 'revocations') return ['REVOKE', 'DELETE'].includes(item.action);
    return true;
  });
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (policySearch.trim()) tags.push(`Chính sách: ${policySearch.trim()}`);
    if (policyFilter !== 'all') tags.push(`Bộ lọc policy: ${policyFilter}`);
    if (requestSearch.trim()) tags.push(`Yêu cầu: ${requestSearch.trim()}`);
    if (requestFilter !== 'all') tags.push(`Bộ lọc request: ${requestFilter}`);
    if (activitySearch.trim()) tags.push(`Hoạt động: ${activitySearch.trim()}`);
    if (activityFilter !== 'all') tags.push(`Bộ lọc activity: ${activityFilter}`);
    if (selectedPreset) tags.push(`Mẫu đang dùng: ${selectedPreset.name}`);
    return tags;
  }, [activityFilter, activitySearch, policyFilter, policySearch, requestFilter, requestSearch, selectedPreset]);

  const buildCurrentSnapshot = (): AccessExceptionFilterSnapshot => ({
    policy_search: policySearch,
    policy_filter: policyFilter,
    request_search: requestSearch,
    request_filter: requestFilter,
    activity_search: activitySearch,
    activity_filter: activityFilter,
  });

  const applySnapshot = (snapshot: AccessExceptionFilterSnapshot) => {
    setPolicySearch(snapshot.policy_search);
    setPolicyFilter(snapshot.policy_filter);
    setRequestSearch(snapshot.request_search);
    setRequestFilter(snapshot.request_filter);
    setActivitySearch(snapshot.activity_search);
    setActivityFilter(snapshot.activity_filter);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem access exception.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem access exception.');
    }
  };

  const applySavedView = () => {
    const snapshot: AccessExceptionFilterSnapshot = {
      policy_search: typeof savedConfig?.policy_search === 'string' ? savedConfig.policy_search : '',
      policy_filter: savedConfig?.policy_filter === 'active'
        || savedConfig?.policy_filter === 'inactive'
        || savedConfig?.policy_filter === 'findings'
        || savedConfig?.policy_filter === 'critical'
        || savedConfig?.policy_filter === 'debt'
        ? savedConfig.policy_filter
        : 'all',
      request_search: typeof savedConfig?.request_search === 'string' ? savedConfig.request_search : '',
      request_filter: savedConfig?.request_filter === 'pending'
        || savedConfig?.request_filter === 'active'
        || savedConfig?.request_filter === 'expiring'
        || savedConfig?.request_filter === 'expired'
        || savedConfig?.request_filter === 'closed'
        || savedConfig?.request_filter === 'high-risk'
        ? savedConfig.request_filter
        : 'all',
      activity_search: typeof savedConfig?.activity_search === 'string' ? savedConfig.activity_search : '',
      activity_filter: savedConfig?.activity_filter === 'approvals'
        || savedConfig?.activity_filter === 'routing'
        || savedConfig?.activity_filter === 'automation'
        || savedConfig?.activity_filter === 'revocations'
        ? savedConfig.activity_filter
        : 'all',
    };
    applySnapshot(snapshot);
    messageApi.success('Đã khôi phục chế độ xem access exception đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: AccessExceptionNamedPreset = existing
      ? { ...existing, name, filters: currentSnapshot }
      : { id: `${Date.now()}`, name, filters: currentSnapshot };
    const nextPresets = existing
      ? namedPresets.map((item) => (item.id === existing.id ? nextPreset : item))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...savedConfig,
        ...currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedPresetId(nextPreset.id);
      setPresetName('');
      setIsPresetModalOpen(false);
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc access exception.' : 'Đã lưu mẫu lọc access exception mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc access exception.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc access exception.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc access exception để xóa.');
      return;
    }
    const nextPresets = namedPresets.filter((item) => item.id !== preset.id);
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: nextPresets,
      });
      setSelectedPresetId('NONE');
      messageApi.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc access exception.');
    }
  };
  const policyDebtRows = [...(workspaceQuery.data?.policies ?? [])]
    .filter((item) => item.debt_status !== 'healthy' || item.debt_score > 0 || item.high_risk_request_count > 0)
    .sort((left, right) => (
      right.debt_score - left.debt_score
      || right.risk_score - left.risk_score
      || right.high_risk_request_count - left.high_risk_request_count
      || right.pending_request_count - left.pending_request_count
    ));
  const requestRiskQueue = [...(workspaceQuery.data?.requests ?? [])]
    .filter((item) => item.risk_score >= 35)
    .sort((left, right) => (
      right.risk_score - left.risk_score
      || Number(right.is_stage_overdue) - Number(left.is_stage_overdue)
      || Number(right.access_still_present) - Number(left.access_still_present)
    ));

  const policyOptions = (workspaceQuery.data?.policies ?? []).filter((item) => item.is_active).map((item) => ({
    value: item.key,
    label: `${item.name} (${item.risk.label})`,
  }));
  const policyPackOptions = (workspaceQuery.data?.policy_packs ?? []).map((item) => ({
    value: item.key,
    label: `${item.name} · ${item.approval_stage_count} stage`,
  }));
  const selectedPolicyPack = (workspaceQuery.data?.policy_packs ?? []).find((item) => item.key === selectedPolicyPackKey) ?? null;
  const userOptions = (userSearchQuery.data ?? []).map((user) => ({
    value: user.id,
    label: `${user.first_name || user.last_name ? `${user.first_name} ${user.last_name}`.trim() : user.username} (${user.username})`,
  }));
  const approverOptions = (workspaceQuery.data?.approver_candidates ?? []).map((user) => ({
    value: user.id,
    label: `${user.full_name} (${user.username})${user.is_out_of_office ? ' · OOO' : ''}`,
  }));
  const roleOptions = (workspaceQuery.data?.roles ?? []).map((role) => ({
    value: role.id,
    label: `${role.name || role.code} (${role.code})`,
  }));
  const teamOptions = (workspaceQuery.data?.teams ?? []).map((team) => ({
    value: team.id,
    label: `${team.name || team.code} (${team.code})`,
  }));
  const routingRules = workspaceQuery.data?.routing_rules ?? [];
  const routingCoverage = workspaceQuery.data?.routing_coverage ?? [];
  const routingCoverageSummary = workspaceQuery.data?.routing_coverage_summary;
  const approverCapacity = workspaceQuery.data?.approver_capacity ?? [];
  const approverCapacitySummary = workspaceQuery.data?.approver_capacity_summary;
  const approverAvailability = workspaceQuery.data?.approver_availability ?? [];
  const approverAvailabilitySummary = workspaceQuery.data?.approver_availability_summary;
  const workloadRecommendations = workspaceQuery.data?.workload_recommendations ?? [];
  const slaRadar = workspaceQuery.data?.sla_radar;
  const continuityRunbook = workspaceQuery.data?.continuity_runbook ?? [];
  const continuitySummary = workspaceQuery.data?.continuity_summary;
  const continuityAnalytics = workspaceQuery.data?.continuity_analytics ?? [];
  const continuityAnalyticsSummary = workspaceQuery.data?.continuity_analytics_summary;
  const guidedRemediation = workspaceQuery.data?.guided_remediation ?? [];
  const guidedRemediationSummary = workspaceQuery.data?.guided_remediation_summary;
  const continuityDrillPreview = (automationSnapshot?.continuity_drill_candidates?.length || automationSnapshot?.summary?.continuity_drills_due)
    ? {
      generated_at: automationSnapshot?.generated_at ?? workspaceQuery.data?.continuity_drill_preview?.generated_at,
      summary: {
        drills_due: automationSnapshot?.summary?.continuity_drills_due ?? 0,
        drills_overdue: (automationSnapshot?.continuity_drill_candidates ?? []).filter((item) => item.status === 'overdue').length,
        playbooks_prepared: automationSnapshot?.summary?.playbooks_prepared ?? 0,
      },
      items: automationSnapshot?.continuity_drill_candidates ?? [],
    }
    : workspaceQuery.data?.continuity_drill_preview;
  const automationApprovalPulse = [
    ...(automationSnapshot?.sla_escalation_candidates ?? []),
    ...(automationSnapshot?.sla_warning_candidates ?? []),
  ].slice(0, 8);
  const simulationImpactedRequests = simulationData?.impacted_requests ?? [];
  const simulationPlaybooks = simulationData?.playbooks ?? [];
  const routingStageOneModeOptions = [
    { value: 'directory_then_team', label: 'Directory -> team' },
    { value: 'team_then_directory', label: 'Team -> directory' },
    { value: 'directory_only', label: 'Directory only' },
    { value: 'team_match', label: 'Team match' },
    { value: 'governance_pool', label: 'Governance pool' },
  ];
  const routingStageTwoModeOptions = [
    { value: 'directory_then_independent', label: 'Directory -> independent team' },
    { value: 'independent_team_then_directory', label: 'Independent team -> directory' },
    { value: 'directory_only', label: 'Directory only' },
    { value: 'independent_team_match', label: 'Independent team match' },
    { value: 'governance_pool', label: 'Governance pool' },
    { value: '', label: 'Not used' },
  ];
  const departmentOptions = routingRules.map((item) => ({
    value: item.department_key,
    label: item.department_label,
  }));
  const routingRuleMap = new Map(routingRules.map((item) => [item.department_key, item]));

  const focusRequest = (requestKey: string, preferredFilter: RequestFilter = 'all') => {
    setRequestFilter(preferredFilter);
    setRequestSearch(requestKey);
  };

  const handleApplyGuidedRemediation = (item: AccessExceptionGuidedRemediationItem) => {
    guidedRemediationMutation.mutate({
      action_type: item.action_type as 'policy_enable_approval' | 'policy_upgrade_stage_two' | 'request_revoke' | 'request_reroute',
      policy_key: item.policy_key || undefined,
      request_key: item.request_key || undefined,
      note: item.suggested_note || undefined,
    });
  };

  const openRoutingRuleEditor = (rule?: AccessExceptionRoutingRule | null, seed?: Partial<RoutingRuleFormValues>) => {
    setEditingRoutingRule(rule ?? null);
    setRoutingDrawerOpen(true);
    if (rule) {
      routingForm.setFieldsValue({
        department_key: rule.department_key,
        department_label: rule.department_label,
        is_active: rule.is_active,
        stage_one_mode: rule.stage_one_mode,
        stage_two_mode: rule.stage_two_mode,
        stage_one_primary_user_id: rule.stage_one_primary_user_id || undefined,
        stage_one_delegate_user_id: rule.stage_one_delegate_user_id || undefined,
        stage_one_rotation_user_ids: rule.stage_one_rotation_user_ids,
        stage_two_primary_user_id: rule.stage_two_primary_user_id || undefined,
        stage_two_delegate_user_id: rule.stage_two_delegate_user_id || undefined,
        stage_two_rotation_user_ids: rule.stage_two_rotation_user_ids,
        fallback_team_tokens_text: buildTokenText(rule.fallback_team_tokens),
        notes: rule.notes,
        ...seed,
      });
      return;
    }
    routingForm.resetFields();
    routingForm.setFieldsValue({
      ...DEFAULT_ROUTING_RULE_VALUES,
      ...seed,
    });
  };

  const openAvailabilityEditor = (row?: AccessExceptionApproverAvailabilityRow | null) => {
    setEditingAvailability(row ?? null);
    setAvailabilityDrawerOpen(true);
    if (row) {
      availabilityForm.setFieldsValue({
        user_id: row.user_id,
        is_out_of_office: row.is_out_of_office,
        starts_at: formatDateTimeLocal(row.starts_at),
        ends_at: formatDateTimeLocal(row.ends_at),
        backup_user_id: row.backup_user_id || undefined,
        label: row.label,
        notes: row.notes,
      });
      return;
    }
    availabilityForm.resetFields();
    availabilityForm.setFieldsValue(DEFAULT_AVAILABILITY_VALUES);
  };

  const openRerouteDialog = (payload: RerouteDialogState) => {
    setRerouteState(payload);
    rerouteForm.resetFields();
    rerouteForm.setFieldsValue({
      approver_user_id: payload.suggestedApproverId,
      note: payload.suggestedCoverageNote || '',
    });
  };

  const openWorkloadRecommendation = (recommendation: AccessExceptionWorkloadRecommendation) => {
    const existingRule = routingRuleMap.get(recommendation.department_key) ?? null;
    const seed: Partial<RoutingRuleFormValues> = {
      department_key: recommendation.department_key,
      department_label: recommendation.department_label,
    };
    if (recommendation.kind === 'assign-stage1-owner' && recommendation.recommended_primary_approver?.id) {
      seed.stage_one_primary_user_id = recommendation.recommended_primary_approver.id;
    }
    if (recommendation.kind === 'assign-stage2-owner' && recommendation.recommended_primary_approver?.id) {
      seed.stage_two_primary_user_id = recommendation.recommended_primary_approver.id;
    }
    if (recommendation.recommended_delegate_approver?.id) {
      if (recommendation.stage > 1) {
        seed.stage_two_delegate_user_id = recommendation.recommended_delegate_approver.id;
      } else {
        seed.stage_one_delegate_user_id = recommendation.recommended_delegate_approver.id;
      }
    }
    openRoutingRuleEditor(existingRule, seed);
  };

  const policyColumns: ColumnsType<AccessExceptionPolicy> = [
    {
      title: 'Chính sách',
      key: 'policy',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Text strong>{record.name}</Text>
            <Tag color={toneColor(record.tone)}>{record.key}</Tag>
            <Tag color={riskColor(record.risk_level)}>{record.risk.label}</Tag>
            <Tag color={policyDebtColor(record.debt_status)}>{record.debt_label}</Tag>
            {record.pack_key ? <Tag color="geekblue">{record.pack_key}</Tag> : null}
            {!record.is_active ? <Tag>Tạm dừng</Tag> : null}
          </Space>
          <Text type="secondary">{record.description || 'Khong co mo ta.'}</Text>
          <Text type="secondary">
            {record.approval_stage_count} stage | SLA {record.approval_sla_hours}h | risk {record.risk_score}/100 | debt {record.debt_score}/100
          </Text>
          <Text type="secondary">
            {record.pending_request_count} pending | {record.active_request_count} active | {record.high_risk_request_count} high-risk | {record.expired_access_request_count} expired-with-access
          </Text>
        </Space>
      ),
    },
    {
      title: 'Độ phủ',
      key: 'coverage',
      width: 260,
      render: (_, record) => (
        <Space direction="vertical" size={6}>
          {renderCompactTags(record.roles, 'Không có vai trò')}
          {renderCompactTags(record.teams, 'Không có nhóm')}
        </Space>
      ),
    },
    {
      title: 'Tín hiệu',
      key: 'signals',
      width: 300,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Space size={6} wrap>
            <Tag color={policyDebtColor(record.debt_status)}>{`${record.debt_score} debt`}</Tag>
            <Tag color={riskColor(record.risk_level)}>{`${record.risk_score} risk`}</Tag>
            {record.overdue_request_count ? <Tag color="volcano">{`${record.overdue_request_count} overdue`}</Tag> : null}
            {record.stale_pending_request_count ? <Tag color="gold">{`${record.stale_pending_request_count} stale`}</Tag> : null}
          </Space>
          <Text type="secondary">
            Self-approval {record.self_approval_request_count} | OOO queue {record.out_of_office_request_count} | unticketed {record.unticketed_request_count}
          </Text>
          <Text type="secondary">{record.debt_reasons[0] || record.warnings[0] || 'Governance debt dang o muc kiem soat.'}</Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 130,
      render: (_, record) => (
        <Space>
          <Button
            icon={<EditOutlined />}
            onClick={() => openPolicyEditor(record)}
          />
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={deletePolicyMutation.isPending}
            onClick={() => {
              void Modal.confirm({
                title: 'Xoa access exception policy?',
                content: `Policy ${record.name} se bi go khoi thu vien governance.`,
                okText: 'Xoa policy',
                okButtonProps: { danger: true },
                onOk: () => deletePolicyMutation.mutateAsync(record.key),
              });
            }}
          />
        </Space>
      ),
    },
  ];

  const requestColumns: ColumnsType<AccessExceptionRequest> = [
    {
      title: 'Đối tượng',
      key: 'target',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{record.target_user.full_name || record.target_user.username}</Text>
          <Text type="secondary">{record.target_user.username} | {record.policy.name}</Text>
          <Space size={6} wrap>
            <Tag>{record.request_kind_label}</Tag>
            <Tag color={stateColor(record.lifecycle_state)}>{record.status_label}</Tag>
            <Tag color={riskColor(record.policy.risk_level)}>{record.policy.risk_level}</Tag>
            <Tag color={requestRiskColor(record.risk_band)}>{`${record.risk_label} ${record.risk_score}`}</Tag>
            {record.requires_approval ? <Tag color={record.is_stage_overdue ? 'volcano' : 'blue'}>{`Chặng ${record.current_stage}/${record.total_stages}`}</Tag> : null}
            {record.routing?.department_label ? <Tag color="geekblue">{record.routing.department_label}</Tag> : null}
            {record.active_approver?.is_out_of_office ? <Tag color="volcano">Người duyệt đang vắng mặt</Tag> : null}
            {record.routing?.auto_selected_stage_one ? <Tag color="cyan">Tự chọn chặng 1</Tag> : null}
            {record.routing?.auto_selected_stage_two ? <Tag color="purple">Tự chọn chặng 2</Tag> : null}
            {record.current_stage === 1 && record.routing?.stage_one_resolution_label ? <Tag color="magenta">{record.routing.stage_one_resolution_label}</Tag> : null}
            {record.current_stage > 1 && record.routing?.stage_two_resolution_label ? <Tag color="magenta">{record.routing.stage_two_resolution_label}</Tag> : null}
            {record.has_open_renewal ? <Tag color="cyan">Renewal in flight</Tag> : null}
          </Space>
          {record.requires_approval ? (
            <Space direction="vertical" size={0}>
              <Text type="secondary">
                {record.current_stage_label}
                {record.active_approver ? ` | ${record.active_approver.full_name || record.active_approver.username}` : ''}
              </Text>
              {record.routing?.summary ? (
                <Text type="secondary">
                  {record.routing.summary}
                  {record.routing.stage_one_source_label ? ` | ${record.routing.stage_one_source_label}` : ''}
                  {record.total_stages > 1 && record.routing.stage_two_source_label ? ` | ${record.routing.stage_two_source_label}` : ''}
                  {record.routing.target_team_codes.length ? ` | Nhóm ${record.routing.target_team_codes.join(', ')}` : ''}
                </Text>
              ) : null}
              {record.current_stage === 1 && record.routing?.stage_one_coverage_note ? (
                <Text type="secondary">{record.routing.stage_one_coverage_note}</Text>
              ) : null}
              {record.current_stage > 1 && record.routing?.stage_two_coverage_note ? (
                <Text type="secondary">{record.routing.stage_two_coverage_note}</Text>
              ) : null}
              {record.continuity?.reroute_count ? (
                <Text type="secondary">
                  Đã đổi tuyến {record.continuity.reroute_count} lần
                  {record.continuity.last_rerouted_at ? ` | Lần gần nhất ${formatDateTime(record.continuity.last_rerouted_at)}` : ''}
                </Text>
              ) : null}
              {record.risk_reasons.length ? (
                <Text type="secondary">{record.risk_reasons[0]}</Text>
              ) : null}
            </Space>
          ) : null}
        </Space>
      ),
    },
    {
      title: 'Hiệu lực',
      key: 'window',
      width: 210,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text>{record.duration_days} ngày</Text>
          <Text type="secondary">Gửi lúc {formatDateTime(record.requested_at)}</Text>
          <Text type="secondary">Hết hạn {formatDateTime(record.planned_expires_at)}</Text>
          {record.lifecycle_state === 'pending' ? (
            <Text type={record.is_stage_overdue ? 'danger' : 'secondary'}>
              SLA chặng {formatDateTime(record.approval_stage_due_at)}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: 'Rủi ro',
      key: 'risk',
      width: 240,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Space size={6} wrap>
            <Tag color={requestRiskColor(record.risk_band)}>{record.risk_label}</Tag>
            {record.has_self_approval ? <Tag color="volcano">Thiếu kiểm soát 4 mắt</Tag> : null}
            {record.access_still_present && record.lifecycle_state === 'expired' ? <Tag color="volcano">Quyền hết hạn nhưng vẫn còn hiệu lực</Tag> : null}
          </Space>
          <Text strong>{`Rủi ro ${record.risk_score}/100`}</Text>
          <Text type="secondary">{record.risk_reasons[0] || 'Risk dang o muc thap.'}</Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 220,
      render: (_, record) => (
        <Space wrap>
          {record.can_approve ? (
            <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => setDecisionState({ mode: 'approve', request: record })}>
              {record.total_stages > record.current_stage ? 'Chuyển chặng kế tiếp' : 'Phê duyệt'}
            </Button>
          ) : null}
          {record.can_reject ? (
            <Button size="small" danger icon={<StopOutlined />} onClick={() => setDecisionState({ mode: 'reject', request: record })}>
              Từ chối
            </Button>
          ) : null}
          {record.can_revoke ? (
            <Button size="small" onClick={() => setDecisionState({ mode: 'revoke', request: record })}>
              Thu hồi
            </Button>
          ) : null}
          {record.can_renew ? (
            <Button
              size="small"
              icon={<SyncOutlined />}
              onClick={() => {
                setRenewalState(record);
                renewalForm.setFieldsValue({
                  approver_user_id: record.routing?.auto_selected_stage_one ? undefined : record.approver?.id,
                  stage_two_approver_user_id: record.routing?.auto_selected_stage_two ? undefined : record.stage_two_approver?.id,
                  duration_days: record.duration_days,
                  justification: `Need to extend ${record.policy.name} for ${record.target_user.full_name || record.target_user.username}.`,
                  ticket_ref: record.ticket_ref || '',
                });
              }}
            >
              Gia hạn
            </Button>
          ) : null}
          {record.can_reroute ? (
            <Button
              size="small"
              onClick={() => openRerouteDialog({
                requestKey: record.key,
                requestLabel: `${record.target_user.full_name || record.target_user.username} · ${record.policy.name}`,
                stageLabel: record.current_stage_label,
                currentApproverLabel: record.active_approver?.full_name || record.active_approver?.username || 'Chua gan',
                suggestedCoverageNote: record.current_stage > 1 ? record.routing.stage_two_coverage_note : record.routing.stage_one_coverage_note,
              })}
            >
              Đổi tuyến
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const policyDebtColumns: ColumnsType<AccessExceptionPolicy> = [
    {
      title: 'Chính sách',
      key: 'policy',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Text strong>{record.name}</Text>
            <Tag color={policyDebtColor(record.debt_status)}>{record.debt_label}</Tag>
            <Tag color={riskColor(record.risk_level)}>{record.department_label}</Tag>
          </Space>
          <Text type="secondary">{record.debt_reasons[0] || record.warnings[0] || 'Nợ kiểm soát hiện vẫn trong ngưỡng theo dõi.'}</Text>
        </Space>
      ),
    },
    {
      title: 'Nhịp nợ kiểm soát',
      key: 'pulse',
      width: 280,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text strong>{`Nợ kiểm soát ${record.debt_score}/100 | Rủi ro ${record.risk_score}/100`}</Text>
          <Text type="secondary">
            Rủi ro cao {record.high_risk_request_count} | quá hạn {record.overdue_request_count} | hết hạn nhưng còn quyền {record.expired_access_request_count}
          </Text>
          <Text type="secondary">
            Tự duyệt {record.self_approval_request_count} | hàng chờ khi vắng mặt {record.out_of_office_request_count}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openPolicyEditor(record)}>
          Rà soát
        </Button>
      ),
    },
  ];

  const requestRiskColumns: ColumnsType<AccessExceptionRequest> = [
    {
      title: 'Yêu cầu',
      key: 'request',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Text strong>{record.target_user.full_name || record.target_user.username}</Text>
            <Tag color={requestRiskColor(record.risk_band)}>{record.risk_label}</Tag>
            <Tag>{record.request_kind_label}</Tag>
          </Space>
          <Text type="secondary">{record.policy.name} | {record.current_stage_label}</Text>
          <Text type="secondary">{record.risk_reasons[0] || 'Rủi ro hiện ở mức thấp.'}</Text>
        </Space>
      ),
    },
    {
      title: 'Áp lực xử lý',
      key: 'pressure',
      width: 280,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text strong>{`Rủi ro ${record.risk_score}/100`}</Text>
          <Text type="secondary">{record.status_label} | hết hạn {formatDateTime(record.planned_expires_at)}</Text>
          <Space size={6} wrap>
            {record.is_stage_overdue ? <Tag color="volcano">Vỡ SLA</Tag> : null}
            {record.has_self_approval ? <Tag color="volcano">Thiếu kiểm soát 4 mắt</Tag> : null}
            {record.active_approver?.is_out_of_office ? <Tag color="gold">Người duyệt vắng mặt</Tag> : null}
            {record.access_still_present && record.lifecycle_state === 'expired' ? <Tag color="volcano">Quyền hết hạn nhưng còn hiệu lực</Tag> : null}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Button size="small" onClick={() => focusRequest(record.key, 'high-risk')}>
          Tập trung
        </Button>
      ),
    },
  ];

  const routingRuleColumns: ColumnsType<AccessExceptionRoutingRule> = [
    {
      title: 'Phòng ban',
      key: 'department',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Text strong>{record.department_label}</Text>
            <Tag color={record.is_active ? 'green' : 'default'}>{record.department_key}</Tag>
            {!record.is_active ? <Tag>Tạm dừng</Tag> : null}
          </Space>
          <Text type="secondary">{record.pack_keys.join(', ') || 'Khong co pack gan'}</Text>
          <Text type="secondary">{record.notes || 'Chua co ghi chu routing.'}</Text>
        </Space>
      ),
    },
    {
      title: 'Stage owners',
      key: 'owners',
      width: 360,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text type="secondary">
            Stage 1: {record.stage_one_primary_approver?.full_name || record.stage_one_primary_approver?.username || 'Chua gan owner'}
            {record.stage_one_delegate_approver ? ` | Delegate ${record.stage_one_delegate_approver.full_name || record.stage_one_delegate_approver.username}` : ''}
          </Text>
          {record.stage_one_rotation_approvers.length ? (
            <Text type="secondary">
              S1 rotation: {record.stage_one_rotation_approvers.map((item) => item.full_name || item.username).join(', ')}
            </Text>
          ) : null}
          <Text type="secondary">
            Stage 2: {record.stage_two_primary_approver?.full_name || record.stage_two_primary_approver?.username || 'Chua gan owner'}
            {record.stage_two_delegate_approver ? ` | Delegate ${record.stage_two_delegate_approver.full_name || record.stage_two_delegate_approver.username}` : ''}
          </Text>
          {record.stage_two_rotation_approvers.length ? (
            <Text type="secondary">
              S2 rotation: {record.stage_two_rotation_approvers.map((item) => item.full_name || item.username).join(', ')}
            </Text>
          ) : null}
          <Space size={6} wrap>
            {record.configured_stage_one ? <Tag color="cyan">Stage 1 ready</Tag> : <Tag color="gold">Stage 1 fallback</Tag>}
            {record.stage_two_mode ? (record.configured_stage_two ? <Tag color="purple">Stage 2 ready</Tag> : <Tag color="gold">Stage 2 fallback</Tag>) : <Tag>Single-stage</Tag>}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Routing modes',
      key: 'modes',
      width: 240,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text type="secondary">S1 {record.stage_one_mode}</Text>
          <Text type="secondary">S2 {record.stage_two_mode || 'not-used'}</Text>
          <Text type="secondary">Tokens {record.fallback_team_tokens.join(', ') || 'none'}</Text>
        </Space>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Button
          icon={<EditOutlined />}
          onClick={() => openRoutingRuleEditor(record)}
        />
      ),
    },
  ];

  const coverageColumns: ColumnsType<AccessExceptionRoutingCoverageRow> = [
    {
      title: 'Phòng ban',
      key: 'department',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Text strong>{record.department_label}</Text>
            <Tag color={coverageStatusColor(record.status)}>{record.status}</Tag>
            <Tag>{record.department_key}</Tag>
          </Space>
          <Text type="secondary">
            {record.active_policy_count} active policy | {record.pending_request_count} pending queue
          </Text>
          <Text type="secondary">{record.pack_keys.join(', ') || 'Khong co policy pack gan.'}</Text>
        </Space>
      ),
    },
    {
      title: 'Độ phủ',
      key: 'coverage',
      width: 270,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Space size={6} wrap>
            {record.stage_one_ready ? <Tag color="cyan">Stage 1 ready</Tag> : <Tag color="gold">Stage 1 gap</Tag>}
            {record.stage_two_ready ? <Tag color="purple">Stage 2 ready</Tag> : <Tag color="gold">Stage 2 gap</Tag>}
            {!record.routing_rule_active ? <Tag>Paused</Tag> : null}
          </Space>
          <Text type="secondary">Fallback pending {record.fallback_request_count}</Text>
          <Text type="secondary">
            Gần chạm SLA {record.near_sla_request_count} | Quá hạn {record.overdue_request_count}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Alerts',
      key: 'alerts',
      width: 320,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          {record.warnings.length ? (
            record.warnings.slice(0, 3).map((warning) => (
              <Text key={`${record.department_key}-${warning}`} type="secondary">{warning}</Text>
            ))
          ) : (
            <Text type="secondary">Coverage dang on dinh.</Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Button
          icon={<EditOutlined />}
          onClick={() => openRoutingRuleEditor(
            routingRuleMap.get(record.department_key) ?? null,
            {
              department_key: record.department_key,
              department_label: record.department_label,
            },
          )}
        >
          Mở định tuyến
        </Button>
      ),
    },
  ];

  const slaRadarColumns: ColumnsType<AccessExceptionSlaRadarItem> = [
    {
      title: 'Yêu cầu',
      key: 'request',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Text strong>{record.target_user.full_name || record.target_user.username}</Text>
            <Tag color={severityColor(record.severity)}>{record.status}</Tag>
            <Tag>{record.request_key}</Tag>
          </Space>
          <Text type="secondary">{record.policy.name} | {record.stage_label}</Text>
          <Text type="secondary">
            {record.department_label}
            {record.active_approver ? ` | ${record.active_approver.full_name || record.active_approver.username}` : ''}
          </Text>
        </Space>
      ),
    },
    {
      title: 'SLA',
      key: 'sla',
      width: 260,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text>{formatDateTime(record.approval_stage_due_at)}</Text>
          <Text type={record.status === 'overdue' ? 'danger' : 'secondary'}>
            {record.status === 'overdue' ? `Quá hạn ${record.hours_overdue}h` : `Còn ${record.hours_to_due}h`}
          </Text>
          <Space size={6} wrap>
            {record.warning_due ? <Tag color="gold">Cần nhắc</Tag> : null}
            {record.escalation_due ? <Tag color="volcano">Cần leo thang</Tag> : null}
            {record.warning_sent ? <Tag color="blue">Đã nhắc</Tag> : null}
            {record.escalation_sent ? <Tag color="red">Đã leo thang</Tag> : null}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Định tuyến',
      key: 'routing',
      width: 230,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text type="secondary">{record.routing_source_label}</Text>
          <Text type="secondary">
            Chặng {record.current_stage}/{record.total_stages}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Button
          onClick={() => {
            focusRequest(record.request_key, 'pending');
          }}
        >
          Tập trung
        </Button>
      ),
    },
  ];

  const capacityColumns: ColumnsType<AccessExceptionApproverCapacityRow> = [
    {
      title: 'Người duyệt',
      key: 'approver',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Text strong>{record.approver?.full_name || record.approver?.username || 'Chưa xác định người duyệt'}</Text>
            <Tag color={capacityStatusColor(record.status)}>{record.status}</Tag>
            {record.is_staff ? <Tag color="geekblue">Nhân sự nội bộ</Tag> : null}
            {record.is_out_of_office ? <Tag color="volcano">Vắng mặt</Tag> : null}
          </Space>
          <Text type="secondary">
            {record.approver?.username}
            {record.active_session_count ? ` | ${record.active_session_count} phiên hoạt động` : ''}
          </Text>
          {record.is_out_of_office ? (
            <Text type="secondary">{record.availability_label || 'Vắng mặt'}{record.availability_window ? ` | ${record.availability_window}` : ''}</Text>
          ) : null}
          <Text type="secondary">
            {record.primary_department_count} phòng ban chính | {record.delegate_department_count} phòng ban dự phòng
          </Text>
        </Space>
      ),
    },
    {
      title: 'Tải hàng chờ',
      key: 'load',
      width: 250,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text type="secondary">
            Chờ duyệt {record.pending_request_count} | Gần SLA {record.near_sla_request_count} | Quá hạn {record.overdue_request_count}
          </Text>
          <Text type="secondary">
            Chặng 1 {record.stage_one_queue_count} | Chặng 2 {record.stage_two_queue_count}
          </Text>
          <Space size={6} wrap>
            <Tag color={capacityStatusColor(record.status)}>Điểm {record.load_score}</Tag>
            {record.single_threaded_departments.length ? <Tag color="gold">{record.single_threaded_departments.length} điểm nghẽn đơn tuyến</Tag> : null}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Độ phủ',
      key: 'coverage',
      width: 320,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text type="secondary">
            Chính: {[...record.stage_one_primary_departments, ...record.stage_two_primary_departments].slice(0, 3).join(', ') || 'Chưa có'}
          </Text>
          <Text type="secondary">
            Khoảng trống dự phòng: {record.single_threaded_departments.slice(0, 2).join(', ') || 'Không có khoảng trống lớn'}
          </Text>
          {record.warnings.length ? (
            <Text type="secondary">{record.warnings[0]}</Text>
          ) : (
            <Text type="secondary">Capacity dang o muc on dinh.</Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 130,
      render: (_, record) => (
        <Button
          onClick={() => {
            setRequestFilter('pending');
            setRequestSearch(record.approver?.username || record.approver?.full_name || '');
          }}
        >
          Tập trung hàng chờ
        </Button>
      ),
    },
  ];

  const availabilityColumns: ColumnsType<AccessExceptionApproverAvailabilityRow> = [
    {
      title: 'Người duyệt',
      key: 'approver',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Text strong>{record.approver?.full_name || record.approver?.username || `User ${record.user_id}`}</Text>
            <Tag color={availabilityStatusColor(record.coverage_status)}>{record.coverage_status_label}</Tag>
            {record.is_currently_out_of_office ? <Tag color="volcano">Đang vắng mặt</Tag> : <Tag color="blue">Sẵn sàng</Tag>}
          </Space>
          <Text type="secondary">
            {record.label || 'No label'}
            {record.window_label ? ` | ${record.window_label}` : ''}
          </Text>
          <Text type="secondary">
            Primary {record.primary_departments.slice(0, 2).join(', ') || 'none'} | Rotation {record.rotation_departments.slice(0, 2).join(', ') || 'none'}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Độ phủ',
      key: 'coverage',
      width: 320,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text type="secondary">
            Dự phòng: {record.backup_approver?.full_name || record.backup_approver?.username || 'Chưa gán dự phòng'}
          </Text>
          <Text type="secondary">
            Yêu cầu bị ảnh hưởng {record.impacted_request_count}
          </Text>
          <Text type="secondary">{record.notes || 'Khong co ghi chu coverage.'}</Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 130,
      render: (_, record) => (
        <Button onClick={() => openAvailabilityEditor(record)}>
          Điều phối độ phủ
        </Button>
      ),
    },
  ];

  const continuityColumns: ColumnsType<AccessExceptionContinuityRunbookRow> = [
    {
      title: 'Yêu cầu',
      key: 'request',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Text strong>{record.target_user.full_name || record.target_user.username}</Text>
            <Tag color={availabilityStatusColor(record.status === 'ready-to-reroute' ? 'covered' : 'critical')}>{record.status_label}</Tag>
            <Tag>{record.request_key}</Tag>
          </Space>
          <Text type="secondary">{record.policy.name} | {record.stage_label}</Text>
          <Text type="secondary">{record.department_label} | {record.current_stage}/{record.total_stages} chặng</Text>
        </Space>
      ),
    },
    {
      title: 'Liên tục vận hành',
      key: 'continuity',
      width: 320,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text type="secondary">
            Hiện tại: {record.active_approver?.full_name || record.active_approver?.username || 'Chưa gán'}
          </Text>
          <Text type="secondary">{record.continuity_note}</Text>
          {record.last_rerouted_at ? <Text type="secondary">Đổi tuyến gần nhất {formatDateTime(record.last_rerouted_at)}</Text> : null}
        </Space>
      ),
    },
    {
      title: 'Đề xuất',
      key: 'suggestion',
      width: 280,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text type="secondary">
            {record.suggested_approver?.full_name || record.suggested_approver?.username || 'Chưa có đề xuất'}
          </Text>
          <Text type="secondary">
            {record.suggested_resolution_label || 'Chưa có đường điều phối liên tục'}
            {record.suggested_source_label ? ` | ${record.suggested_source_label}` : ''}
          </Text>
          {record.suggested_coverage_note ? <Text type="secondary">{record.suggested_coverage_note}</Text> : null}
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 180,
      render: (_, record) => (
        <Space wrap>
          {record.status === 'ready-to-reroute' ? (
            <Button
              size="small"
              type="primary"
              loading={rerouteMutation.isPending}
              onClick={() => rerouteMutation.mutate({
                request_key: record.request_key,
                note: record.suggested_coverage_note || record.continuity_note || undefined,
              })}
            >
              Tự đổi tuyến
            </Button>
          ) : null}
          <Button
            size="small"
            onClick={() => openRerouteDialog({
              requestKey: record.request_key,
              requestLabel: `${record.target_user.full_name || record.target_user.username} · ${record.policy.name}`,
              stageLabel: record.stage_label,
              currentApproverLabel: record.active_approver?.full_name || record.active_approver?.username || 'Chua gan',
              suggestedApproverId: record.suggested_approver?.id,
              suggestedApproverLabel: record.suggested_approver?.full_name || record.suggested_approver?.username,
              suggestedSourceLabel: record.suggested_source_label,
              suggestedResolutionLabel: record.suggested_resolution_label,
              suggestedCoverageNote: record.suggested_coverage_note,
            })}
          >
            Đổi tuyến tay
          </Button>
        </Space>
      ),
    },
  ];

  const continuityAnalyticsColumns: ColumnsType<AccessExceptionContinuityAnalyticsRow> = [
    {
      title: 'Phòng ban',
      key: 'department',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Text strong>{record.department_label}</Text>
            <Tag color={drillStatusColor(record.drill_status)}>{record.drill_status_label}</Tag>
            <Tag>{record.department_key}</Tag>
          </Space>
          <Text type="secondary">
            Mức sẵn sàng {record.preparedness_score} | Chờ duyệt {record.pending_request_count} | Bị ảnh hưởng {record.impacted_request_count}
          </Text>
          {record.out_of_office_owner_names.length ? (
            <Text type="secondary">Đầu mối vắng mặt: {record.out_of_office_owner_names.join(', ')}</Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: 'Trạng thái diễn tập',
      key: 'posture',
      width: 320,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text type="secondary">
            Sẵn sàng đổi tuyến {record.ready_to_reroute_count} | Cần xử lý tay {record.manual_gap_requests}
          </Text>
          <Text type="secondary">
            Diễn tập gần nhất {record.last_drill_at ? formatDateTime(record.last_drill_at) : 'Chưa diễn tập'}
            {record.days_since_last_drill !== null ? ` | ${record.days_since_last_drill} ngày trước` : ''}
          </Text>
          <Text type="secondary">{record.suggested_focus}</Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space wrap>
          <Button size="small" onClick={() => previewAutomationMutation.mutate({ scope: 'continuity' })}>
            Xem trước diễn tập
          </Button>
          <Button
            size="small"
            onClick={() => {
              simulationForm.setFieldsValue({
                ...DEFAULT_SIMULATION_VALUES,
                department_key: record.department_key,
              });
              simulateAbsenceMutation.mutate({
                approver_user_ids: [],
                department_key: record.department_key,
                duration_hours: DEFAULT_SIMULATION_VALUES.duration_hours,
              });
            }}
          >
            Mô phỏng
          </Button>
        </Space>
      ),
    },
  ];

  const simulationColumns: ColumnsType<AccessExceptionAbsenceSimulationImpactedRow> = [
    {
      title: 'Yêu cầu bị ảnh hưởng',
      key: 'request',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Space size={8} wrap>
            <Text strong>{record.target_user.full_name || record.target_user.username}</Text>
            <Tag color={availabilityStatusColor(record.status === 'ready-to-reroute' ? 'covered' : 'critical')}>{record.status_label}</Tag>
            <Tag>{record.request_key}</Tag>
          </Space>
          <Text type="secondary">{record.policy.name} | {record.department_label}</Text>
          <Text type="secondary">{record.stage_label} | {record.continuity_note}</Text>
        </Space>
      ),
    },
    {
      title: 'Suggested path',
      key: 'suggestion',
      width: 320,
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Text type="secondary">
            {record.suggested_approver?.full_name || record.suggested_approver?.username || 'Chua co backup path'}
          </Text>
          <Text type="secondary">
            {record.suggested_resolution_label || 'Cần chỉ định thủ công'}
            {record.suggested_source_label ? ` | ${record.suggested_source_label}` : ''}
          </Text>
          {record.suggested_coverage_note ? <Text type="secondary">{record.suggested_coverage_note}</Text> : null}
        </Space>
      ),
    },
  ];

  const handleSavePolicy = async () => {
    const values = await policyForm.validateFields();
    savePolicyMutation.mutate({
      key: values.key,
      pack_key: values.pack_key || undefined,
      name: values.name,
      description: values.description,
      is_active: values.is_active,
      tone: values.tone,
      risk_level: values.risk_level,
      approval_stage_count: values.approval_stage_count,
      approval_sla_hours: values.approval_sla_hours,
      stage_one_label: values.stage_one_label,
      stage_two_label: values.stage_two_label,
      default_duration_days: values.default_duration_days,
      max_duration_days: values.max_duration_days,
      requires_approval: values.requires_approval,
      role_ids: values.role_ids,
      team_ids: values.team_ids,
      checklist: parseChecklistText(values.checklist_text),
    });
  };
  const handleSaveRoutingRule = async () => {
    const values = await routingForm.validateFields();
    saveRoutingRuleMutation.mutate({
      department_key: values.department_key,
      department_label: values.department_label,
      is_active: values.is_active,
      stage_one_mode: values.stage_one_mode,
      stage_two_mode: values.stage_two_mode || undefined,
      stage_one_primary_user_id: values.stage_one_primary_user_id || undefined,
      stage_one_delegate_user_id: values.stage_one_delegate_user_id || undefined,
      stage_one_rotation_user_ids: values.stage_one_rotation_user_ids,
      stage_two_primary_user_id: values.stage_two_primary_user_id || undefined,
      stage_two_delegate_user_id: values.stage_two_delegate_user_id || undefined,
      stage_two_rotation_user_ids: values.stage_two_rotation_user_ids,
      fallback_team_tokens: parseRoutingTokensText(values.fallback_team_tokens_text),
      notes: values.notes || undefined,
    });
  };
  const handleSaveAvailability = async () => {
    const values = await availabilityForm.validateFields();
    saveAvailabilityMutation.mutate({
      user_id: Number(values.user_id),
      is_out_of_office: values.is_out_of_office,
      starts_at: values.starts_at ? dayjs(values.starts_at).toISOString() : null,
      ends_at: values.ends_at ? dayjs(values.ends_at).toISOString() : null,
      backup_user_id: values.backup_user_id || null,
      label: values.label || '',
      notes: values.notes || '',
    });
  };
  const handlePreview = async () => {
    const values = await requestForm.validateFields();
    previewMutation.mutate({
      policy_key: values.policy_key || '',
      user_id: Number(values.user_id),
      approver_user_id: values.approver_user_id || undefined,
      stage_two_approver_user_id: values.stage_two_approver_user_id || undefined,
      duration_days: values.duration_days || undefined,
      justification: values.justification || undefined,
      ticket_ref: values.ticket_ref || undefined,
    });
  };
  const handleSubmitRequest = async () => {
    const values = await requestForm.validateFields();
    createRequestMutation.mutate({
      policy_key: values.policy_key || '',
      user_id: Number(values.user_id),
      approver_user_id: values.approver_user_id || undefined,
      stage_two_approver_user_id: values.stage_two_approver_user_id || undefined,
      duration_days: values.duration_days || undefined,
      justification: values.justification,
      ticket_ref: values.ticket_ref || undefined,
    });
  };
  const handleDecision = async () => {
    if (!decisionState) return;
    const values = await decisionForm.validateFields();
    if (decisionState.mode === 'revoke') {
      revokeMutation.mutate({ request_key: decisionState.request.key, note: values.note || undefined });
      return;
    }
    decideMutation.mutate({
      request_key: decisionState.request.key,
      decision: decisionState.mode,
      note: values.note || undefined,
    });
  };
  const handleRenewal = async () => {
    if (!renewalState) return;
    const values = await renewalForm.validateFields();
    createRenewalMutation.mutate({
      request_key: renewalState.key,
      approver_user_id: values.approver_user_id || undefined,
      stage_two_approver_user_id: values.stage_two_approver_user_id || undefined,
      duration_days: values.duration_days || undefined,
      justification: values.justification,
      ticket_ref: values.ticket_ref || undefined,
    });
  };
  const handleReroute = async () => {
    if (!rerouteState) return;
    const values = await rerouteForm.validateFields();
    rerouteMutation.mutate({
      request_key: rerouteState.requestKey,
      approver_user_id: values.approver_user_id || undefined,
      note: values.note || undefined,
    });
  };
  const handleSaveAutomationPolicy = async () => {
    const values = await automationPolicyForm.validateFields();
    saveAutomationPolicyMutation.mutate({
      enabled: values.enabled,
      auto_revoke_expired: values.auto_revoke_expired,
      reminder_offsets_days: parseReminderOffsetsText(values.reminder_offsets_text),
      renewal_window_days: Number(values.renewal_window_days || 5),
      notify_target_user: values.notify_target_user,
      notify_requested_by: values.notify_requested_by,
      notify_approver: values.notify_approver,
      approval_warning_window_hours: Number(values.approval_warning_window_hours || 6),
      approval_escalation_delay_hours: Number(values.approval_escalation_delay_hours || 2),
      notify_requester_for_sla: values.notify_requester_for_sla,
      notify_active_approver_for_sla: values.notify_active_approver_for_sla,
      notify_directory_owners_for_sla: values.notify_directory_owners_for_sla,
      continuity_drill_enabled: values.continuity_drill_enabled,
      continuity_drill_interval_days: Number(values.continuity_drill_interval_days || 7),
      continuity_drill_warning_days: Number(values.continuity_drill_warning_days || 2),
      notify_directory_owners_for_continuity: values.notify_directory_owners_for_continuity,
      auto_prepare_playbooks: values.auto_prepare_playbooks,
    });
  };
  const handleSaveScheduler = () => {
    saveSchedulerMutation.mutate({
      enabled: schedulerEnabled,
      interval_minutes: Math.max(5, Number(schedulerIntervalMinutes || 30)),
    });
  };
  const handleSimulateAbsence = async () => {
    const values = await simulationForm.validateFields();
    simulateAbsenceMutation.mutate({
      approver_user_ids: values.approver_user_ids,
      department_key: values.department_key || undefined,
      duration_hours: Number(values.duration_hours || 24),
    });
  };

  return (
    <>
      {contextHolder}
      <PageHeader
        title="Trung tâm ngoại lệ truy cập"
        subtitle="Điều phối chính sách ngoại lệ truy cập, luồng phê duyệt và hàng chờ xử lý rủi ro trong một workspace thống nhất."
        icon={<SafetyCertificateOutlined />}
        extra={(
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void invalidateWorkspace()}>Làm mới</Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openPolicyEditor()}
            >
              Tạo chính sách
            </Button>
          </Space>
        )}
      />

      {(focusRequestKey || focusPolicyKey || focusSearch) ? (
        <Alert
          data-testid="access-exception-focus-banner"
          type={editingPolicy ? 'info' : 'warning'}
          showIcon
          style={{ marginBottom: 16 }}
          message={`Đang tập trung theo drilldown: ${focusRequestKey || focusPolicyKey || focusSearch}`}
          description={editingPolicy
            ? 'Chính sách mục tiêu đã được mở sẵn để bạn rà soát guardrail, định tuyến và debt liên quan.'
            : 'Hàng chờ và bộ lọc đã được thu hẹp theo drilldown để bạn tiếp tục xử lý đúng request hoặc policy mục tiêu.'}
        />
      ) : null}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Chính sách đang áp dụng" value={workspaceQuery.data?.summary.active_policies ?? 0} tint="#2563eb" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Yêu cầu chờ duyệt" value={workspaceQuery.data?.summary.requests_pending ?? 0} tint="#d97706" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Ngoại lệ đang hiệu lực" value={workspaceQuery.data?.summary.requests_active ?? 0} tint="#059669" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Khoảng trống coverage" value={workspaceQuery.data?.summary.routing_coverage_gaps ?? 0} tint="#dc2626" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Hàng chờ gia hạn" value={automationSnapshot?.summary.renewal_candidates ?? 0} tint="#0891b2" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Nhắc việc đến hạn" value={automationSnapshot?.summary.reminders_due ?? 0} tint="#7c3aed" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="SLA quá hạn" value={workspaceQuery.data?.summary.sla_requests_overdue ?? 0} tint="#ea580c" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Escalation đến hạn" value={workspaceQuery.data?.summary.sla_escalations_due ?? 0} tint="#be123c" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Hàng chờ rủi ro cao" value={workspaceQuery.data?.summary.high_risk_requests ?? 0} tint="#dc2626" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Debt nghiêm trọng" value={workspaceQuery.data?.summary.policy_debt_critical ?? 0} tint="#b91c1c" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Hành động remediation" value={workspaceQuery.data?.summary.guided_remediation_actions ?? 0} tint="#1d4ed8" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Cần xử lý gấp" value={workspaceQuery.data?.summary.guided_remediation_critical ?? 0} tint="#991b1b" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Người duyệt quá tải" value={workspaceQuery.data?.summary.overloaded_approvers ?? 0} tint="#b91c1c" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Thiếu người dự phòng" value={workspaceQuery.data?.summary.backup_gap_departments ?? 0} tint="#c2410c" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Người duyệt vắng mặt" value={workspaceQuery.data?.summary.out_of_office_approvers ?? 0} tint="#dc2626" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Request bị ảnh hưởng" value={workspaceQuery.data?.summary.continuity_impacted_requests ?? 0} tint="#0f766e" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Drill đến hạn" value={workspaceQuery.data?.summary.continuity_drills_due ?? 0} tint="#7c2d12" /></Col>
        <Col xs={24} md={12} xl={6}><SummaryCard title="Playbook sẵn sàng" value={workspaceQuery.data?.summary.continuity_playbooks_prepared ?? 0} tint="#0f766e" /></Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24}>
          <Card
            data-testid="access-exception-command-strip"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div data-testid="access-exception-command-policy-search">
                  <Input
                    placeholder="Tìm policy theo tên, khóa hoặc mô tả"
                    value={policySearch}
                    onChange={(event) => setPolicySearch(event.target.value)}
                    style={{ width: 240 }}
                  />
                </div>
                <Select<PolicyFilter>
                  value={policyFilter}
                  onChange={setPolicyFilter}
                  style={{ width: 160 }}
                  options={[
                    { value: 'all', label: 'Mọi chính sách' },
                    { value: 'active', label: 'Đang áp dụng' },
                    { value: 'inactive', label: 'Tạm dừng' },
                    { value: 'findings', label: 'Cần rà soát' },
                    { value: 'critical', label: 'Chỉ rủi ro cao' },
                    { value: 'debt', label: 'Debt watch' },
                  ]}
                />
                <Input
                  placeholder="Tìm request, người nhận quyền hoặc policy"
                  value={requestSearch}
                  onChange={(event) => setRequestSearch(event.target.value)}
                  style={{ width: 260 }}
                />
                <Select<RequestFilter>
                  value={requestFilter}
                  onChange={setRequestFilter}
                  style={{ width: 160 }}
                  options={[
                    { value: 'all', label: 'Mọi yêu cầu' },
                    { value: 'pending', label: 'Chờ duyệt' },
                    { value: 'active', label: 'Đang hiệu lực' },
                    { value: 'expiring', label: 'Sắp hết hạn' },
                    { value: 'expired', label: 'Đã hết hạn' },
                    { value: 'closed', label: 'Đã đóng' },
                    { value: 'high-risk', label: 'Rủi ro cao' },
                  ]}
                />
                <Input
                  placeholder="Tìm hoạt động, actor hoặc mã request"
                  value={activitySearch}
                  onChange={(event) => setActivitySearch(event.target.value)}
                  style={{ width: 260 }}
                />
                <Select<ActivityFilter>
                  value={activityFilter}
                  onChange={setActivityFilter}
                  style={{ width: 180 }}
                  options={[
                    { value: 'all', label: 'Mọi hoạt động' },
                    { value: 'approvals', label: 'Phê duyệt' },
                    { value: 'routing', label: 'Định tuyến' },
                    { value: 'automation', label: 'Tự động hóa' },
                    { value: 'revocations', label: 'Thu hồi / xóa' },
                  ]}
                />
              </div>
              <Space wrap>
                <Button data-testid="access-exception-save-view" onClick={() => void saveCurrentView()}>
                  Lưu chế độ xem
                </Button>
                <Button data-testid="access-exception-restore-view" onClick={applySavedView}>
                  Khôi phục
                </Button>
                <Button
                  data-testid="access-exception-open-preset-modal"
                  onClick={() => setIsPresetModalOpen(true)}
                >
                  Tạo mẫu lọc
                </Button>
                <div data-testid="access-exception-preset-select">
                  <Select
                    value={selectedPresetId}
                    onChange={setSelectedPresetId}
                    style={{ width: 240 }}
                    options={[
                      { value: 'NONE', label: 'Chọn mẫu access exception' },
                      ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                    ]}
                  />
                </div>
                <Button data-testid="access-exception-apply-preset" onClick={applyNamedPreset}>
                  Áp dụng mẫu
                </Button>
                <Button
                  danger
                  data-testid="access-exception-delete-preset"
                  disabled={!selectedPreset}
                  onClick={() => void deleteNamedPreset()}
                >
                  Xóa mẫu
                </Button>
              </Space>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Bộ lọc này đồng bộ cho policy library, hàng chờ request và activity feed để đội governance mở lại đúng góc nhìn xử lý ngoại lệ.
              </Paragraph>
              {activeFilterTags.length ? (
                <Space size={[6, 6]} wrap>
                  {activeFilterTags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </Space>
              ) : null}
            </Space>
          </Card>
        </Col>
      </Row>

      <Modal
        open={isPresetModalOpen}
        title="Lưu mẫu lọc access exception"
        okText="Lưu mẫu"
        cancelText="Đóng"
        onOk={() => void saveNamedPreset()}
        onCancel={() => {
          setIsPresetModalOpen(false);
          setPresetName('');
        }}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Lưu nhanh tổ hợp bộ lọc policy, request và activity để quay lại đúng hàng chờ đang phụ trách.
          </Paragraph>
          <Input
            data-testid="access-exception-preset-name"
            placeholder="Ví dụ: Queue SLA cao và routing debt"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            onPressEnter={() => void saveNamedPreset()}
          />
        </Space>
      </Modal>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card
            title="Thư viện chính sách"
            style={PANEL_STYLE}
            extra={(
              <Space>
                <div data-testid="access-exception-policy-search">
                  <Input
                    placeholder="Tìm theo tên, khóa hoặc mô tả chính sách"
                    value={policySearch}
                    onChange={(event) => setPolicySearch(event.target.value)}
                    style={{ width: 260 }}
                  />
                </div>
                <Select<PolicyFilter>
                  value={policyFilter}
                  onChange={setPolicyFilter}
                  style={{ width: 160 }}
                  options={[
                    { value: 'all', label: 'Mọi chính sách' },
                    { value: 'active', label: 'Đang áp dụng' },
                    { value: 'inactive', label: 'Tạm dừng' },
                    { value: 'findings', label: 'Cần rà soát' },
                    { value: 'critical', label: 'Chỉ rủi ro cao' },
                    { value: 'debt', label: 'Debt watch' },
                  ]}
                />
                <Button icon={<DownloadOutlined />} onClick={exportPolicies}>Xuất CSV</Button>
              </Space>
            )}
          >
            <Table rowKey="key" loading={workspaceQuery.isLoading} columns={policyColumns} dataSource={policies} pagination={false} scroll={{ x: 1080 }} />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card title="Tạo yêu cầu ngoại lệ" style={PANEL_STYLE}>
            <Form form={requestForm} layout="vertical" initialValues={DEFAULT_REQUEST_VALUES} onValuesChange={() => setPreviewData(null)}>
              <Form.Item name="policy_key" label="Chính sách" rules={[{ required: true, message: 'Hãy chọn chính sách.' }]}><Select placeholder="Chọn chính sách" options={policyOptions} /></Form.Item>
              {selectedPolicy ? (
                <Alert
                  showIcon
                  type={selectedPolicy.approval_stage_count > 1 ? 'warning' : 'info'}
                  style={{ marginBottom: 16 }}
                  message={`${selectedPolicy.name} · ${selectedPolicy.approval_stage_count} chặng phê duyệt`}
                  description={`${selectedPolicy.pack_key || 'custom-policy'} | ${selectedPolicy.stage_one_label}${selectedPolicy.approval_stage_count > 1 ? ` -> ${selectedPolicy.stage_two_label}` : ''} | SLA ${selectedPolicy.approval_sla_hours} giờ`}
                />
              ) : null}
              {selectedPolicy ? (
                <Alert
                  showIcon
                  type="info"
                  style={{ marginBottom: 16 }}
                  message={`${selectedPolicy.department_label} đang dùng định tuyến ủy quyền`}
                  description={(
                    <Space direction="vertical" size={2}>
                      <Text>{selectedPolicy.routing_summary}</Text>
                      <Text type="secondary">
                        {(selectedPolicy.pack_key || 'custom-policy')} | {selectedPolicy.stage_one_label}: {selectedPolicy.stage_one_strategy_label}
                        {selectedPolicy.approval_stage_count > 1 ? ` | ${selectedPolicy.stage_two_label}: ${selectedPolicy.stage_two_strategy_label}` : ''}
                      </Text>
                      <Text type="secondary">Để trống trường approver nếu muốn hệ thống tự chọn người duyệt theo pack.</Text>
                    </Space>
                  )}
                />
              ) : null}
              <Form.Item name="user_id" label="Người nhận quyền" rules={[{ required: true, message: 'Hãy chọn người nhận quyền.' }]}>
                <Select showSearch filterOption={false} options={userOptions} placeholder="Tìm người dùng" onSearch={setUserSearch} />
              </Form.Item>
              <Form.Item
                name="approver_user_id"
                label={selectedPolicy?.requires_approval ? `${selectedPolicy.stage_one_label || 'Người duyệt'} (không bắt buộc)` : 'Người duyệt'}
                extra={selectedPolicy?.requires_approval ? 'Để trống nếu muốn hệ thống tự route chặng 1 theo department pack.' : undefined}
              >
                <Select allowClear options={approverOptions} placeholder="Chọn người duyệt hoặc để hệ thống tự route" />
              </Form.Item>
              {selectedPolicy?.approval_stage_count && selectedPolicy.approval_stage_count > 1 ? (
                <Form.Item
                  name="stage_two_approver_user_id"
                  label={`${selectedPolicy.stage_two_label || 'Người duyệt chặng 2'} (không bắt buộc)`}
                  extra="Để trống nếu muốn hệ thống tự route chặng 2 với approver độc lập."
                >
                  <Select allowClear options={approverOptions} placeholder="Chọn approver chặng 2 hoặc để hệ thống tự route" />
                </Form.Item>
              ) : null}
              <Row gutter={12}>
                <Col span={12}><Form.Item name="duration_days" label="Thời hạn (ngày)" rules={[{ required: true, message: 'Nhập thời hạn.' }]}><Input type="number" min={1} /></Form.Item></Col>
                <Col span={12}><Form.Item name="ticket_ref" label="Mã ticket"><Input placeholder="INC-1024" /></Form.Item></Col>
              </Row>
              <Form.Item name="justification" label="Lý do nghiệp vụ" rules={[{ required: true, message: 'Nhập lý do nghiệp vụ.' }]}><Input.TextArea rows={4} /></Form.Item>
              <Space>
                <Button icon={<EyeOutlined />} loading={previewMutation.isPending} onClick={() => void handlePreview()}>Xem trước yêu cầu</Button>
                <Button type="primary" icon={<PlusOutlined />} loading={createRequestMutation.isPending} disabled={previewData?.can_submit_request === false} onClick={() => void handleSubmitRequest()}>Gửi yêu cầu</Button>
              </Space>
            </Form>

            {previewData ? (
              <div style={{ marginTop: 16 }}>
                <Alert
                  type={previewData.can_submit_request ? 'success' : 'warning'}
                  showIcon
                  message="Tóm tắt xem trước"
                  description={`${previewData.summary.role_additions} vai trò / ${previewData.summary.team_additions} nhóm sẽ được thêm. Hết hạn dự kiến: ${formatDateTime(previewData.expires_at)}`}
                />
                <PreviewPanel previewData={previewData} />
              </div>
            ) : null}

            <div style={{ marginTop: 16 }}>
              <Card
                size="small"
                title="Bàn điều phối tự động hóa"
                extra={(
                  <Space wrap>
                    <Button icon={<EyeOutlined />} loading={previewAutomationMutation.isPending} onClick={() => previewAutomationMutation.mutate({ scope: 'all' })}>
                      Xem trước toàn bộ
                    </Button>
                    <Button icon={<SafetyCertificateOutlined />} loading={runAutomationMutation.isPending} onClick={() => runAutomationMutation.mutate({ scope: 'approvals' })}>
                      Chạy SLA
                    </Button>
                    <Button icon={<SyncOutlined />} loading={runAutomationMutation.isPending} onClick={() => runAutomationMutation.mutate({ scope: 'continuity' })}>
                      Chạy drill
                    </Button>
                    <Button type="primary" icon={<ThunderboltOutlined />} loading={runAutomationMutation.isPending} onClick={() => runAutomationMutation.mutate({ scope: 'all' })}>
                      Chạy toàn bộ
                    </Button>
                    <Button icon={<ClockCircleOutlined />} onClick={() => setAutomationDrawerOpen(true)}>
                      Chính sách
                    </Button>
                  </Space>
                )}
                style={{ borderRadius: 18, background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)' }}
              >
                <Alert
                  showIcon
                  type={workspaceQuery.data?.scheduler_status.enabled ? 'success' : 'warning'}
                  message={workspaceQuery.data?.scheduler_status.enabled ? 'Bộ lập lịch đang hoạt động' : 'Bộ lập lịch đang tạm dừng'}
                  description={`Chu kỳ ${schedulerIntervalMinutes} phút | Cảnh báo duyệt trước ${workspaceQuery.data?.automation_policy.approval_warning_window_hours ?? 6} giờ | Leo thang sau ${workspaceQuery.data?.automation_policy.approval_escalation_delay_hours ?? 2} giờ quá hạn | Diễn tập liên tục vận hành mỗi ${workspaceQuery.data?.automation_policy.continuity_drill_interval_days ?? 7} ngày${workspaceQuery.data?.scheduler_status.next_run ? ` | Lần chạy tới ${formatDateTime(workspaceQuery.data.scheduler_status.next_run)}` : ''}`}
                />
                <Row gutter={12} style={{ marginTop: 12 }}>
                  <Col span={10}>
                    <Text type="secondary">Bộ lập lịch</Text>
                    <div>
                      <Switch checked={schedulerEnabled} onChange={(checked) => setSchedulerDraft((current) => ({ enabled: checked, interval_minutes: current?.interval_minutes ?? schedulerIntervalMinutes }))} />
                    </div>
                  </Col>
                  <Col span={8}>
                    <Text type="secondary">Chu kỳ</Text>
                    <Input
                      type="number"
                      min={5}
                      max={120}
                      value={schedulerIntervalMinutes}
                      onChange={(event) => setSchedulerDraft((current) => ({
                        enabled: current?.enabled ?? schedulerEnabled,
                        interval_minutes: Number(event.target.value || 30),
                      }))}
                    />
                  </Col>
                  <Col span={6}>
                    <Text type="secondary">Lưu</Text>
                    <div>
                      <Button loading={saveSchedulerMutation.isPending} onClick={handleSaveScheduler}>Áp dụng</Button>
                    </div>
                  </Col>
                </Row>

                <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                  <Col xs={12} md={8}>
                    <Statistic title="Gia hạn" value={automationSnapshot?.summary.renewal_candidates ?? 0} valueStyle={{ color: '#0891b2', fontWeight: 700 }} />
                  </Col>
                  <Col xs={12} md={8}>
                    <Statistic title="Nhắc việc" value={automationSnapshot?.summary.reminders_due ?? 0} valueStyle={{ color: '#7c3aed', fontWeight: 700 }} />
                  </Col>
                  <Col xs={12} md={8}>
                    <Statistic title="Thu hồi tự động" value={automationSnapshot?.summary.auto_revokes_due ?? 0} valueStyle={{ color: '#dc2626', fontWeight: 700 }} />
                  </Col>
                  <Col xs={12} md={8}>
                    <Statistic title="Cảnh báo SLA" value={automationSnapshot?.summary.sla_warnings_due ?? 0} valueStyle={{ color: '#d97706', fontWeight: 700 }} />
                  </Col>
                  <Col xs={12} md={8}>
                    <Statistic title="SLA quá hạn" value={slaRadar?.summary.overdue ?? 0} valueStyle={{ color: '#ea580c', fontWeight: 700 }} />
                  </Col>
                  <Col xs={12} md={8}>
                    <Statistic title="Escalation đến hạn" value={automationSnapshot?.summary.sla_escalations_due ?? 0} valueStyle={{ color: '#be123c', fontWeight: 700 }} />
                  </Col>
                  <Col xs={12} md={8}>
                    <Statistic title="Drill đến hạn" value={continuityDrillPreview?.summary.drills_due ?? 0} valueStyle={{ color: '#7c2d12', fontWeight: 700 }} />
                  </Col>
                  <Col xs={12} md={8}>
                    <Statistic title="Kịch bản" value={automationSnapshot?.summary.playbooks_prepared ?? 0} valueStyle={{ color: '#0f766e', fontWeight: 700 }} />
                  </Col>
                </Row>

                <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                  <Col xs={24} lg={12}>
                    <Text strong>Renewal candidates</Text>
                    {(automationSnapshot?.renewal_candidates ?? []).length ? (
                      <List
                        size="small"
                        dataSource={automationSnapshot?.renewal_candidates ?? []}
                        renderItem={(item) => (
                          <List.Item>
                            <Space direction="vertical" size={2}>
                              <Text strong>{item.target_user.full_name || item.target_user.username}</Text>
                              <Text type="secondary">{item.policy.name} | expire {formatDateTime(item.planned_expires_at)}</Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Khong co renewal canh bao." />}
                  </Col>
                  <Col xs={24} lg={12}>
                    <Text strong>Approval SLA pulse</Text>
                    {automationApprovalPulse.length ? (
                      <List
                        size="small"
                        dataSource={automationApprovalPulse}
                        renderItem={(item) => (
                          <List.Item>
                            <Space direction="vertical" size={2}>
                              <Space size={8} wrap>
                                <Text strong>{item.target_user.full_name || item.target_user.username}</Text>
                                <Tag color={severityColor(item.severity)}>{item.status}</Tag>
                                {item.escalation_due ? <Tag color="volcano">Cần leo thang</Tag> : null}
                                {item.warning_due ? <Tag color="gold">Cần nhắc</Tag> : null}
                              </Space>
                              <Text type="secondary">{item.policy.name} | {item.stage_label}</Text>
                              <Text type="secondary">
                                {formatDateTime(item.approval_stage_due_at)} | {item.routing_source_label}
                              </Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Hàng chờ SLA đang ổn định." />}
                  </Col>
                </Row>
              </Card>
            </div>

            <div style={{ marginTop: 16 }}>
              <Text strong>Watchlist quản trị</Text>
              {(workspaceQuery.data?.watchlist ?? []).length ? (
                <List
                  size="small"
                  dataSource={workspaceQuery.data?.watchlist ?? []}
                  renderItem={(item) => (
                    <List.Item>
                      <Space direction="vertical" size={2}>
                        <Space size={8} wrap>
                          <Tag color={severityColor(item.severity)}>{item.severity}</Tag>
                          {item.request_key ? <Tag>{item.request_key}</Tag> : null}
                        </Space>
                        <Text strong>{item.title}</Text>
                        <Text type="secondary">{item.description}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : <Empty description="Watchlist hiện đang trống." />}
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card
            title="Bảng debt chính sách"
            style={PANEL_STYLE}
            extra={(
              <Space wrap>
                <Tag color="volcano">{workspaceQuery.data?.summary.policy_debt_critical ?? 0} nghiêm trọng</Tag>
                <Tag color="gold">{workspaceQuery.data?.summary.policy_debt_watchlist ?? 0} cần theo dõi</Tag>
              </Space>
            )}
          >
            <Alert
              showIcon
              type={(workspaceQuery.data?.summary.policy_debt_critical ?? 0) > 0 ? 'warning' : 'info'}
              style={{ marginBottom: 16 }}
              message="Debt cấu hình, kiểm soát cũ và áp lực từ hàng chờ đang chạy"
              description={`Theo dõi ${policyDebtRows.length} chính sách có tín hiệu nợ kiểm soát | yêu cầu rủi ro cao ${workspaceQuery.data?.summary.high_risk_requests ?? 0} | nợ kiểm soát nghiêm trọng ${workspaceQuery.data?.summary.policy_debt_critical ?? 0}`}
            />
            {policyDebtRows.length ? (
              <Table
                rowKey="key"
                columns={policyDebtColumns}
                dataSource={policyDebtRows}
                pagination={false}
                scroll={{ x: 860, y: 420 }}
              />
              ) : <Empty description="Chưa có chính sách nào cần rà soát nợ kiểm soát." />}
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card
            title="Hàng chờ rủi ro cao"
            style={PANEL_STYLE}
            extra={(
              <Space wrap>
                <Tag color="volcano">{workspaceQuery.data?.summary.critical_risk_requests ?? 0} nghiêm trọng</Tag>
                <Tag color="gold">{workspaceQuery.data?.summary.high_risk_requests ?? 0} mức cao</Tag>
              </Space>
            )}
          >
            <Alert
              showIcon
              type={(workspaceQuery.data?.summary.critical_risk_requests ?? 0) > 0 ? 'warning' : 'info'}
              style={{ marginBottom: 16 }}
              message="Những yêu cầu cần được quản trị chú ý ngay"
              description="Tổng hợp các yêu cầu có điểm rủi ro cao nhất để admin chốt nhanh trước khi biến thành backlog, SLA breach hoặc policy debt."
            />
            {requestRiskQueue.length ? (
              <Table
                rowKey="key"
                columns={requestRiskColumns}
                dataSource={requestRiskQueue}
                pagination={false}
                scroll={{ x: 760, y: 420 }}
              />
            ) : <Empty description="Chưa có yêu cầu nào vượt ngưỡng theo dõi rủi ro." />}
          </Card>
        </Col>

        <Col xs={24}>
          <Card
            title="Khắc phục được gợi ý"
            style={PANEL_STYLE}
            extra={(
              <Space wrap>
                <Tag color="volcano">{guidedRemediationSummary?.critical_actions ?? 0} nghiêm trọng</Tag>
                <Tag color="blue">{guidedRemediationSummary?.total_actions ?? 0} sẵn sàng</Tag>
                <Tag color="cyan">{guidedRemediationSummary?.policy_actions ?? 0} theo chính sách</Tag>
                <Tag color="purple">{guidedRemediationSummary?.request_actions ?? 0} theo yêu cầu</Tag>
              </Space>
            )}
          >
            <Alert
              showIcon
              type={(guidedRemediationSummary?.critical_actions ?? 0) > 0 ? 'warning' : 'info'}
              style={{ marginBottom: 16 }}
              message="Các thao tác xử lý nhanh cho tín hiệu rủi ro cao nhất"
              description="Dùng khắc phục được gợi ý để xử lý các tín hiệu rõ ràng nhất ngay trong không gian làm việc, thay vì phải đi qua từng khối riêng lẻ."
            />
            {guidedRemediation.length ? (
              <List
                style={{ maxHeight: 560, overflow: 'auto' }}
                dataSource={guidedRemediation}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      item.request_key ? (
                        <Button key={`${item.id}-focus`} size="small" onClick={() => focusRequest(item.request_key || '', 'high-risk')}>
                          Tập trung
                        </Button>
                      ) : item.policy_key ? (
                        <Button
                          key={`${item.id}-review`}
                          size="small"
                          onClick={() => openPolicyEditor((workspaceQuery.data?.policies ?? []).find((policy) => policy.key === item.policy_key) ?? null)}
                        >
                          Rà soát
                        </Button>
                      ) : null,
                      <Button
                        key={`${item.id}-apply`}
                        type="primary"
                        size="small"
                        loading={guidedRemediationMutation.isPending}
                        onClick={() => handleApplyGuidedRemediation(item)}
                      >
                        {item.action_label}
                      </Button>,
                    ].filter(Boolean)}
                  >
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space size={8} wrap>
                        <Tag color={severityColor(item.severity)}>{item.severity}</Tag>
                        <Tag>{item.kind}</Tag>
                        {item.policy_name ? <Tag color="geekblue">{item.policy_name}</Tag> : null}
                        {item.request_key ? <Tag>{item.request_key}</Tag> : null}
                        {item.department_label ? <Tag color="cyan">{item.department_label}</Tag> : null}
                      </Space>
                      <Text strong>{item.title}</Text>
                      <Text type="secondary">{item.description}</Text>
                      <Text type="secondary">
                        {item.target_user ? `${item.target_user.full_name || item.target_user.username}` : 'Khuyến nghị ở cấp chính sách'}
                        {item.suggested_approver ? ` | Đầu mối đề xuất ${item.suggested_approver.full_name || item.suggested_approver.username}` : ''}
                        {item.suggested_resolution_label ? ` | ${item.suggested_resolution_label}` : ''}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : <Empty description="Chưa có remediation nào đang sẵn sàng." />}
          </Card>
        </Col>

        <Col xs={24}>
          <Card
            title="Danh bạ định tuyến"
            style={PANEL_STYLE}
            extra={(
              <Space>
                <Tag color="cyan">{routingRules.filter((item) => item.configured_stage_one).length} chặng 1 sẵn sàng</Tag>
                <Tag color="purple">{routingRules.filter((item) => item.configured_stage_two).length} chặng 2 sẵn sàng</Tag>
              </Space>
            )}
          >
            <Alert
              showIcon
              type="info"
              style={{ marginBottom: 16 }}
              message="Định tuyến theo đầu mối chính và người dự phòng của từng phòng ban"
              description="Gán đầu mối chính và người dự phòng theo phòng ban để ngoại lệ truy cập đi theo danh bạ kiểm soát trước khi fallback sang nhóm phù hợp hoặc nhóm kiểm soát chung."
            />
            <Table
              rowKey="department_key"
              columns={routingRuleColumns}
              dataSource={routingRules}
              pagination={false}
              scroll={{ x: 960 }}
            />
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card
            title="Nhịp coverage"
            style={PANEL_STYLE}
            extra={(
              <Space wrap>
                <Tag color="cyan">{routingCoverageSummary?.departments_stage_one_ready ?? 0} chặng 1 sẵn sàng</Tag>
                <Tag color="purple">{routingCoverageSummary?.departments_stage_two_ready ?? 0} chặng 2 sẵn sàng</Tag>
                <Tag color="volcano">{routingCoverageSummary?.coverage_gaps ?? 0} khoảng trống</Tag>
              </Space>
            )}
          >
            <Alert
              showIcon
              type={(routingCoverageSummary?.coverage_gaps ?? 0) > 0 ? 'warning' : 'success'}
              style={{ marginBottom: 16 }}
              message="Độ phủ định tuyến theo phòng ban và áp lực fallback"
              description={`Đang theo dõi ${(routingCoverageSummary?.departments_total ?? 0)} phòng ban | fallback chờ xử lý ${routingCoverageSummary?.fallback_pending_requests ?? 0} | gần chạm SLA ${routingCoverageSummary?.near_sla_requests ?? 0}`}
            />
            <Table
              rowKey="department_key"
              columns={coverageColumns}
              dataSource={routingCoverage}
              pagination={false}
              scroll={{ x: 980 }}
            />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card
            title="Radar SLA"
            style={PANEL_STYLE}
            extra={(
              <Space wrap>
                <Tag color="gold">{slaRadar?.summary.near_due ?? 0} sắp đến hạn</Tag>
                <Tag color="volcano">{slaRadar?.summary.overdue ?? 0} quá hạn</Tag>
              </Space>
            )}
          >
            <Alert
              showIcon
              type={(slaRadar?.summary.overdue ?? 0) > 0 ? 'error' : 'info'}
              style={{ marginBottom: 16 }}
              message="Radar vi phạm SLA của hàng chờ phê duyệt"
              description={`Cảnh báo trước ${(slaRadar?.warning_window_hours ?? 6)} giờ và leo thang sau ${(slaRadar?.escalation_delay_hours ?? 2)} giờ quá hạn.`}
            />
            {(slaRadar?.items ?? []).length ? (
              <Table
                rowKey="request_key"
                columns={slaRadarColumns}
                dataSource={slaRadar?.items ?? []}
                pagination={false}
                scroll={{ x: 860 }}
              />
            ) : <Empty description="Không có yêu cầu nào sắp đến hạn hoặc quá hạn." />}
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card
            title="Bàn công suất người duyệt"
            style={PANEL_STYLE}
            extra={(
              <Space wrap>
                <Tag color="volcano">{approverCapacitySummary?.overloaded_approvers ?? 0} quá tải</Tag>
                <Tag color="gold">{approverCapacitySummary?.single_threaded_departments ?? 0} thiếu backup</Tag>
                <Tag color="cyan">{approverCapacitySummary?.pending_assignments ?? 0} chờ phân công</Tag>
              </Space>
            )}
          >
            <Alert
              showIcon
              type={(approverCapacitySummary?.overloaded_approvers ?? 0) > 0 ? 'warning' : 'info'}
              style={{ marginBottom: 16 }}
              message="Tải xử lý của người duyệt và rủi ro phụ thuộc một người"
              description={`Theo dõi ${(approverCapacitySummary?.total_approvers ?? 0)} người duyệt | phân công quá hạn ${approverCapacitySummary?.overdue_assignments ?? 0} | phòng ban có khoảng trống độ phủ ${approverCapacitySummary?.coverage_gap_departments ?? 0}`}
            />
            <Table
              rowKey="approver_id"
              columns={capacityColumns}
              dataSource={approverCapacity}
              pagination={false}
              scroll={{ x: 980 }}
            />
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card title="Khuyến nghị cân bằng tải" style={PANEL_STYLE}>
            {workloadRecommendations.length ? (
              <List
                dataSource={workloadRecommendations}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      <Button key={`${item.id}-open`} size="small" onClick={() => openWorkloadRecommendation(item)}>
                        {item.action_label || 'Mở định tuyến'}
                      </Button>,
                    ]}
                  >
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space size={8} wrap>
                        <Tag color={severityColor(item.severity)}>{item.severity}</Tag>
                        <Tag>{item.department_label}</Tag>
                        {item.stage ? <Tag>{`Chặng ${item.stage}`}</Tag> : null}
                      </Space>
                      <Text strong>{item.title}</Text>
                      <Text type="secondary">{item.description}</Text>
                      <Text type="secondary">
                        {item.current_owner ? `Hiện tại: ${item.current_owner.full_name || item.current_owner.username}` : 'Hiện tại: chưa gán'}
                        {item.recommended_primary_approver ? ` | Đầu mối đề xuất: ${item.recommended_primary_approver.full_name || item.recommended_primary_approver.username}` : ''}
                        {item.recommended_delegate_approver ? ` | Người dự phòng đề xuất: ${item.recommended_delegate_approver.full_name || item.recommended_delegate_approver.username}` : ''}
                      </Text>
                      <Text type="secondary">{item.rationale}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : <Empty description="Chưa có khuyến nghị cân bằng tải." />}
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card
            title="Bàn độ phủ"
            style={PANEL_STYLE}
            extra={(
              <Space wrap>
                <Tag color="volcano">{approverAvailabilitySummary?.out_of_office_approvers ?? 0} vắng mặt</Tag>
                <Tag color="gold">{approverAvailabilitySummary?.out_of_office_coverage_gaps ?? 0} khoảng trống</Tag>
                <Button onClick={() => openAvailabilityEditor(null)}>Thêm kế hoạch độ phủ</Button>
              </Space>
            )}
          >
            <Alert
              showIcon
              type={(approverAvailabilitySummary?.out_of_office_coverage_gaps ?? 0) > 0 ? 'warning' : 'info'}
              style={{ marginBottom: 16 }}
              message="Độ phủ khi người duyệt vắng mặt và phương án người dự phòng"
              description={`Đang theo dõi ${approverAvailabilitySummary?.tracked_approvers ?? 0} người duyệt | đã phủ ${approverAvailabilitySummary?.covered_out_of_office_approvers ?? 0} | yêu cầu bị ảnh hưởng ${approverAvailabilitySummary?.impacted_requests ?? 0}`}
            />
            {approverAvailability.length ? (
              <Table
                rowKey="user_id"
                columns={availabilityColumns}
                dataSource={approverAvailability}
                pagination={false}
                scroll={{ x: 900 }}
              />
            ) : <Empty description="Chưa có kế hoạch độ phủ nào được ghi nhận." />}
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card
            title="Runbook liên tục vận hành"
            style={PANEL_STYLE}
            extra={(
              <Space wrap>
                <Tag color="cyan">{continuitySummary?.ready_to_reroute ?? 0} sẵn sàng</Tag>
                <Tag color="volcano">{continuitySummary?.needs_manual ?? 0} cần tay người</Tag>
              </Space>
            )}
          >
            <Alert
              showIcon
              type={(continuitySummary?.needs_manual ?? 0) > 0 ? 'warning' : 'info'}
              style={{ marginBottom: 16 }}
              message="Tính liên tục của hàng chờ và điều hướng lại yêu cầu bị ảnh hưởng"
              description={`Yêu cầu bị ảnh hưởng ${continuitySummary?.impacted_requests ?? 0} | phòng ban liên quan ${continuitySummary?.impacted_departments ?? 0}`}
            />
            {continuityRunbook.length ? (
              <Table
                rowKey="request_key"
                columns={continuityColumns}
                dataSource={continuityRunbook}
                pagination={false}
                scroll={{ x: 920, y: 360 }}
              />
            ) : <Empty description="Không có request nào đang bị ảnh hưởng bởi approver vắng mặt." />}
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card
            title="Phân tích liên tục vận hành theo phòng ban"
            style={PANEL_STYLE}
            extra={(
              <Space wrap>
                <Tag color="gold">{continuityAnalyticsSummary?.departments_due ?? 0} đến hạn</Tag>
                <Tag color="volcano">{continuityAnalyticsSummary?.departments_overdue ?? 0} quá hạn</Tag>
                <Tag color="cyan">{continuityAnalyticsSummary?.departments_tracked ?? 0} đang theo dõi</Tag>
              </Space>
            )}
          >
            <Alert
              showIcon
              type={(continuityAnalyticsSummary?.departments_overdue ?? 0) > 0 ? 'warning' : 'info'}
              style={{ marginBottom: 16 }}
              message="Mức sẵn sàng của phòng ban, độ mới của diễn tập và áp lực điều phối thủ công"
              description={`Đến hạn ${continuityAnalyticsSummary?.departments_due ?? 0} | quá hạn ${continuityAnalyticsSummary?.departments_overdue ?? 0} | khoảng trống thủ công ${continuityAnalyticsSummary?.departments_with_manual_gap ?? 0}`}
            />
            {continuityAnalytics.length ? (
              <Table
                rowKey="department_key"
                columns={continuityAnalyticsColumns}
                dataSource={continuityAnalytics}
                pagination={false}
                scroll={{ x: 980 }}
              />
            ) : <Empty description="Chưa có dữ liệu continuity theo phòng ban." />}
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card
            title="Diễn tập fallback"
            style={PANEL_STYLE}
            extra={(
              <Space wrap>
                <Tag color="gold">{continuityDrillPreview?.summary.drills_due ?? 0} đến hạn</Tag>
                <Tag color="volcano">{continuityDrillPreview?.summary.drills_overdue ?? 0} quá hạn</Tag>
              </Space>
            )}
          >
            <Alert
              showIcon
              type={(continuityDrillPreview?.summary.drills_overdue ?? 0) > 0 ? 'warning' : 'info'}
              style={{ marginBottom: 16 }}
              message="Bảng diễn tập fallback theo lịch"
              description={`Tự động hóa sẽ theo dõi độ mới của diễn tập mỗi ${workspaceQuery.data?.automation_policy.continuity_drill_interval_days ?? 7} ngày và chuẩn bị ${continuityDrillPreview?.summary.playbooks_prepared ?? 0} kịch bản.`}
            />
            {(continuityDrillPreview?.items ?? []).length ? (
              <List
                dataSource={continuityDrillPreview?.items ?? []}
                renderItem={(item: AccessExceptionContinuityDrillItem) => (
                  <List.Item
                    actions={[
                      <Button key={`${item.id}-run`} size="small" loading={runAutomationMutation.isPending} onClick={() => runAutomationMutation.mutate({ scope: 'continuity' })}>
                        Chạy drill
                      </Button>,
                    ]}
                  >
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space size={8} wrap>
                        <Tag color={severityColor(item.severity)}>{item.status_label}</Tag>
                        <Tag>{item.department_label}</Tag>
                      </Space>
                      <Text strong>{item.suggested_focus}</Text>
                      <Text type="secondary">
                        Chờ duyệt {item.pending_request_count} | bị ảnh hưởng {item.impacted_request_count} | sẵn sàng {item.ready_to_reroute_count} | cần tay người {item.manual_gap_requests}
                      </Text>
                      <Text type="secondary">
                        {item.last_drill_at ? `Diễn tập gần nhất ${formatDateTime(item.last_drill_at)}` : 'Chưa có lần diễn tập nào'}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : <Empty description="Không có drill nào đang đến hạn." />}
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card
            title="Mô phỏng vắng mặt"
            style={PANEL_STYLE}
            extra={(
              <Button loading={simulateAbsenceMutation.isPending} onClick={() => void handleSimulateAbsence()}>
                Mô phỏng
              </Button>
            )}
          >
            <Alert
              showIcon
              type="info"
              style={{ marginBottom: 16 }}
              message="Mô phỏng người duyệt vắng mặt và tự chuẩn bị kịch bản liên tục vận hành"
              description="Chọn người duyệt hoặc phòng ban để xem hàng chờ nào bị ảnh hưởng và hệ thống có thể chuẩn bị gì trước khi sự cố xảy ra."
            />
            <Form form={simulationForm} layout="vertical" initialValues={DEFAULT_SIMULATION_VALUES}>
              <Form.Item name="approver_user_ids" label="Người duyệt">
                <Select mode="multiple" allowClear options={approverOptions} placeholder="Chọn người duyệt cần mô phỏng vắng mặt" />
              </Form.Item>
              <Form.Item name="department_key" label="Phòng ban">
                <Select allowClear options={departmentOptions} placeholder="Hoặc mô phỏng theo độ phủ của phòng ban" />
              </Form.Item>
              <Form.Item name="duration_hours" label="Thời lượng (giờ)" rules={[{ required: true, message: 'Nhập số giờ mô phỏng.' }]}>
                <Input type="number" min={1} max={336} />
              </Form.Item>
            </Form>
            {simulationData ? (
              <Alert
                showIcon
                type={simulationData.summary.needs_manual > 0 ? 'warning' : 'success'}
                message={simulationData.simulation_label}
                description={`Bị ảnh hưởng ${simulationData.summary.impacted_requests} | sẵn sàng ${simulationData.summary.ready_to_reroute} | cần tay người ${simulationData.summary.needs_manual} | playbook ${simulationData.summary.playbooks_prepared}`}
              />
            ) : null}
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card
            title="Kịch bản tự chuẩn bị"
            style={PANEL_STYLE}
            extra={simulationData ? (
              <Space wrap>
                <Tag color="cyan">{simulationData.summary.ready_to_reroute} sẵn sàng</Tag>
                <Tag color="volcano">{simulationData.summary.needs_manual} cần tay người</Tag>
              </Space>
            ) : null}
          >
            {simulationData ? (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                {simulationImpactedRequests.length ? (
                  <Table
                    rowKey="request_key"
                    columns={simulationColumns}
                    dataSource={simulationImpactedRequests}
                    pagination={false}
                    scroll={{ x: 920 }}
                  />
                ) : (
                  <Empty description="Mô phỏng này không tác động request nào." />
                )}
                {simulationPlaybooks.length ? (
                  <List
                    dataSource={simulationPlaybooks}
                    renderItem={(item) => (
                      <List.Item>
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          <Space size={8} wrap>
                            <Tag color={severityColor(item.severity)}>{item.severity}</Tag>
                            {item.department_key ? <Tag>{item.department_key}</Tag> : null}
                            {item.request_key ? <Tag>{item.request_key}</Tag> : null}
                          </Space>
                          <Text strong>{item.title}</Text>
                          <Text type="secondary">{item.description}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : null}
              </Space>
            ) : <Empty description="Chạy mô phỏng vắng mặt để xem request bị ảnh hưởng và playbook tương ứng." />}
          </Card>
        </Col>

        <Col xs={24}>
          <Card
            title="Hàng chờ ngoại lệ"
            style={PANEL_STYLE}
            extra={(
              <Space>
                <div data-testid="access-exception-request-search">
                  <Input
                    placeholder="Tìm theo mã request, người nhận quyền hoặc chính sách"
                    value={requestSearch}
                    onChange={(event) => setRequestSearch(event.target.value)}
                    style={{ width: 280 }}
                  />
                </div>
                <Select<RequestFilter>
                  value={requestFilter}
                  onChange={setRequestFilter}
                  style={{ width: 160 }}
                  options={[
                    { value: 'all', label: 'Mọi yêu cầu' },
                    { value: 'pending', label: 'Chờ duyệt' },
                    { value: 'active', label: 'Đang hiệu lực' },
                    { value: 'expiring', label: 'Sắp hết hạn' },
                    { value: 'expired', label: 'Đã hết hạn' },
                    { value: 'closed', label: 'Đã đóng' },
                    { value: 'high-risk', label: 'Rủi ro cao' },
                  ]}
                />
                <Button icon={<DownloadOutlined />} onClick={exportRequests}>Xuất CSV</Button>
              </Space>
            )}
          >
            <Table rowKey="key" columns={requestColumns} dataSource={requests} pagination={false} scroll={{ x: 1080 }} />
          </Card>
        </Col>

        <Col xs={24}>
          <Card
            title="Hoạt động gần đây"
            style={PANEL_STYLE}
            extra={(
              <Space>
                <Input
                  placeholder="Tìm theo tóm tắt, actor, action hoặc mã request"
                  value={activitySearch}
                  onChange={(event) => setActivitySearch(event.target.value)}
                  style={{ width: 300 }}
                />
                <Select<ActivityFilter>
                  value={activityFilter}
                  onChange={setActivityFilter}
                  style={{ width: 180 }}
                  options={[
                    { value: 'all', label: 'Mọi hoạt động' },
                    { value: 'approvals', label: 'Phê duyệt' },
                    { value: 'routing', label: 'Định tuyến' },
                    { value: 'automation', label: 'Tự động hóa' },
                    { value: 'revocations', label: 'Thu hồi / xóa' },
                  ]}
                />
                <Button icon={<DownloadOutlined />} onClick={exportActivity}>Xuất CSV</Button>
              </Space>
            )}
          >
            {filteredActivity.length ? (
              <List
                dataSource={filteredActivity}
                renderItem={(item: AccessExceptionActivityItem) => (
                  <List.Item>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space size={8} wrap>
                        <Tag color={severityColor(item.action === 'APPROVE' ? 'success' : item.action === 'REJECT' || item.action === 'REVOKE' || item.action === 'DELETE' ? 'error' : 'info')}>{item.action}</Tag>
                        <Tag>{item.kind}</Tag>
                      </Space>
                      <Text strong>{item.summary}</Text>
                      <Text type="secondary">{item.actor.full_name || item.actor.username || 'Hệ thống'} | {formatDateTime(item.timestamp)}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : <Empty description="Chưa có hoạt động phù hợp với bộ lọc hiện tại." />}
          </Card>
        </Col>
      </Row>

      <Drawer
        title={editingPolicy ? 'Chỉnh sửa chính sách ngoại lệ truy cập' : 'Tạo chính sách ngoại lệ truy cập'}
        open={policyDrawerOpen}
        onClose={() => {
          setPolicyDrawerOpen(false);
          setEditingPolicy(null);
        }}
        width={460}
        extra={(
          <Space>
            <Button onClick={() => setPolicyDrawerOpen(false)}>Hủy</Button>
            <Button type="primary" loading={savePolicyMutation.isPending} onClick={() => void handleSavePolicy()}>Lưu chính sách</Button>
          </Space>
        )}
      >
        <div data-testid="access-exception-policy-drawer">
        <Form form={policyForm} layout="vertical" initialValues={DEFAULT_POLICY_VALUES}>
          <Form.Item name="pack_key" label="Gói chính sách">
            <Select
              allowClear
              options={policyPackOptions}
              placeholder="Khởi tạo từ một governance pack"
              onChange={(value) => applyPolicyPackToForm(value)}
            />
          </Form.Item>
          {selectedPolicyPack ? (
            <Alert
              showIcon
              type={selectedPolicyPack.approval_stage_count > 1 ? 'warning' : 'info'}
              style={{ marginBottom: 16 }}
              message={selectedPolicyPack.name}
              description={(
                <Space direction="vertical" size={2}>
                  <Text>{selectedPolicyPack.description}</Text>
                  <Text type="secondary">
                    {selectedPolicyPack.department_label} | {selectedPolicyPack.approval_stage_count} chặng | SLA {selectedPolicyPack.approval_sla_hours} giờ
                  </Text>
                  <Text type="secondary">{selectedPolicyPack.routing_summary}</Text>
                  <Text type="secondary">
                    {selectedPolicyPack.stage_one_label}: {selectedPolicyPack.stage_one_strategy_label}
                    {selectedPolicyPack.approval_stage_count > 1 ? ` | ${selectedPolicyPack.stage_two_label}: ${selectedPolicyPack.stage_two_strategy_label}` : ''}
                  </Text>
                </Space>
              )}
            />
          ) : null}
          <Form.Item name="key" label="Khóa" rules={[{ required: true, message: 'Nhập khóa.' }]}><Input disabled={Boolean(editingPolicy)} /></Form.Item>
          <Form.Item name="name" label="Tên chính sách" rules={[{ required: true, message: 'Nhập tên chính sách.' }]}><Input /></Form.Item>
          <Form.Item name="description" label="Mô tả"><Input.TextArea rows={3} /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="tone" label="Tông màu"><Select options={[{ value: 'blue', label: 'Xanh dương' }, { value: 'green', label: 'Xanh lá' }, { value: 'gold', label: 'Vàng' }, { value: 'cyan', label: 'Lam ngọc' }, { value: 'volcano', label: 'Đỏ cam' }, { value: 'purple', label: 'Tím' }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="risk_level" label="Mức rủi ro"><Select options={[{ value: 'standard', label: 'Tiêu chuẩn' }, { value: 'elevated', label: 'Nâng cao' }, { value: 'critical', label: 'Nghiêm trọng' }]} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="default_duration_days" label="Thời hạn mặc định"><Input type="number" min={1} /></Form.Item></Col>
            <Col span={12}><Form.Item name="max_duration_days" label="Thời hạn tối đa"><Input type="number" min={1} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="approval_stage_count" label="Số chặng duyệt"><Input type="number" min={1} max={2} /></Form.Item></Col>
            <Col span={12}><Form.Item name="approval_sla_hours" label="SLA (giờ)"><Input type="number" min={1} max={168} /></Form.Item></Col>
          </Row>
          <Form.Item name="stage_one_label" label="Nhãn chặng 1"><Input /></Form.Item>
          {policyStageCount > 1 ? (
            <Form.Item name="stage_two_label" label="Nhãn chặng 2"><Input /></Form.Item>
          ) : null}
          <Form.Item name="role_ids" label="Vai trò" rules={[{ required: true, message: 'Chọn vai trò.' }]}><Select mode="multiple" options={roleOptions} /></Form.Item>
          <Form.Item name="team_ids" label="Nhóm" rules={[{ required: true, message: 'Chọn nhóm.' }]}><Select mode="multiple" options={teamOptions} /></Form.Item>
          <Form.Item name="checklist_text" label="Danh mục kiểm tra"><Input.TextArea rows={4} placeholder="Mỗi dòng là một bước rà soát." /></Form.Item>
          <Form.Item name="requires_approval" label="Yêu cầu phê duyệt" valuePropName="checked"><Switch /></Form.Item>
          {!policyRequiresApproval ? (
            <Alert showIcon type="warning" style={{ marginBottom: 16 }} message="Chính sách này sẽ cấp quyền ngay lập tức, không đi qua hàng chờ phê duyệt." />
          ) : null}
          <Form.Item name="is_active" label="Đang áp dụng" valuePropName="checked"><Switch /></Form.Item>
        </Form>
        </div>
      </Drawer>

      <Drawer
        title={editingRoutingRule ? `Danh bạ định tuyến · ${editingRoutingRule.department_label}` : 'Danh bạ định tuyến'}
        open={routingDrawerOpen}
        onClose={() => {
          setRoutingDrawerOpen(false);
          setEditingRoutingRule(null);
          routingForm.resetFields();
        }}
        width={460}
        extra={(
          <Space>
            <Button
              onClick={() => {
                setRoutingDrawerOpen(false);
                setEditingRoutingRule(null);
                routingForm.resetFields();
              }}
            >
              Hủy
            </Button>
            <Button type="primary" loading={saveRoutingRuleMutation.isPending} onClick={() => void handleSaveRoutingRule()}>
              Lưu định tuyến
            </Button>
          </Space>
        )}
      >
        <Form form={routingForm} layout="vertical" initialValues={DEFAULT_ROUTING_RULE_VALUES}>
          <Form.Item name="department_key" label="Mã phòng ban" rules={[{ required: true, message: 'Nhập mã phòng ban.' }]}>
            <Input disabled />
          </Form.Item>
          <Form.Item name="department_label" label="Tên phòng ban" rules={[{ required: true, message: 'Nhập tên phòng ban.' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="is_active" label="Danh bạ đang áp dụng" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="stage_one_mode" label="Chế độ chặng 1" rules={[{ required: true, message: 'Chọn chế độ chặng 1.' }]}>
                <Select options={routingStageOneModeOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="stage_two_mode" label="Chế độ chặng 2">
                <Select options={routingStageTwoModeOptions} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="stage_one_primary_user_id" label="Owner chặng 1">
            <Select allowClear options={approverOptions} placeholder="Chọn owner chặng 1" />
          </Form.Item>
          <Form.Item name="stage_one_delegate_user_id" label="Delegate chặng 1">
            <Select allowClear options={approverOptions} placeholder="Chọn delegate chặng 1" />
          </Form.Item>
          <Form.Item name="stage_one_rotation_user_ids" label="Vòng xoay chặng 1">
            <Select mode="multiple" allowClear options={approverOptions} placeholder="Chọn người duyệt xoay vòng" />
          </Form.Item>
          <Form.Item name="stage_two_primary_user_id" label="Owner chặng 2">
            <Select allowClear options={approverOptions} placeholder="Chọn owner chặng 2" />
          </Form.Item>
          <Form.Item name="stage_two_delegate_user_id" label="Delegate chặng 2">
            <Select allowClear options={approverOptions} placeholder="Chọn delegate chặng 2" />
          </Form.Item>
          <Form.Item name="stage_two_rotation_user_ids" label="Vòng xoay chặng 2">
            <Select mode="multiple" allowClear options={approverOptions} placeholder="Chọn người duyệt xoay vòng chặng 2" />
          </Form.Item>
          <Form.Item name="fallback_team_tokens_text" label="Mã nhóm fallback">
            <Input.TextArea rows={3} placeholder="FINANCE, CONTROL, OPS" />
          </Form.Item>
          <Form.Item name="notes" label="Ghi chú">
            <Input.TextArea rows={4} placeholder="Ghi chú owner/delegate cho định tuyến và escalation." />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title={editingAvailability ? 'Chỉnh sửa độ phủ người duyệt' : 'Tạo độ phủ người duyệt'}
        open={availabilityDrawerOpen}
        onClose={() => {
          setAvailabilityDrawerOpen(false);
          setEditingAvailability(null);
          availabilityForm.resetFields();
        }}
        width={440}
        extra={(
          <Space>
            <Button onClick={() => {
              setAvailabilityDrawerOpen(false);
              setEditingAvailability(null);
              availabilityForm.resetFields();
            }}
            >
              Hủy
            </Button>
            <Button type="primary" loading={saveAvailabilityMutation.isPending} onClick={() => void handleSaveAvailability()}>
              Lưu độ phủ
            </Button>
          </Space>
        )}
      >
        <Form form={availabilityForm} layout="vertical" initialValues={DEFAULT_AVAILABILITY_VALUES}>
          <Form.Item name="user_id" label="Người duyệt" rules={[{ required: true, message: 'Chọn người duyệt.' }]}>
            <Select showSearch options={approverOptions} placeholder="Chọn approver" disabled={Boolean(editingAvailability)} />
          </Form.Item>
          <Form.Item name="is_out_of_office" label="Đánh dấu vắng mặt" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="starts_at" label="Bắt đầu">
                <Input type="datetime-local" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="ends_at" label="Kết thúc">
                <Input type="datetime-local" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="backup_user_id" label="Người duyệt dự phòng">
            <Select allowClear options={approverOptions} placeholder="Chọn approver dự phòng" />
          </Form.Item>
          <Form.Item name="label" label="Nhãn độ phủ">
            <Input placeholder="Vắng mặt - hội thảo, bàn giao ca, nghỉ phép..." />
          </Form.Item>
          <Form.Item name="notes" label="Ghi chú">
            <Input.TextArea rows={4} placeholder="Thêm ghi chú cho delegate hoặc handoff xoay vòng." />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title="Chính sách tự động hóa"
        open={automationDrawerOpen}
        onClose={() => setAutomationDrawerOpen(false)}
        width={420}
        extra={(
          <Space>
            <Button onClick={() => setAutomationDrawerOpen(false)}>Hủy</Button>
            <Button type="primary" loading={saveAutomationPolicyMutation.isPending} onClick={() => void handleSaveAutomationPolicy()}>
              Lưu chính sách
            </Button>
          </Space>
        )}
      >
        <Form form={automationPolicyForm} layout="vertical" initialValues={DEFAULT_AUTOMATION_POLICY_VALUES}>
          <Form.Item name="enabled" label="Bật tự động hóa" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="auto_revoke_expired" label="Tự thu hồi ngoại lệ đã hết hạn" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="reminder_offsets_text" label="Mốc nhắc việc" rules={[{ required: true, message: 'Nhập ít nhất một mốc nhắc.' }]}>
            <Input placeholder="7, 3, 1" />
          </Form.Item>
          <Form.Item name="renewal_window_days" label="Cửa sổ gia hạn (ngày)" rules={[{ required: true, message: 'Nhập cửa sổ gia hạn.' }]}>
            <Input type="number" min={1} max={30} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="approval_warning_window_hours" label="Cảnh báo duyệt (giờ)" rules={[{ required: true, message: 'Nhập mốc cảnh báo SLA.' }]}>
                <Input type="number" min={1} max={72} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="approval_escalation_delay_hours" label="Leo thang sau quá hạn (giờ)" rules={[{ required: true, message: 'Nhập mốc leo thang.' }]}>
                <Input type="number" min={1} max={72} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="continuity_drill_enabled" label="Bật continuity drill" valuePropName="checked"><Switch /></Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="continuity_drill_interval_days" label="Chu kỳ drill (ngày)" rules={[{ required: true, message: 'Nhập chu kỳ drill.' }]}>
                <Input type="number" min={1} max={30} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="continuity_drill_warning_days" label="Cảnh báo trước hạn (ngày)" rules={[{ required: true, message: 'Nhập số ngày cảnh báo.' }]}>
                <Input type="number" min={1} max={14} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="notify_target_user" label="Gửi cho người nhận quyền" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="notify_requested_by" label="Gửi cho người tạo yêu cầu" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="notify_approver" label="Gửi cho approver" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="notify_requester_for_sla" label="Gửi cho requester khi chạm SLA" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="notify_active_approver_for_sla" label="Gửi cho approver đang xử lý khi chạm SLA" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="notify_directory_owners_for_sla" label="Gửi cho owner danh bạ khi chạm SLA" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="notify_directory_owners_for_continuity" label="Gửi cho owner danh bạ khi có continuity drill" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="auto_prepare_playbooks" label="Tự chuẩn bị playbook" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Drawer>

      <Modal
        title={decisionState ? `${decisionState.mode === 'approve' ? 'Phê duyệt' : decisionState.mode === 'reject' ? 'Từ chối' : 'Thu hồi'} ngoại lệ truy cập` : ''}
        open={Boolean(decisionState)}
        onCancel={() => {
          setDecisionState(null);
          decisionForm.resetFields();
        }}
        onOk={() => void handleDecision()}
        okText={decisionState?.mode === 'approve' ? 'Phê duyệt' : decisionState?.mode === 'reject' ? 'Từ chối' : 'Thu hồi'}
        okButtonProps={{ danger: decisionState?.mode !== 'approve', loading: decideMutation.isPending || revokeMutation.isPending }}
      >
        {decisionState ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              showIcon
              type={decisionState.mode === 'approve' ? 'info' : decisionState.mode === 'reject' ? 'warning' : 'error'}
              message={decisionState.request.target_user.full_name || decisionState.request.target_user.username}
              description={`${decisionState.request.policy.name} | ${decisionState.request.status_label}`}
            />
            {decisionState.request.requires_approval ? (
              <Alert
                showIcon
                type={decisionState.request.is_stage_overdue ? 'warning' : 'info'}
                message={`${decisionState.request.current_stage_label} · Chặng ${decisionState.request.current_stage}/${decisionState.request.total_stages}`}
                description={
                  decisionState.mode === 'approve' && decisionState.request.current_stage < decisionState.request.total_stages
                    ? `Lần phê duyệt này sẽ route request sang ${decisionState.request.approval_path.find((item) => item.level === decisionState.request.current_stage + 1)?.label || `chặng ${decisionState.request.current_stage + 1}`}.`
                    : `Người duyệt hiện tại: ${decisionState.request.active_approver?.full_name || decisionState.request.active_approver?.username || 'Chưa gán'}.`
                }
              />
            ) : null}
            <Form form={decisionForm} layout="vertical"><Form.Item name="note" label="Ghi chú quyết định"><Input.TextArea rows={4} /></Form.Item></Form>
          </Space>
        ) : null}
      </Modal>

      <Modal
        title={renewalState ? `Gia hạn ${renewalState.policy.name}` : 'Gia hạn ngoại lệ truy cập'}
        open={Boolean(renewalState)}
        onCancel={() => {
          setRenewalState(null);
          renewalForm.resetFields();
        }}
        onOk={() => void handleRenewal()}
        okText="Tạo yêu cầu gia hạn"
        okButtonProps={{ loading: createRenewalMutation.isPending }}
      >
        {renewalState ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              showIcon
              type="info"
              message={renewalState.target_user.full_name || renewalState.target_user.username}
              description={`${renewalState.policy.name} | cửa sổ hiện tại kết thúc ${formatDateTime(renewalState.planned_expires_at)}`}
            />
            {renewalState.routing?.summary ? (
              <Alert
                showIcon
                type="info"
                message={`${renewalState.routing.department_label} đang dùng định tuyến ủy quyền`}
                description={`${renewalState.routing.summary}${renewalState.routing.target_team_codes.length ? ` | Teams ${renewalState.routing.target_team_codes.join(', ')}` : ''}`}
              />
            ) : null}
            <Form form={renewalForm} layout="vertical" initialValues={DEFAULT_RENEWAL_VALUES}>
              <Form.Item
                name="approver_user_id"
                label={`${renewalState.stage_one_label || 'Người duyệt'} (không bắt buộc)`}
                extra="Để trống nếu muốn hệ thống route lại chặng 1."
              >
                <Select allowClear options={approverOptions} placeholder="Chọn approver hoặc để hệ thống tự route" />
              </Form.Item>
              {renewalState.total_stages > 1 ? (
                <Form.Item
                  name="stage_two_approver_user_id"
                  label={`${renewalState.stage_two_label || 'Người duyệt chặng 2'} (không bắt buộc)`}
                  extra="Để trống nếu muốn delegated routing chọn approver chặng 2 độc lập."
                >
                  <Select allowClear options={approverOptions} placeholder="Chọn approver chặng 2 hoặc để hệ thống tự route" />
                </Form.Item>
              ) : null}
              <Form.Item name="duration_days" label="Thời hạn (ngày)" rules={[{ required: true, message: 'Nhập thời hạn.' }]}>
                <Input type="number" min={1} />
              </Form.Item>
              <Form.Item name="ticket_ref" label="Mã ticket">
                <Input placeholder="INC-2048" />
              </Form.Item>
              <Form.Item name="justification" label="Lý do gia hạn" rules={[{ required: true, message: 'Nhập lý do gia hạn.' }]}>
                <Input.TextArea rows={4} />
              </Form.Item>
            </Form>
          </Space>
        ) : null}
      </Modal>

      <Modal
        title={rerouteState ? `Đổi tuyến ${rerouteState.requestLabel}` : 'Đổi tuyến người duyệt'}
        open={Boolean(rerouteState)}
        onCancel={() => {
          setRerouteState(null);
          rerouteForm.resetFields();
        }}
        onOk={() => void handleReroute()}
        okText="Áp dụng đổi tuyến"
        okButtonProps={{ loading: rerouteMutation.isPending }}
      >
        {rerouteState ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              showIcon
              type="warning"
              message={rerouteState.stageLabel}
              description={`Người duyệt hiện tại: ${rerouteState.currentApproverLabel}`}
            />
            {rerouteState.suggestedApproverLabel ? (
              <Alert
                showIcon
                type="info"
                message={`Đề xuất: ${rerouteState.suggestedApproverLabel}`}
                description={`${rerouteState.suggestedResolutionLabel || 'Đường continuity'}${rerouteState.suggestedSourceLabel ? ` | ${rerouteState.suggestedSourceLabel}` : ''}${rerouteState.suggestedCoverageNote ? ` | ${rerouteState.suggestedCoverageNote}` : ''}`}
              />
            ) : null}
            <Form form={rerouteForm} layout="vertical">
              <Form.Item name="approver_user_id" label="Người duyệt kế tiếp">
                <Select allowClear options={approverOptions} placeholder="Giữ gợi ý hiện tại hoặc chọn thủ công" />
              </Form.Item>
              <Form.Item name="note" label="Ghi chú đổi tuyến">
                <Input.TextArea rows={4} placeholder="Ghi lý do đổi tuyến và continuity handoff." />
              </Form.Item>
            </Form>
          </Space>
        ) : null}
      </Modal>
    </>
  );
}

function PreviewPanel({ previewData }: { previewData: AccessExceptionPreviewResponse }) {
  return (
    <div style={{ marginTop: 12 }}>
      {previewData.warnings.length ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message="Warnings"
          description={<List size="small" dataSource={previewData.warnings} renderItem={(item) => <List.Item>{item}</List.Item>} />}
        />
      ) : null}
      {previewData.routing_recommendation ? (
        <Card size="small" title="Delegated routing" style={{ marginBottom: 12 }}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Text strong>{previewData.routing_recommendation.department_label}</Text>
            <Text type="secondary">{previewData.routing_recommendation.routing_summary}</Text>
            <Text type="secondary">
              {previewData.policy.stage_one_label}: {previewData.routing_recommendation.stage_one_strategy_label}
              {previewData.summary.approval_stage_count > 1 ? ` | ${previewData.policy.stage_two_label}: ${previewData.routing_recommendation.stage_two_strategy_label}` : ''}
            </Text>
            <Text type="secondary">
              {previewData.routing_recommendation.selected_stage_one_source_label}
              {previewData.summary.approval_stage_count > 1 ? ` | ${previewData.routing_recommendation.selected_stage_two_source_label}` : ''}
            </Text>
            <Space size={8} wrap>
              {previewData.routing_recommendation.auto_selected_stage_one ? <Tag color="cyan">Tự chọn chặng 1</Tag> : null}
              {previewData.routing_recommendation.auto_selected_stage_two ? <Tag color="purple">Tự chọn chặng 2</Tag> : null}
              {previewData.routing_recommendation.selected_stage_one_resolution_label ? <Tag color="magenta">{previewData.routing_recommendation.selected_stage_one_resolution_label}</Tag> : null}
              {previewData.summary.approval_stage_count > 1 && previewData.routing_recommendation.selected_stage_two_resolution_label ? <Tag color="magenta">{previewData.routing_recommendation.selected_stage_two_resolution_label}</Tag> : null}
              {previewData.routing_recommendation.target_teams.map((team) => (
                <Tag key={`${team.id}-${team.code}`}>{team.name || team.code}</Tag>
              ))}
            </Space>
            <Text type="secondary">
                Chặng 1: {previewData.routing_recommendation.selected_stage_one_approver?.full_name || previewData.routing_recommendation.selected_stage_one_approver?.username || 'Chưa xác định'}
            </Text>
            {previewData.routing_recommendation.selected_stage_one_coverage_note ? <Text type="secondary">{previewData.routing_recommendation.selected_stage_one_coverage_note}</Text> : null}
            {previewData.summary.approval_stage_count > 1 ? (
              <>
                <Text type="secondary">
                  Chặng 2: {previewData.routing_recommendation.selected_stage_two_approver?.full_name || previewData.routing_recommendation.selected_stage_two_approver?.username || 'Chưa xác định'}
                </Text>
                {previewData.routing_recommendation.selected_stage_two_coverage_note ? <Text type="secondary">{previewData.routing_recommendation.selected_stage_two_coverage_note}</Text> : null}
              </>
            ) : null}
          </Space>
        </Card>
      ) : null}
      <Row gutter={[12, 12]}>
        <Col span={12}>
          <Card size="small" title="Before">
            <Paragraph type="secondary">Roles</Paragraph>
            {renderCompactTags(previewData.roles_before, 'Không có vai trò')}
            <Paragraph type="secondary" style={{ marginTop: 12 }}>Teams</Paragraph>
            {renderCompactTags(previewData.teams_before, 'Không có nhóm')}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="After">
            <Paragraph type="secondary">Roles</Paragraph>
            {renderCompactTags(previewData.roles_after, 'Không có vai trò')}
            <Paragraph type="secondary" style={{ marginTop: 12 }}>Teams</Paragraph>
            {renderCompactTags(previewData.teams_after, 'Không có nhóm')}
          </Card>
        </Col>
      </Row>
      {previewData.approval_path.length ? (
        <Card size="small" title="Approval ladder" style={{ marginTop: 12 }}>
          <List
            size="small"
            dataSource={previewData.approval_path}
            renderItem={(item) => (
              <List.Item>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <Space size={8} wrap>
                    <Tag color={approvalStatusColor(item.status)}>{`Stage ${item.level}`}</Tag>
                    <Text strong>{item.label}</Text>
                  </Space>
                  <Text type="secondary">{item.approver?.full_name || item.approver?.username || 'Chua gan approver'}</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      ) : null}
    </div>
  );
}
