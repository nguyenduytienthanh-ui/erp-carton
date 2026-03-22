import { useMemo, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
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
import { canManageInventoryData } from '../../utils/authz';
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
  { label: 'Nhap nhanh', value: 'RECEIPT' },
  { label: 'Xuat nhanh', value: 'ISSUE' },
  { label: 'Dieu chinh tang', value: 'ADJUSTMENT_IN' },
  { label: 'Dieu chinh giam', value: 'ADJUSTMENT_OUT' },
];

const salesOrderStatusLabels: Record<string, string> = {
  DRAFT: 'Nhap',
  SUBMITTED: 'Cho duyet',
  APPROVED: 'Da duyet',
  REJECTED: 'Tu choi',
  POSTED: 'Da ghi so',
  VOID: 'Da huy',
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
  const canManage = canManageInventoryData();
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
    if (!intentFilters.warehouse) return 'Tat ca kho';
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
    if (intentSearch.trim()) tags.push(`Tu khoa: ${intentSearch.trim()}`);
    if (intentFilters.warehouse) tags.push(`Kho: ${selectedWarehouseLabel}`);
    if (intentFilters.belowMinOnly) tags.push('Dang loc duoi ton toi thieu');
    if (selectedViewPreset) tags.push(`Mau loc: ${selectedViewPreset.name}`);
    return tags;
  }, [intentFilters.belowMinOnly, intentFilters.warehouse, intentSearch, selectedViewPreset, selectedWarehouseLabel]);
  const workspaceAlert = useMemo(() => {
    const belowMinCount = Number(summaryQuery.data?.below_min_count ?? 0);
    if (belowMinCount > 0) {
      return { type: 'warning' as const, title: `Co ${belowMinCount} dong ton dang duoi muc toi thieu`, description: 'Nen uu tien bo sung truoc khi tiep tuc xuat kho hoac giu cho them.' };
    }
    if (stockCommandSummary.zeroAvailableRows > 0 || stockCommandSummary.inactiveRows > 0) {
      return { type: 'info' as const, title: 'Kho van hanh co mot so diem can theo doi', description: `Co ${stockCommandSummary.zeroAvailableRows} dong het kha dung va ${stockCommandSummary.inactiveRows} dong nam o kho/vi tri tam ngung.` };
    }
    return { type: 'success' as const, title: 'Ton kho dang o trang thai on dinh', description: 'Ban co the dieu phoi nhap xuat nhanh va giu cho tren bo loc hien tai.' };
  }, [stockCommandSummary.inactiveRows, stockCommandSummary.zeroAvailableRows, summaryQuery.data?.below_min_count]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock-summary'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-reservations'] });
  };
  const createMovementMutation = useMutation({
    mutationFn: inventoryApi.createTransaction,
    onSuccess: async () => { await invalidate(); messageApi.success('Da ghi nhan giao dich kho'); },
    onError: (error) => { messageApi.error(getToastMessage(error)); },
  });
  const createReservationMutation = useMutation({
    mutationFn: inventoryApi.createReservation,
    onSuccess: async () => { await invalidate(); messageApi.success('Da tao phieu giu cho'); },
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
    if (stockRows.length === 0) { messageApi.warning('Khong co dong ton kho de xuat'); return; }
    downloadCSV(stockRows.map((row) => ({
      product_code: row.product_code, product_name: row.product_name, warehouse_name: row.warehouse_name,
      location_name: row.location_name || '', on_hand: row.on_hand, reserved: row.reserved,
      available: row.available, min_stock: row.min_stock, below_min: row.is_below_min ? 'YES' : 'NO',
    })), `inventory-stock-${dayjs().format('YYYYMMDD')}`);
  };

  const columns: ColumnsType<InventoryStockRow> = [
    { title: 'Ma SP', dataIndex: 'product_code', width: 120 },
    { title: 'Ten san pham', dataIndex: 'product_name', width: 240 },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 160 },
    { title: 'Vi tri', dataIndex: 'location_name', width: 140, render: (value) => value || '-' },
    { title: 'DVT', dataIndex: 'unit_name', width: 80, render: (value) => value || '-' },
    { title: 'Ton', dataIndex: 'on_hand', width: 100, align: 'right', render: (value) => formatQty(value) },
    { title: 'Giu cho', dataIndex: 'reserved', width: 100, align: 'right', render: (value) => formatQty(value) },
    { title: 'Kha dung', dataIndex: 'available', width: 100, align: 'right', render: (value, row) => <span style={{ color: toNumber(row.available) <= 0 ? '#cf1322' : undefined, fontWeight: toNumber(row.available) <= 0 ? 700 : undefined }}>{formatQty(value)}</span> },
    { title: 'Min', dataIndex: 'min_stock', width: 100, align: 'right', render: (value) => formatQty(value) },
    { title: 'Tinh trang', width: 240, render: (_, row) => (
      <Space wrap>
        {row.warehouse_is_active === false ? <Tag color="red">Kho ngung</Tag> : null}
        {row.location_is_active === false ? <Tag color="red">Vi tri ngung</Tag> : null}
        {row.location_type === 'RETURN' ? <Tag color="orange">Hang tra</Tag> : null}
        {toNumber(row.available) <= 0 ? <Tag color="volcano">Het kha dung</Tag> : null}
        <Tag color={row.is_below_min ? 'red' : 'green'}>{row.is_below_min ? 'Duoi min' : 'An toan'}</Tag>
      </Space>
    ) },
    { title: 'Tac vu', width: 210, fixed: 'right', render: (_, row) => {
      const moveDisabled = !canManage || row.warehouse_is_active === false || row.location_is_active === false;
      const reserveDisabled = moveDisabled || row.location_type === 'RETURN' || toNumber(row.available) <= 0;
      return (
        <Space>
          <Button size="small" disabled={moveDisabled} onClick={() => {
            setMovementRow(row);
            moveForm.setFieldsValue({ transaction_type: 'ISSUE', transaction_date: dayjs().format('YYYY-MM-DD'), quantity: Number(row.available || 0) > 0 ? 1 : 0.0001, unit_cost: 0, reference: '', reason: '', note: '' });
          }}>Nhap/xuat nhanh</Button>
          <Button size="small" type="primary" disabled={reserveDisabled} onClick={() => {
            setReservationRow(row); setSelectedOrderId(undefined); setOrderSearch('');
            reservationForm.setFieldsValue({ reservation_date: dayjs().format('YYYY-MM-DD'), reserved_qty: getSuggestedReserveQty(row), sales_order: undefined, sales_order_line: undefined, reference: '', note: '' });
          }}>Giu cho</Button>
        </Space>
      );
    } },
  ];

  const onSubmitMovement = async () => {
    if (!movementRow) return;
    const values = await moveForm.validateFields();
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
            <div className="command-center-eyebrow">Inventory command center · Allocation · Quick actions</div>
            <div className="command-center-title">Trung tam dieu phoi ton kho</div>
            <div className="command-center-description">Theo doi ton thuc te, muc giu cho, kha dung va thao tac nhanh ngay tren tung dong ton kho.</div>
            <div className="command-center-hero-badges">
              <div className="command-center-hero-badge"><InboxOutlined /><span>Kho</span><span className="command-center-hero-badge-value">{selectedWarehouseLabel}</span></div>
              <div className="command-center-hero-badge"><SafetyCertificateOutlined /><span>Duoi min</span><span className="command-center-hero-badge-value">{summaryQuery.data?.below_min_count ?? 0}</span></div>
              <div className="command-center-hero-badge"><SwapOutlined /><span>Dong rui ro</span><span className="command-center-hero-badge-value">{stockCommandSummary.riskyRows}</span></div>
            </div>
            <div className="command-center-hero-actions" data-testid="inventory-stock-command-strip">
              <div data-testid="inventory-stock-command-search">
                <Input value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setPage(1); }} placeholder="Tim san pham, kho, vi tri..." style={{ minWidth: 280, flex: '1 1 320px' }} suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xoa tim kiem" /> : undefined} />
              </div>
              <Select allowClear placeholder="Loc theo kho" style={{ width: 220 }} value={filters.warehouse} onChange={(value) => { setFilters((prev) => ({ ...prev, warehouse: value })); setPage(1); }} options={warehouseOptions} />
              <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>Xuat CSV</Button>
              <Button onClick={handleResetFilters}>Xoa bo loc</Button>
            </div>
          </div>
          <div className="command-center-hero-meta">
            <div className="command-center-hero-card"><div className="command-center-hero-card-label">Ton kha dung</div><div className="command-center-hero-card-value">{formatQty(summaryQuery.data?.total_available_qty ?? 0)}</div><div className="command-center-hero-card-caption">Khoi luong co the phan bo ngay tren bo loc hien tai.</div></div>
            <div className="command-center-hero-card"><div className="command-center-hero-card-label">Dong het kha dung</div><div className="command-center-hero-card-value">{stockCommandSummary.zeroAvailableRows}</div><div className="command-center-hero-card-caption">Nhom can canh bao truoc khi xuat them hoac giu cho.</div></div>
          </div>
        </div>
      </section>

      <div className={`command-center-finance-alert ${workspaceAlert.type === 'success' ? 'command-center-finance-alert--steady' : 'command-center-finance-alert--warning'}`}>
        <div><div className="command-center-finance-alert-title">{workspaceAlert.title}</div><div className="command-center-finance-alert-description">{workspaceAlert.description}</div></div>
        <Space wrap>
          <Tag color={intentFilters.belowMinOnly ? 'gold' : 'default'}>{intentFilters.belowMinOnly ? 'Dang loc duoi ton toi thieu' : 'Dang xem toan bo ton kho'}</Tag>
          <Tag color="cyan">{`Hien thi: ${stockRows.length}/${stockQuery.data?.count ?? 0} dong`}</Tag>
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
          <Space><span style={{ color: '#475569', fontWeight: 700 }}>Chi hien thi duoi min</span><Switch checked={filters.belowMinOnly} onChange={(checked) => { setFilters((prev) => ({ ...prev, belowMinOnly: checked })); setPage(1); }} /></Space>
        </div>
        <div className="workspace-toolbar-group">
          {activeFilterTags.length > 0 ? activeFilterTags.map((item) => <Tag key={item}>{item}</Tag>) : <span className="workspace-inline-note">Khong co bo loc bo sung tren workspace hien tai.</span>}
        </div>
      </div>

      <div className="workspace-metric-grid">
        <div className="workspace-metric-card"><div className="workspace-metric-eyebrow">Dong ton</div><div className="workspace-metric-value">{summaryQuery.data?.stock_rows ?? 0}</div><div className="workspace-metric-caption">Toan bo dong ton dang duoc theo doi.</div></div>
        <div className="workspace-metric-card workspace-metric-card--critical"><div className="workspace-metric-eyebrow">Duoi toi thieu</div><div className="workspace-metric-value">{summaryQuery.data?.below_min_count ?? 0}</div><div className="workspace-metric-caption">Nhom can bo sung de tranh hut hang.</div></div>
        <div className="workspace-metric-card"><div className="workspace-metric-eyebrow">Ton thuc te</div><div className="workspace-metric-value">{formatQty(summaryQuery.data?.total_on_hand_qty ?? 0)}</div><div className="workspace-metric-caption">Tong so luong hien co trong kho.</div></div>
        <div className="workspace-metric-card workspace-metric-card--warning"><div className="workspace-metric-eyebrow">Da giu cho</div><div className="workspace-metric-value">{formatQty(summaryQuery.data?.total_reserved_qty ?? 0)}</div><div className="workspace-metric-caption">Khoi luong da khoa cho don ban.</div></div>
        <div className="workspace-metric-card workspace-metric-card--steady"><div className="workspace-metric-eyebrow">Kha dung</div><div className="workspace-metric-value">{formatQty(summaryQuery.data?.total_available_qty ?? 0)}</div><div className="workspace-metric-caption">Luong co the dieu phoi ngay.</div></div>
        <div className="workspace-metric-card"><div className="workspace-metric-eyebrow">Return / inactive</div><div className="workspace-metric-value">{stockCommandSummary.returnRows + stockCommandSummary.inactiveRows}</div><div className="workspace-metric-caption">{`Return: ${stockCommandSummary.returnRows} · inactive: ${stockCommandSummary.inactiveRows}`}</div></div>
      </div>

      <div className="command-center-grid">
        <section className="command-center-panel">
          <div className="command-center-panel-header"><div><div className="command-center-panel-kicker">Priority lane</div><div className="command-center-panel-title">Danh muc uu tien xu ly</div><div className="command-center-panel-subtitle">Nhung dong ton can duoc doi kho va planning xu ly truoc.</div></div></div>
          <div className="command-center-watchlist">
            {priorityRows.length > 0 ? priorityRows.map((row) => (
              <div key={`${row.product_id}-${row.warehouse_id}-${row.location_id ?? '0'}`} className={`command-center-watch-item command-center-watch-item--${row.is_below_min || toNumber(row.available) <= 0 ? 'critical' : 'warning'}`}>
                <div className="command-center-watch-title">{`${row.product_code} · ${row.product_name}`}</div>
                <div className="command-center-watch-detail">{`${row.warehouse_name}${row.location_name ? ` / ${row.location_name}` : ''} · kha dung ${formatQty(row.available)} · min ${formatQty(row.min_stock)}`}</div>
                <div className="workspace-inline-note">{row.is_below_min ? 'Can bo sung som de khong tut duoi muc an toan.' : toNumber(row.available) <= 0 ? 'Khong con kha dung de giu cho hoac xuat them.' : 'Can theo doi sat do ton kho da sat nguong canh bao.'}</div>
              </div>
            )) : <div className="command-center-empty">Chua co dong ton nao de dua vao lane uu tien.</div>}
          </div>
        </section>
        <section className="command-center-panel">
          <div className="command-center-panel-header"><div><div className="command-center-panel-kicker">Playbook</div><div className="command-center-panel-title">Khung dieu phoi nhanh</div><div className="command-center-panel-subtitle">Ba quy tac de doi kho thao tac nhanh ma van giu duoc do an toan.</div></div></div>
          <div className="command-center-playbook">
            <div className="command-center-playbook-item"><div className="command-center-playbook-title">1. Xu ly dong duoi min truoc</div><div className="command-center-playbook-detail">Nhom nay tac dong truc tiep den kha nang giao hang va can duoc uu tien bo sung.</div></div>
            <div className="command-center-playbook-item"><div className="command-center-playbook-title">2. Kiem tra kha dung truoc khi giu cho</div><div className="command-center-playbook-detail">Reservation chi nen mo khi dong ton van con kha dung va khong nam o khu return.</div></div>
            <div className="command-center-playbook-item"><div className="command-center-playbook-title">3. Dung nhap/xuat nhanh cho phan ung ca</div><div className="command-center-playbook-detail">Workspace nay phu hop cho dieu chinh nhanh, giao dich phuc tap van nen di qua luong day du.</div></div>
          </div>
        </section>
      </div>

      <section className="command-center-panel">
        <div className="command-center-panel-header"><div><div className="command-center-panel-kicker">Stock table</div><div className="command-center-panel-title">Bang ton kho thuc thi</div><div className="command-center-panel-subtitle">Loc, quan sat trang thai va mo tac vu nhanh tren tung dong ton kho.</div></div></div>
        <Table rowKey={(row) => `${row.product_id}-${row.warehouse_id}-${row.location_id ?? '0'}`} loading={stockQuery.isLoading} columns={columns} dataSource={stockRows} scroll={{ x: 1500 }} pagination={{ current: page, pageSize, total: stockQuery.data?.count ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: async (nextPage, nextPageSize) => { setPage(nextPage); if (nextPageSize !== pageSize) await saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize }); } }} locale={{ emptyText: 'Khong co du lieu ton kho tren bo loc hien tai.' }} />
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

      <Modal title={movementRow ? `Nhap/xuat nhanh: ${movementRow.product_code}` : 'Nhap/xuat nhanh'} open={Boolean(movementRow)} onCancel={() => setMovementRow(null)} onOk={onSubmitMovement} confirmLoading={createMovementMutation.isPending}>
        <Form form={moveForm} layout="vertical">
          <Form.Item name="transaction_type" label="Loai giao dich" rules={[{ required: true, message: 'Bat buoc' }]}><Select options={quickMoveOptions} /></Form.Item>
          <Form.Item name="transaction_date" label="Ngay chung tu" rules={[{ required: true, message: 'Bat buoc' }]}><Input type="date" /></Form.Item>
          <Form.Item name="quantity" label="So luong" rules={[{ required: true, message: 'Bat buoc' }]}><InputNumber style={{ width: '100%' }} min={0.0001} /></Form.Item>
          <Form.Item name="unit_cost" label="Don gia von"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
          <Form.Item name="reference" label="Chung tu tham chieu"><Input /></Form.Item>
          <Form.Item name="reason" label="Ly do"><Input /></Form.Item>
          <Form.Item name="note" label="Ghi chu"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={reservationRow ? `Giu cho cho ${reservationRow.product_code}` : 'Tao phieu giu cho'} open={Boolean(reservationRow)} onCancel={() => setReservationRow(null)} onOk={onSubmitReservation} confirmLoading={createReservationMutation.isPending}>
        <Form form={reservationForm} layout="vertical">
          <div style={{ marginBottom: 12, color: '#595959' }}>Kha dung tai vi tri hien tai: <strong>{reservationRow?.available || '0'}</strong></div>
          <Form.Item name="reservation_date" label="Ngay giu cho" rules={[{ required: true, message: 'Bat buoc' }]}><Input type="date" /></Form.Item>
          <Form.Item name="sales_order" label="Don ban">
            <Select showSearch allowClear filterOption={false} onSearch={setOrderSearch} onChange={(value) => { setSelectedOrderId(value); reservationForm.setFieldValue('sales_order_line', undefined); if (!value) reservationForm.setFieldValue('reserved_qty', getSuggestedReserveQty(reservationRow)); }} options={(orderOptionsQuery.data?.results ?? []).map((item) => ({ label: `${item.code}${item.customer_name ? ` - ${item.customer_name}` : ''} [${salesOrderStatusLabels[item.status] || item.status}]`, value: item.id })).filter((item) => { const order = orderOptionsQuery.data?.results?.find((row) => row.id === item.value); return order ? ['APPROVED', 'POSTED'].includes(order.status) : true; })} />
          </Form.Item>
          <Form.Item name="sales_order_line" label="Dong hang">
            <Select allowClear onChange={(value) => { const selectedLine = matchingLines.find((line) => line.id === value); reservationForm.setFieldValue('reserved_qty', getSuggestedReserveQty(reservationRow, selectedLine)); }} options={matchingLines.map((line) => ({ label: `Dong ${line.line_number} - ${line.product_code || ''} ${line.product_name || ''} / SL ${line.qty} / da giu ${line.reserved_qty_total || '0'} / da xuat ${line.shipped_qty_total || '0'} / con can giu ${line.remaining_reservation_qty || line.qty}`, value: line.id }))} />
          </Form.Item>
          <Form.Item name="reserved_qty" label="So luong giu cho" rules={[{ required: true, message: 'Bat buoc' }]}><InputNumber style={{ width: '100%' }} min={0.0001} /></Form.Item>
          <Form.Item name="reference" label="Tham chieu"><Input /></Form.Item>
          <Form.Item name="note" label="Ghi chu"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
