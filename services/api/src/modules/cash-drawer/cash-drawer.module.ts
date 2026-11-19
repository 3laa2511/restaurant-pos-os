import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CashDrawerController } from './cash-drawer.controller.js';
import { CashDrawerService } from './cash-drawer.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule],
  controllers: [CashDrawerController],
  providers: [CashDrawerService],
  exports: [CashDrawerService],
})
export class CashDrawerModule {}
