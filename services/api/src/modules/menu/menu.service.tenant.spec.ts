import { describe, expect, it, jest } from '@jest/globals';
import { MenuService } from './menu.service.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { WORKSPACES } from '../auth/workspace.constants.js';

describe('MenuService tenant and branch isolation', () => {
  it('loads the tenant catalog and applies branch-specific overrides', async () => {
    const categoryFindMany = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue([
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
    const branchProductFindMany = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue([
      { productId: 'prod-1', priceOverride: 120, enabled: true, available: true },
      { productId: 'prod-2', priceOverride: null, enabled: false, available: true },
    ]);
    const branchFindFirst = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ id: 'branch-a' });
    const executeRaw = jest.fn<(...args: any[]) => Promise<number>>().mockResolvedValue(1);
    const tx = {
      $executeRaw: executeRaw,
      category: { findMany: categoryFindMany },
      branchProduct: { findMany: branchProductFindMany },
      branch: { findFirst: branchFindFirst },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (transaction: typeof tx) => Promise<any>) => work(tx)),
    };
    const service = new MenuService(prisma as never);

    const context = {
      userId: 'user-1',
      tenantId: 'tenant-a',
      branchId: 'branch-a',
      deviceId: 'device-a',
      sessionId: 'session-a',
      workspace: WORKSPACES.POS,
      roles: [],
      permissions: [],
      kitchenStation: null,
    } satisfies AuthContext;

    const result = await service.listActiveMenu(context);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
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
    expect(result[0]!.products).toHaveLength(1);
    expect(result[0]!.products[0]!.price).toBe(120);
  });

  it('denies catalog access when the authenticated session has no tenant scope', async () => {
    const categoryFindMany = jest.fn<(...args: any[]) => Promise<any>>();
    const service = new MenuService({ category: { findMany: categoryFindMany } } as never);
    const context = {
      userId: 'user-1',
      tenantId: null,
      branchId: null,
      deviceId: null,
      sessionId: 'session-a',
      workspace: WORKSPACES.POS,
      roles: [],
      permissions: [],
      kitchenStation: null,
    } satisfies AuthContext;

    await expect(service.listActiveMenu(context)).rejects.toThrow('tenant scope is required');
    expect(categoryFindMany).not.toHaveBeenCalled();
  });
});


describe('MenuService product modifiers', () => {
  const context: AuthContext = {
    userId: 'user-1',
    tenantId: 'tenant-a',
    branchId: 'branch-a',
    deviceId: 'device-a',
    sessionId: 'session-a',
    workspace: WORKSPACES.POS,
    roles: [],
    permissions: [],
    kitchenStation: null,
  };

  it('creates a modifier group only for an active product in the authenticated tenant', async () => {
    const create = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ id: 'group-1' });
    const tx = {
      $executeRaw: jest.fn<(...args: any[]) => Promise<number>>().mockResolvedValue(1),
      product: { findFirst: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ id: 'product-1' }) },
      productModifierGroup: { create },
    };
    const prisma = { $transaction: jest.fn(async (work: (transaction: typeof tx) => Promise<any>) => work(tx)) };
    const service = new MenuService(prisma as never);

    await service.createModifierGroup(context, { productId: 'product-1', name: 'Size', required: true });

    expect(tx.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'product-1', tenantId: 'tenant-a', active: true },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'tenant-a', productId: 'product-1', minSelections: 1, maxSelections: 1 }),
    }));
  });

  it('rejects modifier groups whose product is outside the authenticated tenant', async () => {
    const create = jest.fn<(...args: any[]) => Promise<any>>();
    const tx = {
      $executeRaw: jest.fn<(...args: any[]) => Promise<number>>().mockResolvedValue(1),
      product: { findFirst: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(null) },
      productModifierGroup: { create },
    };
    const prisma = { $transaction: jest.fn(async (work: (transaction: typeof tx) => Promise<any>) => work(tx)) };
    const service = new MenuService(prisma as never);

    await expect(service.createModifierGroup(context, { productId: 'foreign-product', name: 'Size' }))
      .rejects.toThrow('Product not found in the current tenant');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects invalid selection bounds before persisting a group', async () => {
    const create = jest.fn<(...args: any[]) => Promise<any>>();
    const tx = {
      $executeRaw: jest.fn<(...args: any[]) => Promise<number>>().mockResolvedValue(1),
      product: { findFirst: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ id: 'product-1' }) },
      productModifierGroup: { create },
    };
    const prisma = { $transaction: jest.fn(async (work: (transaction: typeof tx) => Promise<any>) => work(tx)) };
    const service = new MenuService(prisma as never);

    await expect(service.createModifierGroup(context, {
      productId: 'product-1', name: 'Size', minSelections: 2, maxSelections: 1,
    })).rejects.toThrow('Minimum selections cannot exceed maximum selections');
    expect(create).not.toHaveBeenCalled();
  });

  it('creates options only within an active modifier group in the authenticated tenant', async () => {
    const create = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ id: 'option-1' });
    const tx = {
      $executeRaw: jest.fn<(...args: any[]) => Promise<number>>().mockResolvedValue(1),
      productModifierGroup: { findFirst: jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({ id: 'group-1' }) },
      productModifierOption: { create },
    };
    const prisma = { $transaction: jest.fn(async (work: (transaction: typeof tx) => Promise<any>) => work(tx)) };
    const service = new MenuService(prisma as never);

    await service.createModifierOption(context, { groupId: 'group-1', name: 'Large', priceDelta: 12.5 });

    expect(tx.productModifierGroup.findFirst).toHaveBeenCalledWith({
      where: { id: 'group-1', tenantId: 'tenant-a', active: true },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'tenant-a', groupId: 'group-1', priceDelta: '12.50' }),
    }));
  });
});
