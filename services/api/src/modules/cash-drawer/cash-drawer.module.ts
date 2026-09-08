import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CashDrawerController } from './cash-drawer.controller.js';
import { CashDrawerService } from './cash-drawer.service.js';

@Module({
  imports: [AuditModule],
  controllers: [CashDrawerController],
  providers: [CashDrawerService],
  exports: [CashDrawerService],
})
export class CashDrawerModule {}
