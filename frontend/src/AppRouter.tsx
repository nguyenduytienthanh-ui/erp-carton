import { Suspense, lazy, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App as AntApp, ConfigProvider, Spin } from 'antd';
import type { Locale } from 'antd/es/locale';
import { theme as customTheme } from './styles/theme';
import PrivateRoute from './components/PrivateRoute';
import FeatureRoute from './components/FeatureRoute';

import { ErrorBoundary } from './components/ErrorBoundary';
import { canAccessOpsModules, canManageModulePermissionSettings } from './utils/authz';

const Login = lazy(() => import('./pages/Login'));
const AuthenticatedShell = lazy(() => import('./components/Layout/AuthenticatedShell'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ProductList = lazy(() => import('./pages/Products/ProductList'));
const CategoryList = lazy(() => import('./pages/Categories/CategoryList'));
const UnitList = lazy(() => import('./pages/Units/UnitList'));
const CustomerList = lazy(() => import('./pages/Customers/CustomerList'));
const ExecutiveCockpit = lazy(() => import('./pages/Management/ExecutiveCockpit'));
const TaskOperationsBoard = lazy(() => import('./pages/Tasks/TaskOperationsBoard'));
const TaskInbox = lazy(() => import('./pages/Tasks/TaskInbox'));
const WorkflowTaskTemplateList = lazy(() => import('./pages/WorkflowTaskTemplates/WorkflowTaskTemplateList'));
const WorkflowPipelineBoard = lazy(() => import('./pages/WorkflowPipeline/WorkflowPipelineBoard'));
const WorkflowAnalyticsDashboard = lazy(() => import('./pages/WorkflowPipeline/WorkflowAnalyticsDashboard'));
const NotificationCenter = lazy(() => import('./pages/Notifications/NotificationCenter'));
const OperationsLogDashboard = lazy(() => import('./pages/Operations/OperationsLogDashboard'));
const EmployeeList = lazy(() => import('./pages/Workforce/EmployeeList'));
const AttendanceList = lazy(() => import('./pages/Workforce/AttendanceList'));
const BonusPenaltyList = lazy(() => import('./pages/Workforce/BonusPenaltyList'));
const PayrollList = lazy(() => import('./pages/Workforce/PayrollList'));
const SalaryAdvanceList = lazy(() => import('./pages/Workforce/SalaryAdvanceList'));
const BankAccountList = lazy(() => import('./pages/Finance/BankAccountList'));
const TransactionCategoryList = lazy(() => import('./pages/Finance/TransactionCategoryList'));
const CashBook = lazy(() => import('./pages/Finance/CashBook'));
const AdvanceTransactionList = lazy(() => import('./pages/Finance/AdvanceTransactionList'));
const FinanceSummary = lazy(() => import('./pages/Finance/FinanceSummary'));
const ModulePermissionSettings = lazy(() => import('./pages/Admin/ModulePermissionSettings'));
const ModulePermissionHistory = lazy(() => import('./pages/Admin/ModulePermissionHistory'));

export default function AppRouter() {
  const canAccessOps = canAccessOpsModules();
  const canManageModulePermissions = canManageModulePermissionSettings();
  const [antdLocale, setAntdLocale] = useState<Locale | undefined>(undefined);
  const routeFallback = (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <Spin />
    </div>
  );
  const withAsyncBoundary = (element: ReactNode) => (
    <Suspense fallback={routeFallback}>
      <ErrorBoundary>{element}</ErrorBoundary>
    </Suspense>
  );

  useEffect(() => {
    void import('antd/locale/vi_VN')
      .then((m) => setAntdLocale(m.default))
      .catch(() => setAntdLocale(undefined));
  }, []);

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        token: {
          colorPrimary: customTheme.colors.primary,
          colorSuccess: customTheme.colors.success,
          colorWarning: customTheme.colors.warning,
          colorError: customTheme.colors.error,
          colorInfo: customTheme.colors.info,
          borderRadius: 8,
          fontFamily: customTheme.typography.fontFamily,
        },
        components: {
          Button: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Input: {
            borderRadius: 8,
            controlHeight: 36,
          },
          Select: {
            borderRadius: 8,
            controlHeight: 36,
            zIndexPopup: 9999,
          },
          Card: {
            borderRadiusLG: 12,
          },
          Table: {
            borderRadius: 8,
          },
        },
      }}
    >
      <AntApp>
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <Routes>
            <Route path="/login" element={withAsyncBoundary(<Login />)} />

            <Route
              path="/"
              element={
                <PrivateRoute>
                  <Suspense fallback={routeFallback}>
                    <AuthenticatedShell />
                  </Suspense>
                </PrivateRoute>
              }
            >
              <Route index element={withAsyncBoundary(<Dashboard />)} />
              <Route path="products" element={withAsyncBoundary(<ProductList />)} />
              <Route path="categories" element={withAsyncBoundary(<CategoryList />)} />
              <Route path="units" element={withAsyncBoundary(<UnitList />)} />
              <Route path="customers" element={withAsyncBoundary(<CustomerList />)} />
              <Route path="executive-cockpit" element={<FeatureRoute allow={canAccessOps} fallbackTo="/task-inbox">{withAsyncBoundary(<ExecutiveCockpit />)}</FeatureRoute>} />
              <Route path="task-operations" element={<FeatureRoute allow={canAccessOps} fallbackTo="/task-inbox">{withAsyncBoundary(<TaskOperationsBoard />)}</FeatureRoute>} />
              <Route path="task-inbox" element={withAsyncBoundary(<TaskInbox />)} />
              <Route path="workflow-task-templates" element={<FeatureRoute allow={canAccessOps} fallbackTo="/task-inbox">{withAsyncBoundary(<WorkflowTaskTemplateList />)}</FeatureRoute>} />
              <Route path="workflow-pipeline" element={<FeatureRoute allow={canAccessOps} fallbackTo="/task-inbox">{withAsyncBoundary(<WorkflowPipelineBoard />)}</FeatureRoute>} />
              <Route path="workflow-analytics" element={<FeatureRoute allow={canAccessOps} fallbackTo="/task-inbox">{withAsyncBoundary(<WorkflowAnalyticsDashboard />)}</FeatureRoute>} />
              <Route path="notifications" element={withAsyncBoundary(<NotificationCenter />)} />
              <Route path="operations-log" element={<FeatureRoute allow={canAccessOps} fallbackTo="/task-inbox">{withAsyncBoundary(<OperationsLogDashboard />)}</FeatureRoute>} />
              <Route path="pricings" element={<div>Bảng giá sản phẩm (Đang phát triển)</div>} />
              <Route path="employees" element={withAsyncBoundary(<EmployeeList />)} />
              <Route path="attendance" element={withAsyncBoundary(<AttendanceList />)} />
              <Route path="bonus-penalty" element={withAsyncBoundary(<BonusPenaltyList />)} />
              <Route path="payroll" element={withAsyncBoundary(<PayrollList />)} />
              <Route path="salary-advance" element={withAsyncBoundary(<SalaryAdvanceList />)} />
              <Route path="transaction-categories" element={withAsyncBoundary(<TransactionCategoryList />)} />
              <Route path="bank-accounts" element={withAsyncBoundary(<BankAccountList />)} />
              <Route path="cash-book" element={withAsyncBoundary(<CashBook />)} />
              <Route path="advance-transactions" element={withAsyncBoundary(<AdvanceTransactionList />)} />
              <Route path="finance-summary" element={withAsyncBoundary(<FinanceSummary />)} />
              <Route
                path="admin/module-permissions"
                element={(
                  <FeatureRoute allow={canManageModulePermissions} fallbackTo="/">
                    {withAsyncBoundary(<ModulePermissionSettings />)}
                  </FeatureRoute>
                )}
              />
              <Route
                path="admin/module-permissions-history"
                element={(
                  <FeatureRoute allow={canManageModulePermissions} fallbackTo="/">
                    {withAsyncBoundary(<ModulePermissionHistory />)}
                  </FeatureRoute>
                )}
              />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}
