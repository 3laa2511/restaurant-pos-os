import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
