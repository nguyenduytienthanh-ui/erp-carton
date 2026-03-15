import { useMemo, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../api/finance';
import { workforceApi } from '../../api/workforce';
import type { BankAccount, CashAccount } from '../../types/finance';
import type { Employee, SalaryAdvanceRecord, SalaryAdvanceRecordPayload, SalaryAdvanceApprovalStatus, SalaryAdvanceStatus } from '../../types/workforce';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { canManageWorkforceData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

type SalaryAdvanceFilters = {
  month: string;
  status: '' | SalaryAdvanceStatus;
  approval_status: '' | SalaryAdvanceApprovalStatus;
};

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const currentDate = today.toISOString().slice(0, 10);

const STATUS_OPTIONS: Array<{ value: SalaryAdvanceStatus; label: string }> = [
  { value: 'UNDEDUCTED', label: 'Chưa trừ' },
  { value: 'DEDUCTED', label: 'Đã trừ' },
];
const APPROVAL_STATUS_OPTIONS: Array<{ value: SalaryAdvanceApprovalStatus; label: string }> = [
  { value: 'DRAFT', label: 'Nháp' },
  { value: 'PENDING_L1', label: 'Chờ duyệt L1' },
  { value: 'PENDING_L2', label: 'Chờ duyệt L2' },
  { value: 'APPROVED', label: 'Đã duyệt' },
  { value: 'REJECTED', label: 'Từ chối' },
];

function serializeFilters(filters: SalaryAdvanceFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): SalaryAdvanceFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<SalaryAdvanceFilters>;
    return {
      month: typeof parsed.month === 'string' && parsed.month ? parsed.month : currentMonth,
      status: parsed.status === 'UNDEDUCTED' || parsed.status === 'DEDUCTED' ? parsed.status : '',
      approval_status:
        parsed.approval_status === 'DRAFT' ||
        parsed.approval_status === 'PENDING_L1' ||
        parsed.approval_status === 'PENDING_L2' ||
        parsed.approval_status === 'APPROVED' ||
        parsed.approval_status === 'REJECTED'
          ? parsed.approval_status
          : '',
    };
  } catch {
    return { month: currentMonth, status: '', approval_status: '' };
  }
}

type SalaryAdvanceForm = {
  employee: number;
  advance_date: string;
  month: string;
  amount: number;
  reason: string;
  approved_by_name: string;
  note: string;
  is_active: boolean;
};

type DisbursementForm = {
  source_type: 'CASH' | 'BANK';
  source_cash_account: number | null;
  source_bank_account: number | null;
};

const emptyForm: SalaryAdvanceForm = {
  employee: 0,
  advance_date: currentDate,
  month: currentMonth,
  amount: 0,
  reason: 'Ứng lương',
  approved_by_name: '',
  note: '',
  is_active: true,
};

const emptyDisbursementForm: DisbursementForm = {
  source_type: 'CASH',
  source_cash_account: null,
  source_bank_account: null,
};

export default function SalaryAdvanceList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<SalaryAdvanceFilters>({ month: currentMonth, status: '', approval_status: '' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SalaryAdvanceRecord | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<SalaryAdvanceForm>();
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [rejectReason, setRejectReason] = useState('');
  const [rejectForm] = Form.useForm();
  const [disbursementModal, setDisbursementModal] = useState<{ open: boolean; row: SalaryAdvanceRecord | null }>({
    open: false,
    row: null,
  });
  const [disbursementForm] = Form.useForm<DisbursementForm>();
  const { config, saveConfig } = useUserPreferences('workforce-salary-advance-list');
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

  const employeesQuery = useQuery({
    queryKey: ['workforce-employees-select'],
    queryFn: () => workforceApi.getEmployees({ page: 1, page_size: 500, ordering: 'code', is_active: 'true' }),
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

  const params = useMemo(() => {
    const p: Record<string, unknown> = { page, page_size: pageSize, ordering: '-advance_date' };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.month) p.month = intentFilters.month;
    if (intentFilters.status) p.status = intentFilters.status;
    if (intentFilters.approval_status) p.approval_status = intentFilters.approval_status;
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['workforce-salary-advances', params],
    queryFn: () => workforceApi.getSalaryAdvances(params),
  });
  const approvalQueueQuery = useQuery({
    queryKey: ['workforce-salary-advances-approval-queue'],
    queryFn: () => workforceApi.getSalaryAdvanceApprovalQueue(),
    enabled: canManage,
  });
  const approvalSlaOverviewQuery = useQuery({
    queryKey: ['workforce-salary-advances-approval-sla-overview'],
    queryFn: () => workforceApi.getSalaryAdvanceApprovalSlaOverview(),
    enabled: canManage,
  });

  const createMutation = useMutation({
    mutationFn: workforceApi.createSalaryAdvance,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      messageApi.success('Đã thêm ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SalaryAdvanceRecordPayload> }) =>
      workforceApi.updateSalaryAdvance(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      messageApi.success('Đã cập nhật ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: workforceApi.deleteSalaryAdvance,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      messageApi.success('Đã xóa ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const submitApprovalMutation = useMutation({
    mutationFn: (id: number) => workforceApi.submitSalaryAdvanceApproval(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      await approvalQueueQuery.refetch();
      messageApi.success('Đã gửi duyệt ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const approveLevel1Mutation = useMutation({
    mutationFn: (id: number) => workforceApi.approveSalaryAdvanceLevel1(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      await approvalQueueQuery.refetch();
      messageApi.success('Đã duyệt L1 ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const approveLevel2Mutation = useMutation({
    mutationFn: (id: number) => workforceApi.approveSalaryAdvanceLevel2(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      await approvalQueueQuery.refetch();
      messageApi.success('Đã duyệt L2 ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const rejectApprovalMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => workforceApi.rejectSalaryAdvanceApproval(id, reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      await approvalQueueQuery.refetch();
      messageApi.success('Đã từ chối duyệt ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const remindPendingApprovalsMutation = useMutation({
    mutationFn: () => workforceApi.remindSalaryAdvancePendingApprovals({ dry_run: false }),
    onSuccess: async (data) => {
      messageApi.success(`Đã gửi nhắc SLA duyệt ứng lương: ${data.sent_count} người nhận`);
      await approvalSlaOverviewQuery.refetch();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const postDisbursementMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: DisbursementForm }) =>
      workforceApi.postSalaryAdvanceDisbursement(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      messageApi.success('Đã ghi nhận chi tiền ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const reverseDisbursementMutation = useMutation({
    mutationFn: (id: number) => workforceApi.reverseSalaryAdvanceDisbursement(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] });
      messageApi.success('Đã hủy chứng từ chi tiền ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const employees = (employeesQuery.data?.results ?? []).filter(
    (item) => item.is_active && item.status !== 'RESIGNED'
  );
  const cashAccounts = cashAccountsQuery.data?.results ?? [];
  const bankAccounts = bankAccountsQuery.data?.results ?? [];
  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const total = listQuery.data?.count ?? 0;

  const summary = useMemo(() => {
    const totalAmount = rows.reduce((acc, item) => acc + Number(item.amount), 0);
    const undeducted = rows
      .filter((item) => item.status === 'UNDEDUCTED')
      .reduce((acc, item) => acc + Number(item.amount), 0);
    const deducted = rows
      .filter((item) => item.status === 'DEDUCTED')
      .reduce((acc, item) => acc + Number(item.amount), 0);
    const approvedNotDisbursed = rows
      .filter((item) => item.approval_status === 'APPROVED' && item.disbursement_status !== 'DISBURSED')
      .reduce((acc, item) => acc + Number(item.amount), 0);
    const disbursedNotDeducted = rows
      .filter((item) => item.disbursement_status === 'DISBURSED' && item.status === 'UNDEDUCTED')
      .reduce((acc, item) => acc + Number(item.amount), 0);
    return { totalAmount, undeducted, deducted, approvedNotDisbursed, disbursedNotDeducted };
  }, [rows]);

  const columns: ColumnsType<SalaryAdvanceRecord> = [
    { title: 'Ngày', dataIndex: 'advance_date', width: 110 },
    { title: 'Tháng trừ', dataIndex: 'month', width: 90 },
    { title: 'Mã NV', dataIndex: 'employee_code', width: 110 },
    { title: 'Tên NV', dataIndex: 'employee_name', width: 220 },
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      width: 150,
      align: 'right',
      render: (value: string) => `${Number(value || 0).toLocaleString('vi-VN')} đ`,
    },
    { title: 'Lý do', dataIndex: 'reason', width: 220 },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (status: SalaryAdvanceStatus) => STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status,
    },
    {
      title: 'Duyệt',
      dataIndex: 'approval_status',
      width: 130,
      render: (approvalStatus: SalaryAdvanceApprovalStatus) => {
        const label = APPROVAL_STATUS_OPTIONS.find((item) => item.value === approvalStatus)?.label ?? approvalStatus;
        const color =
          approvalStatus === 'APPROVED'
            ? 'green'
            : approvalStatus === 'REJECTED'
              ? 'red'
              : approvalStatus === 'PENDING_L1' || approvalStatus === 'PENDING_L2'
                ? 'gold'
                : 'default';
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: 'Chi tiền',
      dataIndex: 'disbursement_status',
      width: 120,
      render: (status: SalaryAdvanceRecord['disbursement_status']) => (
        <Tag color={status === 'DISBURSED' ? 'green' : 'default'}>
          {status === 'DISBURSED' ? 'Đã chi' : 'Chưa chi'}
        </Tag>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 470,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          {canManage && (
            <>
              {(row.approval_status === 'DRAFT' || row.approval_status === 'REJECTED') && (
                <Button size="small" onClick={() => submitApprovalMutation.mutate(row.id)} loading={submitApprovalMutation.isPending}>
                  Gửi duyệt
                </Button>
              )}
              {row.approval_status === 'PENDING_L1' && (
                <Button size="small" onClick={() => approveLevel1Mutation.mutate(row.id)} loading={approveLevel1Mutation.isPending}>
                  Duyệt L1
                </Button>
              )}
              {row.approval_status === 'PENDING_L2' && (
                <Button size="small" type="primary" onClick={() => approveLevel2Mutation.mutate(row.id)} loading={approveLevel2Mutation.isPending}>
                  Duyệt L2
                </Button>
              )}
              {(row.approval_status === 'PENDING_L1' || row.approval_status === 'PENDING_L2') && (
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    setRejectReason('');
                    rejectForm.resetFields();
                    setRejectModal({ open: true, id: row.id });
                  }}
                  loading={rejectApprovalMutation.isPending && rejectModal.id === row.id}
                >
                  Từ chối
                </Button>
              )}
              {row.approval_status === 'APPROVED' && row.disbursement_status !== 'DISBURSED' && (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    disbursementForm.setFieldsValue(emptyDisbursementForm);
                    setDisbursementModal({ open: true, row });
                  }}
                >
                  Chi tiền
                </Button>
              )}
              {row.disbursement_status === 'DISBURSED' && (
                <Button
                  size="small"
                  onClick={() =>
                    Modal.confirm({
                      title: 'Hủy chứng từ chi tiền ứng lương?',
                      okText: 'Hủy chi',
                      cancelText: 'Đóng',
                      onOk: () => reverseDisbursementMutation.mutateAsync(row.id),
                    })
                  }
                  loading={reverseDisbursementMutation.isPending}
                >
                  Hủy chi
                </Button>
              )}
              <Button
                size="small"
                disabled={row.approval_status === 'PENDING_L1' || row.approval_status === 'PENDING_L2' || row.approval_status === 'APPROVED'}
                onClick={() => {
                  setEditing(row);
                  form.setFieldsValue({
                    employee: row.employee,
                    advance_date: row.advance_date,
                    month: row.month,
                    amount: Number(row.amount),
                    reason: row.reason,
                    approved_by_name: row.approved_by_name,
                    note: row.note,
                    is_active: row.is_active,
                  });
                  setOpenModal(true);
                }}
              >
                Sửa
              </Button>
              <Button
                size="small"
                danger
                disabled={row.approval_status === 'PENDING_L1' || row.approval_status === 'PENDING_L2' || row.approval_status === 'APPROVED'}
                onClick={() =>
                  Modal.confirm({
                    title: 'Xóa ứng lương này?',
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

  const toPayload = (values: SalaryAdvanceForm): SalaryAdvanceRecordPayload => ({
    employee: values.employee,
    advance_date: values.advance_date,
    month: values.month,
    amount: Number(values.amount || 0),
    reason: values.reason || 'Ứng lương',
    approved_by_name: values.approved_by_name || '',
    note: values.note || '',
    is_active: values.is_active,
  });

  const submitForm = async () => {
    const values = await form.validateFields();
    const payload = toPayload(values);
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setOpenModal(false);
  };

  const submitDisbursement = async () => {
    if (!disbursementModal.row) return;
    const values = await disbursementForm.validateFields();
    await postDisbursementMutation.mutateAsync({
      id: disbursementModal.row.id,
      payload: {
        source_type: values.source_type,
        source_cash_account: values.source_type === 'CASH' ? values.source_cash_account : null,
        source_bank_account: values.source_type === 'BANK' ? values.source_bank_account : null,
      },
    });
    setDisbursementModal({ open: false, row: null });
    disbursementForm.resetFields();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Ứng lương</h2>
          <div style={{ color: '#8c8c8c' }}>Quản lý ứng lương; trạng thái đã trừ/chưa trừ do hệ thống tự quản lý</div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!canManage}
          onClick={() => {
            setEditing(null);
            form.setFieldsValue({ ...emptyForm, month: filters.month || currentMonth });
            setOpenModal(true);
          }}
        >
          Thêm ứng lương
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
        <Input
          type="month"
          value={filters.month}
          onChange={(e) => {
            setFilters((prev) => ({ ...prev, month: e.target.value || currentMonth }));
            setPage(1);
          }}
          style={{ width: 180 }}
        />
        <Select
          value={filters.status || undefined}
          options={STATUS_OPTIONS}
          placeholder="Trạng thái"
          style={{ width: 160 }}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, status: (value ?? '') as '' | SalaryAdvanceStatus }));
            setPage(1);
          }}
        />
        <Select
          value={filters.approval_status || undefined}
          options={APPROVAL_STATUS_OPTIONS}
          placeholder="Trạng thái duyệt"
          style={{ width: 180 }}
          onChange={(value) => {
            setFilters((prev) => ({ ...prev, approval_status: (value ?? '') as '' | SalaryAdvanceApprovalStatus }));
            setPage(1);
          }}
        />
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({ month: currentMonth, status: '', approval_status: '' });
            setPage(1);
          }}
        >
          Xóa bộ lọc
        </Button>
      </div>

      {canManage && (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
          <div style={{ color: '#8c8c8c', marginBottom: 8 }}>
            {`Hàng đợi duyệt ứng lương - Chờ L1: ${approvalQueueQuery.data?.pending_l1_count ?? 0} | Chờ L2: ${approvalQueueQuery.data?.pending_l2_count ?? 0}`}
          </div>
          <div style={{ color: '#8c8c8c', marginBottom: 8 }}>
            {`SLA quá hạn - L1: ${approvalSlaOverviewQuery.data?.overdue_l1_count ?? 0} | L2: ${approvalSlaOverviewQuery.data?.overdue_l2_count ?? 0} | Escalation L1: ${approvalSlaOverviewQuery.data?.escalation_l1_count ?? 0} | Escalation L2: ${approvalSlaOverviewQuery.data?.escalation_l2_count ?? 0} | Lead time TB: ${Number(approvalSlaOverviewQuery.data?.avg_lead_hours ?? 0).toFixed(2)}h`}
          </div>
          <Button
            size="small"
            loading={remindPendingApprovalsMutation.isPending}
            onClick={() => remindPendingApprovalsMutation.mutate()}
          >
            Nhắc SLA duyệt ngay
          </Button>
          <div style={{ marginTop: 8 }}>
            <div style={{ color: '#8c8c8c', marginBottom: 4 }}>Top người tạo phiếu đang tắc nghẽn</div>
            {(approvalSlaOverviewQuery.data?.top_blocked_submitters ?? []).length === 0 ? (
              <div style={{ color: '#bfbfbf' }}>Không có dữ liệu.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(approvalSlaOverviewQuery.data?.top_blocked_submitters ?? []).map((row) => (
                  <div key={row.username} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 170px 120px', gap: 8 }}>
                    <div>{row.username}</div>
                    <div>{`SL: ${row.pending_count}`}</div>
                    <div>{`Tổng tiền: ${Number(row.total_amount || 0).toLocaleString('vi-VN')} đ`}</div>
                    <div>{`Max wait: ${row.max_wait_hours}h`}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Tổng ứng trang hiện tại</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{summary.totalAmount.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Chưa trừ trang hiện tại</div>
          <div style={{ fontWeight: 700, color: '#d48806', fontSize: 20 }}>{summary.undeducted.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Đã trừ trang hiện tại</div>
          <div style={{ fontWeight: 700, color: '#389e0d', fontSize: 20 }}>{summary.deducted.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Đã duyệt chưa chi</div>
          <div style={{ fontWeight: 700, color: '#d48806', fontSize: 20 }}>{summary.approvedNotDisbursed.toLocaleString('vi-VN')} đ</div>
        </div>
        <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
          <div style={{ color: '#8c8c8c' }}>Đã chi chưa trừ</div>
          <div style={{ fontWeight: 700, color: '#cf1322', fontSize: 20 }}>{summary.disbursedNotDeducted.toLocaleString('vi-VN')} đ</div>
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
        title={editing ? 'Sửa ứng lương' : 'Thêm ứng lương'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={submitForm}
        width={760}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="employee" label="Nhân viên" rules={[{ required: true }]}>
              <Select
                options={employees.map((item: Employee) => ({
                  value: item.id,
                  label: `${item.code} - ${item.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="advance_date" label="Ngày ứng" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="month" label="Tháng trừ lương" rules={[{ required: true }]}>
              <Input type="month" />
            </Form.Item>
            <Form.Item name="amount" label="Số tiền" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="approved_by_name" label="Người duyệt">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="reason" label="Lý do">
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

      <Modal
        title="Chi tiền ứng lương"
        open={disbursementModal.open}
        onCancel={() => {
          setDisbursementModal({ open: false, row: null });
          disbursementForm.resetFields();
        }}
        onOk={submitDisbursement}
        confirmLoading={postDisbursementMutation.isPending}
      >
        <Form form={disbursementForm} layout="vertical" initialValues={emptyDisbursementForm}>
          <Form.Item name="source_type" label="Nguồn tiền" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'CASH', label: 'Quỹ tiền mặt' },
                { value: 'BANK', label: 'Ngân hàng' },
              ]}
            />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {() =>
              disbursementForm.getFieldValue('source_type') === 'BANK' ? (
                <Form.Item
                  name="source_bank_account"
                  label="Tài khoản ngân hàng"
                  rules={[{ required: true, message: 'Vui lòng chọn tài khoản ngân hàng.' }]}
                >
                  <Select
                    options={bankAccounts.map((item: BankAccount) => ({
                      value: item.id,
                      label: `${item.code} - ${item.account_name}`,
                    }))}
                  />
                </Form.Item>
              ) : (
                <Form.Item
                  name="source_cash_account"
                  label="Quỹ tiền mặt"
                  rules={[{ required: true, message: 'Vui lòng chọn quỹ tiền mặt.' }]}
                >
                  <Select
                    options={cashAccounts.map((item: CashAccount) => ({
                      value: item.id,
                      label: `${item.name} | khả dụng ${Number(item.current_balance ?? item.balance ?? 0).toLocaleString('vi-VN')} đ`,
                    }))}
                  />
                </Form.Item>
              )
            }
          </Form.Item>
          <div style={{ color: '#8c8c8c' }}>
            {disbursementModal.row
              ? `Hệ thống sẽ tự sinh chứng từ chi tiền đúng theo ngày ứng: ${disbursementModal.row.advance_date}.`
              : ''}
          </div>
        </Form>
      </Modal>

      <Modal
        title="Từ chối duyệt ứng lương"
        open={rejectModal.open}
        onCancel={() => {
          setRejectModal({ open: false, id: null });
          rejectForm.resetFields();
        }}
        onOk={() => {
          rejectForm
            .validateFields()
            .then((values: { reason: string }) => {
              if (rejectModal.id !== null) {
                rejectApprovalMutation.mutate({ id: rejectModal.id, reason: values.reason.trim() });
                setRejectModal({ open: false, id: null });
                rejectForm.resetFields();
              }
            })
            .catch(() => {});
        }}
        okText="Xác nhận từ chối"
        okButtonProps={{ danger: true }}
        confirmLoading={rejectApprovalMutation.isPending}
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            name="reason"
            label="Lý do từ chối"
            rules={[{ required: true, message: 'Vui lòng nhập lý do từ chối.' }]}
          >
            <Input.TextArea
              rows={3}
              placeholder="Nhập lý do từ chối duyệt..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

