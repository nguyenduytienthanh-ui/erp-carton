import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../api/inventory';
import { productsApi } from '../../api/products';
import type {
  Stocktake,
  StocktakeAdjustmentLineStatus,
  StocktakeAdjustmentPreview,
  StocktakeAdjustmentPreviewLine,
  StocktakeAdjustmentType,
  StocktakeLine,
  StocktakeStatus,
} from '../../types/inventory';
import { canManageStocktake } from '../../utils/authz';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import { getToastMessage } from '../../shared/apiError';

const STATUS_LABELS: Record<StocktakeStatus, string> = {
  DRAFT: 'Nháp',
  COMPLETED: 'Đã hoàn tất',
  CANCELLED: 'Đã hủy',
};
const STATUS_COLORS: Record<StocktakeStatus, string> = {
  DRAFT: 'default',
  COMPLETED: 'success',
  CANCELLED: 'default',
};

const STATUS_NEXT_STEPS: Record<StocktakeStatus, string> = {
  DRAFT: 'Nhập đủ số kiểm kê, rà lại chênh lệch rồi hoàn tất kiểm kê.',
  COMPLETED: 'Xem trước điều chỉnh tồn, xử lý dòng bị chặn rồi ghi điều chỉnh nếu có chênh lệch.',
  CANCELLED: 'Phiếu đã hủy, chỉ dùng để tra cứu lịch sử kiểm kê.',
};

const STATUS_HELP_TEXT: Record<StocktakeStatus, string> = {
  DRAFT: 'Phiếu nháp chưa khóa số đếm và chưa tạo giao dịch điều chỉnh.',
  COMPLETED: 'Hoàn tất kiểm kê chỉ khóa số đếm; tồn kho chỉ đổi sau khi ghi điều chỉnh.',
  CANCELLED: 'Không thao tác tiếp trên phiếu đã hủy.',
};

const ADJUSTMENT_TYPE_LABELS: Record<StocktakeAdjustmentType, string> = {
  ADJUSTMENT_IN: 'Điều chỉnh tăng',
  ADJUSTMENT_OUT: 'Điều chỉnh giảm',
};

const ADJUSTMENT_TYPE_COLORS: Record<StocktakeAdjustmentType, string> = {
  ADJUSTMENT_IN: 'green',
  ADJUSTMENT_OUT: 'red',
};

const ADJUSTMENT_STATUS_LABELS: Record<StocktakeAdjustmentLineStatus, string> = {
  READY: 'Sẵn sàng ghi',
  SKIPPED: 'Không lệch',
  BLOCKED: 'Bị chặn',
};

const ADJUSTMENT_STATUS_COLORS: Record<StocktakeAdjustmentLineStatus, string> = {
  READY: 'blue',
  SKIPPED: 'default',
  BLOCKED: 'red',
};

type CreateFormValues = {
  warehouse: number;
  count_date: string;
  note: string;
  lines: Array<{ product_id: number; count_qty: number; note?: string }>;
};

type StocktakeFilters = {
  warehouse?: number;
  status?: StocktakeStatus;
};

type StocktakeViewSnapshot = {
  warehouse?: number;
  status?: StocktakeStatus;
};

type StocktakeNamedPreset = {
  id: string;
  name: string;
  filters: StocktakeViewSnapshot;
};

function parseViewSnapshot(value: unknown): StocktakeViewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  return {
    warehouse: typeof obj.warehouse === 'number' ? obj.warehouse : undefined,
    status: typeof obj.status === 'string' ? (obj.status as StocktakeStatus) : undefined,
  };
}

function formatQty(value: string | number | null | undefined): string {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue.toLocaleString('vi-VN') : String(value ?? '');
}

function formatBlockedReason(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(formatBlockedReason).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => `${key}: ${formatBlockedReason(nestedValue)}`)
      .filter(Boolean)
      .join('; ');
  }
  return String(value);
}

function getStocktakeNextStep(stocktake?: Stocktake | null, adjustmentPosted = false): string {
  if (!stocktake) return 'Chọn một phiếu kiểm tồn để xem bước xử lý tiếp theo.';
  if (stocktake.status === 'COMPLETED' && adjustmentPosted) {
    return 'Phiếu đã ghi điều chỉnh tồn, đối chiếu sổ kho nếu cần kiểm tra sau kiểm kê.';
  }
  return STATUS_NEXT_STEPS[stocktake.status] ?? 'Kiểm tra trạng thái hiện tại trước khi thao tác tiếp.';
}

function getStocktakeStatusHelp(stocktake?: Stocktake | null): string {
  if (!stocktake) return '';
  return STATUS_HELP_TEXT[stocktake.status] ?? '';
}

function getStocktakeAlertType(stocktake?: Stocktake | null, adjustmentPosted = false): 'info' | 'success' | 'warning' {
  if (!stocktake) return 'info';
  if (adjustmentPosted) return 'success';
  if (stocktake.status === 'COMPLETED') return 'warning';
  if (stocktake.status === 'DRAFT') return 'info';
  return 'info';
}

function getPostAdjustmentDisabledReason(
  stocktake: Stocktake | null,
  preview: StocktakeAdjustmentPreview | null,
  adjustmentPosted: boolean,
): string {
  if (!stocktake) return 'Chưa chọn phiếu kiểm tồn.';
  if (stocktake.status !== 'COMPLETED') return 'Chỉ phiếu đã hoàn tất kiểm kê mới ghi điều chỉnh tồn.';
  if (adjustmentPosted) return 'Phiếu này đã ghi điều chỉnh tồn.';
  if (!preview) return 'Cần xem trước điều chỉnh tồn trước khi ghi.';
  if (!preview.can_post) return 'Preview hiện tại chưa cho phép ghi điều chỉnh.';
  if (preview.blocked_lines > 0) return 'Còn dòng bị chặn, cần xử lý trước khi ghi.';
  if (preview.transaction_count === 0) return 'Không có chênh lệch cần ghi điều chỉnh.';
  return '';
}

export default function StocktakeList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<StocktakeFilters>({});
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [adjustmentPreview, setAdjustmentPreview] = useState<StocktakeAdjustmentPreview | null>(null);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [createForm] = Form.useForm<CreateFormValues>();
  const canManage = canManageStocktake();
  const {
    config,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.INVENTORY_STOCKTAKES);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord.pageSize ?? 20);

  const detailQuery = useQuery({
    queryKey: ['inventory-stocktake-detail', detailId],
    queryFn: () => inventoryApi.getStocktake(detailId as number),
    enabled: detailId != null && canManage,
  });
  const detail = detailQuery.data ?? null;

  const listQuery = useQuery({
    queryKey: ['inventory-stocktakes', page, pageSize, filters],
    queryFn: () =>
      inventoryApi.getStocktakes({
        page,
        page_size: pageSize,
        ordering: '-count_date',
        warehouse: filters.warehouse,
        status: filters.status,
      }),
    enabled: canManage,
  });

  const warehousesQuery = useQuery({
    queryKey: ['inventory-warehouses-list'],
    queryFn: () => inventoryApi.getWarehouses({ page_size: 10000, is_active: 'true', ordering: '-created_at' }),
    enabled: canManage,
  });

  const productsQuery = useQuery({
    queryKey: ['products-list-stocktake'],
    queryFn: () => productsApi.getProducts({ page_size: 10000, ordering: '-id' }),
    enabled: createOpen && canManage,
  });

  const resetAdjustmentUi = () => {
    setAdjustmentPreview(null);
    setAdjustmentReason('');
    setIsPostModalOpen(false);
  };

  const openDetail = (id: number) => {
    resetAdjustmentUi();
    setDetailId(id);
  };

  const closeDetail = () => {
    resetAdjustmentUi();
    setDetailId(null);
  };

  const createMutation = useMutation({
    mutationFn: inventoryApi.createStocktake,
    onSuccess: () => {
      messageApi.success('Tạo phiếu kiểm tồn thành công.');
      setCreateOpen(false);
      createForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['inventory-stocktakes'] });
    },
    onError: (err) => messageApi.error(getToastMessage(err)),
  });

  const completeMutation = useMutation({
    mutationFn: inventoryApi.completeStocktake,
    onSuccess: () => {
      messageApi.success('Đã hoàn tất phiếu kiểm tồn.');
      setAdjustmentPreview(null);
      void queryClient.invalidateQueries({ queryKey: ['inventory-stocktakes'] });
      if (detailId != null) {
        void queryClient.invalidateQueries({ queryKey: ['inventory-stocktake-detail', detailId] });
      }
    },
    onError: (err) => messageApi.error(getToastMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: inventoryApi.deleteStocktake,
    onSuccess: () => {
      messageApi.success('Đã xóa phiếu.');
      closeDetail();
      void queryClient.invalidateQueries({ queryKey: ['inventory-stocktakes'] });
    },
    onError: (err) => messageApi.error(getToastMessage(err)),
  });

  const previewAdjustmentMutation = useMutation({
    mutationFn: inventoryApi.previewStocktakeAdjustments,
    onSuccess: (data) => {
      setAdjustmentPreview(data);
      if (data.blocked_lines > 0) {
        messageApi.warning('Có dòng bị chặn, chưa thể ghi điều chỉnh tồn.');
      } else if (data.transaction_count === 0) {
        messageApi.info('Không có chênh lệch cần ghi điều chỉnh.');
      } else {
        messageApi.success('Đã tải xem trước điều chỉnh tồn.');
      }
    },
    onError: (err) => messageApi.error(getToastMessage(err)),
  });

  const postAdjustmentMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => inventoryApi.postStocktakeAdjustments(id, reason),
    onSuccess: (data) => {
      setAdjustmentPreview(data);
      setAdjustmentReason('');
      setIsPostModalOpen(false);
      messageApi.success('Đã ghi điều chỉnh tồn vào sổ kho.');
      void queryClient.invalidateQueries({ queryKey: ['inventory-stocktakes'] });
      if (detailId != null) {
        void queryClient.invalidateQueries({ queryKey: ['inventory-stocktake-detail', detailId] });
      }
    },
    onError: (err) => messageApi.error(getToastMessage(err)),
  });

  const warehouses = useMemo(() => warehousesQuery.data?.results ?? [], [warehousesQuery.data]);
  const products = useMemo(() => productsQuery.data?.results ?? [], [productsQuery.data]);
  const warehouseLabelMap = useMemo(
    () => Object.fromEntries(warehouses.map((item) => [item.id, `${item.code} - ${item.name}`])) as Record<number, string>,
    [warehouses]
  );
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (filters.warehouse) {
      tags.push(`Kho: ${warehouseLabelMap[filters.warehouse] ?? `#${filters.warehouse}`}`);
    }
    if (filters.status) {
      tags.push(`Trạng thái: ${STATUS_LABELS[filters.status]}`);
    }
    return tags;
  }, [filters.status, filters.warehouse, warehouseLabelMap]);
  const namedPresets = useMemo<StocktakeNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const obj = value as Record<string, unknown>;
      if (typeof obj.id !== 'string' || typeof obj.name !== 'string') return [];
      const filtersValue = parseViewSnapshot(obj.filters);
      if (!filtersValue) return [];
      return [{ id: obj.id, name: obj.name, filters: filtersValue }];
    });
  }, [configRecord.saved_views]);
  const selectedPreset = useMemo(
    () => namedPresets.find((preset) => preset.id === selectedPresetId) ?? null,
    [namedPresets, selectedPresetId]
  );
  const savedViewSnapshot = useMemo(() => {
    const directSnapshot = parseViewSnapshot(configRecord.saved_view_snapshot);
    if (directSnapshot) return directSnapshot;
    return parseViewSnapshot({
      warehouse: configRecord.warehouse,
      status: configRecord.status,
    });
  }, [configRecord.saved_view_snapshot, configRecord.warehouse, configRecord.status]);
  const commandContextTags = useMemo(() => {
    if (!selectedPreset) return activeFilterTags;
    return [...activeFilterTags, `Mẫu đang dùng: ${selectedPreset.name}`];
  }, [activeFilterTags, selectedPreset]);

  const previewForDetail = detail && adjustmentPreview?.stocktake === detail.id ? adjustmentPreview : null;
  const isAdjustmentPosted = Boolean(
    detail?.adjustment_posted_at || previewForDetail?.adjustment_posted_at || previewForDetail?.status === 'POSTED'
  );
  const canOpenPostAdjustment =
    Boolean(detail && previewForDetail?.can_post && previewForDetail.blocked_lines === 0 && previewForDetail.transaction_count > 0) &&
    !isAdjustmentPosted;
  const postAdjustmentDisabledReason = getPostAdjustmentDisabledReason(detail, previewForDetail, isAdjustmentPosted);

  const handleOpenPostAdjustment = () => {
    if (!detail || !previewForDetail) {
      messageApi.warning('Vui lòng xem trước điều chỉnh tồn trước khi ghi sổ.');
      return;
    }
    if (previewForDetail.blocked_lines > 0) {
      messageApi.warning('Còn dòng bị chặn, chưa thể ghi điều chỉnh tồn.');
      return;
    }
    if (isAdjustmentPosted) {
      messageApi.info('Phiếu này đã ghi điều chỉnh tồn, không thể ghi lại.');
      return;
    }
    if (previewForDetail.transaction_count === 0) {
      messageApi.info('Không có chênh lệch cần ghi điều chỉnh.');
      return;
    }
    setIsPostModalOpen(true);
  };

  const handlePostAdjustment = async () => {
    if (!detail) return;
    const reason = adjustmentReason.trim();
    if (!reason) {
      messageApi.warning('Vui lòng nhập lý do ghi điều chỉnh tồn.');
      return;
    }
    await postAdjustmentMutation.mutateAsync({ id: detail.id, reason });
  };

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    const lines = (values.lines ?? []).filter((l: { product_id?: number }) => l.product_id);
    if (lines.length === 0) {
      messageApi.warning('Thêm ít nhất một dòng sản phẩm.');
      return;
    }
    await createMutation.mutateAsync({
      warehouse: values.warehouse,
      count_date: dayjs(values.count_date).format('YYYY-MM-DD'),
      note: values.note ?? '',
      lines_data: lines.map((l: { product_id: number; count_qty: number; note?: string }) => ({
        product_id: l.product_id,
        count_qty: Number(l.count_qty ?? 0),
        note: l.note,
      })),
    });
  };

  const buildCurrentSnapshot = (): StocktakeViewSnapshot => ({
    warehouse: filters.warehouse,
    status: filters.status,
  });

  const applySnapshot = (snapshot: StocktakeViewSnapshot) => {
    setFilters({
      warehouse: snapshot.warehouse,
      status: snapshot.status,
    });
    setPage(1);
  };

  const resetFilters = () => {
    setFilters({});
    setPage(1);
    setSelectedPresetId(undefined);
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
      messageApi.success('Đã lưu chế độ xem kiểm tồn.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem kiểm tồn.');
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
    const nextPreset: StocktakeNamedPreset = existing
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

  const columns: ColumnsType<Stocktake> = [
    { title: 'Mã', dataIndex: 'code', width: 140 },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 180 },
    { title: 'Ngày kiểm', dataIndex: 'count_date', width: 120, render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 280,
      render: (_: StocktakeStatus, row) => (
        <Space direction="vertical" size={4}>
          <Tag color={STATUS_COLORS[row.status]}>{STATUS_LABELS[row.status]}</Tag>
          <span data-testid={`stocktake-next-step-${row.id}`} style={{ color: '#595959', fontSize: 12, lineHeight: 1.45 }}>
            {getStocktakeNextStep(row)}
          </span>
        </Space>
      ),
    },
    { title: 'Ghi chú', dataIndex: 'note', ellipsis: true },
  ];

  const lineColumns: ColumnsType<StocktakeLine> = [
    { title: '#', dataIndex: 'line_number', width: 50 },
    { title: 'Mã SP', dataIndex: 'product_code', width: 120 },
    { title: 'Tên SP', dataIndex: 'product_name', width: 200 },
    { title: 'Tồn hệ thống', dataIndex: 'system_qty', width: 110, align: 'right', render: (v) => Number(v).toLocaleString('vi-VN') },
    { title: 'Tồn đếm', dataIndex: 'count_qty', width: 110, align: 'right', render: (v) => Number(v).toLocaleString('vi-VN') },
    {
      title: 'Chênh lệch',
      dataIndex: 'variance_qty',
      width: 110,
      align: 'right',
      render: (v: string) => {
        const n = Number(v);
        return <span style={{ color: n !== 0 ? '#cf1322' : undefined }}>{n.toLocaleString('vi-VN')}</span>;
      },
    },
  ];

  const adjustmentLineColumns: ColumnsType<StocktakeAdjustmentPreviewLine> = [
    { title: '#', dataIndex: 'line_number', width: 52 },
    { title: 'Mã SP', dataIndex: 'product_code', width: 110 },
    { title: 'Tên SP', dataIndex: 'product_name', ellipsis: true },
    { title: 'Tồn hệ thống', dataIndex: 'system_qty', width: 110, align: 'right', render: (value) => formatQty(value as string) },
    { title: 'Tồn đếm', dataIndex: 'count_qty', width: 100, align: 'right', render: (value) => formatQty(value as string) },
    {
      title: 'Chênh lệch',
      dataIndex: 'variance_qty',
      width: 105,
      align: 'right',
      render: (value: string) => {
        const numberValue = Number(value);
        const color = numberValue > 0 ? '#237804' : numberValue < 0 ? '#cf1322' : undefined;
        return <span style={{ color }}>{formatQty(value)}</span>;
      },
    },
    {
      title: 'Ledger sẽ ghi',
      dataIndex: 'adjustment_type',
      width: 145,
      render: (value: StocktakeAdjustmentType | null) =>
        value ? <Tag color={ADJUSTMENT_TYPE_COLORS[value]}>{ADJUSTMENT_TYPE_LABELS[value]}</Tag> : <Tag>Không ghi</Tag>,
    },
    { title: 'Số lượng', dataIndex: 'adjustment_qty', width: 95, align: 'right', render: (value) => formatQty(value as string) },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 130,
      render: (value: StocktakeAdjustmentLineStatus, row) => (
        <Space direction="vertical" size={2}>
          <Tag color={ADJUSTMENT_STATUS_COLORS[value]}>{ADJUSTMENT_STATUS_LABELS[value]}</Tag>
          {value === 'BLOCKED' ? (
            <span style={{ color: '#cf1322', fontSize: 12 }}>{formatBlockedReason(row.blocked_reason)}</span>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {contextHolder}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Kiểm tồn</h2>
        <Space wrap>
          {canManage && (
            <Button data-testid="stocktakes-open-create" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              Tạo phiếu kiểm tồn
            </Button>
          )}
          {selectedPreset ? (
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>
              Mẫu đang dùng: {selectedPreset.name}
            </Tag>
          ) : null}
        </Space>
      </div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div data-testid="stocktakes-warehouse-filter" style={{ display: 'inline-block' }}>
          <Select
            allowClear
            placeholder="Lọc theo kho"
            style={{ width: 260 }}
            value={filters.warehouse}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, warehouse: value }));
              setPage(1);
            }}
            options={warehouses.map((item) => ({ label: `${item.code} - ${item.name}`, value: item.id }))}
          />
        </div>
        <div data-testid="stocktakes-status-filter" style={{ display: 'inline-block' }}>
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
        </div>
        <Button onClick={resetFilters}>Xóa bộ lọc</Button>
      </div>
      <div
        data-testid="stocktakes-command-strip"
        style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <Button data-testid="stocktakes-save-view" onClick={() => void saveCurrentView()} disabled={isPreferencesLoading}>
          Lưu chế độ xem
        </Button>
        <Button data-testid="stocktakes-restore-view" onClick={applySavedView} disabled={isPreferencesLoading}>
          Áp dụng chế độ đã lưu
        </Button>
        <Button
          data-testid="stocktakes-open-preset-modal"
          onClick={() => {
            setPresetName(selectedPreset?.name ?? '');
            setIsPresetModalOpen(true);
          }}
          disabled={isPreferencesLoading}
        >
          Lưu mẫu mới
        </Button>
        <div data-testid="stocktakes-preset-select" style={{ display: 'inline-block' }}>
          <Select<string>
            allowClear
            placeholder="Chọn mẫu kiểm tồn"
            value={selectedPresetId}
            onChange={(value) => setSelectedPresetId(value)}
            disabled={isPreferencesLoading}
            style={{ width: 220 }}
            options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
          />
        </div>
        <Button data-testid="stocktakes-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
          Áp dụng mẫu lọc
        </Button>
        <Button danger data-testid="stocktakes-delete-preset" onClick={() => void deleteNamedPreset()} disabled={isPreferencesLoading}>
          Xóa mẫu lọc
        </Button>
        {savedViewSnapshot ? <Tag color="default">Có chế độ xem đã lưu</Tag> : null}
      </div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {commandContextTags.length > 0 ? (
          commandContextTags.map((tag) => <Tag key={tag}>{tag}</Tag>)
        ) : (
          <Tag color="default">Đang xem toàn bộ phiếu kiểm tồn</Tag>
        )}
      </div>
      <Table<Stocktake>
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={listQuery.data?.results ?? []}
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
        onRow={(row) => ({ onClick: () => openDetail(row.id), style: { cursor: 'pointer' } })}
        locale={{
          emptyText: (listQuery.data?.results?.length ?? 0) === 0 && !listQuery.isLoading ? (
            <div style={{ padding: 40, color: '#8c8c8c' }}>
              {commandContextTags.length > 0 ? (
                <>
                  <div style={{ marginBottom: 12 }}>Không tìm thấy phiếu kiểm tồn phù hợp với bộ lọc hiện tại.</div>
                  <Button type="link" onClick={resetFilters}>
                    Xóa bộ lọc
                  </Button>
                </>
              ) : (
                'Chưa có phiếu kiểm tồn. Nhấn Tạo phiếu để thêm mới.'
              )}
            </div>
          ) : undefined,
        }}
      />

      <Modal
        title="Lưu mẫu lọc kiểm tồn"
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
          data-testid="stocktakes-preset-name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Ví dụ: Chờ hoàn tất / Theo kho nguyên liệu"
          maxLength={80}
          autoFocus
        />
      </Modal>

      <Modal
        title="Tạo phiếu kiểm tồn"
        open={createOpen}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        onOk={() => void handleCreate()}
        confirmLoading={createMutation.isPending}
        okText="Tạo phiếu"
        cancelText="Đóng"
        width={640}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" initialValues={{ count_date: dayjs(), lines: [{}] }}>
          <Form.Item name="warehouse" label="Kho" rules={[{ required: true }]}>
            <Select
              data-testid="stocktake-warehouse"
              placeholder="Chọn kho"
              options={warehouses.map((w) => ({ label: `${w.code} - ${w.name}`, value: w.id }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item name="count_date" label="Ngày kiểm" rules={[{ required: true }]}>
            <DatePicker data-testid="stocktake-count-date" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea data-testid="stocktake-note" rows={2} placeholder="Ghi chú" />
          </Form.Item>
          <Form.Item label="Dòng kiểm" required>
            <Form.List name="lines">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item name={[field.name, 'product_id']} rules={[{ required: true }]} style={{ width: 280 }}>
                        <Select
                          data-testid={`stocktake-line-product-${field.name}`}
                          placeholder="Chọn sản phẩm"
                          options={products.map((p) => ({ label: `${p.code} - ${p.name}`, value: p.id }))}
                          showSearch
                          optionFilterProp="label"
                        />
                      </Form.Item>
                      <Form.Item name={[field.name, 'count_qty']} initialValue={0} rules={[{ required: true }]} style={{ width: 100 }}>
                        <InputNumber data-testid={`stocktake-line-qty-${field.name}`} min={0} style={{ width: '100%' }} />
                      </Form.Item>
                      <Button type="link" danger onClick={() => remove(field.name)}>Xóa</Button>
                    </Space>
                  ))}
                  <Button data-testid="stocktake-add-line" type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>Thêm dòng</Button>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Ghi điều chỉnh tồn kho"
        open={isPostModalOpen}
        onCancel={() => setIsPostModalOpen(false)}
        onOk={() => void handlePostAdjustment()}
        confirmLoading={postAdjustmentMutation.isPending}
        okText="Ghi điều chỉnh tồn"
        cancelText="Đóng"
        okButtonProps={{
          'data-testid': 'stocktake-confirm-post-adjustments',
          disabled: !adjustmentReason.trim() || postAdjustmentMutation.isPending,
        }}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Alert
            type="warning"
            showIcon
            message="Thao tác này sẽ tạo giao dịch nhập/xuất điều chỉnh tồn"
            description="Đây không phải là thao tác hoàn tất kiểm kê đơn thuần. Sau khi ghi ledger, phiếu không được ghi điều chỉnh lần hai."
          />
          {previewForDetail ? (
            <Space wrap>
              <Tag color="green">Tăng: {previewForDetail.total_in_lines}</Tag>
              <Tag color="red">Giảm: {previewForDetail.total_out_lines}</Tag>
              <Tag>Bỏ qua: {previewForDetail.skipped_zero_lines}</Tag>
            </Space>
          ) : null}
          <Input.TextArea
            data-testid="stocktake-adjustment-reason"
            rows={3}
            value={adjustmentReason}
            onChange={(event) => setAdjustmentReason(event.target.value)}
            placeholder="Nhập lý do bắt buộc, ví dụ: Điều chỉnh theo biên bản kiểm kê cuối ngày"
            maxLength={255}
            showCount
          />
        </Space>
      </Modal>

      <Drawer
        title={detail ? `Phiếu kiểm tồn ${detail.code}` : 'Chi tiết'}
        open={detailId != null}
        onClose={closeDetail}
        width={720}
      >
        {detailQuery.isLoading && detailId != null ? (
          <div style={{ padding: 24, textAlign: 'center' }}>Đang tải...</div>
        ) : detail ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <Space>
                <span>Kho: {detail.warehouse_name}</span>
                <span>Ngày: {dayjs(detail.count_date).format('DD/MM/YYYY')}</span>
                <Tag color={STATUS_COLORS[detail.status]}>{STATUS_LABELS[detail.status]}</Tag>
              </Space>
              {detail.note && <div style={{ marginTop: 8, color: '#666' }}>{detail.note}</div>}
            </div>
            <Alert
              showIcon
              data-testid="stocktake-detail-next-step"
              type={getStocktakeAlertType(detail, isAdjustmentPosted)}
              message={getStocktakeNextStep(detail, isAdjustmentPosted)}
              description={getStocktakeStatusHelp(detail)}
              style={{ marginBottom: 16 }}
            />
            <Table<StocktakeLine>
              rowKey="id"
              size="small"
              pagination={false}
              columns={lineColumns}
              dataSource={detail.lines ?? []}
            />
            <div data-testid="stocktake-adjustment-panel" style={{ marginTop: 18 }}>
              <h3 style={{ marginBottom: 8 }}>Điều chỉnh tồn sau kiểm kê</h3>
              {detail.status !== 'COMPLETED' ? (
                <Alert
                  data-testid="stocktake-adjustment-draft-alert"
                  type="info"
                  showIcon
                  message="Chưa thể ghi điều chỉnh tồn"
                  description="Hoàn tất kiểm kê chỉ khóa số đếm. Sau khi phiếu ở trạng thái Đã hoàn tất, bạn mới có thể xem trước và ghi bút toán điều chỉnh tồn kho."
                />
              ) : isAdjustmentPosted ? (
                <Alert
                  data-testid="stocktake-adjustment-posted-status"
                  type="success"
                  showIcon
                  message="Đã ghi điều chỉnh tồn"
                  description={`Phiếu này đã tạo ledger điều chỉnh tồn${(detail.adjustment_posted_at || previewForDetail?.adjustment_posted_at) ? ` lúc ${dayjs(detail.adjustment_posted_at || previewForDetail?.adjustment_posted_at).format('DD/MM/YYYY HH:mm')}` : ''}. Không thể ghi lại lần hai.`}
                />
              ) : (
                <Alert
                  data-testid="stocktake-adjustment-ready-alert"
                  type="warning"
                  showIcon
                  message="Hoàn tất kiểm kê chưa làm thay đổi tồn kho"
                  description="Xem trước điều chỉnh để kiểm tra dòng tăng, dòng giảm, dòng bỏ qua và dòng bị chặn. Chỉ khi bấm Ghi điều chỉnh tồn, hệ thống mới tạo InventoryTransaction."
                />
              )}

              {detail.status === 'COMPLETED' ? (
                <Space style={{ marginTop: 12, marginBottom: 12 }} wrap>
                  <Button
                    data-testid="stocktake-preview-adjustments"
                    onClick={() => previewAdjustmentMutation.mutate(detail.id)}
                    loading={previewAdjustmentMutation.isPending}
                    disabled={isAdjustmentPosted}
                    title={isAdjustmentPosted ? 'Phiếu đã ghi điều chỉnh tồn.' : 'Xem trước các dòng sẽ tạo giao dịch điều chỉnh'}
                  >
                    Xem trước điều chỉnh tồn
                  </Button>
                  <Button
                    data-testid="stocktake-post-adjustments"
                    type="primary"
                    disabled={!canOpenPostAdjustment}
                    title={postAdjustmentDisabledReason || 'Ghi các giao dịch điều chỉnh tồn sau kiểm kê'}
                    onClick={handleOpenPostAdjustment}
                  >
                    Ghi điều chỉnh tồn
                  </Button>
                </Space>
              ) : null}

              {previewForDetail ? (
                <div data-testid="stocktake-adjustment-preview">
                  <div data-testid="stocktake-adjustment-summary" style={{ marginBottom: 10 }}>
                    <Space wrap>
                      <Tag color="green">Tăng: {previewForDetail.total_in_lines}</Tag>
                      <Tag color="red">Giảm: {previewForDetail.total_out_lines}</Tag>
                      <Tag>Bỏ qua: {previewForDetail.skipped_zero_lines}</Tag>
                      <Tag color={previewForDetail.blocked_lines > 0 ? 'red' : 'blue'}>Bị chặn: {previewForDetail.blocked_lines}</Tag>
                    </Space>
                  </div>
                  {previewForDetail.blocked_lines > 0 ? (
                    <Alert
                      data-testid="stocktake-adjustment-blocker-alert"
                      type="error"
                      showIcon
                      style={{ marginBottom: 10 }}
                      message="Có dòng chưa thể ghi ledger"
                      description="Vui lòng xử lý dòng bị chặn trước. Hệ thống sẽ không ghi một phần nếu còn lỗi."
                    />
                  ) : null}
                  <Table<StocktakeAdjustmentPreviewLine>
                    data-testid="stocktake-adjustment-preview-table"
                    rowKey="line_id"
                    size="small"
                    pagination={false}
                    columns={adjustmentLineColumns}
                    dataSource={previewForDetail.lines ?? []}
                    scroll={{ x: 950 }}
                  />
                </div>
              ) : null}
            </div>
            {canManage && detail.status === 'DRAFT' && (
              <Space style={{ marginTop: 16 }}>
                <Button
                  data-testid={`stocktake-complete-${detail.id}`}
                  type="primary"
                  title="Khóa số kiểm kê để chuẩn bị xem trước điều chỉnh tồn"
                  onClick={() => completeMutation.mutate(detail.id)}
                  loading={completeMutation.isPending}
                >
                  Hoàn tất kiểm kê
                </Button>
                <Button
                  data-testid={`stocktake-delete-${detail.id}`}
                  danger
                  title="Chỉ xóa phiếu kiểm tồn còn ở trạng thái nháp"
                  onClick={() => { if (window.confirm('Xóa phiếu này?')) deleteMutation.mutate(detail.id); }}
                  loading={deleteMutation.isPending}
                >
                  Xóa phiếu
                </Button>
              </Space>
            )}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
