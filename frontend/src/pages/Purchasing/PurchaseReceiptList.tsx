import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { purchasingApi } from '../../api/purchasing';
import type { PurchaseApprovalHistoryItem, PurchaseReceipt, Supplier } from '../../types/purchasing';
import { PAGES } from '../../utils/constants';
import { canCancelPurchaseOrders, canManagePurchasingData } from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';

const { Text, Title } = Typography;
const RECEIPT_STATUS_LABELS: Record<PurchaseReceipt['status'], string> = {
  POSTED: 'Đã ghi sổ',
  CANCELLED: 'Đã hủy',
};

type Filters = {
  status?: string;
  supplier?: number;
};
type PurchaseReceiptLaneFilter = 'ALL' | 'POSTED_TODAY' | 'MONTHLY_RECON' | 'CANCELLED_REVIEW' | 'HIGH_VALUE';
type PurchaseReceiptViewSnapshot = {
  search_input: string;
  status: string;
  supplier: number | null;
  laneFilter: PurchaseReceiptLaneFilter;
};
type PurchaseReceiptNamedPreset = {
  id: string;
  name: string;
  filters: PurchaseReceiptViewSnapshot;
};


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


function formatMoney(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0';
}

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};
const LANE_LABELS: Record<PurchaseReceiptLaneFilter, string> = {
  ALL: 'Toàn bộ phiếu',
  POSTED_TODAY: 'Ghi sổ hôm nay',
  MONTHLY_RECON: 'Đối soát tháng này',
  CANCELLED_REVIEW: 'Cần rà hủy',
  HIGH_VALUE: 'Giá trị cao',
};

function matchesReceiptLane(
  receipt: PurchaseReceipt,
  laneFilter: PurchaseReceiptLaneFilter,
  highValueThreshold: number,
): boolean {
  if (laneFilter === 'ALL') return true;
  const receiptDate = dayjs(receipt.receipt_date);
  const totalAmount = Number(receipt.total_amount ?? 0);
  switch (laneFilter) {
    case 'POSTED_TODAY':
      return receipt.status === 'POSTED' && receiptDate.isSame(dayjs(), 'day');
    case 'MONTHLY_RECON':
      return receiptDate.isSame(dayjs(), 'month');
    case 'CANCELLED_REVIEW':
      return receipt.status === 'CANCELLED';
    case 'HIGH_VALUE':
      return totalAmount > 0 && totalAmount >= highValueThreshold;
    default:
      return true;
  }
}


export default function PurchaseReceiptList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManagePurchasingData();
  const canCancel = canCancelPurchaseOrders();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [laneFilter, setLaneFilter] = useState<PurchaseReceiptLaneFilter>('ALL');
  const [page, setPage] = useState(1);
  const [drawerReceipt, setDrawerReceipt] = useState<PurchaseReceipt | null>(null);
  const [cancelReceipt, setCancelReceipt] = useState<PurchaseReceipt | null>(null);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState('NONE');
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const [reasonForm] = Form.useForm<{ reason: string }>();
  const { config, saveConfig } = useUserPreferences(PAGES.PURCHASING_RECEIPTS);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord?.pageSize ?? 20);
  const namedPresets = useMemo(() => {
    const raw = configRecord?.saved_views;
    if (!Array.isArray(raw)) return [] as PurchaseReceiptNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        const name = typeof record.name === 'string' ? record.name : '';
        const filters = record.filters;
        if (!id || !name || !filters || typeof filters !== 'object') return null;
        const filterRecord = filters as Record<string, unknown>;
        const statusValue = typeof filterRecord.status === 'string' ? filterRecord.status : '';
        const laneFilterValue = typeof filterRecord.laneFilter === 'string' ? filterRecord.laneFilter : 'ALL';
        if (statusValue && statusValue !== 'POSTED' && statusValue !== 'CANCELLED') {
          return null;
        }
        return {
          id,
          name,
          filters: {
            search_input: typeof filterRecord.search_input === 'string' ? filterRecord.search_input : '',
            status: statusValue,
            supplier: typeof filterRecord.supplier === 'number' ? filterRecord.supplier : null,
            laneFilter: laneFilterValue === 'POSTED_TODAY' || laneFilterValue === 'MONTHLY_RECON' || laneFilterValue === 'CANCELLED_REVIEW' || laneFilterValue === 'HIGH_VALUE' ? laneFilterValue : 'ALL',
          },
        } as PurchaseReceiptNamedPreset;
      })
      .filter((item): item is PurchaseReceiptNamedPreset => item !== null);
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
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: '-receipt_date' };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.supplier) next.supplier = intentFilters.supplier;
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const receiptsQuery = useQuery({
    queryKey: ['purchasing-receipts', params],
    queryFn: () => purchasingApi.getReceipts(params),
  });
  const suppliersQuery = useQuery({
    queryKey: ['purchasing-receipt-suppliers'],
    queryFn: () => purchasingApi.getSuppliers({ page_size: 200, ordering: 'code', is_active: 'true' }),
  });
  const receiptDetailQuery = useQuery({
    queryKey: ['purchasing-receipt-detail', drawerReceipt?.id],
    queryFn: () => purchasingApi.getReceipt(drawerReceipt!.id),
    enabled: !!drawerReceipt,
  });
  const receiptLifecycleHistoryQuery = useQuery({
    queryKey: ['purchasing-receipt-lifecycle-history', drawerReceipt?.id],
    queryFn: () => purchasingApi.getReceiptLifecycleHistory(drawerReceipt!.id),
    enabled: !!drawerReceipt,
  });
  const receiptNextStatesQuery = useQuery({
    queryKey: ['purchasing-receipt-next-states', drawerReceipt?.id],
    queryFn: () => purchasingApi.getReceiptNextStates(drawerReceipt!.id),
    enabled: !!drawerReceipt,
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => purchasingApi.cancelReceipt(id, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['purchasing-receipts'] }),
        queryClient.invalidateQueries({ queryKey: ['purchasing-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['purchasing-receipt-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['purchasing-receipt-lifecycle-history'] }),
        queryClient.invalidateQueries({ queryKey: ['purchasing-receipt-next-states'] }),
      ]);
      messageApi.success('Đã hủy phiếu nhập');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = useMemo(() => receiptsQuery.data?.results ?? [], [receiptsQuery.data?.results]);
  const supplierOptions = useMemo<Supplier[]>(() => suppliersQuery.data?.results ?? [], [suppliersQuery.data?.results]);
  const detail = receiptDetailQuery.data ?? drawerReceipt;
  const summary = useMemo(() => {
    const postedCount = rows.filter((row) => row.status === 'POSTED').length;
    const cancelledCount = rows.filter((row) => row.status === 'CANCELLED').length;
    const totalQty = rows.reduce((acc, row) => acc + Number(row.total_qty ?? 0), 0);
    const totalAmount = rows.reduce((acc, row) => acc + Number(row.total_amount ?? 0), 0);
    const recentReceipts = rows.filter((row) => dayjs(row.receipt_date).isSame(dayjs(), 'month')).length;
    const postedTodayCount = rows.filter((row) => row.status === 'POSTED' && dayjs(row.receipt_date).isSame(dayjs(), 'day')).length;
    const highValueThreshold = rows.length ? totalAmount / rows.length : 0;
    const highValueCount = rows.filter((row) => Number(row.total_amount ?? 0) > 0 && Number(row.total_amount ?? 0) >= highValueThreshold).length;
    return { postedCount, cancelledCount, totalQty, totalAmount, recentReceipts, postedTodayCount, highValueThreshold, highValueCount };
  }, [rows]);
  const visibleRows = useMemo(
    () => rows.filter((row) => matchesReceiptLane(row, laneFilter, summary.highValueThreshold)),
    [laneFilter, rows, summary.highValueThreshold],
  );
  const laneTiles = useMemo(
    () => [
      { value: 'ALL' as const, label: LANE_LABELS.ALL, count: rows.length },
      { value: 'POSTED_TODAY' as const, label: LANE_LABELS.POSTED_TODAY, count: summary.postedTodayCount },
      { value: 'MONTHLY_RECON' as const, label: LANE_LABELS.MONTHLY_RECON, count: summary.recentReceipts },
      { value: 'CANCELLED_REVIEW' as const, label: LANE_LABELS.CANCELLED_REVIEW, count: summary.cancelledCount },
      { value: 'HIGH_VALUE' as const, label: LANE_LABELS.HIGH_VALUE, count: summary.highValueCount },
    ],
    [rows.length, summary.cancelledCount, summary.highValueCount, summary.postedTodayCount, summary.recentReceipts],
  );
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.status) tags.push(`Trạng thái: ${intentFilters.status === 'POSTED' ? 'Đã ghi sổ' : 'Đã hủy'}`);
    if (intentFilters.supplier) {
      const supplier = supplierOptions.find((item) => item.id === intentFilters.supplier);
      tags.push(`Nhà cung cấp: ${supplier ? `${supplier.code} - ${supplier.name}` : `#${intentFilters.supplier}`}`);
    }
    if (laneFilter !== 'ALL') tags.push(`Làn điều phối: ${LANE_LABELS[laneFilter]}`);
    if (selectedViewPreset) tags.push(`Mẫu đang dùng: ${selectedViewPreset.name}`);
    return tags;
  }, [intentFilters.status, intentFilters.supplier, intentSearch, laneFilter, selectedViewPreset, supplierOptions]);

  const buildCurrentSnapshot = (): PurchaseReceiptViewSnapshot => ({
    search_input: searchInput,
    status: filters.status ?? '',
    supplier: filters.supplier ?? null,
    laneFilter,
  });

  const applySnapshot = (snapshot: PurchaseReceiptViewSnapshot) => {
    setSearchInput(snapshot.search_input);
    setFilters({
      status: snapshot.status || undefined,
      supplier: snapshot.supplier ?? undefined,
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
      messageApi.success('Đã lưu chế độ xem phiếu nhập mua.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem phiếu nhập mua.');
    }
  };

  const applySavedView = () => {
    const rawStatus = typeof configRecord?.status === 'string' ? configRecord.status : '';
    const rawLaneFilter = typeof configRecord?.laneFilter === 'string' ? configRecord.laneFilter : 'ALL';
    const snapshot: PurchaseReceiptViewSnapshot = {
      search_input: typeof configRecord?.search_input === 'string' ? configRecord.search_input : '',
      status: rawStatus === 'POSTED' || rawStatus === 'CANCELLED' ? rawStatus : '',
      supplier: typeof configRecord?.supplier === 'number' ? configRecord.supplier : null,
      laneFilter: rawLaneFilter === 'POSTED_TODAY' || rawLaneFilter === 'MONTHLY_RECON' || rawLaneFilter === 'CANCELLED_REVIEW' || rawLaneFilter === 'HIGH_VALUE' ? rawLaneFilter : 'ALL',
    };
    applySnapshot(snapshot);
    messageApi.success('Đã khôi phục chế độ xem phiếu nhập mua đã lưu.');
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
    const nextPreset: PurchaseReceiptNamedPreset = existing
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
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc phiếu nhập mua.' : 'Đã lưu mẫu lọc phiếu nhập mua mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc phiếu nhập mua.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc phiếu nhập mua.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc phiếu nhập mua để xóa.');
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
      messageApi.error('Không thể xóa mẫu lọc phiếu nhập mua.');
    }
  };
  const statusAlert = useMemo(() => {
    if (summary.cancelledCount > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${summary.cancelledCount} phiếu nhập đã bị hủy trong tập dữ liệu hiện tại.`,
        description: 'Nên rà nguyên nhân hủy để tránh lệch đối soát nhập kho và chậm khớp công nợ mua hàng.',
      };
    }
    if (summary.postedCount > 0) {
      return {
        type: 'info' as const,
        message: `Đã ghi sổ ${summary.postedCount} phiếu nhập trong bối cảnh đang xem.`,
        description: 'Bạn có thể theo dõi chi tiết từng phiếu để đối chiếu dòng hàng, mã sổ kho và trạng thái hủy nếu có.',
      };
    }
    return {
      type: 'success' as const,
      message: 'Luồng phiếu nhập đang ổn định.',
      description: 'Chưa có phiếu nhập nổi bật trên bộ lọc hiện tại.',
    };
  }, [summary.cancelledCount, summary.postedCount]);

  const getReceiptCancelBlockReason = (receipt: PurchaseReceipt) => {
    if (!canManage || !canCancel) return 'Bạn không có quyền hủy phiếu nhập.';
    if (receipt.status !== 'POSTED') return 'Phiếu nhập không còn hiệu lực để hủy.';
    if (receipt.can_cancel === false) return receipt.cancel_block_reason || 'Phiếu nhập hiện không thể hủy.';
    return '';
  };

  const columns: ColumnsType<PurchaseReceipt> = [
    { title: 'Phiếu nhập', dataIndex: 'code', width: 140 },
    { title: 'Đơn mua', dataIndex: 'purchase_order_code', width: 140, render: (value) => value || '-' },
    { title: 'Nhà cung cấp', dataIndex: 'supplier_name', width: 220, render: (value) => value || '-' },
    { title: 'Ngày nhận', dataIndex: 'receipt_date', width: 110, render: (value) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 160, render: (value) => value || '-' },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (value) => <Tag color={value === 'POSTED' ? 'success' : 'error'}>{value === 'POSTED' ? 'Đã ghi sổ' : 'Đã hủy'}</Tag>,
    },
    { title: 'SL', dataIndex: 'total_qty', width: 100 },
    { title: 'Giá trị', dataIndex: 'total_amount', width: 140, render: (value) => formatMoney(value) },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 180,
      fixed: 'right',
      render: (_, row) => {
        const cancelBlockReason = getReceiptCancelBlockReason(row);
        return (
          <Space>
            <Button data-testid={`purchase-receipt-view-${row.id}`} size="small" onClick={() => setDrawerReceipt(row)}>
              Xem
            </Button>
            <Tooltip title={cancelBlockReason || undefined}>
              <Button
                data-testid={`purchase-receipt-cancel-${row.id}`}
                size="small"
                danger
                disabled={!!cancelBlockReason}
                onClick={() => {
                  setCancelReceipt(row);
                  reasonForm.setFieldValue('reason', '');
                }}
              >
                Hủy phiếu
              </Button>
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  const handleCancelReceipt = async () => {
    const values = await reasonForm.validateFields();
    if (!cancelReceipt) return;
    await cancelMutation.mutateAsync({ id: cancelReceipt.id, reason: values.reason.trim() });
    setCancelReceipt(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <Space wrap>
                <Tag color="blue">Mua hàng</Tag>
                <Tag color="gold">Phiếu nhập</Tag>
                <Tag color="processing">Đối chiếu kho</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>Trung tâm phiếu nhập mua</Title>
              <Text type="secondary">Theo dõi nhận hàng từ đơn mua, đối chiếu trạng thái ghi sổ và kiểm tra chi tiết nhập kho theo từng dòng.</Text>
            </div>
          </div>

          <Alert showIcon type={statusAlert.type} message={statusAlert.message} description={statusAlert.description} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đã ghi sổ" value={summary.postedCount} suffix="phiếu" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đã hủy" value={summary.cancelledCount} suffix="phiếu" valueStyle={{ color: summary.cancelledCount > 0 ? '#cf1322' : undefined }} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tổng số lượng" value={summary.totalQty} precision={0} suffix="đv" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tổng giá trị" value={summary.totalAmount} formatter={(value) => `${formatMoney(value)} đ`} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {laneTiles.map((lane) => (
              <Button
                key={lane.value}
                type={laneFilter === lane.value ? 'primary' : 'default'}
                data-testid={`purchase-receipts-lane-${lane.value.toLowerCase().replace(/_/g, '-')}`}
                onClick={() => {
                  setLaneFilter(lane.value);
                  setPage(1);
                }}
              >
                {`${lane.label} (${lane.count})`}
              </Button>
            ))}
          </div>
        </Space>
      </Card>

      <Card data-testid="purchase-receipts-command-strip">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div data-testid="purchase-receipts-command-search">
              <Input
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setPage(1);
                }}
                placeholder="Tìm kiếm tất cả cột..."
                style={{ width: 320 }}
                suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
              />
            </div>
            <Select
              value={filters.status ?? ''}
              style={{ width: 220 }}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, status: value || undefined }));
                setPage(1);
              }}
              options={[
                { value: '', label: 'Tất cả trạng thái' },
                { value: 'POSTED', label: 'Đã ghi sổ' },
                { value: 'CANCELLED', label: 'Đã hủy' },
              ]}
            />
            <Select
              showSearch
              optionFilterProp="label"
              value={filters.supplier ?? ''}
              style={{ width: 260 }}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, supplier: typeof value === 'number' ? value : undefined }));
                setPage(1);
              }}
              options={[
                { value: '', label: 'Tất cả nhà cung cấp' },
                ...supplierOptions.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` })),
              ]}
            />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button data-testid="purchase-receipts-save-view" onClick={() => void saveCurrentView()}>
              Lưu chế độ xem
            </Button>
            <Button data-testid="purchase-receipts-restore-view" onClick={applySavedView}>
              Khôi phục
            </Button>
            <Button
              data-testid="purchase-receipts-open-preset-modal"
              onClick={() => setIsViewPresetModalOpen(true)}
            >
              Tạo mẫu lọc
            </Button>
            <div data-testid="purchase-receipts-preset-select">
              <Select
                value={selectedViewPresetId}
                onChange={setSelectedViewPresetId}
                style={{ width: 240 }}
                options={[
                  { value: 'NONE', label: 'Chọn mẫu phiếu nhập' },
                  ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                ]}
              />
            </div>
            <Button data-testid="purchase-receipts-apply-preset" onClick={applyNamedPreset}>
              Áp dụng mẫu
            </Button>
            <Button
              danger
              data-testid="purchase-receipts-delete-preset"
              disabled={!selectedViewPreset}
              onClick={() => void deleteNamedPreset()}
            >
              Xóa mẫu
            </Button>
            <Button
              onClick={resetFilters}
            >
              Xóa bộ lọc
            </Button>
          </div>
          <Space wrap>
            {activeFilterTags.length > 0 ? activeFilterTags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Text type="secondary">Đang hiển thị toàn bộ phiếu nhập.</Text>}
            <Tag color="success">{`Phiếu trong tháng này: ${summary.recentReceipts}`}</Tag>
          </Space>
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={receiptsQuery.isLoading}
        columns={columns}
        dataSource={visibleRows}
        scroll={{ x: 1400 }}
        pagination={{
          current: page,
          pageSize,
          total: receiptsQuery.data?.count ?? 0,
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
          emptyText: visibleRows.length === 0 && !receiptsQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {(intentSearch || filters.status || filters.supplier || laneFilter !== 'ALL') ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy phiếu nhập phù hợp.</div>
                  <Button type="link" onClick={resetFilters}>
                    Xóa bộ lọc
                  </Button>
                </div>
              ) : 'Chưa có phiếu nhập kho.'}
            </div>
          ) : undefined,
        }}
      />

      <Modal
        open={isViewPresetModalOpen}
        title="Lưu mẫu lọc phiếu nhập mua"
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
              data-testid="purchase-receipts-preset-name"
              placeholder="Ví dụ: Đã ghi sổ theo nhà cung cấp"
              value={viewPresetName}
              onChange={(event) => setViewPresetName(event.target.value)}
              onPressEnter={() => void saveNamedPreset()}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={cancelReceipt ? `Hủy phiếu nhập ${cancelReceipt.code}` : 'Hủy phiếu nhập'}
        open={!!cancelReceipt}
        onCancel={() => setCancelReceipt(null)}
        onOk={() => void handleCancelReceipt()}
        confirmLoading={cancelMutation.isPending}
        okText="Xác nhận hủy"
        cancelText="Đóng"
      >
        <Form form={reasonForm} layout="vertical">
          <Form.Item name="reason" label="Lý do hủy" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `Chi tiết ${detail.code}` : 'Chi tiết phiếu nhập'}
        width={920}
        open={!!drawerReceipt}
        onClose={() => setDrawerReceipt(null)}
      >
        {detail ? (
          <div data-testid="purchase-receipt-detail-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Đơn mua">{detail.purchase_order_code || '-'}</Descriptions.Item>
              <Descriptions.Item label="Nhà cung cấp">{detail.supplier_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Ngày nhận">{dayjs(detail.receipt_date).format('DD/MM/YYYY')}</Descriptions.Item>
              <Descriptions.Item label="Kho">{detail.warehouse_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Vị trí">{detail.location_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <Tag color={detail.status === 'POSTED' ? 'success' : 'error'}>{RECEIPT_STATUS_LABELS[detail.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Tổng số lượng">{detail.total_qty}</Descriptions.Item>
              <Descriptions.Item label="Tổng giá trị">{formatMoney(detail.total_amount)}</Descriptions.Item>
              <Descriptions.Item label="Ghi chú" span={2}>{detail.note || '-'}</Descriptions.Item>
              {detail.cancel_reason ? <Descriptions.Item label="Lý do hủy" span={2}>{detail.cancel_reason}</Descriptions.Item> : null}
            </Descriptions>

            <Card size="small" title="Bước kế tiếp khuyến nghị">
              <div data-testid="purchase-receipt-next-states" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Tag color="blue">Hiện tại: {RECEIPT_STATUS_LABELS[detail.status]}</Tag>
                {(receiptNextStatesQuery.data?.next_states ?? []).length > 0 ? (
                  (receiptNextStatesQuery.data?.next_states ?? []).map((state) => (
                    <Tag key={state} color="gold">
                      {RECEIPT_STATUS_LABELS[state as PurchaseReceipt['status']] || state}
                    </Tag>
                  ))
                ) : (
                  <Tag>Không còn bước tiếp theo</Tag>
                )}
              </div>
            </Card>

            <Card size="small" title="Lịch sử vòng đời">
              <Table<PurchaseApprovalHistoryItem>
                data-testid="purchase-receipt-lifecycle-history"
                rowKey={(row) => `${row.action}-${row.created_at}`}
                loading={receiptLifecycleHistoryQuery.isLoading}
                dataSource={receiptLifecycleHistoryQuery.data ?? []}
                pagination={false}
                locale={{ emptyText: 'Phiếu nhập này chưa có lịch sử vòng đời.' }}
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

            <Table
              rowKey="id"
              columns={[
                { title: '#', dataIndex: 'line_number', width: 60 },
                { title: 'Mã SP', dataIndex: 'product_code', width: 120, render: (value) => value || '-' },
                { title: 'Tên SP', dataIndex: 'product_name', width: 220, render: (value) => value || '-' },
                { title: 'SL nhận', dataIndex: 'quantity', width: 120 },
                { title: 'Đơn giá', dataIndex: 'unit_cost', width: 120, render: (value) => formatMoney(value) },
                { title: 'Thành tiền', dataIndex: 'line_total', width: 140, render: (value) => formatMoney(value) },
                { title: 'Mã sổ kho', dataIndex: 'inventory_transaction_code', width: 140, render: (value) => value || '-' },
              ]}
              dataSource={detail.lines}
              pagination={false}
              scroll={{ x: 900 }}
            />
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
