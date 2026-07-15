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
import { average, loadUserMap } from './hydro-support.operations';
import { assertHydroTaskAccessible, findHydroTask } from './hydro-task-sync.operations';
export async function tasks(ctx: HydroContext, query: QueryHydroSummaryDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where = await hydroTaskWhere(ctx, query, user);
    const [items, total] = await ctx.prisma.$transaction([
      ctx.prisma.hydroTask.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      ctx.prisma.hydroTask.count({ where }),
    ]);
    const [meta, metrics] = await Promise.all([
      hydroTaskMeta(ctx, items),
      hydroTaskMetrics(ctx, items.map((item) => item.id)),
    ]);

    return {
      items: items.map((item) => formatHydroTask(ctx, item, meta, metrics.get(item.id))),
      page,
      pageSize,
      total,
    };
  }

export async function taskResults(ctx: HydroContext, taskId: string, query: QueryHydroSummaryDto, user: RequestUser) {
    const task = await findHydroTask(ctx, taskId);
    await assertHydroTaskAccessible(ctx, task, user);
    const { page, pageSize, skip, take } = toPagination(query);
    const where: Prisma.HydroResultWhereInput = {
      taskId,
      studentId: query.studentId,
      status: query.status,
    };
    const [items, total, allResults] = await ctx.prisma.$transaction([
      ctx.prisma.hydroResult.findMany({
        where,
        orderBy: [{ lastSubmitAt: 'desc' }, { updatedAt: 'desc' }],
        skip,
        take,
      }),
      ctx.prisma.hydroResult.count({ where }),
      ctx.prisma.hydroResult.findMany({ where: { taskId }, select: { status: true, score: true } }),
    ]);
    const users = await loadUserMap(ctx, items.map((item) => item.studentId));
    const scores = allResults.map((item) => (item.score === null ? null : Number(item.score))).filter((score): score is number => score !== null);

    return {
      task: formatHydroTask(ctx, task, await hydroTaskMeta(ctx, [task]), (await hydroTaskMetrics(ctx, [task.id])).get(task.id)),
      metrics: {
        total: allResults.length,
        submittedCount: allResults.filter((item) => item.status !== 'not_started').length,
        judgedCount: allResults.filter((item) => ['accepted', 'judged', 'done'].includes(item.status)).length,
        averageScore: average(ctx, scores),
        maxScore: scores.length ? Math.max(...scores) : 0,
      },
      items: items.map((item) => {
        const student = users.get(item.studentId);
        return {
          id: item.id,
          taskId: item.taskId,
          studentId: item.studentId,
          studentName: student?.realName ?? student?.username ?? '学生',
          username: student?.username ?? '',
          hydroUserId: item.hydroUserId,
          score: item.score === null ? null : Number(item.score),
          status: item.status,
          submitCount: item.submitCount,
          lastSubmitAt: item.lastSubmitAt,
          syncedAt: item.syncedAt,
          rawResult: item.rawResult,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

export async function hydroTaskWhere(ctx: HydroContext, 
    query: Pick<QueryHydroSummaryDto, 'courseId' | 'classId' | 'examId' | 'status' | 'keyword'>,
    user: RequestUser,
  ): Promise<Prisma.HydroTaskWhereInput> {
    if (query.classId) {
      await ctx.dataScope.assertClassWritable(user, query.classId);
    }
    if (query.examId) {
      await ctx.dataScope.assertExamAccessible(user, query.examId);
    }

    const and: Prisma.HydroTaskWhereInput[] = [
      { courseId: query.courseId },
      { classId: query.classId },
      { examId: query.examId },
      { status: query.status },
    ].filter((item) => Object.values(item).some((value) => value !== undefined));

    if (query.keyword) {
      and.push({
        OR: [
          { title: { contains: query.keyword, mode: 'insensitive' } },
          { hydroProblemId: { contains: query.keyword, mode: 'insensitive' } },
          { hydroContestId: { contains: query.keyword, mode: 'insensitive' } },
        ],
      });
    }

    const classIds = await ctx.dataScope.classIdsFor(user);
    if (classIds !== null) {
      and.push({
        OR: [
          { classId: { in: classIds } },
          { classId: null, createdBy: user.id },
        ],
      });
    }

    return and.length ? { AND: and } : {};
  }

export async function hydroTaskMeta(ctx: HydroContext, tasks: HydroTaskRecord[]) {
    const courseIds = [...new Set(tasks.map((item) => item.courseId).filter((id): id is string => Boolean(id)))];
    const classIds = [...new Set(tasks.map((item) => item.classId).filter((id): id is string => Boolean(id)))];
    const examIds = [...new Set(tasks.map((item) => item.examId).filter((id): id is string => Boolean(id)))];
    const [courses, classes, exams] = await Promise.all([
      courseIds.length
        ? ctx.prisma.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      classIds.length
        ? ctx.prisma.classGroup.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      examIds.length
        ? ctx.prisma.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);

    return {
      courseNames: new Map(courses.map((item) => [item.id, item.name] as const)),
      classNames: new Map(classes.map((item) => [item.id, item.name] as const)),
      examNames: new Map(exams.map((item) => [item.id, item.name] as const)),
    };
  }

export async function hydroTaskMetrics(ctx: HydroContext, taskIds: string[]) {
    if (!taskIds.length) {
      return new Map<string, { resultCount: number; submittedCount: number; pendingCount: number; averageScore: number; maxScore: number }>();
    }
    const results = await ctx.prisma.hydroResult.findMany({
      where: { taskId: { in: taskIds } },
      select: { taskId: true, status: true, score: true },
    });
    const map = new Map<string, { resultCount: number; submittedCount: number; pendingCount: number; scores: number[] }>();
    for (const taskId of taskIds) {
      map.set(taskId, { resultCount: 0, submittedCount: 0, pendingCount: 0, scores: [] });
    }
    for (const result of results) {
      const metrics = map.get(result.taskId) ?? { resultCount: 0, submittedCount: 0, pendingCount: 0, scores: [] };
      metrics.resultCount += 1;
      if (result.status !== 'not_started') metrics.submittedCount += 1;
      if (['pending', 'judging'].includes(result.status)) metrics.pendingCount += 1;
      if (result.score !== null) metrics.scores.push(Number(result.score));
      map.set(result.taskId, metrics);
    }

    return new Map(
      [...map.entries()].map(([taskId, item]) => [
        taskId,
        {
          resultCount: item.resultCount,
          submittedCount: item.submittedCount,
          pendingCount: item.pendingCount,
          averageScore: average(ctx, item.scores),
          maxScore: item.scores.length ? Math.max(...item.scores) : 0,
        },
      ]),
    );
  }

export function formatHydroTask(ctx: HydroContext, 
    task: HydroTaskRecord,
    meta: Awaited<ReturnType<typeof hydroTaskMeta>>,
    metrics?: { resultCount: number; submittedCount: number; pendingCount: number; averageScore: number; maxScore: number },
  ) {
    return {
      id: task.id,
      title: task.title,
      courseId: task.courseId,
      courseName: task.courseId ? meta.courseNames.get(task.courseId) ?? '' : '',
      classId: task.classId,
      className: task.classId ? meta.classNames.get(task.classId) ?? '' : '',
      examId: task.examId,
      examName: task.examId ? meta.examNames.get(task.examId) ?? '' : '',
      hydroUrl: task.hydroUrl,
      hydroProblemId: task.hydroProblemId,
      hydroContestId: task.hydroContestId,
      startTime: task.startTime,
      endTime: task.endTime,
      status: task.status,
      resultCount: metrics?.resultCount ?? 0,
      submittedCount: metrics?.submittedCount ?? 0,
      pendingCount: metrics?.pendingCount ?? 0,
      averageScore: metrics?.averageScore ?? 0,
      maxScore: metrics?.maxScore ?? 0,
      createdBy: task.createdBy,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
