import { Injectable } from '@nestjs/common';
import { AiSummaryType, Prisma } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AiSummaryTaskCoordinator, SummaryTaskOptions } from './ai-summary-task.coordinator';
import { ClassSummaryDatasetBuilder, ClassSummaryScopeInput } from './datasets/class-summary-dataset.builder';
import { LessonAssistantDatasetBuilder } from './datasets/lesson-assistant-dataset.builder';
import { ParentReportDatasetBuilder, ParentReportScopeInput } from './datasets/parent-report-dataset.builder';
import {
  CreateClassSummaryTaskDto,
  CreateLessonAssistantTaskDto,
  CreateParentReportTaskDto,
} from './dto/integrated-summary.dto';
import {
  CLASS_SUMMARY_OUTPUT_SCHEMA_VERSION,
  LESSON_ASSISTANT_OUTPUT_SCHEMA_VERSION,
  PARENT_REPORT_OUTPUT_SCHEMA_VERSION,
} from './schemas/summary-output.schema';
import { createSummaryDatasetInputHash } from './summary-input-hash';

const MIN_INTEGRATED_OUTPUT_TOKENS = 100;

@Injectable()
export class IntegratedSummaryUseCases {
  constructor(
    private readonly classBuilder: ClassSummaryDatasetBuilder,
    private readonly parentBuilder: ParentReportDatasetBuilder,
    private readonly lessonBuilder: LessonAssistantDatasetBuilder,
    private readonly coordinator: AiSummaryTaskCoordinator,
  ) {}

  async previewClass(input: ClassSummaryScopeInput, user: RequestUser) {
    return this.preview(await this.classBuilder.build(input, user));
  }

  async createClass(
    dto: CreateClassSummaryTaskDto,
    user: RequestUser,
    options: SummaryTaskOptions = {},
  ) {
    const dataset = await this.classBuilder.build(dto, user);
    return this.coordinator.create({
      type: AiSummaryType.CLASS,
      subjectId: dto.classId,
      scope: this.rangeScope(dto),
      dataset,
      templateCode: 'class-summary',
      schemaVersion: CLASS_SUMMARY_OUTPUT_SCHEMA_VERSION,
      minOutputTokens: MIN_INTEGRATED_OUTPUT_TOKENS,
      configId: dto.configId,
      maxTokens: dto.maxTokens,
    }, user, options);
  }

  async previewParent(input: ParentReportScopeInput, user: RequestUser) {
    return this.preview(await this.parentBuilder.build(input, user));
  }

  async createParent(
    dto: CreateParentReportTaskDto,
    user: RequestUser,
    options: SummaryTaskOptions = {},
  ) {
    const dataset = await this.parentBuilder.build(dto, user);
    return this.coordinator.create({
      type: AiSummaryType.PARENT_REPORT,
      subjectId: dto.studentId,
      scope: this.rangeScope(dto),
      dataset,
      templateCode: 'parent-report',
      schemaVersion: PARENT_REPORT_OUTPUT_SCHEMA_VERSION,
      minOutputTokens: MIN_INTEGRATED_OUTPUT_TOKENS,
      configId: dto.configId,
      maxTokens: dto.maxTokens,
    }, user, options);
  }

  async previewLesson(sessionId: string, user: RequestUser) {
    return this.preview(await this.lessonBuilder.build(sessionId, user));
  }

  async createLesson(
    dto: CreateLessonAssistantTaskDto,
    user: RequestUser,
    options: SummaryTaskOptions = {},
  ) {
    const dataset = await this.lessonBuilder.build(dto.sessionId, user);
    return this.coordinator.create({
      type: AiSummaryType.LESSON,
      subjectId: dto.sessionId,
      scope: {},
      dataset,
      templateCode: 'lesson-assistant',
      schemaVersion: LESSON_ASSISTANT_OUTPUT_SCHEMA_VERSION,
      minOutputTokens: MIN_INTEGRATED_OUTPUT_TOKENS,
      configId: dto.configId,
      maxTokens: dto.maxTokens,
    }, user, options);
  }

  private preview(dataset: Parameters<typeof createSummaryDatasetInputHash>[0]) {
    const { evidenceIndex, ...facts } = dataset;
    return {
      inputHash: createSummaryDatasetInputHash(dataset),
      datasetVersion: dataset.datasetVersion,
      dataset: {
        ...facts,
        evidence: Object.values(evidenceIndex).sort((left, right) => left.refId.localeCompare(right.refId)),
      },
    };
  }

  private rangeScope(value: { from?: string; to?: string }): Prisma.InputJsonObject {
    return {
      ...(value.from ? { from: value.from } : {}),
      ...(value.to ? { to: value.to } : {}),
    };
  }
}
