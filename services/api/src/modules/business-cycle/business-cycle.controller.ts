import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { BusinessCycleService } from './business-cycle.service.js';

@Controller('business-cycles')
@UseGuards(AuthGuard, PermissionGuard)
export class BusinessCycleController {
  constructor(private readonly cycles: BusinessCycleService) {}
  @Get('current')
  @RequirePermission(PERMISSIONS.BUSINESS_CYCLE_VIEW)
  current(@CurrentAuth() context: AuthContext, @Query('branchId') branchId: string) {
    if (!branchId) throw new Error('branchId is required');
    return this.cycles.current(context, branchId);
  }
  @Post('open')
  @RequirePermission(PERMISSIONS.BUSINESS_CYCLE_MANAGE)
  open(@CurrentAuth() context: AuthContext, @Body() body: { branchId: string; name: string }) { return this.cycles.open(context, body); }
  @Post('close')
  @RequirePermission(PERMISSIONS.BUSINESS_CYCLE_MANAGE)
  close(@CurrentAuth() context: AuthContext, @Body() body: { branchId: string }) { return this.cycles.close(context, body); }
}
