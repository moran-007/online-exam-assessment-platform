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
import { extractDlValue } from './hydro-external-format.operations';
import { createHydroSession, isHydroBotChallenge } from './hydro-http-gateway.operations';
import { extractHydroTestCaseSummary, normalizeJudgeStatus } from './hydro-judge-format.operations';
import { applyJudgeResult } from './hydro-judge-writeback.operations';
import { absoluteHydroUrl, decodeHtml, extractByRegex, stripTags, toRecord } from './hydro-support.operations';
export async function fetchHydroRecordResult(ctx: HydroContext, 
    session: HydroSession,
    externalSubmissionId: string,
    recordUrl?: string,
  ): Promise<HydroRecordResult> {
    const targetUrl = recordUrl || `${session.baseUrl}/record/${encodeURIComponent(externalSubmissionId)}`;
    const response = await session.fetch(targetUrl, {
      redirect: 'manual',
      headers: { Referer: session.baseUrl },
    });
    const html = await response.text();
    if (isHydroBotChallenge(ctx, html, response.url || targetUrl)) {
      throw new BadRequestException(ctx.hydroBotChallengeMessage);
    }
    if (!response.ok) {
      throw new BadRequestException(`Hydro 结果读取失败：${response.status}`);
    }
    return parseHydroRecordHtml(ctx, html, externalSubmissionId, absoluteHydroUrl(ctx, targetUrl, session.baseUrl));
  }

export function parseHydroRecordHtml(ctx: HydroContext, html: string, externalSubmissionId: string, recordUrl: string): HydroRecordResult {
    const statusText =
      extractByRegex(ctx, html, /<span[^>]*class=["'][^"']*record-status--text[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) ||
      extractByRegex(ctx, html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const status = normalizeJudgeStatus(ctx, statusText);
    const scoreText =
      extractByRegex(ctx, html, /<dl[^>]*id=["']summary["'][\s\S]*?<dt>\s*分数\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i) ||
      extractByRegex(ctx, html, /<h1[^>]*class=["'][^"']*section__title[^"']*["'][\s\S]*?<span[^>]*style=["'][^"']*color:[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const parsedScore = Number(String(scoreText).trim());
    const score = Number.isFinite(parsedScore) && parsedScore >= 0 ? parsedScore : status === 'accepted' ? 100 : null;
    const testCaseSummary = extractHydroTestCaseSummary(ctx, html);
    const judgedTimestamp = extractByRegex(ctx, 
      html,
      /<dt>\s*评测时间\s*<\/dt>\s*<dd>\s*<span[^>]*data-timestamp=["']([^"']+)["'][^>]*>/i,
    );
    const judgedAtNumber = Number(judgedTimestamp);
    const judgedAt = Number.isFinite(judgedAtNumber) && judgedAtNumber > 0 ? new Date(judgedAtNumber * 1000).toISOString() : null;
    const message =
      extractByRegex(ctx, html, /<span[^>]*class=["']message["'][^>]*>([\s\S]*?)<\/span>/i) ||
      statusText ||
      status;
    const dataStatus = extractByRegex(ctx, html, /<div[^>]*id=["']status["'][^>]*data-status=["']([^"']+)["']/i);
    const language = extractDlValue(ctx, html, '语言');
    const submitter = extractByRegex(ctx, html, /<dt>\s*递交者\s*<\/dt>[\s\S]*?<a[^>]*class=["'][^"']*user-profile-name[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    return {
      externalSubmissionId,
      recordUrl,
      status,
      score,
      passedTestCaseCount: testCaseSummary.passed,
      totalTestCaseCount: testCaseSummary.total,
      message: decodeHtml(ctx, stripTags(ctx, message)).replace(/\s+/g, ' ').trim(),
      judgedAt,
      final: !['pending', 'judging'].includes(status),
      result: {
        externalSubmissionId,
        recordUrl,
        statusText: decodeHtml(ctx, stripTags(ctx, statusText)).replace(/\s+/g, ' ').trim(),
        dataStatus,
        score,
        remoteScore: score,
        passedTestCaseCount: testCaseSummary.passed,
        totalTestCaseCount: testCaseSummary.total,
        scoreRate: testCaseSummary.total ? (testCaseSummary.passed ?? 0) / testCaseSummary.total : null,
        language,
        submitter,
      },
    };
  }

export async function syncSubmission(ctx: HydroContext, submissionId: string) {
    const submission = await ctx.prisma.judgeSubmission.findFirst({
      where: { id: submissionId },
      include: { question: { include: { programmingRef: true } } },
    });
    if (!submission || !isSyncableSubmission(ctx, submission.status, submission.externalSubmissionId, submission.resultJson)) {
      return null;
    }
    const resultJson = toRecord(ctx, submission.resultJson);
    const accountId = String(resultJson.hydroAccountId ?? '');
    const account = accountId ? await ctx.prisma.hydroAccount.findFirst({ where: { id: accountId } }) : null;
    if (!account) return null;
    if (account.lastLoginStatus === 'blocked') return null;
    const session = await createHydroSession(ctx, account);
    const recordUrl = String(resultJson.recordUrl || '');
    const record = await fetchHydroRecordResult(ctx, session, submission.externalSubmissionId as string, recordUrl || undefined);
    if (!record.final) {
      await ctx.prisma.judgeSubmission.update({
        where: { id: submission.id },
        data: {
          status: record.status,
          resultJson: {
            ...resultJson,
            recordUrl: record.recordUrl,
            message: record.message,
            result: record.result,
          } as Prisma.InputJsonObject,
        },
      });
      return record;
    }
    await applyJudgeResult(ctx, {
      submissionId: submission.id,
      externalSubmissionId: submission.externalSubmissionId ?? undefined,
      status: record.status,
      score: record.score ?? undefined,
      passedTestCaseCount: record.passedTestCaseCount ?? undefined,
      totalTestCaseCount: record.totalTestCaseCount ?? undefined,
      message: record.message,
      judgedAt: record.judgedAt ?? undefined,
      result: {
        ...record.result,
        recordUrl: record.recordUrl,
      },
    });
    return record;
  }

export async function syncPendingSubmissions(ctx: HydroContext) {
    const submissions = await ctx.prisma.judgeSubmission.findMany({
      where: {
        status: { in: ['pending', 'judging'] },
        externalSubmissionId: { not: null },
      },
      orderBy: { submittedAt: 'asc' },
      take: 20,
    });
    for (const submission of submissions) {
      await syncSubmission(ctx, submission.id).catch(() => undefined);
    }
  }

export function isSyncableSubmission(ctx: HydroContext, status: string, externalSubmissionId: string | null, resultJson: Prisma.JsonValue | null) {
    const result = toRecord(ctx, resultJson);
    return Boolean(externalSubmissionId) && ['pending', 'judging'].includes(status) && result.mode === 'direct';
  }

export function codeAnswerJson(ctx: HydroContext, 
    dto: SubmitHydroCodeDto,
    binding: HydroProblemBinding,
    submissionId: string,
    submitResult: HydroSubmitResult,
  ): Prisma.InputJsonObject {
    return {
      text: dto.code,
      language: dto.language,
      code: dto.code,
      hydro: {
        submissionId,
        externalSubmissionId: submitResult.externalSubmissionId ?? null,
        externalProblemId: binding.externalProblemId,
        problemUrl: submitResult.problemUrl,
        mode: submitResult.mode,
      },
    } as Prisma.InputJsonObject;
  }

export async function recalculateAttempt(ctx: HydroContext, tx: Prisma.TransactionClient, attemptId: string) {
    const attempt = await tx.examAttempt.findUnique({
      where: { id: attemptId },
      select: { status: true, submittedAt: true },
    });
    const answers = await tx.answerRecord.findMany({ where: { attemptId } });
    let objectiveScore = 0;
    let subjectiveScore = 0;
    let judgeScore = 0;
    let hasManual = false;
    let hasJudge = false;

    for (const answer of answers) {
      const score = Number(answer.score);
      if (answer.status === AnswerRecordStatus.JUDGE_PENDING || answer.status === AnswerRecordStatus.JUDGE_DONE) {
        judgeScore += score;
        hasJudge ||= answer.status === AnswerRecordStatus.JUDGE_PENDING;
      } else if (answer.status === AnswerRecordStatus.MANUAL_NEEDED || answer.status === AnswerRecordStatus.MANUAL_GRADED) {
        subjectiveScore += score;
        hasManual ||= answer.status === AnswerRecordStatus.MANUAL_NEEDED;
      } else {
        objectiveScore += score;
      }
    }

    await tx.examAttempt.update({
      where: { id: attemptId },
      data: {
        objectiveScore,
        subjectiveScore,
        judgeScore,
        totalScore: objectiveScore + subjectiveScore + judgeScore,
        status:
          attempt?.status === AttemptStatus.IN_PROGRESS && !attempt.submittedAt
            ? AttemptStatus.IN_PROGRESS
            : hasManual || hasJudge
              ? AttemptStatus.GRADING
              : AttemptStatus.GRADED,
      },
    });
  }