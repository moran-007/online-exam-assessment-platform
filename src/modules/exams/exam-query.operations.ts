/* eslint-disable @typescript-eslint/no-unused-vars */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AnswerRecordStatus, AttemptStatus, ClassMemberStatus, ExamStatus, PaperStatus, Prisma, QuestionType, ScoringEvaluationSource, UserStatus, UserType } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { normalizeExamStatus, toApiEnum } from '../../common/utils/enum-normalizer';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionTypeRegistry } from '../question-types/question-type-registry.service';
import { ScoringHistoryService } from '../question-types/scoring-history.service';
import { BulkUpdateExamStatusDto } from './dto/bulk-update-exam-status.dto';
import { CreateExamDto } from './dto/create-exam.dto';
import { QueryExamDto } from './dto/query-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';

type SnapshotQuestion = {
  questionId: string;
  score: number;
  snapshot: {
    type: string;
    scoringRule?: Prisma.JsonValue | null;
    scoringRuleVersionId?: string | null;
    engine?: { adapterKey?: string; adapterVersion?: number };
    children?: SnapshotQuestion[];
    answer?: {
      correctOptionIds?: string[];
      blanks?: Array<{
        index: number;
        answers: string[];
        ignoreCase?: boolean;
        trimSpace?: boolean;
        score?: number;
      }>;
    } | null;
  };
};

type PaperSnapshot = {
  sections: Array<{ questions: SnapshotQuestion[] }>;
};
import { ExamsContext } from './exams.context';
import { activeAnnouncementText } from './exam-announcement.operations';
import { extractResultVisibility } from './exam-write.operations';
export async function list(ctx: ExamsContext, query: QueryExamDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const scopeWhere = await ctx.dataScope.examWhere(user, query.classId);
    const where: Prisma.ExamWhereInput = {
      deletedAt: null,
      courseId: query.courseId,
      AND: [
        scopeWhere,
        examStatusWhere(ctx, query.status),
        query.keyword ? { OR: [{ name: { contains: query.keyword, mode: 'insensitive' } }] } : {},
      ],
    };

    const [items, total] = await ctx.prisma.$transaction([
      ctx.prisma.exam.findMany({
        where,
        include: {
          course: { select: { name: true } },
          paper: { select: { name: true, totalScore: true } },
          announcements: {
            where: { isActive: true },
            orderBy: { version: 'desc' },
            take: 1,
          },
          _count: { select: { attempts: true } },
        },
        orderBy: examOrderBy(ctx, query),
        skip,
        take,
      }),
      ctx.prisma.exam.count({ where }),
    ]);

    const classMap = await loadClassMap(ctx, items.map((exam) => exam.classId).filter(Boolean) as string[]);

    return {
      items: items.map((exam) => {
        const effectiveStatus = effectiveExamStatus(ctx, exam);
        return {
          ...exam,
          status: toApiEnum(effectiveStatus),
          storedStatus: toApiEnum(exam.status),
          courseName: exam.course.name,
          paperName: exam.paper.name,
          className: exam.classId ? classMap.get(exam.classId)?.name ?? '' : '公开',
          totalScore: Number(exam.paper.totalScore),
          attemptCount: exam._count.attempts,
          announcement: activeAnnouncementText(ctx, exam),
          announcementId: exam.announcements[0]?.id ?? null,
          announcementVersion: exam.announcements[0]?.version ?? null,
          resultVisibility: extractResultVisibility(ctx, exam.antiCheatConfigJson),
        };
      }),
      page,
      pageSize,
      total,
    };
  }

export async function detail(ctx: ExamsContext, id: string, user: RequestUser) {
    await ctx.dataScope.assertExamAccessible(user, id);
    const exam = await ctx.prisma.exam.findFirst({
      where: { id, deletedAt: null },
      include: {
        paper: true,
        course: true,
        announcements: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    const classMap = await loadClassMap(ctx, exam.classId ? [exam.classId] : []);

    return {
      ...exam,
      status: toApiEnum(effectiveExamStatus(ctx, exam)),
      storedStatus: toApiEnum(exam.status),
      className: exam.classId ? classMap.get(exam.classId)?.name ?? '' : '公开',
      announcement: activeAnnouncementText(ctx, exam),
      announcementId: exam.announcements[0]?.id ?? null,
      announcementVersion: exam.announcements[0]?.version ?? null,
      resultVisibility: extractResultVisibility(ctx, exam.antiCheatConfigJson),
      paper: { ...exam.paper, status: toApiEnum(exam.paper.status), totalScore: Number(exam.paper.totalScore) },
    };
  }

export async function results(ctx: ExamsContext, id: string, query: QueryExamDto, user: RequestUser) {
    await ctx.dataScope.assertExamAccessible(user, id);
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.ExamAttemptWhereInput = { examId: id };
    const [items, total, allAttempts] = await ctx.prisma.$transaction([
      ctx.prisma.examAttempt.findMany({
        where,
        orderBy: [{ totalScore: 'desc' }, { submittedAt: 'asc' }],
        skip,
        take,
      }),
      ctx.prisma.examAttempt.count({ where }),
      ctx.prisma.examAttempt.findMany({
        where,
        orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, userId: true },
      }),
    ]);
    const userIds = [...new Set(items.map((item) => item.userId))];
    const users = await ctx.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, realName: true },
    });
    const userMap = new Map(users.map((user) => [user.id, user]));
    const attemptNoMap = new Map<string, number>();
    const counters = new Map<string, number>();
    for (const attempt of allAttempts) {
      const next = (counters.get(attempt.userId) ?? 0) + 1;
      counters.set(attempt.userId, next);
      attemptNoMap.set(attempt.id, next);
    }

    return {
      items: items.map((attempt, index) => ({
        ...attempt,
        status: toApiEnum(attempt.status),
        studentName: userMap.get(attempt.userId)?.realName ?? userMap.get(attempt.userId)?.username ?? attempt.userId,
        username: userMap.get(attempt.userId)?.username ?? '',
        attemptNo: attemptNoMap.get(attempt.id) ?? 1,
        objectiveScore: Number(attempt.objectiveScore),
        subjectiveScore: Number(attempt.subjectiveScore),
        judgeScore: Number(attempt.judgeScore),
        totalScore: Number(attempt.totalScore),
        rank: skip + index + 1,
      })),
      page,
      pageSize,
      total,
    };
  }

export async function statistics(ctx: ExamsContext, id: string, user: RequestUser) {
    await ctx.dataScope.assertExamAccessible(user, id);
    const attempts = await ctx.prisma.examAttempt.findMany({
      where: { examId: id, submittedAt: { not: null } },
      include: { answers: true },
    });
    const scores = attempts.map((attempt) => Number(attempt.totalScore));
    const submitCount = attempts.length;
    const averageScore = submitCount ? scores.reduce((sum, score) => sum + score, 0) / submitCount : 0;

    const questionStatsMap = new Map<string, { total: number; correct: number; score: number }>();
    for (const attempt of attempts) {
      for (const answer of attempt.answers) {
        const item = questionStatsMap.get(answer.questionId) ?? { total: 0, correct: 0, score: 0 };
        item.total += 1;
        item.correct += answer.isCorrect ? 1 : 0;
        item.score += Number(answer.score);
        questionStatsMap.set(answer.questionId, item);
      }
    }

    return {
      averageScore,
      maxScore: scores.length ? Math.max(...scores) : 0,
      minScore: scores.length ? Math.min(...scores) : 0,
      submitCount,
      studentCount: submitCount,
      passRate: submitCount
        ? scores.filter((score) => score >= averageScore).length / submitCount
        : 0,
      excellentRate: submitCount ? scores.filter((score) => score >= 90).length / submitCount : 0,
      questionStats: [...questionStatsMap.entries()].map(([questionId, value]) => ({
        questionId,
        correctRate: value.total ? value.correct / value.total : 0,
        averageScore: value.total ? value.score / value.total : 0,
      })),
      knowledgePointStats: [],
    };
  }

export function effectiveExamStatus(ctx: ExamsContext, exam: { status: ExamStatus; startTime: Date; endTime: Date }, now = new Date()) {
    if (exam.status === ExamStatus.DRAFT || exam.status === ExamStatus.ARCHIVED) return exam.status;
    if (exam.status === ExamStatus.ENDED || exam.endTime <= now) return ExamStatus.ENDED;
    if (exam.status === ExamStatus.RUNNING || exam.startTime <= now) return ExamStatus.RUNNING;
    return ExamStatus.SCHEDULED;
  }

export function examStatusWhere(ctx: ExamsContext, status?: string): Prisma.ExamWhereInput {
    if (!status) return {};
    const normalized = normalizeExamStatus(status);
    const now = new Date();
    if (normalized === ExamStatus.SCHEDULED) {
      return {
        status: ExamStatus.SCHEDULED,
        startTime: { gt: now },
      };
    }
    if (normalized === ExamStatus.RUNNING) {
      return {
        OR: [
          { status: ExamStatus.RUNNING, endTime: { gt: now } },
          { status: ExamStatus.SCHEDULED, startTime: { lte: now }, endTime: { gt: now } },
        ],
      };
    }
    if (normalized === ExamStatus.ENDED) {
      return {
        OR: [
          { status: ExamStatus.ENDED },
          { status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] }, endTime: { lte: now } },
        ],
      };
    }
    return { status: normalized };
  }

export function examOrderBy(ctx: ExamsContext, query: QueryExamDto): Prisma.ExamOrderByWithRelationInput[] {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderMap: Record<string, Prisma.ExamOrderByWithRelationInput> = {
      createdAt: { createdAt: direction },
      updatedAt: { updatedAt: direction },
      startTime: { startTime: direction },
      endTime: { endTime: direction },
      name: { name: direction },
      status: { status: direction },
      durationMinutes: { durationMinutes: direction },
    };
    const primary = orderMap[query.sortBy || 'createdAt'] ?? { createdAt: 'desc' };
    return query.sortBy && query.sortBy !== 'createdAt' ? [primary, { createdAt: 'desc' }] : [primary];
  }

export async function loadClassMap(ctx: ExamsContext, classIds: string[]) {
    if (!classIds.length) return new Map<string, { id: string; name: string }>();
    const classes = await ctx.prisma.classGroup.findMany({
      where: { id: { in: [...new Set(classIds)] }, deletedAt: null },
      select: { id: true, name: true },
    });
    return new Map(classes.map((item) => [item.id, item]));
  }

export async function studentsInClass(ctx: ExamsContext, classId: string) {
    const relations = await ctx.prisma.classStudent.findMany({
      where: {
        classId,
        status: ClassMemberStatus.ACTIVE,
        student: {
          userType: UserType.STUDENT,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
      },
      include: {
        student: {
          select: {
            id: true,
            username: true,
            realName: true,
            userType: true,
            status: true,
          },
        },
      },
    });

    return relations.map((relation) => relation.student);
  }
