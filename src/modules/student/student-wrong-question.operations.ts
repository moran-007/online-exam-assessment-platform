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
import { ensureStudent, normalizeMasteryStatus, resolveStudentClassIds } from './student-snapshot.operations';
import { matchReviewRule, nextReviewAt, reviewMasteryRule } from './student-wrong-analysis.operations';
export async function wrongQuestions(ctx: StudentContext, user: RequestUser, query: QueryWrongQuestionDto = {}) {
    ensureStudent(ctx, user);
    const masteryStatuses =
      query.mastery === 'mastered'
        ? [MasteryStatus.MASTERED]
        : [MasteryStatus.UNMASTERED, MasteryStatus.REVIEWING];
    const items = await ctx.prisma.wrongQuestion.findMany({
      where: {
        studentId: user.id,
        masteryStatus: { in: masteryStatuses },
        question: { deletedAt: null, status: QuestionStatus.PUBLISHED },
      },
      include: {
        events: {
          orderBy: { happenedAt: 'desc' },
          take: 5,
        },
        question: {
          select: {
            id: true,
            courseId: true,
            title: true,
            content: true,
            type: true,
            status: true,
            analysis: true,
            defaultScore: true,
            course: { select: { name: true } },
            tags: { include: { tag: true } },
            options: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                optionKey: true,
                content: true,
                sortOrder: true,
              },
            },
          },
        },
      },
      orderBy: { lastWrongAt: 'desc' },
    });

    return items.map((item) => ({
      ...item,
      score: Number(item.score),
      masteryStatus: toApiEnum(item.masteryStatus),
      sourceType: toApiEnum(item.sourceType),
      nextReviewAt: nextReviewAt(ctx, item.lastWrongAt, item.wrongCount, item.masteryStatus).nextReviewAt,
      recentEvents: item.events.map((event) => ({
        id: event.id,
        sourceType: toApiEnum(event.sourceType),
        eventType: event.eventType,
        isCorrect: event.isCorrect,
        score: event.score === null ? null : Number(event.score),
        masteryStatus: event.masteryStatus ? toApiEnum(event.masteryStatus) : null,
        happenedAt: event.happenedAt,
      })),
      question: {
        ...item.question,
        type: toApiEnum(item.question.type),
        status: toApiEnum(item.question.status),
        courseId: item.question.courseId,
        courseName: item.question.course.name,
        tags: item.question.tags.map((relation) => relation.tag),
        defaultScore: Number(item.question.defaultScore),
        options: item.question.options.map((option) => ({
          optionId: option.id,
          label: option.optionKey,
          content: option.content,
          sortOrder: option.sortOrder,
        })),
      },
    }));
  }

export async function addWrongQuestion(ctx: StudentContext, user: RequestUser, dto: AddWrongQuestionDto) {
    ensureStudent(ctx, user);
    const question = await ctx.prisma.question.findFirst({
      where: {
        id: dto.questionId,
        deletedAt: null,
        status: QuestionStatus.PUBLISHED,
      },
      include: { answer: true },
    });

    if (!question) {
      throw new NotFoundException('题目不存在或未发布，不能加入错题本');
    }

    const fromPractice = dto.answer !== undefined || dto.score !== undefined || dto.totalScore !== undefined;
    const sourceType = fromPractice ? WrongQuestionSourceType.PRACTICE : WrongQuestionSourceType.MANUAL;
    const wrongAnswerJson = (dto.answer ?? {}) as Prisma.InputJsonObject;
    const score = dto.score ?? 0;
    const masteryStatus = fromPractice ? MasteryStatus.UNMASTERED : MasteryStatus.REVIEWING;

    const item = await ctx.prisma.wrongQuestion.upsert({
      where: {
        studentId_questionId: {
          studentId: user.id,
          questionId: dto.questionId,
        },
      },
      update: {
        sourceType,
        sourceId: dto.questionId,
        wrongAnswerJson,
        correctAnswerJson: (question.answer?.answerJson ?? {}) as Prisma.InputJsonObject,
        score,
        masteryStatus,
        ...(fromPractice ? { wrongCount: { increment: 1 } } : {}),
        lastWrongAt: new Date(),
      },
      create: {
        studentId: user.id,
        questionId: dto.questionId,
        sourceType,
        sourceId: dto.questionId,
        wrongAnswerJson,
        correctAnswerJson: (question.answer?.answerJson ?? {}) as Prisma.InputJsonObject,
        score,
        wrongCount: fromPractice ? 1 : 0,
        masteryStatus,
      },
    });
    await ctx.prisma.wrongQuestionEvent.create({
      data: {
        wrongQuestionId: item.id,
        studentId: user.id,
        questionId: dto.questionId,
        sourceType,
        sourceId: dto.questionId,
        eventType: fromPractice ? 'practice_wrong' : 'manual_add',
        isCorrect: fromPractice ? false : null,
        score,
        masteryStatus,
        eventJson: {
          answer: dto.answer ?? {},
          totalScore: dto.totalScore ?? null,
        } as Prisma.InputJsonObject,
      },
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'student:add-wrong-question',
      module: 'student',
      targetType: 'question',
      targetId: dto.questionId,
    });

    return { id: item.id };
  }

export async function addWrongQuestions(ctx: StudentContext, user: RequestUser, dto: BatchWrongQuestionDto) {
    ensureStudent(ctx, user);
    const failed: Array<{ questionId: string; message: string }> = [];
    let successCount = 0;

    for (const item of dto.items) {
      try {
        await addWrongQuestion(ctx, user, item);
        successCount += 1;
      } catch (error) {
        failed.push({
          questionId: item.questionId,
          message: error instanceof Error ? error.message : '加入错题本失败',
        });
      }
    }

    await ctx.audit.log({
      userId: user.id,
      action: 'student:batch-add-wrong-question',
      module: 'student',
      targetType: 'question',
      targetId: dto.items[0]?.questionId,
      afterData: {
        questionIds: dto.items.map((item) => item.questionId),
        successCount,
        failedCount: failed.length,
      },
    });

    return {
      successCount,
      failed,
    };
  }

export async function updateWrongQuestionStatus(ctx: StudentContext, 
    user: RequestUser,
    questionId: string,
    dto: UpdateWrongQuestionStatusDto,
  ) {
    ensureStudent(ctx, user);
    const masteryStatus = normalizeMasteryStatus(ctx, dto.masteryStatus);
    const item = await ctx.prisma.wrongQuestion.findFirst({
      where: {
        studentId: user.id,
        questionId,
        question: { deletedAt: null, status: QuestionStatus.PUBLISHED },
      },
    });

    if (!item) {
      throw new NotFoundException('错题不存在');
    }

    const updated = await ctx.prisma.wrongQuestion.update({
      where: { id: item.id },
      data: { masteryStatus },
    });
    await ctx.prisma.wrongQuestionEvent.create({
      data: {
        wrongQuestionId: item.id,
        studentId: user.id,
        questionId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        eventType: 'status_change',
        isCorrect: masteryStatus === MasteryStatus.MASTERED ? true : null,
        score: updated.score,
        masteryStatus,
        eventJson: {
          from: toApiEnum(item.masteryStatus),
          to: toApiEnum(masteryStatus),
        } as Prisma.InputJsonObject,
      },
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'student:update-wrong-question-status',
      module: 'student',
      targetType: 'question',
      targetId: questionId,
      afterData: { masteryStatus },
    });

    return true;
  }

export async function recordWrongQuestionPractice(ctx: StudentContext, user: RequestUser, questionId: string, dto: RecordWrongQuestionPracticeDto) {
    ensureStudent(ctx, user);
    const item = await ctx.prisma.wrongQuestion.findFirst({
      where: {
        studentId: user.id,
        questionId,
        question: { deletedAt: null, status: QuestionStatus.PUBLISHED },
      },
      include: {
        events: {
          orderBy: { happenedAt: 'desc' },
          take: 20,
        },
        question: {
          include: {
            answer: true,
            knowledgePoints: { select: { knowledgePointId: true } },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('错题不存在');

    const now = new Date();
    let masteryStatus: MasteryStatus = MasteryStatus.UNMASTERED;
    let correctStreak = 0;
    let requiredCorrectStreak = 0;
    let matchedReviewRule:
      | {
          intervalsJson: Prisma.JsonValue;
          masteryRuleJson: Prisma.JsonValue | null;
        }
      | undefined;

    if (dto.isCorrect) {
      const classIds = await resolveStudentClassIds(ctx, user.id);
      const reviewRules = await ctx.prisma.reviewReminderRule.findMany({
        where: { enabled: true },
        orderBy: [{ updatedAt: 'desc' }],
      });
      matchedReviewRule = matchReviewRule(ctx, item.question, reviewRules, classIds);
      const masteryRule = reviewMasteryRule(ctx, matchedReviewRule?.masteryRuleJson);
      requiredCorrectStreak = masteryRule.correctStreak;
      correctStreak = 1;
      for (const event of item.events) {
        if (event.isCorrect === true) {
          correctStreak += 1;
          continue;
        }
        if (event.isCorrect === false) break;
      }
      masteryStatus = correctStreak >= requiredCorrectStreak ? MasteryStatus.MASTERED : MasteryStatus.REVIEWING;
    }

    const updated = await ctx.prisma.wrongQuestion.update({
      where: { id: item.id },
      data: dto.isCorrect
        ? {
            masteryStatus,
            lastWrongAt: masteryStatus === MasteryStatus.REVIEWING ? now : item.lastWrongAt,
          }
        : {
            sourceType: WrongQuestionSourceType.PRACTICE,
            sourceId: questionId,
            wrongAnswerJson: (dto.answer ?? {}) as Prisma.InputJsonObject,
            correctAnswerJson: (item.question.answer?.answerJson ?? item.correctAnswerJson ?? {}) as Prisma.InputJsonObject,
            score: dto.score ?? 0,
            masteryStatus,
            wrongCount: { increment: 1 },
            lastWrongAt: now,
          },
    });

    await ctx.prisma.wrongQuestionEvent.create({
      data: {
        wrongQuestionId: item.id,
        studentId: user.id,
        questionId,
        sourceType: WrongQuestionSourceType.PRACTICE,
        sourceId: questionId,
        eventType: dto.isCorrect ? 'practice_correct' : 'practice_wrong',
        isCorrect: dto.isCorrect,
        score: dto.score ?? 0,
        masteryStatus,
        eventJson: {
          answer: dto.answer ?? {},
          totalScore: dto.totalScore ?? null,
          correctStreak: dto.isCorrect ? correctStreak : 0,
          requiredCorrectStreak: dto.isCorrect ? requiredCorrectStreak : null,
        } as Prisma.InputJsonObject,
      },
    });

    return {
      mastered: masteryStatus === MasteryStatus.MASTERED,
      masteryStatus: toApiEnum(updated.masteryStatus),
      wrongCount: updated.wrongCount,
      correctStreak,
      requiredCorrectStreak,
      nextReviewAt: nextReviewAt(ctx, updated.lastWrongAt, updated.wrongCount, updated.masteryStatus, matchedReviewRule).nextReviewAt,
    };
  }

export async function wrongQuestionEvents(ctx: StudentContext, user: RequestUser, questionId: string) {
    ensureStudent(ctx, user);
    const exists = await ctx.prisma.wrongQuestion.findFirst({
      where: {
        studentId: user.id,
        questionId,
        question: { deletedAt: null, status: QuestionStatus.PUBLISHED },
      },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('错题不存在');

    const events = await ctx.prisma.wrongQuestionEvent.findMany({
      where: { studentId: user.id, questionId },
      orderBy: { happenedAt: 'desc' },
      take: 100,
    });
    return events.map((event) => ({
      id: event.id,
      sourceType: toApiEnum(event.sourceType),
      sourceId: event.sourceId,
      eventType: event.eventType,
      isCorrect: event.isCorrect,
      score: event.score === null ? null : Number(event.score),
      masteryStatus: event.masteryStatus ? toApiEnum(event.masteryStatus) : null,
      happenedAt: event.happenedAt,
      eventJson: event.eventJson,
    }));
  }