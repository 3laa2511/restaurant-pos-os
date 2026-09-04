import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PermissionGuard } from './permission.guard.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, PermissionGuard],
  exports: [AuthService, AuthGuard, PermissionGuard],
})
export class AuthModule {}
