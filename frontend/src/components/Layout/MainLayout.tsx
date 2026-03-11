import { useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Layout, Menu, Button, Popover, Space, message, Divider, Drawer, Badge } from 'antd';
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
  LogoutOutlined,
  BellOutlined,
  SafetyOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { storage } from '../../utils/storage';
import TaskQuickLauncher from '../TaskQuickLauncher/TaskQuickLauncher';
import { notificationsApi } from '../../api/notifications';
import { operationsApi } from '../../api/operations';
import { adminApi } from '../../api/admin';
import { financeApi } from '../../api/finance';
import { workforceApi } from '../../api/workforce';
import {
  canManageFinanceData,
  canAccessSalesOrders,
  canManageInventoryData,
  canManageModulePermissionSettings,
  canManageWorkforceData,
  canViewModulePermissionHistory,
  canViewOperationsLog,
  canViewOpsHub,
  canViewWorkflowData,
  canManageWorkflowData,
} from '../../utils/authz';
import { useRealtimePollingInterval } from '../../hooks/useRealtimePollingInterval';

const { Header, Sider, Content } = Layout;
const SIDEBAR_OPEN_KEYS_STORAGE_KEY = 'erp-carton.sidebar-open-keys';

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
  '/products': () => import('../../pages/Products/ProductList'),
  '/sales-orders': () => import('../../pages/Sales/SalesOrderList'),
  '/categories': () => import('../../pages/Categories/CategoryList'),
  '/units': () => import('../../pages/Units/UnitList'),
  '/customers': () => import('../../pages/Customers/CustomerList'),
  '/warehouses': () => import('../../pages/Inventory/WarehouseList'),
  '/warehouse-locations': () => import('../../pages/Inventory/WarehouseLocationList'),
  '/inventory-stock': () => import('../../pages/Inventory/InventoryStockOverview'),
  '/inventory-transactions': () => import('../../pages/Inventory/InventoryTransactionList'),
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
  '/finance-summary': () => import('../../pages/Finance/FinanceSummary'),
  '/admin/module-permissions': () => import('../../pages/Admin/ModulePermissionSettings'),
  '/admin/module-permissions-history': () => import('../../pages/Admin/ModulePermissionHistory'),
};

const MainLayout = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [openMenuKeys, setOpenMenuKeys] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(SIDEBAR_OPEN_KEYS_STORAGE_KEY);
      if (!raw) return ['workforce-group', 'finance-group'];
      const parsed = JSON.parse(raw) as string[];
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : ['inventory-group', 'workforce-group', 'finance-group'];
    } catch {
      return ['inventory-group', 'workforce-group', 'finance-group'];
    }
  });
  const navigate = useNavigate();
  const location = useLocation();
  const user = storage.getUser();
  const desktopControlSize = 40;
  const queryClient = useQueryClient();
  const prefetchedRoutesRef = useRef<Set<string>>(new Set());
  const canViewOps = canViewOpsHub();
  const canViewSalesOrders = canAccessSalesOrders();
  const canViewWorkflow = canViewWorkflowData();
  const canManageWorkflow = canManageWorkflowData();
  const canViewOpsLog = canViewOperationsLog();
  const canManageFinance = canManageFinanceData();
  const canManageInventory = canManageInventoryData();
  const canManageWorkforce = canManageWorkforceData();
  const canManageModulePermissions = canManageModulePermissionSettings();
  const canViewRbacAudit = canViewModulePermissionHistory();
  const headerNotificationInterval = useRealtimePollingInterval({
    enabled: true,
    activeMs: 15_000,
    hiddenMs: false,
  });
  const unreadQuery = useQuery({
    queryKey: ['header-notifications-unread'],
    queryFn: () => notificationsApi.unread(),
    staleTime: 5_000,
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
    staleTime: 30_000,
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
    staleTime: 30_000,
    refetchInterval: workforceApprovalInterval,
    refetchIntervalInBackground: false,
  });
  const operationsLogMetaQuery = useQuery({
    queryKey: ['layout-operations-log-meta'],
    queryFn: () => operationsApi.meta(),
    enabled: canViewOpsLog,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const rbacHistoryMetaQuery = useQuery({
    queryKey: ['layout-rbac-history-meta'],
    queryFn: () => adminApi.getRoleModulePermissionHistoryMeta(),
    enabled: canViewRbacAudit,
    staleTime: 60_000,
    refetchInterval: 120_000,
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
        setCollapsed(true); // Auto-collapse on mobile
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check

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

  const menuItems: MenuProps['items'] = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: renderMenuLabel('/', 'Tổng quan'),
    },
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
    canManageInventory ? {
      key: 'inventory-group',
      icon: <DatabaseOutlined />,
      label: 'Kho',
      children: [
        {
          key: '/inventory-stock',
          label: renderMenuLabel('/inventory-stock', 'Tồn kho'),
        },
        {
          key: '/inventory-transactions',
          label: renderMenuLabel('/inventory-transactions', 'Sổ kho'),
        },
        {
          key: '/inventory-reservations',
          label: renderMenuLabel('/inventory-reservations', 'Reservation'),
        },
        {
          key: '/warehouses',
          label: renderMenuLabel('/warehouses', 'Kho hàng'),
        },
        {
          key: '/warehouse-locations',
          label: renderMenuLabel('/warehouse-locations', 'Vị trí kho'),
        },
      ],
    } : null,
    {
      key: '/pricings',
      icon: <DollarOutlined />,
      label: renderMenuLabel('/pricings', 'Bảng giá'),
    },
    {
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
      ],
    },
    {
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
              Tạm ứng {overdue90Count > 0 ? <Badge count={overdue90Count} size="small" overflowCount={99} /> : null}
            </span>
          ),
        },
        {
          key: '/finance-summary',
          label: renderMenuLabel('/finance-summary', 'Báo cáo tài chính'),
        },
      ],
    },
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
          key: '/task-operations',
          label: renderMenuLabel('/task-operations', 'Điều hành nhiệm vụ'),
        },
      ],
    } : null,
    (canManageWorkflow || canViewWorkflow) ? {
      key: 'workflow-group',
      icon: <ApartmentOutlined />,
      label: 'Workflow',
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
    (canViewOpsLog || canManageModulePermissions || canViewRbacAudit) ? {
      key: 'governance-group',
      icon: <SafetyOutlined />,
      label: 'Kiểm soát',
      children: [
        ...(canViewOpsLog ? [{
          key: '/operations-log',
          label: renderMenuLabel(
            '/operations-log',
            <span>
              Nhật ký vận hành {operationsFailedCount > 0 ? <Badge count={operationsFailedCount} size="small" overflowCount={99} /> : null}
            </span>
          ),
        }] : []),
        ...(canManageModulePermissions ? [{
          key: '/admin/module-permissions',
          label: renderMenuLabel('/admin/module-permissions', 'Phân quyền module'),
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

  const handleLogout = useCallback(() => {
    storage.clear();
    navigate('/login');
  }, [navigate]);

  const accountMenuContent = (
    <div style={{ minWidth: 180 }}>
      <div
        role="button"
        tabIndex={0}
        style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        onClick={() => message.info('Chức năng đang phát triển')}
        onKeyDown={(e) => e.key === 'Enter' && message.info('Chức năng đang phát triển')}
      >
        <UserOutlined />
        Thông tin cá nhân
      </div>
      <Divider style={{ margin: '4px 0' }} />
      <div
        role="button"
        tabIndex={0}
        style={{ padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: '#ff4d4f' }}
        onClick={handleLogout}
        onKeyDown={(e) => e.key === 'Enter' && handleLogout()}
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

  const handleMenuClick = useCallback(({ key }: { key: string }) => {
    prefetchRouteChunk(key);
    navigate(key);
    if (isMobile) {
      setMobileMenuVisible(false);
    }
  }, [navigate, isMobile, prefetchRouteChunk]);

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
          <div
            style={{
              height: '64px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '18px',
              fontWeight: 'bold',
            }}
          >
            {collapsed ? '🏭' : '🏭 ERP Carton'}
          </div>
          {menuContent}
        </Sider>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <Drawer
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '20px' }}>🏭</span>
              <span style={{ fontSize: '18px', fontWeight: 'bold' }}>ERP Carton</span>
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
            justifyContent: 'space-between',
            alignItems: 'center',
            height: isMobile ? '56px' : '64px',
            boxShadow: isMobile ? '0 1px 6px rgba(15, 23, 42, 0.08)' : 'none',
            borderBottom: '1px solid #eef2f7',
            position: 'sticky',
            top: 0,
            zIndex: 999,
          }}
        >
          <Button
            type="text"
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

          <Space size={10}>
            {!isMobile && <TaskQuickLauncher />}
            <Popover content={notificationPopoverContent} placement="bottomRight" trigger="click">
              <Button
                type="text"
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
              <Button type="text" icon={<UserOutlined />} style={{ fontSize: isMobile ? '14px' : '15px', height: isMobile ? 40 : desktopControlSize }}>
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
      </Layout>
    </Layout>
  );
};

export default MainLayout;
