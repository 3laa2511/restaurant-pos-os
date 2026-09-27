import type { KitchenStation } from '../../generated/prisma/enums.js';
import type { AuthContext } from './authorization.types.js';
import type { WorkspaceCode } from './workspace.constants.js';

export interface SessionRecord {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  branchId: string | null;
  deviceId: string | null;
  workspace: WorkspaceCode;
  expiresAt: Date;
  revokedAt: Date | null;
}

export function assertSessionActive(session: SessionRecord, now = new Date()): void {
  if (session.revokedAt !== null || session.expiresAt <= now) {
    throw new Error('Session is expired or revoked');
  }
}

export function buildAuthContext(
  session: SessionRecord,
  roles: readonly AuthContext['roles'][number][],
  permissions: AuthContext['permissions'],
  kitchenStation: KitchenStation | null = null,
  workspace: WorkspaceCode,
): AuthContext {
  assertSessionActive(session);
  return {
    userId: session.userId,
    tenantId: session.tenantId,
    branchId: session.branchId,
    deviceId: session.deviceId,
    workspace,
    roles,
    permissions,
    kitchenStation,
  };
}
