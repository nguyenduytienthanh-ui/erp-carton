import { Suspense, lazy, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App as AntApp, ConfigProvider, Spin } from 'antd';
import type { Locale } from 'antd/es/locale';
import { theme as customTheme } from './styles/theme';
import PrivateRoute from './components/PrivateRoute';
import FeatureRoute from './components/FeatureRoute';
import { ProductsListFilterProvider } from './contexts/ProductsListFilterContext';

import { ErrorBoundary } from './components/ErrorBoundary';
import {
  canAccessSalesOrders,
  canManageModulePermissionSettings,
  canManageFinanceData,
  canManageInventoryData,
  canManageStocktake,
  canManagePurchasingData,
  canManageProductionData,
  canManageWorkforceData,
  canViewModulePermissionHistory,
  canViewOperationsLog,
  canViewOpsHub,
  canViewReportsCenter,
  canViewWorkflowData,
  canManageWorkflowData,
} from './utils/authz';

const Login = lazy(() => import('./pages/Login'));
const AuthenticatedShell = lazy(() => import('./components/Layout/AuthenticatedShell'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ProductList = lazy(() => import('./pages/Products/ProductList'));
const SalesOrderList = lazy(() => import('./pages/Sales/SalesOrderList'));
const ShipmentList = lazy(() => import('./pages/Sales/ShipmentList'));
const QuoteList = lazy(() => import('./pages/Sales/QuoteList'));
const CategoryList = lazy(() => import('./pages/Categories/CategoryList'));
const UnitList = lazy(() => import('./pages/Units/UnitList'));
const CustomerList = lazy(() => import('./pages/Customers/CustomerList'));
const SupplierList = lazy(() => import('./pages/Purchasing/SupplierList'));
const MaterialPriceList = lazy(() => import('./pages/Purchasing/MaterialPriceList'));
const PurchaseOrderList = lazy(() => import('./pages/Purchasing/PurchaseOrderList'));
const PurchaseReceiptList = lazy(() => import('./pages/Purchasing/PurchaseReceiptList'));
const PurchaseRequestList = lazy(() => import('./pages/Purchasing/PurchaseRequestList'));
const PurchaseReturnList = lazy(() => import('./pages/Purchasing/PurchaseReturnList'));
const ProductionOrderList = lazy(() => import('./pages/Production/ProductionOrderList'));
const ExecutiveCockpit = lazy(() => import('./pages/Management/ExecutiveCockpit'));
const ReportsCenter = lazy(() => import('./pages/Management/ReportsCenter'));
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
const GeneralLedger = lazy(() => import('./pages/Finance/GeneralLedger'));
const GeneralLedgerList = lazy(() => import('./pages/Finance/GeneralLedgerList'));
const TrialBalance = lazy(() => import('./pages/Finance/TrialBalance'));
const BankReconciliation = lazy(() => import('./pages/Finance/BankReconciliation'));
const BankReconciliationList = lazy(() => import('./pages/Finance/BankReconciliationList'));
const AccountsReceivableList = lazy(() => import('./pages/Finance/AccountsReceivableList'));
const AgingAnalysis = lazy(() => import('./pages/Finance/AgingAnalysis'));
const AccountsPayableList = lazy(() => import('./pages/Finance/AccountsPayableList'));
const WarehouseList = lazy(() => import('./pages/Inventory/WarehouseList'));
const WarehouseLocationList = lazy(() => import('./pages/Inventory/WarehouseLocationList'));
const InventoryStockOverview = lazy(() => import('./pages/Inventory/InventoryStockOverview'));
const StocktakeList = lazy(() => import('./pages/Inventory/StocktakeList'));
const StockAlertList = lazy(() => import('./pages/Inventory/StockAlertList'));
const WarehouseTransferList = lazy(() => import('./pages/Inventory/WarehouseTransferList'));
const InventoryTransactionList = lazy(() => import('./pages/Inventory/InventoryTransactionList'));
const InventoryReservationList = lazy(() => import('./pages/Inventory/InventoryReservationList'));
const ModulePermissionSettings = lazy(() => import('./pages/Admin/ModulePermissionSettings'));
const ModulePermissionHistory = lazy(() => import('./pages/Admin/ModulePermissionHistory'));

const routeFallback = (
  <div style={{ padding: 24, textAlign: 'center' }}>
    <Spin />
  </div>
);

function withAsyncBoundary(element: ReactNode) {
  return (
    <Suspense fallback={routeFallback}>
      <ErrorBoundary>{element}</ErrorBoundary>
    </Suspense>
  );
}

export default function AppRouter() {
  const canViewOps = canViewOpsHub();
  const canViewReports = canViewReportsCenter();
  const canViewSalesOrders = canAccessSalesOrders();
  const canViewWorkflow = canViewWorkflowData();
  const canManageWorkflow = canManageWorkflowData();
  const canViewOpsLog = canViewOperationsLog();
  const canManageModulePermissions = canManageModulePermissionSettings();
  const canViewModulePermissionAudit = canViewModulePermissionHistory();
  const canManageFinance = canManageFinanceData();
  const canManageInventory = canManageInventoryData();
  const canManageStocktakeRoute = canManageStocktake();
  const canManagePurchasing = canManagePurchasingData();
  const canManageProduction = canManageProductionData();
  const canManageWorkforce = canManageWorkforceData();
  const [antdLocale, setAntdLocale] = useState<Locale | undefined>(undefined);

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
              <Route
                path="products"
                element={withAsyncBoundary(
                  <ProductsListFilterProvider>
                    <ProductList />
                  </ProductsListFilterProvider>
                )}
              />
              <Route path="sales-orders" element={<FeatureRoute allow={canViewSalesOrders} fallbackTo="/">{withAsyncBoundary(<SalesOrderList />)}</FeatureRoute>} />
              <Route path="shipments" element={<FeatureRoute allow={canViewSalesOrders} fallbackTo="/">{withAsyncBoundary(<ShipmentList />)}</FeatureRoute>} />
              <Route path="quotes" element={<FeatureRoute allow={canViewSalesOrders} fallbackTo="/">{withAsyncBoundary(<QuoteList />)}</FeatureRoute>} />
              <Route path="categories" element={withAsyncBoundary(<CategoryList />)} />
              <Route path="units" element={withAsyncBoundary(<UnitList />)} />
              <Route path="customers" element={withAsyncBoundary(<CustomerList />)} />
              <Route path="suppliers" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<SupplierList />)}</FeatureRoute>} />
              <Route path="material-prices" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<MaterialPriceList />)}</FeatureRoute>} />
              <Route path="purchase-orders" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<PurchaseOrderList />)}</FeatureRoute>} />
              <Route path="purchase-receipts" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<PurchaseReceiptList />)}</FeatureRoute>} />
              <Route path="purchase-requests" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<PurchaseRequestList />)}</FeatureRoute>} />
              <Route path="purchase-returns" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<PurchaseReturnList />)}</FeatureRoute>} />
              <Route path="production-orders" element={<FeatureRoute allow={canManageProduction} fallbackTo="/">{withAsyncBoundary(<ProductionOrderList />)}</FeatureRoute>} />
              <Route path="warehouses" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<WarehouseList />)}</FeatureRoute>} />
              <Route path="warehouse-locations" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<WarehouseLocationList />)}</FeatureRoute>} />
              <Route path="inventory-stock" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<InventoryStockOverview />)}</FeatureRoute>} />
              <Route path="inventory-transactions" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<InventoryTransactionList />)}</FeatureRoute>} />
              <Route path="inventory-reservations" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<InventoryReservationList />)}</FeatureRoute>} />
              <Route path="stocktakes" element={<FeatureRoute allow={canManageStocktakeRoute} fallbackTo="/">{withAsyncBoundary(<StocktakeList />)}</FeatureRoute>} />
              <Route path="stock-alerts" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<StockAlertList />)}</FeatureRoute>} />
              <Route path="warehouse-transfers" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<WarehouseTransferList />)}</FeatureRoute>} />
              <Route path="executive-cockpit" element={<FeatureRoute allow={canViewOps} fallbackTo="/task-inbox">{withAsyncBoundary(<ExecutiveCockpit />)}</FeatureRoute>} />
              <Route path="reports" element={<FeatureRoute allow={canViewReports} fallbackTo="/">{withAsyncBoundary(<ReportsCenter />)}</FeatureRoute>} />
              <Route path="task-operations" element={<FeatureRoute allow={canViewOps} fallbackTo="/task-inbox">{withAsyncBoundary(<TaskOperationsBoard />)}</FeatureRoute>} />
              <Route path="task-inbox" element={withAsyncBoundary(<TaskInbox />)} />
              <Route path="workflow-task-templates" element={<FeatureRoute allow={canManageWorkflow} fallbackTo="/task-inbox">{withAsyncBoundary(<WorkflowTaskTemplateList />)}</FeatureRoute>} />
              <Route path="workflow-pipeline" element={<FeatureRoute allow={canViewWorkflow} fallbackTo="/task-inbox">{withAsyncBoundary(<WorkflowPipelineBoard />)}</FeatureRoute>} />
              <Route path="workflow-analytics" element={<FeatureRoute allow={canViewWorkflow} fallbackTo="/task-inbox">{withAsyncBoundary(<WorkflowAnalyticsDashboard />)}</FeatureRoute>} />
              <Route path="notifications" element={withAsyncBoundary(<NotificationCenter />)} />
              <Route path="operations-log" element={<FeatureRoute allow={canViewOpsLog} fallbackTo="/task-inbox">{withAsyncBoundary(<OperationsLogDashboard />)}</FeatureRoute>} />
              <Route path="employees" element={<FeatureRoute allow={canManageWorkforce} fallbackTo="/">{withAsyncBoundary(<EmployeeList />)}</FeatureRoute>} />
              <Route path="attendance" element={<FeatureRoute allow={canManageWorkforce} fallbackTo="/">{withAsyncBoundary(<AttendanceList />)}</FeatureRoute>} />
              <Route path="bonus-penalty" element={<FeatureRoute allow={canManageWorkforce} fallbackTo="/">{withAsyncBoundary(<BonusPenaltyList />)}</FeatureRoute>} />
              <Route path="payroll" element={<FeatureRoute allow={canManageWorkforce} fallbackTo="/">{withAsyncBoundary(<PayrollList />)}</FeatureRoute>} />
              <Route path="salary-advance" element={<FeatureRoute allow={canManageWorkforce} fallbackTo="/">{withAsyncBoundary(<SalaryAdvanceList />)}</FeatureRoute>} />
              <Route path="transaction-categories" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<TransactionCategoryList />)}</FeatureRoute>} />
              <Route path="bank-accounts" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<BankAccountList />)}</FeatureRoute>} />
              <Route path="cash-book" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<CashBook />)}</FeatureRoute>} />
              <Route path="advance-transactions" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<AdvanceTransactionList />)}</FeatureRoute>} />
              <Route path="receivables" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<AccountsReceivableList />)}</FeatureRoute>} />
              <Route path="aging-analysis" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<AgingAnalysis />)}</FeatureRoute>} />
              <Route path="payables" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<AccountsPayableList />)}</FeatureRoute>} />
              <Route path="finance-summary" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<FinanceSummary />)}</FeatureRoute>} />
              <Route path="general-ledger" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<GeneralLedgerList />)}</FeatureRoute>} />
              <Route path="trial-balance" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<TrialBalance />)}</FeatureRoute>} />
              <Route path="bank-reconciliation" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<BankReconciliationList />)}</FeatureRoute>} />
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
                  <FeatureRoute allow={canViewModulePermissionAudit} fallbackTo="/">
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
