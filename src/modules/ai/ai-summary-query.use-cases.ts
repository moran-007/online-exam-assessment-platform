import { Injectable, NotFoundException } from '@nestjs/common';
import { AiSummaryReviewStatus, AiSummaryType, ClassMemberStatus, UserType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { AiSummaryAccessService } from './ai-summary-access.service';
import { evidenceList, presentSummary } from './ai-summary.presenter';

@Injectable()
export class AiSummaryQueryUseCases {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AiSummaryAccessService,
  ) {}

  async task(id: string, user: RequestUser) {
    const task = await this.prisma.aiSummaryTask.findUnique({
      where: { id },
      include: { summary: { select: { id: true } } },
    });
    const supportedTypes: AiSummaryType[] = [
      AiSummaryType.EXAM,
      AiSummaryType.STUDENT,
      AiSummaryType.CLASS,
      AiSummaryType.PARENT_REPORT,
      AiSummaryType.LESSON,
    ];
    if (!task || !supportedTypes.includes(task.type)) {
      throw new NotFoundException('AI 总结任务不存在');
    }
    await this.access.assertSubject(task.type, task.subjectId, user);
    return {
      id: task.id,
      type: task.type.toLowerCase(),
      subjectId: task.subjectId,
      status: task.status.toLowerCase(),
      attemptCount: task.attemptCount,
      inputHash: task.inputHash,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
      requestedOutputTokens: task.requestedOutputTokens,
      model: task.modelSnapshot,
      sanitizedError: task.sanitizedError,
      summaryId: task.summary?.id ?? null,
    };
  }

  async detail(id: string, user: RequestUser) {
    return presentSummary(await this.access.require(id, user));
  }

  examHistory(examId: string, user: RequestUser) {
    return this.history(AiSummaryType.EXAM, examId, user);
  }

  studentHistory(studentId: string, user: RequestUser) {
    return this.history(AiSummaryType.STUDENT, studentId, user);
  }

  classHistory(classId: string, user: RequestUser) {
    return this.history(AiSummaryType.CLASS, classId, user);
  }

  parentReportHistory(studentId: string, user: RequestUser) {
    return this.history(AiSummaryType.PARENT_REPORT, studentId, user);
  }

  lessonHistory(sessionId: string, user: RequestUser) {
    return this.history(AiSummaryType.LESSON, sessionId, user);
  }

  async publishedFor(user: RequestUser) {
    const learnerIds = await this.learnerIds(user);
    if (!learnerIds.length) return [];
    const [attempts, memberships] = await Promise.all([
      this.prisma.examAttempt.findMany({
        where: { userId: { in: learnerIds } },
        select: { examId: true },
        distinct: ['examId'],
      }),
      this.prisma.classStudent.findMany({
        where: { studentId: { in: learnerIds }, status: ClassMemberStatus.ACTIVE },
        select: { classId: true },
        distinct: ['classId'],
      }),
    ]);
    const visibleTypes = [
      { type: AiSummaryType.STUDENT, subjectId: { in: learnerIds } },
      ...(user.userType === UserType.PARENT
        ? [{ type: AiSummaryType.PARENT_REPORT, subjectId: { in: learnerIds } }]
        : []),
      ...(user.userType === UserType.STUDENT && memberships.length
        ? [{ type: AiSummaryType.CLASS, subjectId: { in: memberships.map((item) => item.classId) } }]
        : []),
      ...(attempts.length ? [{
        type: AiSummaryType.EXAM,
        subjectId: { in: attempts.map((attempt) => attempt.examId) },
      }] : []),
    ];
    const rows = await this.prisma.aiSummary.findMany({
      where: {
        reviewStatus: AiSummaryReviewStatus.PUBLISHED,
        publishedAt: { not: null },
        OR: visibleTypes,
      },
      orderBy: { publishedAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type.toLowerCase(),
      subjectId: row.subjectId,
      content: row.summaryJson,
      evidence: evidenceList(row.evidenceIndexJson),
      publishedAt: row.publishedAt as Date,
    }));
  }

  private async history(type: AiSummaryType, subjectId: string, user: RequestUser) {
    await this.access.assertSubject(type, subjectId, user);
    const rows = await this.prisma.aiSummary.findMany({
      where: { type, subjectId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(presentSummary);
  }

  private async learnerIds(user: RequestUser) {
    if (user.userType === UserType.STUDENT) return [user.id];
    if (user.userType !== UserType.PARENT) return [];
    const relations = await this.prisma.parentStudent.findMany({
      where: { parentId: user.id, status: ClassMemberStatus.ACTIVE },
      select: { studentId: true },
    });
    return relations.map((relation) => relation.studentId);
  }
}
