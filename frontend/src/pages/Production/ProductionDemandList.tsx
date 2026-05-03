import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType, TableProps } from 'antd/es/table';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';

import { productionApi } from '../../api/production';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getToastMessage } from '../../shared/apiError';
import type {
  ProductionDemand,
  ProductionDemandPlanningStatus,
  ProductionDemandPriority,
  ProductionDemandProductionStatus,
  ProductionDemandProductKind,
  ProductionDemandQueryParams,
} from '../../types/production';
import { PAGES } from '../../utils/constants';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

type DemandLaneFilter =
  | 'ALL'
  | 'OVERDUE'
  | 'DUE_TODAY'
  | 'UPCOMING_7'
  | 'NOT_DUE'
  | 'HELD'
  | 'NO_DATE'
  | 'PARTIALLY_PLANNED'
  | 'FULLY_PLANNED'
  | 'IN_PROGRESS'
  | 'COMPLETED';

type DemandFilters = {
  planning_status?: ProductionDemandPlanningStatus;
  production_status?: ProductionDemandProductionStatus;
  product_kind?: ProductionDemandProductKind;
  priority?: ProductionDemandPriority;
  product_code?: string;
  customer?: string;
  delivery_date_from?: string;
  delivery_date_to?: string;
  planning_due_date_from?: string;
  planning_due_date_to?: string;
};

type SummaryCard = {
  key: string;
  title: string;
  value: number;
  color: string;
  lane?: DemandLaneFilter;
};

const SUMMARY_DEFAULT = {
  total: 0,
  held: 0,
  cancelled: 0,
  no_date: 0,
  overdue: 0,
  due_today: 0,
  upcoming_7_days: 0,
  not_due: 0,
  partially_planned: 0,
  fully_planned: 0,
  no_production_needed: 0,
  not_released: 0,
  in_progress: 0,
  completed: 0,
};

const PLANNING_STATUS_LABELS: Record<ProductionDemandPlanningStatus, string> = {
  NOT_DUE: 'Chưa tới hạn',
  UPCOMING: 'Sắp đến hạn',
  DUE: 'Cần lập KH',
  OVERDUE: 'Quá hạn',
  PARTIALLY_PLANNED: 'Đã lập một phần',
  FULLY_PLANNED: 'Đã lập đủ',
  NO_PRODUCTION_NEEDED: 'Không cần SX',
  CANCELLED: 'Đã hủy',
};

const PLANNING_STATUS_COLORS: Record<ProductionDemandPlanningStatus, string> = {
  NOT_DUE: 'default',
  UPCOMING: 'processing',
  DUE: 'gold',
  OVERDUE: 'error',
  PARTIALLY_PLANNED: 'cyan',
  FULLY_PLANNED: 'success',
  NO_PRODUCTION_NEEDED: 'purple',
  CANCELLED: 'magenta',
};

const PRODUCTION_STATUS_LABELS: Record<ProductionDemandProductionStatus, string> = {
  NOT_RELEASED: 'Chưa phát hành',
  PARTIALLY_RELEASED: 'Phát hành một phần',
  FULLY_RELEASED: 'Đã phát hành',
  IN_PROGRESS: 'Đang sản xuất',
  PARTIALLY_COMPLETED: 'Hoàn thành một phần',
  COMPLETED: 'Hoàn thành',
  PAUSED: 'Tạm dừng',
  CANCELLED: 'Đã hủy',
};

const PRODUCTION_STATUS_COLORS: Record<ProductionDemandProductionStatus, string> = {
  NOT_RELEASED: 'default',
  PARTIALLY_RELEASED: 'cyan',
  FULLY_RELEASED: 'blue',
  IN_PROGRESS: 'gold',
  PARTIALLY_COMPLETED: 'lime',
  COMPLETED: 'success',
  PAUSED: 'orange',
  CANCELLED: 'magenta',
};

const PRODUCT_KIND_LABELS: Record<string, string> = {
  SPECIFIC: 'Mã riêng',
  GENERIC: 'Mã chung',
};

const PRODUCT_KIND_COLORS: Record<string, string> = {
  SPECIFIC: 'blue',
  GENERIC: 'gold',
};

const PRIORITY_LABELS: Record<ProductionDemandPriority, string> = {
  LOW: 'Thấp',
  NORMAL: 'Bình thường',
  HIGH: 'Cao',
  URGENT: 'Khẩn',
};

const PRIORITY_COLORS: Record<ProductionDemandPriority, string> = {
  LOW: 'default',
  NORMAL: 'blue',
  HIGH: 'orange',
  URGENT: 'red',
};

const LANE_LABELS: Record<DemandLaneFilter, string> = {
  ALL: 'Tất cả',
  OVERDUE: 'Quá hạn',
  DUE_TODAY: 'Cần lập hôm nay',
  UPCOMING_7: 'Sắp đến hạn 7 ngày',
  NOT_DUE: 'Chưa tới hạn',
  HELD: 'Cần xử lý',
  NO_DATE: 'Chưa có ngày',
  PARTIALLY_PLANNED: 'Đã lập một phần',
  FULLY_PLANNED: 'Đã lập đủ',
  IN_PROGRESS: 'Đang sản xuất',
  COMPLETED: 'Hoàn thành',
};

const DEMAND_LANES: DemandLaneFilter[] = [
  'ALL',
  'OVERDUE',
  'DUE_TODAY',
  'UPCOMING_7',
  'NOT_DUE',
  'HELD',
  'NO_DATE',
  'PARTIALLY_PLANNED',
  'FULLY_PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
];

const PLANNING_STATUS_OPTIONS = Object.entries(PLANNING_STATUS_LABELS).map(([value, label]) => ({ value, label }));
const PRODUCTION_STATUS_OPTIONS = Object.entries(PRODUCTION_STATUS_LABELS).map(([value, label]) => ({ value, label }));
const PRODUCT_KIND_OPTIONS = [
  { value: 'SPECIFIC', label: 'Mã riêng' },
  { value: 'GENERIC', label: 'Mã chung' },
];
const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }));

const ORDERING_FIELD_MAP: Record<string, string> = {
  planning_due_date: 'planning_due_date',
  delivery_date: 'delivery_date',
  product_code: 'product_code',
  priority: 'priority',
  created_at: 'created_at',
};

const formatDate = (value?: string | null) => (value ? dayjs(value).format('DD/MM/YYYY') : '-');
const formatNumber = (value?: string | number | null) => Number(value || 0).toLocaleString('vi-VN');
const formatMaybeText = (value?: string | null) => {
  const normalized = String(value || '').trim();
  return normalized || '-';
};

const isDemandLaneFilter = (value: unknown): value is DemandLaneFilter => (
  typeof value === 'string' && DEMAND_LANES.includes(value as DemandLaneFilter)
);

const cleanFilters = (filters: DemandFilters): DemandFilters => {
  const next: DemandFilters = {};
  if (filters.planning_status) next.planning_status = filters.planning_status;
  if (filters.production_status) next.production_status = filters.production_status;
  if (filters.product_kind) next.product_kind = filters.product_kind;
  if (filters.priority) next.priority = filters.priority;
  if (filters.product_code?.trim()) next.product_code = filters.product_code.trim();
  if (filters.customer?.trim()) next.customer = filters.customer.trim();
  if (filters.delivery_date_from) next.delivery_date_from = filters.delivery_date_from;
  if (filters.delivery_date_to) next.delivery_date_to = filters.delivery_date_to;
  if (filters.planning_due_date_from) next.planning_due_date_from = filters.planning_due_date_from;
  if (filters.planning_due_date_to) next.planning_due_date_to = filters.planning_due_date_to;
  return next;
};

const getDemandCode = (demand: ProductionDemand) => demand.demand_code || demand.demand_key;
const getCustomerDisplay = (demand: ProductionDemand) => (
  demand.customer_display || demand.customer_name_snapshot || '-'
);

const getLaneParams = (lane: DemandLaneFilter): ProductionDemandQueryParams => {
  switch (lane) {
    case 'OVERDUE':
      return { planning_bucket: 'overdue' };
    case 'DUE_TODAY':
      return { planning_bucket: 'due_today' };
    case 'UPCOMING_7':
      return { planning_bucket: 'upcoming_7' };
    case 'NOT_DUE':
      return { planning_bucket: 'not_due' };
    case 'HELD':
      return { planning_bucket: 'held' };
    case 'NO_DATE':
      return { planning_bucket: 'no_date' };
    case 'PARTIALLY_PLANNED':
      return { planning_status: 'PARTIALLY_PLANNED' };
    case 'FULLY_PLANNED':
      return { planning_status: 'FULLY_PLANNED' };
    case 'IN_PROGRESS':
      return { production_status: 'IN_PROGRESS' };
    case 'COMPLETED':
      return { production_status: 'COMPLETED' };
    default:
      return {};
  }
};

const getLaneCount = (lane: DemandLaneFilter, summary: typeof SUMMARY_DEFAULT) => {
  switch (lane) {
    case 'OVERDUE':
      return summary.overdue;
    case 'DUE_TODAY':
      return summary.due_today;
    case 'UPCOMING_7':
      return summary.upcoming_7_days;
    case 'NOT_DUE':
      return summary.not_due;
    case 'HELD':
      return summary.held;
    case 'NO_DATE':
      return summary.no_date;
    case 'PARTIALLY_PLANNED':
      return summary.partially_planned;
    case 'FULLY_PLANNED':
      return summary.fully_planned;
    case 'IN_PROGRESS':
      return summary.in_progress;
    case 'COMPLETED':
      return summary.completed;
    default:
      return summary.total;
  }
};

const getOrderingFromSorter = (sorter: Parameters<NonNullable<TableProps<ProductionDemand>['onChange']>>[2]) => {
  const sorterItem = Array.isArray(sorter) ? sorter[0] : sorter;
  if (!sorterItem?.order) {
    return 'planning_due_date,delivery_date,id';
  }
  const rawField = String(sorterItem.field || sorterItem.columnKey || '');
  const field = ORDERING_FIELD_MAP[rawField];
  if (!field) {
    return 'planning_due_date,delivery_date,id';
  }
  return sorterItem.order === 'descend' ? `-${field}` : field;
};

const dateRangeValue = (from?: string, to?: string): [Dayjs | null, Dayjs | null] | null => {
  if (!from && !to) return null;
  return [from ? dayjs(from) : null, to ? dayjs(to) : null];
};

const normalizePrintColor = (item: unknown): string => {
  if (typeof item === 'string') {
    return item.trim();
  }
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>;
    const raw = record.name || record.color || record.code || record.label || record.value;
    return typeof raw === 'string' ? raw.trim() : '';
  }
  return '';
};

const getPrintColors = (demand: ProductionDemand) => (
  Array.isArray(demand.print_colors)
    ? demand.print_colors.map(normalizePrintColor).filter(Boolean)
    : []
);

const getPrintColorsDisplay = (demand: ProductionDemand) => {
  const colors = getPrintColors(demand);
  if (colors.length) return colors;
  if (typeof demand.print_colors === 'string' && demand.print_colors.trim()) {
    return [demand.print_colors.trim()];
  }
  return [];
};

const getSalesOrderHref = (demand: ProductionDemand) => {
  if (demand.sales_order) {
    return `/sales-orders?focus_id=${demand.sales_order}`;
  }
  if (demand.sales_order_code) {
    return `/sales-orders?q=${encodeURIComponent(demand.sales_order_code)}`;
  }
  return '';
};

const getPlanningBucketLabel = (bucket?: string | null) => {
  switch (bucket) {
    case 'held':
      return 'Cần xử lý';
    case 'cancelled':
      return 'Đã hủy';
    case 'no_date':
      return 'Chưa có ngày';
    case 'overdue':
      return 'Quá hạn';
    case 'due_today':
      return 'Cần lập hôm nay';
    case 'upcoming_7':
      return 'Sắp đến hạn 7 ngày';
    case 'not_due':
      return 'Chưa tới hạn';
    default:
      return bucket || '-';
  }
};

const formatDetailDate = (value?: string | null) => (value ? dayjs(value).format('DD/MM/YYYY') : 'Chưa có');

const getRecordText = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
};

const formatSummaryItem = (item: unknown, kind: 'operation' | 'routing') => {
  if (typeof item === 'string') return item.trim();
  if (!item || typeof item !== 'object') return String(item ?? '').trim();

  const record = item as Record<string, unknown>;
  const operation = [
    getRecordText(record, ['operation_code', 'code']),
    getRecordText(record, ['operation_name', 'name']),
  ].filter(Boolean).join(' - ');
  const rate = getRecordText(record, ['applied_rate_per_hour', 'standard_rate_per_hour', 'rate_per_hour']);
  const note = getRecordText(record, ['note', 'override_reason']);

  if (kind === 'routing') {
    const step = getRecordText(record, ['display_step', 'step_no', 'display_order']);
    const stepType = getRecordText(record, ['step_type']);
    const group = getRecordText(record, ['group_code']);
    return [
      step ? `Bước ${step}` : '',
      operation,
      rate ? `Định mức ${formatNumber(rate)}` : '',
      stepType ? `Kiểu ${stepType}` : '',
      group ? `Nhóm ${group}` : '',
      note,
    ].filter(Boolean).join(' · ');
  }

  return [
    operation,
    rate ? `Định mức ${formatNumber(rate)}` : '',
    note,
  ].filter(Boolean).join(' · ');
};

const renderSummaryBlock = (
  value: ProductionDemand['operations_summary'] | ProductionDemand['routing_summary'],
  kind: 'operation' | 'routing',
  emptyText: string,
) => {
  if (Array.isArray(value) && value.length) {
    return (
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {value.map((item, index) => {
          const text = formatSummaryItem(item, kind);
          return (
            <Text key={`${kind}-${index}`}>
              {text || JSON.stringify(item)}
            </Text>
          );
        })}
      </Space>
    );
  }

  if (typeof value === 'string' && value.trim()) {
    return <Text style={{ whiteSpace: 'pre-wrap' }}>{value.trim()}</Text>;
  }

  if (value && typeof value === 'object') {
    return (
      <Text style={{ whiteSpace: 'pre-wrap' }}>
        {JSON.stringify(value, null, 2)}
      </Text>
    );
  }

  return <Text type="secondary">{emptyText}</Text>;
};

const renderTextBlock = (value?: string | null, emptyText = 'Chưa có') => {
  const text = String(value || '').trim();
  return text ? <Text style={{ whiteSpace: 'pre-wrap' }}>{text}</Text> : <Text type="secondary">{emptyText}</Text>;
};

const renderPlanningStatus = (status: ProductionDemandPlanningStatus, row?: ProductionDemand) => {
  if (row?.is_held || row?.hold_reason) {
    return (
      <Space size={4} wrap>
        <Tag color="error">Cần xử lý</Tag>
        <Tag color={PLANNING_STATUS_COLORS[status] || 'default'}>
          {PLANNING_STATUS_LABELS[status] || status}
        </Tag>
      </Space>
    );
  }
  return (
    <Tag color={PLANNING_STATUS_COLORS[status] || 'default'}>
      {PLANNING_STATUS_LABELS[status] || status}
    </Tag>
  );
};

const renderProductionStatus = (status: ProductionDemandProductionStatus) => (
  <Tag color={PRODUCTION_STATUS_COLORS[status] || 'default'}>
    {PRODUCTION_STATUS_LABELS[status] || status}
  </Tag>
);

const renderPriority = (priority: ProductionDemandPriority) => (
  <Tag color={PRIORITY_COLORS[priority] || 'default'}>
    {PRIORITY_LABELS[priority] || priority}
  </Tag>
);

const renderProductKind = (kind?: string) => {
  const normalized = String(kind || '').trim() || 'SPECIFIC';
  const color = PRODUCT_KIND_COLORS[normalized] || 'default';
  return (
    <Tag color={color}>
      {PRODUCT_KIND_LABELS[normalized] || normalized}
    </Tag>
  );
};

export default function ProductionDemandList() {
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<DemandFilters>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [ordering, setOrdering] = useState('planning_due_date,delivery_date,id');
  const { config, saveConfig } = useUserPreferences(PAGES.PRODUCTION_DEMANDS);
  const configRecord = config as Record<string, unknown>;
  const storedLane = isDemandLaneFilter(configRecord?.laneFilter) ? configRecord.laneFilter : 'ALL';
  const [activeLane, setActiveLane] = useState<DemandLaneFilter>(storedLane);
  const pageSize = Number(configRecord?.pageSize ?? 20);
  const [selectedDemandId, setSelectedDemandId] = useState<number | null>(null);
  const [selectedDemandPreview, setSelectedDemandPreview] = useState<ProductionDemand | null>(null);

  useEffect(() => {
    setActiveLane(storedLane);
  }, [storedLane]);

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (value) => JSON.stringify(cleanFilters(value as DemandFilters)),
    parseFilters: (value) => {
      try {
        return cleanFilters(JSON.parse(value) as DemandFilters);
      } catch {
        return {};
      }
    },
  });

  const effectiveFilters = useMemo(() => cleanFilters(intentFilters as DemandFilters), [intentFilters]);
  const laneParams = useMemo(() => getLaneParams(activeLane), [activeLane]);

  const listParams = useMemo(() => ({
    search: intentSearch.trim() || undefined,
    ...effectiveFilters,
    ...laneParams,
    page,
    page_size: pageSize,
    ordering,
  }), [effectiveFilters, intentSearch, laneParams, ordering, page, pageSize]);

  const summaryParams = useMemo(() => ({
    search: intentSearch.trim() || undefined,
    ...effectiveFilters,
  }), [effectiveFilters, intentSearch]);

  const listQuery = useQuery({
    queryKey: ['production-demands', listParams],
    queryFn: () => productionApi.getDemands(listParams),
  });

  const summaryQuery = useQuery({
    queryKey: ['production-demands-summary', summaryParams],
    queryFn: () => productionApi.getDemandSummary(summaryParams),
  });

  const detailQuery = useQuery({
    queryKey: ['production-demand-detail', selectedDemandId],
    queryFn: () => productionApi.getDemand(selectedDemandId as number),
    enabled: Boolean(selectedDemandId),
  });

  const rows = listQuery.data?.results ?? [];
  const summary = summaryQuery.data ?? SUMMARY_DEFAULT;
  const selectedDemand = detailQuery.data ?? selectedDemandPreview;
  const hasSearch = Boolean(intentSearch.trim());
  const hasFilters = Object.keys(effectiveFilters).length > 0;
  const hasActiveView = hasSearch || hasFilters || activeLane !== 'ALL';
  const errorMessage = listQuery.isError ? getToastMessage(listQuery.error) : '';

  const summaryCards: SummaryCard[] = [
    { key: 'overdue', title: 'Quá hạn', value: summary.overdue, color: '#cf1322', lane: 'OVERDUE' },
    { key: 'due_today', title: 'Hôm nay', value: summary.due_today, color: '#d48806', lane: 'DUE_TODAY' },
    { key: 'upcoming', title: '7 ngày tới', value: summary.upcoming_7_days, color: '#1677ff', lane: 'UPCOMING_7' },
    { key: 'held', title: 'Cần xử lý', value: summary.held, color: '#c41d7f', lane: 'HELD' },
    { key: 'no_date', title: 'Chưa có ngày', value: summary.no_date, color: '#595959', lane: 'NO_DATE' },
    { key: 'fully_planned', title: 'Đã lập đủ', value: summary.fully_planned, color: '#389e0d', lane: 'FULLY_PLANNED' },
    { key: 'in_progress', title: 'Đang sản xuất', value: summary.in_progress, color: '#fa8c16', lane: 'IN_PROGRESS' },
  ];

  const updateFilters = (patch: Partial<DemandFilters>, options: { resetLane?: boolean } = {}) => {
    setFilters((previous) => cleanFilters({ ...previous, ...patch }));
    setPage(1);
    if (options.resetLane) {
      setActiveLane('ALL');
      void saveConfig({ ...(config as Record<string, unknown>), laneFilter: 'ALL' });
    }
  };

  const resetAllFilters = () => {
    setSearchInput('');
    setFilters({});
    setActiveLane('ALL');
    setPage(1);
    void saveConfig({ ...(config as Record<string, unknown>), laneFilter: 'ALL' });
  };

  const handleLaneChange = (lane: string) => {
    const nextLane = isDemandLaneFilter(lane) ? lane : 'ALL';
    setActiveLane(nextLane);
    setPage(1);
    void saveConfig({ ...(config as Record<string, unknown>), laneFilter: nextLane });
  };

  const handleDateRangeChange = (
    field: 'delivery_date' | 'planning_due_date',
    values: [Dayjs | null, Dayjs | null] | null,
  ) => {
    updateFilters({
      [`${field}_from`]: values?.[0]?.format('YYYY-MM-DD') || undefined,
      [`${field}_to`]: values?.[1]?.format('YYYY-MM-DD') || undefined,
    });
  };

  const refreshData = async () => {
    await Promise.all([
      listQuery.refetch(),
      summaryQuery.refetch(),
    ]);
  };

  const openDemandDetail = (demand: ProductionDemand) => {
    setSelectedDemandPreview(demand);
    setSelectedDemandId(demand.id);
  };

  const closeDemandDetail = () => {
    setSelectedDemandId(null);
    setSelectedDemandPreview(null);
  };

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (activeLane !== 'ALL') tags.push(`Lane: ${LANE_LABELS[activeLane]}`);
    if (effectiveFilters.product_kind) tags.push(`Loại mã: ${PRODUCT_KIND_LABELS[effectiveFilters.product_kind] || effectiveFilters.product_kind}`);
    if (effectiveFilters.priority) tags.push(`Ưu tiên: ${PRIORITY_LABELS[effectiveFilters.priority] || effectiveFilters.priority}`);
    if (effectiveFilters.planning_status) tags.push(`KH: ${PLANNING_STATUS_LABELS[effectiveFilters.planning_status] || effectiveFilters.planning_status}`);
    if (effectiveFilters.production_status) tags.push(`SX: ${PRODUCTION_STATUS_LABELS[effectiveFilters.production_status] || effectiveFilters.production_status}`);
    if (effectiveFilters.product_code) tags.push(`Mã hàng: ${effectiveFilters.product_code}`);
    if (effectiveFilters.customer) tags.push(`Khách hàng: ${effectiveFilters.customer}`);
    if (effectiveFilters.delivery_date_from || effectiveFilters.delivery_date_to) {
      tags.push(`Ngày giao: ${formatDate(effectiveFilters.delivery_date_from)} - ${formatDate(effectiveFilters.delivery_date_to)}`);
    }
    if (effectiveFilters.planning_due_date_from || effectiveFilters.planning_due_date_to) {
      tags.push(`Ngày lập KH: ${formatDate(effectiveFilters.planning_due_date_from)} - ${formatDate(effectiveFilters.planning_due_date_to)}`);
    }
    return tags;
  }, [activeLane, effectiveFilters, intentSearch]);

  const columns: ColumnsType<ProductionDemand> = [
    {
      title: 'Ngày cần lập KH',
      dataIndex: 'planning_due_date',
      key: 'planning_due_date',
      width: 140,
      render: (value: string | null, row) => {
        const isOverdue = row.planning_bucket === 'overdue';
        return <Text type={isOverdue ? 'danger' : undefined} strong={isOverdue}>{formatDate(value)}</Text>;
      },
      sorter: true,
    },
    {
      title: 'Ngày giao',
      dataIndex: 'delivery_date',
      key: 'delivery_date',
      width: 120,
      render: (value: string | null) => formatDate(value),
      sorter: true,
    },
    {
      title: 'Số đơn',
      width: 170,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{formatMaybeText(row.sales_order_code)}</Text>
          <Button
            type="link"
            size="small"
            style={{ height: 'auto', padding: 0, fontSize: 12 }}
            onClick={() => openDemandDetail(row)}
          >
            {getDemandCode(row)}
          </Button>
        </Space>
      ),
    },
    {
      title: 'Khách hàng',
      width: 200,
      render: (_, row) => (
        <Tooltip title={getCustomerDisplay(row)}>
          <Text ellipsis style={{ maxWidth: 180 }}>{getCustomerDisplay(row)}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Mã hàng',
      dataIndex: 'product_code',
      key: 'product_code',
      width: 150,
      render: (value: string) => <Text strong>{formatMaybeText(value)}</Text>,
      sorter: true,
    },
    {
      title: 'Tên hàng',
      dataIndex: 'product_name',
      width: 300,
      render: (value: string, row) => {
        const colors = getPrintColors(row);
        const visibleColors = colors.slice(0, 3);
        const hiddenCount = Math.max(0, colors.length - visibleColors.length);
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Tooltip title={formatMaybeText(value)}>
              <Text ellipsis style={{ maxWidth: 270 }}>{formatMaybeText(value)}</Text>
            </Tooltip>
            <Space size={4} wrap>
              {row.size_order ? <Text type="secondary" style={{ fontSize: 12 }}>{row.size_order}</Text> : null}
              {visibleColors.map((color) => <Tag key={color} color="default">{color}</Tag>)}
              {hiddenCount > 0 ? <Tag color="default">+{hiddenCount}</Tag> : null}
            </Space>
          </Space>
        );
      },
    },
    {
      title: 'Loại mã',
      dataIndex: 'product_kind',
      width: 110,
      render: (value: string) => renderProductKind(value),
    },
    {
      title: 'SL cần SX',
      dataIndex: 'qty_required',
      width: 120,
      align: 'right',
      render: (value: string) => formatNumber(value),
    },
    {
      title: 'SL đã lập KH',
      dataIndex: 'qty_planned',
      width: 130,
      align: 'right',
      render: (value: string) => formatNumber(value),
    },
    {
      title: 'SL còn lại',
      dataIndex: 'qty_remaining_to_plan',
      width: 120,
      align: 'right',
      render: (value: string) => {
        const numericValue = Number(value || 0);
        return <Text strong={numericValue > 0}>{formatNumber(value)}</Text>;
      },
    },
    {
      title: 'Trạng thái KH',
      dataIndex: 'planning_status',
      width: 180,
      render: (status: ProductionDemandPlanningStatus, row) => renderPlanningStatus(status, row),
    },
    {
      title: 'Trạng thái SX',
      dataIndex: 'production_status',
      width: 170,
      render: (status: ProductionDemandProductionStatus) => renderProductionStatus(status),
    },
    {
      title: 'Ưu tiên',
      dataIndex: 'priority',
      key: 'priority',
      width: 120,
      render: (priority: ProductionDemandPriority) => renderPriority(priority),
      sorter: true,
    },
    {
      title: 'Hold/Ghi chú',
      width: 260,
      render: (_, row) => {
        const text = row.hold_reason || row.notes || '-';
        if (row.hold_reason) {
          return (
            <Tooltip title={row.hold_reason}>
              <Text type="danger" ellipsis style={{ maxWidth: 230 }}>Cần xử lý: {row.hold_reason}</Text>
            </Tooltip>
          );
        }
        return (
          <Tooltip title={text}>
            <Text type="secondary" ellipsis style={{ maxWidth: 230 }}>{text}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: 'Hành động',
      width: 110,
      fixed: 'right',
      render: (_, row) => (
        <Button
          size="small"
          icon={<EyeOutlined />}
          onClick={() => openDemandDetail(row)}
        >
          Chi tiết
        </Button>
      ),
    },
  ];

  const handleTableChange: TableProps<ProductionDemand>['onChange'] = (pagination, _filters, sorter) => {
    setPage(pagination.current || 1);
    const nextPageSize = pagination.pageSize || pageSize;
    if (nextPageSize !== pageSize) {
      void saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize });
    }
    setOrdering(getOrderingFromSorter(sorter));
  };

  const renderDemandDrawerContent = () => {
    if (detailQuery.isLoading && !selectedDemand) {
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin />
        </div>
      );
    }

    if (!selectedDemand) {
      return <Empty description="Chưa có dữ liệu chi tiết nhu cầu." />;
    }

    const salesOrderHref = getSalesOrderHref(selectedDemand);
    const colors = getPrintColorsDisplay(selectedDemand);

    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {detailQuery.isFetching ? (
          <Alert showIcon type="info" message="Đang làm mới dữ liệu chi tiết..." />
        ) : null}
        {detailQuery.isError ? (
          <Alert
            showIcon
            type="error"
            message="Không tải được chi tiết mới nhất"
            description={getToastMessage(detailQuery.error)}
          />
        ) : null}

        <Card size="small" title="Thông tin đơn hàng">
          <Descriptions column={1} size="small" bordered labelStyle={{ width: 190 }}>
            <Descriptions.Item label="Số đơn">
              <Space>
                <Text strong>{formatMaybeText(selectedDemand.sales_order_code)}</Text>
                {salesOrderHref ? (
                  <Button size="small" href={salesOrderHref}>
                    Xem đơn hàng
                  </Button>
                ) : null}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Khách hàng">{getCustomerDisplay(selectedDemand)}</Descriptions.Item>
            <Descriptions.Item label="Dòng đơn">
              {selectedDemand.sales_order_line_number ? `Dòng ${selectedDemand.sales_order_line_number}` : formatMaybeText(selectedDemand.delivery_plan_display)}
            </Descriptions.Item>
            <Descriptions.Item label="Mã hàng">{formatMaybeText(selectedDemand.product_code || selectedDemand.product_display_code)}</Descriptions.Item>
            <Descriptions.Item label="Tên hàng">{formatMaybeText(selectedDemand.product_name || selectedDemand.product_display_name)}</Descriptions.Item>
            <Descriptions.Item label="Loại mã">{renderProductKind(selectedDemand.product_kind)}</Descriptions.Item>
            <Descriptions.Item label="Đơn vị">{formatMaybeText(selectedDemand.unit_name)}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card size="small" title="Quy cách và màu in">
          <Descriptions column={1} size="small" bordered labelStyle={{ width: 190 }}>
            <Descriptions.Item label="Quy cách đặt hàng">{formatMaybeText(selectedDemand.size_order)}</Descriptions.Item>
            <Descriptions.Item label="Quy cách sản xuất">{formatMaybeText(selectedDemand.size_production)}</Descriptions.Item>
            <Descriptions.Item label="Màu in">
              {colors.length ? (
                <Space size={4} wrap>
                  {colors.map((color) => <Tag key={color}>{color}</Tag>)}
                </Space>
              ) : (
                <Text type="secondary">Chưa có màu in</Text>
              )}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Card size="small" title="Số lượng và trạng thái">
          <Descriptions column={1} size="small" bordered labelStyle={{ width: 190 }}>
            <Descriptions.Item label="SL cần sản xuất">{formatNumber(selectedDemand.qty_required)}</Descriptions.Item>
            <Descriptions.Item label="SL đã lập KH">{formatNumber(selectedDemand.qty_planned)}</Descriptions.Item>
            <Descriptions.Item label="SL còn lại">{formatNumber(selectedDemand.qty_remaining_to_plan)}</Descriptions.Item>
            <Descriptions.Item label="SL đã phát hành">{formatNumber(selectedDemand.qty_released)}</Descriptions.Item>
            <Descriptions.Item label="SL đã hoàn thành">{formatNumber(selectedDemand.qty_completed)}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái kế hoạch">{renderPlanningStatus(selectedDemand.planning_status, selectedDemand)}</Descriptions.Item>
            <Descriptions.Item label="Trạng thái sản xuất">{renderProductionStatus(selectedDemand.production_status)}</Descriptions.Item>
            <Descriptions.Item label="Ưu tiên">{renderPriority(selectedDemand.priority)}</Descriptions.Item>
            <Descriptions.Item label="Nhóm thời hạn">
              <Space size={6} wrap>
                <Tag color={selectedDemand.is_held ? 'error' : 'default'}>
                  {getPlanningBucketLabel(selectedDemand.planning_bucket)}
                </Tag>
                {selectedDemand.is_held ? <Tag color="error">Đang hold/cần xử lý</Tag> : null}
              </Space>
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Card size="small" title="Ngày tháng">
          <Descriptions column={1} size="small" bordered labelStyle={{ width: 190 }}>
            <Descriptions.Item label="Ngày đơn">{formatDetailDate(selectedDemand.order_date)}</Descriptions.Item>
            <Descriptions.Item label="Ngày giao">{formatDetailDate(selectedDemand.delivery_date)}</Descriptions.Item>
            <Descriptions.Item label="Ngày cần hoàn thành SX">{formatDetailDate(selectedDemand.production_due_date)}</Descriptions.Item>
            <Descriptions.Item label="Ngày cần lập kế hoạch">{formatDetailDate(selectedDemand.planning_due_date)}</Descriptions.Item>
            <Descriptions.Item label="Ngày nhắc">{formatDetailDate(selectedDemand.reminder_date)}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card size="small" title="Hold / ghi chú">
          {selectedDemand.hold_reason ? (
            <Alert
              showIcon
              type="warning"
              message="Nhu cầu đang cần xử lý"
              description={selectedDemand.hold_reason}
              style={{ marginBottom: 12 }}
            />
          ) : null}
          <Descriptions column={1} size="small" bordered labelStyle={{ width: 190 }}>
            <Descriptions.Item label="Hold reason">{renderTextBlock(selectedDemand.hold_reason)}</Descriptions.Item>
            <Descriptions.Item label="Ghi chú">{renderTextBlock(selectedDemand.notes)}</Descriptions.Item>
            <Descriptions.Item label="Ghi chú nhắc">{renderTextBlock(selectedDemand.reminder_note)}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card size="small" title="Công đoạn áp dụng">
          {renderSummaryBlock(selectedDemand.operations_summary, 'operation', 'Chưa có công đoạn áp dụng')}
        </Card>

        <Card size="small" title="Thứ tự công đoạn sản xuất">
          {renderSummaryBlock(selectedDemand.routing_summary, 'routing', 'Chưa có thứ tự công đoạn')}
        </Card>
      </Space>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="list-page-head">
        <div>
          <Title level={2} style={{ marginBottom: 4 }}>Nhu cầu sản xuất</Title>
          <Text type="secondary">Theo dõi nhu cầu sản xuất phát sinh từ đơn hàng và kế hoạch giao.</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void refreshData()}>
          Tải lại
        </Button>
      </div>

      {errorMessage ? (
        <Alert
          showIcon
          type="error"
          message="Không tải được nhu cầu sản xuất"
          description={errorMessage}
        />
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {summaryCards.map((item) => (
          <Card
            key={item.key}
            hoverable={Boolean(item.lane)}
            size="small"
            style={{ height: '100%', borderRadius: 8 }}
            onClick={() => item.lane && handleLaneChange(item.lane)}
          >
            <Statistic title={item.title} value={item.value} valueStyle={{ color: item.color }} />
          </Card>
        ))}
      </div>

      <Card size="small">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Tabs
            activeKey={activeLane}
            onChange={handleLaneChange}
            items={DEMAND_LANES.map((lane) => ({
              key: lane,
              label: `${LANE_LABELS[lane]} (${formatNumber(getLaneCount(lane, summary))})`,
            }))}
          />

          <Space wrap align="start">
            <Input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              placeholder="Tìm mã nhu cầu, đơn hàng, khách hàng, mã hàng..."
              style={{ width: 360, maxWidth: '100%' }}
              suffix={searchInput ? (
                <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" />
              ) : undefined}
            />
            <Select
              value={filters.product_kind || ''}
              style={{ width: 140 }}
              options={[{ value: '', label: 'Tất cả mã' }, ...PRODUCT_KIND_OPTIONS]}
              onChange={(value) => updateFilters({ product_kind: value || undefined })}
            />
            <Select
              value={filters.priority || ''}
              style={{ width: 140 }}
              options={[{ value: '', label: 'Mọi ưu tiên' }, ...PRIORITY_OPTIONS]}
              onChange={(value) => updateFilters({ priority: (value || undefined) as ProductionDemandPriority | undefined })}
            />
            <Select
              value={filters.planning_status || ''}
              style={{ width: 180 }}
              options={[{ value: '', label: 'Mọi trạng thái KH' }, ...PLANNING_STATUS_OPTIONS]}
              onChange={(value) => updateFilters(
                { planning_status: (value || undefined) as ProductionDemandPlanningStatus | undefined },
                { resetLane: Boolean(value) },
              )}
            />
            <Select
              value={filters.production_status || ''}
              style={{ width: 180 }}
              options={[{ value: '', label: 'Mọi trạng thái SX' }, ...PRODUCTION_STATUS_OPTIONS]}
              onChange={(value) => updateFilters(
                { production_status: (value || undefined) as ProductionDemandProductionStatus | undefined },
                { resetLane: Boolean(value) },
              )}
            />
            <Button onClick={() => setAdvancedOpen((value) => !value)}>
              {advancedOpen ? 'Ẩn lọc nâng cao' : 'Bộ lọc nâng cao'}
            </Button>
            {hasActiveView ? <Button onClick={resetAllFilters}>Xóa lọc</Button> : null}
          </Space>

          {advancedOpen ? (
            <Space wrap align="start">
              <Input
                value={filters.product_code || ''}
                onChange={(event) => updateFilters({ product_code: event.target.value })}
                placeholder="Mã hàng chứa..."
                style={{ width: 180 }}
                suffix={filters.product_code ? (
                  <QuickClearIcon onClear={() => updateFilters({ product_code: undefined })} title="Xóa mã hàng" />
                ) : undefined}
              />
              <Input
                value={filters.customer || ''}
                onChange={(event) => updateFilters({ customer: event.target.value })}
                placeholder="Khách hàng chứa..."
                style={{ width: 220 }}
                suffix={filters.customer ? (
                  <QuickClearIcon onClear={() => updateFilters({ customer: undefined })} title="Xóa khách hàng" />
                ) : undefined}
              />
              <RangePicker
                value={dateRangeValue(filters.delivery_date_from, filters.delivery_date_to)}
                onChange={(values) => handleDateRangeChange('delivery_date', values)}
                format="DD/MM/YYYY"
                placeholder={['Giao từ', 'Giao đến']}
              />
              <RangePicker
                value={dateRangeValue(filters.planning_due_date_from, filters.planning_due_date_to)}
                onChange={(values) => handleDateRangeChange('planning_due_date', values)}
                format="DD/MM/YYYY"
                placeholder={['Lập KH từ', 'Lập KH đến']}
              />
            </Space>
          ) : null}

          <Space wrap>
            <Tag color="blue">Tổng: {formatNumber(listQuery.data?.count ?? 0)}</Tag>
            {activeFilterTags.length ? (
              activeFilterTags.map((tag) => <Tag key={tag} color="processing">{tag}</Tag>)
            ) : (
              <Tag color="default">Đang xem toàn bộ nhu cầu</Tag>
            )}
          </Space>
        </Space>
      </Card>

      <div className="list-page-table-wrap">
        <Table<ProductionDemand>
          className="enterprise-data-table"
          rowKey="id"
          loading={listQuery.isLoading || listQuery.isFetching}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 2160 }}
          onChange={handleTableChange}
          pagination={{
            current: page,
            pageSize,
            total: listQuery.data?.count ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
          }}
          locale={{
            emptyText: !listQuery.isLoading ? (
              <div style={{ padding: 32 }}>
                <Empty description={hasActiveView ? 'Không tìm thấy nhu cầu sản xuất phù hợp.' : 'Chưa có nhu cầu sản xuất nào.'} />
                {hasActiveView ? <Button type="link" onClick={resetAllFilters}>Xóa lọc</Button> : null}
              </div>
            ) : undefined,
          }}
        />
      </div>

      <Drawer
        title={(
          <Space direction="vertical" size={0}>
            <Text strong>Chi tiết nhu cầu sản xuất</Text>
            {selectedDemand ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {getDemandCode(selectedDemand)}
              </Text>
            ) : null}
          </Space>
        )}
        width={840}
        open={Boolean(selectedDemandId)}
        onClose={closeDemandDetail}
        destroyOnClose
        footer={(
          <div style={{ textAlign: 'right' }}>
            <Button onClick={closeDemandDetail}>Đóng</Button>
          </div>
        )}
      >
        {renderDemandDrawerContent()}
      </Drawer>
    </div>
  );
}
