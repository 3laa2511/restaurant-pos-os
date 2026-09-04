import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthContext } from './authorization.types.js';
import type { AuthenticatedRequest } from './auth.service.js';

type AuthenticatedHttpRequest = AuthenticatedRequest;

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedHttpRequest>();
    if (!request.authContext) throw new Error('Authentication context is missing');
    return request.authContext;
  },
);
