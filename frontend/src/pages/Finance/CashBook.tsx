import { useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Segmented,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../api/finance';
import type {
  CashAccount,
  CashAccountType,
  CashTransaction,
  CashTransactionSourceType,
  CashTransactionType,
} from '../../types/finance';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageFinanceData } from '../../utils/authz';

type ViewMode = 'transactions' | 'accounts';
type TransactionFilters = {
  transaction_type: '' | CashTransactionType;
};

function serializeFilters(filters: TransactionFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): TransactionFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<TransactionFilters>;
    return {
      transaction_type:
        parsed.transaction_type === 'INCOME' ||
        parsed.transaction_type === 'EXPENSE' ||
        parsed.transaction_type === 'TRANSFER'
          ? parsed.transaction_type
          : '',
    };
  } catch {
    return { transaction_type: '' };
  }
}

type CashAccountForm = {
  name: string;
  account_type: CashAccountType;
  balance?: number;
  note: string;
  is_active: boolean;
};

type CashTransactionForm = {
  transaction_type: CashTransactionType;
  source_type: CashTransactionSourceType;
  source_cash_account: number | null;
  source_bank_account: number | null;
  target_cash_account: number | null;
  category: number | null;
  transaction_date: string;
  amount: number;
  object_name: string;
  reason: string;
  note: string;
};

const emptyAccountForm: CashAccountForm = {
  name: '',
  account_type: 'CASH',
  balance: 0,
  note: '',
  is_active: true,
};

const emptyTransactionForm: CashTransactionForm = {
  transaction_type: 'EXPENSE',
  source_type: 'CASH',
  source_cash_account: null,
  source_bank_account: null,
  target_cash_account: null,
  category: null,
  transaction_date: new Date().toISOString().slice(0, 10),
  amount: 0,
  object_name: '',
  reason: '',
  note: '',
};

export default function CashBook() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>('transactions');
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<TransactionFilters>({ transaction_type: '' });
  const [page, setPage] = useState(1);
  const [openTransactionModal, setOpenTransactionModal] = useState(false);
  const [openAccountModal, setOpenAccountModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<CashTransaction | null>(null);
  const [editingAccount, setEditingAccount] = useState<CashAccount | null>(null);
  const [transactionForm] = Form.useForm<CashTransactionForm>();
  const [accountForm] = Form.useForm<CashAccountForm>();
  const { config, saveConfig } = useUserPreferences(PAGES.FINANCE_CASH_BOOK);
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

  const transactionsParams = useMemo(() => {
    const p: Record<string, unknown> = { page, page_size: pageSize, ordering: '-transaction_date' };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.transaction_type) p.transaction_type = intentFilters.transaction_type;
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const transactionsQuery = useQuery({
    queryKey: ['finance-cash-transactions', transactionsParams],
    queryFn: () => financeApi.getCashTransactions(transactionsParams),
  });
  const accountsQuery = useQuery({
    queryKey: ['finance-cash-accounts'],
    queryFn: () => financeApi.getCashAccounts({ page: 1, page_size: 200, ordering: 'name' }),
  });
  const categoriesQuery = useQuery({
    queryKey: ['finance-transaction-categories-all'],
    queryFn: () => financeApi.getTransactionCategories({ page: 1, page_size: 200, ordering: 'code', is_active: 'true' }),
  });
  const bankAccountsQuery = useQuery({
    queryKey: ['finance-bank-accounts-all'],
    queryFn: () => financeApi.getBankAccounts({ page: 1, page_size: 200, ordering: 'code', is_active: 'true' }),
  });

  const createAccountMutation = useMutation({
    mutationFn: financeApi.createCashAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-cash-accounts'] });
      messageApi.success('Đã thêm tài khoản quỹ');
    },
  });
  const updateAccountMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      financeApi.updateCashAccount(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-cash-accounts'] });
      messageApi.success('Đã cập nhật tài khoản quỹ');
    },
  });
  const deleteAccountMutation = useMutation({
    mutationFn: financeApi.deleteCashAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-cash-accounts'] });
      messageApi.success('Đã xóa tài khoản quỹ');
    },
  });
  const createTransactionMutation = useMutation({
    mutationFn: financeApi.createCashTransaction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-cash-transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-cash-accounts'] });
      messageApi.success('Đã thêm giao dịch');
    },
  });
  const updateTransactionMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      financeApi.updateCashTransaction(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-cash-transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-cash-accounts'] });
      messageApi.success('Đã cập nhật giao dịch');
    },
  });
  const deleteTransactionMutation = useMutation({
    mutationFn: financeApi.deleteCashTransaction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-cash-transactions'] });
      messageApi.success('Đã xóa giao dịch');
    },
  });

  const transactions = useMemo(
    () => transactionsQuery.data?.results ?? [],
    [transactionsQuery.data?.results]
  );
  const transactionTotal = transactionsQuery.data?.count ?? 0;
  const cashAccounts = accountsQuery.data?.results ?? [];
  const activeCashAccounts = cashAccounts.filter((item) => item.is_active);
  const categories = categoriesQuery.data?.results ?? [];
  const bankAccounts = bankAccountsQuery.data?.results ?? [];

  const summary = useMemo(() => {
    const totalIncome = transactions
      .filter((item) => item.transaction_type === 'INCOME')
      .reduce((acc, item) => acc + Number(item.amount), 0);
    const totalExpense = transactions
      .filter((item) => item.transaction_type === 'EXPENSE')
      .reduce((acc, item) => acc + Number(item.amount), 0);
    return {
      totalIncome,
      totalExpense,
      delta: totalIncome - totalExpense,
    };
  }, [transactions]);

  const transactionColumns: ColumnsType<CashTransaction> = [
    {
      title: 'Ngày',
      dataIndex: 'transaction_date',
      width: 120,
    },
    {
      title: 'Loại',
      dataIndex: 'transaction_type',
      width: 110,
      render: (type: CashTransactionType) => {
        if (type === 'INCOME') return <Tag color="green">Thu</Tag>;
        if (type === 'EXPENSE') return <Tag color="red">Chi</Tag>;
        return <Tag color="blue">Chuyển</Tag>;
      },
    },
    {
      title: 'Nguồn',
      width: 210,
      render: (_, row) =>
        row.source_type === 'CASH' ? row.source_cash_account_name ?? '-' : row.source_bank_account_code ?? '-',
    },
    {
      title: 'Danh mục',
      dataIndex: 'category_name',
      width: 180,
      render: (value: string | undefined) => value || '-',
    },
    {
      title: 'Lý do',
      dataIndex: 'reason',
      width: 240,
      render: (value: string) => value || '-',
    },
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      align: 'right',
      width: 160,
      render: (value: string, row) => {
        const amount = Number(value || 0).toLocaleString('vi-VN');
        const sign = row.transaction_type === 'INCOME' ? '+' : '-';
        const color = row.transaction_type === 'INCOME' ? '#389e0d' : '#cf1322';
        return <span style={{ fontWeight: 600, color }}>{`${sign}${amount} đ`}</span>;
      },
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 170,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          {canManage && (
            <>
              <Button
                size="small"
                onClick={() => {
                  setEditingTransaction(row);
                  transactionForm.setFieldsValue({
                    transaction_type: row.transaction_type,
                    source_type: row.source_type,
                    source_cash_account: row.source_cash_account,
                    source_bank_account: row.source_bank_account,
                    target_cash_account: row.target_cash_account,
                    category: row.category,
                    transaction_date: row.transaction_date,
                    amount: Number(row.amount),
                    object_name: row.object_name || '',
                    reason: row.reason || '',
                    note: row.note || '',
                  });
                  setOpenTransactionModal(true);
                }}
              >
                Sửa
              </Button>
              <Button
                size="small"
                danger
                onClick={() =>
                  Modal.confirm({
                    title: 'Xóa giao dịch?',
                    content: 'Chỉ dùng khi nhập sai dữ liệu.',
                    okText: 'Xóa',
                    cancelText: 'Hủy',
                    onOk: () => deleteTransactionMutation.mutateAsync(row.id),
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

  const accountColumns: ColumnsType<CashAccount> = [
    { title: 'Tên tài khoản', dataIndex: 'name' },
    {
      title: 'Loại',
      dataIndex: 'account_type',
      width: 120,
      render: (value: CashAccountType) => (value === 'CASH' ? 'Tiền mặt' : 'Quỹ'),
    },
    {
      title: 'Số dư mở sổ',
      dataIndex: 'balance',
      width: 160,
      align: 'right',
      render: (value: string) => `${Number(value || 0).toLocaleString('vi-VN')} đ`,
    },
    {
      title: 'Số dư khả dụng',
      dataIndex: 'current_balance',
      width: 170,
      align: 'right',
      render: (value: string | undefined, row) => `${Number(value ?? row.balance ?? 0).toLocaleString('vi-VN')} đ`,
    },
    { title: 'Kích hoạt', dataIndex: 'is_active', width: 100, render: (v: boolean) => (v ? 'Có' : 'Không') },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 170,
      render: (_, row) => (
        <Space>
          {canManage && (
            <>
              <Button
                size="small"
                onClick={() => {
                  setEditingAccount(row);
                  accountForm.setFieldsValue({
                    name: row.name,
                    account_type: row.account_type,
                    balance: Number(row.balance),
                    note: row.note || '',
                    is_active: row.is_active,
                  });
                  setOpenAccountModal(true);
                }}
              >
                Sửa
              </Button>
              <Button
                size="small"
                danger
                onClick={() =>
                  Modal.confirm({
                    title: `Xóa tài khoản quỹ "${row.name}"?`,
                    okText: 'Xóa',
                    cancelText: 'Hủy',
                    onOk: () => deleteAccountMutation.mutateAsync(row.id),
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

  const submitNewCashAccount = async () => {
    const values = await accountForm.validateFields();
    const payload = {
      name: values.name.trim(),
      account_type: values.account_type,
      note: values.note || '',
      is_active: values.is_active,
    };
    if (editingAccount) {
      await updateAccountMutation.mutateAsync({ id: editingAccount.id, payload });
    } else {
      await createAccountMutation.mutateAsync({
        ...payload,
        balance: String(values.balance ?? 0),
      });
    }
    setOpenAccountModal(false);
  };

  const submitNewTransaction = async () => {
    const values = await transactionForm.validateFields();
    const payload = {
      transaction_type: values.transaction_type,
      source_type: values.source_type,
      source_cash_account: values.source_cash_account,
      source_bank_account: values.source_bank_account,
      target_cash_account: values.target_cash_account,
      category: values.category,
      transaction_date: values.transaction_date,
      amount: String(values.amount ?? 0),
      object_name: values.object_name || '',
      reason: values.reason || '',
      note: values.note || '',
    };
    if (editingTransaction) {
      await updateTransactionMutation.mutateAsync({ id: editingTransaction.id, payload });
    } else {
      await createTransactionMutation.mutateAsync(payload);
    }
    setOpenTransactionModal(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Sổ quỹ</h2>
          <div style={{ color: '#8c8c8c' }}>Quản lý tài khoản quỹ và giao dịch thu chi</div>
        </div>
        <Space>
          {viewMode === 'transactions' ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canManage}
              onClick={() => {
                setEditingTransaction(null);
                transactionForm.setFieldsValue(emptyTransactionForm);
                setOpenTransactionModal(true);
              }}
            >
              Thêm giao dịch
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canManage}
              onClick={() => {
                setEditingAccount(null);
                accountForm.setFieldsValue(emptyAccountForm);
                setOpenAccountModal(true);
              }}
            >
              Thêm tài khoản quỹ
            </Button>
          )}
        </Space>
      </div>

      <Segmented
        options={[
          { label: 'Giao dịch', value: 'transactions' },
          { label: 'Tài khoản quỹ', value: 'accounts' },
        ]}
        value={viewMode}
        onChange={(value) => setViewMode(value as ViewMode)}
      />

      {viewMode === 'transactions' && (
        <>
          <div
            style={{
              border: '1px solid #f0f0f0',
              borderRadius: 10,
              padding: 12,
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <Input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm kiếm tất cả cột..."
              style={{ width: 320 }}
              suffix={
                searchInput ? (
                  <QuickClearIcon
                    onClear={() => {
                      setSearchInput('');
                      setPage(1);
                    }}
                    title="Xóa tìm kiếm"
                  />
                ) : undefined
              }
            />
            <Select
              value={filters.transaction_type || undefined}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, transaction_type: (value ?? '') as '' | CashTransactionType }));
                setPage(1);
              }}
              placeholder="Lọc theo loại"
              style={{ width: 180 }}
              options={[
                { value: 'INCOME', label: 'Thu' },
                { value: 'EXPENSE', label: 'Chi' },
                { value: 'TRANSFER', label: 'Chuyển' },
              ]}
              allowClear={false}
            />
            <Select
              value={filters.source_bank_account && Number.isFinite(filters.source_bank_account) ? filters.source_bank_account : undefined}
              onChange={(value) => {
                setFilters((prev) => ({ ...prev, source_bank_account: value != null ? value : '' }));
                setPage(1);
              }}
              placeholder="Ngân hàng (nguồn)"
              style={{ width: 200 }}
              allowClear
              options={bankAccounts.filter((b) => b.is_active).map((b) => ({ value: b.id, label: `${b.code} - ${b.bank_name}` }))}
            />
            <Button
              onClick={() => {
                setSearchInput('');
                setFilters({ transaction_type: '', source_bank_account: '' });
                setPage(1);
              }}
            >
              Xóa bộ lọc
            </Button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
              <div style={{ color: '#8c8c8c' }}>Tổng thu trang hiện tại</div>
              <div style={{ fontWeight: 700, color: '#389e0d', fontSize: 20 }}>{summary.totalIncome.toLocaleString('vi-VN')} đ</div>
            </div>
            <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
              <div style={{ color: '#8c8c8c' }}>Tổng chi trang hiện tại</div>
              <div style={{ fontWeight: 700, color: '#cf1322', fontSize: 20 }}>{summary.totalExpense.toLocaleString('vi-VN')} đ</div>
            </div>
            <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
              <div style={{ color: '#8c8c8c' }}>Chênh lệch trang hiện tại</div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{summary.delta.toLocaleString('vi-VN')} đ</div>
            </div>
          </div>

          {transactions.length === 0 && !transactionsQuery.isLoading ? (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: '#8c8c8c' }}>
              {intentSearch || (intentFilters.transaction_type || intentFilters.source_bank_account) ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy giao dịch phù hợp.</div>
                  <Button
                    type="link"
                    onClick={() => {
                      setSearchInput('');
                      setFilters({ transaction_type: '', source_bank_account: '' });
                      setPage(1);
                    }}
                  >
                    Xóa bộ lọc
                  </Button>
                </div>
              ) : (
                <div>Chưa có giao dịch. Nhấn <strong>Thêm giao dịch</strong> để thêm mới.</div>
              )}
            </div>
          ) : (
            <Table
              rowKey="id"
              loading={transactionsQuery.isLoading}
              columns={transactionColumns}
              dataSource={transactions}
              scroll={{ x: 1250 }}
              pagination={{
                current: page,
                pageSize,
                total: transactionTotal,
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
          )}
        </>
      )}

      {viewMode === 'accounts' && (
        <Table rowKey="id" loading={accountsQuery.isLoading} columns={accountColumns} dataSource={cashAccounts} />
      )}

      <Modal
        title={editingAccount ? 'Sửa tài khoản quỹ' : 'Thêm tài khoản quỹ'}
        open={openAccountModal}
        onCancel={() => {
          setOpenAccountModal(false);
          setEditingAccount(null);
        }}
        onOk={submitNewCashAccount}
        confirmLoading={createAccountMutation.isPending || updateAccountMutation.isPending}
      >
        <Form layout="vertical" form={accountForm}>
          <Form.Item name="name" label="Tên tài khoản" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="account_type" label="Loại tài khoản" initialValue="CASH">
            <Select
              options={[
                { value: 'CASH', label: 'Tiền mặt' },
                { value: 'FUND', label: 'Quỹ' },
              ]}
            />
          </Form.Item>
          {!editingAccount ? (
            <Form.Item name="balance" label="Số dư mở sổ" initialValue={0}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          ) : null}
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked" initialValue>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingTransaction ? 'Sửa giao dịch' : 'Thêm giao dịch'}
        open={openTransactionModal}
        onCancel={() => {
          setOpenTransactionModal(false);
          setEditingTransaction(null);
        }}
        onOk={submitNewTransaction}
        confirmLoading={createTransactionMutation.isPending || updateTransactionMutation.isPending}
        width={760}
      >
        <Form layout="vertical" form={transactionForm}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="transaction_type" label="Loại giao dịch" initialValue="EXPENSE">
              <Select
                options={[
                  { value: 'INCOME', label: 'Thu' },
                  { value: 'EXPENSE', label: 'Chi' },
                  { value: 'TRANSFER', label: 'Chuyển' },
                ]}
              />
            </Form.Item>
            <Form.Item name="transaction_date" label="Ngày giao dịch" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="source_type" label="Nguồn tiền" initialValue="CASH">
              <Select
                options={[
                  { value: 'CASH', label: 'Tiền mặt / Quỹ' },
                  { value: 'BANK', label: 'Ngân hàng' },
                ]}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate>
              {() => {
                const sourceType = transactionForm.getFieldValue('source_type') as CashTransactionSourceType;
                if (sourceType === 'BANK') {
                  return (
                    <Form.Item
                      name="source_bank_account"
                      label="Tài khoản ngân hàng nguồn"
                      rules={[{ required: true, message: 'Bắt buộc' }]}
                    >
                      <Select
                        options={bankAccounts.map((item) => ({
                          value: item.id,
                          label: `${item.code} - ${item.account_number}`,
                        }))}
                      />
                    </Form.Item>
                  );
                }
                return (
                  <Form.Item
                    name="source_cash_account"
                    label="Tài khoản quỹ nguồn"
                    rules={[{ required: true, message: 'Bắt buộc' }]}
                  >
                    <Select
                      options={activeCashAccounts.map((item) => ({
                        value: item.id,
                        label: `${item.name} (${Number(item.current_balance ?? item.balance).toLocaleString('vi-VN')} đ)`,
                      }))}
                    />
                  </Form.Item>
                );
              }}
            </Form.Item>
            <Form.Item noStyle shouldUpdate>
              {() => {
                const type = transactionForm.getFieldValue('transaction_type') as CashTransactionType;
                if (type !== 'TRANSFER') return null;
                return (
                  <Form.Item name="target_cash_account" label="Tài khoản đích" rules={[{ required: true, message: 'Bắt buộc' }]}>
                    <Select
                      options={activeCashAccounts.map((item) => ({
                        value: item.id,
                        label: `${item.name} (${Number(item.current_balance ?? item.balance).toLocaleString('vi-VN')} đ)`,
                      }))}
                    />
                  </Form.Item>
                );
              }}
            </Form.Item>
            <Form.Item name="category" label="Danh mục">
              <Select
                options={categories.map((item) => ({
                  value: item.id,
                  label: `${item.code} - ${item.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="amount" label="Số tiền" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="object_name" label="Đối tượng">
              <Input />
            </Form.Item>
            <Form.Item name="reason" label="Lý do">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

