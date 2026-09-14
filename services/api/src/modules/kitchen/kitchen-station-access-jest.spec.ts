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

describe('kitchen station authorization compatibility', () => {
  it('allows undefined and null station assignments', () => {
    expect(() => assertKitchenStationAccess(context(), 'KITCHEN')).not.toThrow();
    expect(() => assertKitchenStationAccess(context(null), 'PACKING')).not.toThrow();
  });

  it('enforces an assigned station', () => {
    expect(() => assertKitchenStationAccess(context('BEVERAGE'), 'BEVERAGE')).not.toThrow();
    expect(() => assertKitchenStationAccess(context('BEVERAGE'), 'PACKING')).toThrow(
      'Forbidden: kitchen station access denied',
    );
  });
});
