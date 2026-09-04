import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { PaymentService } from './payment.service.js';
import { RefundService } from './refund.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [PaymentService, RefundService],
  exports: [PaymentService, RefundService],
})
export class PaymentModule {}
