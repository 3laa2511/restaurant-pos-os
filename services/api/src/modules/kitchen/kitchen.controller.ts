import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import type { KitchenTicketStatus } from './kitchen-ticket.policy.js';
import { KitchenService } from './kitchen.service.js';

const KITCHEN_STATUSES: readonly KitchenTicketStatus[] = ['QUEUED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];

function parseTarget(value: string): KitchenTicketStatus {
  if (!KITCHEN_STATUSES.includes(value as KitchenTicketStatus)) throw new Error('target must be QUEUED, PREPARING, READY, COMPLETED, or CANCELLED');
  return value as KitchenTicketStatus;
}

@Controller('kitchen')
@UseGuards(AuthGuard, PermissionGuard)
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get('tickets')
  @RequirePermission(PERMISSIONS.ORDER_VIEW)
  tickets(@CurrentAuth() context: AuthContext, @Query('branchId') branchId?: string) {
    return this.kitchen.list(context, branchId);
  }

  @Patch('tickets/:orderId/status')
  @RequirePermission(PERMISSIONS.KITCHEN_TICKET_MANAGE)
  transition(
    @CurrentAuth() context: AuthContext,
    @Param('orderId') orderId: string,
    @Body() body: { target?: string; reason?: string },
  ) {
    if (!body.target) throw new Error('target is required');
    return this.kitchen.transition(context, orderId, parseTarget(body.target), body.reason);
  }
}
