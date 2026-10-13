import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { BusinessCycleController } from './business-cycle.controller.js';
import { BusinessCycleService } from './business-cycle.service.js';
@Module({ imports: [DatabaseModule, AuthModule, AuditModule], controllers: [BusinessCycleController], providers: [BusinessCycleService], exports: [BusinessCycleService] })
export class BusinessCycleModule {}
