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
export async function findAccessibleExam(ctx: HydroContext, examId: string, user: RequestUser) {
    await ctx.dataScope.assertExamAccessible(user, examId);
    const exam = await ctx.prisma.exam.findFirst({
      where: { id: examId, deletedAt: null },
      select: { id: true, name: true, courseId: true, classId: true },
    });
    if (!exam) throw new NotFoundException('考试不存在');
    return exam;
  }

export async function assertCourseExists(ctx: HydroContext, courseId: string) {
    const exists = await ctx.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('课程不存在');
  }

export function parseHydroTaskDate(ctx: HydroContext, value: string | null | undefined, label: string) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${label}格式不正确`);
    }
    return date;
  }

export function assertHydroTaskTimeRange(ctx: HydroContext, startTime?: Date | null, endTime?: Date | null) {
    if (startTime && endTime && startTime >= endTime) {
      throw new BadRequestException('Hydro 任务结束时间必须晚于开始时间');
    }
  }

export function requiredTaskText(ctx: HydroContext, value: unknown, label: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new BadRequestException(`请填写${label}`);
    return text;
  }

export function optionalTaskText(ctx: HydroContext, value: unknown) {
    const text = String(value ?? '').trim();
    return text || null;
  }

export async function findHydroTask(ctx: HydroContext, taskId: string) {
    const task = await ctx.prisma.hydroTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Hydro 任务不存在');
    return task;
  }

export async function assertHydroTaskAccessible(ctx: HydroContext, task: HydroTaskRecord, user: RequestUser) {
    if (ctx.dataScope.isUnrestricted(user)) return;
    if (task.examId) {
      await ctx.dataScope.assertExamAccessible(user, task.examId);
      return;
    }
    if (task.classId) {
      await ctx.dataScope.assertClassWritable(user, task.classId);
      return;
    }
    if (task.createdBy === user.id) return;
    throw new ForbiddenException('无权限访问该 Hydro 任务');
  }

export async function syncHydroTaskRecord(ctx: HydroContext, task: HydroTaskRecord, user: RequestUser) {
    if (!task.examId && !task.hydroProblemId) {
      throw new BadRequestException('Hydro 任务至少需要绑定考试或 Hydro 题号后才能同步');
    }
    const submissions = await ctx.prisma.judgeSubmission.findMany({
      where: {
        attempt: task.examId ? { examId: task.examId } : undefined,
        question: task.hydroProblemId
          ? {
              programmingRef: {
                is: {
                  externalProblemId: task.hydroProblemId,
                },
              },
            }
          : undefined,
      },
      include: {
        question: { select: { id: true, title: true, programmingRef: true } },
        attempt: { select: { id: true, examId: true, userId: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const latestByStudent = new Map<string, (typeof submissions)[number]>();
    const submitCountByStudent = new Map<string, number>();
    for (const submission of submissions) {
      submitCountByStudent.set(submission.studentId, (submitCountByStudent.get(submission.studentId) ?? 0) + 1);
      if (!latestByStudent.has(submission.studentId)) {
        latestByStudent.set(submission.studentId, submission);
      }
    }

    const studentIds = [...latestByStudent.keys()];
    const accounts = studentIds.length
      ? await ctx.prisma.hydroAccount.findMany({
          where: { studentId: { in: studentIds }, bindStatus: 'bound' },
          orderBy: { updatedAt: 'desc' },
        })
      : [];
    const accountMap = new Map<string, (typeof accounts)[number]>();
    for (const account of accounts) {
      if (!accountMap.has(account.studentId)) accountMap.set(account.studentId, account);
    }
    const existingResults = studentIds.length
      ? await ctx.prisma.hydroResult.findMany({
          where: { taskId: task.id, studentId: { in: studentIds } },
          orderBy: { updatedAt: 'desc' },
        })
      : [];
    const existingByStudent = new Map<string, (typeof existingResults)[number]>();
    const duplicateIds: string[] = [];
    for (const result of existingResults) {
      if (existingByStudent.has(result.studentId)) {
        duplicateIds.push(result.id);
      } else {
        existingByStudent.set(result.studentId, result);
      }
    }

    const syncedAt = new Date();
    await ctx.prisma.$transaction(async (tx) => {
      if (duplicateIds.length) {
        await tx.hydroResult.deleteMany({ where: { id: { in: duplicateIds } } });
      }
      for (const [studentId, latest] of latestByStudent.entries()) {
        const account = accountMap.get(studentId);
        const data = {
          hydroUserId: account?.hydroUserId ?? studentId,
          score: latest.score === null ? null : Number(latest.score),
          status: latest.status || 'pending',
          submitCount: submitCountByStudent.get(studentId) ?? 1,
          lastSubmitAt: latest.submittedAt,
          rawResult: {
            latestSubmissionId: latest.id,
            externalSubmissionId: latest.externalSubmissionId,
            questionId: latest.questionId,
            questionTitle: latest.question.title,
            provider: latest.provider,
            language: latest.language,
            judgedAt: latest.judgedAt?.toISOString() ?? null,
            result: latest.resultJson ?? null,
          } as Prisma.InputJsonObject,
          syncedAt,
        };
        const existing = existingByStudent.get(studentId);
        if (existing) {
          await tx.hydroResult.update({
            where: { id: existing.id },
            data,
          });
        } else {
          await tx.hydroResult.create({
            data: {
              taskId: task.id,
              studentId,
              ...data,
            },
          });
        }
      }
      if (task.status === 'draft' && latestByStudent.size) {
        await tx.hydroTask.update({ where: { id: task.id }, data: { status: 'active' } });
      }
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:sync-task-results',
      module: 'hydro',
      targetType: 'hydro_task',
      targetId: task.id,
      afterData: {
        submissionCount: submissions.length,
        syncedCount: latestByStudent.size,
        hydroProblemId: task.hydroProblemId,
      },
    });

    return {
      taskId: task.id,
      title: task.title,
      submissionCount: submissions.length,
      syncedCount: latestByStudent.size,
      duplicateCleanedCount: duplicateIds.length,
      syncedAt,
    };
  }