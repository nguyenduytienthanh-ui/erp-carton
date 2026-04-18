import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workforceApi } from '../../api/workforce';
import type {
  BonusPenaltyCalculationType,
  BonusPenaltyRecord,
  BonusPenaltyRecordPayload,
  BonusPenaltyType,
  Employee,
} from '../../types/workforce';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { canManageWorkforceData } from '../../utils/authz';
import { PAGES } from '../../utils/constants';
import { getToastMessage } from '../../shared/apiError';

const { Text, Title } = Typography;

type BonusPenaltyFilters = {
  month: string;
  record_type: '' | BonusPenaltyType;
};

type BonusPenaltyViewSnapshot = {
  search: string;
  month: string;
  record_type: '' | BonusPenaltyType;
};

type BonusPenaltyNamedPreset = {
  id: string;
  name: string;
  filters: BonusPenaltyViewSnapshot;
};

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const currentDate = today.toISOString().slice(0, 10);

const TYPE_OPTIONS: Array<{ value: BonusPenaltyType; label: string }> = [
  { value: 'BONUS', label: 'Thưởng' },
  { value: 'PENALTY', label: 'Phạt' },
];

const CALC_OPTIONS: Array<{ value: BonusPenaltyCalculationType; label: string }> = [
  { value: 'FIXED', label: 'Cố định' },
  { value: 'DAILY_RATIO', label: 'Theo ngày công' },
];

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};

function serializeFilters(filters: BonusPenaltyFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): BonusPenaltyFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<BonusPenaltyFilters>;
    return {
      month: typeof parsed.month === 'string' && parsed.month ? parsed.month : currentMonth,
      record_type: parsed.record_type === 'BONUS' || parsed.record_type === 'PENALTY' ? parsed.record_type : '',
    };
  } catch {
    return { month: currentMonth, record_type: '' };
  }
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number): string {
  return `${value.toLocaleString('vi-VN')} đ`;
}

function parseViewSnapshot(value: unknown): BonusPenaltyViewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const recordType = obj.record_type;
  return {
    search: typeof obj.search === 'string' ? obj.search : '',
    month: typeof obj.month === 'string' && obj.month ? obj.month : currentMonth,
    record_type: recordType === 'BONUS' || recordType === 'PENALTY' ? recordType : '',
  };
}

type BonusPenaltyForm = {
  employee: number;
  month: string;
  record_type: BonusPenaltyType;
  reason: string;
  amount: number;
  calculation_type: BonusPenaltyCalculationType;
  record_date: string;
  approved_by_name: string;
  note: string;
  is_active: boolean;
};

const emptyForm: BonusPenaltyForm = {
  employee: 0,
  month: currentMonth,
  record_type: 'BONUS',
  reason: '',
  amount: 0,
  calculation_type: 'FIXED',
  record_date: currentDate,
  approved_by_name: '',
  note: '',
  is_active: true,
};

export default function BonusPenaltyList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<BonusPenaltyFilters>({ month: currentMonth, record_type: '' });
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<BonusPenaltyRecord | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<BonusPenaltyForm>();
  const {
    config,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.WORKFORCE_BONUS_PENALTY);
  const canManage = canManageWorkforceData();
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

  const employeesQuery = useQuery({
    queryKey: ['workforce-employees-select'],
    queryFn: () => workforceApi.getEmployees({ page: 1, page_size: 500, ordering: 'code', is_active: 'true' }),
  });

  const params = useMemo(() => {
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: '-record_date' };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.month) next.month = intentFilters.month;
    if (intentFilters.record_type) next.record_type = intentFilters.record_type;
    return next;
  }, [intentFilters, intentSearch, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['workforce-bonus-penalty', params],
    queryFn: () => workforceApi.getBonusPenaltyRecords(params),
  });

  const createMutation = useMutation({
    mutationFn: workforceApi.createBonusPenaltyRecord,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-bonus-penalty'] });
      messageApi.success('Đã thêm thưởng/phạt');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<BonusPenaltyRecordPayload> }) =>
      workforceApi.updateBonusPenaltyRecord(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-bonus-penalty'] });
      messageApi.success('Đã cập nhật thưởng/phạt');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: workforceApi.deleteBonusPenaltyRecord,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-bonus-penalty'] });
      messageApi.success('Đã xóa thưởng/phạt');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const employees = (employeesQuery.data?.results ?? []).filter(
    (item) => item.is_active && item.status !== 'RESIGNED',
  );
  const rows = useMemo(() => listQuery.data?.results ?? [], [listQuery.data?.results]);
  const total = listQuery.data?.count ?? 0;

  const summary = useMemo(() => {
    const bonusRows = rows.filter((item) => item.record_type === 'BONUS');
    const penaltyRows = rows.filter((item) => item.record_type === 'PENALTY');
    const totalBonus = bonusRows.reduce((acc, item) => acc + toNumber(item.amount), 0);
    const totalPenalty = penaltyRows.reduce((acc, item) => acc + toNumber(item.amount), 0);
    return {
      totalBonus,
      totalPenalty,
      delta: totalBonus - totalPenalty,
      bonusCount: bonusRows.length,
      penaltyCount: penaltyRows.length,
      dailyRatioCount: rows.filter((item) => item.calculation_type === 'DAILY_RATIO').length,
    };
  }, [rows]);

  const statusAlert = useMemo(() => {
    if (summary.totalPenalty > summary.totalBonus) {
      return {
        type: 'warning' as const,
        message: 'Giá trị phạt đang lớn hơn giá trị thưởng trên tập dữ liệu hiện tại.',
        description: 'Nên rà lại các bản ghi phạt, lý do và cách tính trước khi chuyển dữ liệu sang bước tính lương.',
      };
    }
    if (summary.penaltyCount > 0) {
      return {
        type: 'info' as const,
        message: `Có ${summary.penaltyCount} bản ghi phạt trong tháng đang xem.`,
        description: 'Bạn có thể dùng bộ lọc loại để rà riêng các khoản phạt và đối chiếu lý do duyệt.',
      };
    }
    return {
      type: 'success' as const,
      message: 'Dữ liệu thưởng/phạt đang ở trạng thái cân bằng.',
      description: 'Không có tín hiệu phạt nổi bật trên bộ lọc hiện tại.',
    };
  }, [summary.penaltyCount, summary.totalBonus, summary.totalPenalty]);

  const activeFilterTags = useMemo(() => {
    const tags = [`Tháng: ${intentFilters.month || currentMonth}`];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    if (intentFilters.record_type) {
      tags.push(`Loại: ${TYPE_OPTIONS.find((item) => item.value === intentFilters.record_type)?.label ?? intentFilters.record_type}`);
    }
    return tags;
  }, [intentFilters, intentSearch]);

  const namedPresets = useMemo(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) return [] as BonusPenaltyNamedPreset[];
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
      .filter((value): value is BonusPenaltyNamedPreset => value !== null);
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
      month: configRecord.month,
      record_type: configRecord.record_type,
    });
  }, [configRecord.month, configRecord.record_type, configRecord.saved_view_snapshot, configRecord.search]);

  const commandContextTags = useMemo(() => {
    if (!selectedPreset) return activeFilterTags;
    return [...activeFilterTags, `Mẫu đang dùng: ${selectedPreset.name}`];
  }, [activeFilterTags, selectedPreset]);

  const buildCurrentSnapshot = (): BonusPenaltyViewSnapshot => ({
    search: searchInput,
    month: filters.month || currentMonth,
    record_type: filters.record_type,
  });

  const applySnapshot = (snapshot: BonusPenaltyViewSnapshot) => {
    setSearchInput(snapshot.search);
    setFilters({
      month: snapshot.month || currentMonth,
      record_type: snapshot.record_type,
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
      messageApi.success('Đã lưu chế độ xem thưởng/phạt.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem thưởng/phạt.');
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
    const nextPreset: BonusPenaltyNamedPreset = existing
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

  const columns: ColumnsType<BonusPenaltyRecord> = [
    { title: 'Ngày', dataIndex: 'record_date', width: 110 },
    { title: 'Tháng', dataIndex: 'month', width: 90 },
    { title: 'Mã NV', dataIndex: 'employee_code', width: 100 },
    { title: 'Tên NV', dataIndex: 'employee_name', width: 220 },
    {
      title: 'Loại',
      dataIndex: 'record_type',
      width: 110,
      render: (value: BonusPenaltyType) => <Tag color={value === 'BONUS' ? 'success' : 'error'}>{value === 'BONUS' ? 'Thưởng' : 'Phạt'}</Tag>,
    },
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      width: 150,
      align: 'right',
      render: (value: string, row) => {
        const formatted = formatCurrency(toNumber(value));
        if (row.record_type === 'BONUS') return <span style={{ color: '#389e0d', fontWeight: 600 }}>{formatted}</span>;
        return <span style={{ color: '#cf1322', fontWeight: 600 }}>-{formatted}</span>;
      },
    },
    { title: 'Lý do', dataIndex: 'reason', width: 260 },
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
                  setEditing(row);
                  form.setFieldsValue({
                    employee: row.employee,
                    month: row.month,
                    record_type: row.record_type,
                    reason: row.reason,
                    amount: toNumber(row.amount),
                    calculation_type: row.calculation_type,
                    record_date: row.record_date,
                    approved_by_name: row.approved_by_name || '',
                    note: row.note || '',
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
                onClick={() =>
                  Modal.confirm({
                    title: 'Xóa bản ghi thưởng/phạt?',
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

  const toPayload = (values: BonusPenaltyForm): BonusPenaltyRecordPayload => ({
    employee: values.employee,
    month: values.month,
    record_type: values.record_type,
    reason: values.reason.trim(),
    amount: toNumber(values.amount),
    calculation_type: values.calculation_type,
    record_date: values.record_date,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}

      <Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <Space wrap>
                <Tag color="blue">Nhân sự</Tag>
                <Tag color="gold">Thưởng / Phạt</Tag>
                <Tag color={canManage ? 'processing' : 'default'}>{canManage ? 'Điều phối ảnh hưởng lương' : 'Theo quyền hiện tại'}</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>Trung tâm thưởng và phạt</Title>
              <Text type="secondary">Theo dõi nhanh chênh lệch thưởng/phạt, cách tính và các khoản ảnh hưởng trực tiếp tới bảng lương tháng.</Text>
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
              Thêm thưởng/phạt
            </Button>
            {selectedPreset ? (
              <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                Mẫu đang dùng: {selectedPreset.name}
              </Tag>
            ) : null}
          </div>

          <Alert showIcon type={statusAlert.type} message={statusAlert.message} description={statusAlert.description} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tổng thưởng" value={summary.totalBonus} formatter={(value) => formatCurrency(toNumber(value))} valueStyle={{ color: '#389e0d' }} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tổng phạt" value={summary.totalPenalty} formatter={(value) => formatCurrency(toNumber(value))} valueStyle={{ color: '#cf1322' }} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Chênh lệch" value={summary.delta} formatter={(value) => formatCurrency(toNumber(value))} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Bản ghi theo ngày công" value={summary.dailyRatioCount} suffix="bản ghi" />
            </div>
          </div>
        </Space>
      </Card>

      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div data-testid="bonus-penalty-search" style={{ display: 'inline-block' }}>
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
            </div>
            <div data-testid="bonus-penalty-month-filter" style={{ display: 'inline-block' }}>
              <Input
                type="month"
                value={filters.month}
                onChange={(e) => {
                  setFilters((prev) => ({ ...prev, month: e.target.value || currentMonth }));
                  setPage(1);
                }}
                style={{ width: 180 }}
              />
            </div>
            <div data-testid="bonus-penalty-type-filter" style={{ display: 'inline-block' }}>
              <Select
                value={filters.record_type || undefined}
                placeholder="Loại"
                options={TYPE_OPTIONS}
                style={{ width: 140 }}
                onChange={(value) => {
                  setFilters((prev) => ({ ...prev, record_type: (value ?? '') as '' | BonusPenaltyType }));
                  setPage(1);
                }}
              />
            </div>
            <Button
              onClick={() => {
                setSearchInput('');
                setFilters({ month: currentMonth, record_type: '' });
                setPage(1);
                setSelectedPresetId(undefined);
              }}
            >
              Xóa bộ lọc
            </Button>
          </div>
          <div
            data-testid="bonus-penalty-command-strip"
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Button data-testid="bonus-penalty-save-view" onClick={() => void saveCurrentView()} disabled={isPreferencesLoading}>
              Lưu chế độ xem
            </Button>
            <Button data-testid="bonus-penalty-restore-view" onClick={applySavedView} disabled={isPreferencesLoading}>
              Áp dụng chế độ đã lưu
            </Button>
            <Button
              data-testid="bonus-penalty-open-preset-modal"
              onClick={() => {
                setPresetName(selectedPreset?.name ?? '');
                setIsPresetModalOpen(true);
              }}
              disabled={isPreferencesLoading}
            >
              Lưu mẫu mới
            </Button>
            <div data-testid="bonus-penalty-preset-select" style={{ display: 'inline-block' }}>
              <Select<string>
                allowClear
                placeholder="Chọn mẫu thưởng/phạt"
                value={selectedPresetId}
                onChange={(value) => setSelectedPresetId(value)}
                disabled={isPreferencesLoading}
                style={{ width: 220 }}
                options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
              />
            </div>
            <Button data-testid="bonus-penalty-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
              Áp dụng mẫu lọc
            </Button>
            <Button danger data-testid="bonus-penalty-delete-preset" onClick={() => void deleteNamedPreset()} disabled={isPreferencesLoading}>
              Xóa mẫu lọc
            </Button>
            {savedViewSnapshot ? <Tag color="default">Có chế độ xem đã lưu</Tag> : null}
          </div>
          <Space wrap>
            {commandContextTags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
            <Tag color="success">{`Số bản ghi thưởng: ${summary.bonusCount}`}</Tag>
            <Tag color="error">{`Số bản ghi phạt: ${summary.penaltyCount}`}</Tag>
          </Space>
        </Space>
      </Card>

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
        title="Lưu mẫu lọc thưởng/phạt"
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
          data-testid="bonus-penalty-preset-name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Ví dụ: Chỉ thưởng / Chỉ phạt / Theo dõi cuối tháng"
          maxLength={80}
          autoFocus
        />
      </Modal>

      <Modal
        title={editing ? 'Sửa thưởng/phạt' : 'Thêm thưởng/phạt'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={submitForm}
        width={760}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="month" label="Tháng" rules={[{ required: true }]}>
              <Input type="month" />
            </Form.Item>
            <Form.Item name="employee" label="Nhân viên" rules={[{ required: true }]}>
              <Select
                options={employees.map((item: Employee) => ({
                  value: item.id,
                  label: `${item.code} - ${item.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="record_type" label="Loại" rules={[{ required: true }]}>
              <Select options={TYPE_OPTIONS} />
            </Form.Item>
            <Form.Item name="calculation_type" label="Cách tính" rules={[{ required: true }]}>
              <Select options={CALC_OPTIONS} />
            </Form.Item>
            <Form.Item name="record_date" label="Ngày ghi nhận" rules={[{ required: true }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="amount" label="Số tiền" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="reason" label="Lý do" rules={[{ required: true, message: 'Bắt buộc' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="approved_by_name" label="Người duyệt">
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
    </div>
  );
}
