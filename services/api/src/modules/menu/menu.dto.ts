import { IsBoolean, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class BranchProductConfigDto {
  @IsString() @Length(1, 128) branchId!: string;
  @IsString() @Length(1, 128) productId!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) priceOverride?: number | null;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() available?: boolean;
}
