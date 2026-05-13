import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Layout, Menu, Button, Popover, Space, Divider, Drawer, Badge } from 'antd';
import type { MenuProps } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  DashboardOutlined,
  AppstoreOutlined,
  TagsOutlined,
  ToolOutlined,
  DollarOutlined,
  ControlOutlined,
  ApartmentOutlined,
  InboxOutlined,
  UserOutlined,
  TeamOutlined,
  ShoppingCartOutlined,
  BuildOutlined,
  BarChartOutlined,
  LogoutOutlined,
  BellOutlined,
  SafetyOutlined,
  DatabaseOutlined,
  CarOutlined,
  QrcodeOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { isEditableElement, prefersDesktopScannerUi } from '../../utils/inputDevices';
import { authApi } from '../../api/auth';
import { storage } from '../../utils/storage';
import TaskQuickLauncher from '../TaskQuickLauncher/TaskQuickLauncher';
import GlobalCommandPalette from './GlobalCommandPalette';
import { notificationsApi } from '../../api/notifications';
import { operationsApi } from '../../api/operations';
import { adminApi } from '../../api/admin';
import { financeApi } from '../../api/finance';
import { workforceApi } from '../../api/workforce';
import {
  buildCommandPaletteCatalog,
  getCommandPaletteFavoritePaths,
  getNextCommandPaletteRecentPaths,
  persistCommandPaletteRecentPaths,
  toggleCommandPaletteFavoritePath,
} from '../../utils/commandPalette';
import {
  canManageFinanceData,
  canAccessSalesOrders,
  canManageInventoryData,
  canManageStocktake,
  canManagePurchasingData,
  canManageProductionData,
  canViewQualityData,
  canAccessProductionCenter,
  canAccessMaterialIssues,
  canAccessProductionReceipts,
  canManageUserAccessExceptions,
  canManageModulePermissionSettings,
  canManageUserAccessReviews,
  canManageOnboardingStudio,
  canManageRoleTeamGovernance,
  canManageUserDirectory,
  canManageUserLifecycle,
  canManageUserProvisioning,
  canManageWorkforceData,
  canViewApprovalControlTower,
  canViewAdminAuditCenter,
  canViewAdminObservabilityCenter,
  canViewAccessGovernanceCenter,
  canViewModulePermissionHistory,
  canViewOperationsLog,
  canViewOpsHub,
  canViewReportsCenter,
  canViewWorkflowData,
  canManageWorkflowData,
} from '../../utils/authz';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';

const { Header, Sider, Content } = Layout;
const SIDEBAR_OPEN_KEYS_STORAGE_KEY = 'erp-carton.sidebar-open-keys';
const DEFAULT_OPEN_MENU_KEYS = ['sales-group', 'production-group', 'workflow-group', 'workforce-group', 'finance-group'];

type ConnectionLike = {
  saveData?: boolean;
  effectiveType?: string;
};

function shouldSkipRouteChunkPrefetch(): boolean {
  const connection = (globalThis.navigator as Navigator & { connection?: ConnectionLike }).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g';
}

const routeChunkPrefetchers: Record<string, () => Promise<unknown>> = {
  '/': () => import('../../pages/Dashboard'),
  '/account': () => import('../../pages/Account/AccountCenter'),
  '/products': () => import('../../pages/Products/ProductList'),
  '/sales-orders': () => import('../../pages/Sales/SalesOrderList'),
  '/sales-fulfillment-center': () => import('../../pages/Management/SalesFulfillmentCenter'),
  '/shipments': () => import('../../pages/Sales/ShipmentList'),
  '/scan-center': () => import('../../pages/Inventory/ScanCenter'),
  '/shipments/scan': () => import('../../pages/Inventory/ScanCenter'),
  '/quotes': () => import('../../pages/Sales/QuoteListNew'),
  '/quote-analytics': () => import('../../pages/Management/QuoteAnalytics'),
  '/sales-analytics': () => import('../../pages/Sales/SalesAnalyticsDashboard'),
  '/discount-management': () => import('../../pages/Sales/DiscountManagement'),
  '/customer-portal': () => import('../../pages/Sales/CustomerPortal'),
  '/inventory-forecast': () => import('../../pages/Inventory/InventoryForecast'),
  '/budget-management': () => import('../../pages/Finance/BudgetManagement'),
  '/bi-dashboard': () => import('../../pages/Management/BIDashboard'),
  '/categories': () => import('../../pages/Categories/CategoryList'),
  '/units': () => import('../../pages/Units/UnitList'),
  '/customers': () => import('../../pages/Customers/CustomerList'),
  '/suppliers': () => import('../../pages/Purchasing/SupplierList'),
  '/purchase-orders': () => import('../../pages/Purchasing/PurchaseOrderList'),
  '/purchase-receipts': () => import('../../pages/Purchasing/PurchaseReceiptList'),
  '/purchase-requests': () => import('../../pages/Purchasing/PurchaseRequestList'),
  '/purchase-returns': () => import('../../pages/Purchasing/PurchaseReturnList'),
  '/production-demands': () => import('../../pages/Production/ProductionDemandList'),
  '/production-orders': () => import('../../pages/Production/ProductionOrderList'),
  '/production-planning': () => import('../../pages/Production/ProductionPlanningBoard'),
  '/production-resources': () => import('../../pages/Production/ProductionResourceCatalog'),
  '/material-issues': () => import('../../pages/Production/MaterialIssueList'),
  '/production-receipts': () => import('../../pages/Production/ProductionReceiptList'),
  '/qc-printing': () => import('../../pages/Quality/QCPrintingWorkspace'),
  '/production-costing': () => import('../../pages/Management/ProductionCostingReport'),
  '/reports': () => import('../../pages/Management/ReportsCenter'),
  '/warehouses': () => import('../../pages/Inventory/WarehouseList'),
  '/warehouse-locations': () => import('../../pages/Inventory/WarehouseLocationList'),
  '/inventory-stock': () => import('../../pages/Inventory/InventoryStockOverview'),
  '/inventory-transactions': () => import('../../pages/Inventory/InventoryTransactionList'),
  '/stock-alerts': () => import('../../pages/Inventory/StockAlertList'),
  '/warehouse-transfers': () => import('../../pages/Inventory/WarehouseTransferList'),
  '/stocktakes': () => import('../../pages/Inventory/StocktakeList'),
  '/inventory-reservations': () => import('../../pages/Inventory/InventoryReservationList'),
  '/task-inbox': () => import('../../pages/Tasks/TaskInbox'),
  '/executive-cockpit': () => import('../../pages/Management/ExecutiveCockpit'),
  '/task-operations': () => import('../../pages/Tasks/TaskOperationsBoard'),
  '/workflow-task-templates': () => import('../../pages/WorkflowTaskTemplates/WorkflowTaskTemplateList'),
  '/workflow-pipeline': () => import('../../pages/WorkflowPipeline/WorkflowPipelineBoard'),
  '/workflow-analytics': () => import('../../pages/WorkflowPipeline/WorkflowAnalyticsDashboard'),
  '/notifications': () => import('../../pages/Notifications/NotificationCenter'),
  '/operations-log': () => import('../../pages/Operations/OperationsLogDashboard'),
  '/employees': () => import('../../pages/Workforce/EmployeeList'),
  '/attendance': () => import('../../pages/Workforce/AttendanceList'),
  '/bonus-penalty': () => import('../../pages/Workforce/BonusPenaltyList'),
  '/payroll': () => import('../../pages/Workforce/PayrollList'),
  '/salary-advance': () => import('../../pages/Workforce/SalaryAdvanceList'),
  '/transaction-categories': () => import('../../pages/Finance/TransactionCategoryList'),
  '/bank-accounts': () => import('../../pages/Finance/BankAccountList'),
  '/cash-book': () => import('../../pages/Finance/CashBook'),
  '/advance-transactions': () => import('../../pages/Finance/AdvanceTransactionList'),
  '/receivables': () => import('../../pages/Finance/AccountsReceivableList'),
  '/aging-analysis': () => import('../../pages/Finance/AgingAnalysis'),
  '/payables': () => import('../../pages/Finance/AccountsPayableList'),
  '/finance-summary': () => import('../../pages/Finance/FinanceSummary'),
  '/profit-report': () => import('../../pages/Management/ProfitReport'),
  '/general-ledger': () => import('../../pages/Finance/GeneralLedgerList'),
  '/trial-balance': () => import('../../pages/Finance/TrialBalance'),
  '/bank-reconciliation': () => import('../../pages/Finance/BankReconciliationList'),
  '/employee-performance': () => import('../../pages/Management/EmployeePerformanceReport'),
  '/admin/approval-control-tower': () => import('../../pages/Admin/ApprovalControlTower'),
  '/admin/audit-center': () => import('../../pages/Admin/AdminAuditCenter'),
  '/admin/observability': () => import('../../pages/Admin/AdminObservabilityCenter'),
  '/admin/access-governance': () => import('../../pages/Admin/AccessGovernanceCenter'),
  '/admin/access-exceptions': () => import('../../pages/Admin/AccessExceptionCenter'),
  '/admin/access-reviews': () => import('../../pages/Admin/AccessReviewCenter'),
  '/admin/user-provisioning': () => import('../../pages/Admin/UserProvisioningDesk'),
  '/admin/user-lifecycle': () => import('../../pages/Admin/UserOffboardingDesk'),
  '/admin/onboarding-studio': () => import('../../pages/Admin/OnboardingStudio'),
  '/admin/roles-teams': () => import('../../pages/Admin/RoleTeamGovernance'),
  '/admin/users': () => import('../../pages/Admin/UserControlCenter'),
  '/admin/module-permissions': () => import('../../pages/Admin/ModulePermissionSettings'),
  '/admin/module-permissions-history': () => import('../../pages/Admin/ModulePermissionHistory'),
};

type WorkspaceHeaderSignal = {
  key: string;
  label: string;
  value: string;
  tone: 'critical' | 'warning' | 'steady';
  path: string;
};

type RestoredHeaderShortcut = {
  key: string;
  label: string;
  description: string;
  path: string;
  testId: string;
  badge?: string;
};

const MainLayout = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [favoriteCommandPaths, setFavoriteCommandPaths] = useState<string[]>(() => getCommandPaletteFavoritePaths());
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [preferDesktopScanUi, setPreferDesktopScanUi] = useState(() => prefersDesktopScannerUi());
  const globalScannerBufferRef = useRef({ value: '', startedAt: 0, lastAt: 0 });
  const [openMenuKeys, setOpenMenuKeys] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_OPEN_KEYS_STORAGE_KEY);
      if (!raw) return DEFAULT_OPEN_MENU_KEYS;
      const parsed = JSON.parse(raw) as string[];
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_OPEN_MENU_KEYS;
    } catch {
      return DEFAULT_OPEN_MENU_KEYS;
    }
  });
  const navigate = useNavigate();
  const location = useLocation();
  const user = storage.getUser();
  const desktopControlSize = 40;
  const queryClient = useQueryClient();
  const prefetchedRoutesRef = useRef<Set<string>>(new Set());
  const canViewOps = canViewOpsHub();
  const canViewReports = canViewReportsCenter();
  const canViewSalesOrders = canAccessSalesOrders();
  const canViewWorkflow = canViewWorkflowData();
  const canManageWorkflow = canManageWorkflowData();
  const canViewOpsLog = canViewOperationsLog();
  const canManageFinance = canManageFinanceData();
  const canManageInventory = canManageInventoryData();
  const canManageStocktakeMenu = canManageStocktake();
  const canManagePurchasing = canManagePurchasingData();
  const canManageProduction = canManageProductionData();
  const canViewQuality = canViewQualityData();
  const canAccessProduction = canAccessProductionCenter();
  const canAccessMaterialIssueRoute = canAccessMaterialIssues();
  const canAccessProductionReceiptRoute = canAccessProductionReceipts();
  const canManageWorkforce = canManageWorkforceData();
  const canUseScanCenter = canManageInventory || canViewSalesOrders || canManagePurchasing || canManageProduction;
  const canViewSalesFulfillmentCenter = canViewSalesOrders || canManagePurchasing || canManageProduction || canViewReports;
  const canViewApprovalTower = canViewApprovalControlTower();
  const canManageModulePermissions = canManageModulePermissionSettings();
  const canManageAccessExceptions = canManageUserAccessExceptions();
  const canManageAccessReviews = canManageUserAccessReviews();
  const canManageLifecycle = canManageUserLifecycle();
  const canManageProvisioning = canManageUserProvisioning();
  const canManageOnboarding = canManageOnboardingStudio();
  const canManageRoleTeams = canManageRoleTeamGovernance();
  const canManageUsers = canManageUserDirectory();
  const canViewRbacAudit = canViewModulePermissionHistory();
  const canViewAdminAudit = canViewAdminAuditCenter();
  const canViewAdminObservability = canViewAdminObservabilityCenter();
  const canViewAccessGovernance = canViewAccessGovernanceCenter();
  const headerNotificationInterval = useRealtimePollingInterval({
    enabled: true,
    activeMs: 30_000, // Increased from 15s to 30s to reduce polling frequency
    hiddenMs: false,
  });
  const unreadQuery = useQuery({
    queryKey: ['header-notifications-unread'],
    queryFn: () => notificationsApi.unread(),
    staleTime: 15_000, // Increased from 5s to 15s
    refetchInterval: headerNotificationInterval,
    refetchIntervalInBackground: false,
  });
  const financeOverdueInterval = useRealtimePollingInterval({
    enabled: canManageFinance,
    activeMs: 60_000,
    hiddenMs: false,
  });
  const overdueOverviewQuery = useQuery({
    queryKey: ['layout-finance-overdue-overview'],
    queryFn: () => financeApi.getAdvanceOverdueOverview(),
    enabled: canManageFinance,
    staleTime: 60_000, // Increased from 30s to 60s
    refetchInterval: financeOverdueInterval,
    refetchIntervalInBackground: false,
  });
  const workforceApprovalInterval = useRealtimePollingInterval({
    enabled: canManageWorkforce,
    activeMs: 60_000,
    hiddenMs: false,
  });
  const salaryAdvanceApprovalQueueQuery = useQuery({
    queryKey: ['layout-workforce-salary-advance-approval-queue'],
    queryFn: () => workforceApi.getSalaryAdvanceApprovalQueue(),
    enabled: canManageWorkforce,
    staleTime: 60_000, // Increased from 30s to 60s
    refetchInterval: workforceApprovalInterval,
    refetchIntervalInBackground: false,
  });
  const operationsLogMetaQuery = useQuery({
    queryKey: ['layout-operations-log-meta'],
    queryFn: () => operationsApi.meta(),
    enabled: canViewOpsLog,
    staleTime: 60_000, // Increased from 30s to 60s
    refetchInterval: 60_000, // Changed from 60s to 120s
    refetchIntervalInBackground: false,
  });
  const rbacHistoryMetaQuery = useQuery({
    queryKey: ['layout-rbac-history-meta'],
    queryFn: () => adminApi.getRoleModulePermissionHistoryMeta(),
    enabled: canViewRbacAudit,
    staleTime: 120_000, // Increased from 60s to 120s
    refetchInterval: 240_000, // Increased from 120s to 240s (4 minutes)
    refetchIntervalInBackground: false,
  });
  const markReadMutation = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['header-notifications-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
    },
  });
  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['header-notifications-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-list'] });
    },
  });

  // Detect mobile screen size
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (mobile) {
        setCollapsed(true);
      }
      setPreferDesktopScanUi(prefersDesktopScannerUi());
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_OPEN_KEYS_STORAGE_KEY, JSON.stringify(openMenuKeys));
  }, [openMenuKeys]);

  const prefetchRouteChunk = useCallback((routePath: string) => {
    if (shouldSkipRouteChunkPrefetch()) return;
    if (routePath === location.pathname) return;
    if (prefetchedRoutesRef.current.has(routePath)) return;
    const prefetcher = routeChunkPrefetchers[routePath];
    if (!prefetcher) return;
    prefetchedRoutesRef.current.add(routePath);
    void prefetcher().catch(() => {
      prefetchedRoutesRef.current.delete(routePath);
    });
  }, [location.pathname]);

  const renderMenuLabel = useCallback(
    (routePath: string, label: ReactNode) => (
      <span
        onMouseEnter={() => prefetchRouteChunk(routePath)}
        onFocus={() => prefetchRouteChunk(routePath)}
      >
        {label}
      </span>
    ),
    [prefetchRouteChunk]
  );

  const overdue90Count =
    overdueOverviewQuery.data?.buckets?.find((bucket) => bucket.threshold_days === 90)?.count ?? 0;
  const salaryAdvancePendingCount =
    (salaryAdvanceApprovalQueueQuery.data?.pending_l1_count ?? 0) +
    (salaryAdvanceApprovalQueueQuery.data?.pending_l2_count ?? 0);
  const unreadCount = unreadQuery.data?.length ?? 0;
  const operationsFailedCount = operationsLogMetaQuery.data?.recent_failed_count_24h ?? 0;
  const rbacAnomalyCount = rbacHistoryMetaQuery.data?.anomalies_24h_count ?? 0;
  const commandPaletteCommands = useMemo(() => buildCommandPaletteCatalog({
    canViewReports,
    canViewSalesOrders,
    canViewSalesFulfillmentCenter,
    canManagePurchasing,
    canAccessProductionCenter: canAccessProduction,
    canAccessMaterialIssues: canAccessMaterialIssueRoute,
    canAccessProductionReceipts: canAccessProductionReceiptRoute,
    canManageProduction,
    canViewQuality,
    canManageInventory,
    canManageStocktake: canManageStocktakeMenu,
    canManageFinance,
    canManageWorkforce,
    canViewOps,
    canViewWorkflow,
    canManageWorkflow,
    canViewOpsLog,
    canViewApprovalTower,
    canViewAdminAudit,
    canViewAdminObservability,
    canViewAccessGovernance,
    canManageAccessExceptions,
    canManageAccessReviews,
    canManageProvisioning,
    canManageLifecycle,
    canManageOnboarding,
    canManageRoleTeams,
    canManageUsers,
    canManageModulePermissions,
    canViewRbacAudit,
    unreadCount,
    overdue90Count,
    salaryAdvancePendingCount,
    operationsFailedCount,
    rbacAnomalyCount,
  }), [
    canAccessMaterialIssueRoute,
    canAccessProduction,
    canAccessProductionReceiptRoute,
    canManageAccessExceptions,
    canManageAccessReviews,
    canManageFinance,
    canManageInventory,
    canManageLifecycle,
    canManageModulePermissions,
    canManageOnboarding,
    canManageProduction,
    canManageProvisioning,
    canManagePurchasing,
    canManageRoleTeams,
    canManageStocktakeMenu,
    canManageUsers,
    canManageWorkflow,
    canManageWorkforce,
    canViewApprovalTower,
    canViewAdminAudit,
    canViewAccessGovernance,
    canViewAdminObservability,
    canViewOps,
    canViewOpsLog,
    canViewQuality,
    canViewRbacAudit,
    canViewReports,
    canViewSalesOrders,
    canViewSalesFulfillmentCenter,
    canViewWorkflow,
    operationsFailedCount,
    overdue90Count,
    rbacAnomalyCount,
    salaryAdvancePendingCount,
    unreadCount,
  ]);
  const activeCommand = useMemo(
    () => commandPaletteCommands.find((command) => command.path === location.pathname) ?? null,
    [commandPaletteCommands, location.pathname]
  );
  const workspaceSignals = useMemo<WorkspaceHeaderSignal[]>(() => {
    const signals: WorkspaceHeaderSignal[] = [];
    if (unreadCount > 0) {
      signals.push({
        key: 'notifications',
        label: 'Thông báo mới',
        value: String(unreadCount),
        tone: unreadCount >= 10 ? 'critical' : 'warning',
        path: '/notifications',
      });
    }
    if (overdue90Count > 0) {
      signals.push({
        key: 'finance-overdue',
        label: 'Tạm ứng 90+',
        value: String(overdue90Count),
        tone: 'critical',
        path: '/advance-transactions',
      });
    }
    if (salaryAdvancePendingCount > 0) {
      signals.push({
        key: 'salary-advance',
        label: 'Ứng lương chờ duyệt',
        value: String(salaryAdvancePendingCount),
        tone: salaryAdvancePendingCount >= 5 ? 'critical' : 'warning',
        path: '/salary-advance',
      });
    }
    if (operationsFailedCount > 0) {
      signals.push({
        key: 'operations-log',
        label: 'Sự cố vận hành',
        value: String(operationsFailedCount),
        tone: 'critical',
        path: '/operations-log',
      });
    }
    if (rbacAnomalyCount > 0) {
      signals.push({
        key: 'rbac-audit',
        label: 'Bất thường RBAC',
        value: String(rbacAnomalyCount),
        tone: 'warning',
        path: '/admin/module-permissions-history',
      });
    }
    if (signals.length === 0) {
      return [{
        key: 'steady-state',
        label: 'Nền vận hành',
        value: 'OK',
        tone: 'steady',
        path: '/',
      }];
    }
    return signals.slice(0, 3);
  }, [
    operationsFailedCount,
    overdue90Count,
    rbacAnomalyCount,
    salaryAdvancePendingCount,
    unreadCount,
  ]);
  const restoredHeaderShortcuts = useMemo<RestoredHeaderShortcut[]>(() => {
    const shortcuts: RestoredHeaderShortcut[] = [
      {
        key: 'scan-center',
        label: 'Trung tâm quét QR',
        description: 'Mở khu quét QR nhanh để tra cứu và thao tác giao nhận.',
        path: '/scan-center',
        testId: 'header-restore-shortcut-scan-center',
        badge: 'QR',
      },
    ];

    if (canViewSalesFulfillmentCenter) {
      shortcuts.push({
        key: 'sales-fulfillment-center',
        label: 'Điều độ đơn hàng xuất',
        description: 'Tổng quan kế hoạch vật tư, thiếu hụt và sẵn sàng giao hàng.',
        path: '/sales-fulfillment-center',
        testId: 'header-restore-shortcut-sales-fulfillment-center',
      });
    }

    if (canViewSalesOrders) {
      shortcuts.push(
        {
          key: 'shipments',
          label: 'Phiếu xuất',
          description: 'Điều phối xe, tài xế, bàn giao và giao xong trong một nơi.',
          path: '/shipments',
          testId: 'header-restore-shortcut-shipments',
        },
      );
    }

    if (canManageProduction) {
      shortcuts.push(
        {
          key: 'production-demands',
          label: 'Nhu cầu sản xuất',
          description: 'Theo dõi nhu cầu sản xuất phát sinh từ đơn hàng và kế hoạch giao.',
          path: '/production-demands',
          testId: 'header-restore-shortcut-production-demands',
        },
        {
          key: 'production-planning',
          label: 'Điều độ sản xuất',
          description: 'Mở planner công đoạn để rà tải theo ngày, ca và điểm nghẽn.',
          path: '/production-planning',
          testId: 'header-restore-shortcut-production-planning',
        },
        {
          key: 'production-resources',
          label: 'Danh mục máy/tổ',
          description: 'Mở danh mục tổ sản xuất, máy và năng lực mặc định dùng cho planner.',
          path: '/production-resources',
          testId: 'header-restore-shortcut-production-resources',
        },
      );
    }

    if (canManageOnboarding) {
      shortcuts.push({
        key: 'onboarding-studio',
        label: 'Trợ lý triển khai công việc',
        description: 'Mở nhanh công cụ rollout và preset triển khai công việc.',
        path: '/admin/onboarding-studio',
        testId: 'header-restore-shortcut-onboarding-studio',
      });
    }

    if (canManageWorkforce) {
      shortcuts.push({
        key: 'salary-advance',
        label: 'Ứng lương',
        description: 'Theo dõi riêng hồ sơ ứng lương, không lẫn với tạm ứng.',
        path: '/salary-advance',
        testId: 'header-restore-shortcut-salary-advance',
      });
    }

    if (canManageFinance) {
      shortcuts.push({
        key: 'advance-transactions',
        label: 'Tạm ứng - quyết toán',
        description: 'Mở command center tài chính cho tạm ứng và quyết toán.',
        path: '/advance-transactions',
        testId: 'header-restore-shortcut-advance-transactions',
      });
    }

    return shortcuts;
  }, [
    canManageFinance,
    canManageOnboarding,
    canManageProduction,
    canManageWorkforce,
    canViewSalesFulfillmentCenter,
    canViewSalesOrders,
  ]);
  const workspaceSummary = useMemo(() => {
    const fragments: string[] = [];
    if (unreadCount > 0) fragments.push(`${unreadCount} thông báo mới`);
    if (overdue90Count > 0) fragments.push(`${overdue90Count} hồ sơ tạm ứng quá 90 ngày`);
    if (salaryAdvancePendingCount > 0) fragments.push(`${salaryAdvancePendingCount} hồ sơ ứng lương chờ duyệt`);
    if (operationsFailedCount > 0) fragments.push(`${operationsFailedCount} sự cố cần rà soát`);
    if (rbacAnomalyCount > 0) fragments.push(`${rbacAnomalyCount} bất thường phân quyền`);
    if (fragments.length === 0) {
      return activeCommand?.description ?? 'Hệ thống đang sẵn sàng cho những luồng công việc ưu tiên.';
    }
    return fragments.slice(0, 3).join(' • ');
  }, [
    activeCommand?.description,
    operationsFailedCount,
    overdue90Count,
    rbacAnomalyCount,
    salaryAdvancePendingCount,
    unreadCount,
  ]);
  const recentCommandPaths = useMemo(
    () => getNextCommandPaletteRecentPaths(location.pathname),
    [location.pathname],
  );

  useEffect(() => {
    persistCommandPaletteRecentPaths(recentCommandPaths);
  }, [recentCommandPaths]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setCommandPaletteOpen((current) => !current);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const quickScanPath = useMemo(() => (
    preferDesktopScanUi
      ? '/scan-center?role=operator&preset=overview&focus=batch&device=desktop'
      : '/scan-center?role=operator&preset=overview&focus=batch'
  ), [preferDesktopScanUi]);

  const buildScannerRoute = useCallback((scanValue: string) => {
    const normalizedValue = scanValue.trim();
    if (!normalizedValue) {
      return quickScanPath;
    }
    if (location.pathname === '/scan-center') {
      const nextParams = new URLSearchParams(location.search);
      nextParams.set('device', 'desktop');
      nextParams.set('q', normalizedValue);
      return `/scan-center?${nextParams.toString()}`;
    }
    return `${quickScanPath}&q=${encodeURIComponent(normalizedValue)}`;
  }, [location.pathname, location.search, quickScanPath]);

  useEffect(() => {
    if (!canUseScanCenter || isMobile) {
      return;
    }
    const resetScannerBuffer = () => {
      globalScannerBufferRef.current = { value: '', startedAt: 0, lastAt: 0 };
    };
    const handleKeyPress = (event: KeyboardEvent) => {
      if (commandPaletteOpen) return;
      if (isEditableElement(event.target)) return;

      const now = Date.now();
      let buffer = globalScannerBufferRef.current;
      const gap = buffer.lastAt > 0 ? now - buffer.lastAt : 0;
      if (gap > 90) {
        resetScannerBuffer();
        buffer = globalScannerBufferRef.current;
      }

      if (event.key === 'Enter') {
        if (buffer.value.length < 6) {
          resetScannerBuffer();
          return;
        }
        const duration = now - buffer.startedAt;
        const averageInterval = buffer.value.length > 1 ? duration / (buffer.value.length - 1) : 0;
        const looksLikeScannerBurst = buffer.value.length >= 6 && duration <= 900 && averageInterval <= 45;
        if (looksLikeScannerBurst) {
          event.preventDefault();
          navigate(buildScannerRoute(buffer.value));
        }
        resetScannerBuffer();
        return;
      }

      if (event.key.length === 1) {
        if (buffer.value.length === 0) {
          buffer.startedAt = now;
        }
        buffer.value += event.key;
        buffer.lastAt = now;
      }
    };
    window.addEventListener('keydown', handleKeyPress, true);
    return () => window.removeEventListener('keydown', handleKeyPress, true);
  }, [buildScannerRoute, canUseScanCenter, commandPaletteOpen, isMobile, navigate]);

  const menuItems: MenuProps['items'] = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: renderMenuLabel('/', 'Tổng quan'),
    },
    canViewReports ? {
      key: '/reports',
      icon: <BarChartOutlined />,
      label: renderMenuLabel('/reports', 'Trung tâm báo cáo'),
    } : null,
    {
      key: '/products',
      icon: <AppstoreOutlined />,
      label: renderMenuLabel('/products', 'Sản phẩm'),
    },
    canViewSalesOrders ? {
      key: '/sales-orders',
      icon: <ShoppingCartOutlined />,
      label: renderMenuLabel('/sales-orders', 'Đơn hàng xuất'),
    } : null,
    canViewSalesFulfillmentCenter ? {
      key: '/sales-fulfillment-center',
      icon: <ControlOutlined />,
      label: renderMenuLabel('/sales-fulfillment-center', 'Điều độ đơn hàng xuất'),
    } : null,
    canViewSalesOrders ? {
      key: '/shipments',
      icon: <CarOutlined />,
      label: renderMenuLabel('/shipments', 'Phiếu xuất'),
    } : null,
    canUseScanCenter ? {
      key: '/scan-center',
      icon: <QrcodeOutlined />,
      label: renderMenuLabel('/scan-center', 'Trung tâm quét QR'),
    } : null,
    canViewSalesOrders ? {
      key: '/quotes',
      icon: <ShoppingCartOutlined />,
      label: renderMenuLabel('/quotes', 'Báo giá'),
    } : null,
    canViewSalesOrders ? {
      key: '/quote-analytics',
      icon: <BarChartOutlined />,
      label: renderMenuLabel('/quote-analytics', 'Phân tích báo giá'),
    } : null,
    canViewSalesOrders ? {
      key: '/sales-analytics',
      icon: <BarChartOutlined />,
      label: renderMenuLabel('/sales-analytics', 'Phân tích bán hàng'),
    } : null,
    canViewSalesOrders ? {
      key: '/discount-management',
      icon: <DollarOutlined />,
      label: renderMenuLabel('/discount-management', 'Quản lý chiết khấu'),
    } : null,
    {
      key: '/categories',
      icon: <TagsOutlined />,
      label: renderMenuLabel('/categories', 'Danh mục'),
    },
    {
      key: '/units',
      icon: <ToolOutlined />,
      label: renderMenuLabel('/units', 'Đơn vị tính'),
    },
    {
      key: '/customers',
      icon: <TeamOutlined />,
      label: renderMenuLabel('/customers', 'Khách hàng'),
    },
    {
      key: '/customer-portal',
      icon: <UserOutlined />,
      label: renderMenuLabel('/customer-portal', 'Cổng khách hàng'),
    },
    canManagePurchasing ? {
      key: 'purchasing-group',
      icon: <ShoppingCartOutlined />,
      label: 'Mua hàng',
      children: [
        {
          key: '/suppliers',
          label: renderMenuLabel('/suppliers', 'Nhà cung cấp'),
        },
        {
          key: '/purchase-orders',
          label: renderMenuLabel('/purchase-orders', 'Đơn mua'),
        },
        {
          key: '/purchase-receipts',
          label: renderMenuLabel('/purchase-receipts', 'Phiếu nhập mua'),
        },
        {
          key: '/purchase-requests',
          label: renderMenuLabel('/purchase-requests', 'Yêu cầu mua'),
        },
        {
          key: '/purchase-returns',
          label: renderMenuLabel('/purchase-returns', 'Phiếu trả hàng'),
        },
        {
          key: '/purchase-order-forecast',
          label: renderMenuLabel('/purchase-order-forecast', 'Dự báo đơn mua'),
        },
        {
          key: '/supplier-analytics',
          label: renderMenuLabel('/supplier-analytics', 'Phân tích nhà cung cấp'),
        },
        {
          key: '/material-prices',
          label: renderMenuLabel('/material-prices', 'Bảng giá NVL'),
        },
      ],
    } : null,
    (canAccessProduction || canAccessMaterialIssueRoute || canAccessProductionReceiptRoute || canManageProduction) ? {
      key: 'production-group',
      icon: <BuildOutlined />,
      label: 'Sản xuất',
      children: [
        ...(canManageProduction ? [{
          key: '/production-demands',
          label: renderMenuLabel('/production-demands', 'Nhu cầu sản xuất'),
        }] : []),
        ...(canAccessProduction ? [{
          key: '/production-orders',
          label: renderMenuLabel('/production-orders', 'Lệnh sản xuất'),
        }] : []),
        ...(canManageProduction ? [{
          key: '/production-planning',
          label: renderMenuLabel('/production-planning', 'Điều độ sản xuất'),
        }] : []),
        ...(canManageProduction ? [{
          key: '/production-resources',
          label: renderMenuLabel('/production-resources', 'Danh mục máy/tổ'),
        }] : []),
        ...(canAccessMaterialIssueRoute ? [{
          key: '/material-issues',
          label: renderMenuLabel('/material-issues', 'Cấp vật tư'),
        }] : []),
        ...(canAccessProductionReceiptRoute ? [{
          key: '/production-receipts',
          label: renderMenuLabel('/production-receipts', 'Nhập thành phẩm'),
        }] : []),
        ...(canManageProduction ? [{
          key: '/production-costing',
          label: renderMenuLabel('/production-costing', 'Giá vốn sau sản xuất'),
        }] : []),
      ],
    } : null,
    canViewQuality ? {
      key: '/qc-printing',
      icon: <SafetyOutlined />,
      label: renderMenuLabel('/qc-printing', 'QC Printing'),
    } : null,
    (canManageInventory || canManageStocktakeMenu) ? {
      key: 'inventory-group',
      icon: <DatabaseOutlined />,
      label: 'Kho',
      children: [
        ...(canManageInventory ? [
          { key: '/inventory-stock', label: renderMenuLabel('/inventory-stock', 'Tồn kho') },
          { key: '/inventory-forecast', label: renderMenuLabel('/inventory-forecast', 'Dự báo tồn kho') },
          { key: '/inventory-transactions', label: renderMenuLabel('/inventory-transactions', 'Sổ kho') },
          { key: '/inventory-reservations', label: renderMenuLabel('/inventory-reservations', 'Giữ chỗ tồn kho') },
          { key: '/stock-alerts', label: renderMenuLabel('/stock-alerts', 'Cảnh báo tồn kho') },
          { key: '/warehouse-transfers', label: renderMenuLabel('/warehouse-transfers', 'Chuyển kho') },
          { key: '/warehouses', label: renderMenuLabel('/warehouses', 'Kho hàng') },
          { key: '/warehouse-locations', label: renderMenuLabel('/warehouse-locations', 'Vị trí kho') },
        ] : []),
        ...(canManageStocktakeMenu ? [
          { key: '/stocktakes', label: renderMenuLabel('/stocktakes', 'Kiểm tồn') },
        ] : []),
      ],
    } : null,
    canManageWorkforce ? {
      key: 'workforce-group',
      icon: <UserOutlined />,
      label: 'Nhân sự',
      children: [
        {
          key: '/employees',
          label: renderMenuLabel('/employees', 'Nhân viên'),
        },
        {
          key: '/attendance',
          label: renderMenuLabel('/attendance', 'Chấm công'),
        },
        {
          key: '/bonus-penalty',
          label: renderMenuLabel('/bonus-penalty', 'Thưởng phạt'),
        },
        {
          key: '/payroll',
          label: renderMenuLabel('/payroll', 'Bảng lương'),
        },
        {
          key: '/salary-advance',
          label: renderMenuLabel(
            '/salary-advance',
            <span>
              Ứng lương {salaryAdvancePendingCount > 0 ? <Badge count={salaryAdvancePendingCount} size="small" overflowCount={99} /> : null}
            </span>
          ),
        },
        {
          key: '/employee-performance',
          label: renderMenuLabel('/employee-performance', 'Đánh giá nhân viên'),
        },
      ],
    } : null,
    canManageFinance ? {
      key: 'finance-group',
      icon: <DollarOutlined />,
      label: 'Tài chính',
      children: [
        {
          key: '/transaction-categories',
          label: renderMenuLabel('/transaction-categories', 'Loại thu chi'),
        },
        {
          key: '/bank-accounts',
          label: renderMenuLabel('/bank-accounts', 'Ngân hàng'),
        },
        {
          key: '/cash-book',
          label: renderMenuLabel('/cash-book', 'Sổ quỹ'),
        },
        {
          key: '/advance-transactions',
          label: renderMenuLabel(
            '/advance-transactions',
            <span>
              Tạm ứng - quyết toán {overdue90Count > 0 ? <Badge count={overdue90Count} size="small" overflowCount={99} /> : null}
            </span>
          ),
        },
        {
          key: '/receivables',
          label: renderMenuLabel('/receivables', 'Công nợ phải thu'),
        },
        {
          key: '/aging-analysis',
          label: renderMenuLabel('/aging-analysis', 'Phân tích quá hạn'),
        },
        {
          key: '/payables',
          label: renderMenuLabel('/payables', 'Công nợ phải trả'),
        },
        {
          key: '/finance-summary',
          label: renderMenuLabel('/finance-summary', 'Báo cáo tài chính'),
        },
        {
          key: '/profit-report',
          label: renderMenuLabel('/profit-report', 'Báo cáo lợi nhuận'),
        },
        {
          key: '/budget-management',
          label: renderMenuLabel('/budget-management', 'Quản lý ngân sách'),
        },
        {
          key: '/general-ledger',
          label: renderMenuLabel('/general-ledger', 'Sổ cái'),
        },
        {
          key: '/trial-balance',
          label: renderMenuLabel('/trial-balance', 'Bảng cân đối'),
        },
        {
          key: '/bank-reconciliation',
          label: renderMenuLabel('/bank-reconciliation', 'Đối soát ngân hàng'),
        },
      ],
    } : null,
    {
      key: '/task-inbox',
      icon: <InboxOutlined />,
      label: renderMenuLabel('/task-inbox', 'Nhiệm vụ của tôi'),
    },
    {
      key: '/notifications',
      icon: <BellOutlined />,
      label: renderMenuLabel(
        '/notifications',
        <span>
          Thông báo {unreadCount > 0 ? <Badge count={unreadCount} size="small" overflowCount={99} /> : null}
        </span>
      ),
    },
    canViewOps ? {
      key: 'ops-group',
      icon: <ControlOutlined />,
      label: 'Điều hành',
      children: [
        {
          key: '/executive-cockpit',
          label: renderMenuLabel('/executive-cockpit', 'Điều hành tổng hợp'),
        },
        {
          key: '/bi-dashboard',
          label: renderMenuLabel('/bi-dashboard', 'Điều hành BI'),
        },
        {
          key: '/task-operations',
          label: renderMenuLabel('/task-operations', 'Điều hành nhiệm vụ'),
        },
      ],
    } : null,
    (canManageWorkflow || canViewWorkflow) ? {
      key: 'workflow-group',
      icon: <ApartmentOutlined />,
      label: 'Quy trình',
      children: [
        ...(canManageWorkflow ? [{
          key: '/workflow-task-templates',
          label: renderMenuLabel('/workflow-task-templates', 'Mẫu nhiệm vụ'),
        }] : []),
        ...(canViewWorkflow ? [{
          key: '/workflow-pipeline',
          label: renderMenuLabel('/workflow-pipeline', 'Luồng công việc'),
        }, {
          key: '/workflow-analytics',
          label: renderMenuLabel('/workflow-analytics', 'Phân tích quy trình'),
        }] : []),
      ],
    } : null,
    (canViewOpsLog || canViewApprovalTower || canViewAdminAudit || canViewAdminObservability || canViewAccessGovernance || canManageAccessExceptions || canManageAccessReviews || canManageLifecycle || canManageProvisioning || canManageOnboarding || canManageRoleTeams || canManageUsers || canManageModulePermissions || canViewRbacAudit) ? {
      key: 'governance-group',
      icon: <SafetyOutlined />,
      label: 'Kiểm soát',
      children: [
        ...(canViewApprovalTower ? [{
          key: '/admin/approval-control-tower',
          label: renderMenuLabel('/admin/approval-control-tower', 'Trung tâm điều phối duyệt'),
        }] : []),
        ...(canViewAdminAudit ? [{
          key: '/admin/audit-center',
          label: renderMenuLabel('/admin/audit-center', 'Trung tâm kiểm soát audit'),
        }] : []),
        ...(canViewAdminObservability ? [{
          key: '/admin/observability',
          label: renderMenuLabel('/admin/observability', 'Trung tâm sức khỏe hệ thống'),
        }] : []),
        ...(canViewOpsLog ? [{
          key: '/operations-log',
          label: renderMenuLabel(
            '/operations-log',
            <span>
              Nhật ký vận hành {operationsFailedCount > 0 ? <Badge count={operationsFailedCount} size="small" overflowCount={99} /> : null}
            </span>
          ),
        }] : []),
        ...(canViewAccessGovernance ? [{
          key: '/admin/access-governance',
          label: renderMenuLabel('/admin/access-governance', 'Trung tâm giám sát truy cập'),
        }] : []),
        ...(canManageAccessExceptions ? [{
          key: '/admin/access-exceptions',
          label: renderMenuLabel('/admin/access-exceptions', 'Ngoại lệ truy cập'),
        }] : []),
        ...(canManageAccessReviews ? [{
          key: '/admin/access-reviews',
          label: renderMenuLabel('/admin/access-reviews', 'Review truy cập'),
        }] : []),
        ...(canManageProvisioning ? [{
          key: '/admin/user-provisioning',
          label: renderMenuLabel('/admin/user-provisioning', 'Bàn cấp tài khoản'),
        }] : []),
        ...(canManageOnboarding ? [{
          key: '/admin/onboarding-studio',
          label: renderMenuLabel('/admin/onboarding-studio', 'Trợ lý triển khai công việc'),
        }] : []),
        ...(canManageLifecycle ? [{
          key: '/admin/user-lifecycle',
          label: renderMenuLabel('/admin/user-lifecycle', 'Bàn kết thúc vòng đời'),
        }] : []),
        ...(canManageRoleTeams ? [{
          key: '/admin/roles-teams',
          label: renderMenuLabel('/admin/roles-teams', 'Vai trò và nhóm'),
        }] : []),
        ...(canManageUsers ? [{
          key: '/admin/users',
          label: renderMenuLabel('/admin/users', 'Quản trị người dùng'),
        }] : []),
        ...(canManageModulePermissions ? [{
          key: '/admin/module-permissions',
          label: renderMenuLabel('/admin/module-permissions', 'Phân quyền module'),
        }, {
          key: '/admin/system-configuration',
          label: renderMenuLabel('/admin/system-configuration', 'Cấu hình hệ thống'),
        }] : []),
        ...(canViewRbacAudit ? [{
          key: '/admin/module-permissions-history',
          label: renderMenuLabel(
            '/admin/module-permissions-history',
            <span>
              Lịch sử phân quyền {rbacAnomalyCount > 0 ? <Badge count={rbacAnomalyCount} size="small" overflowCount={99} /> : null}
            </span>
          ),
        }] : []),
      ],
    } : null,
  ];

  const handleLogout = useCallback(async () => {
    const refreshToken = storage.getRefreshToken();
    try {
      await authApi.logout(refreshToken);
    } catch {
      // Clear client-side auth state even if the server-side logout request fails.
    }
    storage.clear();
    navigate('/login');
  }, [navigate]);

  const accountMenuContent = (
    <div style={{ minWidth: 180 }}>
      <div
        role="button"
        tabIndex={0}
        style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        onMouseEnter={() => prefetchRouteChunk('/account')}
        onFocus={() => prefetchRouteChunk('/account')}
        onClick={() => navigate('/account')}
        onKeyDown={(e) => e.key === 'Enter' && navigate('/account')}
      >
        <UserOutlined />
        Thông tin cá nhân
      </div>
      <Divider style={{ margin: '4px 0' }} />
      <div
        role="button"
        tabIndex={0}
        style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}
        onClick={() => { void handleLogout(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            void handleLogout();
          }
        }}
      >
        <LogoutOutlined />
        Đăng xuất
      </div>
    </div>
  );

  const unreadItems = unreadQuery.data ?? [];
  const notificationPopoverContent = (
    <div style={{ width: 360 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Thông báo chưa đọc</strong>
        <Button
          type="link"
          size="small"
          loading={markAllReadMutation.isPending}
          onClick={() => markAllReadMutation.mutate()}
          style={{ paddingInline: 0 }}
        >
          Đánh dấu tất cả đã đọc
        </Button>
      </div>
      {unreadQuery.isLoading ? (
        <div style={{ padding: '10px 0' }}>Đang tải...</div>
      ) : unreadItems.length === 0 ? (
        <div style={{ color: '#8c8c8c' }}>Không có thông báo mới.</div>
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {unreadItems.slice(0, 8).map((item) => (
            <div key={item.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 8 }}>
              <div style={{ fontWeight: 600 }}>{item.title}</div>
              <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 2 }}>{item.message}</div>
              <div style={{ color: '#8c8c8c', fontSize: 11, marginTop: 4 }}>
                {dayjs(item.created_at).format('DD/MM HH:mm:ss')}
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                <Button
                  size="small"
                  loading={markReadMutation.isPending}
                  onClick={() => markReadMutation.mutate(item.id)}
                >
                  Đã đọc
                </Button>
                <Button
                  size="small"
                  type="link"
                  onClick={() => navigate('/notifications')}
                  style={{ paddingInline: 0 }}
                >
                  Mở trung tâm
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Divider style={{ margin: '10px 0' }} />
      <Button type="primary" block onClick={() => navigate('/notifications')}>
        Xem tất cả thông báo
      </Button>
    </div>
  );
  const restoredShortcutPopoverContent = (
    <div style={{ width: isMobile ? 288 : 320, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <strong>Lối tắt khôi phục</strong>
        <span style={{ color: '#64748b', fontSize: 12 }}>
          Kéo các chức năng dễ bị chìm trong menu con lên gần khu vực thao tác nhanh để mở ngay.
        </span>
      </div>
      {restoredHeaderShortcuts.map((shortcut) => (
        <Button
          key={shortcut.key}
          type="text"
          block
          data-testid={shortcut.testId}
          style={{
            height: 'auto',
            padding: '10px 12px',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            textAlign: 'left',
          }}
          onMouseEnter={() => prefetchRouteChunk(shortcut.path)}
          onFocus={() => prefetchRouteChunk(shortcut.path)}
          onClick={() => navigate(shortcut.path)}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 600, color: '#0f172a' }}>{shortcut.label}</span>
            <span style={{ color: '#64748b', fontSize: 12, whiteSpace: 'normal' }}>{shortcut.description}</span>
          </span>
          <span
            style={{
              border: '1px solid #dbeafe',
              background: '#eff6ff',
              color: '#2563eb',
              borderRadius: 999,
              padding: shortcut.badge ? '2px 8px' : '2px 10px',
              fontSize: 11,
              fontWeight: 700,
              lineHeight: '18px',
            }}
          >
            {shortcut.badge ?? 'Mở'}
          </span>
        </Button>
      ))}
    </div>
  );

  const handleMenuClick = useCallback(({ key }: { key: string }) => {
    if (!key || key.endsWith('-group')) return;
    if (key === location.pathname) {
      if (isMobile) setMobileMenuVisible(false);
      return;
    }
    navigate(key);
    if (isMobile) setMobileMenuVisible(false);
  }, [navigate, isMobile, location.pathname]);

  const handleCommandNavigate = useCallback((path: string) => {
    prefetchRouteChunk(path);
    if (path !== location.pathname) {
      navigate(path);
      window.setTimeout(() => {
        if (window.location.pathname !== path) {
          window.location.assign(path);
        }
      }, 80);
    }
    if (isMobile) setMobileMenuVisible(false);
  }, [isMobile, location.pathname, navigate, prefetchRouteChunk]);

  const handleToggleFavoriteCommand = useCallback((path: string) => {
    setFavoriteCommandPaths(toggleCommandPaletteFavoritePath(path));
  }, []);

  const menuContent = (
    <Menu
      theme={isMobile ? 'light' : 'dark'}
      mode="inline"
      selectedKeys={[location.pathname]}
      openKeys={collapsed && !isMobile ? [] : openMenuKeys}
      items={menuItems}
      onClick={handleMenuClick}
      onOpenChange={(keys) => setOpenMenuKeys(keys as string[])}
    />
  );

  return (
    <Layout className="app-main-layout" style={{ minHeight: '100vh' }}>
      {/* Desktop Sidebar */}
      {!isMobile && (
        <Sider
          className="app-desktop-sider"
          trigger={null}
          collapsible
          collapsed={collapsed}
          width={200}
          style={{
            borderRight: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <div className={`workspace-brand${collapsed ? ' workspace-brand--collapsed' : ''}`}>
            <div className="workspace-brand-mark">EC</div>
            {!collapsed ? (
              <div className="workspace-brand-copy">
                <div className="workspace-brand-title">ERP Carton</div>
                <div className="workspace-brand-subtitle">Enterprise command center</div>
              </div>
            ) : null}
          </div>
          {menuContent}
        </Sider>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <Drawer
          title={
            <div className="workspace-brand">
              <div className="workspace-brand-mark">EC</div>
              <div className="workspace-brand-copy">
                <div className="workspace-brand-title">ERP Carton</div>
                <div className="workspace-brand-subtitle">Enterprise command center</div>
              </div>
            </div>
          }
          placement="left"
          onClose={() => setMobileMenuVisible(false)}
          open={mobileMenuVisible}
          bodyStyle={{ padding: 0 }}
          width={250}
        >
          {menuContent}
        </Drawer>
      )}

      <Layout style={{ minWidth: 0 }}>
        <Header
          className="app-top-header"
          style={{
            padding: isMobile ? '0 12px' : '0 16px',
            background: '#fff',
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            gap: 12,
            height: isMobile ? '56px' : '64px',
            boxShadow: isMobile ? '0 1px 6px rgba(15, 23, 42, 0.08)' : 'none',
            borderBottom: '1px solid #eef2f7',
            position: 'sticky',
            top: 0,
            zIndex: 999,
          }}
        >
          <div className="workspace-header-leading">
            <Button
              type="text"
              className="workspace-shell-action"
              icon={isMobile ? (mobileMenuVisible ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />) : (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />)}
              onClick={() => {
                if (isMobile) {
                  setMobileMenuVisible(!mobileMenuVisible);
                } else {
                  setCollapsed(!collapsed);
                }
              }}
              style={{
                fontSize: '18px',
                width: isMobile ? 44 : desktopControlSize,
                height: isMobile ? 44 : desktopControlSize,
              }}
            />
            <div className="workspace-header-copy">
              <div className="workspace-header-kicker">
                <span>{activeCommand?.group ?? 'ERP Carton workspace'}</span>
                {!isMobile ? <span className="workspace-live-indicator">Live</span> : null}
                {!isMobile ? <span>{dayjs().format('DD/MM/YYYY')}</span> : null}
              </div>
              <div className="workspace-header-title">
                {activeCommand?.title ?? 'ERP Carton'}
              </div>
              {!isMobile ? (
                <div className="workspace-header-summary">
                  {workspaceSummary}
                </div>
              ) : null}
            </div>
          </div>

          {!isMobile ? (
            <div className="workspace-header-signal-row">
              {workspaceSignals.map((signal) => (
                <button
                  key={signal.key}
                  type="button"
                  className={`workspace-header-signal workspace-header-signal--${signal.tone}`}
                  onMouseEnter={() => prefetchRouteChunk(signal.path)}
                  onFocus={() => prefetchRouteChunk(signal.path)}
                  onClick={() => navigate(signal.path)}
                >
                  <span className="workspace-header-signal-count">{signal.value}</span>
                  <span className="workspace-header-signal-label">{signal.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          <Space size={10} style={{ marginLeft: 'auto' }}>
            <Button
              type="text"
              className="workspace-search-trigger workspace-shell-action"
              icon={<SearchOutlined />}
              data-testid="command-palette-open-button"
              onClick={() => setCommandPaletteOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: isMobile ? 40 : desktopControlSize,
                paddingInline: isMobile ? 10 : 14,
                border: '1px solid #e2e8f0',
                borderRadius: 999,
                background: '#f8fafc',
                color: '#0f172a',
              }}
            >
              {!isMobile ? (
                <>
                  <span>Tìm nhanh</span>
                  <span
                    style={{
                      border: '1px solid #dbeafe',
                      background: '#eff6ff',
                      color: '#2563eb',
                      borderRadius: 999,
                      padding: '1px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    Ctrl+K
                  </span>
                </>
              ) : null}
            </Button>
            {canUseScanCenter ? (
              <Button
                type="primary"
                className="workspace-shell-action"
                icon={<QrcodeOutlined />}
                data-testid="workspace-scan-center-button"
                onMouseEnter={() => prefetchRouteChunk('/scan-center')}
                onFocus={() => prefetchRouteChunk('/scan-center')}
                onClick={() => navigate(quickScanPath)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: isMobile ? 40 : desktopControlSize,
                  paddingInline: isMobile ? 12 : 14,
                  borderRadius: 999,
                  boxShadow: '0 10px 24px rgba(37, 99, 235, 0.18)',
                }}
              >
                {!isMobile ? (
                  <>
                    <span>Quét QR</span>
                    <span
                      style={{
                        border: '1px solid rgba(255,255,255,0.45)',
                        background: 'rgba(255,255,255,0.16)',
                        color: '#fff',
                        borderRadius: 999,
                        padding: '1px 8px',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {preferDesktopScanUi ? 'Máy tính' : 'Di động'}
                    </span>
                  </>
                ) : null}
              </Button>
            ) : null}
            {restoredHeaderShortcuts.length > 0 ? (
              <Popover content={restoredShortcutPopoverContent} placement="bottomRight" trigger="click">
                <Button
                  type="text"
                  className="workspace-shell-action"
                  icon={<AppstoreOutlined />}
                  data-testid="header-restored-shortcuts-button"
                  aria-label="Lối tắt khôi phục"
                  title="Lối tắt khôi phục"
                  style={{ fontSize: isMobile ? '14px' : '15px', height: isMobile ? 40 : desktopControlSize }}
                >
                  {isMobile ? null : 'Lối tắt'}
                </Button>
              </Popover>
            ) : null}
            <TaskQuickLauncher compact={isMobile} />
            <Popover content={notificationPopoverContent} placement="bottomRight" trigger="click">
              <Button
                type="text"
                className="workspace-shell-action"
                icon={<BellOutlined />}
                style={{ fontSize: isMobile ? '14px' : '15px', height: isMobile ? 40 : desktopControlSize }}
              >
                <span style={{ marginRight: 6 }}>Thông báo</span>
                <span style={{ color: unreadItems.length > 0 ? '#1677ff' : '#8c8c8c', fontWeight: 600 }}>
                  {unreadItems.length}
                </span>
              </Button>
            </Popover>
            <Popover content={accountMenuContent} placement="bottomRight" trigger="click">
              <Button className="workspace-shell-action" type="text" icon={<UserOutlined />} style={{ fontSize: isMobile ? '14px' : '15px', height: isMobile ? 40 : desktopControlSize }}>
                {isMobile ? (user?.username || 'Tài khoản') : `Tài khoản ${user?.username ? `(${user.username})` : ''}`}
              </Button>
            </Popover>
          </Space>
        </Header>
        <Content
          className="app-main-content"
          style={{
            margin: isMobile ? '12px 8px' : '14px auto 18px',
            width: isMobile ? 'auto' : 'min(100% - 20px, 1760px)',
            padding: isMobile ? 16 : 18,
            minHeight: 280,
            background: '#fff',
            borderRadius: isMobile ? '8px' : '12px',
            border: isMobile ? 'none' : '1px solid #eef2f7',
            boxShadow: isMobile ? 'none' : '0 1px 2px rgba(15, 23, 42, 0.04)',
          }}
        >
          <Outlet />
        </Content>
        <GlobalCommandPalette
          key={commandPaletteOpen ? 'command-palette-open' : 'command-palette-closed'}
          open={commandPaletteOpen}
          compact={isMobile}
          commands={commandPaletteCommands}
          favoritePaths={favoriteCommandPaths}
          recentPaths={recentCommandPaths}
          onClose={() => setCommandPaletteOpen(false)}
          onNavigate={handleCommandNavigate}
          onPrefetch={prefetchRouteChunk}
          onToggleFavorite={handleToggleFavoriteCommand}
        />
      </Layout>
    </Layout>
  );
};

export default MainLayout;
