import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { setRlsContext, withRlsContext } from '../../database/rls-context.js';
import { assertBranchAccess, assertPermission, assertTenantScope, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';

type Db = Prisma.TransactionClient;
type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
type Line = {
  code: string;
  name: string;
  nameAr?: string;
  type: AccountType;
  debit?: number;
  credit?: number;
  branchId?: string | null;
  memo?: string;
};

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const positiveMoney = (n: number, field: string) => {
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a non-negative finite number`);
  return money(n);
};

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureAccount(tx: Db, tenantId: string, code: string, name: string, type: AccountType, nameAr?: string) {
    return tx.accountingAccount.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: { active: true, name, nameAr: nameAr ?? undefined, type },
      create: { id: randomUUID(), tenantId, code, name, nameAr: nameAr ?? null, type },
    });
  }

  async post(
    tx: Db,
    context: AuthContext,
    input: {
      sourceType: string;
      sourceId: string;
      description: string;
      branchId?: string | null;
      lines: Line[];
    },
  ) {
    const tenantId = assertTenantScope(context);
    if (!input.lines.length) throw new Error('Journal entry requires lines');
    if (input.branchId) assertBranchAccess(context, input.branchId);

    for (const line of input.lines) {
      if (!line.code.trim() || !line.name.trim()) throw new Error('Journal line account code and name are required');
      const debit = positiveMoney(line.debit ?? 0, 'Journal debit');
      const credit = positiveMoney(line.credit ?? 0, 'Journal credit');
      if (debit > 0 && credit > 0) throw new Error('A journal line cannot contain both debit and credit');
      if (line.branchId) {
        assertBranchAccess(context, line.branchId);
        if (input.branchId && line.branchId !== input.branchId) throw new Error('Journal line branch must match the journal branch');
      }
    }

    const totalDebit = money(input.lines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0));
    const totalCredit = money(input.lines.reduce((sum, line) => sum + Number(line.credit ?? 0), 0));
    if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new Error('Journal entry is not balanced');
    }

    const existing = await tx.journalEntry.findUnique({
      where: { tenantId_sourceType_sourceId: { tenantId, sourceType: input.sourceType, sourceId: input.sourceId } },
      include: { lines: true },
    });
    if (existing) return existing;

    const accounts = new Map<string, { id: string }>();
    for (const line of input.lines) {
      const account = await this.ensureAccount(tx, tenantId, line.code, line.name, line.type, line.nameAr);
      accounts.set(line.code, account);
    }

    return tx.journalEntry.create({
      data: {
        id: randomUUID(),
        tenantId,
        entryNumber: `JE-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        branchId: input.branchId ?? null,
        entryDate: new Date(),
        postedById: context.userId,
        lines: {
          create: input.lines.map((line) => ({
            id: randomUUID(),
            accountId: accounts.get(line.code)!.id,
            branchId: line.branchId ?? input.branchId ?? null,
            debit: money(line.debit ?? 0).toFixed(2),
            credit: money(line.credit ?? 0).toFixed(2),
            memo: line.memo ?? null,
          })),
        },
      },
      include: { lines: true },
    });
  }

  async postManual(
    context: AuthContext,
    input: { branchId?: string | null; sourceType?: string; sourceId?: string; description: string; lines: Line[] },
  ) {
    assertPermission(context, PERMISSIONS.ACCOUNTING_POST);
    assertTenantScope(context);
    return this.prisma.$transaction(async (tx) => {
      await setRlsContext(tx, context);
      return this.post(tx, context, {
        sourceType: input.sourceType ?? 'MANUAL',
        sourceId: input.sourceId ?? randomUUID(),
        description: input.description,
        branchId: input.branchId,
        lines: input.lines,
      });
    });
  }

  async postSale(
    tx: Db,
    context: AuthContext,
    input: { orderId: string; branchId: string; amount: number; payments: Array<{ method: string; amount: number }> },
  ) {
    assertTenantScope(context);
    assertBranchAccess(context, input.branchId);
    const lines: Line[] = [];
    for (const payment of input.payments) {
      const amount = positiveMoney(payment.amount, 'Payment amount');
      const account = this.paymentAccount(payment.method);
      lines.push({ ...account, debit: amount, branchId: input.branchId });
    }
    lines.push({ code: '4100', name: 'Sales Revenue', nameAr: 'إيرادات المبيعات', type: 'REVENUE', credit: positiveMoney(input.amount, 'Sale amount'), branchId: input.branchId });
    return this.post(tx, context, {
      sourceType: 'ORDER_SALE',
      sourceId: input.orderId,
      description: `Sale for order ${input.orderId}`,
      branchId: input.branchId,
      lines,
    });
  }

  async postPaymentAdjustment(
    tx: Db,
    context: AuthContext,
    input: { adjustmentId: string; branchId: string; amount: number; method: string; type: 'REFUND' | 'VOID' },
  ) {
    const amount = positiveMoney(input.amount, 'Adjustment amount');
    assertBranchAccess(context, input.branchId);
    const revenue = { code: '4100', name: 'Sales Revenue', nameAr: 'إيرادات المبيعات', type: 'REVENUE' as const };
    const payment = this.paymentAccount(input.method);
    const lines: Line[] = input.type === 'REFUND'
      ? [
          { ...revenue, debit: amount, branchId: input.branchId, memo: 'Payment refund' },
          { ...payment, credit: amount, branchId: input.branchId, memo: 'Payment refund' },
        ]
      : [
          { ...revenue, debit: amount, branchId: input.branchId, memo: 'Payment void' },
          { ...payment, credit: amount, branchId: input.branchId, memo: 'Payment void' },
        ];
    return this.post(tx, context, {
      sourceType: input.type === 'VOID' ? 'PAYMENT_VOID' : 'PAYMENT_REFUND',
      sourceId: input.adjustmentId,
      description: `${input.type === 'VOID' ? 'Void' : 'Refund'} payment adjustment ${input.adjustmentId}`,
      branchId: input.branchId,
      lines,
    });
  }

  async postInventoryPurchase(tx: Db, context: AuthContext, input: { receiptId: string; branchId: string; amount: number }) {
    const amount = positiveMoney(input.amount, 'Inventory purchase amount');
    assertBranchAccess(context, input.branchId);
    return this.post(tx, context, {
      sourceType: 'INVENTORY_PURCHASE',
      sourceId: input.receiptId,
      description: `Inventory purchase ${input.receiptId}`,
      branchId: input.branchId,
      lines: [
        { code: '1200', name: 'Inventory', nameAr: 'المخزون', type: 'ASSET', debit: amount, branchId: input.branchId },
        { code: '2100', name: 'Accounts Payable', nameAr: 'الموردون', type: 'LIABILITY', credit: amount, branchId: input.branchId },
      ],
    });
  }

  async postInventoryAdjustment(
    tx: Db,
    context: AuthContext,
    input: { movementId: string; branchId: string; amount: number; direction: string },
  ) {
    const amount = positiveMoney(input.amount, 'Inventory adjustment amount');
    assertBranchAccess(context, input.branchId);
    const increase = input.direction === 'IN';
    return this.post(tx, context, {
      sourceType: 'INVENTORY_ADJUSTMENT',
      sourceId: input.movementId,
      description: `Inventory adjustment ${input.movementId}`,
      branchId: input.branchId,
      lines: increase
        ? [
            { code: '1200', name: 'Inventory', nameAr: 'المخزون', type: 'ASSET', debit: amount, branchId: input.branchId },
            { code: '4900', name: 'Inventory Adjustment Gain', nameAr: 'مكاسب تسوية المخزون', type: 'REVENUE', credit: amount, branchId: input.branchId },
          ]
        : [
            { code: '5900', name: 'Inventory Adjustment Loss', nameAr: 'خسائر تسوية المخزون', type: 'EXPENSE', debit: amount, branchId: input.branchId },
            { code: '1200', name: 'Inventory', nameAr: 'المخزون', type: 'ASSET', credit: amount, branchId: input.branchId },
          ],
    });
  }

  async postInventoryDispatch(
    tx: Db,
    context: AuthContext,
    input: { transferId: string; fromWarehouseId: string; fromBranchId: string | null; amount: number },
  ) {
    const amount = positiveMoney(input.amount, 'Transfer dispatch amount');
    if (input.fromBranchId) assertBranchAccess(context, input.fromBranchId);
    const branchId = input.fromBranchId ?? null;
    return this.post(tx, context, {
      sourceType: 'INVENTORY_TRANSFER_DISPATCH',
      sourceId: input.transferId,
      description: `Inventory transfer dispatch ${input.transferId}`,
      branchId,
      lines: [
        { code: '1250', name: 'Inventory In Transit', nameAr: 'مخزون تحت التحويل', type: 'ASSET', debit: amount, branchId },
        { code: '1200', name: 'Inventory', nameAr: 'المخزون', type: 'ASSET', credit: amount, branchId },
      ],
    });
  }

  async postInventoryReceipt(
    tx: Db,
    context: AuthContext,
    input: { transferId: string; toWarehouseId: string; toBranchId: string | null; amount: number },
  ) {
    const amount = positiveMoney(input.amount, 'Transfer receipt amount');
    if (input.toBranchId) assertBranchAccess(context, input.toBranchId);
    const branchId = input.toBranchId ?? null;
    return this.post(tx, context, {
      sourceType: 'INVENTORY_TRANSFER_RECEIPT',
      sourceId: input.transferId,
      description: `Inventory transfer receipt ${input.transferId}`,
      branchId,
      lines: [
        { code: '1200', name: 'Inventory', nameAr: 'المخزون', type: 'ASSET', debit: amount, branchId },
        { code: '1250', name: 'Inventory In Transit', nameAr: 'مخزون تحت التحويل', type: 'ASSET', credit: amount, branchId },
      ],
    });
  }

  async postPayrollAccrual(
    tx: Db,
    context: AuthContext,
    input: { periodId: string; total: number; allocations: Array<{ branchId: string | null; amount: number }> },
  ) {
    const total = positiveMoney(input.total, 'Payroll total');
    const lines: Line[] = [];
    for (const allocation of input.allocations) {
      const amount = positiveMoney(allocation.amount, 'Payroll allocation');
      if (amount === 0) continue;
      if (allocation.branchId) assertBranchAccess(context, allocation.branchId);
      lines.push({ code: '6100', name: 'Payroll Expense', nameAr: 'مصروف الرواتب', type: 'EXPENSE', debit: amount, branchId: allocation.branchId });
    }
    lines.push({ code: '2200', name: 'Payroll Payable', nameAr: 'رواتب مستحقة', type: 'LIABILITY', credit: total });
    return this.post(tx, context, {
      sourceType: 'PAYROLL_ACCRUAL',
      sourceId: input.periodId,
      description: `Payroll accrual ${input.periodId}`,
      lines,
    });
  }

  async postPayrollPayment(tx: Db, context: AuthContext, input: { periodId: string; total: number }) {
    const total = positiveMoney(input.total, 'Payroll payment');
    return this.post(tx, context, {
      sourceType: 'PAYROLL_PAYMENT',
      sourceId: input.periodId,
      description: `Payroll payment ${input.periodId}`,
      lines: [
        { code: '2200', name: 'Payroll Payable', nameAr: 'رواتب مستحقة', type: 'LIABILITY', debit: total },
        { code: '1000', name: 'Cash', nameAr: 'النقدية', type: 'ASSET', credit: total },
      ],
    });
  }

  async journal(context: AuthContext, branchId?: string) {
    const tenantId = assertTenantScope(context);
    if (branchId) assertBranchAccess(context, branchId);
    return withRlsContext(this.prisma, context, (tx) => tx.journalEntry.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}) },
      include: { lines: { include: { account: true } } },
      orderBy: { entryDate: 'desc' },
    }));
  }

  async trialBalance(context: AuthContext, branchId?: string) {
    const tenantId = assertTenantScope(context);
    if (branchId) assertBranchAccess(context, branchId);
    const entries = await withRlsContext(this.prisma, context, (tx) => tx.journalLine.findMany({
      where: {
        entry: { tenantId, status: 'POSTED', ...(branchId ? { branchId } : {}) },
      },
      include: { account: true },
    }));
    const grouped = new Map<string, { accountId: string; code: string; name: string; nameAr: string | null; type: AccountType; debit: number; credit: number; balance: number }>();
    for (const line of entries) {
      const current = grouped.get(line.accountId) ?? { accountId: line.accountId, code: line.account.code, name: line.account.name, nameAr: line.account.nameAr, type: line.account.type, debit: 0, credit: 0, balance: 0 };
      current.debit = money(current.debit + Number(line.debit));
      current.credit = money(current.credit + Number(line.credit));
      current.balance = money(current.debit - current.credit);
      grouped.set(line.accountId, current);
    }
    return Array.from(grouped.values()).sort((a, b) => a.code.localeCompare(b.code));
  }

  private paymentAccount(method: string): Omit<Line, 'debit' | 'credit' | 'branchId'> {
    switch (method) {
      case 'CASH':
        return { code: '1000', name: 'Cash', nameAr: 'النقدية', type: 'ASSET' };
      case 'CARD':
        return { code: '1010', name: 'Card Receivables', nameAr: 'ذمم البطاقات', type: 'ASSET' };
      case 'WALLET':
        return { code: '1020', name: 'Wallet Receivables', nameAr: 'ذمم المحافظ الإلكترونية', type: 'ASSET' };
      case 'BANK_TRANSFER':
        return { code: '1030', name: 'Bank', nameAr: 'البنك', type: 'ASSET' };
      default:
        throw new Error(`Unsupported payment method for accounting: ${method}`);
    }
  }
}
