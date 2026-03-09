import { storage } from './storage';

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

export function canAccessOpsModules(): boolean {
  // Các màn vận hành là tính năng lõi cho user đã đăng nhập.
  // Hạn chế chi tiết (nút admin/staff) đã được xử lý bên trong từng màn hình.
  if (storage.getAccessToken()) return true;

  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  return authz.roleNames.some((name) =>
    ['admin', 'manager', 'operation-manager', 'ops-manager', 'quan-ly', 'quanly'].includes(name)
  );
}

function hasAnyRole(roleNames: string[], accepted: string[]): boolean {
  return roleNames.some((name) => accepted.includes(name));
}

function hasPermission(permissions: string[], resource: string, action: string): boolean {
  return permissions.includes(`${resource.toUpperCase()}:${action.toUpperCase()}`);
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

export function canManageModulePermissionSettings(): boolean {
  const authz = getCurrentUserAuthz();
  if (authz.isStaff || authz.isSuperuser) return true;
  if (hasPermission(authz.permissions, 'CORE', 'MANAGE_RBAC')) return true;
  return hasAnyRole(authz.roleNames, ['admin', 'manager', 'quan-ly', 'quanly']);
}
