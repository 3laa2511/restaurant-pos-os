import type { KitchenStation } from '../../generated/prisma/enums.js';
import type { PermissionCode, RoleCode } from './rbac.constants.js';
import type { WorkspaceCode } from './workspace.constants.js';

export interface AuthContext {
  userId: string;
  /** Tenant resolved from the authenticated session's branch. Null means the
   * session has no tenant scope and tenant-scoped resources must be denied. */
  tenantId: string | null;
  branchId: string | null;
  deviceId: string | null;
  workspace: WorkspaceCode;
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

export function assertTenantScope(context: AuthContext): string {
  if (context.tenantId === null) {
    throw new Error('Forbidden: tenant scope is required');
  }
  return context.tenantId;
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
