import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { HrController } from './hr.controller.js';
import { HrService } from './hr.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AccountingModule],
  controllers: [HrController],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
