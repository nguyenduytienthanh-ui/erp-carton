import { useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Form, Input, Modal, Select, Space, Statistic, Table, Tag, Typography, message, Skeleton } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, EyeOutlined, InboxOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productionApi } from '../../api/production';
import { inventoryApi } from '../../api/inventory';
import type {
  ProductionApprovalHistoryItem,
  ProductionOrder,
  ProductionReceipt,
  ProductionReceiptStatus,
} from '../../types/production';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { PAGES } from '../../utils/constants';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';

type Filters = { status?: ProductionReceiptStatus; production_order?: number };
type ProductionReceiptLaneFilter = 'ALL' | 'POSTED_TODAY' | 'THIS_MONTH' | 'CANCELLED_REVIEW' | 'HIGH_OUTPUT';
type ProductionReceiptViewSnapshot = {
  search_input: string;
  status: ProductionReceiptStatus | '';
  production_order: number | null;
  laneFilter: ProductionReceiptLaneFilter;
};
type ProductionReceiptNamedPreset = {
  id: string;
  name: string;
  filters: ProductionReceiptViewSnapshot;
};
type ReceiptFormValues = { production_order: number; receipt_date: string; warehouse?: number | null; location?: number | null; reference?: string; reason?: string; note?: string };
type CancelFormValues = { reason: string };

const { Text, Title } = Typography;
const STATUS_LABELS: Record<ProductionReceiptStatus, string> = { POSTED: 'Đã ghi nhận', CANCELLED: 'Đã hủy' };
const STATUS_COLORS: Record<ProductionReceiptStatus, string> = { POSTED: 'green', CANCELLED: 'red' };
const TILE_STYLE = { height: '100%', borderRadius: 14 };
const LANE_LABELS: Record<ProductionReceiptLaneFilter, string> = {
  ALL: 'Toàn bộ chứng từ',
  POSTED_TODAY: 'Nhập hôm nay',
  THIS_MONTH: 'Theo dõi tháng này',
  CANCELLED_REVIEW: 'Cần rà hủy',
  HIGH_OUTPUT: 'Sản lượng lớn',
};

function matchesProductionReceiptLane(
  receipt: ProductionReceipt,
  laneFilter: ProductionReceiptLaneFilter,
  highOutputThreshold: number,
): boolean {
  if (laneFilter === 'ALL') return true;
  const receiptDate = dayjs(receipt.receipt_date);
  const totalQty = Number(receipt.total_qty ?? 0);
  switch (laneFilter) {
    case 'POSTED_TODAY':
      return receipt.status === 'POSTED' && receiptDate.isSame(dayjs(), 'day');
    case 'THIS_MONTH':
      return receiptDate.isSame(dayjs(), 'month');
    case 'CANCELLED_REVIEW':
      return receipt.status === 'CANCELLED';
    case 'HIGH_OUTPUT':
      return totalQty > 0 && totalQty >= highOutputThreshold;
    default:
      return true;
  }
}

export default function ProductionReceiptList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [laneFilter, setLaneFilter] = useState<ProductionReceiptLaneFilter>('ALL');
  const [page, setPage] = useState(1);
  const [detailReceipt, setDetailReceipt] = useState<ProductionReceipt | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ProductionReceipt | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState('NONE');
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const [form] = Form.useForm<ReceiptFormValues>();
  const [cancelForm] = Form.useForm<CancelFormValues>();
  const { config, saveConfig } = useUserPreferences(PAGES.PRODUCTION_RECEIPTS);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord?.pageSize ?? 20);
  const namedPresets = useMemo(() => {
    const raw = configRecord?.saved_views;
    if (!Array.isArray(raw)) return [] as ProductionReceiptNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        const name = typeof record.name === 'string' ? record.name : '';
        const filters = record.filters;
        if (!id || !name || !filters || typeof filters !== 'object') return null;
        const filterRecord = filters as Record<string, unknown>;
        const statusValue = filterRecord.status;
        const laneFilterValue = typeof filterRecord.laneFilter === 'string' ? filterRecord.laneFilter : 'ALL';
        if (statusValue !== '' && statusValue !== undefined && statusValue !== 'POSTED' && statusValue !== 'CANCELLED') {
          return null;
        }
        return {
          id,
          name,
          filters: {
            search_input: typeof filterRecord.search_input === 'string' ? filterRecord.search_input : '',
            status: statusValue === 'POSTED' || statusValue === 'CANCELLED' ? statusValue : '',
            production_order: typeof filterRecord.production_order === 'number' ? filterRecord.production_order : null,
            laneFilter: laneFilterValue === 'POSTED_TODAY' || laneFilterValue === 'THIS_MONTH' || laneFilterValue === 'CANCELLED_REVIEW' || laneFilterValue === 'HIGH_OUTPUT' ? laneFilterValue : 'ALL',
          },
        } as ProductionReceiptNamedPreset;
      })
      .filter((item): item is ProductionReceiptNamedPreset => item !== null);
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (value) => JSON.stringify(value),
    parseFilters: (value) => { try { return JSON.parse(value); } catch { return {}; } },
  });

  const params = useMemo(() => ({ search: intentSearch.trim() || undefined, status: intentFilters.status || undefined, production_order: intentFilters.production_order || undefined, page, page_size: pageSize }), [intentFilters.production_order, intentFilters.status, intentSearch, page, pageSize]);
  const listQuery = useQuery({ queryKey: ['production-receipts', params], queryFn: () => productionApi.getReceipts(params) });
  const ordersQuery = useQuery({ queryKey: ['production-receipt-order-options'], queryFn: () => productionApi.getOrders({ page_size: 200, ordering: '-order_date' }) });
  const warehousesQuery = useQuery({ queryKey: ['production-receipt-warehouses'], queryFn: () => inventoryApi.getWarehouses({ page_size: 200, ordering: 'code' }) });
  const locationsQuery = useQuery({ queryKey: ['production-receipt-locations'], queryFn: () => inventoryApi.getLocations({ page_size: 400, ordering: 'code' }) });
  const detailQuery = useQuery({
    queryKey: ['production-receipt-detail', detailReceipt?.id],
    queryFn: () => productionApi.getReceipt(detailReceipt!.id),
    enabled: Boolean(detailReceipt?.id),
  });
  const lifecycleHistoryQuery = useQuery({
    queryKey: ['production-receipt-lifecycle-history', detailReceipt?.id],
    queryFn: () => productionApi.getReceiptLifecycleHistory(detailReceipt!.id),
    enabled: Boolean(detailReceipt?.id),
  });
  const nextStatesQuery = useQuery({
    queryKey: ['production-receipt-next-states', detailReceipt?.id],
    queryFn: () => productionApi.getReceiptNextStates(detailReceipt!.id),
    enabled: Boolean(detailReceipt?.id),
  });

  const orderOptions = useMemo(() => (ordersQuery.data?.results ?? []).filter((item: ProductionOrder) => ['RELEASED', 'IN_PROGRESS'].includes(item.status)).map((item: ProductionOrder) => ({ label: `${item.code} - ${item.product_name || item.product_code || 'Lệnh sản xuất'}`, value: item.id, warehouse: item.target_warehouse ?? null, location: item.target_location ?? null })), [ordersQuery.data?.results]);
  const orderLabelMap = useMemo(() => Object.fromEntries(orderOptions.map((item) => [item.value, item.label])) as Record<number, string>, [orderOptions]);

  const invalidateReceipts = async () => {
    await queryClient.invalidateQueries({ queryKey: ['production-receipts'] });
    await queryClient.invalidateQueries({ queryKey: ['production-receipt-detail'] });
    await queryClient.invalidateQueries({ queryKey: ['production-receipt-lifecycle-history'] });
    await queryClient.invalidateQueries({ queryKey: ['production-receipt-next-states'] });
    await queryClient.invalidateQueries({ queryKey: ['production-orders'] });
    await queryClient.invalidateQueries({ queryKey: ['production-orders-summary'] });
    await queryClient.invalidateQueries({ queryKey: ['production-order-detail'] });
    await queryClient.invalidateQueries({ queryKey: ['production-order-receipts'] });
  };

  const createMutation = useMutation({
    mutationFn: ({ production_order, ...payload }: ReceiptFormValues) => productionApi.receiveOutput(production_order, payload),
    onSuccess: async () => { await invalidateReceipts(); messageApi.success('Đã nhập kho thành phẩm'); form.resetFields(); setFormOpen(false); },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => productionApi.cancelReceipt(id, reason),
    onSuccess: async () => { await invalidateReceipts(); messageApi.success('Đã hủy chứng từ nhập thành phẩm'); cancelForm.resetFields(); setCancelTarget(null); },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = listQuery.data?.results ?? [];
  const detailData = detailQuery.data ?? detailReceipt;
  const summary = useMemo(() => ({
    postedCount: rows.filter((item) => item.status === 'POSTED').length,
    cancelledCount: rows.filter((item) => item.status === 'CANCELLED').length,
    totalQty: rows.reduce((total, item) => total + Number(item.total_qty || 0), 0),
    totalAmount: rows.reduce((total, item) => total + Number(item.total_amount || 0), 0),
    todayCount: rows.filter((item) => dayjs(item.receipt_date).isSame(dayjs(), 'day')).length,
    postedTodayCount: rows.filter((item) => item.status === 'POSTED' && dayjs(item.receipt_date).isSame(dayjs(), 'day')).length,
    thisMonthCount: rows.filter((item) => dayjs(item.receipt_date).isSame(dayjs(), 'month')).length,
    highOutputThreshold: rows.length ? rows.reduce((total, item) => total + Number(item.total_qty || 0), 0) / rows.length : 0,
  }), [rows]);
  const highOutputCount = useMemo(
    () => rows.filter((item) => Number(item.total_qty || 0) > 0 && Number(item.total_qty || 0) >= summary.highOutputThreshold).length,
    [rows, summary.highOutputThreshold],
  );
  const visibleRows = useMemo(
    () => rows.filter((item) => matchesProductionReceiptLane(item, laneFilter, summary.highOutputThreshold)),
    [laneFilter, rows, summary.highOutputThreshold],
  );
  const laneTiles = useMemo(
    () => [
      { value: 'ALL' as const, label: LANE_LABELS.ALL, count: rows.length },
      { value: 'POSTED_TODAY' as const, label: LANE_LABELS.POSTED_TODAY, count: summary.postedTodayCount },
      { value: 'THIS_MONTH' as const, label: LANE_LABELS.THIS_MONTH, count: summary.thisMonthCount },
      { value: 'CANCELLED_REVIEW' as const, label: LANE_LABELS.CANCELLED_REVIEW, count: summary.cancelledCount },
      { value: 'HIGH_OUTPUT' as const, label: LANE_LABELS.HIGH_OUTPUT, count: highOutputCount },
    ],
    [highOutputCount, rows.length, summary.cancelledCount, summary.postedTodayCount, summary.thisMonthCount],
  );
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Tìm kiếm: ${intentSearch.trim()}`);
    if (filters.status) tags.push(`Trạng thái: ${STATUS_LABELS[filters.status]}`);
    if (filters.production_order) tags.push(`Lệnh: ${orderLabelMap[filters.production_order] ?? `#${filters.production_order}`}`);
    if (laneFilter !== 'ALL') tags.push(`Làn điều phối: ${LANE_LABELS[laneFilter]}`);
    if (selectedViewPreset) tags.push(`Mẫu đang dùng: ${selectedViewPreset.name}`);
    return tags;
  }, [filters.production_order, filters.status, intentSearch, laneFilter, orderLabelMap, selectedViewPreset]);

  const buildCurrentSnapshot = (): ProductionReceiptViewSnapshot => ({
    search_input: searchInput,
    status: filters.status ?? '',
    production_order: filters.production_order ?? null,
    laneFilter,
  });

  const applySnapshot = (snapshot: ProductionReceiptViewSnapshot) => {
    setSearchInput(snapshot.search_input);
    setFilters({
      status: snapshot.status || undefined,
      production_order: snapshot.production_order ?? undefined,
    });
    setLaneFilter(snapshot.laneFilter ?? 'ALL');
    setPage(1);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem nhập thành phẩm.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem nhập thành phẩm.');
    }
  };

  const applySavedView = () => {
    const rawStatus = configRecord?.status;
    const rawLaneFilter = typeof configRecord?.laneFilter === 'string' ? configRecord.laneFilter : 'ALL';
    const snapshot: ProductionReceiptViewSnapshot = {
      search_input: typeof configRecord?.search_input === 'string' ? configRecord.search_input : '',
      status: rawStatus === 'POSTED' || rawStatus === 'CANCELLED' ? rawStatus : '',
      production_order: typeof configRecord?.production_order === 'number' ? configRecord.production_order : null,
      laneFilter: rawLaneFilter === 'POSTED_TODAY' || rawLaneFilter === 'THIS_MONTH' || rawLaneFilter === 'CANCELLED_REVIEW' || rawLaneFilter === 'HIGH_OUTPUT' ? rawLaneFilter : 'ALL',
    };
    applySnapshot(snapshot);
    messageApi.success('Đã khôi phục chế độ xem nhập thành phẩm đã lưu.');
  };

  const resetFilters = () => {
    setSearchInput('');
    setFilters({});
    setLaneFilter('ALL');
    setPage(1);
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: ProductionReceiptNamedPreset = existing
      ? { ...existing, name, filters: currentSnapshot }
      : { id: `${Date.now()}`, name, filters: currentSnapshot };
    const nextPresets = existing
      ? namedPresets.map((item) => (item.id === existing.id ? nextPreset : item))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        ...currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId(nextPreset.id);
      setViewPresetName('');
      setIsViewPresetModalOpen(false);
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc nhập thành phẩm.' : 'Đã lưu mẫu lọc nhập thành phẩm mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc nhập thành phẩm.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc nhập thành phẩm.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc nhập thành phẩm để xóa.');
      return;
    }
    const nextPresets = namedPresets.filter((item) => item.id !== preset.id);
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        ...buildCurrentSnapshot(),
        saved_views: nextPresets,
      });
      setSelectedViewPresetId('NONE');
      messageApi.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc nhập thành phẩm.');
    }
  };
  const statusAlert = useMemo(() => {
    if (summary.cancelledCount > 0) return { type: 'warning' as const, message: `${summary.cancelledCount} chứng từ nhập thành phẩm đã bị hủy, nên đối soát lại số lượng thành phẩm và tình trạng hoàn công.` };
    if (summary.postedTodayCount > 0) return { type: 'info' as const, message: `Hôm nay đã ghi nhận ${summary.postedTodayCount} chứng từ nhập thành phẩm trong bộ lọc hiện tại.` };
    return { type: 'success' as const, message: 'Luồng nhập kho thành phẩm đang ổn định, chưa phát sinh cảnh báo cần xử lý ngay.' };
  }, [summary.cancelledCount, summary.postedTodayCount]);

  const columns: ColumnsType<ProductionReceipt> = [
    { title: 'Mã chứng từ', dataIndex: 'code', width: 140 },
    { title: 'Lệnh SX', dataIndex: 'production_order_code', width: 130, render: (value: string | null) => value || '-' },
    { title: 'Ngày nhập', dataIndex: 'receipt_date', width: 130, render: (value: string) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Kho đích', dataIndex: 'warehouse_name', width: 180, render: (value: string | null) => value || '-' },
    { title: 'Tổng SL', dataIndex: 'total_qty', width: 120, align: 'right', render: (value: string) => Number(value || 0).toLocaleString('vi-VN') },
    { title: 'Giá trị', dataIndex: 'total_amount', width: 140, align: 'right', render: (value: string) => Number(value || 0).toLocaleString('vi-VN') },
    { title: 'Trạng thái', dataIndex: 'status', width: 140, render: (value: ProductionReceiptStatus) => <Tag color={STATUS_COLORS[value]}>{STATUS_LABELS[value]}</Tag> },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 190,
      fixed: 'right',
      render: (_, row) => <Space wrap size="small">
        <Button data-testid={`production-receipt-view-${row.id}`} size="small" icon={<EyeOutlined />} onClick={() => setDetailReceipt(row)}>Xem</Button>
        {row.status === 'POSTED' ? <Button data-testid={`production-receipt-cancel-${row.id}`} size="small" danger icon={<StopOutlined />} onClick={() => { cancelForm.setFieldsValue({ reason: '' }); setCancelTarget(row); }}>Hủy chứng từ</Button> : null}
      </Space>,
    },
  ];

  const handleExportCSV = () => {
    if (!visibleRows.length) return;
    downloadCSV(visibleRows.map((receipt) => ({ 'Mã chứng từ': receipt.code, 'Lệnh SX': receipt.production_order_code || '', 'Ngày nhập': dayjs(receipt.receipt_date).format('DD/MM/YYYY'), 'Kho đích': receipt.warehouse_name || '', 'Tổng SL': Number(receipt.total_qty || 0).toLocaleString('vi-VN'), 'Giá trị': Number(receipt.total_amount || 0).toLocaleString('vi-VN'), 'Trạng thái': STATUS_LABELS[receipt.status] })), 'nhap-kho-thanh-pham');
  };
  const handleSubmit = async () => {
    const values = await form.validateFields();
    await createMutation.mutateAsync(values);
  };
  const handleCancelReceipt = async () => {
    if (!cancelTarget) return;
    const values = await cancelForm.validateFields();
    await cancelMutation.mutateAsync({ id: cancelTarget.id, reason: values.reason.trim() });
  };

  if (listQuery.isLoading && !listQuery.data) return <Skeleton active paragraph={{ rows: 10 }} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <Card bordered={false} style={{ borderRadius: 20 }} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 16 } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Title level={3} style={{ margin: 0 }}>Trung tâm nhập kho thành phẩm</Title>
            <Text type="secondary">Ghi nhận đầu ra sản xuất, theo dõi chứng từ nhập thành phẩm và xử lý các trường hợp cần hủy đối soát.</Text>
          </div>
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={handleExportCSV} disabled={!visibleRows.length}>Xuất CSV</Button>
            <Button type="primary" icon={<InboxOutlined />} onClick={() => { form.setFieldsValue({ receipt_date: dayjs().format('YYYY-MM-DD'), reference: '', reason: 'Nhập kho thành phẩm từ sản xuất', note: '' }); setFormOpen(true); }}>Nhập thành phẩm</Button>
          </Space>
        </div>
        <Alert showIcon type={statusAlert.type} message={statusAlert.message} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Card size="small" style={TILE_STYLE}><Statistic title="Đã ghi nhận" value={summary.postedCount} valueStyle={{ color: '#389e0d' }} /></Card>
          <Card size="small" style={TILE_STYLE}><Statistic title="Đã hủy" value={summary.cancelledCount} valueStyle={{ color: '#cf1322' }} /></Card>
          <Card size="small" style={TILE_STYLE}><Statistic title="Tổng SL nhập" value={summary.totalQty} precision={2} /></Card>
          <Card size="small" style={TILE_STYLE}><Statistic title="Giá trị" value={summary.totalAmount} precision={0} /></Card>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {laneTiles.map((lane) => (
            <Button
              key={lane.value}
              type={laneFilter === lane.value ? 'primary' : 'default'}
              data-testid={`production-receipts-lane-${lane.value.toLowerCase().replace(/_/g, '-')}`}
              onClick={() => {
                setLaneFilter(lane.value);
                setPage(1);
              }}
            >
              {`${lane.label} (${lane.count})`}
            </Button>
          ))}
        </div>
      </Card>

      <Card bordered={false} data-testid="production-receipts-command-strip" style={{ borderRadius: 18 }} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div data-testid="production-receipts-command-search">
            <Input value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setPage(1); }} placeholder="Tìm mã chứng từ, mã lệnh, thành phẩm..." style={{ width: 320 }} suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined} />
          </div>
          <Select allowClear placeholder="Trạng thái" style={{ width: 220 }} value={filters.status} onChange={(value) => { setFilters((prev) => ({ ...prev, status: value })); setPage(1); }} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
          <Select allowClear showSearch optionFilterProp="label" placeholder="Lệnh sản xuất" style={{ width: 320 }} value={filters.production_order} onChange={(value) => { setFilters((prev) => ({ ...prev, production_order: value })); setPage(1); }} options={orderOptions} />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button data-testid="production-receipts-save-view" onClick={() => void saveCurrentView()}>Lưu chế độ xem</Button>
          <Button data-testid="production-receipts-restore-view" onClick={applySavedView}>Khôi phục</Button>
          <Button data-testid="production-receipts-open-preset-modal" onClick={() => setIsViewPresetModalOpen(true)}>Tạo mẫu lọc</Button>
          <div data-testid="production-receipts-preset-select">
            <Select
              value={selectedViewPresetId}
              onChange={setSelectedViewPresetId}
              style={{ width: 240 }}
              options={[
                { value: 'NONE', label: 'Chọn mẫu nhập thành phẩm' },
                ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
              ]}
            />
          </div>
          <Button data-testid="production-receipts-apply-preset" onClick={applyNamedPreset}>Áp dụng mẫu</Button>
          <Button danger data-testid="production-receipts-delete-preset" disabled={!selectedViewPreset} onClick={() => void deleteNamedPreset()}>Xóa mẫu</Button>
          <Button onClick={resetFilters}>Xóa bộ lọc</Button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {activeFilterTags.length ? activeFilterTags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Tag color="default">Đang xem toàn bộ chứng từ nhập thành phẩm</Tag>}
          <Tag color="blue">Chứng từ hôm nay: {summary.todayCount}</Tag>
        </div>
      </Card>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={visibleRows}
        loading={listQuery.isLoading}
        scroll={{ x: 1350 }}
        pagination={{ current: page, pageSize, total: listQuery.data?.count ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: async (nextPage, nextPageSize) => { setPage(nextPage); if (nextPageSize !== pageSize) await saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize }); } }}
        locale={{ emptyText: visibleRows.length === 0 && !listQuery.isLoading ? (activeFilterTags.length ? <div style={{ padding: 32 }}><Empty description="Không tìm thấy chứng từ nhập thành phẩm phù hợp." /><Button type="link" onClick={resetFilters}>Xóa bộ lọc</Button></div> : <Empty description="Chưa có chứng từ nhập thành phẩm nào." />) : undefined }}
      />

      <Modal
        open={isViewPresetModalOpen}
        title="Lưu mẫu lọc nhập thành phẩm"
        okText="Lưu mẫu"
        cancelText="Đóng"
        onOk={() => void saveNamedPreset()}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
      >
        <Form layout="vertical">
          <Form.Item label="Tên mẫu lọc">
            <Input
              data-testid="production-receipts-preset-name"
              placeholder="Ví dụ: Lệnh đang chờ đối soát"
              value={viewPresetName}
              onChange={(event) => setViewPresetName(event.target.value)}
              onPressEnter={() => void saveNamedPreset()}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Nhập kho thành phẩm" open={formOpen} onCancel={() => { setFormOpen(false); form.resetFields(); }} onOk={handleSubmit} okText="Ghi nhận nhập kho" cancelText="Đóng" confirmLoading={createMutation.isPending}>
        <Form form={form} layout="vertical">
          <Alert showIcon type="info" style={{ marginBottom: 16 }} message="Hệ thống sẽ tự lấy thành phẩm của lệnh đã chọn; bạn chỉ cần xác nhận ngày nhập, kho đích và ghi chú nếu cần." />
          <Form.Item label="Lệnh sản xuất" name="production_order" rules={[{ required: true, message: 'Vui lòng chọn lệnh sản xuất' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Chọn lệnh sản xuất đang chạy" options={orderOptions} onChange={(value) => { const selected = orderOptions.find((item) => item.value === value); form.setFieldsValue({ warehouse: selected?.warehouse ?? null, location: selected?.location ?? null }); }} />
          </Form.Item>
          <Form.Item label="Ngày nhập" name="receipt_date" rules={[{ required: true, message: 'Vui lòng chọn ngày nhập' }]}><Input type="date" /></Form.Item>
          <Form.Item label="Kho đích" name="warehouse"><Select allowClear showSearch optionFilterProp="label" placeholder="Chọn kho đích" options={(warehousesQuery.data?.results ?? []).map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))} /></Form.Item>
          <Form.Item label="Vị trí đích" name="location"><Select allowClear showSearch optionFilterProp="label" placeholder="Chọn vị trí" options={(locationsQuery.data?.results ?? []).map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))} /></Form.Item>
          <Form.Item label="Tham chiếu" name="reference"><Input placeholder="Ví dụ: nhập thành phẩm theo lệnh cuối ca" /></Form.Item>
          <Form.Item label="Lý do" name="reason"><Input placeholder="Ví dụ: hoàn tất sản xuất và nhập kho chờ giao" /></Form.Item>
          <Form.Item label="Ghi chú" name="note"><Input.TextArea rows={3} placeholder="Thông tin thêm để phục vụ đối soát hoặc bàn giao kho" /></Form.Item>
        </Form>
      </Modal>

      <Modal title={cancelTarget ? `Hủy chứng từ nhập thành phẩm - ${cancelTarget.code}` : 'Hủy chứng từ nhập thành phẩm'} open={Boolean(cancelTarget)} onCancel={() => { setCancelTarget(null); cancelForm.resetFields(); }} onOk={handleCancelReceipt} okText="Xác nhận hủy" cancelText="Đóng" okButtonProps={{ danger: true }} confirmLoading={cancelMutation.isPending}>
        <Form form={cancelForm} layout="vertical">
          <Alert showIcon type="warning" style={{ marginBottom: 16 }} message="Khi hủy, số lượng thành phẩm đã nhập sẽ được hoàn tác khỏi tồn kho và trạng thái sản xuất liên quan." />
          <Form.Item label="Lý do hủy" name="reason" rules={[{ required: true, message: 'Vui lòng nhập lý do hủy' }, { validator: async (_, value) => (value?.trim() ? Promise.resolve() : Promise.reject(new Error('Vui lòng nhập lý do hủy'))) }]}>
            <Input.TextArea rows={4} maxLength={500} placeholder="Mô tả rõ nguyên nhân để thuận tiện audit và đối soát sau này" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={detailReceipt ? `Chi tiết nhập thành phẩm - ${detailReceipt.code}` : 'Chi tiết nhập thành phẩm'} open={Boolean(detailReceipt)} onCancel={() => setDetailReceipt(null)} footer={null} width={980}>
        {detailQuery.isLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : detailData ? <div data-testid="production-receipt-detail-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Card size="small" style={TILE_STYLE}><Statistic title="Tổng số dòng" value={detailData.lines.length} /></Card>
            <Card size="small" style={TILE_STYLE}><Statistic title="Tổng SL" value={Number(detailData.total_qty || 0)} precision={2} /></Card>
            <Card size="small" style={TILE_STYLE}><Statistic title="Giá trị" value={Number(detailData.total_amount || 0)} precision={0} /></Card>
            <Card size="small" style={TILE_STYLE}><Statistic title="Ngày nhập" value={dayjs(detailData.receipt_date).format('DD/MM/YYYY')} /></Card>
          </div>
          <Card size="small" title="Tổng quan chứng từ">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              <div><strong>Lệnh sản xuất:</strong> {detailData.production_order_code || '-'}</div>
              <div><strong>Trạng thái:</strong> <Tag color={STATUS_COLORS[detailData.status]}>{STATUS_LABELS[detailData.status]}</Tag></div>
              <div><strong>Kho đích:</strong> {detailData.warehouse_name || '-'}</div>
              <div><strong>Vị trí đích:</strong> {detailData.location_name || '-'}</div>
            </div>
            {detailData.note ? <div style={{ marginTop: 12 }}><strong>Ghi chú:</strong> {detailData.note}</div> : null}
            {detailData.cancel_reason ? <div style={{ marginTop: 8 }}><strong>Lý do hủy:</strong> {detailData.cancel_reason}</div> : null}
          </Card>
          <Card size="small" title="Bước kế tiếp khuyến nghị">
            <div data-testid="production-receipt-next-states" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color="blue">Hiện tại: {STATUS_LABELS[detailData.status]}</Tag>
              {(nextStatesQuery.data?.next_states ?? []).length > 0 ? (
                (nextStatesQuery.data?.next_states ?? []).map((state) => (
                  <Tag key={state} color="gold">
                    {STATUS_LABELS[state as ProductionReceiptStatus] || state}
                  </Tag>
                ))
              ) : (
                <Tag>Không còn bước tiếp theo</Tag>
              )}
            </div>
          </Card>
          <Card size="small" title="Lịch sử vòng đời">
            <Table<ProductionApprovalHistoryItem>
              data-testid="production-receipt-lifecycle-history"
              rowKey={(row) => `${row.action}-${row.created_at}`}
              loading={lifecycleHistoryQuery.isLoading}
              dataSource={lifecycleHistoryQuery.data ?? []}
              pagination={false}
              locale={{ emptyText: 'Chứng từ nhập thành phẩm này chưa có lịch sử vòng đời.' }}
              columns={[
                {
                  title: 'Hành động',
                  dataIndex: 'action',
                  width: 180,
                  render: (_, row) => row.action_label || row.action,
                },
                {
                  title: 'Người thực hiện',
                  dataIndex: 'user',
                  width: 180,
                  render: (value) => value || '-',
                },
                {
                  title: 'Ghi chú',
                  dataIndex: 'comments',
                  width: 280,
                  render: (value) => value || '-',
                },
                {
                  title: 'Thời gian',
                  dataIndex: 'created_at',
                  width: 180,
                  render: (value) => dayjs(value).format('DD/MM/YYYY HH:mm'),
                },
              ]}
              scroll={{ x: 820 }}
            />
          </Card>
          <Card size="small" title="Chi tiết thành phẩm đã nhập">
            <Table rowKey="id" size="small" pagination={false} dataSource={detailData.lines} columns={[
              { title: 'Thành phẩm', width: 280, render: (_, row) => [row.product_code, row.product_name].filter(Boolean).join(' - ') || '-' },
              { title: 'Số lượng', dataIndex: 'quantity', width: 120, align: 'right' },
              { title: 'Đơn giá', dataIndex: 'unit_cost', width: 120, align: 'right', render: (value: string) => Number(value || 0).toLocaleString('vi-VN') },
              { title: 'Giá trị', dataIndex: 'line_total', width: 140, align: 'right', render: (value: string) => Number(value || 0).toLocaleString('vi-VN') },
              { title: 'Mã giao dịch kho', dataIndex: 'inventory_transaction_code', width: 150, render: (value: string | null) => value || '-' },
            ]} />
          </Card>
        </div> : null}
      </Modal>
    </div>
  );
}
