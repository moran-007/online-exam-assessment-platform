import { Injectable, NotFoundException } from '@nestjs/common';
import { AiSummaryReviewStatus, AiSummaryType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { evidenceList, presentSummary } from './ai-summary.presenter';
import { ExamSummaryAccessService } from './exam-summary-access.service';

@Injectable()
export class ExamSummaryQueryUseCases {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly access: ExamSummaryAccessService,
  ) {}

  async task(id: string, user: RequestUser) {
    const task = await this.prisma.aiSummaryTask.findUnique({
      where: { id },
      include: { summary: { select: { id: true } } },
    });
    if (!task || task.type !== AiSummaryType.EXAM) throw new NotFoundException('AI 总结任务不存在');
    await this.dataScope.assertExamAccessible(user, task.subjectId);
    return {
      id: task.id,
      status: task.status.toLowerCase(),
      attemptCount: task.attemptCount,
      inputHash: task.inputHash,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
      model: task.modelSnapshot,
      sanitizedError: task.sanitizedError,
      summaryId: task.summary?.id ?? null,
    };
  }

  async detail(id: string, user: RequestUser) {
    return presentSummary(await this.access.require(id, user));
  }

  async history(examId: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, examId);
    const rows = await this.prisma.aiSummary.findMany({
      where: { type: AiSummaryType.EXAM, subjectId: examId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(presentSummary);
  }

  async publishedFor(user: RequestUser) {
    const attempts = await this.prisma.examAttempt.findMany({
      where: { userId: user.id },
      select: { examId: true },
      distinct: ['examId'],
    });
    const rows = attempts.length ? await this.prisma.aiSummary.findMany({
      where: {
        type: AiSummaryType.EXAM,
        subjectId: { in: attempts.map((attempt) => attempt.examId) },
        reviewStatus: AiSummaryReviewStatus.PUBLISHED,
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: 'desc' },
    }) : [];
    return rows.map((row) => ({
      id: row.id,
      examId: row.subjectId,
      content: row.summaryJson,
      evidence: evidenceList(row.evidenceIndexJson),
      publishedAt: row.publishedAt as Date,
    }));
  }
}
