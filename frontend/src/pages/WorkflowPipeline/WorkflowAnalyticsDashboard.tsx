import { useMemo, useState } from 'react';
import { BarChartOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Col, Empty, Input, InputNumber, List, Modal, Row, Select, Space, Spin, Statistic, Switch, Table, Tag, Typography, message } from 'antd';
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
import { getEntityTypeLabel } from '../../utils/constants';
import { storage } from '../../utils/storage';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';

const { Text } = Typography;

const WINDOW_OPTIONS = [
  { value: 7, label: '7 ngày' },
  { value: 14, label: '14 ngày' },
  { value: 30, label: '30 ngày' },
  { value: 60, label: '60 ngày' },
  { value: 90, label: '90 ngày' },
];

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

export default function WorkflowAnalyticsDashboard() {
  type AutomationProfileKey = 'MORNING' | 'MIDDAY' | 'EOD' | 'CUSTOM';
  const [entityType, setEntityType] = useState<'SalesOrder' | 'Product' | 'Customer'>('SalesOrder');
  const [trigger, setTrigger] = useState<WftTrigger>('SUBMIT');
  const [days, setDays] = useState<number>(30);
  const [selectedProfileKey, setSelectedProfileKey] = useState<AutomationProfileKey>('MORNING');
  const [profileEdits, setProfileEdits] = useState<Partial<Record<AutomationProfileKey, WorkflowAutomationProfileConfig>>>({});
  const [schedulerEdits, setSchedulerEdits] = useState<Record<string, { enabled: boolean; slots: WorkflowAutomationScheduleSlot[] }>>({});
  const [schedulerHistoryMode, setSchedulerHistoryMode] = useState<'ALL' | 'MANUAL_PROFILE' | 'SCHEDULE'>('ALL');
  const [schedulerJobEdit, setSchedulerJobEdit] = useState<{ enabled: boolean; interval_minutes: number } | null>(null);
  const [schedulerHealthHours, setSchedulerHealthHours] = useState<number>(24);
  const [schedulerPolicyEdit, setSchedulerPolicyEdit] = useState<{ failure_threshold: number } | null>(null);
  const [schedulerNotifyMessage, setSchedulerNotifyMessage] = useState('');
  const [schedulerIncidentStatus, setSchedulerIncidentStatus] = useState<'ALL' | 'SUCCESS' | 'FAILED' | 'SKIPPED_LOCKED'>('ALL');
  const [schedulerSimulateReason, setSchedulerSimulateReason] = useState('');
  const [historyActorQuery, setHistoryActorQuery] = useState('');
  const [historySuggestedAction, setHistorySuggestedAction] = useState<'ALL' | 'RUN_AUTOMATION' | 'ESCALATE_OVERDUE' | 'REBALANCE_ASSIGNEE' | 'CHECK_CAPACITY'>('ALL');
  const [historySuccessFilter, setHistorySuccessFilter] = useState<'ALL' | 'SUCCESS' | 'FAILED'>('ALL');
  const queryClient = useQueryClient();
  const isSchedulerAdmin = useMemo(() => canManageSchedulerAdmin(), []);
  const analyticsPollingInterval = useRealtimePollingInterval({
    enabled: true,
    activeMs: 30_000,
    hiddenMs: false,
  });

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
    return templates[0].entity_type as 'SalesOrder' | 'Product' | 'Customer';
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
    refetchInterval: analyticsPollingInterval,
    refetchIntervalInBackground: false,
  });

  const insightHistoryQuery = useQuery({
    queryKey: [
      'workflow-insight-history',
      effectiveEntityType,
      effectiveTrigger,
      historyActorQuery,
      historySuggestedAction,
      historySuccessFilter,
    ],
    queryFn: () =>
      workflowTaskTemplatesApi.getInsightExecutionHistory({
        entity_type: effectiveEntityType,
        trigger: effectiveTrigger,
        limit: 10,
        actor_query: historyActorQuery.trim() || undefined,
        suggested_action: historySuggestedAction === 'ALL' ? undefined : historySuggestedAction,
        success: historySuccessFilter === 'ALL' ? undefined : historySuccessFilter === 'SUCCESS',
      }),
    staleTime: 10_000,
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
    queryKey: ['workflow-automation-history', effectiveEntityType, effectiveTrigger, schedulerHistoryMode],
    queryFn: () => workflowTaskTemplatesApi.getAutomationRunHistory({
      entity_type: effectiveEntityType,
      trigger: effectiveTrigger,
      limit: 10,
      run_mode: schedulerHistoryMode,
    }),
    staleTime: 10_000,
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
    refetchInterval: analyticsPollingInterval,
    refetchIntervalInBackground: false,
  });
  const schedulerPolicyQuery = useQuery({
    queryKey: ['workflow-scheduler-policy'],
    queryFn: () => workflowTaskTemplatesApi.getSchedulerPolicy(),
    staleTime: 20_000,
  });
  const schedulerIncidentsQuery = useQuery({
    queryKey: ['workflow-scheduler-incidents', schedulerIncidentStatus],
    queryFn: () => workflowTaskTemplatesApi.getSchedulerIncidents({
      status: schedulerIncidentStatus,
      limit: 20,
    }),
    staleTime: 10_000,
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
    onError: () => message.error('Không thể chạy automation workflow.'),
  });
  const saveProfilesMutation = useMutation({
    mutationFn: (profiles: Record<AutomationProfileKey, WorkflowAutomationProfileConfig>) =>
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
    mutationFn: (profileKey: AutomationProfileKey) =>
      workflowTaskTemplatesApi.runAutomationProfile({
        entity_type: effectiveEntityType,
        trigger: effectiveTrigger,
        profile_key: profileKey,
      }),
    onSuccess: (res) => {
      const r = res.result;
      message.success(
        `[${res.profile_key}] ${r.message} Tự start: ${r.auto_started_count}, nhắc quá hạn: ${r.overdue_reminded_count}, thông báo gửi: ${r.notifications_sent}.`
      );
      void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-automation-history'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-insight-history'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-board'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-summary'] });
    },
    onError: () => message.error('Không thể chạy profile tự động hóa.'),
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
      message.success('Đã lưu lịch chạy scheduler.');
      void queryClient.invalidateQueries({ queryKey: ['workflow-automation-schedule'] });
    },
    onError: () => message.error('Không thể lưu lịch scheduler.'),
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
        message.success(`Đã chạy scheduler: ${res.executed_count} lịch đến hạn.`);
        void queryClient.invalidateQueries({ queryKey: ['workflow-automation-history'] });
        void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-analytics'] });
        void queryClient.invalidateQueries({ queryKey: ['workflow-pipeline-board'] });
        void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
      }
    },
    onError: () => message.error('Không thể chạy scheduler.'),
  });
  const saveSchedulerJobMutation = useMutation({
    mutationFn: (payload: { enabled: boolean; interval_minutes: number }) =>
      workflowTaskTemplatesApi.saveSchedulerJobStatus(payload),
    onSuccess: () => {
      message.success('Đã cập nhật scheduler global.');
      setSchedulerJobEdit(null);
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-job-status'] });
    },
    onError: () => message.error('Không thể cập nhật scheduler global.'),
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
      message.success('Đã lưu policy auto-recovery.');
      setSchedulerPolicyEdit(null);
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-policy'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-health'] });
    },
    onError: () => message.error('Không thể lưu policy auto-recovery.'),
  });
  const applySchedulerPolicyPresetMutation = useMutation({
    mutationFn: (presetKey: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE') =>
      workflowTaskTemplatesApi.applySchedulerPolicyPreset({ preset_key: presetKey }),
    onSuccess: (res) => {
      message.success(`Đã áp dụng preset ${res.preset_key}.`);
      setSchedulerPolicyEdit(null);
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-policy'] });
      void queryClient.invalidateQueries({ queryKey: ['workflow-scheduler-health'] });
    },
    onError: () => message.error('Không thể áp dụng preset policy.'),
  });
  const notifySchedulerAdminsMutation = useMutation({
    mutationFn: (payload: { message: string }) => workflowTaskTemplatesApi.notifySchedulerAdmins(payload),
    onSuccess: (res) => {
      message.success(`Đã gửi cảnh báo tới ${res.notified_admin_count} tài khoản quản trị.`);
      setSchedulerNotifyMessage('');
    },
    onError: () => message.error('Không thể gửi cảnh báo admin.'),
  });
  const simulateSchedulerFailureMutation = useMutation({
    mutationFn: (reason: string) =>
      workflowTaskTemplatesApi.simulateSchedulerFailure({ reason }),
    onSuccess: (res) => {
      message.success(`Đã mô phỏng lỗi scheduler. Auto-recovery: ${res.auto_recovery?.disabled ? 'đã tự tắt job' : 'chưa tắt job'}.`);
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
              {failed.map((f) => `${f.insight_type} / ${f.suggested_action}: ${f.error || 'Lỗi không xác định'}`).join('\n')}
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
      message.warning('Không có lỗi scheduler để xuất.');
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
    message.success('Đã xuất CSV lỗi scheduler.');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Space wrap>
            <BarChartOutlined />
            <Text strong style={{ fontSize: 16 }}>Phân tích quy trình</Text>
            <Tag color="blue">{getEntityTypeLabel(effectiveEntityType)}</Tag>
            <Tag>{WFT_TRIGGER_LABELS[effectiveTrigger] ?? effectiveTrigger}</Tag>
          </Space>
          <Space wrap>
            <Select<'SalesOrder' | 'Product' | 'Customer'>
              value={entityType}
              onChange={setEntityType}
              style={{ width: 170 }}
              options={(availableEntityTypes.length ? availableEntityTypes : ['SalesOrder', 'Product', 'Customer']).map((v) => ({ value: v, label: getEntityTypeLabel(v) }))}
            />
            <Select<WftTrigger>
              value={effectiveTrigger}
              onChange={setTrigger}
              style={{ width: 180 }}
              options={triggerOptionsForEntity}
            />
            <Select<number>
              value={days}
              onChange={setDays}
              style={{ width: 120 }}
              options={WINDOW_OPTIONS}
            />
            <Button icon={<ReloadOutlined />} loading={analyticsQuery.isFetching} onClick={() => analyticsQuery.refetch()}>
              Tải lại
            </Button>
            <Button type="primary" loading={runAutomationMutation.isPending} onClick={() => runAutomationMutation.mutate(undefined)}>
              Chạy tự động hóa
            </Button>
          </Space>
        </div>
        {analyticsQuery.data?.meta?.message ? (
          <div style={{ marginTop: 10 }}>
            <Tag color="gold">{analyticsQuery.data.meta.message}</Tag>
          </div>
        ) : null}
        {analyticsQuery.data?.generated_at ? (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag color="processing">Tự động cập nhật mỗi 30 giây</Tag>
            <Tag>Cập nhật lần cuối: {dayjs(analyticsQuery.data.generated_at).format('DD/MM/YYYY HH:mm:ss')}</Tag>
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
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu analytics." />
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
                  Thực thi tất cả gợi ý khả dụng
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
                        {insight.severity}
                      </Tag>
                      <Tag>{insight.type}</Tag>
                      {insight.step_title ? <Tag color="purple">{normalizeStepTitle(insight.step_title)}</Tag> : null}
                    </Space>
                    <div style={{ marginTop: 6, fontSize: 13 }}>{insight.message}</div>
                    {insight.suggested_action ? (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Tag color="blue">Gợi ý: {insight.suggested_action}</Tag>
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
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có cấu hình profile tự động." />
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Space wrap>
                  <Select<AutomationProfileKey>
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
                    Chạy profile
                  </Button>
                  <Button
                    loading={saveProfilesMutation.isPending}
                    onClick={() => {
                      if (!profileDraft) return;
                      const nextProfiles = {
                        ...profiles,
                        [selectedProfileKey]: profileDraft,
                      } as Record<AutomationProfileKey, WorkflowAutomationProfileConfig>;
                      saveProfilesMutation.mutate(nextProfiles);
                    }}
                  >
                    Lưu profile hiện tại
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
                    Chạy scheduler ngay
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
                      <Text type="secondary">Cooldown (giờ)</Text>
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
                  {(Object.keys(profiles) as AutomationProfileKey[]).map((key) => {
                    const p = profiles[key];
                    return (
                      <Tag key={key} color={selectedProfileKey === key ? 'blue' : 'default'}>
                        {key}: overdue={p.remind_overdue ? 'on' : 'off'}, autoStart={p.auto_start_ready ? 'on' : 'off'}, cooldown={p.reminder_cooldown_hours}h
                      </Tag>
                    );
                  })}
                </Space>
                <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <Text strong>Scheduler toàn hệ thống</Text>
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
                      Cập nhật job scheduler
                    </Button>
                    <Tag color={schedulerJobStatusQuery.data?.enabled ? 'green' : 'default'}>
                      {schedulerJobStatusQuery.data?.enabled ? 'Đang bật' : 'Đang tắt'}
                    </Tag>
                    {schedulerJobStatusQuery.data?.next_run ? (
                      <Tag>Next: {dayjs(schedulerJobStatusQuery.data.next_run).format('DD/MM HH:mm:ss')}</Tag>
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
                      <Text type="secondary">Ngưỡng auto-disable</Text>
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
                      Lưu policy
                    </Button>
                    <Button
                      loading={applySchedulerPolicyPresetMutation.isPending}
                      disabled={!isSchedulerAdmin}
                      onClick={() => applySchedulerPolicyPresetMutation.mutate('CONSERVATIVE')}
                    >
                      Preset An toàn
                    </Button>
                    <Button
                      loading={applySchedulerPolicyPresetMutation.isPending}
                      disabled={!isSchedulerAdmin}
                      onClick={() => applySchedulerPolicyPresetMutation.mutate('BALANCED')}
                    >
                      Preset Cân bằng
                    </Button>
                    <Button
                      loading={applySchedulerPolicyPresetMutation.isPending}
                      disabled={!isSchedulerAdmin}
                      onClick={() => applySchedulerPolicyPresetMutation.mutate('AGGRESSIVE')}
                    >
                      Preset Tăng tốc
                    </Button>
                  </Space>
                  {schedulerHealthQuery.isLoading ? (
                    <div style={{ textAlign: 'center', padding: 12 }}><Spin /></div>
                  ) : schedulerHealthQuery.data ? (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Space wrap>
                        <Tag color="green">SUCCESS: {schedulerHealthQuery.data.status_counts.SUCCESS}</Tag>
                        <Tag color="red">FAILED: {schedulerHealthQuery.data.status_counts.FAILED}</Tag>
                        <Tag color="default">LOCKED: {schedulerHealthQuery.data.status_counts.SKIPPED_LOCKED}</Tag>
                        <Tag>Consecutive fail: {schedulerHealthQuery.data.consecutive_failures}</Tag>
                        <Tag>Avg duration: {schedulerHealthQuery.data.avg_success_duration_ms} ms</Tag>
                        {schedulerHealthQuery.data.last_run_at ? (
                          <Tag>Last run: {dayjs(schedulerHealthQuery.data.last_run_at).format('DD/MM HH:mm:ss')}</Tag>
                        ) : null}
                      </Space>
                      {schedulerHealthQuery.data.auto_disabled && (
                        <Space wrap>
                          <Tag color="red">
                            Scheduler đã tự tắt do fail liên tiếp ({schedulerHealthQuery.data.consecutive_failures}/{schedulerHealthQuery.data.failure_threshold ?? 3})
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
                            Khôi phục scheduler
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
                        placeholder="Nội dung cảnh báo gửi admin"
                        style={{ width: 420 }}
                        suffix={schedulerNotifyMessage ? <QuickClearIcon onClear={() => setSchedulerNotifyMessage('')} title="Xóa nội dung" /> : undefined}
                      />
                      <Button
                        disabled={!isSchedulerAdmin}
                        loading={notifySchedulerAdminsMutation.isPending}
                        onClick={() => notifySchedulerAdminsMutation.mutate({
                          message: schedulerNotifyMessage.trim() || 'Cảnh báo thủ công từ dashboard scheduler.',
                        })}
                      >
                        Gửi cảnh báo admin
                      </Button>
                      <Input
                        value={schedulerSimulateReason}
                        onChange={(e) => setSchedulerSimulateReason(e.target.value)}
                        placeholder="Lý do mô phỏng lỗi (admin)"
                        style={{ width: 320 }}
                        suffix={schedulerSimulateReason ? <QuickClearIcon onClear={() => setSchedulerSimulateReason('')} title="Xóa lý do" /> : undefined}
                      />
                      <Button
                        danger
                        disabled={!isSchedulerAdmin}
                        loading={simulateSchedulerFailureMutation.isPending}
                        onClick={() => simulateSchedulerFailureMutation.mutate(
                          schedulerSimulateReason.trim() || 'Manual failure simulation from dashboard.',
                        )}
                      >
                        Mô phỏng lỗi scheduler
                      </Button>
                    </Space>
                  </div>
                  {!isSchedulerAdmin && (
                    <Tag color="gold">
                      Tài khoản hiện tại không có quyền admin/staff cho thao tác simulate/recover/policy.
                    </Tag>
                  )}
                  <div style={{ marginTop: 10, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
                    <Space wrap style={{ marginBottom: 8 }}>
                      <Text strong>Timeline sự cố/recovery</Text>
                      <Select<'ALL' | 'SUCCESS' | 'FAILED' | 'SKIPPED_LOCKED'>
                        value={schedulerIncidentStatus}
                        onChange={setSchedulerIncidentStatus}
                        style={{ width: 180 }}
                        options={[
                          { value: 'ALL', label: 'Tất cả trạng thái' },
                          { value: 'SUCCESS', label: 'SUCCESS' },
                          { value: 'FAILED', label: 'FAILED' },
                          { value: 'SKIPPED_LOCKED', label: 'SKIPPED_LOCKED' },
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
                                  {item.status}
                                </Tag>
                                <Tag>{item.event_type || 'JOB_RUN'}</Tag>
                                <Tag>{item.run_mode || '-'}</Tag>
                                <Text type="secondary">{item.duration_ms} ms</Text>
                                <Text type="secondary">{item.created_at ? dayjs(item.created_at).format('DD/MM HH:mm:ss') : ''}</Text>
                              </Space>
                              <Text>{item.message || '-'}</Text>
                              {item.policy_diff && (item.policy_diff.old_failure_threshold !== undefined || item.policy_diff.new_failure_threshold !== undefined) ? (
                                <Text type="secondary">
                                  Policy threshold: {String(item.policy_diff.old_failure_threshold ?? '-')} → {String(item.policy_diff.new_failure_threshold ?? '-')}
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
                        <Select<AutomationProfileKey>
                          value={slot.profile_key}
                          onChange={(v) => {
                            const nextSlots = schedulerDraft.slots.map((s, i) => (i === idx ? { ...s, profile_key: v } : s));
                            setSchedulerEdits((prev) => ({ ...prev, [schedulerKey]: { ...schedulerDraft, slots: nextSlots } }));
                          }}
                          style={{ width: 140 }}
                          options={[
                            { value: 'MORNING', label: 'MORNING' },
                            { value: 'MIDDAY', label: 'MIDDAY' },
                            { value: 'EOD', label: 'EOD' },
                            { value: 'CUSTOM', label: 'CUSTOM' },
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
                    <Text strong>Lịch sử chạy profile</Text>
                    <Select<'ALL' | 'MANUAL_PROFILE' | 'SCHEDULE'>
                      value={schedulerHistoryMode}
                      onChange={setSchedulerHistoryMode}
                      style={{ width: 180 }}
                      options={[
                        { value: 'ALL', label: 'Tất cả mode' },
                        { value: 'MANUAL_PROFILE', label: 'Chạy tay profile' },
                        { value: 'SCHEDULE', label: 'Scheduler' },
                      ]}
                    />
                  </Space>
                  {automationHistoryQuery.isLoading ? (
                    <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
                  ) : (
                    <List<WorkflowAutomationRunHistoryItem>
                      size="small"
                      dataSource={automationHistoryQuery.data?.items ?? []}
                      locale={{ emptyText: 'Chưa có lịch sử chạy profile.' }}
                      renderItem={(item) => (
                        <List.Item>
                          <List.Item.Meta
                            title={(
                              <Space size={8} wrap>
                                <Tag color="processing">{item.profile_key}</Tag>
                                <Tag color={item.run_mode === 'SCHEDULE' ? 'purple' : 'default'}>
                                  {item.run_mode === 'SCHEDULE' ? 'Scheduler' : 'Manual'}
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
                  <Tag key={action}>{action}: {count}</Tag>
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
                  { value: 'RUN_AUTOMATION', label: 'RUN_AUTOMATION' },
                  { value: 'ESCALATE_OVERDUE', label: 'ESCALATE_OVERDUE' },
                  { value: 'REBALANCE_ASSIGNEE', label: 'REBALANCE_ASSIGNEE' },
                  { value: 'CHECK_CAPACITY', label: 'CHECK_CAPACITY' },
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
                value={historyActorQuery}
                onChange={(e) => setHistoryActorQuery(e.target.value)}
                style={{ width: 220 }}
                placeholder="Lọc theo username"
                suffix={historyActorQuery ? <QuickClearIcon onClear={() => setHistoryActorQuery('')} title="Xóa username" /> : undefined}
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
                          <Tag>{item.insight_type}</Tag>
                          <Tag color="blue">{item.suggested_action}</Tag>
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
    </div>
  );
}
