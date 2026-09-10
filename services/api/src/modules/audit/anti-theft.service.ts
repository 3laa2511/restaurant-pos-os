import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { assertBranchAccess, assertPermission, type AuthContext } from '../auth/authorization.types.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { AuditService, type AuditRiskLevel } from './audit.service.js';

export interface AntiTheftScanOptions { branchId?: string; windowMinutes?: number; minimumScore?: number; }

interface EventMetadata { riskScore?: unknown; riskLevel?: unknown; amount?: unknown; variance?: unknown; deviceId?: unknown; }

export interface AntiTheftAlert {
  key: string;
  branchId: string | null;
  actorUserId: string | null;
  deviceId: string | null;
  score: number;
  level: AuditRiskLevel;
  eventCount: number;
  suspiciousEventCount: number;
  totalAmount: number;
  varianceTotal: number;
  reasons: string[];
  windowStart: string;
  windowEnd: string;
}

function level(score: number): AuditRiskLevel { if (score >= 90) return 'CRITICAL'; if (score >= 70) return 'HIGH'; if (score >= 40) return 'MEDIUM'; return 'LOW'; }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function money(value: unknown): number { const n = typeof value === 'number' ? value : Number(value); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; }
function eventWeight(action: string): number { const a = action.toUpperCase(); if (a.includes('REFUND') || a.includes('VOID')) return 3; if (a.includes('CANCEL')) return 2; if (a.includes('DISCOUNT')) return 2; if (a.includes('PAY_OUT') || a.includes('ADJUSTMENT')) return 3; return 0; }

@Injectable()
export class AntiTheftService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async scan(context: AuthContext, options: AntiTheftScanOptions = {}): Promise<{ generatedAt: string; windowMinutes: number; alerts: AntiTheftAlert[] }> {
    assertPermission(context, PERMISSIONS.AUDIT_VIEW);
    const branchId = text(options.branchId ?? context.branchId);
    if (branchId) assertBranchAccess(context, branchId);
    const windowMinutes = options.windowMinutes ?? 60;
    if (!Number.isInteger(windowMinutes) || windowMinutes < 5 || windowMinutes > 1440) throw new Error('windowMinutes must be an integer between 5 and 1440');
    const minimumScore = options.minimumScore ?? 40;
    if (!Number.isInteger(minimumScore) || minimumScore < 1 || minimumScore > 100) throw new Error('minimumScore must be an integer between 1 and 100');

    const end = new Date();
    const start = new Date(end.getTime() - windowMinutes * 60_000);
    const where: Prisma.AuditLogWhereInput = { createdAt: { gte: start, lt: end } };
    if (branchId) where.branchId = branchId;
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' }, take: 5000, select: { id: true, actorUserId: true, branchId: true, action: true, metadata: true, createdAt: true } });

    const groups = new Map<string, { branchId: string | null; actorUserId: string | null; deviceId: string | null; events: typeof rows; }>();
    for (const row of rows) {
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as EventMetadata : {};
      const deviceId = text(metadata.deviceId);
      const key = `${row.branchId ?? 'global'}:${row.actorUserId ?? 'system'}:${deviceId ?? 'unknown'}`;
      const group = groups.get(key) ?? { branchId: row.branchId, actorUserId: row.actorUserId, deviceId, events: [] };
      group.events.push(row); groups.set(key, group);
    }

    const alerts: AntiTheftAlert[] = [];
    for (const [key, group] of groups) {
      let score = 0; let suspicious = 0; let totalAmount = 0; let varianceTotal = 0; const reasons = new Set<string>();
      for (const row of group.events) {
        const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as EventMetadata : {};
        const weight = eventWeight(row.action);
        const eventRisk = typeof metadata.riskScore === 'number' ? metadata.riskScore : 0;
        if (weight > 0 || eventRisk >= 70) suspicious++;
        score += weight * 10 + (eventRisk >= 90 ? 20 : eventRisk >= 70 ? 10 : 0);
        totalAmount += money(metadata.amount);
        varianceTotal += money(metadata.variance);
        const action = row.action.toUpperCase();
        if (action.includes('REFUND')) reasons.add('Repeated refunds');
        if (action.includes('VOID')) reasons.add('Repeated voids');
        if (action.includes('CANCEL')) reasons.add('Repeated cancellations');
        if (action.includes('DISCOUNT')) reasons.add('Repeated discounts');
        if (Math.abs(money(metadata.variance)) > 0) reasons.add('Cash variance activity');
      }
      if (group.events.length >= 20) { score += 15; reasons.add('High audit-event frequency'); }
      if (suspicious >= 5) { score += 15; reasons.add('High suspicious-event frequency'); }
      if (totalAmount >= 10000) { score += 15; reasons.add('High-value suspicious activity'); }
      score = Math.min(100, score);
      if (score < minimumScore) continue;
      alerts.push({ key, branchId: group.branchId, actorUserId: group.actorUserId, deviceId: group.deviceId, score, level: level(score), eventCount: group.events.length, suspiciousEventCount: suspicious, totalAmount: Math.round(totalAmount * 100) / 100, varianceTotal: Math.round(varianceTotal * 100) / 100, reasons: [...reasons], windowStart: start.toISOString(), windowEnd: end.toISOString() });
    }
    alerts.sort((a, b) => b.score - a.score);
    return { generatedAt: end.toISOString(), windowMinutes, alerts };
  }

  async acknowledge(context: AuthContext, alertKey: string, reason: string): Promise<{ acknowledged: true }> {
    assertPermission(context, PERMISSIONS.AUDIT_VIEW);
    const cleanReason = text(reason); const key = text(alertKey);
    if (!key) throw new Error('alertKey is required');
    if (!cleanReason) throw new Error('reason is required to acknowledge an anti-theft alert');
    await this.audit.record(context, { action: 'ANTI_THEFT_ALERT_ACKNOWLEDGED', entityType: 'AntiTheftAlert', entityId: key, reason: cleanReason, metadata: { alertKey: key } });
    return { acknowledged: true };
  }
}
