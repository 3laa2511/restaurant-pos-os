import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentController } from './payment.controller.js';
import { PaymentService } from './payment.service.js';
import { RefundService } from './refund.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [PaymentController],
  providers: [PaymentService, RefundService],
  exports: [PaymentService, RefundService],
})
export class PaymentModule {}
