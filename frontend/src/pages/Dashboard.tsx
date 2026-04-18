import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRightOutlined,
  BellOutlined,
  BuildOutlined,
  ControlOutlined,
  DatabaseOutlined,
  DollarCircleOutlined,
  InboxOutlined,
  SafetyOutlined,
  ShoppingCartOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Button, Progress, Spin, Tag, message } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { financeApi } from '../api/finance';
import { inventoryApi } from '../api/inventory';
import { notificationsApi } from '../api/notifications';
import { operationsApi } from '../api/operations';
import { productionApi } from '../api/production';
import { purchasingApi } from '../api/purchasing';
import { salesApi } from '../api/sales';
import { tasksApi } from '../api/tasks';
import { workforceApi } from '../api/workforce';
import { useUserPreferences } from '../hooks/useUserPreferences';
import {
  canAccessSalesOrders,
  canManageFinanceData,
  canManageInventoryData,
  canManageProductionData,
  canManagePurchasingData,
  canManageWorkforceData,
  canViewOpsHub,
  canViewReportsCenter,
  canViewWorkflowData,
} from '../utils/authz';
import { PAGES } from '../utils/constants';
import { theme } from '../styles/theme';

type Tone = 'critical' | 'warning' | 'steady';

type DashboardCard = {
  key: string;
  title: string;
  value: string;
  detail: string;
  route: string;
  actionLabel: string;
  tone: Tone;
  icon: ReactNode;
  priority: number;
};

type ShortcutCard = {
  key: string;
  title: string;
  badge: string;
  description: string;
  route: string;
  actionLabel: string;
};

type PlaybookItem = {
  key: string;
  title: string;
  detail: string;
  route: string;
  tone: Tone;
};

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

function toneLabel(tone: Tone): string {
  if (tone === 'critical') return 'Can xu ly';
  if (tone === 'warning') return 'Can theo doi';
  return 'On track';
}

function toneWeight(tone: Tone): number {
  if (tone === 'critical') return 3;
  if (tone === 'warning') return 2;
  return 1;
}

function PanelSection({
  kicker,
  title,
  subtitle,
  extra,
  children,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="command-center-panel">
      <div className="command-center-panel-header">
        <div>
          <div className="command-center-panel-kicker">{kicker}</div>
          <div className="command-center-panel-title">{title}</div>
          <div className="command-center-panel-subtitle">{subtitle}</div>
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const [now, setNow] = useState(() => dayjs());
  const actionThrottleLockRef = useRef(false);
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
    const timerId = window.setInterval(() => setNow(dayjs()), 60_000);
    return () => window.clearInterval(timerId);
  }, []);

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
  const canManageWorkforce = canManageWorkforceData();
  const canViewReports = canViewReportsCenter();
  const canViewOps = canViewOpsHub();
  const canViewWorkflow = canViewWorkflowData();

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
  const taskSummaryQuery = useQuery({
    queryKey: ['dashboard-task-summary'],
    queryFn: () => tasksApi.mySummary(),
    staleTime: 20_000,
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
  });
  const notificationCountQuery = useQuery({
    queryKey: ['dashboard-notification-count'],
    queryFn: () => notificationsApi.unreadCount(),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const operationsMetaQuery = useQuery({
    queryKey: ['dashboard-operations-log-meta'],
    queryFn: () => operationsApi.meta(),
    enabled: canViewOps,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const salaryAdvanceQueueQuery = useQuery({
    queryKey: ['dashboard-salary-advance-approval-queue'],
    queryFn: () => workforceApi.getSalaryAdvanceApprovalQueue(),
    enabled: canManageWorkforce,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const remindMutation = useMutation({
    mutationFn: () => financeApi.remindOverdueAdvances({ threshold_days: 90 }),
    onSuccess: (data) => {
      messageApi.success(`Đã gửi nhắc quá hạn tới ${data.sent_count} người nhận.`);
    },
    onError: () => {
      messageApi.error('Gửi nhắc quá hạn thất bại.');
    },
  });

  const salesSummary = salesSummaryQuery.data;
  const purchasingSummary = purchasingSummaryQuery.data;
  const productionSummary = productionSummaryQuery.data;
  const stockSummary = stockSummaryQuery.data;
  const receivableSummary = receivableSummaryQuery.data;
  const payableSummary = payableSummaryQuery.data;
  const taskSummary = taskSummaryQuery.data;
  const unreadCount = notificationCountQuery.data?.count ?? 0;
  const operationsFailedCount = operationsMetaQuery.data?.recent_failed_count_24h ?? 0;
  const salaryAdvancePendingCount =
    (salaryAdvanceQueueQuery.data?.pending_l1_count ?? 0)
    + (salaryAdvanceQueueQuery.data?.pending_l2_count ?? 0);

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

  const handleAcknowledgeOverdue = () => {
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
          messageApi.success('Đã xác nhận xử lý cảnh báo tạm ứng quá hạn.');
        } catch {
          messageApi.error('Lưu trạng thái xác nhận thất bại.');
        }
      })();
    });
  };

  const signalCards = useMemo<DashboardCard[]>(() => {
    const cards: DashboardCard[] = [
      {
        key: 'tasks',
        title: 'Hộp nhiệm vụ quá hạn',
        value: formatNumber(taskSummary?.overdue),
        detail: `Đang giao cho tôi: ${formatNumber(taskSummary?.assigned_to_me)} | Theo dõi: ${formatNumber(taskSummary?.watching)}`,
        route: '/task-inbox',
        actionLabel: 'Mở hộp nhiệm vụ',
        tone: (taskSummary?.overdue ?? 0) > 0 ? 'critical' : (taskSummary?.assigned_to_me ?? 0) > 0 ? 'warning' : 'steady',
        icon: <InboxOutlined />,
        priority: (taskSummary?.overdue ?? 0) * 4 + (taskSummary?.assigned_to_me ?? 0),
      },
      {
        key: 'notifications',
        title: 'Thông báo chưa đọc',
        value: formatNumber(unreadCount),
        detail: unreadCount > 0
          ? 'Có cập nhật đang chờ phản hồi từ các luồng công việc liên phòng ban.'
          : 'Không có cảnh báo mới trong trung tâm thông báo.',
        route: '/notifications',
        actionLabel: 'Xem trung tâm thông báo',
        tone: unreadCount >= 10 ? 'critical' : unreadCount > 0 ? 'warning' : 'steady',
        icon: <BellOutlined />,
        priority: unreadCount * 2,
      },
    ];

    if (canManageFinance) {
      cards.push({
        key: 'finance-overdue',
        title: 'Tạm ứng quá hạn 90+',
        value: formatNumber(overdue90Count),
        detail: `Tổng còn phải quyết toán: ${formatMoney(overdue90Amount)}`,
        route: '/advance-transactions',
        actionLabel: 'Vào command center tạm ứng',
        tone: overdue90Count > 0 ? 'critical' : 'steady',
        icon: <WalletOutlined />,
        priority: overdue90Count * 5,
      });
    }

    if (canManageWorkforce) {
      cards.push({
        key: 'salary-advance-approval',
        title: 'Ứng lương chờ duyệt',
        value: formatNumber(salaryAdvancePendingCount),
        detail: salaryAdvancePendingCount > 0
          ? 'Có hồ sơ đang chờ duyệt trong hàng đợi SLA nhân sự.'
          : 'Không có hồ sơ ứng lương đang chờ duyệt.',
        route: '/salary-advance',
        actionLabel: 'Mở trung tâm ứng lương',
        tone: salaryAdvancePendingCount >= 5 ? 'critical' : salaryAdvancePendingCount > 0 ? 'warning' : 'steady',
        icon: <SafetyOutlined />,
        priority: salaryAdvancePendingCount * 3,
      });
    }

    if (canViewOps) {
      cards.push({
        key: 'operations-log',
        title: 'Sự cố vận hành 24h',
        value: formatNumber(operationsFailedCount),
        detail: operationsFailedCount > 0
          ? 'Có sự kiện thất bại cần drilldown trong nhật ký vận hành.'
          : 'Nhật ký vận hành không ghi nhận lỗi nổi bật trong 24 giờ gần nhất.',
        route: '/operations-log',
        actionLabel: 'Mở operations log',
        tone: operationsFailedCount > 0 ? 'critical' : 'steady',
        icon: <ControlOutlined />,
        priority: operationsFailedCount * 4,
      });
    }

    return cards.sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      return toneWeight(right.tone) - toneWeight(left.tone);
    });
  }, [
    canManageFinance,
    canManageWorkforce,
    canViewOps,
    operationsFailedCount,
    overdue90Amount,
    overdue90Count,
    salaryAdvancePendingCount,
    taskSummary?.assigned_to_me,
    taskSummary?.overdue,
    taskSummary?.watching,
    unreadCount,
  ]);

  const shortcutCards = useMemo<ShortcutCard[]>(() => {
    const cards: ShortcutCard[] = [
      {
        key: 'task-inbox',
        title: 'Hộp nhiệm vụ',
        badge: formatNumber(taskSummary?.assigned_to_me),
        description: 'Đi thẳng tới hàng việc cá nhân, việc theo dõi và các task cần hỗ trợ.',
        route: '/task-inbox',
        actionLabel: 'Mở workspace',
      },
      {
        key: 'notifications',
        title: 'Trung tâm thông báo',
        badge: formatNumber(unreadCount),
        description: 'Theo dõi nhắc việc, approval request và cập nhật mới nhất từ toàn hệ thống.',
        route: '/notifications',
        actionLabel: 'Xem cập nhật',
      },
    ];

    if (canViewReports) {
      cards.push({
        key: 'reports',
        title: 'Trung tâm báo cáo',
        badge: 'Live',
        description: 'Kéo nhanh các báo cáo tổng hợp để chốt phiên điều hành và chia sẻ lãnh đạo.',
        route: '/reports',
        actionLabel: 'Mở reports center',
      });
    }

    if (canViewOps) {
      cards.push({
        key: 'executive-cockpit',
        title: 'Điều hành tổng hợp',
        badge: formatNumber(operationsFailedCount),
        description: 'Hợp nhất các command center vận hành, sự cố và các điểm nóng cần phối hợp.',
        route: '/executive-cockpit',
        actionLabel: 'Mở cockpit',
      });
    }

    if (canViewWorkflow) {
      cards.push({
        key: 'workflow-pipeline',
        title: 'Workflow pipeline',
        badge: 'Flow',
        description: 'Theo dõi pipeline công việc và các luồng đang nghẽn theo từng giai đoạn.',
        route: '/workflow-pipeline',
        actionLabel: 'Xem pipeline',
      });
    }

    if (canManageProduction) {
      cards.push({
        key: 'paper-optimization',
        title: 'Tối ưu ghép giấy',
        badge: 'Baseline',
        description: 'Mở ngay workspace ghép giấy để xem phương án mua cuối, so sánh 4 phương án và tải workbook chuẩn.',
        route: '/paper-optimization',
        actionLabel: 'Mở tối ưu ghép giấy',
      });
    }

    return cards.slice(0, canManageProduction ? 6 : 5);
  }, [
    canManageProduction,
    canViewOps,
    canViewReports,
    canViewWorkflow,
    operationsFailedCount,
    taskSummary?.assigned_to_me,
    unreadCount,
  ]);

  const moduleCards = useMemo<DashboardCard[]>(() => {
    const cards: DashboardCard[] = [];

    if (canViewSales) {
      const openSales = (salesSummary?.draft_count ?? 0) + (salesSummary?.submitted_count ?? 0) + (salesSummary?.approved_count ?? 0);
      const tone: Tone = (salesSummary?.overdue_delivery_count ?? 0) > 0
        ? 'critical'
        : (salesSummary?.pending_approval_count ?? 0) > 0
          ? 'warning'
          : 'steady';
      cards.push({
        key: 'sales',
        title: 'Đơn hàng xuất',
        value: formatNumber(openSales),
        detail: `Chờ duyệt: ${formatNumber(salesSummary?.pending_approval_count)} | Giao quá hạn: ${formatNumber(salesSummary?.overdue_delivery_count)}`,
        route: '/sales-orders',
        actionLabel: 'Mở sales order center',
        tone,
        icon: <ShoppingCartOutlined style={{ color: theme.colors.primary }} />,
        priority: (salesSummary?.overdue_delivery_count ?? 0) * 4 + openSales,
      });
    }

    if (canManagePurchasing) {
      const tone: Tone = (purchasingSummary?.overdue_receipt_count ?? 0) > 0
        ? 'critical'
        : (purchasingSummary?.pending_approval_count ?? 0) > 0
          ? 'warning'
          : 'steady';
      cards.push({
        key: 'purchasing',
        title: 'Đơn mua chờ nhận',
        value: formatNumber(purchasingSummary?.waiting_receipt_count),
        detail: `Chờ duyệt: ${formatNumber(purchasingSummary?.pending_approval_count)} | Quá hạn nhận: ${formatNumber(purchasingSummary?.overdue_receipt_count)}`,
        route: '/purchase-orders',
        actionLabel: 'Mở purchase center',
        tone,
        icon: <ShoppingCartOutlined style={{ color: theme.colors.warning }} />,
        priority: (purchasingSummary?.overdue_receipt_count ?? 0) * 4 + (purchasingSummary?.waiting_receipt_count ?? 0),
      });
    }

    if (canManageProduction) {
      const tone: Tone = (productionSummary?.overdue_plan_count ?? 0) > 0 ? 'critical' : (productionSummary?.active_count ?? 0) > 0 ? 'warning' : 'steady';
      cards.push({
        key: 'production',
        title: 'Lệnh sản xuất đang chạy',
        value: formatNumber(productionSummary?.active_count),
        detail: `Quá hạn kế hoạch: ${formatNumber(productionSummary?.overdue_plan_count)} | Còn lại: ${formatNumber(productionSummary?.active_remaining_qty)}`,
        route: '/production-orders',
        actionLabel: 'Mở production center',
        tone,
        icon: <BuildOutlined style={{ color: theme.colors.info }} />,
        priority: (productionSummary?.overdue_plan_count ?? 0) * 4 + (productionSummary?.active_count ?? 0),
      });
    }

    if (canManageInventory) {
      const belowMin = stockSummary?.below_min_count ?? 0;
      cards.push({
        key: 'inventory',
        title: 'Cảnh báo tồn kho',
        value: formatNumber(belowMin),
        detail: `Tồn khả dụng: ${formatNumber(stockSummary?.total_available_qty)} | Dòng tồn: ${formatNumber(stockSummary?.stock_rows)}`,
        route: '/inventory-stock',
        actionLabel: 'Mở inventory center',
        tone: belowMin > 20 ? 'critical' : belowMin > 0 ? 'warning' : 'steady',
        icon: <DatabaseOutlined style={{ color: theme.colors.error }} />,
        priority: belowMin * 3,
      });
    }

    if (canManageFinance) {
      cards.push({
        key: 'receivables',
        title: 'Công nợ phải thu',
        value: formatMoney(receivableSummary?.remaining_amount),
        detail: `Quá hạn: ${formatMoney(receivableSummary?.overdue_amount)} | Chưa thu: ${formatNumber(receivableSummary?.open_count)}`,
        route: '/receivables',
        actionLabel: 'Mở AR center',
        tone: (receivableSummary?.overdue_count ?? 0) > 0 ? 'critical' : 'steady',
        icon: <WalletOutlined style={{ color: theme.colors.success }} />,
        priority: (receivableSummary?.overdue_count ?? 0) * 4 + (receivableSummary?.open_count ?? 0),
      });
      cards.push({
        key: 'payables',
        title: 'Công nợ phải trả',
        value: formatMoney(payableSummary?.remaining_amount),
        detail: `Quá hạn: ${formatMoney(payableSummary?.overdue_amount)} | Chưa chi: ${formatNumber(payableSummary?.open_count)}`,
        route: '/payables',
        actionLabel: 'Mở AP center',
        tone: (payableSummary?.overdue_count ?? 0) > 0 ? 'warning' : 'steady',
        icon: <DollarCircleOutlined style={{ color: theme.colors.warning }} />,
        priority: (payableSummary?.overdue_count ?? 0) * 2 + (payableSummary?.open_count ?? 0),
      });
    }

    return cards.sort((left, right) => {
      if (toneWeight(right.tone) !== toneWeight(left.tone)) {
        return toneWeight(right.tone) - toneWeight(left.tone);
      }
      return right.priority - left.priority;
    });
  }, [
    canManageFinance,
    canManageInventory,
    canManageProduction,
    canManagePurchasing,
    canViewSales,
    payableSummary?.open_count,
    payableSummary?.overdue_amount,
    payableSummary?.overdue_count,
    payableSummary?.remaining_amount,
    productionSummary?.active_count,
    productionSummary?.active_remaining_qty,
    productionSummary?.overdue_plan_count,
    purchasingSummary?.overdue_receipt_count,
    purchasingSummary?.pending_approval_count,
    purchasingSummary?.waiting_receipt_count,
    receivableSummary?.open_count,
    receivableSummary?.overdue_amount,
    receivableSummary?.overdue_count,
    receivableSummary?.remaining_amount,
    salesSummary?.approved_count,
    salesSummary?.draft_count,
    salesSummary?.overdue_delivery_count,
    salesSummary?.pending_approval_count,
    salesSummary?.submitted_count,
    stockSummary?.below_min_count,
    stockSummary?.stock_rows,
    stockSummary?.total_available_qty,
  ]);

  const watchlistItems = useMemo(() => {
    const items: Array<{ tone: Tone; title: string; detail: string }> = [];

    if (canViewSales && (salesSummary?.pending_approval_count ?? 0) > 0) {
      items.push({
        tone: 'warning',
        title: `${formatNumber(salesSummary?.pending_approval_count)} đơn bán đang chờ duyệt`,
        detail: 'Cần chốt duyệt để không làm trễ kế hoạch giao hàng và dòng tiền phải thu.',
      });
    }
    if (canViewSales && (salesSummary?.overdue_delivery_count ?? 0) > 0) {
      items.push({
        tone: 'critical',
        title: `${formatNumber(salesSummary?.overdue_delivery_count)} kế hoạch giao hàng đã quá hạn`,
        detail: 'Rà lại reservation tồn, năng lực sản xuất và lịch xuất hàng trong ngày.',
      });
    }
    if (canManagePurchasing && (purchasingSummary?.overdue_receipt_count ?? 0) > 0) {
      items.push({
        tone: 'critical',
        title: `${formatNumber(purchasingSummary?.overdue_receipt_count)} đơn mua quá hạn nhận hàng`,
        detail: 'Đẩy theo nhà cung cấp hoặc điều chỉnh lại kế hoạch vật tư để tránh nghẽn sản xuất.',
      });
    }
    if (canManageProduction && (productionSummary?.overdue_plan_count ?? 0) > 0) {
      items.push({
        tone: 'critical',
        title: `${formatNumber(productionSummary?.overdue_plan_count)} lệnh sản xuất quá hạn`,
        detail: 'Ưu tiên bóc tách công đoạn nghẽn, thiếu vật tư và các lệnh cần can thiệp ngay.',
      });
    }
    if (canManageInventory && (stockSummary?.below_min_count ?? 0) > 0) {
      items.push({
        tone: 'warning',
        title: `${formatNumber(stockSummary?.below_min_count)} dòng tồn kho dưới định mức`,
        detail: 'Cần bổ sung, điều chuyển hoặc tái ưu tiên reservation cho các đơn đang nóng.',
      });
    }
    if (canManageFinance && (receivableSummary?.overdue_count ?? 0) > 0) {
      items.push({
        tone: 'critical',
        title: `${formatNumber(receivableSummary?.overdue_count)} khoản phải thu đã quá hạn`,
        detail: 'Thu tiền hoặc escalated follow-up để bảo toàn dòng tiền trong kỳ vận hành hiện tại.',
      });
    }
    if (canManageFinance && (payableSummary?.overdue_count ?? 0) > 0) {
      items.push({
        tone: 'warning',
        title: `${formatNumber(payableSummary?.overdue_count)} khoản phải trả đã quá hạn`,
        detail: 'Cân đối thanh toán để giữ cam kết với nhà cung cấp nhưng không phá kế hoạch dòng tiền.',
      });
    }

    if (items.length === 0) {
      items.push({
        tone: 'steady',
        title: 'Không có điểm nóng nghiêm trọng',
        detail: 'Các module đang ở trạng thái ổn định theo dữ liệu hiện tại và chưa ghi nhận nghẽn lớn.',
      });
    }

    return items.slice(0, 6);
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

  const operatingMode = useMemo(() => {
    const weightedScore =
      (overdue90Count > 0 ? 3 : 0)
      + ((taskSummary?.overdue ?? 0) > 0 ? 2 : 0)
      + (operationsFailedCount > 0 ? 3 : 0)
      + ((receivableSummary?.overdue_count ?? 0) > 0 ? 2 : 0)
      + (salaryAdvancePendingCount > 0 ? 1 : 0)
      + (unreadCount > 0 ? 1 : 0);

    if (weightedScore >= 7) {
      return {
        tone: 'critical' as Tone,
        label: 'Intervention mode',
        detail: 'Có nhiều luồng cần can thiệp nhanh để không lan sang giao hàng, tiền và SLA.',
      };
    }
    if (weightedScore >= 3) {
      return {
        tone: 'warning' as Tone,
        label: 'Priority control',
        detail: 'Có điểm nóng cần giữ nhịp điều phối nhưng chưa đến mức quá tải vận hành.',
      };
    }
    return {
      tone: 'steady' as Tone,
      label: 'Stable flow',
      detail: 'Vận hành đang ổn định, phù hợp để tăng tốc xử lý và chốt báo cáo.',
    };
  }, [
    operationsFailedCount,
    overdue90Count,
    receivableSummary?.overdue_count,
    salaryAdvancePendingCount,
    taskSummary?.overdue,
    unreadCount,
  ]);

  const overallExecution = useMemo(() => {
    if (processStats.length === 0) return 0;
    return Math.round(processStats.reduce((sum, item) => sum + item.percent, 0) / processStats.length);
  }, [processStats]);

  const hotSignalCount = useMemo(
    () => signalCards.filter((card) => card.tone !== 'steady' && card.value !== '0').length,
    [signalCards]
  );

  const heroBadges = useMemo(
    () => [
      { key: 'mode', value: operatingMode.label, label: 'trạng thái vận hành' },
      { key: 'signals', value: formatNumber(hotSignalCount), label: 'luồng cần ưu tiên' },
      { key: 'execution', value: `${overallExecution}%`, label: 'độ phủ thực thi' },
    ],
    [hotSignalCount, operatingMode.label, overallExecution]
  );

  const heroScoreCards = useMemo(
    () => [
      {
        key: 'modules',
        label: 'Modules ready',
        value: formatNumber(moduleCards.length),
        caption: 'điểm điều hành đang mở theo quyền hiện tại',
      },
      {
        key: 'tasks',
        label: 'Assigned tasks',
        value: formatNumber(taskSummary?.assigned_to_me),
        caption: 'task đang giao cho tôi trong workspace',
      },
      {
        key: 'alerts',
        label: 'Hot signals',
        value: formatNumber(hotSignalCount),
        caption: 'dấu hiệu cần theo dõi xuyên phòng ban',
      },
      {
        key: 'updates',
        label: 'Unread updates',
        value: formatNumber(unreadCount),
        caption: 'cập nhật chưa đọc trong notification center',
      },
    ],
    [hotSignalCount, moduleCards.length, taskSummary?.assigned_to_me, unreadCount]
  );

  const playbookItems = useMemo<PlaybookItem[]>(() => {
    const items: PlaybookItem[] = [];

    if (overdue90Count > 0) {
      items.push({
        key: 'finance-overdue',
        title: 'Khóa backlog tạm ứng trên 90 ngày',
        detail: 'Xác nhận người phụ trách, gửi nhắc ngay và ưu tiên quyết toán trong cùng phiên.',
        route: '/advance-transactions',
        tone: 'critical',
      });
    }
    if ((taskSummary?.overdue ?? 0) > 0) {
      items.push({
        key: 'tasks-overdue',
        title: 'Triaging nhiệm vụ quá hạn trước cuối ca',
        detail: 'Đi thẳng vào quick queue để xử lý việc đã vượt SLA và gỡ nghẽn cho luồng kế tiếp.',
        route: '/task-inbox',
        tone: 'critical',
      });
    }
    if (canViewOps && operationsFailedCount > 0) {
      items.push({
        key: 'operations-log',
        title: 'Drilldown sự cố vận hành trong 24 giờ',
        detail: 'Khoanh vùng lỗi gần nhất, actor liên quan và phạm vi ảnh hưởng trước khi leo thang.',
        route: '/operations-log',
        tone: 'critical',
      });
    }
    if (canManagePurchasing && (purchasingSummary?.overdue_receipt_count ?? 0) > 0) {
      items.push({
        key: 'purchasing-followup',
        title: 'Đẩy theo các đơn mua quá hạn nhận',
        detail: 'Kiểm tra PO quá hạn và phân loại đơn nào đang ảnh hưởng trực tiếp tới kế hoạch sản xuất.',
        route: '/purchase-orders',
        tone: 'warning',
      });
    }
    if (canViewReports) {
      items.push({
        key: 'reports',
        title: 'Chốt snapshot điều hành bằng báo cáo nhanh',
        detail: 'Tạo một ảnh chụp trạng thái cuối phiên để chia sẻ với quản lý hoặc lãnh đạo ca.',
        route: '/reports',
        tone: 'steady',
      });
    }
    if (canViewWorkflow) {
      items.push({
        key: 'workflow',
        title: 'Kiểm tra pipeline có dấu hiệu nghẽn',
        detail: 'Mở workflow pipeline để xem stage nào đang chặn công việc và phân phối lại nguồn lực.',
        route: '/workflow-pipeline',
        tone: 'warning',
      });
    }

    if (items.length === 0) {
      items.push({
        key: 'steady-state',
        title: 'Duy trì nhịp điều hành ổn định',
        detail: 'Không có playbook khẩn, có thể ưu tiên tối ưu hóa hoặc hoàn tất báo cáo cuối phiên.',
        route: '/',
        tone: 'steady',
      });
    }

    return items.slice(0, 4);
  }, [
    canManagePurchasing,
    canViewOps,
    canViewReports,
    canViewWorkflow,
    operationsFailedCount,
    overdue90Count,
    purchasingSummary?.overdue_receipt_count,
    taskSummary?.overdue,
  ]);

  const primaryHeroAction = signalCards[0] ?? {
    key: 'task-inbox',
    title: 'Ưu tiên nhiệm vụ',
    value: '0',
    detail: '',
    route: '/task-inbox',
    actionLabel: 'Mở hộp nhiệm vụ',
    tone: 'steady' as Tone,
    icon: <InboxOutlined />,
    priority: 0,
  };

  const secondaryHeroAction = canViewOps
    ? { label: 'Điều hành tổng hợp', route: '/executive-cockpit' }
    : canViewReports
      ? { label: 'Trung tâm báo cáo', route: '/reports' }
      : canViewWorkflow
        ? { label: 'Workflow pipeline', route: '/workflow-pipeline' }
        : { label: 'Trung tâm thông báo', route: '/notifications' };

  const signalPanelSubtitle = notificationCountQuery.isLoading || taskSummaryQuery.isLoading
    ? 'Đang đồng bộ các tín hiệu vận hành thời gian gần thực.'
    : 'Các tín hiệu nóng được đẩy lên đầu để có thể hành động ngay trong một nhịp điều hành.';

  return (
    <div className="command-center">
      {contextHolder}

      <section className="command-center-hero">
        <div className="command-center-hero-grid">
          <div>
            <div className="command-center-eyebrow">ERP Carton Command Center</div>
            <div className="command-center-title">Vận hành toàn cảnh theo ưu tiên, không theo cảm giác.</div>
            <div className="command-center-description">
              Màn hình này gom các điểm nóng quan trọng nhất giữa bán hàng, mua hàng, sản xuất,
              tồn kho, tài chính và tác vụ cá nhân để chúng ta xử lý đúng thứ tự và ra quyết định nhanh hơn.
            </div>

            <div className="command-center-hero-badges">
              {heroBadges.map((badge) => (
                <div key={badge.key} className="command-center-hero-badge">
                  <span className="command-center-hero-badge-value">{badge.value}</span>
                  <span>{badge.label}</span>
                </div>
              ))}
            </div>

            <div className="command-center-hero-actions">
              <Button
                type="primary"
                onClick={() => navigate(primaryHeroAction.route)}
                icon={<ArrowRightOutlined />}
              >
                {primaryHeroAction.actionLabel}
              </Button>
              <Button ghost onClick={() => navigate(secondaryHeroAction.route)}>
                {secondaryHeroAction.label}
              </Button>
            </div>
          </div>

          <div className="command-center-hero-meta">
            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Ca làm việc hiện tại</div>
              <div className="command-center-hero-card-value">{now.format('HH:mm')}</div>
              <div className="command-center-hero-card-caption">
                {now.format('DD/MM/YYYY')} • {operatingMode.detail}
              </div>
            </div>

            <div className="command-center-hero-card">
              <div className="command-center-hero-card-label">Executive snapshot</div>
              <div className="command-center-hero-score-grid">
                {heroScoreCards.map((score) => (
                  <div key={score.key} className="command-center-hero-score">
                    <div className="command-center-hero-score-label">{score.label}</div>
                    <div className="command-center-hero-score-value">{score.value}</div>
                    <div className="command-center-hero-score-caption">{score.caption}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {canManageFinance && (
        <section className={`command-center-finance-alert ${overdue90Count > 0 ? 'command-center-finance-alert--warning' : 'command-center-finance-alert--steady'}`}>
          {overdueOverviewQuery.isLoading ? (
            <Spin />
          ) : (
            <>
              <div>
                <div className="command-center-finance-alert-title">Cảnh báo tạm ứng quá hạn 90 ngày</div>
                <div className="command-center-finance-alert-description">
                  {`Số phiếu: ${formatNumber(overdue90Count)} • Tổng còn phải quyết toán: ${formatMoney(overdue90Amount)}`}
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {overdue90Count <= 0 ? (
                    <Tag color="success">Không có hồ sơ rủi ro mức 90 ngày</Tag>
                  ) : isAcked ? (
                    <Tag color="blue">Đã xác nhận xử lý trong phiên hiện tại</Tag>
                  ) : (
                    <Tag color="red">Chưa xác nhận xử lý</Tag>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button disabled={overdue90Count <= 0} onClick={handleAcknowledgeOverdue}>
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
              </div>
            </>
          )}
        </section>
      )}

      <div className="command-center-grid">
        <PanelSection
          kicker="Ưu tiên ngay"
          title="Tín hiệu điều hành cần phản ứng"
          subtitle={signalPanelSubtitle}
          extra={<Tag color={operatingMode.tone === 'critical' ? 'red' : operatingMode.tone === 'warning' ? 'gold' : 'green'}>{operatingMode.label}</Tag>}
        >
          <div className="command-center-signal-grid">
            {signalCards.map((card) => (
              <button
                key={card.key}
                type="button"
                className={`command-center-signal-card command-center-signal-card--${card.tone}`}
                onClick={() => navigate(card.route)}
              >
                <div className="command-center-card-head">
                  <span className="command-center-card-icon">{card.icon}</span>
                  <span className={`command-center-card-tone command-center-card-tone--${card.tone}`}>
                    {toneLabel(card.tone)}
                  </span>
                </div>
                <div className="command-center-card-value">{card.value}</div>
                <div className="command-center-card-title">{card.title}</div>
                <div className="command-center-card-detail">{card.detail}</div>
                <div className="command-center-card-footer">
                  <span>{card.actionLabel}</span>
                  <ArrowRightOutlined />
                </div>
              </button>
            ))}
          </div>
        </PanelSection>

        <PanelSection
          kicker="Điều hướng nhanh"
          title="Lối tắt cho một phiên điều hành gọn"
          subtitle="Mở đúng command center chỉ với một cú click, giảm thời gian chuyển màn hình trong ca làm việc."
        >
          <div className="command-center-shortcuts">
            {shortcutCards.map((card) => (
              <button
                key={card.key}
                type="button"
                className="command-center-shortcut"
                data-testid={`dashboard-restore-${card.key}`}
                onClick={() => navigate(card.route)}
              >
                <div className="command-center-shortcut-meta">
                  <div className="command-center-shortcut-title">{card.title}</div>
                  <div className="command-center-shortcut-badge">{card.badge}</div>
                </div>
                <div className="command-center-shortcut-description">{card.description}</div>
                <div className="command-center-card-footer">
                  <span>{card.actionLabel}</span>
                  <ArrowRightOutlined />
                </div>
              </button>
            ))}
          </div>
        </PanelSection>
      </div>

      <PanelSection
        kicker="Dòng nghiệp vụ"
        title="Trạng thái các trung tâm nghiệp vụ chính"
        subtitle="Mỗi thẻ đại diện cho một luồng vận hành trọng yếu, có chỉ số trung tâm và đường đi nhanh tới màn thao tác."
      >
        {moduleCards.length === 0 ? (
          <div className="command-center-empty">
            Tài khoản hiện tại chưa mở quyền cho các trung tâm nghiệp vụ trọng yếu. Có thể bắt đầu từ hộp nhiệm vụ hoặc trung tâm thông báo.
          </div>
        ) : (
          <div className="command-center-module-grid">
            {moduleCards.map((card) => (
              <button
                key={card.key}
                type="button"
                className="command-center-module-card"
                onClick={() => navigate(card.route)}
                style={{
                  padding: 18,
                  borderColor: card.tone === 'critical'
                    ? 'rgba(220, 38, 38, 0.14)'
                    : card.tone === 'warning'
                      ? 'rgba(217, 119, 6, 0.16)'
                      : 'rgba(148, 163, 184, 0.18)',
                }}
              >
                <div className="command-center-card-head">
                  <span className="command-center-card-icon">{card.icon}</span>
                  <span className={`command-center-card-tone command-center-card-tone--${card.tone}`}>
                    {toneLabel(card.tone)}
                  </span>
                </div>
                <div className="command-center-card-value">{card.value}</div>
                <div className="command-center-card-title">{card.title}</div>
                <div className="command-center-card-detail">{card.detail}</div>
                <div className="command-center-card-footer">
                  <span>{card.actionLabel}</span>
                  <ArrowRightOutlined />
                </div>
              </button>
            ))}
          </div>
        )}
      </PanelSection>

      <div className="command-center-grid">
        <PanelSection
          kicker="Watchlist"
          title="Điểm nóng liên phòng ban"
          subtitle="Danh sách này giúp chúng ta nắm các điểm nghẽn cần phối hợp chéo giữa kinh doanh, vận hành và tài chính."
        >
          <div className="command-center-watchlist">
            {watchlistItems.map((item, index) => (
              <div
                key={`${item.title}-${index}`}
                className={`command-center-watch-item command-center-watch-item--${item.tone}`}
              >
                <div className="command-center-watch-title">{item.title}</div>
                <div className="command-center-watch-detail">{item.detail}</div>
              </div>
            ))}
          </div>
        </PanelSection>

        <div className="command-center-stack">
          <PanelSection
            kicker="Tiến độ"
            title="Nhịp thực thi hiện tại"
            subtitle="Các thanh tiến độ cho thấy mức hoàn tất của những luồng cốt lõi, phù hợp để đọc nhanh trước khi chuyển màn hình."
          >
            {processStats.length === 0 ? (
              <div className="command-center-empty">
                Chưa có dữ liệu tiến độ cho các module đang được mở quyền ở tài khoản này.
              </div>
            ) : (
              <div className="command-center-progress-list">
                {processStats.map((item) => (
                  <div key={item.label}>
                    <div className="command-center-progress-top">
                      <span className="command-center-progress-label">{item.label}</span>
                      <span className="command-center-progress-value">{item.value}</span>
                    </div>
                    <Progress percent={item.percent} strokeColor={item.color} showInfo={false} />
                  </div>
                ))}
              </div>
            )}
          </PanelSection>

          <PanelSection
            kicker="Playbook"
            title="Bước kế tiếp được đề xuất"
            subtitle="Các hành động dưới đây được xếp ra từ chính dữ liệu đang nóng trên dashboard để giúp phiên xử lý đi thẳng vào việc."
          >
            <div className="command-center-playbook">
              {playbookItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="command-center-playbook-item"
                  onClick={() => navigate(item.route)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div className="command-center-playbook-title">{item.title}</div>
                    <Tag color={item.tone === 'critical' ? 'red' : item.tone === 'warning' ? 'gold' : 'green'}>
                      {toneLabel(item.tone)}
                    </Tag>
                  </div>
                  <div className="command-center-playbook-detail">{item.detail}</div>
                  <div className="command-center-card-footer">
                    <span>Đi tới màn xử lý</span>
                    <ArrowRightOutlined />
                  </div>
                </button>
              ))}
            </div>
          </PanelSection>
        </div>
      </div>
    </div>
  );
}
