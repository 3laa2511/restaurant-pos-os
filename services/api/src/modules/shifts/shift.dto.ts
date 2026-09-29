import { IsNumber, IsString, Length, Min } from 'class-validator';

export class OpenShiftDto {
  @IsString() @Length(1, 128) branchId!: string;
  @IsString() @Length(1, 128) deviceId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) openingCash!: number;
  @IsString() @Length(16, 128) idempotencyKey!: string;
  @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) clientSequence!: number;
}

export class CloseShiftDto {
  @IsString() @Length(1, 128) shiftId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) closingCash!: number;
  @IsString() @Length(16, 128) idempotencyKey!: string;
  @IsNumber({ maxDecimalPlaces: 0 }) @Min(0) clientSequence!: number;
}
