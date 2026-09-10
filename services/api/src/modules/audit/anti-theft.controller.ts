import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { AntiTheftService } from './anti-theft.service.js';

@Controller('audit/anti-theft')
@UseGuards(AuthGuard, PermissionGuard)
export class AntiTheftController {
  constructor(private readonly antiTheft: AntiTheftService) {}

  @Get('scan')
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  scan(@CurrentAuth() context: AuthContext, @Query('branchId') branchId?: string, @Query('windowMinutes') windowMinutes?: string, @Query('minimumScore') minimumScore?: string) {
    return this.antiTheft.scan(context, {
      ...(branchId !== undefined ? { branchId } : {}),
      ...(windowMinutes !== undefined ? { windowMinutes: Number(windowMinutes) } : {}),
      ...(minimumScore !== undefined ? { minimumScore: Number(minimumScore) } : {}),
    });
  }

  @Post('alerts/acknowledge')
  @RequirePermission(PERMISSIONS.AUDIT_VIEW)
  acknowledge(@CurrentAuth() context: AuthContext, @Body() body: { alertKey?: string; reason?: string }) {
    return this.antiTheft.acknowledge(context, body.alertKey ?? '', body.reason ?? '');
  }
}
