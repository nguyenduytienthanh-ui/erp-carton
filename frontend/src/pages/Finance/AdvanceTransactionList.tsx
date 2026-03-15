import { useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
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
  AdvanceApprovalStatus,
  AdvanceSettlement,
  AdvanceTransaction,
  AdvanceTransactionSourceType,
  AdvanceTransactionStatus,
  AdvanceTransactionType,
  BankAccount,
  CashAccount,
} from '../../types/finance';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageFinanceData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

type ViewMode = 'advances' | 'settlements';
type AdvanceFilters = {
  month: string;
  status: '' | AdvanceTransactionStatus;
  approval_status: '' | AdvanceApprovalStatus;
};

type AdvanceForm = {
  code: string;
  advance_type: AdvanceTransactionType;
  advance_date: string;
  recipient_name: string;
  source_type: AdvanceTransactionSourceType;
  source_cash_account: number | null;
  source_bank_account: number | null;
  amount: number;
  purpose: string;
  note: string;
  is_active: boolean;
};

type SettlementForm = {
  advance_transaction: number;
  settlement_date: string;
  spent_amount: number;
  refund_amount: number;
  note: string;
};

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const currentDate = today.toISOString().slice(0, 10);

const STATUS_OPTIONS: Array<{ value: AdvanceTransactionStatus; label: string }> = [
  { value: 'OPEN', label: 'Chưa quyết toán' },
  { value: 'PARTIAL', label: 'Đang quyết toán' },
  { value: 'SETTLED', label: 'Đã quyết toán' },
  { value: 'CANCELLED', label: 'Đã hủy' },
];
const APPROVAL_STATUS_OPTIONS: Array<{ value: AdvanceApprovalStatus; label: string }> = [
  { value: 'DRAFT', label: 'Nháp' },
  { value: 'PENDING_L1', label: 'Chờ duyệt L1' },
  { value: 'PENDING_L2', label: 'Chờ duyệt L2' },
  { value: 'APPROVED', label: 'Đã duyệt' },
  { value: 'REJECTED', label: 'Từ chối' },
];

const ADVANCE_TYPE_OPTIONS: Array<{ value: AdvanceTransactionType; label: string }> = [
  { value: 'PURCHASE', label: 'Tạm ứng mua hàng' },
  { value: 'SALARY', label: 'Tạm ứng lương' },
  { value: 'OTHER', label: 'Tạm ứng khác' },
];

function serializeFilters(filters: AdvanceFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): AdvanceFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<AdvanceFilters>;
    return {
      month: typeof parsed.month === 'string' && parsed.month ? parsed.month : currentMonth,
      status:
        parsed.status === 'OPEN' ||
        parsed.status === 'PARTIAL' ||
        parsed.status === 'SETTLED' ||
        parsed.status === 'CANCELLED'
          ? parsed.status
          : '',
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

const emptyAdvanceForm: AdvanceForm = {
  code: '',
  advance_type: 'PURCHASE',
  advance_date: currentDate,
  recipient_name: '',
  source_type: 'CASH',
  source_cash_account: null,
  source_bank_account: null,
  amount: 0,
  purpose: '',
  note: '',
  is_active: true,
};

const emptySettlementForm: SettlementForm = {
  advance_transaction: 0,
  settlement_date: currentDate,
  spent_amount: 0,
  refund_amount: 0,
  note: '',
};

function statusColor(status: AdvanceTransactionStatus): string {
  if (status === 'OPEN') return 'orange';
  if (status === 'PARTIAL') return 'blue';
  if (status === 'SETTLED') return 'green';
  return 'default';
}

function approvalColor(status: AdvanceApprovalStatus): string {
  if (status === 'APPROVED') return 'green';
  if (status === 'PENDING_L1' || status === 'PENDING_L2') return 'gold';
  if (status === 'REJECTED') return 'red';
  return 'default';
}

export default function AdvanceTransactionList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<ViewMode>('advances');
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<AdvanceFilters>({ month: currentMonth, status: '', approval_status: '' });
  const [advancesPage, setAdvancesPage] = useState(1);
  const [settlementsPage, setSettlementsPage] = useState(1);
  const [openAdvanceModal, setOpenAdvanceModal] = useState(false);
  const [openSettlementModal, setOpenSettlementModal] = useState(false);
  const [advanceSelectSearch, setAdvanceSelectSearch] = useState('');
  const [editingAdvance, setEditingAdvance] = useState<AdvanceTransaction | null>(null);
  const [editingSettlement, setEditingSettlement] = useState<AdvanceSettlement | null>(null);
  const [advanceForm] = Form.useForm<AdvanceForm>();
  const [settlementForm] = Form.useForm<SettlementForm>();
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [rejectForm] = Form.useForm();
  const { config, saveConfig } = useUserPreferences(PAGES.FINANCE_ADVANCE_TRANSACTIONS);
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

  const advancesParams = useMemo(() => {
    const p: Record<string, unknown> = { page: advancesPage, page_size: pageSize, ordering: '-advance_date' };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.month) p.month = intentFilters.month;
    if (intentFilters.status) p.status = intentFilters.status;
    if (intentFilters.approval_status) p.approval_status = intentFilters.approval_status;
    return p;
  }, [intentSearch, intentFilters, advancesPage, pageSize]);

  const settlementsParams = useMemo(() => {
    const p: Record<string, unknown> = { page: settlementsPage, page_size: pageSize, ordering: '-settlement_date' };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.month) p.month = intentFilters.month;
    return p;
  }, [intentSearch, intentFilters, settlementsPage, pageSize]);

  const advancesQuery = useQuery({
    queryKey: ['finance-advance-transactions', advancesParams],
    queryFn: () => financeApi.getAdvanceTransactions(advancesParams),
  });
  const settlementsQuery = useQuery({
    queryKey: ['finance-advance-settlements', settlementsParams],
    queryFn: () => financeApi.getAdvanceSettlements(settlementsParams),
  });
  const cashAccountsQuery = useQuery({
    queryKey: ['finance-cash-accounts-all'],
    queryFn: () => financeApi.getCashAccounts({ page: 1, page_size: 300, ordering: 'name', is_active: 'true' }),
  });
  const bankAccountsQuery = useQuery({
    queryKey: ['finance-bank-accounts-all'],
    queryFn: () => financeApi.getBankAccounts({ page: 1, page_size: 300, ordering: 'code', is_active: 'true' }),
  });
  const advanceSelectQuery = useQuery({
    queryKey: ['finance-advance-transactions-select', advanceSelectSearch],
    queryFn: () => financeApi.getAdvanceTransactions({
      page: 1,
      page_size: 50,
      ordering: '-advance_date',
      approval_status: 'APPROVED',
      q: advanceSelectSearch.trim() || undefined,
    }),
  });

  const createAdvanceMutation = useMutation({
    mutationFn: financeApi.createAdvanceTransaction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions-select'] });
      messageApi.success('Đã thêm phiếu tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateAdvanceMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      financeApi.updateAdvanceTransaction(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions-select'] });
      messageApi.success('Đã cập nhật phiếu tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteAdvanceMutation = useMutation({
    mutationFn: financeApi.deleteAdvanceTransaction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions-select'] });
      messageApi.success('Đã xóa phiếu tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const submitAdvanceApprovalMutation = useMutation({
    mutationFn: (id: number) => financeApi.submitAdvanceApproval(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      messageApi.success('Đã gửi duyệt phiếu tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const approveAdvanceLevel1Mutation = useMutation({
    mutationFn: (id: number) => financeApi.approveAdvanceLevel1(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      messageApi.success('Đã duyệt cấp 1');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const approveAdvanceLevel2Mutation = useMutation({
    mutationFn: (id: number) => financeApi.approveAdvanceLevel2(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      messageApi.success('Đã duyệt cấp 2');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const rejectAdvanceApprovalMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => financeApi.rejectAdvanceApproval(id, reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      messageApi.success('Đã từ chối phiếu');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const postAdvanceDisbursementMutation = useMutation({
    mutationFn: (id: number) => financeApi.postAdvanceDisbursement(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      messageApi.success('Đã ghi nhận chi tiền tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const reverseAdvanceDisbursementMutation = useMutation({
    mutationFn: (id: number) => financeApi.reverseAdvanceDisbursement(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      messageApi.success('Đã hủy chứng từ chi tiền tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const createSettlementMutation = useMutation({
    mutationFn: financeApi.createAdvanceSettlement,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-settlements'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions-select'] });
      messageApi.success('Đã thêm quyết toán');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateSettlementMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      financeApi.updateAdvanceSettlement(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-settlements'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions-select'] });
      messageApi.success('Đã cập nhật quyết toán');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteSettlementMutation = useMutation({
    mutationFn: financeApi.deleteAdvanceSettlement,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-settlements'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions-select'] });
      messageApi.success('Đã xóa quyết toán');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const advances = useMemo(() => advancesQuery.data?.results ?? [], [advancesQuery.data?.results]);
  const settlements = useMemo(() => settlementsQuery.data?.results ?? [], [settlementsQuery.data?.results]);
  const advanceTotal = advancesQuery.data?.count ?? 0;
  const settlementTotal = settlementsQuery.data?.count ?? 0;
  const cashAccounts = cashAccountsQuery.data?.results ?? [];
  const bankAccounts = bankAccountsQuery.data?.results ?? [];
  const advanceOptions = (advanceSelectQuery.data?.results ?? []).filter(
    (item) => (item.status === 'OPEN' || item.status === 'PARTIAL') && item.approval_status === 'APPROVED'
  );

  const summary = useMemo(() => {
    const totalAdvance = advances.reduce((acc, item) => acc + Number(item.amount), 0);
    const totalSpent = advances.reduce((acc, item) => acc + Number(item.total_spent), 0);
    const totalRefund = advances.reduce((acc, item) => acc + Number(item.total_refund), 0);
    const totalRemaining = advances.reduce((acc, item) => acc + Number(item.remaining_amount), 0);
    return { totalAdvance, totalSpent, totalRefund, totalRemaining };
  }, [advances]);

  const advanceColumns: ColumnsType<AdvanceTransaction> = [
    { title: 'Mã', dataIndex: 'code', width: 120 },
    { title: 'Ngày', dataIndex: 'advance_date', width: 110 },
    { title: 'Người nhận', dataIndex: 'recipient_name', width: 220 },
    {
      title: 'Loại',
      dataIndex: 'advance_type',
      width: 170,
      render: (value: AdvanceTransactionType) =>
        ADVANCE_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value,
    },
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      align: 'right',
      width: 140,
      render: (value: string) => `${Number(value || 0).toLocaleString('vi-VN')} đ`,
    },
    {
      title: 'Đã chi',
      dataIndex: 'total_spent',
      align: 'right',
      width: 130,
      render: (value: string) => `${Number(value || 0).toLocaleString('vi-VN')} đ`,
    },
    {
      title: 'Hoàn ứng',
      dataIndex: 'total_refund',
      align: 'right',
      width: 130,
      render: (value: string) => `${Number(value || 0).toLocaleString('vi-VN')} đ`,
    },
    {
      title: 'Còn lại',
      dataIndex: 'remaining_amount',
      align: 'right',
      width: 130,
      render: (value: string) => <strong>{Number(value || 0).toLocaleString('vi-VN')} đ</strong>,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 150,
      render: (value: AdvanceTransactionStatus) => {
        const label = STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value;
        return <Tag color={statusColor(value)}>{label}</Tag>;
      },
    },
    {
      title: 'Duyệt',
      dataIndex: 'approval_status',
      width: 140,
      render: (value: AdvanceApprovalStatus) => {
        const label = APPROVAL_STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value;
        return <Tag color={approvalColor(value)}>{label}</Tag>;
      },
    },
    {
      title: 'Chi tiền',
      dataIndex: 'disbursement_status',
      width: 130,
      render: (value: AdvanceTransaction['disbursement_status']) => (
        <Tag color={value === 'DISBURSED' ? 'green' : 'default'}>
          {value === 'DISBURSED' ? 'Đã chi' : 'Chưa chi'}
        </Tag>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 460,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          {canManage && (
            <>
              {(row.approval_status === 'DRAFT' || row.approval_status === 'REJECTED') && (
                <Button
                  size="small"
                  onClick={() => submitAdvanceApprovalMutation.mutate(row.id)}
                  loading={submitAdvanceApprovalMutation.isPending}
                >
                  Gửi duyệt
                </Button>
              )}
              {row.approval_status === 'PENDING_L1' && (
                <Button
                  size="small"
                  onClick={() => approveAdvanceLevel1Mutation.mutate(row.id)}
                  loading={approveAdvanceLevel1Mutation.isPending}
                >
                  Duyệt L1
                </Button>
              )}
              {row.approval_status === 'PENDING_L2' && (
                <Button
                  size="small"
                  onClick={() => approveAdvanceLevel2Mutation.mutate(row.id)}
                  loading={approveAdvanceLevel2Mutation.isPending}
                >
                  Duyệt L2
                </Button>
              )}
              {(row.approval_status === 'PENDING_L1' || row.approval_status === 'PENDING_L2') && (
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    rejectForm.resetFields();
                    setRejectModal({ open: true, id: row.id });
                  }}
                  loading={rejectAdvanceApprovalMutation.isPending && rejectModal.id === row.id}
                >
                  Từ chối
                </Button>
              )}
              {row.approval_status === 'APPROVED' && row.disbursement_status !== 'DISBURSED' && (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => postAdvanceDisbursementMutation.mutate(row.id)}
                  loading={postAdvanceDisbursementMutation.isPending}
                >
                  Chi tiền
                </Button>
              )}
              {row.disbursement_status === 'DISBURSED' && (
                <Button
                  size="small"
                  onClick={() =>
                    Modal.confirm({
                      title: `Hủy chứng từ chi tiền ${row.code}?`,
                      okText: 'Hủy chi',
                      cancelText: 'Đóng',
                      onOk: () => reverseAdvanceDisbursementMutation.mutateAsync(row.id),
                    })
                  }
                  loading={reverseAdvanceDisbursementMutation.isPending}
                >
                  Hủy chi
                </Button>
              )}
              <Button
                size="small"
                disabled={row.approval_status === 'PENDING_L1' || row.approval_status === 'PENDING_L2' || row.approval_status === 'APPROVED'}
                onClick={() => {
                  setEditingAdvance(row);
                  advanceForm.setFieldsValue({
                    code: row.code,
                    advance_type: row.advance_type,
                    advance_date: row.advance_date,
                    recipient_name: row.recipient_name,
                    source_type: row.source_type,
                    source_cash_account: row.source_cash_account,
                    source_bank_account: row.source_bank_account,
                    amount: Number(row.amount),
                    purpose: row.purpose,
                    note: row.note,
                    is_active: row.is_active,
                  });
                  setOpenAdvanceModal(true);
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
                    title: `Xóa phiếu tạm ứng ${row.code}?`,
                    okText: 'Xóa',
                    cancelText: 'Hủy',
                    onOk: () => deleteAdvanceMutation.mutateAsync(row.id),
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

  const settlementColumns: ColumnsType<AdvanceSettlement> = [
    { title: 'Ngày', dataIndex: 'settlement_date', width: 110 },
    { title: 'Mã tạm ứng', dataIndex: 'advance_code', width: 130 },
    { title: 'Người nhận', dataIndex: 'advance_recipient_name', width: 210 },
    {
      title: 'Chi thực tế',
      dataIndex: 'spent_amount',
      width: 150,
      align: 'right',
      render: (value: string) => `${Number(value || 0).toLocaleString('vi-VN')} đ`,
    },
    {
      title: 'Hoàn ứng',
      dataIndex: 'refund_amount',
      width: 150,
      align: 'right',
      render: (value: string) => `${Number(value || 0).toLocaleString('vi-VN')} đ`,
    },
    { title: 'Ghi chú', dataIndex: 'note', width: 260, render: (value: string) => value || '-' },
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
                  setEditingSettlement(row);
                  settlementForm.setFieldsValue({
                    advance_transaction: row.advance_transaction,
                    settlement_date: row.settlement_date,
                    spent_amount: Number(row.spent_amount),
                    refund_amount: Number(row.refund_amount),
                    note: row.note,
                  });
                  setOpenSettlementModal(true);
                }}
              >
                Sửa
              </Button>
              <Button
                size="small"
                danger
                onClick={() =>
                  Modal.confirm({
                    title: 'Xóa phiếu quyết toán?',
                    okText: 'Xóa',
                    cancelText: 'Hủy',
                    onOk: () => deleteSettlementMutation.mutateAsync(row.id),
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

  const submitAdvance = async () => {
    const values = await advanceForm.validateFields();
    const payload = {
      code: values.code.trim().toUpperCase(),
      advance_type: values.advance_type,
      advance_date: values.advance_date,
      recipient_name: values.recipient_name.trim(),
      source_type: values.source_type,
      source_cash_account: values.source_type === 'CASH' ? values.source_cash_account : null,
      source_bank_account: values.source_type === 'BANK' ? values.source_bank_account : null,
      amount: String(values.amount ?? 0),
      purpose: values.purpose || '',
      note: values.note || '',
      is_active: values.is_active,
    };
    if (editingAdvance) {
      await updateAdvanceMutation.mutateAsync({ id: editingAdvance.id, payload });
    } else {
      await createAdvanceMutation.mutateAsync(payload);
    }
    setOpenAdvanceModal(false);
  };

  const submitSettlement = async () => {
    const values = await settlementForm.validateFields();
    const payload = {
      advance_transaction: values.advance_transaction,
      settlement_date: values.settlement_date,
      spent_amount: String(values.spent_amount ?? 0),
      refund_amount: String(values.refund_amount ?? 0),
      note: values.note || '',
    };
    if (editingSettlement) {
      await updateSettlementMutation.mutateAsync({ id: editingSettlement.id, payload });
    } else {
      await createSettlementMutation.mutateAsync(payload);
    }
    setOpenSettlementModal(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Tạm ứng & quyết toán</h2>
          <div style={{ color: '#8c8c8c' }}>Theo dõi tạm ứng, hoàn ứng và trạng thái quyết toán</div>
        </div>
        <Space>
          {viewMode === 'advances' ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canManage}
              onClick={() => {
                setEditingAdvance(null);
                advanceForm.setFieldsValue(emptyAdvanceForm);
                setOpenAdvanceModal(true);
              }}
            >
              Thêm phiếu tạm ứng
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canManage}
              onClick={() => {
                setEditingSettlement(null);
                settlementForm.setFieldsValue(emptySettlementForm);
                setOpenSettlementModal(true);
              }}
            >
              Thêm quyết toán
            </Button>
          )}
        </Space>
      </div>

      <Segmented
        options={[
          { label: 'Phiếu tạm ứng', value: 'advances' },
          { label: 'Quyết toán', value: 'settlements' },
        ]}
        value={viewMode}
        onChange={(value) => setViewMode(value as ViewMode)}
      />

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setAdvancesPage(1);
            setSettlementsPage(1);
          }}
          placeholder="Tìm kiếm tất cả cột..."
          style={{ width: 320 }}
          suffix={
            searchInput ? (
              <QuickClearIcon
                onClear={() => {
                  setSearchInput('');
                  setAdvancesPage(1);
                  setSettlementsPage(1);
                }}
                title="Xóa tìm kiếm"
              />
            ) : undefined
          }
        />
        <Input
          type="month"
          value={filters.month}
          onChange={(e) => {
            setFilters((prev) => ({ ...prev, month: e.target.value || currentMonth }));
            setAdvancesPage(1);
            setSettlementsPage(1);
          }}
          style={{ width: 180 }}
        />
        {viewMode === 'advances' && (
          <Select
            value={filters.status || undefined}
            placeholder="Trạng thái"
            style={{ width: 180 }}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, status: (value ?? '') as '' | AdvanceTransactionStatus }));
              setAdvancesPage(1);
            }}
          />
        )}
        {viewMode === 'advances' && (
          <Select
            value={filters.approval_status || undefined}
            placeholder="Trạng thái duyệt"
            style={{ width: 180 }}
            options={APPROVAL_STATUS_OPTIONS}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, approval_status: (value ?? '') as '' | AdvanceApprovalStatus }));
              setAdvancesPage(1);
            }}
          />
        )}
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters({ month: currentMonth, status: '', approval_status: '' });
            setAdvancesPage(1);
            setSettlementsPage(1);
          }}
        >
          Xóa bộ lọc
        </Button>
      </div>

      {viewMode === 'advances' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
              <div style={{ color: '#8c8c8c' }}>Tổng tạm ứng trang hiện tại</div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{summary.totalAdvance.toLocaleString('vi-VN')} đ</div>
            </div>
            <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
              <div style={{ color: '#8c8c8c' }}>Đã chi thực tế trang hiện tại</div>
              <div style={{ fontWeight: 700, color: '#1677ff', fontSize: 20 }}>{summary.totalSpent.toLocaleString('vi-VN')} đ</div>
            </div>
            <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
              <div style={{ color: '#8c8c8c' }}>Đã hoàn ứng trang hiện tại</div>
              <div style={{ fontWeight: 700, color: '#389e0d', fontSize: 20 }}>{summary.totalRefund.toLocaleString('vi-VN')} đ</div>
            </div>
            <div style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 10 }}>
              <div style={{ color: '#8c8c8c' }}>Còn lại trang hiện tại</div>
              <div style={{ fontWeight: 700, color: '#cf1322', fontSize: 20 }}>{summary.totalRemaining.toLocaleString('vi-VN')} đ</div>
            </div>
          </div>

          <Table
            rowKey="id"
            loading={advancesQuery.isLoading}
            columns={advanceColumns}
            dataSource={advances}
            scroll={{ x: 1700 }}
            pagination={{
              current: advancesPage,
              pageSize,
              total: advanceTotal,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              onChange: async (nextPage, nextPageSize) => {
                setAdvancesPage(nextPage);
                if (nextPageSize !== pageSize) {
                  await saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize });
                }
              },
            }}
          />
        </>
      )}

      {viewMode === 'settlements' && (
        <Table
          rowKey="id"
          loading={settlementsQuery.isLoading}
          columns={settlementColumns}
          dataSource={settlements}
          scroll={{ x: 1250 }}
          pagination={{
            current: settlementsPage,
            pageSize,
            total: settlementTotal,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            onChange: async (nextPage, nextPageSize) => {
              setSettlementsPage(nextPage);
              if (nextPageSize !== pageSize) {
                await saveConfig({ ...(config as Record<string, unknown>), pageSize: nextPageSize });
              }
            },
          }}
        />
      )}

      <Modal
        title={editingAdvance ? 'Sửa phiếu tạm ứng' : 'Thêm phiếu tạm ứng'}
        open={openAdvanceModal}
        onCancel={() => setOpenAdvanceModal(false)}
        onOk={submitAdvance}
        width={760}
        confirmLoading={createAdvanceMutation.isPending || updateAdvanceMutation.isPending}
      >
        <Form form={advanceForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="code" label="Mã tạm ứng" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="advance_date" label="Ngày tạm ứng" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="advance_type" label="Loại tạm ứng">
              <Select options={ADVANCE_TYPE_OPTIONS} />
            </Form.Item>
            <Form.Item name="recipient_name" label="Người nhận" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="source_type" label="Nguồn tiền">
              <Select
                options={[
                  { value: 'CASH', label: 'Tiền mặt / Quỹ' },
                  { value: 'BANK', label: 'Ngân hàng' },
                ]}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate>
              {() => {
                const sourceType = advanceForm.getFieldValue('source_type') as AdvanceTransactionSourceType;
                if (sourceType === 'BANK') {
                  return (
                    <Form.Item
                      name="source_bank_account"
                      label="Tài khoản ngân hàng nguồn"
                      rules={[{ required: true, message: 'Bắt buộc' }]}
                    >
                      <Select
                        options={bankAccounts.map((item: BankAccount) => ({
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
                      options={cashAccounts.map((item: CashAccount) => ({
                        value: item.id,
                        label: item.name,
                      }))}
                    />
                  </Form.Item>
                );
              }}
            </Form.Item>
            <Form.Item name="amount" label="Số tiền" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="purpose" label="Mục đích">
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
        title={editingSettlement ? 'Sửa quyết toán' : 'Thêm quyết toán'}
        open={openSettlementModal}
        onCancel={() => setOpenSettlementModal(false)}
        onOk={submitSettlement}
        confirmLoading={createSettlementMutation.isPending || updateSettlementMutation.isPending}
      >
        <Form form={settlementForm} layout="vertical">
          <Form.Item
            name="advance_transaction"
            label="Phiếu tạm ứng"
            rules={[{ required: true, message: 'Bắt buộc' }]}
          >
            <Select
              showSearch
              filterOption={false}
              onSearch={setAdvanceSelectSearch}
              options={advanceOptions.map((item: AdvanceTransaction) => ({
                value: item.id,
                label: `${item.code} - ${item.recipient_name} (${Number(item.remaining_amount).toLocaleString('vi-VN')} đ)`,
              }))}
            />
          </Form.Item>
          <Form.Item name="settlement_date" label="Ngày quyết toán" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input type="date" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="spent_amount" label="Chi thực tế" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="refund_amount" label="Hoàn ứng" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Từ chối duyệt phiếu tạm ứng"
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
                rejectAdvanceApprovalMutation.mutate({ id: rejectModal.id, reason: values.reason.trim() });
                setRejectModal({ open: false, id: null });
                rejectForm.resetFields();
              }
            })
            .catch(() => {});
        }}
        okText="Xác nhận từ chối"
        okButtonProps={{ danger: true }}
        confirmLoading={rejectAdvanceApprovalMutation.isPending}
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            name="reason"
            label="Lý do từ chối"
            rules={[{ required: true, message: 'Vui lòng nhập lý do từ chối.' }]}
          >
            <Input.TextArea rows={3} placeholder="Nhập lý do từ chối duyệt phiếu tạm ứng..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

