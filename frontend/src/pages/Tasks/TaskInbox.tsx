import { useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, Input, Segmented, Space, Spin, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EyeOutlined, InboxOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi, type TaskItem } from '../../api/tasks';
import { QuickClearIcon, TaskWorkspaceModal } from '../../components';

const { Text } = Typography;

type InboxTab = 'ASSIGNED' | 'CREATED' | 'WATCHING' | 'TEAM' | 'OVERDUE';

export default function TaskInbox() {
  const [tab, setTab] = useState<InboxTab>('ASSIGNED');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<TaskItem | null>(null);
  const queryClient = useQueryClient();

  const summaryQuery = useQuery({
    queryKey: ['task-inbox-summary'],
    queryFn: () => tasksApi.mySummary(),
    staleTime: 10_000,
  });

  const tasksQuery = useQuery({
    queryKey: ['task-inbox-list', tab, q],
    queryFn: () => {
      const baseParams = {
        is_open: true,
        q: q.trim() || undefined,
        ordering_mode: 'quick_queue' as const,
      };
      if (tab === 'ASSIGNED') return tasksApi.list({ ...baseParams, mine: true });
      if (tab === 'CREATED') return tasksApi.list({ ...baseParams, created_by_me: true });
      if (tab === 'WATCHING') return tasksApi.list({ ...baseParams, watching: true });
      if (tab === 'TEAM') return tasksApi.list({ ...baseParams, team_members: true });
      return tasksApi.list({ ...baseParams, is_overdue: true });
    },
    staleTime: 5_000,
  });

  const watchMutation = useMutation({
    mutationFn: ({ id, watching }: { id: number; watching: boolean }) =>
      (watching ? tasksApi.unwatch(id) : tasksApi.watch(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-list'] });
      void queryClient.invalidateQueries({ queryKey: ['task-inbox-summary'] });
    },
    onError: () => message.error('Không thể cập nhật trạng thái theo dõi.'),
  });

  const data = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);

  const columns: ColumnsType<TaskItem> = [
    {
      title: 'Đối tượng',
      key: 'entity',
      width: 180,
      render: (_, r) => (
        <Space direction="vertical" size={1}>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>{r.entity_type}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.entity_code || `#${r.entity_id}`}</Text>
        </Space>
      ),
    },
    {
      title: 'Nhiệm vụ',
      dataIndex: 'title',
      key: 'title',
      render: (_, r) => (
        <Space direction="vertical" size={2}>
          <Text strong>{r.title}</Text>
          <Space size={6} wrap>
            <Tag>{r.status_display}</Tag>
            {r.needs_help && <Tag color="warning">Cần hỗ trợ</Tag>}
            {r.is_blocking && <Tag color="error">Blocking</Tag>}
            {r.due_date && dayjs(r.due_date).isBefore(dayjs(), 'day') && <Tag color="gold">Quá hạn</Tag>}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Người xử lý',
      key: 'assignee',
      width: 160,
      render: (_, r) => r.assigned_to_info?.full_name || 'Chưa giao',
    },
    {
      title: 'Theo dõi',
      key: 'watch',
      width: 110,
      render: (_, r) => (
        <Button
          size="small"
          icon={r.is_watching ? <StarFilled /> : <StarOutlined />}
          onClick={() => watchMutation.mutate({ id: r.id, watching: r.is_watching })}
        >
          {r.watchers_count}
        </Button>
      ),
    },
    {
      title: 'Hạn',
      dataIndex: 'due_date',
      key: 'due_date',
      width: 120,
      render: (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '-'),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 110,
      render: (_, r) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => setSelected(r)}>
          Mở
        </Button>
      ),
    },
  ];

  const summary = summaryQuery.data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Space wrap>
            <InboxOutlined />
            <Text strong style={{ fontSize: 16 }}>Nhiệm vụ của tôi</Text>
          </Space>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo mã, tiêu đề, mô tả..."
            style={{ width: 300 }}
            suffix={q ? <QuickClearIcon onClear={() => setQ('')} title="Xóa tìm kiếm" /> : undefined}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <Segmented<InboxTab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'ASSIGNED', label: <Badge count={summary?.assigned_to_me ?? 0} size="small">Được giao tôi</Badge> },
              { value: 'CREATED', label: <Badge count={summary?.created_by_me ?? 0} size="small">Tạo bởi tôi</Badge> },
              { value: 'WATCHING', label: <Badge count={summary?.watching ?? 0} size="small">Tôi theo dõi</Badge> },
              { value: 'TEAM', label: <Badge count={summary?.team_members ?? 0} size="small">Nhân viên của tôi</Badge> },
              { value: 'OVERDUE', label: <Badge count={summary?.overdue ?? 0} size="small">Quá hạn</Badge> },
            ]}
          />
        </div>
      </Card>

      <Card size="small">
        {tasksQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
        ) : data.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có nhiệm vụ phù hợp." />
        ) : (
          <Table<TaskItem>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={data}
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        )}
      </Card>

      <TaskWorkspaceModal
        open={!!selected}
        onClose={() => setSelected(null)}
        entityType={selected?.entity_type || 'Product'}
        entityId={selected?.entity_id ?? null}
        entityCode={selected?.entity_code}
        titlePrefix="Nhiệm vụ của tôi"
      />
    </div>
  );
}
