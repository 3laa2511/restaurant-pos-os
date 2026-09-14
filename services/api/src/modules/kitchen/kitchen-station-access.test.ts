import { describe, expect, it } from '@jest/globals';
import { assertKitchenStationAccess, type AuthContext } from '../auth/authorization.types.js';
import type { KitchenStation } from '../../generated/prisma/enums.js';

const context = (kitchenStation?: KitchenStation | null): AuthContext => ({
  userId: 'u',
  branchId: 'b',
  deviceId: null,
  roles: [],
  permissions: [],
  ...(kitchenStation !== undefined ? { kitchenStation } : {}),
});

describe('kitchen station authorization', () => {
  it('allows unassigned contexts', () => {
    expect(() => assertKitchenStationAccess(context(), 'KITCHEN')).not.toThrow();
    expect(() => assertKitchenStationAccess(context(null), 'PACKING')).not.toThrow();
  });

  it('allows the assigned station', () => {
    expect(() => assertKitchenStationAccess(context('BEVERAGE'), 'BEVERAGE')).not.toThrow();
  });

  it('denies another station', () => {
    expect(() => assertKitchenStationAccess(context('KITCHEN'), 'PACKING')).toThrow(
      'Forbidden: kitchen station access denied',
    );
  });
});
