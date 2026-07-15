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
import { answerRows, blankCount, prepareQuestionSnapshot, shuffle, studentPaperOrderBy } from './student-paper-format.operations';
import { apiQuestionType, ensureStudent } from './student-snapshot.operations';
import { pickRandom } from './student-wrong-analysis.operations';
export async function studentPapers(ctx: StudentContext, user: RequestUser, query: QueryStudentPaperDto) {
    ensureStudent(ctx, user);
    const { page, pageSize, skip, take } = toPagination(query);
    const where = studentPracticePaperWhere(ctx, query);

    const [items, total] = await ctx.prisma.$transaction([
      ctx.prisma.paper.findMany({
        where,
        include: {
          course: { select: { name: true } },
          _count: {
            select: {
              questions: true,
              exams: { where: { deletedAt: null } },
            },
          },
        },
        orderBy: studentPaperOrderBy(ctx, query),
        skip,
        take,
      }),
      ctx.prisma.paper.count({ where }),
    ]);

    return {
      items: items.map((paper) => ({
        id: paper.id,
        name: paper.name,
        courseId: paper.courseId,
        courseName: paper.course.name,
        totalScore: Number(paper.totalScore),
        durationMinutes: paper.durationMinutes,
        type: toApiEnum(paper.type),
        status: toApiEnum(paper.status),
        questionCount: paper._count.questions,
        examUsageCount: paper._count.exams,
        examOccupied: paper._count.exams > 0,
        createdAt: paper.createdAt,
        updatedAt: paper.updatedAt,
      })),
      page,
      pageSize,
      total,
    };
  }

export async function previewStudentPaper(ctx: StudentContext, user: RequestUser, paperId: string) {
    ensureStudent(ctx, user);
    const paper = await ctx.prisma.paper.findFirst({
      where: studentPracticePaperPreviewWhere(ctx, user.id, paperId),
      include: {
        course: true,
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: { questions: { orderBy: { sortOrder: 'asc' } } },
        },
        questions: {
          where: { sectionId: null },
          orderBy: { sortOrder: 'asc' },
        },
        rules: true,
      },
    });

    if (!paper) {
      throw new NotFoundException('试卷不存在或暂不可练习');
    }

    return {
      ...paper,
      type: toApiEnum(paper.type),
      status: toApiEnum(paper.status),
      totalScore: Number(paper.totalScore),
      sections: paper.sections.map((section) => ({
        ...section,
        score: Number(section.score),
        questions: section.questions.map((question) => ({
          ...question,
          score: Number(question.score),
        })),
      })),
      questions: paper.questions.map((question) => ({
        ...question,
        score: Number(question.score),
      })),
    };
  }

export function studentPracticePaperWhere(ctx: StudentContext, query?: Pick<QueryStudentPaperDto, 'courseId' | 'keyword'>): Prisma.PaperWhereInput {
    const now = new Date();
    return {
      deletedAt: null,
      status: PaperStatus.PUBLISHED,
      type: { not: PaperType.PRACTICE },
      courseId: query?.courseId,
      exams: {
        none: {
          deletedAt: null,
          status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
          startTime: { lte: now },
          endTime: { gt: now },
        },
      },
      OR: query?.keyword
        ? [
            { name: { contains: query.keyword, mode: 'insensitive' } },
            { course: { name: { contains: query.keyword, mode: 'insensitive' } } },
          ]
        : undefined,
    };
  }

export function studentPracticePaperPreviewWhere(ctx: StudentContext, userId: string, paperId: string): Prisma.PaperWhereInput {
    const now = new Date();
    return {
      id: paperId,
      deletedAt: null,
      OR: [
        {
          createdBy: userId,
          type: PaperType.PRACTICE,
        },
        {
          status: PaperStatus.PUBLISHED,
          type: { not: PaperType.PRACTICE },
          exams: {
            none: {
              deletedAt: null,
              status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
              startTime: { lte: now },
              endTime: { gt: now },
            },
          },
        },
      ],
    };
  }

export async function buildPaperSnapshot(ctx: StudentContext, 
    tx: Prisma.TransactionClient,
    paper: Prisma.PaperGetPayload<{
    include: {
      sections: { include: { questions: true } };
      questions: true;
      rules: true;
    };
  }>,
  ): Promise<PaperSnapshot> {
    if (paper.type === PaperType.RANDOM && paper.rules.length) {
      return buildRandomPaperSnapshot(ctx, tx, paper);
    }

    return buildFixedPaperSnapshot(ctx, paper);
  }

export function buildFixedPaperSnapshot(ctx: StudentContext, paper: Prisma.PaperGetPayload<{
    include: {
      sections: { include: { questions: true } };
      questions: true;
      rules: true;
    };
  }>): PaperSnapshot {
    const sections: PaperSnapshotSection[] = paper.sections.map((section) => {
      const orderedQuestions = paper.shuffleQuestions || section.shuffleQuestions
        ? shuffle(ctx, section.questions)
        : section.questions;

      return {
        id: section.id,
        title: section.title,
        sortOrder: section.sortOrder,
        questions: orderedQuestions.map((question, index) => ({
          paperQuestionId: question.id,
          questionId: question.questionId,
          score: Number(question.score),
          sortOrder: index + 1,
          snapshot: prepareQuestionSnapshot(ctx, question.questionSnapshotJson, paper.shuffleOptions),
        })),
      };
    });

    if (paper.questions.length) {
      const orderedQuestions = paper.shuffleQuestions ? shuffle(ctx, paper.questions) : paper.questions;
      sections.push({
        id: null,
        title: '未分区题目',
        sortOrder: sections.length + 1,
        questions: orderedQuestions.map((question, index) => ({
          paperQuestionId: question.id,
          questionId: question.questionId,
          score: Number(question.score),
          sortOrder: index + 1,
          snapshot: prepareQuestionSnapshot(ctx, question.questionSnapshotJson, paper.shuffleOptions),
        })),
      });
    }

    return {
      id: paper.id,
      name: paper.name,
      totalScore: Number(paper.totalScore),
      durationMinutes: paper.durationMinutes,
      sections,
    };
  }

export async function buildRandomPaperSnapshot(ctx: StudentContext, 
    tx: Prisma.TransactionClient,
    paper: Prisma.PaperGetPayload<{
      include: {
        sections: { include: { questions: true } };
        questions: true;
        rules: true;
      };
    }>,
  ): Promise<PaperSnapshot> {
    const ruleConfig = paperRuleConfig(ctx, paper.rules[0]?.ruleJson);
    const sections: PaperSnapshotSection[] = [];
    const selectedIds = new Set<string>();
    const shuffleOptions = ruleConfig.shuffleOptions ?? paper.shuffleOptions;

    for (const [sectionIndex, rule] of ruleConfig.rules.entries()) {
      const candidates = await findRandomRuleCandidates(ctx, tx, paper.courseId, rule, [...selectedIds]);
      if (candidates.length < rule.count) {
        throw new BadRequestException({
          code: 40010,
          message: `随机试卷题库数量不足：${rule.sectionTitle}`,
          data: {
            sectionTitle: rule.sectionTitle,
            requiredCount: rule.count,
            availableCount: candidates.length,
          },
        });
      }

      const chosen = pickRandom(ctx, candidates, rule.count);
      const questions: PaperSnapshotQuestion[] = [];
      for (const [index, question] of chosen.entries()) {
        selectedIds.add(question.id);
        const snapshot = await ctx.questionSnapshots.buildSnapshot(tx, question.id);
        questions.push({
          paperQuestionId: `random-${sectionIndex + 1}-${index + 1}`,
          questionId: question.id,
          score: rule.scoreEach,
          sortOrder: index + 1,
          snapshot: prepareQuestionSnapshot(ctx, snapshot as Prisma.JsonValue, shuffleOptions),
        });
      }

      sections.push({
        id: `random-${sectionIndex + 1}`,
        title: rule.sectionTitle,
        sortOrder: sectionIndex + 1,
        questions: ruleConfig.shuffleQuestions ? shuffle(ctx, questions) : questions,
      });
    }

    return {
      id: paper.id,
      name: paper.name,
      totalScore: sections
        .flatMap((section) => section.questions)
        .reduce((sum, question) => sum + question.score, 0),
      durationMinutes: paper.durationMinutes,
      sections,
    };
  }

export function paperRuleConfig(ctx: StudentContext, value: Prisma.JsonValue | undefined) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const rawRules = Array.isArray(source.rules) ? source.rules : [];
    const rules = rawRules.map((item, index) => {
      const rule = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
      return {
        sectionTitle: String(rule.sectionTitle || `随机分区 ${index + 1}`).trim(),
        questionType: String(rule.questionType || 'single_choice').trim(),
        knowledgePointIds: Array.isArray(rule.knowledgePointIds) ? rule.knowledgePointIds.map(String).filter(Boolean) : [],
        tagIds: Array.isArray(rule.tagIds) ? rule.tagIds.map(String).filter(Boolean) : [],
        difficultyRange: Array.isArray(rule.difficultyRange) ? rule.difficultyRange.map(Number) : undefined,
        count: Math.max(1, Math.round(Number(rule.count) || 1)),
        scoreEach: Math.max(0, Number(rule.scoreEach) || 0),
      };
    });

    if (!rules.length) {
      throw new BadRequestException('随机试卷缺少组卷规则，无法生成个人试卷');
    }

    return {
      rules,
      shuffleQuestions: Boolean(source.shuffleQuestions),
      shuffleOptions: Boolean(source.shuffleOptions),
    };
  }

export async function findRandomRuleCandidates(ctx: StudentContext, 
    tx: Prisma.TransactionClient,
    courseId: string,
    rule: {
      questionType: string;
      knowledgePointIds: string[];
      tagIds: string[];
      difficultyRange?: number[];
    },
    excludeIds: string[],
  ) {
    const [minDifficulty, maxDifficulty] = rule.difficultyRange ?? [1, 5];
    return tx.question.findMany({
      where: {
        courseId,
        deletedAt: null,
        status: QuestionStatus.PUBLISHED,
        type: normalizeQuestionType(rule.questionType),
        id: { notIn: excludeIds },
        difficulty: {
          gte: Number.isFinite(minDifficulty) ? minDifficulty : 1,
          lte: Number.isFinite(maxDifficulty) ? maxDifficulty : 5,
        },
        knowledgePoints: rule.knowledgePointIds.length
          ? { some: { knowledgePointId: { in: rule.knowledgePointIds } } }
          : undefined,
        tags: rule.tagIds.length ? { some: { tagId: { in: rule.tagIds } } } : undefined,
      },
      select: { id: true },
    });
  }

export function publicPaper(ctx: StudentContext, paperSnapshot: PaperSnapshot, paperInstanceId: string) {
    const publicQuestion = (paperQuestion: PaperSnapshotQuestion): Record<string, unknown> => ({
      questionId: paperQuestion.questionId,
      type: apiQuestionType(ctx, paperQuestion.snapshot.type),
      title: paperQuestion.snapshot.title,
      content: paperQuestion.snapshot.content,
      score: paperQuestion.score,
      blankCount: blankCount(ctx, paperQuestion.snapshot.answer),
      answerRows: answerRows(ctx, paperQuestion.snapshot.answer),
      programmingRef: paperQuestion.snapshot.programmingRef
        ? {
            ...paperQuestion.snapshot.programmingRef,
            externalProblemUrl: paperQuestion.snapshot.programmingRef.externalProblemUrl ?? null,
          }
        : null,
      options: (paperQuestion.snapshot.options ?? []).map((option) => ({
        optionId: option.id,
        label: option.optionKey,
        content: option.content,
      })),
      children: (paperQuestion.snapshot.children ?? []).map(publicQuestion),
    });
    return {
      paperInstanceId,
      sections: paperSnapshot.sections.map((section) => ({
        title: section.title,
        questions: section.questions.map(publicQuestion),
      })),
    };
  }