import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class BranchProductConfigDto {
  @IsString() @Length(1, 128) branchId!: string;
  @IsString() @Length(1, 128) productId!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) priceOverride?: number | null;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() available?: boolean;
}

export class CreateModifierGroupDto {
  @IsString() @Length(1, 128) productId!: string;
  @IsString() @Length(1, 128) name!: string;
  @IsOptional() @IsString() @Length(1, 128) nameAr?: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(20) minSelections?: number;
  @IsOptional() @IsInt() @Min(1) @Max(20) maxSelections?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

export class CreateModifierOptionDto {
  @IsString() @Length(1, 128) groupId!: string;
  @IsString() @Length(1, 128) name!: string;
  @IsOptional() @IsString() @Length(1, 128) nameAr?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) priceDelta?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}
