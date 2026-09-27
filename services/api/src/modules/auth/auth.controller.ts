import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.service.js';
import { LoginDto } from './auth.dto.js';
import { CurrentAuth } from './auth.decorators.js';
import type { AuthContext } from './authorization.types.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 300_000 } })
  login(@Body() input: LoginDto) {
    return this.auth.login(input);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentAuth() context: AuthContext) {
    return context;
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(@Req() request: AuthenticatedRequest, @CurrentAuth() context: AuthContext) {
    if (!request.sessionId) throw new Error('Session context is missing');
    await this.auth.logout(request.sessionId, context.userId);
    return { success: true };
  }
}
