import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import MainLayout from './MainLayout';
import { canAccessOpsModules, canAccessSalesOrders, canAccessMaterialIssues, canAccessProductionCenter, canAccessProductionReceipts, canManageFinanceData, canManageInventoryData, canManageModulePermissionSettings, canManageProductionData, canManagePurchasingData, canViewReportsCenter, canViewWorkflowData, canManageWorkflowData } from '../../utils/authz';
import { usersApi } from '../../api/users';
import { storage } from '../../utils/storage';

type ConnectionLike = {
  saveData?: boolean;
  effectiveType?: string;
};

function shouldSkipPrefetch(): boolean {
  const connection = (globalThis.navigator as Navigator & { connection?: ConnectionLike }).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g';
}

const routeChunkPrefetchers: Record<string, () => Promise<unknown>> = {
  '/account': () => import('../../pages/Account/AccountCenter'),
  '/task-inbox': () => import('../../pages/Tasks/TaskInbox'),
  '/products': () => import('../../pages/Products/ProductList'),
  '/sales-orders': () => import('../../pages/Sales/SalesOrderList'),
  '/scan-center': () => import('../../pages/Inventory/ScanCenter'),
  '/shipments/scan': () => import('../../pages/Inventory/ScanCenter'),
  '/warehouses': () => import('../../pages/Inventory/WarehouseList'),
  '/warehouse-locations': () => import('../../pages/Inventory/WarehouseLocationList'),
  '/inventory-stock': () => import('../../pages/Inventory/InventoryStockOverview'),
  '/inventory-transactions': () => import('../../pages/Inventory/InventoryTransactionList'),
  '/inventory-reservations': () => import('../../pages/Inventory/InventoryReservationList'),
  '/customers': () => import('../../pages/Customers/CustomerList'),
  '/suppliers': () => import('../../pages/Purchasing/SupplierList'),
  '/material-prices': () => import('../../pages/Purchasing/MaterialPriceList'),
  '/purchase-orders': () => import('../../pages/Purchasing/PurchaseOrderList'),
  '/purchase-receipts': () => import('../../pages/Purchasing/PurchaseReceiptList'),
  '/production-orders': () => import('../../pages/Production/ProductionOrderList'),
  '/production-receipts': () => import('../../pages/Production/ProductionReceiptList'),
  '/reports': () => import('../../pages/Management/ReportsCenter'),
  '/receivables': () => import('../../pages/Finance/AccountsReceivableList'),
  '/payables': () => import('../../pages/Finance/AccountsPayableList'),
  '/finance-summary': () => import('../../pages/Finance/FinanceSummary'),
  '/executive-cockpit': () => import('../../pages/Management/ExecutiveCockpit'),
  '/notifications': () => import('../../pages/Notifications/NotificationCenter'),
  '/workflow-pipeline': () => import('../../pages/WorkflowPipeline/WorkflowPipelineBoard'),
  '/workflow-analytics': () => import('../../pages/WorkflowPipeline/WorkflowAnalyticsDashboard'),
  '/task-operations': () => import('../../pages/Tasks/TaskOperationsBoard'),
  '/admin/module-permissions': () => import('../../pages/Admin/ModulePermissionSettings'),
  '/admin/module-permissions-history': () => import('../../pages/Admin/ModulePermissionHistory'),
};

function getRoutePrefetchOrder(pathname: string, canAccessOps: boolean, canViewReports: boolean, canViewWorkflow: boolean, canManageWorkflow: boolean, canManageRbac: boolean, canManageInventory: boolean, canManagePurchasing: boolean, canAccessProduction: boolean, canAccessMaterialIssueRoute: boolean, canAccessProductionReceiptRoute: boolean, canManageFinance: boolean, canAccessSales: boolean): string[] {
  const common = [
    '/account',
    '/task-inbox',
    ...(canViewReports ? ['/reports'] : []),
    '/products',
    ...(canAccessSales ? ['/sales-orders', '/shipments/scan'] : ['/shipments/scan']),
    ...(canManagePurchasing ? ['/purchase-orders', '/purchase-receipts', '/suppliers', '/material-prices'] : []),
    ...(canAccessProduction ? ['/production-orders'] : []),
    ...(canAccessMaterialIssueRoute ? ['/material-issues'] : []),
    ...(canAccessProductionReceiptRoute ? ['/production-receipts'] : []),
    ...(canManageFinance ? ['/receivables', '/payables', '/finance-summary'] : []),
    '/notifications',
    ...(canManageInventory ? ['/inventory-stock', '/inventory-transactions'] : []),
  ];
  if (pathname.startsWith('/products')) {
    return [
      ...common,
      ...(canManageInventory ? ['/warehouses', '/warehouse-locations', '/inventory-reservations'] : []),
      '/customers',
      ...(canAccessOps ? ['/task-operations'] : []),
      ...(canViewWorkflow ? ['/workflow-pipeline', '/workflow-analytics'] : []),
      ...(canManageWorkflow ? ['/workflow-task-templates'] : []),
      ...(canManageRbac ? ['/admin/module-permissions', '/admin/module-permissions-history'] : []),
    ];
  }
  if (pathname.startsWith('/sales-orders')) {
    return [
      ...common,
      ...(canManageInventory ? ['/inventory-stock', '/inventory-reservations'] : []),
      '/customers',
      ...(canAccessOps ? ['/task-operations'] : []),
      ...(canViewWorkflow ? ['/workflow-pipeline', '/workflow-analytics'] : []),
      ...(canManageRbac ? ['/admin/module-permissions', '/admin/module-permissions-history'] : []),
    ];
  }
  if (pathname.startsWith('/inventory')) {
    return [
      ...common,
      ...(canManageInventory ? ['/warehouses', '/warehouse-locations', '/inventory-stock', '/inventory-transactions', '/inventory-reservations'] : []),
      '/customers',
      ...(canAccessOps ? ['/task-operations'] : []),
      ...(canViewWorkflow ? ['/workflow-pipeline', '/workflow-analytics'] : []),
      ...(canManageRbac ? ['/admin/module-permissions', '/admin/module-permissions-history'] : []),
    ];
  }
  if (pathname.startsWith('/task') || pathname.startsWith('/workflow')) {
    return [
      ...common,
      ...(canManageInventory ? ['/inventory-stock', '/inventory-transactions'] : []),
      ...(canAccessOps ? ['/executive-cockpit', '/task-operations'] : []),
      ...(canViewWorkflow ? ['/workflow-pipeline', '/workflow-analytics'] : []),
      ...(canManageWorkflow ? ['/workflow-task-templates'] : []),
      ...(canManageRbac ? ['/admin/module-permissions', '/admin/module-permissions-history'] : []),
      '/customers',
    ];
  }
  return [
    ...common,
    ...(canManageInventory ? ['/warehouses', '/warehouse-locations', '/inventory-stock', '/inventory-transactions', '/inventory-reservations'] : []),
    '/customers',
    ...(canAccessOps ? ['/executive-cockpit', '/task-operations'] : []),
    ...(canViewWorkflow ? ['/workflow-pipeline', '/workflow-analytics'] : []),
    ...(canManageWorkflow ? ['/workflow-task-templates'] : []),
    ...(canManageRbac ? ['/admin/module-permissions', '/admin/module-permissions-history'] : []),
  ];
}

export default function AuthenticatedShell() {
  const queryClient = useQueryClient();
  const [, setAuthzVersion] = useState(0);

  useEffect(() => {
    let active = true;
    usersApi
      .me()
      .then((profile) => {
        if (!active) return;
        storage.setUser(profile);
        // Force rerender so role-based menu/buttons reflect latest profile.
        setAuthzVersion((v) => v + 1);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (shouldSkipPrefetch()) return;

    const pathname = globalThis.location?.pathname || '/';
    const canAccessOps = canAccessOpsModules();
    const canViewReports = canViewReportsCenter();
    const canAccessSales = canAccessSalesOrders();
    const canManageFinance = canManageFinanceData();
    const canManageInventory = canManageInventoryData();
    const canManagePurchasing = canManagePurchasingData();
    const canManageProduction = canManageProductionData();
    const canAccessProduction = canAccessProductionCenter();
    const canAccessMaterialIssueRoute = canAccessMaterialIssues();
    const canAccessProductionReceiptRoute = canAccessProductionReceipts();
    const canViewWorkflow = canViewWorkflowData();
    const canManageWorkflow = canManageWorkflowData();
    const canManageRbac = canManageModulePermissionSettings();
    const routePrefetchTasks = getRoutePrefetchOrder(pathname, canAccessOps, canViewReports, canViewWorkflow, canManageWorkflow, canManageRbac, canManageInventory, canManagePurchasing, canAccessProduction || canManageProduction, canAccessMaterialIssueRoute, canAccessProductionReceiptRoute, canManageFinance, canAccessSales)
      .filter((routePath) => routePath !== pathname)
      .map((routePath) => routeChunkPrefetchers[routePath])
      .filter((v): v is (() => Promise<unknown>) => typeof v === 'function');
    const dataPrefetchTasks: Array<() => Promise<unknown>> = [
      () =>
        import('../../api/tasks').then(({ tasksApi }) =>
          queryClient.prefetchQuery({
            queryKey: ['task-inbox-summary'],
            queryFn: () => tasksApi.mySummary(),
            staleTime: 10_000,
          })
        ),
      () =>
        import('../../api/notifications').then(({ notificationsApi }) =>
          queryClient.prefetchQuery({
            queryKey: ['notifications-unread-count'],
            queryFn: () => notificationsApi.unreadCount(),
            staleTime: 5_000,
          })
        ),
      () =>
        import('../../api/notifications').then(({ notificationsApi }) =>
          queryClient.prefetchQuery({
            queryKey: ['header-notifications-unread'],
            queryFn: () => notificationsApi.unread(),
            staleTime: 5_000,
          })
        ),
    ];
    const prefetchTasks: Array<() => Promise<unknown>> = [...routePrefetchTasks, ...dataPrefetchTasks];

    const runPrefetch = () => {
      // Prefetch sequentially to avoid network burst on weaker machines.
      prefetchTasks.reduce<Promise<unknown>>(
        (p, task) => p.then(() => task()).catch(() => undefined),
        Promise.resolve()
      );
    };

    const w = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
      setTimeout: typeof setTimeout;
      clearTimeout: typeof clearTimeout;
    };

    if (typeof w.requestIdleCallback === 'function') {
      const idleId = w.requestIdleCallback(() => runPrefetch(), { timeout: 2_500 });
      return () => w.cancelIdleCallback?.(idleId);
    }

    const timeoutId = w.setTimeout(runPrefetch, 1_200);
    return () => w.clearTimeout(timeoutId);
  }, [queryClient]);

  return <MainLayout />;
}
