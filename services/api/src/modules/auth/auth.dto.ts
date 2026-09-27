import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { WORKSPACES, type WorkspaceCode } from './workspace.constants.js';

export class LoginDto {
  @IsString()
  @Length(1, 64)
  @Matches(/^[A-Za-z0-9._@-]+$/)
  username!: string;

  @IsString()
  @Length(8, 256)
  password!: string;

  @IsOptional()
  @IsIn(WORKSPACES)
  workspace?: WorkspaceCode;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  branchId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  @Type(() => String)
  deviceCode?: string;
}
