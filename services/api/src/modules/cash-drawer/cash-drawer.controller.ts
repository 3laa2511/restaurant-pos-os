import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { CashDrawerService, type CreateCashDrawerInput, type RecordCashMovementInput } from './cash-drawer.service.js';
import { CreateCashDrawerDto, RecordCashMovementDto } from './cash-drawer.dto.js';

@Controller('cash-drawers')
@UseGuards(AuthGuard, PermissionGuard)
export class CashDrawerController {
  constructor(private readonly cashDrawers: CashDrawerService) {}

  @Post()
  @RequirePermission(PERMISSIONS.CASH_DRAWER_MANAGE)
  create(@CurrentAuth() context: AuthContext, @Body() body: CreateCashDrawerDto) {
    return this.cashDrawers.create(context, body as CreateCashDrawerInput);
  }

  @Get(':drawerId/balance')
  @RequirePermission(PERMISSIONS.CASH_DRAWER_VIEW)
  balance(@CurrentAuth() context: AuthContext, @Param('drawerId') drawerId: string, @Query('shiftId') shiftId: string, @Query('deviceId') deviceId: string) {
    return this.cashDrawers.getBalance(context, drawerId, shiftId, deviceId);
  }

  @Post('movements')
  @RequirePermission(PERMISSIONS.CASH_DRAWER_MANAGE)
  movement(@CurrentAuth() context: AuthContext, @Body() body: RecordCashMovementDto) {
    return this.cashDrawers.recordMovement(context, body as RecordCashMovementInput);
  }
}
