import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { RiskPolicyService } from './risk-policy.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuditController],
  providers: [RiskPolicyService, AuditService],
  exports: [AuditService, RiskPolicyService],
})
export class AuditModule {}
