import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, AccountingModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
