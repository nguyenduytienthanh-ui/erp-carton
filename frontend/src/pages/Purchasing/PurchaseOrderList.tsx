import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Grid,
  Input,
  InputNumber,
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
import type { MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  InboxOutlined,
  MoreOutlined,
  PlusOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { inventoryApi } from '../../api/inventory';
import { productsApi } from '../../api/products';
import { purchasingApi } from '../../api/purchasing';
import PurchaseOrderForm from './PurchaseOrderForm';
import type {
  PurchaseApprovalHistoryItem,
  PurchaseOrder,
  PurchaseOrderFormValues,
  PurchaseOrderStatus,
  PurchaseReceipt,
  Supplier,
} from '../../types/purchasing';
import { PAGES } from '../../utils/constants';
import {
  canApprovePurchaseOrders,
  canCancelPurchaseOrders,
  canManagePurchasingData,
  canReceivePurchaseOrders,
  canSubmitPurchaseOrders,
} from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';

const { Text, Title } = Typography;

type Filters = {
  status?: string;
  supplier?: number;
};
type PurchaseOrderViewSnapshot = {
  search_input: string;
  status: string;
  supplier: number | null;
};
type PurchaseOrderNamedPreset = {
  id: string;
  name: string;
  filters: PurchaseOrderViewSnapshot;
};

type ReasonModalState =
  | { type: 'reject'; order: PurchaseOrder }
  | { type: 'cancel'; order: PurchaseOrder }
  | null;

type ReceiveModalState = { order: PurchaseOrder } | null;


const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'success',
  REJECTED: 'error',
  PARTIAL_RECEIVED: 'warning',
  RECEIVED: 'cyan',
  CANCELLED: 'magenta',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  PARTIAL_RECEIVED: 'Nhập một phần',
  RECEIVED: 'Đã nhập đủ',
  CANCELLED: 'Đã hủy',
};

const STATUS_NEXT_STEPS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Kiểm tra nhà cung cấp, kho nhận và dòng hàng, sau đó gửi duyệt.',
  SUBMITTED: 'Chờ duyệt đơn mua. Nếu sai thông tin, người duyệt có thể từ chối kèm lý do.',
  APPROVED: 'Đơn đã duyệt, bước tiếp theo là nhận hàng vào kho.',
  REJECTED: 'Xem lý do từ chối, chỉnh lại đơn rồi gửi duyệt lại nếu vẫn cần mua.',
  PARTIAL_RECEIVED: 'Đơn đã nhận một phần, tiếp tục nhập phần còn lại khi hàng về.',
  RECEIVED: 'Đơn đã nhận đủ, chuyển sang đối chiếu phiếu nhập và công nợ mua hàng.',
  CANCELLED: 'Đơn đã hủy, không tiếp tục nhận hàng từ đơn này.',
};

const STATUS_HELP_TEXT: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Đơn còn sửa được trước khi gửi duyệt.',
  SUBMITTED: 'Đơn đang khóa để chờ quyết định duyệt.',
  APPROVED: 'Đơn đã sẵn sàng cho bước nhập kho mua hàng.',
  REJECTED: 'Đơn bị từ chối nhưng vẫn có thể sửa và gửi duyệt lại.',
  PARTIAL_RECEIVED: 'Chỉ nhập tiếp số lượng còn lại, tránh nhập trùng phần đã nhận.',
  RECEIVED: 'Không còn số lượng cần nhận từ đơn này.',
  CANCELLED: 'Đơn đã dừng vòng đời và chỉ dùng để tra cứu.',
};

type PurchaseOrderActionKey = 'edit' | 'submit' | 'approve' | 'reject' | 'receive' | 'cancel' | 'delete';
type PurchaseOrderMenuActionKey = 'view' | PurchaseOrderActionKey;
type PurchaseOrderActionPermissions = {
  canManage: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReceive: boolean;
  canCancel: boolean;
};
type PurchaseOrderColumnKey =
  | 'code'
  | 'supplier'
  | 'order_date'
  | 'expected_receipt_date'
  | 'status'
  | 'receiving'
  | 'warehouse'
  | 'line_count'
  | 'payment_terms_days'
  | 'currency'
  | 'reference'
  | 'updated_at'
  | 'total'
  | 'actions';

const PURCHASE_ORDER_ACTION_LABELS: Record<PurchaseOrderMenuActionKey, string> = {
  view: 'Xem chi tiết',
  edit: 'Sửa',
  submit: 'Gửi duyệt',
  approve: 'Duyệt',
  reject: 'Từ chối',
  receive: 'Nhập kho',
  cancel: 'Hủy',
  delete: 'Xóa',
};

const PURCHASE_ORDER_ACTION_MENU: Array<{ key: PurchaseOrderMenuActionKey; danger?: boolean }> = [
  { key: 'view' },
  { key: 'edit' },
  { key: 'submit' },
  { key: 'approve' },
  { key: 'reject', danger: true },
  { key: 'receive' },
  { key: 'cancel', danger: true },
  { key: 'delete', danger: true },
];

const PURCHASE_ORDER_ACTION_ICONS: Record<PurchaseOrderMenuActionKey, ReactNode> = {
  view: <EyeOutlined />,
  edit: <EditOutlined />,
  submit: <SendOutlined />,
  approve: <CheckOutlined />,
  reject: <CloseOutlined />,
  receive: <InboxOutlined />,
  cancel: <StopOutlined />,
  delete: <DeleteOutlined />,
};

const REQUIRED_PO_COLUMN_KEYS: PurchaseOrderColumnKey[] = ['code', 'status', 'actions'];
const DEFAULT_PO_COLUMN_KEYS: PurchaseOrderColumnKey[] = [
  'code',
  'supplier',
  'order_date',
  'expected_receipt_date',
  'status',
  'receiving',
  'warehouse',
  'total',
  'actions',
];
const PO_COLUMN_OPTIONS: Array<{ value: PurchaseOrderColumnKey; label: string }> = [
  { value: 'supplier', label: 'Nhà cung cấp' },
  { value: 'order_date', label: 'Ngày đơn' },
  { value: 'expected_receipt_date', label: 'Dự kiến nhận' },
  { value: 'receiving', label: 'Tiến độ nhận' },
  { value: 'warehouse', label: 'Kho nhập' },
  { value: 'line_count', label: 'Số dòng' },
  { value: 'payment_terms_days', label: 'Thanh toán' },
  { value: 'currency', label: 'Tiền tệ' },
  { value: 'reference', label: 'Tham chiếu' },
  { value: 'updated_at', label: 'Cập nhật' },
  { value: 'total', label: 'Tổng tiền' },
];

function getPurchaseOrderRemainingQty(order: Pick<PurchaseOrder, 'lines'>): number {
  return (order.lines ?? []).reduce((sum, line) => sum + Number(line.remaining_qty ?? 0), 0);
}

function getPurchaseOrderNextStep(order?: PurchaseOrder | null): string {
  if (!order) return 'Chọn một đơn mua để xem bước xử lý tiếp theo.';
  const remainingQty = getPurchaseOrderRemainingQty(order);
  if (order.status === 'APPROVED') {
    return remainingQty > 0
      ? `Nhập kho phần hàng đã về. Còn ${remainingQty.toLocaleString('vi-VN')} đơn vị chưa nhận.`
      : 'Đơn đã duyệt nhưng không còn số lượng cần nhận; kiểm tra phiếu nhập liên quan.';
  }
  if (order.status === 'PARTIAL_RECEIVED') {
    return remainingQty > 0
      ? `Tiếp tục nhập phần còn lại khi hàng về. Còn ${remainingQty.toLocaleString('vi-VN')} đơn vị chưa nhận.`
      : 'Đơn đã nhận hết số lượng, kiểm tra trạng thái phiếu nhập liên quan.';
  }
  return STATUS_NEXT_STEPS[order.status] ?? 'Kiểm tra trạng thái hiện tại trước khi thao tác tiếp.';
}

function getPurchaseOrderStatusHelp(order?: PurchaseOrder | null): string {
  if (!order) return '';
  return STATUS_HELP_TEXT[order.status] ?? '';
}

function getPurchaseOrderAlertType(order?: PurchaseOrder | null): 'info' | 'success' | 'warning' | 'error' {
  if (!order) return 'info';
  if (order.status === 'APPROVED' || order.status === 'PARTIAL_RECEIVED') return 'success';
  if (order.status === 'RECEIVED') return 'info';
  if (order.status === 'DRAFT' || order.status === 'SUBMITTED') return 'info';
  if (order.status === 'REJECTED') return 'warning';
  if (order.status === 'CANCELLED') return 'error';
  return 'info';
}

function getPurchaseOrderActionDisabledReason(
  order: PurchaseOrder,
  action: PurchaseOrderActionKey,
  permissions: PurchaseOrderActionPermissions,
): string {
  if (action === 'edit') {
    if (!permissions.canManage) return 'Bạn chưa có quyền sửa đơn mua.';
    return ['DRAFT', 'REJECTED'].includes(order.status) ? '' : 'Chỉ sửa được đơn Nháp hoặc Từ chối.';
  }
  if (action === 'submit') {
    if (!permissions.canSubmit) return 'Bạn chưa có quyền gửi duyệt đơn mua.';
    return ['DRAFT', 'REJECTED'].includes(order.status) ? '' : 'Chỉ đơn Nháp hoặc Từ chối mới gửi duyệt được.';
  }
  if (action === 'approve') {
    if (!permissions.canApprove) return 'Bạn chưa có quyền duyệt đơn mua.';
    return order.status === 'SUBMITTED' ? '' : 'Chỉ đơn Chờ duyệt mới duyệt được.';
  }
  if (action === 'reject') {
    if (!permissions.canApprove) return 'Bạn chưa có quyền từ chối đơn mua.';
    return order.status === 'SUBMITTED' ? '' : 'Chỉ đơn Chờ duyệt mới từ chối được.';
  }
  if (action === 'receive') {
    if (!permissions.canReceive) return 'Bạn chưa có quyền nhập kho mua hàng.';
    if (!['APPROVED', 'PARTIAL_RECEIVED'].includes(order.status)) return 'Chỉ đơn Đã duyệt hoặc Nhập một phần mới nhập kho được.';
    return getPurchaseOrderRemainingQty(order) > 0 ? '' : 'Đơn này không còn số lượng cần nhận.';
  }
  if (action === 'cancel') {
    if (!permissions.canCancel) return 'Bạn chưa có quyền hủy đơn mua.';
    return ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(order.status)
      ? ''
      : 'Chỉ hủy được đơn Nháp, Chờ duyệt, Đã duyệt hoặc Từ chối.';
  }
  if (action === 'delete') {
    if (!permissions.canManage) return 'Bạn chưa có quyền xóa đơn mua.';
    return ['DRAFT', 'REJECTED'].includes(order.status) ? '' : 'Chỉ xóa được đơn Nháp hoặc Từ chối.';
  }
  return '';
}

function getPurchaseOrderQuickActions(order: PurchaseOrder): PurchaseOrderMenuActionKey[] {
  if (order.status === 'DRAFT' || order.status === 'REJECTED') return ['view', 'edit', 'submit'];
  if (order.status === 'SUBMITTED') return ['view', 'approve', 'reject'];
  if (order.status === 'APPROVED' || order.status === 'PARTIAL_RECEIVED') return ['view', 'receive'];
  return ['view'];
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


export default function PurchaseOrderList() {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('q') || searchParams.get('search') || '';
  const initialStatus = searchParams.get('status') || undefined;
  const focusCode = searchParams.get('focus');
  const focusId = Number(searchParams.get('focus_id') || 0) || null;
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManagePurchasingData();
  const canSubmit = canSubmitPurchaseOrders();
  const canApprove = canApprovePurchaseOrders();
  const canReceive = canReceivePurchaseOrders();
  const canCancel = canCancelPurchaseOrders();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [filters, setFilters] = useState<Filters>(initialStatus ? { status: initialStatus } : {});
  const [page, setPage] = useState(1);
  const focusKey = `${focusId ?? ''}:${focusCode ?? ''}`;
  const [drawerOrderId, setDrawerOrderId] = useState<number | null>(null);
  const [dismissedFocusKey, setDismissedFocusKey] = useState<string | null>(null);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [reasonModalState, setReasonModalState] = useState<ReasonModalState>(null);
  const [receiveModalState, setReceiveModalState] = useState<ReceiveModalState>(null);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState('NONE');
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const [reasonForm] = Form.useForm<{ reason: string }>();
  const [receiveForm] = Form.useForm<{
    receipt_date: dayjs.Dayjs;
    warehouse?: number | null;
    location?: number | null;
    reference?: string;
    note?: string;
    items: Array<{
      purchase_order_line: number;
      quantity: number;
      unit_cost: number;
      note?: string;
    }>;
  }>();
  const receiveWarehouseId = Form.useWatch('warehouse', receiveForm);
  const { config, saveConfig } = useUserPreferences(PAGES.PURCHASING_ORDERS);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord?.pageSize ?? 20);
  const namedPresets = useMemo(() => {
    const raw = configRecord?.saved_views;
    if (!Array.isArray(raw)) return [] as PurchaseOrderNamedPreset[];
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
        if (statusValue && !Object.prototype.hasOwnProperty.call(STATUS_LABELS, statusValue)) {
          return null;
        }
        return {
          id,
          name,
          filters: {
            search_input: typeof filterRecord.search_input === 'string' ? filterRecord.search_input : '',
            status: statusValue,
            supplier: typeof filterRecord.supplier === 'number' ? filterRecord.supplier : null,
          },
        } as PurchaseOrderNamedPreset;
      })
      .filter((item): item is PurchaseOrderNamedPreset => item !== null);
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );
  const visibleColumnKeys = useMemo<PurchaseOrderColumnKey[]>(() => {
    const raw = configRecord?.visible_columns;
    if (!Array.isArray(raw)) return DEFAULT_PO_COLUMN_KEYS;
    const allowedValues = new Set(PO_COLUMN_OPTIONS.map((item) => item.value));
    const savedKeys = raw.filter((item): item is PurchaseOrderColumnKey => (
      typeof item === 'string' && (allowedValues.has(item as PurchaseOrderColumnKey) || REQUIRED_PO_COLUMN_KEYS.includes(item as PurchaseOrderColumnKey))
    ));
    return Array.from(new Set([...REQUIRED_PO_COLUMN_KEYS, ...savedKeys, 'actions'])) as PurchaseOrderColumnKey[];
  }, [configRecord]);

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: '-order_date' };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.supplier) next.supplier = intentFilters.supplier;
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const ordersQuery = useQuery({
    queryKey: ['purchasing-orders', params],
    queryFn: () => purchasingApi.getOrders(params),
  });
  const rows = useMemo(() => ordersQuery.data?.results ?? [], [ordersQuery.data?.results]);
  const focusedOrder = useMemo(
    () => rows.find((row) => (focusId ? row.id === focusId : false) || (focusCode ? row.code === focusCode : false)) ?? null,
    [focusCode, focusId, rows],
  );
  const effectiveDrawerOrderId = drawerOrderId ?? (focusedOrder && dismissedFocusKey !== focusKey ? focusedOrder.id : null);
  const drawerOrder = useMemo(
    () => rows.find((row) => row.id === effectiveDrawerOrderId) ?? null,
    [effectiveDrawerOrderId, rows],
  );
  const suppliersQuery = useQuery({
    queryKey: ['purchasing-supplier-options'],
    queryFn: () => purchasingApi.getSuppliers({ page_size: 200, ordering: 'code', is_active: 'true' }),
  });
  const productsQuery = useQuery({
    queryKey: ['purchasing-product-options'],
    queryFn: () => productsApi.getProducts({ page_size: 200, ordering: 'code', status: 'ACTIVE' }),
  });
  const warehousesQuery = useQuery({
    queryKey: ['purchasing-warehouse-options'],
    queryFn: () => inventoryApi.getWarehouses({ page_size: 200, ordering: 'code', is_active: 'true' }),
  });
  const locationsQuery = useQuery({
    queryKey: ['purchasing-location-options'],
    queryFn: () => inventoryApi.getLocations({ page_size: 200, ordering: 'code', is_active: 'true' }),
  });
  const receiptOverviewQuery = useQuery({
    queryKey: ['purchasing-order-receipts', effectiveDrawerOrderId],
    queryFn: () => purchasingApi.getOrderReceiptOverview(effectiveDrawerOrderId as number),
    enabled: effectiveDrawerOrderId !== null,
  });
  const approvalHistoryQuery = useQuery({
    queryKey: ['purchasing-order-history', effectiveDrawerOrderId],
    queryFn: () => purchasingApi.getOrderApprovalHistory(effectiveDrawerOrderId as number),
    enabled: effectiveDrawerOrderId !== null,
  });

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['purchasing-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['purchasing-receipts'] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: purchasingApi.createOrder,
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã tạo đơn mua');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<PurchaseOrderFormValues> }) =>
      purchasingApi.updateOrder(id, payload),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã cập nhật đơn mua');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: purchasingApi.deleteOrder,
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã xóa đơn mua');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const submitMutation = useMutation({
    mutationFn: purchasingApi.submitOrder,
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã gửi duyệt đơn mua');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const approveMutation = useMutation({
    mutationFn: purchasingApi.approveOrder,
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã duyệt đơn mua');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => purchasingApi.rejectOrder(id, reason),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã từ chối đơn mua');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => purchasingApi.cancelOrder(id, reason),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã hủy đơn mua');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const receiveMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof purchasingApi.receiveOrder>[1] }) =>
      purchasingApi.receiveOrder(id, payload),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã ghi nhận nhập kho mua hàng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  useEffect(() => {
    if (!receiveModalState) return;
    const order = receiveModalState.order;
    receiveForm.setFieldsValue({
      receipt_date: dayjs(),
      warehouse: order.warehouse ?? null,
      location: order.location ?? null,
      reference: order.code,
      note: '',
      items: (order.lines || [])
        .filter((line) => Number(line.remaining_qty ?? 0) > 0)
        .map((line) => ({
          purchase_order_line: line.id!,
          quantity: Number(line.remaining_qty ?? 0),
          unit_cost: Number(line.unit_price ?? 0),
          note: '',
        })),
    });
  }, [receiveForm, receiveModalState]);

  const supplierOptions = useMemo<Supplier[]>(
    () => suppliersQuery.data?.results ?? [],
    [suppliersQuery.data?.results],
  );
  const productOptions = useMemo(
    () => productsQuery.data?.results ?? [],
    [productsQuery.data?.results],
  );
  const warehouseOptions = useMemo(
    () => warehousesQuery.data?.results ?? [],
    [warehousesQuery.data?.results],
  );
  const locationOptions = useMemo(
    () => locationsQuery.data?.results ?? [],
    [locationsQuery.data?.results],
  );
  const receiveLocationOptions = useMemo(() => {
    if (!receiveWarehouseId) return locationOptions;
    return locationOptions.filter((item) => item.warehouse === receiveWarehouseId);
  }, [locationOptions, receiveWarehouseId]);
  const summary = useMemo(() => {
    const draftCount = rows.filter((row) => row.status === 'DRAFT').length;
    const submittedCount = rows.filter((row) => row.status === 'SUBMITTED').length;
    const approvedCount = rows.filter((row) => row.status === 'APPROVED').length;
    const pendingReceiveCount = rows.filter((row) => ['APPROVED', 'PARTIAL_RECEIVED'].includes(row.status)).length;
    const overdueReceiptCount = rows.filter((row) => {
      if (!row.expected_receipt_date) return false;
      if (['RECEIVED', 'CANCELLED'].includes(row.status)) return false;
      return dayjs(row.expected_receipt_date).isBefore(dayjs(), 'day');
    }).length;
    const totalValue = rows.reduce((acc, row) => acc + Number(row.total ?? 0), 0);
    return { draftCount, submittedCount, approvedCount, pendingReceiveCount, overdueReceiptCount, totalValue };
  }, [rows]);
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.status) tags.push(`Trạng thái: ${STATUS_LABELS[intentFilters.status] || intentFilters.status}`);
    if (intentFilters.supplier) {
      const supplier = supplierOptions.find((item) => item.id === intentFilters.supplier);
      tags.push(`Nhà cung cấp: ${supplier ? `${supplier.code} - ${supplier.name}` : `#${intentFilters.supplier}`}`);
    }
    if (selectedViewPreset) tags.push(`Mẫu đang dùng: ${selectedViewPreset.name}`);
    return tags;
  }, [intentFilters.status, intentFilters.supplier, intentSearch, selectedViewPreset, supplierOptions]);

  const buildCurrentSnapshot = (): PurchaseOrderViewSnapshot => ({
    search_input: searchInput,
    status: filters.status ?? '',
    supplier: filters.supplier ?? null,
  });

  const applySnapshot = (snapshot: PurchaseOrderViewSnapshot) => {
    setSearchInput(snapshot.search_input);
    setFilters({
      status: snapshot.status || undefined,
      supplier: snapshot.supplier ?? undefined,
    });
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
      messageApi.success('Đã lưu chế độ xem đơn mua.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem đơn mua.');
    }
  };

  const saveVisibleColumnKeys = async (nextKeys: PurchaseOrderColumnKey[]) => {
    const safeKeys = Array.from(new Set([...REQUIRED_PO_COLUMN_KEYS, ...nextKeys, 'actions']));
    await saveConfig({
      ...configRecord,
      pageSize,
      ...buildCurrentSnapshot(),
      saved_views: namedPresets,
      visible_columns: safeKeys,
    });
  };

  const applySavedView = () => {
    const rawStatus = typeof configRecord?.status === 'string' ? configRecord.status : '';
    const snapshot: PurchaseOrderViewSnapshot = {
      search_input: typeof configRecord?.search_input === 'string' ? configRecord.search_input : '',
      status: rawStatus && Object.prototype.hasOwnProperty.call(STATUS_LABELS, rawStatus) ? rawStatus : '',
      supplier: typeof configRecord?.supplier === 'number' ? configRecord.supplier : null,
    };
    applySnapshot(snapshot);
    messageApi.success('Đã khôi phục chế độ xem đơn mua đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: PurchaseOrderNamedPreset = existing
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
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc đơn mua.' : 'Đã lưu mẫu lọc đơn mua mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc đơn mua.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc đơn mua.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc đơn mua để xóa.');
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
      messageApi.error('Không thể xóa mẫu lọc đơn mua.');
    }
  };
  const statusAlert = useMemo(() => {
    if (summary.overdueReceiptCount > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${summary.overdueReceiptCount} đơn mua đã quá ngày dự kiến nhận hàng.`,
        description: 'Nên rà lại các đơn quá hạn để điều phối nhập kho, đẩy nhắc nhà cung cấp hoặc hủy phần không còn cần.',
      };
    }
    if (summary.submittedCount > 0) {
      return {
        type: 'info' as const,
        message: `Hiện có ${summary.submittedCount} đơn mua đang chờ duyệt.`,
        description: 'Bạn có thể ưu tiên duyệt các đơn gắn với forecast khẩn và các đơn đang chờ nhập kho tiếp theo.',
      };
    }
    return {
      type: 'success' as const,
      message: 'Pipeline đơn mua đang ở trạng thái ổn định.',
      description: 'Không có cảnh báo tồn đọng nổi bật trên bộ lọc hiện tại.',
    };
  }, [summary.overdueReceiptCount, summary.submittedCount]);

  const openReasonModal = (state: ReasonModalState) => {
    setReasonModalState(state);
    reasonForm.setFieldValue('reason', '');
  };

  const handleOrderSave = async (payload: PurchaseOrderFormValues) => {
    if (editingOrder) {
      await updateMutation.mutateAsync({ id: editingOrder.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setOpenForm(false);
  };

  const handleReasonSubmit = async () => {
    const values = await reasonForm.validateFields();
    const reason = values.reason.trim();
    if (!reasonModalState) return;
    if (reasonModalState.type === 'reject') {
      await rejectMutation.mutateAsync({ id: reasonModalState.order.id, reason });
    } else {
      await cancelMutation.mutateAsync({ id: reasonModalState.order.id, reason });
    }
    setReasonModalState(null);
  };

  const handleReceiveSubmit = async () => {
    const values = await receiveForm.validateFields();
    const order = receiveModalState?.order;
    if (!order) return;
    await receiveMutation.mutateAsync({
      id: order.id,
      payload: {
        receipt_date: values.receipt_date.format('YYYY-MM-DD'),
        warehouse: values.warehouse ?? null,
        location: values.location ?? null,
        reference: values.reference?.trim() || '',
        note: values.note?.trim() || '',
        items: (values.items || [])
          .filter((item) => Number(item.quantity ?? 0) > 0)
          .map((item) => ({
            purchase_order_line: item.purchase_order_line,
            quantity: String(item.quantity),
            unit_cost: String(item.unit_cost),
            note: item.note?.trim() || '',
          })),
      },
    });
    setReceiveModalState(null);
  };

  const actionPermissions = { canManage, canSubmit, canApprove, canReceive, canCancel };
  const canSeeOrderWriteActions = canManage || canSubmit || canApprove || canReceive || canCancel;

  const handleOrderAction = (row: PurchaseOrder, action: PurchaseOrderMenuActionKey) => {
    if (action === 'view') {
      setDrawerOrderId(row.id);
      setDismissedFocusKey(focusKey);
      return;
    }
    const disabledReason = getPurchaseOrderActionDisabledReason(row, action, actionPermissions);
    if (disabledReason) {
      messageApi.warning(disabledReason);
      return;
    }
    if (action === 'edit') {
      setEditingOrder(row);
      setOpenForm(true);
      return;
    }
    if (action === 'submit') {
      void submitMutation.mutateAsync(row.id);
      return;
    }
    if (action === 'approve') {
      void approveMutation.mutateAsync(row.id);
      return;
    }
    if (action === 'reject') {
      openReasonModal({ type: 'reject', order: row });
      return;
    }
    if (action === 'receive') {
      setReceiveModalState({ order: row });
      return;
    }
    if (action === 'cancel') {
      openReasonModal({ type: 'cancel', order: row });
      return;
    }
    Modal.confirm({
      title: `Xóa đơn mua ${row.code}?`,
      okText: 'Xóa',
      cancelText: 'Hủy',
      onOk: () => deleteMutation.mutateAsync(row.id),
    });
  };

  const renderOrderActions = (row: PurchaseOrder, compact = false) => {
    const quickActions = getPurchaseOrderQuickActions(row).filter((action) => action === 'view' || canSeeOrderWriteActions);
    const menuItems: MenuProps['items'] = PURCHASE_ORDER_ACTION_MENU
      .filter((item) => item.key === 'view' || canSeeOrderWriteActions)
      .map((item) => ({
        key: item.key,
        danger: item.danger,
        disabled: item.key !== 'view' && Boolean(getPurchaseOrderActionDisabledReason(row, item.key, actionPermissions)),
        icon: PURCHASE_ORDER_ACTION_ICONS[item.key],
        label: PURCHASE_ORDER_ACTION_LABELS[item.key],
      }));
    return (
      <Space size={compact ? 8 : 6} wrap>
        {quickActions.map((action) => {
          const disabledReason = action === 'view' ? '' : getPurchaseOrderActionDisabledReason(row, action, actionPermissions);
          return (
            <Button
              key={action}
              size="small"
              type={action === 'approve' || action === 'receive' || action === 'submit' ? 'primary' : 'default'}
              danger={action === 'reject'}
              disabled={Boolean(disabledReason)}
              title={disabledReason || PURCHASE_ORDER_ACTION_LABELS[action]}
              icon={PURCHASE_ORDER_ACTION_ICONS[action]}
              data-testid={`purchase-order-${action}-${row.id}`}
              onClick={() => handleOrderAction(row, action)}
            >
              {compact && action !== 'view' ? '' : PURCHASE_ORDER_ACTION_LABELS[action]}
            </Button>
          );
        })}
        <Dropdown
          trigger={['click']}
          menu={{
            items: menuItems,
            onClick: ({ key }) => handleOrderAction(row, key as PurchaseOrderMenuActionKey),
          }}
        >
          <Button
            size="small"
            icon={<MoreOutlined />}
            aria-label={`Thao tác khác cho ${row.code}`}
            data-testid={`purchase-order-actions-menu-${row.id}`}
          />
        </Dropdown>
      </Space>
    );
  };

  const loadMaterialPrice = async ({ product, supplier }: { product: number; supplier?: number | null }) => {
    const baseParams = { product, page_size: 1, ordering: '-effective_from' };
    if (supplier) {
      const supplierPrices = await purchasingApi.getMaterialPrices({ ...baseParams, supplier });
      if (supplierPrices.results[0]) return supplierPrices.results[0];
    }
    const productPrices = await purchasingApi.getMaterialPrices(baseParams);
    return productPrices.results[0] ?? null;
  };

  const allColumns: ColumnsType<PurchaseOrder> = [
    { key: 'code', title: 'Mã đơn mua', dataIndex: 'code', width: 150, fixed: 'left' },
    { key: 'supplier', title: 'Nhà cung cấp', dataIndex: 'supplier_name', width: 220, render: (value) => value || '-' },
    { key: 'order_date', title: 'Ngày đơn', dataIndex: 'order_date', width: 110, render: (value) => dayjs(value).format('DD/MM/YYYY') },
    { key: 'expected_receipt_date', title: 'Dự kiến nhận', dataIndex: 'expected_receipt_date', width: 120, render: (value) => (value ? dayjs(value).format('DD/MM/YYYY') : '-') },
    {
      key: 'status',
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 260,
      render: (_, row) => (
        <div>
          <Tag color={STATUS_COLORS[row.status] || 'default'}>{STATUS_LABELS[row.status] || row.status}</Tag>
          <div
            data-testid={`purchase-order-next-step-${row.id}`}
            style={{ marginTop: 4, color: '#595959', fontSize: 12, lineHeight: 1.45 }}
          >
            {getPurchaseOrderNextStep(row)}
          </div>
        </div>
      ),
    },
    {
      key: 'receiving',
      title: 'Tiến độ nhận',
      width: 140,
      render: (_, row) => {
        const remainingQty = getPurchaseOrderRemainingQty(row);
        const receivedQty = (row.lines ?? []).reduce((sum, line) => sum + Number(line.received_qty ?? 0), 0);
        const color = remainingQty <= 0 && receivedQty > 0 ? 'success' : remainingQty > 0 ? 'warning' : 'default';
        return (
          <Tag color={color}>
            {remainingQty > 0 ? `Còn ${remainingQty.toLocaleString('vi-VN')}` : 'Không còn'}
          </Tag>
        );
      },
    },
    { key: 'warehouse', title: 'Kho nhập', dataIndex: 'warehouse_name', width: 160, render: (value) => value || '-' },
    { title: 'Số dòng', key: 'line_count', width: 80, render: (_, row) => row.lines?.length ?? 0 },
    { key: 'payment_terms_days', title: 'Thanh toán', dataIndex: 'payment_terms_days', width: 100, render: (value) => `${value} ngày` },
    { key: 'currency', title: 'Tiền tệ', dataIndex: 'currency', width: 90, render: (value) => value || 'VND' },
    { key: 'reference', title: 'Tham chiếu', dataIndex: 'reference', width: 160, render: (value) => value || '-' },
    { key: 'updated_at', title: 'Cập nhật', dataIndex: 'updated_at', width: 150, render: (value) => (value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '-') },
    { key: 'total', title: 'Tổng tiền', dataIndex: 'total', width: 140, render: (value) => formatMoney(value) },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 210,
      fixed: 'right',
      render: (_, row) => renderOrderActions(row),
    },
  ];

  const activeColumnKeySet = new Set(visibleColumnKeys);
  const columns: ColumnsType<PurchaseOrder> = allColumns.filter((column) => {
    const dataIndex = 'dataIndex' in column ? column.dataIndex : undefined;
    return activeColumnKeySet.has(String(column.key ?? dataIndex) as PurchaseOrderColumnKey);
  });

  const drawerLineColumns: ColumnsType<PurchaseOrder['lines'][number]> = [
    { title: '#', dataIndex: 'line_number', width: 60 },
    { title: 'Mã SP', dataIndex: 'product_code', width: 120, render: (_, row) => row.product_code || row.internal_product_code || '-' },
    { title: 'Tên SP', dataIndex: 'product_name', width: 220, render: (value) => value || '-' },
    { title: 'SL đặt', dataIndex: 'qty', width: 100 },
    { title: 'Đã nhận', dataIndex: 'received_qty', width: 100, render: (value) => value || '0.0000' },
    { title: 'Còn lại', dataIndex: 'remaining_qty', width: 100, render: (value) => value || '0.0000' },
    { title: 'Đơn giá', dataIndex: 'unit_price', width: 120, render: (value) => formatMoney(value) },
    { title: 'Thành tiền', dataIndex: 'line_total', width: 120, render: (value) => formatMoney(value) },
  ];

  const receiptColumns: ColumnsType<PurchaseReceipt> = [
    { title: 'Phiếu nhập', dataIndex: 'code', width: 140 },
    { title: 'Ngày nhận', dataIndex: 'receipt_date', width: 110, render: (value) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (value) => <Tag color={value === 'POSTED' ? 'success' : 'error'}>{value === 'POSTED' ? 'Đã ghi sổ' : 'Đã hủy'}</Tag> },
    { title: 'Số lượng', dataIndex: 'total_qty', width: 110 },
    { title: 'Giá trị', dataIndex: 'total_amount', width: 140, render: (value) => formatMoney(value) },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <Space wrap>
                <Tag color="blue">Mua hàng</Tag>
                <Tag color="gold">Đơn mua</Tag>
                <Tag color="processing">Duyệt và nhập kho</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>Trung tâm đơn mua</Title>
              <Text type="secondary">Điều phối toàn bộ luồng từ tạo đơn, gửi duyệt tới nhập kho và theo dõi tiến độ nhận hàng trên cùng một màn hình.</Text>
            </div>
            {canManage ? (
              <Tooltip title={supplierOptions.length === 0 ? 'Vui lòng tạo nhà cung cấp trước' : ''}>
                <Button
                  data-testid="purchase-orders-open-create"
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={supplierOptions.length === 0}
                  onClick={() => {
                    setEditingOrder(null);
                    setOpenForm(true);
                  }}
                >
                  Tạo đơn mua
                </Button>
              </Tooltip>
            ) : null}
          </div>

          <Alert showIcon type={statusAlert.type} message={statusAlert.message} description={statusAlert.description} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Giá trị trên trang" value={summary.totalValue} formatter={(value) => `${formatMoney(value)} đ`} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Nháp" value={summary.draftCount} suffix="đơn" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Chờ duyệt" value={summary.submittedCount} suffix="đơn" valueStyle={{ color: summary.submittedCount > 0 ? '#1677ff' : undefined }} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Chờ nhập kho" value={summary.pendingReceiveCount} suffix="đơn" />
            </div>
          </div>
        </Space>
      </Card>

      <Card data-testid="purchase-orders-command-strip">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div data-testid="purchase-orders-command-search">
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
                ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
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
            <Button data-testid="purchase-orders-save-view" onClick={() => void saveCurrentView()}>
              Lưu chế độ xem
            </Button>
            <Button data-testid="purchase-orders-restore-view" onClick={applySavedView}>
              Khôi phục
            </Button>
            <Button
              icon={<SettingOutlined />}
              data-testid="purchase-orders-column-settings"
              onClick={() => setIsColumnModalOpen(true)}
            >
              Cột
            </Button>
            <Button
              data-testid="purchase-orders-open-preset-modal"
              onClick={() => setIsViewPresetModalOpen(true)}
            >
              Tạo mẫu lọc
            </Button>
            <div data-testid="purchase-orders-preset-select">
              <Select
                value={selectedViewPresetId}
                onChange={setSelectedViewPresetId}
                style={{ width: 240 }}
                options={[
                  { value: 'NONE', label: 'Chọn mẫu đơn mua' },
                  ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                ]}
              />
            </div>
            <Button data-testid="purchase-orders-apply-preset" onClick={applyNamedPreset}>
              Áp dụng mẫu
            </Button>
            <Button
              danger
              data-testid="purchase-orders-delete-preset"
              disabled={!selectedViewPreset}
              onClick={() => void deleteNamedPreset()}
            >
              Xóa mẫu
            </Button>
            <Button
              onClick={() => {
                setSearchInput('');
                setFilters({});
                setPage(1);
              }}
            >
              Xóa bộ lọc
            </Button>
          </div>
          <Space wrap>
            {activeFilterTags.length > 0 ? activeFilterTags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Text type="secondary">Đang hiển thị toàn bộ đơn mua.</Text>}
            <Tag color="success">{`Đã duyệt: ${summary.approvedCount}`}</Tag>
            <Tag color="warning">{`Quá hạn nhận: ${summary.overdueReceiptCount}`}</Tag>
          </Space>
        </Space>
      </Card>

      {isMobile ? (
        <div data-testid="purchase-order-mobile-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ordersQuery.isLoading ? (
            <Card loading />
          ) : rows.length === 0 ? (
            <Card>
              <Empty
                description={(intentSearch || filters.status || filters.supplier) ? 'Không tìm thấy đơn mua phù hợp.' : 'Chưa có đơn mua.'}
              />
            </Card>
          ) : rows.map((row) => {
            const remainingQty = getPurchaseOrderRemainingQty(row);
            return (
              <Card key={row.id} size="small" data-testid={`purchase-order-mobile-card-${row.id}`}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <Text strong>{row.code}</Text>
                      <div style={{ color: '#667085', fontSize: 12, marginTop: 2 }}>{row.supplier_name || '-'}</div>
                    </div>
                    <Tag color={STATUS_COLORS[row.status] || 'default'} style={{ marginInlineEnd: 0 }}>
                      {STATUS_LABELS[row.status] || row.status}
                    </Tag>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                    <div>
                      <Text type="secondary">Ngày đơn</Text>
                      <div>{dayjs(row.order_date).format('DD/MM/YYYY')}</div>
                    </div>
                    <div>
                      <Text type="secondary">Dự kiến nhận</Text>
                      <div>{row.expected_receipt_date ? dayjs(row.expected_receipt_date).format('DD/MM/YYYY') : '-'}</div>
                    </div>
                    <div>
                      <Text type="secondary">Tiến độ nhận</Text>
                      <div>{remainingQty > 0 ? `Còn ${remainingQty.toLocaleString('vi-VN')}` : 'Không còn'}</div>
                    </div>
                    <div>
                      <Text type="secondary">Tổng tiền</Text>
                      <div>{formatMoney(row.total)}</div>
                    </div>
                  </div>
                  <div style={{ color: '#595959', fontSize: 12, lineHeight: 1.45 }}>
                    {getPurchaseOrderNextStep(row)}
                  </div>
                  {renderOrderActions(row, true)}
                </Space>
              </Card>
            );
          })}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Button disabled={page <= 1 || ordersQuery.isLoading} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
              Trước
            </Button>
            <Text type="secondary">{`Trang ${page} / ${Math.max(1, Math.ceil((ordersQuery.data?.count ?? 0) / pageSize))}`}</Text>
            <Button
              disabled={ordersQuery.isLoading || page >= Math.max(1, Math.ceil((ordersQuery.data?.count ?? 0) / pageSize))}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Sau
            </Button>
          </div>
        </div>
      ) : (
        <Table
          rowKey="id"
          loading={ordersQuery.isLoading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1280 }}
          pagination={{
            current: page,
            pageSize,
            total: ordersQuery.data?.count ?? 0,
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
            emptyText: rows.length === 0 && !ordersQuery.isLoading ? (
              <div style={{ padding: 40, color: '#8c8c8c' }}>
                {(intentSearch || filters.status || filters.supplier) ? (
                  <div>
                    <div style={{ marginBottom: 12 }}>Không tìm thấy đơn mua phù hợp.</div>
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
                ) : canManage ? 'Chưa có đơn mua. Nhấn Tạo đơn mua để thêm mới.' : 'Chưa có đơn mua.'}
              </div>
            ) : undefined,
          }}
        />
      )}

      <Modal
        open={isViewPresetModalOpen}
        title="Lưu mẫu lọc đơn mua"
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
              data-testid="purchase-orders-preset-name"
              placeholder="Ví dụ: Ca sáng chờ nhập kho"
              value={viewPresetName}
              onChange={(event) => setViewPresetName(event.target.value)}
              onPressEnter={() => void saveNamedPreset()}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={isColumnModalOpen}
        title="Cột hiển thị"
        onCancel={() => setIsColumnModalOpen(false)}
        footer={[
          <Button key="reset" onClick={() => void saveVisibleColumnKeys(DEFAULT_PO_COLUMN_KEYS)}>
            Khôi phục mặc định
          </Button>,
          <Button key="done" type="primary" onClick={() => setIsColumnModalOpen(false)}>
            Đóng
          </Button>,
        ]}
      >
        <Checkbox.Group
          value={visibleColumnKeys.filter((key) => !REQUIRED_PO_COLUMN_KEYS.includes(key))}
          options={PO_COLUMN_OPTIONS}
          style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 10 }}
          onChange={(checkedValues) => void saveVisibleColumnKeys(checkedValues as PurchaseOrderColumnKey[])}
        />
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          Mã đơn mua, trạng thái và thao tác luôn hiển thị để tránh mất điểm xử lý chính.
        </Text>
      </Modal>

      <PurchaseOrderForm
        open={openForm}
        editing={editingOrder}
        suppliers={supplierOptions}
        products={productOptions}
        warehouses={warehouseOptions}
        locations={locationOptions}
        submitting={createMutation.isPending || updateMutation.isPending}
        loadMaterialPrice={loadMaterialPrice}
        onCancel={() => setOpenForm(false)}
        onSubmit={handleOrderSave}
      />

      <Modal
        title={reasonModalState?.type === 'reject' ? 'Lý do từ chối đơn mua' : 'Lý do hủy đơn mua'}
        open={!!reasonModalState}
        onCancel={() => setReasonModalState(null)}
        onOk={() => void handleReasonSubmit()}
        confirmLoading={rejectMutation.isPending || cancelMutation.isPending}
      >
        <Form form={reasonForm} layout="vertical">
          <Form.Item name="reason" label="Lý do" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={receiveModalState ? `Nhập kho cho ${receiveModalState.order.code}` : 'Nhập kho'}
        open={!!receiveModalState}
        onCancel={() => setReceiveModalState(null)}
        onOk={() => void handleReceiveSubmit()}
        confirmLoading={receiveMutation.isPending}
        width={960}
      >
        <Form form={receiveForm} layout="vertical">
          <Alert
            showIcon
            type="info"
            message={receiveModalState ? getPurchaseOrderNextStep(receiveModalState.order) : 'Nhập kho từ đơn mua'}
            description="Chỉ nhập số lượng thực nhận cho từng dòng còn lại; hệ thống sẽ tạo phiếu nhập theo contract hiện có."
            style={{ marginBottom: 16 }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="receipt_date" label="Ngày nhận" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
            </Form.Item>
            <Form.Item name="warehouse" label="Kho nhận" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={warehouseOptions.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
              />
            </Form.Item>
            <Form.Item name="location" label="Vị trí">
              <Select
                showSearch
                optionFilterProp="label"
                options={receiveLocationOptions.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
              />
            </Form.Item>
            <Form.Item name="reference" label="Tham chiếu">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.List name="items">
            {(fields) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {fields.map((field) => {
                  const lineId = receiveForm.getFieldValue(['items', field.name, 'purchase_order_line']);
                  const line = receiveModalState?.order.lines.find((item) => item.id === lineId);
                  return (
                    <div
                      key={field.key}
                      style={{
                        border: '1px solid #f0f0f0',
                        borderRadius: 10,
                        padding: 12,
                        display: 'grid',
                        gridTemplateColumns: '2fr repeat(3, 1fr)',
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{line?.product_code || line?.internal_product_code || 'SP'}</div>
                        <div style={{ color: '#8c8c8c' }}>{line?.product_name || '-'}</div>
                        <div style={{ color: '#8c8c8c', fontSize: 12 }}>{`Còn lại: ${line?.remaining_qty || '0.0000'}`}</div>
                      </div>
                      <Form.Item name={[field.name, 'purchase_order_line']} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item label="Số lượng nhận" name={[field.name, 'quantity']} rules={[{ required: true, message: 'Bắt buộc' }]}>
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item label="Đơn giá nhập" name={[field.name, 'unit_cost']} rules={[{ required: true, message: 'Bắt buộc' }]}>
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item label="Ghi chú" name={[field.name, 'note']}>
                        <Input />
                      </Form.Item>
                    </div>
                  );
                })}
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Drawer
        title={drawerOrder ? `Chi tiết ${drawerOrder.code}` : 'Chi tiết đơn mua'}
        width={960}
        open={!!drawerOrder}
        onClose={() => {
          setDrawerOrderId(null);
          setDismissedFocusKey(focusKey);
        }}
      >
        {drawerOrder ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Nhà cung cấp">{drawerOrder.supplier_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <Tag color={STATUS_COLORS[drawerOrder.status] || 'default'}>{STATUS_LABELS[drawerOrder.status] || drawerOrder.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Ngày đơn">{dayjs(drawerOrder.order_date).format('DD/MM/YYYY')}</Descriptions.Item>
              <Descriptions.Item label="Dự kiến nhận">
                {drawerOrder.expected_receipt_date ? dayjs(drawerOrder.expected_receipt_date).format('DD/MM/YYYY') : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Kho nhập">{drawerOrder.warehouse_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Vị trí">{drawerOrder.location_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Hạn thanh toán">{`${drawerOrder.payment_terms_days} ngày`}</Descriptions.Item>
              <Descriptions.Item label="Tổng tiền">{formatMoney(drawerOrder.total)}</Descriptions.Item>
              <Descriptions.Item label="Ghi chú" span={2}>{drawerOrder.notes || '-'}</Descriptions.Item>
              {drawerOrder.reject_reason ? <Descriptions.Item label="Lý do từ chối" span={2}>{drawerOrder.reject_reason}</Descriptions.Item> : null}
              {drawerOrder.cancel_reason ? <Descriptions.Item label="Lý do hủy" span={2}>{drawerOrder.cancel_reason}</Descriptions.Item> : null}
            </Descriptions>
            <Alert
              showIcon
              data-testid="purchase-order-detail-next-step"
              type={getPurchaseOrderAlertType(drawerOrder)}
              message={getPurchaseOrderNextStep(drawerOrder)}
              description={getPurchaseOrderStatusHelp(drawerOrder)}
            />

            <div>
              <h3 style={{ marginBottom: 8 }}>Dòng hàng</h3>
              <Table
                rowKey={(row) => String(row.id ?? row.line_number)}
                columns={drawerLineColumns}
                dataSource={drawerOrder.lines}
                pagination={false}
                scroll={{ x: 900 }}
              />
            </div>

            <div>
              <h3 style={{ marginBottom: 8 }}>Phiếu nhập liên quan</h3>
              <Table<PurchaseReceipt>
                rowKey="id"
                loading={receiptOverviewQuery.isLoading}
                columns={receiptColumns}
                dataSource={receiptOverviewQuery.data?.results ?? []}
                pagination={false}
                scroll={{ x: 720 }}
              />
            </div>

            <div>
              <h3 style={{ marginBottom: 8 }}>Lịch sử duyệt</h3>
              <Table<PurchaseApprovalHistoryItem>
                rowKey={(row) => `${row.action}-${row.created_at}`}
                loading={approvalHistoryQuery.isLoading}
                columns={[
                  { title: 'Hành động', dataIndex: 'action', width: 160 },
                  { title: 'Người thực hiện', dataIndex: 'user', width: 160, render: (value) => value || '-' },
                  { title: 'Ghi chú', dataIndex: 'comments', width: 260, render: (value) => value || '-' },
                  { title: 'Thời gian', dataIndex: 'created_at', width: 180, render: (value) => dayjs(value).format('DD/MM/YYYY HH:mm') },
                ]}
                dataSource={approvalHistoryQuery.data ?? []}
                pagination={false}
                scroll={{ x: 760 }}
              />
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
