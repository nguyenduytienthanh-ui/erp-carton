import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Empty, Input, Select, Space, Spin, Switch, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { notificationsApi, type NotificationItem } from '../../api/notifications';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useRowSelection } from '../../hooks/useRowSelection';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';

const { Text, Title } = Typography;

type ReadFilter = 'ALL' | 'UNREAD' | 'READ';

const TYPE_LABELS: Record<string, string> = {
  mention: 'Đề cập',
  comment: 'Bình luận',
  approval_request: 'Yêu cầu duyệt',
  approval_approved: 'Đã duyệt',
  approval_rejected: 'Từ chối duyệt',
  assignment: 'Phân công',
  due_date: 'Nhắc hạn',
  system: 'Hệ thống',
};

function typeColor(type: string): string {
  if (type === 'assignment') return 'blue';
  if (type === 'due_date') return 'gold';
  if (type === 'approval_rejected') return 'red';
  if (type === 'approval_approved') return 'green';
  return 'default';
}

export default function NotificationCenter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [readFilter, setReadFilter] = useState<ReadFilter>('ALL');
  const [liveSync, setLiveSync] = useState(true);
  const liveSinceRef = useRef<string | null>(null);
  const { selectedIds, rowSelection, clearSelection } = useRowSelection<NotificationItem>();
  const {
    intentSearch,
    intentFilters,
  } = useSearchFilterIntent({
    searchInput,
    filterValues: { typeFilter, readFilter },
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (f) => `${f.typeFilter}|${f.readFilter}`,
    parseFilters: (raw) => {
      const [type, read] = raw.split('|');
      return {
        typeFilter: type || 'ALL',
        readFilter: (read === 'UNREAD' || read === 'READ' ? read : 'ALL') as ReadFilter,
      };
    },
  });
  const livePollingInterval = useRealtimePollingInterval({
    enabled: liveSync,
    activeMs: 4_000,
    hiddenMs: false,
  });

  const listQuery = useQuery({
    queryKey: ['notifications-list', intentSearch, intentFilters.typeFilter, intentFilters.readFilter],
    queryFn: () => notificationsApi.list({
      q: intentSearch.trim() || undefined,
      type: intentFilters.typeFilter !== 'ALL' ? intentFilters.typeFilter : undefined,
      unread: intentFilters.readFilter === 'UNREAD' ? true : undefined,
      page_size: 200,
    }),
    staleTime: 5_000,
  });

  const unreadCountQuery = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
    staleTime: 5_000,
  });

  const liveQuery = useQuery({
    queryKey: ['notifications-live-updates', liveSync, intentSearch, intentFilters.typeFilter, intentFilters.readFilter],
    queryFn: () => notificationsApi.liveUpdates({
      since: liveSinceRef.current || undefined,
      q: intentSearch.trim() || undefined,
      type: intentFilters.typeFilter !== 'ALL' ? intentFilters.typeFilter : undefined,
      unread: intentFilters.readFilter === 'UNREAD' ? true : undefined,
    }),
    enabled: liveSync,
    refetchInterval: livePollingInterval,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  useEffect(() => {
    liveSinceRef.current = null;
  }, [intentSearch, intentFilters.typeFilter, intentFilters.readFilter, liveSync]);

  useEffect(() => {
    const payload = liveQuery.data;
    if (!payload) return;
    if (payload.latest_at) liveSinceRef.current = payload.latest_at;
    if (!payload.has_changes) return;
    void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
  }, [liveQuery.data, queryClient]);

  const markReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const markManyMutation = useMutation({
    mutationFn: (ids: number[]) => notificationsApi.markManyRead(ids),
    onSuccess: (res) => {
      message.success(`Đã đánh dấu đã đọc ${res.count} thông báo.`);
      clearSelection();
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
    onError: () => message.error('Không thể đánh dấu đã đọc hàng loạt.'),
  });

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: (res) => {
      message.success(`Đã đánh dấu đã đọc ${res.count} thông báo.`);
      clearSelection();
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
    onError: () => message.error('Không thể đánh dấu tất cả đã đọc.'),
  });

  const data = useMemo(() => {
    const raw = listQuery.data ?? [];
    if (intentFilters.readFilter === 'READ') return raw.filter((x) => x.is_read);
    return raw;
  }, [intentFilters.readFilter, listQuery.data]);

  const openRelated = (item: NotificationItem) => {
    const eType = (item.entity_type || '').toLowerCase();
    if (eType === 'task') {
      navigate('/task-inbox');
      return;
    }
    navigate('/workflow-pipeline');
  };

  const columns: ColumnsType<NotificationItem> = [
    {
      title: 'Loại',
      key: 'type',
      width: 140,
      render: (_, r) => <Tag color={typeColor(r.notification_type)}>{TYPE_LABELS[r.notification_type] || r.notification_type}</Tag>,
    },
    {
      title: 'Nội dung',
      key: 'content',
      render: (_, r) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Text strong>{r.title}</Text>
            {!r.is_read && <Badge color="#1677ff" text={<Text type="secondary">Mới</Text>} />}
          </Space>
          <Text type="secondary">{r.message}</Text>
        </Space>
      ),
    },
    {
      title: 'Nguồn',
      key: 'meta',
      width: 230,
      render: (_, r) => (
        <Space direction="vertical" size={1}>
          <Text type="secondary">Actor: {r.actor_username || 'Hệ thống'}</Text>
          <Text type="secondary">{dayjs(r.created_at).format('DD/MM/YYYY HH:mm:ss')}</Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 220,
      render: (_, r) => (
        <Space>
          {!r.is_read && (
            <Button size="small" loading={markReadMutation.isPending} onClick={() => markReadMutation.mutate(r.id)}>
              Đã đọc
            </Button>
          )}
          <Button size="small" type="primary" onClick={() => openRelated(r)}>
            Mở liên quan
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space size={8} style={{ width: '100%', justifyContent: 'space-between' }}>
            <Title level={4} style={{ margin: 0 }}>Trung tâm thông báo</Title>
            <Tag color="blue">Chưa đọc: {unreadCountQuery.data?.count ?? 0}</Tag>
          </Space>
          <Space wrap>
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm theo tiêu đề/nội dung"
              style={{ width: 320 }}
              suffix={searchInput ? <QuickClearIcon onClear={() => setSearchInput('')} title="Xóa tìm kiếm" /> : undefined}
            />
            <Select
              value={typeFilter}
              onChange={setTypeFilter}
              style={{ width: 170 }}
              options={[
                { value: 'ALL', label: 'Mọi loại' },
                ...Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v })),
              ]}
            />
            <Select<ReadFilter>
              value={readFilter}
              onChange={setReadFilter}
              style={{ width: 140 }}
              options={[
                { value: 'ALL', label: 'Tất cả' },
                { value: 'UNREAD', label: 'Chưa đọc' },
                { value: 'READ', label: 'Đã đọc' },
              ]}
            />
            <Button icon={<ReloadOutlined />} loading={listQuery.isFetching} onClick={() => listQuery.refetch()}>
              Tải lại
            </Button>
            <Button
              icon={<CheckOutlined />}
              disabled={!selectedIds.length}
              loading={markManyMutation.isPending}
              onClick={() => markManyMutation.mutate(selectedIds)}
            >
              Đọc hàng loạt
            </Button>
            <Button
              loading={markAllMutation.isPending}
              onClick={() => markAllMutation.mutate()}
            >
              Đánh dấu tất cả đã đọc
            </Button>
            <Space size={6}>
              <Text type="secondary">Đồng bộ realtime</Text>
              <Switch checked={liveSync} onChange={setLiveSync} size="small" />
            </Space>
            {liveSync && (
              <Tag color={liveQuery.data?.has_changes ? 'gold' : 'cyan'}>
                Realtime: {liveQuery.isFetching ? 'đang kiểm tra' : 'đang chạy'}
              </Tag>
            )}
          </Space>
        </Space>
      </Card>
      <Card size="small">
        {listQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
        ) : !data.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có thông báo phù hợp." />
        ) : (
          <Table<NotificationItem>
            rowKey="id"
            size="small"
            rowSelection={rowSelection}
            columns={columns}
            dataSource={data}
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        )}
      </Card>
    </Space>
  );
}
