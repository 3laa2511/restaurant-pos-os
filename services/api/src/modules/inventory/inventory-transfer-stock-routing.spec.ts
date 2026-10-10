import { describe, expect, it, jest } from '@jest/globals';
import { InventoryService } from './inventory.service.js';

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

function setup(transfer: unknown, stock: unknown = null) {
  const findTransfer = jest.fn(async () => transfer);
  const updateTransfer = jest.fn(async (args: unknown) => args);
  const branchFindUnique = jest.fn(async (_args: unknown) => stock);
  const branchUpdate = jest.fn(async (args: unknown) => args);
  const branchUpsert = jest.fn(async (args: unknown) => args);
  const warehouseFindUnique = jest.fn(async () => null);
  const warehouseUpdate = jest.fn(async (args: unknown) => args);
  const warehouseUpsert = jest.fn(async (args: unknown) => args);
  const movementCreate = jest.fn(async (args: unknown) => args);
  const itemUpdate = jest.fn(async (args: unknown) => args);
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    inventoryTransfer: { findFirst: findTransfer, update: updateTransfer },
    inventoryTransferItem: { update: itemUpdate },
    inventoryStockBalance: {
      findUnique: branchFindUnique,
      update: branchUpdate,
      upsert: branchUpsert,
    },
    warehouseStockBalance: {
      findUnique: warehouseFindUnique,
      update: warehouseUpdate,
      upsert: warehouseUpsert,
    },
    inventoryMovement: { create: movementCreate },
  };
  const prisma = {
    $transaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)),
  };
  const accounting = {
    postInventoryDispatch: jest.fn(async (_tx: unknown, _context: unknown, _input: unknown) => undefined),
    postInventoryReceipt: jest.fn(async (_tx: unknown, _context: unknown, _input: unknown) => undefined),
  };
  const service = new InventoryService(prisma as never, accounting as never);
  return {
    service, tx, branchFindUnique, branchUpdate, branchUpsert,
    warehouseFindUnique, warehouseUpdate, warehouseUpsert,
    movementCreate, updateTransfer, accounting,
  };
}

describe('InventoryService branch warehouse transfer stock routing', () => {
  it('deducts dispatch quantity from the branch stock balance used by POS', async () => {
    const transfer = {
      id: 'transfer-1',
      tenantId: 'tenant-1',
      fromWarehouseId: 'branch-warehouse-1',
      toWarehouseId: 'central-warehouse-1',
      status: 'APPROVED',
      fromWarehouse: { id: 'branch-warehouse-1', type: 'BRANCH', branchId: 'branch-1' },
      toWarehouse: { id: 'central-warehouse-1', type: 'CENTRAL', branchId: null },
      items: [{ id: 'transfer-item-1', ingredientId: 'ingredient-1', quantityBaseUnit: 4, unitCost: 0 }],
    };
    const mocks = setup(transfer, { quantityBaseUnit: 10, averageCostPerBaseUnit: 2 });

    await mocks.service.dispatchTransfer(context, 'transfer-1');

    expect(mocks.branchFindUnique).toHaveBeenCalledWith({
      where: { branchId_ingredientId: { branchId: 'branch-1', ingredientId: 'ingredient-1' } },
    });
    expect(mocks.branchUpdate).toHaveBeenCalledWith({
      where: { branchId_ingredientId: { branchId: 'branch-1', ingredientId: 'ingredient-1' } },
      data: { quantityBaseUnit: 6 },
    });
    expect(mocks.warehouseFindUnique).not.toHaveBeenCalled();
    expect(mocks.warehouseUpdate).not.toHaveBeenCalled();
    expect(mocks.accounting.postInventoryDispatch).toHaveBeenCalledWith(
      mocks.tx, context,
      { transferId: 'transfer-1', fromWarehouseId: 'branch-warehouse-1', fromBranchId: 'branch-1', amount: 8 },
    );
  });

  it('adds received stock to the branch balance and recalculates weighted average cost', async () => {
    const transfer = {
      id: 'transfer-2',
      tenantId: 'tenant-1',
      fromWarehouseId: 'central-warehouse-1',
      toWarehouseId: 'branch-warehouse-1',
      status: 'IN_TRANSIT',
      fromWarehouse: { id: 'central-warehouse-1', type: 'CENTRAL', branchId: null },
      toWarehouse: { id: 'branch-warehouse-1', type: 'BRANCH', branchId: 'branch-1' },
      items: [{ id: 'transfer-item-2', ingredientId: 'ingredient-1', quantityBaseUnit: 5, unitCost: 10 }],
    };
    const mocks = setup(transfer, { quantityBaseUnit: 10, averageCostPerBaseUnit: 4 });

    await mocks.service.receiveTransfer(context, 'transfer-2');

    expect(mocks.branchUpsert).toHaveBeenCalledWith({
      where: { branchId_ingredientId: { branchId: 'branch-1', ingredientId: 'ingredient-1' } },
      update: { quantityBaseUnit: 15, averageCostPerBaseUnit: 6 },
      create: expect.objectContaining({
        tenantId: 'tenant-1',
        branchId: 'branch-1',
        ingredientId: 'ingredient-1',
        quantityBaseUnit: 5,
        averageCostPerBaseUnit: 10,
      }),
    });
    expect(mocks.warehouseFindUnique).not.toHaveBeenCalled();
    expect(mocks.warehouseUpsert).not.toHaveBeenCalled();
    expect(mocks.movementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'TRANSFER_IN',
        idempotencyKey: 'transfer-in:transfer-2:transfer-item-2',
      }),
    });
    expect(mocks.accounting.postInventoryReceipt).toHaveBeenCalledWith(
      mocks.tx, context,
      { transferId: 'transfer-2', toWarehouseId: 'branch-warehouse-1', toBranchId: 'branch-1', amount: 50 },
    );
  });
});
