import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CalculatorOutlined, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../api/finance';
import { workforceApi } from '../../api/workforce';
import type { PayrollRecord, PayrollStatus, WorkforceMonthCloseCheckResponse } from '../../types/workforce';
import type { BankAccount, CashAccount } from '../../types/finance';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { canManageWorkforceData } from '../../utils/authz';

type PayrollFilters = {
  month: string;
};

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

function serializeFilters(filters: PayrollFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): PayrollFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<PayrollFilters>;
    return { month: typeof parsed.month === 'string' && parsed.month ? parsed.month : currentMonth };
  } catch {
    return { month: currentMonth };
  }
}

function statusTag(status: PayrollStatus) {
  if (status === 'LOCKED') return <Tag color="green">Đã khóa</Tag>;
  return <Tag color="orange">Chưa khóa</Tag>;
}

function renderMonthCloseCheck(check: WorkforceMonthCloseCheckResponse) {
  const renderDetailItems = (items: Array<Record<string, unknown>>) => {
    if (!items.length) return null;
    return (
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.slice(0, 5).map((entry, index) => (
          <div key={index} style={{ fontSize: 12, color: '#595959', padding: 8, borderRadius: 6, background: '#ffffff' }}>
            {Object.entries(entry).map(([key, value]) => `${key}: ${String(value ?? '-')}`).join(' | ')}
          </div>
        ))}
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {check.blockers.length > 0 ? (
        <div>
          <div style={{ fontWeight: 700, color: '#cf1322', marginBottom: 8 }}>Điểm chặn phải xử lý trước</div>
          {check.blockers.map((item) => (
            <div key={item.code} style={{ marginBottom: 8, padding: 10, border: '1px solid #ffccc7', borderRadius: 8, background: '#fff2f0' }}>
              <div style={{ fontWeight: 600 }}>{item.title}{item.count > 0 ? ` (${item.count})` : ''}</div>
              <div style={{ color: '#595959' }}>{item.message}</div>
              {renderDetailItems(item.items)}
            </div>
          ))}
        </div>
      ) : null}
      {check.warnings.length > 0 ? (
        <div>
          <div style={{ fontWeight: 700, color: '#d48806', marginBottom: 8 }}>Cảnh báo nên rà soát</div>
          {check.warnings.map((item) => (
            <div key={item.code} style={{ marginBottom: 8, padding: 10, border: '1px solid #ffe58f', borderRadius: 8, background: '#fffbe6' }}>
              <div style={{ fontWeight: 600 }}>{item.title}{item.count > 0 ? ` (${item.count})` : ''}</div>
              <div style={{ color: '#595959' }}>{item.message}</div>
              {renderDetailItems(item.items)}
            </div>
          ))}
        </div>
      ) : null}
      {check.blockers.length === 0 && check.warnings.length === 0 ? (
        <div style={{ padding: 10, border: '1px solid #b7eb8f', borderRadius: 8, background: '#f6ffed', color: '#389e0d' }}>
          Tháng này đã đạt điều kiện đóng kỳ.
        </div>
      ) : null}
    </div>
  );
}

export default function PayrollList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<PayrollFilters>({ month: currentMonth });
  const [page, setPage] = useState(1);
  const [viewingDetail, setViewingDetail] = useState<PayrollRecord | null>(null);
  const [overwriteUnlocked, setOverwriteUnlocked] = useState(true);
  const [lockingRecord, setLockingRecord] = useState<PayrollRecord | null>(null);
  const [lockForm] = Form.useForm<{
    source_type: 'CASH' | 'BANK';
    source_cash_account: number | null;
    source_bank_account: number | null;
    save_as_default: boolean;
  }>();
  const { config, saveConfig } = useUserPreferences('workforce-payroll-list');
  const canManage = canManageWorkforceData();

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
    const p: Record<string, unknown> = { page, page_size: pageSize, ordering: 'employee__code' };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.month) p.month = intentFilters.month;
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const lockedMonthsQuery = useQuery({
    queryKey: ['workforce-payroll-locked-months'],
    queryFn: () => workforceApi.getPayrollLockedMonths(),
    enabled: canManage,
  });
  const payrollPostingDefaultsQuery = useQuery({
    queryKey: ['workforce-payroll-posting-defaults'],
    queryFn: () => workforceApi.getPayrollPostingDefaults(),
    enabled: canManage,
  });
  const cashAccountsQuery = useQuery({
    queryKey: ['finance-cash-accounts-all'],
    queryFn: () => financeApi.getCashAccounts({ page: 1, page_size: 300, ordering: 'name', is_active: 'true' }),
    enabled: canManage,
  });
  const bankAccountsQuery = useQuery({
    queryKey: ['finance-bank-accounts-all'],
    queryFn: () => financeApi.getBankAccounts({ page: 1, page_size: 300, ordering: 'code', is_active: 'true' }),
    enabled: canManage,
  });

  const listQuery = useQuery({
    queryKey: ['workforce-payroll', params],
    queryFn: () => workforceApi.getPayrollRecords(params),
  });

  const calculateMutation = useMutation({
    mutationFn: ({ month, overwrite }: { month: string; overwrite: boolean }) => workforceApi.calculatePayrollMonth(month, overwrite),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-payroll'] });
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      messageApi.success(`Đã tính lương tháng ${data.month} cho ${data.count} nhân viên`);
    },
  });

  const lockMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: {
        source_type: 'CASH' | 'BANK';
        source_cash_account: number | null;
        source_bank_account: number | null;
        save_as_default: boolean;
      };
    }) => workforceApi.lockPayroll(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-payroll'] });
      await queryClient.invalidateQueries({ queryKey: ['workforce-payroll-posting-defaults'] });
      messageApi.success('Đã khóa bản ghi lương');
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (id: number) => workforceApi.unlockPayroll(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-payroll'] });
      messageApi.success('Đã mở khóa bản ghi lương');
    },
  });

  const lockMonthMutation = useMutation({
    mutationFn: (month: string) => workforceApi.lockPayrollMonth(month),
    onSuccess: async () => {
      await lockedMonthsQuery.refetch();
      messageApi.success('Đã khóa kỳ lương tháng');
    },
  });

  const unlockMonthMutation = useMutation({
    mutationFn: (month: string) => workforceApi.unlockPayrollMonth(month),
    onSuccess: async () => {
      await lockedMonthsQuery.refetch();
      messageApi.success('Đã mở khóa kỳ lương tháng');
    },
  });

  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const total = listQuery.data?.count ?? 0;
  const isMonthLocked = (lockedMonthsQuery.data?.months ?? []).includes(filters.month);
  const cashAccounts: CashAccount[] = cashAccountsQuery.data?.results ?? [];
  const bankAccounts: BankAccount[] = bankAccountsQuery.data?.results ?? [];
  const lockSourceType = Form.useWatch('source_type', lockForm) ?? 'CASH';

  useEffect(() => {
    if (!lockingRecord) return;
    const defaults = payrollPostingDefaultsQuery.data;
    lockForm.setFieldsValue({
      source_type: defaults?.source_type ?? 'CASH',
      source_cash_account: defaults?.source_cash_account ?? null,
      source_bank_account: defaults?.source_bank_account ?? null,
      save_as_default: false,
    });
  }, [lockingRecord, payrollPostingDefaultsQuery.data, lockForm]);

  const handleLockMonth = async () => {
    try {
      const check = await workforceApi.getPayrollMonthCloseCheck(filters.month);
      if (check.blockers.length > 0) {
        Modal.error({
          title: `Chưa thể khóa kỳ lương tháng ${filters.month}`,
          width: 720,
          content: renderMonthCloseCheck(check),
        });
        return;
      }
      Modal.confirm({
        title: `Khóa kỳ lương tháng ${filters.month}?`,
        width: 720,
        content: renderMonthCloseCheck(check),
        okText: 'Khóa kỳ tháng',
        cancelText: 'Hủy',
        onOk: async () => {
          await lockMonthMutation.mutateAsync(filters.month);
          await lockedMonthsQuery.refetch();
        },
      });
    } catch {
      messageApi.error('Không thể kiểm tra điều kiện khóa kỳ lương');
    }
  };

  const summary = useMemo(() => {
    const totalIncome = rows.reduce((acc, item) => acc + Number(item.total_income), 0);
    const totalDeductions = rows.reduce((acc, item) => acc + Number(item.total_deductions), 0);
    const totalNetPay = rows.reduce((acc, item) => acc + Number(item.net_pay), 0);
    return { count: rows.length, totalIncome, totalDeductions, totalNetPay };
  }, [rows]);

  const columns: ColumnsType<PayrollRecord> = [
    { title: 'Mã NV', dataIndex: 'employee_code', width: 100 },
    { title: 'Tên NV', dataIndex: 'employee_name', width: 220 },
    {
      title: 'Ngày công',
      width: 110,
      align: 'center',
      render: (_, row) => `${Number(row.actual_days)}/${Number(row.standard_days)}`,
    },
    {
      title: 'Tổng thu',
      dataIndex: 'total_income',
      width: 140,
      align: 'right',
      render: (value: string) => `${Number(value).toLocaleString('vi-VN')} đ`,
    },
    {
      title: 'Tổng trừ',
      dataIndex: 'total_deductions',
      width: 140,
      align: 'right',
      render: (value: string) => `${Number(value).toLocaleString('vi-VN')} đ`,
    },
    {
      title: 'Thực lãnh',
      dataIndex: 'net_pay',
      width: 150,
      align: 'right',
      render: (value: string) => <span style={{ fontWeight: 700 }}>{Number(value).toLocaleString('vi-VN')} đ</span>,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 110,
      render: (status: PayrollStatus) => statusTag(status),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 230,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setViewingDetail(row)}>
            Chi tiết
          </Button>
          {canManage && (row.status === 'LOCKED' ? (
            <Button size="small" icon={<UnlockOutlined />} onClick={() => unlockMutation.mutate(row.id)}>
              Mở khóa
            </Button>
          ) : (
            <Button size="small" icon={<LockOutlined />} onClick={() => setLockingRecord(row)}>
              Khóa
            </Button>
          ))}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Bảng lương</h2>
          <div style={{ color: '#8c8c8c' }}>Tính lương theo tháng từ chấm công, thưởng/phạt và ứng lương</div>
        </div>
        <Space>
          <Button
            type="primary"
            icon={<CalculatorOutlined />}
            disabled={!canManage}
            loading={calculateMutation.isPending}
            onClick={() => {
              Modal.confirm({
                title: `Tính lại lương tháng ${filters.month}?`,
                content: overwriteUnlocked
                  ? 'Hệ thống sẽ ghi đè các bản ghi chưa khóa trong tháng.'
                  : 'Hệ thống sẽ chỉ bổ sung bản ghi còn thiếu, không ghi đè bản ghi chưa khóa.',
                okText: 'Tính lương',
                cancelText: 'Hủy',
                onOk: () => calculateMutation.mutate({ month: filters.month, overwrite: overwriteUnlocked }),
              });
            }}
          >
            Tính lương
          </Button>
          <Button
            disabled={!canManage || isMonthLocked}
            loading={lockMonthMutation.isPending}
            onClick={() => void handleLockMonth()}
          >
            Khóa kỳ tháng
          </Button>
          <Button
            disabled={!canManage || !isMonthLocked}
            loading={unlockMonthMutation.isPending}
            onClick={() => {
              Modal.confirm({
                title: `Mở khóa kỳ lương tháng ${filters.month}?`,
                content: 'Nếu tháng đã khóa lương và có bút toán chi lương tự động, hệ thống sẽ cho phép mở khóa để chỉnh và đồng bộ lại.',
                okText: 'Mở khóa kỳ',
                cancelText: 'Hủy',
                onOk: () => unlockMonthMutation.mutateAsync(filters.month),
              });
            }}
          >
            Mở khóa kỳ
          </Button>
        </Space>
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
        <Input
          type="month"
          value={filters.month}
          onChange={(e) => {
            setFilters({ month: e.target.value || currentMonth });
            setPage(1);
          }}
          style={{ width: 180 }}
        />
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({ month: currentMonth });
            setPage(1);
          }}
        >
          Xóa bộ lọc
        </Button>
        <Space>
          <span style={{ color: '#8c8c8c' }}>Ghi đè bản ghi chưa khóa</span>
          <Switch checked={overwriteUnlocked} onChange={setOverwriteUnlocked} />
        </Space>
        {canManage ? (
          isMonthLocked ? <Tag color="red">Tháng đang khóa kỳ</Tag> : <Tag color="green">Tháng đang mở</Tag>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Số nhân viên trang hiện tại</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{summary.count}</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Tổng thu trang hiện tại</div>
          <div style={{ fontWeight: 700, color: '#389e0d', fontSize: 20 }}>{summary.totalIncome.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Tổng trừ trang hiện tại</div>
          <div style={{ fontWeight: 700, color: '#cf1322', fontSize: 20 }}>{summary.totalDeductions.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Thực lãnh trang hiện tại</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{summary.totalNetPay.toLocaleString('vi-VN')} đ</div>
        </div>
      </div>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1300 }}
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
        title={lockingRecord ? `Chọn nguồn chi lương: ${lockingRecord.employee_name}` : 'Chọn nguồn chi lương'}
        open={lockingRecord != null}
        onCancel={() => setLockingRecord(null)}
        okText="Khóa và hạch toán"
        cancelText="Hủy"
        confirmLoading={lockMutation.isPending}
        onOk={async () => {
          if (!lockingRecord) return;
          const values = await lockForm.validateFields();
          await lockMutation.mutateAsync({
            id: lockingRecord.id,
            payload: {
              source_type: values.source_type,
              source_cash_account: values.source_cash_account,
              source_bank_account: values.source_bank_account,
              save_as_default: values.save_as_default,
            },
          });
          setLockingRecord(null);
        }}
      >
        <Form form={lockForm} layout="vertical">
          <Form.Item name="source_type" label="Nguồn tiền" rules={[{ required: true, message: 'Chọn nguồn tiền' }]}>
            <Select
              options={[
                { value: 'CASH', label: 'Tiền mặt / Quỹ' },
                { value: 'BANK', label: 'Ngân hàng' },
              ]}
            />
          </Form.Item>
          {lockSourceType === 'CASH' ? (
            <Form.Item name="source_cash_account" label="Tài khoản quỹ" rules={[{ required: true, message: 'Chọn quỹ nguồn' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={cashAccounts.map((item) => ({
                  value: item.id,
                  label: `${item.name} | khả dụng ${Number(item.current_balance ?? item.balance ?? 0).toLocaleString('vi-VN')} đ`,
                }))}
              />
            </Form.Item>
          ) : (
            <Form.Item name="source_bank_account" label="Tài khoản ngân hàng" rules={[{ required: true, message: 'Chọn tài khoản ngân hàng' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={bankAccounts.map((item) => ({
                  value: item.id,
                  label: `${item.code} - ${item.account_name}`,
                }))}
              />
            </Form.Item>
          )}
          <Form.Item name="save_as_default" valuePropName="checked">
            <Switch checkedChildren="Lưu mặc định" unCheckedChildren="Không lưu" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={viewingDetail ? `Chi tiết lương ${viewingDetail.employee_name}` : 'Chi tiết lương'}
        open={viewingDetail != null}
        onCancel={() => setViewingDetail(null)}
        footer={null}
      >
        {viewingDetail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><strong>Mã NV:</strong> {viewingDetail.employee_code}</div>
              <div><strong>Tháng:</strong> {viewingDetail.month}</div>
              <div><strong>Phòng ban:</strong> {viewingDetail.employee_department || '-'}</div>
              <div><strong>Chức vụ:</strong> {viewingDetail.employee_position || '-'}</div>
              <div><strong>Mốc hiệu lực lương:</strong> {viewingDetail.profile_effective_month || '-'}</div>
            </div>
            <div><strong>Lương cơ bản:</strong> {Number(viewingDetail.basic_salary).toLocaleString('vi-VN')} đ</div>
            <div><strong>Lương theo công:</strong> {Number(viewingDetail.salary_by_attendance).toLocaleString('vi-VN')} đ</div>
            <div><strong>Tăng ca:</strong> {Number(viewingDetail.overtime_pay).toLocaleString('vi-VN')} đ</div>
            <div><strong>Thưởng:</strong> {Number(viewingDetail.total_bonus).toLocaleString('vi-VN')} đ</div>
            <div><strong>Phạt:</strong> {Number(viewingDetail.total_penalty).toLocaleString('vi-VN')} đ</div>
            <div><strong>Tạm ứng:</strong> {Number(viewingDetail.advance_deduction).toLocaleString('vi-VN')} đ</div>
            <div><strong>Tổng thu:</strong> {Number(viewingDetail.total_income).toLocaleString('vi-VN')} đ</div>
            <div><strong>Tổng trừ:</strong> {Number(viewingDetail.total_deductions).toLocaleString('vi-VN')} đ</div>
            <div style={{ fontSize: 18 }}><strong>Thực lãnh:</strong> {Number(viewingDetail.net_pay).toLocaleString('vi-VN')} đ</div>
          </div>
        )}
      </Modal>
    </div>
  );
}

