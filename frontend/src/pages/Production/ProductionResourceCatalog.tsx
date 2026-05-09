import { useMemo, useState } from 'react';
import { Alert, Button, Col, Input, Row, Select, Space, Statistic, Switch, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ClusterOutlined, ReloadOutlined, SearchOutlined, ToolOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { productionApi } from '../../api/production';
import type { ProductionMachine, ProductionWorkCenter } from '../../types/production';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { getToastMessage } from '../../shared/apiError';

type ResourceFilters = {
  activeOnly: boolean;
  workCenterCode: string;
};

const PAGE_SIZE = 20;
const emptyFilters: ResourceFilters = {
  activeOnly: true,
  workCenterCode: '',
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

export default function ProductionResourceCatalog() {
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<ResourceFilters>(emptyFilters);
  const [workCenterPage, setWorkCenterPage] = useState(1);
  const [machinePage, setMachinePage] = useState(1);

  const { intentSearch, intentFilters } = useSearchFilterIntent({
    searchInput,
    filterValues: filters,
    searchDebounceMs: 500,
    filterDebounceMs: 250,
    serializeFilters,
    parseFilters,
  });

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

  const workCenterRows = workCenterQuery.data?.results ?? [];
  const machineRows = machineQuery.data?.results ?? [];
  const workCenterOptions = workCenterOptionsQuery.data?.results ?? [];
  const isRefreshing = workCenterQuery.isFetching || machineQuery.isFetching || workCenterOptionsQuery.isFetching;
  const hasError = workCenterQuery.isError || machineQuery.isError;

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
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>Danh mục máy/tổ sản xuất</Typography.Title>
          <Typography.Text type="secondary">
            Theo dõi tổ sản xuất, máy sản xuất và năng lực mặc định đang dùng cho điều độ.
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={isRefreshing} onClick={() => void refresh()}>
          Tải lại
        </Button>
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
        />
        <Select
          allowClear
          showSearch
          value={filters.workCenterCode || undefined}
          placeholder="Lọc máy theo tổ"
          optionFilterProp="label"
          style={{ width: 260, maxWidth: '100%' }}
          loading={workCenterOptionsQuery.isFetching}
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
          scroll={{ x: 980 }}
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
          scroll={{ x: 1120 }}
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
    </div>
  );
}
