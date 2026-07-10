import { storage } from './storage';
import { getToastMessage as sharedGetToastMessage } from '../shared/apiError';

type UserRoleLike = {
  name?: string;
  code?: string;
  permissions?: Array<{
    resource?: string;
    action?: string;
  }>;
};

type CurrentUserLike = {
  is_staff?: boolean;
  is_superuser?: boolean;
  roles?: UserRoleLike[];
};

function normalizeRoleName(role: UserRoleLike): string {
  return String(role.name ?? role.code ?? '').trim().toLowerCase();
}

export function getCurrentUserAuthz(): {
  isStaff: boolean;
  isSuperuser: boolean;
  roleNames: string[];
  permissions: string[];
} {
  const rawUser = storage.getUser() as unknown;
  if (!rawUser || typeof rawUser !== 'object') {
    return { isStaff: false, isSuperuser: false, roleNames: [], permissions: [] };
  }
  const user = rawUser as CurrentUserLike;
  const roleNames: string[] = [];
  const permissions = new Set<string>();
  if (Array.isArray(user.roles)) {
    user.roles.forEach((role) => {
      const normalizedRole = normalizeRoleName(role);
      if (normalizedRole) roleNames.push(normalizedRole);
      if (Array.isArray(role.permissions)) {
        role.permissions.forEach((perm) => {
          const resource = String(perm.resource ?? '').trim().toUpperCase();
          const action = String(perm.action ?? '').trim().toUpperCase();
          if (resource && action) {
            permissions.add(`${resource}:${action}`);
          }
        });
      }
    });
  }
  return {
    isStaff: user.is_staff === true,
    isSuperuser: user.is_superuser === true,
    roleNames,
    permissions: Array.from(permissions),
  };
}

function hasAnyRole(roleNames: string[], accepted: string[]): boolean {
  return roleNames.some((name) => accepted.includes(name));
}

function hasPermission(permissions: string[], resource: string, action: string): boolean {
  return permissions.includes(`${resource.toUpperCase()}:${action.toUpperCase()}`);
}

export function canViewOpsHub(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'OPS', 'VIEW')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'operation-manager', 'ops-manager', 'quan-ly', 'quanly']);
}

export function canViewReportsCenter(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'VIEW_REPORTS')) return true;
  return false;
}

export function canViewWorkflowData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'WORKFLOW', 'VIEW')) return true;
  if (hasPermission(authz.permissions, 'WORKFLOW', 'MANAGE')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'operation-manager', 'ops-manager', 'quan-ly', 'quanly']);
}

export function canManageWorkflowData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'WORKFLOW', 'MANAGE')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'operation-manager', 'ops-manager', 'quan-ly', 'quanly']);
}

export function canViewOperationsLog(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'VIEW_OPERATIONS_LOG')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'operation-manager', 'ops-manager', 'quan-ly', 'quanly']);
}

export function canViewModulePermissionHistory(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'VIEW_RBAC_AUDIT')) return true;
  if (hasPermission(authz.permissions, 'CORE', 'MANAGE_RBAC')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'quan-ly', 'quanly']);
}

export function canAccessOpsModules(): boolean {
  if (!storage.getAccessToken()) return false;
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return canViewOpsHub() || canViewWorkflowData() || canViewOperationsLog();
}

export function canManageWorkforceData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'WORKFORCE', 'MANAGE')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'hr',
    'hr-manager',
    'human-resources',
    'payroll',
    'accountant',
    'quan-ly',
    'quanly',
  ]);
}

export function canManageFinanceData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'FINANCE', 'MANAGE')) return true;
  return false;
}

export function canViewFinanceData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return (
    hasPermission(authz.permissions, 'FINANCE', 'VIEW')
    || hasPermission(authz.permissions, 'FINANCE', 'MANAGE')
    || hasPermission(authz.permissions, 'FINANCE', 'SETTLE')
    || hasPermission(authz.permissions, 'FINANCE', 'ADJUST')
  );
}

export function canSettleFinanceData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return hasPermission(authz.permissions, 'FINANCE', 'SETTLE') || hasPermission(authz.permissions, 'FINANCE', 'MANAGE');
}

export function canAdjustFinanceData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return hasPermission(authz.permissions, 'FINANCE', 'ADJUST') || hasPermission(authz.permissions, 'FINANCE', 'MANAGE');
}

export function canViewFinanceGlData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return (
    hasPermission(authz.permissions, 'FINANCE', 'GL')
    || hasPermission(authz.permissions, 'FINANCE', 'VIEW')
    || hasPermission(authz.permissions, 'FINANCE', 'MANAGE')
  );
}

export function canAccessFinanceData(): boolean {
  return canViewFinanceData() || canViewFinanceGlData();
}

export function canManageInventoryData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'INVENTORY', 'MANAGE')) return true;
  return false;
}

/** Quyền kiểm tồn: INVENTORY:STOCKTAKE hoặc INVENTORY:MANAGE */
export function canManageStocktake(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'INVENTORY', 'STOCKTAKE')) return true;
  return false;
}

export function canViewInventoryData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return (
    hasPermission(authz.permissions, 'INVENTORY', 'VIEW') ||
    hasPermission(authz.permissions, 'INVENTORY', 'MANAGE') ||
    hasPermission(authz.permissions, 'INVENTORY', 'ADJUST') ||
    hasPermission(authz.permissions, 'INVENTORY', 'STOCKTAKE') ||
    hasPermission(authz.permissions, 'INVENTORY', 'TRANSFER') ||
    hasPermission(authz.permissions, 'INVENTORY', 'RESERVE')
  );
}

export function canAdjustInventoryData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'INVENTORY', 'ADJUST')) return true;
  return false;
}

export function canTransferInventoryData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'INVENTORY', 'TRANSFER')) return true;
  return false;
}

export function canReserveInventoryData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'INVENTORY', 'RESERVE')) return true;
  return false;
}

export function canManagePurchasingData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PURCHASING', 'MANAGE')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'operation-manager',
    'ops-manager',
    'product-manager',
    'finance-manager',
    'quan-ly',
    'quanly',
  ]);
}

export function canViewPurchasingData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PURCHASING', 'VIEW')) return true;
  if (hasPermission(authz.permissions, 'PURCHASING', 'MANAGE')) return true;
  if (
    hasPermission(authz.permissions, 'PURCHASEORDER', 'SUBMIT')
    || hasPermission(authz.permissions, 'PURCHASEORDER', 'APPROVE')
    || hasPermission(authz.permissions, 'PURCHASEORDER', 'REJECT')
    || hasPermission(authz.permissions, 'PURCHASEORDER', 'RECEIVE')
    || hasPermission(authz.permissions, 'PURCHASEORDER', 'CANCEL')
  ) {
    return true;
  }
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'operation-manager',
    'ops-manager',
    'product-manager',
    'finance-manager',
    'quan-ly',
    'quanly',
  ]);
}

function hasSupplierPermission(action: string): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return hasPermission(authz.permissions, 'SUPPLIER', action);
}

export function canViewSuppliers(): boolean {
  return hasSupplierPermission('VIEW');
}

export function canCreateSuppliers(): boolean {
  return hasSupplierPermission('CREATE');
}

export function canEditSuppliers(): boolean {
  return hasSupplierPermission('EDIT');
}

export function canImportSuppliers(): boolean {
  return hasSupplierPermission('IMPORT');
}

export function canExportSuppliers(): boolean {
  return hasSupplierPermission('EXPORT');
}

export function canDeleteSuppliers(): boolean {
  return hasSupplierPermission('DELETE');
}

export function canManageProductionData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTION', 'MANAGE')) return true;
  return false;
}

export function canViewProductionData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return (
    hasPermission(authz.permissions, 'PRODUCTION', 'VIEW')
    || hasPermission(authz.permissions, 'PRODUCTION', 'MANAGE')
    || hasPermission(authz.permissions, 'PRODUCTION', 'PLAN')
    || hasPermission(authz.permissions, 'PRODUCTION', 'ISSUE')
    || hasPermission(authz.permissions, 'PRODUCTION', 'RECEIVE')
    || hasPermission(authz.permissions, 'PRODUCTION', 'CANCEL')
    || hasPermission(authz.permissions, 'PRODUCTIONORDER', 'SUBMIT')
    || hasPermission(authz.permissions, 'PRODUCTIONORDER', 'APPROVE')
    || hasPermission(authz.permissions, 'PRODUCTIONORDER', 'REJECT')
    || hasPermission(authz.permissions, 'PRODUCTIONORDER', 'RELEASE')
    || hasPermission(authz.permissions, 'PRODUCTIONORDER', 'ISSUE')
    || hasPermission(authz.permissions, 'PRODUCTIONORDER', 'RECEIVE')
    || hasPermission(authz.permissions, 'PRODUCTIONORDER', 'CANCEL')
  );
}

export function canPlanProductionOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return (
    hasPermission(authz.permissions, 'PRODUCTION', 'PLAN')
    || hasPermission(authz.permissions, 'PRODUCTION', 'MANAGE')
    || hasPermission(authz.permissions, 'PRODUCTIONORDER', 'RELEASE')
  );
}

export function canViewQualityData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'QUALITY', 'VIEW')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'operation-manager',
    'ops-manager',
    'product-manager',
    'quan-ly',
    'quanly',
  ]);
}

export function canSubmitProductionOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'SUBMIT')) return true;
  return hasPermission(authz.permissions, 'PRODUCTION', 'MANAGE');
}

export function canApproveProductionOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'APPROVE')) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'REJECT')) return true;
  return hasPermission(authz.permissions, 'PRODUCTION', 'MANAGE');
}

export function canReleaseProductionOrders(): boolean {
  return canPlanProductionOrders();
}

export function canIssueProductionMaterials(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTION', 'ISSUE')) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'ISSUE')) return true;
  return hasPermission(authz.permissions, 'PRODUCTION', 'MANAGE');
}

export function canReceiveProductionOutput(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTION', 'RECEIVE')) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'RECEIVE')) return true;
  return hasPermission(authz.permissions, 'PRODUCTION', 'MANAGE');
}

export function canCancelProductionOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTION', 'CANCEL')) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'CANCEL')) return true;
  return hasPermission(authz.permissions, 'PRODUCTION', 'MANAGE');
}

export function canAccessProductionCenter(): boolean {
  return canViewProductionData();
}

export function canAccessMaterialIssues(): boolean {
  return canViewProductionData() || canIssueProductionMaterials();
}

export function canAccessProductionReceipts(): boolean {
  return canViewProductionData() || canReceiveProductionOutput();
}

export function canUpdateProductionOperations(): boolean {
  return canPlanProductionOrders();
}

export function canUseShipmentExecutionWorkspace(): boolean {
  return canViewInventoryData();
}

export function canSubmitPurchaseOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PURCHASEORDER', 'SUBMIT')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'operation-manager',
    'ops-manager',
    'product-manager',
    'quan-ly',
    'quanly',
  ]);
}

export function canApprovePurchaseOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PURCHASEORDER', 'APPROVE')) return true;
  if (hasPermission(authz.permissions, 'PURCHASEORDER', 'REJECT')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'finance-manager',
    'quan-ly',
    'quanly',
  ]);
}

export function canReceivePurchaseOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PURCHASEORDER', 'RECEIVE')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'operation-manager',
    'ops-manager',
    'product-manager',
    'quan-ly',
    'quanly',
  ]);
}

export function canCancelPurchaseOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PURCHASEORDER', 'CANCEL')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'finance-manager',
    'quan-ly',
    'quanly',
  ]);
}

export function canAccessSalesOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return (
    hasPermission(authz.permissions, 'SALESORDER', 'VIEW')
    || hasPermission(authz.permissions, 'SALESORDER', 'SUBMIT')
    || hasPermission(authz.permissions, 'SALESORDER', 'APPROVE')
    || hasPermission(authz.permissions, 'SALESORDER', 'REJECT')
    || hasPermission(authz.permissions, 'SALESORDER', 'POST')
    || hasPermission(authz.permissions, 'SALESORDER', 'VOID')
  );
}

function hasCustomerPermission(action: string): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return hasPermission(authz.permissions, 'CUSTOMER', action);
}

export function canViewCustomers(): boolean {
  return hasCustomerPermission('VIEW');
}

export function canCreateCustomers(): boolean {
  return hasCustomerPermission('CREATE');
}

export function canEditCustomers(): boolean {
  return hasCustomerPermission('EDIT');
}

export function canSubmitCustomers(): boolean {
  return hasCustomerPermission('SUBMIT');
}

export function canApproveCustomers(): boolean {
  return hasCustomerPermission('APPROVE');
}

export function canRejectCustomers(): boolean {
  return hasCustomerPermission('REJECT');
}

export function canImportCustomers(): boolean {
  return hasCustomerPermission('IMPORT');
}

export function canExportCustomers(): boolean {
  return hasCustomerPermission('EXPORT');
}

export function canAssignCustomers(): boolean {
  return hasCustomerPermission('ASSIGN');
}

export function canDeleteCustomers(): boolean {
  return hasCustomerPermission('DELETE');
}

export function canManageDeliveryCarriers(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return hasPermission(authz.permissions, 'DELIVERYCARRIER', 'EDIT');
}

export function canSubmitSalesOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return hasPermission(authz.permissions, 'SALESORDER', 'SUBMIT');
}

export function canApproveSalesOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return hasPermission(authz.permissions, 'SALESORDER', 'APPROVE')
    || hasPermission(authz.permissions, 'SALESORDER', 'REJECT');
}

export function canPostSalesOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return hasPermission(authz.permissions, 'SALESORDER', 'POST');
}

export function canVoidSalesOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return hasPermission(authz.permissions, 'SALESORDER', 'VOID');
}

export function canManageModulePermissionSettings(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'MANAGE_RBAC')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'quan-ly', 'quanly']);
}

export function canManageRoleTeamGovernance(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'MANAGE_RBAC')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'quan-ly', 'quanly']);
}

export function canManageOnboardingStudio(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'MANAGE_RBAC')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'quan-ly', 'quanly']);
}

export function canManageUserProvisioning(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'MANAGE_RBAC')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'quan-ly', 'quanly']);
}

export function canManageUserLifecycle(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'MANAGE_RBAC')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'quan-ly', 'quanly']);
}

export function canManageUserAccessReviews(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'MANAGE_RBAC')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'quan-ly', 'quanly']);
}

export function canManageUserAccessExceptions(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'MANAGE_RBAC')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'quan-ly', 'quanly']);
}

export function canManageUserDirectory(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'MANAGE_RBAC')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'quan-ly', 'quanly']);
}

export function canViewAccessGovernanceCenter(): boolean {
  return (
    canManageUserAccessExceptions()
    || canManageUserAccessReviews()
    || canManageUserProvisioning()
    || canManageUserLifecycle()
    || canManageRoleTeamGovernance()
    || canManageUserDirectory()
    || canManageModulePermissionSettings()
    || canViewModulePermissionHistory()
  );
}

export function canViewAdminObservabilityCenter(): boolean {
  return (
    canViewOperationsLog()
    || canViewWorkflowData()
    || canViewAccessGovernanceCenter()
    || canAccessFinanceData()
    || canManageWorkforceData()
    || canManagePurchasingData()
    || canManageProductionData()
  );
}

export function canViewApprovalControlTower(): boolean {
  return (
    canAccessFinanceData()
    || canManageWorkforceData()
    || canManagePurchasingData()
    || canManageProductionData()
    || canViewAdminObservabilityCenter()
  );
}

export function canViewAdminAuditCenter(): boolean {
  return canViewAdminObservabilityCenter();
}

export function canManageProductData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCT', 'MANAGE')) return true;
  if (hasPermission(authz.permissions, 'PRODUCTS', 'MANAGE')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'product-manager',
    'operation-manager',
    'ops-manager',
    'quan-ly',
    'quanly',
  ]);
}

export function getToastMessage(error: unknown, fallback = 'Có lỗi xảy ra'): string {
  const message = sharedGetToastMessage(error);
  return message || fallback;
}
