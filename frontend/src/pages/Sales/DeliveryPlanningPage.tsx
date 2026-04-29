import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { salesApi } from '../../api/sales';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useDesktopTableSticky } from '../../hooks/useDesktopTableSticky';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import type {
  DeliveryPlanningGroupItem,
  DeliveryPlanningSummaryRow,
  SalesOrderDeliveryRule,
} from '../../types/sales';
import { PAGES } from '../../utils/constants';
import { appendScanCenterContext, buildScanCenterPath } from '../../utils/scanNavigation';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

type DeliveryPlanningGroupBy =
  | 'DATE_CUSTOMER_CARRIER'
  | 'CUSTOMER_DATE_CARRIER'
  | 'CARRIER_DATE_CUSTOMER';
type AttentionFilter =
  | 'ALL'
  | 'OVERDUE'
  | 'DUE_TODAY'
  | 'DUE_SOON'
  | 'UNASSIGNED_CARRIER'
  | 'FULL_REQUIRED'
  | 'AWAITING_SHIPMENT'
  | 'AWAITING_DELIVERY_CONFIRMATION'
  | 'COMPLETED';
type SortMode = 'DATE_ASC' | 'DATE_DESC' | 'CUSTOMER_ASC';
type VisibleColumnKey =
  | 'delivery_date'
  | 'customer_name'
  | 'planned_carrier_name'
  | 'note_preview'
  | 'sku_preview'
  | 'planned_qty_total'
  | 'shipped_qty_total'
  | 'delivered_qty_total'
  | 'remaining_qty_total'
  | 'attention_status';

type DeliveryPlanningFilters = {
  dateFrom: string;
  dateTo: string;
  attention: AttentionFilter;
  deliveryRule: 'ALL' | SalesOrderDeliveryRule;
  showCompleted: boolean;
  showOnlyUnassignedCarrier: boolean;
  groupBy: DeliveryPlanningGroupBy;
  sort: SortMode;
  orderId?: number | null;
  source?: string;
};

type DeliveryPlanningSnapshot = DeliveryPlanningFilters & {
  search: string;
  visibleColumns: VisibleColumnKey[];
};

const defaultVisibleColumns: VisibleColumnKey[] = [
  'delivery_date',
  'customer_name',
  'planned_carrier_name',
  'sku_preview',
  'planned_qty_total',
  'remaining_qty_total',
  'attention_status',
];

const groupByOptions: Array<{ value: DeliveryPlanningGroupBy; label: string }> = [
  { value: 'DATE_CUSTOMER_CARRIER', label: 'Ngày giao / Khách hàng / Vận chuyển' },
  { value: 'CUSTOMER_DATE_CARRIER', label: 'Khách hàng / Ngày giao / Vận chuyển' },
  { value: 'CARRIER_DATE_CUSTOMER', label: 'Vận chuyển / Ngày giao / Khách hàng' },
];

const attentionOptions: Array<{ value: AttentionFilter; label: string }> = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'OVERDUE', label: 'Quá hạn' },
  { value: 'DUE_TODAY', label: 'Giao hôm nay' },
  { value: 'DUE_SOON', label: 'Sắp đến hạn' },
  { value: 'UNASSIGNED_CARRIER', label: 'Chưa chốt vận chuyển' },
  { value: 'FULL_REQUIRED', label: 'Có hàng phải giao đủ' },
  { value: 'AWAITING_SHIPMENT', label: 'Còn chờ xuất' },
  { value: 'AWAITING_DELIVERY_CONFIRMATION', label: 'Chờ xác nhận giao xong' },
  { value: 'COMPLETED', label: 'Đã giao xong' },
];

const sortOptions: Array<{ value: SortMode; label: string }> = [
  { value: 'DATE_ASC', label: 'Ngày tăng dần' },
  { value: 'DATE_DESC', label: 'Ngày giảm dần' },
  { value: 'CUSTOMER_ASC', label: 'Khách hàng A-Z' },
];

const deliveryRuleOptions: Array<{ value: 'ALL' | SalesOrderDeliveryRule; label: string }> = [
  { value: 'ALL', label: 'Mọi quy tắc' },
  { value: 'FULL_REQUIRED', label: 'Giao đủ' },
  { value: 'PARTIAL_ALLOWED', label: 'Cho phép sớt lại' },
];

const columnOptions: Array<{ value: VisibleColumnKey; label: string }> = [
  { value: 'delivery_date', label: 'Ngày giao' },
  { value: 'customer_name', label: 'Khách hàng' },
  { value: 'planned_carrier_name', label: 'Đơn vị vận chuyển' },
  { value: 'note_preview', label: 'Ghi chú' },
  { value: 'sku_preview', label: 'Mã hàng' },
  { value: 'planned_qty_total', label: 'SL kế hoạch' },
  { value: 'shipped_qty_total', label: 'Đã xuất' },
  { value: 'delivered_qty_total', label: 'Đã giao' },
  { value: 'remaining_qty_total', label: 'Còn lại' },
  { value: 'attention_status', label: 'Cảnh báo' },
];

function parseGroupBy(value: unknown): DeliveryPlanningGroupBy {
  return value === 'CUSTOMER_DATE_CARRIER' || value === 'CARRIER_DATE_CUSTOMER' ? value : 'DATE_CUSTOMER_CARRIER';
}

function parseAttention(value: unknown): AttentionFilter {
  return attentionOptions.some((item) => item.value === value) ? (value as AttentionFilter) : 'ALL';
}

function parseSortMode(value: unknown): SortMode {
  return value === 'DATE_DESC' || value === 'CUSTOMER_ASC' ? value : 'DATE_ASC';
}

function parseDeliveryRule(value: unknown): 'ALL' | SalesOrderDeliveryRule {
  return value === 'FULL_REQUIRED' || value === 'PARTIAL_ALLOWED' ? value : 'ALL';
}

function parseVisibleColumns(value: unknown): VisibleColumnKey[] {
  if (!Array.isArray(value)) return defaultVisibleColumns;
  const parsed = value.filter((item): item is VisibleColumnKey => columnOptions.some((option) => option.value === item));
  return parsed.length ? parsed : defaultVisibleColumns;
}

function serializeFilters(filters: DeliveryPlanningFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): DeliveryPlanningFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<DeliveryPlanningFilters>;
    return {
      dateFrom: typeof parsed.dateFrom === 'string' ? parsed.dateFrom : '',
      dateTo: typeof parsed.dateTo === 'string' ? parsed.dateTo : '',
      attention: parseAttention(parsed.attention),
      deliveryRule: parseDeliveryRule(parsed.deliveryRule),
      showCompleted: Boolean(parsed.showCompleted),
      showOnlyUnassignedCarrier: Boolean(parsed.showOnlyUnassignedCarrier),
      groupBy: parseGroupBy(parsed.groupBy),
      sort: parseSortMode(parsed.sort),
      orderId: typeof parsed.orderId === 'number' ? parsed.orderId : null,
      source: typeof parsed.source === 'string' ? parsed.source : '',
    };
  } catch {
    return {
      dateFrom: '',
      dateTo: '',
      attention: 'ALL',
      deliveryRule: 'ALL',
      showCompleted: false,
      showOnlyUnassignedCarrier: false,
      groupBy: 'DATE_CUSTOMER_CARRIER',
      sort: 'DATE_ASC',
      orderId: null,
      source: '',
    };
  }
}

function parseSnapshot(value: unknown): DeliveryPlanningSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return {
    search: typeof record.search === 'string' ? record.search : '',
    dateFrom: typeof record.dateFrom === 'string' ? record.dateFrom : '',
    dateTo: typeof record.dateTo === 'string' ? record.dateTo : '',
    attention: parseAttention(record.attention),
    deliveryRule: parseDeliveryRule(record.deliveryRule),
    showCompleted: Boolean(record.showCompleted),
    showOnlyUnassignedCarrier: Boolean(record.showOnlyUnassignedCarrier),
    groupBy: parseGroupBy(record.groupBy),
    sort: parseSortMode(record.sort),
    orderId: typeof record.orderId === 'number' ? record.orderId : null,
    source: typeof record.source === 'string' ? record.source : '',
    visibleColumns: parseVisibleColumns(record.visibleColumns),
  };
}

function formatQty(value: string | number | null | undefined): string {
  return Number(value || 0).toLocaleString('vi-VN');
}

function formatCarrier(value: string): string {
  return value.trim() || 'Chưa chốt đơn vị vận chuyển';
}

function formatSkuPreview(row: DeliveryPlanningSummaryRow): string {
  if (!row.sku_preview.length) return '-';
  if (row.sku_count <= row.sku_preview.length) return row.sku_preview.join(', ');
  return `${row.sku_preview.join(', ')} +${row.sku_count - row.sku_preview.length}`;
}

function attentionColor(value: string): string {
  if (value === 'OVERDUE') return 'red';
  if (value === 'DUE_TODAY' || value === 'DUE_SOON' || value === 'UNASSIGNED_CARRIER') return 'gold';
  if (value === 'AWAITING_DELIVERY_CONFIRMATION') return 'purple';
  if (value === 'AWAITING_SHIPMENT') return 'blue';
  if (value === 'COMPLETED') return 'green';
  return 'default';
}

function attentionLabel(value: string): string {
  const found = attentionOptions.find((item) => item.value === value);
  return found?.label || value;
}

function deliveryRuleLabel(value: SalesOrderDeliveryRule): string {
  return value === 'FULL_REQUIRED' ? 'Giao đủ' : 'Cho phép sớt lại';
}

export default function DeliveryPlanningPage() {
  const desktopTableSticky = useDesktopTableSticky();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedRow, setSelectedRow] = useState<DeliveryPlanningSummaryRow | null>(null);
  const [hasAppliedSavedView, setHasAppliedSavedView] = useState(false);
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  const [filters, setFilters] = useState<DeliveryPlanningFilters>({
    dateFrom: searchParams.get('date_from') || '',
    dateTo: searchParams.get('date_to') || '',
    attention: parseAttention(searchParams.get('attention')),
    deliveryRule: parseDeliveryRule(searchParams.get('delivery_rule')),
    showCompleted: ['1', 'true'].includes((searchParams.get('show_completed') || '').toLowerCase()),
    showOnlyUnassignedCarrier: ['1', 'true'].includes((searchParams.get('only_unassigned_carrier') || '').toLowerCase()),
    groupBy: parseGroupBy(searchParams.get('group_by')),
    sort: parseSortMode(searchParams.get('sort')),
    orderId: Number(searchParams.get('order_id') || 0) || null,
    source: searchParams.get('source') || '',
  });
  const [visibleColumns, setVisibleColumns] = useState<VisibleColumnKey[]>(defaultVisibleColumns);
  const [hasQueryOverride] = useState(
    Boolean(
      searchParams.get('q')
      || searchParams.get('date_from')
      || searchParams.get('date_to')
      || searchParams.get('attention')
      || searchParams.get('delivery_rule')
      || searchParams.get('show_completed')
      || searchParams.get('only_unassigned_carrier')
      || searchParams.get('group_by')
      || searchParams.get('sort')
      || searchParams.get('order_id'),
    ),
  );

  const { config, saveConfig, isLoading: isPreferencesLoading } = useUserPreferences(PAGES.SALES_DELIVERY_PLANNING);
  const configRecord = config as Record<string, unknown>;

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const savedSnapshot = useMemo(
    () => parseSnapshot(configRecord.saved_view_snapshot),
    [configRecord.saved_view_snapshot],
  );

  useEffect(() => {
    if (hasAppliedSavedView || hasQueryOverride || isPreferencesLoading || !savedSnapshot) {
      return;
    }
    const hydrateTimer = window.setTimeout(() => {
      setSearchInput(savedSnapshot.search);
      setFilters({
        dateFrom: savedSnapshot.dateFrom,
        dateTo: savedSnapshot.dateTo,
        attention: savedSnapshot.attention,
        deliveryRule: savedSnapshot.deliveryRule,
        showCompleted: savedSnapshot.showCompleted,
        showOnlyUnassignedCarrier: savedSnapshot.showOnlyUnassignedCarrier,
        groupBy: savedSnapshot.groupBy,
        sort: savedSnapshot.sort,
        orderId: savedSnapshot.orderId,
        source: savedSnapshot.source,
      });
      setVisibleColumns(savedSnapshot.visibleColumns);
      setHasAppliedSavedView(true);
    }, 0);
    return () => window.clearTimeout(hydrateTimer);
  }, [hasAppliedSavedView, hasQueryOverride, isPreferencesLoading, savedSnapshot]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (intentSearch.trim()) next.set('q', intentSearch.trim());
    if (intentFilters.dateFrom) next.set('date_from', intentFilters.dateFrom);
    if (intentFilters.dateTo) next.set('date_to', intentFilters.dateTo);
    if (intentFilters.attention !== 'ALL') next.set('attention', intentFilters.attention);
    if (intentFilters.deliveryRule !== 'ALL') next.set('delivery_rule', intentFilters.deliveryRule);
    if (intentFilters.showCompleted) next.set('show_completed', '1');
    if (intentFilters.showOnlyUnassignedCarrier) next.set('only_unassigned_carrier', '1');
    if (intentFilters.groupBy !== 'DATE_CUSTOMER_CARRIER') next.set('group_by', intentFilters.groupBy);
    if (intentFilters.sort !== 'DATE_ASC') next.set('sort', intentFilters.sort);
    if (intentFilters.orderId) next.set('order_id', String(intentFilters.orderId));
    if (intentFilters.source) next.set('source', intentFilters.source);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [intentFilters, intentSearch, searchParams, setSearchParams]);

  const summaryQueryParams = useMemo(
    () => ({
      q: intentSearch.trim() || undefined,
      date_from: intentFilters.dateFrom || undefined,
      date_to: intentFilters.dateTo || undefined,
      attention: intentFilters.attention !== 'ALL' ? intentFilters.attention : undefined,
      delivery_rule: intentFilters.deliveryRule !== 'ALL' ? intentFilters.deliveryRule : undefined,
      show_completed: intentFilters.showCompleted ? '1' : undefined,
      only_unassigned_carrier: intentFilters.showOnlyUnassignedCarrier ? '1' : undefined,
      group_by: intentFilters.groupBy,
      order_id: intentFilters.orderId || undefined,
      source: intentFilters.source || undefined,
    }),
    [intentFilters, intentSearch],
  );

  const summaryQuery = useQuery({
    queryKey: ['sales-delivery-planning', summaryQueryParams],
    queryFn: () => salesApi.getDeliveryPlanningSummary(summaryQueryParams),
  });

  const sortedRows = useMemo(() => {
    const base = [...(summaryQuery.data?.results ?? [])];
    if (intentFilters.sort === 'DATE_DESC') {
      base.sort((a, b) => b.delivery_date.localeCompare(a.delivery_date) || a.customer_name.localeCompare(b.customer_name));
      return base;
    }
    if (intentFilters.sort === 'CUSTOMER_ASC') {
      base.sort((a, b) => a.customer_name.localeCompare(b.customer_name) || a.delivery_date.localeCompare(b.delivery_date));
      return base;
    }
    base.sort((a, b) => a.delivery_date.localeCompare(b.delivery_date) || a.customer_name.localeCompare(b.customer_name));
    return base;
  }, [intentFilters.sort, summaryQuery.data?.results]);

  const autoHiddenSummaryColumns = useMemo<VisibleColumnKey[]>(() => {
    if (sortedRows.length === 0) return [];
    return visibleColumns.filter((columnKey) => {
      if (columnKey !== 'note_preview') return false;
      return sortedRows.every((row) => !row.note_preview?.trim());
    });
  }, [sortedRows, visibleColumns]);

  const summaryVisibleColumns = useMemo(
    () => visibleColumns.filter((columnKey) => !autoHiddenSummaryColumns.includes(columnKey)),
    [autoHiddenSummaryColumns, visibleColumns],
  );

  const itemsQuery = useQuery({
    queryKey: ['sales-delivery-planning-group-items', selectedRow?.group_key],
    queryFn: () => salesApi.getDeliveryPlanningGroupItems(selectedRow?.group_key || ''),
    enabled: Boolean(selectedRow?.group_key),
  });

  const saveCurrentView = async () => {
    await saveConfig({
      ...configRecord,
      saved_view_snapshot: {
        search: searchInput,
        ...filters,
        visibleColumns,
      },
    });
    messageApi.success('Đã lưu góc nhìn kế hoạch giao hàng.');
  };

  const summaryColumns = useMemo<ColumnsType<DeliveryPlanningSummaryRow>>(() => {
    const visibleColumnSet = new Set(summaryVisibleColumns);
    const columns: ColumnsType<DeliveryPlanningSummaryRow> = [
      {
        title: 'Ngày giao',
        dataIndex: 'delivery_date',
        key: 'delivery_date',
        width: 120,
        render: (value: string) => dayjs(value).format('DD/MM/YYYY'),
      },
      {
        title: 'Khách hàng',
        dataIndex: 'customer_name',
        key: 'customer_name',
        width: 220,
      },
      {
        title: 'Đơn vị vận chuyển',
        dataIndex: 'planned_carrier_name',
        key: 'planned_carrier_name',
        width: 220,
        render: (value: string) => formatCarrier(value),
      },
      {
        title: 'Ghi chú',
        dataIndex: 'note_preview',
        key: 'note_preview',
        width: 220,
        render: (value: string) => value || '-',
      },
      {
        title: 'Mã hàng',
        key: 'sku_preview',
        width: 220,
        render: (_, row) => formatSkuPreview(row),
      },
      {
        title: 'SL kế hoạch',
        dataIndex: 'planned_qty_total',
        key: 'planned_qty_total',
        align: 'right',
        width: 120,
        render: (value: string) => formatQty(value),
      },
      {
        title: 'Đã xuất',
        dataIndex: 'shipped_qty_total',
        key: 'shipped_qty_total',
        align: 'right',
        width: 100,
        render: (value: string) => formatQty(value),
      },
      {
        title: 'Đã giao',
        dataIndex: 'delivered_qty_total',
        key: 'delivered_qty_total',
        align: 'right',
        width: 100,
        render: (value: string) => formatQty(value),
      },
      {
        title: 'Còn lại',
        dataIndex: 'remaining_qty_total',
        key: 'remaining_qty_total',
        align: 'right',
        width: 100,
        render: (value: string) => formatQty(value),
      },
      {
        title: 'Cảnh báo',
        dataIndex: 'attention_status',
        key: 'attention_status',
        width: 190,
        render: (value: string, row) => (
          <Space wrap>
            <Tag color={attentionColor(value)}>{attentionLabel(value)}</Tag>
            {row.has_full_required_items ? <Tag color="purple">Có hàng giao đủ</Tag> : null}
          </Space>
        ),
      },
    ];
    return columns.filter((column) => visibleColumnSet.has(column.key as VisibleColumnKey));
  }, [summaryVisibleColumns]);

  const detailColumns = useMemo<ColumnsType<DeliveryPlanningGroupItem>>(
    () => [
      {
        title: 'Mã hàng',
        key: 'product',
        width: 220,
        render: (_, row) => (
          <div>
            <div style={{ fontWeight: 600 }}>{row.product_code || '-'}</div>
            <div style={{ color: 'var(--app-text-muted)', fontSize: 12 }}>{row.product_name || '-'}</div>
          </div>
        ),
      },
      {
        title: 'Đơn hàng',
        dataIndex: 'sales_order_code',
        width: 140,
      },
      {
        title: 'Quy tắc giao',
        dataIndex: 'delivery_rule',
        width: 150,
        render: (value: SalesOrderDeliveryRule) => (
          <Tag color={value === 'FULL_REQUIRED' ? 'purple' : 'blue'}>{deliveryRuleLabel(value)}</Tag>
        ),
      },
      {
        title: 'SL KH',
        dataIndex: 'qty',
        width: 90,
        align: 'right',
        render: (value: string) => formatQty(value),
      },
      {
        title: 'Đã xuất',
        dataIndex: 'shipped_qty',
        width: 90,
        align: 'right',
        render: (value: string) => formatQty(value),
      },
      {
        title: 'Đã giao',
        dataIndex: 'delivered_qty',
        width: 90,
        align: 'right',
        render: (value: string) => formatQty(value),
      },
      {
        title: 'Còn lại',
        dataIndex: 'remaining_qty',
        width: 90,
        align: 'right',
        render: (value: string) => formatQty(value),
      },
      {
        title: 'Ghi chú',
        dataIndex: 'note',
        width: 200,
        render: (value: string) => value || '-',
      },
      {
        title: 'Thao tác',
        key: 'actions',
        width: 260,
        render: (_, row) => {
          const plannerReturnTo = `/delivery-planning${window.location.search}`;
          return (
            <Space wrap>
              <Button size="small" onClick={() => navigate(`/sales-orders?focus_id=${row.sales_order_id}&section=delivery-planning`)}>
                Đơn hàng
              </Button>
              <Button
                size="small"
                onClick={() => navigate(`/shipments?order_id=${row.sales_order_id}${row.shipment_id ? `&focus_id=${row.shipment_id}` : ''}`)}
              >
                Phiếu xuất
              </Button>
              <Button
                size="small"
                disabled={!row.shipment_id}
                onClick={() => navigate(appendScanCenterContext(buildScanCenterPath({
                  orderId: row.sales_order_id,
                  shipmentId: row.shipment_id || undefined,
                }), plannerReturnTo))}
              >
                Quét QR
              </Button>
            </Space>
          );
        },
      },
    ],
    [navigate],
  );

  const summaryCards = summaryQuery.data?.summary;

  return (
    <div data-testid="delivery-planning-root" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <div className="compact-page-header">
        <div className="compact-page-title-stack">
          <div className="compact-page-eyebrow">Điều phối giao hàng</div>
          <Title level={3} className="compact-page-title" style={{ marginBottom: 4, marginTop: 4 }}>Bảng tổng hợp giao hàng</Title>
          <Text type="secondary">
            Tổng hợp theo ngày giao, khách hàng và đơn vị vận chuyển; bấm vào từng dòng để xem mã hàng và tiến độ giao.
          </Text>
        </div>
        <Space wrap>
          <Button data-testid="delivery-planning-save-view" onClick={saveCurrentView}>Lưu góc nhìn</Button>
        </Space>
      </div>

      {filters.source ? (
        <Alert
          type="info"
          showIcon
          message="Đang mở từ luồng liên quan"
          description={
            filters.source === 'shipments'
              ? 'Đã mang theo ngữ cảnh từ Phiếu xuất để rà lại kế hoạch giao tương ứng.'
              : 'Đang mở theo ngữ cảnh điều phối giao hàng.'
          }
        />
      ) : null}

      <Card className="compact-section-card">
        <div className="compact-filter-strip" style={{ width: '100%' }}>
          <Input
            data-testid="delivery-planning-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Tìm theo đơn hàng, khách hàng, mã hàng, vận chuyển, ghi chú"
            style={{ width: 320 }}
            suffix={searchInput.trim() ? <QuickClearIcon onClear={() => setSearchInput('')} title="Xóa tìm kiếm" /> : undefined}
          />
          <RangePicker
            data-testid="delivery-planning-date-range"
            value={[
              filters.dateFrom ? dayjs(filters.dateFrom) : null,
              filters.dateTo ? dayjs(filters.dateTo) : null,
            ]}
            format="DD/MM/YYYY"
            onChange={(dates) => setFilters((current) => ({
              ...current,
              dateFrom: dates?.[0] ? dates[0].format('YYYY-MM-DD') : '',
              dateTo: dates?.[1] ? dates[1].format('YYYY-MM-DD') : '',
            }))}
          />
          <Select
            data-testid="delivery-planning-attention"
            value={filters.attention}
            options={attentionOptions}
            style={{ width: 190 }}
            onChange={(value) => setFilters((current) => ({ ...current, attention: value }))}
          />
          <Select
            data-testid="delivery-planning-rule"
            value={filters.deliveryRule}
            options={deliveryRuleOptions}
            style={{ width: 180 }}
            onChange={(value) => setFilters((current) => ({ ...current, deliveryRule: value }))}
          />
          <Select
            data-testid="delivery-planning-group-by"
            value={filters.groupBy}
            options={groupByOptions}
            style={{ width: 260 }}
            onChange={(value) => setFilters((current) => ({ ...current, groupBy: value }))}
          />
          <Select
            data-testid="delivery-planning-sort"
            value={filters.sort}
            options={sortOptions}
            style={{ width: 170 }}
            onChange={(value) => setFilters((current) => ({ ...current, sort: value }))}
          />
          <Checkbox
            checked={filters.showOnlyUnassignedCarrier}
            onChange={(event) => setFilters((current) => ({ ...current, showOnlyUnassignedCarrier: event.target.checked }))}
          >
            Chỉ chưa chốt vận chuyển
          </Checkbox>
          <Checkbox
            checked={filters.showCompleted}
            onChange={(event) => setFilters((current) => ({ ...current, showCompleted: event.target.checked }))}
          >
            Hiện đã giao xong
          </Checkbox>
          <Select
            data-testid="delivery-planning-visible-columns"
            mode="multiple"
            value={visibleColumns}
            options={columnOptions}
            style={{ minWidth: 280 }}
            onChange={(values) => setVisibleColumns(parseVisibleColumns(values))}
            placeholder="Cột hiển thị"
          />
        </div>
      </Card>

      <div className="compact-summary-grid compact-summary-grid--dense">
        <Card className="compact-stat-card"><Statistic title="Nhóm quá hạn" value={summaryCards?.overdue_groups ?? 0} /></Card>
        <Card className="compact-stat-card"><Statistic title="Giao hôm nay" value={summaryCards?.due_today_groups ?? 0} /></Card>
        <Card className="compact-stat-card"><Statistic title="Sắp đến hạn" value={summaryCards?.due_soon_groups ?? 0} /></Card>
        <Card className="compact-stat-card"><Statistic title="Chưa chốt vận chuyển" value={summaryCards?.unassigned_carrier_groups ?? 0} /></Card>
        <Card className="compact-stat-card"><Statistic title="Có hàng giao đủ" value={summaryCards?.full_required_groups ?? 0} /></Card>
      </div>

      <Card
        className="compact-section-card"
        title="Bảng tổng hợp giao hàng"
        extra={(
          <Space wrap>
            <Button size="small" onClick={() => setFilters((current) => ({ ...current, attention: 'OVERDUE' }))}>Quá hạn</Button>
            <Button size="small" onClick={() => setFilters((current) => ({ ...current, attention: 'UNASSIGNED_CARRIER' }))}>Chưa chốt vận chuyển</Button>
            <Button size="small" onClick={() => setFilters((current) => ({ ...current, attention: 'FULL_REQUIRED' }))}>Hàng giao đủ</Button>
            <Button size="small" onClick={() => setFilters((current) => ({ ...current, attention: 'ALL' }))}>Bỏ lọc nhanh</Button>
          </Space>
        )}
      >
        {autoHiddenSummaryColumns.length > 0 ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Một số cột đang được ẩn tạm để bảng gọn hơn."
            description="Cột ghi chú đang trống trong toàn bộ tập hiện tại nên đã được ẩn. Có thể bật lại trong bộ chọn cột nếu cần."
          />
        ) : null}
        {summaryQuery.isLoading ? (
          <div style={{ padding: 32, textAlign: 'center' }}><Text type="secondary">Đang tải kế hoạch giao hàng...</Text></div>
        ) : summaryQuery.isError ? (
          <Alert type="error" showIcon message="Không tải được bảng kế hoạch giao hàng." />
        ) : sortedRows.length === 0 ? (
          <Empty description="Chưa có kế hoạch giao phù hợp với bộ lọc hiện tại." />
        ) : (
          <Table
            className="enterprise-data-table table-density-compact"
            data-testid="delivery-planning-table"
            rowKey="group_key"
            columns={summaryColumns}
            dataSource={sortedRows}
            sticky={desktopTableSticky}
            pagination={{ pageSize: 12, showSizeChanger: true }}
            scroll={{ x: 960 }}
            onRow={(row) => ({
              'data-testid': `delivery-planning-summary-row-${row.group_key}`,
              style: { cursor: 'pointer' },
              tabIndex: 0,
              onClick: () => setSelectedRow(row),
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedRow(row);
                }
              },
            })}
          />
        )}
      </Card>

      <Drawer
        data-testid="delivery-planning-drawer"
        open={Boolean(selectedRow)}
        width={1120}
        title={selectedRow ? `${dayjs(selectedRow.delivery_date).format('DD/MM/YYYY')} - ${selectedRow.customer_name}` : 'Chi tiết kế hoạch giao'}
        onClose={() => setSelectedRow(null)}
      >
        {selectedRow ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" className="compact-section-card">
              <div className="compact-detail-grid">
                <div><strong>Khách hàng:</strong> {selectedRow.customer_name}</div>
                <div><strong>Đơn vị vận chuyển:</strong> {formatCarrier(selectedRow.planned_carrier_name)}</div>
                <div><strong>Ghi chú:</strong> {selectedRow.note_preview || '-'}</div>
                <div><strong>Số mã hàng:</strong> {selectedRow.sku_count}</div>
              </div>
            </Card>
            {itemsQuery.isLoading ? (
              <Text type="secondary">Đang tải chi tiết mã hàng...</Text>
            ) : itemsQuery.isError ? (
              <Alert type="error" showIcon message="Không tải được chi tiết nhóm kế hoạch giao này." />
            ) : (
              <Table
                className="enterprise-data-table table-density-compact"
                rowKey="delivery_plan_id"
                columns={detailColumns}
                dataSource={itemsQuery.data?.results ?? []}
                sticky={desktopTableSticky}
                pagination={false}
                scroll={{ x: 980 }}
              />
            )}
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
