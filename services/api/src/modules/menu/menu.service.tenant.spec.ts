import { describe, expect, it, jest } from '@jest/globals';
import { MenuService } from './menu.service.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { WORKSPACES } from '../auth/workspace.constants.js';

describe('MenuService tenant and branch isolation', () => {
  it('loads the tenant catalog and applies branch-specific overrides', async () => {
    const categoryFindMany = jest.fn().mockResolvedValue([
      {
        id: 'cat-1',
        name: 'Meals',
        nameAr: null,
        sortOrder: 1,
        products: [
          { id: 'prod-1', sku: 'P1', name: 'Meal', nameAr: null, price: 100 },
          { id: 'prod-2', sku: 'P2', name: 'Drink', nameAr: null, price: 50 },
        ],
      },
    ]);
    const branchProductFindMany = jest.fn().mockResolvedValue([
      { productId: 'prod-1', priceOverride: 120, enabled: true, available: true },
      { productId: 'prod-2', priceOverride: null, enabled: false, available: true },
    ]);
    const branchFindFirst = jest.fn().mockResolvedValue({ id: 'branch-a' });
    const service = new MenuService({
      category: { findMany: categoryFindMany },
      branchProduct: { findMany: branchProductFindMany },
    } as never);

    const context = {
      userId: 'user-1',
      tenantId: 'tenant-a',
      branchId: 'branch-a',
      deviceId: 'device-a',
      workspace: WORKSPACES.POS,
      roles: [],
      permissions: [],
      kitchenStation: null,
    } satisfies AuthContext;

    // The branch lookup is intentionally supplied through the Prisma mock.
    (service as unknown as { prisma: { branch: { findFirst: typeof branchFindFirst } } }).prisma.branch = {
      findFirst: branchFindFirst,
    };

    const result = await service.listActiveMenu(context);

    expect(branchFindFirst).toHaveBeenCalledWith({
      where: { id: 'branch-a', tenantId: 'tenant-a', active: true },
      select: { id: true },
    });
    expect(categoryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', active: true },
    }));
    expect(branchProductFindMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', branchId: 'branch-a' },
      select: { productId: true, priceOverride: true, enabled: true, available: true },
    });
    expect(result[0].products).toHaveLength(1);
    expect(result[0].products[0].price).toBe(120);
  });

  it('denies catalog access when the authenticated session has no tenant scope', async () => {
    const categoryFindMany = jest.fn();
    const service = new MenuService({ category: { findMany: categoryFindMany } } as never);
    const context = {
      userId: 'user-1',
      tenantId: null,
      branchId: null,
      deviceId: null,
      workspace: WORKSPACES.POS,
      roles: [],
      permissions: [],
      kitchenStation: null,
    } satisfies AuthContext;

    await expect(service.listActiveMenu(context)).rejects.toThrow('tenant scope is required');
    expect(categoryFindMany).not.toHaveBeenCalled();
  });
});
