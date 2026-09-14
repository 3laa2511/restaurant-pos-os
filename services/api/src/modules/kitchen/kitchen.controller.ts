import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import type { KitchenTicketStatus } from './kitchen-ticket.policy.js';
import { KitchenService } from './kitchen.service.js';

const KITCHEN_STATUSES: readonly KitchenTicketStatus[] = [
  'SENT_TO_KITCHEN',
  'PREPARING',
  'READY',
  'COMPLETED',
  'CANCELLED',
];

function parseTarget(value: string): KitchenTicketStatus {
  if (!KITCHEN_STATUSES.includes(value as KitchenTicketStatus)) {
    throw new Error('target must be SENT_TO_KITCHEN, PREPARING, READY, COMPLETED, or CANCELLED');
  }
  return value as KitchenTicketStatus;
}

function parseExpectedVersion(value?: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1) throw new Error('expectedVersion must be a positive integer');
  return value;
}

@Controller('kitchen')
@UseGuards(AuthGuard, PermissionGuard)
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get('tickets')
  @RequirePermission(PERMISSIONS.ORDER_VIEW)
  tickets(@CurrentAuth() context: AuthContext, @Query('branchId') branchId?: string) {
    return this.kitchen.listTickets(context, branchId);
  }

  @Post('orders/:orderId/tickets/materialize')
  @RequirePermission(PERMISSIONS.KITCHEN_TICKET_MANAGE)
  materialize(@CurrentAuth() context: AuthContext, @Param('orderId') orderId: string) {
    return this.kitchen.materializeTickets(context, orderId);
  }

  @Patch('ticket/:ticketId/status')
  @RequirePermission(PERMISSIONS.KITCHEN_TICKET_MANAGE)
  transitionTicket(
    @CurrentAuth() context: AuthContext,
    @Param('ticketId') ticketId: string,
    @Body() body: { target?: string; reason?: string; expectedVersion?: number },
  ) {
    if (!body.target) throw new Error('target is required');
    return this.kitchen.transitionTicket(
      context,
      ticketId,
      parseTarget(body.target),
      body.reason,
      parseExpectedVersion(body.expectedVersion),
    );
  }

  /**
   * Compatibility endpoint: preserves the existing order-level kitchen lifecycle.
   * New KDS clients should use /kitchen/ticket/:ticketId/status.
   */
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
