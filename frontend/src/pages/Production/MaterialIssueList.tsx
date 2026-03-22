import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
  Skeleton,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, EyeOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productionApi } from '../../api/production';
import type { ProductionApprovalHistoryItem, ProductionIssue, ProductionIssueStatus, ProductionOrder } from '../../types/production';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { PAGES } from '../../utils/constants';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';

type Filters = {
  status?: ProductionIssueStatus;
  production_order?: number;
};
type MaterialIssueLaneFilter = 'ALL' | 'POSTED_TODAY' | 'THIS_MONTH' | 'CANCELLED_REVIEW' | 'HIGH_VALUE';
type MaterialIssueViewSnapshot = {
  search_input: string;
  status: ProductionIssueStatus | '';
  production_order: number | null;
  laneFilter: MaterialIssueLaneFilter;
};
type MaterialIssueNamedPreset = {
  id: string;
  name: string;
  filters: MaterialIssueViewSnapshot;
};

type IssueFormValues = {
  production_order: number;
  issue_date: string;
  reference?: string;
  reason?: string;
  note?: string;
};

type CancelFormValues = {
  reason: string;
};

const { Text, Title } = Typography;

const STATUS_LABELS: Record<ProductionIssueStatus, string> = {
  POSTED: 'Đã ghi nhận',
  CANCELLED: 'Đã hủy',
};

const STATUS_COLORS: Record<ProductionIssueStatus, string> = {
  POSTED: 'green',
  CANCELLED: 'red',
};
const NEXT_STATE_LABELS: Record<ProductionIssueStatus, string> = {
  POSTED: 'Đã ghi nhận',
  CANCELLED: 'Đã hủy',
};

const SUMMARY_TILE_STYLE = {
  height: '100%',
  borderRadius: 14,
};
const LANE_LABELS: Record<MaterialIssueLaneFilter, string> = {
  ALL: 'Toàn bộ chứng từ',
  POSTED_TODAY: 'Cấp hôm nay',
  THIS_MONTH: 'Theo dõi tháng này',
  CANCELLED_REVIEW: 'Cần rà hủy',
  HIGH_VALUE: 'Giá trị cao',
};

function matchesMaterialIssueLane(
  issue: ProductionIssue,
  laneFilter: MaterialIssueLaneFilter,
  highValueThreshold: number,
): boolean {
  if (laneFilter === 'ALL') return true;
  const issueDate = dayjs(issue.issue_date);
  const totalAmount = Number(issue.total_amount ?? 0);
  switch (laneFilter) {
    case 'POSTED_TODAY':
      return issue.status === 'POSTED' && issueDate.isSame(dayjs(), 'day');
    case 'THIS_MONTH':
      return issueDate.isSame(dayjs(), 'month');
    case 'CANCELLED_REVIEW':
      return issue.status === 'CANCELLED';
    case 'HIGH_VALUE':
      return totalAmount > 0 && totalAmount >= highValueThreshold;
    default:
      return true;
  }
}

export default function MaterialIssueList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [laneFilter, setLaneFilter] = useState<MaterialIssueLaneFilter>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [detailIssue, setDetailIssue] = useState<ProductionIssue | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ProductionIssue | null>(null);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState('NONE');
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const [form] = Form.useForm<IssueFormValues>();
  const [cancelForm] = Form.useForm<CancelFormValues>();
  const { config, saveConfig } = useUserPreferences(PAGES.PRODUCTION_ISSUES);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord?.pageSize ?? 20);
  const namedPresets = useMemo(() => {
    const raw = configRecord?.saved_views;
    if (!Array.isArray(raw)) return [] as MaterialIssueNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        const name = typeof record.name === 'string' ? record.name : '';
        const filters = record.filters;
        if (!id || !name || !filters || typeof filters !== 'object') return null;
        const filterRecord = filters as Record<string, unknown>;
        const statusValue = filterRecord.status;
        const laneFilterValue = typeof filterRecord.laneFilter === 'string' ? filterRecord.laneFilter : 'ALL';
        if (statusValue !== '' && statusValue !== undefined && statusValue !== 'POSTED' && statusValue !== 'CANCELLED') {
          return null;
        }
        return {
          id,
          name,
          filters: {
            search_input: typeof filterRecord.search_input === 'string' ? filterRecord.search_input : '',
            status: statusValue === 'POSTED' || statusValue === 'CANCELLED' ? statusValue : '',
            production_order: typeof filterRecord.production_order === 'number' ? filterRecord.production_order : null,
            laneFilter:
              laneFilterValue === 'POSTED_TODAY'
              || laneFilterValue === 'THIS_MONTH'
              || laneFilterValue === 'CANCELLED_REVIEW'
              || laneFilterValue === 'HIGH_VALUE'
                ? laneFilterValue
                : 'ALL',
          },
        } as MaterialIssueNamedPreset;
      })
      .filter((item): item is MaterialIssueNamedPreset => item !== null);
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (value) => JSON.stringify(value),
    parseFilters: (value) => {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    },
  });

  const params = useMemo(
    () => ({
      search: intentSearch.trim() || undefined,
      status: intentFilters.status || undefined,
      production_order: intentFilters.production_order || undefined,
      page,
      page_size: pageSize,
    }),
    [intentFilters.production_order, intentFilters.status, intentSearch, page, pageSize],
  );

  const listQuery = useQuery({
    queryKey: ['production-issues', params],
    queryFn: () => productionApi.getIssues(params),
  });
  const detailQuery = useQuery({
    queryKey: ['production-issue-detail', detailIssue?.id],
    queryFn: () => productionApi.getIssue(detailIssue!.id),
    enabled: Boolean(detailIssue?.id),
  });
  const lifecycleHistoryQuery = useQuery({
    queryKey: ['production-issue-lifecycle-history', detailIssue?.id],
    queryFn: () => productionApi.getIssueLifecycleHistory(detailIssue!.id),
    enabled: Boolean(detailIssue?.id),
  });
  const nextStatesQuery = useQuery({
    queryKey: ['production-issue-next-states', detailIssue?.id],
    queryFn: () => productionApi.getIssueNextStates(detailIssue!.id),
    enabled: Boolean(detailIssue?.id),
  });

  const orderOptionsQuery = useQuery({
    queryKey: ['production-order-options-for-issues'],
    queryFn: () => productionApi.getOrders({ page_size: 200, ordering: '-order_date' }),
  });

  const invalidateIssues = async () => {
    await queryClient.invalidateQueries({ queryKey: ['production-issues'] });
    await queryClient.invalidateQueries({ queryKey: ['production-issue-detail'] });
    await queryClient.invalidateQueries({ queryKey: ['production-issue-lifecycle-history'] });
    await queryClient.invalidateQueries({ queryKey: ['production-issue-next-states'] });
    await queryClient.invalidateQueries({ queryKey: ['production-orders'] });
    await queryClient.invalidateQueries({ queryKey: ['production-orders-summary'] });
    await queryClient.invalidateQueries({ queryKey: ['production-order-detail'] });
    await queryClient.invalidateQueries({ queryKey: ['production-order-issues'] });
  };

  const createMutation = useMutation({
    mutationFn: ({ production_order, ...payload }: IssueFormValues) =>
      productionApi.issueMaterials(production_order, payload),
    onSuccess: async () => {
      await invalidateIssues();
      messageApi.success('Đã phát hành vật tư theo nhu cầu còn thiếu của lệnh');
      form.resetFields();
      setFormOpen(false);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => productionApi.cancelIssue(id, reason),
    onSuccess: async () => {
      await invalidateIssues();
      messageApi.success('Đã hủy chứng từ cấp vật tư');
      cancelForm.resetFields();
      setCancelTarget(null);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = listQuery.data?.results ?? [];
  const detailData = detailQuery.data ?? detailIssue;

  const orderOptions = useMemo(
    () =>
      (orderOptionsQuery.data?.results ?? [])
        .filter((item: ProductionOrder) => ['RELEASED', 'IN_PROGRESS'].includes(item.status))
        .map((item: ProductionOrder) => ({
          label: `${item.code} - ${item.product_name || item.product_code || 'Lệnh sản xuất'}`,
          value: item.id,
        })),
    [orderOptionsQuery.data?.results],
  );

  const orderLabelMap = useMemo(
    () => Object.fromEntries(orderOptions.map((item) => [item.value, item.label])) as Record<number, string>,
    [orderOptions],
  );

  const summary = useMemo(() => {
    const postedCount = rows.filter((item) => item.status === 'POSTED').length;
    const cancelledCount = rows.filter((item) => item.status === 'CANCELLED').length;
    const totalQty = rows.reduce((total, item) => total + Number(item.total_qty || 0), 0);
    const totalAmount = rows.reduce((total, item) => total + Number(item.total_amount || 0), 0);
    const todayCount = rows.filter((item) => dayjs(item.issue_date).isSame(dayjs(), 'day')).length;
    const postedTodayCount = rows.filter((item) => item.status === 'POSTED' && dayjs(item.issue_date).isSame(dayjs(), 'day')).length;
    const thisMonthCount = rows.filter((item) => dayjs(item.issue_date).isSame(dayjs(), 'month')).length;
    const highValueThreshold = rows.length ? totalAmount / rows.length : 0;
    const highValueCount = rows.filter((item) => Number(item.total_amount || 0) > 0 && Number(item.total_amount || 0) >= highValueThreshold).length;
    return {
      postedCount,
      cancelledCount,
      totalQty,
      totalAmount,
      todayCount,
      postedTodayCount,
      thisMonthCount,
      highValueThreshold,
      highValueCount,
    };
  }, [rows]);
  const visibleRows = useMemo(
    () => rows.filter((item) => matchesMaterialIssueLane(item, laneFilter, summary.highValueThreshold)),
    [laneFilter, rows, summary.highValueThreshold],
  );
  const laneTiles = useMemo(
    () => [
      { value: 'ALL' as const, label: LANE_LABELS.ALL, count: rows.length },
      { value: 'POSTED_TODAY' as const, label: LANE_LABELS.POSTED_TODAY, count: summary.postedTodayCount },
      { value: 'THIS_MONTH' as const, label: LANE_LABELS.THIS_MONTH, count: summary.thisMonthCount },
      { value: 'CANCELLED_REVIEW' as const, label: LANE_LABELS.CANCELLED_REVIEW, count: summary.cancelledCount },
      { value: 'HIGH_VALUE' as const, label: LANE_LABELS.HIGH_VALUE, count: summary.highValueCount },
    ],
    [rows.length, summary.cancelledCount, summary.highValueCount, summary.postedTodayCount, summary.thisMonthCount],
  );

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) {
      tags.push(`Tìm kiếm: ${intentSearch.trim()}`);
    }
    if (filters.status) {
      tags.push(`Trạng thái: ${STATUS_LABELS[filters.status]}`);
    }
    if (filters.production_order) {
      tags.push(`Lệnh: ${orderLabelMap[filters.production_order] ?? `#${filters.production_order}`}`);
    }
    if (selectedViewPreset) {
      tags.push(`Mẫu đang dùng: ${selectedViewPreset.name}`);
    }
    if (laneFilter !== 'ALL') {
      tags.push(`Làn điều phối: ${LANE_LABELS[laneFilter]}`);
    }
    return tags;
  }, [filters.production_order, filters.status, intentSearch, laneFilter, orderLabelMap, selectedViewPreset]);

  const buildCurrentSnapshot = (): MaterialIssueViewSnapshot => ({
    search_input: searchInput,
    status: filters.status ?? '',
    production_order: filters.production_order ?? null,
    laneFilter,
  });

  const applySnapshot = (snapshot: MaterialIssueViewSnapshot) => {
    setSearchInput(snapshot.search_input);
    setFilters({
      status: snapshot.status || undefined,
      production_order: snapshot.production_order ?? undefined,
    });
    setLaneFilter(snapshot.laneFilter ?? 'ALL');
    setPage(1);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        ...buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem cấp vật tư.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem cấp vật tư.');
    }
  };

  const applySavedView = () => {
    const rawStatus = configRecord?.status;
    const rawLaneFilter = typeof configRecord?.laneFilter === 'string' ? configRecord.laneFilter : 'ALL';
    const snapshot: MaterialIssueViewSnapshot = {
      search_input: typeof configRecord?.search_input === 'string' ? configRecord.search_input : '',
      status: rawStatus === 'POSTED' || rawStatus === 'CANCELLED' ? rawStatus : '',
      production_order: typeof configRecord?.production_order === 'number' ? configRecord.production_order : null,
      laneFilter:
        rawLaneFilter === 'POSTED_TODAY'
        || rawLaneFilter === 'THIS_MONTH'
        || rawLaneFilter === 'CANCELLED_REVIEW'
        || rawLaneFilter === 'HIGH_VALUE'
          ? rawLaneFilter
          : 'ALL',
    };
    applySnapshot(snapshot);
    messageApi.success('Đã khôi phục chế độ xem cấp vật tư đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: MaterialIssueNamedPreset = existing
      ? { ...existing, name, filters: currentSnapshot }
      : { id: `${Date.now()}`, name, filters: currentSnapshot };
    const nextPresets = existing
      ? namedPresets.map((item) => (item.id === existing.id ? nextPreset : item))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        ...currentSnapshot,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId(nextPreset.id);
      setViewPresetName('');
      setIsViewPresetModalOpen(false);
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc cấp vật tư.' : 'Đã lưu mẫu lọc cấp vật tư mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc cấp vật tư.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc cấp vật tư.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc cấp vật tư để xóa.');
      return;
    }
    const nextPresets = namedPresets.filter((item) => item.id !== preset.id);
    try {
      await saveConfig({
        ...configRecord,
        pageSize,
        ...buildCurrentSnapshot(),
        saved_views: nextPresets,
      });
      setSelectedViewPresetId('NONE');
      messageApi.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc cấp vật tư.');
    }
  };

  const resetFilters = () => {
    setSearchInput('');
    setFilters({});
    setLaneFilter('ALL');
    setPage(1);
  };

  const statusAlert = useMemo(() => {
    if (summary.cancelledCount > 0) {
      return {
        type: 'warning' as const,
        message: `${summary.cancelledCount} chứng từ cấp vật tư đã bị hủy trong bộ lọc hiện tại, nên đối soát lại định mức và tồn kho nguồn.`,
      };
    }
    if (summary.todayCount > 0) {
      return {
        type: 'info' as const,
        message: `Hôm nay đã ghi nhận ${summary.todayCount} chứng từ cấp vật tư, phù hợp để kiểm tra nhanh tiến độ phát lệnh đầu ca.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Luồng cấp vật tư đang ổn định, chưa phát sinh cảnh báo vận hành đáng chú ý trong bộ lọc hiện tại.',
    };
  }, [summary.cancelledCount, summary.todayCount]);

  const columns: ColumnsType<ProductionIssue> = [
    { title: 'Mã chứng từ', dataIndex: 'code', width: 140 },
    { title: 'Lệnh SX', dataIndex: 'production_order_code', width: 130, render: (value: string | null) => value || '-' },
    {
      title: 'Ngày cấp',
      dataIndex: 'issue_date',
      width: 130,
      render: (value: string) => dayjs(value).format('DD/MM/YYYY'),
    },
    {
      title: 'Dòng vật tư',
      width: 120,
      align: 'right',
      render: (_, row) => row.lines.length,
    },
    {
      title: 'Tổng SL',
      dataIndex: 'total_qty',
      width: 120,
      align: 'right',
      render: (value: string) => Number(value || 0).toLocaleString('vi-VN'),
    },
    {
      title: 'Giá trị',
      dataIndex: 'total_amount',
      width: 140,
      align: 'right',
      render: (value: string) => Number(value || 0).toLocaleString('vi-VN'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 140,
      render: (value: ProductionIssueStatus) => <Tag color={STATUS_COLORS[value]}>{STATUS_LABELS[value]}</Tag>,
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        <Space wrap size="small">
          <Button data-testid={`material-issue-view-${row.id}`} size="small" icon={<EyeOutlined />} onClick={() => setDetailIssue(row)}>
            Xem
          </Button>
          {row.status === 'POSTED' ? (
            <Button
              data-testid={`material-issue-cancel-${row.id}`}
              size="small"
              danger
              icon={<StopOutlined />}
              onClick={() => {
                cancelForm.setFieldsValue({ reason: '' });
                setCancelTarget(row);
              }}
            >
              Hủy chứng từ
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const handleExportCSV = () => {
    if (visibleRows.length === 0) return;
    const csvData = visibleRows.map((issue) => ({
      'Mã chứng từ': issue.code,
      'Lệnh SX': issue.production_order_code || '',
      'Ngày cấp': dayjs(issue.issue_date).format('DD/MM/YYYY'),
      'Dòng vật tư': issue.lines.length,
      'Tổng SL': Number(issue.total_qty || 0).toLocaleString('vi-VN'),
      'Giá trị': Number(issue.total_amount || 0).toLocaleString('vi-VN'),
      'Trạng thái': STATUS_LABELS[issue.status],
    }));
    downloadCSV(csvData, 'cap-phat-vat-tu');
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    await createMutation.mutateAsync(values);
  };

  const handleCancelIssue = async () => {
    if (!cancelTarget) return;
    const values = await cancelForm.validateFields();
    await cancelMutation.mutateAsync({ id: cancelTarget.id, reason: values.reason.trim() });
  };

  if (listQuery.isLoading && !listQuery.data) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}

      <Card
        bordered={false}
        style={{ borderRadius: 20 }}
        styles={{ body: { display: 'flex', flexDirection: 'column', gap: 16 } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Title level={3} style={{ margin: 0 }}>
              Trung tâm cấp phát vật tư
            </Title>
            <Text type="secondary">
              Theo dõi toàn bộ chứng từ xuất vật tư cho sản xuất, rà soát lệnh đang cấp và xử lý các chứng từ cần hủy đối soát.
            </Text>
          </div>
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={handleExportCSV} disabled={visibleRows.length === 0}>
              Xuất CSV
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.setFieldsValue({
                  issue_date: dayjs().format('YYYY-MM-DD'),
                  reference: '',
                  reason: 'Cấp vật tư theo định mức sản xuất',
                  note: '',
                });
                setFormOpen(true);
              }}
            >
              Phát hành
            </Button>
          </Space>
        </div>

        <Alert showIcon type={statusAlert.type} message={statusAlert.message} />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Đã ghi nhận" value={summary.postedCount} valueStyle={{ color: '#389e0d' }} />
          </Card>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Đã hủy" value={summary.cancelledCount} valueStyle={{ color: '#cf1322' }} />
          </Card>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Tổng SL cấp" value={summary.totalQty} precision={2} />
          </Card>
          <Card size="small" style={SUMMARY_TILE_STYLE}>
            <Statistic title="Giá trị" value={summary.totalAmount} precision={0} />
          </Card>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {laneTiles.map((lane) => (
            <Button
              key={lane.value}
              type={laneFilter === lane.value ? 'primary' : 'default'}
              data-testid={`material-issues-lane-${lane.value.toLowerCase().replace(/_/g, '-')}`}
              onClick={() => {
                setLaneFilter(lane.value);
                setPage(1);
              }}
            >
              {`${lane.label} (${lane.count})`}
            </Button>
          ))}
        </div>
      </Card>

      <Card
        bordered={false}
        data-testid="material-issues-command-strip"
        style={{ borderRadius: 18 }}
        styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div data-testid="material-issues-command-search">
            <Input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              placeholder="Tìm mã chứng từ, mã lệnh, vật tư..."
              style={{ width: 320 }}
              suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
            />
          </div>
          <Select
            allowClear
            placeholder="Trạng thái"
            style={{ width: 220 }}
            value={filters.status}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, status: value }));
              setPage(1);
            }}
            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Lệnh sản xuất"
            style={{ width: 320 }}
            value={filters.production_order}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, production_order: value }));
              setPage(1);
            }}
            options={orderOptions}
          />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button data-testid="material-issues-save-view" onClick={() => void saveCurrentView()}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="material-issues-restore-view" onClick={applySavedView}>
            Khôi phục
          </Button>
          <Button
            data-testid="material-issues-open-preset-modal"
            onClick={() => setIsViewPresetModalOpen(true)}
          >
            Tạo mẫu lọc
          </Button>
          <div data-testid="material-issues-preset-select">
            <Select
              value={selectedViewPresetId}
              onChange={setSelectedViewPresetId}
              style={{ width: 240 }}
              options={[
                { value: 'NONE', label: 'Chọn mẫu cấp vật tư' },
                ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
              ]}
            />
          </div>
          <Button data-testid="material-issues-apply-preset" onClick={applyNamedPreset}>
            Áp dụng mẫu
          </Button>
          <Button
            danger
            data-testid="material-issues-delete-preset"
            disabled={!selectedViewPreset}
            onClick={() => void deleteNamedPreset()}
          >
            Xóa mẫu
          </Button>
          <Button
            onClick={resetFilters}
          >
            Xóa bộ lọc
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {activeFilterTags.length > 0 ? (
            activeFilterTags.map((tag) => <Tag key={tag}>{tag}</Tag>)
          ) : (
            <Tag color="default">Đang xem toàn bộ chứng từ cấp vật tư</Tag>
          )}
          <Tag color="blue">Chứng từ hôm nay: {summary.todayCount}</Tag>
        </div>
      </Card>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={visibleRows}
        loading={listQuery.isLoading}
        scroll={{ x: 1350 }}
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
          emptyText:
            visibleRows.length === 0 && !listQuery.isLoading ? (
              activeFilterTags.length > 0 ? (
                <div style={{ padding: 32 }}>
                  <Empty description="Không tìm thấy chứng từ cấp vật tư phù hợp." />
                  <Button
                    type="link"
                    onClick={resetFilters}
                  >
                    Xóa bộ lọc
                  </Button>
                </div>
              ) : (
                <Empty description="Chưa có chứng từ cấp vật tư nào." />
              )
            ) : undefined,
        }}
      />

      <Modal
        open={isViewPresetModalOpen}
        title="Lưu mẫu lọc cấp vật tư"
        okText="Lưu mẫu"
        cancelText="Đóng"
        onOk={() => void saveNamedPreset()}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
      >
        <Form layout="vertical">
          <Form.Item label="Tên mẫu lọc">
            <Input
              data-testid="material-issues-preset-name"
              placeholder="Ví dụ: Chứng từ chờ đối soát cuối ca"
              value={viewPresetName}
              onChange={(event) => setViewPresetName(event.target.value)}
              onPressEnter={() => void saveNamedPreset()}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Phát hành vật tư"
        open={formOpen}
        onCancel={() => {
          setFormOpen(false);
          form.resetFields();
        }}
        onOk={handleSubmit}
        okText="Phát hành"
        cancelText="Đóng"
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Alert
            showIcon
            type="info"
            style={{ marginBottom: 16 }}
            message="Hệ thống sẽ tự cấp toàn bộ vật tư còn thiếu theo định mức của lệnh đã chọn."
          />
          <Form.Item
            label="Lệnh sản xuất"
            name="production_order"
            rules={[{ required: true, message: 'Vui lòng chọn lệnh sản xuất' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Chọn lệnh sản xuất đang chạy"
              options={orderOptions}
            />
          </Form.Item>
          <Form.Item
            label="Ngày cấp"
            name="issue_date"
            rules={[{ required: true, message: 'Vui lòng chọn ngày cấp' }]}
          >
            <Input type="date" />
          </Form.Item>
          <Form.Item label="Tham chiếu" name="reference">
            <Input placeholder="Ví dụ: cấp theo lệnh đầu ca sáng" />
          </Form.Item>
          <Form.Item label="Lý do" name="reason">
            <Input placeholder="Ví dụ: cấp vật tư theo định mức sản xuất" />
          </Form.Item>
          <Form.Item label="Ghi chú" name="note">
            <Input.TextArea rows={3} placeholder="Thông tin thêm để phục vụ đối soát hoặc audit" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={cancelTarget ? `Hủy chứng từ cấp vật tư - ${cancelTarget.code}` : 'Hủy chứng từ cấp vật tư'}
        open={Boolean(cancelTarget)}
        onCancel={() => {
          setCancelTarget(null);
          cancelForm.resetFields();
        }}
        onOk={handleCancelIssue}
        okText="Xác nhận hủy"
        cancelText="Đóng"
        okButtonProps={{ danger: true }}
        confirmLoading={cancelMutation.isPending}
      >
        <Form form={cancelForm} layout="vertical">
          <Alert
            showIcon
            type="warning"
            style={{ marginBottom: 16 }}
            message="Khi hủy, số lượng đã cấp sẽ được hoàn tác về yêu cầu vật tư và kho nguồn tương ứng."
          />
          <Form.Item
            label="Lý do hủy"
            name="reason"
            rules={[
              { required: true, message: 'Vui lòng nhập lý do hủy' },
              { validator: async (_, value) => (value?.trim() ? Promise.resolve() : Promise.reject(new Error('Vui lòng nhập lý do hủy'))) },
            ]}
          >
            <Input.TextArea rows={4} maxLength={500} placeholder="Mô tả rõ nguyên nhân để phục vụ đối soát sau này" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={detailIssue ? `Chi tiết cấp vật tư - ${detailIssue.code}` : 'Chi tiết cấp vật tư'}
        open={Boolean(detailIssue)}
        onCancel={() => setDetailIssue(null)}
        footer={null}
        width={980}
      >
        {detailQuery.isLoading ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : detailQuery.error ? (
          <div style={{ color: '#ff4d4f', padding: 16, textAlign: 'center' }}>
            Lỗi: Không thể tải chi tiết chứng từ cấp vật tư
          </div>
        ) : detailData ? (
          <div data-testid="material-issue-detail-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
              }}
            >
              <Card size="small" style={SUMMARY_TILE_STYLE}>
                <Statistic title="Tổng số dòng" value={detailData.lines.length} />
              </Card>
              <Card size="small" style={SUMMARY_TILE_STYLE}>
                <Statistic title="Tổng SL" value={Number(detailData.total_qty || 0)} precision={2} />
              </Card>
              <Card size="small" style={SUMMARY_TILE_STYLE}>
                <Statistic title="Giá trị" value={Number(detailData.total_amount || 0)} precision={0} />
              </Card>
              <Card size="small" style={SUMMARY_TILE_STYLE}>
                <Statistic title="Ngày cấp" value={dayjs(detailData.issue_date).format('DD/MM/YYYY')} />
              </Card>
            </div>

            <Card size="small" title="Tổng quan chứng từ">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                <div>
                  <strong>Lệnh sản xuất:</strong> {detailData.production_order_code || '-'}
                </div>
                <div>
                  <strong>Trạng thái:</strong> <Tag color={STATUS_COLORS[detailData.status]}>{STATUS_LABELS[detailData.status]}</Tag>
                </div>
                <div>
                  <strong>Tham chiếu:</strong> {detailData.reference || '-'}
                </div>
                <div>
                  <strong>Ngày ghi nhận:</strong> {detailData.posted_at ? dayjs(detailData.posted_at).format('DD/MM/YYYY HH:mm') : '-'}
                </div>
              </div>
              {detailData.note ? (
                <div style={{ marginTop: 12 }}>
                  <strong>Ghi chú:</strong> {detailData.note}
                </div>
              ) : null}
              {detailData.cancel_reason ? (
                <div style={{ marginTop: 8 }}>
                  <strong>Lý do hủy:</strong> {detailData.cancel_reason}
                </div>
              ) : null}
            </Card>

            <Card size="small" title="Bước kế tiếp">
              <div data-testid="material-issue-next-states" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Tag color="blue">
                  Hiện tại: {NEXT_STATE_LABELS[nextStatesQuery.data?.current as ProductionIssueStatus] || NEXT_STATE_LABELS[detailData.status]}
                </Tag>
                {(nextStatesQuery.data?.next_states ?? []).length > 0 ? (
                  (nextStatesQuery.data?.next_states ?? []).map((state) => (
                    <Tag key={state} color="gold">
                      {NEXT_STATE_LABELS[state as ProductionIssueStatus] || state}
                    </Tag>
                  ))
                ) : (
                  <Tag>Không còn bước tiếp theo</Tag>
                )}
              </div>
            </Card>

            <Card size="small" title="Lịch sử vòng đời">
              <Table<ProductionApprovalHistoryItem>
                data-testid="material-issue-lifecycle-history"
                rowKey={(row) => `${row.action}-${row.created_at}`}
                loading={lifecycleHistoryQuery.isLoading}
                columns={[
                  {
                    title: 'Sự kiện',
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
                    title: 'Chi tiết',
                    dataIndex: 'comments',
                    width: 260,
                    render: (value) => value || '-',
                  },
                  {
                    title: 'Thời gian',
                    dataIndex: 'created_at',
                    width: 180,
                    render: (value) => dayjs(value).format('DD/MM/YYYY HH:mm'),
                  },
                ]}
                dataSource={lifecycleHistoryQuery.data ?? []}
                pagination={false}
                locale={{ emptyText: 'Chứng từ cấp vật tư này chưa có lịch sử vòng đời.' }}
                scroll={{ x: 820 }}
              />
            </Card>

            <Card size="small" title="Chi tiết vật tư đã cấp">
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={detailData.lines}
                columns={[
                  {
                    title: 'Vật tư',
                    width: 280,
                    render: (_, row) => [row.material_product_code, row.material_product_name].filter(Boolean).join(' - ') || '-',
                  },
                  {
                    title: 'Kho / vị trí',
                    width: 220,
                    render: (_, row) => [row.warehouse_name, row.location_name].filter(Boolean).join(' / ') || '-',
                  },
                  {
                    title: 'Số lượng',
                    dataIndex: 'quantity',
                    width: 120,
                    align: 'right',
                  },
                  {
                    title: 'Đơn giá',
                    dataIndex: 'unit_cost',
                    width: 120,
                    align: 'right',
                    render: (value: string) => Number(value || 0).toLocaleString('vi-VN'),
                  },
                  {
                    title: 'Giá trị',
                    dataIndex: 'line_total',
                    width: 140,
                    align: 'right',
                    render: (value: string) => Number(value || 0).toLocaleString('vi-VN'),
                  },
                  {
                    title: 'Mã giao dịch kho',
                    dataIndex: 'inventory_transaction_code',
                    width: 150,
                    render: (value: string | null) => value || '-',
                  },
                ]}
              />
            </Card>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
