/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AnswerRecordStatus,
  AttemptStatus,
  HydroAccount,
  MasteryStatus,
  Prisma,
  QuestionStatus,
  QuestionType,
  UserStatus,
  UserType,
  WrongQuestionSourceType,
} from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BindHydroAccountDto,
  BindHydroProblemDto,
  PullHydroProblemDto,
  QueryHydroSummaryDto,
  SaveHydroPlatformDto,
  SaveHydroTaskDto,
  SyncHydroTasksDto,
  SubmitHydroCodeDto,
  UpdateHydroTaskDto,
  WriteBackHydroResultDto,
} from './dto/hydro.dto';

type SnapshotQuestion = {
  questionId: string;
  score: number;
  snapshot: {
    id: string;
    type: string;
    title: string;
    content: string;
    programmingRef?: {
      judgeProvider: string;
      externalProblemId: string;
      externalProblemUrl?: string | null;
      languages?: string[];
      timeLimit?: number | null;
      memoryLimit?: number | null;
      judgeConfig?: Prisma.JsonValue | null;
    } | null;
  };
};

type PaperSnapshot = {
  sections: Array<{ questions: SnapshotQuestion[] }>;
};

type HydroSubmitResult = {
  mode: 'direct' | 'manual';
  externalSubmissionId?: string | null;
  problemUrl: string;
  recordUrl?: string | null;
  status?: string | null;
  score?: number | null;
  judgedAt?: string | null;
  result?: Record<string, unknown> | null;
  raw?: unknown;
  message?: string;
};

type HydroProblemBinding = {
  judgeProvider: string;
  externalProblemId: string;
  externalProblemUrl?: string | null;
  platformBaseUrl?: string | null;
  domainId?: string | null;
  domainName?: string | null;
  accountId?: string | null;
  accountLabel?: string | null;
  languages?: string[];
  timeLimit?: number | null;
  memoryLimit?: number | null;
  judgeConfig?: Prisma.JsonValue | null;
};

type HydroSession = {
  baseUrl: string;
  cookieHeader: () => string;
  fetch: (url: string, init?: RequestInit & { headers?: Record<string, string> }) => Promise<Response>;
};

type HydroRecordResult = {
  externalSubmissionId: string;
  recordUrl: string;
  status: string;
  score: number | null;
  passedTestCaseCount: number | null;
  totalTestCaseCount: number | null;
  message: string;
  judgedAt: string | null;
  final: boolean;
  result: Record<string, unknown>;
};

type ExternalOjPlatformRow = {
  id: string;
  code: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

type HydroTaskRecord = Prisma.HydroTaskGetPayload<Record<string, never>>;
import { HydroContext } from './hydro.context';
import { latestSubmissionMap, normalizeAnswerStatus } from './hydro-judge-format.operations';
import { average, loadUserMap } from './hydro-support.operations';
export async function summary(ctx: HydroContext, query: QueryHydroSummaryDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const examScope = await ctx.dataScope.examWhere(user, query.classId);
    const status = query.status ? normalizeAnswerStatus(ctx, query.status) : undefined;
    const where: Prisma.AnswerRecordWhereInput = {
      questionId: query.questionId,
      question: {
        type: QuestionType.PROGRAMMING,
        deletedAt: null,
        courseId: query.courseId,
      },
      status: status ?? { in: [AnswerRecordStatus.JUDGE_PENDING, AnswerRecordStatus.JUDGE_DONE] },
      attempt: {
        examId: query.examId,
        userId: query.studentId,
        submittedAt: { not: null },
        exam: {
          ...examScope,
          deletedAt: null,
          courseId: query.courseId,
        },
      },
      OR: query.keyword
        ? [
            { question: { title: { contains: query.keyword, mode: 'insensitive' } } },
            { attempt: { exam: { name: { contains: query.keyword, mode: 'insensitive' } } } },
          ]
        : undefined,
    };

    const [records, total, allRecords, submissionCount, pendingSubmissionCount] = await ctx.prisma.$transaction([
      ctx.prisma.answerRecord.findMany({
        where,
        include: {
          question: {
            include: {
              programmingRef: true,
              course: { select: { name: true } },
            },
          },
          attempt: {
            include: {
              exam: { include: { course: { select: { name: true } } } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      ctx.prisma.answerRecord.count({ where }),
      ctx.prisma.answerRecord.findMany({
        where,
        select: { id: true, questionId: true, attemptId: true, score: true, status: true, isCorrect: true },
      }),
      ctx.prisma.judgeSubmission.count({
        where: {
          questionId: query.questionId,
          studentId: query.studentId,
          attempt: {
            examId: query.examId,
            exam: {
              ...examScope,
              deletedAt: null,
              courseId: query.courseId,
            },
          },
        },
      }),
      ctx.prisma.judgeSubmission.count({
        where: {
          status: { in: ['pending', 'judging'] },
          questionId: query.questionId,
          studentId: query.studentId,
          attempt: {
            examId: query.examId,
            exam: {
              ...examScope,
              deletedAt: null,
              courseId: query.courseId,
            },
          },
        },
      }),
    ]);
    const users = await loadUserMap(ctx, records.map((item) => item.attempt.userId));
    const submissionsByQuestion = await latestSubmissionMap(ctx, 
      records.map((item) => ({ attemptId: item.attemptId, questionId: item.questionId })),
    );
    const scores = allRecords.map((item) => Number(item.score));
    const questionGroups = new Map<string, { title: string; total: number; done: number; score: number }>();
    for (const record of records) {
      const group = questionGroups.get(record.questionId) ?? {
        title: record.question.title,
        total: 0,
        done: 0,
        score: 0,
      };
      group.total += 1;
      group.done += record.status === AnswerRecordStatus.JUDGE_DONE ? 1 : 0;
      group.score += Number(record.score);
      questionGroups.set(record.questionId, group);
    }

    return {
      metrics: {
        answerCount: allRecords.length,
        submissionCount,
        pendingSubmissionCount,
        judgedCount: allRecords.filter((item) => item.status === AnswerRecordStatus.JUDGE_DONE).length,
        pendingCount: allRecords.filter((item) => item.status === AnswerRecordStatus.JUDGE_PENDING).length,
        averageScore: average(ctx, scores),
        maxScore: scores.length ? Math.max(...scores) : 0,
      },
      byQuestion: [...questionGroups.entries()].map(([questionId, item]) => ({
        questionId,
        title: item.title,
        answerCount: item.total,
        judgedCount: item.done,
        averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
      })),
      items: records.map((record) => {
        const student = users.get(record.attempt.userId);
        const latestSubmission = submissionsByQuestion.get(`${record.attemptId}:${record.questionId}`);
        return {
          answerRecordId: record.id,
          attemptId: record.attemptId,
          examId: record.attempt.examId,
          examName: record.attempt.exam.name,
          courseName: record.attempt.exam.course.name,
          studentId: record.attempt.userId,
          studentName: student?.realName ?? student?.username ?? '学生',
          username: student?.username ?? '',
          questionId: record.questionId,
          questionTitle: record.question.title,
          externalProblemId: record.question.programmingRef?.externalProblemId ?? '',
          externalProblemUrl: record.question.programmingRef?.externalProblemUrl ?? '',
          score: Number(record.score),
          isCorrect: record.isCorrect,
          status: toApiEnum(record.status),
          updatedAt: record.updatedAt,
          latestSubmission: latestSubmission
            ? {
                submissionId: latestSubmission.id,
                externalSubmissionId: latestSubmission.externalSubmissionId,
                language: latestSubmission.language,
                status: latestSubmission.status,
                score: latestSubmission.score === null ? null : Number(latestSubmission.score),
                submittedAt: latestSubmission.submittedAt,
                judgedAt: latestSubmission.judgedAt,
              }
            : null,
        };
      }),
      page,
      pageSize,
      total,
    };
  }
