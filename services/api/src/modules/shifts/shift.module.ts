import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ShiftController } from './shift.controller.js';
import { ShiftService } from './shift.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ShiftController],
  providers: [ShiftService],
  exports: [ShiftService],
})
export class ShiftModule {}
