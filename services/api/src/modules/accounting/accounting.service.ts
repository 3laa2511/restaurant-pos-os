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

  async ensureAccount(tx: Db, tenantId: string, code: string, type: AccountType) {
    const account = await tx.accountingAccount.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    if (!account) {
      throw new Error(`Accounting account ${code} is not configured`);
    }
    if (!account.active) throw new Error(`Accounting account ${code} is inactive`);
    if (!account.allowPosting) throw new Error(`Accounting account ${code} does not allow posting`);
    if (account.type !== type) throw new Error(`Accounting account ${code} has an incompatible account type`);
    return account;
  }

  async createAccount(
    context: AuthContext,
    input: { code: string; name: string; nameAr?: string; type: AccountType; parentId?: string; allowPosting?: boolean },
  ) {
    assertPermission(context, PERMISSIONS.ACCOUNTING_MANAGE);
    const tenantId = assertTenantScope(context);
    const code = input.code.trim();
    const name = input.name.trim();
    if (!code || !name) throw new Error('Account code and name are required');

    return this.prisma.$transaction(async (tx) => {
      await setRlsContext(tx, context);
      if (input.parentId) {
        const parent = await tx.accountingAccount.findFirst({ where: { id: input.parentId, tenantId } });
        if (!parent) throw new Error('Parent account not found');
        if (parent.type !== input.type) throw new Error('Parent and child account types must match');
      }
      return tx.accountingAccount.create({
        data: {
          id: randomUUID(), tenantId, code, name,
          nameAr: input.nameAr?.trim() || null,
          type: input.type,
          parentId: input.parentId ?? null,
          allowPosting: input.allowPosting ?? true,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async updateAccount(
    context: AuthContext,
    accountId: string,
    input: { name?: string; nameAr?: string; parentId?: string | null; allowPosting?: boolean },
  ) {
    assertPermission(context, PERMISSIONS.ACCOUNTING_MANAGE);
    const tenantId = assertTenantScope(context);
    return this.prisma.$transaction(async (tx) => {
      await setRlsContext(tx, context);
      const account = await tx.accountingAccount.findFirst({ where: { id: accountId, tenantId } });
      if (!account) throw new Error('Account not found');
      if (input.parentId === account.id) throw new Error('An account cannot be its own parent');
      if (input.parentId) {
        const parent = await tx.accountingAccount.findFirst({ where: { id: input.parentId, tenantId } });
        if (!parent) throw new Error('Parent account not found');
        if (parent.type !== account.type) throw new Error('Parent and child account types must match');
        if (!parent.allowPosting && input.allowPosting === false) {
          // allowed; this is a normal parent account configuration
        }
      }
      const hasChildren = await tx.accountingAccount.count({ where: { tenantId, parentId: account.id } });
      if (hasChildren > 0 && input.allowPosting === true) {
        throw new Error('Parent accounts with children cannot allow direct posting');
      }
      return tx.accountingAccount.update({
        where: { id: account.id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.nameAr !== undefined ? { nameAr: input.nameAr.trim() || null } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.allowPosting !== undefined ? { allowPosting: input.allowPosting } : {}),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async deactivateAccount(context: AuthContext, accountId: string) {
    assertPermission(context, PERMISSIONS.ACCOUNTING_MANAGE);
    const tenantId = assertTenantScope(context);
    return this.prisma.$transaction(async (tx) => {
      await setRlsContext(tx, context);
      const account = await tx.accountingAccount.findFirst({ where: { id: accountId, tenantId } });
      if (!account) throw new Error('Account not found');
      const postedLines = await tx.journalLine.count({ where: { accountId: account.id, entry: { tenantId } } });
      if (postedLines > 0) {
        return tx.accountingAccount.update({ where: { id: account.id }, data: { active: false, allowPosting: false } });
      }
      return tx.accountingAccount.update({ where: { id: account.id }, data: { active: false, allowPosting: false } });
    });
  }

  async accounts(context: AuthContext, type?: AccountType) {
    const tenantId = assertTenantScope(context);
    return withRlsContext(this.prisma, context, (tx) => tx.accountingAccount.findMany({
      where: { tenantId, ...(type ? { type } : {}) },
      include: { parent: { select: { id: true, code: true, name: true, nameAr: true } }, _count: { select: { children: true, journalLines: true } } },
      orderBy: { code: 'asc' },
    }));
  }

  async post(
    tx: Db,
    context: AuthContext,
    input: {
      sourceType: string;
      sourceId: string;
      description: string;
      branchId?: string | null;
      reversalOfId?: string | null;
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

    const entryDate = new Date();
    const fiscalPeriod = await tx.fiscalPeriod.findFirst({
      where: {
        tenantId,
        status: 'OPEN',
        periodStart: { lte: entryDate },
        periodEnd: { gte: entryDate },
      },
      orderBy: { periodStart: 'desc' },
    });
    if (!fiscalPeriod) {
      throw new Error('No open fiscal period covers the journal entry date');
    }

    const existing = await tx.journalEntry.findUnique({
      where: { tenantId_sourceType_sourceId: { tenantId, sourceType: input.sourceType, sourceId: input.sourceId } },
      include: { lines: { include: { account: true } } },
    });
    if (existing) {
      const existingDebit = money(existing.lines.reduce((sum, line) => sum + Number(line.debit), 0));
      const existingCredit = money(existing.lines.reduce((sum, line) => sum + Number(line.credit), 0));
      const incomingLines = input.lines.map((line) => ({
        code: line.code.trim(),
        branchId: line.branchId ?? input.branchId ?? null,
        debit: money(line.debit ?? 0),
        credit: money(line.credit ?? 0),
      })).sort((a, b) => (a.code + '|' + (a.branchId ?? '')).localeCompare(b.code + '|' + (b.branchId ?? '')));
      if (existingDebit !== totalDebit || existingCredit !== totalCredit || existing.description !== input.description || existing.branchId !== (input.branchId ?? null) || existing.lines.length !== incomingLines.length) {
        throw new Error('Accounting source collision: an entry already exists with different journal data');
      }
      const incomingAccounts = new Map<string, { debit: number; credit: number; branchId: string | null }>();
      for (const line of input.lines) {
        const account = await this.ensureAccount(tx, tenantId, line.code, line.type);
        incomingAccounts.set(line.code, { debit: money(line.debit ?? 0), credit: money(line.credit ?? 0), branchId: line.branchId ?? input.branchId ?? null });
        if (!existing.lines.some((existingLine) => existingLine.accountId === account.id)) {
          throw new Error('Accounting source collision: an entry already exists with different journal accounts');
        }
      }
      const sameLines = existing.lines.every((line) => {
        const incoming = incomingAccounts.get(line.account.code);
        return incoming !== undefined && incoming.debit === money(Number(line.debit)) && incoming.credit === money(Number(line.credit)) && incoming.branchId === (line.branchId ?? null);
      });
      if (!sameLines) throw new Error('Accounting source collision: an entry already exists with different journal lines');
      return existing;
    }

    const accounts = new Map<string, { id: string }>();
    for (const line of input.lines) {
      const account = await this.ensureAccount(tx, tenantId, line.code, line.type);
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
        entryDate,
        fiscalPeriodId: fiscalPeriod.id,
        postedById: context.userId,
        reversalOfId: input.reversalOfId ?? null,
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
        ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
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

  async postInventoryConsumption(
    tx: Db,
    context: AuthContext,
    input: { orderId: string; branchId: string; amount: number },
  ) {
    const amount = positiveMoney(input.amount, 'COGS amount');
    assertBranchAccess(context, input.branchId);
    if (amount <= 0) return null;
    return this.post(tx, context, {
      sourceType: 'ORDER_COGS',
      sourceId: input.orderId,
      description: `COGS for order ${input.orderId}`,
      branchId: input.branchId,
      lines: [
        { code: '5100', name: 'Cost of Goods Sold', nameAr: 'تكلفة البضاعة المباعة', type: 'EXPENSE', debit: amount, branchId: input.branchId },
        { code: '1200', name: 'Inventory', nameAr: 'المخزون', type: 'ASSET', credit: amount, branchId: input.branchId },
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
    let allocatedTotal = 0;
    for (const allocation of input.allocations) {
      const amount = positiveMoney(allocation.amount, 'Payroll allocation');
      if (amount === 0) continue;
      allocatedTotal = money(allocatedTotal + amount);
      if (allocation.branchId) assertBranchAccess(context, allocation.branchId);
      lines.push({ code: '6100', name: 'Payroll Expense', nameAr: 'مصروف الرواتب', type: 'EXPENSE', debit: amount, branchId: allocation.branchId });
    }
    if (Math.abs(allocatedTotal - total) > 0.005) {
      throw new Error('Payroll allocations must equal payroll total');
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

  async createFiscalPeriod(
    context: AuthContext,
    input: { name: string; periodStart: string; periodEnd: string },
  ) {
    assertPermission(context, PERMISSIONS.ACCOUNTING_MANAGE);
    const tenantId = assertTenantScope(context);
    const start = new Date(input.periodStart);
    const end = new Date(input.periodEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      throw new Error('Fiscal period dates are invalid');
    }

    return this.prisma.$transaction(async (tx) => {
      await setRlsContext(tx, context);
      const overlap = await tx.fiscalPeriod.findFirst({
        where: {
          tenantId,
          periodStart: { lt: end },
          periodEnd: { gt: start },
        },
        select: { id: true, name: true },
      });
      if (overlap) throw new Error(`Fiscal period overlaps existing period: ${overlap.name}`);

      return tx.fiscalPeriod.create({
        data: {
          id: randomUUID(),
          tenantId,
          name: input.name.trim(),
          periodStart: start,
          periodEnd: end,
          status: 'OPEN',
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async fiscalPeriods(context: AuthContext) {
    const tenantId = assertTenantScope(context);
    return withRlsContext(this.prisma, context, (tx) => tx.fiscalPeriod.findMany({
      where: { tenantId },
      include: { closedBy: { select: { id: true, username: true, displayName: true } } },
      orderBy: { periodStart: 'desc' },
    }));
  }

  async closeFiscalPeriod(context: AuthContext, periodId: string) {
    assertPermission(context, PERMISSIONS.ACCOUNTING_MANAGE);
    const tenantId = assertTenantScope(context);

    return this.prisma.$transaction(async (tx) => {
      await setRlsContext(tx, context);
      const period = await tx.fiscalPeriod.findFirst({
        where: { id: periodId, tenantId },
      });
      if (!period) throw new Error('Fiscal period not found');
      if (period.status !== 'OPEN') throw new Error('Fiscal period is already closed');

      return tx.fiscalPeriod.update({
        where: { id: period.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: context.userId,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reverseJournal(context: AuthContext, journalEntryId: string, reason: string) {
    assertPermission(context, PERMISSIONS.ACCOUNTING_MANAGE);
    const tenantId = assertTenantScope(context);

    return this.prisma.$transaction(async (tx) => {
      await setRlsContext(tx, context);

      const original = await tx.journalEntry.findFirst({
        where: { id: journalEntryId, tenantId },
        include: { lines: { include: { account: true } }, reversalOf: true, reversalEntry: true },
      });
      if (!original) throw new Error('Journal entry not found');
      if (original.reversalOfId) throw new Error('A reversal entry cannot be reversed');
      if (original.status !== 'POSTED') throw new Error('Only posted journal entries can be reversed');
      if (original.reversalEntry) throw new Error('Journal entry has already been reversed');
      if (original.branchId) assertBranchAccess(context, original.branchId);

      const description = reason.trim()
        ? `Reversal of ${original.entryNumber}: ${reason.trim()}`
        : `Reversal of ${original.entryNumber}`;

      const reversal = await this.post(tx, context, {
        sourceType: 'JOURNAL_REVERSAL',
        sourceId: original.id,
        description,
        branchId: original.branchId,
        reversalOfId: original.id,
        lines: original.lines.map((line) => ({
          code: line.account.code,
          name: line.account.name,
          ...(line.account.nameAr ? { nameAr: line.account.nameAr } : {}),
          type: line.account.type,
          debit: Number(line.credit),
          credit: Number(line.debit),
          branchId: line.branchId,
          memo: `Reversal of ${original.entryNumber}`,
        })),
      });

      return tx.journalEntry.findUniqueOrThrow({
        where: { id: reversal.id },
        include: { lines: { include: { account: true } }, fiscalPeriod: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async journal(context: AuthContext, branchId?: string) {
    const tenantId = assertTenantScope(context);
    if (branchId) assertBranchAccess(context, branchId);
    return withRlsContext(this.prisma, context, (tx) => tx.journalEntry.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}) },
      include: { lines: { include: { account: true } }, fiscalPeriod: true, reversalOf: true, reversalEntry: true },
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

  async generalLedger(
    context: AuthContext,
    input: { branchId?: string; from?: string; to?: string; accountCode?: string },
  ) {
    const tenantId = assertTenantScope(context);
    if (input.branchId) assertBranchAccess(context, input.branchId);
    const from = input.from ? new Date(input.from) : new Date('1970-01-01T00:00:00.000Z');
    const to = input.to ? new Date(input.to) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) throw new Error('Report date range is invalid');

    return withRlsContext(this.prisma, context, async (tx) => {
      const scope = {
        entry: { tenantId, status: 'POSTED' as const, ...(input.branchId ? { branchId: input.branchId } : {}) },
        ...(input.accountCode ? { account: { is: { code: input.accountCode, tenantId } } } : {}),
      };
      const [openingLines, lines] = await Promise.all([
        from.getTime() > new Date('1970-01-01T00:00:00.000Z').getTime()
          ? tx.journalLine.findMany({
              where: { ...scope, entry: { ...scope.entry, entryDate: { lt: from } } },
              select: { accountId: true, debit: true, credit: true },
            })
          : Promise.resolve([]),
        tx.journalLine.findMany({
          where: { ...scope, entry: { ...scope.entry, entryDate: { gte: from, lte: to } } },
          include: {
            account: { select: { id: true, code: true, name: true, nameAr: true, type: true } },
            entry: { select: { id: true, entryNumber: true, entryDate: true, description: true, sourceType: true, sourceId: true, branchId: true, reversalOfId: true } },
          },
          orderBy: [{ entry: { entryDate: 'asc' } }, { entry: { entryNumber: 'asc' } }],
        }),
      ]);
      const running = new Map<string, number>();
      for (const line of openingLines) {
        running.set(line.accountId, money((running.get(line.accountId) ?? 0) + Number(line.debit) - Number(line.credit)));
      }
      const openingBalances = new Map(running);
      return lines.map((line) => {
        const balance = money((running.get(line.accountId) ?? 0) + Number(line.debit) - Number(line.credit));
        running.set(line.accountId, balance);
        return {
          entryId: line.entry.id, entryNumber: line.entry.entryNumber, entryDate: line.entry.entryDate,
          description: line.entry.description, sourceType: line.entry.sourceType, sourceId: line.entry.sourceId,
          branchId: line.branchId ?? line.entry.branchId, reversalOfId: line.entry.reversalOfId,
          account: line.account, debit: money(Number(line.debit)), credit: money(Number(line.credit)),
          balance, openingBalance: money(openingBalances.get(line.accountId) ?? 0), memo: line.memo,
        };
      });
    });
  }

  async profitAndLoss(context: AuthContext, input: { branchId?: string; from?: string; to?: string }) {
    const tenantId = assertTenantScope(context);
    if (input.branchId) assertBranchAccess(context, input.branchId);
    const from = input.from ? new Date(input.from) : new Date('1970-01-01T00:00:00.000Z');
    const to = input.to ? new Date(input.to) : new Date();
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) throw new Error('Report date range is invalid');

    return withRlsContext(this.prisma, context, async (tx) => {
      const lines = await tx.journalLine.findMany({
        where: { entry: { tenantId, status: 'POSTED', entryDate: { gte: from, lte: to }, ...(input.branchId ? { branchId: input.branchId } : {}) } },
        include: { account: { select: { id: true, code: true, name: true, nameAr: true, type: true } } },
      });
      const grouped = new Map<string, { account: typeof lines[number]['account']; debit: number; credit: number }>();
      for (const line of lines) {
        if (line.account.type !== 'REVENUE' && line.account.type !== 'EXPENSE') continue;
        const current = grouped.get(line.accountId) ?? { account: line.account, debit: 0, credit: 0 };
        current.debit = money(current.debit + Number(line.debit)); current.credit = money(current.credit + Number(line.credit));
        grouped.set(line.accountId, current);
      }
      const accounts = Array.from(grouped.values()).map((row) => ({
        ...row.account, debit: money(row.debit), credit: money(row.credit),
        amount: row.account.type === 'REVENUE' ? money(row.credit - row.debit) : money(row.debit - row.credit),
      })).sort((a, b) => a.code.localeCompare(b.code));
      const revenue = money(accounts.filter((a) => a.type === 'REVENUE').reduce((sum, a) => sum + a.amount, 0));
      const expenses = money(accounts.filter((a) => a.type === 'EXPENSE').reduce((sum, a) => sum + a.amount, 0));
      return { from, to, branchId: input.branchId ?? null, revenue, expenses, netIncome: money(revenue - expenses), accounts };
    });
  }

  async balanceSheet(context: AuthContext, input: { branchId?: string; asOf?: string }) {
    const tenantId = assertTenantScope(context);
    if (input.branchId) assertBranchAccess(context, input.branchId);
    const asOf = input.asOf ? new Date(input.asOf) : new Date();
    if (!Number.isFinite(asOf.getTime())) throw new Error('Balance sheet date is invalid');

    return withRlsContext(this.prisma, context, async (tx) => {
      const lines = await tx.journalLine.findMany({
        where: { entry: { tenantId, status: 'POSTED', entryDate: { lte: asOf }, ...(input.branchId ? { branchId: input.branchId } : {}) } },
        include: { account: { select: { id: true, code: true, name: true, nameAr: true, type: true } } },
      });
      const grouped = new Map<string, { account: typeof lines[number]['account']; debit: number; credit: number }>();
      for (const line of lines) {
        if (!['ASSET', 'LIABILITY', 'EQUITY'].includes(line.account.type)) continue;
        const current = grouped.get(line.accountId) ?? { account: line.account, debit: 0, credit: 0 };
        current.debit = money(current.debit + Number(line.debit)); current.credit = money(current.credit + Number(line.credit));
        grouped.set(line.accountId, current);
      }
      const accounts = Array.from(grouped.values()).map((row) => ({
        ...row.account, debit: money(row.debit), credit: money(row.credit),
        balance: row.account.type === 'ASSET' ? money(row.debit - row.credit) : money(row.credit - row.debit),
      })).sort((a, b) => a.code.localeCompare(b.code));
      const assets = money(accounts.filter((a) => a.type === 'ASSET').reduce((sum, a) => sum + a.balance, 0));
      const liabilities = money(accounts.filter((a) => a.type === 'LIABILITY').reduce((sum, a) => sum + a.balance, 0));
      const equity = money(accounts.filter((a) => a.type === 'EQUITY').reduce((sum, a) => sum + a.balance, 0));

      // Revenue/expense accounts are temporary in presentation, but until a
      // formal year-end closing process is implemented, their cumulative net
      // income must be represented in equity to keep the balance sheet complete.
      const earningsLines = await tx.journalLine.findMany({
        where: {
          entry: { tenantId, status: 'POSTED', entryDate: { lte: asOf }, ...(input.branchId ? { branchId: input.branchId } : {}) },
        },
        include: { account: { select: { type: true } } },
      });
      let cumulativeRevenue = 0;
      let cumulativeExpenses = 0;
      for (const line of earningsLines) {
        if (line.account.type === 'REVENUE') cumulativeRevenue += Number(line.credit) - Number(line.debit);
        if (line.account.type === 'EXPENSE') cumulativeExpenses += Number(line.debit) - Number(line.credit);
      }
      const netIncome = money(cumulativeRevenue - cumulativeExpenses);
      const liabilitiesAndEquity = money(liabilities + equity + netIncome);
      return {
        asOf,
        branchId: input.branchId ?? null,
        assets,
        liabilities,
        equity,
        netIncome,
        liabilitiesAndEquity,
        difference: money(assets - liabilitiesAndEquity),
        accounts,
      };
    });
  }

  async cashBankMovement(context: AuthContext, input: { branchId?: string; from?: string; to?: string }) {
    const ledger = await this.generalLedger(context, {
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
      accountCode: '1000',
    });
    const bank = await this.generalLedger(context, {
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
      accountCode: '1030',
    });
    const summarize = (lines: Awaited<ReturnType<AccountingService['generalLedger']>>) => ({
      openingBalance: lines[0]?.openingBalance ?? 0,
      totalDebit: money(lines.reduce((sum, line) => sum + line.debit, 0)),
      totalCredit: money(lines.reduce((sum, line) => sum + line.credit, 0)),
      closingBalance: lines.length ? lines[lines.length - 1]!.balance : (lines[0]?.openingBalance ?? 0),
      lines,
    });
    return { cash: summarize(ledger), bank: summarize(bank) };
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
