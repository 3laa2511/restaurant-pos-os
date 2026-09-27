import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentAuth } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PermissionGuard } from '../auth/permission.guard.js';
import { RequirePermission } from '../auth/permission.decorator.js';
import { PERMISSIONS } from '../auth/rbac.constants.js';
import type { AuthContext } from '../auth/authorization.types.js';
import { HrService } from './hr.service.js';

@Controller('hr')
@UseGuards(AuthGuard, PermissionGuard)
export class HrController {
  constructor(private readonly hr: HrService) {}

  @Get('employees')
  @RequirePermission(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  listEmployees(@CurrentAuth() context: AuthContext, @Query('branchId') branchId?: string) {
    return this.hr.listEmployees(context, branchId);
  }

  @Post('employees')
  @RequirePermission(PERMISSIONS.HR_EMPLOYEE_MANAGE)
  createEmployee(@CurrentAuth() context: AuthContext, @Body() input: Parameters<HrService['createEmployee']>[1]) {
    return this.hr.createEmployee(context, input);
  }

  @Get('attendance')
  @RequirePermission(PERMISSIONS.HR_ATTENDANCE_MANAGE)
  listAttendance(@CurrentAuth() context: AuthContext, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.hr.listAttendance(context, { from, to, branchId });
  }

  @Post('attendance/check-in')
  @RequirePermission(PERMISSIONS.HR_ATTENDANCE_MANAGE)
  checkIn(@CurrentAuth() context: AuthContext, @Body() input: Parameters<HrService['checkIn']>[1]) {
    return this.hr.checkIn(context, input);
  }

  @Post('attendance/check-out')
  @RequirePermission(PERMISSIONS.HR_ATTENDANCE_MANAGE)
  checkOut(@CurrentAuth() context: AuthContext, @Body() input: Parameters<HrService['checkOut']>[1]) {
    return this.hr.checkOut(context, input);
  }

  @Post('payroll/periods')
  @RequirePermission(PERMISSIONS.HR_PAYROLL_MANAGE)
  createPayrollPeriod(@CurrentAuth() context: AuthContext, @Body() input: Parameters<HrService['createPayrollPeriod']>[1]) {
    return this.hr.createPayrollPeriod(context, input);
  }

  @Post('payroll/periods/:id/approve')
  @Throttle({ default: { limit: 10, ttl: 60_000, blockDuration: 120_000 } })
  @RequirePermission(PERMISSIONS.HR_PAYROLL_MANAGE)
  approvePayrollPeriod(@CurrentAuth() context: AuthContext, @Param('id') id: string) { return this.hr.approvePayrollPeriod(context, id); }

  @Post('payroll/periods/:id/pay')
  @Throttle({ default: { limit: 10, ttl: 60_000, blockDuration: 120_000 } })
  @RequirePermission(PERMISSIONS.HR_PAYROLL_MANAGE)
  payPayrollPeriod(@CurrentAuth() context: AuthContext, @Param('id') id: string) { return this.hr.payPayrollPeriod(context, id); }

  @Get('payroll/periods/:id')
  @RequirePermission(PERMISSIONS.HR_PAYROLL_VIEW)
  getPayrollPeriod(@CurrentAuth() context: AuthContext, @Param('id') id: string) {
    return this.hr.getPayrollPeriod(context, id);
  }
}
