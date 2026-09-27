import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, InventoryUnit } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertTenantScope, type AuthContext } from '../auth/authorization.types.js';

const n=(v:unknown,f:string)=>{const x=Number(v);if(!Number.isFinite(x)||x<0)throw new Error(f+' must be non-negative');return x;};
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listIngredients(context: AuthContext) {
    return this.prisma.ingredient.findMany({ where:{ tenantId:assertTenantScope(context), active:true }, orderBy:{name:'asc'} });
  }

  async createIngredient(context: AuthContext,input:{sku:string;name:string;nameAr?:string;baseUnit:string;purchaseUnit:string;purchaseUnitFactor:number;reorderLevel?:number}) {
    const tenantId=assertTenantScope(context);
    const factor=n(input.purchaseUnitFactor,'Purchase unit factor'); if(factor<=0)throw new Error('Purchase unit factor must be greater than zero');
    return this.prisma.ingredient.create({data:{id:randomUUID(),tenantId,sku:input.sku.trim(),name:input.name.trim(),nameAr:input.nameAr?.trim()||null,baseUnit:input.baseUnit as InventoryUnit,purchaseUnit:input.purchaseUnit as InventoryUnit,purchaseUnitFactor:factor,reorderLevel:n(input.reorderLevel??0,'Reorder level')}});
  }

  async listStock(context:AuthContext,branchId?:string){
    const tenantId=assertTenantScope(context); if(branchId)assertBranchAccess(context,branchId);
    return this.prisma.inventoryStockBalance.findMany({where:{tenantId,...(branchId?{branchId}: {})},include:{ingredient:true,branch:{select:{id:true,code:true,name:true}}},orderBy:{ingredient:{name:'asc'}}});
  }

  async receive(context:AuthContext,input:{branchId:string;supplierId?:string;reference?:string;items:Array<{ingredientId:string;quantityPurchaseUnit:number;unitCost:number}>;}) {
    const tenantId=assertTenantScope(context); assertBranchAccess(context,input.branchId); if(!input.items?.length)throw new Error('Receipt must contain at least one item');
    return this.prisma.$transaction(async tx=>{
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
      return receipt;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }

  async adjust(context:AuthContext,input:{branchId:string;ingredientId:string;quantityBaseUnit:number;direction:'IN'|'OUT';reason:string;idempotencyKey:string}){
    const tenantId=assertTenantScope(context); assertBranchAccess(context,input.branchId); const qty=n(input.quantityBaseUnit,'Quantity'); if(qty<=0)throw new Error('Quantity must be greater than zero');
    return this.prisma.$transaction(async tx=>{
      const ingredient=await tx.ingredient.findFirst({where:{id:input.ingredientId,tenantId,active:true}}); if(!ingredient)throw new Error('Ingredient not found');
      const current=await tx.inventoryStockBalance.findUnique({where:{branchId_ingredientId:{branchId:input.branchId,ingredientId:input.ingredientId}}});
      const currentQty=current?Number(current.quantityBaseUnit):0; const next=input.direction==='IN'?currentQty+qty:currentQty-qty; if(next<0)throw new Error('Insufficient stock');
      const movement=await tx.inventoryMovement.create({data:{id:randomUUID(),tenantId,branchId:input.branchId,ingredientId:input.ingredientId,type:input.direction==='IN'?'ADJUSTMENT_IN':'ADJUSTMENT_OUT',quantityBaseUnit:qty,unitCost:current?Number(current.averageCostPerBaseUnit):0,referenceType:'MANUAL_ADJUSTMENT',referenceId:input.reason.trim(),idempotencyKey:input.idempotencyKey,actorUserId:context.userId}});
      await tx.inventoryStockBalance.upsert({where:{branchId_ingredientId:{branchId:input.branchId,ingredientId:input.ingredientId}},update:{quantityBaseUnit:next},create:{id:randomUUID(),tenantId,branchId:input.branchId,ingredientId:input.ingredientId,quantityBaseUnit:next,averageCostPerBaseUnit:0}});
      return movement;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }

  async setRecipe(context:AuthContext,productId:string,input:{items:Array<{ingredientId:string;quantityBaseUnit:number;wastePercent?:number}>}){
    const tenantId=assertTenantScope(context);
    const product=await this.prisma.product.findFirst({where:{id:productId,tenantId},select:{id:true}}); if(!product)throw new Error('Product not found');
    return this.prisma.$transaction(async tx=>{
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
