import { useMemo, useState } from 'react';
import { ArrowDownOutlined, ArrowUpOutlined, DownloadOutlined, RiseOutlined, ShopOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { Button, DatePicker, Input, Modal, Space, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useQuery } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';

import { useUserPreferences } from '../../hooks/useUserPreferences';
import { salesApi } from '../../api/sales';
import {
  buildStatusBreakdown,
  buildTopCustomers,
  buildTopProducts,
  calculateGrowth,
  getPostedOrders,
  toNumber,
} from '../../utils/analytics';
import { PAGES } from '../../utils/constants';
import { downloadCSV } from '../../utils/csvExport';

const { RangePicker } = DatePicker;

type CustomerRow = ReturnType<typeof buildTopCustomers>[number];
type ProductRow = ReturnType<typeof buildTopProducts>[number];
type StatusRow = ReturnType<typeof buildStatusBreakdown>[number];

type RangePreset = 'rolling_3m' | 'rolling_6m' | 'rolling_12m' | 'custom';

type SalesAnalyticsViewSnapshot = {
  rangePreset: RangePreset;
  startDate: string;
  endDate: string;
};

type SalesAnalyticsNamedPreset = {
  id: string;
  name: string;
  snapshot: SalesAnalyticsViewSnapshot;
  updatedAt: string;
};

function formatMoney(value: number): string {
  return value.toLocaleString('vi-VN', { maximumFractionDigits: 0 });
}

function formatGrowth(value: number): string {
  return `${Math.abs(value).toFixed(1)}%`;
}

function buildRangeFromPreset(preset: RangePreset): [Dayjs, Dayjs] {
  if (preset === 'rolling_3m') {
    return [dayjs().subtract(2, 'month').startOf('month'), dayjs().endOf('day')];
  }
  if (preset === 'rolling_6m') {
    return [dayjs().subtract(5, 'month').startOf('month'), dayjs().endOf('day')];
  }
  return [dayjs().subtract(11, 'month').startOf('month'), dayjs().endOf('day')];
}

export default function SalesAnalyticsDashboard() {
  const [messageApi, contextHolder] = message.useMessage();
  const [rangePreset, setRangePreset] = useState<RangePreset>('rolling_12m');
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(buildRangeFromPreset('rolling_12m'));
  const [selectedViewPresetId, setSelectedViewPresetId] = useState<string>();
  const [isViewPresetModalOpen, setIsViewPresetModalOpen] = useState(false);
  const [viewPresetName, setViewPresetName] = useState('');
  const { config, saveConfig } = useUserPreferences(PAGES.SALES_ANALYTICS_DASHBOARD);
  const configRecord = useMemo<Record<string, unknown>>(
    () => (config && typeof config === 'object' ? (config as Record<string, unknown>) : {}),
    [config],
  );
  const namedPresets = useMemo<SalesAnalyticsNamedPreset[]>(() => {
    const raw = configRecord.saved_views;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const preset = item as Partial<SalesAnalyticsNamedPreset>;
        if (
          typeof preset.id !== 'string' ||
          typeof preset.name !== 'string' ||
          !preset.snapshot ||
          typeof preset.snapshot.rangePreset !== 'string' ||
          typeof preset.snapshot.startDate !== 'string' ||
          typeof preset.snapshot.endDate !== 'string'
        ) {
          return null;
        }
        return {
          id: preset.id,
          name: preset.name,
          snapshot: {
            rangePreset: preset.snapshot.rangePreset as RangePreset,
            startDate: preset.snapshot.startDate,
            endDate: preset.snapshot.endDate,
          },
          updatedAt: typeof preset.updatedAt === 'string' ? preset.updatedAt : new Date().toISOString(),
        };
      })
      .filter((item): item is SalesAnalyticsNamedPreset => Boolean(item));
  }, [configRecord]);
  const selectedViewPreset = useMemo(
    () => namedPresets.find((item) => item.id === selectedViewPresetId) ?? null,
    [namedPresets, selectedViewPresetId],
  );

  const [startDate, endDate] = dateRange;

  const analyticsQuery = useQuery({
    queryKey: ['sales-analytics-dashboard', startDate.format('YYYY-MM-DD'), endDate.format('YYYY-MM-DD')],
    queryFn: async () => {
      const dayCount = Math.max(1, endDate.diff(startDate, 'day') + 1);
      const previousEnd = startDate.subtract(1, 'day');
      const previousStart = previousEnd.subtract(dayCount - 1, 'day');

      const [currentSummary, previousSummary, currentOrdersResponse, previousOrdersResponse, currentQuotesResponse] =
        await Promise.all([
          salesApi.getOrderSummary({
            order_date__gte: startDate.format('YYYY-MM-DD'),
            order_date__lte: endDate.format('YYYY-MM-DD'),
          }),
          salesApi.getOrderSummary({
            order_date__gte: previousStart.format('YYYY-MM-DD'),
            order_date__lte: previousEnd.format('YYYY-MM-DD'),
          }),
          salesApi.getOrders({
            order_date__gte: startDate.format('YYYY-MM-DD'),
            order_date__lte: endDate.format('YYYY-MM-DD'),
            page_size: 500,
            ordering: '-order_date',
          }),
          salesApi.getOrders({
            order_date__gte: previousStart.format('YYYY-MM-DD'),
            order_date__lte: previousEnd.format('YYYY-MM-DD'),
            page_size: 500,
            ordering: '-order_date',
          }),
          salesApi.getQuotes({
            quote_date__gte: startDate.format('YYYY-MM-DD'),
            quote_date__lte: endDate.format('YYYY-MM-DD'),
            page_size: 500,
            ordering: '-quote_date',
          }),
        ]);

      return {
        currentSummary,
        previousSummary,
        currentOrders: currentOrdersResponse.results ?? [],
        previousOrders: previousOrdersResponse.results ?? [],
        currentQuotes: currentQuotesResponse.results ?? [],
      };
    },
  });

  const currentOrders = useMemo(() => analyticsQuery.data?.currentOrders ?? [], [analyticsQuery.data?.currentOrders]);
  const previousOrders = useMemo(() => analyticsQuery.data?.previousOrders ?? [], [analyticsQuery.data?.previousOrders]);
  const currentPostedOrders = useMemo(() => getPostedOrders(currentOrders), [currentOrders]);
  const previousPostedOrders = useMemo(() => getPostedOrders(previousOrders), [previousOrders]);

  const summary = useMemo(() => {
    const totalRevenue = toNumber(analyticsQuery.data?.currentSummary?.posted_total);
    const previousRevenue = toNumber(analyticsQuery.data?.previousSummary?.posted_total);
    const totalOrders = analyticsQuery.data?.currentSummary?.total_orders ?? 0;
    const previousOrderCount = analyticsQuery.data?.previousSummary?.total_orders ?? 0;
    const postedOrderCount = analyticsQuery.data?.currentSummary?.posted_count ?? currentPostedOrders.length;
    const activeQuotes = (analyticsQuery.data?.currentQuotes ?? []).filter((item) => item.status !== 'DRAFT');
    const acceptedQuotes = activeQuotes.filter((item) => item.status === 'ACCEPTED').length;
    const conversionRate = activeQuotes.length > 0 ? Number(((acceptedQuotes / activeQuotes.length) * 100).toFixed(1)) : 0;
    const avgOrderValue = postedOrderCount > 0 ? totalRevenue / postedOrderCount : 0;
    const revenueGrowth = calculateGrowth(totalRevenue, previousRevenue);
    const orderGrowth = calculateGrowth(totalOrders, previousOrderCount);

    return {
      totalRevenue,
      previousRevenue,
      totalOrders,
      previousOrderCount,
      postedOrderCount,
      activeQuotes,
      acceptedQuotes,
      conversionRate,
      avgOrderValue,
      revenueGrowth,
      orderGrowth,
      dueToday: analyticsQuery.data?.currentSummary?.due_today_count ?? 0,
      dueSoon: analyticsQuery.data?.currentSummary?.due_soon_count ?? 0,
      overdueDelivery: analyticsQuery.data?.currentSummary?.overdue_delivery_count ?? 0,
    };
  }, [analyticsQuery.data, currentPostedOrders.length]);

  const activeContextTags = useMemo(() => {
    const tags = [`Từ ${startDate.format('DD/MM/YYYY')}`, `Đến ${endDate.format('DD/MM/YYYY')}`];
    if (rangePreset !== 'custom') {
      tags.push(
        rangePreset === 'rolling_3m'
          ? 'Khung: 3 tháng'
          : rangePreset === 'rolling_6m'
            ? 'Khung: 6 tháng'
            : 'Khung: 12 tháng',
      );
    }
    if (selectedViewPreset) {
      tags.push(`Mẫu lọc: ${selectedViewPreset.name}`);
    }
    return tags;
  }, [endDate, rangePreset, selectedViewPreset, startDate]);

  const topCustomers = useMemo(() => buildTopCustomers(currentPostedOrders, previousPostedOrders), [currentPostedOrders, previousPostedOrders]);
  const topProducts = useMemo(() => buildTopProducts(currentPostedOrders, previousPostedOrders), [currentPostedOrders, previousPostedOrders]);
  const statusBreakdown = useMemo(() => buildStatusBreakdown(currentOrders), [currentOrders]);

  const buildCurrentSnapshot = (): SalesAnalyticsViewSnapshot => ({
    rangePreset,
    startDate: startDate.format('YYYY-MM-DD'),
    endDate: endDate.format('YYYY-MM-DD'),
  });

  const applySnapshot = (snapshot: SalesAnalyticsViewSnapshot) => {
    setRangePreset(snapshot.rangePreset);
    setDateRange([dayjs(snapshot.startDate), dayjs(snapshot.endDate).endOf('day')]);
  };

  const saveCurrentView = async () => {
    try {
      await saveConfig({
        ...configRecord,
        saved_view: buildCurrentSnapshot(),
        saved_views: namedPresets,
      });
      messageApi.success('Đã lưu chế độ xem phân tích bán hàng.');
    } catch {
      messageApi.error('Không thể lưu chế độ xem phân tích bán hàng.');
    }
  };

  const applySavedView = () => {
    const raw = configRecord.saved_view as Partial<SalesAnalyticsViewSnapshot> | undefined;
    if (!raw || typeof raw.startDate !== 'string' || typeof raw.endDate !== 'string' || typeof raw.rangePreset !== 'string') {
      messageApi.warning('Chưa có chế độ xem phân tích bán hàng đã lưu.');
      return;
    }
    applySnapshot({
      rangePreset: raw.rangePreset as RangePreset,
      startDate: raw.startDate,
      endDate: raw.endDate,
    });
    messageApi.success('Đã khôi phục chế độ xem phân tích bán hàng.');
  };

  const saveNamedPreset = async () => {
    const name = viewPresetName.trim();
    if (!name) {
      messageApi.error('Vui lòng nhập tên mẫu lọc.');
      return;
    }
    const existing = namedPresets.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const nextPreset: SalesAnalyticsNamedPreset = {
      id:
        existing?.id ??
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}`),
      name,
      snapshot: buildCurrentSnapshot(),
      updatedAt: new Date().toISOString(),
    };
    const nextPresets = existing
      ? namedPresets.map((item) => (item.id === existing.id ? nextPreset : item))
      : [...namedPresets, nextPreset];
    try {
      await saveConfig({
        ...configRecord,
        saved_view: configRecord.saved_view,
        saved_views: nextPresets,
      });
      setSelectedViewPresetId(nextPreset.id);
      setIsViewPresetModalOpen(false);
      setViewPresetName('');
      messageApi.success(existing ? 'Đã cập nhật mẫu lọc phân tích bán hàng.' : 'Đã lưu mẫu lọc phân tích bán hàng mới.');
    } catch {
      messageApi.error('Không thể lưu mẫu lọc phân tích bán hàng.');
    }
  };

  const applyNamedPreset = () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc phân tích bán hàng.');
      return;
    }
    applySnapshot(preset.snapshot);
    messageApi.success(`Đã áp dụng mẫu lọc "${preset.name}".`);
  };

  const deleteNamedPreset = async () => {
    const preset = namedPresets.find((item) => item.id === selectedViewPresetId);
    if (!preset) {
      messageApi.warning('Vui lòng chọn mẫu lọc phân tích bán hàng để xóa.');
      return;
    }
    try {
      await saveConfig({
        ...configRecord,
        saved_view: configRecord.saved_view,
        saved_views: namedPresets.filter((item) => item.id !== preset.id),
      });
      setSelectedViewPresetId(undefined);
      messageApi.success(`Đã xóa mẫu lọc "${preset.name}".`);
    } catch {
      messageApi.error('Không thể xóa mẫu lọc phân tích bán hàng.');
    }
  };

  const workspaceAlert = useMemo(() => {
    if (summary.overdueDelivery > 0) {
      return {
        title: `Co ${summary.overdueDelivery} don dang tre giao trong ky dang xem`,
        description: 'Nhom sales nen uu tien xem doanh thu theo trang thai don va doi chieu nhom khach hang dang dong gop lon de giam truot doanh thu.',
        tone: 'warning' as const,
      };
    }
    if (summary.revenueGrowth < 0 || summary.orderGrowth < 0) {
      return {
        title: 'Tang truong dang chuyen giam',
        description: 'Can tap trung nhom khach hang top va conversion cua bao gia de xac dinh diem nghẽn thuong mai.',
        tone: 'warning' as const,
      };
    }
    return {
      title: 'Commercial pulse dang o trang thai on dinh',
      description: 'Doanh thu, don hang va quote conversion dang duoc gom vao mot lane de ra quyet dinh nhanh hon.',
      tone: 'steady' as const,
    };
  }, [summary.orderGrowth, summary.overdueDelivery, summary.revenueGrowth]);

  const signalCards = useMemo(
    () => [
      {
        key: 'revenue',
        title: 'Tang truong doanh thu',
        value: formatGrowth(summary.revenueGrowth),
        detail: `${formatMoney(summary.totalRevenue)} VND trong ky dang xem`,
        tone: summary.revenueGrowth >= 0 ? 'steady' : 'critical',
        icon: <RiseOutlined />,
      },
      {
        key: 'orders',
        title: 'Tang truong don hang',
        value: formatGrowth(summary.orderGrowth),
        detail: `${summary.totalOrders} don, trong do ${summary.postedOrderCount} don da ghi so`,
        tone: summary.orderGrowth >= 0 ? 'steady' : 'warning',
        icon: <ShoppingCartOutlined />,
      },
      {
        key: 'quotes',
        title: 'Quote conversion',
        value: `${summary.conversionRate.toFixed(1)}%`,
        detail: `${summary.acceptedQuotes}/${summary.activeQuotes.length} bao gia da duoc chap nhan`,
        tone: summary.conversionRate >= 40 ? 'steady' : summary.conversionRate >= 20 ? 'warning' : 'critical',
        icon: <ShopOutlined />,
      },
    ],
    [
      summary.acceptedQuotes,
      summary.activeQuotes.length,
      summary.conversionRate,
      summary.orderGrowth,
      summary.postedOrderCount,
      summary.revenueGrowth,
      summary.totalOrders,
      summary.totalRevenue,
    ],
  );

  const exportCsv = () => {
    downloadCSV(
      [
        { metric: 'Tong doanh thu', value: formatMoney(summary.totalRevenue) },
        { metric: 'Tong don hang', value: summary.totalOrders },
        { metric: 'Gia tri don trung binh', value: formatMoney(summary.avgOrderValue) },
        { metric: 'Tang truong doanh thu (%)', value: summary.revenueGrowth },
        { metric: 'Tang truong don hang (%)', value: summary.orderGrowth },
        { metric: 'Ty le chot bao gia (%)', value: summary.conversionRate },
      ],
      `sales-analytics-${dayjs().format('YYYYMMDD')}`,
    );
  };

  const customerColumns: ColumnsType<CustomerRow> = [
    { title: 'Khach hang', dataIndex: 'name', width: 180 },
    { title: 'Doanh thu', dataIndex: 'revenue', width: 140, align: 'right', render: (value) => formatMoney(Number(value)) },
    { title: 'Don hang', dataIndex: 'orders', width: 100, align: 'center' },
    {
      title: 'Tang truong',
      dataIndex: 'growth',
      width: 120,
      align: 'right',
      render: (value) => (
        <span style={{ color: value >= 0 ? '#15803d' : '#dc2626' }}>
          {value >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {formatGrowth(Number(value))}
        </span>
      ),
    },
  ];

  const productColumns: ColumnsType<ProductRow> = [
    { title: 'San pham', dataIndex: 'name', width: 220 },
    { title: 'Doanh thu', dataIndex: 'revenue', width: 140, align: 'right', render: (value) => formatMoney(Number(value)) },
    { title: 'San luong', dataIndex: 'units', width: 110, align: 'right', render: (value) => Number(value).toLocaleString('vi-VN') },
    {
      title: 'Tang truong',
      dataIndex: 'growth',
      width: 120,
      align: 'right',
      render: (value) => (
        <span style={{ color: value >= 0 ? '#15803d' : '#dc2626' }}>
          {value >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {formatGrowth(Number(value))}
        </span>
      ),
    },
  ];

  const statusColumns: ColumnsType<StatusRow> = [
    { title: 'Trang thai', dataIndex: 'status', width: 180 },
    { title: 'Doanh thu', dataIndex: 'revenue', align: 'right', render: (value) => formatMoney(Number(value)) },
    { title: 'So don', dataIndex: 'orders', align: 'center' },
    { title: 'Trung binh/don', dataIndex: 'avg_order_value', align: 'right', render: (value) => formatMoney(Number(value)) },
  ];

  return (
    <div className="command-center">
      {contextHolder}
      <section className="command-center-hero">
        <div className="command-center-hero-grid">
          <div>
            <div className="command-center-eyebrow">Commercial analytics · Revenue · Conversion</div>
            <div className="command-center-title">Trung tam phan tich ban hang</div>
            <div className="command-center-description">
              Mot workspace de doi sales va management nhin ngay doanh thu, nhip don hang, quote conversion va nhom khach hang hay san pham dang keo ket qua.
            </div>

            <div className="command-center-hero-badges">
              <div className="command-center-hero-badge">
                <RiseOutlined />
                <span>Doanh thu</span>
                <span className="command-center-hero-badge-value">{formatMoney(summary.totalRevenue)}</span>
              </div>
              <div className="command-center-hero-badge">
                <ShoppingCartOutlined />
                <span>Don hang</span>
                <span className="command-center-hero-badge-value">{summary.totalOrders}</span>
              </div>
              <div className="command-center-hero-badge">
                <ShopOutlined />
                <span>Quote conversion</span>
                <span className="command-center-hero-badge-value">{summary.conversionRate.toFixed(1)}%</span>
              </div>
            </div>

            <div className="command-center-hero-actions" data-testid="sales-analytics-command-strip">
              <div data-testid="sales-analytics-range-preset">
                <DatePicker picker="week" open={false} style={{ display: 'none' }} />
              </div>
              <Tag style={{ marginInlineEnd: 0 }}>Quick range</Tag>
              <div data-testid="sales-analytics-range-select">
                <DatePicker.RangePicker open={false} style={{ display: 'none' }} />
              </div>
              <div data-testid="sales-analytics-range-mode">
                <select
                  value={rangePreset}
                  onChange={(event) => {
                    const nextPreset = event.target.value as RangePreset;
                    setRangePreset(nextPreset);
                    if (nextPreset !== 'custom') {
                      setDateRange(buildRangeFromPreset(nextPreset));
                    }
                  }}
                  style={{ height: 36, borderRadius: 8, border: '1px solid #d9d9d9', padding: '0 12px' }}
                >
                  <option value="rolling_3m">3 tháng gần nhất</option>
                  <option value="rolling_6m">6 tháng gần nhất</option>
                  <option value="rolling_12m">12 tháng gần nhất</option>
                  <option value="custom">Tùy chỉnh</option>
                </select>
              </div>
              <RangePicker
                value={dateRange}
                format="DD/MM/YYYY"
                onChange={(value) => {
                  if (value?.[0] && value?.[1]) {
                    setRangePreset('custom');
                    setDateRange([value[0], value[1]]);
                  }
                }}
              />
              <Button icon={<DownloadOutlined />} onClick={exportCsv}>
                Xuat CSV
              </Button>
            </div>
          </div>

          <div className="command-center-hero-meta">
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Gia tri don trung binh</div>
              <div className="command-center-hero-card-value">{formatMoney(summary.avgOrderValue)}</div>
              <div className="command-center-hero-card-caption">
                Tinh tren don da ghi so trong ky dang xem. Day la moc nhanh de danh gia chat luong pipeline.
              </div>
            </div>
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Canh bao giao hang</div>
              <div className="command-center-hero-card-value">{summary.overdueDelivery}</div>
              <div className="command-center-hero-card-caption">
                Don tre giao: {summary.overdueDelivery} · due today: {summary.dueToday} · due soon: {summary.dueSoon}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div
        className={`command-center-finance-alert ${
          workspaceAlert.tone === 'steady' ? 'command-center-finance-alert--steady' : 'command-center-finance-alert--warning'
        }`}
      >
        <div>
          <div className="command-center-finance-alert-title">{workspaceAlert.title}</div>
          <div className="command-center-finance-alert-description">{workspaceAlert.description}</div>
        </div>
        <Space wrap>
          <Tag color="processing">{`${startDate.format('DD/MM/YYYY')} - ${endDate.format('DD/MM/YYYY')}`}</Tag>
          <Tag color={summary.revenueGrowth >= 0 ? 'success' : 'error'}>{`Doanh thu ${summary.revenueGrowth >= 0 ? '+' : ''}${summary.revenueGrowth.toFixed(1)}%`}</Tag>
        </Space>
      </div>

      <div className="workspace-toolbar">
        <div className="workspace-toolbar-group">
          <Button data-testid="sales-analytics-save-view" onClick={() => void saveCurrentView()}>
            Lưu chế độ xem
          </Button>
          <Button data-testid="sales-analytics-restore-view" onClick={applySavedView}>
            Khôi phục
          </Button>
          <Button
            data-testid="sales-analytics-open-preset-modal"
            onClick={() => {
              setViewPresetName(selectedViewPreset?.name ?? '');
              setIsViewPresetModalOpen(true);
            }}
          >
            Tạo mẫu lọc
          </Button>
          <div data-testid="sales-analytics-preset-select">
            <Tag style={{ display: 'none' }}>preset</Tag>
            <select
              value={selectedViewPresetId ?? ''}
              onChange={(event) => setSelectedViewPresetId(event.target.value || undefined)}
              style={{ height: 36, minWidth: 240, borderRadius: 8, border: '1px solid #d9d9d9', padding: '0 12px' }}
            >
              <option value="">Chọn mẫu lọc phân tích</option>
              {namedPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>
          <Button data-testid="sales-analytics-apply-preset" onClick={applyNamedPreset}>
            Áp dụng mẫu
          </Button>
          <Button danger data-testid="sales-analytics-delete-preset" onClick={() => void deleteNamedPreset()}>
            Xóa mẫu
          </Button>
        </div>
        <div className="workspace-toolbar-group">
          {activeContextTags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      </div>

      <div className="workspace-metric-grid">
        <div className="workspace-metric-card">
          <div className="workspace-metric-eyebrow">Tong doanh thu</div>
          <div className="workspace-metric-value">{formatMoney(summary.totalRevenue)}</div>
          <div className="workspace-metric-caption">Doanh thu cua don da ghi so trong khung thoi gian dang xem.</div>
        </div>
        <div className="workspace-metric-card">
          <div className="workspace-metric-eyebrow">Tong don hang</div>
          <div className="workspace-metric-value">{summary.totalOrders}</div>
          <div className="workspace-metric-caption">Tong don hang vao trong ky, bat ke trang thai.</div>
        </div>
        <div className="workspace-metric-card workspace-metric-card--warning">
          <div className="workspace-metric-eyebrow">Gia tri don TB</div>
          <div className="workspace-metric-value">{formatMoney(summary.avgOrderValue)}</div>
          <div className="workspace-metric-caption">Moc tham chieu de doi sales nhin chat luong pipeline.</div>
        </div>
        <div className="workspace-metric-card workspace-metric-card--steady">
          <div className="workspace-metric-eyebrow">Quote conversion</div>
          <div className="workspace-metric-value">{summary.conversionRate.toFixed(1)}%</div>
          <div className="workspace-metric-caption">Ty le bao gia da duoc chap nhan trong khung thoi gian.</div>
        </div>
      </div>

      <div className="command-center-grid">
        <section className="command-center-panel">
          <div className="command-center-panel-header">
            <div>
              <div className="command-center-panel-kicker">Priority signals</div>
              <div className="command-center-panel-title">Bo tin hieu doanh thu</div>
              <div className="command-center-panel-subtitle">
                Nhin ngay xu huong doanh thu, don hang va quote conversion de chot huong dieu phoi.
              </div>
            </div>
          </div>
          <div className="command-center-signal-grid">
            {signalCards.map((item) => (
              <div key={item.key} className={`command-center-signal-card command-center-signal-card--${item.tone}`}>
                <div className="command-center-card-head">
                  <div className="command-center-card-icon">{item.icon}</div>
                  <div className={`command-center-card-tone command-center-card-tone--${item.tone}`}>
                    {item.tone === 'critical' ? 'Can xu ly' : item.tone === 'warning' ? 'Theo doi' : 'On dinh'}
                  </div>
                </div>
                <div className="command-center-card-value">{item.value}</div>
                <div className="command-center-card-title">{item.title}</div>
                <div className="command-center-card-detail">{item.detail}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="command-center-panel">
          <div className="command-center-panel-header">
            <div>
              <div className="command-center-panel-kicker">Commercial watchlist</div>
              <div className="command-center-panel-title">Lane nhin nhanh</div>
              <div className="command-center-panel-subtitle">
                Hai nhom watchlist giup management chot nhanh ai dang keo doanh thu va san pham nao dang len nhiet.
              </div>
            </div>
          </div>
          <div className="command-center-watchlist">
            {topCustomers.slice(0, 3).map((row) => (
              <div key={row.id} className="command-center-watch-item">
                <div className="command-center-watch-title">{row.name}</div>
                <div className="command-center-watch-detail">{`${formatMoney(row.revenue)} VND · ${row.orders} don`}</div>
                <div className="workspace-inline-note">{`Tang truong ${row.growth >= 0 ? '+' : ''}${row.growth.toFixed(1)}% so voi ky truoc.`}</div>
              </div>
            ))}
            {topProducts.slice(0, 2).map((row) => (
              <div key={row.id} className="command-center-watch-item command-center-watch-item--warning">
                <div className="command-center-watch-title">{row.name}</div>
                <div className="command-center-watch-detail">{`${formatMoney(row.revenue)} VND · ${row.units.toLocaleString('vi-VN')} don vi`}</div>
                <div className="workspace-inline-note">{`Tang truong ${row.growth >= 0 ? '+' : ''}${row.growth.toFixed(1)}%.`}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="workspace-split-grid">
        <section className="command-center-panel">
          <div className="command-center-panel-header">
            <div>
              <div className="command-center-panel-kicker">Customer leaderboard</div>
              <div className="command-center-panel-title">Top khach hang</div>
              <div className="command-center-panel-subtitle">
                Nhom khach hang dang dong gop doanh thu nhieu nhat trong ky.
              </div>
            </div>
          </div>
          <Table
            columns={customerColumns}
            dataSource={topCustomers}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: 560 }}
            loading={analyticsQuery.isLoading}
            locale={{ emptyText: 'Chua co du lieu khach hang.' }}
          />
        </section>

        <section className="command-center-panel">
          <div className="command-center-panel-header">
            <div>
              <div className="command-center-panel-kicker">Product movers</div>
              <div className="command-center-panel-title">Top san pham</div>
              <div className="command-center-panel-subtitle">
                Nhom san pham dang keo doanh thu va san luong trong ky dang xem.
              </div>
            </div>
          </div>
          <Table
            columns={productColumns}
            dataSource={topProducts}
            rowKey="id"
            pagination={false}
            size="small"
            scroll={{ x: 620 }}
            loading={analyticsQuery.isLoading}
            locale={{ emptyText: 'Chua co du lieu san pham.' }}
          />
        </section>
      </div>

      <section className="command-center-panel">
        <div className="command-center-panel-header">
          <div>
            <div className="command-center-panel-kicker">Order status mix</div>
            <div className="command-center-panel-title">Doanh thu theo trang thai don hang</div>
            <div className="command-center-panel-subtitle">
              Dung lane nay de xem doanh thu dang nam o nhung trang thai nao va co bi ket o cho nao khong.
            </div>
          </div>
        </div>
        <Table
          columns={statusColumns}
          dataSource={statusBreakdown}
          rowKey="status"
          pagination={false}
          loading={analyticsQuery.isLoading}
          locale={{ emptyText: 'Chua co du lieu trang thai don hang.' }}
        />
      </section>

      <Modal
        title="Lưu mẫu lọc phân tích bán hàng"
        open={isViewPresetModalOpen}
        onCancel={() => {
          setIsViewPresetModalOpen(false);
          setViewPresetName('');
        }}
        onOk={() => void saveNamedPreset()}
        okText="Lưu mẫu"
        cancelText="Đóng"
      >
        <Input
          data-testid="sales-analytics-preset-name"
          value={viewPresetName}
          onChange={(event) => setViewPresetName(event.target.value)}
          placeholder="Ví dụ: 6 tháng gần nhất - cuối quý"
        />
      </Modal>
    </div>
  );
}
