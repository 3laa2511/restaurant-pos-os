import { IsDateString, IsEnum, IsNumber, IsObject, IsOptional, IsString, Length, Min } from 'class-validator';
import { RoleCode } from '../../generated/prisma/enums.js';

export class CreateEmployeeDto {
  @IsString() @Length(1, 64) username!: string;
  @IsString() @Length(8, 256) password!: string;
  @IsString() @Length(1, 200) displayName!: string;
  @IsString() @Length(1, 64) employeeCode!: string;
  @IsString() @Length(1, 128) jobTitle!: string;
  @IsOptional() @IsString() @Length(1, 128) branchId?: string;
  @IsOptional() @IsEnum(RoleCode) roleCode?: RoleCode;
  @IsOptional() @IsString() @Length(1, 32) phone?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) baseSalary!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) overtimeRate?: number;
}

export class AttendanceDto {
  @IsString() @Length(1, 128) userId!: string;
  @IsString() @Length(1, 128) branchId!: string;
  @IsOptional() @IsDateString() at?: string;
}

export class CreatePayrollPeriodDto {
  @IsString() @Length(1, 200) name!: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsOptional() @IsObject() bonuses?: Record<string, number>;
  @IsOptional() @IsObject() deductions?: Record<string, number>;
}
