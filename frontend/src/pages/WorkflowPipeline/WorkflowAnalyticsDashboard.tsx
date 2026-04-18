import { useMemo, useState, type CSSProperties } from 'react';
import { BarChartOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Empty, Input, InputNumber, List, Modal, Row, Select, Space, Spin, Statistic, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  type WorkflowAutomationProfileConfig,
  type WorkflowAutomationScheduleSlot,
  type WorkflowAutomationRunHistoryItem,
  type WftTrigger,
  WFT_TRIGGER_LABELS,
  workflowTaskTemplatesApi,
  type WorkflowInsightExecutionHistoryItem,
  type WorkflowPipelineStepMetric,
} from '../../api/workflowTaskTemplates';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { SafeText as Text } from '../../components/SafeText';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getEntityTypeLabel, PAGES } from '../../utils/constants';
import { storage } from '../../utils/storage';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';

const WINDOW_OPTIONS = [
  { value: 7, label: '7 ngày' },
  { value: 14, label: '14 ngày' },
  { value: 30, label: '30 ngày' },
  { value: 60, label: '60 ngày' },
  { value: 90, label: '90 ngày' },
];

const SUMMARY_TILE_STYLE: CSSProperties = {
  minHeight: 116,
  borderRadius: 18,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  background: 'linear-gradient(160deg, #ffffff 0%, #f7fbff 100%)',
  border: '1px solid #d6e4ff',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.06)',
};

const SUGGESTED_ACTION_LABELS: Record<string, string> = {
  RUN_AUTOMATION: 'Chạy tự động hóa',
  ESCALATE_OVERDUE: 'Nhắc việc quá hạn',
  REBALANCE_ASSIGNEE: 'Cân bằng người phụ trách',
  CHECK_CAPACITY: 'Rà công suất',
};

const INSIGHT_TYPE_LABELS: Record<string, string> = {
  OVERDUE_CLUSTER: 'Cụm quá hạn',
  CAPACITY_RISK: 'Nguy cơ quá tải',
  BLOCKING_SPIKE: 'Tăng thẻ chặn',
  FAILED_CLUSTER: 'Cụm thất bại',
  STALE_WIP: 'Tồn đọng chậm cập nhật',
  SLA_BREACH: 'Vi phạm SLA',
};

const AUTOMATION_RUN_MODE_LABELS: Record<string, string> = {
  ALL: 'Tất cả chế độ',
  MANUAL_PROFILE: 'Chạy tay theo ca',
  SCHEDULE: 'Lịch nền',
};

type WorkflowAnalyticsHistoryAction = 'ALL' | 'RUN_AUTOMATION' | 'ESCALATE_OVERDUE' | 'REBALANCE_ASSIGNEE' | 'CHECK_CAPACITY';
type WorkflowAnalyticsHistorySuccessFilter = 'ALL' | 'SUCCESS' | 'FAILED';
type WorkflowAnalyticsSchedulerHistoryMode = 'ALL' | 'MANUAL_PROFILE' | 'SCHEDULE';
type WorkflowAnalyticsSchedulerIncidentStatus = 'ALL' | 'SUCCESS' | 'FAILED' | 'SKIPPED_LOCKED';
type WorkflowAnalyticsProfileKey = 'MORNING' | 'MIDDAY' | 'EOD' | 'CUSTOM';

const PROFILE_LABELS: Record<WorkflowAnalyticsProfileKey, string> = {
  MORNING: 'Đầu ngày',
  MIDDAY: 'Giữa ngày',
  EOD: 'Cuối ngày',
  CUSTOM: 'Tùy chỉnh',
};

const SCHEDULER_STATUS_LABELS: Record<'SUCCESS' | 'FAILED' | 'SKIPPED_LOCKED', string> = {
  SUCCESS: 'Thành công',
  FAILED: 'Thất bại',
  SKIPPED_LOCKED: 'Bị khóa',
};

const INSIGHT_SEVERITY_LABELS: Record<string, string> = {
  HIGH: 'Cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
};

type WorkflowAnalyticsViewSnapshot = {
  entityType: string;
  trigger: WftTrigger;
  days: number;
  selectedProfileKey: WorkflowAnalyticsProfileKey;
  insightHistoryLimit: number;
  automationHistoryLimit: number;
  schedulerIncidentLimit: number;
  schedulerHistoryMode: WorkflowAnalyticsSchedulerHistoryMode;
  schedulerIncidentStatus: WorkflowAnalyticsSchedulerIncidentStatus;
  schedulerHealthHours: number;
  historyActorQuery: string;
  historySuggestedAction: WorkflowAnalyticsHistoryAction;
  historySuccessFilter: WorkflowAnalyticsHistorySuccessFilter;
};

type WorkflowAnalyticsNamedPreset = {
  id: string;
  name: string;
  snapshot: WorkflowAnalyticsViewSnapshot;
  updatedAt: string;
};

const WORKFLOW_ANALYTICS_PROFILE_KEYS = ['MORNING', 'MIDDAY', 'EOD', 'CUSTOM'] as const;
const WORKFLOW_ANALYTICS_HISTORY_ACTIONS = ['ALL', 'RUN_AUTOMATION', 'ESCALATE_OVERDUE', 'REBALANCE_ASSIGNEE', 'CHECK_CAPACITY'] as const;
const WORKFLOW_ANALYTICS_HISTORY_SUCCESS_FILTERS = ['ALL', 'SUCCESS', 'FAILED'] as const;
const WORKFLOW_ANALYTICS_SCHEDULER_HISTORY_MODES = ['ALL', 'MANUAL_PROFILE', 'SCHEDULE'] as const;
const WORKFLOW_ANALYTICS_SCHEDULER_INCIDENT_STATUSES = ['ALL', 'SUCCESS', 'FAILED', 'SKIPPED_LOCKED'] as const;

function isWorkflowAnalyticsProfileKey(value: unknown): value is WorkflowAnalyticsProfileKey {
  return typeof value === 'string' && (WORKFLOW_ANALYTICS_PROFILE_KEYS as readonly string[]).includes(value);
}

function isWorkflowAnalyticsHistoryAction(value: unknown): value is WorkflowAnalyticsHistoryAction {
  return typeof value === 'string' && (WORKFLOW_ANALYTICS_HISTORY_ACTIONS as readonly string[]).includes(value);
}

function isWorkflowAnalyticsHistorySuccessFilter(value: unknown): value is WorkflowAnalyticsHistorySuccessFilter {
  return typeof value === 'string' && (WORKFLOW_ANALYTICS_HISTORY_SUCCESS_FILTERS as readonly string[]).includes(value);
}

function isWorkflowAnalyticsSchedulerHistoryMode(value: unknown): value is WorkflowAnalyticsSchedulerHistoryMode {
  return typeof value === 'string' && (WORKFLOW_ANALYTICS_SCHEDULER_HISTORY_MODES as readonly string[]).includes(value);
}

function isWorkflowAnalyticsSchedulerIncidentStatus(value: unknown): value is WorkflowAnalyticsSchedulerIncidentStatus {
  return typeof value === 'string' && (WORKFLOW_ANALYTICS_SCHEDULER_INCIDENT_STATUSES as readonly string[]).includes(value);
}

function parseWorkflowAnalyticsViewSnapshot(value: unknown): WorkflowAnalyticsViewSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const snapshot = value as Partial<WorkflowAnalyticsViewSnapshot>;
  if (
    typeof snapshot.entityType !== 'string'
    || typeof snapshot.trigger !== 'string'
    || !Number.isFinite(snapshot.days)
    || !isWorkflowAnalyticsProfileKey(snapshot.selectedProfileKey)
    || !Number.isFinite(snapshot.insightHistoryLimit)
    || !Number.isFinite(snapshot.automationHistoryLimit)
    || !Number.isFinite(snapshot.schedulerIncidentLimit)
    || !isWorkflowAnalyticsSchedulerHistoryMode(snapshot.schedulerHistoryMode)
    || !isWorkflowAnalyticsSchedulerIncidentStatus(snapshot.schedulerIncidentStatus)
    || !Number.isFinite(snapshot.schedulerHealthHours)
    || typeof snapshot.historyActorQuery !== 'string'
    || !isWorkflowAnalyticsHistoryAction(snapshot.historySuggestedAction)
    || !isWorkflowAnalyticsHistorySuccessFilter(snapshot.historySuccessFilter)
  ) {
    return null;
  }
  return {
    entityType: snapshot.entityType,
    trigger: snapshot.trigger as WftTrigger,
    days: Number(snapshot.days),
    selectedProfileKey: snapshot.selectedProfileKey,
    insightHistoryLimit: Number(snapshot.insightHistoryLimit),
    automationHistoryLimit: Number(snapshot.automationHistoryLimit),
    schedulerIncidentLimit: Number(snapshot.schedulerIncidentLimit),
    schedulerHistoryMode: snapshot.schedulerHistoryMode,
    schedulerIncidentStatus: snapshot.schedulerIncidentStatus,
    schedulerHealthHours: Number(snapshot.schedulerHealthHours),
    historyActorQuery: snapshot.historyActorQuery,
    historySuggestedAction: snapshot.historySuggestedAction,
    historySuccessFilter: snapshot.historySuccessFilter,
  };
}

function normalizeStepTitle(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\{entity_code\}/g, 'mã đối tượng')
    .replace(/\(entity_code\)/g, '(mã đối tượng)')
    .replace(/\{entity_type\}/g, 'loại đối tượng')
    .replace(/\(entity_type\)/g, '(loại đối tượng)')
    .replace(/\{trigger\}/g, 'sự kiện')
    .replace(/\(trigger\)/g, '(sự kiện)')
    .replace(/\bXac nhan thong tin don\b/gi, 'Xác nhận thông tin đơn')
    .replace(/\bLap ke hoach vat tu cho don\b/gi, 'Lập kế hoạch vật tư cho đơn')
    .replace(/\bDieu do san xuat don\b/gi, 'Điều độ sản xuất đơn')
    .replace(/\bQC thanh pham don\b/gi, 'QC thành phẩm đơn')
    .replace(/\bChuan bi giao hang don\b/gi, 'Chuẩn bị giao hàng đơn')
    .replace(/\bma doi tuong\b/gi, 'mã đối tượng');
}

function canManageSchedulerAdmin(): boolean {
  const user = storage.getUser() as unknown;
  if (!user || typeof user !== 'object') return false;
  const u = user as Record<string, unknown>;
  return u.is_staff === true || u.is_superuser === true;
}

function getSuggestedActionLabel(value: string | null | undefined) {
  if (!value) return '-';
  return SUGGESTED_ACTION_LABELS[value] ?? value;
}

function getInsightTypeLabel(value: string | null | undefined) {
  if (!value) return '-';
  return INSIGHT_TYPE_LABELS[value] ?? value;
}

function getAutomationRunModeLabel(value: string | null | undefined) {
  if (!value) return '-';
  return AUTOMATION_RUN_MODE_LABELS[value] ?? value;
}

export default function WorkflowAnalyticsDashboard() {
  const [entityType, setEntityType] = useState<string>('SalesOrder');
  const [trigger, setTrigger] = useState<WftTrigger>('SUBMIT');
  const [days, setDays] = useState<number>(30);
  const [selectedProfileKey, setSelectedProfileKey] = useState<WorkflowAnalyticsProfileKey>('MORNING');
  const [insightHistoryLimit, setInsightHistoryLimit] = useState<number>(10);
  const [automationHistoryLimit, setAutomationHistoryLimit] = useState<number>(10);
  const [schedulerIncidentLimit, setSchedulerIncidentLimit] = useState<number>(20);
  const [profileEdits, setProfileEdits] = useState<Partial<Record<WorkflowAnalyticsProfileKey, WorkflowAutomationProfileConfig>>>({});
  const [schedulerEdits, setSchedulerEdits] = useState<Record<string, { enabled: boolean; slots: WorkflowAutomationScheduleSlot[] }>>({});
  const [schedulerHistoryMode, setSchedulerHistoryMode] = useState<WorkflowAnalyticsSchedulerHistoryMode>('ALL');
  const [schedulerJobEdit, setSchedulerJobEdit] = useState<{ enabled: boolean; interval_minutes: number } | null>(null);
  const [schedulerHealthHours, setSchedulerHealthHours] = useState<number>(24);
  const [schedulerPolicyEdit, setSchedulerPolicyEdit] = useState<{ failure_threshold: number } | null>(null);
  const [schedulerNotifyMessage, setSchedulerNotifyMessage] = useState('');
  const [schedulerIncidentStatus, setSchedulerIncidentStatus] = useState<WorkflowAnalyticsSchedulerIncidentStatus>('ALL');
  const [schedulerSimulateReason, setSchedulerSimulateReason] = useState('');
  const [historyActorQuery, setHistoryActorQuery] = useState('');
  const [historySuggestedAction, setHistorySuggestedAction] = useState<WorkflowAnalyticsHistoryAction>('ALL');
  const [historySuccessFilter, setHistorySuccessFilter] = useState<WorkflowAnalyticsHistorySuccessFilter>('ALL');
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const { config, saveConfig, isLoading: isPreferencesLoading } = useUserPreferences(PAGES.WORKFLOW_ANALYTICS_DASHBOARD);
  const queryClient = useQueryClient();
  const isSchedulerAdmin = useMemo(() => canManageSchedulerAdmin(), []);
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const namedPresets = useMemo<WorkflowAnalyticsNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const preset = item as Partial<WorkflowAnalyticsNamedPreset>;
        const snapshot = parseWorkflowAnalyticsViewSnapshot(preset.snapshot);
        if (typeof preset.id !== 'string' || typeof preset.name !== 'string' || !snapshot) {
          return null;
        }
        return {
          id: preset.id,
          name: preset.name,
          snapshot,
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is WorkflowAnalyticsNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );
  const analyticsPollingInterval = useRealtimePollingInterval({
    enabled: true,
    activeMs: 30_000,
    hiddenMs: false,
  });
  const [historyActorIntent] = useDebouncedValue(historyActorQuery, 450);

  const templatesQuery = useQuery({
    queryKey: ['workflow-active-templates-for-analytics'],
    queryFn: () => workflowTaskTemplatesApi.list({ is_active: true }),
    staleTime: 30_000,
  });
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);

  const availableEntityTypes = useMemo(() => {
    const set = new Set<string>();
    templates.forEach((t) => set.add(t.entity_type));
    return Array.from(set);
  }, [templates]);

  const effectiveEntityType = useMemo(() => {
    if (!templates.length) return entityType;
    if (templates.some((t) => t.entity_type === entityType)) return entityType;
    return templates[0].entity_type;
  }, [templates, entityType]);

  const triggerOptionsForEntity = useMemo(() => {
    const set = new Set<WftTrigger>();
    templates
      .filter((t) => t.entity_type === effectiveEntityType)
      .forEach((t) => set.add(t.trigger));
    const values = Array.from(set);
    return values.map((value) => ({ value, label: WFT_TRIGGER_LABELS[value] ?? value }));
  }, [templates, effectiveEntityType]);

  const effectiveTrigger = useMemo(() => {
    if (!triggerOptionsForEntity.length) return trigger;
    if (triggerOptionsForEntity.some((item) => item.value === trigger)) return trigger;
    return triggerOptionsForEntity[0].value;
  }, [triggerOptionsForEntity, trigger]);

  const analyticsQuery = useQuery({
    queryKey: ['workflow-pipeline-analytics', effectiveEntityType, effectiveTrigger, days],
    queryFn: () =>
      workflowTaskTemplatesApi.getPipelineAnalytics({
        entity_type: effectiveEntityType,
        trigger: effectiveTrigger,
        days,
      }),
    staleTime: 15_000,
    placeholderData: (previousData) => previousData,
    refetchInterval: analyticsPollingInterval,
    refetchIntervalInBackground: false,
  });

  const insightHistoryQuery = useQuery({
    queryKey: [
      'workflow-insight-history',
      effectiveEntityType,
      effectiveTrigger,
      historyActorIntent,
      historySuggestedAction,
      historySuccessFilter,
      insightHistoryLimit,
    ],
    queryFn: () =>
      workflowTaskTemplatesApi.getInsightExecutionHistory({
        entity_type: effectiveEntityType,
        trigger: effectiveTrigger,
        limit: insightHistoryLimit,
        actor_query: historyActorIntent.trim() || undefined,
        suggested_action: historySuggestedAction === 'ALL' ? undefined : historySuggestedAction,
        success: historySuccessFilter === 'ALL' ? undefined : historySuccessFilter === 'SUCCESS',
      }),
    staleTime: 10_000,
    placeholderData: (previousData) => previousData,
    refetchInterval: analyticsPollingInterval,
    refetchIntervalInBackground: false,
  });
  const automationProfilesQuery = useQuery({
    queryKey: ['workflow-automation-profiles', effectiveEntityType, effectiveTrigger],
    queryFn: () => workflowTaskTemplatesApi.getAutomationProfiles({
      entity_type: effectiveEntityType,
      trigger: effectiveTrigger,
    }),
    staleTime: 20_000,
  });
  const automationHistoryQuery = useQuery({
    queryKey: ['workflow-automation-history', effectiveEntityType, effectiveTrigger, schedulerHistoryMode, automationHistoryLimit],
    queryFn: () => workflowTaskTemplatesApi.getAutomationRunHistory({
      entity_type: effectiveEntityType,
      trigger: effectiveTrigger,
      limit: automationHistoryLimit,
      run_mode: schedulerHistoryMode,
    }),
    staleTime: 10_000,
    placeholderData: (previousData) => previousData,
    refetchInterval: analyticsPollingInterval,
    refetchIntervalInBackground: false,
  });
  const automationScheduleQuery = useQuery({
    queryKey: ['workflow-automation-schedule', effectiveEntityType, effectiveTrigger],
    queryFn: () => workflowTaskTemplatesApi.getAutomationSchedule({
      entity_type: effectiveEntityType,
      trigger: effectiveTrigger,
    }),
    staleTime: 20_000,
  });
  const schedulerJobStatusQuery = useQuery({
    queryKey: ['workflow-scheduler-job-status'],
    queryFn: () => workflowTaskTemplatesApi.getSchedulerJobStatus(),
    staleTime: 20_000,
    refetchInterval: analyticsPollingInterval,
    refetchIntervalInBackground: false,
  });
  const schedulerHealthQuery = useQuery({
    queryKey: ['workflow-scheduler-health', schedulerHealthHours],
    queryFn: () => workflowTaskTemplatesApi.getSchedulerHealth({ hours: schedulerHealthHours }),
    staleTime: 10_000,
    placeholderData: (previousData) => previousData,
    refetchInterval: analyticsPollingInterval,
    refetchIntervalInBackground: false,
  });
  const schedulerPolicyQuery = useQuery({
    queryKey: ['workflow-scheduler-policy'],
    queryFn: () => workflowTaskTemplatesApi.getSchedulerPolicy(),
    staleTime: 20_000,
  });
  const schedulerIncidentsQuery = useQuery({
    queryKey: ['workflow-scheduler-incidents', schedulerIncidentStatus, schedulerIncidentLimit],
    queryFn: () => workflowTaskTemplatesApi.getSchedulerIncidents({
      status: schedulerIncidentStatus,
      limit: schedulerIncidentLimit,
    }),
    staleTime: 10_000,
    placeholderData: (previousData) => previousData,
    refetchInterval: analyticsPollingInterval,
    refetchIntervalInBackground: false,
  });

  const runAutomationMutation = useMutation({
    mutationFn: (opts?: {
      remind_overdue?: boolean;
      auto_start_ready?: boolean;
      reminder_cooldown_hours?: number;
    }) =>
      workflowTaskTemplatesApi.runPipelineAutomation({
        entity_type: effectiveEntityType,
        trigger: effectiveTrigger,
        remind_overdue: opts?.remind_overdue ?? true,
        auto_start_ready: opts?.auto_start_ready ?? true,
        reminder_cooldown_hours: opts?.reminder_cooldown_hours ?? 24,
      }),
    onSuccess: (res) => {
      message.success(
        `${res.message} Tự start: ${res.auto_started_count}, nhắc quá hạn: ${res.overdue_reminded_count}, thông báo gửi: ${res.notifications_sent}.`
      );
      void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-insight-history'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-board'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-summary'] });
    },
    onError: () => message.error('Không thể chạy tự động hóa quy trình.'),
  });
  const saveProfilesMutation = useMutation({
    mutationFn: (profiles: Record<WorkflowAnalyticsProfileKey, WorkflowAutomationProfileConfig>) =>
      workflowTaskTemplatesApi.saveAutomationProfiles({
        entity_type: effectiveEntityType,
        trigger: effectiveTrigger,
        profiles,
      }),
    onSuccess: () => {
      message.success('Đã lưu cấu hình ca trực tự động.');
      setProfileEdits({});
      void queryClient.invalidateQueries({ queryKey: ['workflow-automation-profiles'] });
    },
    onError: () => message.error('Không thể lưu cấu hình ca trực.'),
  });
  const runProfileMutation = useMutation({
    mutationFn: (profileKey: WorkflowAnalyticsProfileKey) =>
      workflowTaskTemplatesApi.runAutomationProfile({
        entity_type: effectiveEntityType,
        trigger: effectiveTrigger,
        profile_key: profileKey,
      }),
    onSuccess: (res) => {
      const r = res.result;
      message.success(
        `[${PROFILE_LABELS[res.profile_key as WorkflowAnalyticsProfileKey] ?? res.profile_key}] ${r.message} Tự start: ${r.auto_started_count}, nhắc quá hạn: ${r.overdue_reminded_count}, thông báo gửi: ${r.notifications_sent}.`
      );
      void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-automation-history'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-insight-history'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-board'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-summary'] });
    },
    onError: () => message.error('Không thể chạy kịch bản tự động hóa.'),
  });
  const saveScheduleMutation = useMutation({
    mutationFn: (payload: { enabled: boolean; slots: WorkflowAutomationScheduleSlot[] }) =>
      workflowTaskTemplatesApi.saveAutomationSchedule({
        entity_type: effectiveEntityType,
        trigger: effectiveTrigger,
        enabled: payload.enabled,
        slots: payload.slots,
      }),
    onSuccess: () => {
      message.success('Đã lưu lịch chạy bộ lập lịch.');
      void queryClient.invalidateQueries({ queryKey: ['workflow-automation-schedule'] });
    },
    onError: () => message.error('Không thể lưu lịch chạy bộ lập lịch.'),
  });
  const runDueSchedulerMutation = useMutation({
    mutationFn: (dryRun: boolean) => workflowTaskTemplatesApi.runDueAutomationSchedule({
      dry_run: dryRun,
      entity_type: effectiveEntityType,
      trigger: effectiveTrigger,
    }),
    onSuccess: (res, dryRun) => {
      if (dryRun) {
        message.success(`[DRY-RUN] Có ${res.executed_count} lịch đến hạn.`);
      } else {
        message.success(`Đã chạy bộ lập lịch: ${res.executed_count} lịch đến hạn.`);
        void queryClient.invalidateQueries({ queryKey: ['workflow-automation-history'] });
        void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-analytics'] });
        void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-board'] });
        void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
      }
    },
    onError: () => message.error('Không thể chạy bộ lập lịch.'),
  });
  const saveSchedulerJobMutation = useMutation({
    mutationFn: (payload: { enabled: boolean; interval_minutes: number }) =>
      workflowTaskTemplatesApi.saveSchedulerJobStatus(payload),
    onSuccess: () => {
      message.success('Đã cập nhật scheduler toàn hệ thống.');
      setSchedulerJobEdit(null);
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-job-status'] });
    },
    onError: () => message.error('Không thể cập nhật scheduler toàn hệ thống.'),
  });
  const recoverSchedulerMutation = useMutation({
    mutationFn: (payload: { interval_minutes: number; clear_lock: boolean }) =>
      workflowTaskTemplatesApi.recoverScheduler(payload),
    onSuccess: () => {
      message.success('Đã khôi phục scheduler thành công.');
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-job-status'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-health'] });
    },
    onError: () => message.error('Không thể khôi phục scheduler.'),
  });
  const saveSchedulerPolicyMutation = useMutation({
    mutationFn: (payload: { failure_threshold: number }) =>
      workflowTaskTemplatesApi.saveSchedulerPolicy(payload),
    onSuccess: () => {
      message.success('Đã lưu chính sách tự phục hồi.');
      setSchedulerPolicyEdit(null);
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-policy'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-health'] });
    },
    onError: () => message.error('Không thể lưu chính sách tự phục hồi.'),
  });
  const applySchedulerPolicyPresetMutation = useMutation({
    mutationFn: (presetKey: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE') =>
      workflowTaskTemplatesApi.applySchedulerPolicyPreset({ preset_key: presetKey }),
    onSuccess: (res) => {
      message.success(`Đã áp dụng cấu hình mẫu ${res.preset_key}.`);
      setSchedulerPolicyEdit(null);
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-policy'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-health'] });
    },
    onError: () => message.error('Không thể áp dụng cấu hình mẫu của chính sách.'),
  });
  const notifySchedulerAdminsMutation = useMutation({
    mutationFn: (payload: { message: string }) => workflowTaskTemplatesApi.notifySchedulerAdmins(payload),
    onSuccess: (res) => {
      message.success(`Đã gửi cảnh báo tới ${res.notified_admin_count} tài khoản quản trị.`);
      setSchedulerNotifyMessage('');
    },
    onError: () => message.error('Không thể gửi cảnh báo quản trị.'),
  });
  const simulateSchedulerFailureMutation = useMutation({
    mutationFn: (reason: string) =>
      workflowTaskTemplatesApi.simulateSchedulerFailure({ reason }),
    onSuccess: (res) => {
      message.success(`Đã mô phỏng lỗi bộ lập lịch. Tự phục hồi: ${res.auto_recovery?.disabled ? 'đã tự tắt job' : 'chưa tắt job'}.`);
      setSchedulerSimulateReason('');
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-health'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-job-status'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-incidents'] });
    },
    onError: () => message.error('Không thể mô phỏng lỗi scheduler.'),
  });

  const executeInsightMutation = useMutation({
    mutationFn: (params: { insight_type: string; suggested_action: string }) =>
      workflowTaskTemplatesApi.executeInsightAction({
        entity_type: effectiveEntityType,
        trigger: effectiveTrigger,
        insight_type: params.insight_type,
        suggested_action: params.suggested_action,
      }),
    onSuccess: (res) => {
      if (res.manual_action) {
        message.success(res.message || 'Đã ghi nhận hành động thủ công.');
      } else {
        message.success(
          `${res.message || 'Đã thực thi gợi ý.'} Tự start: ${res.auto_started_count ?? 0}, nhắc quá hạn: ${res.overdue_reminded_count ?? 0}, thông báo gửi: ${res.notifications_sent ?? 0}.`
        );
      }
      void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-board'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-summary'] });
    },
    onError: () => message.error('Không thể thực thi gợi ý.'),
  });
  const executeBatchMutation = useMutation({
    mutationFn: (items: Array<{ insight_type: string; suggested_action: string }>) =>
      workflowTaskTemplatesApi.executeInsightBatch({
        entity_type: effectiveEntityType,
        trigger: effectiveTrigger,
        stop_on_error: false,
        items,
      }),
    onSuccess: (res) => {
      message.success(`Đã chạy batch gợi ý: thành công ${res.success_count}/${res.total}, lỗi ${res.failed_count}.`);
      const failed = res.results.filter((item) => !item.success);
      if (failed.length > 0) {
        Modal.warning({
          title: 'Chi tiết lỗi batch',
          width: 760,
          content: (
            <div style={{ maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
              {failed.map((f) => `${getInsightTypeLabel(f.insight_type)} / ${getSuggestedActionLabel(f.suggested_action)}: ${f.error || 'Lỗi không xác định'}`).join('\n')}
            </div>
          ),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-insight-history'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-board'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-summary'] });
    },
    onError: () => message.error('Không thể thực thi batch gợi ý.'),
  });

  const executeInsight = (insight: {
    suggested_action?: string;
    type: string;
    message: string;
  }) => {
    const action = insight.suggested_action ?? '';
    if (!action) {
      message.info(insight.message);
      return;
    }
    executeInsightMutation.mutate({
      insight_type: insight.type,
      suggested_action: action,
    });
  };
  const executeAllSuggested = () => {
    const items = insights
      .filter((insight) => !!insight.suggested_action)
      .map((insight) => ({
        insight_type: insight.type,
        suggested_action: String(insight.suggested_action),
      }));
    if (!items.length) {
      message.info('Không có gợi ý nào có thể thực thi tự động.');
      return;
    }
    Modal.confirm({
      title: 'Thực thi tất cả gợi ý khả dụng',
      content: `Bạn có chắc muốn chạy ${items.length} gợi ý cho ${getEntityTypeLabel(effectiveEntityType)} / ${WFT_TRIGGER_LABELS[effectiveTrigger] ?? effectiveTrigger}?`,
      okText: 'Thực thi',
      cancelText: 'Hủy',
      onOk: () => executeBatchMutation.mutate(items),
    });
  };

  const columns: ColumnsType<WorkflowPipelineStepMetric> = [
    {
      title: 'Công đoạn',
      dataIndex: 'title',
      key: 'title',
      render: (v: string) => normalizeStepTitle(v),
    },
    { title: 'Tổng việc', dataIndex: 'total_tasks', key: 'total_tasks', width: 100 },
    { title: 'Hoàn thành', dataIndex: 'done_tasks', key: 'done_tasks', width: 100 },
    { title: 'Đang làm', dataIndex: 'in_progress_tasks', key: 'in_progress_tasks', width: 100 },
    { title: 'Cần làm', dataIndex: 'todo_tasks', key: 'todo_tasks', width: 90 },
    { title: 'Thất bại', dataIndex: 'failed_tasks', key: 'failed_tasks', width: 90 },
    { title: 'Quá hạn mở', dataIndex: 'overdue_open_tasks', key: 'overdue_open_tasks', width: 100 },
    {
      title: 'Mục tiêu SLA (giờ)',
      dataIndex: 'target_cycle_time_hours',
      key: 'target_cycle_time_hours',
      width: 120,
      render: (v: number | null) => (v ? v.toFixed(2) : '-'),
    },
    {
      title: 'Chu kỳ TB (giờ)',
      dataIndex: 'avg_cycle_time_hours',
      key: 'avg_cycle_time_hours',
      width: 120,
      render: (v: number) => v.toFixed(2),
    },
    {
      title: 'Chu kỳ P95 (giờ)',
      dataIndex: 'p95_cycle_time_hours',
      key: 'p95_cycle_time_hours',
      width: 120,
      render: (v: number) => v.toFixed(2),
    },
    {
      title: 'Vi phạm SLA',
      key: 'sla_breach',
      width: 130,
      render: (_, row) => {
        if (!row.target_cycle_time_hours) return '-';
        const color = row.breach_rate_percent >= 30 ? 'error' : row.breach_rate_percent >= 10 ? 'gold' : 'green';
        return (
          <Tag color={color}>
            {row.breached_count}/{row.done_tasks} ({row.breach_rate_percent.toFixed(2)}%)
          </Tag>
        );
      },
    },
  ];

  const summary = analyticsQuery.data?.summary;
  const bottlenecks = analyticsQuery.data?.bottlenecks ?? [];
  const insights = analyticsQuery.data?.insights ?? [];
  const actionCounts = analyticsQuery.data?.action_counts ?? {};
  const profiles = automationProfilesQuery.data?.profiles;
  const schedulerKey = `${effectiveEntityType}:${effectiveTrigger}`;
  const schedulerDraft = useMemo(() => {
    if (schedulerEdits[schedulerKey]) return schedulerEdits[schedulerKey];
    const cfg = automationScheduleQuery.data;
    if (!cfg) {
      return {
        enabled: false,
        slots: [
          { profile_key: 'MORNING', time: '08:00', active: true },
          { profile_key: 'MIDDAY', time: '13:00', active: false },
          { profile_key: 'EOD', time: '17:30', active: true },
        ] as WorkflowAutomationScheduleSlot[],
      };
    }
    return { enabled: cfg.enabled, slots: cfg.slots ?? [] };
  }, [automationScheduleQuery.data, schedulerEdits, schedulerKey]);
  const profileDraft = useMemo(() => {
    if (!profiles) return null;
    return profileEdits[selectedProfileKey] ?? profiles[selectedProfileKey];
  }, [profileEdits, profiles, selectedProfileKey]);
  const schedulerJobDraft = useMemo(() => {
    if (schedulerJobEdit) return schedulerJobEdit;
    const status = schedulerJobStatusQuery.data;
    return {
      enabled: status?.enabled ?? true,
      interval_minutes: status?.interval_minutes ?? 5,
    };
  }, [schedulerJobEdit, schedulerJobStatusQuery.data]);
  const schedulerPolicyDraft = useMemo(() => {
    if (schedulerPolicyEdit) return schedulerPolicyEdit;
    return {
      failure_threshold: schedulerPolicyQuery.data?.failure_threshold ?? 3,
    };
  }, [schedulerPolicyEdit, schedulerPolicyQuery.data]);

  const dashboardSummary = useMemo(() => ({
    breachSteps: (analyticsQuery.data?.step_metrics ?? []).filter((item) => item.breach_rate_percent >= 10).length,
    highSeverityInsights: (analyticsQuery.data?.insights ?? []).filter((item) => item.severity === 'HIGH').length,
    activeProfiles: profiles
      ? (Object.keys(profiles) as WorkflowAnalyticsProfileKey[]).filter((key) => {
        const profile = profiles[key];
        return profile.remind_overdue || profile.auto_start_ready;
      }).length
      : 0,
    activeScheduleSlots: schedulerDraft.slots.filter((slot) => slot.active).length,
    schedulerFailures: schedulerHealthQuery.data?.status_counts.FAILED ?? 0,
    schedulerLocked: schedulerHealthQuery.data?.status_counts.SKIPPED_LOCKED ?? 0,
  }), [analyticsQuery.data?.insights, analyticsQuery.data?.step_metrics, profiles, schedulerDraft.slots, schedulerHealthQuery.data?.status_counts.FAILED, schedulerHealthQuery.data?.status_counts.SKIPPED_LOCKED]);

  const dashboardAlert = useMemo(() => {
    if (!summary) {
      return {
        type: 'info' as const,
        message: 'Chưa có đủ dữ liệu để lập bảng điều hành quy trình.',
        description: 'Hãy chọn luồng có mẫu đang bật hoặc tăng khoảng thời gian phân tích.',
      };
    }
    if (summary.overdue_open_tasks > 0 || dashboardSummary.highSeverityInsights > 0 || dashboardSummary.schedulerFailures > 0) {
      return {
        type: 'warning' as const,
        message: 'Trung tâm tự động hóa đang có cảnh báo cần ưu tiên.',
        description: `Hiện có ${summary.overdue_open_tasks} việc mở quá hạn, ${dashboardSummary.highSeverityInsights} cảnh báo mức cao và ${dashboardSummary.schedulerFailures} lần bộ lập lịch thất bại trong phạm vi theo dõi.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Trung tâm tự động hóa đang vận hành ổn định.',
      description: `Tỷ lệ hoàn tất ${summary.completion_rate.toFixed(2)}%, ${dashboardSummary.activeProfiles} kịch bản ca trực đang hoạt động và ${dashboardSummary.activeScheduleSlots} mốc lịch nền đang bật.`,
    };
  }, [dashboardSummary.activeProfiles, dashboardSummary.activeScheduleSlots, dashboardSummary.highSeverityInsights, dashboardSummary.schedulerFailures, summary]);

  const activeContextTags = useMemo(() => {
    const tags = [
      `Đối tượng: ${getEntityTypeLabel(effectiveEntityType)}`,
      `Sự kiện: ${WFT_TRIGGER_LABELS[effectiveTrigger] ?? effectiveTrigger}`,
      `Khoảng phân tích: ${days} ngày`,
      `Ca trực đang chỉnh: ${PROFILE_LABELS[selectedProfileKey]}`,
      `Lịch sử gợi ý: ${insightHistoryLimit} dòng`,
      `Lịch sử scheduler: ${automationHistoryLimit} dòng`,
      `Lịch sử scheduler: ${getAutomationRunModeLabel(schedulerHistoryMode)}`,
    ];
    if (schedulerIncidentStatus !== 'ALL') {
      tags.push(`Sự cố scheduler: ${SCHEDULER_STATUS_LABELS[schedulerIncidentStatus] ?? schedulerIncidentStatus}`);
    }
    if (historySuggestedAction !== 'ALL') {
      tags.push(`Hành động gợi ý: ${getSuggestedActionLabel(historySuggestedAction)}`);
    }
    if (historySuccessFilter !== 'ALL') {
      tags.push(`Kết quả lịch sử: ${historySuccessFilter === 'SUCCESS' ? 'Thành công' : 'Thất bại'}`);
    }
    if (historyActorQuery.trim()) {
      tags.push(`Tài khoản: ${historyActorQuery.trim()}`);
    }
    if (schedulerIncidentStatus !== 'ALL' || schedulerIncidentLimit !== 20) {
      tags.push(`Sự cố scheduler tải ${schedulerIncidentLimit} dòng`);
    }
    return tags;
  }, [
    automationHistoryLimit,
    days,
    effectiveEntityType,
    effectiveTrigger,
    historyActorQuery,
    insightHistoryLimit,
    historySuggestedAction,
    historySuccessFilter,
    schedulerIncidentLimit,
    schedulerHistoryMode,
    schedulerIncidentStatus,
    selectedProfileKey,
  ]);

  const buildCurrentSnapshot = (): WorkflowAnalyticsViewSnapshot => ({
    entityType: effectiveEntityType,
    trigger: effectiveTrigger,
    days,
    selectedProfileKey,
    insightHistoryLimit,
    automationHistoryLimit,
    schedulerIncidentLimit,
    schedulerHistoryMode,
    schedulerIncidentStatus,
    schedulerHealthHours,
    historyActorQuery,
    historySuggestedAction,
    historySuccessFilter,
  });

  const applySnapshot = (snapshot: WorkflowAnalyticsViewSnapshot) => {
    setEntityType(snapshot.entityType);
    setTrigger(snapshot.trigger);
    setDays(snapshot.days);
    setSelectedProfileKey(snapshot.selectedProfileKey);
    setInsightHistoryLimit(Math.max(10, Math.min(50, Math.round(snapshot.insightHistoryLimit))));
    setAutomationHistoryLimit(Math.max(10, Math.min(50, Math.round(snapshot.automationHistoryLimit))));
    setSchedulerIncidentLimit(Math.max(10, Math.min(50, Math.round(snapshot.schedulerIncidentLimit))));
    setSchedulerHistoryMode(snapshot.schedulerHistoryMode);
    setSchedulerIncidentStatus(snapshot.schedulerIncidentStatus);
    setSchedulerHealthHours(snapshot.schedulerHealthHours);
    setHistoryActorQuery(snapshot.historyActorQuery);
    setHistorySuggestedAction(snapshot.historySuggestedAction);
    setHistorySuccessFilter(snapshot.historySuccessFilter);
  };

  const saveCurrentView = async () => {
    await saveConfig({
      ...configRecord,
      saved_view_snapshot: buildCurrentSnapshot(),
      saved_view_saved_at: new Date().toISOString(),
    });
    message.success('Đã lưu chế độ xem hiện tại.');
  };

  const applySavedView = () => {
    const snapshot = parseWorkflowAnalyticsViewSnapshot(configRecord.saved_view_snapshot);
    if (!snapshot) {
      message.info('Chưa có chế độ xem đã lưu.');
      return;
    }
    applySnapshot(snapshot);
    message.success('Đã áp dụng chế độ xem đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      message.warning('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const snapshot = buildCurrentSnapshot();
    const presetId = selectedViewPreset?.id ?? `${Date.now()}`;
    const nextPresets = [
      ...namedPresets.filter((item) => item.id !== presetId),
      {
        id: presetId,
        name,
        snapshot,
        updatedAt: new Date().toISOString(),
      },
    ];
    await saveConfig({
      ...configRecord,
      saved_views: nextPresets,
    });
    setSelectedViewPresetId(presetId);
    setViewPresetName('');
    setIsViewPresetModalOpen(false);
    message.success(`Đã lưu mẫu lọc "${name}".`);
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      message.info('Hãy chọn mẫu lọc cần áp dụng.');
      return;
    }
    applySnapshot(preset.snapshot);
    message.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      message.info('Hãy chọn mẫu lọc cần xóa.');
      return;
    }
    const nextPresets = namedPresets.filter((item) => item.id !== preset.id);
    await saveConfig({
      ...configRecord,
      saved_views: nextPresets,
    });
    setSelectedViewPresetId((current) => (current === preset.id ? undefined : current));
    message.success(`Đã xóa mẫu lọc "${preset.name}".`);
  };

  const exportInsightHistoryCsv = () => {
    const items = insightHistoryQuery.data?.items ?? [];
    if (!items.length) {
      message.warning('Không có dữ liệu lịch sử để xuất.');
      return;
    }
    const headers = [
      'timestamp',
      'actor',
      'actor_username',
      'insight_type',
      'suggested_action',
      'success',
      'manual_action',
      'message',
    ];
    const rows = items.map((item) => [
      item.created_at ?? '',
      item.actor ?? '',
      item.actor_username ?? '',
      item.insight_type ?? '',
      item.suggested_action ?? '',
      item.success ? 'true' : 'false',
      item.manual_action ? 'true' : 'false',
      String(item.message ?? '').replace(/\r?\n/g, ' '),
    ]);
    const escapeCell = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCell(String(cell))).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = dayjs().format('YYYYMMDD_HHmmss');
    a.download = `workflow_insight_history_${effectiveEntityType}_${effectiveTrigger}_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('Đã xuất CSV lịch sử thực thi gợi ý.');
  };
  const exportSchedulerErrorsCsv = () => {
    const items = schedulerHealthQuery.data?.recent_errors ?? [];
    if (!items.length) {
      message.warning('Không có lỗi bộ lập lịch để xuất.');
      return;
    }
    const headers = ['timestamp', 'message'];
    const rows = items.map((item) => [item.created_at ?? '', String(item.message ?? '').replace(/\r?\n/g, ' ')]);
    const escapeCell = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map((cell) => escapeCell(cell)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scheduler_errors_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('Đã xuất CSV lỗi bộ lập lịch.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <Space wrap>
              <BarChartOutlined />
              <Text strong style={{ fontSize: 18 }}>Trung tâm phân tích quy trình</Text>
              <Tag color="blue">{getEntityTypeLabel(effectiveEntityType)}</Tag>
              <Tag>{WFT_TRIGGER_LABELS[effectiveTrigger] ?? effectiveTrigger}</Tag>
            </Space>
            <div style={{ color: '#666', fontSize: 13, marginTop: 6, maxWidth: 760 }}>
              Theo dõi sức khỏe luồng, cảnh báo nghẽn, hiệu quả tự động hóa và trạng thái bộ lập lịch trong một bảng điều hành duy nhất.
            </div>
          </div>
          <Space wrap>
            <Tag color="processing" style={{ marginInlineEnd: 0 }}>
              Tự động cập nhật mỗi 30 giây
            </Tag>
            {analyticsQuery.data?.generated_at ? (
              <Tag style={{ marginInlineEnd: 0 }}>
                Cập nhật lần cuối: {dayjs(analyticsQuery.data.generated_at).format('DD/MM/YYYY HH:mm:ss')}
              </Tag>
            ) : null}
            <Button icon={<ReloadOutlined />} loading={analyticsQuery.isFetching} onClick={() => analyticsQuery.refetch()}>
              Tải lại
            </Button>
            <Button type="primary" loading={runAutomationMutation.isPending} onClick={() => runAutomationMutation.mutate(undefined)}>
              Chạy tự động hóa
            </Button>
          </Space>
        </div>

        <div
          style={{
            marginTop: 12,
            padding: '12px 14px',
            borderRadius: 16,
            border: '1px solid #e5eefc',
            background: 'linear-gradient(180deg, #fcfdff 0%, #f7fbff 100%)',
          }}
        >
          <Space wrap>
            <div data-testid="workflow-analytics-entity-type-filter">
              <Select<string>
                value={entityType}
                onChange={setEntityType}
                style={{ width: 170 }}
                options={(availableEntityTypes.length ? availableEntityTypes : ['SalesOrder', 'PurchaseOrder', 'ProductionOrder', 'Product', 'Customer']).map((v) => ({ value: v, label: getEntityTypeLabel(v) }))}
              />
            </div>
            <div data-testid="workflow-analytics-trigger-filter">
              <Select<WftTrigger>
                value={effectiveTrigger}
                onChange={setTrigger}
                style={{ width: 180 }}
                options={triggerOptionsForEntity}
              />
            </div>
            <div data-testid="workflow-analytics-window-filter">
              <Select<number>
                value={days}
                onChange={setDays}
                style={{ width: 120 }}
                options={WINDOW_OPTIONS}
              />
            </div>
          </Space>
        </div>

        <div
          data-testid="workflow-analytics-command-strip"
          style={{
            marginTop: 12,
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Button data-testid="workflow-analytics-save-view" onClick={() => void saveCurrentView()} disabled={isPreferencesLoading}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="workflow-analytics-restore-view" onClick={applySavedView} disabled={isPreferencesLoading}>
            Áp dụng chế độ đã lưu
          </Button>
          <Button
            data-testid="workflow-analytics-open-preset-modal"
            disabled={isPreferencesLoading}
            onClick={() => {
              setViewPresetName(selectedViewPreset?.name ?? '');
              setIsViewPresetModalOpen(true);
            }}
          >
            Lưu mẫu mới
          </Button>
          <div data-testid="workflow-analytics-preset-select" style={{ display: 'inline-block' }}>
            <Select<string>
              allowClear
              placeholder="Chọn mẫu lọc cá nhân"
              value={selectedViewPresetId}
              onChange={(value) => setSelectedViewPresetId(value)}
              disabled={isPreferencesLoading}
              style={{ width: 220 }}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          </div>
          <Button data-testid="workflow-analytics-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
            Áp dụng mẫu lọc
          </Button>
          <Button danger data-testid="workflow-analytics-delete-preset" onClick={() => void deleteNamedPreset()} disabled={isPreferencesLoading}>
            Xóa mẫu lọc
          </Button>
        </div>

        <Space wrap size={8} style={{ marginTop: 10 }}>
          {activeContextTags.map((tag) => (
            <Tag key={tag} color="processing" style={{ marginInlineEnd: 0 }}>
              {tag}
            </Tag>
          ))}
        </Space>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 12,
            marginTop: 16,
          }}
        >
          {[
            { label: 'Tổng đối tượng', value: summary?.entities_total ?? 0, tone: '#1677ff' },
            { label: 'Việc mở', value: summary?.open_tasks ?? 0, tone: '#0958d9' },
            { label: 'Quá hạn mở', value: summary?.overdue_open_tasks ?? 0, tone: '#cf1322' },
            { label: 'Tỷ lệ hoàn tất', value: summary ? `${summary.completion_rate.toFixed(2)}%` : '0%', tone: '#389e0d' },
            { label: 'Cảnh báo mức cao', value: dashboardSummary.highSeverityInsights, tone: '#c41d7f' },
            { label: 'Công đoạn vi phạm SLA', value: dashboardSummary.breachSteps, tone: '#d46b08' },
            { label: 'Kịch bản đang hoạt động', value: dashboardSummary.activeProfiles, tone: '#531dab' },
            { label: 'Mốc lịch nền bật', value: dashboardSummary.activeScheduleSlots, tone: '#08979c' },
          ].map((tile) => (
            <div key={tile.label} style={SUMMARY_TILE_STYLE}>
              <div style={{ color: '#666', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {tile.label}
              </div>
              <div
                style={{
                  fontSize: typeof tile.value === 'number' ? 30 : 22,
                  lineHeight: 1.1,
                  fontWeight: 700,
                  color: tile.tone,
                }}
              >
                {tile.value}
              </div>
              <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                {typeof tile.value === 'number' && tile.value === 0 ? 'Chưa phát sinh trong phạm vi đang xem' : 'Theo phạm vi phân tích hiện tại'}
              </div>
            </div>
          ))}
        </div>

        <Alert style={{ marginTop: 12 }} type={dashboardAlert.type} showIcon message={dashboardAlert.message} description={dashboardAlert.description} />

        {analyticsQuery.data?.meta?.message ? (
          <div style={{ marginTop: 10 }}>
            <Tag color="gold">{analyticsQuery.data.meta.message}</Tag>
          </div>
        ) : null}
      </Card>

      {analyticsQuery.isLoading ? (
        <Card size="small">
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spin />
          </div>
        </Card>
      ) : !summary ? (
        <Card size="small">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu phân tích." />
        </Card>
      ) : (
        <>
          <Card size="small">
            <Row gutter={[12, 12]}>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Statistic title="Tổng đối tượng" value={summary.entities_total} />
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Statistic title="Đối tượng hoàn tất" value={summary.entities_completed} />
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Statistic title="% hoàn tất" value={summary.completion_rate} suffix="%" precision={2} />
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Statistic title="Thời gian xử lý TB (giờ)" value={summary.avg_lead_time_hours} precision={2} />
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Statistic title="Tuổi việc mở TB (giờ)" value={summary.avg_open_age_hours} precision={2} />
              </Col>
              <Col xs={24} sm={12} md={8} lg={4}>
                <Statistic title="Việc mở / quá hạn" value={`${summary.open_tasks} / ${summary.overdue_open_tasks}`} />
              </Col>
            </Row>
          </Card>

          <Card size="small" title="Cycle time theo công đoạn">
            <Table<WorkflowPipelineStepMetric>
              rowKey="template_id"
              size="small"
              columns={columns}
              dataSource={analyticsQuery.data?.step_metrics ?? []}
              pagination={false}
              scroll={{ x: 980 }}
            />
          </Card>

          <Card size="small" title="Điểm nghẽn (chu kỳ cao nhất)">
            {bottlenecks.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa đủ dữ liệu để xác định điểm nghẽn." />
            ) : (
              <Space wrap>
                {bottlenecks.map((item) => (
                  <Tag key={item.template_id} color="volcano">
                    {normalizeStepTitle(item.title)}: {item.avg_cycle_time_hours.toFixed(2)}h
                  </Tag>
                ))}
              </Space>
            )}
          </Card>

          <Card size="small" title="Cảnh báo chủ động">
            {insights.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <Button type="primary" loading={executeBatchMutation.isPending} onClick={executeAllSuggested}>
                  Thực thi toàn bộ gợi ý khả dụng
                </Button>
              </div>
            )}
            {insights.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có cảnh báo nghẽn đáng kể." />
            ) : (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {insights.map((insight, idx) => (
                  <div
                    key={`${insight.type}-${insight.step_title}-${idx}`}
                    style={{
                      border: '1px solid #f0f0f0',
                      borderRadius: 8,
                      padding: 10,
                      background: '#fafafa',
                    }}
                  >
                    <Space size={8} wrap>
                      <Tag color={insight.severity === 'HIGH' ? 'red' : insight.severity === 'MEDIUM' ? 'gold' : 'blue'}>
                        {INSIGHT_SEVERITY_LABELS[insight.severity] ?? insight.severity}
                      </Tag>
                      <Tag>{getInsightTypeLabel(insight.type)}</Tag>
                      {insight.step_title ? <Tag color="purple">{normalizeStepTitle(insight.step_title)}</Tag> : null}
                    </Space>
                    <div style={{ marginTop: 6, fontSize: 13 }}>{insight.message}</div>
                    {insight.suggested_action ? (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Tag color="blue">Gợi ý: {getSuggestedActionLabel(insight.suggested_action)}</Tag>
                        <Button
                          size="small"
                          type="primary"
                          loading={executeInsightMutation.isPending}
                          onClick={() => executeInsight(insight)}
                        >
                          Thực thi gợi ý
                        </Button>
                      </div>
                    ) : (
                      <div style={{ marginTop: 4, color: '#8c8c8c', fontSize: 12 }}>
                        Không có hành động tự động cho cảnh báo này.
                      </div>
                    )}
                  </div>
                ))}
              </Space>
            )}
          </Card>

          <Card size="small" title="Kịch bản tự động theo ca trực">
            {automationProfilesQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>
            ) : !profiles ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có cấu hình kịch bản tự động." />
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Space wrap>
                  <Select<WorkflowAnalyticsProfileKey>
                    value={selectedProfileKey}
                    onChange={setSelectedProfileKey}
                    style={{ width: 180 }}
                    options={[
                      { value: 'MORNING', label: 'Đầu ngày' },
                      { value: 'MIDDAY', label: 'Giữa ngày' },
                      { value: 'EOD', label: 'Cuối ngày' },
                      { value: 'CUSTOM', label: 'Tùy chỉnh' },
                    ]}
                  />
                  <Button
                    type="primary"
                    loading={runProfileMutation.isPending}
                    onClick={() => runProfileMutation.mutate(selectedProfileKey)}
                  >
                    Chạy kịch bản
                  </Button>
                  <Button
                    loading={saveProfilesMutation.isPending}
                    onClick={() => {
                      if (!profileDraft) return;
                      const nextProfiles = {
                        ...profiles,
                        [selectedProfileKey]: profileDraft,
                      } as Record<WorkflowAnalyticsProfileKey, WorkflowAutomationProfileConfig>;
                      saveProfilesMutation.mutate(nextProfiles);
                    }}
                  >
                    Lưu kịch bản hiện tại
                  </Button>
                  <Button
                    loading={runDueSchedulerMutation.isPending}
                    onClick={() => runDueSchedulerMutation.mutate(true)}
                  >
                    Kiểm tra lịch đến hạn
                  </Button>
                  <Button
                    type="primary"
                    loading={runDueSchedulerMutation.isPending}
                    onClick={() => runDueSchedulerMutation.mutate(false)}
                  >
                    Chạy bộ lập lịch ngay
                  </Button>
                </Space>
                {profileDraft ? (
                  <Space wrap>
                    <Space size={6}>
                      <Text type="secondary">Nhắc quá hạn</Text>
                      <Switch
                        checked={profileDraft.remind_overdue}
                        onChange={(v) => setProfileEdits((prev) => ({
                          ...prev,
                          [selectedProfileKey]: { ...profileDraft, remind_overdue: v },
                        }))}
                        size="small"
                      />
                    </Space>
                    <Space size={6}>
                      <Text type="secondary">Tự start việc sẵn sàng</Text>
                      <Switch
                        checked={profileDraft.auto_start_ready}
                        onChange={(v) => setProfileEdits((prev) => ({
                          ...prev,
                          [selectedProfileKey]: { ...profileDraft, auto_start_ready: v },
                        }))}
                        size="small"
                      />
                    </Space>
                    <Space size={6}>
                      <Text type="secondary">Khoảng nghỉ (giờ)</Text>
                      <InputNumber
                        min={1}
                        max={168}
                        value={profileDraft.reminder_cooldown_hours}
                        onChange={(v) => setProfileEdits((prev) => ({
                          ...prev,
                          [selectedProfileKey]: { ...profileDraft, reminder_cooldown_hours: Number(v || 24) },
                        }))}
                        size="small"
                      />
                    </Space>
                  </Space>
                ) : null}
                <Space wrap>
                  {(Object.keys(profiles) as WorkflowAnalyticsProfileKey[]).map((key) => {
                    const p = profiles[key];
                    return (
                      <Tag key={key} color={selectedProfileKey === key ? 'blue' : 'default'}>
                        {PROFILE_LABELS[key]}: nhắc quá hạn={p.remind_overdue ? 'bật' : 'tắt'}, tự bắt đầu={p.auto_start_ready ? 'bật' : 'tắt'}, khoảng nghỉ={p.reminder_cooldown_hours}h
                      </Tag>
                    );
                  })}
                </Space>
                <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <Text strong>Bộ lập lịch toàn hệ thống</Text>
                    <Space size={6}>
                      <Text type="secondary">Bật job</Text>
                      <Switch
                        checked={schedulerJobDraft.enabled}
                        onChange={(v) => setSchedulerJobEdit({ ...schedulerJobDraft, enabled: v })}
                        size="small"
                      />
                    </Space>
                    <Space size={6}>
                      <Text type="secondary">Chu kỳ (phút)</Text>
                      <InputNumber
                        min={1}
                        max={120}
                        value={schedulerJobDraft.interval_minutes}
                        onChange={(v) => setSchedulerJobEdit({ ...schedulerJobDraft, interval_minutes: Number(v || 5) })}
                        size="small"
                      />
                    </Space>
                    <Button
                      loading={saveSchedulerJobMutation.isPending}
                      onClick={() => saveSchedulerJobMutation.mutate(schedulerJobDraft)}
                    >
                      Cập nhật lịch nền
                    </Button>
                    <Tag color={schedulerJobStatusQuery.data?.enabled ? 'green' : 'default'}>
                      {schedulerJobStatusQuery.data?.enabled ? 'Đang bật' : 'Đang tắt'}
                    </Tag>
                    {schedulerJobStatusQuery.data?.next_run ? (
                      <Tag>Lần chạy kế: {dayjs(schedulerJobStatusQuery.data.next_run).format('DD/MM HH:mm:ss')}</Tag>
                    ) : null}
                    {schedulerJobStatusQuery.data?.lock_active ? <Tag color="gold">Đang có lock chạy</Tag> : null}
                    <Select<number>
                      value={schedulerHealthHours}
                      onChange={setSchedulerHealthHours}
                      style={{ width: 120 }}
                      options={[
                        { value: 6, label: '6h' },
                        { value: 12, label: '12h' },
                        { value: 24, label: '24h' },
                        { value: 72, label: '72h' },
                      ]}
                    />
                    <Space size={6}>
                      <Text type="secondary">Ngưỡng tự tắt</Text>
                      <InputNumber
                        min={1}
                        max={20}
                        value={schedulerPolicyDraft.failure_threshold}
                        onChange={(v) => setSchedulerPolicyEdit({ failure_threshold: Number(v || 3) })}
                        size="small"
                      />
                    </Space>
                    <Button
                      loading={saveSchedulerPolicyMutation.isPending}
                      disabled={!isSchedulerAdmin}
                      onClick={() => saveSchedulerPolicyMutation.mutate(schedulerPolicyDraft)}
                    >
                      Lưu chính sách
                    </Button>
                    <Button
                      loading={applySchedulerPolicyPresetMutation.isPending}
                      disabled={!isSchedulerAdmin}
                      onClick={() => applySchedulerPolicyPresetMutation.mutate('CONSERVATIVE')}
                    >
                      Mẫu an toàn
                    </Button>
                    <Button
                      loading={applySchedulerPolicyPresetMutation.isPending}
                      disabled={!isSchedulerAdmin}
                      onClick={() => applySchedulerPolicyPresetMutation.mutate('BALANCED')}
                    >
                      Mẫu cân bằng
                    </Button>
                    <Button
                      loading={applySchedulerPolicyPresetMutation.isPending}
                      disabled={!isSchedulerAdmin}
                      onClick={() => applySchedulerPolicyPresetMutation.mutate('AGGRESSIVE')}
                    >
                      Mẫu tăng tốc
                    </Button>
                  </Space>
                  {schedulerHealthQuery.isLoading ? (
                    <div style={{ textAlign: 'center', padding: 12 }}><Spin /></div>
                  ) : schedulerHealthQuery.data ? (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Space wrap>
                        <Tag color="green">Thành công: {schedulerHealthQuery.data.status_counts.SUCCESS}</Tag>
                        <Tag color="red">Thất bại: {schedulerHealthQuery.data.status_counts.FAILED}</Tag>
                        <Tag color="default">Bị khóa: {schedulerHealthQuery.data.status_counts.SKIPPED_LOCKED}</Tag>
                        <Tag>Lỗi liên tiếp: {schedulerHealthQuery.data.consecutive_failures}</Tag>
                        <Tag>Thời lượng TB: {schedulerHealthQuery.data.avg_success_duration_ms} ms</Tag>
                        {schedulerHealthQuery.data.last_run_at ? (
                          <Tag>Lần chạy gần nhất: {dayjs(schedulerHealthQuery.data.last_run_at).format('DD/MM HH:mm:ss')}</Tag>
                        ) : null}
                      </Space>
                      {schedulerHealthQuery.data.auto_disabled && (
                        <Space wrap>
                          <Tag color="red">
                            Bộ lập lịch đã tự tắt do lỗi liên tiếp ({schedulerHealthQuery.data.consecutive_failures}/{schedulerHealthQuery.data.failure_threshold ?? 3})
                          </Tag>
                          <Button
                            type="primary"
                            danger
                            disabled={!isSchedulerAdmin}
                            loading={recoverSchedulerMutation.isPending}
                            onClick={() => recoverSchedulerMutation.mutate({
                              interval_minutes: schedulerJobDraft.interval_minutes,
                              clear_lock: true,
                            })}
                          >
                            Khôi phục bộ lập lịch
                          </Button>
                        </Space>
                      )}
                    </Space>
                  ) : null}
                  {(schedulerHealthQuery.data?.recent_errors ?? []).length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Space wrap style={{ marginBottom: 6 }}>
                        <Text type="danger">Lỗi gần nhất:</Text>
                        <Button size="small" onClick={exportSchedulerErrorsCsv}>Xuất CSV lỗi</Button>
                      </Space>
                      <List
                        size="small"
                        dataSource={schedulerHealthQuery.data?.recent_errors ?? []}
                        renderItem={(item) => (
                          <List.Item>
                            <Text type="secondary">
                              {(item.created_at ? dayjs(item.created_at).format('DD/MM HH:mm:ss') : '')} - {item.message}
                            </Text>
                          </List.Item>
                        )}
                      />
                    </div>
                  )}
                  {(schedulerHealthQuery.data?.recommended_actions ?? []).length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Text strong>Gợi ý khôi phục:</Text>
                      <List
                        size="small"
                        dataSource={schedulerHealthQuery.data?.recommended_actions ?? []}
                        renderItem={(item) => (
                          <List.Item>
                            <Text type="secondary">- {item}</Text>
                          </List.Item>
                        )}
                      />
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <Space wrap>
                      <Input
                        value={schedulerNotifyMessage}
                        onChange={(e) => setSchedulerNotifyMessage(e.target.value)}
                        placeholder="Nội dung cảnh báo gửi quản trị"
                        style={{ width: 420 }}
                        suffix={schedulerNotifyMessage ? <QuickClearIcon onClear={() => setSchedulerNotifyMessage('')} title="Xóa nội dung" /> : undefined}
                      />
                      <Button
                        disabled={!isSchedulerAdmin}
                        loading={notifySchedulerAdminsMutation.isPending}
                        onClick={() => notifySchedulerAdminsMutation.mutate({
                          message: schedulerNotifyMessage.trim() || 'Cảnh báo thủ công từ bảng điều khiển bộ lập lịch.',
                        })}
                      >
                        Gửi cảnh báo quản trị
                      </Button>
                      <Input
                        value={schedulerSimulateReason}
                        onChange={(e) => setSchedulerSimulateReason(e.target.value)}
                        placeholder="Lý do mô phỏng lỗi (quản trị)"
                        style={{ width: 320 }}
                        suffix={schedulerSimulateReason ? <QuickClearIcon onClear={() => setSchedulerSimulateReason('')} title="Xóa lý do" /> : undefined}
                      />
                      <Button
                        danger
                        disabled={!isSchedulerAdmin}
                        loading={simulateSchedulerFailureMutation.isPending}
                        onClick={() => simulateSchedulerFailureMutation.mutate(
                          schedulerSimulateReason.trim() || 'Mô phỏng lỗi thủ công từ bảng điều khiển.',
                        )}
                      >
                        Mô phỏng lỗi bộ lập lịch
                      </Button>
                    </Space>
                  </div>
                  {!isSchedulerAdmin && (
                    <Tag color="gold">
                      Tài khoản hiện tại không có quyền quản trị cho các thao tác mô phỏng, khôi phục và cấu hình chính sách.
                    </Tag>
                  )}
                  <div style={{ marginTop: 10, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <Text strong>Dòng thời gian sự cố/khôi phục</Text>
                    <Select<'ALL' | 'SUCCESS' | 'FAILED' | 'SKIPPED_LOCKED'>
                      value={schedulerIncidentStatus}
                      onChange={setSchedulerIncidentStatus}
                        style={{ width: 180 }}
                        options={[
                          { value: 'ALL', label: 'Tất cả trạng thái' },
                          { value: 'SUCCESS', label: 'Thành công' },
                          { value: 'FAILED', label: 'Thất bại' },
                        { value: 'SKIPPED_LOCKED', label: 'Bị khóa' },
                      ]}
                    />
                    <Select<number>
                      value={schedulerIncidentLimit}
                      onChange={setSchedulerIncidentLimit}
                      style={{ width: 120 }}
                      options={[
                        { value: 10, label: '10 dòng' },
                        { value: 20, label: '20 dòng' },
                        { value: 50, label: '50 dòng' },
                      ]}
                    />
                  </Space>
                    {schedulerIncidentsQuery.isLoading ? (
                      <div style={{ textAlign: 'center', padding: 12 }}><Spin /></div>
                    ) : (
                      <List
                        size="small"
                        dataSource={schedulerIncidentsQuery.data?.items ?? []}
                        locale={{ emptyText: 'Chưa có sự cố/recovery trong phạm vi lọc.' }}
                        renderItem={(item) => (
                          <List.Item>
                            <Space direction="vertical" size={2} style={{ width: '100%' }}>
                              <Space wrap>
                                <Tag color={item.status === 'FAILED' ? 'red' : item.status === 'SUCCESS' ? 'green' : 'default'}>
                                  {SCHEDULER_STATUS_LABELS[item.status as 'SUCCESS' | 'FAILED' | 'SKIPPED_LOCKED'] ?? item.status}
                                </Tag>
                                <Tag>{item.event_type || 'JOB_RUN'}</Tag>
                                <Tag>{item.run_mode || '-'}</Tag>
                                <Text type="secondary">{item.duration_ms} ms</Text>
                                <Text type="secondary">{item.created_at ? dayjs(item.created_at).format('DD/MM HH:mm:ss') : ''}</Text>
                              </Space>
                              <Text>{item.message || '-'}</Text>
                              {item.policy_diff && (item.policy_diff.old_failure_threshold !== undefined || item.policy_diff.new_failure_threshold !== undefined) ? (
                                <Text type="secondary">
                                  Ngưỡng chính sách: {String(item.policy_diff.old_failure_threshold ?? '-')} → {String(item.policy_diff.new_failure_threshold ?? '-')}
                                </Text>
                              ) : null}
                            </Space>
                          </List.Item>
                        )}
                      />
                    )}
                  </div>
                </div>
                <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <Text strong>Lịch chạy theo giờ</Text>
                    <Space size={6}>
                      <Text type="secondary">Bật scheduler</Text>
                      <Switch
                        checked={schedulerDraft.enabled}
                        onChange={(v) => setSchedulerEdits((prev) => ({
                          ...prev,
                          [schedulerKey]: { ...schedulerDraft, enabled: v },
                        }))}
                        size="small"
                      />
                    </Space>
                    <Button
                      loading={saveScheduleMutation.isPending}
                      onClick={() => saveScheduleMutation.mutate(schedulerDraft)}
                    >
                      Lưu lịch chạy
                    </Button>
                  </Space>
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {schedulerDraft.slots.map((slot, idx) => (
                      <Space key={`${slot.profile_key}-${idx}`} wrap>
                        <Select<WorkflowAnalyticsProfileKey>
                          value={slot.profile_key}
                          onChange={(v) => {
                            const nextSlots = schedulerDraft.slots.map((s, i) => (i === idx ? { ...s, profile_key: v } : s));
                            setSchedulerEdits((prev) => ({ ...prev, [schedulerKey]: { ...schedulerDraft, slots: nextSlots } }));
                          }}
                          style={{ width: 140 }}
                          options={[
                            { value: 'MORNING', label: PROFILE_LABELS.MORNING },
                            { value: 'MIDDAY', label: PROFILE_LABELS.MIDDAY },
                            { value: 'EOD', label: PROFILE_LABELS.EOD },
                            { value: 'CUSTOM', label: PROFILE_LABELS.CUSTOM },
                          ]}
                        />
                        <Input
                          value={slot.time}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const nextSlots = schedulerDraft.slots.map((s, i) => (i === idx ? { ...s, time: raw } : s));
                            setSchedulerEdits((prev) => ({ ...prev, [schedulerKey]: { ...schedulerDraft, slots: nextSlots } }));
                          }}
                          placeholder="HH:mm"
                          style={{ width: 100 }}
                        />
                        <Space size={6}>
                          <Text type="secondary">Hoạt động</Text>
                          <Switch
                            checked={slot.active}
                            onChange={(v) => {
                              const nextSlots = schedulerDraft.slots.map((s, i) => (i === idx ? { ...s, active: v } : s));
                              setSchedulerEdits((prev) => ({ ...prev, [schedulerKey]: { ...schedulerDraft, slots: nextSlots } }));
                            }}
                            size="small"
                          />
                        </Space>
                      </Space>
                    ))}
                  </Space>
                </div>
                <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <Text strong>Lịch sử chạy kịch bản</Text>
                    <Select<'ALL' | 'MANUAL_PROFILE' | 'SCHEDULE'>
                      value={schedulerHistoryMode}
                      onChange={setSchedulerHistoryMode}
                      style={{ width: 180 }}
                      options={[
                        { value: 'ALL', label: 'Tất cả chế độ' },
                        { value: 'MANUAL_PROFILE', label: 'Chạy tay theo ca' },
                          { value: 'SCHEDULE', label: 'Lịch nền' },
                      ]}
                    />
                    <Select<number>
                      value={automationHistoryLimit}
                      onChange={setAutomationHistoryLimit}
                      style={{ width: 120 }}
                      options={[
                        { value: 10, label: '10 dòng' },
                        { value: 20, label: '20 dòng' },
                        { value: 50, label: '50 dòng' },
                      ]}
                    />
                  </Space>
                  {automationHistoryQuery.isLoading ? (
                    <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
                  ) : (
                      <List<WorkflowAutomationRunHistoryItem>
                        size="small"
                        dataSource={automationHistoryQuery.data?.items ?? []}
                        locale={{ emptyText: 'Chưa có lịch sử chạy kịch bản.' }}
                        renderItem={(item) => (
                          <List.Item>
                            <List.Item.Meta
                              title={(
                                <Space size={8} wrap>
                                  <Tag color="processing">{PROFILE_LABELS[item.profile_key as WorkflowAnalyticsProfileKey] ?? item.profile_key}</Tag>
                                  <Tag color={item.run_mode === 'SCHEDULE' ? 'purple' : 'default'}>
                                    {getAutomationRunModeLabel(item.run_mode)}
                                  </Tag>
                            <Tag>Tự start {item.auto_started_count}</Tag>
                            <Tag>Nhắc quá hạn {item.overdue_reminded_count}</Tag>
                            <Tag>Gửi thông báo {item.notifications_sent}</Tag>
                              </Space>
                            )}
                            description={(
                              <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                                <div>{item.actor || 'Hệ thống'} • {item.created_at ? dayjs(item.created_at).format('DD/MM/YYYY HH:mm') : ''}</div>
                                <div>{item.message || '-'}</div>
                              </div>
                            )}
                          />
                        </List.Item>
                      )}
                    />
                  )}
                </div>
              </Space>
            )}
          </Card>

          <Card size="small" title={`Sự kiện ${days} ngày gần nhất`}>
            {Object.keys(actionCounts).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có sự kiện." />
            ) : (
              <Space wrap>
                {Object.entries(actionCounts).map(([action, count]) => (
                  <Tag key={action}>{getSuggestedActionLabel(action)}: {count}</Tag>
                ))}
              </Space>
            )}
          </Card>

          <Card size="small" title="Lịch sử thực thi gợi ý (mới nhất)">
            <div style={{ marginBottom: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Select<'ALL' | 'RUN_AUTOMATION' | 'ESCALATE_OVERDUE' | 'REBALANCE_ASSIGNEE' | 'CHECK_CAPACITY'>
                value={historySuggestedAction}
                onChange={setHistorySuggestedAction}
                style={{ width: 210 }}
                options={[
                  { value: 'ALL', label: 'Tất cả hành động' },
                  { value: 'RUN_AUTOMATION', label: getSuggestedActionLabel('RUN_AUTOMATION') },
                  { value: 'ESCALATE_OVERDUE', label: getSuggestedActionLabel('ESCALATE_OVERDUE') },
                  { value: 'REBALANCE_ASSIGNEE', label: getSuggestedActionLabel('REBALANCE_ASSIGNEE') },
                  { value: 'CHECK_CAPACITY', label: getSuggestedActionLabel('CHECK_CAPACITY') },
                ]}
              />
              <Select<'ALL' | 'SUCCESS' | 'FAILED'>
                value={historySuccessFilter}
                onChange={setHistorySuccessFilter}
                style={{ width: 150 }}
                options={[
                  { value: 'ALL', label: 'Tất cả kết quả' },
                  { value: 'SUCCESS', label: 'Thành công' },
                  { value: 'FAILED', label: 'Thất bại' },
                ]}
              />
              <Input
                data-testid="workflow-analytics-history-actor-search"
                value={historyActorQuery}
                onChange={(e) => setHistoryActorQuery(e.target.value)}
                style={{ width: 220 }}
                placeholder="Lọc theo tài khoản"
                suffix={historyActorQuery ? <QuickClearIcon onClear={() => setHistoryActorQuery('')} title="Xóa tài khoản" /> : undefined}
              />
              <Select<number>
                value={insightHistoryLimit}
                onChange={setInsightHistoryLimit}
                style={{ width: 120 }}
                options={[
                  { value: 10, label: '10 dòng' },
                  { value: 20, label: '20 dòng' },
                  { value: 50, label: '50 dòng' },
                ]}
              />
              <Button onClick={exportInsightHistoryCsv}>Xuất CSV</Button>
            </div>
            {insightHistoryQuery.isLoading ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <Spin />
              </div>
            ) : (
              <List<WorkflowInsightExecutionHistoryItem>
                dataSource={insightHistoryQuery.data?.items ?? []}
                locale={{ emptyText: 'Chưa có lịch sử thực thi.' }}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={(
                        <Space size={8} wrap>
                          <Tag color={item.success ? 'green' : 'red'}>{item.success ? 'THÀNH CÔNG' : 'THẤT BẠI'}</Tag>
                          <Tag>{getInsightTypeLabel(item.insight_type)}</Tag>
                          <Tag color="blue">{getSuggestedActionLabel(item.suggested_action)}</Tag>
                          {item.manual_action ? <Tag color="gold">THỦ CÔNG</Tag> : <Tag color="processing">TỰ ĐỘNG</Tag>}
                        </Space>
                      )}
                      description={(
                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                          <div>
                            {(item.actor || item.actor_username || 'Không rõ')} • {item.created_at ? dayjs(item.created_at).format('DD/MM/YYYY HH:mm') : ''}
                          </div>
                          <div>{item.message || '-'}</div>
                        </div>
                      )}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </>
      )}
      <Modal
        title="Lưu mẫu lọc"
        open={isViewPresetModalOpen}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
      >
        <Input
          autoFocus
          value={viewPresetName}
          onChange={(event) => setViewPresetName(event.target.value)}
          placeholder="Ví dụ: Điều phối lệnh sản xuất 30 ngày"
          data-testid="workflow-analytics-preset-name"
        />
      </Modal>
    </div>
  );
}
