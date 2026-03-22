import { useMemo, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusOutlined } from '@ant-design/icons';
import { workforceApi } from '../../api/workforce';
import type { Employee, EmployeePayload, EmployeeProfileHistory, EmployeeProfileHistoryPayload, EmployeeStatus } from '../../types/workforce';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { PAGES } from '../../utils/constants';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { canManageWorkforceData } from '../../utils/authz';
import { getToastMessage } from '../../shared/apiError';

type EmployeeFilters = {
  status: '' | EmployeeStatus;
};

type EmployeeViewSnapshot = {
  search: string;
  status: '' | EmployeeStatus;
};

type EmployeeNamedPreset = {
  id: string;
  name: string;
  filters: EmployeeViewSnapshot;
};

const DEFAULT_FILTERS: EmployeeFilters = {
  status: '',
};

const STATUS_OPTIONS: Array<{ value: EmployeeStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Đang làm' },
  { value: 'ON_LEAVE', label: 'Tạm nghỉ' },
  { value: 'RESIGNED', label: 'Nghỉ việc' },
];

function serializeFilters(filters: EmployeeFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): EmployeeFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<EmployeeFilters>;
    return {
      status: parsed.status === 'ACTIVE' || parsed.status === 'ON_LEAVE' || parsed.status === 'RESIGNED' ? parsed.status : '',
    };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

function parseViewSnapshot(value: unknown): EmployeeViewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  return {
    search: typeof obj.search === 'string' ? obj.search : '',
    status:
      obj.status === 'ACTIVE' || obj.status === 'ON_LEAVE' || obj.status === 'RESIGNED'
        ? obj.status
        : '',
  };
}

const emptyPayload: EmployeePayload = {
  code: '',
  name: '',
  cccd: '',
  birth_date: null,
  gender: '',
  address: '',
  phone: '',
  email: '',
  department: '',
  position: '',
  start_date: null,
  status: 'ACTIVE',
  salary_basic: 0,
  bank_account_number: '',
  bank_name: '',
  bank_branch: '',
  note: '',
  is_active: true,
};

type EmployeeHistoryForm = EmployeeProfileHistoryPayload;

const emptyHistoryPayload: EmployeeHistoryForm = {
  employee: 0,
  effective_month: '',
  salary_basic: 0,
  department: '',
  position: '',
  status: 'ACTIVE',
  note: '',
};

export default function EmployeeList() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<EmployeeFilters>(DEFAULT_FILTERS);
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm<EmployeePayload>();
  const [historyModal, setHistoryModal] = useState<{ open: boolean; employee: Employee | null }>({ open: false, employee: null });
  const [historyEditing, setHistoryEditing] = useState<EmployeeProfileHistory | null>(null);
  const [historyForm] = Form.useForm<EmployeeHistoryForm>();
  const {
    config,
    saveConfig,
    isLoading: isPreferencesLoading,
  } = useUserPreferences(PAGES.WORKFORCE_EMPLOYEES);
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

  const params = useMemo(() => {
    const p: Record<string, unknown> = {
      page,
      page_size: pageSize,
      ordering: 'code',
    };
    if (intentSearch.trim()) p.q = intentSearch.trim();
    if (intentFilters.status) p.status = intentFilters.status;
    return p;
  }, [intentSearch, intentFilters, page, pageSize]);

  const listQuery = useQuery({
    queryKey: ['workforce-employees', params],
    queryFn: () => workforceApi.getEmployees(params),
  });
  const historyQuery = useQuery({
    queryKey: ['workforce-employee-profile-histories', historyModal.employee?.id],
    queryFn: () =>
      workforceApi.getEmployeeProfileHistories({
        employee: historyModal.employee?.id,
        page: 1,
        page_size: 200,
        ordering: '-effective_month',
      }),
    enabled: historyModal.open && historyModal.employee !== null,
  });

  const createMutation = useMutation({
    mutationFn: workforceApi.createEmployee,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-employees'] });
      messageApi.success('Đã thêm nhân viên');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<EmployeePayload> }) =>
      workforceApi.updateEmployee(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-employees'] });
      messageApi.success('Đã cập nhật nhân viên');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: workforceApi.deleteEmployee,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-employees'] });
      messageApi.success('Đã xóa nhân viên');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const createHistoryMutation = useMutation({
    mutationFn: workforceApi.createEmployeeProfileHistory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-employee-profile-histories'] });
      await queryClient.invalidateQueries({ queryKey: ['workforce-employees'] });
      messageApi.success('Đã thêm mốc hiệu lực');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateHistoryMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<EmployeeProfileHistoryPayload> }) =>
      workforceApi.updateEmployeeProfileHistory(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-employee-profile-histories'] });
      await queryClient.invalidateQueries({ queryKey: ['workforce-employees'] });
      messageApi.success('Đã cập nhật mốc hiệu lực');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const deleteHistoryMutation = useMutation({
    mutationFn: workforceApi.deleteEmployeeProfileHistory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['workforce-employee-profile-histories'] });
      await queryClient.invalidateQueries({ queryKey: ['workforce-employees'] });
      messageApi.success('Đã xóa mốc hiệu lực');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const rows = listQuery.data?.results ?? [];
  const total = listQuery.data?.count ?? 0;
  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (intentSearch.trim()) {
      tags.push(`Tìm kiếm: ${intentSearch.trim()}`);
    }
    if (filters.status) {
      tags.push(`Trạng thái: ${STATUS_OPTIONS.find((item) => item.value === filters.status)?.label ?? filters.status}`);
    }
    return tags;
  }, [filters.status, intentSearch]);
  const namedPresets = useMemo<EmployeeNamedPreset[]>(() => {
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
      search: configRecord.search,
      status: configRecord.status,
    });
  }, [configRecord.saved_view_snapshot, configRecord.search, configRecord.status]);
  const commandContextTags = useMemo(() => {
    if (!selectedPreset) return activeFilterTags;
    return [...activeFilterTags, `Mẫu đang dùng: ${selectedPreset.name}`];
  }, [activeFilterTags, selectedPreset]);

  const buildCurrentSnapshot = (): EmployeeViewSnapshot => ({
    search: searchInput,
    status: filters.status,
  });

  const applySnapshot = (snapshot: EmployeeViewSnapshot) => {
    setSearchInput(snapshot.search);
    setFilters({ status: snapshot.status });
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
      messageApi.success('Đã lưu chế độ xem nhân sự.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem nhân sự.');
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
    const nextPreset: EmployeeNamedPreset = existing
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

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ ...emptyPayload });
    setIsModalOpen(true);
  };

  const openEdit = (row: Employee) => {
    setEditing(row);
    form.setFieldsValue({
      ...emptyPayload,
      ...row,
      salary_basic: Number(row.salary_basic ?? 0),
    });
    setIsModalOpen(true);
  };

  const openHistoryModal = (row: Employee) => {
    setHistoryEditing(null);
    historyForm.setFieldsValue({
      ...emptyHistoryPayload,
      employee: row.id,
      effective_month: row.profile_effective_month || row.start_date?.slice(0, 7) || '',
      salary_basic: Number(row.salary_basic ?? 0),
      department: row.department,
      position: row.position,
      status: row.status,
      note: '',
    });
    setHistoryModal({ open: true, employee: row });
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload: EmployeePayload = {
      ...values,
      code: values.code.trim().toUpperCase(),
      name: values.name.trim(),
    };
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    setIsModalOpen(false);
  };

  const submitHistory = async () => {
    if (!historyModal.employee) return;
    const values = await historyForm.validateFields();
    const payload: EmployeeProfileHistoryPayload = {
      employee: historyModal.employee.id,
      effective_month: values.effective_month,
      salary_basic: Number(values.salary_basic || 0),
      department: values.department || '',
      position: values.position || '',
      status: values.status,
      note: values.note || '',
    };
    if (historyEditing) {
      await updateHistoryMutation.mutateAsync({ id: historyEditing.id, payload });
    } else {
      await createHistoryMutation.mutateAsync(payload);
    }
    setHistoryEditing(null);
    historyForm.setFieldsValue({
      ...payload,
      employee: historyModal.employee.id,
      effective_month: '',
      note: '',
    });
  };

  const columns: ColumnsType<Employee> = [
    { title: 'Mã NV', dataIndex: 'code', width: 120 },
    { title: 'Họ tên', dataIndex: 'name', width: 220 },
    { title: 'Điện thoại', dataIndex: 'phone', width: 140 },
    { title: 'Phòng ban', dataIndex: 'department', width: 160 },
    { title: 'Chức vụ', dataIndex: 'position', width: 160 },
    {
      title: 'Lương cơ bản',
      dataIndex: 'salary_basic',
      width: 150,
      align: 'right',
      render: (value: string) => `${Number(value || 0).toLocaleString('vi-VN')} đ`,
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 120,
      render: (status: EmployeeStatus) => STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status,
    },
    {
      title: 'Kích hoạt',
      dataIndex: 'is_active',
      width: 90,
      render: (active: boolean) => (active ? 'Có' : 'Không'),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 250,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          {canManage && (
            <>
              <Button size="small" onClick={() => openHistoryModal(row)}>
                Hiệu lực
              </Button>
              <Button size="small" onClick={() => openEdit(row)}>
                Sửa
              </Button>
              <Button
                size="small"
                danger
                onClick={() =>
                  Modal.confirm({
                    title: `Xóa nhân viên ${row.code}?`,
                    content: 'Hành động này không thể hoàn tác.',
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Nhân viên</h2>
          <div style={{ color: '#8c8c8c' }}>Danh mục nhân sự nền tảng</div>
        </div>
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!canManage}>
            Thêm nhân viên
          </Button>
          {selectedPreset ? (
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>
              Mẫu đang dùng: {selectedPreset.name}
            </Tag>
          ) : null}
        </Space>
      </div>

      <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div data-testid="employees-search" style={{ display: 'inline-block' }}>
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
        <div data-testid="employees-status-filter" style={{ display: 'inline-block' }}>
          <Select
            value={filters.status || undefined}
            onChange={(value) => {
              setFilters((prev) => ({ ...prev, status: (value ?? '') as EmployeeStatus | '' }));
              setPage(1);
            }}
            placeholder="Trạng thái"
            style={{ width: 180 }}
            options={STATUS_OPTIONS}
          />
        </div>
        <Button
          onClick={() => {
            setSearchInput('');
            setFilters(DEFAULT_FILTERS);
            setPage(1);
            setSelectedPresetId(undefined);
          }}
        >
          Xóa bộ lọc
        </Button>
      </div>
      <div
        data-testid="employees-command-strip"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <Button data-testid="employees-save-view" onClick={() => void saveCurrentView()} disabled={isPreferencesLoading}>
          Lưu chế độ xem
        </Button>
        <Button data-testid="employees-restore-view" onClick={applySavedView} disabled={isPreferencesLoading}>
          Áp dụng chế độ đã lưu
        </Button>
        <Button
          data-testid="employees-open-preset-modal"
          onClick={() => {
            setPresetName(selectedPreset?.name ?? '');
            setIsPresetModalOpen(true);
          }}
          disabled={isPreferencesLoading}
        >
          Lưu mẫu mới
        </Button>
        <div data-testid="employees-preset-select" style={{ display: 'inline-block' }}>
          <Select<string>
            allowClear
            placeholder="Chọn mẫu nhân sự"
            value={selectedPresetId}
            onChange={(value) => setSelectedPresetId(value)}
            disabled={isPreferencesLoading}
            style={{ width: 220 }}
            options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
          />
        </div>
        <Button data-testid="employees-apply-preset" onClick={applyNamedPreset} disabled={isPreferencesLoading}>
          Áp dụng mẫu lọc
        </Button>
        <Button danger data-testid="employees-delete-preset" onClick={() => void deleteNamedPreset()} disabled={isPreferencesLoading}>
          Xóa mẫu lọc
        </Button>
        {savedViewSnapshot ? <Tag color="default">Có chế độ xem đã lưu</Tag> : null}
      </div>
      <Space wrap>
        {commandContextTags.length > 0 ? (
          commandContextTags.map((tag) => <Tag key={tag}>{tag}</Tag>)
        ) : (
          <Tag color="default">Đang xem toàn bộ nhân sự</Tag>
        )}
      </Space>

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
              await saveConfig({
                ...(config as Record<string, unknown>),
                pageSize: nextPageSize,
              });
            }
          },
        }}
      />

      <Modal
        title="Lưu mẫu lọc nhân sự"
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
          data-testid="employees-preset-name"
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          placeholder="Ví dụ: Nhân sự đang làm / Theo dõi nghỉ việc"
          maxLength={80}
          autoFocus
        />
      </Modal>

      <Modal
        title={editing ? `Sửa nhân viên ${editing.code}` : 'Thêm nhân viên'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={920}
      >
        <Form layout="vertical" form={form}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item name="code" label="Mã NV" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="name" label="Họ tên" rules={[{ required: true, message: 'Bắt buộc' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="phone" label="Điện thoại">
              <Input />
            </Form.Item>
            <Form.Item name="department" label="Phòng ban">
              <Input />
            </Form.Item>
            <Form.Item name="position" label="Chức vụ">
              <Input />
            </Form.Item>
            <Form.Item name="status" label="Trạng thái">
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
            <Form.Item name="salary_basic" label="Lương cơ bản">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="bank_name" label="Ngân hàng">
              <Input />
            </Form.Item>
            <Form.Item name="bank_account_number" label="Số tài khoản">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="is_active" label="Kích hoạt" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={historyModal.employee ? `Lịch sử hiệu lực - ${historyModal.employee.code}` : 'Lịch sử hiệu lực'}
        open={historyModal.open}
        onCancel={() => {
          setHistoryModal({ open: false, employee: null });
          setHistoryEditing(null);
          historyForm.resetFields();
        }}
        footer={null}
        width={1000}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ color: '#8c8c8c' }}>
            Mỗi mốc hiệu lực áp dụng từ đầu tháng đã chọn. Payroll sẽ lấy mốc gần nhất nhỏ hơn hoặc bằng tháng đang tính.
          </div>
          <Form form={historyForm} layout="vertical">
            <div style={{ display: 'grid', gridTemplateColumns: '180px repeat(4, minmax(0, 1fr))', gap: 12 }}>
              <Form.Item name="effective_month" label="Tháng hiệu lực" rules={[{ required: true, message: 'Bắt buộc' }]}>
                <Input type="month" />
              </Form.Item>
              <Form.Item name="salary_basic" label="Lương cơ bản" rules={[{ required: true, message: 'Bắt buộc' }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="department" label="Phòng ban">
                <Input />
              </Form.Item>
              <Form.Item name="position" label="Chức vụ">
                <Input />
              </Form.Item>
              <Form.Item name="status" label="Trạng thái">
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </div>
            <Form.Item name="note" label="Ghi chú">
              <Input />
            </Form.Item>
            <Space>
              <Button type="primary" onClick={submitHistory} loading={createHistoryMutation.isPending || updateHistoryMutation.isPending}>
                {historyEditing ? 'Cập nhật mốc' : 'Thêm mốc'}
              </Button>
              {historyEditing ? (
                <Button
                  onClick={() => {
                    setHistoryEditing(null);
                    historyForm.setFieldsValue({
                      ...emptyHistoryPayload,
                      employee: historyModal.employee?.id ?? 0,
                      salary_basic: Number(historyModal.employee?.salary_basic ?? 0),
                      department: historyModal.employee?.department ?? '',
                      position: historyModal.employee?.position ?? '',
                      status: historyModal.employee?.status ?? 'ACTIVE',
                    });
                  }}
                >
                  Hủy sửa
                </Button>
              ) : null}
            </Space>
          </Form>
          <Table
            rowKey="id"
            loading={historyQuery.isLoading}
            dataSource={historyQuery.data?.results ?? []}
            pagination={false}
            size="small"
            scroll={{ x: 900 }}
            columns={[
              { title: 'Tháng hiệu lực', dataIndex: 'effective_month', width: 130 },
              {
                title: 'Lương cơ bản',
                dataIndex: 'salary_basic',
                width: 160,
                align: 'right',
                render: (value: string) => `${Number(value || 0).toLocaleString('vi-VN')} đ`,
              },
              { title: 'Phòng ban', dataIndex: 'department', width: 160 },
              { title: 'Chức vụ', dataIndex: 'position', width: 160 },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                width: 120,
                render: (status: EmployeeStatus) => STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status,
              },
              { title: 'Ghi chú', dataIndex: 'note' },
              {
                title: 'Thao tác',
                key: 'actions',
                width: 150,
                fixed: 'right',
                render: (_, row: EmployeeProfileHistory) => (
                  <Space>
                    <Button
                      size="small"
                      onClick={() => {
                        setHistoryEditing(row);
                        historyForm.setFieldsValue({
                          employee: row.employee,
                          effective_month: row.effective_month,
                          salary_basic: Number(row.salary_basic || 0),
                          department: row.department,
                          position: row.position,
                          status: row.status,
                          note: row.note,
                        });
                      }}
                    >
                      Sửa
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() =>
                        Modal.confirm({
                          title: `Xóa mốc hiệu lực ${row.effective_month}?`,
                          okText: 'Xóa',
                          cancelText: 'Hủy',
                          onOk: () => deleteHistoryMutation.mutateAsync(row.id),
                        })
                      }
                    >
                      Xóa
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Modal>
    </div>
  );
}

