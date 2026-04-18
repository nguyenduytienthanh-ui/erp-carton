import { useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Select, Space, Statistic, Table, Tag, Typography, message, Skeleton } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, DownloadOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/inventory';
import type { WarehouseTransfer, WarehouseTransferStatus } from '../../types/inventory';
import { PAGES } from '../../utils/constants';
import { canManageInventoryData } from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';
import WarehouseTransferFormModal from './WarehouseTransferFormModal';

type Filters = {
  status?: string;
};

type WarehouseTransferLaneFilter = 'ALL' | 'DRAFT_REVIEW' | 'READY_TO_POST' | 'IN_TRANSIT' | 'RECEIVED_TODAY';

type WarehouseTransferViewSnapshot = {
  search: string;
  status?: string;
  laneFilter: WarehouseTransferLaneFilter;
};

type WarehouseTransferNamedPreset = {
  id: string;
  name: string;
  filters: WarehouseTransferViewSnapshot;
};

const STATUS_LABELS: Record<WarehouseTransferStatus, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ xác nhận',
  IN_TRANSIT: 'Đang vận chuyển',
  RECEIVED: 'Đã nhận',
  CANCELLED: 'Đã hủy',
};

const STATUS_COLORS: Record<WarehouseTransferStatus, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  IN_TRANSIT: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'magenta',
};

const LANE_LABELS: Record<WarehouseTransferLaneFilter, string> = {
  ALL: 'Toàn bộ nhịp chuyển kho',
  DRAFT_REVIEW: 'Rà soát nháp',
  READY_TO_POST: 'Chờ xuất kho',
  IN_TRANSIT: 'Đang luân chuyển',
  RECEIVED_TODAY: 'Đã nhập đích hôm nay',
};

const { Text, Title } = Typography;

const SUMMARY_TILE_STYLE = {
  height: '100%',
  borderRadius: 14,
};

function getStatusLabel(status: WarehouseTransferStatus | string | null | undefined): string {
  if (!status) return '-';
  return STATUS_LABELS[status as WarehouseTransferStatus] ?? status;
}

function getStatusColor(status: WarehouseTransferStatus | string | null | undefined): string {
  if (!status) return 'default';
  return STATUS_COLORS[status as WarehouseTransferStatus] ?? 'default';
}

function parseViewSnapshot(value: unknown): WarehouseTransferViewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  return {
    search: typeof obj.search === 'string' ? obj.search : '',
    status: typeof obj.status === 'string' ? obj.status : undefined,
    laneFilter:
      obj.laneFilter === 'DRAFT_REVIEW' ||
      obj.laneFilter === 'READY_TO_POST' ||
      obj.laneFilter === 'IN_TRANSIT' ||
      obj.laneFilter === 'RECEIVED_TODAY'
        ? (obj.laneFilter as WarehouseTransferLaneFilter)
        : 'ALL',
  };
}

function matchesTransferLane(item: WarehouseTransfer, laneFilter: WarehouseTransferLaneFilter): boolean {
  if (laneFilter === 'ALL') return true;
  if (laneFilter === 'DRAFT_REVIEW') return item.status === 'DRAFT';
  if (laneFilter === 'READY_TO_POST') return item.status === 'SUBMITTED';
  if (laneFilter === 'IN_TRANSIT') return item.status === 'IN_TRANSIT';
  if (laneFilter === 'RECEIVED_TODAY') return Boolean(item.received_at && dayjs(item.received_at).isSame(dayjs(), 'day'));
  return true;
}

export default function WarehouseTransferList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [laneFilter, setLaneFilter] = useState<WarehouseTransferLaneFilter>('ALL');
  const [page, setPage] = useState(1);
  const [detailTransfer, setDetailTransfer] = useState<WarehouseTransfer | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editTransfer, setEditTransfer] = useState<WarehouseTransfer | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const {
    config,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.INVENTORY_WAREHOUSE_TRANSFERS);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord.pageSize ?? 20);
  const canManage = canManageInventoryData();

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (value) => JSON.stringify(value),
    parseFilters: (value) => {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    },
  });

  const params = {
    page,
    page_size: pageSize,
    search: intentSearch.trim() || undefined,
    status: intentFilters?.status || undefined,
  };

  const transfersQuery = useQuery({
    queryKey: ['inventory-warehouse-transfers', params],
    queryFn: () => inventoryApi.getWarehouseTransfers(params),
  });

  const detailQuery = useQuery({
    queryKey: ['inventory-warehouse-transfer', detailTransfer?.id],
    queryFn: () => inventoryApi.getWarehouseTransfer(detailTransfer!.id),
    enabled: !!detailTransfer?.id,
  });

  const deleteMutation = useMutation({
    mutationFn: inventoryApi.deleteWarehouseTransfer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfers'] });
      messageApi.success('Đã xóa phiếu chuyển kho');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: inventoryApi.submitTransfer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfers'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfer'] });
      messageApi.success('Đã gửi phiếu chuyển');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const postMutation = useMutation({
    mutationFn: inventoryApi.postTransfer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfers'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfer'] });
      messageApi.success('Đã xuất kho chuyển');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const receiveMutation = useMutation({
    mutationFn: inventoryApi.receiveTransfer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfers'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-warehouse-transfer'] });
      messageApi.success('Đã nhận phiếu chuyển');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = useMemo(() => transfersQuery.data?.results ?? [], [transfersQuery.data?.results]);

  const summary = useMemo(() => {
    const draftCount = rows.filter((item) => item.status === 'DRAFT').length;
    const inTransitCount = rows.filter((item) => item.status === 'IN_TRANSIT').length;
    const completedCount = rows.filter((item) => item.status === 'RECEIVED').length;
    const completedTodayCount = rows.filter((item) => item.received_at && dayjs(item.received_at).isSame(dayjs(), 'day')).length;
    const lineCount = rows.reduce((total, item) => total + (item.lines?.length ?? 0), 0);
    return {
      draftCount,
      inTransitCount,
      completedCount,
      completedTodayCount,
      lineCount,
    };
  }, [rows]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) {
      tags.push(`Tìm kiếm: ${intentSearch.trim()}`);
    }
    if (filters.status) {
      tags.push(`Trạng thái: ${STATUS_LABELS[filters.status as WarehouseTransferStatus] ?? filters.status}`);
    }
    if (laneFilter !== 'ALL') {
      tags.push(`Làn điều phối: ${LANE_LABELS[laneFilter]}`);
    }
    return tags;
  }, [filters.status, intentSearch, laneFilter]);
  const namedPresets = useMemo<WarehouseTransferNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const obj = value as Record<string, unknown>;
      if (typeof obj.id !== 'string' || typeof obj.name !== 'string') return [];
      const filtersValue = parseViewSnapshot(obj.filters);
      if (!filtersValue) return [];
      return [{ id: obj.id, name: obj.name, filters: filtersValue }];
    });
  }, [configRecord.saved_views]);
  const selectedPreset = useMemo(
    () => namedPresets.find((preset) => preset.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );
  const savedViewSnapshot = useMemo(() => {
    const directSnapshot = parseViewSnapshot(configRecord.saved_view_snapshot);
    if (directSnapshot) return directSnapshot;
    return parseViewSnapshot({
      search: configRecord.search,
      status: configRecord.status,
      laneFilter: configRecord.laneFilter,
    });
  }, [configRecord.laneFilter, configRecord.saved_view_snapshot, configRecord.search, configRecord.status]);
  const commandContextTags = useMemo(() => {
    if (!selectedPreset) return activeFilterTags;
    return [...activeFilterTags, `Mẫu đang dùng: ${selectedPreset.name}`];
  }, [activeFilterTags, selectedPreset]);

  const buildCurrentSnapshot = (): WarehouseTransferViewSnapshot => ({
    search: searchInput,
    status: filters.status,
    laneFilter,
  });

  const applySnapshot = (snapshot: WarehouseTransferViewSnapshot) => {
    setSearchInput(snapshot.search);
    setFilters({ status: snapshot.status });
    setLaneFilter(snapshot.laneFilter);
    setPage(1);
  };

  const saveCurrentView = async () => {
    const currentSnapshot = buildCurrentSnapshot();
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem chuyển kho.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem chuyển kho.');
    }
  };

  const applySavedView = () => {
    if (!savedViewSnapshot) {
      messageApi.warning('Chưa có chế độ xem đã lưu.');
      return;
    }
    applySnapshot(savedViewSnapshot);
    messageApi.success('Đã áp dụng chế độ xem đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    const nextPreset: WarehouseTransferNamedPreset = existing
      ? { ...existing, name, filters: currentSnapshot }
      : { id: `${Date.now()}`, name, filters: currentSnapshot };
    const nextPresets = existing
      ? namedPresets.map((preset) => (preset.id === existing.id ? nextPreset : preset))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedPresetId(nextPreset.id);
      setPresetName('');
      setIsPresetModalOpen(false);
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc.' : 'Đã lưu mẫu lọc mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc.');
    }
  };

  const applyNamedPreset = () => {
    if (!selectedPreset) {
      messageApi.warning('Vui lòng chọn mẫu lọc.');
      return;
    }
    applySnapshot(selectedPreset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${selectedPreset.name}".`);
  };

  const deleteNamedPreset = async () => {
    if (!selectedPreset) {
      messageApi.warning('Vui lòng chọn mẫu lọc để xóa.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const nextPresets = namedPresets.filter((preset) => preset.id !== selectedPreset.id);
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedPresetId(undefined);
      messageApi.success(`Đã xóa mẫu lọc "${selectedPreset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc.');
    }
  };

  const statusAlert = useMemo(() => {
    if (summary.inTransitCount > 0) {
      return {
        type: 'warning' as const,
        message: `${summary.inTransitCount} phiếu đang trên đường về kho đích, nên theo dõi sát để tránh chậm nhập.`,
      };
    }
    if (summary.draftCount > 0) {
      return {
        type: 'info' as const,
        message: `${summary.draftCount} phiếu vẫn ở trạng thái nháp, có thể rà soát để gửi xác nhận trong ca này.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Luồng chuyển kho đang ổn định, chưa có phiếu cần ưu tiên xử lý ngay trên trang hiện tại.',
    };
  }, [summary.draftCount, summary.inTransitCount]);

  const columns: ColumnsType<WarehouseTransfer> = [
    { title: 'Mã chuyển', dataIndex: 'code', width: 150, key: 'code' },
    { title: 'Ngày chuyển', dataIndex: 'transfer_date', width: 120, key: 'transfer_date' },
    {
      title: 'Từ kho',
      dataIndex: 'from_warehouse_code',
      width: 140,
      key: 'from_warehouse',
    },
    {
      title: 'Đến kho',
      dataIndex: 'to_warehouse_code',
      width: 140,
      key: 'to_warehouse',
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 150,
      render: (status: WarehouseTransferStatus) => <Tag color={getStatusColor(status)}>{getStatusLabel(status)}</Tag>,
    },
    {
      title: 'Thao tác',
      width: 360,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailTransfer(row)}>
            Xem
          </Button>
          <Button
            data-testid={`warehouse-transfer-edit-${row.id}`}
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            onClick={() => {
              setEditTransfer(row);
              setFormOpen(true);
            }}
          >
            Sửa
          </Button>
          <Button
            data-testid={`warehouse-transfer-delete-${row.id}`}
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            danger
            icon={<DeleteOutlined />}
            onClick={() =>
              Modal.confirm({
                title: 'Xóa phiếu chuyển',
                content: `Xóa ${row.code}?`,
                okText: 'Xóa',
                cancelText: 'Hủy',
                onOk: () => deleteMutation.mutate(row.id),
              })
            }
          />
          <Button
            data-testid={`warehouse-transfer-submit-${row.id}`}
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            onClick={() => submitMutation.mutate(row.id)}
          >
            Gửi xác nhận
          </Button>
          <Button
            data-testid={`warehouse-transfer-post-${row.id}`}
            size="small"
            disabled={!canManage || row.status !== 'SUBMITTED'}
            onClick={() => postMutation.mutate(row.id)}
          >
            Xuất kho
          </Button>
          <Button
            data-testid={`warehouse-transfer-receive-${row.id}`}
            size="small"
            disabled={!canManage || row.status !== 'IN_TRANSIT'}
            type="primary"
            onClick={() => receiveMutation.mutate(row.id)}
          >
            Nhận hàng
          </Button>
        </Space>
      ),
    },
  ];

  const visibleRows = useMemo(
    () => rows.filter((item) => matchesTransferLane(item, laneFilter)),
    [laneFilter, rows],
  );

  const laneTiles = useMemo(
    () => [
      { key: 'ALL' as const, count: rows.length },
      { key: 'DRAFT_REVIEW' as const, count: summary.draftCount },
      { key: 'READY_TO_POST' as const, count: rows.filter((item) => item.status === 'SUBMITTED').length },
      { key: 'IN_TRANSIT' as const, count: summary.inTransitCount },
      { key: 'RECEIVED_TODAY' as const, count: summary.completedTodayCount },
    ],
    [rows, summary.completedTodayCount, summary.draftCount, summary.inTransitCount],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <Card
        bordered={false}
        style={{ borderRadius: 20 }}
        styles={{ body: { display: 'flex', flexDirection: 'column', gap: 16 } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Title level={3} style={{ margin: 0 }}>
              Trung tâm chuyển kho
            </Title>
            <Text type="secondary">
              Theo dõi luồng điều chuyển giữa các kho, nhận diện phiếu đang chờ xác nhận và các lệnh cần nhập đích trong ngày.
            </Text>
          </div>
          <Space wrap>
            <Button
              icon={<DownloadOutlined />}
              disabled={visibleRows.length === 0}
              onClick={() => {
                const exportData = visibleRows.map((item) => ({
                  'Mã chuyển': item.code,
                  Ngày: item.transfer_date,
                  'Từ kho': item.from_warehouse_code,
                  'Đến kho': item.to_warehouse_code,
                  'Trạng thái': getStatusLabel(item.status),
                }));
                downloadCSV(exportData, 'phieu-chuyen-kho');
              }}
            >
              Xuất CSV
            </Button>
            <Button
              data-testid="warehouse-transfers-open-create"
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canManage}
              onClick={() => {
                setEditTransfer(null);
                setFormOpen(true);
              }}
            >
              Tạo phiếu chuyển
            </Button>
            {selectedPreset ? (
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                Mẫu đang dùng: {selectedPreset.name}
              </Tag>
            ) : null}
          </Space>
        </div>

        <Alert showIcon type={statusAlert.type} message={statusAlert.message} />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Phiếu nháp" value={summary.draftCount} />
          </Card>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Đang vận chuyển" value={summary.inTransitCount} valueStyle={{ color: '#d48806' }} />
          </Card>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Đã nhận" value={summary.completedCount} valueStyle={{ color: '#389e0d' }} />
          </Card>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Nhập đích hôm nay" value={summary.completedTodayCount} />
          </Card>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {laneTiles.map((lane) => (
            <Button
              key={lane.key}
              data-testid={`warehouse-transfers-lane-${lane.key.toLowerCase().replaceAll('_', '-')}`}
              type={laneFilter === lane.key ? 'primary' : 'default'}
              onClick={() => {
                setLaneFilter(lane.key);
                setPage(1);
              }}
            >
              {LANE_LABELS[lane.key]} · {lane.count}
            </Button>
          ))}
        </div>
      </Card>

      <Card
        bordered={false}
        style={{ borderRadius: 18 }}
        styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div data-testid="warehouse-transfers-search" style={{ display: 'inline-block' }}>
            <Input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              placeholder="Tìm mã chuyển..."
              style={{ width: 260 }}
              suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
            />
          </div>
          <div data-testid="warehouse-transfers-status-filter" style={{ display: 'inline-block' }}>
            <Select
              style={{ width: 220 }}
              placeholder="Trạng thái"
              allowClear
              value={filters.status || undefined}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, status: value }));
                setPage(1);
              }}
              options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </div>
          <Button
            onClick={() => {
              setSearchInput('');
              setFilters({});
              setLaneFilter('ALL');
              setPage(1);
              setSelectedPresetId(undefined);
            }}
          >
            Xóa bộ lọc
          </Button>
        </div>
        <div
          data-testid="warehouse-transfers-command-strip"
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Button data-testid="warehouse-transfers-save-view" onClick={() => void saveCurrentView()} disabled={isPreferencesLoading}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="warehouse-transfers-restore-view" onClick={applySavedView} disabled={isPreferencesLoading}>
            Áp dụng chế độ đã lưu
          </Button>
          <Button
            data-testid="warehouse-transfers-open-preset-modal"
            onClick={() => {
              setPresetName(selectedPreset?.name ?? '');
              setIsPresetModalOpen(true);
            }}
            disabled={isPreferencesLoading}
          >
            Lưu mẫu mới
          </Button>
          <div data-testid="warehouse-transfers-preset-select" style={{ display: 'inline-block' }}>
            <Select<string>
              allowClear
              placeholder="Chọn mẫu chuyển kho"
              value={selectedPresetId}
              onChange={(value) => setSelectedPresetId(value)}
              disabled={isPreferencesLoading}
              style={{ width: 220 }}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          </div>
          <Button data-testid="warehouse-transfers-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
            Áp dụng mẫu lọc
          </Button>
          <Button
            danger
            data-testid="warehouse-transfers-delete-preset"
            onClick={() => void deleteNamedPreset()}
            disabled={isPreferencesLoading}
          >
            Xóa mẫu lọc
          </Button>
          {savedViewSnapshot ? <Tag color="default">Có chế độ xem đã lưu</Tag> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {commandContextTags.length > 0 ? (
            commandContextTags.map((tag) => <Tag key={tag}>{tag}</Tag>)
          ) : (
            <Tag color="default">Đang xem toàn bộ lệnh chuyển kho</Tag>
          )}
          <Tag color="blue">Dòng chi tiết hiện có: {visibleRows.reduce((total, item) => total + (item.lines?.length ?? 0), 0)}</Tag>
        </div>
      </Card>

      <Table
        rowKey="id"
        loading={transfersQuery.isLoading}
        columns={columns}
        dataSource={visibleRows}
        scroll={{ x: 1500 }}
        pagination={{
          current: page,
          pageSize,
          total: transfersQuery.data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              void saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize });
            }
          },
        }}
        locale={{
          emptyText: visibleRows.length === 0 && !transfersQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {(intentSearch || filters.status || laneFilter !== 'ALL') ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy phiếu chuyển phù hợp.</div>
                  <Button
                    type="link"
                    onClick={() => {
                      setSearchInput('');
                      setFilters({});
                      setLaneFilter('ALL');
                      setPage(1);
                    }}
                  >
                    Xóa bộ lọc
                  </Button>
                </div>
              ) : 'Chưa có phiếu chuyển kho.'}
            </div>
          ) : undefined,
        }}
      />

      <Modal
        title="Lưu mẫu lọc chuyển kho"
        open={isPresetModalOpen}
        onCancel={() => {
          setIsPresetModalOpen(false);
          setPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Hủy"
      >
        <Input
          data-testid="warehouse-transfers-preset-name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Ví dụ: Chờ nhận hàng / Cần xuất kho"
          maxLength={80}
          autoFocus
        />
      </Modal>

      {detailTransfer && (
        <Modal
          title={`Chi tiết chuyển kho - ${detailTransfer.code}`}
          open={Boolean(detailTransfer)}
          onCancel={() => setDetailTransfer(null)}
          width={900}
          footer={null}
        >
          {detailQuery.isLoading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : detailQuery.error ? (
            <div style={{ color: '#ff4d4f', padding: 16, textAlign: 'center' }}>Lỗi: Không thể tải chi tiết phiếu chuyển</div>
          ) : detailQuery.data ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <strong>Ngày chuyển:</strong> {detailQuery.data.transfer_date}
                </div>
                <div>
                  <strong>Từ kho:</strong> {detailQuery.data.from_warehouse_code}
                </div>
                <div>
                  <strong>Đến kho:</strong> {detailQuery.data.to_warehouse_code}
                </div>
                <div>
                  <strong>Trạng thái:</strong>{' '}
                  <Tag color={getStatusColor(detailQuery.data.status)}>{getStatusLabel(detailQuery.data.status)}</Tag>
                </div>
                {detailQuery.data.reference && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <strong>Tham chiếu:</strong> {detailQuery.data.reference}
                  </div>
                )}
                {detailQuery.data.note && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <strong>Ghi chú:</strong> {detailQuery.data.note}
                  </div>
                )}
              </div>
              {detailQuery.data.lines && (
                <Table
                  style={{ marginTop: 16 }}
                  rowKey="id"
                  columns={[
                    { title: 'Sản phẩm', dataIndex: 'product_name', width: 220 },
                    { title: 'Mã', dataIndex: 'product_code', width: 120 },
                    { title: 'Số lượng', dataIndex: 'qty', width: 120 },
                    { title: 'Đã nhận', dataIndex: 'received_qty', width: 120 },
                  ]}
                  dataSource={detailQuery.data.lines}
                  pagination={false}
                />
              )}
            </>
          ) : null}
        </Modal>
      )}

      <WarehouseTransferFormModal
        open={formOpen}
        data={editTransfer}
        onClose={() => {
          setFormOpen(false);
          setEditTransfer(null);
        }}
        onSuccess={() => setPage(1)}
      />
    </div>
  );
}
