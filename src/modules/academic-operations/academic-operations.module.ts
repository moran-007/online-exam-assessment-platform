import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { LessonCatalogController } from './lesson-catalog.controller';
import { LessonCatalogService } from './lesson-catalog.service';
import { LessonHourController } from './lesson-hour.controller';
import { LessonHourService } from './lesson-hour.service';
import { LessonScheduleController } from './lesson-schedule.controller';
import { LessonScheduleService } from './lesson-schedule.service';

@Module({
  imports: [AuditModule],
  controllers: [LessonCatalogController, LessonScheduleController, AttendanceController, LessonHourController],
  providers: [LessonCatalogService, LessonScheduleService, AttendanceService, LessonHourService],
  exports: [LessonCatalogService, LessonScheduleService, AttendanceService, LessonHourService],
})
export class AcademicOperationsModule {}
