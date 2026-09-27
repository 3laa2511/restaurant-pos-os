import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { HrController } from './hr.controller.js';
import { HrService } from './hr.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [HrController],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
