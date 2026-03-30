import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  TimePicker,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ClockCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { Link } from 'react-router-dom';

import { reportsApi } from '../../api/reports';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getToastMessage } from '../../shared/apiError';
import type {
  BooleanFilterValue,
  CustomReportDefinition,
  CustomReportGeneratedResult,
  CustomReportRun,
  CustomReportScheduleFrequency,
  CustomReportStatus,
  CustomReportType,
  CustomReportUpsertPayload,
  GenerateCustomReportPayload,
} from '../../types/reports';
import { PAGES } from '../../utils/constants';
import { downloadCSV } from '../../utils/csvExport';

const { RangePicker } = DatePicker;

type ReportFilters = {
  report_type: '' | CustomReportType;
  status: '' | CustomReportStatus;
  schedule_enabled: BooleanFilterValue;
  is_system: BooleanFilterValue;
};

type ReportFormValues = {
  code: string;
  name: string;
  report_type: CustomReportType;
  description: string;
  status: CustomReportStatus;
  period?: [Dayjs, Dayjs];
  schedule_enabled: boolean;
  schedule_frequency: CustomReportScheduleFrequency;
  schedule_time: Dayjs | null;
  schedule_day_of_week: number | null;
  schedule_day_of_month: number | null;
  schedule_recipients: string[];
};

type ReportsCenterViewSnapshot = {
  searchInput: string;
  filters: ReportFilters;
  pageSize: number;
};

type ReportsCenterNamedPreset = {
  id: string;
  name: string;
  snapshot: ReportsCenterViewSnapshot;
  updatedAt: string;
};

const reportTypeOptions: Array<{ label: string; value: CustomReportType }> = [
  { label: 'Bán hàng', value: 'SALES' },
  { label: 'Mua hàng', value: 'PURCHASE' },
  { label: 'Tồn kho', value: 'INVENTORY' },
  { label: 'Sản xuất', value: 'PRODUCTION' },
  { label: 'Tài chính', value: 'FINANCIAL' },
  { label: 'Vận chuyển', value: 'SHIPPING' },
  { label: 'Nhân sự', value: 'WORKFORCE' },
];

const statusOptions: Array<{ label: string; value: CustomReportStatus }> = [
  { label: 'Nháp', value: 'DRAFT' },
  { label: 'Đã tạo', value: 'GENERATED' },
  { label: 'Hoàn tất', value: 'FINALIZED' },
  { label: 'Lưu trữ', value: 'ARCHIVED' },
];

const scheduleFrequencyOptions: Array<{ label: string; value: CustomReportScheduleFrequency }> = [
  { label: 'Không lập lịch', value: 'NONE' },
  { label: 'Hàng ngày', value: 'DAILY' },
  { label: 'Hàng tuần', value: 'WEEKLY' },
  { label: 'Hàng tháng', value: 'MONTHLY' },
];

const booleanFilterOptions: Array<{ label: string; value: BooleanFilterValue }> = [
  { label: 'Tất cả', value: '' },
  { label: 'Có', value: 'true' },
  { label: 'Không', value: 'false' },
];

const weekdayOptions = [
  { label: 'Thứ 2', value: 0 },
  { label: 'Thứ 3', value: 1 },
  { label: 'Thứ 4', value: 2 },
  { label: 'Thứ 5', value: 3 },
  { label: 'Thứ 6', value: 4 },
  { label: 'Thứ 7', value: 5 },
  { label: 'Chủ nhật', value: 6 },
];

const reportTypeLabels: Record<CustomReportType, string> = {
  SALES: 'Bán hàng',
  PURCHASE: 'Mua hàng',
  INVENTORY: 'Tồn kho',
  PRODUCTION: 'Sản xuất',
  FINANCIAL: 'Tài chính',
  SHIPPING: 'Vận chuyển',
  WORKFORCE: 'Nhân sự',
};

const statusLabels: Record<CustomReportStatus, string> = {
  DRAFT: 'Nháp',
  GENERATED: 'Đã tạo',
  FINALIZED: 'Hoàn tất',
  ARCHIVED: 'Lưu trữ',
};

const statusColors: Record<CustomReportStatus, string> = {
  DRAFT: 'default',
  GENERATED: 'processing',
  FINALIZED: 'success',
  ARCHIVED: 'warning',
};

const scheduleLabels: Record<CustomReportScheduleFrequency, string> = {
  NONE: 'Không lập lịch',
  DAILY: 'Hàng ngày',
  WEEKLY: 'Hàng tuần',
  MONTHLY: 'Hàng tháng',
};

const quickLinks = [
  { to: '/finance-summary', label: 'Báo cáo tài chính' },
  { to: '/cash-book', label: 'Sổ quỹ' },
  { to: '/receivables', label: 'Công nợ phải thu' },
  { to: '/payables', label: 'Công nợ phải trả' },
  { to: '/aging-analysis', label: 'Phân tích quá hạn' },
];

const quickRunReports = [
  { code: 'SALES_SUMMARY', label: 'Tổng hợp bán hàng' },
  { code: 'PURCHASE_SUMMARY', label: 'Tổng hợp mua hàng' },
  { code: 'INVENTORY_HEALTH', label: 'Sức khỏe tồn kho' },
  { code: 'PRODUCTION_COSTING', label: 'Giá vốn sản xuất' },
  { code: 'PROFIT_REPORT', label: 'Báo cáo lợi nhuận' },
  { code: 'EMPLOYEE_PERFORMANCE', label: 'Hiệu suất nhân sự' },
  { code: 'AUDIT_TRAIL', label: 'Nhật ký hệ thống' },
];

function serializeFilters(filters: ReportFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): ReportFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<ReportFilters>;
    return {
      report_type: parsed.report_type && parsed.report_type in reportTypeLabels ? parsed.report_type : '',
      status: parsed.status && parsed.status in statusLabels ? parsed.status : '',
      schedule_enabled: parsed.schedule_enabled === 'true' || parsed.schedule_enabled === 'false' ? parsed.schedule_enabled : '',
      is_system: parsed.is_system === 'true' || parsed.is_system === 'false' ? parsed.is_system : '',
    };
  } catch {
    return { report_type: '', status: '', schedule_enabled: '', is_system: '' };
  }
}

function parseReportsCenterViewSnapshot(raw: unknown): ReportsCenterViewSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const snapshot = raw as Partial<ReportsCenterViewSnapshot>;
  if (typeof snapshot.searchInput !== 'string') return null;
  const pageSize = Number(snapshot.pageSize ?? 10);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
  return {
    searchInput: snapshot.searchInput,
    filters: parseFilters(JSON.stringify(snapshot.filters ?? {})),
    pageSize,
  };
}

function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'CUSTOM_REPORT';
}

function createDefaultScheduleTime(): Dayjs {
  return dayjs().hour(8).minute(0).second(0).millisecond(0);
}

function createDefaultPeriod(): [Dayjs, Dayjs] {
  return [dayjs().startOf('month'), dayjs()];
}

function createEmptyFormValues(): ReportFormValues {
  return {
    code: '',
    name: '',
    report_type: 'FINANCIAL',
    description: '',
    status: 'DRAFT',
    period: createDefaultPeriod(),
    schedule_enabled: false,
    schedule_frequency: 'NONE',
    schedule_time: createDefaultScheduleTime(),
    schedule_day_of_week: 0,
    schedule_day_of_month: 1,
    schedule_recipients: [],
  };
}

function parseTimeValue(value?: string | null): Dayjs | null {
  if (!value) return null;
  return dayjs(`2000-01-01T${value}`);
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  return dayjs(value).format('DD/MM/YYYY');
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  return dayjs(value).format('DD/MM/YYYY HH:mm');
}

function humanizeKey(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isPrimitiveValue(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function renderValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') {
    return value.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  }
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (Array.isArray(value) || typeof value === 'object') {
    return (
      <pre
        style={{
          margin: 0,
          padding: 12,
          background: '#fafafa',
          borderRadius: 8,
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return String(value);
}

function renderObjectSection(data?: Record<string, unknown>): ReactNode {
  const entries = Object.entries(data ?? {});
  if (!entries.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu" />;
  }

  const primitiveEntries = entries.filter(([, value]) => isPrimitiveValue(value));
  const complexEntries = entries.filter(([, value]) => !isPrimitiveValue(value));

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {primitiveEntries.length ? (
        <Row gutter={[12, 12]}>
          {primitiveEntries.map(([key, value]) => (
            <Col xs={24} sm={12} lg={8} key={key}>
              <Card size="small">
                <Typography.Text type="secondary">{humanizeKey(key)}</Typography.Text>
                <div style={{ marginTop: 8, fontWeight: 600 }}>{renderValue(value)}</div>
              </Card>
            </Col>
          ))}
        </Row>
      ) : null}

      {complexEntries.map(([key, value]) => (
        <div key={key}>
          <Typography.Text strong>{humanizeKey(key)}</Typography.Text>
          <div style={{ marginTop: 8 }}>{renderValue(value)}</div>
        </div>
      ))}
    </Space>
  );
}

function formatSchedule(
  report: Pick<
    CustomReportDefinition,
    'schedule_enabled' | 'schedule_frequency' | 'schedule_time' | 'schedule_day_of_week' | 'schedule_day_of_month'
  >
): string {
  if (!report.schedule_enabled) return 'Không lập lịch';

  const timeLabel = report.schedule_time ? String(report.schedule_time).slice(0, 5) : '--:--';
  if (report.schedule_frequency === 'DAILY') return `Hàng ngày lúc ${timeLabel}`;
  if (report.schedule_frequency === 'WEEKLY') {
    const weekday = weekdayOptions.find((option) => option.value === report.schedule_day_of_week)?.label ?? 'Thứ 2';
    return `${weekday} lúc ${timeLabel}`;
  }
  if (report.schedule_frequency === 'MONTHLY') {
    return `Ngày ${report.schedule_day_of_month ?? 1} lúc ${timeLabel}`;
  }
  return 'Không lập lịch';
}

export default function ReportsCenter() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<ReportFormValues>();
  const { config, saveConfig } = useUserPreferences(PAGES.REPORTS_CENTER);
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const [page, setPage] = useState(1);
  const [pageSizeOverride, setPageSizeOverride] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<ReportFilters>({
    report_type: '',
    status: '',
    schedule_enabled: '',
    is_system: '',
  });
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editing, setEditing] = useState<CustomReportDefinition | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [previewResult, setPreviewResult] = useState<CustomReportGeneratedResult | null>(null);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const namedPresets = useMemo<ReportsCenterNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const preset = item as Partial<ReportsCenterNamedPreset>;
        if (typeof preset.id !== 'string' || typeof preset.name !== 'string') return null;
        const snapshot = parseReportsCenterViewSnapshot(preset.snapshot);
        if (!snapshot) return null;
        return {
          id: preset.id,
          name: preset.name,
          snapshot,
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is ReportsCenterNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );
  const configuredPageSize = Number(configRecord.pageSize ?? 10);
  const pageSize = pageSizeOverride ?? (Number.isFinite(configuredPageSize) && configuredPageSize > 0 ? configuredPageSize : 10);

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 500,
    filterDebounceMs: 250,
    serializeFilters,
    parseFilters,
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: '-last_generated_at,-updated_at,code' };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.report_type) next.report_type = intentFilters.report_type;
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.schedule_enabled) next.schedule_enabled = intentFilters.schedule_enabled;
    if (intentFilters.is_system) next.is_system = intentFilters.is_system;
    return next;
  }, [intentFilters, intentSearch, page, pageSize]);

  const summaryParams = useMemo(() => {
    const next: Record<string, unknown> = {};
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.report_type) next.report_type = intentFilters.report_type;
    if (intentFilters.status) next.status = intentFilters.status;
    if (intentFilters.schedule_enabled) next.schedule_enabled = intentFilters.schedule_enabled;
    if (intentFilters.is_system) next.is_system = intentFilters.is_system;
    return next;
  }, [intentFilters, intentSearch]);

  const listQuery = useQuery({
    queryKey: ['reports-custom', params],
    queryFn: () => reportsApi.getCustomReports(params),
    staleTime: 15_000,
    placeholderData: (previousData) => previousData,
  });
  const summaryQuery = useQuery({
    queryKey: ['reports-custom-summary', summaryParams],
    queryFn: () => reportsApi.getCustomReportsSummary(summaryParams),
    staleTime: 15_000,
    placeholderData: (previousData) => previousData,
  });
  const detailQuery = useQuery({
    queryKey: ['reports-custom-detail', selectedReportId],
    queryFn: () => reportsApi.getCustomReport(selectedReportId as number),
    enabled: detailOpen && selectedReportId !== null,
    staleTime: 10_000,
  });
  const historyQuery = useQuery({
    queryKey: ['reports-custom-history', selectedReportId, historyPage],
    queryFn: () => reportsApi.getCustomReportHistory({ report_id: selectedReportId as number, page: historyPage, page_size: 5 }),
    enabled: detailOpen && selectedReportId !== null,
    staleTime: 10_000,
    placeholderData: (previousData) => previousData,
  });

  const createMutation = useMutation({ mutationFn: reportsApi.createCustomReport });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CustomReportUpsertPayload> }) => reportsApi.updateCustomReport(id, payload),
  });
  const deleteMutation = useMutation({ mutationFn: reportsApi.deleteCustomReport });
  const generateMutation = useMutation({ mutationFn: reportsApi.generateCustomReport });
  const scheduleMutation = useMutation({ mutationFn: reportsApi.scheduleCustomReport });

  const scheduleEnabled = Boolean(Form.useWatch('schedule_enabled', form));
  const scheduleFrequency = (Form.useWatch('schedule_frequency', form) as CustomReportScheduleFrequency | undefined) ?? 'NONE';

  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;
  const summary = summaryQuery.data;
  const detailData = detailQuery.data;
  const historyRows = historyQuery.data?.results ?? detailData?.recent_runs ?? [];
  const historyTotal = historyQuery.data?.count ?? detailData?.recent_runs?.length ?? 0;
  const totalReports = summary?.total_count ?? 0;
  const scheduledCount = summary?.scheduled_count ?? 0;
  const systemCount = summary?.system_count ?? 0;
  const runCount = summary?.run_count ?? 0;
  const readyCount = (summary?.generated_count ?? 0) + (summary?.finalized_count ?? 0);
  const draftCount = summary?.draft_count ?? 0;
  const archivedCount = summary?.archived_count ?? 0;
  const failedReports = rows.filter((report) => report.last_run_status === 'FAILED').length;
  const staleReports = rows.filter((report) => !report.last_generated_at || dayjs().diff(dayjs(report.last_generated_at), 'day') >= 14).length;
  const dueSoonReports = rows.filter((report) => report.schedule_enabled && report.next_run_at && dayjs(report.next_run_at).isBefore(dayjs().add(48, 'hour'))).length;
  const activeFilterCount =
    Number(Boolean(intentSearch.trim())) +
    Number(Boolean(intentFilters.report_type)) +
    Number(Boolean(intentFilters.status)) +
    Number(Boolean(intentFilters.schedule_enabled)) +
    Number(Boolean(intentFilters.is_system));
  const automationRate = totalReports > 0 ? Math.round((scheduledCount / totalReports) * 100) : 0;
  const customCount = Math.max(totalReports - systemCount, 0);
  const latestGeneratedAt = rows.reduce<string | null>((latest, report) => {
    if (!report.last_generated_at) return latest;
    if (!latest) return report.last_generated_at;
    return dayjs(report.last_generated_at).isAfter(dayjs(latest)) ? report.last_generated_at : latest;
  }, null);

  const reportShortcuts = [
    {
      key: 'create',
      title: 'Tạo báo cáo mới',
      description: 'Khởi tạo nhanh một biểu mẫu điều hành mới cho tài chính, mua hàng hoặc vận hành.',
      badge: 'Setup',
      onClick: openCreateModal,
    },
    {
      key: 'profit',
      title: 'Chạy Profit report',
      description: 'Tạo ngay báo cáo lợi nhuận mới nhất để đối chiếu kết quả kinh doanh.',
      badge: 'Run',
      onClick: () => void handleRunReport({ report_code: 'PROFIT_REPORT' }),
    },
    {
      key: 'inventory-health',
      title: 'Sức khỏe tồn kho',
      description: 'Lấy nhanh bức tranh tồn kho để phát hiện hàng chậm luân chuyển và điểm nghẽn.',
      badge: 'Ops',
      onClick: () => void handleRunReport({ report_code: 'INVENTORY_HEALTH' }),
    },
    {
      key: 'export',
      title: 'Xuất danh mục đang lọc',
      description: activeFilterCount > 0
        ? `Xuất ${rows.length.toLocaleString('vi-VN')} báo cáo theo bộ lọc hiện tại ra CSV.`
        : 'Xuất toàn bộ danh mục báo cáo hiện có ra CSV để chia sẻ hoặc rà soát ngoại tuyến.',
      badge: activeFilterCount > 0 ? `${activeFilterCount} filters` : 'CSV',
      onClick: exportCurrentRows,
    },
  ];

  const reportWatchlist = [
    {
      key: 'failed',
      title: failedReports > 0 ? `${failedReports} báo cáo chạy lỗi gần nhất` : 'Không có báo cáo lỗi trong tập hiện tại',
      detail: failedReports > 0
        ? 'Ưu tiên mở chi tiết các báo cáo lỗi để kiểm tra cấu hình, nguồn dữ liệu hoặc lịch chạy.'
        : 'Luồng chạy gần đây đang ổn định, chưa ghi nhận báo cáo thất bại trong danh mục đang hiển thị.',
      tone: failedReports > 0 ? 'critical' : 'steady',
    },
    {
      key: 'stale',
      title: staleReports > 0 ? `${staleReports} báo cáo chưa được làm mới đủ lâu` : 'Không có báo cáo bị cũ dữ liệu',
      detail: staleReports > 0
        ? 'Các báo cáo này đã hơn 14 ngày chưa chạy hoặc chưa từng được tạo, nên cân nhắc làm mới hoặc dọn lại lịch.'
        : 'Tần suất làm mới dữ liệu đang ổn với tập báo cáo xuất hiện trên màn hình này.',
      tone: staleReports > 0 ? 'warning' : 'steady',
    },
    {
      key: 'schedule',
      title: scheduledCount > 0 ? `${scheduledCount} báo cáo đang có lịch tự động` : 'Chưa có báo cáo nào được tự động hóa',
      detail: dueSoonReports > 0
        ? `${dueSoonReports} lịch sẽ chạy trong 48 giờ tới, phù hợp để rà lại đầu ra và người nhận.`
        : 'Khu vực này cho biết độ phủ tự động hóa của command center báo cáo.',
      tone: scheduledCount === 0 ? 'warning' : 'steady',
    },
    {
      key: 'draft',
      title: draftCount > 0 ? `${draftCount} báo cáo vẫn ở trạng thái nháp` : 'Không còn báo cáo nào đang ở trạng thái nháp',
      detail: draftCount > 0
        ? 'Những báo cáo nháp thường là phần việc dở dang hoặc mẫu đang chờ chuẩn hóa trước khi đi vào vận hành.'
        : 'Danh mục đang nghiêng về các báo cáo đã sẵn sàng dùng hoặc đã lưu trữ.',
      tone: draftCount > 0 ? 'warning' : 'steady',
    },
  ] as const;

  const previewColumns = useMemo<ColumnsType<Record<string, unknown>>>(() => {
    const firstRow = previewResult?.rows?.[0];
    if (!firstRow) return [];
    return Object.keys(firstRow).map((key) => ({
      title: humanizeKey(key),
      dataIndex: key,
      key,
      width: 180,
      render: (value: unknown) => renderValue(value),
    }));
  }, [previewResult]);

  const activeContextTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Tìm kiếm: ${intentSearch.trim()}`);
    if (intentFilters.report_type) tags.push(`Loại: ${reportTypeLabels[intentFilters.report_type]}`);
    if (intentFilters.status) tags.push(`Trạng thái: ${statusLabels[intentFilters.status]}`);
    if (intentFilters.schedule_enabled === 'true') tags.push('Lập lịch: Có');
    if (intentFilters.schedule_enabled === 'false') tags.push('Lập lịch: Không');
    if (intentFilters.is_system === 'true') tags.push('Báo cáo hệ thống: Có');
    if (intentFilters.is_system === 'false') tags.push('Báo cáo hệ thống: Không');
    tags.push(`Kích thước trang: ${pageSize}`);
    if (selectedViewPreset) tags.push(`Mẫu lọc: ${selectedViewPreset.name}`);
    return tags;
  }, [intentFilters.is_system, intentFilters.report_type, intentFilters.schedule_enabled, intentFilters.status, intentSearch, pageSize, selectedViewPreset]);

  const buildCurrentSnapshot = (): ReportsCenterViewSnapshot => ({
    searchInput,
    filters,
    pageSize,
  });

  const applySnapshot = (snapshot: ReportsCenterViewSnapshot) => {
    setSearchInput(snapshot.searchInput);
    setFilters(snapshot.filters);
    setPageSizeOverride(snapshot.pageSize);
    setPage(1);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        saved_view: buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem báo cáo.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem báo cáo.');
    }
  };

  const applySavedView = () => {
    const savedView = parseReportsCenterViewSnapshot(configRecord.saved_view);
    if (!savedView) {
      messageApi.warning('Chưa có chế độ xem báo cáo đã lưu.');
      return;
    }
    applySnapshot(savedView);
    messageApi.success('Đã khôi phục chế độ xem báo cáo.');
  };

  const saveNamedPreset = async () => {
    const trimmedName = viewPresetName.trim();
    if (!trimmedName) {
      messageApi.warning('Nhập tên mẫu lọc báo cáo.');
      return;
    }
    const snapshot = buildCurrentSnapshot();
    const presetId = selectedViewPreset?.id ?? `${Date.now()}`;
    const nextPresets = [
      ...namedPresets.filter((item) => item.id !== presetId),
      {
        id: presetId,
        name: trimmedName,
        snapshot,
        updatedAt: new Date().toISOString(),
      },
    ];
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        saved_view: snapshot,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId(presetId);
      setIsViewPresetModalOpen(false);
      setViewPresetName('');
      messageApi.success('Đã lưu mẫu lọc báo cáo.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc báo cáo.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Chọn một mẫu lọc báo cáo để áp dụng.');
      return;
    }
    applySnapshot(preset.snapshot);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Chọn một mẫu lọc báo cáo để xóa.');
      return;
    }
    const nextPresets = namedPresets.filter((item) => item.id !== preset.id);
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        saved_view: configRecord.saved_view,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId((current) => (current === preset.id ? undefined : current));
      messageApi.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc báo cáo.');
    }
  };

  async function invalidateReports(reportId?: number) {
    await queryClient.invalidateQueries({ queryKey: ['reports-custom'] });
    await queryClient.invalidateQueries({ queryKey: ['reports-custom-summary'] });
    if (reportId) {
      await queryClient.invalidateQueries({ queryKey: ['reports-custom-detail', reportId] });
      await queryClient.invalidateQueries({ queryKey: ['reports-custom-history', reportId] });
    }
  }

  function openCreateModal() {
    setEditing(null);
    form.setFieldsValue(createEmptyFormValues());
    setFormOpen(true);
  }

  function openEditModal(report: CustomReportDefinition) {
    setEditing(report);
    form.setFieldsValue({
      code: report.code,
      name: report.name,
      report_type: report.report_type,
      description: report.description || '',
      status: report.status,
      period: report.period_start && report.period_end ? [dayjs(report.period_start), dayjs(report.period_end)] : undefined,
      schedule_enabled: report.schedule_enabled,
      schedule_frequency: report.schedule_frequency,
      schedule_time: parseTimeValue(report.schedule_time) ?? createDefaultScheduleTime(),
      schedule_day_of_week: report.schedule_day_of_week ?? 0,
      schedule_day_of_month: report.schedule_day_of_month ?? 1,
      schedule_recipients: report.schedule_recipients ?? [],
    });
    setFormOpen(true);
  }

  function closeFormModal() {
    setFormOpen(false);
    setEditing(null);
    form.resetFields();
  }

  function openDetailModal(reportId: number) {
    setSelectedReportId(reportId);
    setHistoryPage(1);
    setDetailOpen(true);
  }

  function closeDetailModal() {
    setDetailOpen(false);
    setSelectedReportId(null);
    setHistoryPage(1);
  }

  function closePreviewModal() {
    setPreviewOpen(false);
    setPreviewResult(null);
  }

  function validateSchedule(values: ReportFormValues): boolean {
    if (!values.schedule_enabled) return true;

    const nextErrors: Array<{ name: keyof ReportFormValues; errors: string[] }> = [];
    if (!values.schedule_frequency || values.schedule_frequency === 'NONE') {
      nextErrors.push({ name: 'schedule_frequency', errors: ['Chọn tần suất lập lịch'] });
    }
    if (!values.schedule_time) {
      nextErrors.push({ name: 'schedule_time', errors: ['Chọn giờ chạy'] });
    }
    if (values.schedule_frequency === 'WEEKLY' && values.schedule_day_of_week === null) {
      nextErrors.push({ name: 'schedule_day_of_week', errors: ['Chọn thứ trong tuần'] });
    }
    if (values.schedule_frequency === 'MONTHLY' && values.schedule_day_of_month === null) {
      nextErrors.push({ name: 'schedule_day_of_month', errors: ['Chọn ngày trong tháng'] });
    }
    if (nextErrors.length) {
      form.setFields(nextErrors as Parameters<typeof form.setFields>[0]);
      return false;
    }
    return true;
  }

  function buildPayload(values: ReportFormValues): CustomReportUpsertPayload {
    const codeSource = values.code || editing?.code || values.name || values.report_type;
    return {
      code: normalizeCode(codeSource),
      name: values.name.trim(),
      report_type: values.report_type,
      description: values.description.trim(),
      status: values.status,
      period_start: values.period?.[0]?.format('YYYY-MM-DD') ?? null,
      period_end: values.period?.[1]?.format('YYYY-MM-DD') ?? null,
      schedule_enabled: values.schedule_enabled,
      schedule_frequency: values.schedule_enabled ? values.schedule_frequency : 'NONE',
      schedule_time: values.schedule_enabled && values.schedule_time ? values.schedule_time.format('HH:mm:ss') : null,
      schedule_day_of_week: values.schedule_enabled && values.schedule_frequency === 'WEEKLY' ? values.schedule_day_of_week : null,
      schedule_day_of_month: values.schedule_enabled && values.schedule_frequency === 'MONTHLY' ? values.schedule_day_of_month : null,
      schedule_recipients: values.schedule_enabled ? values.schedule_recipients.map((item) => item.trim()).filter(Boolean) : [],
    };
  }

  async function submitForm(runAfterSave = false) {
    try {
      const values = await form.validateFields();
      if (!validateSchedule(values)) return;

      const payload = buildPayload(values);
      const savedReport = editing ? await updateMutation.mutateAsync({ id: editing.id, payload }) : await createMutation.mutateAsync(payload);
      await invalidateReports(savedReport.id);
      messageApi.success(editing ? 'Đã cập nhật báo cáo' : 'Đã tạo báo cáo');
      closeFormModal();

      if (runAfterSave) {
        await handleRunReport({
          report_id: savedReport.id,
          period_start: payload.period_start ?? undefined,
          period_end: payload.period_end ?? undefined,
        });
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in (error as Record<string, unknown>)) return;
      messageApi.error(getToastMessage(error, editing ? 'Cập nhật báo cáo thất bại' : 'Tạo báo cáo thất bại'));
    }
  }

  async function handleRunReport(payload: GenerateCustomReportPayload) {
    try {
      const result = await generateMutation.mutateAsync(payload);
      await invalidateReports(result.id);
      setPreviewResult(result);
      setPreviewOpen(true);
      messageApi.success('Đã chạy báo cáo');
    } catch (error) {
      messageApi.error(getToastMessage(error, 'Chạy báo cáo thất bại'));
    }
  }

  function confirmDelete(report: CustomReportDefinition) {
    Modal.confirm({
      title: 'Xóa báo cáo?',
      content: `Báo cáo ${report.code} - ${report.name} sẽ bị xóa khỏi hệ thống.`,
      okText: 'Xóa',
      okButtonProps: { danger: true },
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          await deleteMutation.mutateAsync(report.id);
          await invalidateReports(report.id);
          if (selectedReportId === report.id) closeDetailModal();
          messageApi.success('Đã xóa báo cáo');
        } catch (error) {
          messageApi.error(getToastMessage(error, 'Xóa báo cáo thất bại'));
          throw error;
        }
      },
    });
  }

  function confirmDisableSchedule(report: CustomReportDefinition) {
    Modal.confirm({
      title: 'Dừng lịch báo cáo?',
      content: `Lịch tự động của ${report.code} sẽ được tắt.`,
      okText: 'Dừng lịch',
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          await scheduleMutation.mutateAsync({ report_id: report.id, schedule_enabled: false });
          await invalidateReports(report.id);
          messageApi.success('Đã dừng lịch báo cáo');
        } catch (error) {
          messageApi.error(getToastMessage(error, 'Cập nhật lịch thất bại'));
          throw error;
        }
      },
    });
  }

  function exportCurrentRows() {
    if (!rows.length) {
      messageApi.warning('Không có dữ liệu để xuất');
      return;
    }
    const csvRows = rows.map((report) => ({
      Ma: report.code,
      Ten: report.name,
      Loai: reportTypeLabels[report.report_type],
      Trang_thai: statusLabels[report.status],
      Lap_lich: formatSchedule(report),
      Ke_tiep: formatDateTime(report.next_run_at),
      Lan_chay_gan_nhat: formatDateTime(report.last_generated_at),
      So_lan_chay: report.run_count,
      He_thong: report.is_system ? 'Có' : 'Không',
    }));
    downloadCSV(csvRows, 'reports-center');
  }

  const reportColumns: ColumnsType<CustomReportDefinition> = [
    {
      title: 'Ma',
      dataIndex: 'code',
      key: 'code',
      width: 150,
      render: (value: string, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{value}</Typography.Text>
          {row.is_system ? <Tag color="geekblue">Hệ thống</Tag> : null}
        </Space>
      ),
    },
    {
      title: 'Báo cáo',
      dataIndex: 'name',
      key: 'name',
      width: 260,
      render: (_value: string, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{row.name}</Typography.Text>
          <Typography.Text type="secondary">{reportTypeLabels[row.report_type]}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: CustomReportStatus) => <Tag color={statusColors[value]}>{statusLabels[value]}</Tag>,
    },
    {
      title: 'Thời kỳ',
      key: 'period',
      width: 190,
      render: (_value, row) => row.period_start && row.period_end ? `${formatDate(row.period_start)} - ${formatDate(row.period_end)}` : '-',
    },
    {
      title: 'Lập lịch',
      key: 'schedule',
      width: 220,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Tag color={row.schedule_enabled ? 'processing' : 'default'}>
            {row.schedule_enabled ? scheduleLabels[row.schedule_frequency] : 'Không lập lịch'}
          </Tag>
          <Typography.Text type="secondary">{formatSchedule(row)}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Lần chạy gần nhất',
      key: 'last_generated_at',
      width: 180,
      render: (_value, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{formatDateTime(row.last_generated_at)}</Typography.Text>
          <Typography.Text type="secondary">{row.generated_by_name || '-'}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Kế tiếp',
      dataIndex: 'next_run_at',
      key: 'next_run_at',
      width: 170,
      render: (value: string | null | undefined) => formatDateTime(value),
    },
    {
      title: 'Số lần chạy',
      dataIndex: 'run_count',
      key: 'run_count',
      width: 120,
      align: 'right',
      render: (value: number) => value.toLocaleString('vi-VN'),
    },
    {
      title: 'Hành động',
      key: 'actions',
      fixed: 'right',
      width: 340,
      render: (_value, row) => (
        <Space wrap size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetailModal(row.id)}>Xem</Button>
          <Button
            size="small"
            icon={<FileTextOutlined />}
            loading={generateMutation.isPending}
            onClick={() => void handleRunReport({ report_id: row.id, period_start: row.period_start ?? undefined, period_end: row.period_end ?? undefined })}
          >
            Chạy
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(row)}>Sửa</Button>
          {row.schedule_enabled ? (
            <Button size="small" icon={<PauseCircleOutlined />} loading={scheduleMutation.isPending} onClick={() => confirmDisableSchedule(row)}>
              Dừng lịch
            </Button>
          ) : (
            <Button size="small" icon={<ClockCircleOutlined />} onClick={() => openEditModal(row)}>Lập lịch</Button>
          )}
          {!row.is_system ? (
            <Button danger size="small" icon={<DeleteOutlined />} loading={deleteMutation.isPending} onClick={() => confirmDelete(row)}>
              Xóa
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const historyColumns: ColumnsType<CustomReportRun> = [
    { title: 'Thời gian', dataIndex: 'generated_at', key: 'generated_at', width: 170, render: (value: string) => formatDateTime(value) },
    {
      title: 'Kích hoạt',
      dataIndex: 'trigger_type',
      key: 'trigger_type',
      width: 120,
      render: (value: CustomReportRun['trigger_type']) => (value === 'SCHEDULED' ? <Tag color="processing">Lịch</Tag> : <Tag>Thủ công</Tag>),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: CustomReportRun['status']) => (value === 'SUCCESS' ? <Tag color="success">Thành công</Tag> : <Tag color="error">Thất bại</Tag>),
    },
    {
      title: 'Thời kỳ',
      key: 'period',
      width: 180,
      render: (_value, row) => row.period_start && row.period_end ? `${formatDate(row.period_start)} - ${formatDate(row.period_end)}` : '-',
    },
    { title: 'Số dòng', dataIndex: 'row_count', key: 'row_count', width: 110, align: 'right', render: (value: number) => value.toLocaleString('vi-VN') },
    { title: 'Xử lý', dataIndex: 'duration_ms', key: 'duration_ms', width: 120, align: 'right', render: (value: number) => `${value.toLocaleString('vi-VN')} ms` },
    { title: 'Người chạy', dataIndex: 'generated_by_name', key: 'generated_by_name', width: 150, render: (value: string | null | undefined) => value || '-' },
  ];

  return (
    <div style={{ padding: 20 }}>
      {contextHolder}

      <div className="command-center">
        <section className="command-center-hero">
          <div className="command-center-hero-grid">
            <div>
              <div className="command-center-eyebrow">Reports Command Center</div>
              <div className="command-center-title">
                Tạo, lập lịch và điều phối báo cáo như một trung tâm điều hành dữ liệu.
              </div>
              <div className="command-center-description">
                Tầng báo cáo bây giờ ưu tiên rõ các chỉ số nóng, độ phủ tự động hóa và những mẫu cần xử lý để số liệu ra quyết định luôn đi đúng nhịp vận hành.
              </div>
              <div className="command-center-hero-badges">
                <div className="command-center-hero-badge">
                  <span>Tổng báo cáo</span>
                  <span className="command-center-hero-badge-value">{totalReports.toLocaleString('vi-VN')}</span>
                </div>
                <div className="command-center-hero-badge">
                  <span>Tự động hóa</span>
                  <span className="command-center-hero-badge-value">{automationRate}%</span>
                </div>
                <div className="command-center-hero-badge">
                  <span>Đang lọc</span>
                  <span className="command-center-hero-badge-value">{activeFilterCount}</span>
                </div>
                <div className="command-center-hero-badge">
                  <span>Lần chạy</span>
                  <span className="command-center-hero-badge-value">{runCount.toLocaleString('vi-VN')}</span>
                </div>
              </div>
              <div className="command-center-hero-actions">
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                  Tạo báo cáo
                </Button>
                <Button icon={<ReloadOutlined />} onClick={() => { void listQuery.refetch(); void summaryQuery.refetch(); }}>
                  Làm mới command center
                </Button>
                <Button icon={<DownloadOutlined />} onClick={exportCurrentRows}>
                  Xuất CSV hiện tại
                </Button>
              </div>
            </div>

            <div className="command-center-hero-meta">
              <div className="command-center-hero-card">
                <div className="command-center-hero-card-label">Độ phủ điều hành</div>
                <div className="command-center-hero-card-value">{readyCount.toLocaleString('vi-VN')}</div>
                <div className="command-center-hero-card-caption">
                  {totalReports > 0
                    ? `${readyCount.toLocaleString('vi-VN')} trên ${totalReports.toLocaleString('vi-VN')} báo cáo đã ở trạng thái sẵn sàng sử dụng.`
                    : 'Chưa có dữ liệu tóm tắt để đo độ phủ điều hành.'}
                  {latestGeneratedAt ? ` Lần tạo gần nhất vào ${formatDateTime(latestGeneratedAt)}.` : ''}
                </div>
                <div className="command-center-hero-score-grid">
                  <div className="command-center-hero-score">
                    <div className="command-center-hero-score-label">Có lịch</div>
                    <div className="command-center-hero-score-value">{scheduledCount}</div>
                    <div className="command-center-hero-score-caption">Báo cáo đang chạy tự động.</div>
                  </div>
                  <div className="command-center-hero-score">
                    <div className="command-center-hero-score-label">Lỗi gần nhất</div>
                    <div className="command-center-hero-score-value">{failedReports}</div>
                    <div className="command-center-hero-score-caption">Cần rà soát đầu ra hoặc cấu hình.</div>
                  </div>
                  <div className="command-center-hero-score">
                    <div className="command-center-hero-score-label">Custom</div>
                    <div className="command-center-hero-score-value">{customCount}</div>
                    <div className="command-center-hero-score-caption">Biểu mẫu do đội nghiệp vụ tự vận hành.</div>
                  </div>
                  <div className="command-center-hero-score">
                    <div className="command-center-hero-score-label">Lưu trữ</div>
                    <div className="command-center-hero-score-value">{archivedCount}</div>
                    <div className="command-center-hero-score-caption">Báo cáo đã kết thúc vòng đời.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="workspace-split-grid">
          <div className="command-center-stack">
            <section className="command-center-panel">
              <div className="command-center-panel-header">
                <div>
                  <div className="command-center-panel-kicker">Điều phối nhanh</div>
                  <div className="command-center-panel-title">Luồng thao tác ưu tiên</div>
                  <div className="command-center-panel-subtitle">
                    Những hành động quan trọng nhất để đội vận hành báo cáo có thể tạo mới, chạy ngay hoặc xuất dữ liệu mà không phải đi lòng vòng.
                  </div>
                </div>
                <div className="workspace-pill">{rows.length.toLocaleString('vi-VN')} mục trong danh sách</div>
              </div>
              <div className="command-center-shortcuts">
                {reportShortcuts.map((shortcut) => (
                  <button
                    key={shortcut.key}
                    type="button"
                    className="command-center-shortcut"
                    onClick={shortcut.onClick}
                  >
                    <div className="command-center-shortcut-meta">
                      <div className="command-center-shortcut-title">{shortcut.title}</div>
                      <span className="command-center-shortcut-badge">{shortcut.badge}</span>
                    </div>
                    <div className="command-center-shortcut-description">{shortcut.description}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="command-center-panel">
              <div className="command-center-panel-header">
                <div>
                  <div className="command-center-panel-kicker">Mẫu chạy nhanh</div>
                  <div className="command-center-panel-title">Bộ báo cáo dùng thường xuyên</div>
                  <div className="command-center-panel-subtitle">
                    Các template được gọi nhanh cho tài chính, mua hàng, tồn kho và hiệu suất nhân sự.
                  </div>
                </div>
              </div>
              <Space wrap size={[12, 12]}>
                {quickRunReports.map((item) => (
                  <Button
                    key={item.code}
                    icon={<FileTextOutlined />}
                    loading={generateMutation.isPending}
                    onClick={() => void handleRunReport({ report_code: item.code })}
                  >
                    {item.label}
                  </Button>
                ))}
              </Space>
            </section>
          </div>

          <div className="command-center-stack">
            <section className="command-center-panel">
              <div className="command-center-panel-header">
                <div>
                  <div className="command-center-panel-kicker">Watchlist</div>
                  <div className="command-center-panel-title">Điểm cần theo dõi</div>
                  <div className="command-center-panel-subtitle">
                    Khu vực tóm tắt những trạng thái đáng chú ý nhất trong danh mục báo cáo hiện tại.
                  </div>
                </div>
              </div>
              <div className="command-center-watchlist">
                {reportWatchlist.map((item) => (
                  <div key={item.key} className={`command-center-watch-item command-center-watch-item--${item.tone}`}>
                    <div className="command-center-watch-title">{item.title}</div>
                    <div className="command-center-watch-detail">{item.detail}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="command-center-panel">
              <div className="command-center-panel-header">
                <div>
                  <div className="command-center-panel-kicker">Kết nối nhanh</div>
                  <div className="command-center-panel-title">Báo cáo liên quan</div>
                  <div className="command-center-panel-subtitle">
                    Bật ngay các khu vực tài chính liên quan để đối chiếu dữ liệu sau khi báo cáo hoàn tất.
                  </div>
                </div>
              </div>
              <div className="workspace-metric-grid">
                <div className={`workspace-metric-card ${failedReports > 0 ? 'workspace-metric-card--critical' : 'workspace-metric-card--steady'}`}>
                  <div className="workspace-metric-eyebrow">Sức khỏe lịch chạy</div>
                  <div className="workspace-metric-value">{failedReports}</div>
                  <div className="workspace-metric-caption">
                    {failedReports > 0 ? 'Có báo cáo lỗi cần ưu tiên xử lý.' : 'Chưa ghi nhận lịch chạy lỗi trong tập dữ liệu hiện tại.'}
                  </div>
                </div>
                <div className={`workspace-metric-card ${staleReports > 0 ? 'workspace-metric-card--warning' : 'workspace-metric-card--steady'}`}>
                  <div className="workspace-metric-eyebrow">Báo cáo cũ</div>
                  <div className="workspace-metric-value">{staleReports}</div>
                  <div className="workspace-metric-caption">
                    Những báo cáo này nên được chạy lại hoặc xem xét lưu trữ.
                  </div>
                </div>
              </div>
              <Space wrap size={[12, 12]} style={{ marginTop: 16 }}>
                {quickLinks.map((item) => (
                  <Link key={item.to} to={item.to}>
                    <Button icon={<LinkOutlined />}>{item.label}</Button>
                  </Link>
                ))}
              </Space>
            </section>
          </div>
        </div>

        <section className="command-center-panel">
          <div className="command-center-panel-header">
            <div>
              <div className="command-center-panel-kicker">Danh mục báo cáo</div>
              <div className="command-center-panel-title">Điều hướng, lọc và kiểm soát vòng đời báo cáo</div>
              <div className="command-center-panel-subtitle">
                {activeFilterCount > 0
                  ? `Đang áp dụng ${activeFilterCount} bộ lọc để thu hẹp danh mục theo nhu cầu điều hành.`
                  : 'Toàn bộ danh mục đang hiển thị để đội vận hành có thể rà soát từ góc nhìn tổng thể.'}
              </div>
            </div>
            <div className="workspace-pill">
              {listQuery.isFetching || summaryQuery.isFetching ? 'Đang đồng bộ' : 'Dữ liệu mới'}
            </div>
          </div>

          <div className="workspace-toolbar" style={{ marginBottom: 18 }}>
            <div className="workspace-toolbar-group">
              <div data-testid="reports-center-command-strip">
                <Space wrap>
                  <Button data-testid="reports-center-save-view" onClick={() => void saveCurrentView()}>
                    Lưu chế độ xem
                  </Button>
                  <Button data-testid="reports-center-restore-view" onClick={applySavedView}>
                    Khôi phục
                  </Button>
                  <Button
                    data-testid="reports-center-open-preset-modal"
                    onClick={() => {
                      setViewPresetName(selectedViewPreset?.name ?? '');
                      setIsViewPresetModalOpen(true);
                    }}
                  >
                    Tạo mẫu lọc
                  </Button>
                  <div data-testid="reports-center-preset-select" style={{ display: 'inline-block' }}>
                    <Select
                      style={{ width: 230 }}
                      placeholder="Chọn mẫu lọc báo cáo"
                      value={selectedViewPresetId}
                      onChange={(value) => setSelectedViewPresetId(value)}
                      options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
                    />
                  </div>
                  <Button data-testid="reports-center-apply-preset" onClick={applyNamedPreset}>
                    Ap dung mau
                  </Button>
                  <Button danger data-testid="reports-center-delete-preset" onClick={() => void deleteNamedPreset()}>
                    Xoa mau
                  </Button>
                </Space>
              </div>
              <Input data-testid="reports-center-search"
                className="workspace-filter-input"
                placeholder="Tìm mã, tên hoặc mô tả..."
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setPage(1);
                }}
              />
              <Select placeholder="Loại báo cáo" value={filters.report_type || undefined} onChange={(value) => { setFilters((current) => ({ ...current, report_type: (value ?? '') as ReportFilters['report_type'] })); setPage(1); }} allowClear style={{ width: 170 }} options={reportTypeOptions} />
              <Select placeholder="Trạng thái" value={filters.status || undefined} onChange={(value) => { setFilters((current) => ({ ...current, status: (value ?? '') as ReportFilters['status'] })); setPage(1); }} allowClear style={{ width: 150 }} options={statusOptions} />
              <Select placeholder="Lập lịch" value={filters.schedule_enabled || undefined} onChange={(value) => { setFilters((current) => ({ ...current, schedule_enabled: (value ?? '') as BooleanFilterValue })); setPage(1); }} allowClear style={{ width: 150 }} options={booleanFilterOptions} />
              <Select placeholder="Báo cáo hệ thống" value={filters.is_system || undefined} onChange={(value) => { setFilters((current) => ({ ...current, is_system: (value ?? '') as BooleanFilterValue })); setPage(1); }} allowClear style={{ width: 170 }} options={booleanFilterOptions} />
            </div>

            <div className="workspace-toolbar-group">
              <Button icon={<ReloadOutlined />} onClick={() => { void listQuery.refetch(); void summaryQuery.refetch(); }}>Làm mới</Button>
              <Button icon={<DownloadOutlined />} onClick={exportCurrentRows}>Xuất CSV</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>Tạo báo cáo</Button>
            </div>
          </div>

          <Space wrap style={{ marginBottom: 18 }}>
            {activeContextTags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>

          {listQuery.isLoading ? (
            <Skeleton active />
          ) : (
            <Table
              columns={reportColumns}
              dataSource={rows}
              rowKey="id"
              scroll={{ x: 1700 }}
              pagination={{
                current: page,
                pageSize,
                total,
                showSizeChanger: true,
                pageSizeOptions: ['10', '20', '50'],
                onChange: (nextPage, nextPageSize) => {
                  if (nextPageSize && nextPageSize !== pageSize) {
                    setPageSizeOverride(nextPageSize);
                    setPage(1);
                    return;
                  }
                  setPage(nextPage);
                },
              }}
              locale={{ emptyText: <Empty description="Chưa có báo cáo nào" /> }}
            />
          )}
        </section>
      </div>

      <Modal
        title="Lưu mẫu lọc báo cáo"
        open={isViewPresetModalOpen}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Dong"
      >
        <Input
          data-testid="reports-center-preset-name"
          value={viewPresetName}
          onChange={(event) => setViewPresetName(event.target.value)}
          placeholder="Ví dụ: Báo cáo tài chính theo bộ lọc ca"
        />
      </Modal>

      <Modal
        title={editing ? `Cập nhật báo cáo ${editing.code}` : 'Tạo báo cáo mới'}
        open={formOpen}
        onCancel={closeFormModal}
        width={820}
        footer={[
          <Button key="cancel" onClick={closeFormModal}>Đóng</Button>,
          <Button key="save" loading={createMutation.isPending || updateMutation.isPending} onClick={() => void submitForm(false)}>Lưu</Button>,
          <Button key="save-run" type="primary" loading={createMutation.isPending || updateMutation.isPending || generateMutation.isPending} onClick={() => void submitForm(true)}>
            Lưu và chạy
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical" initialValues={createEmptyFormValues()}>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="Tên báo cáo" name="name" rules={[{ required: true, message: 'Nhập tên báo cáo' }]}>
                <Input placeholder="Ví dụ: Tổng hợp doanh thu tháng" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Mã báo cáo" name="code" tooltip="Nếu bỏ trống, hệ thống sẽ tự tạo từ tên báo cáo.">
                <Input placeholder="Ví dụ: SALES_MONTHLY_SUMMARY" disabled={Boolean(editing?.is_system)} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Loại báo cáo" name="report_type" rules={[{ required: true, message: 'Chọn loại báo cáo' }]}>
                <Select options={reportTypeOptions} disabled={Boolean(editing?.is_system)} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="Trạng thái" name="status" rules={[{ required: true, message: 'Chọn trạng thái' }]}>
                <Select options={statusOptions} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="Mô tả" name="description">
                <Input.TextArea rows={3} placeholder="Mô tả mục tiêu và cách dùng báo cáo" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="Thời kỳ mặc định" name="period">
                <RangePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Card size="small" title="Lập lịch">
            <Row gutter={16}>
              <Col xs={24} md={8}>
                <Form.Item label="Bật lịch chạy" name="schedule_enabled" valuePropName="checked">
                  <Switch
                    checkedChildren="Bật"
                    unCheckedChildren="Tắt"
                    onChange={(checked) => {
                      form.setFieldValue('schedule_enabled', checked);
                      if (checked && form.getFieldValue('schedule_frequency') === 'NONE') form.setFieldValue('schedule_frequency', 'DAILY');
                      if (!checked) form.setFieldValue('schedule_frequency', 'NONE');
                    }}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="Tần suất" name="schedule_frequency">
                  <Select options={scheduleFrequencyOptions} disabled={!scheduleEnabled} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item label="Giờ chạy" name="schedule_time">
                  <TimePicker style={{ width: '100%' }} format="HH:mm" minuteStep={5} disabled={!scheduleEnabled} />
                </Form.Item>
              </Col>
              {scheduleEnabled && scheduleFrequency === 'WEEKLY' ? (
                <Col xs={24} md={12}>
                  <Form.Item label="Thứ trong tuần" name="schedule_day_of_week">
                    <Select options={weekdayOptions} />
                  </Form.Item>
                </Col>
              ) : null}
              {scheduleEnabled && scheduleFrequency === 'MONTHLY' ? (
                <Col xs={24} md={12}>
                  <Form.Item label="Ngày trong tháng" name="schedule_day_of_month">
                    <InputNumber min={1} max={31} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              ) : null}
              <Col span={24}>
                <Form.Item label="Email nhận báo cáo" name="schedule_recipients">
                  <Select mode="tags" tokenSeparators={[',', ';']} open={false} disabled={!scheduleEnabled} placeholder="Nhập email rồi nhấn Enter" />
                </Form.Item>
              </Col>
            </Row>
          </Card>
        </Form>
      </Modal>

      <Modal
        title={detailData ? `Chi tiết ${detailData.code}` : 'Chi tiết báo cáo'}
        open={detailOpen}
        onCancel={closeDetailModal}
        width={1100}
        footer={[
          <Button key="close" onClick={closeDetailModal}>Đóng</Button>,
          <Button key="edit" onClick={() => { if (!detailData) return; closeDetailModal(); openEditModal(detailData); }}>Sửa</Button>,
          <Button key="run" type="primary" loading={generateMutation.isPending} onClick={() => { if (!detailData) return; void handleRunReport({ report_id: detailData.id, period_start: detailData.period_start ?? undefined, period_end: detailData.period_end ?? undefined }); }}>
            Chạy ngay
          </Button>,
        ]}
      >
        {detailQuery.isLoading ? (
          <Skeleton active />
        ) : detailData ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" title="Thông tin chính">
              <Row gutter={[16, 16]}>
                <Col xs={24} md={12}><Typography.Text type="secondary">Mã</Typography.Text><div style={{ marginTop: 4, fontWeight: 600 }}>{detailData.code}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Tên</Typography.Text><div style={{ marginTop: 4, fontWeight: 600 }}>{detailData.name}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Loại</Typography.Text><div style={{ marginTop: 4 }}>{reportTypeLabels[detailData.report_type]}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Trạng thái</Typography.Text><div style={{ marginTop: 4 }}><Tag color={statusColors[detailData.status]}>{statusLabels[detailData.status]}</Tag></div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Thời kỳ</Typography.Text><div style={{ marginTop: 4 }}>{detailData.period_start && detailData.period_end ? `${formatDate(detailData.period_start)} - ${formatDate(detailData.period_end)}` : '-'}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Lập lịch</Typography.Text><div style={{ marginTop: 4 }}>{formatSchedule(detailData)}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Lần chạy gần nhất</Typography.Text><div style={{ marginTop: 4 }}>{formatDateTime(detailData.last_generated_at)}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Lần chạy tiếp theo</Typography.Text><div style={{ marginTop: 4 }}>{formatDateTime(detailData.next_run_at)}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Người chạy gần nhất</Typography.Text><div style={{ marginTop: 4 }}>{detailData.generated_by_name || '-'}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Số lần chạy</Typography.Text><div style={{ marginTop: 4 }}>{detailData.run_count.toLocaleString('vi-VN')}</div></Col>
                <Col span={24}><Typography.Text type="secondary">Mô tả</Typography.Text><div style={{ marginTop: 4 }}>{detailData.description || '-'}</div></Col>
                <Col span={24}>
                  <Typography.Text type="secondary">Email nhận lịch</Typography.Text>
                  <div style={{ marginTop: 8 }}>
                    {detailData.schedule_recipients?.length ? <Space wrap>{detailData.schedule_recipients.map((email) => <Tag key={email}>{email}</Tag>)}</Space> : '-'}
                  </div>
                </Col>
              </Row>
            </Card>

            <Card size="small" title="Tổng hợp lần chạy gần nhất">{renderObjectSection(detailData.last_run_summary)}</Card>

            <Card size="small" title="Lịch sử chạy">
              {historyQuery.isLoading ? (
                <Skeleton active paragraph={{ rows: 4 }} />
              ) : (
                <Table
                  columns={historyColumns}
                  dataSource={historyRows}
                  rowKey="id"
                  scroll={{ x: 900 }}
                  pagination={{ current: historyPage, pageSize: 5, total: historyTotal, onChange: (nextPage) => setHistoryPage(nextPage) }}
                  locale={{ emptyText: <Empty description="Chưa có lịch sử chạy" /> }}
                />
              )}
            </Card>
          </Space>
        ) : (
          <Empty description="Không tìm thấy báo cáo" />
        )}
      </Modal>

      <Modal
        title={previewResult ? `Kết quả ${previewResult.code}` : 'Kết quả báo cáo'}
        open={previewOpen}
        onCancel={closePreviewModal}
        width={1100}
        footer={[<Button key="close" type="primary" onClick={closePreviewModal}>Đóng</Button>]}
      >
        {previewResult ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" title="Thông tin lần chạy">
              <Row gutter={[16, 16]}>
                <Col xs={24} md={12}><Typography.Text type="secondary">Báo cáo</Typography.Text><div style={{ marginTop: 4, fontWeight: 600 }}>{previewResult.code} - {previewResult.name}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Loại</Typography.Text><div style={{ marginTop: 4 }}>{reportTypeLabels[previewResult.report_type]}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Trạng thái</Typography.Text><div style={{ marginTop: 4 }}><Tag color={statusColors[previewResult.status]}>{statusLabels[previewResult.status]}</Tag></div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Thời gian tạo</Typography.Text><div style={{ marginTop: 4 }}>{formatDateTime(previewResult.generated_at)}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Người chạy</Typography.Text><div style={{ marginTop: 4 }}>{previewResult.generated_by_name || '-'}</div></Col>
                <Col xs={24} md={12}><Typography.Text type="secondary">Số dòng</Typography.Text><div style={{ marginTop: 4 }}>{previewResult.row_count.toLocaleString('vi-VN')}</div></Col>
              </Row>
            </Card>

            <Card size="small" title="Tổng hợp">{renderObjectSection(previewResult.summary)}</Card>

            <Card size="small" title="Dữ liệu">
              {previewResult.rows.length ? (
                <Table columns={previewColumns} dataSource={previewResult.rows} rowKey={(_row, index) => String(index)} scroll={{ x: 1000 }} pagination={{ pageSize: 10 }} />
              ) : (
                <Empty description="Báo cáo không có dòng dữ liệu chi tiết" />
              )}
            </Card>
          </Space>
        ) : (
          <Empty description="Chưa có kết quả để hiển thị" />
        )}
      </Modal>
    </div>
  );
}
