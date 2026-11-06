import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { ShiftService, type CloseShiftInput, type OpenShiftInput } from './shift.service.js';
import { CloseShiftDto, OpenShiftDto } from './shift.dto.js';

@Controller('shifts')
@UseGuards(AuthGuard, PermissionGuard)
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @Get('current')
  @RequirePermission(PERMISSIONS.SHIFT_OPEN)
  current(@CurrentAuth() context: AuthContext) {
    return this.shifts.current(context);
  }

  @Post('open')
  @RequirePermission(PERMISSIONS.SHIFT_OPEN)
  open(@CurrentAuth() context: AuthContext, @Body() body: OpenShiftDto) {
    return this.shifts.open(context, body as OpenShiftInput);
  }

  @Post('close')
  @RequirePermission(PERMISSIONS.SHIFT_CLOSE)
  close(@CurrentAuth() context: AuthContext, @Body() body: CloseShiftDto) {
    return this.shifts.close(context, body as CloseShiftInput);
  }
}
