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
import { syncSubmission } from './hydro-submission-sync.operations';
import { toRecord } from './hydro-support.operations';
import { formatHydroTask, hydroTaskMeta, hydroTaskMetrics, hydroTaskWhere } from './hydro-task-query.operations';
import { assertCourseExists, assertHydroTaskAccessible, assertHydroTaskTimeRange, findAccessibleExam, findHydroTask, optionalTaskText, parseHydroTaskDate, requiredTaskText, syncHydroTaskRecord } from './hydro-task-sync.operations';
export async function createTask(ctx: HydroContext, dto: SaveHydroTaskDto, user: RequestUser) {
    const exam = dto.examId ? await findAccessibleExam(ctx, dto.examId, user) : null;
    const courseId = dto.courseId ?? exam?.courseId ?? null;
    const classId = dto.classId ?? exam?.classId ?? null;
    if (classId) {
      await ctx.dataScope.assertClassWritable(user, classId);
    }
    if (courseId) {
      await assertCourseExists(ctx, courseId);
    }

    const startTime = parseHydroTaskDate(ctx, dto.startTime, '开始时间');
    const endTime = parseHydroTaskDate(ctx, dto.endTime, '结束时间');
    assertHydroTaskTimeRange(ctx, startTime, endTime);
    const task = await ctx.prisma.hydroTask.create({
      data: {
        title: requiredTaskText(ctx, dto.title, '任务标题'),
        courseId,
        classId,
        examId: dto.examId ?? null,
        hydroUrl: requiredTaskText(ctx, dto.hydroUrl, 'Hydro 地址'),
        hydroProblemId: optionalTaskText(ctx, dto.hydroProblemId),
        hydroContestId: optionalTaskText(ctx, dto.hydroContestId),
        startTime,
        endTime,
        status: dto.status ?? 'draft',
        createdBy: user.id,
      },
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:create-task',
      module: 'hydro',
      targetType: 'hydro_task',
      targetId: task.id,
      afterData: { title: task.title, examId: task.examId, hydroProblemId: task.hydroProblemId },
    });

    const [meta, metrics] = await Promise.all([
      hydroTaskMeta(ctx, [task]),
      hydroTaskMetrics(ctx, [task.id]),
    ]);
    return formatHydroTask(ctx, task, meta, metrics.get(task.id));
  }

export async function updateTask(ctx: HydroContext, taskId: string, dto: UpdateHydroTaskDto, user: RequestUser) {
    const task = await findHydroTask(ctx, taskId);
    await assertHydroTaskAccessible(ctx, task, user);
    const data: Prisma.HydroTaskUpdateInput = {};

    if (dto.title !== undefined) data.title = requiredTaskText(ctx, dto.title, '任务标题');
    if (dto.hydroUrl !== undefined) data.hydroUrl = requiredTaskText(ctx, dto.hydroUrl, 'Hydro 地址');
    if (dto.hydroProblemId !== undefined) data.hydroProblemId = optionalTaskText(ctx, dto.hydroProblemId);
    if (dto.hydroContestId !== undefined) data.hydroContestId = optionalTaskText(ctx, dto.hydroContestId);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.startTime !== undefined) data.startTime = parseHydroTaskDate(ctx, dto.startTime, '开始时间');
    if (dto.endTime !== undefined) data.endTime = parseHydroTaskDate(ctx, dto.endTime, '结束时间');
    if (dto.examId !== undefined) {
      if (dto.examId) {
        const exam = await findAccessibleExam(ctx, dto.examId, user);
        data.examId = exam.id;
        data.courseId = dto.courseId === undefined ? exam.courseId : data.courseId;
        data.classId = dto.classId === undefined ? exam.classId : data.classId;
      } else {
        data.examId = null;
      }
    }
    if (dto.classId !== undefined) {
      const classId = optionalTaskText(ctx, dto.classId);
      if (classId) {
        await ctx.dataScope.assertClassWritable(user, classId);
      }
      data.classId = classId;
    }
    if (dto.courseId !== undefined) {
      const courseId = optionalTaskText(ctx, dto.courseId);
      if (courseId) {
        await assertCourseExists(ctx, courseId);
      }
      data.courseId = courseId;
    }

    const nextStartTime = (data.startTime as Date | null | undefined) ?? task.startTime;
    const nextEndTime = (data.endTime as Date | null | undefined) ?? task.endTime;
    assertHydroTaskTimeRange(ctx, nextStartTime, nextEndTime);
    const updated = await ctx.prisma.hydroTask.update({ where: { id: taskId }, data });

    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:update-task',
      module: 'hydro',
      targetType: 'hydro_task',
      targetId: taskId,
      beforeData: { title: task.title, status: task.status },
      afterData: { title: updated.title, status: updated.status },
    });

    const [meta, metrics] = await Promise.all([
      hydroTaskMeta(ctx, [updated]),
      hydroTaskMetrics(ctx, [updated.id]),
    ]);
    return formatHydroTask(ctx, updated, meta, metrics.get(updated.id));
  }

export async function syncTasks(ctx: HydroContext, dto: SyncHydroTasksDto, user: RequestUser) {
    const where = await hydroTaskWhere(ctx, dto, user);
    const taskIds = dto.taskIds?.filter(Boolean);
    const tasks = await ctx.prisma.hydroTask.findMany({
      where: taskIds?.length ? { AND: [where, { id: { in: [...new Set(taskIds)] } }] } : where,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    const items: Array<{
      taskId: string;
      title: string;
      submissionCount: number;
      syncedCount: number;
      duplicateCleanedCount: number;
      syncedAt: Date;
    }> = [];
    for (const task of tasks) {
      items.push(await syncHydroTaskRecord(ctx, task, user));
    }

    return {
      syncedTaskCount: items.length,
      submissionCount: items.reduce((sum, item) => sum + item.submissionCount, 0),
      resultCount: items.reduce((sum, item) => sum + item.syncedCount, 0),
      items,
    };
  }

export async function syncTaskResults(ctx: HydroContext, taskId: string, user: RequestUser) {
    const task = await findHydroTask(ctx, taskId);
    await assertHydroTaskAccessible(ctx, task, user);
    return syncHydroTaskRecord(ctx, task, user);
  }

export async function retryFailedTaskResults(ctx: HydroContext, taskId: string, user: RequestUser) {
    const task = await findHydroTask(ctx, taskId);
    await assertHydroTaskAccessible(ctx, task, user);
    const failedResults = await ctx.prisma.hydroResult.findMany({
      where: {
        taskId,
        status: { in: ['failed', 'error', 'pending', 'judging'] },
      },
    });
    let retriedCount = 0;
    for (const result of failedResults) {
      const raw = toRecord(ctx, result.rawResult);
      const latestSubmissionId = String(raw.latestSubmissionId ?? '');
      if (!latestSubmissionId) continue;
      const synced = await syncSubmission(ctx, latestSubmissionId).catch(() => null);
      if (synced) retriedCount += 1;
    }
    const synced = await syncHydroTaskRecord(ctx, task, user);
    return { ...synced, retriedCount };
  }