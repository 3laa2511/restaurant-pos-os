import { describe, expect, it, jest } from '@jest/globals';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { ShiftService } from './shift.service.js';

const context = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'cashier-1',
  branchId: 'branch-1',
  deviceId: 'device-1',
  roles: [],
  permissions: [PERMISSIONS.SHIFT_OPEN, PERMISSIONS.SHIFT_CLOSE],
  ...overrides,
});

describe('ShiftService hardening', () => {
  it('rejects over-precision opening cash before touching the database', async () => {
    const prisma = { syncOperation: { findUnique: jest.fn() } } as any;
    const service = new ShiftService(prisma);

    await expect(service.open(context(), {
      branchId: 'branch-1', deviceId: 'device-1', openingCash: 10.001, idempotencyKey: 'open-1', clientSequence: 1,
    })).rejects.toThrow('at most 2 decimal places');
    expect(prisma.syncOperation.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a second open shift for the same cashier/device inside the transaction', async () => {
    const create = jest.fn();
    const tx = {
      branch: { findUnique: jest.fn().mockResolvedValue({ id: 'branch-1', active: true }) },
      device: { findUnique: jest.fn().mockResolvedValue({ id: 'device-1', branchId: 'branch-1', status: 'ACTIVE' }) },
      shift: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing-shift', userId: 'cashier-1', deviceId: 'device-1' }),
        create,
      },
    } as any;
    const prisma = {
      syncOperation: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any;
    const service = new ShiftService(prisma);

    await expect(service.open(context(), {
      branchId: 'branch-1', deviceId: 'device-1', openingCash: 100, idempotencyKey: 'open-2', clientSequence: 2,
    })).rejects.toThrow('Device already has an open shift');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects closing a shift from another branch before mutation', async () => {
    const tx = {
      shift: { findUnique: jest.fn().mockResolvedValue({
        id: 'shift-1', branchId: 'branch-2', userId: 'cashier-1', deviceId: 'device-1',
        status: 'OPEN', openingCash: '100.00', openedAt: new Date(),
      }) },
    } as any;
    const prisma = {
      syncOperation: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any;
    const service = new ShiftService(prisma);

    await expect(service.close(context(), {
      shiftId: 'shift-1', closingCash: 100, idempotencyKey: 'close-1', clientSequence: 1,
    })).rejects.toThrow('branch access denied');
  });

  it('rejects a second close of an already CLOSED shift', async () => {
    const tx = {
      shift: { findUnique: jest.fn().mockResolvedValue({
        id: 'shift-1', branchId: 'branch-1', userId: 'cashier-1', deviceId: 'device-1',
        status: 'CLOSED', openingCash: '100.00', openedAt: new Date(),
      }) },
    } as any;
    const prisma = {
      syncOperation: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    } as any;
    const service = new ShiftService(prisma);

    await expect(service.close(context(), {
      shiftId: 'shift-1', closingCash: 100, idempotencyKey: 'close-2', clientSequence: 2,
    })).rejects.toThrow('already closed');
  });
});
