import { describe, expect, it, jest } from '@jest/globals';
import { AccountingService } from './accounting.service.js';

describe('AccountingService.ensureAccount', () => {
  const service = new AccountingService({} as never);

  const account = {
    id: 'account-1',
    tenantId: 'tenant-1',
    code: '1000',
    name: 'Cash',
    type: 'ASSET' as const,
    active: true,
    allowPosting: true,
  };

  const tx = (result: unknown) =>
    ({
      accountingAccount: {
        findUnique: jest.fn().mockResolvedValue(result),
      },
    }) as never;

  it('returns a configured active posting account with the expected type', async () => {
    await expect(service.ensureAccount(tx(account), 'tenant-1', '1000', 'ASSET')).resolves.toEqual(account);
  });

  it('rejects an account that is not configured for the tenant', async () => {
    await expect(service.ensureAccount(tx(null), 'tenant-1', '1000', 'ASSET'))
      .rejects.toThrow('Accounting account 1000 is not configured');
  });

  it('rejects inactive accounts and accounts that disallow posting', async () => {
    await expect(
      service.ensureAccount(tx({ ...account, active: false }), 'tenant-1', '1000', 'ASSET'),
    ).rejects.toThrow('Accounting account 1000 is inactive');

    await expect(
      service.ensureAccount(tx({ ...account, allowPosting: false }), 'tenant-1', '1000', 'ASSET'),
    ).rejects.toThrow('Accounting account 1000 does not allow posting');
  });

  it('rejects account type mismatches', async () => {
    await expect(service.ensureAccount(tx({ ...account, type: 'LIABILITY' }), 'tenant-1', '1000', 'ASSET'))
      .rejects.toThrow('Accounting account 1000 has an incompatible account type');
  });

  it('always scopes lookup by tenant and account code', async () => {
    const findUnique = jest.fn<(args: unknown) => Promise<typeof account>>(async (_args) => account);
    const scopedTx = {
      accountingAccount: { findUnique },
    } as never;

    await service.ensureAccount(scopedTx, 'tenant-42', '1000', 'ASSET');

    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId_code: { tenantId: 'tenant-42', code: '1000' } },
    });
  });
});
