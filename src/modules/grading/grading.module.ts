import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { GradingController } from './grading.controller';
import { GradingService } from './grading.service';

@Module({
  imports: [AuditModule],
  controllers: [GradingController],
  providers: [GradingService],
})
export class GradingModule {}
