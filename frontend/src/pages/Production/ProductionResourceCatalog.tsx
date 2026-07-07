import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
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
import {
  ClusterOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productionApi } from '../../api/production';
import type {
  ProductionMachine,
  ProductionMachinePayload,
  ProductionWorkCenter,
  ProductionWorkCenterPayload,
} from '../../types/production';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { getToastMessage } from '../../shared/apiError';
import { canManageProductionData } from '../../utils/authz';

type ResourceFilters = {
  activeOnly: boolean;
  workCenterCode: string;
};

type WorkCenterFormValues = {
  code: string;
  name: string;
  default_capacity_hours: number;
  description?: string;
  sort_order: number;
  is_active: boolean;
};

type MachineFormValues = WorkCenterFormValues & {
  work_center: number;
};

const PAGE_SIZE = 20;
const DEFAULT_CAPACITY_HOURS = 8;

const emptyFilters: ResourceFilters = {
  activeOnly: true,
  workCenterCode: '',
};

const emptyWorkCenterForm: WorkCenterFormValues = {
  code: '',
  name: '',
  default_capacity_hours: DEFAULT_CAPACITY_HOURS,
  description: '',
  sort_order: 0,
  is_active: true,
};

const emptyMachineForm: MachineFormValues = {
  ...emptyWorkCenterForm,
  work_center: 0,
};

function serializeFilters(filters: ResourceFilters): string {
  return JSON.stringify(filters);
}

function parseFilters(raw: string): ResourceFilters {
  try {
    const parsed = JSON.parse(raw) as Partial<ResourceFilters>;
    return {
      activeOnly: parsed.activeOnly !== false,
      workCenterCode: typeof parsed.workCenterCode === 'string' ? parsed.workCenterCode : '',
    };
  } catch {
    return emptyFilters;
  }
}

function formatCapacity(value: string | number | null | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return `${numeric.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} giờ/ca`;
}

function renderStatus(isActive: boolean) {
  return isActive ? <Tag color="green">Đang dùng</Tag> : <Tag>Ngưng dùng</Tag>;
}

function buildWorkCenterLabel(item: ProductionWorkCenter): string {
  return `${item.code} - ${item.name}`;
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeName(value: string): string {
  return value.trim();
}

function normalizeDescription(value: string | undefined): string {
  return value?.trim() ?? '';
}

function normalizeCapacity(value: number | null | undefined): string {
  const numeric = Number(value ?? DEFAULT_CAPACITY_HOURS);
  if (!Number.isFinite(numeric) || numeric < 0) return String(DEFAULT_CAPACITY_HOURS);
  return numeric.toFixed(2);
}

function normalizeSortOrder(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.trunc(numeric);
}

function toWorkCenterForm(row: ProductionWorkCenter): WorkCenterFormValues {
  return {
    code: row.code,
    name: row.name,
    default_capacity_hours: Number(row.default_capacity_hours || DEFAULT_CAPACITY_HOURS),
    description: row.description ?? '',
    sort_order: row.sort_order ?? 0,
    is_active: row.is_active,
  };
}

function toMachineForm(row: ProductionMachine): MachineFormValues {
  return {
    code: row.code,
    name: row.name,
    work_center: row.work_center,
    default_capacity_hours: Number(row.default_capacity_hours || DEFAULT_CAPACITY_HOURS),
    description: row.description ?? '',
    sort_order: row.sort_order ?? 0,
    is_active: row.is_active,
  };
}

function buildWorkCenterPayload(values: WorkCenterFormValues): ProductionWorkCenterPayload {
  return {
    code: normalizeCode(values.code),
    name: normalizeName(values.name),
    default_capacity_hours: normalizeCapacity(values.default_capacity_hours),
    description: normalizeDescription(values.description),
    sort_order: normalizeSortOrder(values.sort_order),
    is_active: values.is_active,
  };
}

function buildMachinePayload(values: MachineFormValues): ProductionMachinePayload {
  return {
    ...buildWorkCenterPayload(values),
    work_center: values.work_center,
  };
}

export default function ProductionResourceCatalog() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<ResourceFilters>(emptyFilters);
  const [workCenterPage, setWorkCenterPage] = useState(1);
  const [machinePage, setMachinePage] = useState(1);
  const [workCenterModalOpen, setWorkCenterModalOpen] = useState(false);
  const [machineModalOpen, setMachineModalOpen] = useState(false);
  const [editingWorkCenter, setEditingWorkCenter] = useState<ProductionWorkCenter | null>(null);
  const [editingMachine, setEditingMachine] = useState<ProductionMachine | null>(null);
  const [workCenterForm] = Form.useForm<WorkCenterFormValues>();
  const [machineForm] = Form.useForm<MachineFormValues>();
  const canManageProduction = canManageProductionData();

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 500,
    filterDebounceMs: 250,
    serializeFilters,
    parseFilters,
  });

  const invalidateResources = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['production-work-centers'] }),
      queryClient.invalidateQueries({ queryKey: ['production-machines'] }),
      queryClient.invalidateQueries({ queryKey: ['production-capacity-options'] }),
      queryClient.invalidateQueries({ queryKey: ['production-planning-board'] }),
    ]);
  };

  const commonSearch = intentSearch.trim();
  const workCenterParams = useMemo(() => {
    const next: Record<string, unknown> = {
      page: workCenterPage,
      page_size: PAGE_SIZE,
      ordering: 'sort_order,name,code',
    };
    if (commonSearch) next.q = commonSearch;
    if (intentFilters.activeOnly) next.is_active = 'true';
    return next;
  }, [commonSearch, intentFilters.activeOnly, workCenterPage]);

  const machineParams = useMemo(() => {
    const next: Record<string, unknown> = {
      page: machinePage,
      page_size: PAGE_SIZE,
      ordering: 'work_center,sort_order,name,code',
    };
    if (commonSearch) next.q = commonSearch;
    if (intentFilters.activeOnly) next.is_active = 'true';
    if (intentFilters.workCenterCode) next.work_center_code = intentFilters.workCenterCode;
    return next;
  }, [commonSearch, intentFilters.activeOnly, intentFilters.workCenterCode, machinePage]);

  const workCenterOptionsQuery = useQuery({
    queryKey: ['production-work-centers', 'options'],
    queryFn: () => productionApi.getProductionWorkCenters({ page_size: 500, ordering: 'sort_order,name,code' }),
    staleTime: 60_000,
  });
  const workCenterQuery = useQuery({
    queryKey: ['production-work-centers', workCenterParams],
    queryFn: () => productionApi.getProductionWorkCenters(workCenterParams),
  });
  const machineQuery = useQuery({
    queryKey: ['production-machines', machineParams],
    queryFn: () => productionApi.getProductionMachines(machineParams),
  });

  const createWorkCenterMutation = useMutation({
    mutationFn: productionApi.createProductionWorkCenter,
    onSuccess: async () => {
      await invalidateResources();
      messageApi.success('Đã thêm tổ sản xuất');
      setWorkCenterModalOpen(false);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateWorkCenterMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ProductionWorkCenterPayload }) =>
      productionApi.updateProductionWorkCenter(id, payload),
    onSuccess: async () => {
      await invalidateResources();
      messageApi.success('Đã cập nhật tổ sản xuất');
      setWorkCenterModalOpen(false);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateWorkCenterStatusMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      productionApi.updateProductionWorkCenter(id, { is_active }),
    onSuccess: async (_, variables) => {
      await invalidateResources();
      messageApi.success(variables.is_active ? 'Đã bật lại tổ sản xuất' : 'Đã ngưng dùng tổ sản xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const createMachineMutation = useMutation({
    mutationFn: productionApi.createProductionMachine,
    onSuccess: async () => {
      await invalidateResources();
      messageApi.success('Đã thêm máy sản xuất');
      setMachineModalOpen(false);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMachineMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ProductionMachinePayload }) =>
      productionApi.updateProductionMachine(id, payload),
    onSuccess: async () => {
      await invalidateResources();
      messageApi.success('Đã cập nhật máy sản xuất');
      setMachineModalOpen(false);
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });
  const updateMachineStatusMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      productionApi.updateProductionMachine(id, { is_active }),
    onSuccess: async (_, variables) => {
      await invalidateResources();
      messageApi.success(variables.is_active ? 'Đã bật lại máy sản xuất' : 'Đã ngưng dùng máy sản xuất');
    },
    onError: (error) => messageApi.error(getToastMessage(error)),
  });

  const workCenterRows = workCenterQuery.data?.results ?? [];
  const machineRows = machineQuery.data?.results ?? [];
  const workCenterOptions = workCenterOptionsQuery.data?.results ?? [];
  const isRefreshing = workCenterQuery.isFetching || machineQuery.isFetching || workCenterOptionsQuery.isFetching;
  const hasError = workCenterQuery.isError || machineQuery.isError;
  const isSavingWorkCenter = createWorkCenterMutation.isPending || updateWorkCenterMutation.isPending;
  const isSavingMachine = createMachineMutation.isPending || updateMachineMutation.isPending;
  const resourceReadinessAlert = useMemo(() => {
    if (hasError || workCenterQuery.isLoading || machineQuery.isLoading) {
      return null;
    }
    const workCenterCount = workCenterQuery.data?.count ?? 0;
    const machineCount = machineQuery.data?.count ?? 0;
    const hasNarrowFilter = Boolean(commonSearch || intentFilters.workCenterCode || !intentFilters.activeOnly);
    if (workCenterCount === 0) {
      return {
        type: 'warning' as const,
        message: hasNarrowFilter
          ? 'Bộ lọc hiện tại không còn tổ sản xuất phù hợp; hãy xóa lọc nếu cần chọn lại nguồn lực cho điều độ.'
          : 'Chưa có tổ sản xuất đang dùng; cần tạo tổ trước khi lập máy và điều độ công đoạn.',
      };
    }
    if (machineCount === 0) {
      return {
        type: 'warning' as const,
        message: hasNarrowFilter
          ? 'Bộ lọc hiện tại không còn máy sản xuất phù hợp; hãy kiểm tra tổ hoặc trạng thái đang dùng.'
          : 'Chưa có máy sản xuất đang dùng; planning sẽ thiếu nguồn lực máy cho công đoạn.',
      };
    }
    return {
      type: 'success' as const,
      message: 'Danh mục nguồn lực đã có tổ và máy phù hợp để phục vụ điều độ sản xuất.',
    };
  }, [
    commonSearch,
    hasError,
    intentFilters.activeOnly,
    intentFilters.workCenterCode,
    machineQuery.data?.count,
    machineQuery.isLoading,
    workCenterQuery.data?.count,
    workCenterQuery.isLoading,
  ]);

  const openCreateWorkCenter = () => {
    setEditingWorkCenter(null);
    workCenterForm.setFieldsValue(emptyWorkCenterForm);
    setWorkCenterModalOpen(true);
  };

  const openEditWorkCenter = (row: ProductionWorkCenter) => {
    setEditingWorkCenter(row);
    workCenterForm.setFieldsValue(toWorkCenterForm(row));
    setWorkCenterModalOpen(true);
  };

  const openCreateMachine = () => {
    setEditingMachine(null);
    machineForm.setFieldsValue({
      ...emptyMachineForm,
      work_center: workCenterOptions.find((item) => item.is_active)?.id ?? workCenterOptions[0]?.id ?? 0,
    });
    setMachineModalOpen(true);
  };

  const openEditMachine = (row: ProductionMachine) => {
    setEditingMachine(row);
    machineForm.setFieldsValue(toMachineForm(row));
    setMachineModalOpen(true);
  };

  const submitWorkCenter = async () => {
    const values = await workCenterForm.validateFields();
    const payload = buildWorkCenterPayload(values);
    if (editingWorkCenter) {
      await updateWorkCenterMutation.mutateAsync({ id: editingWorkCenter.id, payload });
    } else {
      await createWorkCenterMutation.mutateAsync(payload);
    }
  };

  const submitMachine = async () => {
    const values = await machineForm.validateFields();
    const payload = buildMachinePayload(values);
    if (editingMachine) {
      await updateMachineMutation.mutateAsync({ id: editingMachine.id, payload });
    } else {
      await createMachineMutation.mutateAsync(payload);
    }
  };

  const toggleWorkCenterStatus = (row: ProductionWorkCenter) => {
    const nextActive = !row.is_active;
    Modal.confirm({
      title: nextActive ? `Bật lại tổ ${row.code}?` : `Ngưng dùng tổ ${row.code}?`,
      content: nextActive
        ? 'Tổ này sẽ xuất hiện lại trong danh mục lựa chọn nếu còn phù hợp bộ lọc.'
        : 'Các máy thuộc tổ này có thể không còn hiện trong lựa chọn mới trên PlanningBoard.',
      okText: nextActive ? 'Bật lại' : 'Ngưng dùng',
      cancelText: 'Hủy',
      okButtonProps: { danger: !nextActive },
      onOk: () => updateWorkCenterStatusMutation.mutateAsync({ id: row.id, is_active: nextActive }),
    });
  };

  const toggleMachineStatus = (row: ProductionMachine) => {
    const nextActive = !row.is_active;
    Modal.confirm({
      title: nextActive ? `Bật lại máy ${row.code}?` : `Ngưng dùng máy ${row.code}?`,
      content: nextActive
        ? 'Máy này sẽ xuất hiện lại trong lựa chọn mới trên PlanningBoard.'
        : 'Máy này sẽ không còn hiện trong lựa chọn mới trên PlanningBoard.',
      okText: nextActive ? 'Bật lại' : 'Ngưng dùng',
      cancelText: 'Hủy',
      okButtonProps: { danger: !nextActive },
      onOk: () => updateMachineStatusMutation.mutateAsync({ id: row.id, is_active: nextActive }),
    });
  };

  const workCenterColumns: ColumnsType<ProductionWorkCenter> = [
    { title: 'Mã', dataIndex: 'code', width: 120, fixed: 'left' },
    { title: 'Tên', dataIndex: 'name', width: 220 },
    {
      title: 'Năng lực mặc định',
      dataIndex: 'default_capacity_hours',
      width: 160,
      render: formatCapacity,
    },
    { title: 'Thứ tự', dataIndex: 'sort_order', width: 90 },
    {
      title: 'Trạng thái',
      dataIndex: 'is_active',
      width: 120,
      render: renderStatus,
    },
    {
      title: 'Mô tả',
      dataIndex: 'description',
      width: 260,
      render: (value) => value || '-',
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        canManageProduction ? (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            data-testid={`production-work-center-edit-${row.id}`}
            onClick={() => openEditWorkCenter(row)}
          >
            Sửa
          </Button>
          <Button
            size="small"
            danger={row.is_active}
            loading={updateWorkCenterStatusMutation.isPending}
            data-testid={`production-work-center-toggle-${row.id}`}
            onClick={() => toggleWorkCenterStatus(row)}
          >
            {row.is_active ? 'Ngưng dùng' : 'Bật lại'}
          </Button>
        </Space>
        ) : null
      ),
    },
  ];

  const machineColumns: ColumnsType<ProductionMachine> = [
    { title: 'Mã', dataIndex: 'code', width: 140, fixed: 'left' },
    { title: 'Tên', dataIndex: 'name', width: 220 },
    {
      title: 'Tổ trực thuộc',
      dataIndex: 'work_center_code',
      width: 220,
      render: (_, row) => `${row.work_center_code} - ${row.work_center_name}`,
    },
    {
      title: 'Năng lực mặc định',
      dataIndex: 'default_capacity_hours',
      width: 160,
      render: formatCapacity,
    },
    { title: 'Thứ tự', dataIndex: 'sort_order', width: 90 },
    {
      title: 'Trạng thái',
      dataIndex: 'is_active',
      width: 120,
      render: renderStatus,
    },
    {
      title: 'Mô tả',
      dataIndex: 'description',
      width: 260,
      render: (value) => value || '-',
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        canManageProduction ? (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            data-testid={`production-machine-edit-${row.id}`}
            onClick={() => openEditMachine(row)}
          >
            Sửa
          </Button>
          <Button
            size="small"
            danger={row.is_active}
            loading={updateMachineStatusMutation.isPending}
            data-testid={`production-machine-toggle-${row.id}`}
            onClick={() => toggleMachineStatus(row)}
          >
            {row.is_active ? 'Ngưng dùng' : 'Bật lại'}
          </Button>
        </Space>
        ) : null
      ),
    },
  ];

  const refresh = async () => {
    await Promise.all([
      workCenterOptionsQuery.refetch(),
      workCenterQuery.refetch(),
      machineQuery.refetch(),
    ]);
  };

  return (
    <div data-testid="production-resource-catalog-page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>Danh mục máy/tổ sản xuất</Typography.Title>
          <Typography.Text type="secondary">
            Theo dõi tổ sản xuất, máy sản xuất và năng lực mặc định đang dùng cho điều độ.
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={isRefreshing} onClick={() => void refresh()}>
            Tải lại
          </Button>
          {canManageProduction ? <Button
            type="primary"
            icon={<PlusOutlined />}
            data-testid="production-resource-add-work-center"
            onClick={openCreateWorkCenter}
          >
            Thêm tổ sản xuất
          </Button> : null}
          {canManageProduction ? <Button
            icon={<PlusOutlined />}
            data-testid="production-resource-add-machine"
            onClick={openCreateMachine}
            disabled={workCenterOptions.length === 0}
          >
            Thêm máy
          </Button> : null}
        </Space>
      </div>

      <Row gutter={[12, 12]}>
        <Col xs={24} md={8}>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 14 }}>
            <Statistic title="Tổ sản xuất đang hiển thị" value={workCenterQuery.data?.count ?? 0} prefix={<ClusterOutlined />} />
          </div>
        </Col>
        <Col xs={24} md={8}>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 14 }}>
            <Statistic title="Máy sản xuất đang hiển thị" value={machineQuery.data?.count ?? 0} prefix={<ToolOutlined />} />
          </div>
        </Col>
        <Col xs={24} md={8}>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 14 }}>
            <Statistic title="Bộ lọc trạng thái" value={filters.activeOnly ? 'Đang dùng' : 'Tất cả'} />
          </div>
        </Col>
      </Row>

      <div
        style={{
          border: '1px solid #f0f0f0',
          borderRadius: 8,
          padding: 12,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <Input
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
            setWorkCenterPage(1);
            setMachinePage(1);
          }}
          placeholder="Tìm mã, tên, mô tả máy/tổ..."
          prefix={<SearchOutlined />}
          suffix={searchInput ? (
            <QuickClearIcon
              title="Xóa tìm kiếm"
              onClear={() => {
                setSearchInput('');
                setWorkCenterPage(1);
                setMachinePage(1);
              }}
            />
          ) : undefined}
          style={{ width: 320, maxWidth: '100%' }}
          data-testid="production-resource-search"
        />
        <Select
          allowClear
          showSearch
          value={filters.workCenterCode || undefined}
          placeholder="Lọc máy theo tổ"
          optionFilterProp="label"
          style={{ width: 260, maxWidth: '100%' }}
          loading={workCenterOptionsQuery.isFetching}
          data-testid="production-resource-work-center-filter"
          options={workCenterOptions.map((item) => ({
            value: item.code,
            label: buildWorkCenterLabel(item),
          }))}
          onChange={(value) => {
            setFilters((current) => ({ ...current, workCenterCode: value ?? '' }));
            setMachinePage(1);
          }}
        />
        <Space>
          <span style={{ color: '#595959' }}>Chỉ đang dùng</span>
          <Switch
            checked={filters.activeOnly}
            data-testid="production-resource-active-filter"
            onChange={(checked) => {
              setFilters((current) => ({ ...current, activeOnly: checked }));
              setWorkCenterPage(1);
              setMachinePage(1);
            }}
          />
        </Space>
      </div>

      {hasError && (
        <Alert
          showIcon
          type="error"
          message="Không thể tải danh mục máy/tổ."
          description={getToastMessage(workCenterQuery.error || machineQuery.error)}
        />
      )}
      {resourceReadinessAlert ? (
        <Alert
          showIcon
          type={resourceReadinessAlert.type}
          message={resourceReadinessAlert.message}
          data-testid="production-resource-readiness-alert"
        />
      ) : null}

      <section data-testid="production-work-center-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>Tổ sản xuất</Typography.Title>
          <Typography.Text type="secondary">Các cụm công đoạn dùng để nhóm máy và tính năng lực điều độ.</Typography.Text>
        </div>
        <Table<ProductionWorkCenter>
          rowKey="id"
          size="middle"
          columns={workCenterColumns}
          dataSource={workCenterRows}
          loading={workCenterQuery.isLoading || workCenterQuery.isFetching}
          scroll={{ x: 1180 }}
          data-testid="production-work-center-table"
          locale={{ emptyText: 'Chưa có tổ sản xuất phù hợp bộ lọc.' }}
          pagination={{
            current: workCenterPage,
            pageSize: PAGE_SIZE,
            total: workCenterQuery.data?.count ?? 0,
            showSizeChanger: false,
            onChange: (page) => setWorkCenterPage(page),
          }}
        />
      </section>

      <section data-testid="production-machine-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>Máy sản xuất</Typography.Title>
          <Typography.Text type="secondary">Máy thuộc từng tổ sản xuất và năng lực mặc định cho kế hoạch ca.</Typography.Text>
        </div>
        <Table<ProductionMachine>
          rowKey="id"
          size="middle"
          columns={machineColumns}
          dataSource={machineRows}
          loading={machineQuery.isLoading || machineQuery.isFetching}
          scroll={{ x: 1320 }}
          data-testid="production-machine-table"
          locale={{ emptyText: 'Chưa có máy sản xuất phù hợp bộ lọc.' }}
          pagination={{
            current: machinePage,
            pageSize: PAGE_SIZE,
            total: machineQuery.data?.count ?? 0,
            showSizeChanger: false,
            onChange: (page) => setMachinePage(page),
          }}
        />
      </section>

      <Modal
        title={editingWorkCenter ? 'Sửa tổ sản xuất' : 'Thêm tổ sản xuất'}
        open={workCenterModalOpen}
        onCancel={() => setWorkCenterModalOpen(false)}
        onOk={() => void submitWorkCenter()}
        okText={editingWorkCenter ? 'Cập nhật' : 'Thêm tổ'}
        cancelText="Hủy"
        confirmLoading={isSavingWorkCenter}
        destroyOnHidden
        okButtonProps={{ 'data-testid': 'production-work-center-submit' }}
      >
        <Form<WorkCenterFormValues> form={workCenterForm} layout="vertical" initialValues={emptyWorkCenterForm}>
          <Form.Item
            label="Mã tổ"
            name="code"
            rules={[{ required: true, whitespace: true, message: 'Nhập mã tổ sản xuất' }]}
          >
            <Input placeholder="Ví dụ: IN" data-testid="work-center-form-code" />
          </Form.Item>
          <Form.Item
            label="Tên tổ"
            name="name"
            rules={[{ required: true, whitespace: true, message: 'Nhập tên tổ sản xuất' }]}
          >
            <Input placeholder="Ví dụ: Tổ in" data-testid="work-center-form-name" />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item
                label="Năng lực mặc định giờ/ca"
                name="default_capacity_hours"
                rules={[{ required: true, type: 'number', min: 0, message: 'Năng lực phải lớn hơn hoặc bằng 0' }]}
              >
                <InputNumber min={0} step={0.25} style={{ width: '100%' }} data-testid="work-center-form-capacity" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                label="Thứ tự hiển thị"
                name="sort_order"
                rules={[{ required: true, type: 'number', min: 0, message: 'Thứ tự phải lớn hơn hoặc bằng 0' }]}
              >
                <InputNumber min={0} precision={0} style={{ width: '100%' }} data-testid="work-center-form-sort-order" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Mô tả" name="description">
            <Input.TextArea rows={3} placeholder="Ghi chú ngắn về tổ sản xuất" data-testid="work-center-form-description" />
          </Form.Item>
          <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
            <Switch checkedChildren="Đang dùng" unCheckedChildren="Ngưng dùng" data-testid="work-center-form-active" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingMachine ? 'Sửa máy sản xuất' : 'Thêm máy sản xuất'}
        open={machineModalOpen}
        onCancel={() => setMachineModalOpen(false)}
        onOk={() => void submitMachine()}
        okText={editingMachine ? 'Cập nhật' : 'Thêm máy'}
        cancelText="Hủy"
        confirmLoading={isSavingMachine}
        destroyOnHidden
        okButtonProps={{ 'data-testid': 'production-machine-submit' }}
      >
        <Form<MachineFormValues> form={machineForm} layout="vertical" initialValues={emptyMachineForm}>
          <Form.Item
            label="Mã máy"
            name="code"
            rules={[{ required: true, whitespace: true, message: 'Nhập mã máy sản xuất' }]}
          >
            <Input placeholder="Ví dụ: MAY_IN_01" data-testid="machine-form-code" />
          </Form.Item>
          <Form.Item
            label="Tên máy"
            name="name"
            rules={[{ required: true, whitespace: true, message: 'Nhập tên máy sản xuất' }]}
          >
            <Input placeholder="Ví dụ: Máy in 01" data-testid="machine-form-name" />
          </Form.Item>
          <Form.Item
            label="Tổ trực thuộc"
            name="work_center"
            rules={[{ required: true, message: 'Chọn tổ trực thuộc' }]}
          >
            <Select
              allowClear
              showSearch
              placeholder="Chọn tổ sản xuất"
              optionFilterProp="label"
              data-testid="machine-form-work-center"
              options={workCenterOptions.map((item) => ({
                value: item.id,
                label: `${buildWorkCenterLabel(item)}${item.is_active ? '' : ' (ngưng dùng)'}`,
              }))}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item
                label="Năng lực mặc định giờ/ca"
                name="default_capacity_hours"
                rules={[{ required: true, type: 'number', min: 0, message: 'Năng lực phải lớn hơn hoặc bằng 0' }]}
              >
                <InputNumber min={0} step={0.25} style={{ width: '100%' }} data-testid="machine-form-capacity" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                label="Thứ tự hiển thị"
                name="sort_order"
                rules={[{ required: true, type: 'number', min: 0, message: 'Thứ tự phải lớn hơn hoặc bằng 0' }]}
              >
                <InputNumber min={0} precision={0} style={{ width: '100%' }} data-testid="machine-form-sort-order" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Mô tả" name="description">
            <Input.TextArea rows={3} placeholder="Ghi chú ngắn về máy sản xuất" data-testid="machine-form-description" />
          </Form.Item>
          <Form.Item label="Trạng thái" name="is_active" valuePropName="checked">
            <Switch checkedChildren="Đang dùng" unCheckedChildren="Ngưng dùng" data-testid="machine-form-active" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
