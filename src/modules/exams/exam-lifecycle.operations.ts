/* eslint-disable @typescript-eslint/no-unused-vars */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AnswerRecordStatus, AttemptStatus, ExamStatus, PaperStatus, Prisma, QuestionType, ScoringEvaluationSource, UserStatus, UserType } from '@prisma/client';
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
import { effectiveExamStatus } from './exam-query.operations';
import { update } from './exam-write.operations';
export async function publish(ctx: ExamsContext, id: string, user: RequestUser) {
    await ctx.dataScope.assertExamAccessible(user, id);
    const exam = await ctx.prisma.exam.findFirst({
      where: { id, deletedAt: null },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    const now = Date.now();
    const status =
      exam.endTime.getTime() <= now
        ? ExamStatus.ENDED
        : exam.startTime.getTime() <= now
          ? ExamStatus.RUNNING
          : ExamStatus.SCHEDULED;

    const updated = await ctx.prisma.exam.update({
      where: { id },
      data: { status, updatedBy: user.id },
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'exam:publish',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      afterData: { status: updated.status },
    });

    return { id, status: toApiEnum(updated.status) };
  }

export async function unpublish(ctx: ExamsContext, id: string, user: RequestUser) {
    await ctx.dataScope.assertExamAccessible(user, id);
    const exam = await ctx.prisma.exam.findFirst({
      where: { id, deletedAt: null },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    if (exam.status === ExamStatus.RUNNING || exam.status === ExamStatus.ENDED) {
      throw new BadRequestException('考试已开始或已结束，不能取消发布');
    }

    const updated = await ctx.prisma.exam.update({
      where: { id },
      data: { status: ExamStatus.DRAFT, updatedBy: user.id },
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'exam:unpublish',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      afterData: { status: updated.status },
    });

    return { id, status: toApiEnum(updated.status) };
  }

export async function start(ctx: ExamsContext, id: string, user: RequestUser) {
    await ctx.dataScope.assertExamAccessible(user, id);
    const exam = await ctx.prisma.exam.findFirst({
      where: { id, deletedAt: null },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    if (exam.status === ExamStatus.ARCHIVED) {
      throw new BadRequestException('归档考试不能直接启动');
    }

    const now = new Date();
    const effectiveStatus = effectiveExamStatus(ctx, exam, now);
    const isAlreadyRunning = effectiveStatus === ExamStatus.RUNNING;
    const nextStartTime = isAlreadyRunning ? exam.startTime : now;
    const nextEndTime = isAlreadyRunning
      ? exam.endTime
      : new Date(nextStartTime.getTime() + Math.max(1, exam.durationMinutes) * 60_000);
    const updated = await ctx.prisma.exam.update({
      where: { id },
      data: {
        status: ExamStatus.RUNNING,
        startTime: nextStartTime,
        endTime: nextEndTime,
        updatedBy: user.id,
      },
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'exam:start',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      beforeData: { status: exam.status, startTime: exam.startTime, endTime: exam.endTime },
      afterData: { status: updated.status, startTime: updated.startTime, endTime: updated.endTime },
    });

    return { id, status: toApiEnum(updated.status), startTime: updated.startTime, endTime: updated.endTime };
  }

export async function end(ctx: ExamsContext, id: string, user: RequestUser) {
    await ctx.dataScope.assertExamAccessible(user, id);
    const exam = await ctx.prisma.exam.findFirst({
      where: { id, deletedAt: null },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    const endedAt = new Date();
    let finalizedAttemptCount = 0;
    await ctx.prisma.$transaction(async (tx) => {
      await tx.exam.update({
        where: { id },
        data: {
          status: ExamStatus.ENDED,
          endTime: endedAt,
          updatedBy: user.id,
        },
      });

      const attempts = await tx.examAttempt.findMany({
        where: { examId: id, status: AttemptStatus.IN_PROGRESS },
        include: {
          exam: true,
          paperInstance: true,
          answers: true,
        },
      });
      for (const attempt of attempts) {
        await finalizeAttemptForManualEnd(ctx, tx, attempt, endedAt);
        finalizedAttemptCount += 1;
      }
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'exam:end',
      module: 'exam',
      targetType: 'exam',
      targetId: id,
      beforeData: { status: exam.status, endTime: exam.endTime },
      afterData: { status: ExamStatus.ENDED, endTime: endedAt, finalizedAttemptCount },
    });

    return {
      id,
      status: toApiEnum(ExamStatus.ENDED),
      endTime: endedAt,
      finalizedAttemptCount,
    };
  }

export async function bulkUpdateStatus(ctx: ExamsContext, dto: BulkUpdateExamStatusDto, user: RequestUser) {
    const status = normalizeExamStatus(dto.status);
    const ids = [...new Set(dto.ids)];
    const failed: Array<{ id: string; message: string }> = [];
    let successCount = 0;

    for (const id of ids) {
      try {
        await update(ctx, id, { status: toApiEnum(status) }, user);
        successCount += 1;
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : '状态更新失败' });
      }
    }

    await ctx.audit.log({
      userId: user.id,
      action: 'exam:bulk-update-status',
      module: 'exam',
      targetType: 'exam',
      targetId: ids[0],
      afterData: {
        ids,
        status: toApiEnum(status),
        successCount,
        failedCount: failed.length,
      },
    });

    return {
      status: toApiEnum(status),
      successCount,
      failed,
    };
  }

export async function finalizeAttemptForManualEnd(ctx: ExamsContext, 
    tx: Prisma.TransactionClient,
    attempt: Prisma.ExamAttemptGetPayload<{
      include: { exam: true; paperInstance: true; answers: true };
    }>,
    endedAt: Date,
  ) {
    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    let objectiveScore = 0;
    let subjectiveScore = 0;
    let judgeScore = 0;
    let hasManual = false;
    let hasJudge = false;

    for (const paperQuestion of flattenPaperQuestions(ctx, paperSnapshot)) {
      const existing = answerMap.get(paperQuestion.questionId);
      const answerJson = (existing?.answerJson as Record<string, unknown> | undefined) ?? {};
      const grading =
        String(paperQuestion.snapshot.type).toUpperCase() === QuestionType.PROGRAMMING &&
        existing?.status === AnswerRecordStatus.JUDGE_DONE
          ? {
              score: Number(existing.score),
              isCorrect: existing.isCorrect,
              status: AnswerRecordStatus.JUDGE_DONE,
              autoResult: existing.autoResultJson ?? {},
            }
          : gradeQuestionForEnd(ctx, paperQuestion, answerJson);

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
            attemptId: attempt.id,
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
          attemptId: attempt.id,
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
      where: { id: attempt.id },
      data: {
        submittedAt: endedAt,
        status: hasManual || hasJudge ? AttemptStatus.GRADING : AttemptStatus.GRADED,
        objectiveScore,
        subjectiveScore,
        judgeScore,
        totalScore: objectiveScore + subjectiveScore + judgeScore,
        durationSeconds: attemptDurationSeconds(ctx, attempt, endedAt),
      },
    });
  }

export function flattenPaperQuestions(ctx: ExamsContext, snapshot: PaperSnapshot) {
    const flatten = (question: SnapshotQuestion): SnapshotQuestion[] => {
      const children = Array.isArray(question.snapshot.children) ? question.snapshot.children : [];
      return children.length ? children.flatMap(flatten) : [question];
    };
    return snapshot.sections.flatMap((section) => section.questions.flatMap(flatten));
  }

export function gradeQuestionForEnd(ctx: ExamsContext, paperQuestion: SnapshotQuestion, answerJson: Record<string, unknown>) {
    const result = ctx.questionTypes.grade({
      snapshot: paperQuestion.snapshot,
      answer: answerJson as Prisma.InputJsonObject,
      maxScore: paperQuestion.score,
    });
    return { ...result, autoResult: result.details };
  }

export function attemptDurationSeconds(ctx: ExamsContext, 
    attempt: { startedAt: Date; exam?: { durationMinutes: number; endTime: Date } },
    endedAt: Date,
  ) {
    const durationDeadline = attempt.exam
      ? new Date(attempt.startedAt.getTime() + attempt.exam.durationMinutes * 60_000)
      : endedAt;
    const effectiveEnd = endedAt < durationDeadline ? endedAt : durationDeadline;
    return Math.max(0, Math.floor((effectiveEnd.getTime() - attempt.startedAt.getTime()) / 1000));
  }