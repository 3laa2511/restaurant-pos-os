import { Module } from '@nestjs/common';
import { CashDrawerController } from './cash-drawer.controller.js';
import { CashDrawerService } from './cash-drawer.service.js';

@Module({
  controllers: [CashDrawerController],
  providers: [CashDrawerService],
  exports: [CashDrawerService],
})
export class CashDrawerModule {}
