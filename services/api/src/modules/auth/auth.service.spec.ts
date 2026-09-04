import { describe, expect, it, jest } from '@jest/globals';
import { AuthService, hashPassword } from './auth.service.js';

const mockPrisma = () => ({
  user: { findUnique: jest.fn<() => Promise<any>>() },
  branch: { findUnique: jest.fn<() => Promise<any>>() },
  device: { findUnique: jest.fn<() => Promise<any>>() },
  session: {
    create: jest.fn<() => Promise<any>>(),
    findUnique: jest.fn<() => Promise<any>>(),
    updateMany: jest.fn<() => Promise<any>>(),
  },
  auditLog: { create: jest.fn<() => Promise<any>>() },
});

describe('auth service', () => {
  it('hashes and verifies a password through the login flow', async () => {
    const prisma = mockPrisma();
    const passwordHash = await hashPassword('correct-horse');
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'cashier',
      displayName: 'Cashier',
      passwordHash,
      status: 'ACTIVE',
      branchId: 'branch-1',
      roleLinks: [{ role: { code: 'CASHIER' } }],
    });
    prisma.session.create.mockResolvedValue({ id: 'session-1' });
    prisma.auditLog.create.mockResolvedValue({});

    const service = new AuthService(prisma as never);
    const result = await service.login({ username: 'cashier', password: 'correct-horse' });

    expect(result.user.id).toBe('user-1');
    expect(result.user.roles).toEqual(['CASHIER']);
    expect(result.user.permissions).toContain('payment.create');
    expect(result.accessToken).toBeTruthy();
    expect(prisma.session.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', branchId: 'branch-1' }),
    }));
  });

  it('rejects an incorrect password', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'cashier',
      displayName: 'Cashier',
      passwordHash: await hashPassword('correct-horse'),
      status: 'ACTIVE',
      branchId: 'branch-1',
      roleLinks: [{ role: { code: 'CASHIER' } }],
    });

    const service = new AuthService(prisma as never);
    await expect(service.login({ username: 'cashier', password: 'wrong-password' })).rejects.toThrow('Invalid credentials');
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('rejects a blocked device', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'cashier',
      displayName: 'Cashier',
      passwordHash: await hashPassword('correct-horse'),
      status: 'ACTIVE',
      branchId: 'branch-1',
      roleLinks: [{ role: { code: 'CASHIER' } }],
    });
    prisma.device.findUnique.mockResolvedValue({ id: 'device-1', branchId: 'branch-1', status: 'BLOCKED', userId: null });

    const service = new AuthService(prisma as never);
    await expect(service.login({ username: 'cashier', password: 'correct-horse', deviceCode: 'POS-01' })).rejects.toThrow('Device is unavailable');
  });
});
