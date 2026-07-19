import { Injectable } from '@nestjs/common';
import { AiSummaryType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  AiSummaryTaskCoordinator,
  type SummaryTaskOptions,
  withRetryConfirmation,
} from './ai-summary-task.coordinator';
import { MIN_EXAM_SUMMARY_OUTPUT_TOKENS } from './ai-summary-limits';
import { ExamSummaryDatasetBuilder } from './datasets/exam-summary-dataset.builder';
import { CreateExamSummaryTaskDto } from './dto/ai-summary.dto';
import { EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION } from './schemas/summary-output.schema';

@Injectable()
export class ExamSummaryTaskUseCases {
  constructor(
    private readonly builder: ExamSummaryDatasetBuilder,
    private readonly coordinator: AiSummaryTaskCoordinator,
  ) {}

  async create(
    dto: CreateExamSummaryTaskDto,
    user: RequestUser,
    options: SummaryTaskOptions = {},
  ) {
    const dataset = await this.builder.build(dto.examId, user);
    return this.coordinator.create({
      type: AiSummaryType.EXAM,
      subjectId: dto.examId,
      scope: { examId: dto.examId },
      dataset,
      templateCode: 'exam-summary',
      schemaVersion: EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION,
      minOutputTokens: MIN_EXAM_SUMMARY_OUTPUT_TOKENS,
      configId: dto.configId,
      maxTokens: dto.maxTokens,
    }, user, withRetryConfirmation(options, dto.confirmRetry));
  }
}
