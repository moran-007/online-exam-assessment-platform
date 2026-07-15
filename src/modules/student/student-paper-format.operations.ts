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

export type PaperSnapshotQuestion = {
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
import { publicPaper } from './student-paper-query.operations';
export function blankCount(ctx: StudentContext, answerJson: unknown) {
    if (!answerJson || typeof answerJson !== 'object' || Array.isArray(answerJson)) return 1;
    const blanks = (answerJson as { blanks?: unknown[] }).blanks;
    return Array.isArray(blanks) && blanks.length ? blanks.length : 1;
  }

export function answerRows(ctx: StudentContext, answerJson: unknown) {
    if (!answerJson || typeof answerJson !== 'object' || Array.isArray(answerJson)) return undefined;
    const rows = Number((answerJson as { rows?: unknown; answerRows?: unknown }).rows ?? (answerJson as { answerRows?: unknown }).answerRows);
    if (!Number.isFinite(rows) || rows <= 0) return undefined;
    return Math.min(24, Math.max(2, Math.round(rows)));
  }

export function formatAttemptForStudent(ctx: StudentContext, 
    attemptId: string,
    exam: { id: string; name: string; durationMinutes: number; startTime: Date; endTime: Date },
    paperInstanceId: string,
    paperSnapshot: PaperSnapshot,
    attemptStartedAt: Date,
  ) {
    return {
      attemptId,
      attemptStartedAt,
      exam: {
        id: exam.id,
        name: exam.name,
        durationMinutes: exam.durationMinutes,
        startTime: exam.startTime,
        endTime: exam.endTime,
        serverTime: new Date().toISOString(),
        announcement: extractAnnouncement(ctx, (exam as { antiCheatConfigJson?: Prisma.JsonValue | null }).antiCheatConfigJson ?? null),
      },
      paper: publicPaper(ctx, paperSnapshot, paperInstanceId),
    };
  }

export function extractOptionOrder(ctx: StudentContext, paperSnapshot: PaperSnapshot) {
    const optionOrder: Record<string, string[]> = {};
    for (const question of flattenPaperQuestions(ctx, paperSnapshot)) {
      optionOrder[question.questionId] = (question.snapshot.options ?? []).map((option) => option.id);
    }
    return optionOrder;
  }

export function flattenPaperQuestions(ctx: StudentContext, paperSnapshot: PaperSnapshot) {
    const flatten = (question: PaperSnapshotQuestion, materialContext?: Prisma.InputJsonObject): PaperSnapshotQuestion[] => {
      const children = Array.isArray(question.snapshot.children) ? question.snapshot.children : [];
      if (!children.length) return [{ ...question, materialContext }];
      const context: Prisma.InputJsonObject = {
        id: question.questionId,
        title: question.snapshot.title,
        content: question.snapshot.content,
        resources: ((question.snapshot as any).resources ?? []) as Prisma.InputJsonArray,
      };
      return children.flatMap((child) => flatten(child, context));
    };
    return paperSnapshot.sections.flatMap((section) => section.questions.flatMap((question) => flatten(question)));
  }

export function prepareQuestionSnapshot(ctx: StudentContext, snapshotJson: Prisma.JsonValue, shuffleOptions: boolean) {
    const snapshot = snapshotJson as unknown as QuestionSnapshot;
    if (!shuffleOptions || snapshot.allowOptionShuffle === false || !snapshot.options?.length) {
      return snapshot;
    }

    return {
      ...snapshot,
      options: shuffle(ctx, snapshot.options).map((option, index) => ({
        ...option,
        sortOrder: index + 1,
      })),
    };
  }

export function shuffle<T>(ctx: StudentContext, items: T[]) {
    return [...items].sort(() => Math.random() - 0.5);
  }

export function extractAnnouncement(ctx: StudentContext, config: Prisma.JsonValue | null) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return '';
    const value = (config as Record<string, unknown>).announcement;
    return typeof value === 'string' ? value : '';
  }

export function activeAnnouncementText(ctx: StudentContext, source: {
    announcements?: Array<{ content: string }>;
    antiCheatConfigJson?: Prisma.JsonValue | null;
  }) {
    return source.announcements?.[0]?.content ?? extractAnnouncement(ctx, source.antiCheatConfigJson ?? null);
  }

export async function ensureActiveAnnouncementRecord(ctx: StudentContext, exam: {
    id: string;
    antiCheatConfigJson: Prisma.JsonValue | null;
    announcements: Array<{ id: string; version: number; content: string }>;
  }) {
    const active = exam.announcements[0];
    if (active) return active;

    const legacyContent = extractAnnouncement(ctx, exam.antiCheatConfigJson).trim();
    if (!legacyContent) return null;

    const latest = await ctx.prisma.examAnnouncement.aggregate({
      where: { examId: exam.id },
      _max: { version: true },
    });
    return ctx.prisma.examAnnouncement.create({
      data: {
        examId: exam.id,
        version: (latest._max.version ?? 0) + 1,
        content: legacyContent,
      },
    });
  }

export function studentExamOrderBy(ctx: StudentContext, query: QueryStudentExamDto): Prisma.ExamOrderByWithRelationInput[] {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderMap: Record<string, Prisma.ExamOrderByWithRelationInput> = {
      startTime: { startTime: direction },
      endTime: { endTime: direction },
      createdAt: { createdAt: direction },
      name: { name: direction },
      status: { status: direction },
      durationMinutes: { durationMinutes: direction },
    };
    const primary = orderMap[query.sortBy || 'startTime'] ?? { startTime: 'desc' };
    return query.sortBy && query.sortBy !== 'createdAt' ? [primary, { createdAt: 'desc' }] : [primary];
  }

export function studentPaperOrderBy(ctx: StudentContext, query: QueryStudentPaperDto): Prisma.PaperOrderByWithRelationInput[] {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderMap: Record<string, Prisma.PaperOrderByWithRelationInput> = {
      createdAt: { createdAt: direction },
      updatedAt: { updatedAt: direction },
      name: { name: direction },
      totalScore: { totalScore: direction },
      durationMinutes: { durationMinutes: direction },
    };
    const primary = orderMap[query.sortBy || 'updatedAt'] ?? { updatedAt: 'desc' };
    return query.sortBy && query.sortBy !== 'updatedAt' ? [primary, { updatedAt: 'desc' }] : [primary];
  }
