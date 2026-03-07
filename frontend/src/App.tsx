import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App as AntApp, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import { theme as customTheme } from './styles/theme';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MainLayout from './components/Layout/MainLayout';
import PrivateRoute from './components/PrivateRoute';

import ProductList from './pages/Products/ProductList';
import CategoryList from './pages/Categories/CategoryList';
import UnitList from './pages/Units/UnitList';
import CustomerList from './pages/Customers/CustomerList';
import TaskOperationsBoard from './pages/Tasks/TaskOperationsBoard';
import TaskInbox from './pages/Tasks/TaskInbox';
import WorkflowTaskTemplateList from './pages/WorkflowTaskTemplates/WorkflowTaskTemplateList';
import WorkflowPipelineBoard from './pages/WorkflowPipeline/WorkflowPipelineBoard';
import WorkflowAnalyticsDashboard from './pages/WorkflowPipeline/WorkflowAnalyticsDashboard';
import NotificationCenter from './pages/Notifications/NotificationCenter';
import OperationsLogDashboard from './pages/Operations/OperationsLogDashboard';
import { ProductsListFilterProvider } from './contexts/ProductsListFilterContext';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <ConfigProvider
      locale={viVN}
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
          <Route path="/login" element={<Login />} />

          <Route
            path="/"
            element={
              <PrivateRoute>
                <ProductsListFilterProvider>
                  <MainLayout />
                </ProductsListFilterProvider>
              </PrivateRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="products" element={<ErrorBoundary><ProductList /></ErrorBoundary>} />
            <Route path="categories" element={<CategoryList />} />
            <Route path="units" element={<UnitList />} />
            <Route path="customers" element={<ErrorBoundary><CustomerList /></ErrorBoundary>} />
            <Route path="task-operations" element={<ErrorBoundary><TaskOperationsBoard /></ErrorBoundary>} />
            <Route path="task-inbox" element={<ErrorBoundary><TaskInbox /></ErrorBoundary>} />
            <Route path="workflow-task-templates" element={<ErrorBoundary><WorkflowTaskTemplateList /></ErrorBoundary>} />
            <Route path="workflow-pipeline" element={<ErrorBoundary><WorkflowPipelineBoard /></ErrorBoundary>} />
            <Route path="workflow-analytics" element={<ErrorBoundary><WorkflowAnalyticsDashboard /></ErrorBoundary>} />
            <Route path="notifications" element={<ErrorBoundary><NotificationCenter /></ErrorBoundary>} />
            <Route path="operations-log" element={<ErrorBoundary><OperationsLogDashboard /></ErrorBoundary>} />
            <Route path="pricings" element={<div>Bảng giá sản phẩm (Đang phát triển)</div>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}

export default App;
