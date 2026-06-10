import { useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/inventory';
import { productsApi } from '../../api/products';
import type { InventoryNxtReportRow, InventoryNxtSourceBreakdownItem, InventoryNxtSourceType, InventorySourceType, InventoryTransaction } from '../../types/inventory';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageInventoryData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';

type Filters = {
  warehouse?: number;
  product?: number;
  transaction_type?: string;
  status?: InventoryTransaction['status'];
  transaction_date__gte?: string;
  transaction_date__lte?: string;
  source_type?: InventorySourceType;
};

type InventoryTransactionViewSnapshot = {
  search: string;
  warehouse?: number;
  product?: number;
  transaction_type?: string;
  status?: InventoryTransaction['status'];
  transaction_date__gte?: string;
  transaction_date__lte?: string;
  source_type?: InventorySourceType;
};

type InventoryTransactionNamedPreset = {
  id: string;
  name: string;
  filters: InventoryTransactionViewSnapshot;
};

type FormValues = {
  transaction_type: InventoryTransaction['transaction_type'];
  transaction_date: string;
  product: number;
  warehouse?: number;
  location?: number | null;
  target_warehouse?: number | null;
  target_location?: number | null;
  quantity: number;
  unit_cost?: number;
  reference?: string;
  reason?: string;
  note?: string;
};

type CancelFormValues = {
  reason: string;
};

type NxtFilters = {
  date_from: string;
  date_to: string;
  warehouse?: number;
  product?: number;
};

const TYPE_LABELS: Record<InventoryTransaction['transaction_type'], string> = {
  RECEIPT: 'Nhập kho',
  ISSUE: 'Xuất kho',
  TRANSFER: 'Chuyển kho',
  ADJUSTMENT_IN: 'Điều chỉnh tăng',
  ADJUSTMENT_OUT: 'Điều chỉnh giảm',
};

const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const TYPE_COLORS: Record<InventoryTransaction['transaction_type'], string> = {
  RECEIPT: 'success',
  ISSUE: 'volcano',
  TRANSFER: 'processing',
  ADJUSTMENT_IN: 'gold',
  ADJUSTMENT_OUT: 'purple',
};

const STATUS_LABELS: Record<InventoryTransaction['status'], string> = {
  POSTED: 'Đã ghi sổ',
  CANCELLED: 'Đã hủy',
};

const STATUS_COLORS: Record<InventoryTransaction['status'], string> = {
  POSTED: 'green',
  CANCELLED: 'red',
};

const STATUS_NEXT_STEPS: Record<InventoryTransaction['status'], string> = {
  POSTED: 'Chứng từ đã ghi vào sổ kho; chỉ hủy khi đã xác minh sai lệch.',
  CANCELLED: 'Chứng từ đã hủy, kiểm tra lý do hủy khi đối soát tồn kho.',
};

function getTransactionNextStep(row: InventoryTransaction): string {
  return STATUS_NEXT_STEPS[row.status] ?? 'Kiểm tra trạng thái chứng từ trước khi thao tác tiếp.';
}

function getCancelTransactionDisabledReason(row: InventoryTransaction, canManage: boolean): string {
  if (!canManage) return 'Bạn chưa có quyền hủy chứng từ kho.';
  if (row.status !== 'POSTED') return 'Chỉ hủy được chứng từ đã ghi sổ.';
  return '';
}

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const SOURCE_TYPE_LABELS: Record<string, string> = {
  PURCHASE: 'Mua hàng',
  PRODUCTION: 'Sản xuất',
  STOCKTAKE: 'Kiểm tồn',
  TRANSFER: 'Chuyển kho',
  RESERVATION: 'Giữ chỗ',
  SALES: 'Đơn bán',
  SHIPMENT: 'Giao hàng',
  MANUAL: 'Thủ công',
};

const SOURCE_TYPE_OPTIONS = Object.entries(SOURCE_TYPE_LABELS).map(([value, label]) => ({
  value: value as InventorySourceType,
  label,
}));

const NXT_SOURCE_TYPES: InventoryNxtSourceType[] = ['PURCHASE', 'PRODUCTION', 'STOCKTAKE', 'TRANSFER', 'MANUAL'];

const SOURCE_TYPE_COLORS: Record<InventorySourceType, string> = {
  PURCHASE: 'green',
  PRODUCTION: 'orange',
  STOCKTAKE: 'purple',
  TRANSFER: 'processing',
  RESERVATION: 'blue',
  SALES: 'geekblue',
  SHIPMENT: 'cyan',
  MANUAL: 'default',
};

const SOURCE_DOCUMENT_LABELS: Record<string, string> = {
  PURCHASE_RECEIPT: 'Phiếu nhập mua',
  PURCHASE_ORDER: 'Đơn mua',
  PURCHASE_REFERENCE: 'Tham chiếu mua hàng',
  PRODUCTION_ISSUE: 'Cấp vật tư sản xuất',
  PRODUCTION_RECEIPT: 'Nhập thành phẩm',
  PRODUCTION_ORDER: 'Lệnh sản xuất',
  PRODUCTION_REFERENCE: 'Tham chiếu sản xuất',
  STOCKTAKE: 'Kiểm tồn',
  TRANSFER_TRANSACTION: 'Chuyển kho thủ công',
  WAREHOUSE_TRANSFER_REFERENCE: 'Phiếu chuyển kho',
  RESERVATION: 'Giữ chỗ',
  SHIPMENT: 'Giao hàng',
  SALES_ORDER: 'Đơn bán',
  MANUAL: 'Thủ công',
};

const SOURCE_WARNING_LABELS: Record<string, string> = {
  PURCHASE_RECEIPT_LINK_MISSING: 'Thiếu link phiếu nhập',
  PRODUCTION_DOCUMENT_LINK_MISSING: 'Thiếu chứng từ sản xuất',
  TRANSFER_TARGET_WAREHOUSE_MISSING: 'Thiếu kho đích',
  TRANSFER_REFERENCE_ONLY: 'Nhận diện từ tham chiếu',
  PURCHASE_REFERENCE_ONLY: 'Nhận diện từ tham chiếu',
  PRODUCTION_REFERENCE_ONLY: 'Nhận diện từ tham chiếu',
};

const emptyForm: FormValues = {
  transaction_type: 'RECEIPT',
  transaction_date: dayjs().format('YYYY-MM-DD'),
  product: 0,
  warehouse: undefined,
  location: null,
  target_warehouse: null,
  target_location: null,
  quantity: 1,
  unit_cost: 0,
  reference: '',
  reason: '',
  note: '',
};

const { Text, Title } = Typography;

const SUMMARY_TILE_STYLE = {
  height: '100%',
  borderRadius: 14,
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

function parseViewSnapshot(value: unknown): InventoryTransactionViewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  return {
    search: typeof obj.search === 'string' ? obj.search : '',
    warehouse: typeof obj.warehouse === 'number' ? obj.warehouse : undefined,
    product: typeof obj.product === 'number' ? obj.product : undefined,
    transaction_type: typeof obj.transaction_type === 'string' ? obj.transaction_type : undefined,
    status: typeof obj.status === 'string' ? (obj.status as InventoryTransaction['status']) : undefined,
    transaction_date__gte: typeof obj.transaction_date__gte === 'string' ? obj.transaction_date__gte : undefined,
    transaction_date__lte: typeof obj.transaction_date__lte === 'string' ? obj.transaction_date__lte : undefined,
    source_type: typeof obj.source_type === 'string' ? (obj.source_type as InventorySourceType) : undefined,
  };
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatQty(value: string | number | null | undefined): string {
  return toNumber(value).toLocaleString('vi-VN', { maximumFractionDigits: 4 });
}

function getTransactionSource(row: InventoryTransaction): { label: string; color: string; detail?: string | null } {
  if (row.stocktake_code) {
    return { label: 'Kiểm tồn', color: 'purple', detail: row.stocktake_code };
  }
  if (row.reservation_code) {
    return { label: 'Giữ chỗ', color: 'blue', detail: row.reservation_code };
  }
  if (row.shipment_batch_code) {
    return { label: 'Giao hàng', color: 'cyan', detail: row.shipment_batch_code };
  }
  if (row.sales_order_code) {
    return { label: 'Đơn bán', color: 'geekblue', detail: row.sales_order_code };
  }
  return { label: 'Thủ công', color: 'default', detail: row.reference || row.reason || null };
}

function getSourceTypeLabel(value?: string | null): string {
  if (!value) return '';
  return SOURCE_TYPE_LABELS[value] ?? value;
}

function getSourceDocumentLabel(value?: string | null): string {
  if (!value) return '';
  return SOURCE_DOCUMENT_LABELS[value] ?? value;
}

function getSourceWarningLabels(values?: string[] | null): string[] {
  return (values ?? []).map((value) => SOURCE_WARNING_LABELS[value] ?? value);
}

function getSourceDisplay(row: InventoryTransaction): {
  label: string;
  color: string;
  detail?: string | null;
  documentLabel?: string;
  reference?: string;
  warnings: string[];
} {
  const audit = row.source_audit;
  const sourceType = row.source_type ?? audit?.type;
  if (!sourceType) {
    return { ...getTransactionSource(row), warnings: [] };
  }
  const warnings = row.source_warnings ?? audit?.warning_flags ?? [];
  return {
    label: row.source_label ?? audit?.label ?? getSourceTypeLabel(sourceType),
    color: SOURCE_TYPE_COLORS[sourceType] ?? 'default',
    detail: row.source_code ?? audit?.code ?? (row.reference || null),
    documentLabel: getSourceDocumentLabel(row.source_document_type ?? audit?.document_type),
    reference: audit?.reference || row.reference || '',
    warnings: getSourceWarningLabels(warnings),
  };
}

function getNxtRowKey(row: InventoryNxtReportRow): string {
  return `${row.product_id}-${row.warehouse_id ?? 'none'}`;
}

function getNxtSourceBreakdownItem(row: InventoryNxtReportRow, sourceType: InventoryNxtSourceType): InventoryNxtSourceBreakdownItem {
  return row.source_breakdown?.[sourceType] ?? {
    source_type: sourceType,
    source_label: getSourceTypeLabel(sourceType),
    in_qty: '0',
    out_qty: '0',
    net_qty: '0',
    count: 0,
    source_document_types: {},
    source_warnings: {},
  };
}

function hasNxtSourceMovement(item: InventoryNxtSourceBreakdownItem): boolean {
  return toNumber(item.in_qty) !== 0 || toNumber(item.out_qty) !== 0 || toNumber(item.net_qty) !== 0 || item.count > 0;
}

function formatNxtCounter(
  counter: Record<string, number> | undefined,
  labelFn: (value: string) => string = (value) => value,
): string {
  return Object.entries(counter ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([key, count]) => `${labelFn(key)} (${count})`)
    .join('; ');
}

function getNxtDocumentTypesSummary(row: InventoryNxtReportRow): string {
  const rowSummary = formatNxtCounter(row.source_document_types, getSourceDocumentLabel);
  if (rowSummary) return rowSummary;
  const merged: Record<string, number> = {};
  NXT_SOURCE_TYPES.forEach((sourceType) => {
    const item = getNxtSourceBreakdownItem(row, sourceType);
    Object.entries(item.source_document_types ?? {}).forEach(([key, count]) => {
      merged[key] = (merged[key] ?? 0) + Number(count ?? 0);
    });
  });
  return formatNxtCounter(merged, getSourceDocumentLabel);
}

function getNxtWarningsSummary(row: InventoryNxtReportRow): string {
  const rowSummary = formatNxtCounter(row.source_warnings, (value) => SOURCE_WARNING_LABELS[value] ?? value);
  if (rowSummary) return rowSummary;
  const merged: Record<string, number> = {};
  NXT_SOURCE_TYPES.forEach((sourceType) => {
    const item = getNxtSourceBreakdownItem(row, sourceType);
    Object.entries(item.source_warnings ?? {}).forEach(([key, count]) => {
      merged[key] = (merged[key] ?? 0) + Number(count ?? 0);
    });
  });
  return formatNxtCounter(merged, (value) => SOURCE_WARNING_LABELS[value] ?? value);
}

function buildNxtSourceBreakdownCsvColumns(row: InventoryNxtReportRow): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  NXT_SOURCE_TYPES.forEach((sourceType) => {
    const item = getNxtSourceBreakdownItem(row, sourceType);
    const label = getSourceTypeLabel(sourceType);
    result[`${label} - Nhập`] = item.in_qty || '0';
    result[`${label} - Xuất`] = item.out_qty || '0';
    result[`${label} - Net`] = item.net_qty || '0';
    result[`${label} - Số GD`] = item.count ?? 0;
  });
  return result;
}

export default function InventoryTransactionList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [nxtFilters, setNxtFilters] = useState<NxtFilters>({
    date_from: dayjs().startOf('month').format('YYYY-MM-DD'),
    date_to: dayjs().format('YYYY-MM-DD'),
  });
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [page, setPage] = useState(1);
  const [openModal, setOpenModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<InventoryTransaction | null>(null);
  const [form] = Form.useForm<FormValues>();
  const [cancelForm] = Form.useForm<CancelFormValues>();
  const canManage = canManageInventoryData();
  const {
    config,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.INVENTORY_TRANSACTIONS);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord.pageSize ?? 20);
  const txType = Form.useWatch('transaction_type', form);
  const sourceWarehouseId = Form.useWatch('warehouse', form);
  const targetWarehouseId = Form.useWatch('target_warehouse', form);

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
  const sourceLocationQuery = useQuery({
    queryKey: ['inventory-location-options-source', sourceWarehouseId],
    queryFn: () => inventoryApi.getLocations({ page_size: 200, warehouse: sourceWarehouseId, ordering: 'code' }),
    enabled: Boolean(sourceWarehouseId),
  });
  const targetLocationQuery = useQuery({
    queryKey: ['inventory-location-options-target', targetWarehouseId],
    queryFn: () => inventoryApi.getLocations({ page_size: 200, warehouse: targetWarehouseId, ordering: 'code' }),
    enabled: Boolean(targetWarehouseId),
  });
  const productQuery = useQuery({
    queryKey: ['inventory-product-options'],
    queryFn: () => productsApi.getProducts({ page_size: 200, ordering: 'code' }),
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: '-transaction_date' };
    if (intentSearch.trim()) next.search = intentSearch.trim();
    if (intentFilters.warehouse) next.warehouse_involved = intentFilters.warehouse;
    if (intentFilters.product) next.product = intentFilters.product;
    if (intentFilters.transaction_type) next.transaction_type = intentFilters.transaction_type;
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.transaction_date__gte) next.transaction_date__gte = intentFilters.transaction_date__gte;
    if (intentFilters.transaction_date__lte) next.transaction_date__lte = intentFilters.transaction_date__lte;
    if (intentFilters.source_type) next.source_type = intentFilters.source_type;
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['inventory-transactions', params],
    queryFn: () => inventoryApi.getTransactions(params),
  });

  const nxtParams = useMemo(() => {
    const next: { date_from: string; date_to: string; warehouse?: number; product?: number } = {
      date_from: nxtFilters.date_from,
      date_to: nxtFilters.date_to,
    };
    if (nxtFilters.warehouse) next.warehouse = nxtFilters.warehouse;
    if (nxtFilters.product) next.product = nxtFilters.product;
    return next;
  }, [nxtFilters]);

  const nxtQuery = useQuery({
    queryKey: ['inventory-nxt-report', nxtParams],
    queryFn: () => inventoryApi.getNxtReport(nxtParams),
    enabled: Boolean(nxtFilters.date_from && nxtFilters.date_to),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock-summary'] });
  };

  const createMutation = useMutation({
    mutationFn: inventoryApi.createTransaction,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã tạo giao dịch kho');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => inventoryApi.cancelTransaction(id, reason),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã hủy chứng từ kho');
      setCancelTarget(null);
      cancelForm.resetFields();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const warehouseLabelMap = useMemo(
    () =>
      Object.fromEntries(
        (warehouseQuery.data?.results ?? []).map((item) => [item.id, `${item.code} - ${item.name}`]),
      ) as Record<number, string>,
    [warehouseQuery.data?.results],
  );
  const productLabelMap = useMemo(
    () =>
      Object.fromEntries(
        (productQuery.data?.results ?? []).map((item) => [item.id, `${item.code} - ${item.name}`]),
      ) as Record<number, string>,
    [productQuery.data?.results],
  );

  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const nxtRows = useMemo(() => nxtQuery.data?.results ?? [], [nxtQuery.data?.results]);

  const summary = useMemo(() => {
    const postedCount = rows.filter((item) => item.status === 'POSTED').length;
    const cancelledCount = rows.filter((item) => item.status === 'CANCELLED').length;
    const transferCount = rows.filter((item) => item.transaction_type === 'TRANSFER').length;
    const adjustmentCount = rows.filter((item) => item.transaction_type === 'ADJUSTMENT_IN' || item.transaction_type === 'ADJUSTMENT_OUT').length;
    const totalQty = rows.reduce((total, item) => total + Number(item.quantity || 0), 0);
    const totalAmount = rows.reduce((total, item) => {
      if (item.amount) {
        return total + Number(item.amount);
      }
      return total + Number(item.quantity || 0) * Number(item.unit_cost || 0);
    }, 0);
    return {
      postedCount,
      cancelledCount,
      transferCount,
      adjustmentCount,
      totalQty,
      totalAmount,
    };
  }, [rows]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) {
      tags.push(`Tìm kiếm: ${intentSearch.trim()}`);
    }
    if (filters.warehouse) {
      tags.push(`Kho: ${warehouseLabelMap[filters.warehouse] ?? `#${filters.warehouse}`}`);
    }
    if (filters.product) {
      tags.push(`Sản phẩm: ${productLabelMap[filters.product] ?? `#${filters.product}`}`);
    }
    if (filters.transaction_type) {
      tags.push(`Loại: ${TYPE_LABELS[filters.transaction_type as InventoryTransaction['transaction_type']] ?? filters.transaction_type}`);
    }
    if (filters.status) {
      tags.push(`Trạng thái: ${STATUS_LABELS[filters.status]}`);
    }
    if (filters.transaction_date__gte || filters.transaction_date__lte) {
      tags.push(`Kỳ: ${filters.transaction_date__gte || '...'} - ${filters.transaction_date__lte || '...'}`);
    }
    if (filters.source_type) {
      tags.push(`Nguồn: ${getSourceTypeLabel(filters.source_type)}`);
    }
    return tags;
  }, [
    filters.product,
    filters.source_type,
    filters.status,
    filters.transaction_date__gte,
    filters.transaction_date__lte,
    filters.transaction_type,
    filters.warehouse,
    intentSearch,
    productLabelMap,
    warehouseLabelMap,
  ]);
  const namedPresets = useMemo<InventoryTransactionNamedPreset[]>(() => {
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
      warehouse: configRecord.warehouse,
      product: configRecord.product,
      transaction_type: configRecord.transaction_type,
      status: configRecord.status,
      transaction_date__gte: configRecord.transaction_date__gte,
      transaction_date__lte: configRecord.transaction_date__lte,
      source_type: configRecord.source_type,
    });
  }, [
    configRecord.product,
    configRecord.saved_view_snapshot,
    configRecord.search,
    configRecord.source_type,
    configRecord.status,
    configRecord.transaction_date__gte,
    configRecord.transaction_date__lte,
    configRecord.transaction_type,
    configRecord.warehouse,
  ]);
  const commandContextTags = useMemo(() => {
    if (!selectedPreset) return activeFilterTags;
    return [...activeFilterTags, `Mẫu đang dùng: ${selectedPreset.name}`];
  }, [activeFilterTags, selectedPreset]);

  const buildCurrentSnapshot = (): InventoryTransactionViewSnapshot => ({
    search: searchInput,
    warehouse: filters.warehouse,
    product: filters.product,
    transaction_type: filters.transaction_type,
    status: filters.status,
    transaction_date__gte: filters.transaction_date__gte,
    transaction_date__lte: filters.transaction_date__lte,
    source_type: filters.source_type,
  });

  const applySnapshot = (snapshot: InventoryTransactionViewSnapshot) => {
    setSearchInput(snapshot.search);
    setFilters({
      warehouse: snapshot.warehouse,
      product: snapshot.product,
      transaction_type: snapshot.transaction_type,
      status: snapshot.status,
      transaction_date__gte: snapshot.transaction_date__gte,
      transaction_date__lte: snapshot.transaction_date__lte,
      source_type: snapshot.source_type,
    });
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
      messageApi.success('Đã lưu chế độ xem sổ kho.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem sổ kho.');
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
    const nextPreset: InventoryTransactionNamedPreset = existing
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

  const handleExportTransactionsCSV = () => {
    if (rows.length === 0) {
      messageApi.warning('Không có giao dịch kho để xuất.');
      return;
    }
    downloadCSV(
      rows.map((row) => {
        const source = getSourceDisplay(row);
        return {
          'Mã CT': row.code,
          Ngày: row.transaction_date,
          Loại: TYPE_LABELS[row.transaction_type],
          'Trạng thái': STATUS_LABELS[row.status],
          'Mã SP': row.product_code ?? '',
          'Sản phẩm': row.product_name ?? '',
          Nguồn: [row.warehouse_name, row.location_name].filter(Boolean).join(' / '),
          Đích: [row.target_warehouse_name, row.target_location_name].filter(Boolean).join(' / '),
          'Số lượng': row.quantity,
          'Đơn giá vốn': row.unit_cost,
          'Giá trị': row.amount ?? '',
          'Nguồn chứng từ': source.label,
          'Loại chứng từ nguồn': source.documentLabel ?? '',
          'Mã nguồn': source.detail ?? '',
          'Tham chiếu nguồn': source.reference ?? '',
          'Cảnh báo nguồn': source.warnings.join('; '),
          'Tham chiếu': row.reference,
          'Lý do': row.reason,
          'Ghi chú': row.note,
          'Lý do hủy': row.cancel_reason ?? '',
        };
      }),
      `so-kho-${dayjs().format('YYYYMMDD')}`,
    );
  };

  const handleExportNxtCSV = () => {
    if (nxtRows.length === 0) {
      messageApi.warning('Không có dữ liệu NXT để xuất.');
      return;
    }
    downloadCSV(
      nxtRows.map((row) => ({
        'Mã SP': row.product_code,
        'Sản phẩm': row.product_name,
        'Mã kho': row.warehouse_code,
        Kho: row.warehouse_name,
        'Tồn đầu': row.opening_qty,
        Nhập: row.in_qty,
        Xuất: row.out_qty,
        'Tồn cuối': row.closing_qty,
        ...buildNxtSourceBreakdownCsvColumns(row),
        'Cảnh báo nguồn': getNxtWarningsSummary(row),
        'Loại chứng từ nguồn': getNxtDocumentTypesSummary(row),
      })),
      `nxt-${nxtFilters.date_from}-${nxtFilters.date_to}`,
    );
  };

  const resetFilters = () => {
    setSearchInput('');
    setFilters({});
    setPage(1);
    setSelectedPresetId(undefined);
  };

  const statusAlert = useMemo(() => {
    if (summary.cancelledCount > 0) {
      return {
        type: 'warning' as const,
        message: `${summary.cancelledCount} chứng từ đã bị hủy trên trang hiện tại, nên kiểm tra nguyên nhân để tránh lặp lại sai lệch tồn kho.`,
      };
    }
    if (summary.adjustmentCount > 0) {
      return {
        type: 'info' as const,
        message: `${summary.adjustmentCount} giao dịch điều chỉnh đang xuất hiện, phù hợp để rà soát chênh lệch kiểm kê hoặc xử lý bù trừ.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Sổ kho đang ổn định, các giao dịch trên trang hiện tại đã được ghi sổ và chưa phát sinh cảnh báo đặc biệt.',
    };
  }, [summary.adjustmentCount, summary.cancelledCount]);

  const columns: ColumnsType<InventoryTransaction> = [
    { title: 'Mã CT', dataIndex: 'code', width: 150 },
    { title: 'Ngày', dataIndex: 'transaction_date', width: 120 },
    {
      title: 'Loại',
      dataIndex: 'transaction_type',
      width: 170,
      render: (value: InventoryTransaction['transaction_type']) => <Tag color={TYPE_COLORS[value]}>{TYPE_LABELS[value]}</Tag>,
    },
    {
      title: 'Sản phẩm',
      width: 260,
      render: (_, row) => `${row.product_code || ''} - ${row.product_name || ''}`.trim() || '-',
    },
    {
      title: 'Nguồn',
      width: 220,
      render: (_, row) => [row.warehouse_name, row.location_name].filter(Boolean).join(' / ') || '-',
    },
    {
      title: 'Đích',
      width: 220,
      render: (_, row) => [row.target_warehouse_name, row.target_location_name].filter(Boolean).join(' / ') || '-',
    },
    { title: 'Số lượng', dataIndex: 'quantity', width: 120 },
    {
      title: 'Tham chiếu',
      dataIndex: 'reference',
      width: 170,
      render: (value: string) => value || '-',
    },
    {
      title: 'Nguồn chứng từ',
      width: 180,
      render: (_, row) => {
        const source = getSourceDisplay(row);
        return (
          <Space data-testid={`inventory-source-audit-${row.id}`} direction="vertical" size={2}>
            <Tag color={source.color}>{source.label}</Tag>
            {source.documentLabel ? <Text type="secondary">{source.documentLabel}</Text> : null}
            {source.detail ? <Text type="secondary">{source.detail}</Text> : null}
            {source.warnings.length > 0 ? (
              <Space size={4} wrap>
                {source.warnings.map((warning) => (
                  <Tag key={warning} color="warning" style={{ marginInlineEnd: 0 }}>
                    {warning}
                  </Tag>
                ))}
              </Space>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: 'Audit',
      width: 220,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.reason || '-'}</Text>
          {row.note ? <Text type="secondary">{row.note}</Text> : null}
          {row.cancel_reason ? <Text type="danger">Hủy: {row.cancel_reason}</Text> : null}
        </Space>
      ),
    },
    {
      title: 'Trạng thái',
      width: 280,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Tag color={STATUS_COLORS[row.status]}>{STATUS_LABELS[row.status]}</Tag>
          <Text data-testid={`inventory-transaction-next-step-${row.id}`} type="secondary" style={{ fontSize: 12 }}>
            {getTransactionNextStep(row)}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, row) => {
        const disabledReason = getCancelTransactionDisabledReason(row, canManage);
        return (
          <Space>
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              disabled={Boolean(disabledReason)}
              title={disabledReason || 'Hủy chứng từ đã ghi sổ với lý do bắt buộc'}
              onClick={() => {
                cancelForm.setFieldsValue({ reason: '' });
                setCancelTarget(row);
              }}
            >
              Hủy chứng từ
            </Button>
          </Space>
        );
      },
    },
  ];

  const nxtColumns: ColumnsType<InventoryNxtReportRow> = [
    { title: 'Mã SP', dataIndex: 'product_code', width: 120 },
    { title: 'Sản phẩm', dataIndex: 'product_name', width: 240 },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 180 },
    { title: 'Tồn đầu', dataIndex: 'opening_qty', width: 120, align: 'right', render: (value) => formatQty(value as string) },
    { title: 'Nhập', dataIndex: 'in_qty', width: 120, align: 'right', render: (value) => formatQty(value as string) },
    { title: 'Xuất', dataIndex: 'out_qty', width: 120, align: 'right', render: (value) => formatQty(value as string) },
    { title: 'Tồn cuối', dataIndex: 'closing_qty', width: 120, align: 'right', render: (value) => formatQty(value as string) },
    {
      title: 'Phân rã nguồn',
      width: 460,
      render: (_, row) => {
        const activeSources = NXT_SOURCE_TYPES
          .map((sourceType) => getNxtSourceBreakdownItem(row, sourceType))
          .filter(hasNxtSourceMovement);
        const documentTypes = getNxtDocumentTypesSummary(row);
        const warnings = getNxtWarningsSummary(row);

        return (
          <Space data-testid={`inventory-nxt-source-breakdown-${getNxtRowKey(row)}`} direction="vertical" size={6}>
            <Space size={4} wrap>
              {activeSources.length > 0 ? (
                activeSources.map((item) => (
                  <Tag key={item.source_type} color={SOURCE_TYPE_COLORS[item.source_type]} style={{ marginInlineEnd: 0 }}>
                    {getSourceTypeLabel(item.source_type)}: +{formatQty(item.in_qty)} / -{formatQty(item.out_qty)} / net {formatQty(item.net_qty)} ({item.count} GD)
                  </Tag>
                ))
              ) : (
                <Tag color="default">Không có phát sinh theo nguồn</Tag>
              )}
            </Space>
            {documentTypes ? (
              <Text type="secondary" data-testid={`inventory-nxt-source-documents-${getNxtRowKey(row)}`}>
                Loại chứng từ nguồn: {documentTypes}
              </Text>
            ) : null}
            {warnings ? (
              <Text type="warning" data-testid={`inventory-nxt-source-warnings-${getNxtRowKey(row)}`}>
                Cảnh báo nguồn: {warnings}
              </Text>
            ) : null}
          </Space>
        );
      },
    },
  ];

  const onSubmit = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      warehouse: values.warehouse ?? null,
      location: values.location ?? null,
      target_warehouse: values.target_warehouse ?? null,
      target_location: values.target_location ?? null,
      quantity: String(values.quantity),
      unit_cost: String(values.unit_cost ?? 0),
      reference: values.reference?.trim() || '',
      reason: values.reason?.trim() || '',
      note: values.note?.trim() || '',
    };
    await createMutation.mutateAsync(payload);
    setOpenModal(false);
    form.resetFields();
  };

  const onCancelTransaction = async () => {
    if (!cancelTarget) return;
    const values = await cancelForm.validateFields();
    await cancelMutation.mutateAsync({
      id: cancelTarget.id,
      reason: values.reason.trim(),
    });
  };

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
              Trung tâm sổ kho
            </Title>
            <Text type="secondary">
              Điều phối toàn bộ giao dịch nhập, xuất, chuyển và điều chỉnh tồn kho trên cùng một không gian vận hành.
            </Text>
          </div>
          <Space wrap>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canManage}
              onClick={() => {
                form.setFieldsValue(emptyForm);
                setOpenModal(true);
              }}
            >
              Thêm giao dịch
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
            <Statistic title="Đã ghi sổ" value={summary.postedCount} valueStyle={{ color: '#389e0d' }} />
          </Card>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Đã hủy" value={summary.cancelledCount} valueStyle={{ color: '#cf1322' }} />
          </Card>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Lệnh chuyển kho" value={summary.transferCount} />
          </Card>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Khối lượng trên trang" value={summary.totalQty} precision={2} />
          </Card>
        </div>
      </Card>

      <Card
        bordered={false}
        style={{ borderRadius: 18 }}
        styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div data-testid="inventory-transactions-search" style={{ display: 'inline-block' }}>
            <Input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              placeholder="Tìm mã CT, sản phẩm, tham chiếu..."
              style={{ width: 320 }}
              suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
            />
          </div>
          <div data-testid="inventory-transactions-warehouse-filter" style={{ display: 'inline-block' }}>
            <Select
              allowClear
              placeholder="Lọc theo kho"
              style={{ width: 240 }}
              value={filters.warehouse}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, warehouse: value }));
                setPage(1);
              }}
              options={(warehouseQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
            />
          </div>
          <div data-testid="inventory-transactions-type-filter" style={{ display: 'inline-block' }}>
            <Select
              allowClear
              placeholder="Lọc theo loại"
              style={{ width: 240 }}
              value={filters.transaction_type}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, transaction_type: value }));
                setPage(1);
              }}
              options={TYPE_OPTIONS}
            />
          </div>
          <div data-testid="inventory-transactions-status-filter" style={{ display: 'inline-block' }}>
            <Select
              allowClear
              placeholder="Trạng thái"
              style={{ width: 180 }}
              value={filters.status}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, status: value }));
                setPage(1);
              }}
              options={STATUS_OPTIONS}
            />
          </div>
          <div data-testid="inventory-transactions-product-filter" style={{ display: 'inline-block' }}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Sản phẩm"
              style={{ width: 280 }}
              value={filters.product}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, product: value }));
                setPage(1);
              }}
              options={(productQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
            />
          </div>
          <div data-testid="inventory-transactions-source-filter" style={{ display: 'inline-block' }}>
            <Select
              allowClear
              placeholder="Nguồn chứng từ"
              style={{ width: 200 }}
              value={filters.source_type}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, source_type: value }));
                setPage(1);
              }}
              options={SOURCE_TYPE_OPTIONS}
            />
          </div>
          <Input
            data-testid="inventory-transactions-date-from"
            type="date"
            value={filters.transaction_date__gte}
            onChange={(event) => {
              setFilters((prev) => ({ ...prev, transaction_date__gte: event.target.value || undefined }));
              setPage(1);
            }}
            style={{ width: 160 }}
          />
          <Input
            data-testid="inventory-transactions-date-to"
            type="date"
            value={filters.transaction_date__lte}
            onChange={(event) => {
              setFilters((prev) => ({ ...prev, transaction_date__lte: event.target.value || undefined }));
              setPage(1);
            }}
            style={{ width: 160 }}
          />
          <Button
            onClick={resetFilters}
          >
            Xóa bộ lọc
          </Button>
          <Button
            data-testid="inventory-transactions-export-csv"
            icon={<DownloadOutlined />}
            disabled={rows.length === 0}
            onClick={handleExportTransactionsCSV}
          >
            Xuất CSV
          </Button>
        </div>
        <div
          data-testid="inventory-transactions-command-strip"
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <Button
            data-testid="inventory-transactions-save-view"
            onClick={() => void saveCurrentView()}
            disabled={isPreferencesLoading}
          >
            Lưu chế độ xem
          </Button>
          <Button
            data-testid="inventory-transactions-restore-view"
            onClick={applySavedView}
            disabled={isPreferencesLoading}
          >
            Áp dụng chế độ đã lưu
          </Button>
          <Button
            data-testid="inventory-transactions-open-preset-modal"
            onClick={() => {
              setPresetName(selectedPreset?.name ?? '');
              setIsPresetModalOpen(true);
            }}
            disabled={isPreferencesLoading}
          >
            Lưu mẫu mới
          </Button>
          <div data-testid="inventory-transactions-preset-select" style={{ display: 'inline-block' }}>
            <Select<string>
              allowClear
              placeholder="Chọn mẫu sổ kho"
              value={selectedPresetId}
              onChange={(value) => setSelectedPresetId(value)}
              disabled={isPreferencesLoading}
              style={{ width: 220 }}
              options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          </div>
          <Button
            data-testid="inventory-transactions-apply-preset"
            onClick={applyNamedPreset}
            disabled={isPreferencesLoading}
          >
            Áp dụng mẫu lọc
          </Button>
          <Button
            danger
            data-testid="inventory-transactions-delete-preset"
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
            <Tag color="default">Đang xem toàn bộ giao dịch kho</Tag>
          )}
          <Tag color="blue">Giá trị quy đổi: {summary.totalAmount.toLocaleString('vi-VN')} đ</Tag>
        </div>
      </Card>

      <Card
        data-testid="inventory-nxt-panel"
        bordered={false}
        style={{ borderRadius: 18 }}
        styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              Báo cáo Nhập - Xuất - Tồn
            </Title>
            <Text type="secondary">
              Đối chiếu tồn đầu kỳ, phát sinh nhập/xuất và tồn cuối kỳ theo sản phẩm và kho.
            </Text>
          </div>
          <Button
            data-testid="inventory-nxt-export-csv"
            icon={<DownloadOutlined />}
            disabled={nxtRows.length === 0}
            onClick={handleExportNxtCSV}
          >
            Xuất NXT CSV
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Input
            data-testid="inventory-nxt-date-from"
            type="date"
            value={nxtFilters.date_from}
            onChange={(event) => setNxtFilters((prev) => ({ ...prev, date_from: event.target.value }))}
            style={{ width: 170 }}
          />
          <Input
            data-testid="inventory-nxt-date-to"
            type="date"
            value={nxtFilters.date_to}
            onChange={(event) => setNxtFilters((prev) => ({ ...prev, date_to: event.target.value }))}
            style={{ width: 170 }}
          />
          <Select
            allowClear
            data-testid="inventory-nxt-warehouse-filter"
            placeholder="Kho"
            style={{ width: 240 }}
            value={nxtFilters.warehouse}
            onChange={(value) => setNxtFilters((prev) => ({ ...prev, warehouse: value }))}
            options={(warehouseQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            data-testid="inventory-nxt-product-filter"
            placeholder="Sản phẩm"
            style={{ width: 280 }}
            value={nxtFilters.product}
            onChange={(value) => setNxtFilters((prev) => ({ ...prev, product: value }))}
            options={(productQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
          />
        </div>
        <Table<InventoryNxtReportRow>
          data-testid="inventory-nxt-table"
          rowKey={getNxtRowKey}
          loading={nxtQuery.isLoading}
          columns={nxtColumns}
          dataSource={nxtRows}
          pagination={false}
          scroll={{ x: 1480 }}
          locale={{ emptyText: 'Không có dữ liệu NXT trong kỳ đã chọn.' }}
        />
      </Card>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 2100 }}
        pagination={{
          current: page,
          pageSize,
          total: listQuery.data?.count ?? 0,
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
          emptyText: rows.length === 0 && !listQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {activeFilterTags.length > 0 ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy giao dịch kho phù hợp với bộ lọc hiện tại.</div>
                  <Button
                    type="link"
                    onClick={() => {
                      setSearchInput('');
                      setFilters({});
                      setPage(1);
                    }}
                  >
                    Xóa bộ lọc
                  </Button>
                </div>
              ) : 'Chưa có giao dịch kho nào được ghi nhận.'}
            </div>
          ) : undefined,
        }}
      />

      <Modal
        title="Lưu mẫu lọc sổ kho"
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
          data-testid="inventory-transactions-preset-name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Ví dụ: Giao dịch nhập kho / Theo kho thành phẩm"
          maxLength={80}
          autoFocus
        />
      </Modal>

      <Modal
        title="Tạo giao dịch kho"
        open={openModal}
        onCancel={() => {
          setOpenModal(false);
          form.resetFields();
        }}
        onOk={onSubmit}
        confirmLoading={createMutation.isPending}
        width={720}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="transaction_type" label="Loại giao dịch" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select
              options={TYPE_OPTIONS}
              onChange={() => {
                form.setFieldValue('location', null);
                form.setFieldValue('target_warehouse', null);
                form.setFieldValue('target_location', null);
              }}
            />
          </Form.Item>
          <Form.Item name="transaction_date" label="Ngày chứng từ" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="product" label="Sản phẩm" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={(productQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
            />
          </Form.Item>
          <Form.Item name="warehouse" label={txType === 'TRANSFER' ? 'Kho nguồn' : 'Kho'} rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select
              options={(warehouseQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
              onChange={() => form.setFieldValue('location', null)}
            />
          </Form.Item>
          <Form.Item name="location" label="Vị trí nguồn">
            <Select
              allowClear
              options={(sourceLocationQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
            />
          </Form.Item>
          {txType === 'TRANSFER' && (
            <>
              <Form.Item name="target_warehouse" label="Kho đích" rules={[{ required: true, message: 'Bắt buộc' }]}>
                <Select
                  options={(warehouseQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
                  onChange={() => form.setFieldValue('target_location', null)}
                />
              </Form.Item>
              <Form.Item name="target_location" label="Vị trí đích">
                <Select
                  allowClear
                  options={(targetLocationQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
                />
              </Form.Item>
            </>
          )}
          <Form.Item name="quantity" label="Số lượng" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <InputNumber min={0.0001} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unit_cost" label="Đơn giá vốn">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reference" label="Chứng từ tham chiếu">
            <Input />
          </Form.Item>
          <Form.Item name="reason" label="Lý do">
            <Input />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={cancelTarget ? `Hủy chứng từ kho - ${cancelTarget.code}` : 'Hủy chứng từ kho'}
        open={Boolean(cancelTarget)}
        onCancel={() => {
          setCancelTarget(null);
          cancelForm.resetFields();
        }}
        onOk={onCancelTransaction}
        okText="Xác nhận hủy"
        cancelText="Đóng"
        okButtonProps={{ danger: true }}
        confirmLoading={cancelMutation.isPending}
      >
        <Form form={cancelForm} layout="vertical">
          <Alert
            showIcon
            type="warning"
            style={{ marginBottom: 16 }}
            message="Chỉ hủy khi đã xác minh sai lệch số lượng, giá trị hoặc chứng từ nguồn."
          />
          <Form.Item
            name="reason"
            label="Lý do hủy"
            rules={[
              { required: true, message: 'Vui lòng nhập lý do hủy' },
              { validator: async (_, value) => (value?.trim() ? Promise.resolve() : Promise.reject(new Error('Vui lòng nhập lý do hủy'))) },
            ]}
          >
            <Input.TextArea rows={4} maxLength={500} placeholder="Mô tả ngắn nguyên nhân hủy chứng từ để tiện đối soát sau này" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
