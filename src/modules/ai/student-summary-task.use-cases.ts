import { Injectable } from '@nestjs/common';
import { AiSummaryType, Prisma } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import {
  AiSummaryTaskCoordinator,
  type SummaryTaskOptions,
  withRetryConfirmation,
} from './ai-summary-task.coordinator';
import { MIN_STUDENT_SUMMARY_OUTPUT_TOKENS } from './ai-summary-limits';
import { StudentSummaryDatasetBuilder } from './datasets/student-summary-dataset.builder';
import { CreateStudentSummaryTaskDto } from './dto/student-summary.dto';
import { STUDENT_SUMMARY_OUTPUT_SCHEMA_VERSION } from './schemas/summary-output.schema';

@Injectable()
export class StudentSummaryTaskUseCases {
  constructor(
    private readonly builder: StudentSummaryDatasetBuilder,
    private readonly coordinator: AiSummaryTaskCoordinator,
  ) {}

  async create(
    dto: CreateStudentSummaryTaskDto,
    user: RequestUser,
    options: SummaryTaskOptions = {},
  ) {
    const dataset = await this.builder.build(dto, user);
    return this.coordinator.create({
      type: AiSummaryType.STUDENT,
      subjectId: dto.studentId,
      scope: this.scope(dto, dataset.scope?.summaryDomains, dataset.scope?.recentExamCount),
      dataset,
      templateCode: 'student-summary',
      schemaVersion: STUDENT_SUMMARY_OUTPUT_SCHEMA_VERSION,
      minOutputTokens: MIN_STUDENT_SUMMARY_OUTPUT_TOKENS,
      configId: dto.configId,
      maxTokens: dto.maxTokens,
    }, user, withRetryConfirmation(options, dto.confirmRetry));
  }

  private scope(
    dto: CreateStudentSummaryTaskDto,
    summaryDomains?: string[],
    recentExamCount?: number | null,
  ): Prisma.InputJsonObject {
    return {
      studentId: dto.studentId,
      ...(dto.courseId ? { courseId: dto.courseId } : {}),
      ...(dto.examIds ? { examIds: dto.examIds } : {}),
      ...(dto.from ? { from: dto.from } : {}),
      ...(dto.to ? { to: dto.to } : {}),
      ...(summaryDomains?.length ? { summaryDomains } : {}),
      ...(recentExamCount ? { recentExamCount } : {}),
    };
  }
}
