import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { RiskPolicyAdminService } from './risk-policy-admin.service.js';
import { RiskPolicyController } from './risk-policy.controller.js';
import { RiskPolicyService } from './risk-policy.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuditController, RiskPolicyController],
  providers: [RiskPolicyService, RiskPolicyAdminService, AuditService],
  exports: [AuditService, RiskPolicyService, RiskPolicyAdminService],
})
export class AuditModule {}
