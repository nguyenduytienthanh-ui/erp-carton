import { useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Form, Input, Modal, Progress, Select, Space, Statistic, Table, Tag, Typography, message, Skeleton } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckCircleOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, EyeOutlined, InboxOutlined, PlusOutlined, StopOutlined, ToolOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { productionApi } from '../../api/production';
import { productsApi } from '../../api/products';
import { inventoryApi } from '../../api/inventory';
import { salesApi } from '../../api/sales';
import type {
  ProductionApprovalHistoryItem,
  ProductionPlannerDigest,
  ProductionOrder,
  ProductionOrderFormValues,
  ProductionOrderSourceFilter,
  ProductionOrderStatus,
} from '../../types/production';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { PAGES } from '../../utils/constants';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';
import ProductionOrderForm from './ProductionOrderForm';

type Filters = { status?: ProductionOrderStatus; source_type?: ProductionOrderSourceFilter };
type ActionFormValues = { reason: string };
type ActionModalState = { type: 'reject' | 'cancel'; order: ProductionOrder } | null;
type ProductionOrderLaneFilter = 'ALL' | 'DRAFT_QUEUE' | 'PENDING_APPROVAL' | 'READY_TO_RELEASE' | 'ACTIVE_EXECUTION' | 'OVERDUE_PLAN';
type ProductionOrderViewSnapshot = {
  search_input: string;
  status: ProductionOrderStatus | '';
  source_type: ProductionOrderSourceFilter;
  laneFilter: ProductionOrderLaneFilter;
};
type ProductionOrderNamedPreset = {
  id: string;
  name: string;
  filters: ProductionOrderViewSnapshot;
};

const { Text, Title } = Typography;
const STATUS_LABELS: Record<ProductionOrderStatus, string> = { DRAFT: 'Lệnh nháp', SUBMITTED: 'Chờ duyệt', APPROVED: 'Đã duyệt kế hoạch', REJECTED: 'Từ chối', RELEASED: 'Đã phát lệnh', IN_PROGRESS: 'Đang sản xuất', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy' };
const STATUS_COLORS: Record<ProductionOrderStatus, string> = { DRAFT: 'default', SUBMITTED: 'processing', APPROVED: 'blue', REJECTED: 'error', RELEASED: 'cyan', IN_PROGRESS: 'gold', COMPLETED: 'success', CANCELLED: 'magenta' };
const SOURCE_FILTER_LABELS: Record<ProductionOrderSourceFilter, string> = { ALL: 'Tất cả nguồn', DEMAND: 'Từ nhu cầu', MANUAL: 'Thủ công' };
const TILE_STYLE = { height: '100%', borderRadius: 14 };
const LANE_LABELS: Record<ProductionOrderLaneFilter, string> = {
  ALL: 'Toàn bộ lệnh',
  DRAFT_QUEUE: 'Rà soát nháp',
  PENDING_APPROVAL: 'Chờ duyệt',
  READY_TO_RELEASE: 'Sẵn sàng phát lệnh',
  ACTIVE_EXECUTION: 'Đang chạy',
  OVERDUE_PLAN: 'Trễ kế hoạch',
};
const DEFAULT_PLANNER_DIGEST: ProductionPlannerDigest = {
  overdue_operations: 0,
  ready_to_run_count: 0,
  wait_material_count: 0,
  wait_previous_step_count: 0,
  machine_down_count: 0,
  over_capacity_count: 0,
  at_limit_count: 0,
  over_capacity_slot_count: 0,
  unscheduled_count: 0,
  blocked_count: 0,
  handover_ready_count: 0,
  handover_accepted_count: 0,
  unassigned_machine_count: 0,
  unassigned_work_center_count: 0,
  affected_sales_order_count: 0,
  hot_over_capacity_window: null,
  hot_at_limit_window: null,
  hot_machine_queue: null,
  hot_dispatch_owner: null,
  hot_sales_order: null,
  hot_material_wait: null,
  hot_work_center: null,
  hot_machine: null,
  hot_delivery_date: null,
  hot_unscheduled_step: null,
  hot_shift_watch: null,
  hot_date_watch: null,
  hot_owner_capacity: null,
  hot_step_watch: null,
  hot_rebalance_summary: null,
};

type PlannerShortcutCard = {
  key: string;
  title: string;
  description: string;
  actionLabel: string;
  targetUrl: string;
  actionTestId: string;
  secondaryLabel?: string;
  secondaryTargetUrl?: string;
  secondaryTestId?: string;
};

const getProgressPercent = (order: ProductionOrder) => {
  const planned = Number(order.planned_qty || 0);
  const produced = Number(order.produced_qty || 0);
  return planned ? Math.min(100, Math.round((produced / planned) * 100)) : 0;
};
const isOverdue = (order: ProductionOrder) => Boolean(order.planned_end_date && !['COMPLETED', 'CANCELLED'].includes(order.status) && dayjs(order.planned_end_date).isBefore(dayjs(), 'day'));
const canEditOrder = (order: ProductionOrder) => order.status === 'DRAFT' || order.status === 'REJECTED';
const formatQuantity = (value?: string | null) => Number(value || 0).toLocaleString('vi-VN');
const getProductionDemandDisplayCode = (order: ProductionOrder) => (
  order.production_demand_display_code
  || order.production_demand_code
  || order.production_demand_key
  || (order.production_demand ? `#${order.production_demand}` : '')
);
const buildProductionDemandSearchUrl = (order: ProductionOrder) => {
  const demandCode = getProductionDemandDisplayCode(order);
  return demandCode ? `/production-demands?q=${encodeURIComponent(demandCode)}` : '/production-demands';
};
const normalizeInternalUrl = (targetUrl: string | undefined, fallbackUrl: string) => {
  if (!targetUrl) {
    return fallbackUrl;
  }
  try {
    const parsed = new URL(targetUrl, window.location.origin);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return targetUrl.startsWith('/') ? targetUrl : fallbackUrl;
  }
};
const matchesProductionOrderLane = (order: ProductionOrder, laneFilter: ProductionOrderLaneFilter) => {
  switch (laneFilter) {
    case 'DRAFT_QUEUE':
      return order.status === 'DRAFT' || order.status === 'REJECTED';
    case 'PENDING_APPROVAL':
      return order.status === 'SUBMITTED';
    case 'READY_TO_RELEASE':
      return order.status === 'APPROVED';
    case 'ACTIVE_EXECUTION':
      return order.status === 'RELEASED' || order.status === 'IN_PROGRESS';
    case 'OVERDUE_PLAN':
      return isOverdue(order);
    default:
      return true;
  }
};

export default function ProductionOrderList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('q') || searchParams.get('search') || '';
  const initialStatusParam = searchParams.get('status');
  const initialStatus: ProductionOrderStatus | undefined =
    initialStatusParam === 'DRAFT'
    || initialStatusParam === 'SUBMITTED'
    || initialStatusParam === 'APPROVED'
    || initialStatusParam === 'REJECTED'
    || initialStatusParam === 'RELEASED'
    || initialStatusParam === 'IN_PROGRESS'
    || initialStatusParam === 'COMPLETED'
    || initialStatusParam === 'CANCELLED'
      ? initialStatusParam
      : undefined;
  const initialSourceTypeParam = searchParams.get('source_type');
  const initialSourceType: ProductionOrderSourceFilter | undefined =
    initialSourceTypeParam === 'DEMAND' || initialSourceTypeParam === 'MANUAL'
      ? initialSourceTypeParam
      : undefined;
  const focusCode = searchParams.get('focus');
  const focusId = Number(searchParams.get('focus_id') || 0) || null;
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [filters, setFilters] = useState<Filters>({
    ...(initialStatus ? { status: initialStatus } : {}),
    ...(initialSourceType ? { source_type: initialSourceType } : {}),
  });
  const [laneFilter, setLaneFilter] = useState<ProductionOrderLaneFilter>('ALL');
  const [page, setPage] = useState(1);
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [dismissedFocusKey, setDismissedFocusKey] = useState('');
  const [editingOrder, setEditingOrder] = useState<ProductionOrder | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [actionModal, setActionModal] = useState<ActionModalState>(null);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState('NONE');
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const [actionForm] = Form.useForm<ActionFormValues>();
  const { config, saveConfig } = useUserPreferences(PAGES.PRODUCTION_ORDERS);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord?.pageSize ?? 20);
  const namedPresets = useMemo(() => {
    const raw = configRecord?.saved_views;
    if (!Array.isArray(raw)) return [] as ProductionOrderNamedPreset[];
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
        const sourceTypeValue = filterRecord.source_type;
        const laneFilterValue = typeof filterRecord.laneFilter === 'string' ? filterRecord.laneFilter : 'ALL';
        if (statusValue !== '' && statusValue !== undefined && !['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(String(statusValue))) {
          return null;
        }
        if (sourceTypeValue !== undefined && !['ALL', 'DEMAND', 'MANUAL'].includes(String(sourceTypeValue))) {
          return null;
        }
        return {
          id,
          name,
          filters: {
            search_input: typeof filterRecord.search_input === 'string' ? filterRecord.search_input : '',
            status: statusValue === 'DRAFT' || statusValue === 'SUBMITTED' || statusValue === 'APPROVED' || statusValue === 'REJECTED' || statusValue === 'RELEASED' || statusValue === 'IN_PROGRESS' || statusValue === 'COMPLETED' || statusValue === 'CANCELLED' ? statusValue : '',
            source_type: sourceTypeValue === 'DEMAND' || sourceTypeValue === 'MANUAL' ? sourceTypeValue : 'ALL',
            laneFilter:
              laneFilterValue === 'DRAFT_QUEUE'
              || laneFilterValue === 'PENDING_APPROVAL'
              || laneFilterValue === 'READY_TO_RELEASE'
              || laneFilterValue === 'ACTIVE_EXECUTION'
              || laneFilterValue === 'OVERDUE_PLAN'
                ? laneFilterValue
                : 'ALL',
          },
        } as ProductionOrderNamedPreset;
      })
      .filter((item): item is ProductionOrderNamedPreset => item !== null);
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
    parseFilters: (value) => {
      try { return JSON.parse(value); } catch { return {}; }
    },
  });

  const params = useMemo(
    () => ({
      search: intentSearch.trim() || undefined,
      status: intentFilters.status || undefined,
      source_type: intentFilters.source_type && intentFilters.source_type !== 'ALL' ? intentFilters.source_type : undefined,
      page,
      page_size: pageSize,
    }),
    [intentFilters.source_type, intentFilters.status, intentSearch, page, pageSize],
  );
  const summaryParams = useMemo(
    () => ({
      search: intentSearch.trim() || undefined,
      status: intentFilters.status || undefined,
      source_type: intentFilters.source_type && intentFilters.source_type !== 'ALL' ? intentFilters.source_type : undefined,
    }),
    [intentFilters.source_type, intentFilters.status, intentSearch],
  );

  const listQuery = useQuery({ queryKey: ['production-orders', params], queryFn: () => productionApi.getOrders(params) });
  const summaryQuery = useQuery({ queryKey: ['production-orders-summary', summaryParams], queryFn: () => productionApi.getOrderSummary(summaryParams) });
  const productsQuery = useQuery({ queryKey: ['production-form-products'], queryFn: () => productsApi.getProducts({ page_size: 300, ordering: 'code' }) });
  const warehousesQuery = useQuery({ queryKey: ['production-form-warehouses'], queryFn: () => inventoryApi.getWarehouses({ page_size: 200, ordering: 'code' }) });
  const locationsQuery = useQuery({ queryKey: ['production-form-locations'], queryFn: () => inventoryApi.getLocations({ page_size: 400, ordering: 'code' }) });
  const salesOrdersQuery = useQuery({ queryKey: ['production-form-sales-orders'], queryFn: () => salesApi.getOrders({ page_size: 200, ordering: '-order_date' }) });
  const focusKey = `${focusId ?? ''}:${focusCode ?? ''}`;

  const invalidateOrders = async () => {
    const queryFamilies = new Set([
      'production-orders',
      'production-orders-summary',
      'production-order-detail',
      'production-order-issues',
      'production-order-receipts',
      'production-order-approval-history',
      'production-order-next-states',
      'production-demands',
      'production-demand-summary',
      'production-demand-detail',
    ]);
    await queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && (queryFamilies.has(key) || key.startsWith('production-planning'));
      },
    });
  };

  const createMutation = useMutation({ mutationFn: (payload: ProductionOrderFormValues) => productionApi.createOrder(payload), onSuccess: async () => { await invalidateOrders(); messageApi.success('Đã tạo lệnh sản xuất'); setFormOpen(false); setEditingOrder(null); setPage(1); }, onError: (error) => messageApi.error(getToastMessage(error)) });
  const updateMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: ProductionOrderFormValues }) => productionApi.updateOrder(id, payload), onSuccess: async () => { await invalidateOrders(); messageApi.success('Đã cập nhật lệnh sản xuất'); setFormOpen(false); setEditingOrder(null); }, onError: (error) => messageApi.error(getToastMessage(error)) });
  const deleteMutation = useMutation({ mutationFn: productionApi.deleteOrder, onSuccess: async () => { await invalidateOrders(); messageApi.success('Đã xóa lệnh sản xuất'); }, onError: (error) => messageApi.error(getToastMessage(error)) });
  const submitMutation = useMutation({ mutationFn: productionApi.submitOrder, onSuccess: async () => { await invalidateOrders(); messageApi.success('Đã gửi duyệt lệnh sản xuất'); }, onError: (error) => messageApi.error(getToastMessage(error)) });
  const approveMutation = useMutation({ mutationFn: productionApi.approveOrder, onSuccess: async () => { await invalidateOrders(); messageApi.success('Đã duyệt lệnh sản xuất'); }, onError: (error) => messageApi.error(getToastMessage(error)) });
  const rejectMutation = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => productionApi.rejectOrder(id, reason), onSuccess: async () => { await invalidateOrders(); messageApi.success('Đã từ chối lệnh sản xuất'); setActionModal(null); actionForm.resetFields(); }, onError: (error) => messageApi.error(getToastMessage(error)) });
  const releaseMutation = useMutation({ mutationFn: productionApi.releaseOrder, onSuccess: async () => { await invalidateOrders(); messageApi.success('Đã phát lệnh sản xuất'); }, onError: (error) => messageApi.error(getToastMessage(error)) });
  const issueMutation = useMutation({ mutationFn: (id: number) => productionApi.issueMaterials(id, {}), onSuccess: async () => { await invalidateOrders(); messageApi.success('Đã cấp vật tư theo định mức còn thiếu'); }, onError: (error) => messageApi.error(getToastMessage(error)) });
  const receiveMutation = useMutation({ mutationFn: (id: number) => productionApi.receiveOutput(id, {}), onSuccess: async () => { await invalidateOrders(); messageApi.success('Đã nhập kho thành phẩm'); }, onError: (error) => messageApi.error(getToastMessage(error)) });
  const cancelMutation = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => productionApi.cancelOrder(id, reason), onSuccess: async () => { await invalidateOrders(); messageApi.success('Đã hủy lệnh sản xuất'); setActionModal(null); actionForm.resetFields(); }, onError: (error) => messageApi.error(getToastMessage(error)) });

  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const focusedDetailOrder = useMemo(
    () => rows.find((row) => (focusId ? row.id === focusId : false) || (focusCode ? row.code === focusCode : false)) ?? null,
    [focusCode, focusId, rows],
  );
  const activeDetailOrderId = detailOrderId ?? (dismissedFocusKey === focusKey ? null : focusedDetailOrder?.id ?? null);
  const activeDetailOrder = useMemo(
    () => rows.find((row) => row.id === activeDetailOrderId) ?? focusedDetailOrder,
    [activeDetailOrderId, focusedDetailOrder, rows],
  );
  const detailQuery = useQuery({ queryKey: ['production-order-detail', activeDetailOrderId], queryFn: () => productionApi.getOrder(activeDetailOrderId as number), enabled: activeDetailOrderId !== null });
  const issueOverviewQuery = useQuery({ queryKey: ['production-order-issues', activeDetailOrderId], queryFn: () => productionApi.getOrderIssueOverview(activeDetailOrderId as number), enabled: activeDetailOrderId !== null });
  const receiptOverviewQuery = useQuery({ queryKey: ['production-order-receipts', activeDetailOrderId], queryFn: () => productionApi.getOrderReceiptOverview(activeDetailOrderId as number), enabled: activeDetailOrderId !== null });
  const approvalHistoryQuery = useQuery({ queryKey: ['production-order-approval-history', activeDetailOrderId], queryFn: () => productionApi.getOrderApprovalHistory(activeDetailOrderId as number), enabled: activeDetailOrderId !== null });
  const nextStatesQuery = useQuery({ queryKey: ['production-order-next-states', activeDetailOrderId], queryFn: () => productionApi.getOrderNextStates(activeDetailOrderId as number), enabled: activeDetailOrderId !== null });
  const summary = useMemo(() => summaryQuery.data ?? {
    total_orders: rows.length,
    draft_count: rows.filter((item) => item.status === 'DRAFT').length,
    submitted_count: rows.filter((item) => item.status === 'SUBMITTED').length,
    approved_count: rows.filter((item) => item.status === 'APPROVED').length,
    released_count: rows.filter((item) => item.status === 'RELEASED').length,
    in_progress_count: rows.filter((item) => item.status === 'IN_PROGRESS').length,
    completed_count: rows.filter((item) => item.status === 'COMPLETED').length,
    cancelled_count: rows.filter((item) => item.status === 'CANCELLED').length,
    pending_approval_count: rows.filter((item) => item.status === 'SUBMITTED').length,
    active_count: rows.filter((item) => ['RELEASED', 'IN_PROGRESS'].includes(item.status)).length,
    overdue_plan_count: rows.filter(isOverdue).length,
    active_remaining_qty: String(rows.filter((item) => ['RELEASED', 'IN_PROGRESS'].includes(item.status)).reduce((total, item) => total + Number(item.remaining_qty || 0), 0)),
    ready_operation_count: rows.reduce((total, item) => total + item.operations.filter((operation) => operation.status === 'READY').length, 0),
    planner_digest: DEFAULT_PLANNER_DIGEST,
  }, [rows, summaryQuery.data]);
  const plannerDigest = summary.planner_digest ?? DEFAULT_PLANNER_DIGEST;
  const visibleRows = useMemo(
    () => rows.filter((item) => matchesProductionOrderLane(item, laneFilter)),
    [laneFilter, rows],
  );
  const laneTiles = useMemo(
    () => [
      { value: 'ALL' as const, label: LANE_LABELS.ALL, count: rows.length },
      { value: 'DRAFT_QUEUE' as const, label: LANE_LABELS.DRAFT_QUEUE, count: rows.filter((item) => item.status === 'DRAFT' || item.status === 'REJECTED').length },
      { value: 'PENDING_APPROVAL' as const, label: LANE_LABELS.PENDING_APPROVAL, count: rows.filter((item) => item.status === 'SUBMITTED').length },
      { value: 'READY_TO_RELEASE' as const, label: LANE_LABELS.READY_TO_RELEASE, count: rows.filter((item) => item.status === 'APPROVED').length },
      { value: 'ACTIVE_EXECUTION' as const, label: LANE_LABELS.ACTIVE_EXECUTION, count: rows.filter((item) => item.status === 'RELEASED' || item.status === 'IN_PROGRESS').length },
      { value: 'OVERDUE_PLAN' as const, label: LANE_LABELS.OVERDUE_PLAN, count: rows.filter(isOverdue).length },
    ],
    [rows],
  );
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Tìm kiếm: ${intentSearch.trim()}`);
    if (filters.status) tags.push(`Trạng thái: ${STATUS_LABELS[filters.status]}`);
    if (filters.source_type && filters.source_type !== 'ALL') tags.push(`Nguồn: ${SOURCE_FILTER_LABELS[filters.source_type]}`);
    if (laneFilter !== 'ALL') tags.push(`Làn điều phối: ${LANE_LABELS[laneFilter]}`);
    if (selectedViewPreset) tags.push(`Mẫu đang dùng: ${selectedViewPreset.name}`);
    return tags;
  }, [filters.source_type, filters.status, intentSearch, laneFilter, selectedViewPreset]);
  const statusAlert = useMemo(() => {
    if (summary.overdue_plan_count > 0) return { type: 'error' as const, message: `${summary.overdue_plan_count} lệnh đang trễ kế hoạch, nên ưu tiên kiểm tra công đoạn và khả năng cấp vật tư.` };
    if (summary.pending_approval_count > 0) return { type: 'warning' as const, message: `${summary.pending_approval_count} lệnh đang chờ duyệt, phù hợp để trưởng bộ phận chốt trong ca này.` };
    return { type: 'success' as const, message: 'Lệnh sản xuất đang ổn định, chưa có tín hiệu ùn tắc lớn trong bộ lọc hiện tại.' };
  }, [summary.overdue_plan_count, summary.pending_approval_count]);
  const plannerShortcutCards = useMemo<PlannerShortcutCard[]>(() => {
    const cards: PlannerShortcutCard[] = [
      {
        key: 'planner-home',
        title: 'Điều độ sản xuất',
        description: `Sẵn chạy ${plannerDigest.ready_to_run_count} · Chờ vật tư ${plannerDigest.wait_material_count} · Quá hạn ${plannerDigest.overdue_operations}`,
        actionLabel: 'Mở điều độ',
        targetUrl: '/production-planning',
        actionTestId: 'production-orders-open-planning',
      },
    ];

    if (plannerDigest.hot_material_wait) {
      cards.push({
        key: 'material-wait',
        title: 'Điểm nghẽn vật tư',
        description: `${plannerDigest.hot_material_wait.material_product_code} · ${plannerDigest.hot_material_wait.wait_material_operations} công đoạn đang chờ · Còn thiếu ${Number(plannerDigest.hot_material_wait.remaining_issue_qty || 0).toLocaleString('vi-VN')}`,
        actionLabel: 'Xem chờ vật tư',
        targetUrl: plannerDigest.hot_material_wait.focus_url,
        actionTestId: 'production-orders-open-planning-material-wait',
        secondaryLabel: 'Mở cấp vật tư',
        secondaryTargetUrl: plannerDigest.hot_material_wait.material_issue_url,
        secondaryTestId: 'production-orders-open-planning-material-issue',
      });
    }

    if (plannerDigest.hot_sales_order) {
      cards.push({
        key: 'sales-hot',
        title: 'Cam kết giao hàng nóng',
        description: `${plannerDigest.hot_sales_order.sales_order_code} · Quá hạn ${plannerDigest.hot_sales_order.overdue_count} · Chờ vật tư ${plannerDigest.hot_sales_order.wait_material_count}`,
        actionLabel: 'Mở điều độ theo SO',
        targetUrl: plannerDigest.hot_sales_order.focus_url,
        actionTestId: 'production-orders-open-planning-sales-hotspot',
        secondaryLabel: 'Về điều phối đơn hàng',
        secondaryTargetUrl: plannerDigest.hot_sales_order.sales_fulfillment_url,
        secondaryTestId: 'production-orders-open-sales-fulfillment',
      });
    }

    if (plannerDigest.hot_over_capacity_window) {
      cards.push({
        key: 'capacity-hot',
        title: 'Ca đang quá tải',
        description: `${plannerDigest.hot_over_capacity_window.date_label} · ${plannerDigest.hot_over_capacity_window.shift_label} · Tải ${plannerDigest.hot_over_capacity_window.load_ratio ?? '0'}`,
        actionLabel: 'Mở điểm nóng công suất',
        targetUrl: plannerDigest.hot_over_capacity_window.focus_url,
        actionTestId: 'production-orders-open-planning-capacity-hotspot',
      });
    } else if (plannerDigest.hot_machine_queue) {
      cards.push({
        key: 'machine-hot',
        title: 'Máy đang ùn tải',
        description: `${plannerDigest.hot_machine_queue.machine_code} · ${plannerDigest.hot_machine_queue.total_operations} công đoạn · Sẵn chạy ${plannerDigest.hot_machine_queue.ready_to_run_count}`,
        actionLabel: 'Mở hàng chờ máy',
        targetUrl: plannerDigest.hot_machine_queue.focus_url,
        actionTestId: 'production-orders-open-planning-machine-hotspot',
      });
    }

    return cards.slice(0, 4);
  }, [plannerDigest]);

  const buildCurrentSnapshot = (): ProductionOrderViewSnapshot => ({
    search_input: searchInput,
    status: filters.status ?? '',
    source_type: filters.source_type ?? 'ALL',
    laneFilter,
  });

  const applySnapshot = (snapshot: ProductionOrderViewSnapshot) => {
    setSearchInput(snapshot.search_input);
    setFilters({
      status: snapshot.status || undefined,
      source_type: snapshot.source_type && snapshot.source_type !== 'ALL' ? snapshot.source_type : undefined,
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
      messageApi.success('Đã lưu chế độ xem lệnh sản xuất.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem lệnh sản xuất.');
    }
  };

  const applySavedView = () => {
    const rawStatus = configRecord?.status;
    const rawSourceType = configRecord?.source_type;
    const rawLaneFilter = typeof configRecord?.laneFilter === 'string' ? configRecord.laneFilter : 'ALL';
    applySnapshot({
      search_input: typeof configRecord?.search_input === 'string' ? configRecord.search_input : '',
      status: rawStatus === 'DRAFT' || rawStatus === 'SUBMITTED' || rawStatus === 'APPROVED' || rawStatus === 'REJECTED' || rawStatus === 'RELEASED' || rawStatus === 'IN_PROGRESS' || rawStatus === 'COMPLETED' || rawStatus === 'CANCELLED' ? rawStatus : '',
      source_type: rawSourceType === 'DEMAND' || rawSourceType === 'MANUAL' ? rawSourceType : 'ALL',
      laneFilter:
        rawLaneFilter === 'DRAFT_QUEUE'
        || rawLaneFilter === 'PENDING_APPROVAL'
        || rawLaneFilter === 'READY_TO_RELEASE'
        || rawLaneFilter === 'ACTIVE_EXECUTION'
        || rawLaneFilter === 'OVERDUE_PLAN'
          ? rawLaneFilter
          : 'ALL',
    });
    messageApi.success('Đã khôi phục chế độ xem lệnh sản xuất đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: ProductionOrderNamedPreset = existing
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
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc lệnh sản xuất.' : 'Đã lưu mẫu lọc lệnh sản xuất mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc lệnh sản xuất.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc lệnh sản xuất.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc lệnh sản xuất để xóa.');
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
      messageApi.error('Không thể xóa mẫu lọc lệnh sản xuất.');
    }
  };

  const resetFilters = () => {
    setSearchInput('');
    setFilters({});
    setLaneFilter('ALL');
    setPage(1);
  };

  const columns: ColumnsType<ProductionOrder> = [
    { title: 'Mã LSX', dataIndex: 'code', width: 120 },
    {
      title: 'Nguồn / Nhu cầu',
      key: 'source',
      width: 210,
      render: (_, row) => {
        const demandCode = getProductionDemandDisplayCode(row);
        if (!row.production_demand) {
          return <Tag>Thủ công</Tag>;
        }
        return (
          <Space direction="vertical" size={4}>
            <Tag color="blue">Từ nhu cầu</Tag>
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: 'auto' }}
              onClick={() => navigate(buildProductionDemandSearchUrl(row))}
            >
              {demandCode || 'Xem nhu cầu'}
            </Button>
            {row.sales_order_code ? <Text type="secondary">SO: {row.sales_order_code}</Text> : null}
          </Space>
        );
      },
    },
    { title: 'Sản phẩm', width: 240, render: (_, row) => [row.product_code, row.product_name].filter(Boolean).join(' - ') || row.product_name || '-' },
    { title: 'SL kế hoạch', dataIndex: 'planned_qty', width: 130, align: 'right', render: (value: string) => Number(value || 0).toLocaleString('vi-VN') },
    { title: 'Đã hoàn thành', dataIndex: 'produced_qty', width: 130, align: 'right', render: (value: string) => Number(value || 0).toLocaleString('vi-VN') },
    {
      title: 'Số liệu nhu cầu',
      key: 'demand_quantities',
      width: 220,
      render: (_, row) => row.production_demand ? (
        <Space direction="vertical" size={2}>
          <Text>Cần SX: {formatQuantity(row.production_demand_qty_required)}</Text>
          <Text type="secondary">Đã lập: {formatQuantity(row.production_demand_qty_planned)}</Text>
          <Text type="secondary">Đã phát: {formatQuantity(row.production_demand_qty_released)}</Text>
          <Text type="secondary">Còn phát: {formatQuantity(row.production_demand_qty_remaining_to_release)}</Text>
        </Space>
      ) : '-',
    },
    { title: 'Trạng thái', dataIndex: 'status', width: 150, render: (status: ProductionOrderStatus, row) => <Space size={4} wrap><Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Tag>{isOverdue(row) ? <Tag color="error">Trễ kế hoạch</Tag> : null}</Space> },
    { title: 'Tiến độ', width: 180, render: (_, row) => <div style={{ minWidth: 130 }}><Progress percent={getProgressPercent(row)} size="small" status={row.status === 'COMPLETED' ? 'success' : 'active'} /></div> },
    { title: 'Hạn kế hoạch', dataIndex: 'planned_end_date', width: 130, render: (value: string | null) => (value ? dayjs(value).format('DD/MM/YYYY') : '-') },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 420,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap size="small">
          <Button data-testid={`production-order-view-${row.id}`} size="small" icon={<EyeOutlined />} onClick={() => setDetailOrderId(row.id)}>Xem</Button>
          {canEditOrder(row) ? <Button data-testid={`production-order-edit-${row.id}`} size="small" icon={<EditOutlined />} onClick={() => { setEditingOrder(row); setFormOpen(true); }}>Sửa</Button> : null}
          {row.status === 'DRAFT' ? <>
            <Button data-testid={`production-order-delete-${row.id}`} size="small" danger icon={<DeleteOutlined />} onClick={() => Modal.confirm({ title: 'Xóa lệnh sản xuất', content: `Xóa lệnh ${row.code}?`, okText: 'Xóa', cancelText: 'Đóng', okButtonProps: { danger: true }, onOk: () => deleteMutation.mutate(row.id) })}>Xóa</Button>
            <Button data-testid={`production-order-submit-${row.id}`} size="small" type="primary" icon={<UploadOutlined />} onClick={() => submitMutation.mutate(row.id)}>Gửi duyệt</Button>
          </> : null}
          {row.status === 'SUBMITTED' ? <>
            <Button data-testid={`production-order-approve-${row.id}`} size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => approveMutation.mutate(row.id)}>Duyệt</Button>
            <Button data-testid={`production-order-reject-${row.id}`} size="small" onClick={() => { actionForm.setFieldsValue({ reason: '' }); setActionModal({ type: 'reject', order: row }); }}>Từ chối</Button>
          </> : null}
          {row.status === 'APPROVED' ? <Button data-testid={`production-order-release-${row.id}`} size="small" type="primary" icon={<ToolOutlined />} onClick={() => releaseMutation.mutate(row.id)}>Phát lệnh</Button> : null}
          {['RELEASED', 'IN_PROGRESS'].includes(row.status) ? <>
            <Button data-testid={`production-order-issue-${row.id}`} size="small" onClick={() => issueMutation.mutate(row.id)}>Cấp vật tư</Button>
            <Button data-testid={`production-order-receive-${row.id}`} size="small" type="primary" icon={<InboxOutlined />} onClick={() => receiveMutation.mutate(row.id)}>Nhập TP</Button>
          </> : null}
          {!['COMPLETED', 'CANCELLED'].includes(row.status) ? <Button data-testid={`production-order-cancel-${row.id}`} size="small" danger icon={<StopOutlined />} onClick={() => { actionForm.setFieldsValue({ reason: '' }); setActionModal({ type: 'cancel', order: row }); }}>Hủy</Button> : null}
        </Space>
      ),
    },
  ];

  const handleExportCSV = () => {
    if (!visibleRows.length) return;
    downloadCSV(visibleRows.map((order) => ({ 'Mã LSX': order.code, 'Nguồn': order.production_demand ? 'Từ nhu cầu' : 'Thủ công', 'Mã nhu cầu': getProductionDemandDisplayCode(order), 'Sản phẩm': [order.product_code, order.product_name].filter(Boolean).join(' - '), 'SL kế hoạch': Number(order.planned_qty || 0).toLocaleString('vi-VN'), 'SL hoàn thành': Number(order.produced_qty || 0).toLocaleString('vi-VN'), 'Trạng thái': STATUS_LABELS[order.status], 'Tiến độ': `${getProgressPercent(order)}%`, 'Hạn kế hoạch': order.planned_end_date ? dayjs(order.planned_end_date).format('DD/MM/YYYY') : '' })), 'lenh-san-xuat');
  };
  const handleActionSubmit = async () => {
    if (!actionModal) return;
    const values = await actionForm.validateFields();
    const reason = values.reason.trim();
    if (actionModal.type === 'reject') return rejectMutation.mutateAsync({ id: actionModal.order.id, reason });
    return cancelMutation.mutateAsync({ id: actionModal.order.id, reason });
  };
  const handleFormSubmit = async (payload: ProductionOrderFormValues): Promise<void> => {
    if (editingOrder) {
      await updateMutation.mutateAsync({ id: editingOrder.id, payload });
      return;
    }
    await createMutation.mutateAsync(payload);
  };

  const detailData = detailQuery.data;
  const detailIssues = issueOverviewQuery.data?.results ?? [];
  const detailReceipts = receiptOverviewQuery.data?.results ?? [];
  const detailPlannerFocusUrl = useMemo(() => {
    if (!detailData?.id) {
      return '/production-planning';
    }
    const readyOperation = detailData.operations.find((operation) => operation.status === 'READY' || operation.status === 'IN_PROGRESS');
    const next = new URLSearchParams({ production_order_id: String(detailData.id) });
    if (readyOperation?.id) {
      next.set('focus_operation_id', String(readyOperation.id));
    }
    return `/production-planning?${next.toString()}`;
  }, [detailData]);

  if (listQuery.isLoading && !listQuery.data) return <Skeleton active paragraph={{ rows: 10 }} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <Card bordered={false} style={{ borderRadius: 20 }} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 16 } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Title level={3} style={{ margin: 0 }}>Trung tâm lệnh sản xuất</Title>
            <Text type="secondary">Theo dõi luồng duyệt, phát lệnh, cấp vật tư và nhập thành phẩm trên cùng một không gian điều phối sản xuất.</Text>
          </div>
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={handleExportCSV} disabled={!visibleRows.length}>Xuất CSV</Button>
            <Button data-testid="production-orders-open-create" type="primary" icon={<PlusOutlined />} onClick={() => { setEditingOrder(null); setFormOpen(true); }}>Tạo lệnh</Button>
          </Space>
        </div>
        <Alert showIcon type={statusAlert.type} message={statusAlert.message} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Card size="small" style={TILE_STYLE}><Statistic title="Tổng lệnh" value={summary.total_orders} /></Card>
          <Card size="small" style={TILE_STYLE}><Statistic title="Chờ duyệt" value={summary.pending_approval_count} valueStyle={{ color: '#d48806' }} /></Card>
          <Card size="small" style={TILE_STYLE}><Statistic title="Đang chạy" value={summary.active_count} valueStyle={{ color: '#1677ff' }} /></Card>
          <Card size="small" style={TILE_STYLE}><Statistic title="SL còn lại" value={Number(summary.active_remaining_qty || 0)} precision={2} /></Card>
        </div>
        <Card
          size="small"
          title="Điểm nóng điều độ cần mở nhanh"
          data-testid="production-orders-planning-shortcuts"
          styles={{ body: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 } }}
        >
          {plannerShortcutCards.map((card) => (
            <Card key={card.key} size="small" style={TILE_STYLE}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div>
                  <Text strong>{card.title}</Text>
                  <div><Text type="secondary">{card.description}</Text></div>
                </div>
                <Space wrap>
                  <Button
                    type="primary"
                    data-testid={card.actionTestId}
                    onClick={() => navigate(normalizeInternalUrl(card.targetUrl, '/production-planning'))}
                  >
                    {card.actionLabel}
                  </Button>
                  {card.secondaryLabel && card.secondaryTargetUrl ? (
                    <Button
                      data-testid={card.secondaryTestId}
                      onClick={() => navigate(normalizeInternalUrl(card.secondaryTargetUrl, '/production-planning'))}
                    >
                      {card.secondaryLabel}
                    </Button>
                  ) : null}
                </Space>
              </Space>
            </Card>
          ))}
        </Card>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {laneTiles.map((lane) => (
            <Button
              key={lane.value}
              type={laneFilter === lane.value ? 'primary' : 'default'}
              data-testid={`production-orders-lane-${lane.value.toLowerCase().replace(/_/g, '-')}`}
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

      <Card bordered={false} data-testid="production-orders-command-strip" style={{ borderRadius: 18 }} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div data-testid="production-orders-command-search">
            <Input value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setPage(1); }} placeholder="Tìm mã lệnh, mã nhu cầu, mã hàng, sản phẩm..." style={{ width: 340 }} suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined} />
          </div>
          <Select allowClear placeholder="Trạng thái" style={{ width: 220 }} value={filters.status} onChange={(value) => { setFilters((prev) => ({ ...prev, status: value })); setPage(1); }} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
          <Select
            placeholder="Nguồn"
            style={{ width: 180 }}
            value={filters.source_type ?? 'ALL'}
            onChange={(value: ProductionOrderSourceFilter) => {
              setFilters((prev) => ({ ...prev, source_type: value === 'ALL' ? undefined : value }));
              setPage(1);
            }}
            options={Object.entries(SOURCE_FILTER_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Button data-testid="production-orders-save-view" onClick={() => void saveCurrentView()}>Lưu chế độ xem</Button>
          <Button data-testid="production-orders-restore-view" onClick={applySavedView}>Khôi phục</Button>
          <Button data-testid="production-orders-open-preset-modal" onClick={() => setIsViewPresetModalOpen(true)}>Tạo mẫu lọc</Button>
          <div data-testid="production-orders-preset-select">
            <Select
              value={selectedViewPresetId}
              onChange={setSelectedViewPresetId}
              style={{ width: 240 }}
              options={[
                { value: 'NONE', label: 'Chọn mẫu lệnh sản xuất' },
                ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
              ]}
            />
          </div>
          <Button data-testid="production-orders-apply-preset" onClick={applyNamedPreset}>Áp dụng mẫu</Button>
          <Button danger data-testid="production-orders-delete-preset" disabled={!selectedViewPreset} onClick={() => void deleteNamedPreset()}>Xóa mẫu</Button>
          <Button onClick={resetFilters}>Xóa bộ lọc</Button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {activeFilterTags.length ? activeFilterTags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Tag color="default">Đang xem toàn bộ lệnh sản xuất</Tag>}
          <Tag color={summary.ready_operation_count > 0 ? 'gold' : 'blue'}>Công đoạn sẵn sàng: {summary.ready_operation_count}</Tag>
        </div>
      </Card>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={visibleRows}
        scroll={{ x: 2180 }}
        pagination={{ current: page, pageSize, total: listQuery.data?.count ?? 0, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: async (nextPage, nextPageSize) => { setPage(nextPage); if (nextPageSize !== pageSize) await saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize }); } }}
        locale={{ emptyText: visibleRows.length === 0 && !listQuery.isLoading ? (activeFilterTags.length ? <div style={{ padding: 32 }}><Empty description="Không tìm thấy lệnh sản xuất phù hợp." /><Button type="link" onClick={resetFilters}>Xóa bộ lọc</Button></div> : <Empty description="Chưa có lệnh sản xuất nào." />) : undefined }}
      />

      <Modal
        open={isViewPresetModalOpen}
        title="Lưu mẫu lọc lệnh sản xuất"
        okText="Lưu mẫu"
        cancelText="Đóng"
        onOk={() => void saveNamedPreset()}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
      >
        <Input
          data-testid="production-orders-preset-name"
          placeholder="Ví dụ: Hàng chờ duyệt cuối ca"
          value={viewPresetName}
          onChange={(event) => setViewPresetName(event.target.value)}
          onPressEnter={() => void saveNamedPreset()}
        />
      </Modal>

      <ProductionOrderForm
        open={formOpen}
        editing={editingOrder}
        products={productsQuery.data?.results ?? []}
        warehouses={warehousesQuery.data?.results ?? []}
        locations={locationsQuery.data?.results ?? []}
        salesOrders={salesOrdersQuery.data?.results ?? []}
        submitting={createMutation.isPending || updateMutation.isPending}
        onCancel={() => { setFormOpen(false); setEditingOrder(null); }}
        onSubmit={handleFormSubmit}
      />

      <Modal title={actionModal ? `${actionModal.type === 'reject' ? 'Từ chối lệnh sản xuất' : 'Hủy lệnh sản xuất'} - ${actionModal.order.code}` : ''} open={Boolean(actionModal)} onCancel={() => { setActionModal(null); actionForm.resetFields(); }} onOk={handleActionSubmit} okText={actionModal?.type === 'reject' ? 'Xác nhận từ chối' : 'Xác nhận hủy'} cancelText="Đóng" okButtonProps={{ danger: actionModal?.type === 'cancel' }} confirmLoading={rejectMutation.isPending || cancelMutation.isPending}>
        <Form form={actionForm} layout="vertical">
          <Alert showIcon type={actionModal?.type === 'reject' ? 'warning' : 'error'} style={{ marginBottom: 16 }} message={actionModal?.type === 'reject' ? 'Nên nêu rõ lý do để bộ phận lập lệnh chỉnh kế hoạch hoặc BOM trước khi gửi lại.' : 'Chỉ hủy khi đã xác minh không còn nhu cầu sản xuất hoặc lệnh phát sinh sai lệch không thể tiếp tục.'} />
          <Form.Item label="Lý do" name="reason" rules={[{ required: true, message: 'Vui lòng nhập lý do' }, { validator: async (_, value) => (value?.trim() ? Promise.resolve() : Promise.reject(new Error('Vui lòng nhập lý do'))) }]}>
            <Input.TextArea rows={4} maxLength={500} placeholder="Ghi rõ bối cảnh để thuận tiện audit và xử lý tiếp theo" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={activeDetailOrder ? `Chi tiết lệnh sản xuất - ${activeDetailOrder.code}` : detailData ? `Chi tiết lệnh sản xuất - ${detailData.code}` : 'Chi tiết lệnh sản xuất'}
        open={activeDetailOrderId !== null}
        onCancel={() => {
          setDetailOrderId(null);
          if (focusedDetailOrder?.id === activeDetailOrderId) {
            setDismissedFocusKey(focusKey);
          }
        }}
        footer={null}
        width={1120}
      >
        {detailQuery.isLoading ? <Skeleton active paragraph={{ rows: 10 }} /> : detailData ? <div data-testid="production-order-detail-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <Text type="secondary">Giữ lệnh sản xuất ở đây, nhưng mở điều độ sản xuất theo đúng ngữ cảnh lệnh để chốt công đoạn, công suất và bàn giao ca.</Text>
            <Button
              type="primary"
              data-testid={`production-order-open-planning-${detailData.id}`}
              onClick={() => navigate(detailPlannerFocusUrl)}
            >
              Mở điều độ sản xuất
            </Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Card size="small" style={TILE_STYLE}><Statistic title="Tiến độ" value={getProgressPercent(detailData)} suffix="%" /></Card>
            <Card size="small" style={TILE_STYLE}><Statistic title="SL kế hoạch" value={Number(detailData.planned_qty || 0)} precision={2} /></Card>
            <Card size="small" style={TILE_STYLE}><Statistic title="SL còn lại" value={Number(detailData.remaining_qty || 0)} precision={2} /></Card>
            <Card size="small" style={TILE_STYLE}><Statistic title="Số công đoạn" value={detailData.operations.length} /></Card>
          </div>
          <Card size="small" title="Tổng quan lệnh">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              <div><strong>Mã lệnh:</strong> {detailData.code}</div>
              <div>
                <strong>Nguồn:</strong>{' '}
                {detailData.production_demand ? (
                  <Space size={6} wrap>
                    <Tag color="blue">Từ nhu cầu</Tag>
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: 'auto' }}
                      onClick={() => navigate(buildProductionDemandSearchUrl(detailData))}
                    >
                      {getProductionDemandDisplayCode(detailData)}
                    </Button>
                  </Space>
                ) : (
                  <Tag>Thủ công</Tag>
                )}
              </div>
              <div><strong>Sản phẩm:</strong> {[detailData.product_code, detailData.product_name].filter(Boolean).join(' - ') || '-'}</div>
              <div><strong>Trạng thái:</strong> <Tag color={STATUS_COLORS[detailData.status]}>{STATUS_LABELS[detailData.status]}</Tag></div>
              <div><strong>Ngày lệnh:</strong> {dayjs(detailData.order_date).format('DD/MM/YYYY')}</div>
              <div><strong>Hạn kế hoạch:</strong> {detailData.planned_end_date ? dayjs(detailData.planned_end_date).format('DD/MM/YYYY') : '-'}</div>
              {detailData.production_demand ? (
                <>
                  <div><strong>SL demand:</strong> {formatQuantity(detailData.production_demand_qty_required)}</div>
                  <div><strong>Đã lập:</strong> {formatQuantity(detailData.production_demand_qty_planned)}</div>
                  <div><strong>Đã phát:</strong> {formatQuantity(detailData.production_demand_qty_released)}</div>
                  <div><strong>Còn phát:</strong> {formatQuantity(detailData.production_demand_qty_remaining_to_release)}</div>
                </>
              ) : null}
              <div><strong>Kho đích:</strong> {detailData.target_warehouse_name || '-'}</div>
              <div><strong>Vị trí đích:</strong> {detailData.target_location_name || '-'}</div>
            </div>
            <Progress percent={getProgressPercent(detailData)} status={detailData.status === 'COMPLETED' ? 'success' : 'active'} style={{ marginTop: 16 }} />
            {detailData.notes ? <div style={{ marginTop: 12 }}><strong>Ghi chú:</strong> {detailData.notes}</div> : null}
            {detailData.reject_reason ? <div style={{ marginTop: 8 }}><strong>Lý do từ chối:</strong> {detailData.reject_reason}</div> : null}
            {detailData.cancel_reason ? <div style={{ marginTop: 8 }}><strong>Lý do hủy:</strong> {detailData.cancel_reason}</div> : null}
          </Card>
          <Card size="small" title="Tổng quan thực thi">
            <Space wrap>
              <Tag color="blue">Định mức: {detailData.material_requirements.length} dòng</Tag>
              <Tag color="gold">Công đoạn: {detailData.operations.length}</Tag>
              <Tag color="green">Cấp vật tư: {detailIssues.length} chứng từ</Tag>
              <Tag color="cyan">Nhập TP: {detailReceipts.length} chứng từ</Tag>
            </Space>
          </Card>
          <Card size="small" title="Bước kế tiếp khuyến nghị">
            <div data-testid="production-order-next-states" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color="blue">Hiện tại: {STATUS_LABELS[detailData.status]}</Tag>
              {(nextStatesQuery.data?.next_states ?? []).length > 0 ? (
                (nextStatesQuery.data?.next_states ?? []).map((state) => (
                  <Tag key={state} color="gold">
                    {STATUS_LABELS[state as ProductionOrderStatus] || state}
                  </Tag>
                ))
              ) : (
                <Tag>Không còn bước tiếp theo</Tag>
              )}
            </div>
          </Card>
          <Card size="small" title="Lịch sử duyệt">
            <Table<ProductionApprovalHistoryItem>
              data-testid="production-order-approval-history"
              rowKey={(row) => `${row.action}-${row.created_at}`}
              loading={approvalHistoryQuery.isLoading}
              dataSource={approvalHistoryQuery.data ?? []}
              pagination={false}
              locale={{ emptyText: 'Lệnh sản xuất này chưa có lịch sử duyệt.' }}
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
                  width: 260,
                  render: (value) => value || '-',
                },
                {
                  title: 'Thời gian',
                  dataIndex: 'created_at',
                  width: 180,
                  render: (value) => dayjs(value).format('DD/MM/YYYY HH:mm'),
                },
              ]}
              scroll={{ x: 800 }}
            />
          </Card>
        </div> : <Empty description="Không tải được chi tiết lệnh sản xuất." />}
      </Modal>
    </div>
  );
}
