import { describe, expect, it, jest } from '@jest/globals';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { ShiftService } from './shift.service.js';

const context = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'cashier-1', tenantId: 'tenant-1', branchId: 'branch-1', deviceId: 'device-1', sessionId: 'session-1', workspace: 'POS', roles: [],
  permissions: [PERMISSIONS.SHIFT_OPEN, PERMISSIONS.SHIFT_CLOSE], ...overrides,
});

type AnyMock = ReturnType<typeof jest.fn>;
const mock = (): AnyMock => jest.fn();
const auditMock = () => ({ recordWithClient: mock() });

function baseTransaction() {
  const tx = {
    $executeRaw: jest.fn<(...args: any[]) => Promise<number>>().mockResolvedValue(1),
    branch: { findFirst: mock() },
    device: { findFirst: mock() },
    shift: { findFirst: mock(), create: mock(), updateMany: mock() },
    cashDrawer: { upsert: mock() },
    cashDrawerMovement: { findMany: mock(), create: mock() },
    syncOperation: { create: mock() },
  } as any;
  return tx;
}

describe('ShiftService hardening', () => {
  it('rejects over-precision opening cash before touching the database', async () => {
    const prisma = { syncOperation: { findUnique: mock() } } as any;
    const service = new ShiftService(prisma, auditMock() as any);
    await expect(service.open(context(), { branchId: 'branch-1', deviceId: 'device-1', openingCash: 10.001, idempotencyKey: 'open-1', clientSequence: 1 })).rejects.toThrow('at most 2 decimal places');
    expect(prisma.syncOperation.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a second open shift for the same cashier/device inside the tenant-scoped transaction', async () => {
    const tx = baseTransaction();
    tx.branch.findFirst.mockResolvedValue({ id: 'branch-1', active: true });
    tx.device.findFirst.mockResolvedValue({ id: 'device-1', branchId: 'branch-1', status: 'ACTIVE' });
    tx.shift.findFirst.mockResolvedValue({ id: 'existing-shift', userId: 'cashier-1', deviceId: 'device-1' });
    const prisma = { syncOperation: { findUnique: mock() }, $transaction: mock() } as any;
    prisma.syncOperation.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const service = new ShiftService(prisma, auditMock() as any);
    await expect(service.open(context(), { branchId: 'branch-1', deviceId: 'device-1', openingCash: 100, idempotencyKey: 'open-2', clientSequence: 2 })).rejects.toThrow('Device already has an open shift');
    expect(tx.branch.findFirst).toHaveBeenCalledWith({ where: { id: 'branch-1', tenantId: 'tenant-1' }, select: { id: true, active: true } });
    expect(tx.device.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'device-1', branch: { tenantId: 'tenant-1' } } }));
    expect(tx.shift.create).not.toHaveBeenCalled();
  });

  it('cannot close a shift belonging to another tenant', async () => {
    const tx = baseTransaction();
    tx.shift.findFirst.mockResolvedValue(null);
    const prisma = { syncOperation: { findUnique: mock() }, $transaction: mock() } as any;
    prisma.syncOperation.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const service = new ShiftService(prisma, auditMock() as any);
    await expect(service.close(context(), { shiftId: 'foreign-shift', closingCash: 100, idempotencyKey: 'close-cross-tenant', clientSequence: 3 })).rejects.toThrow('Shift not found');
    expect(tx.shift.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign-shift', branch: { tenantId: 'tenant-1' } } }));
    expect(tx.shift.updateMany).not.toHaveBeenCalled();
  });

  it('denies shift access when the authenticated session has no tenant scope', async () => {
    const prisma = { syncOperation: { findUnique: mock() } } as any;
    const service = new ShiftService(prisma, auditMock() as any);
    await expect(service.open({ ...context(), tenantId: null }, { branchId: 'branch-1', deviceId: 'device-1', openingCash: 100, idempotencyKey: 'open-no-tenant', clientSequence: 4 })).rejects.toThrow('tenant scope is required');
    expect(prisma.syncOperation.findUnique).not.toHaveBeenCalled();
  });

  it('rejects closing a shift from another branch before mutation', async () => {
    const tx = baseTransaction();
    tx.shift.findFirst.mockResolvedValue({ id: 'shift-1', branchId: 'branch-2', userId: 'cashier-1', deviceId: 'device-1', status: 'OPEN', openingCash: '100.00', openedAt: new Date() });
    const prisma = { syncOperation: { findUnique: mock() }, $transaction: mock() } as any;
    prisma.syncOperation.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const service = new ShiftService(prisma, auditMock() as any);
    await expect(service.close(context(), { shiftId: 'shift-1', closingCash: 100, idempotencyKey: 'close-1', clientSequence: 1 })).rejects.toThrow('branch access denied');
  });

  it('rejects a second close of an already CLOSED shift', async () => {
    const tx = baseTransaction();
    tx.shift.findFirst.mockResolvedValue({ id: 'shift-1', branchId: 'branch-1', userId: 'cashier-1', deviceId: 'device-1', status: 'CLOSED', openingCash: '100.00', openedAt: new Date() });
    const prisma = { syncOperation: { findUnique: mock() }, $transaction: mock() } as any;
    prisma.syncOperation.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const service = new ShiftService(prisma, auditMock() as any);
    await expect(service.close(context(), { shiftId: 'shift-1', closingCash: 100, idempotencyKey: 'close-2', clientSequence: 2 })).rejects.toThrow('already closed');
  });
});
