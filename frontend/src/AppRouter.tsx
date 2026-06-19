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
  canManageUserAccessExceptions,
  canAccessSalesOrders,
  canManageUserAccessReviews,
  canManageModulePermissionSettings,
  canManageOnboardingStudio,
  canManageRoleTeamGovernance,
  canManageUserDirectory,
  canManageUserLifecycle,
  canManageUserProvisioning,
  canManageFinanceData,
  canManageInventoryData,
  canManageStocktake,
  canManagePurchasingData,
  canManageProductionData,
  canViewQualityData,
  canAccessProductionCenter,
  canAccessMaterialIssues,
  canAccessProductionReceipts,
  canManageWorkforceData,
  canViewApprovalControlTower,
  canViewAdminAuditCenter,
  canViewAdminObservabilityCenter,
  canViewModulePermissionHistory,
  canViewAccessGovernanceCenter,
  canViewOperationsLog,
  canViewOpsHub,
  canViewReportsCenter,
  canViewWorkflowData,
  canManageWorkflowData,
  canViewCustomers,
} from './utils/authz';

const Login = lazy(() => import('./pages/Login'));
const AuthenticatedShell = lazy(() => import('./components/Layout/AuthenticatedShell'));
const AccountCenter = lazy(() => import('./pages/Account/AccountCenter'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ProductList = lazy(() => import('./pages/Products/ProductList'));
const SalesOrderList = lazy(() => import('./pages/Sales/SalesOrderList'));
const DeliveryPlanningPage = lazy(() => import('./pages/Sales/DeliveryPlanningPage'));
const DeliveryCarrierList = lazy(() => import('./pages/Sales/DeliveryCarrierList'));
const SalesFulfillmentCenter = lazy(() => import('./pages/Management/SalesFulfillmentCenter'));
const ShipmentList = lazy(() => import('./pages/Sales/ShipmentList'));
const ScanCenter = lazy(() => import('./pages/Inventory/ScanCenter'));
const QuoteList = lazy(() => import('./pages/Sales/QuoteListNew'));
const QuoteAnalytics = lazy(() => import('./pages/Management/QuoteAnalytics'));
const SalesAnalyticsDashboard = lazy(() => import('./pages/Sales/SalesAnalyticsDashboard'));
const DiscountManagement = lazy(() => import('./pages/Sales/DiscountManagement'));
const CustomerPortal = lazy(() => import('./pages/Sales/CustomerPortal'));
const CategoryList = lazy(() => import('./pages/Categories/CategoryList'));
const UnitList = lazy(() => import('./pages/Units/UnitList'));
const CustomerList = lazy(() => import('./pages/Customers/CustomerList'));
const SupplierList = lazy(() => import('./pages/Purchasing/SupplierList'));
const MaterialPriceList = lazy(() => import('./pages/Purchasing/MaterialPriceList'));
const PurchaseOrderList = lazy(() => import('./pages/Purchasing/PurchaseOrderList'));
const PurchaseReceiptList = lazy(() => import('./pages/Purchasing/PurchaseReceiptList'));
const PurchaseRequestList = lazy(() => import('./pages/Purchasing/PurchaseRequestList'));
const PurchaseReturnList = lazy(() => import('./pages/Purchasing/PurchaseReturnList'));
const PurchaseOrderForecast = lazy(() => import('./pages/Purchasing/PurchaseOrderForecast'));
const SupplierPerformanceAnalytics = lazy(() => import('./pages/Purchasing/SupplierPerformanceAnalytics'));
const ProductionDemandList = lazy(() => import('./pages/Production/ProductionDemandList'));
const ProductionOrderList = lazy(() => import('./pages/Production/ProductionOrderList'));
const ProductionPlanningBoard = lazy(() => import('./pages/Production/ProductionPlanningBoard'));
const ProductionResourceCatalog = lazy(() => import('./pages/Production/ProductionResourceCatalog'));
const MaterialIssueList = lazy(() => import('./pages/Production/MaterialIssueList'));
const ProductionReceiptList = lazy(() => import('./pages/Production/ProductionReceiptList'));
const QCPrintingWorkspace = lazy(() => import('./pages/Quality/QCPrintingWorkspace'));
const ExecutiveCockpit = lazy(() => import('./pages/Management/ExecutiveCockpit'));
const ReportsCenter = lazy(() => import('./pages/Management/ReportsCenter'));
const ProductionCostingReport = lazy(() => import('./pages/Management/ProductionCostingReport'));
const ProfitReport = lazy(() => import('./pages/Management/ProfitReport'));
const EmployeePerformanceReport = lazy(() => import('./pages/Management/EmployeePerformanceReport'));
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
const GeneralLedgerList = lazy(() => import('./pages/Finance/GeneralLedgerList'));
const TrialBalance = lazy(() => import('./pages/Finance/TrialBalance'));
const BankReconciliationList = lazy(() => import('./pages/Finance/BankReconciliationList'));
const BudgetManagement = lazy(() => import('./pages/Finance/BudgetManagement'));
const BIDashboard = lazy(() => import('./pages/Management/BIDashboard'));
const AccountsReceivableList = lazy(() => import('./pages/Finance/AccountsReceivableList'));
const AgingAnalysis = lazy(() => import('./pages/Finance/AgingAnalysis'));
const AccountsPayableList = lazy(() => import('./pages/Finance/AccountsPayableList'));
const WarehouseList = lazy(() => import('./pages/Inventory/WarehouseList'));
const WarehouseLocationList = lazy(() => import('./pages/Inventory/WarehouseLocationList'));
const InventoryStockOverview = lazy(() => import('./pages/Inventory/InventoryStockOverview'));
const InventoryForecast = lazy(() => import('./pages/Inventory/InventoryForecast'));
const StocktakeList = lazy(() => import('./pages/Inventory/StocktakeList'));
const StockAlertList = lazy(() => import('./pages/Inventory/StockAlertList'));
const WarehouseTransferList = lazy(() => import('./pages/Inventory/WarehouseTransferList'));
const InventoryTransactionList = lazy(() => import('./pages/Inventory/InventoryTransactionList'));
const InventoryReservationList = lazy(() => import('./pages/Inventory/InventoryReservationList'));
const ModulePermissionSettings = lazy(() => import('./pages/Admin/ModulePermissionSettings'));
const SystemConfigurationCenter = lazy(() => import('./pages/Admin/SystemConfigurationCenter'));
const ModulePermissionHistory = lazy(() => import('./pages/Admin/ModulePermissionHistory'));
const AdminObservabilityCenter = lazy(() => import('./pages/Admin/AdminObservabilityCenter'));
const AdminAuditCenter = lazy(() => import('./pages/Admin/AdminAuditCenter'));
const ApprovalControlTower = lazy(() => import('./pages/Admin/ApprovalControlTower'));
const AccessGovernanceCenter = lazy(() => import('./pages/Admin/AccessGovernanceCenter'));
const AccessExceptionCenter = lazy(() => import('./pages/Admin/AccessExceptionCenter'));
const AccessReviewCenter = lazy(() => import('./pages/Admin/AccessReviewCenter'));
const OnboardingStudio = lazy(() => import('./pages/Admin/OnboardingStudio'));
const RoleTeamGovernance = lazy(() => import('./pages/Admin/RoleTeamGovernance'));
const UserOffboardingDesk = lazy(() => import('./pages/Admin/UserOffboardingDesk'));
const UserProvisioningDesk = lazy(() => import('./pages/Admin/UserProvisioningDesk'));
const UserControlCenter = lazy(() => import('./pages/Admin/UserControlCenter'));

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
  const canViewCustomerCatalog = canViewCustomers();
  const canViewWorkflow = canViewWorkflowData();
  const canManageWorkflow = canManageWorkflowData();
  const canViewOpsLog = canViewOperationsLog();
  const canManageAccessExceptions = canManageUserAccessExceptions();
  const canManageAccessReviews = canManageUserAccessReviews();
  const canManageModulePermissions = canManageModulePermissionSettings();
  const canManageOnboarding = canManageOnboardingStudio();
  const canManageRoleTeams = canManageRoleTeamGovernance();
  const canManageLifecycle = canManageUserLifecycle();
  const canManageProvisioning = canManageUserProvisioning();
  const canManageUsers = canManageUserDirectory();
  const canViewModulePermissionAudit = canViewModulePermissionHistory();
  const canViewAdminAudit = canViewAdminAuditCenter();
  const canViewAdminObservability = canViewAdminObservabilityCenter();
  const canViewAccessGovernance = canViewAccessGovernanceCenter();
  const canManageFinance = canManageFinanceData();
  const canManageInventory = canManageInventoryData();
  const canManageStocktakeRoute = canManageStocktake();
  const canManagePurchasing = canManagePurchasingData();
  const canManageProduction = canManageProductionData();
  const canViewQuality = canViewQualityData();
  const canAccessProduction = canAccessProductionCenter();
  const canAccessMaterialIssueRoute = canAccessMaterialIssues();
  const canAccessProductionReceiptRoute = canAccessProductionReceipts();
  const canManageWorkforce = canManageWorkforceData();
  const canViewApprovalTower = canViewApprovalControlTower();
  const canViewSalesFulfillmentCenter = canViewSalesOrders || canManagePurchasing || canManageProduction || canViewReports;
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
              <Route path="account" element={withAsyncBoundary(<AccountCenter />)} />
              <Route
                path="products"
                element={withAsyncBoundary(
                  <ProductsListFilterProvider>
                    <ProductList />
                  </ProductsListFilterProvider>
                )}
              />
              <Route path="sales-orders" element={<FeatureRoute allow={canViewSalesOrders} fallbackTo="/">{withAsyncBoundary(<SalesOrderList />)}</FeatureRoute>} />
              <Route path="delivery-planning" element={<FeatureRoute allow={canViewSalesOrders} fallbackTo="/sales-orders">{withAsyncBoundary(<DeliveryPlanningPage />)}</FeatureRoute>} />
              <Route path="delivery-carriers" element={<FeatureRoute allow={canViewSalesOrders} fallbackTo="/sales-orders">{withAsyncBoundary(<DeliveryCarrierList />)}</FeatureRoute>} />
              <Route path="sales-fulfillment-center" element={<FeatureRoute allow={canViewSalesFulfillmentCenter} fallbackTo="/sales-orders">{withAsyncBoundary(<SalesFulfillmentCenter />)}</FeatureRoute>} />
              <Route path="shipments" element={<FeatureRoute allow={canViewSalesOrders} fallbackTo="/">{withAsyncBoundary(<ShipmentList />)}</FeatureRoute>} />
              <Route path="scan-center" element={withAsyncBoundary(<ScanCenter />)} />
              <Route path="shipments/scan" element={withAsyncBoundary(<ScanCenter />)} />
              <Route path="quotes" element={<FeatureRoute allow={canViewSalesOrders} fallbackTo="/">{withAsyncBoundary(<QuoteList />)}</FeatureRoute>} />
              <Route path="sales-analytics" element={<FeatureRoute allow={canViewSalesOrders} fallbackTo="/">{withAsyncBoundary(<SalesAnalyticsDashboard />)}</FeatureRoute>} />
              <Route path="discount-management" element={<FeatureRoute allow={canViewSalesOrders} fallbackTo="/">{withAsyncBoundary(<DiscountManagement />)}</FeatureRoute>} />
              <Route path="customer-portal" element={<FeatureRoute allow={canViewCustomerCatalog} fallbackTo="/">{withAsyncBoundary(<CustomerPortal />)}</FeatureRoute>} />
              <Route path="categories" element={withAsyncBoundary(<CategoryList />)} />
              <Route path="units" element={withAsyncBoundary(<UnitList />)} />
              <Route path="customers" element={<FeatureRoute allow={canViewCustomerCatalog} fallbackTo="/">{withAsyncBoundary(<CustomerList />)}</FeatureRoute>} />
              <Route path="suppliers" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<SupplierList />)}</FeatureRoute>} />
              <Route path="material-prices" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<MaterialPriceList />)}</FeatureRoute>} />
              <Route path="purchase-orders" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<PurchaseOrderList />)}</FeatureRoute>} />
              <Route path="purchase-receipts" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<PurchaseReceiptList />)}</FeatureRoute>} />
              <Route path="purchase-requests" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<PurchaseRequestList />)}</FeatureRoute>} />
              <Route path="purchase-returns" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<PurchaseReturnList />)}</FeatureRoute>} />
              <Route path="purchase-order-forecast" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<PurchaseOrderForecast />)}</FeatureRoute>} />
              <Route path="supplier-analytics" element={<FeatureRoute allow={canManagePurchasing} fallbackTo="/">{withAsyncBoundary(<SupplierPerformanceAnalytics />)}</FeatureRoute>} />
              <Route path="production-demands" element={<FeatureRoute allow={canManageProduction} fallbackTo="/">{withAsyncBoundary(<ProductionDemandList />)}</FeatureRoute>} />
              <Route path="production-orders" element={<FeatureRoute allow={canAccessProduction} fallbackTo="/">{withAsyncBoundary(<ProductionOrderList />)}</FeatureRoute>} />
              <Route path="production-planning" element={<FeatureRoute allow={canManageProduction} fallbackTo="/">{withAsyncBoundary(<ProductionPlanningBoard />)}</FeatureRoute>} />
              <Route path="production-resources" element={<FeatureRoute allow={canManageProduction} fallbackTo="/">{withAsyncBoundary(<ProductionResourceCatalog />)}</FeatureRoute>} />
              <Route path="material-issues" element={<FeatureRoute allow={canAccessMaterialIssueRoute} fallbackTo="/">{withAsyncBoundary(<MaterialIssueList />)}</FeatureRoute>} />
              <Route path="production-receipts" element={<FeatureRoute allow={canAccessProductionReceiptRoute} fallbackTo="/">{withAsyncBoundary(<ProductionReceiptList />)}</FeatureRoute>} />
              <Route path="qc-printing" element={<FeatureRoute allow={canViewQuality} fallbackTo="/">{withAsyncBoundary(<QCPrintingWorkspace />)}</FeatureRoute>} />
              <Route path="warehouses" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<WarehouseList />)}</FeatureRoute>} />
              <Route path="warehouse-locations" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<WarehouseLocationList />)}</FeatureRoute>} />
              <Route path="inventory-stock" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<InventoryStockOverview />)}</FeatureRoute>} />
              <Route path="inventory-forecast" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<InventoryForecast />)}</FeatureRoute>} />
              <Route path="inventory-transactions" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<InventoryTransactionList />)}</FeatureRoute>} />
              <Route path="inventory-reservations" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<InventoryReservationList />)}</FeatureRoute>} />
              <Route path="stocktakes" element={<FeatureRoute allow={canManageStocktakeRoute} fallbackTo="/">{withAsyncBoundary(<StocktakeList />)}</FeatureRoute>} />
              <Route path="stock-alerts" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<StockAlertList />)}</FeatureRoute>} />
              <Route path="warehouse-transfers" element={<FeatureRoute allow={canManageInventory} fallbackTo="/">{withAsyncBoundary(<WarehouseTransferList />)}</FeatureRoute>} />
              <Route path="executive-cockpit" element={<FeatureRoute allow={canViewOps} fallbackTo="/task-inbox">{withAsyncBoundary(<ExecutiveCockpit />)}</FeatureRoute>} />
              <Route path="reports" element={<FeatureRoute allow={canViewReports} fallbackTo="/">{withAsyncBoundary(<ReportsCenter />)}</FeatureRoute>} />
              <Route path="production-costing" element={<FeatureRoute allow={canManageProduction} fallbackTo="/">{withAsyncBoundary(<ProductionCostingReport />)}</FeatureRoute>} />
              <Route path="profit-report" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<ProfitReport />)}</FeatureRoute>} />
              <Route path="employee-performance" element={<FeatureRoute allow={canManageWorkforce} fallbackTo="/">{withAsyncBoundary(<EmployeePerformanceReport />)}</FeatureRoute>} />
              <Route path="quote-analytics" element={<FeatureRoute allow={canViewSalesOrders} fallbackTo="/">{withAsyncBoundary(<QuoteAnalytics />)}</FeatureRoute>} />
              <Route path="bi-dashboard" element={<FeatureRoute allow={canViewOps} fallbackTo="/">{withAsyncBoundary(<BIDashboard />)}</FeatureRoute>} />
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
              <Route path="budget-management" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<BudgetManagement />)}</FeatureRoute>} />
              <Route path="general-ledger" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<GeneralLedgerList />)}</FeatureRoute>} />
              <Route path="trial-balance" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<TrialBalance />)}</FeatureRoute>} />
              <Route path="bank-reconciliation" element={<FeatureRoute allow={canManageFinance} fallbackTo="/">{withAsyncBoundary(<BankReconciliationList />)}</FeatureRoute>} />
              <Route
                path="admin/approval-control-tower"
                element={(
                  <FeatureRoute allow={canViewApprovalTower} fallbackTo="/">
                    {withAsyncBoundary(<ApprovalControlTower />)}
                  </FeatureRoute>
                )}
              />
              <Route
                path="admin/audit-center"
                element={(
                  <FeatureRoute allow={canViewAdminAudit} fallbackTo="/">
                    {withAsyncBoundary(<AdminAuditCenter />)}
                  </FeatureRoute>
                )}
              />
              <Route
                path="admin/observability"
                element={(
                  <FeatureRoute allow={canViewAdminObservability} fallbackTo="/">
                    {withAsyncBoundary(<AdminObservabilityCenter />)}
                  </FeatureRoute>
                )}
              />
              <Route
                path="admin/access-governance"
                element={(
                  <FeatureRoute allow={canViewAccessGovernance} fallbackTo="/">
                    {withAsyncBoundary(<AccessGovernanceCenter />)}
                  </FeatureRoute>
                )}
              />
              <Route
                path="admin/access-exceptions"
                element={(
                  <FeatureRoute allow={canManageAccessExceptions} fallbackTo="/">
                    {withAsyncBoundary(<AccessExceptionCenter />)}
                  </FeatureRoute>
                )}
              />
              <Route
                path="admin/access-reviews"
                element={(
                  <FeatureRoute allow={canManageAccessReviews} fallbackTo="/">
                    {withAsyncBoundary(<AccessReviewCenter />)}
                  </FeatureRoute>
                )}
              />
              <Route
                path="admin/user-provisioning"
                element={(
                  <FeatureRoute allow={canManageProvisioning} fallbackTo="/">
                    {withAsyncBoundary(<UserProvisioningDesk />)}
                  </FeatureRoute>
                )}
              />
              <Route
                path="admin/user-lifecycle"
                element={(
                  <FeatureRoute allow={canManageLifecycle} fallbackTo="/">
                    {withAsyncBoundary(<UserOffboardingDesk />)}
                  </FeatureRoute>
                )}
              />
              <Route
                path="admin/onboarding-studio"
                element={(
                  <FeatureRoute allow={canManageOnboarding} fallbackTo="/">
                    {withAsyncBoundary(<OnboardingStudio />)}
                  </FeatureRoute>
                )}
              />
              <Route
                path="admin/roles-teams"
                element={(
                  <FeatureRoute allow={canManageRoleTeams} fallbackTo="/">
                    {withAsyncBoundary(<RoleTeamGovernance />)}
                  </FeatureRoute>
                )}
              />
              <Route
                path="admin/users"
                element={(
                  <FeatureRoute allow={canManageUsers} fallbackTo="/">
                    {withAsyncBoundary(<UserControlCenter />)}
                  </FeatureRoute>
                )}
              />
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
              <Route
                path="admin/system-configuration"
                element={(
                  <FeatureRoute allow={canManageModulePermissions} fallbackTo="/">
                    {withAsyncBoundary(<SystemConfigurationCenter />)}
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
