import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { inventoryApi } from '../../api/inventory';
import { productsApi } from '../../api/products';
import { productionApi } from '../../api/production';
import { salesApi } from '../../api/sales';
import ProductionOrderForm from './ProductionOrderForm';
import type { Warehouse, WarehouseLocation } from '../../types/inventory';
import type { Product } from '../../types/product';
import type {
  ProductionApprovalHistoryItem,
  ProductionIssue,
  ProductionMaterialRequirement,
  ProductionOperation,
  ProductionOrder,
  ProductionOrderFormValues,
  ProductionReceipt,
} from '../../types/production';
import type { SalesOrder } from '../../types/sales';
import { PAGES } from '../../utils/constants';
import {
  canApproveProductionOrders,
  canCancelProductionOrders,
  canIssueProductionMaterials,
  canManageProductionData,
  canReceiveProductionOutput,
  canReleaseProductionOrders,
  canSubmitProductionOrders,
} from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';


type Filters = {
  status?: string;
  product?: number;
};

type ReasonModalState =
  | { type: 'reject-order'; order: ProductionOrder }
  | { type: 'cancel-order'; order: ProductionOrder }
  | { type: 'cancel-issue'; issue: ProductionIssue }
  | { type: 'cancel-receipt'; receipt: ProductionReceipt }
  | null;

type IssueModalState = { order: ProductionOrder } | null;
type ReceiptModalState = { order: ProductionOrder } | null;
type OperationModalState = { order: ProductionOrder; operation: ProductionOperation } | null;


const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'success',
  REJECTED: 'error',
  RELEASED: 'cyan',
  IN_PROGRESS: 'warning',
  COMPLETED: 'green',
  CANCELLED: 'magenta',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  RELEASED: 'Đã phát lệnh',
  IN_PROGRESS: 'Đang sản xuất',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};

const OPERATION_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Chưa sẵn sàng',
  READY: 'Sẵn sàng',
  IN_PROGRESS: 'Đang làm',
  DONE: 'Hoàn thành',
  SKIPPED: 'Bỏ qua',
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


export default function ProductionOrderList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManageProductionData();
  const canSubmit = canSubmitProductionOrders();
  const canApprove = canApproveProductionOrders();
  const canRelease = canReleaseProductionOrders();
  const canIssue = canIssueProductionMaterials();
  const canReceive = canReceiveProductionOutput();
  const canCancel = canCancelProductionOrders();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [openForm, setOpenForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<ProductionOrder | null>(null);
  const [drawerOrder, setDrawerOrder] = useState<ProductionOrder | null>(null);
  const [reasonModalState, setReasonModalState] = useState<ReasonModalState>(null);
  const [issueModalState, setIssueModalState] = useState<IssueModalState>(null);
  const [receiptModalState, setReceiptModalState] = useState<ReceiptModalState>(null);
  const [operationModalState, setOperationModalState] = useState<OperationModalState>(null);
  const [reasonForm] = Form.useForm<{ reason: string }>();
  const [issueForm] = Form.useForm<{
    issue_date: dayjs.Dayjs;
    reference?: string;
    note?: string;
    items: Array<{
      material_requirement: number;
      warehouse?: number | null;
      location?: number | null;
      quantity: number;
      unit_cost: number;
      note?: string;
    }>;
  }>();
  const [receiptForm] = Form.useForm<{
    receipt_date: dayjs.Dayjs;
    warehouse?: number | null;
    location?: number | null;
    reference?: string;
    note?: string;
    quantity: number;
    unit_cost: number;
  }>();
  const [operationForm] = Form.useForm<{
    status: string;
    completed_qty?: number;
    scrap_qty?: number;
    note?: string;
  }>();
  const receiptWarehouseId = Form.useWatch('warehouse', receiptForm);
  const { config, saveConfig } = useUserPreferences(PAGES.PRODUCTION_ORDERS);
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);

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
    if (intentFilters.product) next.product = intentFilters.product;
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const ordersQuery = useQuery({
    queryKey: ['production-orders', params],
    queryFn: () => productionApi.getOrders(params),
  });
  const productsQuery = useQuery({
    queryKey: ['production-products'],
    queryFn: () => productsApi.getProducts({ page_size: 300, ordering: 'code', status: 'ACTIVE' }),
  });
  const warehousesQuery = useQuery({
    queryKey: ['production-warehouses'],
    queryFn: () => inventoryApi.getWarehouses({ page_size: 200, ordering: 'code', is_active: 'true' }),
  });
  const locationsQuery = useQuery({
    queryKey: ['production-locations'],
    queryFn: () => inventoryApi.getLocations({ page_size: 200, ordering: 'code', is_active: 'true' }),
  });
  const salesOrdersQuery = useQuery({
    queryKey: ['production-sales-orders'],
    queryFn: () => salesApi.getOrders({ page_size: 200, ordering: '-order_date' }),
  });
  const orderDetailQuery = useQuery({
    queryKey: ['production-order-detail', drawerOrder?.id],
    queryFn: () => productionApi.getOrder(drawerOrder!.id),
    enabled: !!drawerOrder,
  });
  const issueOverviewQuery = useQuery({
    queryKey: ['production-order-issues', drawerOrder?.id],
    queryFn: () => productionApi.getOrderIssueOverview(drawerOrder!.id),
    enabled: !!drawerOrder,
  });
  const receiptOverviewQuery = useQuery({
    queryKey: ['production-order-receipts', drawerOrder?.id],
    queryFn: () => productionApi.getOrderReceiptOverview(drawerOrder!.id),
    enabled: !!drawerOrder,
  });
  const approvalHistoryQuery = useQuery({
    queryKey: ['production-order-history', drawerOrder?.id],
    queryFn: () => productionApi.getOrderApprovalHistory(drawerOrder!.id),
    enabled: !!drawerOrder,
  });

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['production-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['production-order-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['production-order-issues'] }),
      queryClient.invalidateQueries({ queryKey: ['production-order-receipts'] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: productionApi.createOrder,
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã tạo lệnh sản xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<ProductionOrderFormValues> }) =>
      productionApi.updateOrder(id, payload),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã cập nhật lệnh sản xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: productionApi.deleteOrder,
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã xóa lệnh sản xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const submitMutation = useMutation({
    mutationFn: productionApi.submitOrder,
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã gửi duyệt lệnh sản xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const approveMutation = useMutation({
    mutationFn: productionApi.approveOrder,
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã duyệt lệnh sản xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => productionApi.rejectOrder(id, reason),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã từ chối lệnh sản xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const releaseMutation = useMutation({
    mutationFn: productionApi.releaseOrder,
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã phát lệnh sản xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const cancelOrderMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => productionApi.cancelOrder(id, reason),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã hủy lệnh sản xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const issueMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof productionApi.issueMaterials>[1] }) =>
      productionApi.issueMaterials(id, payload),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã cấp vật tư cho sản xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const receiptMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof productionApi.receiveOutput>[1] }) =>
      productionApi.receiveOutput(id, payload),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã nhập kho thành phẩm');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const operationMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof productionApi.updateOperation>[1] }) =>
      productionApi.updateOperation(id, payload),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã cập nhật công đoạn');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const cancelIssueMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => productionApi.cancelIssue(id, reason),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã hủy chứng từ cấp vật tư');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const cancelReceiptMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => productionApi.cancelReceipt(id, reason),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã hủy nhập kho thành phẩm');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = ordersQuery.data?.results ?? [];
  const products: Product[] = productsQuery.data?.results ?? [];
  const warehouses: Warehouse[] = warehousesQuery.data?.results ?? [];
  const locations: WarehouseLocation[] = locationsQuery.data?.results ?? [];
  const salesOrders: SalesOrder[] = (salesOrdersQuery.data?.results ?? []).filter((item) => ['APPROVED', 'POSTED'].includes(item.status));
  const activeOrder = orderDetailQuery.data ?? drawerOrder;
  const activeIssues = issueOverviewQuery.data?.results ?? [];
  const activeReceipts = receiptOverviewQuery.data?.results ?? [];
  const activeHistory: ProductionApprovalHistoryItem[] = approvalHistoryQuery.data ?? [];
  const filteredReceiptLocations = useMemo(() => {
    if (!receiptWarehouseId) return locations;
    return locations.filter((item) => item.warehouse === receiptWarehouseId);
  }, [locations, receiptWarehouseId]);

  useEffect(() => {
    if (!issueModalState) return;
    const order = issueModalState.order;
    issueForm.setFieldsValue({
      issue_date: dayjs(),
      reference: order.code,
      note: '',
      items: (order.material_requirements || [])
        .filter((item) => Number(item.remaining_issue_qty ?? 0) > 0)
        .map((item) => ({
          material_requirement: Number(item.id),
          warehouse: item.source_warehouse ?? null,
          location: item.source_location ?? null,
          quantity: Number(item.remaining_issue_qty ?? 0),
          unit_cost: Number((item.product_snapshot?.cost_price as string | number | undefined) ?? 0),
          note: '',
        })),
    });
  }, [issueForm, issueModalState]);

  useEffect(() => {
    if (!receiptModalState) return;
    const order = receiptModalState.order;
    receiptForm.setFieldsValue({
      receipt_date: dayjs(),
      warehouse: order.target_warehouse ?? null,
      location: order.target_location ?? null,
      reference: order.code,
      note: '',
      quantity: Number(order.remaining_qty ?? 0),
      unit_cost: Number(order.unit_cost_estimate ?? 0),
    });
  }, [receiptForm, receiptModalState]);

  useEffect(() => {
    if (!operationModalState) return;
    const operation = operationModalState.operation;
    operationForm.setFieldsValue({
      status: operation.status,
      completed_qty: Number(operation.completed_qty ?? 0),
      scrap_qty: Number(operation.scrap_qty ?? 0),
      note: operation.note || '',
    });
  }, [operationForm, operationModalState]);

  const openReasonModal = (state: ReasonModalState) => {
    setReasonModalState(state);
    reasonForm.setFieldValue('reason', '');
  };

  const handleSaveOrder = async (payload: ProductionOrderFormValues) => {
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
    if (reasonModalState.type === 'reject-order') {
      await rejectMutation.mutateAsync({ id: reasonModalState.order.id, reason });
    } else if (reasonModalState.type === 'cancel-order') {
      await cancelOrderMutation.mutateAsync({ id: reasonModalState.order.id, reason });
    } else if (reasonModalState.type === 'cancel-issue') {
      await cancelIssueMutation.mutateAsync({ id: reasonModalState.issue.id, reason });
    } else if (reasonModalState.type === 'cancel-receipt') {
      await cancelReceiptMutation.mutateAsync({ id: reasonModalState.receipt.id, reason });
    }
    setReasonModalState(null);
  };

  const handleIssueSubmit = async () => {
    const values = await issueForm.validateFields();
    const order = issueModalState?.order;
    if (!order) return;
    const items = (values.items || [])
      .filter((item) => Number(item.quantity ?? 0) > 0)
      .map((item) => ({
        material_requirement: item.material_requirement,
        warehouse: item.warehouse ?? null,
        location: item.location ?? null,
        quantity: String(item.quantity),
        unit_cost: String(item.unit_cost),
        note: item.note?.trim() || '',
      }));
    if (items.length <= 0) {
      messageApi.error('Cần ít nhất 1 dòng vật tư có số lượng > 0.');
      return;
    }
    await issueMutation.mutateAsync({
      id: order.id,
      payload: {
        issue_date: values.issue_date.format('YYYY-MM-DD'),
        reference: values.reference?.trim() || '',
        note: values.note?.trim() || '',
        items,
      },
    });
    setIssueModalState(null);
  };

  const handleReceiptSubmit = async () => {
    const values = await receiptForm.validateFields();
    const order = receiptModalState?.order;
    if (!order) return;
    await receiptMutation.mutateAsync({
      id: order.id,
      payload: {
        receipt_date: values.receipt_date.format('YYYY-MM-DD'),
        warehouse: values.warehouse ?? null,
        location: values.location ?? null,
        reference: values.reference?.trim() || '',
        note: values.note?.trim() || '',
        items: [
          {
            quantity: String(values.quantity),
            unit_cost: String(values.unit_cost),
            note: values.note?.trim() || '',
          },
        ],
      },
    });
    setReceiptModalState(null);
  };

  const handleOperationSubmit = async () => {
    const values = await operationForm.validateFields();
    const modalState = operationModalState;
    if (!modalState) return;
    await operationMutation.mutateAsync({
      id: modalState.order.id,
      payload: {
        operation_id: modalState.operation.id,
        status: values.status,
        completed_qty: values.completed_qty != null ? String(values.completed_qty) : undefined,
        scrap_qty: values.scrap_qty != null ? String(values.scrap_qty) : undefined,
        note: values.note?.trim() || '',
      },
    });
    setOperationModalState(null);
  };

  const columns: ColumnsType<ProductionOrder> = [
    { title: 'Mã lệnh', dataIndex: 'code', width: 140 },
    { title: 'Thành phẩm', dataIndex: 'product_name', width: 220, render: (value) => value || '-' },
    { title: 'Đơn bán', dataIndex: 'sales_order_code', width: 130, render: (value) => value || '-' },
    { title: 'Ngày lệnh', dataIndex: 'order_date', width: 110, render: (value) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Bắt đầu', dataIndex: 'planned_start_date', width: 110, render: (value) => (value ? dayjs(value).format('DD/MM/YYYY') : '-') },
    { title: 'Kết thúc', dataIndex: 'planned_end_date', width: 110, render: (value) => (value ? dayjs(value).format('DD/MM/YYYY') : '-') },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 130,
      render: (value) => <Tag color={STATUS_COLORS[value] || 'default'}>{STATUS_LABELS[value] || value}</Tag>,
    },
    { title: 'KH', dataIndex: 'planned_qty', width: 100 },
    { title: 'Đã nhập', dataIndex: 'produced_qty', width: 100 },
    { title: 'Còn lại', dataIndex: 'remaining_qty', width: 100, render: (value) => value || '0.0000' },
    { title: 'Kho TP', dataIndex: 'target_warehouse_name', width: 160, render: (value) => value || '-' },
    { title: 'Giá trị dự kiến', dataIndex: 'estimated_output_value', width: 140, render: (value) => formatMoney(value) },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 460,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => setDrawerOrder(row)}>
            Xem
          </Button>
          <Button
            size="small"
            disabled={!canManage || !['DRAFT', 'REJECTED'].includes(row.status)}
            onClick={() => {
              setEditingOrder(row);
              setOpenForm(true);
            }}
          >
            Sửa
          </Button>
          <Button
            size="small"
            disabled={!canSubmit || !['DRAFT', 'REJECTED'].includes(row.status)}
            onClick={() => void submitMutation.mutateAsync(row.id)}
          >
            Gửi duyệt
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={!canApprove || row.status !== 'SUBMITTED'}
            onClick={() => void approveMutation.mutateAsync(row.id)}
          >
            Duyệt
          </Button>
          <Button
            size="small"
            danger
            disabled={!canApprove || row.status !== 'SUBMITTED'}
            onClick={() => openReasonModal({ type: 'reject-order', order: row })}
          >
            Từ chối
          </Button>
          <Button
            size="small"
            disabled={!canRelease || row.status !== 'APPROVED'}
            onClick={() => void releaseMutation.mutateAsync(row.id)}
          >
            Phát lệnh
          </Button>
          <Button
            size="small"
            disabled={!canIssue || !['RELEASED', 'IN_PROGRESS'].includes(row.status)}
            onClick={() => setIssueModalState({ order: row })}
          >
            Cấp vật tư
          </Button>
          <Button
            size="small"
            disabled={!canReceive || !['RELEASED', 'IN_PROGRESS'].includes(row.status)}
            onClick={() => setReceiptModalState({ order: row })}
          >
            Nhập TP
          </Button>
          <Button
            size="small"
            danger
            disabled={!canCancel || !['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED'].includes(row.status)}
            onClick={() => openReasonModal({ type: 'cancel-order', order: row })}
          >
            Hủy
          </Button>
          <Button
            size="small"
            danger
            disabled={!canManage || !['DRAFT', 'REJECTED'].includes(row.status)}
            onClick={() =>
              Modal.confirm({
                title: `Xóa lệnh sản xuất ${row.code}?`,
                okText: 'Xóa',
                cancelText: 'Hủy',
                onOk: () => deleteMutation.mutateAsync(row.id),
              })
            }
          >
            Xóa
          </Button>
        </Space>
      ),
    },
  ];

  const materialColumns: ColumnsType<ProductionMaterialRequirement> = [
    { title: '#', dataIndex: 'line_number', width: 60 },
    { title: 'Mã VT', dataIndex: 'material_product_code', width: 120, render: (value) => value || '-' },
    { title: 'Tên VT', dataIndex: 'material_product_name', width: 220, render: (value) => value || '-' },
    { title: 'Yêu cầu', dataIndex: 'required_qty', width: 100 },
    { title: 'Đã cấp', dataIndex: 'issued_qty', width: 100, render: (value) => value || '0.0000' },
    { title: 'Còn cấp', dataIndex: 'remaining_issue_qty', width: 100, render: (value) => value || '0.0000' },
    { title: 'Kho nguồn', dataIndex: 'source_warehouse_name', width: 160, render: (value) => value || '-' },
    { title: 'Vị trí', dataIndex: 'source_location_name', width: 160, render: (value) => value || '-' },
  ];

  const operationColumns: ColumnsType<ProductionOperation> = [
    { title: '#', dataIndex: 'sequence', width: 60 },
    { title: 'Công đoạn', dataIndex: 'step_name', width: 160 },
    { title: 'Tốc độ', dataIndex: 'rate_per_hour', width: 100 },
    { title: 'Kế hoạch', dataIndex: 'planned_qty', width: 100 },
    { title: 'Hoàn thành', dataIndex: 'completed_qty', width: 110 },
    { title: 'Phế phẩm', dataIndex: 'scrap_qty', width: 100 },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 130,
      render: (value) => <Tag color={value === 'DONE' ? 'success' : value === 'IN_PROGRESS' ? 'processing' : value === 'READY' ? 'cyan' : value === 'SKIPPED' ? 'default' : 'warning'}>{OPERATION_STATUS_LABELS[value] || value}</Tag>,
    },
    { title: 'Ghi chú', dataIndex: 'note', width: 220, render: (value) => value || '-' },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 110,
      render: (_, row) => (
        <Button
          size="small"
          disabled={!activeOrder || !['RELEASED', 'IN_PROGRESS'].includes(activeOrder.status)}
          onClick={() => activeOrder && setOperationModalState({ order: activeOrder, operation: row })}
        >
          Cập nhật
        </Button>
      ),
    },
  ];

  const issueColumns: ColumnsType<ProductionIssue> = [
    { title: 'Chứng từ', dataIndex: 'code', width: 130 },
    { title: 'Ngày cấp', dataIndex: 'issue_date', width: 110, render: (value) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (value) => <Tag color={value === 'POSTED' ? 'success' : 'error'}>{value === 'POSTED' ? 'Đã ghi sổ' : 'Đã hủy'}</Tag> },
    { title: 'SL', dataIndex: 'total_qty', width: 100 },
    { title: 'Giá trị', dataIndex: 'total_amount', width: 120, render: (value) => formatMoney(value) },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 120,
      render: (_, row) => (
        <Button
          size="small"
          danger
          disabled={!canCancel || row.status !== 'POSTED'}
          onClick={() => openReasonModal({ type: 'cancel-issue', issue: row })}
        >
          Hủy cấp VT
        </Button>
      ),
    },
  ];

  const receiptColumns: ColumnsType<ProductionReceipt> = [
    { title: 'Phiếu nhập', dataIndex: 'code', width: 130 },
    { title: 'Ngày nhập', dataIndex: 'receipt_date', width: 110, render: (value) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (value) => <Tag color={value === 'POSTED' ? 'success' : 'error'}>{value === 'POSTED' ? 'Đã ghi sổ' : 'Đã hủy'}</Tag> },
    { title: 'SL', dataIndex: 'total_qty', width: 100 },
    { title: 'Giá trị', dataIndex: 'total_amount', width: 120, render: (value) => formatMoney(value) },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 140,
      render: (_, row) => (
        <Button
          size="small"
          danger
          disabled={!canCancel || row.status !== 'POSTED'}
          onClick={() => openReasonModal({ type: 'cancel-receipt', receipt: row })}
        >
          Hủy nhập TP
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Sản xuất</h2>
          <div style={{ color: '#8c8c8c' }}>Quản lý lệnh sản xuất, cấp vật tư, công đoạn và nhập kho thành phẩm</div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => {
            setEditingOrder(null);
            setOpenForm(true);
          }}
        >
          Tạo lệnh sản xuất
        </Button>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
          value={filters.product ?? ''}
          style={{ width: 260 }}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, product: typeof value === 'number' ? value : undefined }));
            setPage(1);
          }}
          options={[
            { value: '', label: 'Tất cả thành phẩm' },
            ...products.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` })),
          ]}
        />
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

      <Table
        rowKey="id"
        loading={ordersQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 2100 }}
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
              {(intentSearch || filters.status) ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy lệnh sản xuất phù hợp.</div>
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
              ) : 'Chưa có lệnh sản xuất. Nhấn Tạo lệnh sản xuất để thêm mới.'}
            </div>
          ) : undefined,
        }}
      />

      <ProductionOrderForm
        open={openForm}
        editing={editingOrder}
        products={products}
        warehouses={warehouses}
        locations={locations}
        salesOrders={salesOrders}
        submitting={createMutation.isPending || updateMutation.isPending}
        onCancel={() => setOpenForm(false)}
        onSubmit={handleSaveOrder}
      />

      <Modal
        title={
          reasonModalState?.type === 'reject-order'
            ? 'Lý do từ chối lệnh sản xuất'
            : reasonModalState?.type === 'cancel-order'
              ? 'Lý do hủy lệnh sản xuất'
              : reasonModalState?.type === 'cancel-issue'
                ? 'Lý do hủy cấp vật tư'
                : 'Lý do hủy nhập thành phẩm'
        }
        open={!!reasonModalState}
        onCancel={() => setReasonModalState(null)}
        onOk={() => void handleReasonSubmit()}
        confirmLoading={
          rejectMutation.isPending
          || cancelOrderMutation.isPending
          || cancelIssueMutation.isPending
          || cancelReceiptMutation.isPending
        }
      >
        <Form form={reasonForm} layout="vertical">
          <Form.Item name="reason" label="Lý do" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={issueModalState ? `Cấp vật tư cho ${issueModalState.order.code}` : 'Cấp vật tư'}
        open={!!issueModalState}
        onCancel={() => setIssueModalState(null)}
        onOk={() => void handleIssueSubmit()}
        confirmLoading={issueMutation.isPending}
        width={980}
      >
        <Form form={issueForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="issue_date" label="Ngày cấp" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
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
                  const requirementId = issueForm.getFieldValue(['items', field.name, 'material_requirement']);
                  const requirement = issueModalState?.order.material_requirements.find((item) => item.id === requirementId);
                  return (
                    <div
                      key={field.key}
                      style={{
                        border: '1px solid #f0f0f0',
                        borderRadius: 10,
                        padding: 12,
                        display: 'grid',
                        gridTemplateColumns: '1.8fr repeat(4, 1fr)',
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{requirement?.material_product_code || 'VT'}</div>
                        <div style={{ color: '#8c8c8c' }}>{requirement?.material_product_name || '-'}</div>
                        <div style={{ color: '#8c8c8c', fontSize: 12 }}>{`Còn cấp: ${requirement?.remaining_issue_qty || '0.0000'}`}</div>
                      </div>
                      <Form.Item name={[field.name, 'material_requirement']} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item label="Kho nguồn" name={[field.name, 'warehouse']} rules={[{ required: true, message: 'Bắt buộc' }]}>
                        <Select
                          showSearch
                          optionFilterProp="label"
                          options={warehouses.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
                        />
                      </Form.Item>
                      <Form.Item label="Vị trí" name={[field.name, 'location']}>
                        <Select
                          showSearch
                          optionFilterProp="label"
                          options={locations.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
                        />
                      </Form.Item>
                      <Form.Item label="Số lượng" name={[field.name, 'quantity']} rules={[{ required: true, message: 'Bắt buộc' }]}>
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item label="Đơn giá" name={[field.name, 'unit_cost']} rules={[{ required: true, message: 'Bắt buộc' }]}>
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

      <Modal
        title={receiptModalState ? `Nhập kho thành phẩm ${receiptModalState.order.code}` : 'Nhập kho thành phẩm'}
        open={!!receiptModalState}
        onCancel={() => setReceiptModalState(null)}
        onOk={() => void handleReceiptSubmit()}
        confirmLoading={receiptMutation.isPending}
      >
        <Form form={receiptForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="receipt_date" label="Ngày nhập" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
            </Form.Item>
            <Form.Item name="reference" label="Tham chiếu">
              <Input />
            </Form.Item>
            <Form.Item name="warehouse" label="Kho thành phẩm" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={warehouses.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
              />
            </Form.Item>
            <Form.Item name="location" label="Vị trí">
              <Select
                showSearch
                optionFilterProp="label"
                options={filteredReceiptLocations.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` }))}
              />
            </Form.Item>
            <Form.Item name="quantity" label="Số lượng nhập" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={0.0001} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="unit_cost" label="Giá vốn thực tế" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={operationModalState ? `Cập nhật công đoạn ${operationModalState.operation.step_name}` : 'Cập nhật công đoạn'}
        open={!!operationModalState}
        onCancel={() => setOperationModalState(null)}
        onOk={() => void handleOperationSubmit()}
        confirmLoading={operationMutation.isPending}
      >
        <Form form={operationForm} layout="vertical">
          <Form.Item name="status" label="Trạng thái" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select
              options={Object.entries(OPERATION_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item name="completed_qty" label="Số lượng hoàn thành">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="scrap_qty" label="Số lượng phế phẩm">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={activeOrder ? `Chi tiết ${activeOrder.code}` : 'Chi tiết lệnh sản xuất'}
        width={1120}
        open={!!drawerOrder}
        onClose={() => setDrawerOrder(null)}
      >
        {activeOrder ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Thành phẩm">{activeOrder.product_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <Tag color={STATUS_COLORS[activeOrder.status] || 'default'}>{STATUS_LABELS[activeOrder.status] || activeOrder.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Đơn bán">{activeOrder.sales_order_code || '-'}</Descriptions.Item>
              <Descriptions.Item label="Dòng đơn">{activeOrder.sales_order_line_number || '-'}</Descriptions.Item>
              <Descriptions.Item label="Ngày lệnh">{dayjs(activeOrder.order_date).format('DD/MM/YYYY')}</Descriptions.Item>
              <Descriptions.Item label="Kế hoạch">{`${activeOrder.planned_qty} / Đã nhập ${activeOrder.produced_qty}`}</Descriptions.Item>
              <Descriptions.Item label="Bắt đầu">{activeOrder.planned_start_date ? dayjs(activeOrder.planned_start_date).format('DD/MM/YYYY') : '-'}</Descriptions.Item>
              <Descriptions.Item label="Kết thúc">{activeOrder.planned_end_date ? dayjs(activeOrder.planned_end_date).format('DD/MM/YYYY') : '-'}</Descriptions.Item>
              <Descriptions.Item label="Kho TP">{activeOrder.target_warehouse_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Vị trí TP">{activeOrder.target_location_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Giá vốn dự kiến">{formatMoney(activeOrder.unit_cost_estimate)}</Descriptions.Item>
              <Descriptions.Item label="Giá trị dự kiến">{formatMoney(activeOrder.estimated_output_value)}</Descriptions.Item>
              <Descriptions.Item label="Ghi chú" span={2}>{activeOrder.notes || '-'}</Descriptions.Item>
              {activeOrder.reject_reason ? <Descriptions.Item label="Lý do từ chối" span={2}>{activeOrder.reject_reason}</Descriptions.Item> : null}
              {activeOrder.cancel_reason ? <Descriptions.Item label="Lý do hủy" span={2}>{activeOrder.cancel_reason}</Descriptions.Item> : null}
            </Descriptions>

            <div>
              <h3 style={{ marginBottom: 8 }}>Công đoạn</h3>
              <Table
                rowKey="id"
                loading={orderDetailQuery.isLoading}
                columns={operationColumns}
                dataSource={activeOrder.operations}
                pagination={false}
                scroll={{ x: 1100 }}
              />
            </div>

            <div>
              <h3 style={{ marginBottom: 8 }}>Nhu cầu vật tư</h3>
              <Table
                rowKey={(row) => String(row.id ?? row.line_number)}
                loading={orderDetailQuery.isLoading}
                columns={materialColumns}
                dataSource={activeOrder.material_requirements}
                pagination={false}
                scroll={{ x: 1100 }}
              />
            </div>

            <div>
              <h3 style={{ marginBottom: 8 }}>Cấp vật tư</h3>
              <Table
                rowKey="id"
                loading={issueOverviewQuery.isLoading}
                columns={issueColumns}
                dataSource={activeIssues}
                pagination={false}
                scroll={{ x: 760 }}
              />
            </div>

            <div>
              <h3 style={{ marginBottom: 8 }}>Nhập kho thành phẩm</h3>
              <Table
                rowKey="id"
                loading={receiptOverviewQuery.isLoading}
                columns={receiptColumns}
                dataSource={activeReceipts}
                pagination={false}
                scroll={{ x: 760 }}
              />
            </div>

            <div>
              <h3 style={{ marginBottom: 8 }}>Lịch sử duyệt</h3>
              <Table<ProductionApprovalHistoryItem>
                rowKey={(row) => `${row.action}-${row.created_at}`}
                loading={approvalHistoryQuery.isLoading}
                columns={[
                  { title: 'Hành động', dataIndex: 'action', width: 160 },
                  { title: 'Người thực hiện', dataIndex: 'user', width: 160, render: (value) => value || '-' },
                  { title: 'Ghi chú', dataIndex: 'comments', width: 260, render: (value) => value || '-' },
                  { title: 'Thời gian', dataIndex: 'created_at', width: 180, render: (value) => dayjs(value).format('DD/MM/YYYY HH:mm') },
                ]}
                dataSource={activeHistory}
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
