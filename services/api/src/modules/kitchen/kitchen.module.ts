import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { KitchenController } from './kitchen.controller.js';
import { KitchenService } from './kitchen.service.js';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [KitchenController],
  providers: [KitchenService],
  exports: [KitchenService],
})
export class KitchenModule {}
