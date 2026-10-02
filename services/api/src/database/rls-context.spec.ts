import { setRlsContext, withRlsContext, type PrismaServiceLike, type RlsTransaction } from './rls-context.js';

describe('RLS transaction context', () => {
  it('rejects an incomplete security context', async () => {
    const tx = { $executeRaw: jest.fn() } as unknown as RlsTransaction;
    await expect(
      setRlsContext(tx, {
        tenantId: '',
        branchId: null,
        userId: 'user-1',
        sessionId: 'session-1',
      }),
    ).rejects.toThrow('RLS tenantId is required');

    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('sets tenant, branch, user and session context on the transaction', async () => {
    const executeRaw = jest.fn().mockResolvedValue(4);
    const tx = { $executeRaw: executeRaw } as unknown as RlsTransaction;

    await setRlsContext(tx, {
      tenantId: 'tenant-1',
      branchId: 'branch-1',
      userId: 'user-1',
      sessionId: 'session-1',
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const template = executeRaw.mock.calls[0][0];
    expect(Array.isArray(template)).toBe(true);
    expect(template.join(' ')).toContain('set_config');
    expect(template.join(' ')).toContain('app.tenant_id');
    expect(template.join(' ')).toContain('app.branch_id');
    expect(template.join(' ')).toContain('app.user_id');
    expect(template.join(' ')).toContain('app.session_id');
  });

  it('creates the transaction first and runs business work through the same tx', async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(4) } as unknown as RlsTransaction;
    const transaction = jest.fn(async (callback: (value: RlsTransaction) => Promise<string>) => callback(tx));
    const prisma = { $transaction: transaction } as unknown as PrismaServiceLike;
    const work = jest.fn(async () => 'ok');

    await expect(
      withRlsContext(
        prisma,
        {
          tenantId: 'tenant-1',
          branchId: null,
          userId: 'user-1',
          sessionId: 'session-1',
        },
        work,
      ),
    ).resolves.toBe('ok');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledWith(tx);
  });
});
