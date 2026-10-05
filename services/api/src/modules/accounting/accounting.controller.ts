import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { AccountingService } from './accounting.service.js';
import { CreateFiscalPeriodDto, ManualJournalDto, ReverseJournalDto } from './accounting.dto.js';
import { OptionalBranchQueryDto } from '../security/request.dto.js';

@Controller('accounting')
@UseGuards(AuthGuard, PermissionGuard)
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('fiscal-periods')
  @RequirePermission(PERMISSIONS.ACCOUNTING_VIEW)
  fiscalPeriods(@CurrentAuth() context: AuthContext) {
    return this.accounting.fiscalPeriods(context);
  }

  @Post('fiscal-periods')
  @Throttle({ default: { limit: 10, ttl: 60_000, blockDuration: 120_000 } })
  @RequirePermission(PERMISSIONS.ACCOUNTING_MANAGE)
  createFiscalPeriod(@CurrentAuth() context: AuthContext, @Body() input: CreateFiscalPeriodDto) {
    return this.accounting.createFiscalPeriod(context, input);
  }

  @Post('fiscal-periods/:id/close')
  @Throttle({ default: { limit: 10, ttl: 60_000, blockDuration: 120_000 } })
  @RequirePermission(PERMISSIONS.ACCOUNTING_MANAGE)
  closeFiscalPeriod(@CurrentAuth() context: AuthContext, @Param('id') id: string) {
    return this.accounting.closeFiscalPeriod(context, id);
  }

  @Post('journal/:id/reverse')
  @Throttle({ default: { limit: 10, ttl: 60_000, blockDuration: 120_000 } })
  @RequirePermission(PERMISSIONS.ACCOUNTING_MANAGE)
  reverseJournal(@CurrentAuth() context: AuthContext, @Param('id') id: string, @Body() input: ReverseJournalDto) {
    return this.accounting.reverseJournal(context, id, input.reason ?? '');
  }

  @Post('journal')
  @Throttle({ default: { limit: 30, ttl: 60_000, blockDuration: 120_000 } })
  @RequirePermission(PERMISSIONS.ACCOUNTING_POST)
  postJournal(@CurrentAuth() context: AuthContext, @Body() input: ManualJournalDto) {
    return this.accounting.postManual(context, input);
  }

  @Get('journal')
  @RequirePermission(PERMISSIONS.ACCOUNTING_VIEW)
  journal(@CurrentAuth() context: AuthContext, @Query() query: OptionalBranchQueryDto) {
    return this.accounting.journal(context, query.branchId);
  }

  @Get('trial-balance')
  @RequirePermission(PERMISSIONS.ACCOUNTING_VIEW)
  trialBalance(@CurrentAuth() context: AuthContext, @Query() query: OptionalBranchQueryDto) {
    return this.accounting.trialBalance(context, query.branchId);
  }
}

