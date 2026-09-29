import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class OptionalBranchQueryDto {
  @IsOptional() @IsString() @Length(1, 128) branchId?: string;
}
export class DateRangeBranchQueryDto extends OptionalBranchQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
export class IdParamDto {
  @IsString() @Length(1, 128) id!: string;
}

export class PayrollPeriodIdParamDto extends IdParamDto {}
export class TransferIdParamDto extends IdParamDto {}
export class ProductIdParamDto extends IdParamDto {}
export class OrderIdParamDto extends IdParamDto {}
export class TicketIdParamDto extends IdParamDto {}
export class TransferStatusQueryDto {
  @IsOptional() @IsIn(['DRAFT', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'CANCELLED'])
  status?: string;
}
