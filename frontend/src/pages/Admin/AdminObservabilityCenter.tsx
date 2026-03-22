import { useDeferredValue, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ArrowRightOutlined,
  DashboardOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import PageHeader from '../../components/PageHeader/PageHeader';
import { adminApi } from '../../api/admin';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import {
  workflowTaskTemplatesApi,
  type WorkflowSchedulerIncidentItem,
} from '../../api/workflowTaskTemplates';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';
import { PAGES } from '../../utils/constants';

const { Text, Paragraph } = Typography;

type DomainFilter =
  | 'all'
  | 'system'
  | 'workflow'
  | 'review'
  | 'exception'
  | 'governance'
  | 'provisioning'
  | 'offboarding'
  | 'finance'
  | 'workforce'
  | 'purchasing'
  | 'production';
type SeverityFilter = 'all' | 'error' | 'warning' | 'info' | 'success';

type WatchlistRow = {
  id: string;
  domain: Exclude<DomainFilter, 'all'>;
  severity: Exclude<SeverityFilter, 'all'>;
  title: string;
  description: string;
  metric: string;
  route: string;
};

type ActivityRow = {
  id: string;
  domain: Exclude<DomainFilter, 'all'>;
  severity: Exclude<SeverityFilter, 'all'>;
  timestamp: string | null;
  summary: string;
  action: string;
  actorLabel: string;
  route: string;
  entityId?: number | null;
  entityCode: string;
};

type BusinessFlowCard = {
  key: string;
  domain: Extract<DomainFilter, 'finance' | 'workforce' | 'purchasing' | 'production'>;
  title: string;
  description: string;
  metric: string;
  subMetric: string;
  tint: string;
  route: string;
  routeLabel: string;
  secondaryRoute?: string;
  secondaryRouteLabel?: string;
  chips: string[];
  highlights: Array<{
    title: string;
    description: string;
  }>;
};
type ObservabilityFilterSnapshot = {
  domain_filter: DomainFilter;
  severity_filter: SeverityFilter;
  activity_search: string;
};
type ObservabilityNamedPreset = {
  id: string;
  name: string;
  filters: ObservabilityFilterSnapshot;
};

const HERO_CARD_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #d9e7f5',
  background: 'linear-gradient(180deg, #ffffff 0%, #f6fbff 100%)',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
};

const PANEL_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #e2e8f0',
  boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
};

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function buildRouteWithQuery(
  route: string,
  params: Record<string, string | number | null | undefined>
): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    query.set(key, String(value));
  });
  const serialized = query.toString();
  return serialized ? `${route}?${serialized}` : route;
}

function downloadJsonFile(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function statusFromApprovalAction(
  domain: Extract<DomainFilter, 'finance' | 'workforce' | 'purchasing' | 'production'>,
  action?: string
): string | undefined {
  const normalized = String(action || '').toUpperCase();
  if (!normalized) return undefined;
  if (domain === 'finance' || domain === 'workforce') {
    if (normalized === 'PENDING_L1' || normalized === 'PENDING_L2') return normalized;
    if (normalized === 'REJECT' || normalized === 'REJECT_L1' || normalized === 'REJECT_L2') return 'REJECTED';
    if (normalized.startsWith('APPROVE')) return 'APPROVED';
    if (normalized === 'SUBMIT' || normalized === 'RESUBMIT') return 'PENDING_L1';
    return undefined;
  }
  if (normalized === 'SUBMITTED') return 'SUBMITTED';
  if (normalized === 'REJECT') return 'REJECTED';
  if (normalized.startsWith('APPROVE')) return 'APPROVED';
  if (normalized === 'SUBMIT' || normalized === 'RESUBMIT') return 'SUBMITTED';
  return undefined;
}

function buildApprovalDrilldownRoute(options: {
  domain: Extract<DomainFilter, 'finance' | 'workforce' | 'purchasing' | 'production'>;
  route: string;
  action?: string;
  entityCode?: string | null;
  entityId?: number | null;
}): string {
  const { domain, route, action, entityCode, entityId } = options;
  const status = statusFromApprovalAction(domain, action);

  if (domain === 'finance') {
    return buildRouteWithQuery(route, {
      q: entityCode || undefined,
      focus: entityCode || undefined,
      focus_id: entityId ?? undefined,
      approval_status: status,
    });
  }

  if (domain === 'workforce') {
    return buildRouteWithQuery(route, {
      q: entityCode || undefined,
      focus_id: entityId ?? undefined,
      approval_status: status,
    });
  }

  return buildRouteWithQuery(route, {
    q: entityCode || undefined,
    focus: entityCode || undefined,
    focus_id: entityId ?? undefined,
    status,
  });
}

function buildAuditDrilldownRoute(options: {
  domain: Extract<DomainFilter, 'finance' | 'workforce' | 'purchasing' | 'production' | 'governance' | 'workflow'>;
  route: string;
  action?: string;
  entityCode?: string | null;
  entityId?: number | null;
}): string {
  const { domain, route, action, entityCode, entityId } = options;
  if (domain === 'finance' || domain === 'workforce' || domain === 'purchasing' || domain === 'production') {
    return buildApprovalDrilldownRoute({
      domain,
      route,
      action,
      entityCode,
      entityId,
    });
  }
  return route;
}

function formatMoney(value?: number | string | null): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '--';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatQuantity(value?: number | string | null): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '--';
  return new Intl.NumberFormat('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  return dayjs(value).format('DD/MM/YYYY HH:mm');
}

function formatDate(value?: string | null): string {
  if (!value) return 'Chưa xác định';
  return dayjs(value).format('DD/MM/YYYY');
}

function severityColor(severity: SeverityFilter): string {
  if (severity === 'error') return 'volcano';
  if (severity === 'warning') return 'gold';
  if (severity === 'success') return 'green';
  return 'blue';
}

function severityWeight(severity: Exclude<SeverityFilter, 'all'>): number {
  if (severity === 'error') return 4;
  if (severity === 'warning') return 3;
  if (severity === 'info') return 2;
  return 1;
}

function domainLabel(domain: Exclude<DomainFilter, 'all'>): string {
  if (domain === 'finance') return 'Tài chính';
  if (domain === 'workforce') return 'Nhân sự';
  if (domain === 'purchasing') return 'Mua hàng';
  if (domain === 'production') return 'Sản xuất';
  if (domain === 'system') return 'Hệ thống';
  if (domain === 'workflow') return 'Workflow';
  if (domain === 'review') return 'Rà soát';
  if (domain === 'exception') return 'Ngoại lệ';
  if (domain === 'governance') return 'RBAC';
  if (domain === 'provisioning') return 'Cấp tài khoản';
  return 'Kết thúc vòng đời';
}

function domainTint(domain: Exclude<DomainFilter, 'all'>): string {
  if (domain === 'finance') return '#0f766e';
  if (domain === 'workforce') return '#2563eb';
  if (domain === 'purchasing') return '#d97706';
  if (domain === 'production') return '#7c2d12';
  if (domain === 'system') return '#0f766e';
  if (domain === 'workflow') return '#7c3aed';
  if (domain === 'review') return '#2563eb';
  if (domain === 'exception') return '#dc2626';
  if (domain === 'governance') return '#9333ea';
  if (domain === 'provisioning') return '#0891b2';
  return '#d97706';
}

function normalizeSeverity(value?: string | null): Exclude<SeverityFilter, 'all'> {
  if (value === 'error' || value === 'warning' || value === 'success') return value;
  return 'info';
}

function getHealthStatusLabel(status: string): string {
  if (status === 'unhealthy') return 'Không ổn định';
  if (status === 'warning') return 'Cần theo dõi';
  return 'Ổn định';
}

function getHealthSeverity(status: string): Exclude<SeverityFilter, 'all'> {
  if (status === 'error' || status === 'unhealthy') return 'error';
  if (status === 'warning') return 'warning';
  if (status === 'ok') return 'success';
  return 'info';
}

function summarizeHealthCheck(name: string, payload: Record<string, unknown>): string {
  if (name === 'disk') {
    return `${payload.free_gb ?? '--'} GB trống`;
  }
  if (name === 'memory') {
    return `${payload.percent ?? '--'}% RAM`;
  }
  if (name === 'queue') {
    return `${payload.queued_items ?? 0} job chờ`;
  }
  if (name === 'media') {
    return Boolean(payload.writable) ? 'Có thể ghi' : 'Chưa ghi được';
  }
  if (name === 'database') {
    return 'Kết nối khả dụng';
  }
  if (name === 'data') {
    return `${payload.audit_logs ?? 0} audit log`;
  }
  return String(payload.message ?? 'Đang theo dõi');
}

function describeHealthCheck(name: string, payload: Record<string, unknown>): string {
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  if (name === 'queue') {
    return `Cụm hàng đợi ${payload.cluster_name ?? 'default'} đang có ${payload.queued_items ?? 0} tác vụ chờ xử lý.`;
  }
  if (name === 'disk') {
    return `Dung lượng trống còn ${payload.free_gb ?? '--'} GB trên tổng ${payload.total_gb ?? '--'} GB.`;
  }
  if (name === 'memory') {
    return `Bộ nhớ khả dụng hiện còn ${payload.available_gb ?? '--'} GB.`;
  }
  if (name === 'data') {
    return `Dữ liệu nghiệp vụ hiện có ${payload.users ?? 0} tài khoản, ${payload.notifications ?? 0} thông báo và ${payload.audit_logs ?? 0} audit log.`;
  }
  return `Kiểm tra ${name} đang ở trạng thái ${payload.status ?? 'unknown'}.`;
}

function getWorkflowIncidentSeverity(item: WorkflowSchedulerIncidentItem): Exclude<SeverityFilter, 'all'> {
  if (item.status === 'FAILED') return 'error';
  if (item.status === 'SKIPPED_LOCKED') return 'warning';
  if (item.status === 'SUCCESS') return 'success';
  return 'info';
}

function flowStatusLabel(status?: string | null): string {
  const normalized = String(status ?? '').trim().toUpperCase();
  if (normalized === 'DRAFT') return 'Nháp';
  if (normalized === 'SUBMITTED') return 'Chờ duyệt';
  if (normalized === 'APPROVED') return 'Đã duyệt';
  if (normalized === 'REJECTED') return 'Từ chối';
  if (normalized === 'PARTIAL_RECEIVED') return 'Nhận một phần';
  if (normalized === 'RECEIVED') return 'Đã nhận đủ';
  if (normalized === 'CANCELLED') return 'Đã hủy';
  if (normalized === 'RELEASED') return 'Đã phát lệnh';
  if (normalized === 'IN_PROGRESS') return 'Đang sản xuất';
  if (normalized === 'COMPLETED') return 'Hoàn thành';
  if (normalized === 'POSTED') return 'Đã ghi sổ';
  return normalized || 'Đang theo dõi';
}

function SummaryCard({ title, value, tint }: { title: string; value: number | string; tint: string }) {
  /*
  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem observability.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem observability.');
    }
  };

  const applySavedView = () => {
    const domainValue = savedConfig?.domain_filter;
    const severityValue = savedConfig?.severity_filter;
    const searchValue = savedConfig?.activity_search;
    if (
      domainValue === 'all'
      || domainValue === 'system'
      || domainValue === 'workflow'
      || domainValue === 'review'
      || domainValue === 'exception'
      || domainValue === 'governance'
      || domainValue === 'provisioning'
      || domainValue === 'offboarding'
      || domainValue === 'finance'
      || domainValue === 'workforce'
      || domainValue === 'purchasing'
      || domainValue === 'production'
    ) {
      setDomainFilter(domainValue);
    }
    if (
      severityValue === 'all'
      || severityValue === 'error'
      || severityValue === 'warning'
      || severityValue === 'info'
      || severityValue === 'success'
    ) {
      setSeverityFilter(severityValue);
    }
    if (typeof searchValue === 'string') {
      setActivitySearch(searchValue);
    }
    messageApi.success('Đã khôi phục chế độ xem observability đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: ObservabilityNamedPreset = existing
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
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc observability.' : 'Đã lưu mẫu lọc observability mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc observability.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc observability.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc observability để xóa.');
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
      messageApi.error('Không thể xóa mẫu lọc observability.');
    }
  };

  */
  return (
    <Card style={HERO_CARD_STYLE} bodyStyle={{ padding: 18 }}>
      <Statistic title={title} value={value} valueStyle={{ color: tint, fontWeight: 700 }} />
    </Card>
  );
}

export default function AdminObservabilityCenter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [activitySearch, setActivitySearch] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('NONE');
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const deferredActivitySearch = useDeferredValue(normalizeSearch(activitySearch));
  const { config: savedConfig, saveConfig } = useUserPreferences(PAGES.ADMIN_OBSERVABILITY);

  const workspaceQuery = useQuery({
    queryKey: ['admin-observability-workspace'],
    queryFn: () => adminApi.getAdminObservabilityWorkspace({
      hours: 24,
      incident_limit: 12,
      activity_limit: 10,
    }),
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-observability-workspace'] });
  };

  const notifySchedulerAdminsMutation = useMutation({
    mutationFn: () => workflowTaskTemplatesApi.notifySchedulerAdmins({
      message: 'Cảnh báo thủ công từ trung tâm sức khỏe hệ thống.',
    }),
    onSuccess: (result) => {
      messageApi.success(`Đã gửi cảnh báo tới ${result.notified_admin_count} quản trị viên.`);
      refreshAll();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể gửi cảnh báo quản trị từ trung tâm sức khỏe hệ thống.'));
    },
  });

  const simulateSchedulerFailureMutation = useMutation({
    mutationFn: () => workflowTaskTemplatesApi.simulateSchedulerFailure({
      reason: 'Diễn tập lỗi thủ công từ trung tâm sức khỏe hệ thống.',
    }),
    onSuccess: () => {
      messageApi.success('Đã ghi nhận diễn tập lỗi scheduler workflow.');
      refreshAll();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể mô phỏng lỗi scheduler workflow.'));
    },
  });

  const recoverSchedulerMutation = useMutation({
    mutationFn: () => workflowTaskTemplatesApi.recoverScheduler({
      interval_minutes: workspaceQuery.data?.workflow.job_status?.interval_minutes ?? 5,
      clear_lock: true,
    }),
    onSuccess: () => {
      messageApi.success('Đã khôi phục scheduler workflow.');
      refreshAll();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Không thể khôi phục scheduler workflow.'));
    },
  });

  const alertDrillMutation = useMutation({
    mutationFn: () => adminApi.runAdminObservabilityAlertDrill({ severity: 'warning' }),
    onSuccess: (result) => {
      messageApi.success(
        `Da chay alert drill: success ${result.status_counts.SUCCESS}, skipped ${result.status_counts.SKIPPED}, failed ${result.status_counts.FAILED}.`
      );
      refreshAll();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Khong the chay alert drill tu command center.'));
    },
  });

  const alertReadinessMutation = useMutation({
    mutationFn: () => adminApi.getAdminAlertReadiness({ hours: 24 }),
    onSuccess: (payload) => {
      downloadJsonFile('alert-channel-readiness.json', payload);
      messageApi.success('Da xuat alert channel readiness.');
      refreshAll();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Khong the xuat alert channel readiness.'));
    },
  });

  const goLiveHandoffMutation = useMutation({
    mutationFn: () => adminApi.getAdminGoLiveHandoff({ environment: 'staging' }),
    onSuccess: (payload) => {
      const environment = String(payload.environment ?? 'staging').toLowerCase();
      downloadJsonFile(`go-live-handoff-${environment}.json`, payload);
      messageApi.success(`Da xuat go-live handoff cho ${environment}.`);
      refreshAll();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Khong the xuat go-live handoff.'));
    },
  });

  const cleanupPreviewMutation = useMutation({
    mutationFn: () => adminApi.getAdminReleaseCleanupPreview(),
    onSuccess: (payload) => {
      downloadJsonFile('release-cleanup-preview.json', payload);
      messageApi.success(`Da xuat cleanup preview voi ${payload.existing_count} artifact dang mo.`);
      refreshAll();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Khong the xuat cleanup preview.'));
    },
  });

  const releaseLockfileMutation = useMutation({
    mutationFn: () => adminApi.getAdminReleaseLockfile({ environment: 'staging' }),
    onSuccess: (payload) => {
      const environment = String(payload.environment ?? 'staging').toLowerCase();
      downloadJsonFile(`release-lockfile-${environment}.json`, payload);
      messageApi.success(`Da xuat release lockfile cho ${environment}.`);
      refreshAll();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Khong the xuat release lockfile.'));
    },
  });

  const performanceDrilldownMutation = useMutation({
    mutationFn: () => adminApi.getAdminPerformanceDrilldown(),
    onSuccess: (payload) => {
      downloadJsonFile('performance-drilldown.json', payload);
      messageApi.success(`Da xuat performance drilldown: ${payload.surface_count} be mat, ${payload.slow_surface_count} can theo doi.`);
      refreshAll();
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Khong the xuat performance drilldown.'));
    },
  });

  const isLoading = workspaceQuery.isLoading;
  const firstError = workspaceQuery.error;

  const workspace = workspaceQuery.data;
  const capabilities = workspace?.capabilities;
  const monitoring = workspace?.monitoring;
  const healthChecks = Object.entries(workspace?.health.checks ?? {});
  const warningChecks = healthChecks.filter(([, payload]) => String(payload.status || '').toLowerCase() === 'warning').length;
  const errorChecks = healthChecks.filter(([, payload]) => {
    const normalized = String(payload.status || '').toLowerCase();
    return normalized === 'error' || normalized === 'unhealthy';
  }).length;
  const healthStatus = errorChecks > 0 ? 'unhealthy' : warningChecks > 0 ? 'warning' : (workspace?.health.status || 'healthy');
  const workflowHealth = workspace?.workflow.health;
  const workflowStatus = workspace?.workflow.job_status;
  const workflowIncidents = workspace?.workflow.incidents.items ?? [];
  const accessExceptionSummary = workspace?.access_exception.summary;
  const rbacAnomalyCount = workspace?.governance.rbac_history_meta?.anomalies_24h_count ?? 0;
  const queueDepth = Number(workspace?.health.checks.queue?.queued_items ?? 0);
  const dataSnapshot = (workspace?.health.checks.data ?? {}) as Record<string, unknown>;
  const backupStatus = monitoring?.backup?.status ?? 'ok';
  const latestBackupAge = Number(monitoring?.backup?.latest_backup?.age_hours ?? 0);
  const alertChannelCount = Number(monitoring?.alert_channels?.configured_count ?? 0);
  const alertRequiredChannelCount = Number(monitoring?.alert_channels?.required_channel_count ?? 0);
  const alertDeliveryStatus = monitoring?.alert_delivery?.status ?? 'warning';
  const alertSuccessCount = Number(monitoring?.alert_delivery?.status_counts.SUCCESS ?? 0);
  const alertReadiness = monitoring?.alert_readiness;
  const releaseHygiene = monitoring?.release_hygiene;
  const performanceReadiness = monitoring?.performance;
  const workflowFailed24h = workflowHealth?.status_counts.FAILED ?? 0;
  const workflowLocked24h = workflowHealth?.status_counts.SKIPPED_LOCKED ?? 0;
  const exceptionOverdue = accessExceptionSummary?.sla_requests_overdue ?? 0;
  const exceptionCritical = accessExceptionSummary?.guided_remediation_critical ?? 0;
  const canShowWorkflow = Boolean(capabilities?.can_view_workflow);
  const canShowOps = Boolean(capabilities?.can_view_operations_log);
  const canShowDirectory = Boolean(capabilities?.can_manage_user_directory);
  const canShowGovernance = Boolean(
    capabilities?.can_manage_user_directory
      || capabilities?.can_manage_module_permissions
      || capabilities?.can_view_rbac_audit
  );
  const canRunWorkflowAdminActions = Boolean(capabilities?.can_manage_workflow);
  const canSimulateWorkflowFailure = Boolean(capabilities?.can_simulate_scheduler_failure);
  const canRunOperationalActions = Boolean(capabilities?.can_simulate_scheduler_failure);
  const opsRoute = canShowOps ? '/operations-log' : '/admin/observability';
  const namedPresets = useMemo(() => {
    const raw = savedConfig?.saved_views;
    if (!Array.isArray(raw)) return [] as ObservabilityNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        const name = typeof record.name === 'string' ? record.name : '';
        const filters = record.filters;
        if (!id || !name || !filters || typeof filters !== 'object') return null;
        const filterRecord = filters as Record<string, unknown>;
        const domainValue = filterRecord.domain_filter;
        const severityValue = filterRecord.severity_filter;
        if (
          domainValue !== 'all'
          && domainValue !== 'system'
          && domainValue !== 'workflow'
          && domainValue !== 'review'
          && domainValue !== 'exception'
          && domainValue !== 'governance'
          && domainValue !== 'provisioning'
          && domainValue !== 'offboarding'
          && domainValue !== 'finance'
          && domainValue !== 'workforce'
          && domainValue !== 'purchasing'
          && domainValue !== 'production'
        ) {
          return null;
        }
        if (
          severityValue !== 'all'
          && severityValue !== 'error'
          && severityValue !== 'warning'
          && severityValue !== 'info'
          && severityValue !== 'success'
        ) {
          return null;
        }
        return {
          id,
          name,
          filters: {
            domain_filter: domainValue,
            severity_filter: severityValue,
            activity_search: typeof filterRecord.activity_search === 'string' ? filterRecord.activity_search : '',
          },
        } as ObservabilityNamedPreset;
      })
      .filter((item): item is ObservabilityNamedPreset => item !== null);
  }, [savedConfig?.saved_views]);
  const selectedPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );
  const financeFlow = workspace?.business_flows.finance;
  const workforceFlow = workspace?.business_flows.workforce;
  const purchasingFlow = workspace?.business_flows.purchasing;
  const productionFlow = workspace?.business_flows.production;
  const approvalAuditDomains = workspace?.approval_audit.domains ?? [];
  const approvalAuditRecent = workspace?.approval_audit.recent_activity ?? [];
  const approvalAuditHotItems = workspace?.approval_audit.hot_items ?? [];
  const approvalQueueRows = workspace?.approval_audit.queue_rows ?? [];
  const approvalQueueSummary = workspace?.approval_audit.queue_summary;
  const approvalAuditTimeline = workspace?.approval_audit.timeline_7d ?? [];
  const auditSpotlight = workspace?.audit_spotlight;
  const auditSpotlightDomains = auditSpotlight?.domains ?? [];
  const auditSpotlightRecent = auditSpotlight?.recent_activity ?? [];
  const auditSpotlightActors = auditSpotlight?.top_actors ?? [];
  const financePendingTotal = (financeFlow?.queue.pending_l1_count ?? 0) + (financeFlow?.queue.pending_l2_count ?? 0);
  const financeOverdueTotal = (financeFlow?.sla.overdue_l1_count ?? 0) + (financeFlow?.sla.overdue_l2_count ?? 0);
  const financeEscalationTotal = (financeFlow?.sla.escalation_l1_count ?? 0) + (financeFlow?.sla.escalation_l2_count ?? 0);
  const workforcePendingTotal = (workforceFlow?.queue.pending_l1_count ?? 0) + (workforceFlow?.queue.pending_l2_count ?? 0);
  const workforceOverdueTotal = (workforceFlow?.sla.overdue_l1_count ?? 0) + (workforceFlow?.sla.overdue_l2_count ?? 0);
  const workforceEscalationTotal = (workforceFlow?.sla.escalation_l1_count ?? 0) + (workforceFlow?.sla.escalation_l2_count ?? 0);
  const procurementPendingTotal = purchasingFlow?.order_summary.pending_approval_count ?? 0;
  const procurementRequestPending = purchasingFlow?.request_summary.submitted_count ?? 0;
  const procurementReceiptOverdue = purchasingFlow?.order_summary.overdue_receipt_count ?? 0;
  const productionPendingTotal = productionFlow?.order_summary.pending_approval_count ?? 0;
  const productionOverdueTotal = productionFlow?.order_summary.overdue_plan_count ?? 0;
  const productionReadyOperationCount = productionFlow?.order_summary.ready_operation_count ?? 0;

  const businessFlowCards: BusinessFlowCard[] = [
    ...(financeFlow ? [{
      key: 'finance-flow',
      domain: 'finance' as const,
      title: 'Radar tài chính',
      description: 'Theo dõi hàng chờ duyệt tạm ứng, hồ sơ quá hạn và tồn mở trên 90 ngày để chốt xử lý trước khi ảnh hưởng dòng tiền.',
      metric: `${financePendingTotal} hồ sơ chờ`,
      subMetric: `Quá hạn ${financeOverdueTotal} | Tồn mở >90 ngày ${financeFlow.overdue_snapshot_90d.count}`,
      tint: financeOverdueTotal > 0 || financeFlow.overdue_snapshot_90d.count > 0 ? '#dc2626' : '#0f766e',
      route: buildApprovalDrilldownRoute({
        domain: 'finance',
        route: '/advance-transactions',
        action: financeFlow.queue.items[0]?.approval_status,
        entityCode: financeFlow.queue.items[0]?.code,
        entityId: financeFlow.queue.items[0]?.id,
      }),
      routeLabel: 'Mở tạm ứng',
      secondaryRoute: '/finance-summary',
      secondaryRouteLabel: 'Xem tài chính tháng',
      chips: [
        `L1 ${financeFlow.queue.pending_l1_count}`,
        `L2 ${financeFlow.queue.pending_l2_count}`,
        `Escalation ${financeEscalationTotal}`,
        `Còn treo ${formatMoney(financeFlow.overdue_snapshot_90d.total_remaining)}`,
      ],
      highlights: financeFlow.queue.items.slice(0, 3).map((item) => ({
        title: `${item.code} • ${item.recipient_name}`,
        description: `Chờ duyệt cấp ${item.required_approval_level} • ${formatMoney(item.amount)} • ${formatDate(item.advance_date)}`,
      })),
    }] : []),
    ...(workforceFlow ? [{
      key: 'workforce-flow',
      domain: 'workforce' as const,
      title: 'Radar ứng lương',
      description: 'Theo dõi SLA duyệt ứng lương, hồ sơ nghẽn nhiều cấp và các đợt escalation cần can thiệp nhân sự ngay.',
      metric: `${workforcePendingTotal} hồ sơ chờ`,
      subMetric: `Quá hạn ${workforceOverdueTotal} | Escalation ${workforceEscalationTotal}`,
      tint: workforceOverdueTotal > 0 ? '#2563eb' : '#16a34a',
      route: buildApprovalDrilldownRoute({
        domain: 'workforce',
        route: '/salary-advance',
        action: workforceFlow.queue.items[0]?.approval_status,
        entityCode: workforceFlow.queue.items[0]?.employee_code,
        entityId: workforceFlow.queue.items[0]?.id,
      }),
      routeLabel: 'Mở ứng lương',
      chips: [
        `L1 ${workforceFlow.queue.pending_l1_count}`,
        `L2 ${workforceFlow.queue.pending_l2_count}`,
        `Lead ${formatQuantity(workforceFlow.sla.avg_lead_hours)} giờ`,
        `Đã duyệt ${workforceFlow.sla.approved_count}`,
      ],
      highlights: workforceFlow.queue.items.slice(0, 3).map((item) => ({
        title: `${item.employee_code || 'NV'} • ${item.employee_name}`,
        description: `Chờ duyệt cấp ${item.required_approval_level} • ${formatMoney(item.amount)} • Kỳ ${item.month}`,
      })),
    }] : []),
    ...(purchasingFlow ? [{
      key: 'purchasing-flow',
      domain: 'purchasing' as const,
      title: 'Radar mua hàng',
      description: 'Giữ nhịp đơn mua, yêu cầu mua và tiến độ nhận hàng để tránh hụt vật tư ở các lệnh đang chạy.',
      metric: `${procurementPendingTotal} đơn mua chờ`,
      subMetric: `Quá hạn nhận ${procurementReceiptOverdue} | Yêu cầu mua chờ ${procurementRequestPending}`,
      tint: procurementReceiptOverdue > 0 ? '#d97706' : '#0f766e',
      route: buildApprovalDrilldownRoute({
        domain: 'purchasing',
        route: '/purchase-orders',
        action: purchasingFlow.recent_orders.find((item) => item.status === 'SUBMITTED')?.status ?? purchasingFlow.recent_orders[0]?.status,
        entityCode: purchasingFlow.recent_orders.find((item) => item.status === 'SUBMITTED')?.code ?? purchasingFlow.recent_orders[0]?.code,
        entityId: purchasingFlow.recent_orders.find((item) => item.status === 'SUBMITTED')?.id ?? purchasingFlow.recent_orders[0]?.id,
      }),
      routeLabel: 'Mở đơn mua',
      secondaryRoute: buildApprovalDrilldownRoute({
        domain: 'purchasing',
        route: '/purchase-requests',
        action: purchasingFlow.recent_requests.find((item) => item.status === 'SUBMITTED')?.status ?? purchasingFlow.recent_requests[0]?.status,
        entityCode: purchasingFlow.recent_requests.find((item) => item.status === 'SUBMITTED')?.code ?? purchasingFlow.recent_requests[0]?.code,
        entityId: purchasingFlow.recent_requests.find((item) => item.status === 'SUBMITTED')?.id ?? purchasingFlow.recent_requests[0]?.id,
      }),
      secondaryRouteLabel: 'Mở yêu cầu mua',
      chips: [
        `Chờ nhận ${purchasingFlow.order_summary.waiting_receipt_count}`,
        `Giá trị mở ${formatMoney(purchasingFlow.order_summary.open_value)}`,
        `Nháp ${purchasingFlow.order_summary.draft_count}`,
        `PR đã duyệt ${purchasingFlow.request_summary.approved_count}`,
      ],
      highlights: [
        ...purchasingFlow.recent_orders.slice(0, 2).map((item) => ({
          title: `${item.code} • ${item.supplier_name || 'Chưa có NCC'}`,
          description: `${flowStatusLabel(item.status)} • Nhận dự kiến ${formatDate(item.expected_receipt_date)} • ${formatMoney(item.total)}`,
        })),
        ...purchasingFlow.recent_requests.slice(0, 2).map((item) => ({
          title: `${item.code} • ${item.requester_name || 'Chưa gán người yêu cầu'}`,
          description: `${flowStatusLabel(item.status)} • ${item.line_count} dòng • ${formatDate(item.request_date)}`,
        })),
      ].slice(0, 4),
    }] : []),
    ...(productionFlow ? [{
      key: 'production-flow',
      domain: 'production' as const,
      title: 'Radar sản xuất',
      description: 'Theo dõi lệnh chờ duyệt, lệnh quá hạn kế hoạch và công đoạn sẵn sàng để điều độ không bị mù trạng thái.',
      metric: `${productionPendingTotal} lệnh chờ`,
      subMetric: `Quá hạn kế hoạch ${productionOverdueTotal} | Công đoạn sẵn sàng ${productionReadyOperationCount}`,
      tint: productionOverdueTotal > 0 ? '#7c2d12' : '#2563eb',
      route: buildApprovalDrilldownRoute({
        domain: 'production',
        route: '/production-orders',
        action: productionFlow.recent_orders.find((item) => item.status === 'SUBMITTED')?.status ?? productionFlow.recent_orders[0]?.status,
        entityCode: productionFlow.recent_orders.find((item) => item.status === 'SUBMITTED')?.code ?? productionFlow.recent_orders[0]?.code,
        entityId: productionFlow.recent_orders.find((item) => item.status === 'SUBMITTED')?.id ?? productionFlow.recent_orders[0]?.id,
      }),
      routeLabel: 'Mở lệnh sản xuất',
      chips: [
        `Đang chạy ${productionFlow.order_summary.active_count}`,
        `Phát lệnh ${productionFlow.order_summary.released_count}`,
        `Khối lượng còn ${formatQuantity(productionFlow.order_summary.active_remaining_qty)}`,
        `Hoàn thành ${productionFlow.order_summary.completed_count}`,
      ],
      highlights: productionFlow.recent_orders.slice(0, 4).map((item) => ({
        title: `${item.code} • ${item.product_name || 'Chưa có thành phẩm'}`,
        description: `${flowStatusLabel(item.status)} • Đến hạn ${formatDate(item.planned_end_date)} • ${formatQuantity(item.produced_qty)}/${formatQuantity(item.planned_qty)}`,
      })),
    }] : []),
  ];

  const watchlistRows: WatchlistRow[] = [
    ...healthChecks
      .filter(([, payload]) => {
        const normalized = String(payload.status || '').toLowerCase();
        return normalized === 'warning' || normalized === 'error' || normalized === 'unhealthy';
      })
      .map(([name, payload]) => ({
        id: `health-${name}`,
        domain: 'system' as const,
        severity: getHealthSeverity(String(payload.status || 'info')),
        title: `Kiểm tra ${name}`,
        description: describeHealthCheck(name, payload),
        metric: summarizeHealthCheck(name, payload),
        route: opsRoute,
      })),
    ...(backupStatus !== 'ok' || alertDeliveryStatus !== 'ok' || alertChannelCount === 0
      ? [{
          id: 'go-live-monitoring-rail',
          domain: 'system' as const,
          severity: backupStatus !== 'ok' || alertChannelCount === 0 ? 'error' as const : 'warning' as const,
          title: 'Go-live monitoring rail can chot',
          description: `Backup ${backupStatus}, alert delivery ${alertDeliveryStatus}, configured channels ${alertChannelCount}, latest backup age ${latestBackupAge.toFixed(2)}h.`,
          metric: `Alert success ${alertSuccessCount}`,
          route: '/admin/observability',
        }]
      : []),
    ...(releaseHygiene?.status === 'warning'
      ? [{
          id: 'release-hygiene',
          domain: 'system' as const,
          severity: (releaseHygiene.counts.conflicts ?? 0) > 0 ? 'error' as const : 'warning' as const,
          title: 'Release hygiene con thay doi mo',
          description: `${releaseHygiene.total_changes} thay doi dang mo, migration candidates ${releaseHygiene.migration_candidates.length}, artifact candidates ${releaseHygiene.artifact_candidates.length}.`,
          metric: `${releaseHygiene.counts.modified + releaseHygiene.counts.untracked} file can ra`,
          route: '/admin/observability',
        }]
      : []),
    ...(performanceReadiness?.status === 'warning'
      ? [{
          id: 'performance-readiness',
          domain: 'system' as const,
          severity: (performanceReadiness.summary.critical_count ?? 0) > 0 ? 'error' as const : 'warning' as const,
          title: 'Large-data rehearsal can chot',
          description: `${performanceReadiness.summary.warning_count} surface can theo doi va ${performanceReadiness.summary.critical_count} surface dang o muc critical.`,
          metric: `Slow query ${performanceReadiness.slow_query_threshold_ms}ms`,
          route: '/reports',
        }]
      : []),
    ...(workflowFailed24h > 0 || workflowLocked24h > 0 || Boolean(workflowHealth?.auto_disabled) || Boolean(workflowStatus?.lock_active)
      ? [{
          id: 'workflow-scheduler',
          domain: 'workflow' as const,
          severity: workflowFailed24h > 0 || Boolean(workflowHealth?.auto_disabled) ? 'error' as const : 'warning' as const,
          title: 'Bộ lập lịch workflow cần theo dõi',
          description: `24 giờ qua có ${workflowFailed24h} lần thất bại, ${workflowLocked24h} lần bị khóa và ${workflowHealth?.consecutive_failures ?? 0} lỗi liên tiếp.`,
          metric: workflowStatus?.enabled ? `Chu kỳ ${workflowStatus.interval_minutes} phút` : 'Đang tắt',
          route: '/workflow-analytics',
        }]
      : []),
    ...(workflowIncidents
      .filter((item) => item.status === 'FAILED')
      .slice(0, 2)
      .map((item) => ({
        id: `workflow-incident-${item.id}`,
        domain: 'workflow' as const,
        severity: getWorkflowIncidentSeverity(item),
        title: 'Sự cố scheduler gần đây',
        description: item.message,
        metric: formatDateTime(item.created_at),
        route: '/workflow-analytics',
      }))),
    ...(exceptionOverdue > 0 || exceptionCritical > 0 || (accessExceptionSummary?.continuity_departments_overdue ?? 0) > 0
      ? [{
          id: 'access-exception-sla',
          domain: 'exception' as const,
          severity: exceptionCritical > 0 ? 'error' as const : 'warning' as const,
          title: 'Ngoại lệ truy cập đang có điểm nóng SLA',
          description: `${exceptionOverdue} yêu cầu quá hạn, ${accessExceptionSummary?.sla_escalations_due ?? 0} escalation đến hạn và ${accessExceptionSummary?.continuity_departments_overdue ?? 0} đơn vị quá hạn drill continuity.`,
          metric: `${accessExceptionSummary?.high_risk_requests ?? 0} yêu cầu rủi ro cao`,
          route: '/admin/access-exceptions',
        }]
      : []),
    ...(rbacAnomalyCount > 0
      ? [{
          id: 'rbac-anomalies',
          domain: 'governance' as const,
          severity: rbacAnomalyCount >= 3 ? 'error' as const : 'warning' as const,
          title: 'Dị thường phân quyền RBAC trong 24 giờ',
          description: 'Có actor thay đổi quyền module với tần suất hoặc khối lượng cao hơn ngưỡng cảnh báo.',
          metric: `${rbacAnomalyCount} actor bất thường`,
          route: '/admin/module-permissions-history',
        }]
      : []),
    ...(financeFlow && (financePendingTotal > 0 || financeOverdueTotal > 0 || financeFlow.overdue_snapshot_90d.count > 0)
      ? [{
          id: 'finance-approval-sla',
          domain: 'finance' as const,
          severity: financeOverdueTotal > 0 || financeFlow.overdue_snapshot_90d.count > 0 ? 'error' as const : 'warning' as const,
          title: 'Tài chính đang có hồ sơ cần xử lý',
          description: `${financePendingTotal} hồ sơ chờ duyệt, ${financeOverdueTotal} hồ sơ quá hạn và ${financeFlow.overdue_snapshot_90d.count} khoản tồn mở trên 90 ngày.`,
          metric: `Còn treo ${formatMoney(financeFlow.overdue_snapshot_90d.total_remaining)}`,
          route: buildApprovalDrilldownRoute({ domain: 'finance', route: '/advance-transactions' }),
        }]
      : []),
    ...(workforceFlow && (workforcePendingTotal > 0 || workforceOverdueTotal > 0)
      ? [{
          id: 'workforce-approval-sla',
          domain: 'workforce' as const,
          severity: workforceOverdueTotal > 0 ? 'warning' as const : 'info' as const,
          title: 'Ứng lương đang có điểm nghẽn duyệt',
          description: `${workforcePendingTotal} hồ sơ chờ duyệt, ${workforceOverdueTotal} hồ sơ quá hạn và ${workforceEscalationTotal} escalation đến hạn.`,
          metric: `Lead bình quân ${formatQuantity(workforceFlow.sla.avg_lead_hours)} giờ`,
          route: buildApprovalDrilldownRoute({ domain: 'workforce', route: '/salary-advance' }),
        }]
      : []),
    ...(purchasingFlow && (procurementPendingTotal > 0 || procurementReceiptOverdue > 0 || procurementRequestPending > 0)
      ? [{
          id: 'purchasing-flow-hotspot',
          domain: 'purchasing' as const,
          severity: procurementReceiptOverdue > 0 ? 'warning' as const : 'info' as const,
          title: 'Mua hàng cần cân bằng duyệt và nhận hàng',
          description: `${procurementPendingTotal} đơn mua chờ duyệt, ${procurementReceiptOverdue} đơn quá hạn nhận và ${procurementRequestPending} yêu cầu mua chưa xử lý.`,
          metric: `Giá trị mở ${formatMoney(purchasingFlow.order_summary.open_value)}`,
          route: buildApprovalDrilldownRoute({ domain: 'purchasing', route: '/purchase-orders', action: 'SUBMITTED' }),
        }]
      : []),
    ...(productionFlow && (productionPendingTotal > 0 || productionOverdueTotal > 0 || productionReadyOperationCount > 0)
      ? [{
          id: 'production-flow-hotspot',
          domain: 'production' as const,
          severity: productionOverdueTotal > 0 ? 'warning' as const : 'info' as const,
          title: 'Sản xuất đang có tín hiệu điều độ nóng',
          description: `${productionPendingTotal} lệnh chờ duyệt, ${productionOverdueTotal} lệnh quá hạn kế hoạch và ${productionReadyOperationCount} công đoạn sẵn sàng.`,
          metric: `Khối lượng còn ${formatQuantity(productionFlow.order_summary.active_remaining_qty)}`,
          route: buildApprovalDrilldownRoute({ domain: 'production', route: '/production-orders', action: 'SUBMITTED' }),
        }]
      : []),
    ...approvalAuditDomains
      .filter((item) => item.pending_now > 0 || item.rejected_7d > 0 || item.approved_7d > 0)
      .map((item) => ({
        id: `approval-audit-${item.domain}`,
        domain: item.domain,
        severity: item.rejected_7d > 0 ? 'warning' as const : item.pending_now > 0 ? 'info' as const : 'success' as const,
        title: `${item.label} có nhịp duyệt cần rà`,
        description: `${item.pending_now} hồ sơ đang chờ, ${item.approved_7d} hồ sơ đã duyệt và ${item.rejected_7d} hồ sơ bị từ chối trong 7 ngày.`,
        metric: `Gửi duyệt ${item.submitted_7d} | Cập nhật cuối ${formatDateTime(item.last_event_at)}`,
        route: buildApprovalDrilldownRoute({ domain: item.domain, route: item.route }),
      })),
  ].sort((left, right) => severityWeight(right.severity) - severityWeight(left.severity));

  const activityRows: ActivityRow[] = [
    ...(workflowIncidents.map((item) => ({
      id: `workflow-${item.id}`,
      domain: 'workflow' as const,
      severity: getWorkflowIncidentSeverity(item),
      timestamp: item.created_at,
      summary: item.message,
      action: item.status,
      actorLabel: item.actor || 'Hệ thống',
      route: '/workflow-analytics',
      entityCode: item.event_type || item.run_mode || 'workflow-scheduler',
    }))),
    ...((workspace?.governance.recent_activity ?? []).map((item) => ({
      id: `governance-${item.id}`,
      domain: 'governance' as const,
      severity: normalizeSeverity(item.severity),
      timestamp: item.timestamp,
      summary: item.summary,
      action: item.action,
      actorLabel: item.actor.full_name || item.actor.username || 'Hệ thống',
      route: item.route || '/admin/roles-teams',
      entityCode: item.entity_code,
    }))),
    ...((workspace?.access_review.recent_activity ?? []).map((item) => ({
      id: `review-${item.id}`,
      domain: 'review' as const,
      severity: item.action === 'LOCK_ACCOUNT' ? 'error' as const : 'info' as const,
      timestamp: item.timestamp,
      summary: item.summary,
      action: item.action,
      actorLabel: item.actor.full_name || item.actor.username || 'Hệ thống',
      route: item.route || '/admin/access-reviews',
      entityCode: item.entity_code,
    }))),
    ...((workspace?.access_exception.recent_activity ?? []).map((item) => ({
      id: `exception-${item.id}`,
      domain: 'exception' as const,
      severity: item.action === 'REJECT' || item.action === 'REVOKE' ? 'warning' as const : 'info' as const,
      timestamp: item.timestamp,
      summary: item.summary,
      action: item.action,
      actorLabel: item.actor.full_name || item.actor.username || 'Hệ thống',
      route: item.route || '/admin/access-exceptions',
      entityCode: item.entity_code,
    }))),
    ...((workspace?.provisioning.recent_activity ?? []).map((item) => ({
      id: `provisioning-${item.id}`,
      domain: 'provisioning' as const,
      severity: 'info' as const,
      timestamp: item.timestamp,
      summary: item.summary,
      action: 'PROVISION',
      actorLabel: item.actor.full_name || item.actor.username || 'Hệ thống',
      route: item.route || '/admin/user-provisioning',
      entityCode: item.entity_code,
    }))),
    ...((workspace?.offboarding.recent_activity ?? []).map((item) => ({
      id: `offboarding-${item.id}`,
      domain: 'offboarding' as const,
      severity: 'warning' as const,
      timestamp: item.timestamp,
      summary: item.summary,
      action: 'OFFBOARD',
      actorLabel: item.actor.full_name || item.actor.username || 'Hệ thống',
      route: item.route || '/admin/user-lifecycle',
      entityCode: item.entity_code,
    }))),
    ...((financeFlow?.queue.items ?? []).slice(0, 4).map((item) => ({
      id: `finance-${item.id}`,
      domain: 'finance' as const,
      severity: item.required_approval_level >= 2 ? 'warning' as const : 'info' as const,
      timestamp: item.advance_date,
      summary: `${item.code} đang chờ duyệt cấp ${item.required_approval_level}`,
      action: item.approval_status,
      actorLabel: item.recipient_name || 'Tài chính',
      route: buildApprovalDrilldownRoute({
        domain: 'finance',
        route: '/advance-transactions',
        action: item.approval_status,
        entityCode: item.code,
        entityId: item.id,
      }),
      entityId: item.id,
      entityCode: item.code,
    }))),
    ...((workforceFlow?.queue.items ?? []).slice(0, 4).map((item) => ({
      id: `workforce-${item.id}`,
      domain: 'workforce' as const,
      severity: item.required_approval_level >= 2 ? 'warning' as const : 'info' as const,
      timestamp: item.month ? `${item.month}-01` : null,
      summary: `${item.employee_name || item.employee_code} đang chờ duyệt cấp ${item.required_approval_level}`,
      action: item.approval_status,
      actorLabel: item.employee_code || 'Nhân sự',
      route: buildApprovalDrilldownRoute({
        domain: 'workforce',
        route: '/salary-advance',
        action: item.approval_status,
        entityCode: item.employee_code,
        entityId: item.id,
      }),
      entityId: item.id,
      entityCode: String(item.id),
    }))),
    ...((purchasingFlow?.recent_orders ?? []).slice(0, 3).map((item) => ({
      id: `purchasing-order-${item.id}`,
      domain: 'purchasing' as const,
      severity: item.status === 'SUBMITTED' ? 'warning' as const : 'info' as const,
      timestamp: item.expected_receipt_date,
      summary: `${item.code} • ${item.supplier_name || 'Chưa có nhà cung cấp'}`,
      action: flowStatusLabel(item.status),
      actorLabel: item.owner_name || 'Mua hàng',
      route: buildApprovalDrilldownRoute({
        domain: 'purchasing',
        route: '/purchase-orders',
        action: item.status,
        entityCode: item.code,
        entityId: item.id,
      }),
      entityId: item.id,
      entityCode: item.code,
    }))),
    ...((purchasingFlow?.recent_requests ?? []).slice(0, 3).map((item) => ({
      id: `purchasing-request-${item.id}`,
      domain: 'purchasing' as const,
      severity: item.status === 'SUBMITTED' ? 'warning' as const : 'info' as const,
      timestamp: item.request_date,
      summary: `${item.code} • ${item.requester_name || 'Chưa gán người yêu cầu'}`,
      action: flowStatusLabel(item.status),
      actorLabel: 'Yêu cầu mua',
      route: buildApprovalDrilldownRoute({
        domain: 'purchasing',
        route: '/purchase-requests',
        action: item.status,
        entityCode: item.code,
        entityId: item.id,
      }),
      entityId: item.id,
      entityCode: item.code,
    }))),
    ...((productionFlow?.recent_orders ?? []).slice(0, 4).map((item) => ({
      id: `production-${item.id}`,
      domain: 'production' as const,
      severity: item.status === 'SUBMITTED' ? 'warning' as const : item.status === 'IN_PROGRESS' ? 'info' as const : 'success' as const,
      timestamp: item.planned_end_date,
      summary: `${item.code} • ${item.product_name || 'Chưa có thành phẩm'}`,
      action: flowStatusLabel(item.status),
      actorLabel: item.owner_name || 'Sản xuất',
      route: buildApprovalDrilldownRoute({
        domain: 'production',
        route: '/production-orders',
        action: item.status,
        entityCode: item.code,
        entityId: item.id,
      }),
      entityId: item.id,
      entityCode: item.code,
    }))),
    ...(approvalAuditRecent.map((item) => ({
      id: `approval-${item.id}`,
      domain: item.domain,
      severity: item.action === 'REJECT' ? 'warning' as const : item.action.startsWith('APPROVE') ? 'success' as const : 'info' as const,
      timestamp: item.created_at,
      summary: item.summary,
      action: item.action_label,
      actorLabel: item.actor_label,
      route: buildApprovalDrilldownRoute({
        domain: item.domain,
        route: item.route,
        action: item.action,
        entityCode: item.entity_code,
        entityId: item.entity_id,
      }),
      entityId: item.entity_id,
      entityCode: item.entity_code,
    }))),
  ].sort((left, right) => dayjs(right.timestamp || 0).valueOf() - dayjs(left.timestamp || 0).valueOf());

  const filteredWatchlist = watchlistRows.filter((item) => {
    if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
    if (severityFilter !== 'all' && item.severity !== severityFilter) return false;
    return true;
  });

  const filteredActivity = activityRows.filter((item) => {
    if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
    if (severityFilter !== 'all' && item.severity !== severityFilter) return false;
    if (!deferredActivitySearch) return true;
    return [
      item.summary,
      item.action,
      item.actorLabel,
      item.entityCode,
      domainLabel(item.domain),
    ].join(' ').toLowerCase().includes(deferredActivitySearch);
  });
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (domainFilter !== 'all') tags.push(`Miền: ${domainLabel(domainFilter)}`);
    if (severityFilter !== 'all') tags.push(`Mức độ: ${severityFilter.toUpperCase()}`);
    if (activitySearch.trim()) tags.push(`Từ khóa: ${activitySearch.trim()}`);
    if (selectedPreset) tags.push(`Mẫu đang dùng: ${selectedPreset.name}`);
    return tags;
  }, [activitySearch, domainFilter, selectedPreset, severityFilter]);

  const buildCurrentSnapshot = (): ObservabilityFilterSnapshot => ({
    domain_filter: domainFilter,
    severity_filter: severityFilter,
    activity_search: activitySearch,
  });

  const applySnapshot = (snapshot: ObservabilityFilterSnapshot) => {
    setDomainFilter(snapshot.domain_filter);
    setSeverityFilter(snapshot.severity_filter);
    setActivitySearch(snapshot.activity_search);
  };

  const routeCards = [
    ...(canShowWorkflow ? [{
      key: 'workflow',
      title: 'Workflow scheduler',
      description: 'Theo dõi bộ lập lịch workflow, lỗi liên tiếp, lock và lịch sử sự cố gần nhất.',
      metric: `${workflowFailed24h} lỗi / 24h`,
      subMetric: workflowStatus?.enabled ? `Đang bật | mỗi ${workflowStatus.interval_minutes} phút` : 'Đang tắt',
      route: '/workflow-analytics',
    }] : []),
    ...(canShowOps ? [{
      key: 'ops-log',
      title: 'Nhật ký vận hành',
      description: 'Mở nhật ký vận hành để tra cứu request, lỗi và các thao tác hệ thống chi tiết hơn.',
      metric: `${warningChecks + errorChecks} check cần theo dõi`,
      subMetric: `${queueDepth} job đang chờ`,
      route: '/operations-log',
    }] : []),
    ...(canShowDirectory ? [{
      key: 'access',
      title: 'Ngoại lệ truy cập',
      description: 'Đi thẳng tới hàng chờ ngoại lệ có SLA, escalation và continuity drill đang nóng.',
      metric: `${accessExceptionSummary?.requests_pending ?? 0} yêu cầu chờ`,
      subMetric: `${exceptionCritical} critical remediation`,
      route: '/admin/access-exceptions',
    }] : []),
    ...(canShowGovernance ? [{
      key: 'governance',
      title: 'Giám sát truy cập',
      description: 'Xem watchlist truy cập hợp nhất và drilldown sang từng bàn điều hành governance.',
      metric: `${watchlistRows.length} điểm nóng`,
      subMetric: `${activityRows.length} hoạt động tổng hợp`,
      route: '/admin/access-governance',
    }] : []),
    ...(capabilities?.can_view_rbac_audit ? [{
      key: 'rbac',
      title: 'Lịch sử phân quyền',
      description: 'Rà actor bất thường, thay đổi quyền module và các đợt freeze/unfreeze gần đây.',
      metric: `${rbacAnomalyCount} dị thường / 24h`,
      subMetric: 'Theo dõi RBAC audit',
      route: '/admin/module-permissions-history',
    }] : []),
  ];

  const watchlistColumns: ColumnsType<WatchlistRow> = [
    {
      title: 'Miền giám sát',
      key: 'domain',
      width: 170,
      render: (_, record) => <Tag color={domainTint(record.domain)}>{domainLabel(record.domain)}</Tag>,
    },
    {
      title: 'Điểm nóng',
      key: 'content',
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Space wrap>
            <Tag color={severityColor(record.severity)}>{record.severity.toUpperCase()}</Tag>
            <Text strong>{record.title}</Text>
          </Space>
          <Text type="secondary">{record.description}</Text>
        </Space>
      ),
    },
    {
      title: 'Tín hiệu',
      dataIndex: 'metric',
      width: 220,
    },
    {
      title: 'Điều hướng',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Button type="link" icon={<ArrowRightOutlined />} onClick={() => navigate(record.route)}>
          Mở
        </Button>
      ),
    },
  ];

  const activityColumns: ColumnsType<ActivityRow> = [
    {
      title: 'Hoạt động',
      key: 'activity',
      render: (_, record) => (
        <Space direction="vertical" size={4}>
          <Space wrap>
            <Tag color={domainTint(record.domain)}>{domainLabel(record.domain)}</Tag>
            <Tag color={severityColor(record.severity)}>{record.action}</Tag>
            <Text strong>{record.summary}</Text>
          </Space>
          <Text type="secondary">
            {record.actorLabel} | {formatDateTime(record.timestamp)} | {record.entityCode || 'Không mã hóa'}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Điều hướng',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Button type="link" icon={<ArrowRightOutlined />} onClick={() => navigate(record.route)}>
          Mở
        </Button>
      ),
    },
  ];

  const exportWatchlist = () => {
    if (!filteredWatchlist.length) {
      messageApi.warning('Chưa có điểm nóng phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(filteredWatchlist.map((item) => ({
      'Miền giám sát': domainLabel(item.domain),
      'Mức độ': item.severity,
      'Tiêu đề': item.title,
      'Mô tả': item.description,
      'Tín hiệu': item.metric,
      'Đường dẫn': item.route,
    })), 'admin-observability-watchlist');
  };

  const exportActivity = () => {
    if (!filteredActivity.length) {
      messageApi.warning('Chưa có hoạt động phù hợp để xuất CSV.');
      return;
    }
    downloadCSV(filteredActivity.map((item) => ({
      'Thời điểm': formatDateTime(item.timestamp),
      'Miền giám sát': domainLabel(item.domain),
      'Mức độ': item.severity,
      'Hành động': item.action,
      'Tóm tắt': item.summary,
      'Người thao tác': item.actorLabel,
      'Mã đối tượng': item.entityCode,
      'Đường dẫn': item.route,
    })), 'admin-observability-activity');
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem observability.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem observability.');
    }
  };

  const applySavedView = () => {
    const domainValue = savedConfig?.domain_filter;
    const severityValue = savedConfig?.severity_filter;
    const searchValue = savedConfig?.activity_search;
    if (
      domainValue === 'all'
      || domainValue === 'system'
      || domainValue === 'workflow'
      || domainValue === 'review'
      || domainValue === 'exception'
      || domainValue === 'governance'
      || domainValue === 'provisioning'
      || domainValue === 'offboarding'
      || domainValue === 'finance'
      || domainValue === 'workforce'
      || domainValue === 'purchasing'
      || domainValue === 'production'
    ) {
      setDomainFilter(domainValue);
    }
    if (
      severityValue === 'all'
      || severityValue === 'error'
      || severityValue === 'warning'
      || severityValue === 'info'
      || severityValue === 'success'
    ) {
      setSeverityFilter(severityValue);
    }
    if (typeof searchValue === 'string') {
      setActivitySearch(searchValue);
    }
    messageApi.success('Đã khôi phục chế độ xem observability đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: ObservabilityNamedPreset = existing
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
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc observability.' : 'Đã lưu mẫu lọc observability mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc observability.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc observability.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc observability để xóa.');
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
      messageApi.error('Không thể xóa mẫu lọc observability.');
    }
  };

  return (
    <div>
      {contextHolder}
      <PageHeader
        title="Trung tâm sức khỏe hệ thống"
        subtitle="Gom health check, scheduler, điểm nóng access governance và audit liên trung tâm vào một command center để đội admin theo dõi vận hành và bảo mật cùng lúc."
        icon={<DashboardOutlined />}
        extra={[
          <Button key="refresh" icon={<ReloadOutlined />} onClick={refreshAll}>
            Làm mới
          </Button>,
        ]}
      />

      {firstError ? (
        <Alert
          showIcon
          type="error"
          style={{ marginBottom: 16 }}
          message="Không thể tải đầy đủ trung tâm sức khỏe hệ thống"
          description={getToastMessage(firstError, 'Một hoặc nhiều nguồn dữ liệu monitoring đang lỗi.')}
        />
      ) : null}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Sức khỏe tổng thể" value={getHealthStatusLabel(healthStatus)} tint={healthStatus === 'unhealthy' ? '#dc2626' : healthStatus === 'warning' ? '#d97706' : '#16a34a'} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Sự cố workflow 24h" value={workflowFailed24h} tint="#7c3aed" />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Ngoại lệ quá hạn SLA" value={exceptionOverdue} tint="#dc2626" />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Dị thường RBAC 24h" value={rbacAnomalyCount} tint="#9333ea" />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24}>
          <Card
            title="Go-live rail"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={<Tag color={backupStatus !== 'ok' || alertChannelCount === 0 ? 'volcano' : alertDeliveryStatus !== 'ok' ? 'gold' : 'green'}>{backupStatus !== 'ok' || alertChannelCount === 0 ? 'Can khoa lai' : alertDeliveryStatus !== 'ok' ? 'Can drill' : 'San sang'}</Tag>}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert
                showIcon
                type={backupStatus !== 'ok' || alertChannelCount === 0 ? 'warning' : alertDeliveryStatus !== 'ok' || releaseHygiene?.status === 'warning' || performanceReadiness?.status === 'warning' ? 'info' : 'success'}
                message={
                  backupStatus !== 'ok' || alertChannelCount === 0
                    ? 'Go-live rail van con blocker van hanh.'
                    : alertDeliveryStatus !== 'ok' || releaseHygiene?.status === 'warning' || performanceReadiness?.status === 'warning'
                      ? 'Go-live rail da co du lieu, nhung van con muc can chot.'
                      : 'Go-live rail dang o trang thai on dinh.'
                }
                description={`Backup ${backupStatus} | Alert channels ${alertChannelCount} | Alert success ${alertSuccessCount} | Release hygiene ${releaseHygiene?.status ?? 'unknown'} | Performance ${performanceReadiness?.status ?? 'unknown'}.`}
              />
              <Space size={[8, 8]} wrap>
                <Tag color={backupStatus === 'ok' ? 'green' : 'volcano'}>Backup age: {latestBackupAge.toFixed(2)}h</Tag>
                <Tag color={alertChannelCount > 0 ? 'blue' : 'volcano'}>Channels: {alertChannelCount}</Tag>
                <Tag color={alertRequiredChannelCount > 0 && alertChannelCount < alertRequiredChannelCount ? 'volcano' : 'cyan'}>
                  Required min: {alertRequiredChannelCount}
                </Tag>
                <Tag color={alertDeliveryStatus === 'ok' ? 'green' : 'gold'}>Alert delivery: {alertDeliveryStatus}</Tag>
                <Tag color={alertReadiness?.overall_status === 'ok' ? 'green' : 'gold'}>
                  Alert readiness: {alertReadiness?.overall_status ?? 'unknown'}
                </Tag>
                <Tag color={releaseHygiene?.status === 'ok' ? 'green' : 'gold'}>Dirty files: {releaseHygiene?.total_changes ?? 0}</Tag>
                <Tag color={performanceReadiness?.summary.critical_count ? 'volcano' : performanceReadiness?.summary.warning_count ? 'gold' : 'green'}>
                  Large-data: {performanceReadiness?.summary.warning_count ?? 0} warning / {performanceReadiness?.summary.critical_count ?? 0} critical
                </Tag>
                <Tag color="geekblue">Slow query threshold: {monitoring?.database?.slow_query_threshold_ms ?? 0}ms</Tag>
              </Space>
              <Space wrap>
                <Button
                  type="primary"
                  data-testid="admin-observability-run-alert-drill"
                  loading={alertDrillMutation.isPending}
                  disabled={!canRunOperationalActions}
                  onClick={() => alertDrillMutation.mutate()}
                >
                  Chay alert drill
                </Button>
                <Button
                  data-testid="admin-observability-export-alert-readiness"
                  loading={alertReadinessMutation.isPending}
                  disabled={!canRunOperationalActions}
                  onClick={() => alertReadinessMutation.mutate()}
                >
                  Xuat alert readiness
                </Button>
                <Button
                  data-testid="admin-observability-export-handoff"
                  loading={goLiveHandoffMutation.isPending}
                  disabled={!canRunOperationalActions}
                  onClick={() => goLiveHandoffMutation.mutate()}
                >
                  Xuat go-live handoff
                </Button>
                <Button
                  data-testid="admin-observability-preview-release-cleanup"
                  loading={cleanupPreviewMutation.isPending}
                  disabled={!canRunOperationalActions}
                  onClick={() => cleanupPreviewMutation.mutate()}
                >
                  Preview cleanup
                </Button>
                <Button
                  data-testid="admin-observability-export-release-lock"
                  loading={releaseLockfileMutation.isPending}
                  disabled={!canRunOperationalActions}
                  onClick={() => releaseLockfileMutation.mutate()}
                >
                  Xuat release lock
                </Button>
                <Button
                  data-testid="admin-observability-export-performance-drilldown"
                  loading={performanceDrilldownMutation.isPending}
                  disabled={!canRunOperationalActions}
                  onClick={() => performanceDrilldownMutation.mutate()}
                >
                  Xuat performance drilldown
                </Button>
              </Space>
              {(releaseHygiene?.warnings?.length || performanceReadiness?.warnings?.length) ? (
                <Space direction="vertical" size={4}>
                  {(releaseHygiene?.warnings ?? []).slice(0, 2).map((item) => (
                    <Text key={`hygiene-${item}`} type="secondary">- {item}</Text>
                  ))}
                  {(performanceReadiness?.warnings ?? []).slice(0, 2).map((item) => (
                    <Text key={`perf-${item}`} type="secondary">- {item}</Text>
                  ))}
                </Space>
              ) : null}
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24}>
          <Card
            data-testid="admin-observability-command-strip"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div data-testid="admin-observability-activity-search">
                  <Input
                    placeholder="Tìm theo hành động, actor, mã đối tượng hoặc tóm tắt"
                    value={activitySearch}
                    onChange={(event) => setActivitySearch(event.target.value)}
                    style={{ width: 320 }}
                  />
                </div>
                <Select<DomainFilter>
                  value={domainFilter}
                  onChange={setDomainFilter}
                  style={{ width: 220 }}
                  options={[
                    { value: 'all', label: 'Mọi miền' },
                    { value: 'system', label: 'Hệ thống' },
                    { value: 'workflow', label: 'Workflow' },
                    { value: 'finance', label: 'Tài chính' },
                    { value: 'workforce', label: 'Nhân sự' },
                    { value: 'purchasing', label: 'Mua hàng' },
                    { value: 'production', label: 'Sản xuất' },
                    { value: 'exception', label: 'Ngoại lệ' },
                    { value: 'review', label: 'Rà soát' },
                    { value: 'governance', label: 'RBAC' },
                    { value: 'provisioning', label: 'Cấp tài khoản' },
                    { value: 'offboarding', label: 'Kết thúc vòng đời' },
                  ]}
                />
                <Select<SeverityFilter>
                  value={severityFilter}
                  onChange={setSeverityFilter}
                  style={{ width: 180 }}
                  options={[
                    { value: 'all', label: 'Mọi mức độ' },
                    { value: 'error', label: 'Critical' },
                    { value: 'warning', label: 'Cảnh báo' },
                    { value: 'info', label: 'Thông tin' },
                    { value: 'success', label: 'Ổn định' },
                  ]}
                />
              </div>
              <Space wrap>
                <Button data-testid="admin-observability-save-view" onClick={() => void saveCurrentView()}>
                  Lưu chế độ xem
                </Button>
                <Button data-testid="admin-observability-restore-view" onClick={applySavedView}>
                  Khôi phục
                </Button>
                <Button
                  data-testid="admin-observability-open-preset-modal"
                  onClick={() => setIsPresetModalOpen(true)}
                >
                  Tạo mẫu lọc
                </Button>
                <div data-testid="admin-observability-preset-select">
                  <Select
                    value={selectedPresetId}
                    onChange={setSelectedPresetId}
                    style={{ width: 240 }}
                    options={[
                      { value: 'NONE', label: 'Chọn mẫu observability' },
                      ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                    ]}
                  />
                </div>
                <Button data-testid="admin-observability-apply-preset" onClick={applyNamedPreset}>
                  Áp dụng mẫu
                </Button>
                <Button
                  danger
                  data-testid="admin-observability-delete-preset"
                  disabled={!selectedPreset}
                  onClick={() => void deleteNamedPreset()}
                >
                  Xóa mẫu
                </Button>
              </Space>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Chế độ xem này đồng bộ cho watchlist, nhật ký audit và tín hiệu nghiệp vụ để đội admin giữ đúng góc nhìn theo ca hoặc theo miền giám sát.
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

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24}>
          <Card style={PANEL_STYLE} bodyStyle={{ padding: 18 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert
                showIcon
                type={healthStatus === 'unhealthy' || workflowFailed24h > 0 || exceptionCritical > 0 ? 'error' : healthStatus === 'warning' || rbacAnomalyCount > 0 ? 'warning' : 'success'}
                message={
                  healthStatus === 'unhealthy' || workflowFailed24h > 0 || exceptionCritical > 0
                    ? 'Hệ thống đang có cụm rủi ro cần can thiệp ngay'
                    : healthStatus === 'warning' || rbacAnomalyCount > 0
                      ? 'Nền tảng đang ổn nhưng còn vài điểm nóng cần rà chủ động'
                      : 'Nền tảng đang ở trạng thái ổn định'
                }
                description={
                  `Workflow thất bại ${workflowFailed24h} lần | kiểm tra cảnh báo ${warningChecks} | kiểm tra lỗi ${errorChecks} | escalation ngoại lệ ${accessExceptionSummary?.sla_escalations_due ?? 0} | queue depth ${queueDepth}.`
                }
              />
              <Space size={[8, 8]} wrap>
                <Tag color="blue">Môi trường: {workspace?.health.app_env || 'unknown'}</Tag>
                <Tag color="cyan">Server time: {formatDateTime(workspace?.health.server_time)}</Tag>
                <Tag color="geekblue">Users: {Number(dataSnapshot.users ?? 0)}</Tag>
                <Tag color="purple">Audit logs: {Number(dataSnapshot.audit_logs ?? 0)}</Tag>
                <Tag color="gold">Queue: {queueDepth}</Tag>
                <Tag color="green">Cập nhật: {formatDateTime(workspace?.generated_at)}</Tag>
                {workflowStatus?.next_run ? <Tag color="magenta">Workflow next run: {formatDateTime(workflowStatus.next_run)}</Tag> : null}
                {workspace?.access_exception.scheduler_status?.next_run ? <Tag color="volcano">Access next run: {formatDateTime(workspace.access_exception.scheduler_status.next_run)}</Tag> : null}
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {canShowWorkflow ? (
          <Col xs={24} xl={14}>
            <Card
              title="Điều phối scheduler workflow"
              style={PANEL_STYLE}
              bodyStyle={{ padding: 18 }}
              extra={(
                <Button type="link" onClick={() => navigate('/workflow-analytics')}>
                  Mở workflow analytics
                </Button>
              )}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space size={[8, 8]} wrap>
                  <Tag color={workflowStatus?.enabled ? 'green' : 'default'}>
                    {workflowStatus?.enabled ? 'Đang bật' : 'Đang tắt'}
                  </Tag>
                  <Tag color={workflowStatus?.lock_active ? 'volcano' : 'blue'}>
                    {workflowStatus?.lock_active ? 'Đang giữ lock' : 'Không giữ lock'}
                  </Tag>
                  <Tag color="purple">Sự cố 24h: {workflowFailed24h}</Tag>
                  <Tag color="gold">Skipped lock: {workflowLocked24h}</Tag>
                  <Tag color="geekblue">Chu kỳ: {workflowStatus?.interval_minutes ?? 5} phút</Tag>
                  <Tag color="cyan">Sự kiện hiển thị: {workspace?.workflow.incidents.total ?? 0}</Tag>
                </Space>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  Điều phối nhanh các thao tác monitoring cho bộ lập lịch workflow ngay trong command center này.
                  Nếu có lỗi liên tiếp hoặc lock kéo dài, bạn có thể diễn tập, gửi cảnh báo và khôi phục scheduler mà không cần rời màn.
                </Paragraph>
                {(workflowHealth?.recommended_actions ?? []).length ? (
                  <Space direction="vertical" size={4}>
                    <Text strong>Gợi ý xử lý ngay</Text>
                    {(workflowHealth?.recommended_actions ?? []).slice(0, 3).map((item) => (
                      <Text key={item} type="secondary">- {item}</Text>
                    ))}
                  </Space>
                ) : null}
                <Space wrap>
                  <Button
                    data-testid="admin-observability-notify-admins"
                    loading={notifySchedulerAdminsMutation.isPending}
                    disabled={!canRunWorkflowAdminActions}
                    onClick={() => notifySchedulerAdminsMutation.mutate()}
                  >
                    Gửi cảnh báo admin
                  </Button>
                  <Button
                    danger
                    data-testid="admin-observability-simulate-failure"
                    loading={simulateSchedulerFailureMutation.isPending}
                    disabled={!canSimulateWorkflowFailure}
                    onClick={() => simulateSchedulerFailureMutation.mutate()}
                  >
                    Diễn tập lỗi
                  </Button>
                  <Button
                    type="primary"
                    data-testid="admin-observability-recover-scheduler"
                    loading={recoverSchedulerMutation.isPending}
                    disabled={!canRunWorkflowAdminActions}
                    onClick={() => recoverSchedulerMutation.mutate()}
                  >
                    Khôi phục scheduler
                  </Button>
                </Space>
                {!canRunWorkflowAdminActions ? (
                  <Tag color="gold">
                    Tài khoản hiện tại chỉ có quyền theo dõi workflow. Các thao tác điều phối scheduler cần quyền quản trị workflow.
                  </Tag>
                ) : null}
                {canRunWorkflowAdminActions && !canSimulateWorkflowFailure ? (
                  <Tag color="processing">
                    Tài khoản hiện tại có thể khôi phục hoặc gửi cảnh báo scheduler, nhưng chỉ `staff/admin hệ thống` mới được diễn tập lỗi.
                  </Tag>
                ) : null}
              </Space>
            </Card>
          </Col>
        ) : null}

        {canShowGovernance ? (
          <Col xs={24} xl={10}>
            <Card
              title="Bề mặt governance"
              style={PANEL_STYLE}
              bodyStyle={{ padding: 18 }}
              extra={(
                <Button type="link" onClick={() => navigate('/admin/access-governance')}>
                  Mở governance center
                </Button>
              )}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Alert
                  showIcon
                  type={rbacAnomalyCount > 0 || exceptionCritical > 0 ? 'warning' : 'success'}
                  message={rbacAnomalyCount > 0 || exceptionCritical > 0 ? 'Governance đang có tín hiệu cần rà' : 'Governance đang ổn định'}
                  description={`RBAC dị thường ${rbacAnomalyCount} | ngoại lệ critical ${exceptionCritical} | review hoạt động ${(workspace?.access_review.recent_activity ?? []).length}.`}
                />
                <Space size={[8, 8]} wrap>
                  <Tag color="purple">RBAC 24h: {rbacAnomalyCount}</Tag>
                  <Tag color="volcano">Ngoại lệ quá hạn: {exceptionOverdue}</Tag>
                  <Tag color="cyan">Provisioning: {(workspace?.provisioning.recent_activity ?? []).length}</Tag>
                  <Tag color="gold">Offboarding: {(workspace?.offboarding.recent_activity ?? []).length}</Tag>
                  <Tag color="geekblue">Review: {(workspace?.access_review.recent_activity ?? []).length}</Tag>
                </Space>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  Cụm governance này gom các tín hiệu từ RBAC audit, access review, provisioning và offboarding để admin
                  thấy nhanh khu vực nào đang nóng trước khi drilldown sang từng command center chuyên biệt.
                </Paragraph>
              </Space>
            </Card>
          </Col>
        ) : null}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {routeCards.map((card) => (
          <Col xs={24} md={12} xl={8} key={card.key}>
            <Card style={PANEL_STYLE} bodyStyle={{ padding: 18 }}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Text strong style={{ fontSize: 16 }}>{card.title}</Text>
                <Text strong style={{ color: '#0f172a' }}>{card.metric}</Text>
                <Text type="secondary">{card.subMetric}</Text>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  {card.description}
                </Paragraph>
                <Button
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  data-testid={`admin-observability-route-${card.key}`}
                  onClick={() => navigate(card.route)}
                >
                  Mở trung tâm
                </Button>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      {businessFlowCards.length ? (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          {businessFlowCards.map((card) => (
            <Col xs={24} md={12} xl={12} key={card.key}>
              <Card
                title={card.title}
                style={PANEL_STYLE}
                bodyStyle={{ padding: 18 }}
                extra={<Tag color={card.tint}>Radar nghiệp vụ</Tag>}
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Text strong style={{ fontSize: 24, color: card.tint }}>{card.metric}</Text>
                    <Text type="secondary">{card.subMetric}</Text>
                    <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      {card.description}
                    </Paragraph>
                  </Space>
                  <Space size={[8, 8]} wrap>
                    {card.chips.map((chip) => (
                      <Tag key={`${card.key}-${chip}`} color={domainTint(card.domain)}>
                        {chip}
                      </Tag>
                    ))}
                  </Space>
                  {card.highlights.length ? (
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      {card.highlights.map((item) => (
                        <Card
                          key={`${card.key}-${item.title}`}
                          size="small"
                          bodyStyle={{ padding: 12 }}
                          style={{ borderRadius: 16, border: '1px solid #e2e8f0', background: '#fafcff' }}
                        >
                          <Space direction="vertical" size={2}>
                            <Text strong>{item.title}</Text>
                            <Text type="secondary">{item.description}</Text>
                          </Space>
                        </Card>
                      ))}
                    </Space>
                  ) : (
                    <Alert
                      showIcon
                      type="success"
                      message="Chưa phát hiện hồ sơ nóng trong phạm vi đang xem"
                    />
                  )}
                  <Space wrap>
                    <Button
                      type="primary"
                      icon={<ArrowRightOutlined />}
                      data-testid={`admin-observability-route-${card.key}`}
                      onClick={() => navigate(card.route)}
                    >
                      {card.routeLabel}
                    </Button>
                    {card.secondaryRoute ? (
                      <Button onClick={() => navigate(card.secondaryRoute!)}>
                        {card.secondaryRouteLabel}
                      </Button>
                    ) : null}
                  </Space>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      ) : null}

      {approvalAuditDomains.length ? (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24}>
            <Card
              title="Approval Pulse"
              style={PANEL_STYLE}
              bodyStyle={{ padding: 18 }}
              extra={(
                <Button
                  type="primary"
                  data-testid="admin-observability-route-approval-control-tower"
                  onClick={() => navigate('/admin/approval-control-tower')}
                >
                  Mở control tower duyệt
                </Button>
              )}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  Gom hồ sơ nóng nhất và nhịp submit/approve/reject 7 ngày để admin nhìn ra miền nào đang tăng nhiệt trước khi chuyển sang command center duyệt chi tiết.
                </Paragraph>
                <div
                  data-testid="admin-observability-approval-queue-pulse"
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}
                >
                  <Card size="small" bodyStyle={{ padding: 14 }} style={{ borderRadius: 16, border: '1px solid #e2e8f0' }}>
                    <Space direction="vertical" size={4}>
                      <Text type="secondary">Hàng chờ hiện tại</Text>
                      <Text strong style={{ fontSize: 24 }}>{approvalQueueSummary?.total_pending ?? approvalQueueRows.length}</Text>
                    </Space>
                  </Card>
                  <Card size="small" bodyStyle={{ padding: 14 }} style={{ borderRadius: 16, border: '1px solid #e2e8f0' }}>
                    <Space direction="vertical" size={4}>
                      <Text type="secondary">Cần chốt gấp</Text>
                      <Text strong style={{ fontSize: 24, color: '#cf1322' }}>{approvalQueueSummary?.critical_queue_count ?? 0}</Text>
                    </Space>
                  </Card>
                  <Card size="small" bodyStyle={{ padding: 14 }} style={{ borderRadius: 16, border: '1px solid #e2e8f0' }}>
                    <Space direction="vertical" size={4}>
                      <Text type="secondary">Chờ quá 2 ngày</Text>
                      <Text strong style={{ fontSize: 24, color: '#d97706' }}>{approvalQueueSummary?.stale_queue_count ?? 0}</Text>
                    </Space>
                  </Card>
                  <Card size="small" bodyStyle={{ padding: 14 }} style={{ borderRadius: 16, border: '1px solid #e2e8f0' }}>
                    <Space direction="vertical" size={4}>
                      <Text type="secondary">Hàng chờ đa cấp</Text>
                      <Text strong style={{ fontSize: 24, color: '#1677ff' }}>{approvalQueueSummary?.multi_level_queue_count ?? 0}</Text>
                    </Space>
                  </Card>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {approvalAuditHotItems.slice(0, 4).map((item) => (
                    <Card
                      key={item.id}
                      size="small"
                      bodyStyle={{ padding: 14 }}
                      style={{ borderRadius: 16, border: '1px solid #e2e8f0', background: '#fafcff' }}
                    >
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        <Space wrap>
                          <Tag color={domainTint(item.domain)}>{domainLabel(item.domain)}</Tag>
                          <Tag color={item.age_days >= 2 ? 'volcano' : 'gold'}>{item.age_days} ngày chờ</Tag>
                        </Space>
                        <Text strong>{item.entity_code}</Text>
                        <Text type="secondary">{item.title}</Text>
                        <Text type="secondary">{item.aging_hint}</Text>
                      </Space>
                    </Card>
                  ))}
                </div>
                {approvalAuditTimeline.length ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
                    {approvalAuditTimeline.map((item) => (
                      <Card
                        key={item.date}
                        size="small"
                        bodyStyle={{ padding: 12 }}
                        style={{ borderRadius: 16, border: '1px solid #e2e8f0', background: '#ffffff' }}
                      >
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          <Text strong>{dayjs(item.date).format('DD/MM')}</Text>
                          <Text type="secondary">Gửi {item.submitted}</Text>
                          <Text type="secondary">Duyệt {item.approved}</Text>
                          <Text type="secondary">Từ chối {item.rejected}</Text>
                        </Space>
                      </Card>
                    ))}
                  </div>
                ) : null}
              </Space>
            </Card>
          </Col>
          <Col xs={24} xl={11}>
            <Card
              title="Bảng kiểm soát duyệt trọng yếu"
              style={PANEL_STYLE}
              bodyStyle={{ padding: 18 }}
              extra={<Tag color="geekblue">7 ngày gần nhất</Tag>}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  Gom hàng chờ, số quyết định đã duyệt, số hồ sơ bị từ chối và thời điểm có biến động gần nhất theo từng miền nghiệp vụ để admin drilldown nhanh.
                </Paragraph>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {approvalAuditDomains.map((item) => (
                    <Card
                      key={item.domain}
                      size="small"
                      bodyStyle={{ padding: 14 }}
                      style={{ borderRadius: 16, border: '1px solid #dbeafe', background: '#f8fbff' }}
                    >
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space wrap>
                          <Tag color={domainTint(item.domain)}>{item.label}</Tag>
                          <Tag color={item.rejected_7d > 0 ? 'volcano' : item.pending_now > 0 ? 'gold' : 'green'}>
                            {item.rejected_7d > 0 ? 'Cần rà' : item.pending_now > 0 ? 'Đang chờ' : 'Ổn định'}
                          </Tag>
                        </Space>
                        <Text strong style={{ fontSize: 18 }}>{item.pending_now} hồ sơ đang chờ</Text>
                        <Text type="secondary">
                          Gửi duyệt {item.submitted_7d} | Đã duyệt {item.approved_7d} | Từ chối {item.rejected_7d}
                        </Text>
                        <Text type="secondary">Biến động gần nhất: {formatDateTime(item.last_event_at)}</Text>
                        <Button
                          type="primary"
                          icon={<ArrowRightOutlined />}
                          data-testid={`admin-observability-approval-domain-${item.domain}`}
                          onClick={() =>
                            navigate(buildApprovalDrilldownRoute({ domain: item.domain, route: item.route }))
                          }
                        >
                          Mở tác nghiệp
                        </Button>
                      </Space>
                    </Card>
                  ))}
                </div>
              </Space>
            </Card>
          </Col>

          <Col xs={24} xl={13}>
            <Card
              title="Nhật ký quyết định duyệt 7 ngày"
              style={PANEL_STYLE}
              bodyStyle={{ padding: 18 }}
              extra={<Button icon={<DownloadOutlined />} onClick={exportActivity}>Xuất CSV</Button>}
            >
              {approvalAuditRecent.length ? (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 6, hideOnSinglePage: true }}
                  dataSource={approvalAuditRecent}
                  columns={[
                    {
                      title: 'Miền',
                      dataIndex: 'domain',
                      width: 120,
                      render: (value: Exclude<DomainFilter, 'all'>) => <Tag color={domainTint(value)}>{domainLabel(value)}</Tag>,
                    },
                    {
                      title: 'Quyết định',
                      key: 'summary',
                      render: (_, record) => (
                        <Space direction="vertical" size={4}>
                          <Space wrap>
                            <Tag color={record.action === 'REJECT' ? 'volcano' : 'green'}>{record.action_label}</Tag>
                            <Text strong>{record.summary}</Text>
                          </Space>
                          <Text type="secondary">
                            {record.actor_label} | {formatDateTime(record.created_at)} | {record.entity_code || 'Không mã hóa'}
                          </Text>
                          {record.comments ? <Text type="secondary">{record.comments}</Text> : null}
                        </Space>
                      ),
                    },
                    {
                      title: 'Điều hướng',
                      key: 'actions',
                      width: 120,
                      render: (_, record) => (
                        <Button
                          type="link"
                          icon={<ArrowRightOutlined />}
                          onClick={() =>
                            navigate(
                              buildApprovalDrilldownRoute({
                                domain: record.domain,
                                route: record.route,
                                action: record.action,
                                entityCode: record.entity_code,
                                entityId: record.entity_id,
                              })
                            )
                          }
                        >
                          Mở
                        </Button>
                      ),
                    },
                  ]}
                />
              ) : (
                <Empty description="Chưa có quyết định duyệt nào trong 7 ngày gần nhất." />
              )}
            </Card>
          </Col>
        </Row>
      ) : null}

      {auditSpotlightDomains.length ? (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24} xl={11}>
            <Card
              title="Radar audit nhạy cảm"
              style={PANEL_STYLE}
              bodyStyle={{ padding: 18 }}
              extra={(
                <Button
                  type="link"
                  data-testid="admin-observability-route-audit-center"
                  onClick={() => navigate('/admin/audit-center')}
                >
                  Mở audit center
                </Button>
              )}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Alert
                  showIcon
                  type={(auditSpotlight?.high_severity_events ?? 0) > 0 ? 'warning' : 'info'}
                  message={
                    (auditSpotlight?.high_severity_events ?? 0) > 0
                      ? `Có ${auditSpotlight?.high_severity_events ?? 0} sự kiện critical trong radar audit.`
                      : 'Radar audit đang ở trạng thái theo dõi bình thường.'
                  }
                  description={`Tổng ${auditSpotlight?.total_events ?? 0} sự kiện | nhạy cảm ${auditSpotlight?.sensitive_events ?? 0} | actor hotspot ${auditSpotlightActors.length}.`}
                />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {auditSpotlightDomains.map((item) => (
                    <Card
                      key={`audit-${item.domain}`}
                      size="small"
                      bodyStyle={{ padding: 14 }}
                      style={{ borderRadius: 16, border: '1px solid #e2e8f0', background: '#fbfdff' }}
                    >
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space wrap>
                          <Tag color={domainTint(item.domain)}>{item.label}</Tag>
                          <Tag color={item.high_severity_events_24h > 0 ? 'volcano' : item.sensitive_events_24h > 0 ? 'gold' : 'green'}>
                            {item.high_severity_events_24h > 0 ? 'Critical' : item.sensitive_events_24h > 0 ? 'Nhạy cảm' : 'Ổn định'}
                          </Tag>
                        </Space>
                        <Text strong>{item.events_24h} sự kiện 24h</Text>
                        <Text type="secondary">
                          Nhạy cảm {item.sensitive_events_24h} | Critical {item.high_severity_events_24h} | Actor {item.actors_24h}
                        </Text>
                        <Text type="secondary">Cập nhật cuối: {formatDateTime(item.last_event_at)}</Text>
                        <Button
                          type="primary"
                          icon={<ArrowRightOutlined />}
                          data-testid={`admin-observability-audit-domain-${item.domain}`}
                          onClick={() => navigate(item.route)}
                        >
                          Mở miền audit
                        </Button>
                      </Space>
                    </Card>
                  ))}
                </div>
              </Space>
            </Card>
          </Col>

          <Col xs={24} xl={13}>
            <Card
              title="Hot actor và nhật ký audit"
              style={PANEL_STYLE}
              bodyStyle={{ padding: 18 }}
              extra={<Tag color="purple">72 giờ gần nhất</Tag>}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {auditSpotlightActors.length ? (
                  <Space size={[8, 8]} wrap>
                    {auditSpotlightActors.slice(0, 4).map((actor) => (
                      <Tag key={`audit-actor-${actor.actor_id ?? actor.username}`} color={actor.high_severity_event_count > 0 ? 'volcano' : actor.sensitive_event_count > 0 ? 'gold' : 'blue'}>
                        {(actor.full_name || actor.username || 'Hệ thống')}: {actor.event_count}
                      </Tag>
                    ))}
                  </Space>
                ) : null}
                {auditSpotlightRecent.length ? (
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 6, hideOnSinglePage: true }}
                    dataSource={auditSpotlightRecent}
                    columns={[
                      {
                        title: 'Miền',
                        dataIndex: 'domain',
                        width: 140,
                        render: (value: Exclude<DomainFilter, 'all'>) => <Tag color={domainTint(value)}>{domainLabel(value)}</Tag>,
                      },
                      {
                        title: 'Sự kiện',
                        key: 'summary',
                        render: (_, record) => (
                          <Space direction="vertical" size={4}>
                            <Space wrap>
                              <Tag color={severityColor(record.severity as SeverityFilter)}>{record.action_label}</Tag>
                              <Text strong>{record.summary}</Text>
                            </Space>
                            <Text type="secondary">
                              {record.actor_label} | {record.entity_code || record.entity_type} | {formatDateTime(record.created_at)}
                            </Text>
                            {record.comments ? <Text type="secondary">{record.comments}</Text> : null}
                          </Space>
                        ),
                      },
                      {
                        title: 'Điều hướng',
                        key: 'actions',
                        width: 120,
                        render: (_, record) => (
                          <Button
                            type="link"
                            icon={<ArrowRightOutlined />}
                            onClick={() =>
                              navigate(
                                buildAuditDrilldownRoute({
                                  domain: record.domain,
                                  route: record.route,
                                  action: record.action,
                                  entityCode: record.entity_code,
                                  entityId: record.entity_id,
                                })
                              )
                            }
                          >
                            Mở
                          </Button>
                        ),
                      },
                    ]}
                  />
                ) : (
                  <Empty description="Chưa có sự kiện audit nào nổi bật trong cửa sổ đang theo dõi." />
                )}
              </Space>
            </Card>
          </Col>
        </Row>
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={11}>
          <Card
            title="Watchlist vận hành và nghiệp vụ"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={(
              <Space wrap>
                <Select<DomainFilter>
                  value={domainFilter}
                  onChange={setDomainFilter}
                  style={{ width: 180 }}
                  options={[
                    { value: 'all', label: 'Mọi miền' },
                    { value: 'system', label: 'Hệ thống' },
                    { value: 'workflow', label: 'Workflow' },
                    { value: 'finance', label: 'Tài chính' },
                    { value: 'workforce', label: 'Nhân sự' },
                    { value: 'purchasing', label: 'Mua hàng' },
                    { value: 'production', label: 'Sản xuất' },
                    { value: 'exception', label: 'Ngoại lệ' },
                    { value: 'review', label: 'Rà soát' },
                    { value: 'governance', label: 'RBAC' },
                    { value: 'provisioning', label: 'Cấp tài khoản' },
                    { value: 'offboarding', label: 'Kết thúc vòng đời' },
                  ]}
                />
                <Select<SeverityFilter>
                  value={severityFilter}
                  onChange={setSeverityFilter}
                  style={{ width: 170 }}
                  options={[
                    { value: 'all', label: 'Mọi mức độ' },
                    { value: 'error', label: 'Critical' },
                    { value: 'warning', label: 'Cảnh báo' },
                    { value: 'info', label: 'Thông tin' },
                    { value: 'success', label: 'Ổn định' },
                  ]}
                />
                <Button icon={<DownloadOutlined />} onClick={exportWatchlist}>
                  Xuất CSV
                </Button>
              </Space>
            )}
          >
            {filteredWatchlist.length ? (
              <Table<WatchlistRow>
                rowKey="id"
                size="small"
                loading={isLoading}
                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                dataSource={filteredWatchlist}
                columns={watchlistColumns}
              />
            ) : (
              <Empty description="Chưa có điểm nóng nào khớp bộ lọc hiện tại." />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={13}>
          <Card
            title="Nhật ký audit và tín hiệu nghiệp vụ"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={(
              <Space wrap>
                <Input.Search
                  allowClear
                  placeholder="Tìm theo hành động, actor, mã đối tượng hoặc tóm tắt"
                  value={activitySearch}
                  onChange={(event) => setActivitySearch(event.target.value)}
                  style={{ width: 300 }}
                />
                <Button icon={<DownloadOutlined />} onClick={exportActivity}>
                  Xuất CSV
                </Button>
              </Space>
            )}
          >
            {filteredActivity.length ? (
              <Table<ActivityRow>
                rowKey="id"
                size="small"
                loading={isLoading}
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                dataSource={filteredActivity}
                columns={activityColumns}
              />
            ) : (
              <Empty description="Chưa có hoạt động nào khớp bộ lọc hiện tại." />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        open={isPresetModalOpen}
        title="Lưu mẫu lọc observability"
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
            Lưu nhanh bộ lọc theo ca trực, theo miền giám sát hoặc theo mức độ sự cố để mở lại đúng góc nhìn khi đổi ca.
          </Paragraph>
          <Input
            data-testid="admin-observability-preset-name"
            placeholder="Ví dụ: Ca tối theo dõi workflow và critical"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            onPressEnter={() => void saveNamedPreset()}
          />
        </Space>
      </Modal>
    </div>
  );
}
