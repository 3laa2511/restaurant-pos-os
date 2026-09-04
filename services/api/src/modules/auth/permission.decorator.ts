import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from './rbac.constants.js';

export const REQUIRED_PERMISSION = 'requiredPermission';

export const RequirePermission = (permission: PermissionCode) => SetMetadata(REQUIRED_PERMISSION, permission);
