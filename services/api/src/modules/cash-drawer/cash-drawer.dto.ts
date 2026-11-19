import { IsIn, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import type { CashDrawerDirection, CashDrawerMovementType } from './cash-drawer.service.js';

export class CreateCashDrawerDto {
  @IsString() @Length(1, 128) branchId!: string;
  @IsString() @Length(1, 128) deviceId!: string;
  @IsString() @Length(1, 160) name!: string;
}

export class RecordCashMovementDto {
  @IsString() @Length(1, 128) drawerId!: string;
  @IsString() @Length(1, 128) shiftId!: string;
  @IsString() @Length(1, 128) deviceId!: string;
  @IsIn(['OPENING_FLOAT', 'SALE', 'CASH_CHANGE', 'REFUND', 'PAY_IN', 'PAY_OUT', 'ADJUSTMENT'])
  type!: CashDrawerMovementType;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @IsString() @Length(1, 500) reason!: string;
  @IsString() @Length(16, 128) idempotencyKey!: string;
  @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) clientSequence!: number;
  @IsOptional() @IsIn(['IN', 'OUT']) direction?: CashDrawerDirection;
  @IsOptional() @IsString() @Length(1, 64) sourceType?: string;
  @IsOptional() @IsString() @Length(1, 128) sourceId?: string;
}
