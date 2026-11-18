import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateDiningAreaDto {
  @IsOptional() @IsString() @Length(1, 128) branchId?: string;
  @IsString() @Length(1, 80) name!: string;
  @IsOptional() @IsString() @Length(1, 80) nameAr?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
}

export class CreateDiningTableDto {
  @IsString() @Length(1, 32) number!: string;
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsString() @Length(1, 80) nameAr?: string;
  @IsInt() @Min(1) @Max(100) seats!: number;
}

export class AssignDiningOrderDto {
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}

export class ClearDiningTableDto {
  @IsString() @Length(3, 500) reason!: string;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}

export class UpdateDiningTableStatusDto {
  @IsIn(['AVAILABLE', 'RESERVED', 'OUT_OF_SERVICE']) status!: 'AVAILABLE' | 'RESERVED' | 'OUT_OF_SERVICE';
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}
