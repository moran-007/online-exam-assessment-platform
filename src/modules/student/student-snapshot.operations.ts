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
  ClassMemberStatus,
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
import { flattenPaperQuestions } from './student-paper-format.operations';
export function ensureStudent(ctx: StudentContext, user: RequestUser) {
    if (user.userType !== 'STUDENT') {
      throw new ForbiddenException('仅学生账号可以访问学生端接口');
    }
  }

export function normalizeMasteryStatus(ctx: StudentContext, value: string) {
    const normalized = value.replace(/-/g, '_').toUpperCase() as MasteryStatus;
    if (!Object.values(MasteryStatus).includes(normalized)) {
      throw new BadRequestException('掌握状态不合法');
    }
    return normalized;
  }

export async function findStudentUser(ctx: StudentContext, studentId: string): Promise<RequestUser> {
    const student = await ctx.prisma.user.findFirst({
      where: {
        id: studentId,
        userType: UserType.STUDENT,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      select: {
        id: true,
        username: true,
        realName: true,
        userType: true,
      },
    });

    if (!student) {
      throw new NotFoundException('模拟学生不存在或不可用');
    }

    return {
      id: student.id,
      username: student.username,
      realName: student.realName,
      userType: student.userType,
      roles: [],
      permissions: [],
    };
  }

export async function resolveStudentClassIds(ctx: StudentContext, studentId: string) {
    const relations = await ctx.prisma.classStudent.findMany({
      where: { studentId, status: ClassMemberStatus.ACTIVE, classGroup: { deletedAt: null, status: 'active' } },
      select: { classId: true },
    });
    return relations.map((relation) => relation.classId);
  }

export async function assertStudentCanAccessExam(ctx: StudentContext, examId: string, studentId: string) {
    const exam = await ctx.prisma.exam.findFirst({
      where: { id: examId, deletedAt: null },
      select: { classId: true },
    });
    if (!exam?.classId) return;
    const exists = await ctx.prisma.classStudent.findFirst({
      where: {
        classId: exam.classId,
        studentId,
        status: ClassMemberStatus.ACTIVE,
        classGroup: { deletedAt: null, status: 'active' },
      },
      select: { id: true },
    });
    if (!exists) {
      throw new ForbiddenException('该考试不在你的班级范围内');
    }
  }

export function answerCode(ctx: StudentContext, answerJson: Prisma.JsonValue | Record<string, unknown> | undefined | null) {
    if (!answerJson || typeof answerJson !== 'object' || Array.isArray(answerJson)) return '';
    const answer = answerJson as Record<string, unknown>;
    return String(answer.code ?? answer.text ?? '').trim();
  }

export function nullableJsonInput(ctx: StudentContext, value: Prisma.JsonValue | undefined) {
    return value === null ? Prisma.JsonNull : value === undefined ? undefined : (value as Prisma.InputJsonValue);
  }

export function normalizePaperSnapshot(ctx: StudentContext, value: unknown): SnapshotNormalizationResult {
    const source = plainRecord(ctx, value);
    const fallbackSection = Array.isArray(source.questions)
      ? [{ id: null, title: source.name ?? '题目', sortOrder: 1, questions: source.questions }]
      : [];
    const rawSections = Array.isArray(source.sections) ? source.sections : fallbackSection;
    let changed = !Array.isArray(source.sections);

    const sections = rawSections
      .map((rawSection, sectionIndex) => {
        const section = plainRecord(ctx, rawSection);
        const questions = (Array.isArray(section.questions) ? section.questions : [])
          .map((rawQuestion, questionIndex) => normalizePaperQuestion(ctx, rawQuestion, sectionIndex, questionIndex))
          .filter((question): question is PaperSnapshotQuestion => Boolean(question));

        return {
          id: optionalString(ctx, section.id),
          title: firstString(ctx, section.title, section.name, `第 ${sectionIndex + 1} 部分`),
          sortOrder: numberValue(ctx, section.sortOrder, sectionIndex + 1),
          questions,
        };
      })
      .filter((section) => section.questions.length);

    const snapshot: PaperSnapshot = {
      id: firstString(ctx, source.id, source.paperId),
      name: firstString(ctx, source.name, source.title, '试卷'),
      totalScore: numberValue(ctx, 
        source.totalScore,
        sections.flatMap((section) => section.questions).reduce((sum, question) => sum + question.score, 0),
      ),
      durationMinutes: Math.max(1, Math.round(numberValue(ctx, source.durationMinutes, 60))),
      sections,
    };

    changed ||= JSON.stringify(snapshot) !== JSON.stringify(value);
    return { snapshot, changed };
  }

export function normalizePaperQuestion(ctx: StudentContext, rawQuestion: unknown, sectionIndex: number, questionIndex: number) {
    const source = plainRecord(ctx, rawQuestion);
    const nestedQuestion = plainRecordOrNull(ctx, source.question);
    const snapshotSource = plainRecord(ctx, 
      source.snapshot ?? source.questionSnapshot ?? source.questionSnapshotJson ?? nestedQuestion ?? source,
    );
    const questionId = firstString(ctx, source.questionId, snapshotSource.id, source.id);
    if (!questionId) return null;
    const score = numberValue(ctx, source.score, numberValue(ctx, snapshotSource.defaultScore, 0));

    return {
      paperQuestionId: firstString(ctx, 
        source.paperQuestionId,
        source.paperQuestionID,
        source.id,
        `${questionId}:${sectionIndex + 1}:${questionIndex + 1}`,
      ),
      questionId,
      score,
      sortOrder: numberValue(ctx, source.sortOrder, questionIndex + 1),
      snapshot: normalizeQuestionSnapshot(ctx, snapshotSource, questionId, score),
    };
  }

export function normalizeQuestionSnapshot(ctx: StudentContext, source: Record<string, unknown>, questionId: string, score: number): QuestionSnapshot {
    const answer = plainRecordOrNull(ctx, source.answer ?? source.answerJson);
    const options = (Array.isArray(source.options) ? source.options : []).map((rawOption, index) => {
      const option = plainRecord(ctx, rawOption);
      const optionKey = firstString(ctx, option.optionKey, option.label, option.key, String.fromCharCode(65 + index));
      return {
        id: firstString(ctx, option.id, option.optionId, option.value, `${questionId}:${optionKey}`),
        optionKey,
        content: firstString(ctx, option.content, option.text, option.label),
        isCorrect: Boolean(option.isCorrect),
        sortOrder: numberValue(ctx, option.sortOrder, index + 1),
      };
    });
    const programmingRef = plainRecordOrNull(ctx, source.programmingRef ?? source.programming);
    const children = (Array.isArray(source.children) ? source.children : [])
      .map((child, index) => normalizePaperQuestion(ctx, child, 0, index))
      .filter((child): child is PaperSnapshotQuestion => Boolean(child));

    return {
      id: questionId,
      type: apiQuestionType(ctx, source.type),
      title: firstString(ctx, source.title, source.name, `第 ${questionId} 题`),
      content: firstString(ctx, source.content, source.description, source.statement),
      analysis: optionalString(ctx, source.analysis),
      defaultScore: numberValue(ctx, source.defaultScore, score),
      allowOptionShuffle: source.allowOptionShuffle === undefined ? true : Boolean(source.allowOptionShuffle),
      options,
      answer: answer
        ? ({
            ...answer,
            correctOptionIds: correctOptionIds(ctx, answer, options),
          } as QuestionSnapshot['answer'])
        : null,
      programmingRef: programmingRef
        ? ({
            ...programmingRef,
            judgeProvider: firstString(ctx, programmingRef.judgeProvider, programmingRef.provider, 'hydro'),
            externalProblemId: firstString(ctx, programmingRef.externalProblemId, programmingRef.problemId),
            externalProblemUrl: optionalString(ctx, programmingRef.externalProblemUrl ?? programmingRef.problemUrl),
            languages: Array.isArray(programmingRef.languages) ? programmingRef.languages.map(String).filter(Boolean) : [],
          } as QuestionSnapshot['programmingRef'])
        : null,
      scoringRule: (source.scoringRule as Prisma.JsonValue | null | undefined) ?? null,
      scoringRuleVersionId: optionalString(ctx, source.scoringRuleVersionId),
      engine: plainRecordOrNull(ctx, source.engine) as QuestionSnapshot['engine'],
      children,
    };
  }

export function hasRenderableQuestions(ctx: StudentContext, snapshot: PaperSnapshot) {
    return flattenPaperQuestions(ctx, snapshot).some(
      (question) => Boolean(question.questionId && question.snapshot.title !== undefined && question.snapshot.content !== undefined),
    );
  }

export function correctOptionIds(ctx: StudentContext, 
    answer: Record<string, unknown>,
    options: Array<{ id: string; optionKey: string; isCorrect?: boolean }>,
  ) {
    const explicit = answer.correctOptionIds;
    if (Array.isArray(explicit)) return explicit.map(String).filter(Boolean);
    const keys = answer.correctOptionKeys ?? answer.correctOptions;
    if (Array.isArray(keys)) {
      const keySet = new Set(keys.map(String));
      return options.filter((option) => keySet.has(option.optionKey) || keySet.has(option.id)).map((option) => option.id);
    }
    return options.filter((option) => option.isCorrect).map((option) => option.id);
  }

export function apiQuestionType(ctx: StudentContext, value: unknown) {
    const raw = String(value || 'short_answer').trim();
    return raw.replace(/-/g, '_').toLowerCase();
  }

export function plainRecord(ctx: StudentContext, value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

export function plainRecordOrNull(ctx: StudentContext, value: unknown): Record<string, unknown> | null {
    const record = plainRecord(ctx, value);
    return Object.keys(record).length ? record : null;
  }

export function firstString(ctx: StudentContext, ...values: unknown[]) {
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) return text;
    }
    return '';
  }

export function optionalString(ctx: StudentContext, value: unknown) {
    const text = String(value ?? '').trim();
    return text || null;
  }

export function numberValue(ctx: StudentContext, value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
