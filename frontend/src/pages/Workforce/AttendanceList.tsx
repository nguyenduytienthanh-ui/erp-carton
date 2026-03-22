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
  AttendanceDayType,
  AttendanceRecord,
  AttendanceRecordPayload,
  AttendanceShift,
  Employee,
} from '../../types/workforce';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageWorkforceData } from '../../utils/authz';
import { PAGES } from '../../utils/constants';
import { getToastMessage } from '../../shared/apiError';

const { Text, Title } = Typography;

type AttendanceFilters = {
  month: string;
};

type AttendanceViewSnapshot = {
  search: string;
  month: string;
};

type AttendanceNamedPreset = {
  id: string;
  name: string;
  filters: AttendanceViewSnapshot;
};

const OVERTIME_DAY_OPTIONS: Array<{ value: AttendanceDayType; label: string }> = [
  { value: 'WEEKDAY', label: 'Ngày thường' },
  { value: 'SUNDAY', label: 'Chủ nhật' },
  { value: 'HOLIDAY', label: 'Ngày lễ' },
];

const OVERTIME_SHIFT_OPTIONS: Array<{ value: AttendanceShift; label: string }> = [
  { value: 'MORNING', label: 'Sáng' },
  { value: 'AFTERNOON', label: 'Chiều' },
  { value: 'EVENING', label: 'Tối' },
  { value: 'NIGHT', label: 'Đêm' },
  { value: 'FULLDAY', label: 'Cả ngày' },
];

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const defaultOvertimeDate = `${currentMonth}-01`;

const SUMMARY_TILE_STYLE = {
  border: '1px solid #e5e7eb',
  borderRadius: 18,
  padding: '14px 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  height: '100%',
};

function serializeFilters(filters: AttendanceFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): AttendanceFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<AttendanceFilters>;
    return { month: typeof parsed.month === 'string' && parsed.month ? parsed.month : currentMonth };
  } catch {
    return { month: currentMonth };
  }
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseViewSnapshot(value: unknown): AttendanceViewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  return {
    search: typeof obj.search === 'string' ? obj.search : '',
    month: typeof obj.month === 'string' && obj.month ? obj.month : currentMonth,
  };
}

type AttendanceForm = {
  employee: number;
  month: string;
  standard_days: number;
  actual_days: number;
  paid_leave: number;
  unpaid_leave: number;
  note: string;
  is_active: boolean;
  overtime_items: Array<{
    overtime_date: string;
    day_type: AttendanceDayType;
    shift: AttendanceShift;
    hours: number;
    rate: number;
    note: string;
  }>;
};

const emptyForm: AttendanceForm = {
  employee: 0,
  month: currentMonth,
  standard_days: 26,
  actual_days: 0,
  paid_leave: 0,
  unpaid_leave: 0,
  note: '',
  is_active: true,
  overtime_items: [],
};

export default function AttendanceList() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<AttendanceFilters>({ month: currentMonth });
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [form] = Form.useForm<AttendanceForm>();
  const {
    config,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.WORKFORCE_ATTENDANCE);
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
    const next: Record<string, unknown> = { page, page_size: pageSize, ordering: '-month' };
    if (intentSearch.trim()) next.q = intentSearch.trim();
    if (intentFilters.month) next.month = intentFilters.month;
    return next;
  }, [intentFilters, intentSearch, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['workforce-attendance', params],
    queryFn: () => workforceApi.getAttendanceRecords(params),
  });

  const createMutation = useMutation({
    mutationFn: workforceApi.createAttendanceRecord,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-attendance'] });
      messageApi.success('Đã thêm chấm công');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<AttendanceRecordPayload> }) =>
      workforceApi.updateAttendanceRecord(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-attendance'] });
      messageApi.success('Đã cập nhật chấm công');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: workforceApi.deleteAttendanceRecord,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-attendance'] });
      messageApi.success('Đã xóa chấm công');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const employees = (employeesQuery.data?.results ?? []).filter(
    (item) => item.is_active && item.status !== 'RESIGNED',
  );
  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;

  const summary = useMemo(() => {
    const totalStandardDays = rows.reduce((acc, item) => acc + toNumber(item.standard_days), 0);
    const totalActualDays = rows.reduce((acc, item) => acc + toNumber(item.actual_days), 0);
    const totalPaidLeave = rows.reduce((acc, item) => acc + toNumber(item.paid_leave), 0);
    const totalUnpaidLeave = rows.reduce((acc, item) => acc + toNumber(item.unpaid_leave), 0);
    const totalOvertimeHours = rows.reduce((acc, item) => acc + toNumber(item.total_overtime_hours), 0);
    const employeesWithOvertime = rows.filter((item) => toNumber(item.total_overtime_hours) > 0).length;
    return {
      totalStandardDays,
      totalActualDays,
      totalPaidLeave,
      totalUnpaidLeave,
      totalOvertimeHours,
      employeesWithOvertime,
    };
  }, [rows]);

  const activeFilterTags = useMemo(() => {
    const tags = [`Tháng công: ${intentFilters.month || currentMonth}`];
    if (intentSearch.trim()) tags.push(`Từ khóa: ${intentSearch.trim()}`);
    return tags;
  }, [intentFilters.month, intentSearch]);

  const namedPresets = useMemo(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) return [] as AttendanceNamedPreset[];
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
      .filter((value): value is AttendanceNamedPreset => value !== null);
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
    });
  }, [configRecord.month, configRecord.saved_view_snapshot, configRecord.search]);

  const commandContextTags = useMemo(() => {
    if (!selectedPreset) return activeFilterTags;
    return [...activeFilterTags, `Mẫu đang dùng: ${selectedPreset.name}`];
  }, [activeFilterTags, selectedPreset]);

  const buildCurrentSnapshot = (): AttendanceViewSnapshot => ({
    search: searchInput,
    month: filters.month || currentMonth,
  });

  const applySnapshot = (snapshot: AttendanceViewSnapshot) => {
    setSearchInput(snapshot.search);
    setFilters({ month: snapshot.month || currentMonth });
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
      messageApi.success('Đã lưu chế độ xem chấm công.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem chấm công.');
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
    const nextPreset: AttendanceNamedPreset = existing
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
    if (summary.totalUnpaidLeave > 0) {
      return {
        type: 'warning' as const,
        message: `Có ${summary.totalUnpaidLeave.toFixed(1)} ngày nghỉ không phép trong tập dữ liệu hiện tại.`,
        description: 'Nên kiểm tra các bản ghi chấm công trước khi khóa bảng lương để tránh lệch công và phát sinh tranh soát cuối kỳ.',
      };
    }
    if (summary.employeesWithOvertime > 0) {
      return {
        type: 'info' as const,
        message: `${summary.employeesWithOvertime} nhân sự đang có tăng ca trong tháng này.`,
        description: `Tổng giờ tăng ca hiện tại là ${summary.totalOvertimeHours.toFixed(1)} giờ. Bạn có thể rà soát chi tiết ngay trong từng bản ghi.`,
      };
    }
    return {
      type: 'success' as const,
      message: 'Dữ liệu chấm công đang ở trạng thái gọn và ổn định.',
      description: 'Chưa có tín hiệu nghỉ không phép hoặc tăng ca nổi bật trên bộ lọc hiện tại.',
    };
  }, [summary.employeesWithOvertime, summary.totalOvertimeHours, summary.totalUnpaidLeave]);

  const columns: ColumnsType<AttendanceRecord> = [
    { title: 'Tháng', dataIndex: 'month', width: 100 },
    { title: 'Mã NV', dataIndex: 'employee_code', width: 120 },
    { title: 'Tên NV', dataIndex: 'employee_name', width: 220 },
    { title: 'Công chuẩn', dataIndex: 'standard_days', width: 100, align: 'center' },
    { title: 'Công thực tế', dataIndex: 'actual_days', width: 110, align: 'center' },
    { title: 'Nghỉ phép', dataIndex: 'paid_leave', width: 90, align: 'center' },
    { title: 'Nghỉ KP', dataIndex: 'unpaid_leave', width: 90, align: 'center' },
    {
      title: 'Tăng ca',
      dataIndex: 'total_overtime_hours',
      width: 110,
      align: 'center',
      render: (value: string) => {
        const hours = toNumber(value);
        return <span style={{ color: hours > 0 ? '#1677ff' : undefined, fontWeight: hours > 0 ? 600 : undefined }}>{hours} h</span>;
      },
    },
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
                    standard_days: toNumber(row.standard_days),
                    actual_days: toNumber(row.actual_days),
                    paid_leave: toNumber(row.paid_leave),
                    unpaid_leave: toNumber(row.unpaid_leave),
                    note: row.note || '',
                    is_active: row.is_active,
                    overtime_items: (row.overtime_items || []).map((item) => ({
                      overtime_date: item.overtime_date,
                      day_type: item.day_type,
                      shift: item.shift,
                      hours: toNumber(item.hours),
                      rate: toNumber(item.rate),
                      note: item.note || '',
                    })),
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
                    title: `Xóa chấm công ${row.employee_code} tháng ${row.month}?`,
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

  const toPayload = (values: AttendanceForm): AttendanceRecordPayload => ({
    employee: values.employee,
    month: values.month,
    standard_days: values.standard_days,
    actual_days: values.actual_days,
    paid_leave: values.paid_leave,
    unpaid_leave: values.unpaid_leave,
    note: values.note || '',
    is_active: values.is_active,
    overtime_items: (values.overtime_items || []).map((item) => ({
      overtime_date: item.overtime_date,
      day_type: item.day_type,
      shift: item.shift,
      hours: toNumber(item.hours),
      rate: toNumber(item.rate),
      note: item.note || '',
    })),
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
                <Tag color="gold">Chấm công</Tag>
                <Tag color={canManage ? 'processing' : 'default'}>{canManage ? 'Theo dõi dữ liệu sống' : 'Theo quyền hiện tại'}</Tag>
              </Space>
              <Title level={3} style={{ margin: '8px 0 4px' }}>Trung tâm chấm công</Title>
              <Text type="secondary">Theo dõi công chuẩn, công thực tế, nghỉ phép và tăng ca theo tháng trước khi khóa lương.</Text>
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
              Thêm chấm công
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
              <Statistic title="Nhân sự trên trang" value={rows.length} suffix="người" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tổng công thực tế" value={summary.totalActualDays} precision={1} suffix="ngày" />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Tổng tăng ca" value={summary.totalOvertimeHours} precision={1} suffix="giờ" valueStyle={{ color: summary.totalOvertimeHours > 0 ? '#1677ff' : undefined }} />
            </div>
            <div style={SUMMARY_TILE_STYLE}>
              <Statistic title="Nghỉ không phép" value={summary.totalUnpaidLeave} precision={1} suffix="ngày" valueStyle={{ color: summary.totalUnpaidLeave > 0 ? '#cf1322' : '#389e0d' }} />
            </div>
          </div>
        </Space>
      </Card>

      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div data-testid="attendance-search" style={{ display: 'inline-block' }}>
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
            <div data-testid="attendance-month-filter" style={{ display: 'inline-block' }}>
              <Input
                type="month"
                value={filters.month}
                onChange={(e) => {
                  setFilters({ month: e.target.value || currentMonth });
                  setPage(1);
                }}
                style={{ width: 180 }}
              />
            </div>
            <Button
              onClick={() => {
                setSearchInput('');
                setFilters({ month: currentMonth });
                setPage(1);
                setSelectedPresetId(undefined);
              }}
            >
              Xóa bộ lọc
            </Button>
          </div>
          <div
            data-testid="attendance-command-strip"
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Button data-testid="attendance-save-view" onClick={() => void saveCurrentView()} disabled={isPreferencesLoading}>
              Lưu chế độ xem
            </Button>
            <Button data-testid="attendance-restore-view" onClick={applySavedView} disabled={isPreferencesLoading}>
              Áp dụng chế độ đã lưu
            </Button>
            <Button
              data-testid="attendance-open-preset-modal"
              onClick={() => {
                setPresetName(selectedPreset?.name ?? '');
                setIsPresetModalOpen(true);
              }}
              disabled={isPreferencesLoading}
            >
              Lưu mẫu mới
            </Button>
            <div data-testid="attendance-preset-select" style={{ display: 'inline-block' }}>
              <Select<string>
                allowClear
                placeholder="Chọn mẫu chấm công"
                value={selectedPresetId}
                onChange={(value) => setSelectedPresetId(value)}
                disabled={isPreferencesLoading}
                style={{ width: 220 }}
                options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
              />
            </div>
            <Button data-testid="attendance-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
              Áp dụng mẫu lọc
            </Button>
            <Button danger data-testid="attendance-delete-preset" onClick={() => void deleteNamedPreset()} disabled={isPreferencesLoading}>
              Xóa mẫu lọc
            </Button>
            {savedViewSnapshot ? <Tag color="default">Có chế độ xem đã lưu</Tag> : null}
          </div>
          <Space wrap>
            {commandContextTags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
            <Tag color="success">{`Nghỉ phép: ${summary.totalPaidLeave.toFixed(1)} ngày`}</Tag>
            <Tag color="processing">{`Công chuẩn: ${summary.totalStandardDays.toFixed(1)} ngày`}</Tag>
          </Space>
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1200 }}
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
        title="Lưu mẫu lọc chấm công"
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
          data-testid="attendance-preset-name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Ví dụ: Chấm công tháng này / Theo dõi tăng ca / Chốt cuối tháng"
          maxLength={80}
          autoFocus
        />
      </Modal>

      <Modal
        title={editing ? 'Sửa chấm công' : 'Thêm chấm công'}
        open={openModal}
        onCancel={() => setOpenModal(false)}
        onOk={submitForm}
        width={980}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="month" label="Tháng" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input type="month" />
            </Form.Item>
            <Form.Item name="employee" label="Nhân viên" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Select
                options={employees.map((item: Employee) => ({
                  value: item.id,
                  label: `${item.code} - ${item.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="standard_days" label="Ngày công chuẩn">
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="actual_days" label="Ngày công thực tế">
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="paid_leave" label="Nghỉ phép">
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="unpaid_leave" label="Nghỉ không phép">
              <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="overtime_items" label="Tăng ca">
            <Form.List name="overtime_items">
              {(fields, { add, remove }) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Button
                    onClick={() =>
                      add({
                        overtime_date: defaultOvertimeDate,
                        day_type: 'WEEKDAY',
                        shift: 'EVENING',
                        hours: 1,
                        rate: 1.5,
                        note: '',
                      })
                    }
                  >
                    + Thêm tăng ca
                  </Button>
                  {fields.map((field) => (
                    <div
                      key={field.key}
                      style={{
                        border: '1px solid #f0f0f0',
                        borderRadius: 8,
                        padding: 8,
                        display: 'grid',
                        gridTemplateColumns: '180px 160px 140px 100px 100px 1fr auto',
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      <Form.Item name={[field.name, 'overtime_date']} style={{ margin: 0 }} rules={[{ required: true }]}>
                        <Input type="date" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'day_type']} style={{ margin: 0 }} rules={[{ required: true }]}>
                        <Select options={OVERTIME_DAY_OPTIONS} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'shift']} style={{ margin: 0 }} rules={[{ required: true }]}>
                        <Select options={OVERTIME_SHIFT_OPTIONS} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'hours']} style={{ margin: 0 }} rules={[{ required: true }]}>
                        <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'rate']} style={{ margin: 0 }} rules={[{ required: true }]}>
                        <InputNumber min={1} step={0.1} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'note']} style={{ margin: 0 }}>
                        <Input placeholder="Ghi chú tăng ca" />
                      </Form.Item>
                      <Button danger onClick={() => remove(field.name)}>
                        Xóa
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Form.List>
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
