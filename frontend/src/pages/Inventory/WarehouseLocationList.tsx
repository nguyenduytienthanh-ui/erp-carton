import { useMemo, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/inventory';
import type { WarehouseLocation } from '../../types/inventory';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageInventoryData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

type Filters = { activeOnly: boolean; warehouse?: number };
type FormValues = Omit<WarehouseLocation, 'id' | 'created_at' | 'updated_at' | 'warehouse_name' | 'parent_name'>;

const LOCATION_TYPE_OPTIONS = [
  { label: 'Lưu trữ', value: 'STORAGE' },
  { label: 'Chờ xử lý', value: 'STAGING' },
  { label: 'Xuất hàng', value: 'SHIPPING' },
  { label: 'Hàng trả', value: 'RETURN' },
  { label: 'Sản xuất', value: 'PRODUCTION' },
  { label: 'Khác', value: 'OTHER' },
];

const emptyForm: FormValues = {
  warehouse: 0,
  code: '',
  name: '',
  parent: null,
  location_type: 'STORAGE',
  allow_mixed_products: true,
  is_active: true,
  sort_order: 0,
  note: '',
};

function serializeFilters(filters: Filters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): Filters {
  try {
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return { activeOnly: parsed.activeOnly !== false, warehouse: parsed.warehouse };
  } catch {
    return { activeOnly: true };
  }
}

export default function WarehouseLocationList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({ activeOnly: true });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<WarehouseLocation | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const canManage = canManageInventoryData();
  const { config, saveConfig } = useUserPreferences(PAGES.INVENTORY_LOCATIONS);
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

  const locationOptionsQuery = useQuery({
    queryKey: ['inventory-location-parent-options', form.getFieldValue('warehouse')],
    queryFn: () => inventoryApi.getLocations({ page_size: 200, warehouse: form.getFieldValue('warehouse') || undefined, ordering: 'code' }),
    enabled: Boolean(form.getFieldValue('warehouse')),
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: 'warehouse__code' };
    if (intentSearch.trim()) next.search = intentSearch.trim();
    if (intentFilters.activeOnly) next.is_active = 'true';
    if (intentFilters.warehouse) next.warehouse = intentFilters.warehouse;
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['inventory-locations', params],
    queryFn: () => inventoryApi.getLocations(params),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory-locations'] });
    await queryClient.invalidateQueries({ queryKey: ['inventory-location-parent-options'] });
  };

  const createMutation = useMutation({
    mutationFn: inventoryApi.createLocation,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã thêm vị trí kho');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<FormValues> }) => inventoryApi.updateLocation(id, payload),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã cập nhật vị trí kho');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: inventoryApi.deleteLocation,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã xóa vị trí kho');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const columns: ColumnsType<WarehouseLocation> = [
    { title: 'Kho', dataIndex: 'warehouse_name', width: 160 },
    { title: 'Mã vị trí', dataIndex: 'code', width: 120 },
    { title: 'Tên vị trí', dataIndex: 'name', width: 200 },
    { title: 'Cha', dataIndex: 'parent_name', width: 140, render: (value) => value || '-' },
    { title: 'Loại', dataIndex: 'location_type', width: 120 },
    { title: 'Trộn nhiều mã', dataIndex: 'allow_mixed_products', width: 110, render: (value) => (value ? 'Có' : 'Không') },
    { title: 'Kích hoạt', dataIndex: 'is_active', width: 90, render: (value) => (value ? 'Có' : 'Không') },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 170,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            disabled={!canManage}
            onClick={() => {
              setEditing(row);
              form.setFieldsValue({
                warehouse: row.warehouse,
                code: row.code,
                name: row.name,
                parent: row.parent ?? null,
                location_type: row.location_type,
                allow_mixed_products: row.allow_mixed_products,
                is_active: row.is_active,
                sort_order: row.sort_order,
                note: row.note,
              });
              setOpenModal(true);
            }}
          >
            Sửa
          </Button>
          <Button
            size="small"
            danger
            disabled={!canManage}
            onClick={() =>
              Modal.confirm({
                title: `Xóa vị trí ${row.code}?`,
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

  const onSubmit = async () => {
    const values = await form.validateFields();
    const payload: FormValues = {
      ...values,
      code: values.code.trim().toUpperCase(),
      name: values.name.trim(),
      note: values.note?.trim() || '',
      warehouse: Number(values.warehouse),
      parent: values.parent ?? null,
      sort_order: Number(values.sort_order ?? 0),
    };
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setOpenModal(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Vị trí kho</h2>
          <div style={{ color: '#8c8c8c' }}>Bin, staging, shipping và các vùng xử lý trong kho</div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => {
            setEditing(null);
            form.setFieldsValue(emptyForm);
            setOpenModal(true);
          }}
        >
          Thêm vị trí
        </Button>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm mã vị trí, tên vị trí, kho..."
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
          <span style={{ color: '#595959' }}>Chỉ hiển thị đang dùng</span>
          <Switch
            checked={filters.activeOnly}
            onChange={(checked) => {
              setFilters((prev) => ({ ...prev, activeOnly: checked }));
              setPage(1);
            }}
          />
        </Space>
      </div>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={listQuery.data?.results ?? []}
        scroll={{ x: 1200 }}
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
        title={editing ? `Sửa vị trí ${editing.code}` : 'Thêm vị trí kho'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={onSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="warehouse" label="Kho" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select
              options={(warehouseQuery.data?.results ?? []).map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
              onChange={() => form.setFieldValue('parent', null)}
            />
          </Form.Item>
          <Form.Item name="code" label="Mã vị trí" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="Tên vị trí" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="parent" label="Vị trí cha">
            <Select
              allowClear
              options={(locationOptionsQuery.data?.results ?? [])
                .filter((item) => !editing || item.id !== editing.id)
                .map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
            />
          </Form.Item>
          <Form.Item name="location_type" label="Loại vị trí" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select options={LOCATION_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="sort_order" label="Thứ tự">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="allow_mixed_products" label="Cho phép trộn nhiều mã" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
