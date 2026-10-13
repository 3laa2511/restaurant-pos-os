import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AccountingController } from './accounting.controller.js';
import { AccountingService } from './accounting.service.js';
@Module({imports:[DatabaseModule,AuthModule],controllers:[AccountingController],providers:[AccountingService],exports:[AccountingService]})
export class AccountingModule {}