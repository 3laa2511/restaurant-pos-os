import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import type { SyncEnvelope, SyncResult } from '../sync/sync-contract.js';
import type { KitchenTicketStatus } from './kitchen-ticket.policy.js';
import { KitchenService } from './kitchen.service.js';
import { OptionalBranchQueryDto, OrderIdParamDto, TicketIdParamDto } from '../security/request.dto.js';
import { KitchenTicketStatusDto } from './kitchen.dto.js';
import { KitchenSyncService } from './kitchen-sync.service.js';

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
  constructor(
    private readonly kitchen: KitchenService,
    private readonly kitchenSync: KitchenSyncService,
  ) {}

  @Get('tickets')
  @RequirePermission(PERMISSIONS.ORDER_VIEW)
  tickets(@CurrentAuth() context: AuthContext, @Query() query: OptionalBranchQueryDto) {
    return this.kitchen.listTickets(context, query.branchId);
  }

  @Post('orders/:orderId/tickets/materialize')
  @RequirePermission(PERMISSIONS.KITCHEN_TICKET_MANAGE)
  materialize(@CurrentAuth() context: AuthContext, @Param() params: OrderIdParamDto) {
    return this.kitchen.materializeTickets(context, params.id);
  }

  @Patch('ticket/:ticketId/status')
  @RequirePermission(PERMISSIONS.KITCHEN_TICKET_MANAGE)
  transitionTicket(
    @CurrentAuth() context: AuthContext,
    @Param() params: TicketIdParamDto,
    @Body() body: KitchenTicketStatusDto,
  ) {
    return this.kitchen.transitionTicket(context, params.id, body.target, body.reason, body.expectedVersion);
  }

  @Post('tickets/sync')
  @RequirePermission(PERMISSIONS.KITCHEN_TICKET_MANAGE)
  syncTicket(@CurrentAuth() context: AuthContext, @Body() envelope: SyncEnvelope): Promise<SyncResult> {
    return this.kitchenSync.submit(context, envelope);
  }

  /**
   * Compatibility endpoint: preserves the existing order-level kitchen lifecycle.
   * New KDS clients should use /kitchen/ticket/:ticketId/status.
   */
  @Patch('tickets/:orderId/status')
  @RequirePermission(PERMISSIONS.KITCHEN_TICKET_MANAGE)
  transition(
    @CurrentAuth() context: AuthContext,
    @Param() params: OrderIdParamDto,
    @Body() body: KitchenTicketStatusDto,
  ) {
    return this.kitchen.transition(context, params.id, body.target, body.reason);
  }
}
