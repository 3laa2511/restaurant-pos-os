import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { PaymentService, type PersistSplitPaymentInput } from './payment.service.js';
import { RefundService, type PaymentAdjustmentInput } from './refund.service.js';
import { PaymentAdjustmentDto, SettlePaymentDto } from './payment.dto.js';

function requireDevice(context: AuthContext): string {
  if (!context.deviceId) throw new BadRequestException('A device-bound session is required for payment operations');
  return context.deviceId;
}

function requireClientSequence(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new BadRequestException('clientSequence must be a non-negative integer');
  return value;
}

function requireIdempotencyKey(value: string): string {
  if (!value.trim()) throw new BadRequestException('idempotencyKey is required');
  return value.trim();
}

@Controller('payments')
@UseGuards(AuthGuard, PermissionGuard)
export class PaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly refunds: RefundService,
  ) {}

  @Post('settle')
  @RequirePermission(PERMISSIONS.PAYMENT_CREATE)
  settle(@CurrentAuth() context: AuthContext, @Body() body: SettlePaymentDto) {
    const input: PersistSplitPaymentInput = {
      ...body,
      allocations: body.allocations,
      idempotencyKey: requireIdempotencyKey(body.idempotencyKey),
      clientSequence: requireClientSequence(body.clientSequence),
      deviceId: requireDevice(context),
    };
    return this.payments.settleSplitPayment(context, input);
  }

  @Post('refund')
  @Throttle({ default: { limit: 20, ttl: 60_000, blockDuration: 120_000 } })
  @RequirePermission(PERMISSIONS.PAYMENT_REFUND)
  refund(@CurrentAuth() context: AuthContext, @Body() body: PaymentAdjustmentDto) {
    return this.refunds.refundPayment(context, {
      ...body,
      idempotencyKey: requireIdempotencyKey(body.idempotencyKey),
      clientSequence: requireClientSequence(body.clientSequence),
      deviceId: requireDevice(context),
    });
  }

  @Post('void')
  @Throttle({ default: { limit: 20, ttl: 60_000, blockDuration: 120_000 } })
  @RequirePermission(PERMISSIONS.PAYMENT_VOID)
  void(@CurrentAuth() context: AuthContext, @Body() body: PaymentAdjustmentDto) {
    return this.refunds.voidPayment(context, {
      ...body,
      idempotencyKey: requireIdempotencyKey(body.idempotencyKey),
      clientSequence: requireClientSequence(body.clientSequence),
      deviceId: requireDevice(context),
    });
  }
}
