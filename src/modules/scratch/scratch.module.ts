import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataScopeModule } from '../data-scope/data-scope.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScratchAccessService } from './scratch-access.service';
import { ScratchAssignmentsService } from './scratch-assignments.service';
import { ScratchAssetsService } from './scratch-assets.service';
import { ScratchController } from './scratch.controller';
import { ScratchJudgeService } from './scratch-judge.service';
import { ScratchRuntimeAdapter } from './scratch-runtime.adapter';
import { ScratchTemplatesService } from './scratch-templates.service';
import { ScratchWorksService } from './scratch-works.service';

@Module({
  imports: [AuditModule, DataScopeModule, NotificationsModule],
  controllers: [ScratchController],
  providers: [
    ScratchAccessService,
    ScratchAssetsService,
    ScratchTemplatesService,
    ScratchAssignmentsService,
    ScratchWorksService,
    ScratchRuntimeAdapter,
    ScratchJudgeService,
  ],
  exports: [ScratchAssignmentsService],
})
export class ScratchModule {}
