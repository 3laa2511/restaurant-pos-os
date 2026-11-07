import { Body, Controller, Get, UseGuards, Post } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { SyncEnvelopeDto } from './sync.dto.js';
import type { SyncEnvelope } from './sync-contract.js';
import { SyncService } from './sync.service.js';

@UseGuards(AuthGuard, PermissionGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('operations')
  @RequirePermission(PERMISSIONS.ORDER_CREATE)
  submit(@CurrentAuth() context: AuthContext, @Body() envelope: SyncEnvelopeDto) {
    return this.sync.submit(context, envelope as unknown as SyncEnvelope);
  }

  @Get('pending')
  @RequirePermission(PERMISSIONS.ORDER_VIEW)
  pending(@CurrentAuth() context: AuthContext) {
    return this.sync.pending(context);
  }
}
