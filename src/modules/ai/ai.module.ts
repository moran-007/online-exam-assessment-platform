import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StatisticsModule } from '../statistics/statistics.module';
import { AiConfigUseCases } from './ai-config.use-cases';
import { AiGenerationUseCases } from './ai-generation.use-cases';
import { AiProviderGateway } from './ai-provider.gateway';
import { AiProviderConfigAccessService } from './ai-provider-config-access.service';
import { AiProviderCapabilityRegistry } from './ai-provider-capability.registry';
import { AiController } from './ai.controller';
import { AiSummaryController } from './ai-summary.controller';
import { AiTokenUsageService } from './ai-token-usage.service';
import { SummaryOutputValidator } from './schemas/summary-output.validator';
import { ExamSummaryDatasetBuilder } from './datasets/exam-summary-dataset.builder';
import { StudentSummaryDatasetBuilder } from './datasets/student-summary-dataset.builder';
import { ExamSummaryPreviewUseCases } from './exam-summary-preview.use-cases';
import { StudentSummaryPreviewUseCases } from './student-summary-preview.use-cases';
import { AiSummaryTaskRunner } from './ai-summary-task.runner';
import { AiSummaryTaskCoordinator } from './ai-summary-task.coordinator';
import { ExamSummaryTaskUseCases } from './exam-summary-task.use-cases';
import { StudentSummaryTaskUseCases } from './student-summary-task.use-cases';
import { StudentSummaryBatchEstimateUseCases } from './student-summary-batch-estimate.use-cases';
import { AiSummaryLifecycleController } from './ai-summary-lifecycle.controller';
import { AiSummaryLifecycleUseCases } from './ai-summary-lifecycle.use-cases';
import { AiSummaryAccessService } from './ai-summary-access.service';
import { AiSummaryQueryUseCases } from './ai-summary-query.use-cases';
import { ClassSummaryDatasetBuilder } from './datasets/class-summary-dataset.builder';
import { ParentReportDatasetBuilder } from './datasets/parent-report-dataset.builder';
import { LessonAssistantDatasetBuilder } from './datasets/lesson-assistant-dataset.builder';
import { IntegratedSummaryController } from './integrated-summary.controller';
import { IntegratedSummaryUseCases } from './integrated-summary.use-cases';
import { AiQualityController } from './ai-quality.controller';
import { AiFeedbackUseCases } from './ai-feedback.use-cases';
import { AiQualityDashboardUseCases } from './ai-quality-dashboard.use-cases';
import { AiRegressionUseCases } from './ai-regression.use-cases';
import { AiSummaryPresetController } from './ai-summary-preset.controller';
import { AiSummaryPresetUseCases } from './ai-summary-preset.use-cases';
import { AiDataPermissionService } from './ai-data-permission.service';
import { AiLearningContextService } from './ai-learning-context.service';

@Module({
  imports: [AuditModule, StatisticsModule],
  controllers: [
    AiController,
    AiSummaryController,
    AiSummaryLifecycleController,
    IntegratedSummaryController,
    AiQualityController,
    AiSummaryPresetController,
  ],
  providers: [
    AiProviderGateway,
    AiProviderCapabilityRegistry,
    AiProviderConfigAccessService,
    AiTokenUsageService,
    SummaryOutputValidator,
    AiConfigUseCases,
    AiGenerationUseCases,
    ExamSummaryDatasetBuilder,
    StudentSummaryDatasetBuilder,
    ExamSummaryPreviewUseCases,
    StudentSummaryPreviewUseCases,
    AiSummaryTaskRunner,
    AiSummaryTaskCoordinator,
    ExamSummaryTaskUseCases,
    StudentSummaryTaskUseCases,
    StudentSummaryBatchEstimateUseCases,
    AiSummaryLifecycleUseCases,
    AiSummaryAccessService,
    AiSummaryQueryUseCases,
    ClassSummaryDatasetBuilder,
    ParentReportDatasetBuilder,
    LessonAssistantDatasetBuilder,
    IntegratedSummaryUseCases,
    AiFeedbackUseCases,
    AiQualityDashboardUseCases,
    AiRegressionUseCases,
    AiSummaryPresetUseCases,
    AiDataPermissionService,
    AiLearningContextService,
  ],
  exports: [
    AiProviderGateway,
    AiProviderCapabilityRegistry,
    AiProviderConfigAccessService,
    AiTokenUsageService,
    SummaryOutputValidator,
    ExamSummaryDatasetBuilder,
  ],
})
export class AiModule {}
