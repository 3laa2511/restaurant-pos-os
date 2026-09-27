import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
 @Get('journal') @RequirePermission(PERMISSIONS.ACCOUNTING_VIEW)
 journal(@CurrentAuth() c:AuthContext,@Query('branchId') branchId?:string){return this.accounting.journal(c,branchId);}
 @Post('payments/:paymentId/post') @RequirePermission(PERMISSIONS.ACCOUNTING_POST)
 postPayment(@CurrentAuth() c:AuthContext,@Param('paymentId') paymentId:string){return this.accounting.postPayment(c,paymentId);}
 @Get('trial-balance') @RequirePermission(PERMISSIONS.ACCOUNTING_VIEW)
 trialBalance(@CurrentAuth() c:AuthContext,@Query('branchId') branchId?:string){return this.accounting.trialBalance(c,branchId);}
}