import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { RiskPolicyAdminService, type RiskPolicyWriteInput } from './risk-policy-admin.service.js';

@Controller('audit/risk-policies')
@UseGuards(AuthGuard, PermissionGuard)
@RequirePermission(PERMISSIONS.AUDIT_POLICY_MANAGE)
export class RiskPolicyController {
  constructor(private readonly policies: RiskPolicyAdminService) {}

  @Get()
  list(
    @CurrentAuth() context: AuthContext,
    @Query('branchId') branchId?: string,
    @Query('action') action?: string,
    @Query('includeDisabled') includeDisabled?: string,
  ) {
    return this.policies.list(context, branchId, action, includeDisabled !== 'false');
  }

  @Post()
  create(@CurrentAuth() context: AuthContext, @Body() body: RiskPolicyWriteInput) {
    return this.policies.create(context, body);
  }

  @Patch(':id')
  update(@CurrentAuth() context: AuthContext, @Param('id') id: string, @Body() body: RiskPolicyWriteInput) {
    return this.policies.update(context, id, body);
  }

  @Patch(':id/enabled')
  setEnabled(@CurrentAuth() context: AuthContext, @Param('id') id: string, @Body() body: { enabled?: boolean }) {
    if (typeof body.enabled !== 'boolean') throw new Error('enabled must be a boolean');
    return this.policies.setEnabled(context, id, body.enabled);
  }
}
