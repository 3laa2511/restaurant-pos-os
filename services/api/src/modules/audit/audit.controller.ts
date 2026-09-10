import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { AuditService, type AuditRiskLevel } from './audit.service.js';

const RISK_LEVELS: readonly AuditRiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
function parseLimit(value: string | undefined): number | undefined { if (value === undefined) return undefined; const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new Error('limit must be a positive integer'); return parsed; }
function parseRiskLevel(value: string): AuditRiskLevel { if (!RISK_LEVELS.includes(value as AuditRiskLevel)) throw new Error('riskLevel must be LOW, MEDIUM, HIGH, or CRITICAL'); return value as AuditRiskLevel; }
function parseDateQuery(value: string | undefined, field: string): Date | undefined { if (value === undefined) return undefined; const date = new Date(value); if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date`); return date; }

@Controller('audit')
@UseGuards(AuthGuard, PermissionGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get('events')
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  events(@CurrentAuth() context: AuthContext, @Query('branchId') branchId?: string, @Query('action') action?: string, @Query('entityType') entityType?: string, @Query('actorUserId') actorUserId?: string, @Query('deviceId') deviceId?: string, @Query('riskLevel') riskLevel?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.audit.list(context, {
      ...(branchId !== undefined ? { branchId } : {}), ...(action !== undefined ? { action } : {}), ...(entityType !== undefined ? { entityType } : {}), ...(actorUserId !== undefined ? { actorUserId } : {}), ...(deviceId !== undefined ? { deviceId } : {}), ...(riskLevel !== undefined ? { riskLevel: parseRiskLevel(riskLevel) } : {}), ...(from !== undefined ? { from: parseDateQuery(from, 'from') } : {}), ...(to !== undefined ? { to: parseDateQuery(to, 'to') } : {}), ...(limit !== undefined ? { limit: parseLimit(limit) } : {}), ...(cursor !== undefined ? { cursor } : {}),
    });
  }
}
