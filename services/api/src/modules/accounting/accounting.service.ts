import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertPermission, assertTenantScope, type AuthContext } from '../auth/authorization.types.js';
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
    if (input.branchId) assertBranchAccess(context, input.branchId);
    for (const line of input.lines) {
      if (!line.code.trim() || !line.name.trim()) throw new Error('Journal line account code and name are required');
      const debit = line.debit ?? 0;
      const credit = line.credit ?? 0;
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
        throw new Error('Journal debit and credit must be non-negative finite numbers');
      }
      if (debit > 0 && credit > 0) throw new Error('A journal line cannot contain both debit and credit');
      if (Math.abs(debit - money(debit)) > 1e-9 || Math.abs(credit - money(credit)) > 1e-9) {
        throw new Error('Journal amounts must have at most 2 decimal places');
      }
      if (line.branchId) assertBranchAccess(context, line.branchId);
    }
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