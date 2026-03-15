import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Empty, Input, Select, Space, Spin, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { operationsApi, type OperationLogItem, type OperationSource, type OperationSuccessFilter } from '../../api/operations';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { SafeText as Text, SafeTitle as Title } from '../../components/SafeText';
import { storage } from '../../utils/storage';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';
import { canViewOperationsLog } from '../../utils/authz';

const SOURCE_LABELS: Record<string, string> = {
  TASK_BULK: 'Task Bulk',
  PIPELINE_EVENT: 'Pipeline',
  INSIGHT_ACTION: 'Insight',
  TASK_AUDIT: 'Task Audit',
  AUTOMATION_RUN: 'Automation',
};

const SOURCE_COLORS: Record<string, string> = {
  TASK_BULK: 'purple',
  PIPELINE_EVENT: 'blue',
  INSIGHT_ACTION: 'gold',
  TASK_AUDIT: 'default',
  AUTOMATION_RUN: 'cyan',
};

function canViewAllLogs(): boolean {
  if (canViewOperationsLog()) return true;
  const user = storage.getUser() as unknown;
  if (!user || typeof user !== 'object') return false;
  const u = user as Record<string, unknown>;
  return u.is_staff === true || u.is_superuser === true;
}

export default function OperationsLogDashboard() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [actorQuery, setActorQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState<OperationSource>('ALL');
  const [successFilter, setSuccessFilter] = useState<OperationSuccessFilter>('ALL');
  const [liveSync, setLiveSync] = useState(true);
  const [includeAll, setIncludeAll] = useState(canViewAllLogs());
  const liveSinceRef = useRef<string | null>(null);
  const {
    intentSearch,
    intentFilters,
  } = useSearchFilterIntent({
    searchInput,
    filterValues: { actorQuery, actionFilter, sourceFilter, successFilter, includeAll },
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (f) => JSON.stringify(f),
    parseFilters: (raw) => {
      try {
        const parsed = JSON.parse(raw) as {
          actorQuery?: string;
          actionFilter?: string;
          sourceFilter?: OperationSource;
          successFilter?: OperationSuccessFilter;
          includeAll?: boolean;
        };
        return {
          actorQuery: parsed.actorQuery ?? '',
          actionFilter: parsed.actionFilter ?? 'ALL',
          sourceFilter: parsed.sourceFilter ?? 'ALL',
          successFilter: parsed.successFilter ?? 'ALL',
          includeAll: parsed.includeAll === true,
        };
      } catch {
        return {
          actorQuery: '',
          actionFilter: 'ALL',
          sourceFilter: 'ALL' as OperationSource,
          successFilter: 'ALL' as OperationSuccessFilter,
          includeAll: canViewAllLogs(),
        };
      }
    },
  });
  const livePollingInterval = useRealtimePollingInterval({
    enabled: liveSync,
    activeMs: 10_000,
    hiddenMs: false,
  });

  const logsQuery = useQuery({
    queryKey: ['operations-log', intentSearch, intentFilters.actorQuery, intentFilters.actionFilter, intentFilters.sourceFilter, intentFilters.successFilter, intentFilters.includeAll],
    queryFn: () => operationsApi.list({
      q: intentSearch.trim() || undefined,
      actor_query: intentFilters.actorQuery.trim() || undefined,
      action: intentFilters.actionFilter,
      source: intentFilters.sourceFilter,
      success: intentFilters.successFilter,
      include_all: intentFilters.includeAll,
      limit: 200,
    }),
    staleTime: 5_000,
  });
  const logMetaQuery = useQuery({
    queryKey: ['operations-log-meta'],
    queryFn: () => operationsApi.meta(),
    staleTime: 30_000,
  });

  const liveQuery = useQuery({
    queryKey: ['operations-log-live', liveSync, intentSearch, intentFilters.actorQuery, intentFilters.actionFilter, intentFilters.sourceFilter, intentFilters.successFilter, intentFilters.includeAll],
    queryFn: () => operationsApi.liveUpdates({
      since: liveSinceRef.current || undefined,
      q: intentSearch.trim() || undefined,
      actor_query: intentFilters.actorQuery.trim() || undefined,
      action: intentFilters.actionFilter,
      source: intentFilters.sourceFilter,
      success: intentFilters.successFilter,
      include_all: intentFilters.includeAll,
    }),
    enabled: liveSync,
    refetchInterval: livePollingInterval,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  useEffect(() => {
    liveSinceRef.current = null;
  }, [
    intentSearch,
    intentFilters.actorQuery,
    intentFilters.actionFilter,
    intentFilters.sourceFilter,
    intentFilters.successFilter,
    intentFilters.includeAll,
    liveSync,
  ]);

  useEffect(() => {
    const payload = liveQuery.data;
    if (!payload) return;
    if (payload.latest_at) liveSinceRef.current = payload.latest_at;
    if (!payload.has_changes) return;
    void queryClient.invalidateQueries({ queryKey: ['operations-log'] });
  }, [liveQuery.data, queryClient]);

  const data = useMemo(() => logsQuery.data?.items ?? [], [logsQuery.data?.items]);

  const exportCsv = () => {
    if (!data.length) {
      message.warning('Không có dữ liệu để xuất CSV.');
      return;
    }
    const headers = ['thoi_gian', 'nguon', 'hanh_dong', 'actor', 'ket_qua', 'doi_tuong', 'ma', 'noi_dung'];
    const rows = data.map((item) => [
      dayjs(item.created_at).format('DD/MM/YYYY HH:mm:ss'),
      SOURCE_LABELS[item.source] || item.source,
      item.action,
      item.actor || 'Hệ thống',
      item.success === true ? 'Thành công' : item.success === false ? 'Thất bại' : '-',
      item.entity_type,
      item.entity_code || String(item.entity_id),
      item.message || '',
    ]);
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map((x) => esc(x)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nhat_ky_van_hanh_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('Đã xuất CSV nhật ký vận hành.');
  };

  const columns: ColumnsType<OperationLogItem> = [
    {
      title: 'Thời gian',
      key: 'created_at',
      width: 170,
      render: (_, r) => dayjs(r.created_at).format('DD/MM/YYYY HH:mm:ss'),
    },
    {
      title: 'Nguồn',
      key: 'source',
      width: 130,
      render: (_, r) => <Tag color={SOURCE_COLORS[r.source] || 'default'}>{SOURCE_LABELS[r.source] || r.source}</Tag>,
    },
    {
      title: 'Hành động',
      dataIndex: 'action',
      key: 'action',
      width: 140,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'Người thao tác',
      dataIndex: 'actor',
      key: 'actor',
      width: 170,
      render: (v: string | null) => v || 'Hệ thống',
    },
    {
      title: 'Kết quả',
      key: 'success',
      width: 120,
      render: (_, r) => (
        r.success === true
          ? <Tag color="green">Thành công</Tag>
          : r.success === false
            ? <Tag color="red">Thất bại</Tag>
            : <Tag>-</Tag>
      ),
    },
    {
      title: 'Nội dung',
      key: 'message',
      render: (_, r) => (
        <Space direction="vertical" size={1}>
          <Text>{r.message || '-'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.entity_type} • {r.entity_code || `#${r.entity_id}`}
          </Text>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>Nhật ký vận hành</Title>
          <Space wrap>
            <Tag color={Number(logMetaQuery.data?.recent_failed_count_24h ?? 0) > 0 ? 'red' : 'green'}>
              Lỗi 24h: {logMetaQuery.data?.recent_failed_count_24h ?? 0}
            </Tag>
          </Space>
          <Space wrap>
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm nội dung/nguồn/hành động"
              style={{ width: 280 }}
              suffix={searchInput ? <QuickClearIcon onClear={() => setSearchInput('')} title="Xóa tìm kiếm" /> : undefined}
            />
            <Input
              value={actorQuery}
              onChange={(e) => setActorQuery(e.target.value)}
              placeholder="Lọc theo người thao tác"
              style={{ width: 220 }}
              suffix={actorQuery ? <QuickClearIcon onClear={() => setActorQuery('')} title="Xóa người thao tác" /> : undefined}
            />
            <Select<string>
              value={actionFilter}
              onChange={setActionFilter}
              style={{ width: 150 }}
              options={[
                { value: 'ALL', label: 'Mọi hành động' },
                ...((logMetaQuery.data?.actions ?? []).map((item) => ({ value: item.value, label: item.label }))),
              ]}
            />
            <Select<OperationSource>
              value={sourceFilter}
              onChange={setSourceFilter}
              style={{ width: 160 }}
              options={[
                { value: 'ALL', label: 'Mọi nguồn' },
                ...((logMetaQuery.data?.sources ?? []).map((item) => ({
                  value: item.value as OperationSource,
                  label: SOURCE_LABELS[item.value] || item.label,
                }))),
              ]}
            />
            <Select<OperationSuccessFilter>
              value={successFilter}
              onChange={setSuccessFilter}
              style={{ width: 140 }}
              options={[
                { value: 'ALL', label: 'Mọi kết quả' },
                { value: 'SUCCESS', label: 'Thành công' },
                { value: 'FAILED', label: 'Thất bại' },
              ]}
            />
            {canViewAllLogs() && (
              <Space size={6}>
                <Text type="secondary">Xem toàn hệ thống</Text>
                <Switch checked={includeAll} onChange={setIncludeAll} size="small" />
              </Space>
            )}
            <Space size={6}>
              <Text type="secondary">Đồng bộ realtime</Text>
              <Switch checked={liveSync} onChange={setLiveSync} size="small" />
            </Space>
            {liveSync && (
              <Tag color={liveQuery.data?.has_changes ? 'gold' : 'cyan'}>
                Realtime: {liveQuery.isFetching ? 'đang kiểm tra' : 'đang chạy'}
              </Tag>
            )}
            <Button icon={<ReloadOutlined />} loading={logsQuery.isFetching} onClick={() => logsQuery.refetch()}>
              Tải lại
            </Button>
            <Button onClick={exportCsv}>Xuất CSV</Button>
            <Tag style={{ marginInlineEnd: 0 }}>Hiển thị {data.length} bản ghi</Tag>
          </Space>
        </Space>
      </Card>
      <Card size="small">
        {logsQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
        ) : !data.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu nhật ký vận hành." />
        ) : (
          <Table<OperationLogItem>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={data}
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        )}
      </Card>
    </Space>
  );
}
