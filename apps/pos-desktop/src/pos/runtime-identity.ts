import { getDesktopSession, type DesktopSession, type KitchenStation } from './auth-client.js';

export interface PosRuntimeIdentity {
  userId: string;
  cashierId: string;
  branchId: string;
  deviceId: string;
  username: string;
  displayName: string;
  kitchenStation: KitchenStation | null;
  roles: readonly string[];
  permissions: readonly string[];
}

export function getPosRuntimeIdentity(session: DesktopSession | null = getDesktopSession()): PosRuntimeIdentity {
  if (!session) throw new Error('Authenticated POS session is required');
  const branchId = session.user.branchId?.trim();
  const deviceId = session.deviceId?.trim();
  if (!branchId) throw new Error('Authenticated session is not assigned to a branch');
  if (!deviceId) throw new Error('Authenticated session is not assigned to a POS device');
  if (!session.user.id.trim()) throw new Error('Authenticated session has no user identity');
  return {
    userId: session.user.id,
    cashierId: session.user.id,
    branchId,
    deviceId,
    username: session.user.username,
    displayName: session.user.displayName,
    kitchenStation: session.user.kitchenStation ?? null,
    roles: session.user.roles,
    permissions: session.user.permissions,
  };
}
