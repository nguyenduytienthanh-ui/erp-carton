import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { customersApi } from '../../api/customers';
import { financeApi } from '../../api/finance';
import type { Customer } from '../../types/customer';
import type { CashAccount, BankAccount, ReceivableDocument, ReceivableSettlement } from '../../types/finance';
import { PAGES } from '../../utils/constants';
import { canManageFinanceData } from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';


type Filters = {
  status?: string;
  customer?: number;
  overdueOnly: boolean;
};


function serializeFilters(filters: Filters): string {
  return JSON.stringify(filters);
}


function parseFilters(raw: string): Filters {
  try {
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return {
      status: parsed.status,
      customer: parsed.customer,
      overdueOnly: parsed.overdueOnly === true,
    };
  } catch {
    return { overdueOnly: false };
  }
}


function formatMoney(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0';
}


export default function AccountsReceivableList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManageFinanceData();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({ overdueOnly: false });
  const [page, setPage] = useState(1);
  const [drawerDoc, setDrawerDoc] = useState<ReceivableDocument | null>(null);
  const [collectDoc, setCollectDoc] = useState<ReceivableDocument | null>(null);
  const [cancelDoc, setCancelDoc] = useState<ReceivableDocument | null>(null);
  const [collectForm] = Form.useForm<{
    settlement_date: string;
    amount: number;
    source_type: 'CASH' | 'BANK';
    source_cash_account?: number | null;
    source_bank_account?: number | null;
    note?: string;
  }>();
  const [reasonForm] = Form.useForm<{ reason: string }>();
  const sourceType = Form.useWatch('source_type', collectForm);
  const { config, saveConfig } = useUserPreferences(PAGES.FINANCE_RECEIVABLES);
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
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: 'due_date' };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.customer) next.customer = intentFilters.customer;
    if (intentFilters.overdueOnly) next.overdue_only = 'true';
    return next;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['finance-receivables', params],
    queryFn: () => financeApi.getReceivables(params),
  });
  const summaryQuery = useQuery({
    queryKey: ['finance-receivables-summary', params],
    queryFn: () => financeApi.getReceivableSummary(params),
  });
  const customersQuery = useQuery({
    queryKey: ['finance-receivable-customers'],
    queryFn: () => customersApi.getCustomers({ page_size: 200, ordering: 'code' }),
  });
  const detailQuery = useQuery({
    queryKey: ['finance-receivable-detail', drawerDoc?.id],
    queryFn: () => financeApi.getReceivable(drawerDoc!.id),
    enabled: !!drawerDoc,
  });
  const cashAccountsQuery = useQuery({
    queryKey: ['finance-receivable-cash-accounts'],
    queryFn: () => financeApi.getCashAccounts({ page_size: 200, is_active: 'true' }),
  });
  const bankAccountsQuery = useQuery({
    queryKey: ['finance-receivable-bank-accounts'],
    queryFn: () => financeApi.getBankAccounts({ page_size: 200, is_active: 'true' }),
  });

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['finance-receivables'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-receivables-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-cash-book'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-cash-transactions'] }),
    ]);
  };

  const collectMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof financeApi.collectReceivable>[1] }) =>
      financeApi.collectReceivable(id, payload),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã ghi nhận thu tiền');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => financeApi.cancelReceivable(id, reason),
    onSuccess: async () => {
      await invalidateAll();
      messageApi.success('Đã hủy chứng từ phải thu');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = listQuery.data?.results ?? [];
  const summary = summaryQuery.data;
  const customers: Customer[] = customersQuery.data?.results ?? [];
  const detail = detailQuery.data ?? drawerDoc;
  const cashAccounts: CashAccount[] = cashAccountsQuery.data?.results ?? [];
  const bankAccounts: BankAccount[] = bankAccountsQuery.data?.results ?? [];

  const columns: ColumnsType<ReceivableDocument> = [
    { title: 'Mã PT', dataIndex: 'code', width: 130 },
    { title: 'Đơn bán', dataIndex: 'source_sales_order_code', width: 130, render: (value) => value || '-' },
    { title: 'Khách hàng', dataIndex: 'customer_name', width: 220, render: (value) => value || '-' },
    { title: 'Ngày ghi nhận', dataIndex: 'document_date', width: 120, render: (value) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Đến hạn', dataIndex: 'due_date', width: 120, render: (value) => dayjs(value).format('DD/MM/YYYY') },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (value) => (
        <Tag color={value === 'OPEN' ? 'warning' : value === 'PARTIAL' ? 'processing' : value === 'SETTLED' ? 'success' : 'default'}>
          {value === 'OPEN' ? 'Chưa thu' : value === 'PARTIAL' ? 'Thu một phần' : value === 'SETTLED' ? 'Đã thu đủ' : 'Đã hủy'}
        </Tag>
      ),
    },
    { title: 'Tổng phải thu', dataIndex: 'total_amount', width: 140, render: (value) => formatMoney(value) },
    { title: 'Đã thu', dataIndex: 'settled_amount', width: 140, render: (value) => formatMoney(value) },
    { title: 'Còn lại', dataIndex: 'remaining_amount', width: 140, render: (value) => formatMoney(value) },
    { title: 'Quá hạn (ngày)', dataIndex: 'days_overdue', width: 120 },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 220,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => setDrawerDoc(row)}>
            Xem
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={!canManage || !['OPEN', 'PARTIAL'].includes(row.status)}
            onClick={() => {
              setCollectDoc(row);
              collectForm.setFieldsValue({
                settlement_date: dayjs().format('YYYY-MM-DD'),
                amount: Number(row.remaining_amount || 0),
                source_type: 'CASH',
                source_cash_account: cashAccounts[0]?.id ?? null,
                source_bank_account: null,
                note: '',
              });
            }}
          >
            Thu tiền
          </Button>
          <Button
            size="small"
            danger
            disabled={!canManage || row.status !== 'OPEN'}
            onClick={() => {
              setCancelDoc(row);
              reasonForm.setFieldValue('reason', '');
            }}
          >
            Hủy
          </Button>
        </Space>
      ),
    },
  ];

  const settlementColumns: ColumnsType<ReceivableSettlement> = [
    { title: 'Ngày thu', dataIndex: 'settlement_date', width: 120, render: (value) => dayjs(value).format('DD/MM/YYYY') },
    { title: 'Số tiền', dataIndex: 'amount', width: 140, render: (value) => formatMoney(value) },
    { title: 'Nguồn', dataIndex: 'source_type', width: 100, render: (value) => (value === 'BANK' ? 'Ngân hàng' : 'Quỹ') },
    { title: 'Quỹ/NH', key: 'account', width: 180, render: (_, row) => row.source_cash_account_name || row.source_bank_account_code || '-' },
    { title: 'Ghi chú', dataIndex: 'note', width: 240, render: (value) => value || '-' },
  ];

  const handleCollectSubmit = async () => {
    const values = await collectForm.validateFields();
    const doc = collectDoc;
    if (!doc) return;
    await collectMutation.mutateAsync({
      id: doc.id,
      payload: {
        settlement_date: values.settlement_date,
        amount: String(values.amount),
        source_type: values.source_type,
        source_cash_account: values.source_type === 'CASH' ? values.source_cash_account ?? null : null,
        source_bank_account: values.source_type === 'BANK' ? values.source_bank_account ?? null : null,
        note: values.note?.trim() || '',
      },
    });
    setCollectDoc(null);
  };

  const handleCancelSubmit = async () => {
    const values = await reasonForm.validateFields();
    const doc = cancelDoc;
    if (!doc) return;
    await cancelMutation.mutateAsync({ id: doc.id, reason: values.reason.trim() });
    setCancelDoc(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div>
        <h2 style={{ margin: 0 }}>Công nợ phải thu</h2>
        <div style={{ color: '#8c8c8c' }}>Theo dõi chứng từ phải thu từ đơn bán và lịch sử thu tiền</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <Card size="small"><div style={{ color: '#8c8c8c' }}>Tổng phải thu</div><div style={{ fontSize: 24, fontWeight: 700 }}>{formatMoney(summary?.total_amount)}</div></Card>
        <Card size="small"><div style={{ color: '#8c8c8c' }}>Đã thu</div><div style={{ fontSize: 24, fontWeight: 700 }}>{formatMoney(summary?.settled_amount)}</div></Card>
        <Card size="small"><div style={{ color: '#8c8c8c' }}>Còn lại</div><div style={{ fontSize: 24, fontWeight: 700 }}>{formatMoney(summary?.remaining_amount)}</div></Card>
        <Card size="small"><div style={{ color: '#8c8c8c' }}>Quá hạn</div><div style={{ fontSize: 24, fontWeight: 700 }}>{formatMoney(summary?.overdue_amount)}</div></Card>
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
            { value: 'OPEN', label: 'Chưa thu' },
            { value: 'PARTIAL', label: 'Thu một phần' },
            { value: 'SETTLED', label: 'Đã thu đủ' },
            { value: 'CANCELLED', label: 'Đã hủy' },
          ]}
        />
        <Select
          showSearch
          optionFilterProp="label"
          value={filters.customer ?? ''}
          style={{ width: 260 }}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, customer: typeof value === 'number' ? value : undefined }));
            setPage(1);
          }}
          options={[
            { value: '', label: 'Tất cả khách hàng' },
            ...customers.map((item) => ({ value: item.id, label: `${item.code} - ${item.name}` })),
          ]}
        />
        <Space>
          <span style={{ color: '#595959' }}>Chỉ xem quá hạn</span>
          <Switch
            checked={filters.overdueOnly}
            onChange={(checked) => {
              setFilters((prev) => ({ ...prev, overdueOnly: checked }));
              setPage(1);
            }}
          />
        </Space>
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({ overdueOnly: false });
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
        scroll={{ x: 1700 }}
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
        locale={{
          emptyText: rows.length === 0 && !listQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {(intentSearch || filters.status || filters.customer || filters.overdueOnly) ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy công nợ phù hợp.</div>
                  <Button
                    type="link"
                    onClick={() => {
                      setSearchInput('');
                      setFilters({ overdueOnly: false });
                      setPage(1);
                    }}
                  >
                    Xóa bộ lọc
                  </Button>
                </div>
              ) : 'Chưa có công nợ phải thu.'}
            </div>
          ) : undefined,
        }}
      />

      <Modal
        title={collectDoc ? `Thu tiền ${collectDoc.code}` : 'Thu tiền'}
        open={!!collectDoc}
        onCancel={() => setCollectDoc(null)}
        onOk={() => void handleCollectSubmit()}
        confirmLoading={collectMutation.isPending}
      >
        <Form form={collectForm} layout="vertical">
          <Form.Item name="settlement_date" label="Ngày thu" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="amount" label="Số tiền thu" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <InputNumber min={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="source_type" label="Nguồn tiền" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Select options={[{ value: 'CASH', label: 'Quỹ tiền mặt' }, { value: 'BANK', label: 'Ngân hàng' }]} />
          </Form.Item>
          {sourceType === 'BANK' ? (
            <Form.Item name="source_bank_account" label="Tài khoản ngân hàng" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={bankAccounts.map((item) => ({ value: item.id, label: `${item.code} - ${item.bank_name}` }))}
              />
            </Form.Item>
          ) : (
            <Form.Item name="source_cash_account" label="Quỹ tiền mặt" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={cashAccounts.map((item) => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
          )}
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={cancelDoc ? `Hủy ${cancelDoc.code}` : 'Hủy chứng từ'}
        open={!!cancelDoc}
        onCancel={() => setCancelDoc(null)}
        onOk={() => void handleCancelSubmit()}
        confirmLoading={cancelMutation.isPending}
      >
        <Form form={reasonForm} layout="vertical">
          <Form.Item name="reason" label="Lý do hủy" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `Chi tiết ${detail.code}` : 'Chi tiết phải thu'}
        width={920}
        open={!!drawerDoc}
        onClose={() => setDrawerDoc(null)}
      >
        {detail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Đơn bán">{detail.source_sales_order_code || '-'}</Descriptions.Item>
              <Descriptions.Item label="Khách hàng">{detail.customer_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Ngày ghi nhận">{dayjs(detail.document_date).format('DD/MM/YYYY')}</Descriptions.Item>
              <Descriptions.Item label="Ngày đến hạn">{dayjs(detail.due_date).format('DD/MM/YYYY')}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <Tag color={detail.status === 'OPEN' ? 'warning' : detail.status === 'PARTIAL' ? 'processing' : detail.status === 'SETTLED' ? 'success' : 'default'}>
                  {detail.status === 'OPEN' ? 'Chưa thu' : detail.status === 'PARTIAL' ? 'Thu một phần' : detail.status === 'SETTLED' ? 'Đã thu đủ' : 'Đã hủy'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Quá hạn">{`${detail.days_overdue} ngày`}</Descriptions.Item>
              <Descriptions.Item label="Tổng phải thu">{formatMoney(detail.total_amount)}</Descriptions.Item>
              <Descriptions.Item label="Đã thu">{formatMoney(detail.settled_amount)}</Descriptions.Item>
              <Descriptions.Item label="Còn lại">{formatMoney(detail.remaining_amount)}</Descriptions.Item>
              <Descriptions.Item label="Tham chiếu">{detail.reference || '-'}</Descriptions.Item>
              <Descriptions.Item label="Ghi chú" span={2}>{detail.note || '-'}</Descriptions.Item>
            </Descriptions>

            <div>
              <h3 style={{ marginBottom: 8 }}>Lịch sử thu tiền</h3>
              <Table
                rowKey="id"
                columns={settlementColumns}
                dataSource={detail.settlements}
                pagination={false}
                scroll={{ x: 900 }}
              />
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
