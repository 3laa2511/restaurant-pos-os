import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OrderModule } from './modules/orders/order.module.js';
import { PaymentModule } from './modules/payments/payment.module.js';
import { ShiftModule } from './modules/shifts/shift.module.js';
import { CashDrawerModule } from './modules/cash-drawer/cash-drawer.module.js';
import { SyncModule } from './modules/sync/sync.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, HealthModule, OrderModule, PaymentModule, ShiftModule, CashDrawerModule, SyncModule],
})
export class AppModule {}
