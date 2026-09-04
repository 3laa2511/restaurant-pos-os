import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from './authorization.types.js';
import { REQUIRED_PERMISSION } from './permission.decorator.js';
import type { PermissionCode } from './rbac.constants.js';
import type { AuthenticatedRequest } from './auth.service.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<PermissionCode | undefined>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.authContext) throw new ForbiddenException('Authentication context is missing');
    if (!hasPermission(request.authContext, permission)) {
      throw new ForbiddenException(`Forbidden: missing permission ${permission}`);
    }
    return true;
  }
}
