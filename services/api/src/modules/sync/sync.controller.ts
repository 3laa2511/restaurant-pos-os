import { Body, Controller, Get, UseGuards, Post } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { SyncEnvelopeDto } from './sync.dto.js';
import type { SyncEnvelope } from './sync-contract.js';
import { SyncService } from './sync.service.js';

@UseGuards(AuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('operations')
  submit(@CurrentAuth() context: AuthContext, @Body() envelope: SyncEnvelopeDto) {
    return this.sync.submit(context, envelope as unknown as SyncEnvelope);
  }

  @Get('pending')
  pending(@CurrentAuth() context: AuthContext) {
    return this.sync.pending(context);
  }
}
