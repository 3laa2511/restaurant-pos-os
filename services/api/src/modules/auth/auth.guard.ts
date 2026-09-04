import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.service.js';

type AuthenticatedHttpRequest = AuthenticatedRequest & {
  header(name: string): string | undefined;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedHttpRequest>();
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) return false;

    const authenticated = await this.auth.authenticate(match[1]);
    request.authContext = authenticated.context;
    request.sessionId = authenticated.sessionId;
    return true;
  }
}
