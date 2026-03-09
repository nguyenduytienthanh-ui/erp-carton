import { useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Switch, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../api/finance';
import type { TransactionCategory, TransactionCategoryType } from '../../types/finance';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageFinanceData } from '../../utils/authz';

type CategoryFilters = {
  category_type: '' | TransactionCategoryType;
};

const typeOptions: Array<{ value: TransactionCategoryType; label: string }> = [
  { value: 'INCOME', label: 'Thu' },
  { value: 'EXPENSE', label: 'Chi' },
];

function serializeFilters(filters: CategoryFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): CategoryFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<CategoryFilters>;
    return {
      category_type:
        parsed.category_type === 'INCOME' || parsed.category_type === 'EXPENSE' ? parsed.category_type : '',
    };
  } catch {
    return { category_type: '' };
  }
}

type CategoryForm = Omit<TransactionCategory, 'id' | 'is_system' | 'created_at' | 'updated_at'>;

const emptyForm: CategoryForm = {
  code: '',
  name: '',
  category_type: 'EXPENSE',
  color: '#1677ff',
  note: '',
  is_active: true,
};

export default function TransactionCategoryList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<CategoryFilters>({ category_type: '' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TransactionCategory | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<CategoryForm>();
  const { config, saveConfig } = useUserPreferences(PAGES.FINANCE_TRANSACTION_CATEGORIES);
  const canManage = canManageFinanceData();

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
    if (intentFilters.category_type) p.category_type = intentFilters.category_type;
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['finance-transaction-categories', params],
    queryFn: () => financeApi.getTransactionCategories(params),
  });

  const createMutation = useMutation({
    mutationFn: financeApi.createTransactionCategory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-transaction-categories'] });
      messageApi.success('Đã thêm loại thu chi');
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CategoryForm> }) =>
      financeApi.updateTransactionCategory(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-transaction-categories'] });
      messageApi.success('Đã cập nhật loại thu chi');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: financeApi.deleteTransactionCategory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-transaction-categories'] });
      messageApi.success('Đã xóa loại thu chi');
    },
  });

  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;

  const columns: ColumnsType<TransactionCategory> = [
    { title: 'Mã', dataIndex: 'code', width: 120 },
    { title: 'Tên loại', dataIndex: 'name', width: 240 },
    {
      title: 'Loại',
      dataIndex: 'category_type',
      width: 100,
      render: (v: TransactionCategoryType) => (v === 'INCOME' ? 'Thu' : 'Chi'),
    },
    {
      title: 'Màu',
      dataIndex: 'color',
      width: 90,
      render: (color: string) => <div style={{ width: 18, height: 18, borderRadius: 4, backgroundColor: color }} />,
    },
    { title: 'Hệ thống', dataIndex: 'is_system', width: 90, render: (v: boolean) => (v ? 'Có' : 'Không') },
    { title: 'Kích hoạt', dataIndex: 'is_active', width: 90, render: (v: boolean) => (v ? 'Có' : 'Không') },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 180,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            disabled={row.is_system || !canManage}
            onClick={() => {
              setEditing(row);
              form.setFieldsValue({ ...row });
              setOpenModal(true);
            }}
          >
            Sửa
          </Button>
          <Button
            size="small"
            danger
            disabled={row.is_system || !canManage}
            onClick={() =>
              Modal.confirm({
                title: `Xóa danh mục ${row.code}?`,
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
    const payload: CategoryForm = {
      ...values,
      code: values.code.trim().toUpperCase(),
      name: values.name.trim(),
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
          <h2 style={{ margin: 0 }}>Loại thu chi</h2>
          <div style={{ color: '#8c8c8c' }}>Danh mục chuẩn cho sổ quỹ</div>
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
          Thêm loại
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
          value={filters.category_type || undefined}
          onChange={(value) => {
            setFilters({ category_type: (value ?? '') as '' | TransactionCategoryType });
            setPage(1);
          }}
          placeholder="Lọc theo loại"
          style={{ width: 180 }}
          options={typeOptions}
        />
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({ category_type: '' });
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
        dataSource={rows}
        scroll={{ x: 900 }}
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
      />

      <Modal
        title={editing ? `Sửa loại ${editing.code}` : 'Thêm loại thu chi'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={onSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Mã" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name" label="Tên loại" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="category_type" label="Loại" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select options={typeOptions} />
          </Form.Item>
          <Form.Item name="color" label="Màu">
            <Input />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

