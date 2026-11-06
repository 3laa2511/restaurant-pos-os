import { describe, expect, it, jest } from '@jest/globals';
import { AuthService, hashPassword } from './auth.service.js';

type MockArgs = Record<string, unknown>;
type MockResult = Promise<any>;

const mockPrisma = () => {
  const prisma = {
    $executeRaw: jest.fn<() => Promise<number>>().mockResolvedValue(4),
    $transaction: jest.fn(async (callback: (tx: typeof prisma) => Promise<any>) => callback(prisma)),
    user: { findUnique: jest.fn<(args: MockArgs) => MockResult>() },
    branch: {
    findUnique: jest.fn<(args: MockArgs) => MockResult>(),
    findFirst: jest.fn<(args: MockArgs) => MockResult>(),
  },
    device: { findUnique: jest.fn<(args: MockArgs) => MockResult>() },
    session: {
    create: jest.fn<(args: MockArgs) => MockResult>(),
    findUnique: jest.fn<(args: MockArgs) => MockResult>(),
    updateMany: jest.fn<(args: MockArgs) => MockResult>(),
  },
    auditLog: { create: jest.fn<(args: MockArgs) => MockResult>() },
    };
  return prisma;
};

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
      tenantId: 'tenant-1',
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
      tenantId: 'tenant-1',
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
      tenantId: 'tenant-1',
      branchId: 'branch-1',
      roleLinks: [{ role: { code: 'CASHIER' } }],
    });
    prisma.device.findUnique.mockResolvedValue({ id: 'device-1', branchId: 'branch-1', status: 'BLOCKED', userId: null });

    const service = new AuthService(prisma as never);
    await expect(service.login({ username: 'cashier', password: 'correct-horse', deviceCode: 'POS-01' })).rejects.toThrow('Device is unavailable');
  });

  it('rejects a branchless cashier before accepting a caller-selected branch', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-branchless-cashier',
      username: 'branchless-cashier',
      displayName: 'Branchless Cashier',
      passwordHash: await hashPassword('correct-horse'),
      status: 'ACTIVE',
      tenantId: 'tenant-1',
      branchId: null,
      roleLinks: [{ role: { code: 'CASHIER' } }],
    });

    const service = new AuthService(prisma as never);
    await expect(service.login({
      username: 'branchless-cashier',
      password: 'correct-horse',
      branchId: 'branch-1',
    })).rejects.toThrow('User must be assigned to a branch or have only tenant-wide roles');

    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('allows a branchless owner to start a tenant-wide session', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-owner',
      username: 'owner',
      displayName: 'Owner',
      passwordHash: await hashPassword('correct-horse'),
      status: 'ACTIVE',
      tenantId: 'tenant-1',
      branchId: null,
      roleLinks: [{ role: { code: 'OWNER' } }],
    });
    prisma.session.create.mockResolvedValue({ id: 'session-owner' });
    prisma.auditLog.create.mockResolvedValue({});

    const service = new AuthService(prisma as never);
    const result = await service.login({ username: 'owner', password: 'correct-horse' });

    expect(result.user.branchId).toBeNull();
    expect(prisma.session.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-owner', tenantId: 'tenant-1', branchId: null }),
    }));
  });

  it('allows a tenant-wide owner to select only a branch belonging to the same tenant', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-owner',
      username: 'owner',
      displayName: 'Owner',
      passwordHash: await hashPassword('correct-horse'),
      status: 'ACTIVE',
      tenantId: 'tenant-1',
      branchId: null,
      roleLinks: [{ role: { code: 'OWNER' } }],
    });
    prisma.branch.findFirst.mockResolvedValue({ id: 'branch-1', active: true });
    prisma.session.create.mockResolvedValue({ id: 'session-owner-branch' });
    prisma.auditLog.create.mockResolvedValue({});

    const service = new AuthService(prisma as never);
    const result = await service.login({
      username: 'owner',
      password: 'correct-horse',
      branchId: 'branch-1',
    });

    expect(result.user.branchId).toBe('branch-1');
    expect(prisma.branch.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'branch-1', tenantId: 'tenant-1' },
    }));
    expect(prisma.session.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ branchId: 'branch-1' }),
    }));
  });

  it('rejects branchless users with mixed tenant-wide and branch-scoped roles', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-mixed',
      username: 'mixed-role',
      displayName: 'Mixed Role',
      passwordHash: await hashPassword('correct-horse'),
      status: 'ACTIVE',
      tenantId: 'tenant-1',
      branchId: null,
      roleLinks: [{ role: { code: 'OWNER' } }, { role: { code: 'CASHIER' } }],
    });

    const service = new AuthService(prisma as never);
    await expect(service.login({ username: 'mixed-role', password: 'correct-horse' }))
      .rejects.toThrow('User must be assigned to a branch or have only tenant-wide roles');
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
});
