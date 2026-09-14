import type { KitchenStation } from '../../generated/prisma/enums.js';
import type { PermissionCode, RoleCode } from './rbac.constants.js';

export interface AuthContext {
  userId: string;
  branchId: string | null;
  deviceId: string | null;
  roles: readonly RoleCode[];
  permissions: readonly PermissionCode[];
  /**
   * Assigned kitchen station. Undefined is retained for compatibility with
   * legacy/in-memory auth contexts; authenticated production sessions should
   * normalize this to null when the user has no station assignment.
   */
  kitchenStation?: KitchenStation | null;
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

export function assertKitchenStationAccess(
  context: AuthContext,
  station: KitchenStation,
): void {
  if (context.kitchenStation != null && context.kitchenStation !== station) {
    throw new Error('Forbidden: kitchen station access denied');
  }
}
