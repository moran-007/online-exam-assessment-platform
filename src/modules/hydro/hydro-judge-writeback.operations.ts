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
import { findSnapshotQuestion, hydroScoreBreakdown, normalizeJudgeStatus } from './hydro-judge-format.operations';
import { recalculateAttempt } from './hydro-submission-sync.operations';
import { toRecord } from './hydro-support.operations';
export async function applyJudgeResult(ctx: HydroContext, dto: WriteBackHydroResultDto) {
    if (!dto.submissionId && !dto.externalSubmissionId) {
      throw new BadRequestException('缺少 submissionId 或 externalSubmissionId');
    }

    const submission = await ctx.prisma.judgeSubmission.findFirst({
      where: dto.submissionId
        ? { id: dto.submissionId }
        : {
            provider: 'hydro',
            externalSubmissionId: dto.externalSubmissionId,
          },
      include: {
        attempt: { include: { paperInstance: true } },
      },
    });
    if (!submission) throw new NotFoundException('判题提交记录不存在');

    const snapshot = findSnapshotQuestion(ctx, 
      submission.attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot,
      submission.questionId,
    );
    const maxScore = Number(snapshot?.score ?? 0);
    const normalizedStatus = normalizeJudgeStatus(ctx, dto.status);
    const scoreBreakdown = hydroScoreBreakdown(ctx, maxScore, normalizedStatus, dto.score, {
      ...toRecord(ctx, dto.result),
      passedTestCaseCount: dto.passedTestCaseCount ?? toRecord(ctx, dto.result).passedTestCaseCount,
      totalTestCaseCount: dto.totalTestCaseCount ?? toRecord(ctx, dto.result).totalTestCaseCount,
    });
    const score = scoreBreakdown.score;
    const isFullScore = scoreBreakdown.isFullScore;
    const judgedAt = dto.judgedAt ? new Date(dto.judgedAt) : new Date();
    const previousResult = toRecord(ctx, submission.resultJson);
    const hydroResult = toRecord(ctx, dto.result);
    const recordUrl = String(hydroResult.recordUrl ?? previousResult.recordUrl ?? '');
    const problemUrl = String(previousResult.problemUrl ?? hydroResult.problemUrl ?? '');
    const mode = String(previousResult.mode ?? hydroResult.mode ?? 'direct');
    const resultJson = {
      ...previousResult,
      ...hydroResult,
      message: dto.message ?? null,
      recordUrl: recordUrl || null,
      problemUrl: problemUrl || null,
      writebackStatus: dto.status,
      remoteScore: scoreBreakdown.remoteScore,
      passedTestCaseCount: scoreBreakdown.passedTestCaseCount,
      totalTestCaseCount: scoreBreakdown.totalTestCaseCount,
      scoreRate: scoreBreakdown.scoreRate,
    } as Prisma.InputJsonObject;
    const autoResultJson = {
      latestSubmissionId: submission.id,
      externalSubmissionId: submission.externalSubmissionId,
      status: normalizedStatus,
      message: dto.message ?? '',
      mode,
      problemUrl,
      recordUrl,
      language: String(hydroResult.language ?? previousResult.language ?? submission.language),
      result: hydroResult,
      remoteScore: scoreBreakdown.remoteScore,
      passedTestCaseCount: scoreBreakdown.passedTestCaseCount,
      totalTestCaseCount: scoreBreakdown.totalTestCaseCount,
      scoreRate: scoreBreakdown.scoreRate,
    } as Prisma.InputJsonObject;

    await ctx.prisma.$transaction(async (tx) => {
      await tx.judgeSubmission.update({
        where: { id: submission.id },
        data: {
          status: normalizedStatus,
          score,
          judgedAt,
          resultJson,
        },
      });

      await tx.answerRecord.upsert({
        where: {
          attemptId_questionId: {
            attemptId: submission.attemptId,
            questionId: submission.questionId,
          },
        },
        update: {
          score,
          isCorrect: isFullScore,
          status: AnswerRecordStatus.JUDGE_DONE,
          autoResultJson,
          gradedAt: judgedAt,
        },
        create: {
          attemptId: submission.attemptId,
          questionId: submission.questionId,
          answerJson: {
            language: submission.language,
            code: submission.codeSnapshot,
            latestSubmissionId: submission.id,
          } as Prisma.InputJsonObject,
          score,
          isCorrect: isFullScore,
          status: AnswerRecordStatus.JUDGE_DONE,
          autoResultJson,
          gradedAt: judgedAt,
        },
      });

      if (maxScore > 0 && score < maxScore) {
        await upsertProgrammingWrongQuestion(ctx, tx, {
          studentId: submission.studentId,
          questionId: submission.questionId,
          sourceType: WrongQuestionSourceType.EXAM,
          sourceId: submission.attempt.examId,
          score,
          wrongAnswerJson: {
            language: submission.language,
            code: submission.codeSnapshot,
            latestSubmissionId: submission.id,
            externalSubmissionId: submission.externalSubmissionId,
            status: normalizedStatus,
          } as Prisma.InputJsonObject,
          correctAnswerJson: snapshotAnswerJson(ctx, snapshot),
          eventType: 'exam_wrong',
          eventJson: {
            attemptId: submission.attemptId,
            submissionId: submission.id,
            externalSubmissionId: submission.externalSubmissionId,
            status: normalizedStatus,
            maxScore,
            remoteScore: scoreBreakdown.remoteScore,
            passedTestCaseCount: scoreBreakdown.passedTestCaseCount,
            totalTestCaseCount: scoreBreakdown.totalTestCaseCount,
            scoreRate: scoreBreakdown.scoreRate,
            message: dto.message ?? '',
          } as Prisma.InputJsonObject,
        });
      }

      await recalculateAttempt(ctx, tx, submission.attemptId);
    });

    return {
      submissionId: submission.id,
      externalSubmissionId: submission.externalSubmissionId,
      attemptId: submission.attemptId,
      questionId: submission.questionId,
      status: normalizedStatus,
      score,
      maxScore,
      remoteScore: scoreBreakdown.remoteScore,
      passedTestCaseCount: scoreBreakdown.passedTestCaseCount,
      totalTestCaseCount: scoreBreakdown.totalTestCaseCount,
      scoreRate: scoreBreakdown.scoreRate,
      isCorrect: isFullScore,
      judgedAt,
    };
  }

export async function upsertProgrammingWrongQuestion(ctx: HydroContext, 
    tx: Prisma.TransactionClient,
    params: {
      studentId: string;
      questionId: string;
      sourceType: WrongQuestionSourceType;
      sourceId: string;
      score: number;
      wrongAnswerJson: Prisma.InputJsonObject;
      correctAnswerJson: Prisma.InputJsonValue;
      eventType: string;
      eventJson: Prisma.InputJsonObject;
    },
  ) {
    const wrongItem = await tx.wrongQuestion.upsert({
      where: {
        studentId_questionId: {
          studentId: params.studentId,
          questionId: params.questionId,
        },
      },
      update: {
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        wrongAnswerJson: params.wrongAnswerJson,
        correctAnswerJson: params.correctAnswerJson,
        score: params.score,
        masteryStatus: MasteryStatus.UNMASTERED,
        wrongCount: { increment: 1 },
        lastWrongAt: new Date(),
      },
      create: {
        studentId: params.studentId,
        questionId: params.questionId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        wrongAnswerJson: params.wrongAnswerJson,
        correctAnswerJson: params.correctAnswerJson,
        score: params.score,
        masteryStatus: MasteryStatus.UNMASTERED,
      },
    });

    await tx.wrongQuestionEvent.create({
      data: {
        wrongQuestionId: wrongItem.id,
        studentId: params.studentId,
        questionId: params.questionId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        eventType: params.eventType,
        isCorrect: false,
        score: params.score,
        masteryStatus: MasteryStatus.UNMASTERED,
        eventJson: params.eventJson,
      },
    });
  }

export function snapshotAnswerJson(ctx: HydroContext, snapshot?: SnapshotQuestion) {
    const answer = (snapshot?.snapshot as { answer?: Prisma.JsonValue } | undefined)?.answer;
    return (answer ?? {}) as Prisma.InputJsonValue;
  }