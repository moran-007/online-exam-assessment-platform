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
import { attemptDeadline, attemptDurationSeconds } from './student-answer-save.operations';
import { result } from './student-attempt-result.operations';
import { flattenPaperQuestions } from './student-paper-format.operations';
import { ensureStudent, normalizePaperSnapshot } from './student-snapshot.operations';
import { gradeQuestion } from './student-wrong-analysis.operations';
export async function submit(ctx: StudentContext, attemptId: string, user: RequestUser) {
    ensureStudent(ctx, user);
    return submitForStudent(ctx, attemptId, user);
  }

export async function submitForStudent(ctx: StudentContext, attemptId: string, user: RequestUser) {
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

    if (
      attempt.status === AttemptStatus.GRADED ||
      attempt.status === AttemptStatus.GRADING ||
      attempt.status === AttemptStatus.SUBMITTED
    ) {
      return result(ctx, attemptId, user);
    }

    const submittedAt = new Date();
    const timedOut = attemptDeadline(ctx, attempt) <= submittedAt;
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

        if (grading.isCorrect === false) {
          const wrongItem = await tx.wrongQuestion.upsert({
            where: {
              studentId_questionId: {
                studentId: user.id,
                questionId: paperQuestion.questionId,
              },
            },
            update: {
              sourceType: WrongQuestionSourceType.EXAM,
              sourceId: attempt.examId,
              wrongAnswerJson: answerJson as Prisma.InputJsonObject,
              correctAnswerJson: (paperQuestion.snapshot.answer ?? {}) as Prisma.InputJsonObject,
              contextSnapshotJson: paperQuestion.materialContext ?? undefined,
              score: grading.score,
              masteryStatus: MasteryStatus.UNMASTERED,
              wrongCount: { increment: 1 },
              lastWrongAt: new Date(),
            },
            create: {
              studentId: user.id,
              questionId: paperQuestion.questionId,
              sourceType: WrongQuestionSourceType.EXAM,
              sourceId: attempt.examId,
              wrongAnswerJson: answerJson as Prisma.InputJsonObject,
              correctAnswerJson: (paperQuestion.snapshot.answer ?? {}) as Prisma.InputJsonObject,
              contextSnapshotJson: paperQuestion.materialContext ?? undefined,
              score: grading.score,
            },
          });
          await tx.wrongQuestionEvent.create({
            data: {
              wrongQuestionId: wrongItem.id,
              studentId: user.id,
              questionId: paperQuestion.questionId,
              sourceType: WrongQuestionSourceType.EXAM,
              sourceId: attempt.examId,
              eventType: 'exam_wrong',
              isCorrect: false,
              score: grading.score,
              masteryStatus: MasteryStatus.UNMASTERED,
              eventJson: {
                attemptId,
                selectedAnswer: answerJson,
                correctAnswer: paperQuestion.snapshot.answer ?? {},
              } as Prisma.InputJsonObject,
            },
          });
        }
      }

      const totalScore = objectiveScore + subjectiveScore + judgeScore;
      await tx.examAttempt.update({
        where: { id: attemptId },
        data: {
          status: timedOut ? AttemptStatus.TIMEOUT_SUBMITTED : hasManual || hasJudge ? AttemptStatus.GRADING : AttemptStatus.GRADED,
          submittedAt,
          objectiveScore,
          subjectiveScore,
          judgeScore,
          totalScore,
          durationSeconds: attemptDurationSeconds(ctx, attempt, submittedAt),
        },
      });
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'student:submit-attempt',
      module: 'student',
      targetType: 'attempt',
      targetId: attemptId,
      afterData: { objectiveScore, subjectiveScore, judgeScore },
    });

    return result(ctx, attemptId, user);
  }