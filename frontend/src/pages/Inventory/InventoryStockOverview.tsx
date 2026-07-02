import { useMemo, useState } from 'react';
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, InboxOutlined, SafetyCertificateOutlined, SwapOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';

import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { inventoryApi } from '../../api/inventory';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getToastMessage } from '../../shared/apiError';
import type { InventorySalesOrderLineOption, InventoryStockRow } from '../../types/inventory';
import { canAdjustInventoryData, canReserveInventoryData } from '../../utils/authz';
import { PAGES } from '../../utils/constants';
import { downloadCSV } from '../../utils/csvExport';

type Filters = { warehouse?: number; belowMinOnly: boolean };
type QuickMoveForm = {
  transaction_type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
  transaction_date: string;
  quantity: number;
  unit_cost?: number;
  reference?: string;
  reason?: string;
  note?: string;
};
type ReservationForm = {
  reservation_date: string;
  sales_order?: number;
  sales_order_line?: number;
  reserved_qty: number;
  reference?: string;
  note?: string;
};

type InventoryStockViewSnapshot = {
  searchInput: string;
  filters: Filters;
};

type InventoryStockNamedPreset = {
  id: string;
  name: string;
  snapshot: InventoryStockViewSnapshot;
  updatedAt: string;
};

const quickMoveOptions = [
  { label: 'Nhập nhanh', value: 'RECEIPT' },
  { label: 'Xuất nhanh', value: 'ISSUE' },
  { label: 'Điều chỉnh tăng', value: 'ADJUSTMENT_IN' },
  { label: 'Điều chỉnh giảm', value: 'ADJUSTMENT_OUT' },
];

const salesOrderStatusLabels: Record<string, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  POSTED: 'Đã ghi sổ',
  VOID: 'Đã hủy',
};

function serializeFilters(filters: Filters): string { return JSON.stringify(filters); }
function parseFilters(raw: string): Filters {
  try {
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return { warehouse: parsed.warehouse, belowMinOnly: parsed.belowMinOnly === true };
  } catch { return { belowMinOnly: false }; }
}
function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function formatQty(value: string | number | null | undefined): string {
  return toNumber(value).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
}
function getSuggestedReserveQty(row: InventoryStockRow | null, line?: InventorySalesOrderLineOption): number {
  const available = toNumber(row?.available);
  const lineNeed = line ? toNumber(line.remaining_reservation_qty ?? line.qty) : available;
  return Math.max(0, Math.min(available, lineNeed));
}
function stockRiskScore(row: InventoryStockRow): number {
  return (row.is_below_min ? 100 : 0) + (toNumber(row.available) <= 0 ? 60 : 0) + (row.warehouse_is_active === false ? 30 : 0) + (row.location_is_active === false ? 30 : 0) + (row.location_type === 'RETURN' ? 15 : 0);
}

function getStockRowNextStep(row: InventoryStockRow): string {
  if (row.warehouse_is_active === false || row.location_is_active === false) {
    return 'Kho hoặc vị trí đang ngừng, cần kiểm tra master data trước khi điều phối.';
  }
  if (row.location_type === 'RETURN') {
    return 'Hàng đang ở khu trả về, nên kiểm tra chất lượng/nguồn trả trước khi xuất hoặc giữ chỗ.';
  }
  if (toNumber(row.available) < 0) {
    return 'Khả dụng đang âm, cần đối soát giao dịch kho và reservation trước khi thao tác tiếp.';
  }
  if (toNumber(row.available) === 0) {
    return 'Không còn khả dụng; ưu tiên mua thêm, sản xuất thêm hoặc chuyển kho bổ sung.';
  }
  if (row.is_below_min) {
    return 'Tồn đã dưới mức tối thiểu; ưu tiên bổ sung hoặc chuyển kho trước khi nhận thêm đơn giữ chỗ.';
  }
  if (toNumber(row.reserved) > 0) {
    return 'Đang có lượng đã giữ chỗ; kiểm tra reservation trước khi xuất kho thủ công.';
  }
  return 'Tồn đang ổn, có thể xuất/giữ chỗ theo nhu cầu bán hàng.';
}

function getStockMovementDisabledReason(row: InventoryStockRow, canManage: boolean): string {
  if (!canManage) return 'Bạn chưa có quyền thao tác tồn kho.';
  if (row.warehouse_is_active === false) return 'Kho đang ngừng hoạt động.';
  if (row.location_is_active === false) return 'Vị trí đang ngừng hoạt động.';
  return '';
}

function getStockReservationDisabledReason(row: InventoryStockRow, canManage: boolean): string {
  const moveReason = getStockMovementDisabledReason(row, canManage);
  if (moveReason) return moveReason;
  if (row.location_type === 'RETURN') return 'Không giữ chỗ trực tiếp trên khu hàng trả.';
  if (toNumber(row.available) <= 0) return 'Không còn tồn khả dụng để giữ chỗ.';
  return '';
}

export default function InventoryStockOverview() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({ belowMinOnly: false });
  const [page, setPage] = useState(1);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const [movementRow, setMovementRow] = useState<InventoryStockRow | null>(null);
  const [reservationRow, setReservationRow] = useState<InventoryStockRow | null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<number | undefined>();
  const [moveForm] = Form.useForm<QuickMoveForm>();
  const [reservationForm] = Form.useForm<ReservationForm>();
  const canAdjust = canAdjustInventoryData();
  const canReserve = canReserveInventoryData();
  const { config, saveConfig } = useUserPreferences(PAGES.INVENTORY_STOCK);
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const pageSize = Number(configRecord.pageSize ?? 20);
  const namedPresets = useMemo<InventoryStockNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const preset = item as Partial<InventoryStockNamedPreset>;
        if (
          typeof preset.id !== 'string' ||
          typeof preset.name !== 'string' ||
          !preset.snapshot ||
          typeof preset.snapshot.searchInput !== 'string' ||
          !preset.snapshot.filters ||
          typeof preset.snapshot.filters !== 'object'
        ) {
          return null;
        }
        return {
          id: preset.id,
          name: preset.name,
          snapshot: {
            searchInput: preset.snapshot.searchInput,
            filters: parseFilters(JSON.stringify(preset.snapshot.filters)),
          },
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is InventoryStockNamedPreset => Boolean(item));
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

  const warehouseQuery = useQuery({
    queryKey: ['inventory-warehouse-options'],
    queryFn: () => inventoryApi.getWarehouses({ page_size: 200, ordering: 'code' }),
  });
  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, page_size: pageSize };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.warehouse) next.warehouse = intentFilters.warehouse;
    if (intentFilters.belowMinOnly) next.below_min_only = 'true';
    return next;
  }, [intentFilters, intentSearch, page, pageSize]);
  const stockQuery = useQuery({ queryKey: ['inventory-stock', params], queryFn: () => inventoryApi.getStock(params) });
  const summaryQuery = useQuery({ queryKey: ['inventory-stock-summary'], queryFn: () => inventoryApi.getStockSummary() });
  const orderOptionsQuery = useQuery({
    queryKey: ['inventory-sales-order-options', orderSearch],
    queryFn: () => inventoryApi.searchSalesOrders({ page_size: 20, search: orderSearch }),
    enabled: Boolean(reservationRow),
  });
  const orderDetailQuery = useQuery({
    queryKey: ['inventory-sales-order-detail', selectedOrderId],
    queryFn: () => inventoryApi.getSalesOrder(selectedOrderId as number),
    enabled: Boolean(selectedOrderId),
  });

  const stockRows = useMemo(() => stockQuery.data?.results ?? [], [stockQuery.data?.results]);
  const warehouseOptions = useMemo(() => (warehouseQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id })), [warehouseQuery.data?.results]);
  const selectedWarehouseLabel = useMemo(() => {
    if (!intentFilters.warehouse) return 'Tất cả kho';
    const warehouse = (warehouseQuery.data?.results ?? []).find((item) => item.id === intentFilters.warehouse);
    return warehouse ? `${warehouse.code} - ${warehouse.name}` : `Kho #${intentFilters.warehouse}`;
  }, [intentFilters.warehouse, warehouseQuery.data?.results]);
  const matchingLines: InventorySalesOrderLineOption[] = useMemo(() => {
    const lines = orderDetailQuery.data?.lines ?? [];
    if (!reservationRow) return [];
    return lines.filter((line) => line.product === reservationRow.product_id);
  }, [orderDetailQuery.data?.lines, reservationRow]);
  const stockCommandSummary = useMemo(() => {
    const zeroAvailableRows = stockRows.filter((row) => toNumber(row.available) <= 0).length;
    const inactiveRows = stockRows.filter((row) => row.warehouse_is_active === false || row.location_is_active === false).length;
    const returnRows = stockRows.filter((row) => row.location_type === 'RETURN').length;
    const riskyRows = stockRows.filter((row) => row.is_below_min || toNumber(row.available) <= 0 || row.warehouse_is_active === false || row.location_is_active === false).length;
    return { zeroAvailableRows, inactiveRows, returnRows, riskyRows };
  }, [stockRows]);
  const priorityRows = useMemo(() => [...stockRows].sort((left, right) => stockRiskScore(right) - stockRiskScore(left)).slice(0, 5), [stockRows]);
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.warehouse) tags.push(`Kho: ${selectedWarehouseLabel}`);
    if (intentFilters.belowMinOnly) tags.push('Đang lọc dưới tồn tối thiểu');
    if (selectedViewPreset) tags.push(`Mẫu lọc: ${selectedViewPreset.name}`);
    return tags;
  }, [intentFilters.belowMinOnly, intentFilters.warehouse, intentSearch, selectedViewPreset, selectedWarehouseLabel]);
  const workspaceAlert = useMemo(() => {
    const belowMinCount = Number(summaryQuery.data?.below_min_count ?? 0);
    if (belowMinCount > 0) {
      return { type: 'warning' as const, title: `Có ${belowMinCount} dòng tồn đang dưới mức tối thiểu`, description: 'Nên ưu tiên bổ sung trước khi tiếp tục xuất kho hoặc giữ chỗ thêm.' };
    }
    if (stockCommandSummary.zeroAvailableRows > 0 || stockCommandSummary.inactiveRows > 0) {
      return { type: 'info' as const, title: 'Kho vận hành có một số điểm cần theo dõi', description: `Có ${stockCommandSummary.zeroAvailableRows} dòng hết khả dụng và ${stockCommandSummary.inactiveRows} dòng nằm ở kho/vị trí tạm ngừng.` };
    }
    return { type: 'success' as const, title: 'Tồn kho đang ở trạng thái ổn định', description: 'Bạn có thể điều phối nhập xuất nhanh và giữ chỗ trên bộ lọc hiện tại.' };
  }, [stockCommandSummary.inactiveRows, stockCommandSummary.zeroAvailableRows, summaryQuery.data?.below_min_count]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock-summary'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-reservations'] });
  };
  const createMovementMutation = useMutation({
    mutationFn: inventoryApi.createTransaction,
    onSuccess: async () => { await invalidate(); messageApi.success('Đã ghi nhận giao dịch kho'); },
    onError: (error) => { messageApi.error(getToastMessage(error)); },
  });
  const createReservationMutation = useMutation({
    mutationFn: inventoryApi.createReservation,
    onSuccess: async () => { await invalidate(); messageApi.success('Đã tạo phiếu giữ chỗ'); },
    onError: (error) => { messageApi.error(getToastMessage(error)); },
  });

  const buildCurrentSnapshot = (): InventoryStockViewSnapshot => ({
    searchInput,
    filters,
  });

  const applySnapshot = (snapshot: InventoryStockViewSnapshot) => {
    setSearchInput(snapshot.searchInput);
    setFilters(snapshot.filters);
    setPage(1);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        saved_view: buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem tồn kho.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem tồn kho.');
    }
  };

  const applySavedView = () => {
    const raw = configRecord.saved_view as Partial<InventoryStockViewSnapshot> | undefined;
    if (!raw || typeof raw.searchInput !== 'string' || !raw.filters || typeof raw.filters !== 'object') {
      messageApi.warning('Chưa có chế độ xem tồn kho đã lưu.');
      return;
    }
    applySnapshot({
      searchInput: raw.searchInput,
      filters: parseFilters(JSON.stringify(raw.filters)),
    });
    messageApi.success('Đã khôi phục chế độ xem tồn kho.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: InventoryStockNamedPreset = {
      id:
        existing?.id ??
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}`),
      name,
      snapshot: buildCurrentSnapshot(),
      updatedAt: new Date().toISOString(),
    };
    const nextPresets = existing
      ? namedPresets.map((item) => (item.id === existing.id ? nextPreset : item))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        saved_view: configRecord.saved_view,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId(nextPreset.id);
      setIsViewPresetModalOpen(false);
      setViewPresetName('');
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc tồn kho.' : 'Đã lưu mẫu lọc tồn kho mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc tồn kho.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc tồn kho.');
      return;
    }
    applySnapshot(preset.snapshot);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc tồn kho để xóa.');
      return;
    }
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        saved_view: configRecord.saved_view,
        saved_views: namedPresets.filter((item) => item.id !== preset.id),
      });
      setSelectedViewPresetId(undefined);
      messageApi.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc tồn kho.');
    }
  };

  const handleResetFilters = () => { setSearchInput(''); setFilters({ belowMinOnly: false }); setPage(1); };
  const handleExportCSV = () => {
    if (stockRows.length === 0) { messageApi.warning('Không có dòng tồn kho để xuất'); return; }
    downloadCSV(stockRows.map((row) => ({
      'Mã SP': row.product_code, 'Tên sản phẩm': row.product_name, Kho: row.warehouse_name,
      'Vị trí': row.location_name || '', 'Tồn thực tế': row.on_hand, 'Đã giữ chỗ': row.reserved,
      'Khả dụng': row.available, Min: row.min_stock, 'Dưới min': row.is_below_min ? 'Có' : 'Không',
    })), `inventory-stock-${dayjs().format('YYYYMMDD')}`);
  };

  const columns: ColumnsType<InventoryStockRow> = [
    { title: 'Mã SP', dataIndex: 'product_code', width: 120 },
    { title: 'Tên sản phẩm', dataIndex: 'product_name', width: 240 },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 160 },
    { title: 'Vị trí', dataIndex: 'location_name', width: 140, render: (value) => value || '-' },
    { title: 'ĐVT', dataIndex: 'unit_name', width: 80, render: (value) => value || '-' },
    { title: 'Tồn', dataIndex: 'on_hand', width: 100, align: 'right', render: (value) => formatQty(value) },
    { title: 'Giữ chỗ', dataIndex: 'reserved', width: 100, align: 'right', render: (value) => formatQty(value) },
    { title: 'Khả dụng', dataIndex: 'available', width: 100, align: 'right', render: (value, row) => <span style={{ color: toNumber(row.available) <= 0 ? '#cf1322' : undefined, fontWeight: toNumber(row.available) <= 0 ? 700 : undefined }}>{formatQty(value)}</span> },
    { title: 'Min', dataIndex: 'min_stock', width: 100, align: 'right', render: (value) => formatQty(value) },
    { title: 'Tình trạng', width: 310, render: (_, row) => (
      <Space direction="vertical" size={4}>
        <Space wrap>
          {row.warehouse_is_active === false ? <Tag color="red">Kho ngừng</Tag> : null}
          {row.location_is_active === false ? <Tag color="red">Vị trí ngừng</Tag> : null}
          {row.location_type === 'RETURN' ? <Tag color="orange">Hàng trả</Tag> : null}
          {toNumber(row.available) <= 0 ? <Tag color="volcano">Hết khả dụng</Tag> : null}
          <Tag color={row.is_below_min ? 'red' : 'green'}>{row.is_below_min ? 'Dưới min' : 'An toàn'}</Tag>
        </Space>
        <span data-testid={`inventory-stock-next-step-${row.product_id}-${row.warehouse_id}-${row.location_id ?? '0'}`} style={{ color: '#595959', fontSize: 12, lineHeight: 1.45 }}>
          {getStockRowNextStep(row)}
        </span>
      </Space>
    ) },
    { title: 'Tác vụ', width: 230, fixed: 'right', render: (_, row) => {
      const moveReason = getStockMovementDisabledReason(row, canAdjust);
      const reserveReason = getStockReservationDisabledReason(row, canReserve);
      return (
        <Space>
          <Button size="small" disabled={Boolean(moveReason)} title={moveReason || 'Tạo giao dịch nhập/xuất/điều chỉnh nhanh từ dòng tồn này'} onClick={() => {
            setMovementRow(row);
            moveForm.setFieldsValue({ transaction_type: 'ISSUE', transaction_date: dayjs().format('YYYY-MM-DD'), quantity: Number(row.available || 0) > 0 ? 1 : 0.0001, unit_cost: 0, reference: '', reason: '', note: '' });
          }}>Nhập/xuất nhanh</Button>
          <Button size="small" type="primary" disabled={Boolean(reserveReason)} title={reserveReason || 'Giữ chỗ lượng khả dụng cho đơn bán'} onClick={() => {
            setReservationRow(row); setSelectedOrderId(undefined); setOrderSearch('');
            reservationForm.setFieldsValue({ reservation_date: dayjs().format('YYYY-MM-DD'), reserved_qty: getSuggestedReserveQty(row), sales_order: undefined, sales_order_line: undefined, reference: '', note: '' });
          }}>Giữ chỗ</Button>
        </Space>
      );
    } },
  ];

  const onSubmitMovement = async () => {
    if (!movementRow) return;
    const values = await moveForm.validateFields();
    const isAdjustment = values.transaction_type === 'ADJUSTMENT_IN' || values.transaction_type === 'ADJUSTMENT_OUT';
    if (isAdjustment && !values.reason?.trim()) {
      moveForm.setFields([{ name: 'reason', errors: ['Điều chỉnh tồn kho bắt buộc có lý do.'] }]);
      return;
    }
    await createMovementMutation.mutateAsync({
      transaction_type: values.transaction_type, transaction_date: values.transaction_date, product: movementRow.product_id,
      warehouse: movementRow.warehouse_id, location: movementRow.location_id ?? null, quantity: String(values.quantity),
      unit_cost: String(values.unit_cost ?? 0), reference: values.reference?.trim() || '', reason: values.reason?.trim() || '', note: values.note?.trim() || '',
    });
    setMovementRow(null);
  };
  const onSubmitReservation = async () => {
    if (!reservationRow) return;
    const values = await reservationForm.validateFields();
    await createReservationMutation.mutateAsync({
      reservation_date: values.reservation_date, sales_order: values.sales_order ?? null, sales_order_line: values.sales_order_line ?? null,
      product: reservationRow.product_id, warehouse: reservationRow.warehouse_id, location: reservationRow.location_id ?? null,
      reserved_qty: String(values.reserved_qty), reference: values.reference?.trim() || '', note: values.note?.trim() || '',
    });
    setReservationRow(null);
  };

  return (
    <div className="command-center">
      {contextHolder}
      <section className="command-center-hero">
        <div className="command-center-hero-grid">
          <div>
            <div className="command-center-eyebrow">Kho · Phân bổ · Tác vụ nhanh</div>
            <div className="command-center-title">Trung tâm điều phối tồn kho</div>
            <div className="command-center-description">Theo dõi tồn thực tế, mức giữ chỗ, khả dụng và thao tác nhanh ngay trên từng dòng tồn kho.</div>
            <div className="command-center-hero-badges">
              <div className="command-center-hero-badge"><InboxOutlined /><span>Kho</span><span className="command-center-hero-badge-value">{selectedWarehouseLabel}</span></div>
              <div className="command-center-hero-badge"><SafetyCertificateOutlined /><span>Dưới min</span><span className="command-center-hero-badge-value">{summaryQuery.data?.below_min_count ?? 0}</span></div>
              <div className="command-center-hero-badge"><SwapOutlined /><span>Dòng rủi ro</span><span className="command-center-hero-badge-value">{stockCommandSummary.riskyRows}</span></div>
            </div>
            <div className="command-center-hero-actions" data-testid="inventory-stock-command-strip">
              <div data-testid="inventory-stock-command-search">
                <Input value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setPage(1); }} placeholder="Tìm sản phẩm, kho, vị trí..." style={{ minWidth: 280, flex: '1 1 320px' }} suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined} />
              </div>
              <Select allowClear placeholder="Lọc theo kho" style={{ width: 220 }} value={filters.warehouse} onChange={(value) => { setFilters((prev) => ({ ...prev, warehouse: value })); setPage(1); }} options={warehouseOptions} />
              <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>Xuất CSV</Button>
              <Button onClick={handleResetFilters}>Xóa bộ lọc</Button>
            </div>
          </div>
          <div className="command-center-hero-meta">
            <div className="command-center-hero-card"><div className="command-center-hero-card-label">Tồn khả dụng</div><div className="command-center-hero-card-value">{formatQty(summaryQuery.data?.total_available_qty ?? 0)}</div><div className="command-center-hero-card-caption">Khối lượng có thể phân bổ ngay trên bộ lọc hiện tại.</div></div>
            <div className="command-center-hero-card"><div className="command-center-hero-card-label">Dòng hết khả dụng</div><div className="command-center-hero-card-value">{stockCommandSummary.zeroAvailableRows}</div><div className="command-center-hero-card-caption">Nhóm cần cảnh báo trước khi xuất thêm hoặc giữ chỗ.</div></div>
          </div>
        </div>
      </section>

      <div className={`command-center-finance-alert ${workspaceAlert.type === 'success' ? 'command-center-finance-alert--steady' : 'command-center-finance-alert--warning'}`}>
        <div><div className="command-center-finance-alert-title">{workspaceAlert.title}</div><div className="command-center-finance-alert-description">{workspaceAlert.description}</div></div>
        <Space wrap>
          <Tag color={intentFilters.belowMinOnly ? 'gold' : 'default'}>{intentFilters.belowMinOnly ? 'Đang lọc dưới tồn tối thiểu' : 'Đang xem toàn bộ tồn kho'}</Tag>
          <Tag color="cyan">{`Hiển thị: ${stockRows.length}/${stockQuery.data?.count ?? 0} dòng`}</Tag>
        </Space>
      </div>

      <div className="workspace-toolbar">
        <div className="workspace-toolbar-group">
          <Button data-testid="inventory-stock-save-view" onClick={() => void saveCurrentView()}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="inventory-stock-restore-view" onClick={applySavedView}>
            Khôi phục
          </Button>
          <Button
            data-testid="inventory-stock-open-preset-modal"
            onClick={() => {
              setViewPresetName(selectedViewPreset?.name ?? '');
              setIsViewPresetModalOpen(true);
            }}
          >
            Tạo mẫu lọc
          </Button>
          <div data-testid="inventory-stock-preset-select">
            <Select
              style={{ width: 240 }}
              placeholder="Chọn mẫu lọc tồn kho"
              value={selectedViewPresetId}
              onChange={(value) => setSelectedViewPresetId(value)}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          </div>
          <Button data-testid="inventory-stock-apply-preset" onClick={applyNamedPreset}>
            Áp dụng mẫu
          </Button>
          <Button danger data-testid="inventory-stock-delete-preset" onClick={() => void deleteNamedPreset()}>
            Xóa mẫu
          </Button>
        </div>
        <div className="workspace-toolbar-group">
          <Space><span style={{ color: '#475569', fontWeight: 700 }}>Chỉ hiển thị dưới min</span><Switch checked={filters.belowMinOnly} onChange={(checked) => { setFilters((prev) => ({ ...prev, belowMinOnly: checked })); setPage(1); }} /></Space>
        </div>
        <div className="workspace-toolbar-group">
          {activeFilterTags.length > 0 ? activeFilterTags.map((item) => <Tag key={item}>{item}</Tag>) : <span className="workspace-inline-note">Không có bộ lọc bổ sung trên workspace hiện tại.</span>}
        </div>
      </div>

      <div className="workspace-metric-grid">
        <div className="workspace-metric-card"><div className="workspace-metric-eyebrow">Dòng tồn</div><div className="workspace-metric-value">{summaryQuery.data?.stock_rows ?? 0}</div><div className="workspace-metric-caption">Toàn bộ dòng tồn đang được theo dõi.</div></div>
        <div className="workspace-metric-card workspace-metric-card--critical"><div className="workspace-metric-eyebrow">Dưới tối thiểu</div><div className="workspace-metric-value">{summaryQuery.data?.below_min_count ?? 0}</div><div className="workspace-metric-caption">Nhóm cần bổ sung để tránh hụt hàng.</div></div>
        <div className="workspace-metric-card"><div className="workspace-metric-eyebrow">Tồn thực tế</div><div className="workspace-metric-value">{formatQty(summaryQuery.data?.total_on_hand_qty ?? 0)}</div><div className="workspace-metric-caption">Tổng số lượng hiện có trong kho.</div></div>
        <div className="workspace-metric-card workspace-metric-card--warning"><div className="workspace-metric-eyebrow">Đã giữ chỗ</div><div className="workspace-metric-value">{formatQty(summaryQuery.data?.total_reserved_qty ?? 0)}</div><div className="workspace-metric-caption">Khối lượng đã khóa cho đơn bán.</div></div>
        <div className="workspace-metric-card workspace-metric-card--steady"><div className="workspace-metric-eyebrow">Khả dụng</div><div className="workspace-metric-value">{formatQty(summaryQuery.data?.total_available_qty ?? 0)}</div><div className="workspace-metric-caption">Lượng có thể điều phối ngay.</div></div>
        <div className="workspace-metric-card"><div className="workspace-metric-eyebrow">Return / inactive</div><div className="workspace-metric-value">{stockCommandSummary.returnRows + stockCommandSummary.inactiveRows}</div><div className="workspace-metric-caption">{`Return: ${stockCommandSummary.returnRows} · inactive: ${stockCommandSummary.inactiveRows}`}</div></div>
      </div>

      <div className="command-center-grid">
        <section className="command-center-panel">
          <div className="command-center-panel-header"><div><div className="command-center-panel-kicker">Priority lane</div><div className="command-center-panel-title">Danh mục ưu tiên xử lý</div><div className="command-center-panel-subtitle">Những dòng tồn cần được đội kho và planning xử lý trước.</div></div></div>
          <div className="command-center-watchlist">
            {priorityRows.length > 0 ? priorityRows.map((row) => (
              <div key={`${row.product_id}-${row.warehouse_id}-${row.location_id ?? '0'}`} className={`command-center-watch-item command-center-watch-item--${row.is_below_min || toNumber(row.available) <= 0 ? 'critical' : 'warning'}`}>
                <div className="command-center-watch-title">{`${row.product_code} · ${row.product_name}`}</div>
                <div className="command-center-watch-detail">{`${row.warehouse_name}${row.location_name ? ` / ${row.location_name}` : ''} · khả dụng ${formatQty(row.available)} · min ${formatQty(row.min_stock)}`}</div>
                <div className="workspace-inline-note">{getStockRowNextStep(row)}</div>
              </div>
            )) : <div className="command-center-empty">Chưa có dòng tồn nào để đưa vào lane ưu tiên.</div>}
          </div>
        </section>
        <section className="command-center-panel">
          <div className="command-center-panel-header"><div><div className="command-center-panel-kicker">Playbook</div><div className="command-center-panel-title">Khung điều phối nhanh</div><div className="command-center-panel-subtitle">Ba quy tắc để đội kho thao tác nhanh mà vẫn giữ được độ an toàn.</div></div></div>
          <div className="command-center-playbook">
            <div className="command-center-playbook-item"><div className="command-center-playbook-title">1. Xử lý dòng dưới min trước</div><div className="command-center-playbook-detail">Nhóm này tác động trực tiếp đến khả năng giao hàng và cần được ưu tiên bổ sung.</div></div>
            <div className="command-center-playbook-item"><div className="command-center-playbook-title">2. Kiểm tra khả dụng trước khi giữ chỗ</div><div className="command-center-playbook-detail">Reservation chỉ nên mở khi dòng tồn vẫn còn khả dụng và không nằm ở khu return.</div></div>
            <div className="command-center-playbook-item"><div className="command-center-playbook-title">3. Dùng nhập/xuất nhanh cho phản ứng ca</div><div className="command-center-playbook-detail">Workspace này phù hợp cho điều chỉnh nhanh, giao dịch phức tạp vẫn nên đi qua luồng đầy đủ.</div></div>
          </div>
        </section>
      </div>

      <section className="command-center-panel">
        <div className="command-center-panel-header"><div><div className="command-center-panel-kicker">Stock table</div><div className="command-center-panel-title">Bảng tồn kho thực thi</div><div className="command-center-panel-subtitle">Lọc, quan sát trạng thái và mở tác vụ nhanh trên từng dòng tồn kho.</div></div></div>
        <Table rowKey={(row) => `${row.product_id}-${row.warehouse_id}-${row.location_id ?? '0'}`} loading={stockQuery.isLoading} columns={columns} dataSource={stockRows} scroll={{ x: 1500 }} pagination={{ current: page, pageSize, total: stockQuery.data?.count ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: async (nextPage, nextPageSize) => { setPage(nextPage); if (nextPageSize !== pageSize) await saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize }); } }} locale={{ emptyText: <Empty description="Không có dữ liệu tồn kho trên bộ lọc hiện tại." /> }} />
      </section>

      <Modal
        title="Lưu mẫu lọc tồn kho"
        open={isViewPresetModalOpen}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Đóng"
      >
        <Form layout="vertical">
          <Form.Item label="Tên mẫu lọc">
            <Input
              data-testid="inventory-stock-preset-name"
              value={viewPresetName}
              onChange={(event) => setViewPresetName(event.target.value)}
              placeholder="Ví dụ: Chạm đáy tồn - kho thành phẩm"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={movementRow ? `Nhập/xuất nhanh: ${movementRow.product_code}` : 'Nhập/xuất nhanh'} open={Boolean(movementRow)} onCancel={() => setMovementRow(null)} onOk={onSubmitMovement} confirmLoading={createMovementMutation.isPending}>
        <Form form={moveForm} layout="vertical">
          <Alert
            showIcon
            type="info"
            message={movementRow ? getStockRowNextStep(movementRow) : 'Kiểm tra dòng tồn trước khi ghi giao dịch'}
            description="Giao dịch nhanh sẽ ghi vào sổ kho theo contract hiện có. Với nghiệp vụ phức tạp, nên đi qua luồng chứng từ đầy đủ."
            style={{ marginBottom: 16 }}
          />
          <Form.Item name="transaction_type" label="Loại giao dịch" rules={[{ required: true, message: 'Bắt buộc' }]}><Select options={quickMoveOptions} /></Form.Item>
          <Form.Item name="transaction_date" label="Ngày chứng từ" rules={[{ required: true, message: 'Bắt buộc' }]}><Input type="date" /></Form.Item>
          <Form.Item name="quantity" label="Số lượng" rules={[{ required: true, message: 'Bắt buộc' }]}><InputNumber style={{ width: '100%' }} min={0.0001} /></Form.Item>
          <Form.Item name="unit_cost" label="Đơn giá vốn"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
          <Form.Item name="reference" label="Chứng từ tham chiếu"><Input /></Form.Item>
          <Form.Item name="reason" label="Lý do"><Input /></Form.Item>
          <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={reservationRow ? `Giữ chỗ cho ${reservationRow.product_code}` : 'Tạo phiếu giữ chỗ'} open={Boolean(reservationRow)} onCancel={() => setReservationRow(null)} onOk={onSubmitReservation} confirmLoading={createReservationMutation.isPending}>
        <Form form={reservationForm} layout="vertical">
          <Alert
            showIcon
            type="info"
            message={reservationRow ? `Khả dụng tại vị trí hiện tại: ${reservationRow.available || '0'}` : 'Tạo phiếu giữ chỗ'}
            description={reservationRow ? getStockRowNextStep(reservationRow) : 'Chọn dòng tồn còn khả dụng để giữ cho đơn bán.'}
            style={{ marginBottom: 16 }}
          />
          <Form.Item name="reservation_date" label="Ngày giữ chỗ" rules={[{ required: true, message: 'Bắt buộc' }]}><Input type="date" /></Form.Item>
          <Form.Item name="sales_order" label="Đơn bán">
            <Select showSearch allowClear filterOption={false} onSearch={setOrderSearch} onChange={(value) => { setSelectedOrderId(value); reservationForm.setFieldValue('sales_order_line', undefined); if (!value) reservationForm.setFieldValue('reserved_qty', getSuggestedReserveQty(reservationRow)); }} options={(orderOptionsQuery.data?.results ?? []).map((item) => ({ label: `${item.code}${item.customer_name ? ` - ${item.customer_name}` : ''} [${salesOrderStatusLabels[item.status] || item.status}]`, value: item.id })).filter((item) => { const order = orderOptionsQuery.data?.results?.find((row) => row.id === item.value); return order ? ['APPROVED', 'POSTED'].includes(order.status) : true; })} />
          </Form.Item>
          <Form.Item name="sales_order_line" label="Dòng hàng">
            <Select allowClear onChange={(value) => { const selectedLine = matchingLines.find((line) => line.id === value); reservationForm.setFieldValue('reserved_qty', getSuggestedReserveQty(reservationRow, selectedLine)); }} options={matchingLines.map((line) => ({ label: `Dòng ${line.line_number} - ${line.product_code || ''} ${line.product_name || ''} / SL ${line.qty} / đã giữ ${line.reserved_qty_total || '0'} / đã xuất ${line.shipped_qty_total || '0'} / còn cần giữ ${line.remaining_reservation_qty || line.qty}`, value: line.id }))} />
          </Form.Item>
          <Form.Item name="reserved_qty" label="Số lượng giữ chỗ" rules={[{ required: true, message: 'Bắt buộc' }]}><InputNumber style={{ width: '100%' }} min={0.0001} /></Form.Item>
          <Form.Item name="reference" label="Tham chiếu"><Input /></Form.Item>
          <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
