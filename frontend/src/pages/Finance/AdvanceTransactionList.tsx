import { useMemo, useState, type CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tabs,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, EyeOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { financeApi } from '../../api/finance';
import type {
  AdvanceApprovalHistoryItem,
  AdvanceApprovalStatus,
  AdvanceApprovalQueueItem,
  AdvanceApprovalSlaPolicy,
  AdvanceApprovalSlaReminderHistoryItem,
  AdvanceSettlement,
  AdvanceTransaction,
  AdvanceOverdueOverviewItem,
  AdvanceReminderHistoryItem,
  AdvanceReminderPolicy,
  AdvanceReminderPolicyHistoryItem,
  AdvanceTransactionSourceType,
  AdvanceTransactionStatus,
  AdvanceTransactionType,
  BankAccount,
  CashAccount,
  AdvanceReminderPolicySimulationResponse,
} from '../../types/finance';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageFinanceData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';

const { Text, Title } = Typography;

type ViewMode = 'advances' | 'settlements';
type ControlTab = 'overview' | 'workspace' | 'policy';
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

type ReminderPolicyForm = {
  default_threshold_days: number;
  cooldown_hours: number;
  role_threshold_days_text: string;
  user_threshold_days_text: string;
};

type ApprovalPolicyForm = {
  sla_hours_l1: number;
  sla_hours_l2: number;
  remind_every_hours: number;
  escalation_hours_l1: number;
  escalation_hours_l2: number;
  escalation_cooldown_hours: number;
  window_days: number;
};

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const currentDate = today.toISOString().slice(0, 10);

const PANEL_STYLE: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: 16,
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
};

const SUMMARY_TILE_STYLE: CSSProperties = {
  ...PANEL_STYLE,
  padding: '14px 16px',
  height: '100%',
};

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

function formatMoney(value: number | string | null | undefined): string {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? `${numeric.toLocaleString('vi-VN')} đ` : '0 đ';
}

function formatPercent(value: number | null | undefined): string {
  const numeric = Number(value ?? 0);
  return `${numeric.toFixed(1)}%`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function stringifyThresholdMap(record: Record<string, number> | undefined): string {
  return JSON.stringify(record ?? {}, null, 2);
}

function parseThresholdMap(raw: string, fieldLabel: string): Record<string, number> {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${fieldLabel} phải là JSON hợp lệ.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldLabel} phải là object dạng key-value.`);
  }
  return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, number>>((acc, [key, value]) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new Error(`${fieldLabel} có giá trị không hợp lệ tại khóa "${key}".`);
    }
    acc[key] = numeric;
    return acc;
  }, {});
}

export default function AdvanceTransactionList() {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('q') || searchParams.get('search') || '';
  const initialFocusCode = searchParams.get('focus');
  const initialFocusId = Number(searchParams.get('focus_id') || 0) || null;
  const initialStatusParam = searchParams.get('status');
  const initialApprovalStatusParam = searchParams.get('approval_status');
  const initialFilters: AdvanceFilters = {
    month: searchParams.get('month') || currentMonth,
    status:
      initialStatusParam === 'OPEN'
      || initialStatusParam === 'PARTIAL'
      || initialStatusParam === 'SETTLED'
      || initialStatusParam === 'CANCELLED'
        ? initialStatusParam
        : '',
    approval_status:
      initialApprovalStatusParam === 'DRAFT'
      || initialApprovalStatusParam === 'PENDING_L1'
      || initialApprovalStatusParam === 'PENDING_L2'
      || initialApprovalStatusParam === 'APPROVED'
      || initialApprovalStatusParam === 'REJECTED'
        ? initialApprovalStatusParam
        : '',
  };
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [controlTab, setControlTab] = useState<ControlTab>('overview');
  const [viewMode, setViewMode] = useState<ViewMode>('advances');
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [filters, setFilters] = useState<AdvanceFilters>(initialFilters);
  const [advancesPage, setAdvancesPage] = useState(1);
  const [settlementsPage, setSettlementsPage] = useState(1);
  const [openAdvanceModal, setOpenAdvanceModal] = useState(false);
  const [openSettlementModal, setOpenSettlementModal] = useState(false);
  const [advanceSelectSearch, setAdvanceSelectSearch] = useState('');
  const [editingAdvance, setEditingAdvance] = useState<AdvanceTransaction | null>(null);
  const [detailAdvanceId, setDetailAdvanceId] = useState<number | null>(null);
  const [dismissedFocusKey, setDismissedFocusKey] = useState('');
  const [editingSettlement, setEditingSettlement] = useState<AdvanceSettlement | null>(null);
  const [advanceForm] = Form.useForm<AdvanceForm>();
  const [settlementForm] = Form.useForm<SettlementForm>();
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [rejectForm] = Form.useForm();
  const [openReminderPolicyModal, setOpenReminderPolicyModal] = useState(false);
  const [openApprovalPolicyModal, setOpenApprovalPolicyModal] = useState(false);
  const [reminderPolicyForm] = Form.useForm<ReminderPolicyForm>();
  const [approvalPolicyForm] = Form.useForm<ApprovalPolicyForm>();
  const [policySimulation, setPolicySimulation] = useState<AdvanceReminderPolicySimulationResponse | null>(null);
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
  const approvalQueueQuery = useQuery({
    queryKey: ['finance-advance-approval-queue'],
    queryFn: () => financeApi.getAdvanceApprovalQueue(),
  });
  const approvalSlaOverviewQuery = useQuery({
    queryKey: ['finance-advance-approval-sla-overview'],
    queryFn: () => financeApi.getAdvanceApprovalSlaOverview(),
  });
  const approvalSlaReminderHistoryQuery = useQuery({
    queryKey: ['finance-advance-approval-sla-reminder-history', 30],
    queryFn: () => financeApi.getAdvanceApprovalSlaReminderHistory({ days: 30 }),
  });
  const overdueOverviewQuery = useQuery({
    queryKey: ['finance-advance-overdue-overview', currentDate],
    queryFn: () => financeApi.getAdvanceOverdueOverview({ as_of: currentDate }),
  });
  const overdueReportQuery = useQuery({
    queryKey: ['finance-advance-overdue-report', currentDate, 30],
    queryFn: () => financeApi.getAdvanceOverdueReport({ as_of: currentDate, overdue_days: 30 }),
  });
  const reminderHistoryQuery = useQuery({
    queryKey: ['finance-advance-reminder-history', 30, currentDate],
    queryFn: () => financeApi.getAdvanceReminderHistory({ days: 30, as_of_to: currentDate }),
  });
  const reminderPolicyQuery = useQuery({
    queryKey: ['finance-advance-reminder-policy'],
    queryFn: () => financeApi.getAdvanceReminderPolicy(),
  });
  const reminderPolicyHistoryQuery = useQuery({
    queryKey: ['finance-advance-reminder-policy-history', 12],
    queryFn: () => financeApi.getAdvanceReminderPolicyHistory({ limit: 12 }),
  });
  const approvalPolicyQuery = useQuery({
    queryKey: ['finance-advance-approval-sla-policy'],
    queryFn: () => financeApi.getAdvanceApprovalSlaPolicy(),
  });
  const focusKey = `${initialFocusId ?? ''}:${initialFocusCode ?? ''}`;

  const invalidateAdvanceWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-settlements'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-transactions-select'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-approval-history'] }),
    ]);
  };

  const invalidateAdvanceControlCenter = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['finance-advance-approval-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-approval-sla-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-approval-sla-reminder-history'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-overdue-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-overdue-report'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-reminder-history'] }),
    ]);
  };

  const invalidateAdvancePolicies = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['finance-advance-reminder-policy'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-reminder-policy-history'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-approval-sla-policy'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-approval-sla-reminder-history'] }),
      queryClient.invalidateQueries({ queryKey: ['finance-advance-approval-sla-overview'] }),
    ]);
  };

  const createAdvanceMutation = useMutation({
    mutationFn: financeApi.createAdvanceTransaction,
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã thêm phiếu tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateAdvanceMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      financeApi.updateAdvanceTransaction(id, payload),
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã cập nhật phiếu tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteAdvanceMutation = useMutation({
    mutationFn: financeApi.deleteAdvanceTransaction,
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã xóa phiếu tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const submitAdvanceApprovalMutation = useMutation({
    mutationFn: (id: number) => financeApi.submitAdvanceApproval(id),
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã gửi duyệt phiếu tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const approveAdvanceLevel1Mutation = useMutation({
    mutationFn: (id: number) => financeApi.approveAdvanceLevel1(id),
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã duyệt cấp 1');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const approveAdvanceLevel2Mutation = useMutation({
    mutationFn: (id: number) => financeApi.approveAdvanceLevel2(id),
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã duyệt cấp 2');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const rejectAdvanceApprovalMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => financeApi.rejectAdvanceApproval(id, reason),
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã từ chối phiếu');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const postAdvanceDisbursementMutation = useMutation({
    mutationFn: (id: number) => financeApi.postAdvanceDisbursement(id),
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã ghi nhận chi tiền tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const reverseAdvanceDisbursementMutation = useMutation({
    mutationFn: (id: number) => financeApi.reverseAdvanceDisbursement(id),
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã hủy chứng từ chi tiền tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const createSettlementMutation = useMutation({
    mutationFn: financeApi.createAdvanceSettlement,
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã thêm quyết toán');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateSettlementMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Record<string, unknown> }) =>
      financeApi.updateAdvanceSettlement(id, payload),
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã cập nhật quyết toán');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteSettlementMutation = useMutation({
    mutationFn: financeApi.deleteAdvanceSettlement,
    onSuccess: async () => {
      await invalidateAdvanceWorkspace();
      await invalidateAdvanceControlCenter();
      messageApi.success('Đã xóa quyết toán');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const remindPendingApprovalsMutation = useMutation({
    mutationFn: (payload?: { dry_run?: boolean }) => financeApi.remindAdvancePendingApprovals(payload),
    onSuccess: async (result) => {
      await invalidateAdvanceControlCenter();
      messageApi.success(
        result.dry_run
          ? `Đã mô phỏng nhắc duyệt: ${result.sent_count} người nhận dự kiến`
          : `Đã gửi nhắc duyệt cho ${result.sent_count} người`
      );
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const remindOverdueMutation = useMutation({
    mutationFn: () => financeApi.remindOverdueAdvances({ threshold_days: 30, as_of: currentDate }),
    onSuccess: async (result) => {
      await invalidateAdvanceControlCenter();
      messageApi.success(`Đã gửi nhắc quá hạn cho ${result.sent_count} người`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const exportOverdueReportMutation = useMutation({
    mutationFn: () => financeApi.exportAdvanceOverdueReportExcel({ as_of: currentDate, overdue_days: 30 }),
    onSuccess: (blob) => {
      downloadBlob(blob, `bao_cao_tam_ung_qua_han_${currentDate}.xlsx`);
      messageApi.success('Đã xuất báo cáo tạm ứng quá hạn');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const saveReminderPolicyMutation = useMutation({
    mutationFn: (payload: Partial<AdvanceReminderPolicy>) => financeApi.saveAdvanceReminderPolicy(payload),
    onSuccess: async () => {
      await invalidateAdvancePolicies();
      setOpenReminderPolicyModal(false);
      setPolicySimulation(null);
      messageApi.success('Đã cập nhật chính sách nhắc tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const simulateReminderPolicyMutation = useMutation({
    mutationFn: (payload: Partial<AdvanceReminderPolicy>) =>
      financeApi.simulateAdvanceReminderPolicy({ as_of: currentDate, policy: payload }),
    onSuccess: (result) => {
      setPolicySimulation(result);
      messageApi.success(`Mô phỏng xong: ${result.would_send_count} người sẽ nhận nhắc việc`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const rollbackReminderPolicyMutation = useMutation({
    mutationFn: (auditLogId: number) => financeApi.rollbackAdvanceReminderPolicy({ audit_log_id: auditLogId }),
    onSuccess: async () => {
      await invalidateAdvancePolicies();
      messageApi.success('Đã khôi phục cấu hình nhắc tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const saveApprovalPolicyMutation = useMutation({
    mutationFn: (payload: Partial<AdvanceApprovalSlaPolicy>) => financeApi.saveAdvanceApprovalSlaPolicy(payload),
    onSuccess: async () => {
      await invalidateAdvancePolicies();
      setOpenApprovalPolicyModal(false);
      messageApi.success('Đã cập nhật chính sách SLA duyệt tạm ứng');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const advances = useMemo(() => advancesQuery.data?.results ?? [], [advancesQuery.data?.results]);
  const focusedAdvance = useMemo(
    () => advances.find(
      (item) => (initialFocusId ? item.id === initialFocusId : false) || (initialFocusCode ? item.code === initialFocusCode : false),
    ) ?? null,
    [advances, initialFocusCode, initialFocusId],
  );
  const activeDetailAdvanceId = detailAdvanceId ?? (dismissedFocusKey === focusKey ? null : focusedAdvance?.id ?? null);
  const detailAdvanceData = useMemo(
    () => advances.find((item) => item.id === activeDetailAdvanceId) ?? focusedAdvance,
    [activeDetailAdvanceId, advances, focusedAdvance]
  );
  const approvalHistoryQuery = useQuery({
    queryKey: ['finance-advance-approval-history', activeDetailAdvanceId],
    queryFn: () => financeApi.getAdvanceApprovalHistory(activeDetailAdvanceId as number),
    enabled: activeDetailAdvanceId !== null,
  });
  const settlements = useMemo(() => settlementsQuery.data?.results ?? [], [settlementsQuery.data?.results]);
  const advanceTotal = advancesQuery.data?.count ?? 0;
  const settlementTotal = settlementsQuery.data?.count ?? 0;
  const cashAccounts = cashAccountsQuery.data?.results ?? [];
  const bankAccounts = bankAccountsQuery.data?.results ?? [];
  const advanceOptions = (advanceSelectQuery.data?.results ?? []).filter(
    (item) => (item.status === 'OPEN' || item.status === 'PARTIAL') && item.approval_status === 'APPROVED'
  );
  const approvalQueue = approvalQueueQuery.data;
  const approvalSlaOverview = approvalSlaOverviewQuery.data;
  const approvalSlaPolicy = approvalPolicyQuery.data;
  const approvalSlaReminderHistory = approvalSlaReminderHistoryQuery.data;
  const overdueOverview = overdueOverviewQuery.data;
  const overdueReport = overdueReportQuery.data;
  const reminderHistory = reminderHistoryQuery.data;
  const reminderPolicy = reminderPolicyQuery.data;
  const reminderPolicyHistory = reminderPolicyHistoryQuery.data;
  const commandCenterLoading =
    approvalQueueQuery.isLoading ||
    approvalSlaOverviewQuery.isLoading ||
    overdueOverviewQuery.isLoading ||
    overdueReportQuery.isLoading ||
    reminderHistoryQuery.isLoading;

  const summary = useMemo(() => {
    const totalAdvance = advances.reduce((acc, item) => acc + Number(item.amount), 0);
    const totalSpent = advances.reduce((acc, item) => acc + Number(item.total_spent), 0);
    const totalRefund = advances.reduce((acc, item) => acc + Number(item.total_refund), 0);
    const totalRemaining = advances.reduce((acc, item) => acc + Number(item.remaining_amount), 0);
    return { totalAdvance, totalSpent, totalRefund, totalRemaining };
  }, [advances]);

  const commandSummary = useMemo(
    () => ({
      pendingApprovals: (approvalQueue?.pending_l1_count ?? 0) + (approvalQueue?.pending_l2_count ?? 0),
      overdueApprovals: (approvalSlaOverview?.overdue_l1_count ?? 0) + (approvalSlaOverview?.overdue_l2_count ?? 0),
      overdueAdvances: overdueReport?.summary.count ?? 0,
      overdueRemaining: overdueReport?.summary.total_remaining ?? '0',
      reminderReadRate: reminderHistory?.summary?.overall_read_rate ?? 0,
      averageApprovalLeadHours: approvalSlaOverview?.avg_lead_hours ?? 0,
    }),
    [approvalQueue, approvalSlaOverview, overdueReport, reminderHistory]
  );

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (searchInput.trim()) tags.push(`Từ khóa: ${searchInput.trim()}`);
    if (filters.month) tags.push(`Tháng: ${filters.month}`);
    if (filters.status) tags.push(`Trạng thái: ${STATUS_OPTIONS.find((item) => item.value === filters.status)?.label ?? filters.status}`);
    if (filters.approval_status) {
      tags.push(
        `Duyệt: ${
          APPROVAL_STATUS_OPTIONS.find((item) => item.value === filters.approval_status)?.label ?? filters.approval_status
        }`
      );
    }
    return tags;
  }, [filters, searchInput]);

  const openReminderPolicyEditor = () => {
    const current = reminderPolicy ?? {
      default_threshold_days: 30,
      cooldown_hours: 24,
      role_threshold_days: {},
      user_threshold_days: {},
    };
    reminderPolicyForm.setFieldsValue({
      default_threshold_days: current.default_threshold_days,
      cooldown_hours: current.cooldown_hours,
      role_threshold_days_text: stringifyThresholdMap(current.role_threshold_days),
      user_threshold_days_text: stringifyThresholdMap(current.user_threshold_days),
    });
    setPolicySimulation(null);
    setOpenReminderPolicyModal(true);
  };

  const openApprovalPolicyEditor = () => {
    const current = approvalSlaPolicy ?? approvalSlaOverview?.policy ?? {
      sla_hours_l1: 24,
      sla_hours_l2: 24,
      remind_every_hours: 8,
      escalation_hours_l1: 24,
      escalation_hours_l2: 36,
      escalation_cooldown_hours: 12,
      window_days: 30,
    };
    approvalPolicyForm.setFieldsValue({
      sla_hours_l1: current.sla_hours_l1,
      sla_hours_l2: current.sla_hours_l2,
      remind_every_hours: current.remind_every_hours,
      escalation_hours_l1: current.escalation_hours_l1,
      escalation_hours_l2: current.escalation_hours_l2,
      escalation_cooldown_hours: current.escalation_cooldown_hours,
      window_days: current.window_days,
    });
    setOpenApprovalPolicyModal(true);
  };

  const exportCurrentViewCsv = () => {
    if (viewMode === 'advances') {
      downloadCSV(
        advances.map((item) => ({
          ma: item.code,
          ngay_tam_ung: item.advance_date,
          nguoi_nhan: item.recipient_name,
          loai: item.advance_type,
          so_tien: item.amount,
          da_chi: item.total_spent,
          hoan_ung: item.total_refund,
          con_lai: item.remaining_amount,
          trang_thai: item.status,
          trang_thai_duyet: item.approval_status,
        })),
        'tam_ung_hien_tai'
      );
      return;
    }

    downloadCSV(
      settlements.map((item) => ({
        ma_tam_ung: item.advance_code,
        nguoi_nhan: item.advance_recipient_name,
        ngay_quyet_toan: item.settlement_date,
        chi_thuc_te: item.spent_amount,
        hoan_ung: item.refund_amount,
        ghi_chu: item.note,
      })),
      'quyet_toan_tam_ung_hien_tai'
    );
  };

  const buildReminderPolicyPayload = async (): Promise<Partial<AdvanceReminderPolicy>> => {
    const values = await reminderPolicyForm.validateFields();
    return {
      default_threshold_days: Number(values.default_threshold_days ?? 0),
      cooldown_hours: Number(values.cooldown_hours ?? 0),
      role_threshold_days: parseThresholdMap(values.role_threshold_days_text ?? '{}', 'Ngưỡng theo vai trò'),
      user_threshold_days: parseThresholdMap(values.user_threshold_days_text ?? '{}', 'Ngưỡng theo người dùng'),
    };
  };

  const submitReminderPolicy = async () => {
    try {
      const payload = await buildReminderPolicyPayload();
      await saveReminderPolicyMutation.mutateAsync(payload);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Không thể lưu chính sách nhắc việc.');
    }
  };

  const simulateReminderPolicy = async () => {
    try {
      const payload = await buildReminderPolicyPayload();
      await simulateReminderPolicyMutation.mutateAsync(payload);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : 'Không thể mô phỏng chính sách nhắc việc.');
    }
  };

  const submitApprovalPolicy = async () => {
    const values = await approvalPolicyForm.validateFields();
    await saveApprovalPolicyMutation.mutateAsync({
      sla_hours_l1: Number(values.sla_hours_l1 ?? 0),
      sla_hours_l2: Number(values.sla_hours_l2 ?? 0),
      remind_every_hours: Number(values.remind_every_hours ?? 0),
      escalation_hours_l1: Number(values.escalation_hours_l1 ?? 0),
      escalation_hours_l2: Number(values.escalation_hours_l2 ?? 0),
      escalation_cooldown_hours: Number(values.escalation_cooldown_hours ?? 0),
      window_days: Number(values.window_days ?? 0),
    });
  };

  const refreshCommandCenter = async () => {
    await Promise.all([
      invalidateAdvanceWorkspace(),
      invalidateAdvanceControlCenter(),
      invalidateAdvancePolicies(),
    ]);
    messageApi.success('Đã làm mới trung tâm điều phối tạm ứng');
  };

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
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailAdvanceId(row.id)}>
            Xem
          </Button>
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

  const approvalQueueColumns: ColumnsType<AdvanceApprovalQueueItem> = [
    { title: 'Mã phiếu', dataIndex: 'code', width: 120 },
    { title: 'Người nhận', dataIndex: 'recipient_name', width: 180 },
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      width: 140,
      align: 'right',
      render: (value: string) => formatMoney(value),
    },
    { title: 'Ngày tạm ứng', dataIndex: 'advance_date', width: 120 },
    {
      title: 'Cấp duyệt',
      dataIndex: 'required_approval_level',
      width: 120,
      render: (value: number) => <Tag color={value === 1 ? 'gold' : 'orange'}>{`L${value}`}</Tag>,
    },
  ];

  const overdueColumns: ColumnsType<AdvanceOverdueOverviewItem> = [
    { title: 'Mã phiếu', dataIndex: 'code', width: 120 },
    { title: 'Người nhận', dataIndex: 'recipient_name', width: 180 },
    {
      title: 'Quá hạn',
      dataIndex: 'days_overdue',
      width: 110,
      align: 'right',
      render: (value: number) => <Text strong style={{ color: value >= 90 ? '#cf1322' : '#d46b08' }}>{`${value} ngày`}</Text>,
    },
    {
      title: 'Còn phải quyết toán',
      dataIndex: 'remaining_amount',
      width: 160,
      align: 'right',
      render: (value: string) => formatMoney(value),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (value: AdvanceTransactionStatus) => <Tag color={statusColor(value)}>{STATUS_OPTIONS.find((item) => item.value === value)?.label ?? value}</Tag>,
    },
  ];

  const reminderHistoryColumns: ColumnsType<AdvanceReminderHistoryItem> = [
    {
      title: 'Thời điểm',
      dataIndex: 'created_at',
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
    { title: 'Tiêu đề', dataIndex: 'title', width: 220 },
    {
      title: 'Người nhận',
      dataIndex: 'recipient_names',
      width: 220,
      render: (value: string[]) => (value && value.length > 0 ? value.join(', ') : '-'),
    },
    {
      title: 'Đã gửi',
      dataIndex: 'sent_count',
      width: 90,
      align: 'right',
    },
    {
      title: 'Tỷ lệ đọc',
      dataIndex: 'read_rate',
      width: 110,
      align: 'right',
      render: (value: number) => formatPercent(value),
    },
  ];

  const reminderPolicyHistoryColumns: ColumnsType<AdvanceReminderPolicyHistoryItem> = [
    {
      title: 'Thời điểm',
      dataIndex: 'created_at',
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
    { title: 'Người cập nhật', dataIndex: 'username', width: 150 },
    {
      title: 'Trường thay đổi',
      dataIndex: 'changed_fields',
      render: (value: string[]) =>
        value && value.length > 0 ? (
          <Space size={[4, 4]} wrap>
            {value.map((field) => (
              <Tag key={field}>{field}</Tag>
            ))}
          </Space>
        ) : (
          '-'
        ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 130,
      render: (_, row) => (
        <Button
          size="small"
          disabled={!canManage}
          loading={rollbackReminderPolicyMutation.isPending}
          onClick={() =>
            Modal.confirm({
              title: 'Khôi phục cấu hình nhắc việc?',
              content: `Hoàn nguyên về phiên bản do ${row.username} lưu lúc ${formatDateTime(row.created_at)}.`,
              okText: 'Khôi phục',
              cancelText: 'Đóng',
              onOk: () => rollbackReminderPolicyMutation.mutateAsync(row.id),
            })
          }
        >
          Khôi phục
        </Button>
      ),
    },
  ];

  const approvalSlaHistoryColumns: ColumnsType<AdvanceApprovalSlaReminderHistoryItem> = [
    {
      title: 'Luồng duyệt',
      dataIndex: 'level_label',
      width: 140,
      render: (value: string, row) => <Tag color={row.level_key === 1 ? 'gold' : 'orange'}>{value}</Tag>,
    },
    {
      title: 'Lần nhắc gần nhất',
      dataIndex: 'latest_created_at',
      width: 180,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: 'Đã gửi',
      dataIndex: 'sent_count',
      width: 90,
      align: 'right',
    },
    {
      title: 'Chưa đọc',
      dataIndex: 'unread_count',
      width: 90,
      align: 'right',
    },
    {
      title: 'Tỷ lệ đọc',
      dataIndex: 'read_rate',
      width: 110,
      align: 'right',
      render: (value: number) => formatPercent(value),
    },
    {
      title: 'Mẫu người nhận',
      dataIndex: 'sample_recipients',
      render: (value: string[]) => (value && value.length > 0 ? value.join(', ') : '-'),
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Trung tâm tạm ứng và quyết toán
          </Title>
          <Text type="secondary">
            Điều phối phiếu tạm ứng, luồng duyệt, công nợ quá hạn và chính sách nhắc việc trong cùng một màn hình.
          </Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void refreshCommandCenter()}>
            Làm mới dữ liệu
          </Button>
          <Button
            disabled={!canManage}
            loading={remindPendingApprovalsMutation.isPending}
            onClick={() => remindPendingApprovalsMutation.mutate(undefined)}
          >
            Nhắc duyệt đang treo
          </Button>
          <Button
            disabled={!canManage}
            loading={remindOverdueMutation.isPending}
            onClick={() => remindOverdueMutation.mutate(undefined)}
          >
            Nhắc quá hạn quyết toán
          </Button>
          <Button
            icon={<DownloadOutlined />}
            loading={exportOverdueReportMutation.isPending}
            onClick={() => exportOverdueReportMutation.mutate(undefined)}
          >
            Xuất báo cáo quá hạn
          </Button>
          {controlTab === 'workspace' && (
            <Button onClick={exportCurrentViewCsv}>Xuất CSV màn đang xem</Button>
          )}
          {controlTab === 'policy' && (
            <>
              <Button onClick={openReminderPolicyEditor}>Cấu hình nhắc việc</Button>
              <Button onClick={openApprovalPolicyEditor}>Cấu hình SLA duyệt</Button>
            </>
          )}
          {controlTab === 'workspace' && viewMode === 'advances' ? (
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
              Tạo phiếu tạm ứng
            </Button>
          ) : (
            controlTab === 'workspace' && (
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
                Tạo quyết toán
              </Button>
            )
          )}
        </Space>
      </div>

      <Tabs
        activeKey={controlTab}
        onChange={(value) => setControlTab(value as ControlTab)}
        items={[
          { key: 'overview', label: 'Tổng quan điều phối' },
          { key: 'workspace', label: 'Tác nghiệp phiếu' },
          { key: 'policy', label: 'Chính sách & lịch sử' },
        ]}
      />

      {controlTab === 'overview' && (
        <>
          {(commandSummary.overdueApprovals > 0 || commandSummary.overdueAdvances > 0) && (
            <Alert
              type="warning"
              showIcon
              message="Có điểm nghẽn cần xử lý ngay"
              description={`Đang có ${commandSummary.overdueApprovals} phiếu chậm SLA duyệt và ${commandSummary.overdueAdvances} phiếu quá hạn quyết toán.`}
            />
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Phiếu chờ duyệt" value={commandSummary.pendingApprovals} loading={commandCenterLoading} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Phiếu quá SLA duyệt" value={commandSummary.overdueApprovals} loading={commandCenterLoading} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tạm ứng quá hạn quyết toán" value={commandSummary.overdueAdvances} loading={commandCenterLoading} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Giá trị còn treo quá hạn" value={Number(commandSummary.overdueRemaining)} suffix="đ" precision={0} loading={commandCenterLoading} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tỷ lệ đọc nhắc việc" value={Number(commandSummary.reminderReadRate)} suffix="%" precision={1} loading={commandCenterLoading} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Lead time duyệt trung bình" value={Number(commandSummary.averageApprovalLeadHours)} suffix="giờ" precision={1} loading={commandCenterLoading} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
            <Card
              title="Hàng chờ duyệt"
              extra={
                <Space size={8}>
                  <Tag color="gold">{`L1: ${approvalQueue?.pending_l1_count ?? 0}`}</Tag>
                  <Tag color="orange">{`L2: ${approvalQueue?.pending_l2_count ?? 0}`}</Tag>
                </Space>
              }
              loading={approvalQueueQuery.isLoading}
            >
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                columns={approvalQueueColumns}
                dataSource={approvalQueue?.items ?? []}
                scroll={{ x: 640 }}
              />
            </Card>

            <Card
              title="Phiếu quá hạn nổi bật"
              extra={<Tag color="red">{`Mốc báo cáo: ${overdueReport?.summary.overdue_days ?? 30} ngày`}</Tag>}
              loading={overdueOverviewQuery.isLoading || overdueReportQuery.isLoading}
            >
              <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
                {(overdueOverview?.buckets ?? []).map((bucket) => (
                  <Tag key={bucket.threshold_days} color={bucket.threshold_days >= 90 ? 'red' : 'volcano'}>
                    {`>= ${bucket.threshold_days} ngày: ${bucket.count} phiếu / ${formatMoney(bucket.total_remaining)}`}
                  </Tag>
                ))}
              </Space>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                columns={overdueColumns}
                dataSource={overdueOverview?.top_urgent ?? []}
                scroll={{ x: 700 }}
              />
            </Card>

            <Card
              title="Nút thắt người gửi phiếu"
              extra={<Tag>{`Cửa sổ SLA: ${approvalSlaOverview?.policy.window_days ?? 30} ngày`}</Tag>}
              loading={approvalSlaOverviewQuery.isLoading}
            >
              <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
                <Tag color="red">{`Quá SLA L1: ${approvalSlaOverview?.overdue_l1_count ?? 0}`}</Tag>
                <Tag color="red">{`Quá SLA L2: ${approvalSlaOverview?.overdue_l2_count ?? 0}`}</Tag>
                <Tag color="blue">{`Đã duyệt trong kỳ: ${approvalSlaOverview?.approved_count ?? 0}`}</Tag>
              </Space>
              <Table
                rowKey="username"
                size="small"
                pagination={false}
                dataSource={approvalSlaOverview?.top_blocked_submitters ?? []}
                columns={[
                  { title: 'Người gửi', dataIndex: 'username', width: 160 },
                  { title: 'Phiếu treo', dataIndex: 'pending_count', width: 90, align: 'right' },
                  {
                    title: 'Tổng tiền treo',
                    dataIndex: 'total_amount',
                    width: 140,
                    align: 'right',
                    render: (value: string) => formatMoney(value),
                  },
                  {
                    title: 'Chờ lâu nhất',
                    dataIndex: 'max_wait_hours',
                    width: 120,
                    align: 'right',
                    render: (value: number) => `${Number(value ?? 0).toFixed(1)} giờ`,
                  },
                ]}
                locale={{ emptyText: 'Chưa có nút thắt nổi bật' }}
                scroll={{ x: 560 }}
              />
            </Card>

            <Card
              title="Lịch sử nhắc việc 30 ngày"
              extra={
                <Space size={8}>
                  <Tag color="blue">{`Đã gửi: ${reminderHistory?.summary?.total_sent ?? 0}`}</Tag>
                  <Tag color="green">{`Đọc: ${formatPercent(reminderHistory?.summary?.overall_read_rate ?? 0)}`}</Tag>
                </Space>
              }
              loading={reminderHistoryQuery.isLoading}
            >
              <Table
                rowKey={(row) => `${row.entity_id}-${row.created_at}`}
                size="small"
                pagination={false}
                columns={reminderHistoryColumns}
                dataSource={reminderHistory?.items ?? []}
                scroll={{ x: 760 }}
              />
            </Card>
          </div>
        </>
      )}

      {controlTab === 'workspace' && (
        <>
          <Segmented
            options={[
              { label: 'Phiếu tạm ứng', value: 'advances' },
              { label: 'Quyết toán', value: 'settlements' },
            ]}
            value={viewMode}
            onChange={(value) => setViewMode(value as ViewMode)}
          />

          {activeFilterTags.length > 0 && (
            <Space wrap size={[8, 8]}>
              {activeFilterTags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </Space>
          )}

          <div style={{ ...PANEL_STYLE, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setAdvancesPage(1);
                setSettlementsPage(1);
              }}
              placeholder="Tìm kiếm mã phiếu, người nhận, mục đích..."
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
                placeholder="Trạng thái nghiệp vụ"
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
                  setFilters((prev) => ({
                    ...prev,
                    approval_status: (value ?? '') as '' | AdvanceApprovalStatus,
                  }));
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
              Đặt lại bộ lọc
            </Button>
          </div>

          {viewMode === 'advances' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div style={SUMMARY_TILE_STYLE}>
                  <div style={{ color: '#8c8c8c' }}>Tổng tạm ứng trên trang</div>
                  <div style={{ fontWeight: 700, fontSize: 20 }}>{formatMoney(summary.totalAdvance)}</div>
                </div>
                <div style={SUMMARY_TILE_STYLE}>
                  <div style={{ color: '#8c8c8c' }}>Đã chi thực tế trên trang</div>
                  <div style={{ fontWeight: 700, color: '#1677ff', fontSize: 20 }}>{formatMoney(summary.totalSpent)}</div>
                </div>
                <div style={SUMMARY_TILE_STYLE}>
                  <div style={{ color: '#8c8c8c' }}>Đã hoàn ứng trên trang</div>
                  <div style={{ fontWeight: 700, color: '#389e0d', fontSize: 20 }}>{formatMoney(summary.totalRefund)}</div>
                </div>
                <div style={SUMMARY_TILE_STYLE}>
                  <div style={{ color: '#8c8c8c' }}>Còn phải quyết toán trên trang</div>
                  <div style={{ fontWeight: 700, color: '#cf1322', fontSize: 20 }}>{formatMoney(summary.totalRemaining)}</div>
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
        </>
      )}

      {controlTab === 'policy' && (
        <>
          {reminderPolicy?.recommendation && (
            <Alert
              type="info"
              showIcon
              message={`Khuyến nghị preset: ${reminderPolicy.recommendation.recommended_preset_key}`}
              description={reminderPolicy.recommendation.reason}
            />
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <Card
              title="Chính sách nhắc quyết toán"
              extra={<Button onClick={openReminderPolicyEditor}>Cập nhật</Button>}
              loading={reminderPolicyQuery.isLoading}
            >
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text>{`Ngưỡng mặc định: ${reminderPolicy?.default_threshold_days ?? 0} ngày`}</Text>
                <Text>{`Cooldown: ${reminderPolicy?.cooldown_hours ?? 0} giờ`}</Text>
                <Text>{`Vai trò có ngưỡng riêng: ${Object.keys(reminderPolicy?.role_threshold_days ?? {}).length}`}</Text>
                <Text>{`Người dùng có ngưỡng riêng: ${Object.keys(reminderPolicy?.user_threshold_days ?? {}).length}`}</Text>
              </Space>
            </Card>

            <Card
              title="Chính sách SLA duyệt"
              extra={<Button onClick={openApprovalPolicyEditor}>Cập nhật</Button>}
              loading={approvalPolicyQuery.isLoading || approvalSlaOverviewQuery.isLoading}
            >
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text>{`SLA cấp 1: ${approvalSlaPolicy?.sla_hours_l1 ?? approvalSlaOverview?.policy.sla_hours_l1 ?? 0} giờ`}</Text>
                <Text>{`SLA cấp 2: ${approvalSlaPolicy?.sla_hours_l2 ?? approvalSlaOverview?.policy.sla_hours_l2 ?? 0} giờ`}</Text>
                <Text>{`Chu kỳ nhắc: ${approvalSlaPolicy?.remind_every_hours ?? approvalSlaOverview?.policy.remind_every_hours ?? 0} giờ`}</Text>
                <Text>{`Ngưỡng escalation L1: ${approvalSlaPolicy?.escalation_hours_l1 ?? approvalSlaOverview?.policy.escalation_hours_l1 ?? 0} giờ`}</Text>
                <Text>{`Ngưỡng escalation L2: ${approvalSlaPolicy?.escalation_hours_l2 ?? approvalSlaOverview?.policy.escalation_hours_l2 ?? 0} giờ`}</Text>
                <Text>{`Cooldown escalation: ${approvalSlaPolicy?.escalation_cooldown_hours ?? approvalSlaOverview?.policy.escalation_cooldown_hours ?? 0} giờ`}</Text>
                <Text>{`Cửa sổ theo dõi: ${approvalSlaPolicy?.window_days ?? approvalSlaOverview?.policy.window_days ?? 0} ngày`}</Text>
              </Space>
            </Card>

            <Card title="Tóm tắt lịch sử nhắc duyệt" loading={approvalSlaReminderHistoryQuery.isLoading}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text>{`Đã gửi: ${approvalSlaReminderHistory?.summary.total_sent ?? 0}`}</Text>
                <Text>{`Đã đọc: ${approvalSlaReminderHistory?.summary.total_read ?? 0}`}</Text>
                <Text>{`Chưa đọc: ${approvalSlaReminderHistory?.summary.total_unread ?? 0}`}</Text>
                <Text>{`Tỷ lệ đọc: ${formatPercent(approvalSlaReminderHistory?.summary.overall_read_rate ?? 0)}`}</Text>
              </Space>
            </Card>
          </div>

          <Card title="Lịch sử thay đổi chính sách nhắc quyết toán">
            <Table
              rowKey="id"
              size="small"
              columns={reminderPolicyHistoryColumns}
              dataSource={reminderPolicyHistory?.items ?? []}
              pagination={false}
              scroll={{ x: 920 }}
            />
          </Card>

          <Card title="Lịch sử nhắc SLA duyệt">
            <Table
              rowKey={(row) => `${row.level_key}-${row.latest_created_at}`}
              size="small"
              columns={approvalSlaHistoryColumns}
              dataSource={approvalSlaReminderHistory?.items ?? []}
              pagination={false}
              scroll={{ x: 900 }}
            />
          </Card>
        </>
      )}

      <Modal
        title={detailAdvanceData ? `Chi tiết phiếu tạm ứng - ${detailAdvanceData.code}` : 'Chi tiết phiếu tạm ứng'}
        open={activeDetailAdvanceId !== null}
        onCancel={() => {
          setDetailAdvanceId(null);
          if (focusedAdvance?.id === activeDetailAdvanceId) {
            setDismissedFocusKey(focusKey);
          }
        }}
        footer={null}
        width={980}
      >
        {detailAdvanceData ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Mã phiếu">{detailAdvanceData.code}</Descriptions.Item>
              <Descriptions.Item label="Người nhận">{detailAdvanceData.recipient_name}</Descriptions.Item>
              <Descriptions.Item label="Loại tạm ứng">
                {ADVANCE_TYPE_OPTIONS.find((item) => item.value === detailAdvanceData.advance_type)?.label ?? detailAdvanceData.advance_type}
              </Descriptions.Item>
              <Descriptions.Item label="Ngày tạm ứng">{detailAdvanceData.advance_date}</Descriptions.Item>
              <Descriptions.Item label="Số tiền">{formatMoney(detailAdvanceData.amount)}</Descriptions.Item>
              <Descriptions.Item label="Còn phải quyết toán">{formatMoney(detailAdvanceData.remaining_amount)}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                <Tag color={statusColor(detailAdvanceData.status)}>
                  {STATUS_OPTIONS.find((item) => item.value === detailAdvanceData.status)?.label ?? detailAdvanceData.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Duyệt">
                <Space size={6} wrap>
                  <Tag color={approvalColor(detailAdvanceData.approval_status)}>
                    {APPROVAL_STATUS_OPTIONS.find((item) => item.value === detailAdvanceData.approval_status)?.label ?? detailAdvanceData.approval_status}
                  </Tag>
                  <Tag color={detailAdvanceData.required_approval_level > 1 ? 'orange' : 'gold'}>
                    {`L${detailAdvanceData.required_approval_level}`}
                  </Tag>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Chi tiền">
                <Tag color={detailAdvanceData.disbursement_status === 'DISBURSED' ? 'green' : 'default'}>
                  {detailAdvanceData.disbursement_status === 'DISBURSED' ? 'Đã chi' : 'Chưa chi'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Nguồn tiền">
                {detailAdvanceData.source_type === 'BANK'
                  ? `Ngân hàng ${detailAdvanceData.source_bank_account_code || ''}`.trim()
                  : `Quỹ ${detailAdvanceData.source_cash_account_name || ''}`.trim()}
              </Descriptions.Item>
              <Descriptions.Item label="Đã chi">{formatMoney(detailAdvanceData.total_spent)}</Descriptions.Item>
              <Descriptions.Item label="Hoàn ứng">{formatMoney(detailAdvanceData.total_refund)}</Descriptions.Item>
              <Descriptions.Item label="Gửi duyệt">{formatDateTime(detailAdvanceData.submitted_at)}</Descriptions.Item>
              <Descriptions.Item label="Chi tiền lúc">{formatDateTime(detailAdvanceData.disbursed_at)}</Descriptions.Item>
              <Descriptions.Item label="Mục đích" span={2}>
                {detailAdvanceData.purpose || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Ghi chú" span={2}>
                {detailAdvanceData.note || '-'}
              </Descriptions.Item>
              {detailAdvanceData.rejection_reason ? (
                <Descriptions.Item label="Lý do từ chối" span={2}>
                  {detailAdvanceData.rejection_reason}
                </Descriptions.Item>
              ) : null}
            </Descriptions>

            <div>
              <Title level={5}>Lịch sử duyệt</Title>
              <Table<AdvanceApprovalHistoryItem>
                rowKey={(row) => `${row.action}-${row.level ?? 0}-${row.created_at}`}
                loading={approvalHistoryQuery.isLoading}
                dataSource={approvalHistoryQuery.data ?? []}
                pagination={false}
                locale={{ emptyText: 'Phiếu tạm ứng này chưa có lịch sử duyệt.' }}
                columns={[
                  {
                    title: 'Hành động',
                    dataIndex: 'action',
                    width: 180,
                    render: (_, row) => row.action_label || row.action,
                  },
                  {
                    title: 'Người thực hiện',
                    dataIndex: 'user',
                    width: 180,
                    render: (value) => value || '-',
                  },
                  {
                    title: 'Ghi chú',
                    dataIndex: 'comments',
                    width: 280,
                    render: (value) => value || '-',
                  },
                  {
                    title: 'Thời gian',
                    dataIndex: 'created_at',
                    width: 180,
                    render: (value) => formatDateTime(value),
                  },
                ]}
                scroll={{ x: 820 }}
              />
            </div>
          </Space>
        ) : null}
      </Modal>

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
        title="Chính sách nhắc quyết toán tạm ứng"
        open={openReminderPolicyModal}
        onCancel={() => {
          setOpenReminderPolicyModal(false);
          setPolicySimulation(null);
        }}
        onOk={() => void submitReminderPolicy()}
        width={760}
        okText="Lưu chính sách"
        confirmLoading={saveReminderPolicyMutation.isPending}
        footer={[
          <Button key="simulate" onClick={() => void simulateReminderPolicy()} loading={simulateReminderPolicyMutation.isPending}>
            Mô phỏng
          </Button>,
          <Button
            key="cancel"
            onClick={() => {
              setOpenReminderPolicyModal(false);
              setPolicySimulation(null);
            }}
          >
            Đóng
          </Button>,
          <Button key="save" type="primary" onClick={() => void submitReminderPolicy()} loading={saveReminderPolicyMutation.isPending}>
            Lưu chính sách
          </Button>,
        ]}
      >
        <Form form={reminderPolicyForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item
              name="default_threshold_days"
              label="Ngưỡng mặc định (ngày)"
              rules={[{ required: true, message: 'Bắt buộc' }]}
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="cooldown_hours"
              label="Khoảng nghỉ giữa các lần nhắc (giờ)"
              rules={[{ required: true, message: 'Bắt buộc' }]}
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item
            name="role_threshold_days_text"
            label="Ngưỡng riêng theo vai trò (JSON)"
            tooltip='Ví dụ: {"finance_manager": 15, "procurement_manager": 20}'
          >
            <Input.TextArea rows={5} />
          </Form.Item>
          <Form.Item
            name="user_threshold_days_text"
            label="Ngưỡng riêng theo người dùng (JSON)"
            tooltip='Ví dụ: {"an.nguyen": 10, "thu.le": 45}'
          >
            <Input.TextArea rows={5} />
          </Form.Item>
        </Form>
        {policySimulation && (
          <div style={{ ...PANEL_STYLE, marginTop: 12 }}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Text strong>Kết quả mô phỏng</Text>
              <Text>{`Sẽ gửi nhắc cho ${policySimulation.would_send_count} người`}</Text>
              <Text>{`Danh sách: ${policySimulation.would_send_usernames.join(', ') || 'Không có'}`}</Text>
              {policySimulation.skipped_cooldown_usernames && policySimulation.skipped_cooldown_usernames.length > 0 && (
                <Text type="secondary">{`Bỏ qua do cooldown: ${policySimulation.skipped_cooldown_usernames.join(', ')}`}</Text>
              )}
              {policySimulation.snapshot && (
                <Text type="secondary">
                  {`Ảnh chụp tại ${policySimulation.snapshot.as_of}, ngưỡng áp dụng: ${
                    policySimulation.snapshot.threshold_days ?? 'theo chính sách'
                  } ngày`}
                </Text>
              )}
            </Space>
          </div>
        )}
      </Modal>

      <Modal
        title="Chính sách SLA duyệt tạm ứng"
        open={openApprovalPolicyModal}
        onCancel={() => setOpenApprovalPolicyModal(false)}
        onOk={() => void submitApprovalPolicy()}
        okText="Lưu chính sách"
        confirmLoading={saveApprovalPolicyMutation.isPending}
      >
        <Form form={approvalPolicyForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="sla_hours_l1" label="SLA cấp 1 (giờ)" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="sla_hours_l2" label="SLA cấp 2 (giờ)" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="remind_every_hours"
              label="Chu kỳ nhắc (giờ)"
              rules={[{ required: true, message: 'Bắt buộc' }]}
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="escalation_hours_l1"
              label="Ngưỡng escalation cấp 1 (giờ)"
              rules={[{ required: true, message: 'Bắt buộc' }]}
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="escalation_hours_l2"
              label="Ngưỡng escalation cấp 2 (giờ)"
              rules={[{ required: true, message: 'Bắt buộc' }]}
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="escalation_cooldown_hours"
              label="Cooldown escalation (giờ)"
              rules={[{ required: true, message: 'Bắt buộc' }]}
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="window_days" label="Cửa sổ thống kê (ngày)" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
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

