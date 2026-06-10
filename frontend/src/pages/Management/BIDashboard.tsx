import React, { useMemo, useState } from 'react';
import { ArrowDownOutlined, ArrowUpOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, Input, Modal, Progress, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { financeApi } from '../../api/finance';
import { inventoryApi } from '../../api/inventory';
import { salesApi } from '../../api/sales';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import {
  buildTopCustomers,
  buildTopProducts,
  calculateGrowth,
  getPostedOrders,
  toNumber,
} from '../../utils/analytics';
import { PAGES } from '../../utils/constants';

type PeriodKey = 'month' | 'quarter' | 'year';

type BIDashboardViewSnapshot = {
  period: PeriodKey;
};

type BIDashboardNamedPreset = {
  id: string;
  name: string;
  snapshot: BIDashboardViewSnapshot;
  updatedAt: string;
};

const periodOptions = [
  { label: 'Tháng', value: 'month' },
  { label: 'Quý', value: 'quarter' },
  { label: 'Năm', value: 'year' },
];

const PERIOD_VALUES: PeriodKey[] = ['month', 'quarter', 'year'];
const PERIOD_LABELS: Record<PeriodKey, string> = {
  month: 'Thang',
  quarter: 'Quy',
  year: 'Nam',
};

const formatMoney = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 0 });

function isPeriodKey(value: unknown): value is PeriodKey {
  return typeof value === 'string' && PERIOD_VALUES.includes(value as PeriodKey);
}

function getPeriodRange(period: PeriodKey) {
  const end = dayjs().endOf('day');
  const quarterStartMonth = Math.floor(dayjs().month() / 3) * 3;
  const currentQuarterStart = dayjs().month(quarterStartMonth).startOf('month');
  const previousQuarterStart = currentQuarterStart.subtract(3, 'month');
  if (period === 'year') {
    return {
      currentStart: dayjs().startOf('year'),
      currentEnd: end,
      previousStart: dayjs().subtract(1, 'year').startOf('year'),
      previousEnd: dayjs().subtract(1, 'year').endOf('year'),
    };
  }
  if (period === 'quarter') {
    return {
      currentStart: currentQuarterStart,
      currentEnd: end,
      previousStart: previousQuarterStart,
      previousEnd: previousQuarterStart.add(2, 'month').endOf('month'),
    };
  }
  return {
    currentStart: dayjs().startOf('month'),
    currentEnd: end,
    previousStart: dayjs().subtract(1, 'month').startOf('month'),
    previousEnd: dayjs().subtract(1, 'month').endOf('month'),
  };
}

const BIDashboard: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const { config, saveConfig } = useUserPreferences(PAGES.BI_DASHBOARD);
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const namedPresets = useMemo<BIDashboardNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const preset = item as Partial<BIDashboardNamedPreset>;
        const snapshot = preset.snapshot as Partial<BIDashboardViewSnapshot> | undefined;
        if (
          typeof preset.id !== 'string' ||
          typeof preset.name !== 'string' ||
          !snapshot ||
          !isPeriodKey(snapshot.period)
        ) {
          return null;
        }
        return {
          id: preset.id,
          name: preset.name,
          snapshot: { period: snapshot.period },
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is BIDashboardNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );
  const { currentStart, currentEnd, previousStart, previousEnd } = getPeriodRange(period);

  const dashboardQuery = useQuery({
    queryKey: ['bi-dashboard', period, currentStart.format('YYYY-MM-DD'), currentEnd.format('YYYY-MM-DD')],
    queryFn: async () => {
      const [salesCurrent, salesPrevious, cashCurrent, cashPrevious, inventorySummary, receivableSummary, payableSummary, currentOrdersResponse, previousOrdersResponse] = await Promise.all([
        salesApi.getOrderSummary({
          order_date__gte: currentStart.format('YYYY-MM-DD'),
          order_date__lte: currentEnd.format('YYYY-MM-DD'),
        }),
        salesApi.getOrderSummary({
          order_date__gte: previousStart.format('YYYY-MM-DD'),
          order_date__lte: previousEnd.format('YYYY-MM-DD'),
        }),
        financeApi.getCashFlowSummary({
          date_from: currentStart.format('YYYY-MM-DD'),
          date_to: currentEnd.format('YYYY-MM-DD'),
        }),
        financeApi.getCashFlowSummary({
          date_from: previousStart.format('YYYY-MM-DD'),
          date_to: previousEnd.format('YYYY-MM-DD'),
        }),
        inventoryApi.getStockSummary(),
        financeApi.getReceivableSummary({
          document_date__gte: currentStart.format('YYYY-MM-DD'),
          document_date__lte: currentEnd.format('YYYY-MM-DD'),
        }),
        financeApi.getPayableSummary({
          document_date__gte: currentStart.format('YYYY-MM-DD'),
          document_date__lte: currentEnd.format('YYYY-MM-DD'),
        }),
        salesApi.getOrders({
          order_date__gte: currentStart.format('YYYY-MM-DD'),
          order_date__lte: currentEnd.format('YYYY-MM-DD'),
          page_size: 500,
          ordering: '-order_date',
        }),
        salesApi.getOrders({
          order_date__gte: previousStart.format('YYYY-MM-DD'),
          order_date__lte: previousEnd.format('YYYY-MM-DD'),
          page_size: 500,
          ordering: '-order_date',
        }),
      ]);

      return {
        salesCurrent,
        salesPrevious,
        cashCurrent,
        cashPrevious,
        inventorySummary,
        receivableSummary,
        payableSummary,
        currentOrders: currentOrdersResponse.results ?? [],
        previousOrders: previousOrdersResponse.results ?? [],
      };
    },
  });

  const currentOrders = dashboardQuery.data?.currentOrders ?? [];
  const previousOrders = dashboardQuery.data?.previousOrders ?? [];
  const currentPostedOrders = getPostedOrders(currentOrders);
  const previousPostedOrders = getPostedOrders(previousOrders);
  const topCustomers = buildTopCustomers(currentPostedOrders, previousPostedOrders);
  const topProducts = buildTopProducts(currentPostedOrders, previousPostedOrders);
  const overdueReceivableCount = dashboardQuery.data?.receivableSummary?.overdue_count ?? 0;
  const overduePayableCount = dashboardQuery.data?.payableSummary?.overdue_count ?? 0;
  const belowMinCount = dashboardQuery.data?.inventorySummary?.below_min_count ?? 0;
  const pendingSalesCount = dashboardQuery.data?.salesCurrent?.pending_approval_count ?? 0;
  const cashDelta = toNumber(dashboardQuery.data?.cashCurrent?.cash_delta);

  const biOwnerInsight = useMemo(() => {
    if (dashboardQuery.isError) {
      return {
        type: 'error' as const,
        message: 'Không tải được dữ liệu BI',
        description: 'Hãy thử làm mới dashboard. Nếu vẫn lỗi, dùng Reports Center hoặc các màn nghiệp vụ để đối chiếu số liệu trước khi ra quyết định.',
        actionLabel: 'Thử tải lại',
        actionPath: '',
      };
    }
    if (dashboardQuery.isLoading) {
      return {
        type: 'info' as const,
        message: 'Đang tổng hợp dashboard BI',
        description: 'Hệ thống đang gom doanh thu, công nợ, tồn kho và dòng tiền trong kỳ đang xem.',
        actionLabel: 'Đang tải',
        actionPath: '',
      };
    }
    if (overdueReceivableCount > 0) {
      return {
        type: 'warning' as const,
        message: 'Ưu tiên thu hồi công nợ quá hạn',
        description: `Có ${overdueReceivableCount} chứng từ phải thu quá hạn trong kỳ ${PERIOD_LABELS[period]}. Nên mở AR để phân công follow-up trước khi xem các chỉ số tăng trưởng.`,
        actionLabel: 'Mở công nợ phải thu',
        actionPath: '/receivables',
      };
    }
    if (belowMinCount > 0) {
      return {
        type: 'warning' as const,
        message: 'Tồn kho dưới định mức cần rà ngay',
        description: `${belowMinCount} dòng tồn đang dưới min. Nên kiểm tra tồn khả dụng trước khi chốt kế hoạch bán hàng hoặc sản xuất.`,
        actionLabel: 'Mở tồn kho',
        actionPath: '/inventory-stock',
      };
    }
    if (pendingSalesCount > 0) {
      return {
        type: 'info' as const,
        message: 'Có đơn bán đang chờ duyệt',
        description: `${pendingSalesCount} đơn bán chưa được duyệt có thể ảnh hưởng doanh thu kỳ này. Mở đơn bán để chốt hoặc trả lại người phụ trách.`,
        actionLabel: 'Mở đơn bán',
        actionPath: '/sales-orders',
      };
    }
    if (overduePayableCount > 0) {
      return {
        type: 'info' as const,
        message: 'Cần cân đối lịch chi trả',
        description: `${overduePayableCount} chứng từ phải trả quá hạn. Nên rà AP cùng dòng tiền trước khi cam kết thanh toán mới.`,
        actionLabel: 'Mở công nợ phải trả',
        actionPath: '/payables',
      };
    }
    if (cashDelta < 0) {
      return {
        type: 'warning' as const,
        message: 'Dòng tiền thuần đang âm',
        description: 'Kỳ đang xem có dòng tiền thuần âm. Nên mở sổ quỹ để xem khoản chi lớn và đối chiếu với lịch thu.',
        actionLabel: 'Mở sổ quỹ',
        actionPath: '/cash-book',
      };
    }
    return {
      type: 'success' as const,
      message: 'BI dashboard chưa ghi nhận điểm nóng nổi bật',
      description: 'Có thể dùng màn này để đọc xu hướng, sau đó chạy Reports Center để chốt snapshot chia sẻ cho owner hoặc quản lý ca.',
      actionLabel: 'Mở Reports Center',
      actionPath: '/reports',
    };
  }, [
    belowMinCount,
    cashDelta,
    dashboardQuery.isError,
    dashboardQuery.isLoading,
    overduePayableCount,
    overdueReceivableCount,
    pendingSalesCount,
    period,
  ]);

  const biQuickLinks = [
    { to: '/sales-orders', label: 'Đơn bán', detail: `${pendingSalesCount} chờ duyệt` },
    { to: '/inventory-stock', label: 'Tồn kho', detail: `${belowMinCount} dưới min` },
    { to: '/receivables', label: 'Phải thu', detail: `${overdueReceivableCount} quá hạn` },
    { to: '/payables', label: 'Phải trả', detail: `${overduePayableCount} quá hạn` },
    { to: '/cash-book', label: 'Sổ quỹ', detail: cashDelta < 0 ? 'Dòng tiền âm' : 'Đối chiếu thu chi' },
    { to: '/reports', label: 'Reports', detail: 'Chốt snapshot' },
  ];

  const kpis = [
    {
      key: 'revenue',
      label: 'Doanh thu',
      value: toNumber(dashboardQuery.data?.salesCurrent?.posted_total),
      previous: toNumber(dashboardQuery.data?.salesPrevious?.posted_total),
      color: '#1677ff',
      suffix: 'VND',
      detail: `${dashboardQuery.data?.salesCurrent?.posted_count ?? 0} đơn đã ghi sổ`,
    },
    {
      key: 'orders',
      label: 'Đơn hàng',
      value: dashboardQuery.data?.salesCurrent?.total_orders ?? 0,
      previous: dashboardQuery.data?.salesPrevious?.total_orders ?? 0,
      color: '#389e0d',
      detail: `${dashboardQuery.data?.salesCurrent?.pending_approval_count ?? 0} đơn chờ duyệt`,
    },
    {
      key: 'cash_delta',
      label: 'Dòng tiền thuần',
      value: toNumber(dashboardQuery.data?.cashCurrent?.cash_delta),
      previous: toNumber(dashboardQuery.data?.cashPrevious?.cash_delta),
      color: '#13a8a8',
      suffix: 'VND',
      detail: `${dashboardQuery.data?.cashCurrent?.transactions_count ?? 0} giao dịch`,
    },
    {
      key: 'inventory',
      label: 'Tồn khả dụng',
      value: toNumber(dashboardQuery.data?.inventorySummary?.total_available_qty),
      previous: toNumber(dashboardQuery.data?.inventorySummary?.total_on_hand_qty),
      color: '#722ed1',
      detail: `${dashboardQuery.data?.inventorySummary?.below_min_count ?? 0} dòng dưới min`,
    },
    {
      key: 'receivables',
      label: 'Công nợ phải thu',
      value: toNumber(dashboardQuery.data?.receivableSummary?.remaining_amount),
      previous: toNumber(dashboardQuery.data?.receivableSummary?.total_amount),
      color: '#eb2f96',
      suffix: 'VND',
      detail: `${dashboardQuery.data?.receivableSummary?.overdue_count ?? 0} chứng từ quá hạn`,
    },
    {
      key: 'payables',
      label: 'Công nợ phải trả',
      value: toNumber(dashboardQuery.data?.payableSummary?.remaining_amount),
      previous: toNumber(dashboardQuery.data?.payableSummary?.total_amount),
      color: '#fa8c16',
      suffix: 'VND',
      detail: `${dashboardQuery.data?.payableSummary?.overdue_count ?? 0} chứng từ quá hạn`,
    },
  ];

  const tableColumns: ColumnsType<(typeof topProducts)[number]> = [
    { title: 'Sản phẩm', dataIndex: 'name', width: 220 },
    { title: 'Doanh thu', dataIndex: 'revenue', align: 'right', render: (value) => formatMoney(Number(value)) },
    { title: 'Số lượng', dataIndex: 'units', align: 'right', render: (value) => Number(value).toLocaleString('vi-VN') },
    {
      title: 'Tăng trưởng',
      dataIndex: 'growth',
      align: 'right',
      render: (value) => (
        <span style={{ color: value >= 0 ? '#389e0d' : '#cf1322' }}>
          {value >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(value)}%
        </span>
      ),
    },
  ];

  const activeContextTags = useMemo(() => {
    const tags = [`Ky xem: ${PERIOD_LABELS[period]}`];
    if (selectedViewPreset) {
      tags.push(`Mau loc: ${selectedViewPreset.name}`);
    }
    return tags;
  }, [period, selectedViewPreset]);

  const buildCurrentSnapshot = (): BIDashboardViewSnapshot => ({
    period,
  });

  const applySnapshot = (snapshot: BIDashboardViewSnapshot) => {
    setPeriod(snapshot.period);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        saved_view: buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Da luu che do xem BI.');
    } catch {
      messageApi.error('Khong the luu che do xem BI.');
    }
  };

  const applySavedView = () => {
    const savedView = configRecord.saved_view;
    const snapshot = savedView as Partial<BIDashboardViewSnapshot> | undefined;
    if (!snapshot || typeof snapshot !== 'object' || !isPeriodKey(snapshot.period)) {
      messageApi.warning('Chua co che do xem BI da luu.');
      return;
    }
    applySnapshot({ period: snapshot.period });
    messageApi.success('Da khoi phuc che do xem BI.');
  };

  const saveNamedPreset = async () => {
    const trimmedName = viewPresetName.trim();
    if (!trimmedName) {
      messageApi.warning('Nhap ten mau loc BI.');
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
        saved_view: snapshot,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId(presetId);
      setIsViewPresetModalOpen(false);
      setViewPresetName('');
      messageApi.success('Da luu mau loc BI.');
    } catch {
      messageApi.error('Khong the luu mau loc BI.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Chon mot mau loc BI de ap dung.');
      return;
    }
    applySnapshot(preset.snapshot);
    messageApi.success(`Da ap dung mau loc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Chon mot mau loc BI de xoa.');
      return;
    }
    const nextPresets = namedPresets.filter((item) => item.id !== preset.id);
    try {
      await saveConfig({
        ...configRecord,
        saved_view: configRecord.saved_view,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId((current) => (current === preset.id ? undefined : current));
      messageApi.success(`Da xoa mau loc "${preset.name}".`);
    } catch {
      messageApi.error('Khong the xoa mau loc BI.');
    }
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <Card>
        <Row justify="space-between" align="middle" gutter={[16, 16]}>
          <Col>
            <Typography.Title level={4} style={{ margin: 0 }}>Bảng điều hành BI</Typography.Title>
            <Typography.Text type="secondary">
              Kỳ hiện tại: {currentStart.format('DD/MM/YYYY')} - {currentEnd.format('DD/MM/YYYY')}
            </Typography.Text>
          </Col>
          <Col>
            <Space wrap data-testid="bi-dashboard-command-strip">
              <div data-testid="bi-dashboard-period-select">
                <Select value={period} onChange={setPeriod} options={periodOptions} style={{ width: 120 }} />
              </div>
              <Button data-testid="bi-dashboard-save-view" onClick={() => void saveCurrentView()}>
                Luu che do xem
              </Button>
              <Button data-testid="bi-dashboard-restore-view" onClick={applySavedView}>
                Khoi phuc
              </Button>
              <Button
                data-testid="bi-dashboard-open-preset-modal"
                onClick={() => {
                  setViewPresetName(selectedViewPreset?.name ?? '');
                  setIsViewPresetModalOpen(true);
                }}
              >
                Tao mau loc
              </Button>
              <div data-testid="bi-dashboard-preset-select">
                <Select
                  style={{ width: 220 }}
                  placeholder="Chon mau loc BI"
                  value={selectedViewPresetId}
                  onChange={(value) => setSelectedViewPresetId(value)}
                  options={namedPresets.map((preset) => ({ value: preset.id, label: preset.name }))}
                />
              </div>
              <Button data-testid="bi-dashboard-apply-preset" onClick={applyNamedPreset}>
                Ap dung mau
              </Button>
              <Button danger data-testid="bi-dashboard-delete-preset" onClick={() => void deleteNamedPreset()}>
                Xoa mau
              </Button>
              <Button
                data-testid="bi-dashboard-refresh"
                icon={<ReloadOutlined />}
                loading={dashboardQuery.isFetching}
                onClick={() => dashboardQuery.refetch()}
              >
                Làm mới
              </Button>
            </Space>
          </Col>
        </Row>
        <Space wrap style={{ marginTop: 12 }}>
          {activeContextTags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </Space>
      </Card>

      <Alert
        type={biOwnerInsight.type}
        showIcon
        message={biOwnerInsight.message}
        description={biOwnerInsight.description}
        action={biOwnerInsight.actionPath ? (
          <Link to={biOwnerInsight.actionPath}>
            <Button size="small">{biOwnerInsight.actionLabel}</Button>
          </Link>
        ) : (
          <Button size="small" loading={dashboardQuery.isFetching} onClick={() => dashboardQuery.refetch()}>
            {biOwnerInsight.actionLabel}
          </Button>
        )}
      />

      <Card title="Đi tới màn xử lý">
        <Space wrap size={[12, 12]}>
          {biQuickLinks.map((item) => (
            <Link key={item.to} to={item.to}>
              <Button>
                {item.label} · {item.detail}
              </Button>
            </Link>
          ))}
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        {kpis.map((item) => {
          const change = calculateGrowth(item.value, item.previous);
          const progressBase = item.previous > 0 ? item.previous : item.value || 1;
          const progress = Math.max(0, Math.min(999, Math.round((item.value / progressBase) * 100)));

          return (
            <Col xs={24} md={12} xl={8} key={item.key}>
              <Card loading={dashboardQuery.isLoading}>
                <div style={{ color: item.color, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{item.label}</div>
                <Statistic
                  value={item.value}
                  formatter={(value) => {
                    if (item.key === 'orders' || item.key === 'inventory') {
                      return Number(value || 0).toLocaleString('vi-VN');
                    }
                    return formatMoney(Number(value || 0));
                  }}
                  prefix={item.suffix}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                  <Typography.Text type={change >= 0 ? 'success' : 'danger'}>
                    {change >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(change)}%
                  </Typography.Text>
                  <Typography.Text type="secondary">{item.detail}</Typography.Text>
                </div>
                <Progress percent={progress} showInfo={false} strokeColor={item.color} style={{ marginTop: 10 }} />
              </Card>
            </Col>
          );
        })}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title="Top sản phẩm" loading={dashboardQuery.isLoading}>
            <Table
              columns={tableColumns}
              dataSource={topProducts}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ x: 680 }}
              locale={{ emptyText: <Empty description="Chưa có sản phẩm phát sinh doanh thu trong kỳ này." /> }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="Top khách hàng" loading={dashboardQuery.isLoading}>
            <Table
              columns={[
                { title: 'Khách hàng', dataIndex: 'name', width: 180 },
                { title: 'Doanh thu', dataIndex: 'revenue', align: 'right', render: (value) => formatMoney(Number(value)) },
                { title: 'Số đơn', dataIndex: 'orders', align: 'center' },
                {
                  title: 'Tăng trưởng',
                  dataIndex: 'growth',
                  align: 'right',
                  render: (value) => (
                    <span style={{ color: value >= 0 ? '#389e0d' : '#cf1322' }}>
                      {value >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(value)}%
                    </span>
                  ),
                },
              ]}
              dataSource={topCustomers}
              rowKey="id"
              pagination={false}
              size="small"
              scroll={{ x: 620 }}
              locale={{ emptyText: <Empty description="Chưa có khách hàng phát sinh doanh thu trong kỳ này." /> }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="Cảnh báo vận hành" loading={dashboardQuery.isLoading}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card size="small" style={{ borderLeft: '4px solid #cf1322' }}>
              <Space direction="vertical" size={4}>
                <Typography.Text strong>Công nợ phải thu quá hạn</Typography.Text>
                <Typography.Text>{dashboardQuery.data?.receivableSummary?.overdue_count ?? 0} chứng từ</Typography.Text>
                <Tag color="red">{formatMoney(toNumber(dashboardQuery.data?.receivableSummary?.overdue_amount))} VND</Tag>
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" style={{ borderLeft: '4px solid #fa8c16' }}>
              <Space direction="vertical" size={4}>
                <Typography.Text strong>Tồn kho cần mua bù</Typography.Text>
                <Typography.Text>{dashboardQuery.data?.inventorySummary?.below_min_count ?? 0} dòng dưới min</Typography.Text>
                <Tag color="orange">{dashboardQuery.data?.inventorySummary?.stock_rows ?? 0} dòng tồn đang theo dõi</Tag>
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card size="small" style={{ borderLeft: '4px solid #1677ff' }}>
              <Space direction="vertical" size={4}>
                <Typography.Text strong>Công nợ phải trả quá hạn</Typography.Text>
                <Typography.Text>{dashboardQuery.data?.payableSummary?.overdue_count ?? 0} chứng từ</Typography.Text>
                <Tag color="blue">{formatMoney(toNumber(dashboardQuery.data?.payableSummary?.overdue_amount))} VND</Tag>
              </Space>
            </Card>
          </Col>
        </Row>
      </Card>
      <Modal
        title="Luu mau loc BI"
        open={isViewPresetModalOpen}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Luu mau"
        cancelText="Dong"
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            Luu ky xem hien tai de mo lai nhanh cho cac buoi dieu hanh sau.
          </Typography.Text>
          <Input
            data-testid="bi-dashboard-preset-name"
            value={viewPresetName}
            onChange={(event) => setViewPresetName(event.target.value)}
            placeholder="Vi du: Tong quan theo quy"
          />
        </Space>
      </Modal>
    </div>
  );
};

export default BIDashboard;
