import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import MainLayout from './MainLayout';
import { ProductsListFilterProvider } from '../../contexts/ProductsListFilterContext';
import { canAccessOpsModules, canManageModulePermissionSettings } from '../../utils/authz';
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
  '/task-inbox': () => import('../../pages/Tasks/TaskInbox'),
  '/products': () => import('../../pages/Products/ProductList'),
  '/customers': () => import('../../pages/Customers/CustomerList'),
  '/executive-cockpit': () => import('../../pages/Management/ExecutiveCockpit'),
  '/notifications': () => import('../../pages/Notifications/NotificationCenter'),
  '/workflow-pipeline': () => import('../../pages/WorkflowPipeline/WorkflowPipelineBoard'),
  '/workflow-analytics': () => import('../../pages/WorkflowPipeline/WorkflowAnalyticsDashboard'),
  '/task-operations': () => import('../../pages/Tasks/TaskOperationsBoard'),
  '/admin/module-permissions': () => import('../../pages/Admin/ModulePermissionSettings'),
  '/admin/module-permissions-history': () => import('../../pages/Admin/ModulePermissionHistory'),
};

function getRoutePrefetchOrder(pathname: string, canAccessOps: boolean, canManageRbac: boolean): string[] {
  const common = ['/task-inbox', '/products', '/notifications'];
  if (pathname.startsWith('/products')) {
    return [
      ...common,
      '/customers',
      ...(canAccessOps ? ['/task-operations'] : []),
      ...(canManageRbac ? ['/admin/module-permissions', '/admin/module-permissions-history'] : []),
    ];
  }
  if (pathname.startsWith('/task') || pathname.startsWith('/workflow')) {
    return [
      ...common,
      ...(canAccessOps ? ['/executive-cockpit', '/workflow-pipeline', '/workflow-analytics', '/task-operations'] : []),
      ...(canManageRbac ? ['/admin/module-permissions', '/admin/module-permissions-history'] : []),
      '/customers',
    ];
  }
  return [
    ...common,
    '/customers',
    ...(canAccessOps ? ['/executive-cockpit', '/workflow-pipeline'] : []),
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
    const canManageRbac = canManageModulePermissionSettings();
    const routePrefetchTasks = getRoutePrefetchOrder(pathname, canAccessOps, canManageRbac)
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

  return (
    <ProductsListFilterProvider>
      <MainLayout />
    </ProductsListFilterProvider>
  );
}
