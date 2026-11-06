import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import type { KitchenTicketStatus } from './kitchen-ticket.policy.js';

const KITCHEN_STATUSES: readonly KitchenTicketStatus[] = [
  'SENT_TO_KITCHEN',
  'PREPARING',
  'READY',
  'COMPLETED',
  'CANCELLED',
];

export class KitchenTicketStatusDto {
  @IsIn(KITCHEN_STATUSES)
  target!: KitchenTicketStatus;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
