import { useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';

import { productionApi } from '../../api/production';
import QuickClearIcon from '../../components/QuickClearIcon/QuickClearIcon';
import { useSearchFilterIntent } from '../../hooks/useSearchFilterIntent';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { getToastMessage } from '../../shared/apiError';
import type {
  ProductionDemand,
  ProductionDemandPlanningStatus,
  ProductionDemandPriority,
  ProductionDemandProductionStatus,
} from '../../types/production';
import { PAGES } from '../../utils/constants';

const { Text, Title } = Typography;

const SUMMARY_DEFAULT = {
  total: 0,
  held: 0,
  cancelled: 0,
  no_date: 0,
  overdue: 0,
  due_today: 0,
  upcoming_7_days: 0,
  not_due: 0,
  partially_planned: 0,
  fully_planned: 0,
  no_production_needed: 0,
  not_released: 0,
  in_progress: 0,
  completed: 0,
};

const PLANNING_STATUS_LABELS: Record<ProductionDemandPlanningStatus, string> = {
  NOT_DUE: 'Chưa tới hạn',
  UPCOMING: 'Sắp đến hạn',
  DUE: 'Cần lập KH',
  OVERDUE: 'Quá hạn',
  PARTIALLY_PLANNED: 'Đã lập một phần',
  FULLY_PLANNED: 'Đã lập đủ',
  NO_PRODUCTION_NEEDED: 'Không cần SX',
  CANCELLED: 'Đã hủy',
};

const PLANNING_STATUS_COLORS: Record<ProductionDemandPlanningStatus, string> = {
  NOT_DUE: 'default',
  UPCOMING: 'processing',
  DUE: 'gold',
  OVERDUE: 'error',
  PARTIALLY_PLANNED: 'cyan',
  FULLY_PLANNED: 'success',
  NO_PRODUCTION_NEEDED: 'purple',
  CANCELLED: 'magenta',
};

const PRODUCTION_STATUS_LABELS: Record<ProductionDemandProductionStatus, string> = {
  NOT_RELEASED: 'Chưa phát hành',
  PARTIALLY_RELEASED: 'Phát hành một phần',
  FULLY_RELEASED: 'Đã phát hành',
  IN_PROGRESS: 'Đang sản xuất',
  PARTIALLY_COMPLETED: 'Hoàn thành một phần',
  COMPLETED: 'Hoàn thành',
  PAUSED: 'Tạm dừng',
  CANCELLED: 'Đã hủy',
};

const PRODUCTION_STATUS_COLORS: Record<ProductionDemandProductionStatus, string> = {
  NOT_RELEASED: 'default',
  PARTIALLY_RELEASED: 'cyan',
  FULLY_RELEASED: 'blue',
  IN_PROGRESS: 'gold',
  PARTIALLY_COMPLETED: 'lime',
  COMPLETED: 'success',
  PAUSED: 'orange',
  CANCELLED: 'magenta',
};

const PRODUCT_KIND_LABELS: Record<string, string> = {
  SPECIFIC: 'Mã riêng',
  GENERIC: 'Mã chung',
};

const PRODUCT_KIND_COLORS: Record<string, string> = {
  SPECIFIC: 'blue',
  GENERIC: 'gold',
};

const PRIORITY_LABELS: Record<ProductionDemandPriority, string> = {
  LOW: 'Thấp',
  NORMAL: 'Bình thường',
  HIGH: 'Cao',
  URGENT: 'Khẩn',
};

const PRIORITY_COLORS: Record<ProductionDemandPriority, string> = {
  LOW: 'default',
  NORMAL: 'blue',
  HIGH: 'orange',
  URGENT: 'red',
};

const formatDate = (value?: string | null) => (value ? dayjs(value).format('DD/MM/YYYY') : '-');
const formatNumber = (value?: string | number | null) => Number(value || 0).toLocaleString('vi-VN');
const formatMaybeText = (value?: string | null) => {
  const normalized = String(value || '').trim();
  return normalized || '-';
};

const getDemandCode = (demand: ProductionDemand) => demand.demand_code || demand.demand_key;
const getCustomerDisplay = (demand: ProductionDemand) => (
  demand.customer_display || demand.customer_name_snapshot || '-'
);

const renderPlanningStatus = (status: ProductionDemandPlanningStatus) => (
  <Tag color={PLANNING_STATUS_COLORS[status] || 'default'}>
    {PLANNING_STATUS_LABELS[status] || status}
  </Tag>
);

const renderProductionStatus = (status: ProductionDemandProductionStatus) => (
  <Tag color={PRODUCTION_STATUS_COLORS[status] || 'default'}>
    {PRODUCTION_STATUS_LABELS[status] || status}
  </Tag>
);

const renderPriority = (priority: ProductionDemandPriority) => (
  <Tag color={PRIORITY_COLORS[priority] || 'default'}>
    {PRIORITY_LABELS[priority] || priority}
  </Tag>
);

const renderProductKind = (kind?: string) => {
  const normalized = String(kind || '').trim() || 'SPECIFIC';
  return (
    <Tag color={PRODUCT_KIND_COLORS[normalized] || 'default'}>
      {PRODUCT_KIND_LABELS[normalized] || normalized}
    </Tag>
  );
};

export default function ProductionDemandList() {
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const { config, saveConfig } = useUserPreferences(PAGES.PRODUCTION_DEMANDS);
  const configRecord = config as Record<string, unknown>;
  const pageSize = Number(configRecord?.pageSize ?? 20);

  const { intentSearch } = useSearchFilterIntent({
    searchInput,
    filterValues: {},
    searchDebounceMs: 650,
    filterDebounceMs: 300,
    serializeFilters: (value) => JSON.stringify(value),
    parseFilters: () => ({}),
  });

  const listParams = useMemo(() => ({
    search: intentSearch.trim() || undefined,
    page,
    page_size: pageSize,
    ordering: 'planning_due_date,delivery_date,id',
  }), [intentSearch, page, pageSize]);

  const summaryParams = useMemo(() => ({
    search: intentSearch.trim() || undefined,
  }), [intentSearch]);

  const listQuery = useQuery({
    queryKey: ['production-demands', listParams],
    queryFn: () => productionApi.getDemands(listParams),
  });

  const summaryQuery = useQuery({
    queryKey: ['production-demands-summary', summaryParams],
    queryFn: () => productionApi.getDemandSummary(summaryParams),
  });

  const rows = listQuery.data?.results ?? [];
  const summary = summaryQuery.data ?? SUMMARY_DEFAULT;
  const hasSearch = Boolean(intentSearch.trim());
  const errorMessage = listQuery.isError ? getToastMessage(listQuery.error) : '';

  const summaryCards = [
    { key: 'overdue', title: 'Quá hạn', value: summary.overdue, color: '#cf1322' },
    { key: 'due_today', title: 'Hôm nay', value: summary.due_today, color: '#d48806' },
    { key: 'upcoming', title: '7 ngày tới', value: summary.upcoming_7_days, color: '#1677ff' },
    { key: 'held', title: 'Cần xử lý', value: summary.held, color: '#c41d7f' },
    { key: 'no_date', title: 'Chưa có ngày', value: summary.no_date, color: '#595959' },
    { key: 'fully_planned', title: 'Đã lập đủ', value: summary.fully_planned, color: '#389e0d' },
    { key: 'in_progress', title: 'Đang sản xuất', value: summary.in_progress, color: '#fa8c16' },
  ];

  const columns: ColumnsType<ProductionDemand> = [
    {
      title: 'Ngày cần lập KH',
      dataIndex: 'planning_due_date',
      width: 140,
      render: (value: string | null) => formatDate(value),
      sorter: true,
    },
    {
      title: 'Ngày giao',
      dataIndex: 'delivery_date',
      width: 120,
      render: (value: string | null) => formatDate(value),
      sorter: true,
    },
    {
      title: 'Số đơn',
      width: 160,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{formatMaybeText(row.sales_order_code)}</Text>
          <Text type="secondary">{getDemandCode(row)}</Text>
        </Space>
      ),
    },
    {
      title: 'Khách hàng',
      width: 200,
      render: (_, row) => getCustomerDisplay(row),
    },
    {
      title: 'Mã hàng',
      dataIndex: 'product_code',
      width: 150,
      render: (value: string) => formatMaybeText(value),
      sorter: true,
    },
    {
      title: 'Tên hàng',
      dataIndex: 'product_name',
      width: 260,
      render: (value: string) => formatMaybeText(value),
    },
    {
      title: 'Loại mã',
      dataIndex: 'product_kind',
      width: 110,
      render: (value: string) => renderProductKind(value),
    },
    {
      title: 'SL cần SX',
      dataIndex: 'qty_required',
      width: 120,
      align: 'right',
      render: (value: string) => formatNumber(value),
    },
    {
      title: 'SL đã lập KH',
      dataIndex: 'qty_planned',
      width: 130,
      align: 'right',
      render: (value: string) => formatNumber(value),
    },
    {
      title: 'SL còn lại',
      dataIndex: 'qty_remaining_to_plan',
      width: 120,
      align: 'right',
      render: (value: string) => formatNumber(value),
    },
    {
      title: 'Trạng thái KH',
      dataIndex: 'planning_status',
      width: 160,
      render: (status: ProductionDemandPlanningStatus) => renderPlanningStatus(status),
    },
    {
      title: 'Trạng thái SX',
      dataIndex: 'production_status',
      width: 170,
      render: (status: ProductionDemandProductionStatus) => renderProductionStatus(status),
    },
    {
      title: 'Ưu tiên',
      dataIndex: 'priority',
      width: 120,
      render: (priority: ProductionDemandPriority) => renderPriority(priority),
    },
    {
      title: 'Hold/Ghi chú',
      width: 240,
      render: (_, row) => {
        if (row.hold_reason) {
          return <Text type="danger">{row.hold_reason}</Text>;
        }
        return <Text type="secondary">{row.notes || '-'}</Text>;
      },
    },
  ];

  const resetSearch = () => {
    setSearchInput('');
    setPage(1);
  };

  const refreshData = async () => {
    await Promise.all([
      listQuery.refetch(),
      summaryQuery.refetch(),
    ]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="list-page-head">
        <div>
          <Title level={2} style={{ marginBottom: 4 }}>Nhu cầu sản xuất</Title>
          <Text type="secondary">Theo dõi nhu cầu sản xuất phát sinh từ đơn hàng và kế hoạch giao.</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void refreshData()}>
          Tải lại
        </Button>
      </div>

      {errorMessage ? (
        <Alert
          showIcon
          type="error"
          message="Không tải được nhu cầu sản xuất"
          description={errorMessage}
        />
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {summaryCards.map((item) => (
          <Card key={item.key} size="small" style={{ height: '100%', borderRadius: 8 }}>
            <Statistic title={item.title} value={item.value} valueStyle={{ color: item.color }} />
          </Card>
        ))}
      </div>

      <Card size="small">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space wrap>
            <Input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              placeholder="Tìm mã nhu cầu, đơn hàng, khách hàng, mã hàng..."
              style={{ width: 360, maxWidth: '100%' }}
              suffix={searchInput ? (
                <QuickClearIcon onClear={resetSearch} title="Xóa tìm kiếm" />
              ) : undefined}
            />
            <Tag color="blue">Tổng: {formatNumber(listQuery.data?.count ?? 0)}</Tag>
            {hasSearch ? <Tag color="processing">Đang lọc theo tìm kiếm</Tag> : <Tag color="default">Đang xem toàn bộ nhu cầu</Tag>}
          </Space>
        </Space>
      </Card>

      <div className="list-page-table-wrap">
        <Table<ProductionDemand>
          className="enterprise-data-table"
          rowKey="id"
          loading={listQuery.isLoading || listQuery.isFetching}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1900 }}
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
            emptyText: !listQuery.isLoading ? (
              <div style={{ padding: 32 }}>
                <Empty description={hasSearch ? 'Không tìm thấy nhu cầu sản xuất phù hợp.' : 'Chưa có nhu cầu sản xuất nào.'} />
                {hasSearch ? <Button type="link" onClick={resetSearch}>Xóa tìm kiếm</Button> : null}
              </div>
            ) : undefined,
          }}
        />
      </div>
    </div>
  );
}
