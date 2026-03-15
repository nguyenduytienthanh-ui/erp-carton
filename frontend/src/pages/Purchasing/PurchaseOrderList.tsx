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
import { purchasingApi } from '../../api/purchasing';
import PurchaseOrderForm from './PurchaseOrderForm';
import type { PurchaseApprovalHistoryItem, PurchaseOrder, PurchaseOrderFormValues, PurchaseReceipt, Supplier } from '../../types/purchasing';
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


type Filters = {
  status?: string;
  supplier?: number;
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


export default function PurchaseOrderList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManagePurchasingData();
  const canSubmit = canSubmitPurchaseOrders();
  const canApprove = canApprovePurchaseOrders();
  const canReceive = canReceivePurchaseOrders();
  const canCancel = canCancelPurchaseOrders();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [drawerOrder, setDrawerOrder] = useState<PurchaseOrder | null>(null);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [reasonModalState, setReasonModalState] = useState<ReasonModalState>(null);
  const [receiveModalState, setReceiveModalState] = useState<ReceiveModalState>(null);
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
    if (intentFilters.supplier) next.supplier = intentFilters.supplier;
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const ordersQuery = useQuery({
    queryKey: ['purchasing-orders', params],
    queryFn: () => purchasingApi.getOrders(params),
  });
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
    queryKey: ['purchasing-order-receipts', drawerOrder?.id],
    queryFn: () => purchasingApi.getOrderReceiptOverview(drawerOrder!.id),
    enabled: !!drawerOrder,
  });
  const approvalHistoryQuery = useQuery({
    queryKey: ['purchasing-order-history', drawerOrder?.id],
    queryFn: () => purchasingApi.getOrderApprovalHistory(drawerOrder!.id),
    enabled: !!drawerOrder,
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

  const rows = ordersQuery.data?.results ?? [];
  const supplierOptions: Supplier[] = suppliersQuery.data?.results ?? [];
  const productOptions = productsQuery.data?.results ?? [];
  const warehouseOptions = warehousesQuery.data?.results ?? [];
  const locationOptions = locationsQuery.data?.results ?? [];
  const receiveLocationOptions = useMemo(() => {
    if (!receiveWarehouseId) return locationOptions;
    return locationOptions.filter((item) => item.warehouse === receiveWarehouseId);
  }, [locationOptions, receiveWarehouseId]);

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

  const columns: ColumnsType<PurchaseOrder> = [
    { title: 'Mã đơn mua', dataIndex: 'code', width: 140 },
    { title: 'Nhà cung cấp', dataIndex: 'supplier_name', width: 220, render: (value) => value || '-' },
    { title: 'Ngày đơn', dataIndex: 'order_date', width: 110, render: (value) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Dự kiến nhận', dataIndex: 'expected_receipt_date', width: 120, render: (value) => (value ? dayjs(value).format('DD/MM/YYYY') : '-') },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 130,
      render: (value) => <Tag color={STATUS_COLORS[value] || 'default'}>{STATUS_LABELS[value] || value}</Tag>,
    },
    { title: 'Kho nhập', dataIndex: 'warehouse_name', width: 160, render: (value) => value || '-' },
    { title: 'Số dòng', key: 'line_count', width: 80, render: (_, row) => row.lines?.length ?? 0 },
    { title: 'Thanh toán', dataIndex: 'payment_terms_days', width: 100, render: (value) => `${value} ngày` },
    { title: 'Tổng tiền', dataIndex: 'total', width: 140, render: (value) => formatMoney(value) },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 420,
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
            onClick={() => openReasonModal({ type: 'reject', order: row })}
          >
            Từ chối
          </Button>
          <Button
            size="small"
            disabled={!canReceive || !['APPROVED', 'PARTIAL_RECEIVED'].includes(row.status)}
            onClick={() => setReceiveModalState({ order: row })}
          >
            Nhập kho
          </Button>
          <Button
            size="small"
            danger
            disabled={!canCancel || !['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(row.status)}
            onClick={() => openReasonModal({ type: 'cancel', order: row })}
          >
            Hủy
          </Button>
          <Button
            size="small"
            danger
            disabled={!canManage || !['DRAFT', 'REJECTED'].includes(row.status)}
            onClick={() =>
              Modal.confirm({
                title: `Xóa đơn mua ${row.code}?`,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Đơn mua</h2>
          <div style={{ color: '#8c8c8c' }}>Quản lý đơn mua, duyệt mua và nhập kho mua hàng</div>
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
          Tạo đơn mua
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
        scroll={{ x: 1900 }}
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
      />

      <PurchaseOrderForm
        open={openForm}
        editing={editingOrder}
        suppliers={supplierOptions}
        products={productOptions}
        warehouses={warehouseOptions}
        locations={locationOptions}
        submitting={createMutation.isPending || updateMutation.isPending}
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
        onClose={() => setDrawerOrder(null)}
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
