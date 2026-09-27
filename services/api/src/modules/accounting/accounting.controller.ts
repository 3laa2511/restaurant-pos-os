import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { AccountingService } from './accounting.service.js';
import { ManualJournalDto } from './accounting.dto.js';

@Controller('accounting')
@UseGuards(AuthGuard, PermissionGuard)
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Post('journal')
  @Throttle({ default: { limit: 30, ttl: 60_000, blockDuration: 120_000 } })
  @RequirePermission(PERMISSIONS.ACCOUNTING_POST)
  postJournal(@CurrentAuth() context: AuthContext, @Body() input: ManualJournalDto) {
    return this.accounting.postManual(context, input);
  }

  @Get('journal')
  @RequirePermission(PERMISSIONS.ACCOUNTING_VIEW)
  journal(@CurrentAuth() context: AuthContext, @Query('branchId') branchId?: string) {
    return this.accounting.journal(context, branchId);
  }

  @Get('trial-balance')
  @RequirePermission(PERMISSIONS.ACCOUNTING_VIEW)
  trialBalance(@CurrentAuth() context: AuthContext, @Query('branchId') branchId?: string) {
    return this.accounting.trialBalance(context, branchId);
  }
}
