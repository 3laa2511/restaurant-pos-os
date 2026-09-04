import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest, LoginInput } from './auth.service.js';
import { CurrentAuth } from './auth.decorators.js';
import type { AuthContext } from './authorization.types.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() input: LoginInput) {
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
