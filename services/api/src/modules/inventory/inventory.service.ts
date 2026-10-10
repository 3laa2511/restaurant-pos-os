import { Injectable } from '@nestjs/common';
import { setRlsContext, withRlsContext } from '../../database/rls-context.js';
import { randomUUID } from 'node:crypto';
import { Prisma, InventoryUnit } from '../../generated/prisma/client.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertTenantScope, type AuthContext } from '../auth/authorization.types.js';

const n=(v:unknown,f:string)=>{const x=Number(v);if(!Number.isFinite(x)||x<0)throw new Error(f+' must be non-negative');return x;};
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService, private readonly accounting: AccountingService) {}

  async listIngredients(context: AuthContext) {
    const tenantId = assertTenantScope(context);
    return withRlsContext(this.prisma, context, (tx) => tx.ingredient.findMany({ where:{ tenantId, active:true }, orderBy:{name:'asc'} }));
  }

  async createIngredient(context: AuthContext,input:{sku:string;name:string;nameAr?:string;baseUnit:string;purchaseUnit:string;purchaseUnitFactor:number;reorderLevel?:number}) {
    const tenantId=assertTenantScope(context);
    const factor=n(input.purchaseUnitFactor,'Purchase unit factor'); if(factor<=0)throw new Error('Purchase unit factor must be greater than zero');
    return withRlsContext(this.prisma, context, (tx) => tx.ingredient.create({data:{id:randomUUID(),tenantId,sku:input.sku.trim(),name:input.name.trim(),nameAr:input.nameAr?.trim()||null,baseUnit:input.baseUnit as InventoryUnit,purchaseUnit:input.purchaseUnit as InventoryUnit,purchaseUnitFactor:factor,reorderLevel:n(input.reorderLevel??0,'Reorder level')}}));
  }

  async listStock(context:AuthContext,branchId?:string){
    const tenantId=assertTenantScope(context); if(branchId)assertBranchAccess(context,branchId);
    return withRlsContext(this.prisma, context, (tx) => tx.inventoryStockBalance.findMany({where:{tenantId,...(branchId?{branchId}: {})},include:{ingredient:true,branch:{select:{id:true,code:true,name:true}}},orderBy:{ingredient:{name:'asc'}}}));
  }

  async receive(context:AuthContext,input:{branchId:string;supplierId?:string;reference?:string;items:Array<{ingredientId:string;quantityPurchaseUnit:number;unitCost:number}>;}) {
    const tenantId=assertTenantScope(context); assertBranchAccess(context,input.branchId); if(!input.items?.length)throw new Error('Receipt must contain at least one item');
    if (new Set(input.items.map((item) => item.ingredientId)).size !== input.items.length) {
      throw new Error('Receipt cannot contain the same ingredient more than once; combine quantities and costs into one line');
    }
    return this.prisma.$transaction(async tx => {
      await setRlsContext(tx, context);
      const branch=await tx.branch.findFirst({where:{id:input.branchId,tenantId,active:true},select:{id:true}}); if(!branch)throw new Error('Branch not found');
      const items: Array<{ ingredientId:string; purchaseUnitFactor:number; qty:number; baseQty:number; unitCost:number; baseUnitCost:number; line:number }> = []; let total=0;
      for(const item of input.items){
        const ingredient=await tx.ingredient.findFirst({where:{id:item.ingredientId,tenantId,active:true}});
        if(!ingredient)throw new Error('Ingredient not found');
        const qty=n(item.quantityPurchaseUnit,'Quantity'); if(qty<=0)throw new Error('Quantity must be greater than zero');
        const unitCost=n(item.unitCost,'Unit cost'); const baseQty=qty*Number(ingredient.purchaseUnitFactor); const line=qty*unitCost; total+=line;
        items.push({ingredientId:ingredient.id,purchaseUnitFactor:Number(ingredient.purchaseUnitFactor),qty,baseQty,unitCost,baseUnitCost:unitCost/Number(ingredient.purchaseUnitFactor),line});
      }
      if (input.supplierId) {
        const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, tenantId, active: true }, select: { id: true } });
        if (!supplier) throw new Error('Supplier not found');
      }
      const receipt=await tx.inventoryReceipt.create({data:{id:randomUUID(),tenantId,branchId:input.branchId,supplierId:input.supplierId||null,reference:input.reference?.trim()||null,totalCost:total,items:{create:items.map(x=>({id:randomUUID(),ingredientId:x.ingredientId,quantityPurchaseUnit:x.qty,quantityBaseUnit:x.baseQty,unitCost:x.unitCost,totalCost:x.line}))}}});
      for(const x of items){
        const existing=await tx.inventoryStockBalance.findUnique({where:{branchId_ingredientId:{branchId:input.branchId,ingredientId:x.ingredientId}}});
        const oldQty=existing?Number(existing.quantityBaseUnit):0; const oldAvg=existing?Number(existing.averageCostPerBaseUnit):0;
        const newQty=oldQty+x.baseQty; const newAvg=newQty===0?0:((oldQty*oldAvg)+(x.baseQty*x.baseUnitCost))/newQty;
        await tx.inventoryStockBalance.upsert({where:{branchId_ingredientId:{branchId:input.branchId,ingredientId:x.ingredientId}},update:{quantityBaseUnit:newQty,averageCostPerBaseUnit:newAvg},create:{id:randomUUID(),tenantId,branchId:input.branchId,ingredientId:x.ingredientId,quantityBaseUnit:x.baseQty,averageCostPerBaseUnit:x.unitCost/Number(x.purchaseUnitFactor)}});
        await tx.inventoryMovement.create({data:{id:randomUUID(),tenantId,branchId:input.branchId,ingredientId:x.ingredientId,type:'PURCHASE',quantityBaseUnit:x.baseQty,unitCost:x.baseUnitCost,referenceType:'RECEIPT',referenceId:receipt.id,idempotencyKey:`${receipt.id}:${x.ingredientId}`,actorUserId:context.userId}});
      }
      await this.accounting.postInventoryPurchase(tx, context, { receiptId: receipt.id, branchId: input.branchId, amount: Number(receipt.totalCost) });
      return receipt;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }

  async consumeOrder(tx: Prisma.TransactionClient, context: AuthContext, input: { orderId: string; branchId: string }) {
    const tenantId = assertTenantScope(context);
    assertBranchAccess(context, input.branchId);

    const order = await tx.order.findFirst({
      where: { id: input.orderId, branchId: input.branchId, branch: { tenantId } },
      include: { items: { include: { product: { include: { recipeIngredients: true } } } } },
    });
    if (!order) throw new Error('Order not found for inventory consumption');

    // Inventory movements are the consumption idempotency source of truth. Do not
    // rely only on the COGS journal: a valid zero-cost recipe still consumes stock
    // but intentionally does not create a zero-value journal entry.
    const existingMovement = await tx.inventoryMovement.findFirst({
      where: {
        tenantId,
        branchId: input.branchId,
        type: 'CONSUMPTION',
        referenceType: 'ORDER',
        referenceId: input.orderId,
      },
      select: { id: true },
    });
    const existingCogs = await tx.journalEntry.findFirst({
      where: { tenantId, sourceType: 'ORDER_COGS', sourceId: input.orderId },
      select: { id: true },
    });
    if (existingMovement || existingCogs) {
      return { orderId: input.orderId, amount: 0, alreadyConsumed: true };
    }

    let totalCost = 0;
    for (const item of order.items) {
      for (const recipe of item.product.recipeIngredients) {
        const requiredQty = Number(recipe.quantityBaseUnit) * item.quantity * (1 + Number(recipe.wastePercent) / 100);
        if (!Number.isFinite(requiredQty) || requiredQty <= 0) continue;

        const stock = await tx.inventoryStockBalance.findUnique({
          where: { branchId_ingredientId: { branchId: input.branchId, ingredientId: recipe.ingredientId } },
        });
        const currentQty = stock ? Number(stock.quantityBaseUnit) : 0;
        const unitCost = stock ? Number(stock.averageCostPerBaseUnit) : 0;
        if (currentQty < requiredQty) {
          throw new Error(`Insufficient stock for ingredient ${recipe.ingredientId}`);
        }

        const lineCost = requiredQty * unitCost;
        totalCost += lineCost;
        const nextQty = currentQty - requiredQty;
        await tx.inventoryStockBalance.update({
          where: { branchId_ingredientId: { branchId: input.branchId, ingredientId: recipe.ingredientId } },
          data: { quantityBaseUnit: nextQty },
        });
        await tx.inventoryMovement.create({
          data: {
            id: randomUUID(),
            tenantId,
            branchId: input.branchId,
            ingredientId: recipe.ingredientId,
            type: 'CONSUMPTION',
            quantityBaseUnit: requiredQty,
            unitCost,
            referenceType: 'ORDER',
            referenceId: input.orderId,
            idempotencyKey: `order-consumption:${input.orderId}:${recipe.ingredientId}:${item.id}`,
            actorUserId: context.userId,
          },
        });
      }
    }

    if (totalCost > 0) {
      await this.accounting.postInventoryConsumption(tx, context, {
        orderId: input.orderId,
        branchId: input.branchId,
        amount: totalCost,
      });
    }
    return { orderId: input.orderId, amount: Math.round(totalCost * 100) / 100 };
  }

  async adjust(context:AuthContext,input:{branchId:string;ingredientId:string;quantityBaseUnit:number;direction:'IN'|'OUT';reason:string;idempotencyKey:string}){
    const tenantId=assertTenantScope(context); assertBranchAccess(context,input.branchId); const qty=n(input.quantityBaseUnit,'Quantity'); if(qty<=0)throw new Error('Quantity must be greater than zero');
    return this.prisma.$transaction(async tx => {
      await setRlsContext(tx, context);
      const ingredient=await tx.ingredient.findFirst({where:{id:input.ingredientId,tenantId,active:true}}); if(!ingredient)throw new Error('Ingredient not found');
      const current=await tx.inventoryStockBalance.findUnique({where:{branchId_ingredientId:{branchId:input.branchId,ingredientId:input.ingredientId}}});
      const currentQty=current?Number(current.quantityBaseUnit):0; const next=input.direction==='IN'?currentQty+qty:currentQty-qty; if(next<0)throw new Error('Insufficient stock');
      const movement=await tx.inventoryMovement.create({data:{id:randomUUID(),tenantId,branchId:input.branchId,ingredientId:input.ingredientId,type:input.direction==='IN'?'ADJUSTMENT_IN':'ADJUSTMENT_OUT',quantityBaseUnit:qty,unitCost:current?Number(current.averageCostPerBaseUnit):0,referenceType:'MANUAL_ADJUSTMENT',referenceId:input.reason.trim(),idempotencyKey:input.idempotencyKey,actorUserId:context.userId}});
      await tx.inventoryStockBalance.upsert({where:{branchId_ingredientId:{branchId:input.branchId,ingredientId:input.ingredientId}},update:{quantityBaseUnit:next},create:{id:randomUUID(),tenantId,branchId:input.branchId,ingredientId:input.ingredientId,quantityBaseUnit:next,averageCostPerBaseUnit:0}});
      await this.accounting.postInventoryAdjustment(tx, context, { movementId: movement.id, branchId: input.branchId, amount: qty * (current ? Number(current.averageCostPerBaseUnit) : 0), direction: input.direction });
      return movement;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }


  async listWarehouses(context: AuthContext) {
    const tenantId = assertTenantScope(context);
    return withRlsContext(this.prisma, context, (tx) => tx.warehouse.findMany({
      where: context.branchId
        ? { tenantId, active: true, OR: [{ branchId: context.branchId }, { type: 'CENTRAL' }] }
        : { tenantId, active: true },
      include: { branch: { select: { id: true, code: true, name: true } } },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    }));
  }

  async listTransfers(context: AuthContext, status?: string) {
    const tenantId = assertTenantScope(context);
    return withRlsContext(this.prisma, context, (tx) => tx.inventoryTransfer.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(context.branchId
          ? { OR: [{ fromWarehouse: { branchId: context.branchId } }, { toWarehouse: { branchId: context.branchId } }, { fromWarehouse: { type: 'CENTRAL' }, toWarehouse: { branchId: context.branchId } }, { fromWarehouse: { branchId: context.branchId }, toWarehouse: { type: 'CENTRAL' } }] }
          : {}),
      },
      include: {
        fromWarehouse: { select: { id: true, code: true, name: true, type: true, branchId: true } },
        toWarehouse: { select: { id: true, code: true, name: true, type: true, branchId: true } },
        items: { include: { ingredient: { select: { id: true, sku: true, name: true, baseUnit: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }));
  }

  async createTransfer(context: AuthContext, input: { fromWarehouseId: string; toWarehouseId: string; items: Array<{ ingredientId: string; quantityBaseUnit: number }>; notes?: string }) {
    const tenantId = assertTenantScope(context);
    if (input.fromWarehouseId === input.toWarehouseId) throw new Error('Source and destination warehouses must be different');
    if (!input.items?.length) throw new Error('Transfer must contain at least one item');
    if (new Set(input.items.map((item) => item.ingredientId)).size !== input.items.length) {
      throw new Error('Transfer cannot contain the same ingredient more than once');
    }
    return withRlsContext(this.prisma, context, async (tx) => {
      const warehouses = await tx.warehouse.findMany({ where: { tenantId, id: { in: [input.fromWarehouseId, input.toWarehouseId] }, active: true } });
      if (warehouses.length !== 2) throw new Error('Warehouse not found');
      for (const w of warehouses) if (w.branchId) assertBranchAccess(context, w.branchId);
      const ingredientIds = input.items.map(x => x.ingredientId);
      const ingredients = await tx.ingredient.findMany({ where: { tenantId, id: { in: ingredientIds }, active: true }, select: { id: true } });
      if (ingredients.length !== new Set(ingredientIds).size) throw new Error('Transfer contains an invalid ingredient');
      for (const item of input.items) { const qty = n(item.quantityBaseUnit, 'Transfer quantity'); if (qty <= 0) throw new Error('Transfer quantity must be greater than zero'); }
      const transferNumber = 'TR-' + Date.now() + '-' + randomUUID().slice(0, 8).toUpperCase();
      return tx.inventoryTransfer.create({
        data: { id: randomUUID(), tenantId, transferNumber, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, status: 'REQUESTED', requestedById: context.userId, requestedAt: new Date(), notes: input.notes?.trim() || null, items: { create: input.items.map(x => ({ id: randomUUID(), ingredientId: x.ingredientId, quantityBaseUnit: n(x.quantityBaseUnit, 'Transfer quantity'), unitCost: 0 })) } },
        include: { items: true },
      });
    });
  }

  async approveTransfer(context: AuthContext, transferId: string) {
    const tenantId = assertTenantScope(context);
    return this.prisma.$transaction(async tx => {
      await setRlsContext(tx, context);
      const transfer = await tx.inventoryTransfer.findFirst({ where: { id: transferId, tenantId }, include: { fromWarehouse: true, toWarehouse: true } });
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.fromWarehouse.branchId) assertBranchAccess(context, transfer.fromWarehouse.branchId);
      if (transfer.toWarehouse.branchId) assertBranchAccess(context, transfer.toWarehouse.branchId);
      if (transfer.status !== 'REQUESTED' && transfer.status !== 'DRAFT') throw new Error('Transfer cannot be approved in its current state');
      return tx.inventoryTransfer.update({ where: { id: transfer.id }, data: { status: 'APPROVED', approvedById: context.userId, approvedAt: new Date() } });
    });
  }

  async dispatchTransfer(context: AuthContext, transferId: string) {
    const tenantId = assertTenantScope(context);
    return this.prisma.$transaction(async tx => {
      await setRlsContext(tx, context);
      const transfer = await tx.inventoryTransfer.findFirst({ where: { id: transferId, tenantId }, include: { fromWarehouse: true, toWarehouse: true, items: true } });
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.fromWarehouse.branchId) assertBranchAccess(context, transfer.fromWarehouse.branchId);
      if (transfer.status !== 'APPROVED') throw new Error('Only approved transfers can be dispatched');
      let transferAmount = 0;
      for (const item of transfer.items) {
        const qty = Number(item.quantityBaseUnit);
        const stock = await tx.warehouseStockBalance.findUnique({ where: { warehouseId_ingredientId: { warehouseId: transfer.fromWarehouseId, ingredientId: item.ingredientId } } });
        const current = stock ? Number(stock.quantityBaseUnit) : 0;
        if (current < qty) throw new Error('Insufficient stock for ingredient ' + item.ingredientId);
        const unitCost = stock ? Number(stock.averageCostPerBaseUnit) : 0;
        transferAmount += qty * unitCost;
        await tx.warehouseStockBalance.update({ where: { warehouseId_ingredientId: { warehouseId: transfer.fromWarehouseId, ingredientId: item.ingredientId } }, data: { quantityBaseUnit: current - qty } });
        await tx.inventoryTransferItem.update({ where: { id: item.id }, data: { unitCost } });
        await tx.inventoryMovement.create({ data: { id: randomUUID(), tenantId, branchId: transfer.fromWarehouse.branchId, warehouseId: transfer.fromWarehouseId, ingredientId: item.ingredientId, type: 'TRANSFER_OUT', quantityBaseUnit: qty, unitCost, referenceType: 'INVENTORY_TRANSFER', referenceId: transfer.id, idempotencyKey: 'transfer-out:' + transfer.id + ':' + item.id, actorUserId: context.userId } });
      }
      await this.accounting.postInventoryDispatch(tx, context, { transferId: transfer.id, fromWarehouseId: transfer.fromWarehouseId, fromBranchId: transfer.fromWarehouse.branchId, amount: transferAmount });
      return tx.inventoryTransfer.update({ where: { id: transfer.id }, data: { status: 'IN_TRANSIT', sentAt: new Date() }, include: { items: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async receiveTransfer(context: AuthContext, transferId: string) {
    const tenantId = assertTenantScope(context);
    return this.prisma.$transaction(async tx => {
      await setRlsContext(tx, context);
      let transferAmount = 0;
      const transfer = await tx.inventoryTransfer.findFirst({ where: { id: transferId, tenantId }, include: { fromWarehouse: true, toWarehouse: true, items: true } });
      if (!transfer) throw new Error('Transfer not found');
      if (transfer.toWarehouse.branchId) assertBranchAccess(context, transfer.toWarehouse.branchId);
      if (transfer.status !== 'IN_TRANSIT') throw new Error('Only in-transit transfers can be received');
      for (const item of transfer.items) {
        const qty = Number(item.quantityBaseUnit);
        const unitCost = Number(item.unitCost);
        transferAmount += qty * unitCost;
        const stock = await tx.warehouseStockBalance.findUnique({ where: { warehouseId_ingredientId: { warehouseId: transfer.toWarehouseId, ingredientId: item.ingredientId } } });
        const oldQty = stock ? Number(stock.quantityBaseUnit) : 0;
        const oldAvg = stock ? Number(stock.averageCostPerBaseUnit) : 0;
        const newQty = oldQty + qty;
        const newAvg = newQty === 0 ? 0 : ((oldQty * oldAvg) + (qty * unitCost)) / newQty;
        await tx.warehouseStockBalance.upsert({ where: { warehouseId_ingredientId: { warehouseId: transfer.toWarehouseId, ingredientId: item.ingredientId } }, update: { quantityBaseUnit: newQty, averageCostPerBaseUnit: newAvg }, create: { id: randomUUID(), tenantId, warehouseId: transfer.toWarehouseId, ingredientId: item.ingredientId, quantityBaseUnit: qty, averageCostPerBaseUnit: unitCost } });
        await tx.inventoryMovement.create({ data: { id: randomUUID(), tenantId, branchId: transfer.toWarehouse.branchId, warehouseId: transfer.toWarehouseId, ingredientId: item.ingredientId, type: 'TRANSFER_IN', quantityBaseUnit: qty, unitCost, referenceType: 'INVENTORY_TRANSFER', referenceId: transfer.id, idempotencyKey: 'transfer-in:' + transfer.id + ':' + item.id, actorUserId: context.userId } });
      }
      await this.accounting.postInventoryReceipt(tx, context, { transferId: transfer.id, toWarehouseId: transfer.toWarehouseId, toBranchId: transfer.toWarehouse.branchId, amount: transferAmount });
      return tx.inventoryTransfer.update({ where: { id: transfer.id }, data: { status: 'RECEIVED', receivedAt: new Date() }, include: { items: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async setRecipe(context:AuthContext,productId:string,input:{items:Array<{ingredientId:string;quantityBaseUnit:number;wastePercent?:number}>}){
    const tenantId=assertTenantScope(context);
    if (new Set((input.items ?? []).map((item) => item.ingredientId)).size !== (input.items ?? []).length) {
      throw new Error('Recipe cannot contain the same ingredient more than once');
    }
    return withRlsContext(this.prisma, context, async (tx) => {
      const product=await tx.product.findFirst({where:{id:productId,tenantId},select:{id:true}});
      if(!product)throw new Error('Product not found');
      await tx.recipeIngredient.deleteMany({where:{productId,tenantId}});
      if(input.items?.length) {
        const ingredientIds = input.items.map((x) => x.ingredientId);
        const ingredients = await tx.ingredient.findMany({ where: { tenantId, id: { in: ingredientIds }, active: true }, select: { id: true } });
        if (ingredients.length !== new Set(ingredientIds).size) throw new Error('Recipe contains an ingredient outside the current tenant or an inactive ingredient');
        await tx.recipeIngredient.createMany({data:input.items.map(x=>({id:randomUUID(),tenantId,productId,ingredientId:x.ingredientId,quantityBaseUnit:n(x.quantityBaseUnit,'Recipe quantity'),wastePercent:n(x.wastePercent??0,'Waste percent')}))});
      }
      return tx.recipeIngredient.findMany({where:{productId,tenantId},include:{ingredient:true}});
    });
  }
}
