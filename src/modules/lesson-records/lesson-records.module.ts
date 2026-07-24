import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LearningPortalController } from './learning-portal.controller';
import { LearningPortalService } from './learning-portal.service';
import { LessonAssetsService } from './lesson-assets.service';
import { LessonPlanProcessPresetsController } from './lesson-plan-process-presets.controller';
import { LessonPlanProcessPresetsService } from './lesson-plan-process-presets.service';
import { LessonPlanPromptTemplatesController } from './lesson-plan-prompt-templates.controller';
import { LessonPlanPromptTemplatesService } from './lesson-plan-prompt-templates.service';
import { LessonRecordAccessService } from './lesson-record-access.service';
import { LessonRecordVersionService } from './lesson-record-version.service';
import { LessonPlansController } from './lesson-plans.controller';
import { LessonPlansService } from './lesson-plans.service';
import { LessonRecordsController } from './lesson-records.controller';
import { LessonRecordsService } from './lesson-records.service';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [
    LessonRecordsController,
    LessonPlansController,
    LessonPlanProcessPresetsController,
    LessonPlanPromptTemplatesController,
    LearningPortalController,
  ],
  providers: [
    LessonRecordAccessService,
    LessonRecordVersionService,
    LessonRecordsService,
    LessonPlansService,
    LessonPlanProcessPresetsService,
    LessonPlanPromptTemplatesService,
    LessonAssetsService,
    LearningPortalService,
  ],
  exports: [LessonRecordsService],
})
export class LessonRecordsModule {}
