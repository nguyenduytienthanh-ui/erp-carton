import { useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../api/finance';
import { bankAccountsApi } from '../../api/finance';
import { PAGES } from '../../utils/constants';
import { canManageFinanceData } from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';

type Filters = {
  status?: string;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  POSTED: 'Đã post',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'success',
  POSTED: 'cyan',
};

interface BankRecon {
  id: number;
  code: string;
  statement_date: string;
  statement_balance: string;
  bank_account: number;
  bank_account_code?: string;
  bank_account_name?: string;
  book_balance: string;
  delta: string;
  status: string;
  reference: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export default function BankReconciliationList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [detailRecon, setDetailRecon] = useState<BankRecon | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editRecon, setEditRecon] = useState<BankRecon | null>(null);
  const { config, saveConfig } = useUserPreferences(PAGES.FINANCE_BANK_RECONCILIATION ?? 'finance-bank-recon');
  const pageSize = Number((config as Record<string, unknown>)?.pageSize ?? 20);
  const canManage = canManageFinanceData();

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (f) => JSON.stringify(f),
    parseFilters: (s) => {
      try {
        return JSON.parse(s);
      } catch {
        return {};
      }
    },
  });

  const params = {
    page,
    page_size: pageSize,
    q: intentSearch.trim() || undefined,
    status: intentFilters?.status || undefined,
  };

  const reconciliationsQuery = useQuery({
    queryKey: ['finance-bank-reconciliations', params],
    queryFn: () => financeApi.getBankReconciliations(params),
  });

  const detailQuery = useQuery({
    queryKey: ['finance-bank-reconciliation', detailRecon?.id],
    queryFn: () => financeApi.getBankReconciliation(detailRecon!.id),
    enabled: !!detailRecon?.id,
  });

  const bankAccountsQuery = useQuery({
    queryKey: ['bank-accounts-active'],
    queryFn: () => bankAccountsApi.getBankAccounts({ is_active: 'true', page_size: 1000 }),
  });

  const deleteMutation = useMutation({
    mutationFn: financeApi.deleteBankReconciliation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliations'] });
      messageApi.success('Đã xóa phiếu đối soát');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const approveMutation = useMutation({
    mutationFn: financeApi.approveBankReconciliation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliations'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliation'] });
      messageApi.success('Đã duyệt phiếu đối soát');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const postMutation = useMutation({
    mutationFn: financeApi.postBankReconciliation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliations'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliation'] });
      messageApi.success('Đã post phiếu đối soát');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = reconciliationsQuery.data?.results ?? [];

  const columns: ColumnsType<BankRecon> = [
    { title: 'Mã', dataIndex: 'code', width: 120, key: 'code' },
    { title: 'Ngày BĐS', dataIndex: 'statement_date', width: 120, key: 'statement_date' },
    { title: 'Tài khoản', dataIndex: 'bank_account_name', width: 150, key: 'bank_account' },
    {
      title: 'Số dư sao kê',
      dataIndex: 'statement_balance',
      width: 140,
      render: (val) => Number(val).toLocaleString('vi-VN'),
    },
    {
      title: 'Số dư sổ',
      dataIndex: 'book_balance',
      width: 140,
      render: (val) => Number(val).toLocaleString('vi-VN'),
    },
    {
      title: 'Chênh lệch',
      dataIndex: 'delta',
      width: 140,
      render: (val) => {
        const num = Number(val);
        return (
          <span style={{ color: num === 0 ? 'green' : 'red' }}>
            {num.toLocaleString('vi-VN')}
          </span>
        );
      },
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status] ?? 'default'}>{STATUS_LABELS[status] ?? status}</Tag>
      ),
    },
    {
      title: 'Thao tác',
      width: 280,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailRecon(row)}>
            Xem
          </Button>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            danger
            icon={<DeleteOutlined />}
            onClick={() =>
              Modal.confirm({
                title: 'Xóa phiếu đối soát',
                content: `Xóa ${row.code}?`,
                okText: 'Xóa',
                cancelText: 'Hủy',
                onOk: () => deleteMutation.mutate(row.id),
              })
            }
          />
          <Button
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            type="primary"
            onClick={() => approveMutation.mutate(row.id)}
          >
            Duyệt
          </Button>
          <Button
            size="small"
            disabled={!canManage || row.status !== 'APPROVED'}
            onClick={() => postMutation.mutate(row.id)}
          >
            Post
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Đối Soát Ngân Hàng</h2>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => {
            setEditRecon(null);
            setFormOpen(true);
          }}
        >
          Tạo phiếu đối soát
        </Button>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Tìm mã, tài khoản..."
          style={{ width: 250 }}
          suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
        />
        <Select
          style={{ width: 200 }}
          placeholder="Trạng thái"
          allowClear
          value={filters.status || undefined}
          onChange={(value) => {
            setFilters({ ...filters, status: value });
            setPage(1);
          }}
          options={Object.entries(STATUS_LABELS).map(([key, label]) => ({ value: key, label }))}
        />
      </div>

      <Table
        rowKey="id"
        loading={reconciliationsQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1500 }}
        pagination={{
          current: page,
          pageSize,
          total: reconciliationsQuery.data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50],
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              saveConfig({ ...config, pageSize: nextPageSize });
            }
          },
        }}
        locale={{
          emptyText: rows.length === 0 && !reconciliationsQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {(intentSearch || filters.status) ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy phiếu đối soát phù hợp.</div>
                  <Button
                    type="link"
                    onClick={() => {
                      setSearchInput('');
                      setFilters({});
                      setPage(1);
                    }}
                  >
                    Xóa bộ lọc
                  </Button>
                </div>
              ) : 'Chưa có phiếu đối soát.'}
            </div>
          ) : undefined,
        }}
      />

      {detailRecon && (
        <Modal
          title={`Chi tiết đối soát - ${detailRecon.code}`}
          open={!!detailRecon}
          onCancel={() => setDetailRecon(null)}
          width={800}
          footer={null}
        >
          {detailQuery.data && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <strong>Ngày BĐS:</strong> {detailQuery.data.statement_date}
              </div>
              <div>
                <strong>Tài khoản:</strong> {detailQuery.data.bank_account_name}
              </div>
              <div>
                <strong>Số dư sao kê:</strong> {Number(detailQuery.data.statement_balance).toLocaleString('vi-VN')}
              </div>
              <div>
                <strong>Số dư sổ:</strong> {Number(detailQuery.data.book_balance).toLocaleString('vi-VN')}
              </div>
              <div>
                <strong>Chênh lệch:</strong>{' '}
                <span style={{ color: Number(detailQuery.data.delta) === 0 ? 'green' : 'red' }}>
                  {Number(detailQuery.data.delta).toLocaleString('vi-VN')}
                </span>
              </div>
              <div>
                <strong>Trạng thái:</strong>{' '}
                <Tag color={STATUS_COLORS[detailQuery.data.status] ?? 'default'}>
                  {STATUS_LABELS[detailQuery.data.status] ?? detailQuery.data.status}
                </Tag>
              </div>
              {detailQuery.data.reference && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <strong>Tham chiếu:</strong> {detailQuery.data.reference}
                </div>
              )}
              {detailQuery.data.note && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <strong>Ghi chú:</strong> {detailQuery.data.note}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      <BankReconciliationFormModal
        open={formOpen}
        data={editRecon}
        onClose={() => {
          setFormOpen(false);
          setEditRecon(null);
        }}
        onSuccess={() => setPage(1)}
        bankAccounts={bankAccountsQuery.data?.results ?? []}
      />
    </>
  );
}

function BankReconciliationFormModal({
  open,
  data,
  onClose,
  onSuccess,
  bankAccounts,
}: {
  open: boolean;
  data?: BankRecon | null;
  onClose: () => void;
  onSuccess: () => void;
  bankAccounts: any[];
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => financeApi.createBankReconciliation(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliations'] });
      messageApi.success('Đã tạo phiếu đối soát');
      form.resetFields();
      onClose();
      onSuccess();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => financeApi.updateBankReconciliation(data!.id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-bank-reconciliations'] });
      messageApi.success('Đã cập nhật phiếu đối soát');
      form.resetFields();
      onClose();
      onSuccess();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        statement_date: values.statement_date,
        bank_account: values.bank_account,
        statement_balance: values.statement_balance,
        book_balance: values.book_balance,
        reference: values.reference,
        note: values.note,
      };

      if (data?.id) {
        updateMutation.mutate(payload);
      } else {
        createMutation.mutate(payload);
      }
    } catch {
      // validation error
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        title={data ? `Chỉnh sửa đối soát - ${data.code}` : 'Tạo phiếu đối soát mới'}
        open={open}
        onCancel={onClose}
        width={700}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        onOk={handleSubmit}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={
            data
              ? {
                  statement_date: data.statement_date,
                  bank_account: data.bank_account,
                  statement_balance: data.statement_balance,
                  book_balance: data.book_balance,
                  reference: data.reference,
                  note: data.note,
                }
              : {}
          }
        >
          <Form.Item label="Ngày BĐS" name="statement_date" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>

          <Form.Item label="Tài khoản ngân hàng" name="bank_account" rules={[{ required: true }]}>
            <Select
              placeholder="Chọn tài khoản"
              options={bankAccounts.map((b) => ({ value: b.id, label: `${b.code} - ${b.account_number}` }))}
            />
          </Form.Item>

          <Form.Item label="Số dư sao kê" name="statement_balance" rules={[{ required: true, type: 'number' }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.01} />
          </Form.Item>

          <Form.Item label="Số dư sổ" name="book_balance" rules={[{ required: true, type: 'number' }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.01} />
          </Form.Item>

          <Form.Item label="Tham chiếu" name="reference">
            <Input placeholder="Sao kê số..." />
          </Form.Item>

          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea rows={2} placeholder="Ghi chú thêm" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
