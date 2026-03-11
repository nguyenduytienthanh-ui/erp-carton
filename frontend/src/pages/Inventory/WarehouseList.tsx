import { useMemo, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Space, Switch, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/inventory';
import type { Warehouse } from '../../types/inventory';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageInventoryData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

type WarehouseFilters = { activeOnly: boolean };
type WarehouseFormValues = Omit<Warehouse, 'id' | 'created_at' | 'updated_at' | 'manager_name'>;

const emptyForm: WarehouseFormValues = {
  code: '',
  name: '',
  address: '',
  manager: null,
  note: '',
  is_active: true,
  sort_order: 0,
};

function serializeFilters(filters: WarehouseFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): WarehouseFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<WarehouseFilters>;
    return { activeOnly: parsed.activeOnly !== false };
  } catch {
    return { activeOnly: true };
  }
}

export default function WarehouseList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<WarehouseFilters>({ activeOnly: true });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<WarehouseFormValues>();
  const canManage = canManageInventoryData();
  const { config, saveConfig } = useUserPreferences(PAGES.INVENTORY_WAREHOUSES);
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
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: 'code' };
    if (intentSearch.trim()) next.search = intentSearch.trim();
    if (intentFilters.activeOnly) next.is_active = 'true';
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['inventory-warehouses', params],
    queryFn: () => inventoryApi.getWarehouses(params),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory-warehouses'] });
  };

  const createMutation = useMutation({
    mutationFn: inventoryApi.createWarehouse,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã thêm kho');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<WarehouseFormValues> }) => inventoryApi.updateWarehouse(id, payload),
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã cập nhật kho');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: inventoryApi.deleteWarehouse,
    onSuccess: async () => {
      await invalidate();
      messageApi.success('Đã xóa kho');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const columns: ColumnsType<Warehouse> = [
    { title: 'Mã kho', dataIndex: 'code', width: 120 },
    { title: 'Tên kho', dataIndex: 'name', width: 220 },
    { title: 'Địa chỉ', dataIndex: 'address', width: 260 },
    { title: 'Quản lý', dataIndex: 'manager_name', width: 180, render: (value) => value || '-' },
    { title: 'Sắp xếp', dataIndex: 'sort_order', width: 90 },
    { title: 'Kích hoạt', dataIndex: 'is_active', width: 90, render: (value) => (value ? 'Có' : 'Không') },
    { title: 'Ghi chú', dataIndex: 'note', width: 220, render: (value) => value || '-' },
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
                code: row.code,
                name: row.name,
                address: row.address,
                manager: row.manager ?? null,
                note: row.note,
                is_active: row.is_active,
                sort_order: row.sort_order,
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
                title: `Xóa kho ${row.code}?`,
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
    const payload: WarehouseFormValues = {
      ...values,
      code: values.code.trim().toUpperCase(),
      name: values.name.trim(),
      address: values.address?.trim() || '',
      note: values.note?.trim() || '',
      manager: values.manager ?? null,
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
          <h2 style={{ margin: 0 }}>Kho hàng</h2>
          <div style={{ color: '#8c8c8c' }}>Danh mục kho vật lý và kho nghiệp vụ</div>
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
          Thêm kho
        </Button>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm mã kho, tên kho, địa chỉ..."
          style={{ width: 320 }}
          suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
        />
        <Space>
          <span style={{ color: '#595959' }}>Chỉ hiển thị đang dùng</span>
          <Switch
            checked={filters.activeOnly}
            onChange={(checked) => {
              setFilters({ activeOnly: checked });
              setPage(1);
            }}
          />
        </Space>
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({ activeOnly: true });
            setPage(1);
          }}
        >
          Xóa bộ lọc
        </Button>
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
        title={editing ? `Sửa kho ${editing.code}` : 'Thêm kho'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={onSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Mã kho" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="Tên kho" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="address" label="Địa chỉ">
            <Input />
          </Form.Item>
          <Form.Item name="sort_order" label="Thứ tự">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
