import { Controller, Get, Post, Query, UseGuards, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { AccountingService } from './accounting.service.js';
@Controller('accounting')
@UseGuards(AuthGuard, PermissionGuard)
export class AccountingController {
 constructor(private readonly accounting: AccountingService) {}
 @Post('journal') @Throttle({ default: { limit: 30, ttl: 60_000, blockDuration: 120_000 } }) @RequirePermission(PERMISSIONS.ACCOUNTING_POST)
 postJournal(@CurrentAuth() c:AuthContext,@Body() input:Parameters<AccountingService['postManual']>[1]){return this.accounting.postManual(c,input);}
 @Get('journal') @RequirePermission(PERMISSIONS.ACCOUNTING_VIEW)
 journal(@CurrentAuth() c:AuthContext,@Query('branchId') branchId?:string){return this.accounting.journal(c,branchId);}
 @Get('trial-balance') @RequirePermission(PERMISSIONS.ACCOUNTING_VIEW)
 trialBalance(@CurrentAuth() c:AuthContext,@Query('branchId') branchId?:string){return this.accounting.trialBalance(c,branchId);}
}