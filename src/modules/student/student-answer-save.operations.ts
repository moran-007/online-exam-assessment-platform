/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AnswerRecordStatus,
  AttemptStatus,
  ExamStatus,
  MasteryStatus,
  PaperStatus,
  PaperType,
  Prisma,
  QuestionStatus,
  QuestionType,
  ScoringEvaluationSource,
  ShowAnswerMode,
  ShowScoreMode,
  UserStatus,
  UserType,
  WrongQuestionSourceType,
} from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { normalizeQuestionType, toApiEnum } from '../../common/utils/enum-normalizer';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddWrongQuestionDto,
  BatchWrongQuestionDto,
  GenerateWrongQuestionPaperDto,
  QueryWrongQuestionDto,
  QueryStudentExamDto,
  QueryStudentPaperDto,
  RecordWrongQuestionPracticeDto,
  SaveAnswerDto,
  SaveAnswersDto,
  UpdateWrongQuestionStatusDto,
} from './dto/save-answer.dto';
import { QuestionSnapshotUseCases } from '../questions/questions.use-cases';
import { QuestionTypeRegistry } from '../question-types/question-type-registry.service';
import { ScoringHistoryService } from '../question-types/scoring-history.service';

type QuestionSnapshot = {
  id: string;
  type: string;
  title: string;
  content: string;
  analysis?: string | null;
  defaultScore: number;
  allowOptionShuffle?: boolean;
  options?: Array<{
    id: string;
    optionKey: string;
    content: string;
    isCorrect?: boolean;
    sortOrder: number;
  }>;
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
  programmingRef?: {
    judgeProvider: string;
    externalProblemId: string;
    externalProblemUrl?: string | null;
    languages?: string[];
    timeLimit?: number | null;
    memoryLimit?: number | null;
    judgeConfig?: Prisma.JsonValue | null;
  } | null;
  scoringRule?: Prisma.JsonValue | null;
  scoringRuleVersionId?: string | null;
  engine?: { adapterKey?: string; adapterVersion?: number };
  children?: PaperSnapshotQuestion[];
};

type SnapshotNormalizationResult = {
  snapshot: PaperSnapshot;
  changed: boolean;
};

type PaperSnapshotQuestion = {
  paperQuestionId: string;
  questionId: string;
  score: number;
  sortOrder: number;
  snapshot: QuestionSnapshot;
  materialContext?: Prisma.InputJsonObject;
};

type PaperSnapshotSection = {
  id: string | null;
  title: string;
  sortOrder: number;
  questions: PaperSnapshotQuestion[];
};

type PaperSnapshot = {
  id: string;
  name: string;
  totalScore: number;
  durationMinutes: number;
  sections: PaperSnapshotSection[];
};

type ResultVisibility = {
  score: boolean;
  questionScore: boolean;
  content: boolean;
  studentAnswer: boolean;
  correctness: boolean;
  correctAnswer: boolean;
  analysis: boolean;
  restricted: boolean;
  reason: string;
};
import { StudentContext } from './student.context';
import { assertQuestionInPaper } from './student-attempt-result.operations';
import { flattenPaperQuestions } from './student-paper-format.operations';
import { answerCode, ensureStudent, normalizePaperSnapshot, nullableJsonInput } from './student-snapshot.operations';
import { gradeQuestion } from './student-wrong-analysis.operations';
export async function saveAnswer(ctx: StudentContext, attemptId: string, dto: SaveAnswerDto, user: RequestUser) {
    const attempt = await findEditableAttempt(ctx, attemptId, user);
    await saveAnswerRecord(ctx, attempt, dto);

    return {
      saved: true,
      savedAt: new Date().toISOString(),
    };
  }

export async function saveAnswers(ctx: StudentContext, attemptId: string, dto: SaveAnswersDto, user: RequestUser) {
    return saveAnswersForStudent(ctx, attemptId, dto, user);
  }

export async function saveAnswersForStudent(ctx: StudentContext, attemptId: string, dto: SaveAnswersDto, user: RequestUser) {
    const finalizeEndedAttempt = Boolean(dto.finalizeEndedAttempt);
    const attempt = await findSavableAttempt(ctx, attemptId, user, { finalizeEndedAttempt });

    for (const answer of dto.answers) {
      await saveAnswerRecord(ctx, attempt, answer);
    }

    const shouldFinalize = finalizeEndedAttempt && shouldFinalizeAfterSave(ctx, attempt);
    if (shouldFinalize) {
      await recalculateSavedAttempt(ctx, attemptId, user, new Date());
    }

    return {
      saved: true,
      finalized: shouldFinalize,
      savedAt: new Date().toISOString(),
    };
  }

export async function saveAnswerRecord(ctx: StudentContext, 
    attempt: Prisma.ExamAttemptGetPayload<{
      include: { exam: true; paperInstance: true };
    }>,
    dto: SaveAnswerDto,
  ) {
    const paperSnapshot = normalizePaperSnapshot(ctx, attempt.paperInstance.paperSnapshotJson).snapshot;
    const paperQuestion = assertQuestionInPaper(ctx, paperSnapshot, dto.questionId);
    const existing = await ctx.prisma.answerRecord.findUnique({
      where: {
        attemptId_questionId: {
          attemptId: attempt.id,
          questionId: dto.questionId,
        },
      },
    });
    const preserveJudgeStatus =
      paperQuestion.snapshot.type.toUpperCase() === QuestionType.PROGRAMMING &&
      Boolean(existing) &&
      (existing?.status === AnswerRecordStatus.JUDGE_PENDING || existing?.status === AnswerRecordStatus.JUDGE_DONE) &&
      answerCode(ctx, existing?.answerJson) === answerCode(ctx, dto.answer);

    await ctx.prisma.answerRecord.upsert({
      where: {
        attemptId_questionId: {
          attemptId: attempt.id,
          questionId: dto.questionId,
        },
      },
      update: {
        answerJson: dto.answer as Prisma.InputJsonObject,
        status: preserveJudgeStatus ? existing?.status : AnswerRecordStatus.SAVED,
        score: preserveJudgeStatus ? existing?.score : undefined,
        isCorrect: preserveJudgeStatus ? existing?.isCorrect : undefined,
        autoResultJson: preserveJudgeStatus ? nullableJsonInput(ctx, existing?.autoResultJson) : undefined,
      },
      create: {
        attemptId: attempt.id,
        questionId: dto.questionId,
        answerJson: dto.answer as Prisma.InputJsonObject,
        status: AnswerRecordStatus.SAVED,
      },
    });
  }

export async function findSavableAttempt(ctx: StudentContext, 
    attemptId: string,
    user: RequestUser,
    options: { finalizeEndedAttempt?: boolean } = {},
  ) {
    ensureStudent(ctx, user);
    const attempt = await ctx.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: user.id },
      include: { exam: true, paperInstance: true },
    });

    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }

    if (attempt.status === AttemptStatus.IN_PROGRESS) {
      const now = new Date();
      const deadline = attemptDeadline(ctx, attempt);
      if (attempt.exam.endTime <= now || deadline <= now) {
        if (options.finalizeEndedAttempt && canFinalizeEndedAttemptSave(ctx, attempt, now)) {
          return attempt;
        }
        throw new BadRequestException(
          attempt.exam.endTime <= now ? '考试已结束，不能保存答案' : '答题时长已用完，不能继续保存答案，请提交试卷',
        );
      }
      return attempt;
    }

    if (options.finalizeEndedAttempt && canFinalizeEndedAttemptSave(ctx, attempt)) {
      return attempt;
    }

    throw new BadRequestException('答案已提交，不能修改');
  }

export async function findEditableAttempt(ctx: StudentContext, attemptId: string, user: RequestUser) {
    ensureStudent(ctx, user);
    const attempt = await ctx.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: user.id },
      include: { exam: true, paperInstance: true },
    });

    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }

    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('答案已提交，不能修改');
    }

    if (attempt.exam.endTime <= new Date()) {
      throw new BadRequestException('考试已结束，不能保存答案');
    }

    if (attemptDeadline(ctx, attempt) <= new Date()) {
      throw new BadRequestException('答题时长已用完，不能继续保存答案，请提交试卷');
    }

    return attempt;
  }

export function canFinalizeEndedAttemptSave(ctx: StudentContext, 
    attempt: {
      status: AttemptStatus;
      submittedAt: Date | null;
      startedAt: Date;
      exam: { status: ExamStatus; endTime: Date; durationMinutes: number };
    },
    now = new Date(),
  ) {
    const salvageableStatuses = new Set<AttemptStatus>([
      AttemptStatus.IN_PROGRESS,
      AttemptStatus.SUBMITTED,
      AttemptStatus.GRADING,
      AttemptStatus.GRADED,
      AttemptStatus.TIMEOUT_SUBMITTED,
    ]);
    if (!salvageableStatuses.has(attempt.status)) {
      return false;
    }

    const deadline = attemptDeadline(ctx, attempt);
    if (deadline > now) return false;
    return now.getTime() - deadline.getTime() <= ctx.endedAttemptSaveGraceMs;
  }

export function shouldFinalizeAfterSave(ctx: StudentContext, attempt: {
    status: AttemptStatus;
    submittedAt: Date | null;
    startedAt: Date;
    exam: { status: ExamStatus; endTime: Date; durationMinutes: number };
  }) {
    return canFinalizeEndedAttemptSave(ctx, attempt);
  }

export async function recalculateSavedAttempt(ctx: StudentContext, attemptId: string, user: RequestUser, finalizedAt: Date) {
    const attempt = await ctx.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: user.id },
      include: {
        exam: true,
        paperInstance: true,
        answers: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }

    const paperSnapshot = normalizePaperSnapshot(ctx, attempt.paperInstance.paperSnapshotJson).snapshot;
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    let objectiveScore = 0;
    let subjectiveScore = 0;
    let judgeScore = 0;
    let hasManual = false;
    let hasJudge = false;

    await ctx.prisma.$transaction(async (tx) => {
      for (const paperQuestion of flattenPaperQuestions(ctx, paperSnapshot)) {
        const existing = answerMap.get(paperQuestion.questionId);
        const answerJson = (existing?.answerJson as Record<string, unknown>) ?? {};
        const grading =
          paperQuestion.snapshot.type.toUpperCase() === QuestionType.PROGRAMMING &&
          existing?.status === AnswerRecordStatus.JUDGE_DONE
            ? {
                score: Number(existing.score),
                isCorrect: existing.isCorrect,
                status: AnswerRecordStatus.JUDGE_DONE,
                autoResult: existing.autoResultJson ?? {},
              }
            : gradeQuestion(ctx, paperQuestion, answerJson);

        if (grading.status === AnswerRecordStatus.AUTO_GRADED) {
          objectiveScore += grading.score;
        } else if (grading.status === AnswerRecordStatus.MANUAL_NEEDED) {
          hasManual = true;
          subjectiveScore += grading.score;
        } else if (grading.status === AnswerRecordStatus.JUDGE_PENDING || grading.status === AnswerRecordStatus.JUDGE_DONE) {
          hasJudge ||= grading.status === AnswerRecordStatus.JUDGE_PENDING;
          judgeScore += grading.score;
        }

        const answerRecord = await tx.answerRecord.upsert({
          where: {
            attemptId_questionId: {
              attemptId,
              questionId: paperQuestion.questionId,
            },
          },
          update: {
            answerJson: answerJson as Prisma.InputJsonObject,
            isCorrect: grading.isCorrect,
            score: grading.score,
            status: grading.status,
            autoResultJson: grading.autoResult as Prisma.InputJsonObject,
          },
          create: {
            attemptId,
            questionId: paperQuestion.questionId,
            answerJson: answerJson as Prisma.InputJsonObject,
            isCorrect: grading.isCorrect,
            score: grading.score,
            status: grading.status,
            autoResultJson: grading.autoResult as Prisma.InputJsonObject,
          },
        });
        await ctx.scoringHistory.recordOfficial(tx, {
          answerRecordId: answerRecord.id,
          answerJson: answerRecord.answerJson,
          score: grading.score,
          maxScore: paperQuestion.score,
          isCorrect: grading.isCorrect,
          status: grading.status,
          details: grading.autoResult as Prisma.InputJsonObject,
          adapterKey: String(paperQuestion.snapshot.type).toLowerCase(),
          adapterVersion: ctx.questionTypes.descriptor(paperQuestion.snapshot.type).version,
          source: grading.status === AnswerRecordStatus.JUDGE_DONE ? ScoringEvaluationSource.JUDGE : ScoringEvaluationSource.AUTO,
          scoringRuleVersionId: (paperQuestion.snapshot as any).scoringRuleVersionId ?? null,
          ruleSnapshot: (paperQuestion.snapshot as any).scoringRule ?? null,
        });
      }

      await tx.examAttempt.update({
        where: { id: attemptId },
        data: {
          status: hasManual || hasJudge ? AttemptStatus.GRADING : AttemptStatus.GRADED,
          submittedAt: attempt.submittedAt ?? finalizedAt,
          objectiveScore,
          subjectiveScore,
          judgeScore,
          totalScore: objectiveScore + subjectiveScore + judgeScore,
          durationSeconds: attemptDurationSeconds(ctx, attempt, attempt.submittedAt ?? finalizedAt),
        },
      });
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'student:finalize-saved-attempt',
      module: 'student',
      targetType: 'attempt',
      targetId: attemptId,
      afterData: { objectiveScore, subjectiveScore, judgeScore, salvaged: true },
    });
  }

export function attemptDeadline(ctx: StudentContext, attempt: { startedAt: Date; exam: { durationMinutes: number; endTime: Date } }) {
    const durationDeadline = new Date(attempt.startedAt.getTime() + attempt.exam.durationMinutes * 60_000);
    return durationDeadline < attempt.exam.endTime ? durationDeadline : attempt.exam.endTime;
  }

export function attemptDurationSeconds(ctx: StudentContext, 
    attempt: { startedAt: Date; exam: { durationMinutes: number; endTime: Date } },
    now = new Date(),
  ) {
    const deadline = attemptDeadline(ctx, attempt);
    const effectiveEnd = now < deadline ? now : deadline;
    return Math.max(0, Math.floor((effectiveEnd.getTime() - attempt.startedAt.getTime()) / 1000));
  }