import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, DownloadOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { shipmentsApi } from '../../api/shipments';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';
import type { OutboundShipment, OutboundShipmentStatus, ShipmentLine } from '../../types/shipments';
import { downloadCSV } from '../../utils/csvExport';
import { PAGES } from '../../utils/constants';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import ShipmentFormModal from './ShipmentFormModal';

const { Text, Title } = Typography;

type Filters = {
  status?: OutboundShipmentStatus;
};

type ShipmentLaneFilter = 'ALL' | 'DRAFT_REVIEW' | 'READY_TO_DISPATCH' | 'IN_TRANSIT' | 'OVERDUE';

type ShipmentViewSnapshot = {
  search: string;
  status?: OutboundShipmentStatus;
  laneFilter: ShipmentLaneFilter;
};

type ShipmentNamedPreset = {
  id: string;
  name: string;
  filters: ShipmentViewSnapshot;
};

type DeliveryConfirmationPayload = {
  actual_delivery_date: string;
};

const STATUS_COLORS: Record<OutboundShipmentStatus, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'cyan',
  PACKED: 'geekblue',
  IN_TRANSIT: 'warning',
  DELIVERED: 'success',
  RETURNED: 'error',
  CANCELLED: 'magenta',
};

const STATUS_LABELS: Record<OutboundShipmentStatus, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  PACKED: 'Đã đóng gói',
  IN_TRANSIT: 'Đang vận chuyển',
  DELIVERED: 'Đã giao',
  RETURNED: 'Đã trả',
  CANCELLED: 'Đã hủy',
};

const LANE_LABELS: Record<ShipmentLaneFilter, string> = {
  ALL: 'Toàn bộ nhịp giao hàng',
  DRAFT_REVIEW: 'Rà soát nháp',
  READY_TO_DISPATCH: 'Sẵn sàng điều xe',
  IN_TRANSIT: 'Đang giao cần theo dõi',
  OVERDUE: 'Quá hẹn bàn giao',
};

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};

function formatQty(value: number | string | null | undefined): string {
  return Number(value ?? 0).toLocaleString('vi-VN');
}

function serializeFilters(filters: Filters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): Filters {
  try {
    return JSON.parse(raw) as Filters;
  } catch {
    return {};
  }
}

function parseViewSnapshot(value: unknown): ShipmentViewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  return {
    search: typeof obj.search === 'string' ? obj.search : '',
    status: typeof obj.status === 'string' ? (obj.status as OutboundShipmentStatus) : undefined,
    laneFilter:
      obj.laneFilter === 'DRAFT_REVIEW' ||
      obj.laneFilter === 'READY_TO_DISPATCH' ||
      obj.laneFilter === 'IN_TRANSIT' ||
      obj.laneFilter === 'OVERDUE'
        ? (obj.laneFilter as ShipmentLaneFilter)
        : 'ALL',
  };
}

function matchesShipmentLane(item: OutboundShipment, laneFilter: ShipmentLaneFilter): boolean {
  if (laneFilter === 'ALL') return true;
  if (laneFilter === 'DRAFT_REVIEW') return item.status === 'DRAFT';
  if (laneFilter === 'READY_TO_DISPATCH') return ['SUBMITTED', 'APPROVED', 'PACKED'].includes(item.status);
  if (laneFilter === 'IN_TRANSIT') return item.status === 'IN_TRANSIT';
  if (laneFilter === 'OVERDUE') {
    if (!item.expected_delivery_date) return false;
    if (['DELIVERED', 'CANCELLED', 'RETURNED'].includes(item.status)) return false;
    return dayjs(item.expected_delivery_date).isBefore(dayjs(), 'day');
  }
  return true;
}

export default function ShipmentList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [laneFilter, setLaneFilter] = useState<ShipmentLaneFilter>('ALL');
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editShipment, setEditShipment] = useState<OutboundShipment | null>(null);
  const [detailShipment, setDetailShipment] = useState<OutboundShipment | null>(null);
  const {
    config,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.SALES_SHIPMENTS);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord.pageSize ?? 20);

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(
    () => ({
      search: intentSearch.trim() || undefined,
      status: intentFilters.status || undefined,
      page,
      page_size: pageSize,
    }),
    [intentFilters.status, intentSearch, page, pageSize],
  );

  const shipmentsQuery = useQuery({
    queryKey: ['shipments', params],
    queryFn: () => shipmentsApi.getShipments(params),
  });

  const invalidateShipments = async () => {
    await queryClient.invalidateQueries({ queryKey: ['shipments'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => shipmentsApi.deleteShipment(id),
    onSuccess: async () => {
      await invalidateShipments();
      messageApi.success('Xóa phiếu giao hàng thành công');
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Xóa phiếu giao hàng thất bại'));
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => shipmentsApi.submitShipment(id),
    onSuccess: async () => {
      await invalidateShipments();
      messageApi.success('Gửi duyệt phiếu giao hàng thành công');
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Gửi duyệt thất bại'));
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => shipmentsApi.approveShipment(id),
    onSuccess: async () => {
      await invalidateShipments();
      messageApi.success('Duyệt phiếu giao hàng thành công');
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Duyệt thất bại'));
    },
  });

  const packMutation = useMutation({
    mutationFn: (id: number) => shipmentsApi.packShipment(id),
    onSuccess: async () => {
      await invalidateShipments();
      messageApi.success('Đóng gói phiếu giao hàng thành công');
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Đóng gói thất bại'));
    },
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => shipmentsApi.sendShipment(id),
    onSuccess: async () => {
      await invalidateShipments();
      messageApi.success('Đã chuyển phiếu sang trạng thái vận chuyển');
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Gửi chuyến giao thất bại'));
    },
  });

  const deliverMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: DeliveryConfirmationPayload }) =>
      shipmentsApi.confirmDelivery(id, data),
    onSuccess: async () => {
      await invalidateShipments();
      messageApi.success('Xác nhận giao hàng thành công');
    },
    onError: (error) => {
      messageApi.error(getToastMessage(error, 'Xác nhận giao hàng thất bại'));
    },
  });

  const rows = useMemo(() => shipmentsQuery.data?.results ?? [], [shipmentsQuery.data?.results]);

  const summary = useMemo(() => {
    const draftCount = rows.filter((item) => item.status === 'DRAFT').length;
    const pendingCount = rows.filter((item) => ['SUBMITTED', 'APPROVED', 'PACKED'].includes(item.status)).length;
    const inTransitCount = rows.filter((item) => item.status === 'IN_TRANSIT').length;
    const deliveredCount = rows.filter((item) => item.status === 'DELIVERED').length;
    const overdueCount = rows.filter((item) => {
      if (!item.expected_delivery_date) return false;
      if (['DELIVERED', 'CANCELLED', 'RETURNED'].includes(item.status)) return false;
      return dayjs(item.expected_delivery_date).isBefore(dayjs(), 'day');
    }).length;
    const totalQty = rows.reduce((total, item) => total + Number(item.total_qty ?? 0), 0);
    return {
      draftCount,
      pendingCount,
      inTransitCount,
      deliveredCount,
      overdueCount,
      totalQty,
    };
  }, [rows]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) {
      tags.push(`Tìm kiếm: ${intentSearch.trim()}`);
    }
    if (filters.status) {
      tags.push(`Trạng thái: ${STATUS_LABELS[filters.status]}`);
    }
    if (laneFilter !== 'ALL') {
      tags.push(`Làn điều phối: ${LANE_LABELS[laneFilter]}`);
    }
    return tags;
  }, [filters.status, intentSearch, laneFilter]);
  const namedPresets = useMemo<ShipmentNamedPreset[]>(() => {
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

  const statusAlert = useMemo(() => {
    if (summary.inTransitCount > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${summary.inTransitCount} phiếu đang trên đường giao. Nên ưu tiên kiểm tra bằng chứng bàn giao và ETA của khách trong ca này.`,
      };
    }
    if (summary.pendingCount > 0 || summary.draftCount > 0) {
      return {
        type: 'info' as const,
        message: `Hiện có ${summary.pendingCount} phiếu chờ xử lý và ${summary.draftCount} phiếu nháp trên bộ lọc hiện tại.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Luồng giao hàng đang ổn định, chưa có chuyến nào cần ưu tiên điều phối gấp trên bộ lọc hiện tại.',
    };
  }, [summary.draftCount, summary.inTransitCount, summary.pendingCount]);

  const handleResetFilters = () => {
    setSearchInput('');
    setFilters({});
    setLaneFilter('ALL');
    setPage(1);
    setSelectedPresetId(undefined);
  };

  const buildCurrentSnapshot = (): ShipmentViewSnapshot => ({
    search: searchInput,
    status: filters.status,
    laneFilter,
  });

  const applySnapshot = (snapshot: ShipmentViewSnapshot) => {
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
      messageApi.success('Đã lưu chế độ xem giao hàng.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem giao hàng.');
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
    const nextPreset: ShipmentNamedPreset = existing
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

  const handleExportCSV = () => {
    if (visibleRows.length === 0) return;
    const exportRows = visibleRows.map((item) => ({
      'Mã phiếu': item.code || '',
      'Khách hàng': item.customer_name || '',
      'Ngày giao': dayjs(item.shipment_date).format('DD/MM/YYYY'),
      'Trạng thái': STATUS_LABELS[item.status],
      'SL': formatQty(item.total_qty),
      'Dự kiến giao': item.expected_delivery_date ? dayjs(item.expected_delivery_date).format('DD/MM/YYYY') : '',
      'Mã vận chuyển': item.tracking_number || '',
      'Ghi chú': item.notes || '',
    }));
    downloadCSV(exportRows, 'dieu-phoi-giao-hang');
  };

  const columns: ColumnsType<OutboundShipment> = [
    {
      title: 'Mã phiếu',
      dataIndex: 'code',
      width: 150,
      sorter: (a, b) => (a.code || '').localeCompare(b.code || ''),
    },
    {
      title: 'Khách hàng',
      dataIndex: 'customer_name',
      width: 220,
      render: (value: string | undefined) => value || '-',
    },
    {
      title: 'Ngày giao',
      dataIndex: 'shipment_date',
      width: 120,
      render: (value: string) => dayjs(value).format('DD/MM/YYYY'),
    },
    {
      title: 'Dự kiến giao',
      dataIndex: 'expected_delivery_date',
      width: 120,
      render: (value: string | undefined) => (value ? dayjs(value).format('DD/MM/YYYY') : '-'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 150,
      render: (value: OutboundShipmentStatus) => <Tag color={STATUS_COLORS[value]}>{STATUS_LABELS[value]}</Tag>,
    },
    {
      title: 'SL',
      dataIndex: 'total_qty',
      width: 90,
      align: 'right',
      render: (value: number) => formatQty(value),
    },
    {
      title: 'Vận chuyển',
      width: 220,
      render: (_, row) => {
        const parts = [row.carrier, row.tracking_number].filter(Boolean);
        return parts.length > 0 ? parts.join(' / ') : '-';
      },
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 430,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailShipment(row)}>
            Xem
          </Button>
          <Button
            data-testid={`shipment-edit-${row.id}`}
            size="small"
            disabled={row.status !== 'DRAFT'}
            onClick={() => {
              setEditShipment(row);
              setFormOpen(true);
            }}
          >
            Sửa
          </Button>
          <Button
            data-testid={`shipment-delete-${row.id}`}
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={row.status !== 'DRAFT'}
            onClick={() => {
              Modal.confirm({
                title: 'Xóa phiếu giao hàng',
                content: `Bạn chắc chắn muốn xóa phiếu ${row.code}?`,
                okText: 'Xóa',
                cancelText: 'Hủy',
                okButtonProps: { danger: true },
                onOk: () => deleteMutation.mutate(row.id!),
              });
            }}
          >
            Xóa
          </Button>
          <Button
            data-testid={`shipment-submit-${row.id}`}
            size="small"
            disabled={row.status !== 'DRAFT'}
            onClick={() => submitMutation.mutate(row.id!)}
          >
            Gửi duyệt
          </Button>
          <Button
            data-testid={`shipment-approve-${row.id}`}
            size="small"
            type="primary"
            disabled={row.status !== 'SUBMITTED'}
            onClick={() => approveMutation.mutate(row.id!)}
          >
            Duyệt
          </Button>
          <Button
            data-testid={`shipment-pack-${row.id}`}
            size="small"
            disabled={row.status !== 'APPROVED'}
            onClick={() => packMutation.mutate(row.id!)}
          >
            Đóng gói
          </Button>
          <Button
            data-testid={`shipment-send-${row.id}`}
            size="small"
            disabled={row.status !== 'PACKED'}
            onClick={() => sendMutation.mutate(row.id!)}
          >
            Giao chuyến
          </Button>
          <Button
            data-testid={`shipment-deliver-${row.id}`}
            size="small"
            type="primary"
            disabled={row.status !== 'IN_TRANSIT'}
            onClick={() => {
              Modal.confirm({
                title: 'Xác nhận giao hàng',
                content: `Xác nhận đã giao phiếu ${row.code}?`,
                okText: 'Xác nhận',
                cancelText: 'Đóng',
                onOk: () =>
                  deliverMutation.mutate({
                    id: row.id!,
                    data: { actual_delivery_date: dayjs().format('YYYY-MM-DD') },
                  }),
              });
            }}
          >
            Hoàn tất giao
          </Button>
        </Space>
      ),
    },
  ];

  const visibleRows = rows.filter((item) => matchesShipmentLane(item, laneFilter));

  const laneTiles = useMemo(
    () => [
      { key: 'ALL' as const, count: rows.length },
      { key: 'DRAFT_REVIEW' as const, count: summary.draftCount },
      { key: 'READY_TO_DISPATCH' as const, count: summary.pendingCount },
      { key: 'IN_TRANSIT' as const, count: summary.inTransitCount },
      { key: 'OVERDUE' as const, count: summary.overdueCount },
    ],
    [rows.length, summary.draftCount, summary.inTransitCount, summary.overdueCount, summary.pendingCount],
  );

  const detailColumns: ColumnsType<ShipmentLine> = [
    {
      title: 'Sản phẩm',
      width: 260,
      render: (_, row) => [row.product_code, row.product_name].filter(Boolean).join(' - ') || '-',
    },
    {
      title: 'SL gửi',
      dataIndex: 'qty_shipped',
      width: 120,
      align: 'right',
      render: (value: number) => formatQty(value),
    },
    {
      title: 'SL nhận',
      dataIndex: 'qty_received',
      width: 120,
      align: 'right',
      render: (value: number | undefined) => formatQty(value ?? 0),
    },
    {
      title: 'Đơn giá',
      dataIndex: 'unit_price',
      width: 140,
      align: 'right',
      render: (value: number) => Number(value ?? 0).toLocaleString('vi-VN'),
    },
  ];

  if (shipmentsQuery.isLoading && !shipmentsQuery.data) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}

      <Card bordered={false} style={{ borderRadius: 20 }} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 16 } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <Space wrap>
              <Tag color="blue">Sales</Tag>
              <Tag color="gold">Fulfillment</Tag>
              <Tag color="processing">Last-mile</Tag>
            </Space>
            <Title level={3} style={{ margin: '8px 0 4px' }}>
              Trung tâm điều phối giao hàng
            </Title>
            <Text type="secondary">
              Theo dõi toàn bộ phiếu giao, ưu tiên các chuyến đang chờ xử lý hoặc đang vận chuyển,
              và khóa nhanh thao tác duyệt, đóng gói, bàn giao từ cùng một workspace.
            </Text>
          </div>
          <Space wrap>
            <Button icon={<DownloadOutlined />} disabled={rows.length === 0} onClick={handleExportCSV}>
              Xuất CSV
            </Button>
            <Button
              data-testid="shipments-open-create"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditShipment(null);
                setFormOpen(true);
              }}
            >
              Tạo phiếu giao hàng
            </Button>
            {selectedPreset ? (
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                Mẫu đang dùng: {selectedPreset.name}
              </Tag>
            ) : null}
          </Space>
        </div>

        <Alert showIcon type={statusAlert.type} message={statusAlert.message} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Phiếu nháp" value={summary.draftCount} suffix="phiếu" />
          </div>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Chờ xử lý" value={summary.pendingCount} suffix="phiếu" valueStyle={{ color: summary.pendingCount > 0 ? '#1677ff' : undefined }} />
          </div>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Đang vận chuyển" value={summary.inTransitCount} suffix="phiếu" valueStyle={{ color: summary.inTransitCount > 0 ? '#d48806' : undefined }} />
          </div>
          <div style={SUMMARY_TILE_STYLE}>
            <Statistic title="Đã giao" value={summary.deliveredCount} suffix="phiếu" valueStyle={{ color: summary.deliveredCount > 0 ? '#389e0d' : undefined }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {laneTiles.map((lane) => (
            <Button
              key={lane.key}
              data-testid={`shipments-lane-${lane.key.toLowerCase().replaceAll('_', '-')}`}
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

      <Card bordered={false} style={{ borderRadius: 18 }} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div data-testid="shipments-search" style={{ display: 'inline-block' }}>
            <Input
              placeholder="Tìm kiếm mã phiếu, khách hàng..."
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              style={{ width: 280 }}
              suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
            />
          </div>
          <div data-testid="shipments-status-filter" style={{ display: 'inline-block' }}>
            <Select
              placeholder="Trạng thái"
              value={filters.status}
              onChange={(value) => {
                setFilters({ status: value });
                setPage(1);
              }}
              allowClear
              style={{ width: 220 }}
              options={Object.entries(STATUS_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </div>
          <Button onClick={handleResetFilters}>Xóa bộ lọc</Button>
        </div>
        <div
          data-testid="shipments-command-strip"
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Button data-testid="shipments-save-view" onClick={() => void saveCurrentView()} disabled={isPreferencesLoading}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="shipments-restore-view" onClick={applySavedView} disabled={isPreferencesLoading}>
            Áp dụng chế độ đã lưu
          </Button>
          <Button
            data-testid="shipments-open-preset-modal"
            onClick={() => {
              setPresetName(selectedPreset?.name ?? '');
              setIsPresetModalOpen(true);
            }}
            disabled={isPreferencesLoading}
          >
            Lưu mẫu mới
          </Button>
          <div data-testid="shipments-preset-select" style={{ display: 'inline-block' }}>
            <Select<string>
              allowClear
              placeholder="Chọn mẫu giao hàng"
              value={selectedPresetId}
              onChange={(value) => setSelectedPresetId(value)}
              disabled={isPreferencesLoading}
              style={{ width: 220 }}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          </div>
          <Button data-testid="shipments-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
            Áp dụng mẫu lọc
          </Button>
          <Button danger data-testid="shipments-delete-preset" onClick={() => void deleteNamedPreset()} disabled={isPreferencesLoading}>
            Xóa mẫu lọc
          </Button>
          {savedViewSnapshot ? <Tag color="default">Có chế độ xem đã lưu</Tag> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {commandContextTags.length > 0 ? commandContextTags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Text type="secondary">Đang hiển thị toàn bộ phiếu giao hàng.</Text>}
          <Tag color="warning">{`Quá hạn giao: ${visibleRows.filter((item) => matchesShipmentLane(item, 'OVERDUE')).length}`}</Tag>
          <Tag color="blue">{`Tổng SL trên trang: ${formatQty(visibleRows.reduce((total, item) => total + Number(item.total_qty ?? 0), 0))}`}</Tag>
        </div>
      </Card>

      <Table
        columns={columns}
        dataSource={visibleRows}
        loading={shipmentsQuery.isLoading}
        rowKey="id"
        scroll={{ x: 1750 }}
        pagination={{
          current: page,
          pageSize,
          total: shipmentsQuery.data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: async (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              await saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize });
            }
          },
        }}
        locale={{
          emptyText:
            visibleRows.length === 0 && !shipmentsQuery.isLoading ? (
              <div style={{ padding: 40 }}>
                {activeFilterTags.length > 0 ? (
                  <>
                    <Empty description="Không tìm thấy phiếu giao phù hợp." />
                    <Button type="link" onClick={handleResetFilters}>
                      Xóa bộ lọc
                    </Button>
                  </>
                ) : (
                  <Empty description="Chưa có phiếu giao hàng nào." />
                )}
              </div>
            ) : undefined,
        }}
      />

      <Modal
        title="Lưu mẫu lọc giao hàng"
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
          data-testid="shipments-preset-name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Ví dụ: Chờ duyệt / Đang vận chuyển / Cần kiểm ETA"
          maxLength={80}
          autoFocus
        />
      </Modal>

      {formOpen ? (
        <ShipmentFormModal
          key={editShipment?.id ?? 'new'}
          open={formOpen}
          onClose={() => {
            setFormOpen(false);
            setEditShipment(null);
          }}
          shipment={editShipment}
          onSuccess={() => {
            setFormOpen(false);
            setEditShipment(null);
            void invalidateShipments();
          }}
        />
      ) : null}

      <Modal
        title={detailShipment ? `Chi tiết phiếu giao hàng - ${detailShipment.code}` : 'Chi tiết phiếu giao hàng'}
        open={Boolean(detailShipment)}
        onCancel={() => setDetailShipment(null)}
        footer={null}
        width={980}
      >
        {detailShipment ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <Card size="small" style={SUMMARY_TILE_STYLE}>
                <Statistic title="Tổng dòng" value={detailShipment.lines?.length ?? 0} />
              </Card>
              <Card size="small" style={SUMMARY_TILE_STYLE}>
                <Statistic title="Tổng SL" value={Number(detailShipment.total_qty ?? 0)} precision={0} />
              </Card>
              <Card size="small" style={SUMMARY_TILE_STYLE}>
                <Statistic title="Ngày giao" value={dayjs(detailShipment.shipment_date).format('DD/MM/YYYY')} />
              </Card>
              <Card size="small" style={SUMMARY_TILE_STYLE}>
                <Statistic title="Trạng thái" value={STATUS_LABELS[detailShipment.status]} />
              </Card>
            </div>

            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                {
                  key: 'customer',
                  label: 'Khách hàng',
                  children: detailShipment.customer_name || '-',
                },
                {
                  key: 'reference',
                  label: 'Tham chiếu',
                  children: detailShipment.reference || '-',
                },
                {
                  key: 'expected',
                  label: 'Dự kiến giao',
                  children: detailShipment.expected_delivery_date
                    ? dayjs(detailShipment.expected_delivery_date).format('DD/MM/YYYY')
                    : '-',
                },
                {
                  key: 'actual',
                  label: 'Thực giao',
                  children: detailShipment.actual_delivery_date
                    ? dayjs(detailShipment.actual_delivery_date).format('DD/MM/YYYY')
                    : '-',
                },
                {
                  key: 'carrier',
                  label: 'Vận chuyển',
                  children: [detailShipment.carrier, detailShipment.tracking_number].filter(Boolean).join(' / ') || '-',
                },
                {
                  key: 'status',
                  label: 'Trạng thái',
                  children: <Tag color={STATUS_COLORS[detailShipment.status]}>{STATUS_LABELS[detailShipment.status]}</Tag>,
                },
                {
                  key: 'address',
                  label: 'Địa chỉ giao',
                  children: detailShipment.shipping_address || '-',
                },
                {
                  key: 'note',
                  label: 'Ghi chú',
                  children: detailShipment.notes || '-',
                },
              ]}
            />

            <Card size="small" title="Dòng hàng giao">
              <Table
                columns={detailColumns}
                dataSource={detailShipment.lines ?? []}
                pagination={false}
                rowKey={(record, index) => record.id ?? `${record.line_number}-${index ?? 0}`}
                scroll={{ x: 760 }}
                locale={{ emptyText: 'Phiếu giao chưa có dòng hàng.' }}
              />
            </Card>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
