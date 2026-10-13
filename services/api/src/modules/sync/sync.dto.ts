import { IsIn, IsInt, IsObject, IsString, Length, Min } from 'class-validator';
import type { JsonObject, SyncOperationType } from './sync-contract.js';

export class SyncEnvelopeDto {
  @IsString() @Length(1, 128) id!: string;
  @IsString() @Length(1, 128) deviceId!: string;
  @IsString() @Length(1, 128) branchId!: string;
  @IsIn(['CREATE', 'UPDATE', 'CANCEL', 'PAYMENT', 'SHIFT', 'CHECKOUT'])
  operation!: SyncOperationType;
  @IsString() @Length(1, 64) entityType!: string;
  @IsString() @Length(1, 128) entityId!: string;
  @IsString() @Length(16, 128) idempotencyKey!: string;
  @IsInt() @Min(1) clientSequence!: number;
  @IsString() @Length(1, 128) occurredAt!: string;
  @IsObject() payload!: JsonObject;
}
