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
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'finance',
    'finance-manager',
    'accountant',
    'quan-ly',
    'quanly',
  ]);
}

export function canManageInventoryData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'INVENTORY', 'MANAGE')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'operation-manager',
    'ops-manager',
    'product-manager',
    'sales-manager',
    'quan-ly',
    'quanly',
  ]);
}

/** Quyền kiểm tồn: INVENTORY:STOCKTAKE hoặc INVENTORY:MANAGE */
export function canManageStocktake(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'INVENTORY', 'MANAGE')) return true;
  if (hasPermission(authz.permissions, 'INVENTORY', 'STOCKTAKE')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'operation-manager',
    'ops-manager',
    'product-manager',
    'sales-manager',
    'quan-ly',
    'quanly',
  ]);
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

export function canManageProductionData(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTION', 'MANAGE')) return true;
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

export function canSubmitProductionOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'SUBMIT')) return true;
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

export function canApproveProductionOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'APPROVE')) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'REJECT')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'finance-manager',
    'quan-ly',
    'quanly',
  ]);
}

export function canReleaseProductionOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'RELEASE')) return true;
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

export function canIssueProductionMaterials(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'ISSUE')) return true;
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

export function canReceiveProductionOutput(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'RECEIVE')) return true;
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

export function canCancelProductionOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'PRODUCTIONORDER', 'CANCEL')) return true;
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'finance-manager',
    'quan-ly',
    'quanly',
  ]);
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
  if (
    hasPermission(authz.permissions, 'SALESORDER', 'SUBMIT')
    || hasPermission(authz.permissions, 'SALESORDER', 'APPROVE')
    || hasPermission(authz.permissions, 'SALESORDER', 'REJECT')
    || hasPermission(authz.permissions, 'SALESORDER', 'POST')
    || hasPermission(authz.permissions, 'SALESORDER', 'VOID')
  ) {
    return true;
  }
  return hasAnyRole(authz.roleNames, [
    'admin',
    'manager',
    'sales',
    'sales-manager',
    'accountant',
    'finance',
    'finance-manager',
    'ops-manager',
    'quan-ly',
    'quanly',
  ]);
}

export function canSubmitSalesOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'SALESORDER', 'SUBMIT')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'sales', 'sales-manager', 'quan-ly', 'quanly']);
}

export function canApproveSalesOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'SALESORDER', 'APPROVE')) return true;
  if (hasPermission(authz.permissions, 'SALESORDER', 'REJECT')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'sales-manager', 'quan-ly', 'quanly']);
}

export function canPostSalesOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'SALESORDER', 'POST')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'accountant', 'finance', 'finance-manager', 'quan-ly', 'quanly']);
}

export function canVoidSalesOrders(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'SALESORDER', 'VOID')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'sales-manager', 'finance-manager', 'quan-ly', 'quanly']);
}

export function canManageModulePermissionSettings(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'MANAGE_RBAC')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'quan-ly', 'quanly']);
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
