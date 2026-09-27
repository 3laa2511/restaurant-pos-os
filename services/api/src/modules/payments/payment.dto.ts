import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import type { PaymentMethod } from './payment-policy.js';

export class PaymentAllocationDto {
  @IsIn(['CASH', 'CARD', 'WALLET', 'OTHER'])
  method!: PaymentMethod;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  reference?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  receivedCash?: number;
}

export class SettlePaymentDto {
  @IsString()
  @Length(1, 128)
  orderId!: string;

  @IsString()
  @Length(1, 128)
  shiftId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  @Max(10)
  allocations!: PaymentAllocationDto[];

  @IsString()
  @Length(16, 128)
  idempotencyKey!: string;

  @IsNumber()
  @Min(0)
  clientSequence!: number;
}

export class PaymentAdjustmentDto {
  @IsString()
  @Length(1, 128)
  paymentId!: string;

  @IsString()
  @Length(1, 128)
  shiftId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @Length(1, 500)
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  reference?: string;

  @IsString()
  @Length(16, 128)
  idempotencyKey!: string;

  @IsNumber()
  @Min(0)
  clientSequence!: number;
}
