import { useMemo, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/inventory';
import { productsApi } from '../../api/products';
import type { InventoryTransaction } from '../../types/inventory';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageInventoryData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

type Filters = { warehouse?: number; transaction_type?: string };
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

const TYPE_OPTIONS = [
  { label: 'Nhập kho', value: 'RECEIPT' },
  { label: 'Xuất kho', value: 'ISSUE' },
  { label: 'Chuyển kho', value: 'TRANSFER' },
  { label: 'Điều chỉnh tăng', value: 'ADJUSTMENT_IN' },
  { label: 'Điều chỉnh giảm', value: 'ADJUSTMENT_OUT' },
];

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

const statusColor: Record<string, string> = {
  POSTED: 'green',
  CANCELLED: 'red',
};

export default function InventoryTransactionList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const canManage = canManageInventoryData();
  const { config, saveConfig } = useUserPreferences(PAGES.INVENTORY_TRANSACTIONS);
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);
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
    if (intentFilters.warehouse) next.warehouse = intentFilters.warehouse;
    if (intentFilters.transaction_type) next.transaction_type = intentFilters.transaction_type;
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['inventory-transactions', params],
    queryFn: () => inventoryApi.getTransactions(params),
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
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const columns: ColumnsType<InventoryTransaction> = [
    { title: 'Mã CT', dataIndex: 'code', width: 150 },
    { title: 'Ngày', dataIndex: 'transaction_date', width: 110 },
    { title: 'Loại', dataIndex: 'transaction_type', width: 130 },
    { title: 'Sản phẩm', width: 240, render: (_, row) => `${row.product_code || ''} - ${row.product_name || ''}` },
    { title: 'Nguồn', width: 200, render: (_, row) => [row.warehouse_name, row.location_name].filter(Boolean).join(' / ') || '-' },
    { title: 'Đích', width: 200, render: (_, row) => [row.target_warehouse_name, row.target_location_name].filter(Boolean).join(' / ') || '-' },
    { title: 'SL', dataIndex: 'quantity', width: 100 },
    { title: 'Ref', dataIndex: 'reference', width: 140, render: (value) => value || '-' },
    { title: 'Trạng thái', width: 110, render: (_, row) => <Tag color={statusColor[row.status] || 'default'}>{row.status}</Tag> },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            danger
            disabled={!canManage || row.status !== 'POSTED'}
            onClick={() => {
              const reason = window.prompt('Lý do hủy chứng từ kho', '');
              if (!reason) return;
              void cancelMutation.mutateAsync({ id: row.id, reason });
            }}
          >
            Hủy
          </Button>
        </Space>
      ),
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
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Sổ kho</h2>
          <div style={{ color: '#8c8c8c' }}>Nhật ký nhập, xuất, chuyển và điều chỉnh tồn</div>
        </div>
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
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm mã CT, sản phẩm, ref..."
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
        <Select
          allowClear
          placeholder="Lọc theo loại"
          style={{ width: 220 }}
          value={filters.transaction_type}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, transaction_type: value }));
            setPage(1);
          }}
          options={TYPE_OPTIONS}
        />
      </div>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={listQuery.data?.results ?? []}
        scroll={{ x: 1500 }}
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
      />

      <Modal
        title="Tạo giao dịch kho"
        open={openModal}
        onCancel={() => setOpenModal(false)}
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
    </div>
  );
}
