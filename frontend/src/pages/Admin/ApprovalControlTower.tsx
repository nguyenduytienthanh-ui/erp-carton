import { useDeferredValue, useMemo, useState } from 'react';
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
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import PageHeader from '../../components/PageHeader/PageHeader';
import { adminApi } from '../../api/admin';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import type { AdminObservabilityApprovalQueueRow } from '../../types/admin';
import { PAGES } from '../../utils/constants';

const { Text, Paragraph } = Typography;

type ApprovalDomain = 'finance' | 'workforce' | 'purchasing' | 'production';
type DomainFilter = 'all' | ApprovalDomain;
type ApprovalFilterSnapshot = {
  domain_filter: DomainFilter;
  search: string;
};
type ApprovalNamedPreset = {
  id: string;
  name: string;
  filters: ApprovalFilterSnapshot;
};

type QueueRow = AdminObservabilityApprovalQueueRow;

const PANEL_STYLE = {
  borderRadius: 22,
  border: '1px solid #e2e8f0',
  boxShadow: '0 14px 36px rgba(15, 23, 42, 0.06)',
};

function formatMoney(value?: string | number | null): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return '--';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(numeric);
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('DD/MM/YYYY HH:mm') : value;
}

function buildRouteWithQuery(route: string, params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    query.set(key, String(value));
  });
  const serialized = query.toString();
  return serialized ? `${route}?${serialized}` : route;
}

function statusFromAction(domain: ApprovalDomain, action?: string): string | undefined {
  const normalized = String(action || '').toUpperCase();
  if (domain === 'finance' || domain === 'workforce') {
    if (normalized === 'PENDING_L1' || normalized === 'PENDING_L2') return normalized;
    if (normalized.startsWith('APPROVE')) return 'APPROVED';
    if (normalized === 'REJECT' || normalized === 'REJECT_L1' || normalized === 'REJECT_L2') return 'REJECTED';
    if (normalized === 'SUBMIT' || normalized === 'RESUBMIT') return 'PENDING_L1';
    return undefined;
  }
  if (normalized === 'SUBMITTED') return 'SUBMITTED';
  if (normalized.startsWith('APPROVE')) return 'APPROVED';
  if (normalized === 'REJECT') return 'REJECTED';
  return undefined;
}

function buildApprovalRoute(options: {
  domain: ApprovalDomain;
  route: string;
  action?: string;
  entityCode?: string | null;
  entityId?: number | null;
}): string {
  const { domain, route, action, entityCode, entityId } = options;
  const status = statusFromAction(domain, action);
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

function domainLabel(domain: ApprovalDomain): string {
  if (domain === 'finance') return 'Tài chính';
  if (domain === 'workforce') return 'Nhân sự';
  if (domain === 'purchasing') return 'Mua hàng';
  return 'Sản xuất';
}

function domainColor(domain: ApprovalDomain): string {
  if (domain === 'finance') return 'gold';
  if (domain === 'workforce') return 'blue';
  if (domain === 'purchasing') return 'green';
  return 'purple';
}

function formatQueueAmount(row: QueueRow): string {
  if (row.domain === 'finance' || row.domain === 'workforce' || row.id.startsWith('purchase-order-')) {
    return formatMoney(row.amount_label);
  }
  return row.amount_label;
}

export default function ApprovalControlTower() {
  const navigate = useNavigate();
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('NONE');
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const { config: savedConfig, saveConfig } = useUserPreferences(PAGES.ADMIN_APPROVAL_CONTROL_TOWER);

  const workspaceQuery = useQuery({
    queryKey: ['approval-control-tower-workspace'],
    queryFn: () => adminApi.getAdminObservabilityWorkspace({ activity_limit: 12 }),
  });

  const workspace = workspaceQuery.data;
  const approvalAudit = workspace?.approval_audit;
  const domainCards = approvalAudit?.domains ?? [];
  const hotItems = approvalAudit?.hot_items ?? [];
  const queueSummary = approvalAudit?.queue_summary;
  const timeline7d = approvalAudit?.timeline_7d ?? [];

  const queueRows = useMemo<QueueRow[]>(() => {
    return (approvalAudit?.queue_rows ?? []).map((item) => ({
      ...item,
      route: buildApprovalRoute({
        domain: item.domain,
        route: item.route,
        action: item.status_action,
        entityCode: item.entity_code,
        entityId: item.entity_id,
      }),
    }));
  }, [approvalAudit?.queue_rows]);

  const filteredQueueRows = useMemo(() => {
    return queueRows.filter((item) => {
      if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
      if (!deferredSearch) return true;
      return [item.entity_code, item.title, item.status_label, item.aging_hint, domainLabel(item.domain)]
        .join(' ')
        .toLowerCase()
        .includes(deferredSearch);
    });
  }, [deferredSearch, domainFilter, queueRows]);

  const filteredHotItems = useMemo(() => {
    return hotItems.filter((item) => {
      if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
      if (!deferredSearch) return true;
      return [item.entity_code, item.title, item.status_label, item.aging_hint, domainLabel(item.domain)]
        .join(' ')
        .toLowerCase()
        .includes(deferredSearch);
    });
  }, [deferredSearch, domainFilter, hotItems]);

  const recentDecisions = useMemo(() => {
    return (approvalAudit?.recent_activity ?? []).filter((item) => {
      if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
      if (!deferredSearch) return true;
      return [item.summary, item.entity_code, item.actor_label, domainLabel(item.domain)]
        .join(' ')
        .toLowerCase()
        .includes(deferredSearch);
    });
  }, [approvalAudit?.recent_activity, deferredSearch, domainFilter]);
  const namedPresets = useMemo(() => {
    const raw = savedConfig?.saved_views;
    if (!Array.isArray(raw)) return [] as ApprovalNamedPreset[];
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
        if (
          domainValue !== 'all'
          && domainValue !== 'finance'
          && domainValue !== 'workforce'
          && domainValue !== 'purchasing'
          && domainValue !== 'production'
        ) {
          return null;
        }
        return {
          id,
          name,
          filters: {
            domain_filter: domainValue,
            search: typeof filterRecord.search === 'string' ? filterRecord.search : '',
          },
        } as ApprovalNamedPreset;
      })
      .filter((item): item is ApprovalNamedPreset => item !== null);
  }, [savedConfig?.saved_views]);
  const selectedPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );

  const totalPending = queueSummary?.total_pending ?? queueRows.length;
  const criticalQueueCount = queueSummary?.critical_queue_count ?? queueRows.filter((item) => item.priority_band === 'critical').length;
  const staleQueueCount = queueSummary?.stale_queue_count ?? queueRows.filter((item) => item.age_days >= 2).length;
  const multiLevelQueueCount = queueSummary?.multi_level_queue_count ?? queueRows.filter((item) => item.is_multilevel).length;
  const totalRejected7d = domainCards.reduce((acc, item) => acc + item.rejected_7d, 0);
  const totalApproved7d = domainCards.reduce((acc, item) => acc + item.approved_7d, 0);
  const totalSubmitted7d = domainCards.reduce((acc, item) => acc + item.submitted_7d, 0);
  const hottestApprovalAge = filteredHotItems.reduce((max, item) => Math.max(max, item.age_days), 0);
  const triageLanes = useMemo(() => ([
    {
      key: 'critical',
      title: 'Can thiệp ngay',
      tone: 'volcano',
      description: 'Các hồ sơ vừa có tuổi chờ cao vừa mang mức ưu tiên lớn, có nguy cơ tạo nghẽn chéo miền.',
      items: filteredQueueRows.filter((item) => item.priority_band === 'critical').slice(0, 4),
    },
    {
      key: 'high',
      title: 'Chốt trong ca',
      tone: 'gold',
      description: 'Nhóm hồ sơ nhiều cấp hoặc đang tiến gần vùng backlog cần được chốt ngay trong ca làm việc hiện tại.',
      items: filteredQueueRows.filter((item) => item.priority_band === 'high' || item.is_multilevel).slice(0, 4),
    },
    {
      key: 'normal',
      title: 'Giữ nhịp duyệt',
      tone: 'green',
      description: 'Các hồ sơ còn trong ngưỡng an toàn nhưng nên được duy trì throughput ổn định để không dồn cục cuối ngày.',
      items: filteredQueueRows.filter((item) => item.priority_band === 'normal' && !item.is_multilevel).slice(0, 4),
    },
  ]), [filteredQueueRows]);

  const queueColumns = useMemo<ColumnsType<QueueRow>>(
    () => [
      {
        title: 'Miền',
        dataIndex: 'domain',
        width: 120,
        render: (value: ApprovalDomain) => <Tag color={domainColor(value)}>{domainLabel(value)}</Tag>,
      },
      {
        title: 'Hồ sơ',
        key: 'subject',
        render: (_, record) => (
          <Space direction="vertical" size={2}>
            <Text strong>{record.entity_code}</Text>
            <Text type="secondary">{record.title}</Text>
          </Space>
        ),
      },
      {
        title: 'Giá trị',
        key: 'amount_label',
        width: 180,
        render: (_, record) => formatQueueAmount(record),
      },
      {
        title: 'Trạng thái',
        dataIndex: 'status_label',
        width: 180,
      },
      {
        title: 'Ngữ cảnh',
        key: 'context',
        width: 220,
        render: (_, record) => (
          <Space direction="vertical" size={2}>
            <Text>{record.aging_hint}</Text>
            <Text type="secondary">
              {record.age_days} ngày chờ | {record.is_multilevel ? 'Đa cấp' : 'Một cấp'} | {record.priority_band.toUpperCase()}
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
    ],
    [navigate]
  );
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (domainFilter !== 'all') tags.push(`Miền: ${domainLabel(domainFilter)}`);
    if (search.trim()) tags.push(`Từ khóa: ${search.trim()}`);
    if (selectedPreset) tags.push(`Mẫu đang dùng: ${selectedPreset.name}`);
    return tags;
  }, [domainFilter, search, selectedPreset]);

  const buildCurrentSnapshot = (): ApprovalFilterSnapshot => ({
    domain_filter: domainFilter,
    search,
  });

  const applySnapshot = (snapshot: ApprovalFilterSnapshot) => {
    setDomainFilter(snapshot.domain_filter);
    setSearch(snapshot.search);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...savedConfig,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      message.success('Đã lưu chế độ xem duyệt.');
    } catch {
      message.error('Không thể lưu chế độ xem duyệt.');
    }
  };

  const applySavedView = () => {
    const domainValue = savedConfig?.domain_filter;
    const searchValue = savedConfig?.search;
    if (
      domainValue === 'all'
      || domainValue === 'finance'
      || domainValue === 'workforce'
      || domainValue === 'purchasing'
      || domainValue === 'production'
    ) {
      setDomainFilter(domainValue);
    }
    if (typeof searchValue === 'string') {
      setSearch(searchValue);
    }
    message.success('Đã khôi phục chế độ xem duyệt đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      message.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: ApprovalNamedPreset = existing
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
      message.success(existing ? 'Đã cập nhật mẫu lọc duyệt.' : 'Đã lưu mẫu lọc duyệt mới.');
    } catch {
      message.error('Không thể lưu mẫu lọc duyệt.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      message.warning('Vui lòng chọn mẫu lọc duyệt.');
      return;
    }
    applySnapshot(preset.filters);
    message.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      message.warning('Vui lòng chọn mẫu lọc duyệt để xóa.');
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
      message.error('Không thể xóa mẫu lọc duyệt.');
    }
  };

  const loading = workspaceQuery.isLoading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        title="Trung tâm điều phối duyệt"
        subtitle="Hợp nhất hàng chờ duyệt, quyết định gần đây và radar theo miền nghiệp vụ để trưởng bộ phận không phải nhảy qua nhiều command center rời rạc."
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => {
              void workspaceQuery.refetch();
            }}>
              Làm mới
            </Button>
          </Space>
        }
      />

      <Alert
        showIcon
        type={totalPending > 0 ? 'warning' : 'success'}
        message={
          totalPending > 0
            ? `Đang có ${totalPending} hồ sơ cần điều phối duyệt xuyên các miền nghiệp vụ.`
            : 'Không có hàng chờ duyệt nổi bật trong bối cảnh hiện tại.'
        }
        description={
          totalPending > 0
            ? `Ưu tiên xử lý ${criticalQueueCount} hồ sơ gấp, ${staleQueueCount} hồ sơ đã chờ quá 2 ngày và ${multiLevelQueueCount} hồ sơ nhiều cấp để tránh nghẽn vận hành ở cuối ngày.`
            : 'Bạn có thể dùng màn này như một bàn theo dõi nhịp duyệt, kiểm tra quyết định gần đây và theo dõi xem có miền nào bắt đầu nóng lên.'
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <Card style={PANEL_STYLE}><Statistic title="Hàng chờ hiện tại" value={totalPending} /></Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card style={PANEL_STYLE}><Statistic title="Cần chốt gấp" value={criticalQueueCount} valueStyle={{ color: criticalQueueCount > 0 ? '#cf1322' : undefined }} /></Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card style={PANEL_STYLE}><Statistic title="Chờ quá 2 ngày" value={staleQueueCount} valueStyle={{ color: staleQueueCount > 0 ? '#d97706' : undefined }} /></Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card style={PANEL_STYLE}><Statistic title="Hàng chờ đa cấp" value={multiLevelQueueCount} valueStyle={{ color: '#1677ff' }} /></Card>
        </Col>
      </Row>

      <Card
        data-testid="approval-control-tower-command-strip"
        style={PANEL_STYLE}
        bodyStyle={{ padding: 18 }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            <Segmented<DomainFilter>
              value={domainFilter}
              onChange={(value) => setDomainFilter(value)}
              options={[
                { label: 'Táº¥t cáº£', value: 'all' },
                { label: 'TĂ i chĂ­nh', value: 'finance' },
                { label: 'NhĂ¢n sá»±', value: 'workforce' },
                { label: 'Mua hĂ ng', value: 'purchasing' },
                { label: 'Sáº£n xuáº¥t', value: 'production' },
              ]}
            />
            <div data-testid="approval-control-tower-search">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm mã hồ sơ, đối tượng, miền nghiệp vụ..."
                style={{ width: 300 }}
              />
            </div>
          </Space>
          <Space wrap>
            <Button data-testid="approval-control-tower-save-view" onClick={() => void saveCurrentView()}>
              Lưu chế độ xem
            </Button>
            <Button data-testid="approval-control-tower-restore-view" onClick={applySavedView}>
              Khôi phục
            </Button>
            <Button data-testid="approval-control-tower-open-preset-modal" onClick={() => setIsPresetModalOpen(true)}>
              Tạo mẫu lọc
            </Button>
            <div data-testid="approval-control-tower-preset-select">
              <Select
                value={selectedPresetId}
                onChange={setSelectedPresetId}
                style={{ width: 240 }}
                options={[
                  { value: 'NONE', label: 'Chọn mẫu duyệt' },
                  ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                ]}
              />
            </div>
            <Button data-testid="approval-control-tower-apply-preset" onClick={applyNamedPreset}>
              Áp dụng mẫu
            </Button>
            <Button
              danger
              data-testid="approval-control-tower-delete-preset"
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

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={8}>
          <Card style={PANEL_STYLE}><Statistic title="Gửi duyệt 7 ngày" value={totalSubmitted7d} /></Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card style={PANEL_STYLE}><Statistic title="Đã duyệt 7 ngày" value={totalApproved7d} valueStyle={{ color: '#16a34a' }} /></Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card style={PANEL_STYLE}><Statistic title="Từ chối 7 ngày" value={totalRejected7d} valueStyle={{ color: totalRejected7d > 0 ? '#cf1322' : undefined }} /></Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {triageLanes.map((lane) => (
          <Col xs={24} xl={8} key={lane.key}>
            <Card
              title={lane.title}
              data-testid={`approval-control-tower-lane-${lane.key}`}
              style={PANEL_STYLE}
              extra={<Tag color={lane.tone}>{lane.items.length} hồ sơ</Tag>}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  {lane.description}
                </Paragraph>
                {lane.items.length ? lane.items.map((item) => (
                  <Card
                    key={item.id}
                    size="small"
                    bodyStyle={{ padding: 14 }}
                    style={{ borderRadius: 16, border: '1px solid #e2e8f0', background: '#fafcff' }}
                  >
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Space wrap>
                        <Tag color={domainColor(item.domain)}>{domainLabel(item.domain)}</Tag>
                        <Tag color={item.priority_band === 'critical' ? 'volcano' : item.priority_band === 'high' ? 'gold' : 'green'}>
                          {item.priority_band.toUpperCase()}
                        </Tag>
                      </Space>
                      <Text strong>{item.entity_code} • {item.title}</Text>
                      <Text type="secondary">{item.aging_hint}</Text>
                      <Text type="secondary">
                        {item.age_days} ngày chờ | {item.is_multilevel ? 'Đa cấp' : 'Một cấp'}
                      </Text>
                      <Button type="link" icon={<ArrowRightOutlined />} style={{ paddingInline: 0 }} onClick={() => navigate(item.route)}>
                        Mở hồ sơ
                      </Button>
                    </Space>
                  </Card>
                )) : <Empty description="Không có hồ sơ phù hợp với lane này trong bộ lọc hiện tại." />}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card
            title="Hồ sơ nóng cần chốt"
            style={PANEL_STYLE}
            data-testid="approval-control-tower-hot-items"
            extra={<Tag color={filteredHotItems.length > 0 ? 'volcano' : 'green'}>{filteredHotItems.length} hồ sơ nóng</Tag>}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert
                showIcon
                type={hottestApprovalAge >= 2 ? 'warning' : 'info'}
                message={filteredHotItems.length
                  ? `Ưu tiên rà ${filteredHotItems.length} hồ sơ có tuổi chờ cao nhất trước khi tạo nghẽn duyệt chéo miền.`
                  : 'Không có hồ sơ nóng nổi bật trong bộ lọc hiện tại.'}
                description={filteredHotItems.length
                  ? `Tuổi chờ cao nhất hiện tại là ${hottestApprovalAge} ngày. Các hồ sơ được sắp theo độ ưu tiên và tuổi chờ.`
                  : 'Hãy đổi bộ lọc miền hoặc từ khóa nếu muốn rà sâu một nhóm hồ sơ cụ thể.'}
              />
              {filteredHotItems.length ? filteredHotItems.slice(0, 6).map((item) => (
                <Card
                  key={item.id}
                  size="small"
                  bodyStyle={{ padding: 14 }}
                  style={{ borderRadius: 16, border: '1px solid #e2e8f0', background: '#fafcff' }}
                >
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag color={domainColor(item.domain)}>{domainLabel(item.domain)}</Tag>
                      <Tag color={item.age_days >= 2 ? 'volcano' : 'gold'}>{item.age_days} ngày chờ</Tag>
                      <Tag>{item.status_label}</Tag>
                    </Space>
                    <Text strong>{item.entity_code} • {item.title}</Text>
                    <Text type="secondary">{item.aging_hint}</Text>
                    <Text type="secondary">Giá trị / quy mô: {item.domain === 'purchasing' || item.domain === 'production' ? item.amount_label : formatMoney(item.amount_label)}</Text>
                    <Button
                      type="primary"
                      size="small"
                      icon={<ArrowRightOutlined />}
                      onClick={() => navigate(buildApprovalRoute({
                        domain: item.domain,
                        route: item.route,
                        action: item.status_action,
                        entityCode: item.entity_code,
                        entityId: item.entity_id,
                      }))}
                    >
                      Mở hồ sơ
                    </Button>
                  </Space>
                </Card>
              )) : <Empty description="Chưa có hồ sơ nóng trong phạm vi đang xem." />}
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card
            title="Nhịp duyệt 7 ngày"
            style={PANEL_STYLE}
            data-testid="approval-control-tower-timeline"
            extra={<Tag color="geekblue">Submit / Approve / Reject</Tag>}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                Nhìn nhanh nhịp gửi duyệt, chốt duyệt và từ chối theo từng ngày để phát hiện khoảng hụt throughput hoặc miền đang bắt đầu tăng rejection.
              </Paragraph>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                {timeline7d.map((item) => (
                  <Card
                    key={item.date}
                    size="small"
                    bodyStyle={{ padding: 14 }}
                    style={{ borderRadius: 16, border: '1px solid #e2e8f0', background: '#ffffff' }}
                  >
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Text strong>{dayjs(item.date).format('DD/MM')}</Text>
                      <Tag color="blue">Gửi {item.submitted}</Tag>
                      <Tag color="green">Duyệt {item.approved}</Tag>
                      <Tag color={item.rejected > 0 ? 'volcano' : 'default'}>Từ chối {item.rejected}</Tag>
                    </Space>
                  </Card>
                ))}
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card
            title="Radar theo miền"
            style={PANEL_STYLE}
            extra={<Tag color="geekblue">Dữ liệu duyệt 7 ngày</Tag>}
          >
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {domainCards.length ? domainCards.map((item) => (
                <Card
                  key={item.domain}
                  size="small"
                  bodyStyle={{ padding: 14 }}
                  style={{ borderRadius: 16, border: '1px solid #e2e8f0', background: '#fafcff' }}
                >
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag color={domainColor(item.domain)}>{item.label}</Tag>
                      <Tag color={item.pending_now > 0 ? 'gold' : item.rejected_7d > 0 ? 'volcano' : 'green'}>
                        {item.pending_now > 0 ? 'Đang chờ' : item.rejected_7d > 0 ? 'Cần rà' : 'Ổn định'}
                      </Tag>
                    </Space>
                    <Text strong>{item.pending_now} hồ sơ chờ</Text>
                    <Text type="secondary">
                      Gửi {item.submitted_7d} • Duyệt {item.approved_7d} • Từ chối {item.rejected_7d}
                    </Text>
                    <Text type="secondary">Biến động cuối: {formatDateTime(item.last_event_at)}</Text>
                    <Button
                      type="primary"
                      icon={<ArrowRightOutlined />}
                      onClick={() => navigate(buildApprovalRoute({ domain: item.domain, route: item.route }))}
                    >
                      Mở miền này
                    </Button>
                  </Space>
                </Card>
              )) : <Empty description="Chưa có radar duyệt theo miền." />}
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={15}>
          <Card
            title="Hàng chờ ưu tiên"
            style={PANEL_STYLE}
            extra={(
              <Space wrap>
                <Segmented<DomainFilter>
                  value={domainFilter}
                  onChange={(value) => setDomainFilter(value)}
                  options={[
                    { label: 'Tất cả', value: 'all' },
                    { label: 'Tài chính', value: 'finance' },
                    { label: 'Nhân sự', value: 'workforce' },
                    { label: 'Mua hàng', value: 'purchasing' },
                    { label: 'Sản xuất', value: 'production' },
                  ]}
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tìm mã hồ sơ, đối tượng, miền nghiệp vụ..."
                  style={{ width: 280 }}
                />
              </Space>
            )}
          >
            <Table<QueueRow>
              rowKey="id"
              size="small"
              loading={loading}
              dataSource={filteredQueueRows}
              columns={queueColumns}
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              locale={{ emptyText: <Empty description="Không có hồ sơ phù hợp với bộ lọc hiện tại." /> }}
              scroll={{ x: 980 }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title="Quyết định duyệt gần đây"
        style={PANEL_STYLE}
        extra={<Tag color="blue">Drilldown trực tiếp</Tag>}
      >
        {recentDecisions.length ? (
          <Table
            rowKey="id"
            size="small"
            dataSource={recentDecisions}
            pagination={{ pageSize: 6, hideOnSinglePage: true }}
            columns={[
              {
                title: 'Miền',
                dataIndex: 'domain',
                width: 120,
                render: (value: ApprovalDomain) => <Tag color={domainColor(value)}>{domainLabel(value)}</Tag>,
              },
              {
                title: 'Quyết định',
                key: 'summary',
                render: (_, record) => (
                  <Space direction="vertical" size={2}>
                    <Space wrap>
                      <Tag color={String(record.action).startsWith('REJECT') ? 'volcano' : 'green'}>
                        {record.action_label}
                      </Tag>
                      <Text strong>{record.summary}</Text>
                    </Space>
                    <Text type="secondary">
                      {record.actor_label} • {record.entity_code} • {formatDateTime(record.created_at)}
                    </Text>
                    {record.comments ? <Paragraph type="secondary" style={{ marginBottom: 0 }}>{record.comments}</Paragraph> : null}
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
                        buildApprovalRoute({
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
            scroll={{ x: 860 }}
          />
        ) : (
          <Empty description="Chưa có quyết định duyệt gần đây trong phạm vi hiện tại." />
        )}
      </Card>

      <Modal
        open={isPresetModalOpen}
        title="Lưu mẫu lọc duyệt"
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
            Lưu nhanh góc nhìn điều phối duyệt hiện tại để trưởng ca hoặc quản lý quay lại đúng lane ưu tiên chỉ với một lần bấm.
          </Paragraph>
          <Input
            data-testid="approval-control-tower-preset-name"
            placeholder="Ví dụ: Tài chính cần chốt đầu ngày"
            value={presetName}
            onChange={(event) => setPresetName(event.target.value)}
            onPressEnter={() => void saveNamedPreset()}
          />
        </Space>
      </Modal>
    </div>
  );
}
