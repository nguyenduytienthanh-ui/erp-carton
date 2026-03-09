import { Suspense, lazy, useMemo, useState } from 'react';
import { Button, Card, Descriptions, Drawer, Empty, Input, Select, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AlertOutlined, ClockCircleOutlined, LockOutlined, ProjectOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { tasksApi, type TaskItem } from '../../api/tasks';
import { productsApi } from '../../api/products';
import type { Product } from '../../types/product';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';

const { Text } = Typography;

type BoardFilter = 'ALL' | 'BLOCKING' | 'HELP' | 'OVERDUE' | 'DEPENDENCY';
const TaskWorkspaceModalLazy = lazy(() => import('../../components/TaskWorkspaceModal/TaskWorkspaceModal'));

export default function TaskOperationsBoard() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [filter, setFilter] = useState<BoardFilter>('ALL');
  const [selected, setSelected] = useState<TaskItem | null>(null);
  const [quickViewProductId, setQuickViewProductId] = useState<number | null>(null);
  const [selectedProductForTask, setSelectedProductForTask] = useState<Product | null>(null);

  const {
    intentSearch,
    intentFilters,
  } = useSearchFilterIntent({
    searchInput,
    filterValues: { filter },
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (f) => f.filter,
    parseFilters: (v) => ({
      filter: (v === 'ALL' || v === 'BLOCKING' || v === 'HELP' || v === 'OVERDUE' || v === 'DEPENDENCY'
        ? v
        : 'ALL') as BoardFilter,
    }),
  });

  const tasksQuery = useQuery({
    queryKey: ['task-operations-board', intentSearch, intentFilters.filter],
    queryFn: () =>
      tasksApi.list({
        entity_type: 'Product',
        is_open: true,
        is_blocking: intentFilters.filter === 'BLOCKING' ? true : undefined,
        needs_help: intentFilters.filter === 'HELP' ? true : undefined,
        is_overdue: intentFilters.filter === 'OVERDUE' ? true : undefined,
        dependency_blocked: intentFilters.filter === 'DEPENDENCY' ? true : undefined,
        ordering_mode: 'quick_queue',
        q: intentSearch.trim() || undefined,
      }),
    staleTime: 10_000,
  });

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const quickViewQuery = useQuery<Product>({
    queryKey: ['task-board-product-quick-view', quickViewProductId],
    queryFn: () => productsApi.getProduct(quickViewProductId!),
    enabled: quickViewProductId !== null,
    staleTime: 20_000,
  });
  const quickViewProduct = quickViewQuery.data ?? null;
  const counts = useMemo(() => ({
    all: tasks.length,
    blocking: tasks.filter((t) => t.is_blocking).length,
    help: tasks.filter((t) => t.needs_help).length,
    overdue: tasks.filter((t) => t.due_date && dayjs(t.due_date).isBefore(dayjs(), 'day')).length,
    dep: tasks.filter((t) => t.depends_on_info && t.depends_on_info.status !== 'DONE').length,
  }), [tasks]);

  const columns: ColumnsType<TaskItem> = [
    {
      title: 'Mã hàng',
      dataIndex: 'entity_code',
      key: 'entity_code',
      width: 120,
      render: (_v, r) => (
        <Button type="link" size="small" style={{ paddingInline: 0 }} onClick={() => setQuickViewProductId(r.entity_id)}>
          <Tag color="blue" style={{ marginInlineEnd: 0, cursor: 'pointer' }}>{r.entity_code || `#${r.entity_id}`}</Tag>
        </Button>
      ),
    },
    {
      title: 'Nhiệm vụ',
      dataIndex: 'title',
      key: 'title',
      render: (_v, r) => (
        <Space direction="vertical" size={2}>
          <Text strong>{r.title}</Text>
          {!!r.tags?.length && <Space size={4} wrap>{r.tags.map((t) => <Tag key={t} style={{ marginInlineEnd: 0 }}>#{t}</Tag>)}</Space>}
        </Space>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status_display',
      key: 'status',
      width: 210,
      render: (_v, r) => (
        <Space size={4} wrap>
          {r.is_pinned && <Tag color="magenta" style={{ marginInlineEnd: 0 }}>Ghim</Tag>}
          {r.is_blocking && <Tag color="error" icon={<LockOutlined />} style={{ marginInlineEnd: 0 }}>Blocking</Tag>}
          {r.needs_help && <Tag color="warning" icon={<AlertOutlined />} style={{ marginInlineEnd: 0 }}>Cần hỗ trợ</Tag>}
          {r.due_date && dayjs(r.due_date).isBefore(dayjs(), 'day') && (
            <Tag color="gold" icon={<ClockCircleOutlined />} style={{ marginInlineEnd: 0 }}>Quá hạn</Tag>
          )}
          {r.depends_on_info && r.depends_on_info.status !== 'DONE' && (
            <Tag color="default" style={{ marginInlineEnd: 0 }}>Chờ: {r.depends_on_info.title}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Người xử lý',
      dataIndex: 'assigned_to_info',
      key: 'assigned_to',
      width: 180,
      render: (v) => v?.full_name || 'Chưa giao',
    },
    {
      title: 'Hạn',
      dataIndex: 'due_date',
      key: 'due_date',
      width: 110,
      render: (v) => v ? dayjs(v).format('DD/MM/YYYY') : '-',
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 140,
      render: (_v, r) => (
        <Tooltip title="Mở không gian giao nhiệm vụ của mã hàng">
          <Button size="small" icon={<ProjectOutlined />} onClick={() => setSelected(r)}>
            Mở task
          </Button>
        </Tooltip>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small">
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Tag color="blue">Tổng mở: {counts.all}</Tag>
            <Tag color="error">Blocking: {counts.blocking}</Tag>
            <Tag color="warning">Cần hỗ trợ: {counts.help}</Tag>
            <Tag color="gold">Quá hạn: {counts.overdue}</Tag>
            <Tag>Chờ công đoạn trước: {counts.dep}</Tag>
          </Space>
          <Space wrap>
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm theo mã hàng, tiêu đề task..."
              style={{ width: 260 }}
              suffix={
                searchInput
                  ? <QuickClearIcon onClear={() => setSearchInput('')} title="Xóa tìm kiếm" />
                  : undefined
              }
            />
            <Select<BoardFilter>
              value={filter}
              onChange={setFilter}
              style={{ width: 190 }}
              options={[
                { value: 'ALL', label: 'Tất cả task mở' },
                { value: 'BLOCKING', label: 'Chỉ blocking' },
                { value: 'HELP', label: 'Chỉ cần hỗ trợ' },
                { value: 'OVERDUE', label: 'Chỉ quá hạn' },
                { value: 'DEPENDENCY', label: 'Chờ công đoạn trước' },
              ]}
            />
          </Space>
        </Space>
      </Card>

      <Card size="small">
        {tasksQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
        ) : tasks.length === 0 ? (
          <Empty description="Không có task phù hợp bộ lọc" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<TaskItem>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={tasks}
            pagination={{ pageSize: 20, showSizeChanger: true }}
          />
        )}
      </Card>

      <Suspense fallback={null}>
        <TaskWorkspaceModalLazy
          open={!!selected || !!selectedProductForTask}
          onClose={() => { setSelected(null); setSelectedProductForTask(null); }}
          entityType="Product"
          entityId={selectedProductForTask?.id ?? selected?.entity_id ?? null}
          entityCode={selectedProductForTask?.code ?? selected?.entity_code}
          blockingCount={selectedProductForTask?.blocking_tasks_count ?? (selected?.is_blocking ? 1 : 0)}
          titlePrefix="Điều hành nhiệm vụ"
        />
      </Suspense>

      <Drawer
        title={quickViewProduct ? `Mã hàng: ${quickViewProduct.code}` : 'Thông tin mã hàng'}
        width={560}
        open={quickViewProductId !== null}
        onClose={() => setQuickViewProductId(null)}
        destroyOnClose
      >
        {quickViewQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : !quickViewProduct ? (
          <Empty description="Không tải được thông tin mã hàng" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label="Mã hàng">{quickViewProduct.code}</Descriptions.Item>
              <Descriptions.Item label="Tên hàng">{quickViewProduct.name}</Descriptions.Item>
              <Descriptions.Item label="Danh mục">{quickViewProduct.category_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Đơn vị">{quickViewProduct.unit_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Kích thước PO">{quickViewProduct.size_order || '-'}</Descriptions.Item>
              <Descriptions.Item label="Kích thước SX">{quickViewProduct.size_production || '-'}</Descriptions.Item>
              <Descriptions.Item label="Giá vốn">{quickViewProduct.cost_price || '-'}</Descriptions.Item>
              <Descriptions.Item label="Đơn giá">{quickViewProduct.sale_price || '-'}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">{quickViewProduct.status || '-'}</Descriptions.Item>
              <Descriptions.Item label="Ghi chú">{quickViewProduct.note || '-'}</Descriptions.Item>
            </Descriptions>
            <Button
              type="primary"
              onClick={() => {
                navigate(`/products?searchInput=${encodeURIComponent(quickViewProduct.code)}&search=${encodeURIComponent(quickViewProduct.code)}`);
              }}
            >
              Mở trang Sản phẩm với mã này
            </Button>
            <Button
              onClick={() => {
                setSelectedProductForTask(quickViewProduct);
                setQuickViewProductId(null);
              }}
            >
              Giao nhiệm vụ ngay cho mã này
            </Button>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
