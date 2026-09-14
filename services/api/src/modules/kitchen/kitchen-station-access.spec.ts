import { describe, expect, it } from 'vitest';
import { assertKitchenStationAccess, type AuthContext } from '../auth/authorization.types.js';
import type { KitchenStation } from '../../generated/prisma/enums.js';

const baseContext = (kitchenStation?: KitchenStation | null): AuthContext => ({
  userId: 'user-1',
  branchId: 'branch-1',
  deviceId: null,
  roles: [],
  permissions: [],
  kitchenStation,
});

describe('kitchen station authorization', () => {
  it('allows unrestricted contexts when no station is assigned', () => {
    expect(() => assertKitchenStationAccess(baseContext(), 'KITCHEN')).not.toThrow();
    expect(() => assertKitchenStationAccess(baseContext(null), 'PACKING')).not.toThrow();
  });

  it('allows a user to access their assigned station', () => {
    expect(() => assertKitchenStationAccess(baseContext('BEVERAGE'), 'BEVERAGE')).not.toThrow();
  });

  it('denies access to a different station', () => {
    expect(() => assertKitchenStationAccess(baseContext('KITCHEN'), 'PACKING')).toThrow(
      'Forbidden: kitchen station access denied',
    );
  });
});
