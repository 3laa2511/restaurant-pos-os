import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { SyncController } from './sync.controller.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { SyncService } from './sync.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AccountingModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
