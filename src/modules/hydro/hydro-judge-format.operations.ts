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
import { decodeHtml, extractByRegex, stripTags } from './hydro-support.operations';
export function normalizeJudgeStatus(ctx: HydroContext, status: string) {
    const value = status.trim().toLowerCase().replace(/\s+/g, '_');
    if (['pending', 'queued', 'waiting', 'wait', 'waiting_judge'].includes(value) || /等待|排队/.test(status)) return 'pending';
    if (['compile_error', 'ce', 'compile_error_'].includes(value) || /编译错误/i.test(status)) return 'compile_error';
    if (['runtime_error', 're'].includes(value) || /运行错误|runtime/i.test(status)) return 'runtime_error';
    if (['time_limit_exceeded', 'time_limit_exceed', 'tle'].includes(value) || /时间超限|time limit/i.test(status)) return 'time_limit_exceeded';
    if (['memory_limit_exceeded', 'memory_limit_exceed', 'mle'].includes(value) || /内存超限|memory limit/i.test(status)) return 'memory_limit_exceeded';
    if (['system_error', 'se', 'failed', 'error', 'unknown'].includes(value) || /系统错误|system/i.test(status)) return 'system_error';
    if (
      ['wrong_answer', 'wa', 'partial_accepted', 'partially_accepted', 'partial'].includes(value) ||
      /答案错误|部分|未通过|不通过|wrong answer/i.test(status)
    ) {
      return 'wrong_answer';
    }
    if (['judging', 'running', 'compiling', 'fetched'].includes(value) || /评测中|运行中|编译中/.test(status)) return 'judging';
    const accepted = new Set(['accepted', 'accept', 'ac', 'ok', 'success', 'pass', 'passed']);
    if (accepted.has(value) || /通过|正确/.test(status)) return 'accepted';
    return value || 'unknown';
  }

export function extractHydroTestCaseSummary(ctx: HydroContext, html: string) {
    let passed = 0;
    let total = 0;
    const rowPattern = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
    for (const match of html.matchAll(rowPattern)) {
      const attributes = match[1] ?? '';
      const className = extractByRegex(ctx, attributes, /class=["']([^"']*)["']/i);
      const classes = className.split(/\s+/).filter(Boolean);
      if (!classes.includes('case') && !classes.includes('subtask-case')) continue;

      const body = match[2] ?? '';
      const statusText =
        extractByRegex(ctx, body, /<span[^>]*class=["'][^"']*record-status--text[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
        extractByRegex(ctx, body, /record-status--(?:text|icon)[^"']*\s+([^\s"']+)/i);
      const normalized = normalizeJudgeStatus(ctx, decodeHtml(ctx, stripTags(ctx, statusText)).trim());
      total += 1;
      if (normalized === 'accepted') passed += 1;
    }
    return { passed: total ? passed : null, total: total || null };
  }

export function hydroScoreBreakdown(ctx: HydroContext, 
    maxScore: number,
    status: string,
    remoteScore: number | null | undefined,
    result: Record<string, unknown>,
  ) {
    const normalizedStatus = normalizeJudgeStatus(ctx, status);
    const final = !['pending', 'judging'].includes(normalizedStatus);
    const accepted = normalizedStatus === 'accepted';
    const passedTestCaseCount = toNonNegativeInteger(ctx, result.passedTestCaseCount);
    const totalTestCaseCount = toNonNegativeInteger(ctx, result.totalTestCaseCount);
    const explicitScoreRate = toScoreRate(ctx, result.scoreRate);
    const numericRemoteScore = Number(remoteScore ?? result.remoteScore ?? result.score);
    const normalizedRemoteScore = Number.isFinite(numericRemoteScore) ? Math.min(Math.max(numericRemoteScore, 0), 100) : null;
    const testCaseScoreRate =
      totalTestCaseCount && passedTestCaseCount !== null
        ? Math.min(passedTestCaseCount, totalTestCaseCount) / totalTestCaseCount
        : null;
    const scoreRate =
      testCaseScoreRate !== null
        ? testCaseScoreRate
        : explicitScoreRate !== null
          ? explicitScoreRate
        : normalizedRemoteScore !== null
          ? normalizedRemoteScore / 100
          : accepted
            ? 1
            : 0;
    const safeMaxScore = Number.isFinite(maxScore) ? Math.max(maxScore, 0) : 0;
    const score = final ? Math.round(safeMaxScore * scoreRate * 100) / 100 : 0;
    return {
      score,
      scoreRate,
      remoteScore: normalizedRemoteScore,
      passedTestCaseCount,
      totalTestCaseCount,
      final,
      isFullScore:
        final &&
        safeMaxScore > 0 &&
        score >= safeMaxScore &&
        (!totalTestCaseCount || passedTestCaseCount === totalTestCaseCount),
    };
  }

export function storedJudgeScoreBreakdown(ctx: HydroContext, maxScore: number, status: string, storedScore: number, result: Record<string, unknown>) {
    const safeMaxScore = Number.isFinite(maxScore) ? Math.max(maxScore, 0) : 0;
    const hasTestCaseRatio =
      Boolean(toNonNegativeInteger(ctx, result.totalTestCaseCount)) &&
      toNonNegativeInteger(ctx, result.passedTestCaseCount) !== null;
    const hasExplicitRate = toScoreRate(ctx, result.scoreRate) !== null;
    const resultRemoteScore = Number(result.remoteScore ?? result.score);
    const storedLooksLikeRemoteScore = safeMaxScore > 0 && storedScore > safeMaxScore;

    if (hasTestCaseRatio || hasExplicitRate || Number.isFinite(resultRemoteScore) || storedLooksLikeRemoteScore) {
      const remoteScore = Number.isFinite(resultRemoteScore)
        ? resultRemoteScore
        : storedLooksLikeRemoteScore
          ? storedScore
          : null;
      return hydroScoreBreakdown(ctx, safeMaxScore, status, remoteScore, result);
    }

    const score = Number.isFinite(storedScore) ? Math.max(storedScore, 0) : 0;
    return {
      score,
      scoreRate: safeMaxScore > 0 ? Math.min(score / safeMaxScore, 1) : null,
      remoteScore: null,
      passedTestCaseCount: null,
      totalTestCaseCount: null,
      final: !['pending', 'judging'].includes(normalizeJudgeStatus(ctx, status)),
      isFullScore: isFullJudgeScore(ctx, safeMaxScore, score, result),
    };
  }

export function toNonNegativeInteger(ctx: HydroContext, value: unknown) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
  }

export function toScoreRate(ctx: HydroContext, value: unknown) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.min(numeric > 1 ? numeric / 100 : numeric, 1);
  }

export function isFullJudgeScore(ctx: HydroContext, maxScore: number, score: number, result: Record<string, unknown>) {
    const totalTestCaseCount = toNonNegativeInteger(ctx, result.totalTestCaseCount);
    const passedTestCaseCount = toNonNegativeInteger(ctx, result.passedTestCaseCount);
    if (totalTestCaseCount && passedTestCaseCount !== null) {
      return passedTestCaseCount === totalTestCaseCount;
    }

    const scoreRate = toScoreRate(ctx, result.scoreRate);
    if (scoreRate !== null) return scoreRate >= 1;

    const remoteScore = Number(result.remoteScore ?? result.score);
    if (Number.isFinite(remoteScore)) return remoteScore >= 100;

    const safeMaxScore = Number.isFinite(maxScore) ? Math.max(maxScore, 0) : 0;
    return safeMaxScore > 0 && Number.isFinite(score) && score >= safeMaxScore;
  }

export function attemptDeadline(ctx: HydroContext, attempt: { startedAt: Date; exam: { durationMinutes: number; endTime: Date } }) {
    const durationDeadline = new Date(attempt.startedAt.getTime() + attempt.exam.durationMinutes * 60 * 1000);
    return durationDeadline < attempt.exam.endTime ? durationDeadline : attempt.exam.endTime;
  }

export function normalizeAnswerStatus(ctx: HydroContext, status: string) {
    const value = status.replace(/-/g, '_').toLowerCase();
    if (value === 'pending') return AnswerRecordStatus.JUDGE_PENDING;
    if (value === 'done' || value === 'judged') return AnswerRecordStatus.JUDGE_DONE;
    if (value === 'all') return undefined;
    const enumKey = value.toUpperCase() as keyof typeof AnswerRecordStatus;
    const result = AnswerRecordStatus[enumKey];
    if (!result) throw new BadRequestException('Hydro 汇总状态不合法');
    return result;
  }

export function findSnapshotQuestion(ctx: HydroContext, paperSnapshot: PaperSnapshot, questionId: string) {
    return paperSnapshot.sections.flatMap((section) => section.questions).find((item) => item.questionId === questionId);
  }

export async function latestSubmissionMap(ctx: HydroContext, keys: Array<{ attemptId: string; questionId: string }>) {
    if (!keys.length) {
      return new Map<string, Prisma.JudgeSubmissionGetPayload<Record<string, never>>>();
    }
    const attemptIds = [...new Set(keys.map((item) => item.attemptId))];
    const questionIds = [...new Set(keys.map((item) => item.questionId))];
    const wanted = new Set(keys.map((item) => `${item.attemptId}:${item.questionId}`));
    const submissions = await ctx.prisma.judgeSubmission.findMany({
      where: { attemptId: { in: attemptIds }, questionId: { in: questionIds } },
      orderBy: { submittedAt: 'desc' },
    });
    const map = new Map<string, (typeof submissions)[number]>();
    for (const submission of submissions) {
      const key = `${submission.attemptId}:${submission.questionId}`;
      if (wanted.has(key) && !map.has(key)) {
        map.set(key, submission);
      }
    }
    return map;
  }