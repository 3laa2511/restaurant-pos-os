import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { OptionalBranchQueryDto } from '../security/request.dto.js';
import { OperationsService } from './operations.service.js';

@Controller('operations')
@UseGuards(AuthGuard, PermissionGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('call-center/orders')
  @RequirePermission(PERMISSIONS.ORDER_VIEW)
  callCenterOrders(@CurrentAuth() context: AuthContext, @Query() query: OptionalBranchQueryDto) {
    return this.operations.callCenterOrders(context, query.branchId);
  }

  @Get('dispatch/orders')
  @RequirePermission(PERMISSIONS.ORDER_VIEW)
  dispatchOrders(@CurrentAuth() context: AuthContext, @Query() query: OptionalBranchQueryDto) {
    return this.operations.dispatchOrders(context, query.branchId);
  }

  @Get('management/overview')
  @RequirePermission(PERMISSIONS.REPORT_VIEW_OPERATIONAL)
  managementOverview(@CurrentAuth() context: AuthContext, @Query() query: OptionalBranchQueryDto) {
    return this.operations.managementOverview(context, query.branchId);
  }
}
