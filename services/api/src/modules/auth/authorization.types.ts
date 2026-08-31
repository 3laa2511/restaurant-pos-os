import type { PermissionCode, RoleCode } from './rbac.constants.js';

export interface AuthContext {
  userId: string;
  branchId: string | null;
  deviceId: string | null;
  roles: readonly RoleCode[];
  permissions: readonly PermissionCode[];
}

export function hasPermission(context: AuthContext, permission: PermissionCode): boolean {
  return context.permissions.includes(permission);
}

export function assertPermission(context: AuthContext, permission: PermissionCode): void {
  if (!hasPermission(context, permission)) {
    throw new Error(`Forbidden: missing permission ${permission}`);
  }
}

export function assertBranchAccess(context: AuthContext, branchId: string): void {
  if (context.branchId !== null && context.branchId !== branchId) {
    throw new Error('Forbidden: branch access denied');
  }
}
