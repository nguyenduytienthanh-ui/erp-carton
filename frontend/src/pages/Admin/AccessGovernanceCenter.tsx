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
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';
import { PAGES } from '../../utils/constants';

const { Text, Paragraph } = Typography;

type DomainFilter = 'all' | 'review' | 'exception' | 'provisioning' | 'offboarding' | 'governance';
type SeverityFilter = 'all' | 'error' | 'warning' | 'info' | 'success';

type CombinedWatchlistRow = {
  id: string;
  domain: Exclude<DomainFilter, 'all'>;
  severity: Exclude<SeverityFilter, 'all'>;
  title: string;
  description: string;
  metric: string;
  route: string;
};

type CombinedActivityRow = {
  id: string;
  domain: Exclude<DomainFilter, 'all'>;
  severity: Exclude<SeverityFilter, 'all'>;
  timestamp: string | null;
  summary: string;
  action: string;
  actorLabel: string;
  entityCode: string;
  route: string;
};

type GovernanceHealthSignal = {
  key: string;
  title: string;
  value: string;
  detail: string;
  tint: string;
};

type GovernanceTriageLane = {
  key: string;
  title: string;
  tone: Exclude<SeverityFilter, 'all'>;
  description: string;
  items: Array<{
    id: string;
    domain: Exclude<DomainFilter, 'all'>;
    title: string;
    metric: string;
    route: string;
    severity: Exclude<SeverityFilter, 'all'>;
  }>;
};
type GovernanceFilterSnapshot = {
  domain_filter: DomainFilter;
  severity_filter: SeverityFilter;
  activity_search: string;
};
type GovernanceNamedPreset = {
  id: string;
  name: string;
  filters: GovernanceFilterSnapshot;
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

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  return dayjs(value).format('DD/MM/YYYY HH:mm');
}

function severityColor(severity: SeverityFilter): string {
  if (severity === 'error') return 'volcano';
  if (severity === 'warning') return 'gold';
  if (severity === 'success') return 'green';
  return 'blue';
}

function domainLabel(domain: Exclude<DomainFilter, 'all'>): string {
  if (domain === 'review') return 'Rà soát';
  if (domain === 'exception') return 'Ngoại lệ';
  if (domain === 'provisioning') return 'Cấp tài khoản';
  if (domain === 'offboarding') return 'Kết thúc vòng đời';
  return 'Governance';
}

function domainTint(domain: Exclude<DomainFilter, 'all'>): string {
  if (domain === 'review') return '#2563eb';
  if (domain === 'exception') return '#dc2626';
  if (domain === 'provisioning') return '#0891b2';
  if (domain === 'offboarding') return '#d97706';
  return '#7c3aed';
}

function normalizeSeverity(rawValue: string | null | undefined): Exclude<SeverityFilter, 'all'> {
  if (rawValue === 'error' || rawValue === 'warning' || rawValue === 'success') return rawValue;
  return 'info';
}

function deriveActivitySeverity(action: string, fallback?: string | null): Exclude<SeverityFilter, 'all'> {
  if (fallback) return normalizeSeverity(fallback);
  if (['REVOKE', 'REJECT', 'DELETE'].includes(action)) return 'warning';
  if (['LOCK', 'LOCK_ACCOUNT'].includes(action)) return 'error';
  return 'info';
}

function buildRouteWithQuery(
  route: string,
  params: Record<string, string | number | null | undefined>,
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

function buildGovernanceDrilldownRoute(
  route: string,
  domain: Exclude<DomainFilter, 'all'>,
  options: {
    entityCode?: string;
    entityId?: number | null;
    policyKey?: string | null;
    requestKey?: string | null;
    campaignKey?: string | null;
    governanceKind?: string | null;
  },
): string {
  if (domain === 'review') {
    return buildRouteWithQuery(route, {
      campaign_key: options.campaignKey || options.entityCode || undefined,
      search: options.entityCode || undefined,
    });
  }
  if (domain === 'exception') {
    return buildRouteWithQuery(route, {
      request_key: options.requestKey || undefined,
      policy_key: options.policyKey || undefined,
      search: options.requestKey || options.policyKey || options.entityCode || undefined,
    });
  }
  if (domain === 'provisioning') {
    return buildRouteWithQuery(route, {
      focus_user_id: options.entityId ?? undefined,
      focus: options.entityCode || undefined,
    });
  }
  if (domain === 'offboarding') {
    return buildRouteWithQuery(route, {
      focus_user_id: options.entityId ?? undefined,
      focus: options.entityCode || undefined,
    });
  }
  if (domain === 'governance') {
    if (route.includes('/admin/users')) {
      return buildRouteWithQuery(route, {
        focus_id: options.entityId ?? undefined,
        search: options.entityCode || undefined,
      });
    }
    return buildRouteWithQuery(route, {
      focus_kind: options.governanceKind || undefined,
      focus_id: options.entityId ?? undefined,
      q: options.entityCode || undefined,
    });
  }
  return route;
}

function SummaryCard({
  title,
  value,
  tint,
}: {
  title: string;
  value: number | string;
  tint: string;
}) {
  return (
    <Card style={HERO_CARD_STYLE} bodyStyle={{ padding: 18 }}>
      <Statistic title={title} value={value} valueStyle={{ color: tint, fontWeight: 700 }} />
    </Card>
  );
}

export default function AccessGovernanceCenter() {
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
  const { config: savedConfig, saveConfig } = useUserPreferences(PAGES.ADMIN_ACCESS_GOVERNANCE);

  const governanceSummaryQuery = useQuery({
    queryKey: ['admin-role-governance-summary'],
    queryFn: adminApi.getRoleGovernanceSummary,
  });
  const governanceActivityQuery = useQuery({
    queryKey: ['admin-role-governance-activity', 'all', 18],
    queryFn: () => adminApi.getRoleGovernanceActivity({ kind: 'all', limit: 18 }),
  });
  const accessReviewWorkspaceQuery = useQuery({
    queryKey: ['admin-access-review-workspace'],
    queryFn: adminApi.getAccessReviewWorkspace,
  });
  const accessReviewActivityQuery = useQuery({
    queryKey: ['admin-access-review-activity'],
    queryFn: () => adminApi.getAccessReviewActivity({ limit: 18 }),
  });
  const accessExceptionWorkspaceQuery = useQuery({
    queryKey: ['admin-access-exception-workspace'],
    queryFn: adminApi.getAccessExceptionWorkspace,
  });
  const accessExceptionActivityQuery = useQuery({
    queryKey: ['admin-access-exception-activity'],
    queryFn: () => adminApi.getAccessExceptionActivity({ limit: 18 }),
  });
  const provisioningWorkspaceQuery = useQuery({
    queryKey: ['admin-user-provisioning-workspace'],
    queryFn: adminApi.getUserProvisioningWorkspace,
  });
  const provisioningActivityQuery = useQuery({
    queryKey: ['admin-user-provisioning-activity'],
    queryFn: () => adminApi.getUserProvisioningActivity({ limit: 18 }),
  });
  const offboardingWorkspaceQuery = useQuery({
    queryKey: ['admin-user-offboarding-workspace'],
    queryFn: adminApi.getUserOffboardingWorkspace,
  });
  const offboardingActivityQuery = useQuery({
    queryKey: ['admin-user-offboarding-activity'],
    queryFn: () => adminApi.getUserOffboardingActivity({ limit: 18 }),
  });
  const surfaceAuditMutation = useMutation({
    mutationFn: () => adminApi.getAccessGovernanceSurfaceAudit(),
    onSuccess: (payload) => {
      const uncoveredCount = payload.summary.uncovered_routes
        + payload.summary.uncovered_api_surfaces
        + payload.summary.uncovered_critical_actions;
      downloadJsonFile('access-governance-surface-audit.json', payload);
      messageApi.success(`Da xuat surface audit governance. Uncovered surfaces: ${uncoveredCount}.`);
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Khong the xuat surface audit governance.'));
    },
  });

  const allQueries = [
    governanceSummaryQuery,
    governanceActivityQuery,
    accessReviewWorkspaceQuery,
    accessReviewActivityQuery,
    accessExceptionWorkspaceQuery,
    accessExceptionActivityQuery,
    provisioningWorkspaceQuery,
    provisioningActivityQuery,
    offboardingWorkspaceQuery,
    offboardingActivityQuery,
  ];
  const isLoading = allQueries.some((query) => query.isLoading);
  const firstError = allQueries.find((query) => query.error)?.error;

  const watchlistRows: CombinedWatchlistRow[] = [
    ...((accessReviewWorkspaceQuery.data?.watchlist ?? []).map((item) => ({
      id: `review-${item.campaign_key}-${item.title}`,
      domain: 'review' as const,
      severity: normalizeSeverity(item.severity),
      title: item.title,
      description: item.description,
      metric: `${item.matched_user_count} tài khoản khớp`,
      route: buildGovernanceDrilldownRoute(item.route || '/admin/access-reviews', 'review', {
        campaignKey: item.campaign_key,
      }),
    }))),
    ...((accessExceptionWorkspaceQuery.data?.watchlist ?? []).map((item) => ({
      id: `exception-${item.request_key || item.policy_key || item.title}`,
      domain: 'exception' as const,
      severity: normalizeSeverity(item.severity),
      title: item.title,
      description: item.description,
      metric: item.lifecycle_state || 'Theo dõi governance',
      route: buildGovernanceDrilldownRoute(item.route || '/admin/access-exceptions', 'exception', {
        policyKey: item.policy_key,
        requestKey: item.request_key,
      }),
    }))),
    ...((provisioningWorkspaceQuery.data?.watchlist ?? []).map((item) => ({
      id: `provisioning-${item.id}`,
      domain: 'provisioning' as const,
      severity: normalizeSeverity(item.severity),
      title: item.full_name || item.username,
      description: item.summary,
      metric: item.state_label,
      route: buildGovernanceDrilldownRoute(item.route || '/admin/user-provisioning', 'provisioning', {
        entityId: item.id,
        entityCode: item.username,
      }),
    }))),
    ...((offboardingWorkspaceQuery.data?.watchlist ?? []).map((item) => ({
      id: `offboarding-${item.id}`,
      domain: 'offboarding' as const,
      severity: normalizeSeverity(item.severity),
      title: item.full_name || item.username,
      description: item.summary,
      metric: item.state_label,
      route: buildGovernanceDrilldownRoute(item.route || '/admin/user-lifecycle', 'offboarding', {
        entityId: item.id,
        entityCode: item.username,
      }),
    }))),
    ...((governanceSummaryQuery.data?.watchlist ?? []).map((item) => ({
      id: `governance-${item.kind}-${item.entity_id}`,
      domain: 'governance' as const,
      severity: normalizeSeverity(item.severity),
      title: item.title,
      description: item.description,
      metric: item.kind === 'role' ? 'Vai trò' : item.kind === 'team' ? 'Nhóm' : 'Tài khoản',
      route: buildGovernanceDrilldownRoute(item.kind === 'user' ? '/admin/users' : (item.route || '/admin/roles-teams'), 'governance', {
        entityId: item.entity_id,
        governanceKind: item.kind,
      }),
    }))),
  ].sort((left, right) => {
    const severityScore = { error: 3, warning: 2, info: 1, success: 0 };
    return severityScore[right.severity] - severityScore[left.severity];
  });

  const filteredWatchlist = watchlistRows.filter((item) => {
    if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
    if (severityFilter !== 'all' && item.severity !== severityFilter) return false;
    return true;
  });

  const activityRows: CombinedActivityRow[] = [
    ...((accessReviewActivityQuery.data?.items ?? []).map((item) => ({
      id: `review-${item.id}`,
      domain: 'review' as const,
      severity: deriveActivitySeverity(item.action),
      timestamp: item.timestamp,
      summary: item.summary,
      action: item.action,
      actorLabel: item.actor.full_name || item.actor.username || 'Hệ thống',
      entityCode: item.entity_code,
      route: buildGovernanceDrilldownRoute(item.route || '/admin/access-reviews', 'review', {
        campaignKey: item.entity_code,
        entityCode: item.entity_code,
      }),
    }))),
    ...((accessExceptionActivityQuery.data?.items ?? []).map((item) => ({
      id: `exception-${item.id}`,
      domain: 'exception' as const,
      severity: deriveActivitySeverity(item.action),
      timestamp: item.timestamp,
      summary: item.summary,
      action: item.action,
      actorLabel: item.actor.full_name || item.actor.username || 'Hệ thống',
      entityCode: item.entity_code,
      route: buildGovernanceDrilldownRoute(item.route || '/admin/access-exceptions', 'exception', {
        requestKey: item.entity_code,
        entityCode: item.entity_code,
      }),
    }))),
    ...((provisioningActivityQuery.data?.items ?? []).map((item) => ({
      id: `provisioning-${item.id}`,
      domain: 'provisioning' as const,
      severity: 'info' as const,
      timestamp: item.timestamp,
      summary: item.summary,
      action: 'PROVISION',
      actorLabel: item.actor.full_name || item.actor.username || 'Hệ thống',
      entityCode: item.entity_code,
      route: buildGovernanceDrilldownRoute(item.route || '/admin/user-provisioning', 'provisioning', {
        entityCode: item.entity_code,
      }),
    }))),
    ...((offboardingActivityQuery.data?.items ?? []).map((item) => ({
      id: `offboarding-${item.id}`,
      domain: 'offboarding' as const,
      severity: 'warning' as const,
      timestamp: item.timestamp,
      summary: item.summary,
      action: 'OFFBOARD',
      actorLabel: item.actor.full_name || item.actor.username || 'Hệ thống',
      entityCode: item.entity_code,
      route: buildGovernanceDrilldownRoute(item.route || '/admin/user-lifecycle', 'offboarding', {
        entityCode: item.entity_code,
      }),
    }))),
    ...((governanceActivityQuery.data?.items ?? []).map((item) => ({
      id: `governance-${item.id}`,
      domain: 'governance' as const,
      severity: deriveActivitySeverity(item.action, item.severity),
      timestamp: item.timestamp,
      summary: item.summary,
      action: item.action,
      actorLabel: item.actor.full_name || item.actor.username || 'Hệ thống',
      entityCode: item.entity_code,
      route: buildGovernanceDrilldownRoute(
        item.entity_type === 'User' ? '/admin/users' : (item.route || '/admin/roles-teams'),
        'governance',
        {
          entityId: item.entity_id,
          entityCode: item.entity_code,
          governanceKind: item.entity_type === 'Role' ? 'role' : item.entity_type === 'Team' ? 'team' : 'user',
        },
      ),
    }))),
  ].sort((left, right) => dayjs(right.timestamp || 0).valueOf() - dayjs(left.timestamp || 0).valueOf());

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
  const namedPresets = useMemo(() => {
    const raw = savedConfig?.saved_views;
    if (!Array.isArray(raw)) return [] as GovernanceNamedPreset[];
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
          && domainValue !== 'review'
          && domainValue !== 'exception'
          && domainValue !== 'provisioning'
          && domainValue !== 'offboarding'
          && domainValue !== 'governance'
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
        } as GovernanceNamedPreset;
      })
      .filter((item): item is GovernanceNamedPreset => item !== null);
  }, [savedConfig?.saved_views]);
  const selectedPreset = namedPresets.find((item) => item.id === selectedPresetId) ?? null;

  const reviewQueue = accessReviewWorkspaceQuery.data?.summary.review_queue ?? 0;
  const destructiveCampaigns = accessReviewWorkspaceQuery.data?.summary.destructive_campaigns ?? 0;
  const exceptionHighRisk = accessExceptionWorkspaceQuery.data?.summary.high_risk_requests ?? 0;
  const exceptionCritical = accessExceptionWorkspaceQuery.data?.summary.guided_remediation_critical ?? 0;
  const provisioningAttention = provisioningWorkspaceQuery.data?.summary.attention_accounts ?? 0;
  const provisioningGaps = provisioningWorkspaceQuery.data?.summary.access_gaps ?? 0;
  const offboardingQueue = offboardingWorkspaceQuery.data?.summary.review_queue ?? 0;
  const offboardingRetained = offboardingWorkspaceQuery.data?.summary.access_retained ?? 0;
  const governanceSensitive = governanceSummaryQuery.data?.summary.sensitive_roles ?? 0;
  const governanceRecent = governanceSummaryQuery.data?.summary.recent_events_7d ?? 0;
  const governanceUsersWithoutRole = governanceSummaryQuery.data?.summary.users_without_role ?? 0;
  const governanceUsersWithoutTeam = governanceSummaryQuery.data?.summary.users_without_team ?? 0;

  const healthSignals: GovernanceHealthSignal[] = [
    {
      key: 'coverage',
      title: 'Vệ sinh role/team',
      value: `${governanceUsersWithoutRole + governanceUsersWithoutTeam}`,
      detail: `${governanceUsersWithoutRole} chưa có vai trò | ${governanceUsersWithoutTeam} chưa có nhóm`,
      tint: '#7c3aed',
    },
    {
      key: 'exceptions',
      title: 'Nợ ngoại lệ truy cập',
      value: `${exceptionHighRisk}`,
      detail: `${exceptionCritical} critical remediation | ${watchlistRows.filter((item) => item.domain === 'exception').length} điểm nóng`,
      tint: '#dc2626',
    },
    {
      key: 'lifecycle',
      title: 'Backlog vòng đời',
      value: `${provisioningAttention + offboardingQueue}`,
      detail: `${provisioningAttention} cấp tài khoản cần follow-up | ${offboardingQueue} hồ sơ kết thúc vòng đời`,
      tint: '#d97706',
    },
    {
      key: 'reviews',
      title: 'Rà soát định kỳ',
      value: `${reviewQueue}`,
      detail: `${destructiveCampaigns} campaign cần thao tác thận trọng | ${governanceRecent} sự kiện governance 7 ngày`,
      tint: '#2563eb',
    },
  ];

  const triageLanes: GovernanceTriageLane[] = [
    {
      key: 'immediate',
      title: 'Can thiệp ngay',
      tone: exceptionCritical > 0 || offboardingRetained > 0 ? 'error' : 'warning',
      description: 'Ưu tiên xử lý các cụm giữ quyền, ngoại lệ rủi ro cao và hồ sơ có thể làm trôi kiểm soát truy cập.',
      items: [
        {
          id: 'lane-exception',
          domain: 'exception',
          title: 'Ngoại lệ truy cập',
          metric: `${exceptionHighRisk} yêu cầu rủi ro cao | ${exceptionCritical} critical remediation`,
          route: '/admin/access-exceptions',
          severity: exceptionCritical > 0 ? 'error' : 'warning',
        },
        {
          id: 'lane-offboarding',
          domain: 'offboarding',
          title: 'Kết thúc vòng đời',
          metric: `${offboardingRetained} hồ sơ còn giữ quyền | ${offboardingQueue} hồ sơ chờ xử lý`,
          route: '/admin/user-lifecycle',
          severity: offboardingRetained > 0 ? 'error' : 'warning',
        },
      ],
    },
    {
      key: 'today',
      title: 'Ổn định trong ngày',
      tone: reviewQueue > 0 || provisioningAttention > 0 ? 'warning' : 'info',
      description: 'Giữ cho hàng chờ review và tài khoản mới không dồn cục vào cuối ngày hoặc cuối ca.',
      items: [
        {
          id: 'lane-review',
          domain: 'review',
          title: 'Rà soát truy cập',
          metric: `${reviewQueue} hàng chờ | ${destructiveCampaigns} campaign cần cẩn trọng`,
          route: '/admin/access-reviews',
          severity: reviewQueue > 0 ? 'warning' : 'info',
        },
        {
          id: 'lane-provisioning',
          domain: 'provisioning',
          title: 'Cấp tài khoản',
          metric: `${provisioningAttention} tài khoản cần theo dõi | ${provisioningGaps} access gap`,
          route: '/admin/user-provisioning',
          severity: provisioningGaps > 0 ? 'warning' : 'info',
        },
      ],
    },
    {
      key: 'hygiene',
      title: 'Làm sạch nền quyền',
      tone: governanceSensitive > 0 || governanceUsersWithoutRole > 0 || governanceUsersWithoutTeam > 0 ? 'warning' : 'success',
      description: 'Dọn các lệch chuẩn RBAC và governance catalog để giảm rủi ro tích lũy về lâu dài.',
      items: [
        {
          id: 'lane-users',
          domain: 'governance',
          title: 'Điều phối người dùng',
          metric: `${governanceUsersWithoutRole} chưa có vai trò | ${governanceUsersWithoutTeam} chưa có nhóm`,
          route: '/admin/users',
          severity: governanceUsersWithoutRole > 0 || governanceUsersWithoutTeam > 0 ? 'warning' : 'success',
        },
        {
          id: 'lane-governance',
          domain: 'governance',
          title: 'Role & team governance',
          metric: `${governanceSensitive} vai trò nhạy cảm | ${governanceRecent} sự kiện governance 7 ngày`,
          route: '/admin/roles-teams',
          severity: governanceSensitive > 0 ? 'warning' : 'success',
        },
      ],
    },
  ];

  const routeCards = [
    {
      key: 'review',
      title: 'Rà soát truy cập',
      description: 'Khóa các campaign định kỳ, hàng chờ cần xác nhận và các đợt rà soát có tác động lớn.',
      metric: `${reviewQueue} hàng chờ`,
      subMetric: `${destructiveCampaigns} campaign cần thao tác thận trọng`,
      route: '/admin/access-reviews',
    },
    {
      key: 'exception',
      title: 'Ngoại lệ truy cập',
      description: 'Theo dõi hàng chờ rủi ro cao, debt governance và các kịch bản continuity phải can thiệp tay.',
      metric: `${exceptionHighRisk} yêu cầu rủi ro cao`,
      subMetric: `${exceptionCritical} khuyến nghị critical`,
      route: '/admin/access-exceptions',
    },
    {
      key: 'provisioning',
      title: 'Cấp tài khoản',
      description: 'Giám sát tài khoản vừa cấp, access gap và các trường hợp cần follow-up bảo mật sau provision.',
      metric: `${provisioningAttention} tài khoản cần theo dõi`,
      subMetric: `${provisioningGaps} access gap`,
      route: '/admin/user-provisioning',
    },
    {
      key: 'offboarding',
      title: 'Kết thúc vòng đời',
      description: 'Kiểm soát hàng chờ bàn giao, phiên đăng nhập còn mở và các trường hợp vẫn giữ quyền sau xử lý.',
      metric: `${offboardingQueue} hồ sơ chờ xử lý`,
      subMetric: `${offboardingRetained} còn giữ quyền`,
      route: '/admin/user-lifecycle',
    },
    {
      key: 'users',
      title: 'Điều phối người dùng',
      description: 'Theo dõi tài khoản thiếu role, thiếu team và khóa xử lý nhanh để tránh trôi kiểm soát RBAC.',
      metric: `${governanceUsersWithoutRole} chưa có vai trò`,
      subMetric: `${governanceUsersWithoutTeam} chưa có nhóm`,
      route: '/admin/users',
    },
    {
      key: 'governance',
      title: 'Role & team governance',
      description: 'Rà soát vai trò nhạy cảm, độ phủ phân hệ và lịch sử thay đổi gần đây của governance catalog.',
      metric: `${governanceSensitive} vai trò nhạy cảm`,
      subMetric: `${governanceRecent} sự kiện 7 ngày`,
      route: '/admin/roles-teams',
    },
  ];

  const watchlistColumns: ColumnsType<CombinedWatchlistRow> = [
    {
      title: 'Miền giám sát',
      key: 'domain',
      width: 170,
      render: (_, record) => <Tag color={domainTint(record.domain)}>{domainLabel(record.domain)}</Tag>,
    },
    {
      title: 'Điểm nóng cần xử lý',
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

  const activityColumns: ColumnsType<CombinedActivityRow> = [
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
    })), 'access-governance-watchlist');
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
    })), 'access-governance-activity');
  };
  const activeFilterTags = [
    domainFilter !== 'all' ? `Miền: ${domainLabel(domainFilter)}` : null,
    severityFilter !== 'all' ? `Mức độ: ${severityFilter.toUpperCase()}` : null,
    activitySearch.trim() ? `Từ khóa: ${activitySearch.trim()}` : null,
    selectedPreset ? `Mẫu đang dùng: ${selectedPreset.name}` : null,
  ].filter((item): item is string => Boolean(item));

  const buildCurrentSnapshot = (): GovernanceFilterSnapshot => ({
    domain_filter: domainFilter,
    severity_filter: severityFilter,
    activity_search: activitySearch,
  });

  const applySnapshot = (snapshot: GovernanceFilterSnapshot) => {
    setDomainFilter(snapshot.domain_filter);
    setSeverityFilter(snapshot.severity_filter);
    setActivitySearch(snapshot.activity_search);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem governance.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem governance.');
    }
  };

  const applySavedView = () => {
    const domainValue = savedConfig?.domain_filter;
    const severityValue = savedConfig?.severity_filter;
    const searchValue = savedConfig?.activity_search;
    if (
      domainValue === 'all'
      || domainValue === 'review'
      || domainValue === 'exception'
      || domainValue === 'provisioning'
      || domainValue === 'offboarding'
      || domainValue === 'governance'
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
    messageApi.success('Đã khôi phục chế độ xem governance đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: GovernanceNamedPreset = existing
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
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc governance.' : 'Đã lưu mẫu lọc governance mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc governance.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc governance.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc governance để xóa.');
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
      messageApi.error('Không thể xóa mẫu lọc governance.');
    }
  };

  return (
    <div>
      {contextHolder}
      <PageHeader
        title="Trung tâm giám sát truy cập"
        subtitle="Gom các tín hiệu từ rà soát, ngoại lệ, cấp tài khoản, kết thúc vòng đời và governance catalog vào một command center chung để đội admin theo dõi liên tục."
        icon={<DashboardOutlined />}
        extra={[
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={() => {
              void Promise.all([
                queryClient.invalidateQueries({ queryKey: ['admin-role-governance-summary'] }),
                queryClient.invalidateQueries({ queryKey: ['admin-role-governance-activity'] }),
                queryClient.invalidateQueries({ queryKey: ['admin-access-review-workspace'] }),
                queryClient.invalidateQueries({ queryKey: ['admin-access-review-activity'] }),
                queryClient.invalidateQueries({ queryKey: ['admin-access-exception-workspace'] }),
                queryClient.invalidateQueries({ queryKey: ['admin-access-exception-activity'] }),
                queryClient.invalidateQueries({ queryKey: ['admin-user-provisioning-workspace'] }),
                queryClient.invalidateQueries({ queryKey: ['admin-user-provisioning-activity'] }),
                queryClient.invalidateQueries({ queryKey: ['admin-user-offboarding-workspace'] }),
                queryClient.invalidateQueries({ queryKey: ['admin-user-offboarding-activity'] }),
              ]);
            }}
          >
            Làm mới
          </Button>,
        ]}
      />

      {firstError ? (
        <Alert
          showIcon
          type="error"
          style={{ marginBottom: 16 }}
          message="Không thể tải đầy đủ command center truy cập"
          description={getToastMessage(firstError, 'Một hoặc nhiều nguồn dữ liệu governance đang lỗi.')}
        />
      ) : null}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Hàng chờ rà soát" value={reviewQueue} tint="#2563eb" />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Ngoại lệ rủi ro cao" value={exceptionHighRisk} tint="#dc2626" />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Tài khoản cần follow-up" value={provisioningAttention} tint="#0891b2" />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <SummaryCard title="Kết thúc vòng đời chờ xử lý" value={offboardingQueue} tint="#d97706" />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24}>
          <Card style={PANEL_STYLE} bodyStyle={{ padding: 18 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert
                showIcon
                type={exceptionCritical > 0 || offboardingRetained > 0 ? 'error' : provisioningGaps > 0 || governanceSensitive > 0 ? 'warning' : 'success'}
                message={
                  exceptionCritical > 0 || offboardingRetained > 0
                    ? 'Có điểm nóng cần can thiệp ngay trong governance'
                    : provisioningGaps > 0 || governanceSensitive > 0
                      ? 'Hệ thống đang ổn nhưng còn các cụm cần rà soát chủ động'
                      : 'Bề mặt governance đang ổn định'
                }
                description={
                  exceptionCritical > 0 || offboardingRetained > 0
                    ? `${exceptionCritical} khuyến nghị critical ở ngoại lệ truy cập | ${offboardingRetained} hồ sơ kết thúc vòng đời còn giữ quyền.`
                    : `${provisioningGaps} access gap sau cấp tài khoản | ${governanceSensitive} vai trò nhạy cảm cần theo dõi định kỳ.`
                }
              />
              <Space size={[8, 8]} wrap>
                <Tag color="volcano">{exceptionCritical} critical remediation</Tag>
                <Tag color="gold">{provisioningGaps} access gap</Tag>
                <Tag color="blue">{reviewQueue} review queue</Tag>
                <Tag color="cyan">{governanceRecent} sự kiện governance 7 ngày</Tag>
                <Tag color="purple">{watchlistRows.length} điểm nóng tổng hợp</Tag>
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>

      <Card
        data-testid="access-governance-command-strip"
        style={{ ...PANEL_STYLE, marginBottom: 16 }}
        bodyStyle={{ padding: 18 }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            <div data-testid="access-governance-search">
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
              style={{ width: 180 }}
              options={[
                { value: 'all', label: 'Mọi miền' },
                { value: 'review', label: 'Rà soát' },
                { value: 'exception', label: 'Ngoại lệ' },
                { value: 'provisioning', label: 'Cấp tài khoản' },
                { value: 'offboarding', label: 'Kết thúc vòng đời' },
                { value: 'governance', label: 'Governance' },
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
          </Space>
          <Space wrap>
            <Button data-testid="access-governance-save-view" onClick={() => void saveCurrentView()}>
              Lưu chế độ xem
            </Button>
            <Button
              data-testid="access-governance-export-surface-audit"
              icon={<DownloadOutlined />}
              loading={surfaceAuditMutation.isPending}
              onClick={() => surfaceAuditMutation.mutate()}
            >
              Xuat surface audit
            </Button>
            <Button data-testid="access-governance-restore-view" onClick={applySavedView}>
              Khôi phục
            </Button>
            <Button data-testid="access-governance-open-preset-modal" onClick={() => setIsPresetModalOpen(true)}>
              Tạo mẫu lọc
            </Button>
            <div data-testid="access-governance-preset-select">
              <Select
                value={selectedPresetId}
                onChange={setSelectedPresetId}
                style={{ width: 240 }}
                options={[
                  { value: 'NONE', label: 'Chọn mẫu governance' },
                  ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                ]}
              />
            </div>
            <Button data-testid="access-governance-apply-preset" onClick={applyNamedPreset}>
              Áp dụng mẫu
            </Button>
            <Button
              danger
              data-testid="access-governance-delete-preset"
              disabled={!selectedPreset}
              onClick={() => void deleteNamedPreset()}
            >
              Xóa mẫu
            </Button>
          </Space>
          {activeFilterTags.length ? (
            <Space size={[6, 6]} wrap>
              {activeFilterTags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </Space>
          ) : null}
        </Space>
      </Card>

      <Card
        data-testid="access-governance-health-signals"
        style={{ ...PANEL_STYLE, marginBottom: 16 }}
        bodyStyle={{ padding: 18 }}
        title="Tín hiệu vệ sinh quyền"
        extra={<Tag color="blue">{healthSignals.length} cụm theo dõi</Tag>}
      >
        <Row gutter={[16, 16]}>
          {healthSignals.map((signal) => (
            <Col xs={24} md={12} xl={6} key={signal.key}>
              <Card style={HERO_CARD_STYLE} bodyStyle={{ padding: 18 }}>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Text type="secondary">{signal.title}</Text>
                  <Text strong style={{ fontSize: 28, color: signal.tint }}>{signal.value}</Text>
                  <Text type="secondary">{signal.detail}</Text>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {triageLanes.map((lane) => (
          <Col xs={24} xl={8} key={lane.key}>
            <Card
              data-testid={`access-governance-triage-${lane.key}`}
              style={PANEL_STYLE}
              bodyStyle={{ padding: 18 }}
              title={lane.title}
              extra={<Tag color={severityColor(lane.tone)}>{lane.items.length} cụm ưu tiên</Tag>}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  {lane.description}
                </Paragraph>
                {lane.items.map((item) => (
                  <Card
                    key={item.id}
                    size="small"
                    style={{
                      borderRadius: 18,
                      border: '1px solid #e5e7eb',
                      boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
                    }}
                    bodyStyle={{ padding: 14 }}
                  >
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Space wrap>
                        <Tag color={domainTint(item.domain)}>{domainLabel(item.domain)}</Tag>
                        <Tag color={severityColor(item.severity)}>{item.severity.toUpperCase()}</Tag>
                      </Space>
                      <Text strong>{item.title}</Text>
                      <Text type="secondary">{item.metric}</Text>
                      <Button
                        type="link"
                        icon={<ArrowRightOutlined />}
                        style={{ paddingInline: 0 }}
                        onClick={() => navigate(item.route)}
                      >
                        Mở xử lý
                      </Button>
                    </Space>
                  </Card>
                ))}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {routeCards.map((card) => (
          <Col xs={24} md={12} xl={8} key={card.key}>
            <Card style={PANEL_STYLE} bodyStyle={{ padding: 18 }}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Space wrap>
                  <Tag color={domainTint(card.key as Exclude<DomainFilter, 'all'>)}>{card.title}</Tag>
                </Space>
                <Text strong style={{ fontSize: 16 }}>{card.metric}</Text>
                <Text type="secondary">{card.subMetric}</Text>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  {card.description}
                </Paragraph>
                <Button
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  data-testid={`access-governance-route-${card.key}`}
                  onClick={() => navigate(card.route)}
                >
                  Mở trung tâm
                </Button>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={11}>
          <Card
            title="Watchlist truy cập"
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
                    { value: 'review', label: 'Rà soát' },
                    { value: 'exception', label: 'Ngoại lệ' },
                    { value: 'provisioning', label: 'Cấp tài khoản' },
                    { value: 'offboarding', label: 'Kết thúc vòng đời' },
                    { value: 'governance', label: 'Governance' },
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
              <Table<CombinedWatchlistRow>
                rowKey="id"
                size="small"
                loading={isLoading}
                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                dataSource={filteredWatchlist}
                columns={watchlistColumns}
              />
            ) : (
              <Empty description="Không có điểm nóng nào khớp bộ lọc hiện tại." />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={13}>
          <Card
            title="Nhật ký governance hợp nhất"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={(
              <Space wrap>
                <Input.Search
                  allowClear
                  placeholder="Tìm theo hành động, actor, mã đối tượng hoặc tóm tắt"
                  value={activitySearch}
                  onChange={(event) => setActivitySearch(event.target.value)}
                  style={{ width: 280 }}
                />
                <Button icon={<DownloadOutlined />} onClick={exportActivity}>
                  Xuất CSV
                </Button>
              </Space>
            )}
          >
            {filteredActivity.length ? (
              <Table<CombinedActivityRow>
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
        title="Lưu mẫu lọc governance"
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
            Lưu bộ lọc hiện tại để đội admin mở lại đúng góc nhìn governance khi chuyển ca hoặc xử lý sự cố.
          </Paragraph>
          <Input
            data-testid="access-governance-preset-name"
            placeholder="Ví dụ: Ngoại lệ rủi ro cao cuối ngày"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            onPressEnter={() => void saveNamedPreset()}
          />
        </Space>
      </Modal>
    </div>
  );
}
