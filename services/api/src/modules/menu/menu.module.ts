import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { MenuController } from './menu.controller.js';
import { MenuService } from './menu.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [MenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
