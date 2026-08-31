import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { DatabaseModule } from './database/database.module.js';
import { OrderModule } from './modules/orders/order.module.js';

@Module({
  imports: [DatabaseModule, HealthModule, OrderModule],
})
export class AppModule {}
