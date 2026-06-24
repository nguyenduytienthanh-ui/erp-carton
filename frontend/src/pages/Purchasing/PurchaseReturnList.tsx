import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Alert, Button, Card, Input, Modal, Select, Space, Statistic, Table, Tag, Typography, message, Skeleton } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EyeOutlined, PlusOutlined, DownloadOutlined, UndoOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { purchasingApi } from '../../api/purchasing';
import type { PurchaseApprovalHistoryItem, PurchaseReturn, PurchaseReturnStatus } from '../../types/purchasing';
import { PAGES } from '../../utils/constants';
import { canManagePurchasingData } from '../../utils/authz';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { getToastMessage } from '../../shared/apiError';
import { downloadCSV } from '../../utils/csvExport';
import PurchaseReturnFormModal from './PurchaseReturnFormModal';

const { Text, Title } = Typography;

type Filters = {
  status?: string;
};
type PurchaseReturnLaneFilter = 'ALL' | 'DRAFT_REVIEW' | 'PENDING_APPROVAL' | 'READY_TO_POST' | 'POSTED_CLOSED' | 'HIGH_VALUE';
type PurchaseReturnViewSnapshot = {
  search_input: string;
  status: string;
  laneFilter: PurchaseReturnLaneFilter;
};
type PurchaseReturnNamedPreset = {
  id: string;
  name: string;
  filters: PurchaseReturnViewSnapshot;
};

const STATUS_LABELS: Record<PurchaseReturnStatus, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  POSTED: 'Đã vào sổ',
  REVERSED: 'Đã đảo',
  CANCELLED: 'Đã hủy',
};

const STATUS_COLORS: Record<PurchaseReturnStatus, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  APPROVED: 'success',
  POSTED: 'cyan',
  REVERSED: 'purple',
  CANCELLED: 'magenta',
};
const NEXT_STATE_LABELS: Record<string, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  POSTED: 'Đã vào sổ',
  REVERSED: 'Đã đảo',
  CANCELLED: 'Đã hủy',
};

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};
const LANE_LABELS: Record<PurchaseReturnLaneFilter, string> = {
  ALL: 'Toàn bộ phiếu',
  DRAFT_REVIEW: 'Rà soát nháp',
  PENDING_APPROVAL: 'Chờ duyệt',
  READY_TO_POST: 'Sẵn sàng post',
  POSTED_CLOSED: 'Đã post',
  HIGH_VALUE: 'Giá trị cao',
};

function matchesPurchaseReturnLane(
  row: PurchaseReturn,
  laneFilter: PurchaseReturnLaneFilter,
  highValueThreshold: number,
): boolean {
  if (laneFilter === 'ALL') return true;
  const total = Number(row.total ?? 0);
  switch (laneFilter) {
    case 'DRAFT_REVIEW':
      return row.status === 'DRAFT';
    case 'PENDING_APPROVAL':
      return row.status === 'SUBMITTED';
    case 'READY_TO_POST':
      return row.status === 'APPROVED';
    case 'POSTED_CLOSED':
      return row.status === 'POSTED' || row.status === 'REVERSED';
    case 'HIGH_VALUE':
      return total > 0 && total >= highValueThreshold;
    default:
      return true;
  }
}

export default function PurchaseReturnList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [laneFilter, setLaneFilter] = useState<PurchaseReturnLaneFilter>('ALL');
  const [page, setPage] = useState(1);
  const [detailReturn, setDetailReturn] = useState<PurchaseReturn | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editReturn, setEditReturn] = useState<PurchaseReturn | null>(null);
  const [selectedViewPresetId, setSelectedViewPresetId] = useState('NONE');
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const { config, saveConfig } = useUserPreferences(PAGES.PURCHASING_RETURNS);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord?.pageSize ?? 20);
  const namedPresets = useMemo(() => {
    const raw = configRecord?.saved_views;
    if (!Array.isArray(raw)) return [] as PurchaseReturnNamedPreset[];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        const name = typeof record.name === 'string' ? record.name : '';
        const filters = record.filters;
        if (!id || !name || !filters || typeof filters !== 'object') return null;
        const filterRecord = filters as Record<string, unknown>;
        const statusValue = typeof filterRecord.status === 'string' ? filterRecord.status : '';
        const laneFilterValue = typeof filterRecord.laneFilter === 'string' ? filterRecord.laneFilter : 'ALL';
        if (statusValue && !['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED', 'CANCELLED'].includes(statusValue)) {
          return null;
        }
        return {
          id,
          name,
          filters: {
            search_input: typeof filterRecord.search_input === 'string' ? filterRecord.search_input : '',
            status: statusValue,
            laneFilter:
              laneFilterValue === 'DRAFT_REVIEW'
              || laneFilterValue === 'PENDING_APPROVAL'
              || laneFilterValue === 'READY_TO_POST'
              || laneFilterValue === 'POSTED_CLOSED'
              || laneFilterValue === 'HIGH_VALUE'
                ? laneFilterValue
                : 'ALL',
          },
        } as PurchaseReturnNamedPreset;
      })
      .filter((item): item is PurchaseReturnNamedPreset => item !== null);
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );
  const canManage = canManagePurchasingData();

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

  const returnsQuery = useQuery({
    queryKey: ['purchasing-returns', params],
    queryFn: () => purchasingApi.getPurchaseReturns(params),
  });

  const detailQuery = useQuery({
    queryKey: ['purchasing-return', detailReturn?.id],
    queryFn: () => purchasingApi.getPurchaseReturn(detailReturn!.id),
    enabled: !!detailReturn?.id,
  });
  const approvalHistoryQuery = useQuery({
    queryKey: ['purchasing-return-approval-history', detailReturn?.id],
    queryFn: () => purchasingApi.getPurchaseReturnApprovalHistory(detailReturn!.id),
    enabled: !!detailReturn?.id,
  });
  const lifecycleHistoryQuery = useQuery({
    queryKey: ['purchasing-return-lifecycle-history', detailReturn?.id],
    queryFn: () => purchasingApi.getPurchaseReturnLifecycleHistory(detailReturn!.id),
    enabled: !!detailReturn?.id,
  });
  const nextStatesQuery = useQuery({
    queryKey: ['purchasing-return-next-states', detailReturn?.id],
    queryFn: () => purchasingApi.getPurchaseReturnNextStates(detailReturn!.id),
    enabled: !!detailReturn?.id,
  });

  const deleteMutation = useMutation({
    mutationFn: purchasingApi.deletePurchaseReturn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      messageApi.success('Đã xóa phiếu trả');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: purchasingApi.submitPurchaseReturn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return-approval-history'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return-lifecycle-history'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return-next-states'] });
      messageApi.success('Đã gửi duyệt phiếu trả');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const approveMutation = useMutation({
    mutationFn: purchasingApi.approvePurchaseReturn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return-approval-history'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return-lifecycle-history'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return-next-states'] });
      messageApi.success('Đã duyệt phiếu trả');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const postMutation = useMutation({
    mutationFn: purchasingApi.postPurchaseReturn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return-lifecycle-history'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return-next-states'] });
      messageApi.success('Đã post phiếu trả');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const reverseMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => purchasingApi.reversePurchaseReturn(id, reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['purchasing-returns'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return-lifecycle-history'] });
      await queryClient.invalidateQueries({ queryKey: ['purchasing-return-next-states'] });
      messageApi.success('Đã đảo phiếu trả');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = useMemo(() => returnsQuery.data?.results ?? [], [returnsQuery.data?.results]);
  const summary = useMemo(() => {
    const draftCount = rows.filter((row) => row.status === 'DRAFT').length;
    const submittedCount = rows.filter((row) => row.status === 'SUBMITTED').length;
    const approvedCount = rows.filter((row) => row.status === 'APPROVED').length;
    const postedCount = rows.filter((row) => row.status === 'POSTED').length;
    const reversedCount = rows.filter((row) => row.status === 'REVERSED').length;
    const cancelledCount = rows.filter((row) => row.status === 'CANCELLED').length;
    const totalValue = rows.reduce((acc, row) => acc + Number(row.total ?? 0), 0);
    const highValueThreshold = rows.length ? totalValue / rows.length : 0;
    const highValueCount = rows.filter((row) => Number(row.total ?? 0) > 0 && Number(row.total ?? 0) >= highValueThreshold).length;
    return { draftCount, submittedCount, approvedCount, postedCount, reversedCount, postedClosedCount: postedCount + reversedCount, cancelledCount, totalValue, highValueThreshold, highValueCount };
  }, [rows]);
  const visibleRows = useMemo(
    () => rows.filter((row) => matchesPurchaseReturnLane(row, laneFilter, summary.highValueThreshold)),
    [laneFilter, rows, summary.highValueThreshold],
  );
  const laneTiles = useMemo(
    () => [
      { value: 'ALL' as const, label: LANE_LABELS.ALL, count: rows.length },
      { value: 'DRAFT_REVIEW' as const, label: LANE_LABELS.DRAFT_REVIEW, count: summary.draftCount },
      { value: 'PENDING_APPROVAL' as const, label: LANE_LABELS.PENDING_APPROVAL, count: summary.submittedCount },
      { value: 'READY_TO_POST' as const, label: LANE_LABELS.READY_TO_POST, count: summary.approvedCount },
      { value: 'POSTED_CLOSED' as const, label: LANE_LABELS.POSTED_CLOSED, count: summary.postedClosedCount },
      { value: 'HIGH_VALUE' as const, label: LANE_LABELS.HIGH_VALUE, count: summary.highValueCount },
    ],
    [rows.length, summary.approvedCount, summary.draftCount, summary.highValueCount, summary.postedClosedCount, summary.submittedCount],
  );
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (filters.status) tags.push(`Trạng thái: ${STATUS_LABELS[filters.status as PurchaseReturnStatus]}`);
    if (laneFilter !== 'ALL') tags.push(`Làn điều phối: ${LANE_LABELS[laneFilter]}`);
    if (selectedViewPreset) tags.push(`Mẫu đang dùng: ${selectedViewPreset.name}`);
    return tags;
  }, [filters.status, intentSearch, laneFilter, selectedViewPreset]);
  const statusAlert = useMemo(() => {
    if (summary.submittedCount > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${summary.submittedCount} phiếu trả đang chờ duyệt.`,
        description: 'Nên xử lý sớm để giải phóng tồn lỗi và cập nhật kịp thời công nợ với nhà cung cấp.',
      };
    }
    if (summary.approvedCount > 0) {
      return {
        type: 'info' as const,
        message: `Có ${summary.approvedCount} phiếu trả đã duyệt nhưng chưa post.`,
        description: 'Bạn có thể ưu tiên post các phiếu đã duyệt để hoàn tất vòng đời chứng từ trả hàng.',
      };
    }
    return {
      type: 'success' as const,
      message: 'Luồng phiếu trả đang ổn định.',
      description: 'Không có hàng chờ nổi bật trên bộ lọc hiện tại.',
    };
  }, [summary.approvedCount, summary.submittedCount]);

  const buildCurrentSnapshot = (): PurchaseReturnViewSnapshot => ({
    search_input: searchInput,
    status: filters.status ?? '',
    laneFilter,
  });

  const applySnapshot = (snapshot: PurchaseReturnViewSnapshot) => {
    setSearchInput(snapshot.search_input);
    setFilters({ status: snapshot.status || undefined });
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
      messageApi.success('Đã lưu chế độ xem phiếu trả hàng.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem phiếu trả hàng.');
    }
  };

  const applySavedView = () => {
    const rawStatus = typeof configRecord?.status === 'string' ? configRecord.status : '';
    const rawLaneFilter = typeof configRecord?.laneFilter === 'string' ? configRecord.laneFilter : 'ALL';
    applySnapshot({
      search_input: typeof configRecord?.search_input === 'string' ? configRecord.search_input : '',
      status: rawStatus,
      laneFilter:
        rawLaneFilter === 'DRAFT_REVIEW'
        || rawLaneFilter === 'PENDING_APPROVAL'
        || rawLaneFilter === 'READY_TO_POST'
        || rawLaneFilter === 'POSTED_CLOSED'
        || rawLaneFilter === 'HIGH_VALUE'
          ? rawLaneFilter
          : 'ALL',
    });
    messageApi.success('Đã khôi phục chế độ xem phiếu trả hàng đã lưu.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const currentSnapshot = buildCurrentSnapshot();
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: PurchaseReturnNamedPreset = existing
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
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc phiếu trả hàng.' : 'Đã lưu mẫu lọc phiếu trả hàng mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc phiếu trả hàng.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc phiếu trả hàng.');
      return;
    }
    applySnapshot(preset.filters);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc phiếu trả hàng để xóa.');
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
      messageApi.error('Không thể xóa mẫu lọc phiếu trả hàng.');
    }
  };

  const resetFilters = () => {
    setSearchInput('');
    setFilters({});
    setLaneFilter('ALL');
    setPage(1);
  };

  const confirmReverseReturn = (row: PurchaseReturn) => {
    let reason = '';
    Modal.confirm({
      title: `Đảo phiếu trả ${row.code}`,
      content: (
        <Input.TextArea
          rows={3}
          placeholder="Nhập lý do đảo phiếu trả"
          onChange={(event) => {
            reason = event.target.value;
          }}
        />
      ),
      okText: 'Đảo phiếu',
      cancelText: 'Hủy',
      onOk: () => {
        const normalizedReason = reason.trim();
        if (!normalizedReason) {
          messageApi.error('Vui lòng nhập lý do đảo phiếu trả');
          return Promise.reject();
        }
        return reverseMutation.mutateAsync({ id: row.id, reason: normalizedReason });
      },
    });
  };

  const columns: ColumnsType<PurchaseReturn> = [
    { title: 'Mã trả', dataIndex: 'code', width: 150, key: 'code' },
    { title: 'Ngày trả', dataIndex: 'return_date', width: 120, key: 'return_date' },
    { title: 'NCC', dataIndex: 'supplier_name', width: 200, key: 'supplier' },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (status: PurchaseReturnStatus) => (
        <Tag color={STATUS_COLORS[status as keyof typeof STATUS_COLORS]}>{STATUS_LABELS[status as keyof typeof STATUS_LABELS]}</Tag>
      ),
    },
    {
      title: 'Tổng tiền',
      dataIndex: 'total',
      width: 150,
      render: (val) => Number(val).toLocaleString('vi-VN'),
    },
    {
      title: 'Thao tác',
      width: 300,
      render: (_, row) => (
        <Space wrap>
          <Button data-testid={`purchase-return-view-${row.id}`} size="small" icon={<EyeOutlined />} onClick={() => setDetailReturn(row)}>
            Xem
          </Button>
          <Button
            data-testid={`purchase-return-edit-${row.id}`}
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            onClick={() => {
              setEditReturn(row);
              setFormOpen(true);
            }}
          >
            Sửa
          </Button>
          <Button
            data-testid={`purchase-return-delete-${row.id}`}
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            danger
            icon={<DeleteOutlined />}
            onClick={() =>
              Modal.confirm({
                title: 'Xóa phiếu trả',
                content: `Xóa ${row.code}?`,
                okText: 'Xóa',
                cancelText: 'Hủy',
                onOk: () => deleteMutation.mutate(row.id),
              })
            }
          />
          <Button
            data-testid={`purchase-return-submit-${row.id}`}
            size="small"
            disabled={!canManage || row.status !== 'DRAFT'}
            onClick={() => submitMutation.mutate(row.id)}
          >
            Gửi duyệt
          </Button>
          <Button
            data-testid={`purchase-return-approve-${row.id}`}
            size="small"
            disabled={!canManage || row.status !== 'SUBMITTED'}
            type="primary"
            onClick={() => approveMutation.mutate(row.id)}
          >
            Duyệt
          </Button>
          <Button
            data-testid={`purchase-return-post-${row.id}`}
            size="small"
            disabled={!canManage || row.status !== 'APPROVED'}
            onClick={() => postMutation.mutate(row.id)}
          >
            Post
          </Button>
          <Button
            data-testid={`purchase-return-reverse-${row.id}`}
            size="small"
            icon={<UndoOutlined />}
            disabled={!canManage || row.status !== 'POSTED'}
            onClick={() => confirmReverseReturn(row)}
          >
            Đảo
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <Space wrap>
                <Tag color="blue">Mua hàng</Tag>
                <Tag color="gold">Phiếu trả</Tag>
                <Tag color="processing">Hoàn mua</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>Trung tâm trả hàng mua</Title>
              <Text type="secondary">Theo dõi toàn bộ phiếu trả nhà cung cấp từ nháp, duyệt đến post để hoàn tất vòng đời trả hàng và đối soát công nợ.</Text>
            </div>
            <Space>
              <Button
                icon={<DownloadOutlined />}
                disabled={visibleRows.length === 0}
                onClick={() => {
                  const exportData = visibleRows.map((r) => ({
                    'Mã trả': r.code,
                    'Ngày trả': r.return_date,
                    'NCC': r.supplier_name,
                    'Trạng thái': STATUS_LABELS[r.status as keyof typeof STATUS_LABELS],
                    'Tổng tiền': Number(r.total).toLocaleString('vi-VN'),
                  }));
                  downloadCSV(exportData, 'phieu-tra-hang');
                }}
              >
                Xuất CSV
              </Button>
              <Button
                data-testid="purchase-returns-open-create"
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canManage}
                onClick={() => {
                  setEditReturn(null);
                  setFormOpen(true);
                }}
              >
                Tạo phiếu trả
              </Button>
            </Space>
          </div>

          <Alert showIcon type={statusAlert.type} message={statusAlert.message} description={statusAlert.description} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Nháp" value={summary.draftCount} suffix="phiếu" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Chờ duyệt" value={summary.submittedCount} suffix="phiếu" valueStyle={{ color: summary.submittedCount > 0 ? '#1677ff' : undefined }} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Đã post" value={summary.postedCount} suffix="phiếu" valueStyle={{ color: summary.postedCount > 0 ? '#389e0d' : undefined }} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tổng giá trị" value={summary.totalValue} formatter={(value) => `${Number(value ?? 0).toLocaleString('vi-VN')} đ`} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {laneTiles.map((lane) => (
              <Button
                key={lane.value}
                type={laneFilter === lane.value ? 'primary' : 'default'}
                data-testid={`purchase-returns-lane-${lane.value.toLowerCase().replace(/_/g, '-')}`}
                onClick={() => {
                  setLaneFilter(lane.value);
                  setPage(1);
                }}
              >
                {`${lane.label} (${lane.count})`}
              </Button>
            ))}
          </div>
        </Space>
      </Card>

      <Card data-testid="purchase-returns-command-strip">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div data-testid="purchase-returns-command-search">
              <Input
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setPage(1);
                }}
                placeholder="Tìm mã, NCC..."
                style={{ width: 250 }}
                suffix={searchInput ? <QuickClearIcon onClear={() => { setSearchInput(''); setPage(1); }} title="Xóa tìm kiếm" /> : undefined}
              />
            </div>
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
            <Button data-testid="purchase-returns-save-view" onClick={() => void saveCurrentView()}>
              Lưu chế độ xem
            </Button>
            <Button data-testid="purchase-returns-restore-view" onClick={applySavedView}>
              Khôi phục
            </Button>
            <Button data-testid="purchase-returns-open-preset-modal" onClick={() => setIsViewPresetModalOpen(true)}>
              Tạo mẫu lọc
            </Button>
            <div data-testid="purchase-returns-preset-select">
              <Select
                value={selectedViewPresetId}
                onChange={setSelectedViewPresetId}
                style={{ width: 240 }}
                options={[
                  { value: 'NONE', label: 'Chọn mẫu phiếu trả' },
                  ...namedPresets.map((preset) => ({ value: preset.id, label: preset.name })),
                ]}
              />
            </div>
            <Button data-testid="purchase-returns-apply-preset" onClick={applyNamedPreset}>
              Áp dụng mẫu
            </Button>
            <Button
              danger
              data-testid="purchase-returns-delete-preset"
              disabled={!selectedViewPreset}
              onClick={() => void deleteNamedPreset()}
            >
              Xóa mẫu
            </Button>
            <Button onClick={resetFilters}>
              Xóa bộ lọc
            </Button>
          </div>
          <Space wrap>
            {activeFilterTags.length > 0 ? activeFilterTags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Text type="secondary">Đang hiển thị toàn bộ phiếu trả.</Text>}
          </Space>
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={returnsQuery.isLoading}
        columns={columns}
        dataSource={visibleRows}
        scroll={{ x: 1400 }}
        pagination={{
          current: page,
          pageSize,
          total: returnsQuery.data?.count ?? 0,
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
          emptyText: visibleRows.length === 0 && !returnsQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {(intentSearch || filters.status || laneFilter !== 'ALL') ? (
                <div>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy phiếu trả phù hợp.</div>
                  <Button type="link" onClick={resetFilters}>
                    Xóa bộ lọc
                  </Button>
                </div>
              ) : 'Chưa có phiếu trả hàng.'}
            </div>
          ) : undefined,
        }}
      />

      <Modal
        open={isViewPresetModalOpen}
        title="Lưu mẫu lọc phiếu trả hàng"
        okText="Lưu mẫu"
        cancelText="Đóng"
        onOk={() => void saveNamedPreset()}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
      >
        <Input
          data-testid="purchase-returns-preset-name"
          placeholder="Ví dụ: Chờ duyệt giá trị cao"
          value={viewPresetName}
          onChange={(event) => setViewPresetName(event.target.value)}
          onPressEnter={() => void saveNamedPreset()}
        />
      </Modal>

      {detailReturn && (
        <Modal
          title={`Chi tiết trả hàng - ${detailReturn.code}`}
          open={!!detailReturn}
          onCancel={() => setDetailReturn(null)}
          width={900}
          footer={null}
        >
          {detailQuery.isLoading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : detailQuery.error ? (
            <div style={{ color: '#ff4d4f', padding: 16, textAlign: 'center' }}>
              Lỗi: Không thể tải chi tiết phiếu trả
            </div>
          ) : detailQuery.data ? (
            <div data-testid="purchase-return-detail-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {detailQuery.data.legacy_source_warning ? (
                <Alert showIcon type="warning" message={detailQuery.data.legacy_source_warning} />
              ) : null}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <strong>Ngày trả:</strong> {detailQuery.data.return_date}
                </div>
                <div>
                  <strong>NCC:</strong> {detailQuery.data.supplier_name}
                </div>
                <div>
                  <strong>Phiếu nhập nguồn:</strong> {detailQuery.data.source_receipt_code || '-'}
                </div>
                <div>
                  <strong>Đơn mua:</strong> {detailQuery.data.purchase_order_code || '-'}
                </div>
                <div>
                  <strong>Lý do:</strong> {detailQuery.data.return_reason}
                </div>
                <div>
                  <strong>Trạng thái:</strong>{' '}
                  <Tag color={STATUS_COLORS[detailQuery.data.status as keyof typeof STATUS_COLORS]}>
                    {STATUS_LABELS[detailQuery.data.status as keyof typeof STATUS_LABELS]}
                  </Tag>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <strong>Ghi chú:</strong> {detailQuery.data.return_notes}
                </div>
                {detailQuery.data.reversal_reason ? (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <strong>Lý do đảo:</strong> {detailQuery.data.reversal_reason}
                  </div>
                ) : null}
              </div>

              <Card size="small" title="Bước kế tiếp">
                <div data-testid="purchase-return-next-states" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Tag color="blue">Hiện tại: {NEXT_STATE_LABELS[nextStatesQuery.data?.current || detailQuery.data.status] || (nextStatesQuery.data?.current || detailQuery.data.status)}</Tag>
                  {(nextStatesQuery.data?.next_states ?? []).length > 0 ? (
                    (nextStatesQuery.data?.next_states ?? []).map((state) => (
                      <Tag key={state} color="gold">
                        {NEXT_STATE_LABELS[state] || state}
                      </Tag>
                    ))
                  ) : (
                    <Tag>Không còn bước tiếp theo</Tag>
                  )}
                </div>
              </Card>

              <Card size="small" title="Lịch sử duyệt">
                <Table<PurchaseApprovalHistoryItem>
                  data-testid="purchase-return-approval-history"
                  rowKey={(row) => `${row.action}-${row.created_at}`}
                  loading={approvalHistoryQuery.isLoading}
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
                      width: 240,
                      render: (value) => value || '-',
                    },
                    {
                      title: 'Thời gian',
                      dataIndex: 'created_at',
                      width: 180,
                      render: (value) => dayjs(value).format('DD/MM/YYYY HH:mm'),
                    },
                  ]}
                  dataSource={approvalHistoryQuery.data ?? []}
                  pagination={false}
                  locale={{ emptyText: 'Phiếu trả hàng này chưa có lịch sử duyệt.' }}
                  scroll={{ x: 780 }}
                />
              </Card>

              <Card size="small" title="Lịch sử vòng đời">
                <Table<PurchaseApprovalHistoryItem>
                  data-testid="purchase-return-lifecycle-history"
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
                  locale={{ emptyText: 'Phiếu trả hàng này chưa có lịch sử vòng đời.' }}
                  scroll={{ x: 820 }}
                />
              </Card>

              {detailQuery.data?.lines && (
                <Table
                  style={{ marginTop: 0 }}
                  rowKey="id"
                  columns={[
                    { title: 'Dòng nhập', dataIndex: 'source_receipt_line_number', width: 100 },
                    { title: 'Sản phẩm', dataIndex: 'product_name', width: 200 },
                    { title: 'Mã', dataIndex: 'product_code', width: 100 },
                    { title: 'Đã nhập', dataIndex: 'received_qty', width: 100 },
                    { title: 'Đã trả', dataIndex: 'posted_returned_qty', width: 100 },
                    { title: 'Còn trả', dataIndex: 'remaining_returnable_qty', width: 100 },
                    { title: 'Số lượng', dataIndex: 'qty', width: 100 },
                    { title: 'Đơn giá', dataIndex: 'unit_price', width: 120, render: (v) => Number(v).toLocaleString() },
                  ]}
                  dataSource={detailQuery.data.lines}
                  pagination={false}
                />
              )}
            </div>
          ) : null}
        </Modal>
      )}

      <PurchaseReturnFormModal
        open={formOpen}
        data={editReturn}
        onClose={() => {
          setFormOpen(false);
          setEditReturn(null);
        }}
        onSuccess={() => setPage(1)}
      />
    </div>
  );
}
