import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { PrismaOrderRepository } from './prisma-order-repository.js';
import { OrderService } from './order.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    OrderService,
    PrismaOrderRepository,
    {
      provide: 'ORDER_REPOSITORY',
      useExisting: PrismaOrderRepository,
    },
  ],
  exports: [OrderService, 'ORDER_REPOSITORY'],
})
export class OrderModule {}
