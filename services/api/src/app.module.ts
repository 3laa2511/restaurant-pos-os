import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [HealthModule],
})
export class AppModule {}
