import { useMemo, useState, type CSSProperties } from 'react';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { financeApi } from '../../api/finance';
import { workforceApi } from '../../api/workforce';
import type { BankAccount, CashAccount } from '../../types/finance';
import type {
  Employee,
  SalaryAdvanceApprovalHistoryItem,
  SalaryAdvanceApprovalSlaPolicy,
  SalaryAdvanceApprovalSlaReminderHistoryItem,
  SalaryAdvanceApprovalStatus,
  SalaryAdvanceRecord,
  SalaryAdvanceRecordPayload,
  SalaryAdvanceStatus,
} from '../../types/workforce';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { canManageWorkforceData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

const { Text, Title } = Typography;

type SalaryAdvanceFilters = {
  month: string;
  status: '' | SalaryAdvanceStatus;
  approval_status: '' | SalaryAdvanceApprovalStatus;
};

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

const SUMMARY_TILE_STYLE: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
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
        parsed.approval_status === 'DRAFT'
        || parsed.approval_status === 'PENDING_L1'
        || parsed.approval_status === 'PENDING_L2'
        || parsed.approval_status === 'APPROVED'
        || parsed.approval_status === 'REJECTED'
          ? parsed.approval_status
          : '',
    };
  } catch {
    return { month: currentMonth, status: '', approval_status: '' };
  }
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number): string {
  return `${value.toLocaleString('vi-VN')} đ`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('vi-VN');
}

function formatPercent(value: number | null | undefined): string {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function getSalaryAdvanceNextStep(row: SalaryAdvanceRecord, canManage: boolean): string {
  if (!canManage) {
    return 'Theo dõi trạng thái duyệt và liên hệ người phụ trách nhân sự khi cần cập nhật.';
  }
  if (row.approval_status === 'DRAFT') {
    return 'Kiểm tra thông tin nhân viên, số tiền và gửi duyệt khi hồ sơ đã đủ dữ liệu.';
  }
  if (row.approval_status === 'PENDING_L1') {
    return 'Chờ duyệt L1; người quản lý nên duyệt hoặc từ chối kèm lý do rõ ràng.';
  }
  if (row.approval_status === 'PENDING_L2') {
    return 'Chờ duyệt L2; ưu tiên chốt trước khi giải ngân.';
  }
  if (row.approval_status === 'REJECTED') {
    return 'Xem lý do từ chối, sửa hồ sơ và gửi duyệt lại nếu vẫn cần ứng lương.';
  }
  if (row.approval_status === 'APPROVED' && row.disbursement_status !== 'DISBURSED') {
    return 'Hồ sơ đã duyệt; chọn nguồn tiền và ghi nhận chi tiền.';
  }
  if (row.disbursement_status === 'DISBURSED' && row.status === 'UNDEDUCTED') {
    return 'Đã chi tiền; theo dõi khấu trừ trong kỳ lương tương ứng.';
  }
  return 'Hồ sơ đã hoàn tất luồng chính; chỉ mở chi tiết khi cần đối soát lịch sử.';
}

function getSalaryAdvanceEditLockReason(row: SalaryAdvanceRecord): string {
  if (row.approval_status === 'PENDING_L1' || row.approval_status === 'PENDING_L2') {
    return 'Hồ sơ đang chờ duyệt nên không sửa/xóa để giữ nguyên dấu vết phê duyệt.';
  }
  if (row.approval_status === 'APPROVED') {
    return 'Hồ sơ đã duyệt nên không sửa/xóa; nếu sai cần xử lý theo quy trình hủy/đối soát.';
  }
  return '';
}

export default function SalaryAdvanceList() {
  const [searchParams] = useSearchParams();
  const initialSearch = searchParams.get('q') || searchParams.get('search') || '';
  const initialStatusParam = searchParams.get('status');
  const initialApprovalStatusParam = searchParams.get('approval_status');
  const initialFocusId = Number(searchParams.get('focus_id') || 0) || null;
  const initialFilters: SalaryAdvanceFilters = {
    month: searchParams.get('month') || currentMonth,
    status: initialStatusParam === 'UNDEDUCTED' || initialStatusParam === 'DEDUCTED' ? initialStatusParam : '',
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
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [filters, setFilters] = useState<SalaryAdvanceFilters>(initialFilters);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SalaryAdvanceRecord | null>(null);
  const [detailAdvanceId, setDetailAdvanceId] = useState<number | null>(null);
  const [dismissedInitialFocus, setDismissedInitialFocus] = useState(false);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<SalaryAdvanceForm>();
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [rejectReason, setRejectReason] = useState('');
  const [rejectForm] = Form.useForm();
  const [disbursementModal, setDisbursementModal] = useState<{ open: boolean; row: SalaryAdvanceRecord | null }>({ open: false, row: null });
  const [disbursementForm] = Form.useForm<DisbursementForm>();
  const [approvalPolicyModalOpen, setApprovalPolicyModalOpen] = useState(false);
  const [approvalPolicyForm] = Form.useForm<ApprovalPolicyForm>();
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
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: '-advance_date' };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.month) next.month = intentFilters.month;
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.approval_status) next.approval_status = intentFilters.approval_status;
    return next;
  }, [intentFilters, intentSearch, page, pageSize]);

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
  const approvalSlaReminderHistoryQuery = useQuery({
    queryKey: ['workforce-salary-advances-approval-sla-reminder-history', 30],
    queryFn: () => workforceApi.getSalaryAdvanceApprovalSlaReminderHistory({ days: 30 }),
    enabled: canManage,
  });
  const approvalSlaPolicyQuery = useQuery({
    queryKey: ['workforce-salary-advances-approval-sla-policy'],
    queryFn: () => workforceApi.getSalaryAdvanceApprovalSlaPolicy(),
    enabled: canManage,
  });
  const effectiveDetailAdvanceId = detailAdvanceId ?? (!dismissedInitialFocus ? initialFocusId : null);
  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const detailAdvanceData = useMemo(
    () => rows.find((item) => item.id === effectiveDetailAdvanceId) ?? null,
    [effectiveDetailAdvanceId, rows]
  );
  const approvalHistoryQuery = useQuery({
    queryKey: ['workforce-salary-advances-approval-history', detailAdvanceData?.id],
    queryFn: () => workforceApi.getSalaryAdvanceApprovalHistory(detailAdvanceData!.id),
    enabled: Boolean(detailAdvanceData?.id),
  });

  const invalidateList = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances'] }),
      queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances-approval-history'] }),
    ]);
  };
  const invalidateCommandCenter = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances-approval-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances-approval-sla-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances-approval-sla-reminder-history'] }),
      queryClient.invalidateQueries({ queryKey: ['workforce-salary-advances-approval-sla-policy'] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: workforceApi.createSalaryAdvance,
    onSuccess: async () => {
      await invalidateList();
      await invalidateCommandCenter();
      messageApi.success('Đã thêm ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<SalaryAdvanceRecordPayload> }) => workforceApi.updateSalaryAdvance(id, payload),
    onSuccess: async () => {
      await invalidateList();
      await invalidateCommandCenter();
      messageApi.success('Đã cập nhật ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: workforceApi.deleteSalaryAdvance,
    onSuccess: async () => {
      await invalidateList();
      await invalidateCommandCenter();
      messageApi.success('Đã xóa ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const submitApprovalMutation = useMutation({
    mutationFn: (id: number) => workforceApi.submitSalaryAdvanceApproval(id),
    onSuccess: async () => {
      await invalidateList();
      await invalidateCommandCenter();
      messageApi.success('Đã gửi duyệt ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const approveLevel1Mutation = useMutation({
    mutationFn: (id: number) => workforceApi.approveSalaryAdvanceLevel1(id),
    onSuccess: async () => {
      await invalidateList();
      await invalidateCommandCenter();
      messageApi.success('Đã duyệt L1 ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const approveLevel2Mutation = useMutation({
    mutationFn: (id: number) => workforceApi.approveSalaryAdvanceLevel2(id),
    onSuccess: async () => {
      await invalidateList();
      await invalidateCommandCenter();
      messageApi.success('Đã duyệt L2 ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const rejectApprovalMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => workforceApi.rejectSalaryAdvanceApproval(id, reason),
    onSuccess: async () => {
      await invalidateList();
      await invalidateCommandCenter();
      messageApi.success('Đã từ chối duyệt ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const remindPendingApprovalsMutation = useMutation({
    mutationFn: () => workforceApi.remindSalaryAdvancePendingApprovals({ dry_run: false }),
    onSuccess: async (data) => {
      messageApi.success(`Đã gửi nhắc phê duyệt ứng lương: ${data.sent_count} người nhận`);
      await invalidateCommandCenter();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const previewPendingApprovalsMutation = useMutation({
    mutationFn: () => workforceApi.remindSalaryAdvancePendingApprovals({ dry_run: true }),
    onSuccess: (data) => {
      messageApi.success(`Mô phỏng xong: ${data.sent_count} người sẽ nhận nhắc duyệt ứng lương`);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const postDisbursementMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: DisbursementForm }) => workforceApi.postSalaryAdvanceDisbursement(id, payload),
    onSuccess: async () => {
      await invalidateList();
      await invalidateCommandCenter();
      messageApi.success('Đã ghi nhận chi tiền ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const reverseDisbursementMutation = useMutation({
    mutationFn: (id: number) => workforceApi.reverseSalaryAdvanceDisbursement(id),
    onSuccess: async () => {
      await invalidateList();
      await invalidateCommandCenter();
      messageApi.success('Đã hủy chứng từ chi tiền ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const saveApprovalPolicyMutation = useMutation({
    mutationFn: (payload: Partial<SalaryAdvanceApprovalSlaPolicy>) => workforceApi.saveSalaryAdvanceApprovalSlaPolicy(payload),
    onSuccess: async () => {
      await invalidateCommandCenter();
      setApprovalPolicyModalOpen(false);
      messageApi.success('Đã cập nhật chính sách SLA duyệt ứng lương');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const employees = (employeesQuery.data?.results ?? []).filter((item) => item.is_active && item.status !== 'RESIGNED');
  const cashAccounts = cashAccountsQuery.data?.results ?? [];
  const bankAccounts = bankAccountsQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;

  const summary = useMemo(() => {
    const totalAmount = rows.reduce((acc, item) => acc + toNumber(item.amount), 0);
    const undeducted = rows.filter((item) => item.status === 'UNDEDUCTED').reduce((acc, item) => acc + toNumber(item.amount), 0);
    const deducted = rows.filter((item) => item.status === 'DEDUCTED').reduce((acc, item) => acc + toNumber(item.amount), 0);
    const approvedNotDisbursed = rows
      .filter((item) => item.approval_status === 'APPROVED' && item.disbursement_status !== 'DISBURSED')
      .reduce((acc, item) => acc + toNumber(item.amount), 0);
    const disbursedNotDeducted = rows
      .filter((item) => item.disbursement_status === 'DISBURSED' && item.status === 'UNDEDUCTED')
      .reduce((acc, item) => acc + toNumber(item.amount), 0);
    return { totalAmount, undeducted, deducted, approvedNotDisbursed, disbursedNotDeducted };
  }, [rows]);

  const approvalMetrics = useMemo(() => {
    const pendingL1 = Number(approvalQueueQuery.data?.pending_l1_count ?? 0);
    const pendingL2 = Number(approvalQueueQuery.data?.pending_l2_count ?? 0);
    const overdueL1 = Number(approvalSlaOverviewQuery.data?.overdue_l1_count ?? 0);
    const overdueL2 = Number(approvalSlaOverviewQuery.data?.overdue_l2_count ?? 0);
    return {
      pendingL1,
      pendingL2,
      pendingTotal: pendingL1 + pendingL2,
      overdueTotal: overdueL1 + overdueL2,
      escalationTotal: Number(approvalSlaOverviewQuery.data?.escalation_l1_count ?? 0) + Number(approvalSlaOverviewQuery.data?.escalation_l2_count ?? 0),
      avgLeadHours: Number(approvalSlaOverviewQuery.data?.avg_lead_hours ?? 0),
      blockedSubmitters: approvalSlaOverviewQuery.data?.top_blocked_submitters ?? [],
    };
  }, [approvalQueueQuery.data, approvalSlaOverviewQuery.data]);
  const approvalPolicy = approvalSlaPolicyQuery.data ?? approvalSlaOverviewQuery.data?.policy;
  const approvalReminderHistory = approvalSlaReminderHistoryQuery.data;

  const activeFilterTags = useMemo(() => {
    const tags = [`Tháng trừ: ${intentFilters.month || currentMonth}`];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.status) tags.push(`Trạng thái: ${STATUS_OPTIONS.find((item) => item.value === intentFilters.status)?.label ?? intentFilters.status}`);
    if (intentFilters.approval_status) {
      tags.push(`Duyệt: ${APPROVAL_STATUS_OPTIONS.find((item) => item.value === intentFilters.approval_status)?.label ?? intentFilters.approval_status}`);
    }
    return tags;
  }, [intentFilters, intentSearch]);

  const openApprovalPolicyEditor = () => {
    const current = approvalPolicy ?? {
      sla_hours_l1: 8,
      sla_hours_l2: 16,
      remind_every_hours: 4,
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
    setApprovalPolicyModalOpen(true);
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

  const statusAlert = useMemo(() => {
    if (!canManage) {
      return {
        type: 'info' as const,
        message: 'Bạn đang xem dữ liệu ứng lương theo quyền hiện tại.',
        description: 'Các thao tác duyệt, nhắc phê duyệt và giải ngân sẽ xuất hiện khi tài khoản có quyền quản lý nhân sự.',
      };
    }
    if (approvalMetrics.overdueTotal > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${approvalMetrics.overdueTotal} hồ sơ ứng lương quá hạn phê duyệt.`,
        description: 'Ưu tiên xử lý các hồ sơ chờ L1/L2 trước để tránh dồn tắc giải ngân trong kỳ lương đang xem.',
      };
    }
    if (approvalMetrics.pendingTotal > 0) {
      return {
        type: 'info' as const,
        message: `Đang có ${approvalMetrics.pendingTotal} hồ sơ nằm trong hàng đợi duyệt.`,
        description: `Thời gian xử lý bình quân hiện tại là ${approvalMetrics.avgLeadHours.toFixed(2)} giờ.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Luồng ứng lương đang ổn định.',
      description: 'Không có hồ sơ quá hạn nổi bật trên bối cảnh hiện tại; bạn có thể tiếp tục theo dõi giải ngân và khấu trừ lương.',
    };
  }, [approvalMetrics.avgLeadHours, approvalMetrics.overdueTotal, approvalMetrics.pendingTotal, canManage]);

  const ownerNextStepAlert = useMemo(() => {
    if (!canManage) {
      return {
        type: 'info' as const,
        message: 'Bạn đang ở chế độ theo dõi theo quyền hiện tại.',
        description: 'Tiếp tục đọc trạng thái duyệt/chi tiền; mọi thao tác thay đổi cần tài khoản quản lý nhân sự.',
      };
    }
    if (approvalMetrics.overdueTotal > 0) {
      return {
        type: 'warning' as const,
        message: 'Bước tiếp theo: xử lý các hồ sơ quá hạn SLA trước.',
        description: 'Mở từng hồ sơ chờ L1/L2, duyệt hoặc từ chối có lý do để tránh tắc giải ngân trong kỳ lương.',
      };
    }
    if (approvalMetrics.pendingL1 > 0) {
      return {
        type: 'info' as const,
        message: 'Bước tiếp theo: chốt hàng đợi L1.',
        description: 'Ưu tiên hồ sơ chờ L1 để giảm tồn đọng trước khi chuyển sang cấp duyệt cuối.',
      };
    }
    if (approvalMetrics.pendingL2 > 0) {
      return {
        type: 'info' as const,
        message: 'Bước tiếp theo: chốt hàng đợi L2.',
        description: 'Các hồ sơ này đã qua bước đầu; cần quyết định cuối trước khi chi tiền.',
      };
    }
    if (summary.approvedNotDisbursed > 0) {
      return {
        type: 'warning' as const,
        message: 'Bước tiếp theo: giải ngân các hồ sơ đã duyệt.',
        description: `Còn ${formatCurrency(summary.approvedNotDisbursed)} đã duyệt nhưng chưa chi tiền.`,
      };
    }
    if (summary.disbursedNotDeducted > 0) {
      return {
        type: 'info' as const,
        message: 'Bước tiếp theo: theo dõi khấu trừ lương.',
        description: `Còn ${formatCurrency(summary.disbursedNotDeducted)} đã chi nhưng chưa trừ trong kỳ đang xem.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Luồng ứng lương không có việc nổi bật cần chốt ngay.',
      description: 'Tiếp tục theo dõi hàng đợi duyệt, lịch sử nhắc SLA và trạng thái chi/trừ lương.',
    };
  }, [
    approvalMetrics.overdueTotal,
    approvalMetrics.pendingL1,
    approvalMetrics.pendingL2,
    canManage,
    summary.approvedNotDisbursed,
    summary.disbursedNotDeducted,
  ]);

  const columns: ColumnsType<SalaryAdvanceRecord> = [
    { title: 'Ngày', dataIndex: 'advance_date', width: 110 },
    { title: 'Tháng trừ', dataIndex: 'month', width: 100 },
    { title: 'Mã NV', dataIndex: 'employee_code', width: 110 },
    { title: 'Tên NV', dataIndex: 'employee_name', width: 220 },
    { title: 'Số tiền', dataIndex: 'amount', width: 150, align: 'right', render: (value: string) => formatCurrency(toNumber(value)) },
    { title: 'Lý do', dataIndex: 'reason', width: 220 },
    { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (status: SalaryAdvanceStatus) => STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status },
    {
      title: 'Duyệt',
      dataIndex: 'approval_status',
      width: 130,
      render: (approvalStatus: SalaryAdvanceApprovalStatus) => {
        const label = APPROVAL_STATUS_OPTIONS.find((item) => item.value === approvalStatus)?.label ?? approvalStatus;
        const color = approvalStatus === 'APPROVED' ? 'green' : approvalStatus === 'REJECTED' ? 'red' : approvalStatus === 'PENDING_L1' || approvalStatus === 'PENDING_L2' ? 'gold' : 'default';
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: 'Chi tiền',
      dataIndex: 'disbursement_status',
      width: 120,
      render: (status: SalaryAdvanceRecord['disbursement_status']) => <Tag color={status === 'DISBURSED' ? 'green' : 'default'}>{status === 'DISBURSED' ? 'Đã chi' : 'Chưa chi'}</Tag>,
    },
    {
      title: 'Việc tiếp theo',
      key: 'next_step',
      width: 260,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text>{getSalaryAdvanceNextStep(row, canManage)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.required_approval_level > 1 ? 'Yêu cầu đủ 2 cấp duyệt.' : 'Yêu cầu 1 cấp duyệt.'}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 470,
      fixed: 'right',
      render: (_, row) => {
        const editLockReason = getSalaryAdvanceEditLockReason(row);
        return (
          <Space wrap>
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => {
                setDismissedInitialFocus(false);
                setDetailAdvanceId(row.id);
              }}
            >
              Xem
            </Button>
            {canManage && (
              <>
                {(row.approval_status === 'DRAFT' || row.approval_status === 'REJECTED') && (
                  <Button size="small" onClick={() => submitApprovalMutation.mutate(row.id)} loading={submitApprovalMutation.isPending}>Gửi duyệt</Button>
                )}
                {row.approval_status === 'PENDING_L1' && (
                  <Button size="small" onClick={() => approveLevel1Mutation.mutate(row.id)} loading={approveLevel1Mutation.isPending}>Duyệt L1</Button>
                )}
                {row.approval_status === 'PENDING_L2' && (
                  <Button size="small" type="primary" onClick={() => approveLevel2Mutation.mutate(row.id)} loading={approveLevel2Mutation.isPending}>Duyệt L2</Button>
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
                  disabled={Boolean(editLockReason)}
                  title={editLockReason || 'Sửa hồ sơ ứng lương'}
                  onClick={() => {
                    setEditing(row);
                    form.setFieldsValue({
                      employee: row.employee,
                      advance_date: row.advance_date,
                      month: row.month,
                      amount: toNumber(row.amount),
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
                  disabled={Boolean(editLockReason)}
                  title={editLockReason || 'Xóa hồ sơ ứng lương'}
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
        );
      },
    },
  ];

  const approvalReminderHistoryColumns: ColumnsType<SalaryAdvanceApprovalSlaReminderHistoryItem> = [
    {
      title: 'Luồng duyệt',
      dataIndex: 'level_label',
      width: 140,
      render: (value: string, row) => <Tag color={row.level_key === 1 ? 'gold' : row.level_key === 2 ? 'orange' : 'red'}>{value}</Tag>,
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
      width: 100,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <Space wrap>
                <Tag color="blue">Nhân sự</Tag>
                <Tag color="gold">Ứng lương</Tag>
                <Tag color={canManage ? 'processing' : 'default'}>{canManage ? 'Quy trình duyệt 2 cấp' : 'Theo quyền hiện tại'}</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>Trung tâm điều phối ứng lương</Title>
              <Text type="secondary">Theo dõi từ tạo phiếu, duyệt nhiều cấp đến giải ngân và khấu trừ lương theo tháng trên cùng một màn hình.</Text>
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

          <Alert showIcon type={statusAlert.type} message={statusAlert.message} description={statusAlert.description} />
          <Alert showIcon type={ownerNextStepAlert.type} message={ownerNextStepAlert.message} description={ownerNextStepAlert.description} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {[
              { title: 'Tổng ứng trên trang', value: summary.totalAmount, format: 'money' as const, color: undefined },
              { title: 'Chờ duyệt', value: approvalMetrics.pendingTotal, suffix: 'hồ sơ', color: approvalMetrics.pendingTotal > 0 ? '#d48806' : '#389e0d' },
              { title: 'Quá hạn SLA', value: approvalMetrics.overdueTotal, suffix: 'hồ sơ', color: approvalMetrics.overdueTotal > 0 ? '#cf1322' : '#389e0d' },
              { title: 'Đã duyệt chưa chi', value: summary.approvedNotDisbursed, format: 'money' as const, color: summary.approvedNotDisbursed > 0 ? '#d48806' : undefined },
              { title: 'Đã chi chưa trừ', value: summary.disbursedNotDeducted, format: 'money' as const, color: summary.disbursedNotDeducted > 0 ? '#cf1322' : undefined },
              { title: 'Thời gian xử lý TB', value: approvalMetrics.avgLeadHours, precision: 2, suffix: 'giờ', color: undefined },
            ].map((item) => (
              <div key={item.title} style={SUMMARY_TILE_STYLE}>
                <Statistic
                  title={item.title}
                  value={item.value}
                  precision={item.precision}
                  suffix={item.suffix}
                  valueStyle={item.color ? { color: item.color } : undefined}
                  formatter={(value) => item.format === 'money' ? formatCurrency(toNumber(value)) : value}
                />
              </div>
            ))}
          </div>

          <Space wrap>
            <Tag>{`Tháng đang xem: ${intentFilters.month || currentMonth}`}</Tag>
            <Tag color="warning">{`Chờ L1: ${approvalMetrics.pendingL1}`}</Tag>
            <Tag color="processing">{`Chờ L2: ${approvalMetrics.pendingL2}`}</Tag>
            <Tag color="error">{`Leo thang: ${approvalMetrics.escalationTotal}`}</Tag>
            <Tag color="success">{`Đã trừ trên trang: ${formatCurrency(summary.deducted)}`}</Tag>
            <Tag color="gold">{`Chưa trừ trên trang: ${formatCurrency(summary.undeducted)}`}</Tag>
          </Space>
        </Space>
      </Card>
      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
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
          <Space wrap>
            {activeFilterTags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        </Space>
      </Card>

      {canManage && (
        <Card
          title="Hàng đợi duyệt và cảnh báo tắc nghẽn"
          extra={
            <Space>
              <Button size="small" onClick={openApprovalPolicyEditor}>
                Cấu hình SLA
              </Button>
              <Button size="small" title="Chỉ mô phỏng danh sách nhắc, không gửi thông báo thật." loading={previewPendingApprovalsMutation.isPending} onClick={() => previewPendingApprovalsMutation.mutate()}>
                Mô phỏng nhắc duyệt
              </Button>
              <Button size="small" title="Gửi nhắc thật cho người duyệt; nên chạy mô phỏng trước khi dùng." loading={remindPendingApprovalsMutation.isPending} onClick={() => remindPendingApprovalsMutation.mutate()}>
                Nhắc phê duyệt ngay
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Chờ duyệt L1" value={approvalMetrics.pendingL1} suffix="hồ sơ" />
              </div>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Chờ duyệt L2" value={approvalMetrics.pendingL2} suffix="hồ sơ" />
              </div>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Quá hạn cần ưu tiên" value={approvalMetrics.overdueTotal} suffix="hồ sơ" valueStyle={{ color: approvalMetrics.overdueTotal > 0 ? '#cf1322' : '#389e0d' }} />
              </div>
            </div>
            {(approvalMetrics.blockedSubmitters ?? []).length === 0 ? (
              <Text type="secondary">Không có người tạo phiếu đang bị tắc nghẽn nổi bật.</Text>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {approvalMetrics.blockedSubmitters.map((row) => (
                  <div key={row.username} style={{ border: '1px solid #f0f0f0', borderRadius: 14, padding: '12px 14px', background: '#fff' }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{row.username}</div>
                    <Space wrap>
                      <Tag color="warning">{`Hồ sơ chờ: ${row.pending_count}`}</Tag>
                      <Tag color="error">{`Chờ lâu nhất: ${row.max_wait_hours} giờ`}</Tag>
                      <Tag color="blue">{`Tổng tiền: ${formatCurrency(toNumber(row.total_amount))}`}</Tag>
                    </Space>
                  </div>
                ))}
              </div>
            )}
          </Space>
        </Card>
      )}

      {canManage && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
          <Card title="Chính sách SLA duyệt ứng lương" extra={<Button size="small" onClick={openApprovalPolicyEditor}>Cập nhật</Button>}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Text>{`SLA cấp 1: ${approvalPolicy?.sla_hours_l1 ?? 0} giờ`}</Text>
              <Text>{`SLA cấp 2: ${approvalPolicy?.sla_hours_l2 ?? 0} giờ`}</Text>
              <Text>{`Chu kỳ nhắc: ${approvalPolicy?.remind_every_hours ?? 0} giờ`}</Text>
              <Text>{`Escalation L1: ${approvalPolicy?.escalation_hours_l1 ?? 0} giờ`}</Text>
              <Text>{`Escalation L2: ${approvalPolicy?.escalation_hours_l2 ?? 0} giờ`}</Text>
              <Text>{`Cooldown escalation: ${approvalPolicy?.escalation_cooldown_hours ?? 0} giờ`}</Text>
              <Text>{`Cửa sổ theo dõi: ${approvalPolicy?.window_days ?? 0} ngày`}</Text>
            </Space>
          </Card>

          <Card title="Lịch sử nhắc SLA 30 ngày" loading={approvalSlaReminderHistoryQuery.isLoading}>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Text>{`Đã gửi: ${approvalReminderHistory?.summary.total_sent ?? 0}`}</Text>
              <Text>{`Đã đọc: ${approvalReminderHistory?.summary.total_read ?? 0}`}</Text>
              <Text>{`Chưa đọc: ${approvalReminderHistory?.summary.total_unread ?? 0}`}</Text>
              <Text>{`Tỷ lệ đọc: ${formatPercent(approvalReminderHistory?.summary.overall_read_rate ?? 0)}`}</Text>
            </Space>
          </Card>
        </div>
      )}

      {canManage && (
        <Card title="Chi tiết lịch sử nhắc SLA duyệt ứng lương">
          <Table
            rowKey={(row) => `${row.level_key}-${row.latest_created_at}`}
            size="small"
            columns={approvalReminderHistoryColumns}
            dataSource={approvalReminderHistory?.items ?? []}
            loading={approvalSlaReminderHistoryQuery.isLoading}
            pagination={false}
            scroll={{ x: 860 }}
          />
        </Card>
      )}

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1560 }}
        locale={{
          emptyText: (
            <Space direction="vertical" size={2}>
              <Text>Không có hồ sơ ứng lương phù hợp.</Text>
              <Text type="secondary">Thử bỏ bộ lọc hoặc đổi tháng để kiểm tra hàng đợi rộng hơn.</Text>
            </Space>
          ),
        }}
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
        title={detailAdvanceData ? `Chi tiết ứng lương - ${detailAdvanceData.employee_code}` : 'Chi tiết ứng lương'}
        open={Boolean(detailAdvanceData)}
        onCancel={() => {
          setDetailAdvanceId(null);
          setDismissedInitialFocus(true);
        }}
        footer={null}
        width={920}
      >
        {detailAdvanceData ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="Nhân viên">{`${detailAdvanceData.employee_code} - ${detailAdvanceData.employee_name}`}</Descriptions.Item>
              <Descriptions.Item label="Ngày ứng">{detailAdvanceData.advance_date}</Descriptions.Item>
              <Descriptions.Item label="Tháng trừ lương">{detailAdvanceData.month}</Descriptions.Item>
              <Descriptions.Item label="Số tiền">{formatCurrency(toNumber(detailAdvanceData.amount))}</Descriptions.Item>
              <Descriptions.Item label="Trạng thái">
                {STATUS_OPTIONS.find((item) => item.value === detailAdvanceData.status)?.label ?? detailAdvanceData.status}
              </Descriptions.Item>
              <Descriptions.Item label="Duyệt">
                <Space size={6} wrap>
                  <Tag
                    color={
                      detailAdvanceData.approval_status === 'APPROVED'
                        ? 'green'
                        : detailAdvanceData.approval_status === 'REJECTED'
                          ? 'red'
                          : detailAdvanceData.approval_status === 'PENDING_L1' || detailAdvanceData.approval_status === 'PENDING_L2'
                            ? 'gold'
                            : 'default'
                    }
                  >
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
              <Descriptions.Item label="Người duyệt">{detailAdvanceData.approved_by_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Gửi duyệt">{formatDateTime(detailAdvanceData.submitted_at)}</Descriptions.Item>
              <Descriptions.Item label="Chi tiền lúc">{formatDateTime(detailAdvanceData.disbursed_at)}</Descriptions.Item>
              <Descriptions.Item label="Lý do" span={2}>
                {detailAdvanceData.reason || '-'}
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

            <Alert
              showIcon
              type={detailAdvanceData.approval_status === 'APPROVED' && detailAdvanceData.disbursement_status === 'DISBURSED' ? 'success' : 'info'}
              message="Việc tiếp theo"
              description={getSalaryAdvanceNextStep(detailAdvanceData, canManage)}
            />

            <div>
              <Title level={5}>Lịch sử duyệt</Title>
              <Table<SalaryAdvanceApprovalHistoryItem>
                rowKey={(row) => `${row.action}-${row.level ?? 0}-${row.created_at}`}
                loading={approvalHistoryQuery.isLoading}
                dataSource={approvalHistoryQuery.data ?? []}
                pagination={false}
                locale={{ emptyText: 'Hồ sơ ứng lương này chưa có lịch sử duyệt.' }}
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
                    width: 260,
                    render: (value) => value || '-',
                  },
                  {
                    title: 'Thời gian',
                    dataIndex: 'created_at',
                    width: 180,
                    render: (value) => formatDateTime(value),
                  },
                ]}
                scroll={{ x: 800 }}
              />
            </div>
          </Space>
        ) : null}
      </Modal>

      <Modal title={editing ? 'Sửa ứng lương' : 'Thêm ứng lương'} open={openModal} onCancel={() => setOpenModal(false)} onOk={submitForm} width={760} confirmLoading={createMutation.isPending || updateMutation.isPending}>
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="employee" label="Nhân viên" rules={[{ required: true }]}>
              <Select options={employees.map((item: Employee) => ({ value: item.id, label: `${item.code} - ${item.name}` }))} />
            </Form.Item>
            <Form.Item name="advance_date" label="Ngày ứng" rules={[{ required: true }]}><Input type="date" /></Form.Item>
            <Form.Item name="month" label="Tháng trừ lương" rules={[{ required: true }]}><Input type="month" /></Form.Item>
            <Form.Item name="amount" label="Số tiền" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="approved_by_name" label="Người duyệt"><Input /></Form.Item>
          </div>
          <Form.Item name="reason" label="Lý do"><Input /></Form.Item>
          <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked"><Switch /></Form.Item>
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
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            showIcon
            type="info"
            message="Hệ thống sẽ tự sinh chứng từ chi tiền"
            description={disbursementModal.row ? `Chứng từ chi tiền sẽ bám đúng ngày ứng ${disbursementModal.row.advance_date} để đồng bộ công nợ và dòng tiền.` : 'Chọn nguồn tiền phù hợp trước khi xác nhận chi.'}
          />
          <Form form={disbursementForm} layout="vertical" initialValues={emptyDisbursementForm}>
            <Form.Item name="source_type" label="Nguồn tiền" rules={[{ required: true }]}>
              <Select options={[{ value: 'CASH', label: 'Quỹ tiền mặt' }, { value: 'BANK', label: 'Ngân hàng' }]} />
            </Form.Item>
            <Form.Item shouldUpdate noStyle>
              {() =>
                disbursementForm.getFieldValue('source_type') === 'BANK' ? (
                  <Form.Item name="source_bank_account" label="Tài khoản ngân hàng" rules={[{ required: true, message: 'Vui lòng chọn tài khoản ngân hàng.' }]}>
                    <Select options={bankAccounts.map((item: BankAccount) => ({ value: item.id, label: `${item.code} - ${item.account_name}` }))} />
                  </Form.Item>
                ) : (
                  <Form.Item name="source_cash_account" label="Quỹ tiền mặt" rules={[{ required: true, message: 'Vui lòng chọn quỹ tiền mặt.' }]}>
                    <Select options={cashAccounts.map((item: CashAccount) => ({ value: item.id, label: `${item.name} | khả dụng ${formatCurrency(toNumber(item.current_balance ?? item.balance))}` }))} />
                  </Form.Item>
                )
              }
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal
        title="Chính sách SLA duyệt ứng lương"
        open={approvalPolicyModalOpen}
        onCancel={() => setApprovalPolicyModalOpen(false)}
        onOk={() => void submitApprovalPolicy()}
        okText="Lưu chính sách"
        confirmLoading={saveApprovalPolicyMutation.isPending}
        width={760}
      >
        <Form form={approvalPolicyForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="sla_hours_l1" label="SLA cấp 1 (giờ)" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="sla_hours_l2" label="SLA cấp 2 (giờ)" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="remind_every_hours" label="Chu kỳ nhắc (giờ)" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="escalation_hours_l1" label="Ngưỡng escalation L1 (giờ)" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="escalation_hours_l2" label="Ngưỡng escalation L2 (giờ)" rules={[{ required: true, message: 'Bắt buộc' }]}>
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
        title="Từ chối duyệt ứng lương"
        open={rejectModal.open}
        onCancel={() => {
          setRejectModal({ open: false, id: null });
          rejectForm.resetFields();
        }}
        onOk={() => {
          rejectForm.validateFields().then((values: { reason: string }) => {
            if (rejectModal.id !== null) {
              rejectApprovalMutation.mutate({ id: rejectModal.id, reason: values.reason.trim() });
              setRejectModal({ open: false, id: null });
              rejectForm.resetFields();
            }
          }).catch(() => {});
        }}
        okText="Xác nhận từ chối"
        okButtonProps={{ danger: true }}
        confirmLoading={rejectApprovalMutation.isPending}
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item name="reason" label="Lý do từ chối" rules={[{ required: true, message: 'Vui lòng nhập lý do từ chối.' }]}>
            <Input.TextArea rows={3} placeholder="Nhập lý do từ chối duyệt..." value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
