import { useMemo, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Statistic, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/inventory';
import type { InventorySalesOrderLineOption, InventoryStockRow } from '../../types/inventory';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageInventoryData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

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

function serializeFilters(filters: Filters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): Filters {
  try {
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return {
      warehouse: parsed.warehouse,
      belowMinOnly: parsed.belowMinOnly === true,
    };
  } catch {
    return { belowMinOnly: false };
  }
}

const quickMoveOptions = [
  { label: 'Nhập nhanh', value: 'RECEIPT' },
  { label: 'Xuất nhanh', value: 'ISSUE' },
  { label: 'Điều chỉnh tăng', value: 'ADJUSTMENT_IN' },
  { label: 'Điều chỉnh giảm', value: 'ADJUSTMENT_OUT' },
];

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSuggestedReserveQty(row: InventoryStockRow | null, line?: InventorySalesOrderLineOption): number {
  const available = toNumber(row?.available);
  const lineNeed = line ? toNumber(line.remaining_reservation_qty ?? line.qty) : available;
  return Math.max(0, Math.min(available, lineNeed));
}

export default function InventoryStockOverview() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({ belowMinOnly: false });
  const [page, setPage] = useState(1);
  const [movementRow, setMovementRow] = useState<InventoryStockRow | null>(null);
  const [reservationRow, setReservationRow] = useState<InventoryStockRow | null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<number | undefined>();
  const [moveForm] = Form.useForm<QuickMoveForm>();
  const [reservationForm] = Form.useForm<ReservationForm>();
  const canManage = canManageInventoryData();
  const { config, saveConfig } = useUserPreferences(PAGES.INVENTORY_STOCK);
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);

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
  }, [intentSearch, intentFilters, page, pageSize]);

  const stockQuery = useQuery({
    queryKey: ['inventory-stock', params],
    queryFn: () => inventoryApi.getStock(params),
  });
  const summaryQuery = useQuery({
    queryKey: ['inventory-stock-summary'],
    queryFn: () => inventoryApi.getStockSummary(),
  });

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

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-stock-summary'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-reservations'] });
  };

  const createMovementMutation = useMutation({
    mutationFn: inventoryApi.createTransaction,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã ghi nhận giao dịch kho');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const createReservationMutation = useMutation({
    mutationFn: inventoryApi.createReservation,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã tạo reservation');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const matchingLines: InventorySalesOrderLineOption[] = useMemo(() => {
    const lines = orderDetailQuery.data?.lines ?? [];
    if (!reservationRow) return [];
    return lines.filter((line) => line.product === reservationRow.product_id);
  }, [orderDetailQuery.data?.lines, reservationRow]);

  const columns: ColumnsType<InventoryStockRow> = [
    { title: 'Mã SP', dataIndex: 'product_code', width: 120 },
    { title: 'Tên sản phẩm', dataIndex: 'product_name', width: 240 },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 160 },
    { title: 'Vị trí', dataIndex: 'location_name', width: 140, render: (value) => value || '-' },
    { title: 'ĐVT', dataIndex: 'unit_name', width: 80, render: (value) => value || '-' },
    { title: 'On hand', dataIndex: 'on_hand', width: 100 },
    { title: 'Reserved', dataIndex: 'reserved', width: 100 },
    { title: 'Available', dataIndex: 'available', width: 100 },
    { title: 'Min', dataIndex: 'min_stock', width: 100 },
    {
      title: 'Tình trạng',
      width: 220,
      render: (_, row) => (
        <Space wrap>
          {row.warehouse_is_active === false ? <Tag color="red">Kho ngưng</Tag> : null}
          {row.location_is_active === false ? <Tag color="red">Vị trí ngưng</Tag> : null}
          {row.location_type === 'RETURN' ? <Tag color="orange">Hàng trả</Tag> : null}
          {toNumber(row.available) <= 0 ? <Tag color="volcano">Hết available</Tag> : null}
          <Tag color={row.is_below_min ? 'red' : 'green'}>
            {row.is_below_min ? 'Dưới min' : 'An toàn'}
          </Tag>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      width: 210,
      fixed: 'right',
      render: (_, row) => {
        const moveDisabled = !canManage || row.warehouse_is_active === false || row.location_is_active === false;
        const reserveDisabled =
          moveDisabled ||
          row.location_type === 'RETURN' ||
          toNumber(row.available) <= 0;
        return (
        <Space>
          <Button
            size="small"
            disabled={moveDisabled}
            onClick={() => {
              setMovementRow(row);
              moveForm.setFieldsValue({
                transaction_type: 'ISSUE',
                transaction_date: dayjs().format('YYYY-MM-DD'),
                quantity: Number(row.available || 0) > 0 ? 1 : 0.0001,
                unit_cost: 0,
                reference: '',
                reason: '',
                note: '',
              });
            }}
          >
            Nhập/xuất nhanh
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={reserveDisabled}
            onClick={() => {
              setReservationRow(row);
              setSelectedOrderId(undefined);
              setOrderSearch('');
              reservationForm.setFieldsValue({
                reservation_date: dayjs().format('YYYY-MM-DD'),
                reserved_qty: getSuggestedReserveQty(row),
                sales_order: undefined,
                sales_order_line: undefined,
                reference: '',
                note: '',
              });
            }}
          >
            Reserve
          </Button>
        </Space>
        );
      },
    },
  ];

  const onSubmitMovement = async () => {
    if (!movementRow) return;
    const values = await moveForm.validateFields();
    await createMovementMutation.mutateAsync({
      transaction_type: values.transaction_type,
      transaction_date: values.transaction_date,
      product: movementRow.product_id,
      warehouse: movementRow.warehouse_id,
      location: movementRow.location_id ?? null,
      quantity: String(values.quantity),
      unit_cost: String(values.unit_cost ?? 0),
      reference: values.reference?.trim() || '',
      reason: values.reason?.trim() || '',
      note: values.note?.trim() || '',
    });
    setMovementRow(null);
  };

  const onSubmitReservation = async () => {
    if (!reservationRow) return;
    const values = await reservationForm.validateFields();
    await createReservationMutation.mutateAsync({
      reservation_date: values.reservation_date,
      sales_order: values.sales_order ?? null,
      sales_order_line: values.sales_order_line ?? null,
      product: reservationRow.product_id,
      warehouse: reservationRow.warehouse_id,
      location: reservationRow.location_id ?? null,
      reserved_qty: String(values.reserved_qty),
      reference: values.reference?.trim() || '',
      note: values.note?.trim() || '',
    });
    setReservationRow(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div>
        <h2 style={{ margin: 0 }}>Tồn kho</h2>
        <div style={{ color: '#8c8c8c' }}>Theo dõi on-hand, reserved, available và thao tác nhanh ngay trên tồn</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Card><Statistic title="Dòng tồn" value={summaryQuery.data?.stock_rows ?? 0} /></Card>
        <Card><Statistic title="Dưới min" value={summaryQuery.data?.below_min_count ?? 0} /></Card>
        <Card><Statistic title="On hand" value={summaryQuery.data?.total_on_hand_qty ?? 0} /></Card>
        <Card><Statistic title="Reserved" value={summaryQuery.data?.total_reserved_qty ?? 0} /></Card>
        <Card><Statistic title="Available" value={summaryQuery.data?.total_available_qty ?? 0} /></Card>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm sản phẩm, kho, vị trí..."
          style={{ width: 320 }}
          suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
        />
        <Select
          allowClear
          placeholder="Lọc theo kho"
          style={{ width: 220 }}
          value={filters.warehouse}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, warehouse: value }));
            setPage(1);
          }}
          options={(warehouseQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
        />
        <Space>
          <span style={{ color: '#595959' }}>Chỉ hiển thị dưới min</span>
          <Switch
            checked={filters.belowMinOnly}
            onChange={(checked) => {
              setFilters((prev) => ({ ...prev, belowMinOnly: checked }));
              setPage(1);
            }}
          />
        </Space>
      </div>

      <Table
        rowKey={(row) => `${row.product_id}-${row.warehouse_id}-${row.location_id ?? '0'}`}
        loading={stockQuery.isLoading}
        columns={columns}
        dataSource={stockQuery.data?.results ?? []}
        scroll={{ x: 1500 }}
        pagination={{
          current: page,
          pageSize,
          total: stockQuery.data?.count ?? 0,
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

      <Modal
        title={movementRow ? `Nhập/xuất nhanh: ${movementRow.product_code}` : 'Nhập/xuất nhanh'}
        open={Boolean(movementRow)}
        onCancel={() => setMovementRow(null)}
        onOk={onSubmitMovement}
        confirmLoading={createMovementMutation.isPending}
      >
        <Form form={moveForm} layout="vertical">
          <Form.Item name="transaction_type" label="Loại giao dịch" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select options={quickMoveOptions} />
          </Form.Item>
          <Form.Item name="transaction_date" label="Ngày chứng từ" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="quantity" label="Số lượng" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <InputNumber style={{ width: '100%' }} min={0.0001} />
          </Form.Item>
          <Form.Item name="unit_cost" label="Đơn giá vốn">
            <InputNumber style={{ width: '100%' }} min={0} />
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
        title={reservationRow ? `Reservation cho ${reservationRow.product_code}` : 'Tạo reservation'}
        open={Boolean(reservationRow)}
        onCancel={() => setReservationRow(null)}
        onOk={onSubmitReservation}
        confirmLoading={createReservationMutation.isPending}
      >
        <Form form={reservationForm} layout="vertical">
          <div style={{ marginBottom: 12, color: '#595959' }}>
            Available tại vị trí hiện tại: <strong>{reservationRow?.available || '0'}</strong>
          </div>
          <Form.Item name="reservation_date" label="Ngày reserve" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="sales_order" label="Đơn bán">
            <Select
              showSearch
              allowClear
              filterOption={false}
              onSearch={setOrderSearch}
              onChange={(value) => {
                setSelectedOrderId(value);
                reservationForm.setFieldValue('sales_order_line', undefined);
                if (!value) {
                  reservationForm.setFieldValue('reserved_qty', getSuggestedReserveQty(reservationRow));
                }
              }}
              options={(orderOptionsQuery.data?.results ?? []).map((item) => ({
                label: `${item.code}${item.customer_name ? ` - ${item.customer_name}` : ''} [${item.status}]`,
                value: item.id,
              })).filter((item) => {
                const order = orderOptionsQuery.data?.results?.find((row) => row.id === item.value);
                return order ? ['APPROVED', 'POSTED'].includes(order.status) : true;
              })}
            />
          </Form.Item>
          <Form.Item name="sales_order_line" label="Dòng hàng">
            <Select
              allowClear
              onChange={(value) => {
                const selectedLine = matchingLines.find((line) => line.id === value);
                reservationForm.setFieldValue('reserved_qty', getSuggestedReserveQty(reservationRow, selectedLine));
              }}
              options={matchingLines.map((line) => ({
                label:
                  `Dòng ${line.line_number} - ${line.product_code || ''} ${line.product_name || ''}` +
                  ` / qty ${line.qty}` +
                  ` / reserved ${line.reserved_qty_total || '0'}` +
                  ` / shipped ${line.shipped_qty_total || '0'}` +
                  ` / còn reserve ${line.remaining_reservation_qty || line.qty}`,
                value: line.id,
              }))}
            />
          </Form.Item>
          <Form.Item name="reserved_qty" label="Số lượng reserve" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <InputNumber style={{ width: '100%' }} min={0.0001} />
          </Form.Item>
          <Form.Item name="reference" label="Tham chiếu">
            <Input />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
