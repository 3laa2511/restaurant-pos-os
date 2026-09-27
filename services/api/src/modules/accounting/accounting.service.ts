import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertPermission, assertTenantScope, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';

type Db = Prisma.TransactionClient;
type Line = { code: string; name: string; nameAr?: string; type: 'ASSET'|'LIABILITY'|'EQUITY'|'REVENUE'|'EXPENSE'; debit?: number; credit?: number; branchId?: string|null; memo?: string };

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureAccount(tx: Db, tenantId: string, code: string, name: string, type: Line['type'], nameAr?: string) {
    return tx.accountingAccount.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: { active: true, name, nameAr: nameAr ?? undefined, type },
      create: { id: randomUUID(), tenantId, code, name, nameAr: nameAr ?? null, type },
    });
  }

  async post(tx: Db, context: AuthContext, input: { sourceType: string; sourceId: string; description: string; branchId?: string|null; lines: Line[] }) {
    const tenantId = assertTenantScope(context);
    if (!input.lines.length) throw new Error('Journal entry requires lines');
    const totalDebit = money(input.lines.reduce((s,l)=>s+Number(l.debit||0),0));
    const totalCredit = money(input.lines.reduce((s,l)=>s+Number(l.credit||0),0));
    if (totalDebit <= 0 || Math.abs(totalDebit-totalCredit) > 0.005) throw new Error('Journal entry is not balanced');
    const existing = await tx.journalEntry.findUnique({ where: { tenantId_sourceType_sourceId: { tenantId, sourceType: input.sourceType, sourceId: input.sourceId } }, include: { lines: true } });
    if (existing) return existing;
    const accounts = new Map<string, {id:string}>();
    for (const line of input.lines) accounts.set(line.code, await this.ensureAccount(tx, tenantId, line.code, line.name, line.type, line.nameAr));
    return tx.journalEntry.create({
      data: {
        id: randomUUID(), tenantId, entryNumber: 'JE-' + Date.now() + '-' + randomUUID().slice(0,6).toUpperCase(),
        description: input.description, sourceType: input.sourceType, sourceId: input.sourceId, branchId: input.branchId ?? null, entryDate: new Date(), postedById: context.userId,
        lines: { create: input.lines.map(l => ({ id: randomUUID(), accountId: accounts.get(l.code)!.id, branchId: l.branchId ?? input.branchId ?? null, debit: money(l.debit||0).toFixed(2), credit: money(l.credit||0).toFixed(2), memo: l.memo ?? null })) },
      },
      include: { lines: true },
    });
  }

  async postManual(context: AuthContext, input: { branchId?: string|null; sourceType?: string; sourceId?: string; description: string; lines: Line[] }) {
    assertPermission(context, PERMISSIONS.ACCOUNTING_POST);
    const tenantId = assertTenantScope(context);
    return this.prisma.$transaction((tx) => this.post(tx, context, {
      sourceType: input.sourceType ?? 'MANUAL',
      sourceId: input.sourceId ?? randomUUID(),
      description: input.description,
      branchId: input.branchId,
      lines: input.lines,
    }));
  }

  async trialBalance(context: AuthContext, branchId?: string) {
    const tenantId = assertTenantScope(context);
    return this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: { entry: { tenantId }, ...(branchId ? { branchId } : {}) },
      _sum: { debit: true, credit: true },
      orderBy: { accountId: 'asc' },
    });
  }

  async journal(context: AuthContext, branchId?: string) {
    const tenantId = assertTenantScope(context);
    return this.prisma.journalEntry.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}) },
      include: { lines: { include: { account: true } } },
      orderBy: { postedAt: 'desc' },
      take: 500,
    });
  }

  async postSale(tx: Db, context: AuthContext, input: { orderId:string; branchId:string; amount:number; payments:Array<{method:string;amount:number}> }) {
    const debits: Line[] = [];
    for (const p of input.payments) {
      const method = p.method.toUpperCase();
      const code = method === 'CASH' ? '1100-CASH' : method === 'CARD' ? '1110-BANK' : method === 'WALLET' ? '1120-WALLET' : '1130-OTHER-RECEIVABLE';
      debits.push({ code, name: method === 'CASH' ? 'Cash' : method === 'CARD' ? 'Bank/Card Receivable' : method === 'WALLET' ? 'Wallet Receivable' : 'Other Receivable', type:'ASSET', debit:p.amount, branchId:input.branchId });
    }
    debits.push({code:'4100-SALES',name:'Sales Revenue',type:'REVENUE',credit:input.amount,branchId:input.branchId});
    return this.post(tx, context, {sourceType:'POS_SALE',sourceId:input.orderId,description:'POS sale '+input.orderId,branchId:input.branchId,lines:debits});
  }

  async postPaymentAdjustment(tx: Db, context: AuthContext, input: { adjustmentId:string; branchId:string; amount:number; method:string; type:'REFUND'|'VOID'; }) {
    const method=input.method.toUpperCase();
    const code=method==='CASH'?'1100-CASH':method==='CARD'?'1110-BANK':method==='WALLET'?'1120-WALLET':'1130-OTHER-RECEIVABLE';
    return this.post(tx,context,{sourceType:'PAYMENT_'+input.type,sourceId:input.adjustmentId,description:'Payment '+input.type.toLowerCase(),branchId:input.branchId,lines:[
      {code:'4200-SALES-RETURNS',name:'Sales Returns / Refunds',type:'REVENUE',debit:input.amount,branchId:input.branchId},
      {code,name:method==='CASH'?'Cash':method==='CARD'?'Bank/Card Receivable':method==='WALLET'?'Wallet Receivable':'Other Receivable',type:'ASSET',credit:input.amount,branchId:input.branchId},
    ]});
  }

  async postInventoryDispatch(tx: Db, context: AuthContext, input: { transferId:string; fromWarehouseId:string; fromBranchId?:string|null; amount:number }) {
    if (input.amount <= 0) return null;
    return this.post(tx,context,{sourceType:'INVENTORY_TRANSFER_DISPATCH',sourceId:input.transferId,description:'Inventory transfer dispatched',branchId:input.fromBranchId ?? null,lines:[
      {code:'1310-INVENTORY-IN-TRANSIT',name:'Inventory In Transit',type:'ASSET',debit:input.amount},
      {code:'1300-INVENTORY-'+input.fromWarehouseId,name:'Inventory - source warehouse',type:'ASSET',credit:input.amount,branchId:input.fromBranchId},
    ]});
  }

  async postInventoryReceipt(tx: Db, context: AuthContext, input: { transferId:string; toWarehouseId:string; toBranchId?:string|null; amount:number }) {
    if (input.amount <= 0) return null;
    return this.post(tx,context,{sourceType:'INVENTORY_TRANSFER_RECEIPT',sourceId:input.transferId,description:'Inventory transfer received',branchId:input.toBranchId ?? null,lines:[
      {code:'1300-INVENTORY-'+input.toWarehouseId,name:'Inventory - destination warehouse',type:'ASSET',debit:input.amount,branchId:input.toBranchId},
      {code:'1310-INVENTORY-IN-TRANSIT',name:'Inventory In Transit',type:'ASSET',credit:input.amount},
    ]});
  }


  async postInventoryPurchase(tx: Db, context: AuthContext, input:{receiptId:string;branchId:string;amount:number}) {
    if(input.amount<=0) return null;
    return this.post(tx,context,{sourceType:'INVENTORY_PURCHASE',sourceId:input.receiptId,description:'Inventory purchase',branchId:input.branchId,lines:[
      {code:'1200-INVENTORY',name:'Inventory',type:'ASSET',debit:input.amount,branchId:input.branchId},
      {code:'2200-ACCOUNTS-PAYABLE',name:'Accounts Payable',type:'LIABILITY',credit:input.amount,branchId:input.branchId},
    ]});
  }

  async postInventoryAdjustment(tx: Db, context: AuthContext, input:{movementId:string;branchId:string;amount:number;direction:'IN'|'OUT'}) {
    if(input.amount<=0) return null;
    return this.post(tx,context,{sourceType:'INVENTORY_ADJUSTMENT',sourceId:input.movementId,description:'Inventory adjustment',branchId:input.branchId,lines:input.direction==='IN' ? [
      {code:'1200-INVENTORY',name:'Inventory',type:'ASSET',debit:input.amount,branchId:input.branchId},
      {code:'4300-INVENTORY-GAIN',name:'Inventory Adjustment Gain',type:'REVENUE',credit:input.amount,branchId:input.branchId},
    ] : [
      {code:'6300-INVENTORY-LOSS',name:'Inventory Adjustment Loss',type:'EXPENSE',debit:input.amount,branchId:input.branchId},
      {code:'1200-INVENTORY',name:'Inventory',type:'ASSET',credit:input.amount,branchId:input.branchId},
    ]});
  }

  async postPayrollAccrual(tx: Db, context: AuthContext, input:{periodId:string; total:number; allocations:Array<{branchId?:string|null;amount:number}>}) {
    const lines:Line[]=[];
    for(const a of input.allocations) if(a.amount>0) {
      lines.push({code:'6100-PAYROLL-EXPENSE',name:'Payroll Expense',type:'EXPENSE',debit:a.amount,branchId:a.branchId});
      lines.push({code:'2100-PAYROLL-PAYABLE',name:'Payroll Payable',type:'LIABILITY',credit:a.amount,branchId:a.branchId});
    }
    return this.post(tx,context,{sourceType:'PAYROLL_ACCRUAL',sourceId:input.periodId,description:'Payroll accrual',lines});
  }

  async postPayrollPayment(tx: Db, context: AuthContext, input:{periodId:string; total:number}) {
    return this.post(tx,context,{sourceType:'PAYROLL_PAYMENT',sourceId:input.periodId,description:'Payroll payment',lines:[
      {code:'2100-PAYROLL-PAYABLE',name:'Payroll Payable',type:'LIABILITY',debit:input.total},
      {code:'1100-CASH',name:'Cash',type:'ASSET',credit:input.total},
    ]});
  }
}