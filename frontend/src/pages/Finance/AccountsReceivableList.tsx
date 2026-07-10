import { useMemo, useState, type CSSProperties } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
  Skeleton,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, DollarOutlined, DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { accountsReceivableApi } from '../../api/accountsReceivable';
import { financeApi } from '../../api/finance';
import type {
  ReceivableDocument,
  ReceivableDocumentStatus,
  ReceivablePayment,
} from '../../types/accountsReceivable';
import { PAGES } from '../../utils/constants';
import { canAdjustFinanceData, canManageFinanceData, canSettleFinanceData } from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';

const { Text, Title } = Typography;

type Filters = {
  status?: ReceivableDocumentStatus;
  agingBucket?: string;
};

type ReceivableViewSnapshot = {
  search: string;
  status?: ReceivableDocumentStatus;
  agingBucket?: string;
};

type ReceivableNamedPreset = {
  id: string;
  name: string;
  filters: ReceivableViewSnapshot;
};

type PaymentFormValues = {
  settlement_date: dayjs.Dayjs;
  amount: number;
  source_type: 'CASH' | 'BANK';
  source_cash_account?: number;
  source_bank_account?: number;
  note?: string;
};

const STATUS_META: Record<ReceivableDocumentStatus, { color: string; label: string }> = {
  POSTED: { color: 'blue', label: 'Đã phát hành' },
  PARTIAL_PAID: { color: 'gold', label: 'Thu một phần' },
  PAID: { color: 'green', label: 'Đã thu đủ' },
  OVERDUE: { color: 'red', label: 'Quá hạn' },
  WRITTEN_OFF: { color: 'default', label: 'Xóa nợ' },
  CANCELLED: { color: 'default', label: 'Đã hủy' },
};

const AGING_BUCKET_OPTIONS = [
  { value: '0_30', label: '0 - 30 ngày' },
  { value: '30_60', label: '31 - 60 ngày' },
  { value: '60_90', label: '61 - 90 ngày' },
  { value: '90_plus', label: 'Trên 90 ngày' },
];

const SUMMARY_TILE_STYLE: CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};

function getStatusMeta(status?: string): { color: string; label: string } {
  if (!status) return { color: 'default', label: '-' };
  return STATUS_META[status as ReceivableDocumentStatus] ?? { color: 'default', label: status };
}

function serializeFilters(filters: Filters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): Filters {
  try {
    return JSON.parse(raw) as Filters;
  } catch {
    return {};
  }
}

function formatMoney(value: number | string | null | undefined): string {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0';
}

function getReceivableOwnerStep(document: ReceivableDocument): { color: string; text: string } {
  const outstanding = Number(document.outstanding_amount || 0);
  const daysOverdue = Number(document.days_overdue || 0);
  if (document.status === 'CANCELLED') {
    return { color: 'default', text: 'Đã hủy: chỉ dùng để đối soát lịch sử, không ghi nhận thu thêm.' };
  }
  if (document.status === 'PAID' || outstanding <= 0) {
    return { color: 'success', text: 'Đã thu đủ: kiểm tra giao dịch thu và sổ quỹ khi cần đối chiếu.' };
  }
  if (daysOverdue > 0 || document.status === 'OVERDUE') {
    return { color: 'error', text: `Quá hạn ${daysOverdue || 1} ngày: ưu tiên liên hệ khách và ghi nhận thu tiền.` };
  }
  if (document.status === 'PARTIAL_PAID') {
    return { color: 'gold', text: `Đã thu một phần, còn ${formatMoney(outstanding)} đ cần theo dõi.` };
  }
  return { color: 'blue', text: 'Chưa thu: theo dõi ngày đến hạn và ghi nhận thu khi tiền về.' };
}

function getReceivableActionDisabledReason(document: ReceivableDocument, canManage: boolean, action: 'collect' | 'cancel'): string | undefined {
  if (!canManage) return 'Bạn không có quyền thao tác tài chính.';
  if (document.status === 'CANCELLED') return 'Công nợ đã hủy.';
  if (action === 'collect' && (document.status === 'PAID' || Number(document.outstanding_amount || 0) <= 0)) {
    return 'Công nợ đã thu đủ.';
  }
  if (action === 'cancel' && document.status === 'PAID') return 'Công nợ đã thu đủ, không hủy từ màn này.';
  return undefined;
}

function parseViewSnapshot(value: unknown): ReceivableViewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const statusValue = obj.status;
  const agingBucketValue = obj.agingBucket;
  return {
    search: typeof obj.search === 'string' ? obj.search : '',
    status:
      statusValue === 'POSTED'
      || statusValue === 'PARTIAL_PAID'
      || statusValue === 'PAID'
      || statusValue === 'OVERDUE'
      || statusValue === 'WRITTEN_OFF'
      || statusValue === 'CANCELLED'
        ? statusValue
        : undefined,
    agingBucket: typeof agingBucketValue === 'string' ? agingBucketValue : undefined,
  };
}

export default function AccountsReceivableList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const canManage = canManageFinanceData();
  const canSettle = canSettleFinanceData();
  const canAdjust = canAdjustFinanceData();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [page, setPage] = useState(1);
  const [detailReceivable, setDetailReceivable] = useState<ReceivableDocument | null>(null);
  const [paymentDoc, setPaymentDoc] = useState<ReceivableDocument | null>(null);
  const [cancelDoc, setCancelDoc] = useState<ReceivableDocument | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm] = Form.useForm<PaymentFormValues>();
  const [cancelForm] = Form.useForm<{ reason: string }>();
  const {
    config,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.FINANCE_RECEIVABLES);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord.pageSize ?? 20);

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = {
      page,
      page_size: pageSize,
      ordering: '-document_date',
    };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.agingBucket) next.aging_bucket = intentFilters.agingBucket;
    return next;
  }, [intentFilters.agingBucket, intentFilters.status, intentSearch, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['finance-receivables', params],
    queryFn: () => accountsReceivableApi.getReceivables(params),
  });

  const detailQuery = useQuery({
    queryKey: ['finance-receivable-detail', detailReceivable?.id],
    queryFn: () => accountsReceivableApi.getReceivable(detailReceivable!.id!),
    enabled: !!detailReceivable?.id,
  });

  const cashAccountsQuery = useQuery({
    queryKey: ['receivable-cash-accounts'],
    queryFn: () => financeApi.getCashAccounts({ page_size: 1000, is_active: 'true' }),
    enabled: paymentOpen,
  });

  const bankAccountsQuery = useQuery({
    queryKey: ['receivable-bank-accounts'],
    queryFn: () => financeApi.getBankAccounts({ page_size: 1000, is_active: 'true' }),
    enabled: paymentOpen,
  });

  const paymentMutation = useMutation({
    mutationFn: async (payload: { id: number } & Omit<PaymentFormValues, 'settlement_date'> & { settlement_date: string }) => {
      const { id, ...body } = payload;
      return accountsReceivableApi.receivePayment(id, body);
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['finance-receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['finance-receivable-detail'] }),
      ]);
      messageApi.success('Đã ghi nhận thu tiền cho công nợ phải thu');
      setDetailReceivable(updated);
      setPaymentDoc(null);
      setPaymentOpen(false);
      paymentForm.resetFields();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => accountsReceivableApi.cancelReceivable(id, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['finance-receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['finance-receivable-detail'] }),
      ]);
      messageApi.success('Đã hủy công nợ phải thu');
      setCancelDoc(null);
      cancelForm.resetFields();
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const detail = detailQuery.data ?? detailReceivable;

  const summary = useMemo(() => {
    const totalAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const totalCollected = rows.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
    const totalOutstanding = rows.reduce((sum, row) => sum + Number(row.outstanding_amount || 0), 0);
    const overdueCount = rows.filter((row) => row.status === 'OVERDUE' || Number(row.days_overdue || 0) > 0).length;
    const openCount = rows.filter((row) => !['PAID', 'CANCELLED'].includes(row.status)).length;
    const settledCount = rows.filter((row) => row.status === 'PAID').length;
    return { totalAmount, totalCollected, totalOutstanding, overdueCount, openCount, settledCount };
  }, [rows]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.status) tags.push(`Trạng thái: ${getStatusMeta(intentFilters.status).label}`);
    if (intentFilters.agingBucket) {
      const option = AGING_BUCKET_OPTIONS.find((item) => item.value === intentFilters.agingBucket);
      tags.push(`Tuổi nợ: ${option?.label ?? intentFilters.agingBucket}`);
    }
    return tags;
  }, [intentFilters.agingBucket, intentFilters.status, intentSearch]);

  const namedPresets = useMemo(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) return [] as ReceivableNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const id = typeof obj.id === 'string' ? obj.id : '';
        const name = typeof obj.name === 'string' ? obj.name : '';
        const filtersValue = parseViewSnapshot(obj.filters);
        if (!id || !name || !filtersValue) return null;
        return { id, name, filters: filtersValue };
      })
      .filter((value): value is ReceivableNamedPreset => value !== null);
  }, [configRecord.saved_views]);

  const selectedPreset = useMemo(
    () => namedPresets.find((preset) => preset.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );

  const savedViewSnapshot = useMemo(() => {
    const directSnapshot = parseViewSnapshot(configRecord.saved_view_snapshot);
    if (directSnapshot) return directSnapshot;
    return parseViewSnapshot({
      search: configRecord.search,
      status: configRecord.status,
      agingBucket: configRecord.agingBucket,
    });
  }, [configRecord.agingBucket, configRecord.saved_view_snapshot, configRecord.search, configRecord.status]);

  const commandContextTags = useMemo(() => {
    if (!selectedPreset) return activeFilterTags;
    return [...activeFilterTags, `Mẫu đang dùng: ${selectedPreset.name}`];
  }, [activeFilterTags, selectedPreset]);

  const buildCurrentSnapshot = (): ReceivableViewSnapshot => ({
    search: searchInput,
    status: filters.status,
    agingBucket: filters.agingBucket,
  });

  const applySnapshot = (snapshot: ReceivableViewSnapshot) => {
    setSearchInput(snapshot.search);
    setFilters({
      status: snapshot.status,
      agingBucket: snapshot.agingBucket,
    });
    setPage(1);
  };

  const saveCurrentView = async () => {
    const currentSnapshot = buildCurrentSnapshot();
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem công nợ phải thu.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem công nợ phải thu.');
    }
  };

  const applySavedView = () => {
    if (!savedViewSnapshot) {
      messageApi.warning('Chưa có chế độ xem đã lưu.');
      return;
    }
    applySnapshot(savedViewSnapshot);
    messageApi.success('Đã áp dụng chế độ xem đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    const nextPreset: ReceivableNamedPreset = existing
      ? { ...existing, name, filters: currentSnapshot }
      : { id: `${Date.now()}`, name, filters: currentSnapshot };
    const nextPresets = existing
      ? namedPresets.map((preset) => (preset.id === existing.id ? nextPreset : preset))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedPresetId(nextPreset.id);
      setPresetName('');
      setIsPresetModalOpen(false);
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc.' : 'Đã lưu mẫu lọc mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc.');
    }
  };

  const applyNamedPreset = () => {
    if (!selectedPreset) {
      messageApi.warning('Vui lòng chọn mẫu lọc.');
      return;
    }
    applySnapshot(selectedPreset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${selectedPreset.name}".`);
  };

  const deleteNamedPreset = async () => {
    if (!selectedPreset) {
      messageApi.warning('Vui lòng chọn mẫu lọc để xóa.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const nextPresets = namedPresets.filter((preset) => preset.id !== selectedPreset.id);
    try {
      await saveConfig({
        ...config,
        pageSize,
        ...currentSnapshot,
        saved_view_snapshot: currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedPresetId(undefined);
      messageApi.success(`Đã xóa mẫu lọc "${selectedPreset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc.');
    }
  };

  const statusAlert = useMemo(() => {
    if (summary.overdueCount > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${summary.overdueCount} chứng từ đang quá hạn trong phạm vi bạn đang xem.`,
        description: 'Nên ưu tiên rà soát nhóm công nợ quá hạn để tránh dồn áp lực dòng tiền và chậm phản hồi khách hàng.',
      };
    }
    if (summary.totalOutstanding > 0) {
      return {
        type: 'info' as const,
        message: `Còn ${formatMoney(summary.totalOutstanding)} đ chưa thu hồi trên tập dữ liệu hiện tại.`,
        description: 'Bạn có thể theo dõi chi tiết từng công nợ, lịch sử thu tiền và ghi nhận thu trực tiếp ngay từ màn này.',
      };
    }
    return {
      type: 'success' as const,
      message: 'Danh mục công nợ phải thu đang ở trạng thái ổn định.',
      description: 'Chưa có tín hiệu quá hạn nổi bật trên bộ lọc hiện tại.',
    };
  }, [summary.overdueCount, summary.totalOutstanding]);

  const columns: ColumnsType<ReceivableDocument> = [
    { title: 'Mã công nợ', dataIndex: 'code', width: 140, fixed: 'left' },
    {
      title: 'Khách hàng',
      dataIndex: 'customer_name',
      width: 220,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.customer_name || '-'}</Text>
          <Text type="secondary">{row.customer_code || 'Chưa có mã khách hàng'}</Text>
        </Space>
      ),
    },
    {
      title: 'Hóa đơn',
      width: 180,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text>{row.invoice_number || row.code}</Text>
          <Text type="secondary">{dayjs(row.invoice_date).format('DD/MM/YYYY')}</Text>
        </Space>
      ),
    },
    {
      title: 'Đến hạn',
      dataIndex: 'due_date',
      width: 120,
      render: (value: string) => dayjs(value).format('DD/MM/YYYY'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 140,
      render: (value: ReceivableDocumentStatus) => <Tag color={getStatusMeta(value).color}>{getStatusMeta(value).label}</Tag>,
    },
    {
      title: 'Tổng tiền',
      dataIndex: 'amount',
      width: 140,
      align: 'right',
      render: (value: number) => formatMoney(value),
    },
    {
      title: 'Đã thu',
      dataIndex: 'paid_amount',
      width: 140,
      align: 'right',
      render: (value: number) => <Text style={{ color: '#389e0d' }}>{formatMoney(value)}</Text>,
    },
    {
      title: 'Còn phải thu',
      dataIndex: 'outstanding_amount',
      width: 150,
      align: 'right',
      render: (value: number) => (
        <Text strong style={{ color: Number(value) > 0 ? '#cf1322' : '#389e0d' }}>
          {formatMoney(value)}
        </Text>
      ),
    },
    {
      title: 'Quá hạn',
      dataIndex: 'days_overdue',
      width: 110,
      align: 'center',
      render: (value?: number) => (value ? <Tag color="red">{`${value} ngày`}</Tag> : <Text type="secondary">-</Text>),
    },
    {
      title: 'Việc tiếp theo',
      key: 'owner_next_step',
      width: 300,
      render: (_, row) => {
        const ownerStep = getReceivableOwnerStep(row);
        return (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Tag color={ownerStep.color}>Owner next step</Tag>
            <Text type="secondary">{ownerStep.text}</Text>
          </Space>
        );
      },
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 220,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap>
          <Button size="small" icon={<EyeOutlined />} data-testid={`receivable-view-${row.id}`} onClick={() => setDetailReceivable(row)}>
            Xem
          </Button>
          {canSettle ? (
            <Button
              size="small"
              type="primary"
              icon={<DollarOutlined />}
              data-testid={`receivable-collect-${row.id}`}
              disabled={Boolean(getReceivableActionDisabledReason(row, canSettle, 'collect'))}
              title={getReceivableActionDisabledReason(row, canSettle, 'collect') || 'Ghi nhận giao dịch thu tiền cho công nợ này'}
              onClick={() => {
                setPaymentDoc(row);
                paymentForm.setFieldsValue({
                  settlement_date: dayjs(),
                  amount: Number(row.outstanding_amount || 0),
                  source_type: 'BANK',
                  source_bank_account: undefined,
                  source_cash_account: undefined,
                  note: undefined,
                });
                setPaymentOpen(true);
              }}
            >
              Thu tiền
            </Button>
          ) : null}
          {canAdjust ? (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              data-testid={`receivable-cancel-${row.id}`}
              disabled={Boolean(getReceivableActionDisabledReason(row, canAdjust, 'cancel'))}
              title={getReceivableActionDisabledReason(row, canAdjust, 'cancel') || 'Hủy công nợ khi chứng từ phát sinh sai và chưa tất toán'}
              onClick={() => {
                setCancelDoc(row);
                cancelForm.setFieldsValue({ reason: '' });
              }}
            >
              Hủy
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const handleExport = () => {
    if (!rows.length) return;
    downloadCSV(
      rows.map((row) => ({
        'Mã công nợ': row.code,
        'Khách hàng': row.customer_name || '',
        'Mã khách hàng': row.customer_code || '',
        'Số hóa đơn': row.invoice_number || row.code,
        'Ngày hóa đơn': dayjs(row.invoice_date).format('DD/MM/YYYY'),
        'Ngày đến hạn': dayjs(row.due_date).format('DD/MM/YYYY'),
        'Trạng thái': getStatusMeta(row.status).label,
        'Tổng tiền': Number(row.amount || 0),
        'Đã thu': Number(row.paid_amount || 0),
        'Còn phải thu': Number(row.outstanding_amount || 0),
        'Quá hạn ngày': Number(row.days_overdue || 0),
      })),
      'cong-no-phai-thu',
    );
  };

  const handleCancelReceivable = async () => {
    const values = await cancelForm.validateFields();
    if (!cancelDoc?.id) return;
    await cancelMutation.mutateAsync({ id: cancelDoc.id, reason: values.reason.trim() });
  };

  const paymentMethodLabel = (method?: string) => {
    if (method === 'BANK') return 'Ngân hàng';
    if (method === 'CASH') return 'Tiền mặt / quỹ';
    return method || '-';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}

      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <Space wrap>
                <Tag color="blue">Tài chính</Tag>
                <Tag color="gold">Phải thu</Tag>
                <Tag color="processing">Dòng tiền vào</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>
                Trung tâm công nợ phải thu
              </Title>
              <Text type="secondary">
                Theo dõi tình trạng hóa đơn bán hàng, áp lực thu hồi tiền và lịch sử thu tiền theo từng khách hàng trong một màn điều phối tập trung.
              </Text>
            </div>
            <Space wrap>
              {canManage ? (
                <Button icon={<DownloadOutlined />} data-testid="receivables-export-csv" disabled={!rows.length} onClick={handleExport}>
                  Xuất CSV
                </Button>
              ) : null}
              {selectedPreset ? (
                <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                  Mẫu đang dùng: {selectedPreset.name}
                </Tag>
              ) : null}
            </Space>
          </div>

          <Alert showIcon type={statusAlert.type} message={statusAlert.message} description={statusAlert.description} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tổng công nợ" value={summary.totalAmount} formatter={(value) => `${formatMoney(value)} đ`} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đã thu" value={summary.totalCollected} valueStyle={{ color: '#389e0d' }} formatter={(value) => `${formatMoney(value)} đ`} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Còn phải thu" value={summary.totalOutstanding} valueStyle={{ color: summary.totalOutstanding > 0 ? '#cf1322' : undefined }} formatter={(value) => `${formatMoney(value)} đ`} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Chứng từ quá hạn" value={summary.overdueCount} suffix="hồ sơ" />
            </div>
          </div>
        </Space>
      </Card>

      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div data-testid="receivables-search" style={{ display: 'inline-block' }}>
              <Input
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setPage(1);
                }}
                placeholder="Tìm khách hàng, mã công nợ, số hóa đơn..."
                style={{ width: 320 }}
                suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
              />
            </div>
            <Select
              allowClear
              placeholder="Trạng thái"
              style={{ width: 190 }}
              value={filters.status}
              options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))}
              onChange={(value) => {
                setFilters((current) => ({ ...current, status: value as ReceivableDocumentStatus | undefined }));
                setPage(1);
              }}
            />
            <Select
              allowClear
              placeholder="Tuổi nợ"
              style={{ width: 180 }}
              value={filters.agingBucket}
              options={AGING_BUCKET_OPTIONS}
              onChange={(value) => {
                setFilters((current) => ({ ...current, agingBucket: value }));
                setPage(1);
              }}
            />
            <Button
              onClick={() => {
                setSearchInput('');
                setFilters({});
                setPage(1);
                setSelectedPresetId(undefined);
              }}
            >
              Đặt lại bộ lọc
            </Button>
          </div>

          <div
            data-testid="receivables-command-strip"
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Button data-testid="receivables-save-view" onClick={() => void saveCurrentView()} disabled={isPreferencesLoading}>
              Lưu chế độ xem
            </Button>
            <Button data-testid="receivables-restore-view" onClick={applySavedView} disabled={isPreferencesLoading}>
              Áp dụng chế độ đã lưu
            </Button>
            <Button
              data-testid="receivables-open-preset-modal"
              onClick={() => {
                setPresetName(selectedPreset?.name ?? '');
                setIsPresetModalOpen(true);
              }}
              disabled={isPreferencesLoading}
            >
              Lưu mẫu mới
            </Button>
            <div data-testid="receivables-preset-select" style={{ display: 'inline-block' }}>
              <Select<string>
                allowClear
                placeholder="Chọn mẫu lọc phải thu"
                value={selectedPresetId}
                onChange={(value) => setSelectedPresetId(value)}
                disabled={isPreferencesLoading}
                style={{ width: 220 }}
                options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
              />
            </div>
            <Button data-testid="receivables-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
              Áp dụng mẫu lọc
            </Button>
            <Button danger data-testid="receivables-delete-preset" onClick={() => void deleteNamedPreset()} disabled={isPreferencesLoading}>
              Xóa mẫu lọc
            </Button>
            {savedViewSnapshot ? <Tag color="default">Có chế độ xem đã lưu</Tag> : null}
          </div>

          <Space wrap>
            {commandContextTags.length > 0 ? (
              commandContextTags.map((tag) => <Tag key={tag}>{tag}</Tag>)
            ) : (
              <Text type="secondary">Đang hiển thị toàn bộ công nợ phải thu.</Text>
            )}
            <Tag color="default">{`Hồ sơ đang mở: ${summary.openCount}`}</Tag>
            <Tag color="success">{`Đã thu đủ: ${summary.settledCount}`}</Tag>
          </Space>
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1980 }}
        pagination={{
          current: page,
          pageSize,
          total: listQuery.data?.count ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            if (nextPageSize !== pageSize) {
              void saveConfig({ ...config, pageSize: nextPageSize });
            }
          },
        }}
        locale={{
          emptyText:
            rows.length === 0 && !listQuery.isLoading ? (
              <div style={{ padding: 32 }}>
                {activeFilterTags.length > 0 ? (
                  <>
                    <Empty description="Không tìm thấy công nợ phải thu phù hợp." />
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
                  </>
                ) : (
                  <Empty description="Chưa có công nợ phải thu nào." />
                )}
              </div>
            ) : undefined,
        }}
      />

      <Drawer
        title={detail ? `Chi tiết công nợ phải thu · ${detail.code}` : 'Chi tiết công nợ phải thu'}
        open={!!detailReceivable}
        onClose={() => setDetailReceivable(null)}
        width={920}
        extra={
          detail ? (
            <Space wrap>
              {canSettle ? (
                <Button
                  type="primary"
                  icon={<DollarOutlined />}
                  data-testid="receivable-detail-collect"
                  disabled={Boolean(getReceivableActionDisabledReason(detail, canSettle, 'collect'))}
                  title={getReceivableActionDisabledReason(detail, canSettle, 'collect') || 'Ghi nhận giao dịch thu tiền cho công nợ này'}
                  onClick={() => {
                    setPaymentDoc(detail);
                    paymentForm.setFieldsValue({
                      settlement_date: dayjs(),
                      amount: Number(detail.outstanding_amount || 0),
                      source_type: 'BANK',
                      source_bank_account: undefined,
                      source_cash_account: undefined,
                      note: undefined,
                    });
                    setPaymentOpen(true);
                  }}
                >
                  Thu tiền
                </Button>
              ) : null}
              {canAdjust ? (
                <Button
                  danger
                  data-testid="receivable-detail-cancel"
                  disabled={Boolean(getReceivableActionDisabledReason(detail, canAdjust, 'cancel'))}
                  title={getReceivableActionDisabledReason(detail, canAdjust, 'cancel') || 'Hủy công nợ khi chứng từ phát sinh sai và chưa tất toán'}
                  onClick={() => {
                    setCancelDoc(detail);
                    cancelForm.setFieldsValue({ reason: '' });
                  }}
                >
                  Hủy công nợ
                </Button>
              ) : null}
            </Space>
          ) : null
        }
      >
        {detailQuery.isLoading && !detailQuery.data ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert showIcon type={detail.status === 'OVERDUE' ? 'warning' : 'info'} message={getReceivableOwnerStep(detail).text} />
            <Card size="small">
              <Descriptions column={2} size="small">
                <Descriptions.Item label="Khách hàng">{detail.customer_name || '-'}</Descriptions.Item>
                <Descriptions.Item label="Mã khách hàng">{detail.customer_code || '-'}</Descriptions.Item>
                <Descriptions.Item label="Hóa đơn">{detail.invoice_number || detail.code}</Descriptions.Item>
                <Descriptions.Item label="Ngày hóa đơn">{dayjs(detail.invoice_date).format('DD/MM/YYYY')}</Descriptions.Item>
                <Descriptions.Item label="Đến hạn">{dayjs(detail.due_date).format('DD/MM/YYYY')}</Descriptions.Item>
                <Descriptions.Item label="Trạng thái">
                  <Tag color={getStatusMeta(detail.status).color}>{getStatusMeta(detail.status).label}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Đơn bán">{detail.sales_order_code || '-'}</Descriptions.Item>
                <Descriptions.Item label="Ghi chú">{detail.note || '-'}</Descriptions.Item>
              </Descriptions>
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Tổng tiền" value={detail.amount} formatter={(value) => `${formatMoney(value)} đ`} />
              </div>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Đã thu" value={detail.paid_amount} valueStyle={{ color: '#389e0d' }} formatter={(value) => `${formatMoney(value)} đ`} />
              </div>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Còn phải thu" value={detail.outstanding_amount} valueStyle={{ color: Number(detail.outstanding_amount || 0) > 0 ? '#cf1322' : undefined }} formatter={(value) => `${formatMoney(value)} đ`} />
              </div>
              <div style={SUMMARY_TILE_STYLE}>
                <Statistic title="Quá hạn" value={detail.days_overdue || 0} suffix="ngày" />
              </div>
            </div>

            <Tabs
              items={[
                {
                  key: 'info',
                  label: 'Thông tin',
                  children: (
                    <Descriptions column={1} bordered size="small">
                      <Descriptions.Item label="Mã công nợ">{detail.code}</Descriptions.Item>
                      <Descriptions.Item label="Khách hàng">{detail.customer_name || '-'}</Descriptions.Item>
                      <Descriptions.Item label="Số hóa đơn">{detail.invoice_number || '-'}</Descriptions.Item>
                      <Descriptions.Item label="Nguồn đơn bán">{detail.sales_order_code || '-'}</Descriptions.Item>
                      <Descriptions.Item label="Ghi chú">{detail.note || '-'}</Descriptions.Item>
                    </Descriptions>
                  ),
                },
                {
                  key: 'payments',
                  label: `Thu tiền (${detail.payments?.length ?? 0})`,
                  children: (
                    <Table<ReceivablePayment>
                      rowKey={(record) => record.id ?? `${record.settlement_date}-${record.amount}`}
                      pagination={false}
                      dataSource={detail.payments ?? []}
                      locale={{ emptyText: <Empty description="Chưa có giao dịch thu tiền nào." /> }}
                      columns={[
                        {
                          title: 'Ngày thu',
                          dataIndex: 'settlement_date',
                          render: (value: string) => dayjs(value).format('DD/MM/YYYY'),
                        },
                        {
                          title: 'Số tiền',
                          dataIndex: 'amount',
                          align: 'right',
                          render: (value: number) => formatMoney(value),
                        },
                        {
                          title: 'Nguồn thu',
                          dataIndex: 'payment_method',
                          render: (value: string) => paymentMethodLabel(value),
                        },
                        {
                          title: 'Tham chiếu',
                          dataIndex: 'reference',
                          render: (value?: string) => value || '-',
                        },
                        {
                          title: 'Ghi chú',
                          dataIndex: 'note',
                          render: (value?: string) => value || '-',
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Space>
        ) : (
          <Empty description="Không có dữ liệu chi tiết để hiển thị." />
        )}
      </Drawer>

      <Modal
        title="Lưu mẫu lọc công nợ phải thu"
        open={isPresetModalOpen}
        onCancel={() => {
          setIsPresetModalOpen(false);
          setPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Hủy"
      >
        <Input
          data-testid="receivables-preset-name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Ví dụ: Quá hạn cao / Khách lớn / Theo dõi cuối ngày"
          maxLength={80}
          autoFocus
        />
      </Modal>

      <Modal
        title={paymentDoc ? `Ghi nhận thu tiền · ${paymentDoc.code}` : 'Ghi nhận thu tiền'}
        open={paymentOpen}
        onCancel={() => {
          setPaymentOpen(false);
          setPaymentDoc(null);
          paymentForm.resetFields();
        }}
        confirmLoading={paymentMutation.isPending}
        onOk={async () => {
          const values = await paymentForm.validateFields();
          if (!paymentDoc?.id) return;
          await paymentMutation.mutateAsync({
            id: paymentDoc.id,
            settlement_date: values.settlement_date.format('YYYY-MM-DD'),
            amount: Number(values.amount),
            source_type: values.source_type,
            source_cash_account: values.source_cash_account,
            source_bank_account: values.source_bank_account,
            note: values.note?.trim() || undefined,
          });
        }}
        okText="Ghi nhận thu tiền"
        cancelText="Đóng"
      >
        <Form form={paymentForm} layout="vertical">
          <Form.Item label="Ngày thu" name="settlement_date" rules={[{ required: true, message: 'Chọn ngày thu tiền' }]}>
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item label="Số tiền" name="amount" rules={[{ required: true, message: 'Nhập số tiền thu' }]}>
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="Nguồn thu" name="source_type" rules={[{ required: true, message: 'Chọn nguồn thu' }]}>
            <Select
              options={[
                { value: 'BANK', label: 'Ngân hàng' },
                { value: 'CASH', label: 'Tiền mặt / quỹ' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) =>
              getFieldValue('source_type') === 'BANK' ? (
                <Form.Item
                  label="Tài khoản ngân hàng"
                  name="source_bank_account"
                  rules={[{ required: true, message: 'Chọn tài khoản ngân hàng nhận tiền' }]}
                >
                  <Select
                    placeholder="Chọn tài khoản ngân hàng"
                    options={(bankAccountsQuery.data?.results ?? []).map((item) => ({
                      value: item.id,
                      label: `${item.code} - ${item.account_number}`,
                    }))}
                  />
                </Form.Item>
              ) : (
                <Form.Item
                  label="Quỹ / tài khoản tiền mặt"
                  name="source_cash_account"
                  rules={[{ required: true, message: 'Chọn quỹ nhận tiền' }]}
                >
                  <Select
                    placeholder="Chọn quỹ tiền mặt"
                    options={(cashAccountsQuery.data?.results ?? []).map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                  />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea rows={3} placeholder="Bổ sung nội dung thu tiền nếu cần" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={cancelDoc ? `Hủy công nợ · ${cancelDoc.code}` : 'Hủy công nợ'}
        open={!!cancelDoc}
        onCancel={() => {
          setCancelDoc(null);
          cancelForm.resetFields();
        }}
        confirmLoading={cancelMutation.isPending}
        onOk={handleCancelReceivable}
        okText="Xác nhận hủy"
        okButtonProps={{ danger: true }}
        cancelText="Đóng"
      >
        <Form form={cancelForm} layout="vertical">
          <Alert
            showIcon
            type="warning"
            style={{ marginBottom: 16 }}
            message="Thao tác này sẽ khóa chứng từ công nợ"
            description="Hãy nhập lý do rõ ràng để phục vụ đối soát và truy vết sau này."
          />
          <Form.Item
            label="Lý do hủy"
            name="reason"
            rules={[
              { required: true, message: 'Nhập lý do hủy công nợ' },
              { min: 6, message: 'Lý do hủy cần đủ rõ ràng để truy vết' },
            ]}
          >
            <Input.TextArea rows={4} placeholder="Ví dụ: Hủy do chứng từ tạo nhầm hoặc đã thay bằng hồ sơ khác." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
