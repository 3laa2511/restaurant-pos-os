import { describe, expect, it, jest } from '@jest/globals';
import { InventoryService } from './inventory.service.js';

describe('InventoryService.consumeOrder', () => {
  const context = {
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    userId: 'user-1',
    sessionId: 'session-1',
    deviceId: 'device-1',
    workspace: 'POS' as const,
    roles: [],
    permissions: [],
  };

  const orderWithRecipe = (quantityBaseUnit: number, wastePercent = 0) => ({
    id: 'order-1',
    items: [{
      id: 'item-1',
      quantity: 2,
      product: {
        recipeIngredients: [{
          ingredientId: 'ingredient-1',
          quantityBaseUnit,
          wastePercent,
        }],
      },
    }],
  });

  function setup(options?: {
    order?: unknown;
    stock?: unknown;
    existingMovement?: unknown;
    existingCogs?: unknown;
  }) {
    const findOrder = jest.fn(async () => options?.order === undefined ? orderWithRecipe(10) : options.order);
    const findMovement = jest.fn(async () => options?.existingMovement ?? null);
    const findJournal = jest.fn(async () => options?.existingCogs ?? null);
    const findStock = jest.fn(async () => options?.stock === undefined
      ? { quantityBaseUnit: 100, averageCostPerBaseUnit: 3 }
      : options.stock);
    const updateStock = jest.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({});
    const createMovement = jest.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({});
    const postCogs = jest.fn<(tx: unknown, context: unknown, input: unknown) => Promise<unknown>>().mockResolvedValue({});

    const tx = {
      order: { findFirst: findOrder },
      inventoryMovement: { findFirst: findMovement, create: createMovement },
      journalEntry: { findFirst: findJournal },
      inventoryStockBalance: { findUnique: findStock, update: updateStock },
    } as never;
    const service = new InventoryService({} as never, { postInventoryConsumption: postCogs } as never);

    return { service, tx, findOrder, findMovement, findJournal, findStock, updateStock, createMovement, postCogs };
  }

  it('applies recipe quantity and waste percentage and posts the exact COGS amount', async () => {
    const mocks = setup({ order: orderWithRecipe(10, 10) });

    await expect(mocks.service.consumeOrder(mocks.tx, context, {
      orderId: 'order-1',
      branchId: 'branch-1',
    })).resolves.toEqual({ orderId: 'order-1', amount: 66 });

    expect(mocks.updateStock).toHaveBeenCalledWith({
      where: { branchId_ingredientId: { branchId: 'branch-1', ingredientId: 'ingredient-1' } },
      data: { quantityBaseUnit: 78 },
    });
    expect(mocks.createMovement).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'CONSUMPTION',
        quantityBaseUnit: 22,
        referenceType: 'ORDER',
        referenceId: 'order-1',
        idempotencyKey: 'order-consumption:order-1:ingredient-1:item-1',
      }),
    }));
    expect(mocks.postCogs).toHaveBeenCalledWith(mocks.tx, context, {
      orderId: 'order-1',
      branchId: 'branch-1',
      amount: 66,
    });
  });

  it('uses consumption movements to prevent a duplicate zero-cost recipe deduction', async () => {
    const mocks = setup({
      order: orderWithRecipe(10),
      stock: { quantityBaseUnit: 100, averageCostPerBaseUnit: 0 },
    });
    mocks.findMovement
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'movement-1' });

    await expect(mocks.service.consumeOrder(mocks.tx, context, {
      orderId: 'order-1',
      branchId: 'branch-1',
    })).resolves.toEqual({ orderId: 'order-1', amount: 0 });
    await expect(mocks.service.consumeOrder(mocks.tx, context, {
      orderId: 'order-1',
      branchId: 'branch-1',
    })).resolves.toEqual({ orderId: 'order-1', amount: 0, alreadyConsumed: true });

    expect(mocks.updateStock).toHaveBeenCalledTimes(1);
    expect(mocks.createMovement).toHaveBeenCalledTimes(1);
    expect(mocks.postCogs).not.toHaveBeenCalled();
  });

  it('rejects insufficient stock before writing consumption movements', async () => {
    const mocks = setup({
      order: orderWithRecipe(10),
      stock: { quantityBaseUnit: 1, averageCostPerBaseUnit: 3 },
    });

    await expect(mocks.service.consumeOrder(mocks.tx, context, {
      orderId: 'order-1',
      branchId: 'branch-1',
    })).rejects.toThrow('Insufficient stock for ingredient ingredient-1');

    expect(mocks.updateStock).not.toHaveBeenCalled();
    expect(mocks.createMovement).not.toHaveBeenCalled();
    expect(mocks.postCogs).not.toHaveBeenCalled();
  });

  it('does not write stock or COGS when the order has no recipe ingredients', async () => {
    const mocks = setup({ order: orderWithRecipe(10) });
    mocks.findOrder.mockResolvedValue({
      id: 'order-1',
      items: [{ id: 'item-1', quantity: 1, product: { recipeIngredients: [] } }],
    });

    await expect(mocks.service.consumeOrder(mocks.tx, context, {
      orderId: 'order-1',
      branchId: 'branch-1',
    })).resolves.toEqual({ orderId: 'order-1', amount: 0 });

    expect(mocks.findStock).not.toHaveBeenCalled();
    expect(mocks.createMovement).not.toHaveBeenCalled();
    expect(mocks.postCogs).not.toHaveBeenCalled();
  });
});

describe('InventoryService.receive validation', () => {
  const context = {
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    userId: 'user-1',
    sessionId: 'session-1',
    deviceId: 'device-1',
    workspace: 'INVENTORY' as const,
    roles: [],
    permissions: [],
  };

  it('rejects duplicate ingredient receipt lines before opening a transaction', async () => {
    const service = new InventoryService({} as never, {} as never);
    await expect(service.receive(context, {
      branchId: 'branch-1',
      idempotencyKey: 'receipt-idempotency-test-001',
      items: [
        { ingredientId: 'ingredient-1', quantityPurchaseUnit: 2, unitCost: 10 },
        { ingredientId: 'ingredient-1', quantityPurchaseUnit: 3, unitCost: 12 },
      ],
    })).rejects.toThrow('Receipt cannot contain the same ingredient more than once');
  });
});


describe('InventoryService.receive idempotency', () => {
  const context = {
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    userId: 'user-1',
    sessionId: 'session-1',
    deviceId: 'device-1',
    workspace: 'INVENTORY' as const,
    roles: [],
    permissions: [],
  };

  function setup(existingReceipt: unknown) {
    const findExisting = jest.fn(async () => existingReceipt);
    const findIngredient = jest.fn(async () => null);
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      branch: { findFirst: jest.fn(async () => ({ id: 'branch-1' })) },
      inventoryReceipt: { findUnique: findExisting },
      ingredient: { findFirst: findIngredient },
    };
    const prisma = {
      $transaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)),
    };
    const service = new InventoryService(prisma as never, {} as never);
    return { service, findExisting, findIngredient, prisma };
  }

  const receipt = {
    id: 'receipt-1',
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    supplierId: null,
    reference: 'invoice-123',
    idempotencyKey: 'receipt-idempotency-test-001',
    items: [{ ingredientId: 'ingredient-1', quantityPurchaseUnit: 2, unitCost: 10 }],
  };

  it('returns the existing receipt for a retry with the same payload', async () => {
    const mocks = setup(receipt);
    await expect(mocks.service.receive(context, {
      branchId: 'branch-1',
      reference: 'invoice-123',
      idempotencyKey: 'receipt-idempotency-test-001',
      items: [{ ingredientId: 'ingredient-1', quantityPurchaseUnit: 2, unitCost: 10 }],
    })).resolves.toBe(receipt);
    expect(mocks.findIngredient).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of a receipt key with a different payload', async () => {
    const mocks = setup(receipt);
    await expect(mocks.service.receive(context, {
      branchId: 'branch-1',
      reference: 'invoice-123',
      idempotencyKey: 'receipt-idempotency-test-001',
      items: [{ ingredientId: 'ingredient-1', quantityPurchaseUnit: 3, unitCost: 10 }],
    })).rejects.toThrow('Inventory receipt idempotency key was already used with a different payload');
    expect(mocks.findIngredient).not.toHaveBeenCalled();
  });
});

