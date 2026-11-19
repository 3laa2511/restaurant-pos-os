import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { DiningService } from './dining.service.js';
import { AssignDiningOrderDto, ClearDiningTableDto, CreateDiningAreaDto, CreateDiningTableDto, UpdateDiningTableStatusDto } from './dining.dto.js';

@Controller('dining')
@UseGuards(AuthGuard, PermissionGuard)
export class DiningController {
  constructor(private readonly dining: DiningService) {}

  @Get('areas')
  @RequirePermission(PERMISSIONS.DINING_TABLE_VIEW)
  list(@CurrentAuth() context: AuthContext, @Query('branchId') branchId?: string) {
    return this.dining.list(context, branchId);
  }

  @Post('areas')
  @RequirePermission(PERMISSIONS.DINING_TABLE_MANAGE)
  createArea(@CurrentAuth() context: AuthContext, @Body() body: CreateDiningAreaDto) {
    return this.dining.createArea(context, body);
  }

  @Post('areas/:areaId/tables')
  @RequirePermission(PERMISSIONS.DINING_TABLE_MANAGE)
  createTable(
    @CurrentAuth() context: AuthContext,
    @Param('areaId') areaId: string,
    @Body() body: CreateDiningTableDto,
  ) {
    return this.dining.createTable(context, areaId, body);
  }

  @Post('tables/:tableId/orders/:orderId')
  @RequirePermission(PERMISSIONS.DINING_TABLE_VIEW)
  assignOrder(
    @CurrentAuth() context: AuthContext,
    @Param('tableId') tableId: string,
    @Param('orderId') orderId: string,
    @Body() body: AssignDiningOrderDto,
  ) {
    return this.dining.assignOrder(context, tableId, orderId, body.expectedVersion);
  }

  @Post('tables/:tableId/clear')
  @RequirePermission(PERMISSIONS.DINING_TABLE_MANAGE)
  clearTable(
    @CurrentAuth() context: AuthContext,
    @Param('tableId') tableId: string,
    @Body() body: ClearDiningTableDto,
  ) {
    return this.dining.clearTable(context, tableId, body.reason, body.expectedVersion);
  }

  @Patch('tables/:tableId/status')
  @RequirePermission(PERMISSIONS.DINING_TABLE_MANAGE)
  updateStatus(
    @CurrentAuth() context: AuthContext,
    @Param('tableId') tableId: string,
    @Body() body: UpdateDiningTableStatusDto,
  ) {
    return this.dining.updateStatus(context, tableId, body.status, body.expectedVersion);
  }
}
