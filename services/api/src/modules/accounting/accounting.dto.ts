import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';

class JournalLineDto {
  @IsString() @Length(1, 64) code!: string;
  @IsString() @Length(1, 200) name!: string;
  @IsOptional() @IsString() @Length(1, 200) nameAr?: string;
  @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']) type!: 'ASSET'|'LIABILITY'|'EQUITY'|'REVENUE'|'EXPENSE';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) debit?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) credit?: number;
  @IsOptional() @IsString() @Length(1, 128) branchId?: string;
  @IsOptional() @IsString() @Length(1, 500) memo?: string;
}

export class ManualJournalDto {
  @IsOptional() @IsString() @Length(1, 128) branchId?: string;
  @IsOptional() @IsString() @Length(1, 64) sourceType?: string;
  @IsOptional() @IsString() @Length(1, 128) sourceId?: string;
  @IsString() @Length(1, 500) description!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

export class CreateFiscalPeriodDto {
  @IsString() @Length(1, 120) name!: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
}

export class ReverseJournalDto {
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

export class CreateAccountingAccountDto {
  @IsString() @Length(1, 64) code!: string;
  @IsString() @Length(1, 200) name!: string;
  @IsOptional() @IsString() @Length(1, 200) nameAr?: string;
  @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']) type!: 'ASSET'|'LIABILITY'|'EQUITY'|'REVENUE'|'EXPENSE';
  @IsOptional() @IsString() @Length(1, 128) parentId?: string;
  @IsOptional() @IsBoolean() allowPosting?: boolean;
}

export class UpdateAccountingAccountDto {
  @IsOptional() @IsString() @Length(1, 200) name?: string;
  @IsOptional() @IsString() @Length(1, 200) nameAr?: string;
  @IsOptional() @IsString() @Length(1, 128) parentId?: string | null;
  @IsOptional() @IsBoolean() allowPosting?: boolean;
}
