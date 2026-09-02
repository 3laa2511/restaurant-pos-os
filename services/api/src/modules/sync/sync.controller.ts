import { Body, Controller, Get, Post } from '@nestjs/common';
import { SyncEnvelope } from './sync-contract.js';
import { SyncService } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('operations')
  submit(@Body() envelope: SyncEnvelope) {
    return this.sync.submit(envelope);
  }

  @Get('pending')
  pending() {
    return this.sync.pending();
  }
}
