import { describe, expect, it, jest } from '@jest/globals';
import { MenuService } from './menu.service.js';
import type { AuthContext } from '../auth/authorization.types.js';

describe('MenuService tenant isolation', () => {
  it('always applies the authenticated tenant to categories and nested products', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new MenuService({ category: { findMany } } as never);
    const context = {
      userId: 'user-1',
      tenantId: 'tenant-a',
      branchId: 'branch-a',
      deviceId: 'device-a',
      roles: [],
      permissions: [],
      kitchenStation: null,
    } satisfies AuthContext;

    await service.listActiveMenu(context);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', active: true },
      include: expect.objectContaining({
        products: expect.objectContaining({
          where: { tenantId: 'tenant-a', active: true },
        }),
      }),
    }));
  });

  it('denies catalog access when the authenticated session has no tenant scope', async () => {
    const findMany = jest.fn();
    const service = new MenuService({ category: { findMany } } as never);
    const context = {
      userId: 'user-1',
      tenantId: null,
      branchId: null,
      deviceId: null,
      roles: [],
      permissions: [],
      kitchenStation: null,
    } satisfies AuthContext;

    await expect(service.listActiveMenu(context)).rejects.toThrow('tenant scope is required');
    expect(findMany).not.toHaveBeenCalled();
  });
});
