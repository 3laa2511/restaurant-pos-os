import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { DiningController } from './dining.controller.js';
import { DiningService } from './dining.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule],
  controllers: [DiningController],
  providers: [DiningService],
  exports: [DiningService],
})
export class DiningModule {}
