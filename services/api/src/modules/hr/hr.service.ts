import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { hashPassword } from '../auth/auth.service.js';
import { assertBranchAccess, assertTenantScope, type AuthContext } from '../auth/authorization.types.js';
import { RoleCode } from '../../generated/prisma/enums.js';

const required = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
};
const money = (value: unknown, field: string): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a non-negative number`);
  return Math.round((n + Number.EPSILON) * 100) / 100;
};
const day = (value: string): Date => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
  return d;
};

@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService) {}

  async listEmployees(context: AuthContext, branchId?: string) {
    const tenantId = assertTenantScope(context);
    if (branchId) assertBranchAccess(context, branchId);
    return this.prisma.employeeProfile.findMany({
      where: { tenantId, active: true, ...(branchId ? { user: { branchId } } : {}) },
      include: { user: { select: { id: true, username: true, displayName: true, status: true, branchId: true, roleLinks: { include: { role: { select: { code: true, name: true } } } } } } },
      orderBy: { employeeCode: 'asc' },
    });
  }

  async createEmployee(context: AuthContext, input: {
    username: string; password: string; displayName: string; employeeCode: string; jobTitle: string;
    branchId?: string; roleCode?: RoleCode; phone?: string; baseSalary: number; overtimeRate?: number;
  }) {
    const tenantId = assertTenantScope(context);
    const username = required(input.username, 'Username');
    const displayName = required(input.displayName, 'Display name');
    const employeeCode = required(input.employeeCode, 'Employee code');
    const jobTitle = required(input.jobTitle, 'Job title');
    const password = required(input.password, 'Password');
    if (password.length < 8) throw new Error('Password must contain at least 8 characters');
    const baseSalary = money(input.baseSalary, 'Base salary');
    const overtimeRate = money(input.overtimeRate ?? 0, 'Overtime rate');
    const roleCode = input.roleCode ?? RoleCode.CASHIER;

    if (input.branchId) assertBranchAccess(context, input.branchId);
    if (input.branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: input.branchId, tenantId, active: true }, select: { id: true } });
      if (!branch) throw new Error('Branch not found or inactive');
    }

    const passwordHash = await hashPassword(password);
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { code: roleCode }, select: { id: true, code: true } });
      if (!role) throw new Error('Employee role is not seeded');
      const user = await tx.user.create({
        data: { id: randomUUID(), username, displayName, passwordHash, status: 'ACTIVE', branchId: input.branchId ?? null, roleLinks: { create: { roleId: role.id } } },
        select: { id: true, username: true, displayName: true, branchId: true },
      });
      const profile = await tx.employeeProfile.create({
        data: { id: randomUUID(), tenantId, userId: user.id, employeeCode, jobTitle, phone: input.phone?.trim() || null, baseSalary: baseSalary.toFixed(2), overtimeRate: overtimeRate.toFixed(2) },
      });
      return { user, profile };
    });
  }

  async listAttendance(context: AuthContext, filter: { from?: string; to?: string; branchId?: string }) {
    const tenantId = assertTenantScope(context);
    if (filter.branchId) assertBranchAccess(context, filter.branchId);
    return this.prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        ...(filter.branchId ? { branchId: filter.branchId } : {}),
        ...(filter.from || filter.to ? { workDate: { ...(filter.from ? { gte: day(filter.from) } : {}), ...(filter.to ? { lte: day(filter.to) } : {}) } } : {}),
      },
      include: { user: { select: { id: true, username: true, displayName: true } }, branch: { select: { id: true, code: true, name: true } } },
      orderBy: { workDate: 'desc' },
    });
  }

  async checkIn(context: AuthContext, input: { userId: string; branchId: string; at?: string }) {
    const tenantId = assertTenantScope(context);
    assertBranchAccess(context, input.branchId);
    const at = input.at ? day(input.at) : new Date();
    await this.ensureEmployee(context, input.userId, input.branchId);
    const workDate = new Date(at); workDate.setHours(0, 0, 0, 0);
    return this.prisma.attendanceRecord.upsert({
      where: { userId_workDate: { userId: input.userId, workDate } },
      update: { status: 'PRESENT', checkInAt: at },
      create: { id: randomUUID(), tenantId, userId: input.userId, branchId: input.branchId, workDate, status: 'PRESENT', checkInAt: at },
    });
  }

  async checkOut(context: AuthContext, input: { userId: string; branchId: string; at?: string }) {
    assertTenantScope(context); assertBranchAccess(context, input.branchId);
    const at = input.at ? day(input.at) : new Date();
    await this.ensureEmployee(context, input.userId, input.branchId);
    const workDate = new Date(at); workDate.setHours(0, 0, 0, 0);
    const record = await this.prisma.attendanceRecord.findUnique({ where: { userId_workDate: { userId: input.userId, workDate } } });
    if (!record?.checkInAt) throw new Error('Employee has no check-in for this workday');
    const workedMinutes = Math.max(0, Math.round((at.getTime() - record.checkInAt.getTime()) / 60000));
    return this.prisma.attendanceRecord.update({ where: { id: record.id }, data: { checkOutAt: at, workedMinutes } });
  }

  async createPayrollPeriod(context: AuthContext, input: { name: string; periodStart: string; periodEnd: string; bonuses?: Record<string, number>; deductions?: Record<string, number> }) {
    const tenantId = assertTenantScope(context);
    const periodStart = day(input.periodStart), periodEnd = day(input.periodEnd);
    if (periodEnd < periodStart) throw new Error('Payroll period end must be after start');
    const employees = await this.prisma.employeeProfile.findMany({ where: { tenantId, active: true }, select: { userId: true, baseSalary: true, overtimeRate: true } });
    return this.prisma.$transaction(async (tx) => {
      const period = await tx.payrollPeriod.create({ data: { id: randomUUID(), tenantId, name: required(input.name, 'Payroll name'), periodStart, periodEnd } });
      for (const employee of employees) {
        const bonus = money(input.bonuses?.[employee.userId] ?? 0, 'Bonus');
        const deduction = money(input.deductions?.[employee.userId] ?? 0, 'Deduction');
        const attendance = await tx.attendanceRecord.aggregate({ where: { tenantId, userId: employee.userId, workDate: { gte: periodStart, lte: periodEnd } }, _sum: { overtimeMinutes: true } });
        const overtimeMinutes = attendance._sum.overtimeMinutes ?? 0;
        const overtimeAmount = Math.round((overtimeMinutes / 60) * Number(employee.overtimeRate) * 100) / 100;
        const netAmount = Math.round((Number(employee.baseSalary) + overtimeAmount + bonus - deduction) * 100) / 100;
        await tx.payrollEntry.create({ data: { id: randomUUID(), tenantId, periodId: period.id, userId: employee.userId, baseSalary: employee.baseSalary, overtimeAmount, bonuses: bonus, deductions: deduction, netAmount } });
      }
      return tx.payrollPeriod.findUnique({ where: { id: period.id }, include: { entries: true } });
    });
  }

  async getPayrollPeriod(context: AuthContext, id: string) {
    const tenantId = assertTenantScope(context);
    const period = await this.prisma.payrollPeriod.findFirst({ where: { id, tenantId }, include: { entries: { include: { user: { select: { id: true, username: true, displayName: true } } } } } });
    if (!period) throw new Error('Payroll period not found');
    return period;
  }

  private async ensureEmployee(context: AuthContext, userId: string, branchId: string) {
    const tenantId = assertTenantScope(context);
    const employee = await this.prisma.employeeProfile.findFirst({ where: { tenantId, userId, active: true, user: { branchId } }, select: { id: true } });
    if (!employee) throw new Error('Employee not found in the selected branch');
  }
}
