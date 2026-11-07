import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { KitchenController } from './kitchen.controller.js';
import { KitchenService } from './kitchen.service.js';
import { KitchenSyncService } from './kitchen-sync.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule],
  controllers: [KitchenController],
  providers: [KitchenService, KitchenSyncService],
  exports: [KitchenService, KitchenSyncService],
})
export class KitchenModule {}
