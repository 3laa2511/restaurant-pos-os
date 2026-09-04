import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from './authorization.types.js';
import type { AuthenticatedRequest } from './auth.service.js';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    if (!request.authContext) throw new Error('Authentication context is missing');
    return request.authContext;
  },
);
