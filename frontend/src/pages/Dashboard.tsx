import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Col, Progress, Row, Space, Spin, Tag, message } from 'antd';
import {
  BuildOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  DollarCircleOutlined,
  ShoppingCartOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { financeApi } from '../api/finance';
import { inventoryApi } from '../api/inventory';
import { productionApi } from '../api/production';
import { purchasingApi } from '../api/purchasing';
import { salesApi } from '../api/sales';
import { useUserPreferences } from '../hooks/useUserPreferences';
import {
  canAccessSalesOrders,
  canManageFinanceData,
  canManageInventoryData,
  canManageProductionData,
  canManagePurchasingData,
} from '../utils/authz';
import { PAGES } from '../utils/constants';
import { theme } from '../styles/theme';


function formatMoney(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  return `${Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0'} đ`;
}


function formatNumber(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString('vi-VN') : '0';
}


function safePercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}


const Dashboard = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const actionThrottleLockRef = useRef<boolean>(false);
  const actionThrottleTimerRef = useRef<number | null>(null);
  const runActionWithThrottle = (action: () => void): void => {
    if (actionThrottleLockRef.current) return;
    actionThrottleLockRef.current = true;
    if (actionThrottleTimerRef.current) {
      window.clearTimeout(actionThrottleTimerRef.current);
    }
    actionThrottleTimerRef.current = window.setTimeout(() => {
      actionThrottleLockRef.current = false;
      actionThrottleTimerRef.current = null;
    }, 500);
    action();
  };
  useEffect(() => {
    return () => {
      if (actionThrottleTimerRef.current) {
        window.clearTimeout(actionThrottleTimerRef.current);
        actionThrottleTimerRef.current = null;
      }
      actionThrottleLockRef.current = false;
    };
  }, []);

  const canViewSales = canAccessSalesOrders();
  const canManagePurchasing = canManagePurchasingData();
  const canManageProduction = canManageProductionData();
  const canManageInventory = canManageInventoryData();
  const canManageFinance = canManageFinanceData();

  const { config, saveConfig } = useUserPreferences(PAGES.DASHBOARD);

  const salesSummaryQuery = useQuery({
    queryKey: ['dashboard-sales-summary'],
    queryFn: () => salesApi.getOrderSummary(),
    enabled: canViewSales,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const purchasingSummaryQuery = useQuery({
    queryKey: ['dashboard-purchasing-summary'],
    queryFn: () => purchasingApi.getOrderSummary(),
    enabled: canManagePurchasing,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const productionSummaryQuery = useQuery({
    queryKey: ['dashboard-production-summary'],
    queryFn: () => productionApi.getOrderSummary(),
    enabled: canManageProduction,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const stockSummaryQuery = useQuery({
    queryKey: ['dashboard-stock-summary'],
    queryFn: () => inventoryApi.getStockSummary(),
    enabled: canManageInventory,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const receivableSummaryQuery = useQuery({
    queryKey: ['dashboard-receivable-summary'],
    queryFn: () => financeApi.getReceivableSummary(),
    enabled: canManageFinance,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const payableSummaryQuery = useQuery({
    queryKey: ['dashboard-payable-summary'],
    queryFn: () => financeApi.getPayableSummary(),
    enabled: canManageFinance,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const overdueOverviewQuery = useQuery({
    queryKey: ['dashboard-overdue-overview'],
    queryFn: () => financeApi.getAdvanceOverdueOverview(),
    enabled: canManageFinance,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const remindMutation = useMutation({
    mutationFn: () => financeApi.remindOverdueAdvances({ threshold_days: 90 }),
    onSuccess: (data) => {
      messageApi.success(`Đã gửi nhắc quá hạn: ${data.sent_count} người nhận`);
    },
    onError: () => {
      messageApi.error('Gửi nhắc quá hạn thất bại');
    },
  });

  const bucket90 = useMemo(
    () => overdueOverviewQuery.data?.buckets?.find((bucket) => bucket.threshold_days === 90),
    [overdueOverviewQuery.data?.buckets]
  );
  const overdue90Count = bucket90?.count ?? 0;
  const overdue90Amount = bucket90?.total_remaining ?? '0';
  const overdue90Signature = `${overdueOverviewQuery.data?.as_of || ''}|${overdue90Count}|${overdue90Amount}`;
  const ackData = (config as Record<string, unknown>)?.financeOverdueAck as
    | { signature?: string; ackedAt?: string }
    | undefined;
  const isAcked = overdue90Count > 0 && ackData?.signature === overdue90Signature;

  const salesSummary = salesSummaryQuery.data;
  const purchasingSummary = purchasingSummaryQuery.data;
  const productionSummary = productionSummaryQuery.data;
  const stockSummary = stockSummaryQuery.data;
  const receivableSummary = receivableSummaryQuery.data;
  const payableSummary = payableSummaryQuery.data;

  const metricCards = useMemo(() => {
    const cards: Array<{
      key: string;
      title: string;
      value: string;
      subtitle: string;
      color: string;
      icon: ReactNode;
      loading: boolean;
    }> = [];

    if (canViewSales) {
      const openSales = (salesSummary?.draft_count ?? 0) + (salesSummary?.submitted_count ?? 0) + (salesSummary?.approved_count ?? 0);
      cards.push({
        key: 'sales',
        title: 'Đơn bán đang mở',
        value: formatNumber(openSales),
        subtitle: `Chờ duyệt: ${formatNumber(salesSummary?.pending_approval_count)} | Giao quá hạn: ${formatNumber(salesSummary?.overdue_delivery_count)}`,
        color: theme.colors.primary,
        icon: <ShoppingCartOutlined style={{ fontSize: 22, color: theme.colors.primary }} />,
        loading: salesSummaryQuery.isLoading,
      });
    }

    if (canManagePurchasing) {
      cards.push({
        key: 'purchasing',
        title: 'Mua hàng chờ nhận',
        value: formatNumber(purchasingSummary?.waiting_receipt_count),
        subtitle: `Chờ duyệt: ${formatNumber(purchasingSummary?.pending_approval_count)} | Nhận quá hạn: ${formatNumber(purchasingSummary?.overdue_receipt_count)}`,
        color: theme.colors.warning,
        icon: <ShoppingCartOutlined style={{ fontSize: 22, color: theme.colors.warning }} />,
        loading: purchasingSummaryQuery.isLoading,
      });
    }

    if (canManageProduction) {
      cards.push({
        key: 'production',
        title: 'Lệnh sản xuất đang chạy',
        value: formatNumber(productionSummary?.active_count),
        subtitle: `Quá hạn kế hoạch: ${formatNumber(productionSummary?.overdue_plan_count)} | Còn lại: ${formatNumber(productionSummary?.active_remaining_qty)}`,
        color: theme.colors.info,
        icon: <BuildOutlined style={{ fontSize: 22, color: theme.colors.info }} />,
        loading: productionSummaryQuery.isLoading,
      });
    }

    if (canManageInventory) {
      cards.push({
        key: 'inventory',
        title: 'Cảnh báo tồn kho',
        value: formatNumber(stockSummary?.below_min_count),
        subtitle: `Tồn khả dụng: ${formatNumber(stockSummary?.total_available_qty)} | Dòng tồn: ${formatNumber(stockSummary?.stock_rows)}`,
        color: theme.colors.error,
        icon: <DatabaseOutlined style={{ fontSize: 22, color: theme.colors.error }} />,
        loading: stockSummaryQuery.isLoading,
      });
    }

    if (canManageFinance) {
      cards.push({
        key: 'receivables',
        title: 'Phải thu còn lại',
        value: formatMoney(receivableSummary?.remaining_amount),
        subtitle: `Quá hạn: ${formatMoney(receivableSummary?.overdue_amount)} | Chưa thu: ${formatNumber(receivableSummary?.open_count)}`,
        color: theme.colors.success,
        icon: <WalletOutlined style={{ fontSize: 22, color: theme.colors.success }} />,
        loading: receivableSummaryQuery.isLoading,
      });
      cards.push({
        key: 'payables',
        title: 'Phải trả còn lại',
        value: formatMoney(payableSummary?.remaining_amount),
        subtitle: `Quá hạn: ${formatMoney(payableSummary?.overdue_amount)} | Chưa chi: ${formatNumber(payableSummary?.open_count)}`,
        color: theme.colors.warning,
        icon: <DollarCircleOutlined style={{ fontSize: 22, color: theme.colors.warning }} />,
        loading: payableSummaryQuery.isLoading,
      });
    }

    return cards;
  }, [
    canManageFinance,
    canManageInventory,
    canManageProduction,
    canManagePurchasing,
    canViewSales,
    payableSummary,
    payableSummaryQuery.isLoading,
    productionSummary,
    productionSummaryQuery.isLoading,
    purchasingSummary,
    purchasingSummaryQuery.isLoading,
    receivableSummary,
    receivableSummaryQuery.isLoading,
    salesSummary,
    salesSummaryQuery.isLoading,
    stockSummary,
    stockSummaryQuery.isLoading,
  ]);

  const attentionItems = useMemo(() => {
    const items: Array<{ tone: 'danger' | 'warning' | 'ok'; title: string; detail: string }> = [];

    if (canViewSales && (salesSummary?.pending_approval_count ?? 0) > 0) {
      items.push({
        tone: 'warning',
        title: `${formatNumber(salesSummary?.pending_approval_count)} đơn bán đang chờ duyệt`,
        detail: 'Cần xử lý để chốt kế hoạch giao hàng và công nợ phải thu.',
      });
    }
    if (canViewSales && (salesSummary?.overdue_delivery_count ?? 0) > 0) {
      items.push({
        tone: 'danger',
        title: `${formatNumber(salesSummary?.overdue_delivery_count)} kế hoạch giao hàng đã quá hạn`,
        detail: 'Cần rà lại tồn kho, lịch giao và năng lực sản xuất.',
      });
    }
    if (canManagePurchasing && (purchasingSummary?.overdue_receipt_count ?? 0) > 0) {
      items.push({
        tone: 'danger',
        title: `${formatNumber(purchasingSummary?.overdue_receipt_count)} đơn mua quá hạn nhận hàng`,
        detail: 'Cần đẩy nhà cung cấp hoặc điều chỉnh kế hoạch vật tư.',
      });
    }
    if (canManageProduction && (productionSummary?.overdue_plan_count ?? 0) > 0) {
      items.push({
        tone: 'danger',
        title: `${formatNumber(productionSummary?.overdue_plan_count)} lệnh sản xuất quá hạn kế hoạch`,
        detail: 'Cần rà công đoạn tắc nghẽn và vật tư chưa cấp đủ.',
      });
    }
    if (canManageInventory && (stockSummary?.below_min_count ?? 0) > 0) {
      items.push({
        tone: 'warning',
        title: `${formatNumber(stockSummary?.below_min_count)} dòng tồn kho dưới định mức`,
        detail: 'Cần bổ sung mua hàng hoặc tái phân bổ cho các lệnh sắp chạy.',
      });
    }
    if (canManageFinance && (receivableSummary?.overdue_count ?? 0) > 0) {
      items.push({
        tone: 'danger',
        title: `${formatNumber(receivableSummary?.overdue_count)} khoản phải thu đã quá hạn`,
        detail: 'Cần thu tiền hoặc theo dõi công nợ khách hàng.',
      });
    }
    if (canManageFinance && (payableSummary?.overdue_count ?? 0) > 0) {
      items.push({
        tone: 'warning',
        title: `${formatNumber(payableSummary?.overdue_count)} khoản phải trả đã quá hạn`,
        detail: 'Cần cân đối dòng tiền và thanh toán nhà cung cấp.',
      });
    }
    if (items.length === 0) {
      items.push({
        tone: 'ok',
        title: 'Không có điểm nóng nghiêm trọng',
        detail: 'Các module đang ở trạng thái ổn định theo dữ liệu hiện tại.',
      });
    }
    return items;
  }, [
    canManageFinance,
    canManageInventory,
    canManageProduction,
    canManagePurchasing,
    canViewSales,
    payableSummary?.overdue_count,
    productionSummary?.overdue_plan_count,
    purchasingSummary?.overdue_receipt_count,
    receivableSummary?.overdue_count,
    salesSummary?.overdue_delivery_count,
    salesSummary?.pending_approval_count,
    stockSummary?.below_min_count,
  ]);

  const processStats = useMemo(() => {
    const stats: Array<{ label: string; value: string; percent: number; color: string }> = [];
    if (canViewSales) {
      stats.push({
        label: 'Đơn bán đã post',
        value: `${formatNumber(salesSummary?.posted_count)}/${formatNumber(salesSummary?.total_orders)}`,
        percent: safePercent(salesSummary?.posted_count ?? 0, salesSummary?.total_orders ?? 0),
        color: theme.colors.primary,
      });
    }
    if (canManagePurchasing) {
      stats.push({
        label: 'Đơn mua nhận đủ',
        value: `${formatNumber(purchasingSummary?.received_count)}/${formatNumber(purchasingSummary?.total_orders)}`,
        percent: safePercent(purchasingSummary?.received_count ?? 0, purchasingSummary?.total_orders ?? 0),
        color: theme.colors.warning,
      });
    }
    if (canManageProduction) {
      stats.push({
        label: 'Lệnh SX hoàn thành',
        value: `${formatNumber(productionSummary?.completed_count)}/${formatNumber(productionSummary?.total_orders)}`,
        percent: safePercent(productionSummary?.completed_count ?? 0, productionSummary?.total_orders ?? 0),
        color: theme.colors.success,
      });
    }
    if (canManageFinance) {
      stats.push({
        label: 'Thu tiền hoàn tất',
        value: `${formatNumber(receivableSummary?.settled_count)}/${formatNumber(receivableSummary?.count)}`,
        percent: safePercent(receivableSummary?.settled_count ?? 0, receivableSummary?.count ?? 0),
        color: theme.colors.info,
      });
    }
    return stats;
  }, [
    canManageFinance,
    canManageProduction,
    canManagePurchasing,
    canViewSales,
    productionSummary?.completed_count,
    productionSummary?.total_orders,
    purchasingSummary?.received_count,
    purchasingSummary?.total_orders,
    receivableSummary?.count,
    receivableSummary?.settled_count,
    salesSummary?.posted_count,
    salesSummary?.total_orders,
  ]);

  return (
    <div>
      {contextHolder}
      <Card
        bordered={false}
        style={{
          marginBottom: theme.spacing.lg,
          borderRadius: theme.borderRadius.lg,
          background: `linear-gradient(135deg, ${theme.colors.primary} 0%, ${theme.colors.primaryActive} 100%)`,
          color: 'white',
        }}
      >
        <div style={{ padding: theme.spacing.md }}>
          <h1
            style={{
              color: 'white',
              marginBottom: theme.spacing.sm,
              fontSize: theme.typography.fontSize.xxl,
              fontWeight: theme.typography.fontWeight.bold,
            }}
          >
            Tổng quan điều hành ERP Carton
          </h1>
          <p
            style={{
              color: 'rgba(255, 255, 255, 0.9)',
              fontSize: theme.typography.fontSize.md,
              margin: 0,
            }}
          >
            Theo dõi tức thời bán hàng, mua hàng, sản xuất, tồn kho và công nợ trên cùng một màn hình.
          </p>
        </div>
      </Card>

      {canManageFinance && (
        <Card
          bordered={false}
          style={{
            marginBottom: theme.spacing.lg,
            borderRadius: theme.borderRadius.lg,
            boxShadow: theme.shadows.sm,
            border: `1px solid ${overdue90Count > 0 ? '#ffccc7' : '#d9f7be'}`,
          }}
        >
          {overdueOverviewQuery.isLoading ? (
            <div style={{ textAlign: 'center', padding: theme.spacing.md }}>
              <Spin />
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.semibold }}>
                  Cảnh báo tạm ứng quá hạn từ 90 ngày
                </div>
                <div style={{ color: theme.colors.textSecondary }}>
                  {`Số phiếu: ${overdue90Count} | Tổng còn phải quyết toán: ${formatMoney(overdue90Amount)}`}
                </div>
                <div style={{ marginTop: 6 }}>
                  {overdue90Count <= 0 ? (
                    <Tag color="success">Không có rủi ro mức 90 ngày</Tag>
                  ) : isAcked ? (
                    <Tag color="blue">Đã xác nhận xử lý hôm nay</Tag>
                  ) : (
                    <Tag color="red">Chưa xác nhận xử lý</Tag>
                  )}
                </div>
              </div>
              <Space>
                <Button
                  disabled={overdue90Count <= 0}
                  onClick={() => {
                    runActionWithThrottle(() => {
                      void (async () => {
                        try {
                          await saveConfig({
                            ...(config as Record<string, unknown>),
                            financeOverdueAck: {
                              signature: overdue90Signature,
                              ackedAt: new Date().toISOString(),
                            },
                          });
                          messageApi.success('Đã xác nhận đã xử lý cảnh báo quá hạn');
                        } catch {
                          messageApi.error('Lưu trạng thái xác nhận thất bại');
                        }
                      })();
                    });
                  }}
                >
                  Đã xử lý
                </Button>
                <Button
                  type="primary"
                  danger={overdue90Count > 0}
                  loading={remindMutation.isPending}
                  disabled={overdue90Count <= 0}
                  onClick={() => runActionWithThrottle(() => remindMutation.mutate())}
                >
                  Gửi nhắc ngay
                </Button>
              </Space>
            </div>
          )}
        </Card>
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: theme.spacing.lg }}>
        {metricCards.map((card) => (
          <Col key={card.key} xs={24} sm={12} xl={8}>
            <Card
              bordered={false}
              loading={card.loading}
              style={{
                borderRadius: theme.borderRadius.lg,
                boxShadow: theme.shadows.sm,
                height: '100%',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.textSecondary, marginBottom: 6 }}>
                    {card.title}
                  </div>
                  <div style={{ fontSize: theme.typography.fontSize.xxl, fontWeight: theme.typography.fontWeight.bold, color: card.color }}>
                    {card.value}
                  </div>
                  <div style={{ marginTop: 6, fontSize: theme.typography.fontSize.xs, color: theme.colors.textSecondary }}>
                    {card.subtitle}
                  </div>
                </div>
                <div>{card.icon}</div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title="Điểm Nóng Cần Xử Lý"
            bordered={false}
            style={{
              borderRadius: theme.borderRadius.lg,
              boxShadow: theme.shadows.sm,
              height: '100%',
            }}
          >
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              {attentionItems.map((item, index) => (
                <div
                  key={`${item.title}-${index}`}
                  style={{
                    padding: 12,
                    borderRadius: theme.borderRadius.md,
                    border: `1px solid ${
                      item.tone === 'danger' ? '#ffccc7' : item.tone === 'warning' ? '#ffe58f' : '#b7eb8f'
                    }`,
                    background:
                      item.tone === 'danger' ? '#fff2f0' : item.tone === 'warning' ? '#fffbe6' : '#f6ffed',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {item.tone === 'danger' ? (
                      <ClockCircleOutlined style={{ color: theme.colors.error }} />
                    ) : item.tone === 'warning' ? (
                      <ClockCircleOutlined style={{ color: theme.colors.warning }} />
                    ) : (
                      <CheckCircleOutlined style={{ color: theme.colors.success }} />
                    )}
                    <span style={{ fontWeight: theme.typography.fontWeight.semibold }}>{item.title}</span>
                  </div>
                  <div style={{ color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.sm }}>
                    {item.detail}
                  </div>
                </div>
              ))}
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            title="Tiến Độ Vận Hành"
            bordered={false}
            style={{
              borderRadius: theme.borderRadius.lg,
              boxShadow: theme.shadows.sm,
              height: '100%',
            }}
          >
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              {processStats.map((item) => (
                <div key={item.label}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: theme.spacing.xs,
                    }}
                  >
                    <span style={{ color: theme.colors.textSecondary }}>{item.label}</span>
                    <span
                      style={{
                        fontWeight: theme.typography.fontWeight.semibold,
                        color: item.color,
                      }}
                    >
                      {item.value}
                    </span>
                  </div>
                  <Progress percent={item.percent} strokeColor={item.color} showInfo={false} />
                </div>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;
