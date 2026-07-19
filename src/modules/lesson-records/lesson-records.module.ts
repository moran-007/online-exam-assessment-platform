import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LearningPortalController } from './learning-portal.controller';
import { LearningPortalService } from './learning-portal.service';
import { LessonAssetsService } from './lesson-assets.service';
import { LessonRecordAccessService } from './lesson-record-access.service';
import { LessonRecordVersionService } from './lesson-record-version.service';
import { LessonRecordsController } from './lesson-records.controller';
import { LessonRecordsService } from './lesson-records.service';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [LessonRecordsController, LearningPortalController],
  providers: [
    LessonRecordAccessService,
    LessonRecordVersionService,
    LessonRecordsService,
    LessonAssetsService,
    LearningPortalService,
  ],
  exports: [LessonRecordsService],
})
export class LessonRecordsModule {}

