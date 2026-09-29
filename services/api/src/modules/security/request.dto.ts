import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

export class OptionalBranchQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  branchId?: string;
}

export class DateRangeBranchQueryDto extends OptionalBranchQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class IdParamDto {
  @IsString()
  @Length(1, 128)
  id!: string;
}

export class TransferStatusQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  status?: string;
}

export class CashDrawerBalanceQueryDto {
  @IsString()
  @Length(1, 128)
  shiftId!: string;

  @IsString()
  @Length(1, 128)
  deviceId!: string;
}
