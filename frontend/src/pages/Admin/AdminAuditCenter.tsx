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
import { ArrowRightOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import PageHeader from '../../components/PageHeader/PageHeader';
import { adminApi } from '../../api/admin';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import type {
  AdminAuditHotEntity,
  AdminAuditSpotlightActor,
  AdminAuditSpotlightDomain,
  AdminAuditSpotlightItem,
  AdminAuditTimelinePoint,
} from '../../types/admin';
import { downloadCSV } from '../../utils/csvExport';
import { PAGES } from '../../utils/constants';

const { Paragraph, Text } = Typography;

type AuditDomain = 'finance' | 'workforce' | 'purchasing' | 'production' | 'governance' | 'workflow';
type DomainFilter = 'all' | AuditDomain;
type SeverityFilter = 'all' | 'error' | 'warning' | 'info' | 'success';
type AuditDrilldownTarget = {
  domain: AuditDomain;
  route: string;
  action?: string;
  entity_code: string;
  entity_id: number | null;
  entity_id_str: string;
  entity_type: string;
};
type AuditFilterSnapshot = {
  domain_filter: DomainFilter;
  severity_filter: SeverityFilter;
  search: string;
};
type AuditNamedPreset = {
  id: string;
  name: string;
  filters: AuditFilterSnapshot;
};

const PANEL_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #e2e8f0',
  boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
};

const HERO_CARD_STYLE: CSSProperties = {
  borderRadius: 22,
  border: '1px solid #d9e7f5',
  background: 'linear-gradient(180deg, #ffffff 0%, #f5fbff 100%)',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
};

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'Chưa ghi nhận';
  return dayjs(value).format('DD/MM/YYYY HH:mm');
}

function formatShortDate(value: string): string {
  return dayjs(value).format('DD/MM');
}

function domainLabel(domain: AuditDomain): string {
  if (domain === 'finance') return 'Tài chính';
  if (domain === 'workforce') return 'Nhân sự';
  if (domain === 'purchasing') return 'Mua hàng';
  if (domain === 'production') return 'Sản xuất';
  if (domain === 'governance') return 'Kiểm soát truy cập';
  return 'Workflow';
}

function domainTint(domain: AuditDomain): string {
  if (domain === 'finance') return '#0f766e';
  if (domain === 'workforce') return '#2563eb';
  if (domain === 'purchasing') return '#d97706';
  if (domain === 'production') return '#7c2d12';
  if (domain === 'governance') return '#7c3aed';
  return '#0f766e';
}

function severityColor(severity: SeverityFilter): string {
  if (severity === 'error') return 'volcano';
  if (severity === 'warning') return 'gold';
  if (severity === 'success') return 'green';
  return 'blue';
}

function severityScore(severity: 'error' | 'warning' | 'info' | 'success'): number {
  if (severity === 'error') return 4;
  if (severity === 'warning') return 3;
  if (severity === 'info') return 2;
  return 1;
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

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function statusFromAction(domain: AuditDomain, action?: string): string | undefined {
  const normalized = String(action || '').toUpperCase();
  if (!normalized) return undefined;
  if (domain === 'finance' || domain === 'workforce') {
    if (normalized === 'PENDING_L1' || normalized === 'PENDING_L2') return normalized;
    if (normalized.startsWith('APPROVE')) return 'APPROVED';
    if (normalized === 'REJECT') return 'REJECTED';
    if (normalized === 'SUBMIT' || normalized === 'RESUBMIT') return 'PENDING_L1';
    return undefined;
  }
  if (domain === 'purchasing' || domain === 'production') {
    if (normalized === 'SUBMITTED' || normalized === 'SUBMIT' || normalized === 'RESUBMIT') return 'SUBMITTED';
    if (normalized.startsWith('APPROVE')) return 'APPROVED';
    if (normalized === 'REJECT') return 'REJECTED';
  }
  return undefined;
}

function buildAuditDrilldownRoute(
  item: AuditDrilldownTarget,
): string {
  if (item.domain === 'finance') {
    return buildRouteWithQuery(item.route, {
      q: item.entity_code || undefined,
      focus: item.entity_code || undefined,
      focus_id: item.entity_id ?? undefined,
      approval_status: statusFromAction(item.domain, item.action),
    });
  }
  if (item.domain === 'workforce') {
    return buildRouteWithQuery(item.route, {
      q: item.entity_code || undefined,
      focus_id: item.entity_id ?? undefined,
      approval_status: statusFromAction(item.domain, item.action),
    });
  }
  if (item.domain === 'purchasing' || item.domain === 'production') {
    return buildRouteWithQuery(item.route, {
      q: item.entity_code || undefined,
      focus: item.entity_code || undefined,
      focus_id: item.entity_id ?? undefined,
      status: statusFromAction(item.domain, item.action),
    });
  }
  if (item.domain === 'governance') {
    if (item.entity_type === 'Role') {
      return buildRouteWithQuery('/admin/roles-teams', {
        focus_kind: 'role',
        focus_id: item.entity_id ?? undefined,
        q: item.entity_code || undefined,
      });
    }
    if (item.entity_type === 'Team') {
      return buildRouteWithQuery('/admin/roles-teams', {
        focus_kind: 'team',
        focus_id: item.entity_id ?? undefined,
        q: item.entity_code || undefined,
      });
    }
    if (item.entity_type === 'UserAccess') {
      return buildRouteWithQuery('/admin/users', {
        focus_id: item.entity_id ?? undefined,
        search: item.entity_code || undefined,
      });
    }
    if (item.entity_type === 'UserProvisioning' || item.entity_type === 'UserOnboarding') {
      return buildRouteWithQuery('/admin/user-provisioning', {
        focus_user_id: item.entity_id ?? undefined,
        focus: item.entity_code || undefined,
      });
    }
    if (item.entity_type === 'UserOffboarding') {
      return buildRouteWithQuery('/admin/user-lifecycle', {
        focus_user_id: item.entity_id ?? undefined,
        focus: item.entity_code || undefined,
      });
    }
    if (item.entity_type === 'UserAccessReviewCampaign' || item.entity_type === 'UserAccessReview') {
      return buildRouteWithQuery('/admin/access-reviews', {
        campaign_key: item.entity_type === 'UserAccessReviewCampaign'
          ? item.entity_id_str || item.entity_code || undefined
          : undefined,
        search: item.entity_id_str || item.entity_code || undefined,
      });
    }
    if (item.entity_type.startsWith('UserAccessException')) {
      return buildRouteWithQuery('/admin/access-exceptions', {
        request_key: item.entity_type === 'UserAccessExceptionRequest'
          ? item.entity_id_str || item.entity_code || undefined
          : undefined,
        policy_key: item.entity_type === 'UserAccessExceptionPolicy'
          ? item.entity_id_str || item.entity_code || undefined
          : undefined,
        search: item.entity_id_str || item.entity_code || undefined,
      });
    }
  }
  return item.route;
}

export default function AdminAuditCenter() {
  const navigate = useNavigate();
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('NONE');
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const deferredSearch = useDeferredValue(normalizeSearch(search));
  const { config: savedConfig, saveConfig } = useUserPreferences(PAGES.ADMIN_AUDIT_CENTER);

  const auditWorkspaceQuery = useQuery({
    queryKey: ['admin-audit-workspace', 72, 60],
    queryFn: () => adminApi.getAdminAuditWorkspace({ hours: 72, limit: 60 }),
  });

  const retentionPreviewMutation = useMutation({
    mutationFn: () => adminApi.getAdminAuditRetentionPreview({
      days: auditWorkspaceQuery.data?.retention_policy?.retention_days ?? 90,
    }),
    onSuccess: (result) => {
      message.success(`Da chay retention dry-run: ${result.expired_count} event het han.`);
      void auditWorkspaceQuery.refetch();
    },
    onError: (error) => {
      message.error(`Khong the chay retention dry-run: ${String((error as Error)?.message || error)}`);
    },
  });

  const workspace = auditWorkspaceQuery.data;
  const domains = useMemo(() => workspace?.domains ?? [], [workspace?.domains]);
  const topActors = useMemo(() => workspace?.top_actors ?? [], [workspace?.top_actors]);
  const hotEntities = useMemo(() => workspace?.hot_entities ?? [], [workspace?.hot_entities]);
  const timeline = useMemo(() => workspace?.timeline_7d ?? [], [workspace?.timeline_7d]);
  const recentActivity = useMemo(() => workspace?.recent_activity ?? [], [workspace?.recent_activity]);
  const retentionPolicy = workspace?.retention_policy;
  const exportOptions = workspace?.export_options;
  const incidentResponse = workspace?.incident_response;
  const namedPresets = useMemo(() => {
    const raw = savedConfig?.saved_views;
    if (!Array.isArray(raw)) return [] as AuditNamedPreset[];
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
          && domainValue !== 'finance'
          && domainValue !== 'workforce'
          && domainValue !== 'purchasing'
          && domainValue !== 'production'
          && domainValue !== 'governance'
          && domainValue !== 'workflow'
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
            search: typeof filterRecord.search === 'string' ? filterRecord.search : '',
          },
        } as AuditNamedPreset;
      })
      .filter((item): item is AuditNamedPreset => item !== null);
  }, [savedConfig?.saved_views]);
  const selectedPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );

  const filteredDomains = useMemo(() => {
    return domains.filter((item) => {
      if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
      if (!deferredSearch) return true;
      return [item.label, item.domain].join(' ').toLowerCase().includes(deferredSearch);
    });
  }, [deferredSearch, domainFilter, domains]);

  const filteredActors = useMemo(() => {
    return topActors.filter((item) => {
      if (domainFilter !== 'all' && !item.domains.includes(domainFilter)) return false;
      if (!deferredSearch) return true;
      return [item.full_name, item.username, item.domains.join(' ')].join(' ').toLowerCase().includes(deferredSearch);
    });
  }, [deferredSearch, domainFilter, topActors]);

  const filteredHotEntities = useMemo(() => {
    return hotEntities.filter((item) => {
      if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
      if (!deferredSearch) return true;
      return [
        item.summary,
        item.entity_code,
        item.entity_type,
        item.last_actor_label,
        item.latest_action_label,
      ]
        .join(' ')
        .toLowerCase()
        .includes(deferredSearch);
    });
  }, [deferredSearch, domainFilter, hotEntities]);

  const filteredActivity = useMemo(() => {
    return recentActivity
      .filter((item) => {
        if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
        if (severityFilter !== 'all' && item.severity !== severityFilter) return false;
        if (!deferredSearch) return true;
        return [item.summary, item.actor_label, item.entity_code, item.comments, item.action_label]
          .join(' ')
          .toLowerCase()
          .includes(deferredSearch);
      })
      .sort((left, right) => severityScore(right.severity) - severityScore(left.severity));
  }, [deferredSearch, domainFilter, recentActivity, severityFilter]);

  const peakTimelineEvents = useMemo(() => {
    return timeline.reduce((peak, item) => Math.max(peak, item.total_events), 0);
  }, [timeline]);

  const exportActivity = () => {
    if (!filteredActivity.length) return;
    downloadCSV(
      filteredActivity.map((item) => ({
        'Miền': domainLabel(item.domain),
        'Mức độ': item.severity,
        'Hành động': item.action_label,
        'Đối tượng': item.entity_code || item.entity_type,
        'Tóm tắt': item.summary,
        'Ghi chú': item.comments || '',
        'Người thực hiện': item.actor_label,
        'Thời gian': formatDateTime(item.created_at),
      })),
      'kiem-soat-audit',
    );
  };

  const exportServerAudit = async (format: 'csv' | 'json') => {
    try {
      const blob = await adminApi.exportAdminAuditFile({
        export_format: format,
        hours: workspace?.hours_window ?? 72,
        limit: exportOptions?.max_rows ? Math.min(exportOptions.max_rows, 500) : 500,
        domain: domainFilter === 'all' ? undefined : domainFilter,
      });
      downloadBlob(`admin-audit-${domainFilter === 'all' ? 'all' : domainFilter}.${format}`, blob);
      message.success(`Da xuat audit ${format.toUpperCase()} tu server.`);
    } catch (error) {
      message.error(`Khong the xuat audit ${format.toUpperCase()}: ${String((error as Error)?.message || error)}`);
    }
  };

  const domainColumns: ColumnsType<AdminAuditSpotlightDomain> = [
    {
      title: 'Miền',
      dataIndex: 'domain',
      width: 180,
      render: (value: AuditDomain) => <Tag color={severityColor('info')}>{domainLabel(value)}</Tag>,
    },
    {
      title: 'Biến động 24h',
      key: 'metrics',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{record.events_24h} sự kiện</Text>
          <Text type="secondary">
            Nhạy cảm {record.sensitive_events_24h} | Critical {record.high_severity_events_24h} | Actor {record.actors_24h}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Cập nhật cuối',
      dataIndex: 'last_event_at',
      width: 180,
      render: (value: string | null) => formatDateTime(value),
    },
    {
      title: 'Điều hướng',
      key: 'actions',
      width: 140,
      render: (_, record) => (
        <Button
          type="link"
          icon={<ArrowRightOutlined />}
          data-testid={`admin-audit-center-domain-${record.domain}`}
          onClick={() => navigate(record.route)}
        >
          Mở miền
        </Button>
      ),
    },
  ];

  const actorColumns: ColumnsType<AdminAuditSpotlightActor> = [
    {
      title: 'Actor',
      key: 'actor',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{record.full_name || record.username || 'Hệ thống'}</Text>
          <Text type="secondary">{record.username || 'system'}</Text>
        </Space>
      ),
    },
    {
      title: 'Tín hiệu',
      key: 'metrics',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text>{record.event_count} sự kiện</Text>
          <Text type="secondary">
            Nhạy cảm {record.sensitive_event_count} | Critical {record.high_severity_event_count}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Miền',
      dataIndex: 'domains',
      width: 260,
      render: (value: string[]) => (
        <Space size={[4, 4]} wrap>
          {value.map((domain) => (
            <Tag key={`${domain}-${value.length}`}>{domainLabel(domain as AuditDomain)}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: 'Cập nhật cuối',
      dataIndex: 'last_event_at',
      width: 180,
      render: (value: string | null) => formatDateTime(value),
    },
  ];

  const hotEntityColumns: ColumnsType<AdminAuditHotEntity> = [
    {
      title: 'Miền',
      dataIndex: 'domain',
      width: 150,
      render: (value: AuditDomain) => <Tag color={domainTint(value)}>{domainLabel(value)}</Tag>,
    },
    {
      title: 'Hồ sơ nổi bật',
      key: 'summary',
      render: (_, record) => (
        <Space direction="vertical" size={3}>
          <Space wrap>
            {record.latest_action_label ? <Tag color="processing">{record.latest_action_label}</Tag> : null}
            <Text strong>{record.summary}</Text>
          </Space>
          <Text type="secondary">
            {record.entity_code || record.entity_type} | {record.last_actor_label || 'Hệ thống'} | {formatDateTime(record.last_event_at)}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Tín hiệu',
      key: 'metrics',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{record.event_count} sự kiện</Text>
          <Text type="secondary">
            Nhạy cảm {record.sensitive_event_count} | Critical {record.high_severity_event_count}
          </Text>
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
          data-testid="admin-audit-center-open-hot-entity"
          onClick={() => navigate(buildAuditDrilldownRoute(record))}
        >
          Mở
        </Button>
      ),
    },
  ];

  const activityColumns: ColumnsType<AdminAuditSpotlightItem> = [
    {
      title: 'Miền',
      dataIndex: 'domain',
      width: 150,
      render: (value: AuditDomain) => <Tag color={domainTint(value)}>{domainLabel(value)}</Tag>,
    },
    {
      title: 'Mức độ',
      dataIndex: 'severity',
      width: 130,
      render: (value: 'error' | 'warning' | 'info' | 'success') => <Tag color={severityColor(value)}>{value.toUpperCase()}</Tag>,
    },
    {
      title: 'Sự kiện',
      key: 'summary',
      render: (_, record) => (
        <Space direction="vertical" size={3}>
          <Space wrap>
            <Tag color={severityColor(record.severity)}>{record.action_label}</Tag>
            <Text strong>{record.summary}</Text>
          </Space>
          <Text type="secondary">
            {record.actor_label} | {record.entity_code || record.entity_type} | {formatDateTime(record.created_at)}
          </Text>
          {record.comments ? <Text type="secondary">{record.comments}</Text> : null}
          {record.changed_fields.length ? (
            <Space size={[4, 4]} wrap>
              {record.changed_fields.slice(0, 4).map((field) => (
                <Tag key={`${record.id}-${field}`}>{field}</Tag>
              ))}
            </Space>
          ) : null}
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
          data-testid="admin-audit-center-open-activity"
          onClick={() => navigate(buildAuditDrilldownRoute(record))}
        >
          Mở
        </Button>
      ),
    },
  ];

  const totalEvents = workspace?.total_events ?? 0;
  const sensitiveEvents = workspace?.sensitive_events ?? 0;
  const highSeverityEvents = workspace?.high_severity_events ?? 0;
  const hotEntityCount = hotEntities.length;
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (domainFilter !== 'all') tags.push(`Miền: ${domainLabel(domainFilter)}`);
    if (severityFilter !== 'all') tags.push(`Mức độ: ${severityFilter.toUpperCase()}`);
    if (search.trim()) tags.push(`Từ khóa: ${search.trim()}`);
    if (selectedPreset) tags.push(`Mẫu đang dùng: ${selectedPreset.name}`);
    return tags;
  }, [domainFilter, search, selectedPreset, severityFilter]);

  const buildCurrentSnapshot = (): AuditFilterSnapshot => ({
    domain_filter: domainFilter,
    severity_filter: severityFilter,
    search,
  });

  const applySnapshot = (snapshot: AuditFilterSnapshot) => {
    setDomainFilter(snapshot.domain_filter);
    setSeverityFilter(snapshot.severity_filter);
    setSearch(snapshot.search);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      message.success('Đã lưu chế độ xem audit.');
    } catch {
      message.error('Không thể lưu chế độ xem audit.');
    }
  };

  const applySavedView = () => {
    const domainValue = savedConfig?.domain_filter;
    const severityValue = savedConfig?.severity_filter;
    const searchValue = savedConfig?.search;
    if (
      domainValue === 'all'
      || domainValue === 'finance'
      || domainValue === 'workforce'
      || domainValue === 'purchasing'
      || domainValue === 'production'
      || domainValue === 'governance'
      || domainValue === 'workflow'
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
      setSearch(searchValue);
    }
    message.success('Đã khôi phục chế độ xem audit đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      message.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: AuditNamedPreset = existing
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
      message.success(existing ? 'Đã cập nhật mẫu lọc audit.' : 'Đã lưu mẫu lọc audit mới.');
    } catch {
      message.error('Không thể lưu mẫu lọc audit.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      message.warning('Vui lòng chọn mẫu lọc audit.');
      return;
    }
    applySnapshot(preset.filters);
    message.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      message.warning('Vui lòng chọn mẫu lọc audit để xóa.');
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
      message.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      message.error('Không thể xóa mẫu lọc audit.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        title="Trung tâm kiểm soát audit"
        subtitle="Gom biến động nhạy cảm, actor hotspot và nhật ký thay đổi liên miền vào một command center thống nhất để đội điều hành không phải lần theo từng module riêng lẻ."
        extra={(
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={exportActivity} disabled={!filteredActivity.length}>
              Xuất CSV
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void auditWorkspaceQuery.refetch()}>
              Làm mới
            </Button>
          </Space>
        )}
      />

      <Alert
        showIcon
        type={highSeverityEvents > 0 ? 'warning' : 'success'}
        message={
          highSeverityEvents > 0
            ? `Có ${highSeverityEvents} sự kiện critical trong cửa sổ ${workspace?.hours_window ?? 72} giờ.`
            : 'Chưa phát hiện sự kiện critical nổi bật trong cửa sổ đang theo dõi.'
        }
        description={
          highSeverityEvents > 0
            ? 'Ưu tiên rà các event có tác động khóa, thu hồi, từ chối, rollback hoặc workflow failure trước khi chuyển ca.'
            : 'Bạn vẫn có thể dùng command center này để rà actor hoạt động nhiều, bám các thay đổi nhạy cảm và drilldown nhanh sang từng màn tác nghiệp.'
        }
      />

      <Card style={PANEL_STYLE} bodyStyle={{ padding: 18 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            showIcon
            type={(retentionPolicy?.expired_events ?? 0) > 0 ? 'warning' : 'info'}
            message={
              (retentionPolicy?.expired_events ?? 0) > 0
                ? `Co ${retentionPolicy?.expired_events ?? 0} audit event da qua retention window.`
                : 'Retention va export rail dang o trang thai theo doi binh thuong.'
            }
            description={`Retention ${retentionPolicy?.retention_days ?? 0} ngay | max export ${exportOptions?.max_rows ?? 0} dong | contacts ${incidentResponse?.contacts?.length ?? 0}.`}
          />
          <Space size={[8, 8]} wrap>
            <Tag color={(retentionPolicy?.expired_events ?? 0) > 0 ? 'volcano' : 'green'}>
              Expired events: {retentionPolicy?.expired_events ?? 0}
            </Tag>
            <Tag color="blue">Retention days: {retentionPolicy?.retention_days ?? 0}</Tag>
            <Tag color="purple">Formats: {(exportOptions?.formats ?? []).join(', ') || '--'}</Tag>
            <Tag color="gold">Max rows: {exportOptions?.max_rows ?? 0}</Tag>
            {retentionPolicy?.last_run?.created_at ? (
              <Tag color="cyan">Last run: {formatDateTime(retentionPolicy.last_run.created_at)}</Tag>
            ) : null}
          </Space>
          <Space wrap>
            <Button
              data-testid="admin-audit-center-retention-preview"
              loading={retentionPreviewMutation.isPending}
              onClick={() => retentionPreviewMutation.mutate()}
            >
              Chay dry-run retention
            </Button>
            <Button
              data-testid="admin-audit-center-export-server-csv"
              onClick={() => void exportServerAudit('csv')}
            >
              Xuat CSV tu server
            </Button>
            <Button
              data-testid="admin-audit-center-export-server-json"
              onClick={() => void exportServerAudit('json')}
            >
              Xuat JSON tu server
            </Button>
          </Space>
          {(incidentResponse?.runbook_url || incidentResponse?.bundle_command) ? (
            <Space direction="vertical" size={4}>
              {incidentResponse?.runbook_url ? <Text type="secondary">Runbook: {incidentResponse.runbook_url}</Text> : null}
              {incidentResponse?.bundle_command ? <Text type="secondary">Bundle command: {incidentResponse.bundle_command}</Text> : null}
            </Space>
          ) : null}
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <Card style={HERO_CARD_STYLE}><Statistic title="Tổng sự kiện" value={totalEvents} /></Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card style={HERO_CARD_STYLE}><Statistic title="Sự kiện nhạy cảm" value={sensitiveEvents} valueStyle={{ color: '#d97706' }} /></Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card style={HERO_CARD_STYLE}><Statistic title="Critical" value={highSeverityEvents} valueStyle={{ color: highSeverityEvents > 0 ? '#cf1322' : undefined }} /></Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card style={HERO_CARD_STYLE}><Statistic title="Hồ sơ nóng" value={hotEntityCount} valueStyle={{ color: '#1677ff' }} /></Card>
        </Col>
      </Row>

      <Card style={PANEL_STYLE} bodyStyle={{ padding: 18 }}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div data-testid="admin-audit-center-search">
              <Input
                placeholder="Tìm actor, đối tượng, changed field hoặc mô tả sự kiện..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                style={{ width: 320 }}
              />
            </div>
            <Select<DomainFilter>
              value={domainFilter}
              onChange={setDomainFilter}
              style={{ width: 220 }}
              options={[
                { value: 'all', label: 'Mọi miền' },
                { value: 'finance', label: 'Tài chính' },
                { value: 'workforce', label: 'Nhân sự' },
                { value: 'purchasing', label: 'Mua hàng' },
                { value: 'production', label: 'Sản xuất' },
                { value: 'governance', label: 'Kiểm soát truy cập' },
                { value: 'workflow', label: 'Workflow' },
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
            <Button data-testid="admin-audit-center-save-view" onClick={() => void saveCurrentView()}>
              Lưu chế độ xem
            </Button>
            <Button data-testid="admin-audit-center-restore-view" onClick={applySavedView}>
              Khôi phục
            </Button>
            <Button data-testid="admin-audit-center-open-preset-modal" onClick={() => setIsPresetModalOpen(true)}>
              Tạo mẫu lọc
            </Button>
            <div data-testid="admin-audit-center-preset-select">
              <Select
                value={selectedPresetId}
                onChange={setSelectedPresetId}
                style={{ width: 240 }}
                options={[
                  { value: 'NONE', label: 'Chọn mẫu lọc audit' },
                  ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                ]}
              />
            </div>
            <Button data-testid="admin-audit-center-apply-preset" onClick={applyNamedPreset}>
              Áp dụng mẫu
            </Button>
            <Button
              danger
              data-testid="admin-audit-center-delete-preset"
              disabled={!selectedPreset}
              onClick={() => void deleteNamedPreset()}
            >
              Xóa mẫu
            </Button>
          </Space>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Bộ lọc này áp dụng đồng thời cho radar audit, actor hotspot, hồ sơ nóng và activity feed để bạn rà theo ca hoặc theo miền chuyên trách nhanh hơn.
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

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={11}>
          <Card
            title="Radar audit theo miền"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={<Tag color="geekblue">24 giờ gần nhất</Tag>}
          >
            {filteredDomains.length ? (
              <Table<AdminAuditSpotlightDomain>
                rowKey="domain"
                size="small"
                pagination={false}
                dataSource={filteredDomains}
                columns={domainColumns}
              />
            ) : (
              <Empty description="Không có miền audit nào khớp bộ lọc hiện tại." />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={13}>
          <Card
            data-testid="admin-audit-center-actor-hotspot"
            title="Actor hotspot"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={<Tag color="purple">Top 10 actor</Tag>}
          >
            {filteredActors.length ? (
              <Table<AdminAuditSpotlightActor>
                rowKey={(row) => String(row.actor_id ?? row.username)}
                size="small"
                pagination={{ pageSize: 6, hideOnSinglePage: true }}
                dataSource={filteredActors}
                columns={actorColumns}
              />
            ) : (
              <Empty description="Không có actor hotspot nào khớp bộ lọc hiện tại." />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card
            data-testid="admin-audit-center-hot-entities"
            title="Hồ sơ nóng cần điều tra"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={<Tag color="magenta">Top 12 hotspot</Tag>}
          >
            {filteredHotEntities.length ? (
              <Table<AdminAuditHotEntity>
                rowKey="key"
                size="small"
                pagination={{ pageSize: 6, hideOnSinglePage: true }}
                dataSource={filteredHotEntities}
                columns={hotEntityColumns}
              />
            ) : (
              <Empty description="Không có hồ sơ nóng nào khớp bộ lọc hiện tại." />
            )}
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card
            data-testid="admin-audit-center-timeline"
            title="Nhịp audit 7 ngày"
            style={PANEL_STYLE}
            bodyStyle={{ padding: 18 }}
            extra={<Tag color="cyan">Theo ngày</Tag>}
          >
            {timeline.length ? (
              <Row gutter={[12, 12]}>
                {timeline.map((item: AdminAuditTimelinePoint) => {
                  const isPeak = peakTimelineEvents > 0 && item.total_events === peakTimelineEvents;
                  return (
                    <Col xs={12} md={8} xl={12} key={item.date}>
                      <Card
                        size="small"
                        style={{
                          borderRadius: 18,
                          border: isPeak ? '1px solid #91caff' : '1px solid #e5e7eb',
                          background: isPeak ? 'linear-gradient(180deg, #f0f9ff 0%, #ffffff 100%)' : '#fff',
                          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
                        }}
                        bodyStyle={{ padding: 14 }}
                      >
                        <Space direction="vertical" size={4}>
                          <Text strong>{formatShortDate(item.date)}</Text>
                          <Text type="secondary">{dayjs(item.date).format('ddd')}</Text>
                          <Statistic title="Sự kiện" value={item.total_events} valueStyle={{ fontSize: 24 }} />
                          <Text type="secondary">
                            Nhạy cảm {item.sensitive_events} | Critical {item.high_severity_events}
                          </Text>
                        </Space>
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            ) : (
              <Empty description="Chưa có dữ liệu nhịp audit trong cửa sổ đang theo dõi." />
            )}
          </Card>
        </Col>
      </Row>

      <Card
        data-testid="admin-audit-center-recent-activity"
        title="Nhật ký audit nhạy cảm"
        style={PANEL_STYLE}
        bodyStyle={{ padding: 18 }}
        extra={<Tag color="gold">Drilldown trực tiếp</Tag>}
      >
        {filteredActivity.length ? (
          <Table<AdminAuditSpotlightItem>
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            dataSource={filteredActivity}
            columns={activityColumns}
          />
        ) : (
          <Empty description="Không có sự kiện audit nào khớp bộ lọc hiện tại." />
        )}
      </Card>

      <Modal
        open={isPresetModalOpen}
        title="Lưu mẫu lọc audit"
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
            Lưu nhanh bộ lọc hiện tại để đội vận hành hoặc đội kiểm soát mở lại đúng góc nhìn audit khi đổi ca.
          </Paragraph>
          <Input
            data-testid="admin-audit-center-preset-name"
            placeholder="Ví dụ: Workflow cảnh báo cuối ngày"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            onPressEnter={() => void saveNamedPreset()}
          />
        </Space>
      </Modal>
    </div>
  );
}
