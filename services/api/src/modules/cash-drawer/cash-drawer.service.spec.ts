import { describe, expect, it, jest } from '@jest/globals';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { CashDrawerService } from './cash-drawer.service.js';

const context = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'manager-1',
  tenantId: 'tenant-1',
  branchId: 'branch-1',
  deviceId: 'device-1',
  roles: [],
  permissions: [PERMISSIONS.CASH_DRAWER_VIEW, PERMISSIONS.CASH_DRAWER_MANAGE],
  ...overrides,
});

const auditMock = () => ({ recordWithClient: jest.fn() });

describe('CashDrawerService', () => {
  it('rejects over-precision movement amounts before persistence', async () => {
    const prisma = { syncOperation: { findUnique: jest.fn() } } as any;
    const service = new CashDrawerService(prisma, auditMock() as any);

    await expect(service.recordMovement(context(), {
      drawerId: 'drawer-1', shiftId: 'shift-1', deviceId: 'device-1', type: 'PAY_IN', amount: 10.001,
      reason: 'Cash top-up', idempotencyKey: 'drawer-1', clientSequence: 1,
    })).rejects.toThrow('at most 2 decimal places');
    expect(prisma.syncOperation.findUnique).not.toHaveBeenCalled();
  });

  it('requires an explicit direction for ADJUSTMENT', async () => {
    const prisma = { syncOperation: { findUnique: jest.fn() } } as any;
    const service = new CashDrawerService(prisma, auditMock() as any);

    await expect(service.recordMovement(context(), {
      drawerId: 'drawer-1', shiftId: 'shift-1', deviceId: 'device-1', type: 'ADJUSTMENT', amount: 5,
      reason: 'Till correction', idempotencyKey: 'drawer-2', clientSequence: 2,
    })).rejects.toThrow('Adjustment direction is required');
  });

  it('does not allow manual creation of system sale/change/refund movements', async () => {
    const prisma = { syncOperation: { findUnique: jest.fn() } } as any;
    const service = new CashDrawerService(prisma, auditMock() as any);

    for (const type of ['SALE', 'CASH_CHANGE', 'REFUND'] as const) {
      await expect(service.recordMovement(context(), {
        drawerId: 'drawer-1', shiftId: 'shift-1', deviceId: 'device-1', type, amount: 5,
        reason: 'Manual attempt', idempotencyKey: `drawer-${type}`, clientSequence: 3,
      })).rejects.toThrow('System cash movements must be created by the payment/refund flow');
    }
  });
});
