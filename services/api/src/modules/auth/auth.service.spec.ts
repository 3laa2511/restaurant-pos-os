import { describe, expect, it, jest } from '@jest/globals';
import { AuthService, hashPassword } from './auth.service.js';

type MockArgs = Record<string, unknown>;
type MockResult = Promise<any>;

const mockPrisma = () => ({
  user: { findUnique: jest.fn<(args: MockArgs) => MockResult>() },
  branch: { findUnique: jest.fn<(args: MockArgs) => MockResult>() },
  device: { findUnique: jest.fn<(args: MockArgs) => MockResult>() },
  session: {
    create: jest.fn<(args: MockArgs) => MockResult>(),
    findUnique: jest.fn<(args: MockArgs) => MockResult>(),
    updateMany: jest.fn<(args: MockArgs) => MockResult>(),
  },
  auditLog: { create: jest.fn<(args: MockArgs) => MockResult>() },
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

  it('rejects a branchless cashier before creating a session', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      username: 'branchless-cashier',
      displayName: 'Branchless Cashier',
      passwordHash: await hashPassword('correct-horse'),
      status: 'ACTIVE',
      branchId: null,
      roleLinks: [{ role: { code: 'CASHIER' } }],
    });

    const service = new AuthService(prisma as never);
    await expect(service.login({ username: 'branchless-cashier', password: 'correct-horse', branchId: 'branch-1' }))
      .rejects.toThrow('User must be assigned to a branch or have only tenant-wide roles');
    expect(prisma.branch.findUnique).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('allows a branchless owner with tenant-wide scope', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-3',
      username: 'owner',
      displayName: 'Owner',
      passwordHash: await hashPassword('correct-horse'),
      status: 'ACTIVE',
      branchId: null,
      tenantId: 'tenant-1',
      roleLinks: [{ role: { code: 'OWNER' } }],
    });
    prisma.session.create.mockResolvedValue({ id: 'session-owner' });
    prisma.auditLog.create.mockResolvedValue({});

    const service = new AuthService(prisma as never);
    const result = await service.login({ username: 'owner', password: 'correct-horse' });

    expect(result.user.branchId).toBeNull();
    expect(prisma.session.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-3', branchId: null }),
    }));
  });

  it('rejects a tenant-wide owner selecting a branch from another tenant', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-5',
      username: 'owner-cross-tenant',
      displayName: 'Owner',
      passwordHash: await hashPassword('correct-horse'),
      status: 'ACTIVE',
      branchId: null,
      tenantId: 'tenant-1',
      roleLinks: [{ role: { code: 'OWNER' } }],
    });
    prisma.branch.findUnique.mockResolvedValue({ id: 'branch-other-tenant', active: true, tenantId: 'tenant-2' });

    const service = new AuthService(prisma as never);
    await expect(service.login({
      username: 'owner-cross-tenant',
      password: 'correct-horse',
      branchId: 'branch-other-tenant',
    })).rejects.toThrow('Branch is unavailable');
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('rejects mixed tenant-wide and branch-scoped roles without a branch', async () => {
    const prisma = mockPrisma();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-4',
      username: 'mixed-role',
      displayName: 'Mixed Role',
      passwordHash: await hashPassword('correct-horse'),
      status: 'ACTIVE',
      branchId: null,
      roleLinks: [{ role: { code: 'OWNER' } }, { role: { code: 'CASHIER' } }],
    });

    const service = new AuthService(prisma as never);
    await expect(service.login({ username: 'mixed-role', password: 'correct-horse' }))
      .rejects.toThrow('User must be assigned to a branch or have only tenant-wide roles');
    expect(prisma.branch.findUnique).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
});
