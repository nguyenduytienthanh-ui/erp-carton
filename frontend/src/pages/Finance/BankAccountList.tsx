import { useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Space, Switch, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../api/finance';
import type { BankAccount } from '../../types/finance';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageFinanceData } from '../../utils/authz';

type BankFilters = { activeOnly: boolean };

function serializeFilters(filters: BankFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): BankFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<BankFilters>;
    return { activeOnly: parsed.activeOnly !== false };
  } catch {
    return { activeOnly: true };
  }
}

type BankAccountForm = Omit<BankAccount, 'id' | 'created_at' | 'updated_at'>;

const emptyForm: BankAccountForm = {
  code: '',
  account_number: '',
  account_name: '',
  bank_name: '',
  branch: '',
  note: '',
  is_active: true,
};

export default function BankAccountList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<BankFilters>({ activeOnly: true });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<BankAccountForm>();
  const { config, saveConfig } = useUserPreferences(PAGES.FINANCE_BANK_ACCOUNTS);
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
    if (intentFilters.activeOnly) p.is_active = 'true';
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['finance-bank-accounts', params],
    queryFn: () => financeApi.getBankAccounts(params),
  });

  const createMutation = useMutation({
    mutationFn: financeApi.createBankAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-accounts'] });
      messageApi.success('Đã thêm tài khoản ngân hàng');
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<BankAccountForm> }) =>
      financeApi.updateBankAccount(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-accounts'] });
      messageApi.success('Đã cập nhật tài khoản ngân hàng');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: financeApi.deleteBankAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-accounts'] });
      messageApi.success('Đã xóa tài khoản ngân hàng');
    },
  });

  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;

  const columns: ColumnsType<BankAccount> = [
    { title: 'Mã', dataIndex: 'code', width: 120 },
    { title: 'Số tài khoản', dataIndex: 'account_number', width: 160 },
    { title: 'Tên chủ tài khoản', dataIndex: 'account_name', width: 260 },
    { title: 'Ngân hàng', dataIndex: 'bank_name', width: 180 },
    { title: 'Chi nhánh', dataIndex: 'branch', width: 180 },
    { title: 'Kích hoạt', dataIndex: 'is_active', width: 90, render: (v) => (v ? 'Có' : 'Không') },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 170,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          {canManage && (
            <>
              <Button size="small" onClick={() => {
                setEditing(row);
                form.setFieldsValue({ ...row });
                setOpenModal(true);
              }}>
                Sửa
              </Button>
              <Button
                size="small"
                danger
                onClick={() =>
                  Modal.confirm({
                    title: `Xóa tài khoản ${row.code}?`,
                    okText: 'Xóa',
                    cancelText: 'Hủy',
                    onOk: () => deleteMutation.mutateAsync(row.id),
                  })
                }
              >
                Xóa
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  const onSubmit = async () => {
    const values = await form.validateFields();
    const payload: BankAccountForm = {
      ...values,
      code: values.code.trim().toUpperCase(),
      account_number: values.account_number.trim(),
      account_name: values.account_name.trim(),
      bank_name: values.bank_name.trim(),
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
          <h2 style={{ margin: 0 }}>Ngân hàng</h2>
          <div style={{ color: '#8c8c8c' }}>Danh mục tài khoản ngân hàng</div>
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
          Thêm tài khoản
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
        dataSource={rows}
        scroll={{ x: 1200 }}
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
        title={editing ? `Sửa tài khoản ${editing.code}` : 'Thêm tài khoản ngân hàng'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={onSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="Mã" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="account_number" label="Số tài khoản" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="account_name" label="Tên chủ tài khoản" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="bank_name" label="Ngân hàng" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="branch" label="Chi nhánh">
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

