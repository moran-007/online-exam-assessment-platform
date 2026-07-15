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
import { ensureStudent, resolveStudentClassIds } from './student-snapshot.operations';
export async function wrongQuestionInsights(ctx: StudentContext, user: RequestUser) {
    ensureStudent(ctx, user);
    const classIds = await resolveStudentClassIds(ctx, user.id);
    const [items, events, reviewRules] = await ctx.prisma.$transaction([
      ctx.prisma.wrongQuestion.findMany({
        where: { studentId: user.id, question: { deletedAt: null, status: QuestionStatus.PUBLISHED } },
        include: {
          question: {
            select: {
              id: true,
              title: true,
              courseId: true,
              course: { select: { name: true } },
              knowledgePoints: { select: { knowledgePointId: true } },
            },
          },
        },
        orderBy: { lastWrongAt: 'desc' },
      }),
      ctx.prisma.wrongQuestionEvent.findMany({
        where: { studentId: user.id, question: { deletedAt: null, status: QuestionStatus.PUBLISHED } },
        include: { question: { select: { id: true, title: true } } },
        orderBy: { happenedAt: 'asc' },
        take: 500,
      }),
      ctx.prisma.reviewReminderRule.findMany({
        where: {
          enabled: true,
          OR: [
            { classId: null },
            { classId: { in: classIds } },
          ],
        },
        orderBy: [{ updatedAt: 'desc' }],
      }),
    ]);

    const sourceSummary = new Map<string, number>();
    for (const item of items) {
      const key = toApiEnum(item.sourceType);
      sourceSummary.set(key, (sourceSummary.get(key) ?? 0) + 1);
    }

    const curve = new Map<string, { date: string; wrong: number; mastered: number; manual: number }>();
    for (const event of events) {
      const date = event.happenedAt.toISOString().slice(0, 10);
      const current = curve.get(date) ?? { date, wrong: 0, mastered: 0, manual: 0 };
      if (['exam_wrong', 'practice_wrong'].includes(event.eventType)) current.wrong += 1;
      if (event.eventType === 'manual_add') current.manual += 1;
      if (event.eventType === 'practice_correct' || event.masteryStatus === MasteryStatus.MASTERED) current.mastered += 1;
      curve.set(date, current);
    }

    const reminders = items
      .filter((item) => item.masteryStatus === MasteryStatus.UNMASTERED || item.masteryStatus === MasteryStatus.REVIEWING)
      .map((item) => {
        const rule = matchReviewRule(ctx, item.question, reviewRules, classIds);
        const reviewPlan = nextReviewAt(ctx, item.lastWrongAt, item.wrongCount, item.masteryStatus, rule);
        return {
          questionId: item.questionId,
          title: item.question.title,
          courseName: item.question.course.name,
          sourceType: toApiEnum(item.sourceType),
          wrongCount: item.wrongCount,
          masteryStatus: toApiEnum(item.masteryStatus),
          lastWrongAt: item.lastWrongAt,
          nextReviewAt: reviewPlan.nextReviewAt,
          reviewIntervalDays: reviewPlan.intervalDays,
          reviewRuleId: rule?.id ?? null,
          overdue: reviewPlan.nextReviewAt <= new Date(),
        };
      })
      .sort((a, b) => a.nextReviewAt.getTime() - b.nextReviewAt.getTime())
      .slice(0, 12);

    return {
      sourceSummary: [...sourceSummary.entries()].map(([sourceType, count]) => ({ sourceType, count })),
      masteryCurve: [...curve.values()],
      reviewReminders: reminders,
      recentEvents: events.slice(-20).reverse().map((event) => ({
        id: event.id,
        questionId: event.questionId,
        questionTitle: event.question.title,
        sourceType: toApiEnum(event.sourceType),
        eventType: event.eventType,
        isCorrect: event.isCorrect,
        masteryStatus: event.masteryStatus ? toApiEnum(event.masteryStatus) : null,
        happenedAt: event.happenedAt,
      })),
    };
  }

export async function generateWrongQuestionPaper(ctx: StudentContext, user: RequestUser, dto: GenerateWrongQuestionPaperDto) {
    ensureStudent(ctx, user);
    const where: Prisma.WrongQuestionWhereInput = {
      studentId: user.id,
      masteryStatus: { in: [MasteryStatus.UNMASTERED, MasteryStatus.REVIEWING] },
      questionId: dto.questionIds?.length ? { in: dto.questionIds } : undefined,
      question: { deletedAt: null, status: QuestionStatus.PUBLISHED },
    };
    const wrongItems = await ctx.prisma.wrongQuestion.findMany({
      where,
      include: { question: true },
      orderBy: [{ wrongCount: 'desc' }, { lastWrongAt: 'desc' }],
    });
    const selected = (dto.random ? pickRandom(ctx, wrongItems, dto.count ?? wrongItems.length) : wrongItems)
      .slice(0, dto.count ?? wrongItems.length);

    if (!selected.length) {
      throw new BadRequestException('当前没有可组卷的公开错题');
    }

    const courseId = selected[0].question.courseId;
    const title = dto.name?.trim() || `我的错题组卷 ${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}`;

    const result = await ctx.prisma.$transaction(async (tx) => {
      const paper = await tx.paper.create({
        data: {
          name: title,
          courseId,
          durationMinutes: Math.max(selected.length * 3, 20),
          type: PaperType.PRACTICE,
          status: PaperStatus.PUBLISHED,
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
      const section = await tx.paperSection.create({
        data: {
          paperId: paper.id,
          title: '个人错题练习',
          sortOrder: 1,
        },
      });

      for (const [index, item] of selected.entries()) {
        const snapshot = await ctx.questionSnapshots.buildSnapshot(tx, item.questionId);
        await tx.paperQuestion.create({
          data: {
            paperId: paper.id,
            sectionId: section.id,
            questionId: item.questionId,
            questionSnapshotJson: snapshot,
            score: Number(item.question.defaultScore),
            sortOrder: index + 1,
          },
        });
      }

      const totalScore = selected.reduce((sum, item) => sum + Number(item.question.defaultScore), 0);
      await tx.paperSection.update({ where: { id: section.id }, data: { score: totalScore } });
      await tx.paper.update({ where: { id: paper.id }, data: { totalScore } });
      return { paperId: paper.id, questionCount: selected.length, totalScore };
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'student:generate-wrong-question-paper',
      module: 'student',
      targetType: 'paper',
      targetId: result.paperId,
      afterData: {
        questionIds: selected.map((item) => item.questionId),
        questionCount: result.questionCount,
      },
    });

    return result;
  }

export function gradeQuestion(ctx: StudentContext, paperQuestion: PaperSnapshotQuestion, answerJson: Record<string, unknown>) {
    const result = ctx.questionTypes.grade({
      snapshot: paperQuestion.snapshot,
      answer: answerJson as Prisma.InputJsonObject,
      maxScore: paperQuestion.score,
    });
    return { ...result, autoResult: result.details };
  }

export function matchReviewRule(ctx: StudentContext, 
    question: { courseId: string; knowledgePoints: Array<{ knowledgePointId: string }> },
    rules: Array<{
      id: string;
      courseId: string | null;
      classId: string | null;
      knowledgePointId: string | null;
      intervalsJson: Prisma.JsonValue;
      masteryRuleJson: Prisma.JsonValue | null;
    }>,
    classIds: string[],
  ) {
    const knowledgePointIds = new Set(question.knowledgePoints.map((item) => item.knowledgePointId));
    return rules
      .map((rule) => {
        if (rule.courseId && rule.courseId !== question.courseId) return null;
        if (rule.classId && !classIds.includes(rule.classId)) return null;
        if (rule.knowledgePointId && !knowledgePointIds.has(rule.knowledgePointId)) return null;
        const score = (rule.knowledgePointId ? 4 : 0) + (rule.classId ? 2 : 0) + (rule.courseId ? 1 : 0);
        return { rule, score };
      })
      .filter((item): item is { rule: (typeof rules)[number]; score: number } => Boolean(item))
      .sort((a, b) => b.score - a.score)[0]?.rule;
  }

export function nextReviewAt(ctx: StudentContext, 
    lastWrongAt: Date,
    wrongCount: number,
    status: MasteryStatus,
    rule?: {
      intervalsJson: Prisma.JsonValue;
      masteryRuleJson: Prisma.JsonValue | null;
    },
  ) {
    if (status === MasteryStatus.MASTERED || status === MasteryStatus.IGNORED) {
      return { nextReviewAt: lastWrongAt, intervalDays: 0 };
    }
    const intervals = reviewIntervals(ctx, rule?.intervalsJson);
    const masteryRule = reviewMasteryRule(ctx, rule?.masteryRuleJson);
    const index = Math.min(Math.max(wrongCount || 1, 1) - 1, intervals.length - 1);
    const intervalDays = status === MasteryStatus.REVIEWING ? masteryRule.reviewingIntervalDays : intervals[index];
    return {
      nextReviewAt: new Date(lastWrongAt.getTime() + intervalDays * 24 * 60 * 60 * 1000),
      intervalDays,
    };
  }

export function reviewIntervals(ctx: StudentContext, value: Prisma.JsonValue | undefined) {
    if (!Array.isArray(value)) return [1, 3, 7, 14, 30];
    const intervals = value.map(Number).filter((item) => Number.isFinite(item) && item > 0);
    return intervals.length ? intervals : [1, 3, 7, 14, 30];
  }

export function reviewMasteryRule(ctx: StudentContext, value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { reviewingIntervalDays: 3, correctStreak: 3 };
    }
    const source = value as Record<string, unknown>;
    return {
      reviewingIntervalDays: Number(source.reviewingIntervalDays) > 0 ? Math.round(Number(source.reviewingIntervalDays)) : 3,
      correctStreak: Number(source.correctStreak) > 0 ? Math.round(Number(source.correctStreak)) : 3,
    };
  }

export function pickRandom<T>(ctx: StudentContext, items: T[], count: number) {
    return [...items].sort(() => Math.random() - 0.5).slice(0, count);
  }