import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { AuditService, type AuditRiskLevel } from './audit.service.js';

@Controller('audit')
@UseGuards(AuthGuard, PermissionGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('events')
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  events(
    @CurrentAuth() context: AuthContext,
    @Query('branchId') branchId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('deviceId') deviceId?: string,
    @Query('riskLevel') riskLevel?: AuditRiskLevel,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.audit.list(context, {
      ...(branchId !== undefined ? { branchId } : {}),
      ...(action !== undefined ? { action } : {}),
      ...(entityType !== undefined ? { entityType } : {}),
      ...(actorUserId !== undefined ? { actorUserId } : {}),
      ...(deviceId !== undefined ? { deviceId } : {}),
      ...(riskLevel !== undefined ? { riskLevel } : {}),
      ...(from !== undefined ? { from: new Date(from) } : {}),
      ...(to !== undefined ? { to: new Date(to) } : {}),
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
  }
}
