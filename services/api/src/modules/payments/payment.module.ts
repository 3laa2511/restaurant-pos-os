import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { PaymentService } from './payment.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
