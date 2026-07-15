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
import { accountLabel, canManageOwnExternalAccounts, ensureStudent, findAccountForBinding, formatHydroAccount, isPrivilegedUser } from './hydro-account.operations';
import { formatProblemRef } from './hydro-external-format.operations';
import { normalizeHydroLanguage } from './hydro-html-parser.operations';
import { submitToHydro } from './hydro-http-gateway.operations';
import { hasHydroCredential } from './hydro-credential.operations';
import { attemptDeadline, findSnapshotQuestion, hydroScoreBreakdown, storedJudgeScoreBreakdown } from './hydro-judge-format.operations';
import { applyJudgeResult, upsertProgrammingWrongQuestion } from './hydro-judge-writeback.operations';
import { codeAnswerJson, isSyncableSubmission, syncSubmission } from './hydro-submission-sync.operations';
import { toRecord } from './hydro-support.operations';
export async function submitCode(ctx: HydroContext, attemptId: string, questionId: string, dto: SubmitHydroCodeDto, user: RequestUser) {
    ensureStudent(ctx, user);
    const attempt = await ctx.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: user.id },
      include: { exam: true, paperInstance: true },
    });
    if (!attempt) throw new NotFoundException('答题记录不存在');
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('当前答题记录已提交，不能继续提交代码');
    }
    if (attempt.exam.endTime <= new Date()) {
      throw new BadRequestException('考试已结束，不能提交代码');
    }
    if (attemptDeadline(ctx, attempt) <= new Date()) {
      throw new BadRequestException('答题时长已用完，不能继续提交代码');
    }

    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;
    const snapshotQuestion = findSnapshotQuestion(ctx, paperSnapshot, questionId);
    if (!snapshotQuestion) throw new BadRequestException('题目不属于当前试卷实例');
    if (String(snapshotQuestion.snapshot.type).toLowerCase() !== 'programming') {
      throw new BadRequestException('只有编程题可以提交代码');
    }

    const binding =
      snapshotQuestion.snapshot.programmingRef ??
      formatProblemRef(ctx, 
        await ctx.prisma.programmingProblemRef.findUniqueOrThrow({ where: { questionId } }).catch(() => {
          throw new BadRequestException('该编程题尚未绑定 Hydro 题目');
        }),
      );
    const language = normalizeHydroLanguage(ctx, dto.language, binding.languages);
    const submitDto = { ...dto, language };
    const hydroAccount = await findAccountForBinding(ctx, user.id, binding, dto.accountId);
    if (!hydroAccount) {
      throw new BadRequestException('请先在个人信息中绑定当前 Hydro 站点账号，再提交编程题代码');
    }
    if (!hydroAccount.loginUsername || !hasHydroCredential(hydroAccount)) {
      throw new BadRequestException('当前 Hydro 账号缺少登录账号或密码，请先补全后再提交');
    }
    const hydroUsername = hydroAccount.hydroUsername;
    const submitResult = await submitToHydro(ctx, binding, submitDto, hydroAccount);

    const submission = await ctx.prisma.$transaction(async (tx) => {
      const created = await tx.judgeSubmission.create({
        data: {
          attemptId,
          questionId,
          studentId: user.id,
          provider: binding.judgeProvider || 'hydro',
          externalSubmissionId: submitResult.externalSubmissionId,
          language,
          codeSnapshot: submitDto.code,
          status: 'pending',
          resultJson: {
            mode: submitResult.mode,
            problemUrl: submitResult.problemUrl,
            recordUrl: submitResult.recordUrl ?? null,
            language,
            hydroAccountId: hydroAccount.id,
            hydroAccountLabel: accountLabel(ctx, hydroAccount),
            raw: submitResult.raw ?? null,
            message: submitResult.message ?? null,
          } as Prisma.InputJsonObject,
        },
      });

      await tx.answerRecord.upsert({
        where: {
          attemptId_questionId: {
            attemptId,
            questionId,
          },
        },
        update: {
          answerJson: codeAnswerJson(ctx, submitDto, binding, created.id, submitResult),
          status: AnswerRecordStatus.JUDGE_PENDING,
          isCorrect: null,
          score: 0,
          autoResultJson: {
            latestSubmissionId: created.id,
            mode: submitResult.mode,
            problemUrl: submitResult.problemUrl,
            recordUrl: submitResult.recordUrl ?? null,
          } as Prisma.InputJsonObject,
        },
        create: {
          attemptId,
          questionId,
          answerJson: codeAnswerJson(ctx, submitDto, binding, created.id, submitResult),
          status: AnswerRecordStatus.JUDGE_PENDING,
          isCorrect: null,
          score: 0,
          autoResultJson: {
            latestSubmissionId: created.id,
            mode: submitResult.mode,
            problemUrl: submitResult.problemUrl,
            recordUrl: submitResult.recordUrl ?? null,
          } as Prisma.InputJsonObject,
        },
      });

      return created;
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:submit-code',
      module: 'hydro',
      targetType: 'judge_submission',
      targetId: submission.id,
      afterData: {
        attemptId,
        questionId,
        externalSubmissionId: submission.externalSubmissionId,
        mode: submitResult.mode,
      },
    });

    const synced = await syncSubmission(ctx, submission.id);
    if (synced) {
      const detail = await submissionDetail(ctx, submission.id, user);
      return {
        ...detail,
        hydroUsername,
        account: formatHydroAccount(ctx, hydroAccount),
        binding,
      };
    }

    return {
      submissionId: submission.id,
      externalSubmissionId: submission.externalSubmissionId,
      status: submitResult.status || submission.status,
      mode: submitResult.mode,
      problemUrl: submitResult.problemUrl,
      recordUrl: submitResult.recordUrl,
      score: submitResult.score ?? null,
      hydroUsername,
      language,
      account: formatHydroAccount(ctx, hydroAccount),
      binding,
      message:
        submitResult.message ||
        (submitResult.mode === 'direct'
          ? '代码已提交到 Hydro，等待判题回写'
          : '已记录本地提交；当前未配置自动提交适配，请在 Hydro 页面提交或由管理员回写结果'),
    };
  }

export async function submitPracticeCode(ctx: HydroContext, questionId: string, dto: SubmitHydroCodeDto, user: RequestUser) {
    if (!canManageOwnExternalAccounts(ctx, user)) {
      throw new ForbiddenException('请使用学生或教师账号提交编程题测试');
    }
    const question = await ctx.prisma.question.findFirst({
      where: { id: questionId, deletedAt: null, status: QuestionStatus.PUBLISHED, type: QuestionType.PROGRAMMING },
      include: { answer: true, programmingRef: true },
    });
    if (!question) throw new NotFoundException('编程题不存在或未发布');
    if (!question.programmingRef) throw new BadRequestException('该编程题尚未绑定 Hydro 题目');

    const binding = formatProblemRef(ctx, question.programmingRef);
    const language = normalizeHydroLanguage(ctx, dto.language, binding.languages);
    const hydroAccount = await findAccountForBinding(ctx, user.id, binding, dto.accountId);
    if (!hydroAccount) {
      throw new BadRequestException('请先在个人信息中绑定当前 Hydro 站点账号，再提交编程题代码');
    }
    if (!hydroAccount.loginUsername || !hasHydroCredential(hydroAccount)) {
      throw new BadRequestException('当前 Hydro 账号缺少登录账号或密码，请先补全后再提交');
    }

    const submitResult = await submitToHydro(ctx, 
      binding,
      { ...dto, language },
      hydroAccount,
      [1000, 2000, 3000, 5000, 5000],
    );
    const maxScore = Number(question.defaultScore);
    const scoreBreakdown = hydroScoreBreakdown(ctx, 
      maxScore,
      submitResult.status || 'pending',
      submitResult.score,
      toRecord(ctx, submitResult.result),
    );
    const practiceScore = scoreBreakdown.final ? scoreBreakdown.score : null;
    const shouldRecordWrong =
      user.userType === UserType.STUDENT &&
      Number.isFinite(maxScore) &&
      maxScore > 0 &&
      practiceScore !== null &&
      practiceScore < maxScore;

    if (shouldRecordWrong) {
      await ctx.prisma.$transaction(async (tx) => {
        await upsertProgrammingWrongQuestion(ctx, tx, {
          studentId: user.id,
          questionId,
          sourceType: WrongQuestionSourceType.PRACTICE,
          sourceId: questionId,
          score: practiceScore,
          wrongAnswerJson: {
            language,
            code: dto.code,
            externalSubmissionId: submitResult.externalSubmissionId ?? null,
            status: submitResult.status ?? null,
          } as Prisma.InputJsonObject,
          correctAnswerJson: (question.answer?.answerJson ?? {}) as Prisma.InputJsonObject,
          eventType: 'practice_wrong',
          eventJson: {
            externalSubmissionId: submitResult.externalSubmissionId ?? null,
            status: submitResult.status ?? null,
            maxScore,
            remoteScore: scoreBreakdown.remoteScore,
            passedTestCaseCount: scoreBreakdown.passedTestCaseCount,
            totalTestCaseCount: scoreBreakdown.totalTestCaseCount,
            scoreRate: scoreBreakdown.scoreRate,
            message: submitResult.message ?? '',
          } as Prisma.InputJsonObject,
        });
      });
    }

    return {
      questionId,
      questionTitle: question.title,
      externalSubmissionId: submitResult.externalSubmissionId,
      status: submitResult.status || 'pending',
      mode: submitResult.mode,
      problemUrl: submitResult.problemUrl,
      recordUrl: submitResult.recordUrl,
      score: practiceScore,
      maxScore,
      remoteScore: scoreBreakdown.remoteScore,
      passedTestCaseCount: scoreBreakdown.passedTestCaseCount,
      totalTestCaseCount: scoreBreakdown.totalTestCaseCount,
      scoreRate: scoreBreakdown.scoreRate,
      isCorrect: scoreBreakdown.final ? scoreBreakdown.isFullScore : null,
      wrongQuestionAdded: shouldRecordWrong,
      language,
      account: formatHydroAccount(ctx, hydroAccount),
      binding,
      result: submitResult.result ?? submitResult.raw ?? null,
      message: submitResult.message || '代码已提交到 Hydro',
      judgedAt: submitResult.judgedAt,
    };
  }

export async function submissionDetail(ctx: HydroContext, submissionId: string, user: RequestUser) {
    let submission = await ctx.prisma.judgeSubmission.findFirst({
      where: { id: submissionId },
      include: {
        question: { include: { programmingRef: true } },
        attempt: { include: { paperInstance: true } },
      },
    });
    if (!submission) throw new NotFoundException('判题提交记录不存在');
    if (submission.studentId !== user.id && !isPrivilegedUser(ctx, user)) {
      throw new ForbiddenException('无权查看该提交记录');
    }
    if (isSyncableSubmission(ctx, submission.status, submission.externalSubmissionId, submission.resultJson)) {
      await syncSubmission(ctx, submission.id);
      submission =
        (await ctx.prisma.judgeSubmission.findFirst({
          where: { id: submissionId },
          include: {
            question: { include: { programmingRef: true } },
            attempt: { include: { paperInstance: true } },
          },
        })) ?? submission;
    }
    const result = toRecord(ctx, submission.resultJson);
    const snapshot = findSnapshotQuestion(ctx, 
      submission.attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot,
      submission.questionId,
    );
    const maxScore = Number(snapshot?.score ?? 0);
    const storedScore = submission.score === null ? null : Number(submission.score);
    const scoreBreakdown =
      storedScore === null ? null : storedJudgeScoreBreakdown(ctx, maxScore, submission.status, storedScore, result);
    return {
      submissionId: submission.id,
      attemptId: submission.attemptId,
      examId: submission.attempt.examId,
      questionId: submission.questionId,
      questionTitle: submission.question.title,
      provider: submission.provider,
      externalSubmissionId: submission.externalSubmissionId,
      externalProblemId: submission.question.programmingRef?.externalProblemId ?? '',
      externalProblemUrl: submission.question.programmingRef?.externalProblemUrl ?? '',
      language: submission.language,
      status: submission.status,
      score: scoreBreakdown?.score ?? null,
      maxScore,
      isCorrect: scoreBreakdown?.isFullScore ?? null,
      remoteScore: result.remoteScore ?? scoreBreakdown?.remoteScore ?? null,
      passedTestCaseCount: result.passedTestCaseCount ?? scoreBreakdown?.passedTestCaseCount ?? null,
      totalTestCaseCount: result.totalTestCaseCount ?? scoreBreakdown?.totalTestCaseCount ?? null,
      scoreRate: result.scoreRate ?? scoreBreakdown?.scoreRate ?? null,
      message: String(result.message ?? ''),
      mode: String(result.mode ?? ''),
      problemUrl: String(result.problemUrl ?? ''),
      recordUrl: String(result.recordUrl ?? ''),
      submittedAt: submission.submittedAt,
      judgedAt: submission.judgedAt,
      result,
    };
  }

export async function writeBackResult(ctx: HydroContext, dto: WriteBackHydroResultDto, user: RequestUser) {
    const result = await applyJudgeResult(ctx, dto);
    await ctx.audit.log({
      userId: user.id,
      action: 'hydro:writeback-result',
      module: 'hydro',
      targetType: 'judge_submission',
      targetId: result.submissionId,
      afterData: { score: result.score, status: result.status },
    });
    return result;
  }

export async function writeBackCallback(ctx: HydroContext, dto: WriteBackHydroResultDto, headerSecret?: string) {
    const expected = process.env.HYDRO_CALLBACK_SECRET;
    if (expected && dto.secret !== expected && headerSecret !== expected) {
      throw new UnauthorizedException('Hydro 回写密钥不正确');
    }
    if (!expected && !process.env.HYDRO_ALLOW_UNSIGNED_CALLBACK) {
      throw new UnauthorizedException('未配置 HYDRO_CALLBACK_SECRET');
    }
    return applyJudgeResult(ctx, dto);
  }
