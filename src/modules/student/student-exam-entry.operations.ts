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
import { assertExamCanEnter } from './student-attempt-result.operations';
import { activeAnnouncementText, extractOptionOrder, formatAttemptForStudent } from './student-paper-format.operations';
import { buildPaperSnapshot, publicPaper } from './student-paper-query.operations';
import { assertStudentCanAccessExam, ensureStudent, hasRenderableQuestions, normalizePaperSnapshot } from './student-snapshot.operations';
export async function enterExamForStudent(ctx: StudentContext, examId: string, user: RequestUser) {
    const exam = await ctx.prisma.exam.findFirst({
      where: { id: examId, deletedAt: null },
      include: {
        paper: {
          include: {
            sections: {
              orderBy: { sortOrder: 'asc' },
              include: { questions: { orderBy: { sortOrder: 'asc' } } },
            },
            questions: { where: { sectionId: null }, orderBy: { sortOrder: 'asc' } },
            rules: true,
          },
        },
      },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在');
    }

    await assertStudentCanAccessExam(ctx, examId, user.id);
    assertExamCanEnter(ctx, exam);

    const attempts = await ctx.prisma.examAttempt.findMany({
      where: {
        examId,
        userId: user.id,
      },
      orderBy: { createdAt: 'asc' },
    });
    const activeAttempt = attempts.find((attempt) => attempt.status === AttemptStatus.IN_PROGRESS);

    if (!activeAttempt && attempts.length >= exam.attemptLimit) {
      const latestAttempt = attempts.at(-1);
      if (latestAttempt) {
        return getAttemptForStudent(ctx, latestAttempt.id, user);
      }
      throw new BadRequestException('已达到考试可提交次数');
    }

    const result = await ctx.prisma.$transaction(async (tx) => {
      const existingInstance = await tx.paperInstance.findUnique({
        where: {
          examId_studentId: {
            examId,
            studentId: user.id,
          },
        },
      });

      const normalizedExisting = existingInstance
        ? normalizePaperSnapshot(ctx, existingInstance.paperSnapshotJson)
        : null;
      const shouldRebuild = normalizedExisting ? !hasRenderableQuestions(ctx, normalizedExisting.snapshot) : false;
      const paperSnapshot =
        normalizedExisting && !shouldRebuild
          ? normalizedExisting.snapshot
          : await buildPaperSnapshot(ctx, tx, exam.paper);

      const paperInstance =
        existingInstance ??
        (await tx.paperInstance.create({
          data: {
            examId,
            studentId: user.id,
            paperSnapshotJson: paperSnapshot as unknown as Prisma.InputJsonObject,
            questionOrderJson: paperSnapshot.sections.map((section) => ({
              sectionId: section.id,
              questionIds: section.questions.map((question) => question.questionId),
            })) as unknown as Prisma.InputJsonArray,
            optionOrderJson: extractOptionOrder(ctx, paperSnapshot) as unknown as Prisma.InputJsonObject,
          },
        }));

      if (existingInstance && (normalizedExisting?.changed || shouldRebuild)) {
        await tx.paperInstance.update({
          where: { id: existingInstance.id },
          data: {
            paperSnapshotJson: paperSnapshot as unknown as Prisma.InputJsonObject,
            questionOrderJson: paperSnapshot.sections.map((section) => ({
              sectionId: section.id,
              questionIds: section.questions.map((question) => question.questionId),
            })) as unknown as Prisma.InputJsonArray,
            optionOrderJson: extractOptionOrder(ctx, paperSnapshot) as unknown as Prisma.InputJsonObject,
          },
        });
      }

      const attempt =
        activeAttempt ??
        (await tx.examAttempt.create({
          data: {
            examId,
            studentId: user.id,
            userId: user.id,
            paperInstanceId: paperInstance.id,
            status: AttemptStatus.IN_PROGRESS,
          },
        }));

      return { paperInstance, attempt, paperSnapshot };
    });

    return formatAttemptForStudent(ctx, 
      result.attempt.id,
      exam,
      result.paperInstance.id,
      result.paperSnapshot,
      result.attempt.startedAt,
    );
  }

export async function getAttempt(ctx: StudentContext, attemptId: string, user: RequestUser) {
    ensureStudent(ctx, user);
    return getAttemptForStudent(ctx, attemptId, user);
  }

export async function getAttemptForStudent(ctx: StudentContext, attemptId: string, user: RequestUser) {
    const attempt = await ctx.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: user.id },
      include: {
        exam: {
          include: {
            announcements: {
              where: { isActive: true },
              orderBy: { version: 'desc' },
              take: 1,
            },
          },
        },
        paperInstance: true,
        answers: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }

    const paperSnapshot = normalizePaperSnapshot(ctx, attempt.paperInstance.paperSnapshotJson).snapshot;

    return {
      attemptId: attempt.id,
      status: toApiEnum(attempt.status),
      attemptStartedAt: attempt.startedAt,
      answers: attempt.answers.map((answer) => ({
        questionId: answer.questionId,
        answer: answer.answerJson,
        status: toApiEnum(answer.status),
        score: Number(answer.score),
        isCorrect: answer.isCorrect,
        autoResult: answer.autoResultJson ?? {},
        savedAt: answer.updatedAt,
      })),
      exam: {
        id: attempt.exam.id,
        name: attempt.exam.name,
        durationMinutes: attempt.exam.durationMinutes,
        startTime: attempt.exam.startTime,
        endTime: attempt.exam.endTime,
        serverTime: new Date().toISOString(),
        announcement: activeAnnouncementText(ctx, attempt.exam),
      },
      paper: publicPaper(ctx, paperSnapshot, attempt.paperInstance.id),
    };
  }