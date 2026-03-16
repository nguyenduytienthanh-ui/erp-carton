import { useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Space, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DataNode } from 'antd/es/tree';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../api/products';
import type { ProductCategory } from '../../types/sales';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageProductData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

type CategoryFilters = { activeOnly: boolean };

function serializeFilters(filters: CategoryFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): CategoryFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<CategoryFilters>;
    return { activeOnly: parsed.activeOnly !== false };
  } catch {
    return { activeOnly: true };
  }
}

type CategoryForm = Omit<ProductCategory, 'id' | 'created_at' | 'updated_at' | 'children'>;

const emptyForm: CategoryForm = {
  code: '',
  name: '',
  parent: undefined,
  is_active: true,
};

export default function CategoryList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<CategoryFilters>({ activeOnly: true });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ProductCategory | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<CategoryForm>();
  const { config, saveConfig } = useUserPreferences(PAGES.PRODUCTS_CATEGORIES);
  const canManage = canManageProductData();

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
    const p: Record<string, unknown> = { page, page_size: pageSize, ordering: 'code' };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.activeOnly) p.is_active = 'true';
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['product-categories', params],
    queryFn: () => productsApi.getCategories(params),
  });

  const createMutation = useMutation({
    mutationFn: productsApi.createCategory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      messageApi.success('Đã thêm danh mục');
      setOpenModal(false);
      form.resetFields();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CategoryForm> }) =>
      productsApi.updateCategory(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      messageApi.success('Đã cập nhật danh mục');
      setOpenModal(false);
      form.resetFields();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: productsApi.deleteCategory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      messageApi.success('Đã xóa danh mục');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;

  const buildTreeData = (categories: ProductCategory[]): DataNode[] => {
    const rootCategories = categories.filter((c) => !c.parent);
    return rootCategories.map((cat) => ({
      title: `${cat.code} - ${cat.name}`,
      key: cat.id,
      children: buildTreeData(categories.filter((c) => c.parent === cat.id)),
    }));
  };

  const columns: ColumnsType<ProductCategory> = [
    { title: 'Mã', dataIndex: 'code', width: 120 },
    { title: 'Tên', dataIndex: 'name', width: 260 },
    { title: 'Danh mục cha', dataIndex: ['parent', 'name'], width: 180 },
    {
      title: 'Thao tác',
      width: 120,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => {
              setEditing(record);
              form.setFieldsValue(record);
              setOpenModal(true);
            }}
            disabled={!canManage}
          />
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.confirm({
                title: 'Xóa danh mục',
                content: `Bạn chắc chắn muốn xóa danh mục "${record.code}"?`,
                okText: 'Xóa',
                cancelText: 'Hủy',
                onOk: () => deleteMutation.mutate(record.id),
              });
            }}
            disabled={!canManage}
          />
        </Space>
      ),
    },
  ];

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, payload: values });
      } else {
        await createMutation.mutateAsync(values);
      }
    } catch {
      // Form validation failed
    }
  };

  const handleModalClose = () => {
    setOpenModal(false);
    setEditing(null);
    form.resetFields();
  };

  return (
    <>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Danh mục sản phẩm</h2>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => {
            setEditing(null);
            form.resetFields();
            setOpenModal(true);
          }}
        >
          Thêm danh mục
        </Button>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm theo mã, tên..."
          style={{ width: 250 }}
          suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
        />
      </div>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 800 }}
        pagination={{
          current: page,
          pageSize,
          total,
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
          emptyText: rows.length === 0 && !listQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {intentSearch ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy danh mục phù hợp.</div>
                  <Button
                    type="link"
                    onClick={() => {
                      setSearchInput('');
                      setPage(1);
                    }}
                  >
                    Xóa bộ lọc
                  </Button>
                </div>
              ) : 'Chưa có danh mục.'}
            </div>
          ) : undefined,
        }}
      />

      <Modal
        title={editing ? `Sửa danh mục ${editing.code}` : 'Thêm danh mục sản phẩm'}
        open={openModal}
        onCancel={handleModalClose}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={emptyForm}>
          <Form.Item name="code" label="Mã" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input placeholder="VD: DUNG_CU" />
          </Form.Item>
          <Form.Item name="name" label="Tên" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input placeholder="VD: Dụng cụ" />
          </Form.Item>
          <Form.Item name="parent" label="Danh mục cha">
            <Input placeholder="Để trống nếu là danh mục gốc" type="number" />
          </Form.Item>
          <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
            <input type="checkbox" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
