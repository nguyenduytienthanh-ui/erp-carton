import { Suspense, lazy, useMemo, useState, type CSSProperties } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Input, Modal, Select, Space, Spin, Table, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AlertOutlined, ClockCircleOutlined, LockOutlined, ProjectOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { tasksApi, TASK_PRIORITY_COLORS, TASK_PRIORITY_LABELS, type TaskItem } from '../../api/tasks';
import { productsApi } from '../../api/products';
import type { Product } from '../../types/product';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { SafeText as Text } from '../../components/SafeText';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { PAGES } from '../../utils/constants';

type BoardFilter = 'ALL' | 'BLOCKING' | 'HELP' | 'OVERDUE' | 'DEPENDENCY';
type TaskOperationsViewSnapshot = {
  searchInput: string;
  filter: BoardFilter;
};

type TaskOperationsNamedPreset = {
  id: string;
  name: string;
  snapshot: TaskOperationsViewSnapshot;
  updatedAt: string;
};

const FILTER_LABELS: Record<BoardFilter, string> = {
  ALL: 'Tất cả nhiệm vụ mở',
  BLOCKING: 'Đang chặn',
  HELP: 'Cần hỗ trợ',
  OVERDUE: 'Quá hạn',
  DEPENDENCY: 'Chờ công đoạn trước',
};

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

const TaskWorkspaceModalLazy = lazy(() => import('../../components/TaskWorkspaceModal/TaskWorkspaceModal'));

const TASK_OPERATIONS_FILTER_VALUES = ['ALL', 'BLOCKING', 'HELP', 'OVERDUE', 'DEPENDENCY'] as const;

function isTaskOperationsFilter(value: unknown): value is BoardFilter {
  return typeof value === 'string' && (TASK_OPERATIONS_FILTER_VALUES as readonly string[]).includes(value);
}

function parseTaskOperationsViewSnapshot(value: unknown): TaskOperationsViewSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const snapshot = value as Partial<TaskOperationsViewSnapshot>;
  if (typeof snapshot.searchInput !== 'string' || !isTaskOperationsFilter(snapshot.filter)) {
    return null;
  }
  return {
    searchInput: snapshot.searchInput,
    filter: snapshot.filter,
  };
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Chưa cập nhật';
  return dayjs(value).format('DD/MM HH:mm');
}

function getDueTone(task: TaskItem) {
  if (!task.due_date) return 'default';
  if (dayjs(task.due_date).isBefore(dayjs(), 'day')) return 'error';
  if (dayjs(task.due_date).isSame(dayjs(), 'day')) return 'warning';
  if (dayjs(task.due_date).isSame(dayjs().add(1, 'day'), 'day')) return 'processing';
  return 'default';
}

function getDueLabel(value: string | null) {
  if (!value) return 'Chưa đặt hạn';
  if (dayjs(value).isBefore(dayjs(), 'day')) return 'Đã quá hạn';
  if (dayjs(value).isSame(dayjs(), 'day')) return 'Đến hạn hôm nay';
  if (dayjs(value).isSame(dayjs().add(1, 'day'), 'day')) return 'Đến hạn ngày mai';
  return `Còn ${dayjs(value).diff(dayjs(), 'day') + 1} ngày`;
}

function getOperationsNextStep(task: TaskItem): string {
  if (task.depends_on_info && task.depends_on_info.status !== 'DONE') {
    return `Chờ hoàn tất "${task.depends_on_info.title}" trước khi xử lý tiếp.`;
  }
  if (task.is_blocking) {
    return 'Mở workspace để tháo điểm chặn trước khi tiếp tục luồng vận hành.';
  }
  if (task.needs_help) {
    return 'Điều phối người hỗ trợ hoặc phản hồi lý do vướng mắc trong workspace.';
  }
  if (!task.assigned_to_info) {
    return 'Gán người phụ trách để nhiệm vụ có owner rõ ràng.';
  }
  if (task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day')) {
    return 'Ưu tiên cập nhật tiến độ, hoàn thành hoặc chuyển người xử lý ngay.';
  }
  if (task.due_date && dayjs(task.due_date).isSame(dayjs(), 'day')) {
    return 'Chốt trạng thái trong hôm nay hoặc ghi chú lý do chưa xong.';
  }
  if (task.status === 'TODO') {
    return 'Bắt đầu nhiệm vụ khi đủ điều kiện phụ thuộc và nguồn lực.';
  }
  if (task.status === 'IN_PROGRESS') {
    return 'Cập nhật tiến độ, ghi chú vướng mắc hoặc hoàn thành nhiệm vụ.';
  }
  return 'Theo dõi lịch sử và mở workspace khi cần đối soát.';
}

export default function TaskOperationsBoard() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [filter, setFilter] = useState<BoardFilter>('ALL');
  const [selected, setSelected] = useState<TaskItem | null>(null);
  const [quickViewProductId, setQuickViewProductId] = useState<number | null>(null);
  const [selectedProductForTask, setSelectedProductForTask] = useState<Product | null>(null);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const { config, saveConfig, isLoading: isPreferencesLoading } = useUserPreferences(PAGES.TASK_OPERATIONS_BOARD);
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const namedPresets = useMemo<TaskOperationsNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const preset = item as Partial<TaskOperationsNamedPreset>;
        const snapshot = parseTaskOperationsViewSnapshot(preset.snapshot);
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
      .filter((item): item is TaskOperationsNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: { filter },
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (f) => f.filter,
    parseFilters: (value) => ({
      filter: (value === 'ALL' || value === 'BLOCKING' || value === 'HELP' || value === 'OVERDUE' || value === 'DEPENDENCY'
        ? value
        : 'ALL') as BoardFilter,
    }),
  });

  const overviewQuery = useQuery({
    queryKey: ['task-operations-board-overview'],
    queryFn: () =>
      tasksApi.list({
        entity_type: 'Product',
        is_open: true,
        ordering_mode: 'quick_queue',
      }),
    staleTime: 10_000,
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

  const overviewTasks = useMemo(() => overviewQuery.data ?? [], [overviewQuery.data]);
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);

  const quickViewQuery = useQuery<Product>({
    queryKey: ['task-board-product-quick-view', quickViewProductId],
    queryFn: () => productsApi.getProduct(quickViewProductId!),
    enabled: quickViewProductId !== null,
    staleTime: 20_000,
  });

  const quickViewProduct = quickViewQuery.data ?? null;

  const counts = useMemo(() => ({
    total: overviewTasks.length,
    blocking: overviewTasks.filter((task) => task.is_blocking).length,
    help: overviewTasks.filter((task) => task.needs_help).length,
    overdue: overviewTasks.filter((task) => task.due_date && dayjs(task.due_date).isBefore(dayjs(), 'day')).length,
    dueToday: overviewTasks.filter((task) => task.due_date && dayjs(task.due_date).isSame(dayjs(), 'day')).length,
    dep: overviewTasks.filter((task) => task.depends_on_info && task.depends_on_info.status !== 'DONE').length,
    unassigned: overviewTasks.filter((task) => !task.assigned_to_info).length,
    urgent: overviewTasks.filter((task) => task.priority === 'URGENT' || task.priority === 'HIGH').length,
  }), [overviewTasks]);

  const boardAlert = useMemo(() => {
    if (counts.blocking > 0 || counts.overdue > 0) {
      return {
        type: 'warning' as const,
        message: 'Hàng chờ vận hành đang có điểm nóng cần xử lý trước.',
        description: `Hiện có ${counts.blocking} nhiệm vụ đang chặn, ${counts.overdue} nhiệm vụ quá hạn và ${counts.help} nhiệm vụ đang chờ hỗ trợ.`,
      };
    }
    if (counts.help > 0 || counts.dep > 0 || counts.unassigned > 0) {
      return {
        type: 'info' as const,
        message: 'Luồng công việc đang ổn định nhưng vẫn còn vài điểm cần điều phối.',
        description: `Có ${counts.help} nhiệm vụ cần hỗ trợ, ${counts.dep} nhiệm vụ chờ bước trước và ${counts.unassigned} nhiệm vụ chưa giao người phụ trách.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Hàng chờ vận hành đang ở trạng thái kiểm soát tốt.',
      description: `Tổng ${counts.total} nhiệm vụ mở đang được theo dõi, không có điểm chặn hay quá hạn nổi bật.`,
    };
  }, [counts]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (searchInput.trim()) tags.push(`Tìm kiếm: ${searchInput.trim()}`);
    if (filter !== 'ALL') tags.push(`Nhóm lọc: ${FILTER_LABELS[filter]}`);
    return tags;
  }, [filter, searchInput]);

  const buildCurrentSnapshot = (): TaskOperationsViewSnapshot => ({
    searchInput,
    filter,
  });

  const applySnapshot = (snapshot: TaskOperationsViewSnapshot) => {
    setSearchInput(snapshot.searchInput);
    setFilter(snapshot.filter);
  };

  const saveCurrentView = async () => {
    await saveConfig({
      ...configRecord,
      saved_view_snapshot: buildCurrentSnapshot(),
      saved_view_saved_at: new Date().toISOString(),
    });
    message.success('Đã lưu chế độ xem điều phối.');
  };

  const applySavedView = () => {
    const snapshot = parseTaskOperationsViewSnapshot(configRecord.saved_view_snapshot);
    if (!snapshot) {
      message.info('Chưa có chế độ xem điều phối đã lưu.');
      return;
    }
    applySnapshot(snapshot);
    message.success('Đã áp dụng chế độ xem điều phối đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      message.warning('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const presetId = selectedViewPreset?.id ?? `${Date.now()}`;
    const nextPresets = [
      ...namedPresets.filter((item) => item.id !== presetId),
      {
        id: presetId,
        name,
        snapshot: buildCurrentSnapshot(),
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

  const handleRefresh = () => {
    void overviewQuery.refetch();
    void tasksQuery.refetch();
    if (quickViewProductId !== null) {
      void quickViewQuery.refetch();
    }
  };

  const columns: ColumnsType<TaskItem> = [
    {
      title: 'Mã hàng',
      dataIndex: 'entity_code',
      key: 'entity_code',
      width: 140,
      render: (_value, record) => (
        <Space direction="vertical" size={4}>
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0, width: 'fit-content' }}
            onClick={() => setQuickViewProductId(record.entity_id)}
          >
            <Tag color="blue" style={{ marginInlineEnd: 0, cursor: 'pointer' }}>
              {record.entity_code || `#${record.entity_id}`}
            </Tag>
          </Button>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>
            Cập nhật: {formatDateTime(record.activity_updated_at ?? record.updated_at)}
          </div>
        </Space>
      ),
    },
    {
      title: 'Nhiệm vụ',
      dataIndex: 'title',
      key: 'title',
      render: (_value, record) => (
        <Space direction="vertical" size={4}>
          <Text strong>{record.title}</Text>
          {record.description ? (
            <div style={{ color: '#595959', fontSize: 12, lineHeight: 1.5 }}>
              {record.description}
            </div>
          ) : null}
          {record.last_update_note ? (
            <div style={{ color: '#8c8c8c', fontSize: 12, lineHeight: 1.4 }}>
              Ghi chú gần nhất: {record.last_update_note}
            </div>
          ) : null}
          <Space size={4} wrap>
            <Tag color={TASK_PRIORITY_COLORS[record.priority]} style={{ marginInlineEnd: 0 }}>
              {TASK_PRIORITY_LABELS[record.priority] ?? record.priority_display}
            </Tag>
            <Tag style={{ marginInlineEnd: 0 }}>Trao đổi: {record.comment_count}</Tag>
            <Tag style={{ marginInlineEnd: 0 }}>Tệp: {record.attachment_count}</Tag>
            {record.watchers_count > 0 ? (
              <Tag style={{ marginInlineEnd: 0 }}>Theo dõi: {record.watchers_count}</Tag>
            ) : null}
            {!!record.tags?.length && record.tags.map((tag) => (
              <Tag key={tag} style={{ marginInlineEnd: 0 }}>
                #{tag}
              </Tag>
            ))}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Tín hiệu',
      dataIndex: 'status_display',
      key: 'status',
      width: 270,
      render: (_value, record) => (
        <Space direction="vertical" size={4}>
          <Space size={4} wrap>
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              {record.status_display}
            </Tag>
            {record.is_pinned ? <Tag color="magenta" style={{ marginInlineEnd: 0 }}>Ghim</Tag> : null}
            {record.is_blocking ? (
              <Tag color="error" icon={<LockOutlined />} style={{ marginInlineEnd: 0 }}>
                Đang chặn
              </Tag>
            ) : null}
            {record.needs_help ? (
              <Tag color="warning" icon={<AlertOutlined />} style={{ marginInlineEnd: 0 }}>
                Cần hỗ trợ
              </Tag>
            ) : null}
            {record.due_date && dayjs(record.due_date).isSame(dayjs(), 'day') ? (
              <Tag color="gold" icon={<ClockCircleOutlined />} style={{ marginInlineEnd: 0 }}>
                Đến hạn hôm nay
              </Tag>
            ) : null}
            {record.due_date && dayjs(record.due_date).isBefore(dayjs(), 'day') ? (
              <Tag color="error" icon={<ClockCircleOutlined />} style={{ marginInlineEnd: 0 }}>
                Quá hạn
              </Tag>
            ) : null}
            {record.depends_on_info && record.depends_on_info.status !== 'DONE' ? (
              <Tag color="default" style={{ marginInlineEnd: 0 }}>
                Chờ: {record.depends_on_info.title}
              </Tag>
            ) : null}
          </Space>
          <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4 }}>
            Tiếp theo: {getOperationsNextStep(record)}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Phụ trách',
      dataIndex: 'assigned_to_info',
      key: 'assigned_to',
      width: 190,
      render: (value, record) => (
        <Space direction="vertical" size={4}>
          <div style={{ fontWeight: 500 }}>{value?.full_name || 'Chưa giao'}</div>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>
            Giao bởi: {record.assigned_by_info?.full_name || 'Hệ thống'}
          </div>
        </Space>
      ),
    },
    {
      title: 'Hạn xử lý',
      dataIndex: 'due_date',
      key: 'due_date',
      width: 140,
      render: (_value, record) => {
        if (!record.due_date) {
          return <span style={{ color: '#8c8c8c' }}>Chưa đặt hạn</span>;
        }
        return (
          <Space direction="vertical" size={2}>
            <Tag color={getDueTone(record)} style={{ marginInlineEnd: 0, width: 'fit-content' }}>
              {dayjs(record.due_date).format('DD/MM/YYYY')}
            </Tag>
            <div style={{ color: '#8c8c8c', fontSize: 12 }}>
              {getDueLabel(record.due_date)}
            </div>
          </Space>
        );
      },
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 170,
      render: (_value, record) => (
        <Space direction="vertical" size={6}>
          <Tooltip title="Mở không gian điều phối nhiệm vụ của mã hàng này">
            <Button size="small" icon={<ProjectOutlined />} onClick={() => setSelected(record)}>
              Mở workspace
            </Button>
          </Tooltip>
          <Button
            size="small"
            type="link"
            style={{ paddingInline: 0, width: 'fit-content' }}
            onClick={() => {
              navigate(`/products?searchInput=${encodeURIComponent(record.entity_code)}&search=${encodeURIComponent(record.entity_code)}`);
            }}
          >
            Xem hồ sơ mã hàng
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Điều phối nhiệm vụ sản phẩm</h2>
            <p style={{ margin: '4px 0 0', color: '#666', fontSize: 13 }}>
              Theo dõi toàn bộ nhiệm vụ mở theo mã hàng, chốt nhanh các điểm nghẽn và mở workspace đúng lúc.
            </p>
          </div>
          <Space wrap>
            {tasksQuery.isFetching || overviewQuery.isFetching ? (
              <Tag color="processing" style={{ marginInlineEnd: 0 }}>
                Đang đồng bộ trực tiếp
              </Tag>
            ) : (
              <Tag color="success" style={{ marginInlineEnd: 0 }}>
                Đồng bộ gần nhất: {formatDateTime(dayjs().toISOString())}
              </Tag>
            )}
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={tasksQuery.isFetching || overviewQuery.isFetching}>
              Làm mới
            </Button>
          </Space>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          {[
            { label: 'Đang mở', value: counts.total, tone: '#1677ff' },
            { label: 'Đang chặn', value: counts.blocking, tone: '#cf1322' },
            { label: 'Quá hạn', value: counts.overdue, tone: '#d46b08' },
            { label: 'Đến hạn hôm nay', value: counts.dueToday, tone: '#fa8c16' },
            { label: 'Cần hỗ trợ', value: counts.help, tone: '#ad6800' },
            { label: 'Chờ bước trước', value: counts.dep, tone: '#595959' },
            { label: 'Chưa giao', value: counts.unassigned, tone: '#531dab' },
            { label: 'Ưu tiên cao', value: counts.urgent, tone: '#c41d7f' },
          ].map((tile) => (
            <div key={tile.label} style={SUMMARY_TILE_STYLE}>
              <div style={{ color: '#666', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {tile.label}
              </div>
              <div style={{ fontSize: 30, lineHeight: 1, fontWeight: 700, color: tile.tone }}>{tile.value}</div>
              <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                {tile.value === 0 ? 'Không có điểm nổi bật' : 'Đang theo dõi trong hàng chờ'}
              </div>
            </div>
          ))}
        </div>

        <Alert
          type={boardAlert.type}
          showIcon
          message={boardAlert.message}
          description={boardAlert.description}
        />
      </Card>

      <Card size="small">
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Input
              data-testid="task-operations-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Tìm theo mã hàng, tiêu đề nhiệm vụ hoặc ghi chú gần nhất..."
              style={{ width: 320 }}
              suffix={
                searchInput
                  ? <QuickClearIcon onClear={() => setSearchInput('')} title="Xóa tìm kiếm" />
                  : undefined
              }
            />
            <div data-testid="task-operations-filter-select">
              <Select<BoardFilter>
                value={filter}
                onChange={setFilter}
                style={{ width: 210 }}
                options={(Object.keys(FILTER_LABELS) as BoardFilter[]).map((value) => ({
                  value,
                  label: FILTER_LABELS[value],
                }))}
              />
            </div>
            {activeFilterTags.length ? (
              <Button size="small" onClick={() => { setSearchInput(''); setFilter('ALL'); }}>
                Xóa bộ lọc đang áp dụng
              </Button>
            ) : null}
          </Space>

          <Space wrap>
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              Kết quả hiện tại: {tasks.length}
            </Tag>
            <Tag color="default" style={{ marginInlineEnd: 0 }}>
              Tổng workspace đang mở: {overviewTasks.length}
            </Tag>
          </Space>
        </Space>

        <div
          data-testid="task-operations-command-strip"
          style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Button data-testid="task-operations-save-view" onClick={() => void saveCurrentView()} disabled={isPreferencesLoading}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="task-operations-restore-view" onClick={applySavedView} disabled={isPreferencesLoading}>
            Áp dụng chế độ đã lưu
          </Button>
          <Button
            data-testid="task-operations-open-preset-modal"
            disabled={isPreferencesLoading}
            onClick={() => {
              setViewPresetName(selectedViewPreset?.name ?? '');
              setIsViewPresetModalOpen(true);
            }}
          >
            Lưu mẫu mới
          </Button>
          <div data-testid="task-operations-preset-select" style={{ display: 'inline-block' }}>
            <Select<string>
              allowClear
              placeholder="Chọn mẫu lọc điều phối"
              value={selectedViewPresetId}
              onChange={(value) => setSelectedViewPresetId(value)}
              disabled={isPreferencesLoading}
              style={{ width: 220 }}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          </div>
          <Button data-testid="task-operations-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
            Áp dụng mẫu lọc
          </Button>
          <Button danger data-testid="task-operations-delete-preset" onClick={() => void deleteNamedPreset()} disabled={isPreferencesLoading}>
            Xóa mẫu lọc
          </Button>
        </div>

        {activeFilterTags.length ? (
          <Space wrap size={8} style={{ marginTop: 12 }}>
            {activeFilterTags.map((tag) => (
              <Tag key={tag} color="processing" style={{ marginInlineEnd: 0 }}>
                {tag}
              </Tag>
            ))}
          </Space>
        ) : null}
      </Card>

      <Card size="small">
        {tasksQuery.isLoading && !tasks.length ? (
          <div style={{ textAlign: 'center', padding: 30 }}>
            <Spin />
          </div>
        ) : tasks.length === 0 ? (
          <Empty description="Không có nhiệm vụ phù hợp với bộ lọc hiện tại" image={Empty.PRESENTED_IMAGE_SIMPLE} />
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
          placeholder="Ví dụ: Theo dõi mã hàng cần hỗ trợ"
          data-testid="task-operations-preset-name"
        />
      </Modal>

      <Suspense fallback={null}>
        <TaskWorkspaceModalLazy
          open={!!selected || !!selectedProductForTask}
          onClose={() => {
            setSelected(null);
            setSelectedProductForTask(null);
          }}
          entityType="Product"
          entityId={selectedProductForTask?.id ?? selected?.entity_id ?? null}
          entityCode={selectedProductForTask?.code ?? selected?.entity_code}
          blockingCount={selectedProductForTask?.blocking_tasks_count ?? (selected?.is_blocking ? 1 : 0)}
          titlePrefix="Điều hành nhiệm vụ"
        />
      </Suspense>

      <Drawer
        title={quickViewProduct ? `Mã hàng: ${quickViewProduct.code}` : 'Thông tin mã hàng'}
        width={640}
        open={quickViewProductId !== null}
        onClose={() => setQuickViewProductId(null)}
        destroyOnClose
      >
        {quickViewQuery.isLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : !quickViewProduct ? (
          <Empty description="Không tải được thông tin mã hàng" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 12,
              }}
            >
              <div style={SUMMARY_TILE_STYLE}>
                <div style={{ color: '#666', fontSize: 12 }}>Trạng thái</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{quickViewProduct.status}</div>
                <div style={{ color: '#8c8c8c', fontSize: 12 }}>Theo hồ sơ sản phẩm</div>
              </div>
              <div style={SUMMARY_TILE_STYLE}>
                <div style={{ color: '#666', fontSize: 12 }}>Nhiệm vụ chặn</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#cf1322' }}>
                  {quickViewProduct.blocking_tasks_count ?? 0}
                </div>
                <div style={{ color: '#8c8c8c', fontSize: 12 }}>Cần tháo gỡ trước khi phát hành</div>
              </div>
              <div style={SUMMARY_TILE_STYLE}>
                <div style={{ color: '#666', fontSize: 12 }}>Nhóm phụ trách</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{quickViewProduct.team_name || 'Chưa gán'}</div>
                <div style={{ color: '#8c8c8c', fontSize: 12 }}>Chủ sở hữu: {quickViewProduct.owner_name || 'Chưa rõ'}</div>
              </div>
              <div style={SUMMARY_TILE_STYLE}>
                <div style={{ color: '#666', fontSize: 12 }}>Cập nhật gần nhất</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{formatDateTime(quickViewProduct.updated_at)}</div>
                <div style={{ color: '#8c8c8c', fontSize: 12 }}>Theo hồ sơ mã hàng</div>
              </div>
            </div>

            {(quickViewProduct.blocking_tasks_count ?? 0) > 0 || quickViewProduct.status === 'DRAFT' ? (
              <Alert
                type="warning"
                showIcon
                message="Mã hàng này đang cần một lượt rà soát nhanh."
                description={
                  (quickViewProduct.blocking_tasks_count ?? 0) > 0
                    ? 'Đang có nhiệm vụ chặn gắn với mã hàng. Nên mở workspace để xử lý trước khi tiếp tục các bước vận hành.'
                    : 'Mã hàng vẫn ở trạng thái nháp. Nên kiểm tra lại cấu hình và tác vụ liên quan trước khi dùng cho luồng thật.'
                }
              />
            ) : null}

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

            <Space wrap>
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
                Mở workspace cho mã này
              </Button>
            </Space>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
