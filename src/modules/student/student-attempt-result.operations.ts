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
import { flattenPaperQuestions } from './student-paper-format.operations';
import { ensureStudent, normalizePaperSnapshot } from './student-snapshot.operations';
export async function result(ctx: StudentContext, attemptId: string, user: RequestUser) {
    ensureStudent(ctx, user);
    return resultForStudent(ctx, attemptId, user);
  }

export async function resultForStudent(ctx: StudentContext, 
    attemptId: string,
    user: RequestUser,
    options: { forceFull?: boolean } = {},
  ) {
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
    const attemptUsedCount = await ctx.prisma.examAttempt.count({
      where: {
        examId: attempt.examId,
        userId: user.id,
        status: { not: AttemptStatus.CANCELLED },
      },
    });
    const visibility = options.forceFull
      ? fullResultVisibility(ctx)
      : resolveResultVisibility(ctx, attempt, attemptUsedCount);

    return {
      attemptId: attempt.id,
      exam: {
        id: attempt.exam.id,
        name: attempt.exam.name,
      },
      status: toApiEnum(attempt.status),
      totalScore: visibility.score ? Number(attempt.totalScore) : null,
      objectiveScore: visibility.score ? Number(attempt.objectiveScore) : null,
      subjectiveScore: visibility.score ? Number(attempt.subjectiveScore) : null,
      judgeScore: visibility.score ? Number(attempt.judgeScore) : null,
      durationSeconds: attempt.durationSeconds,
      visibility,
      attemptLimit: attempt.exam.attemptLimit,
      attemptUsedCount,
      examEnded: attempt.exam.endTime <= new Date(),
      questionResults: flattenPaperQuestions(ctx, paperSnapshot).map((paperQuestion) => {
        const answer = answerMap.get(paperQuestion.questionId);
        return {
          questionId: paperQuestion.questionId,
          type: paperQuestion.snapshot.type,
          title: paperQuestion.snapshot.title,
          content: visibility.content ? paperQuestion.snapshot.content : '',
          score: paperQuestion.score,
          studentScore: visibility.questionScore ? Number(answer?.score ?? 0) : null,
          isCorrect: visibility.correctness ? answer?.isCorrect : null,
          studentAnswer: visibility.studentAnswer ? answer?.answerJson ?? {} : {},
          correctAnswer: visibility.correctAnswer ? paperQuestion.snapshot.answer ?? {} : {},
          options: visibility.content || visibility.studentAnswer || visibility.correctAnswer
            ? (paperQuestion.snapshot.options ?? []).map((option) => ({
                optionId: option.id,
                label: option.optionKey,
                content: visibility.content ? option.content : '',
                isCorrect: visibility.correctAnswer ? option.isCorrect ?? false : false,
              }))
            : [],
          analysis: visibility.analysis ? paperQuestion.snapshot.analysis : '',
        };
      }),
      knowledgePointStats: [],
    };
  }

export async function assertAttemptBelongsToStudent(ctx: StudentContext, attemptId: string, studentId: string) {
    const attempt = await ctx.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: studentId },
      select: { id: true },
    });
    if (!attempt) {
      throw new NotFoundException('模拟答题记录不存在');
    }
  }

export function fullResultVisibility(ctx: StudentContext): ResultVisibility {
    return {
      score: true,
      questionScore: true,
      content: true,
      studentAnswer: true,
      correctness: true,
      correctAnswer: true,
      analysis: true,
      restricted: false,
      reason: '',
    };
  }

export function resolveResultVisibility(ctx: StudentContext, 
    attempt: {
      status: AttemptStatus;
      submittedAt: Date | null;
      exam: {
        endTime: Date;
        attemptLimit: number;
        showAnswerMode: ShowAnswerMode;
        showScoreMode: ShowScoreMode;
        antiCheatConfigJson: Prisma.JsonValue | null;
      };
    },
    attemptUsedCount: number,
  ): ResultVisibility {
    const examEnded = attempt.exam.endTime <= new Date();
    const attemptsExhausted = attemptUsedCount >= attempt.exam.attemptLimit;
    const detailWindowOpen = examEnded && attemptsExhausted;
    const answerModeOpen = isAnswerModeOpen(ctx, attempt.exam.showAnswerMode, attempt);
    const scoreVisible = isScoreModeOpen(ctx, attempt.exam.showScoreMode, attempt);
    const early = extractResultVisibility(ctx, attempt.exam.antiCheatConfigJson);
    const defaultDetailOpen = detailWindowOpen && answerModeOpen;

    return {
      score: scoreVisible,
      questionScore: scoreVisible && (defaultDetailOpen || early.questionScore !== false),
      content: defaultDetailOpen || early.content === true,
      studentAnswer: defaultDetailOpen || early.studentAnswer === true,
      correctness: defaultDetailOpen || early.correctness === true,
      correctAnswer: defaultDetailOpen || early.correctAnswer === true,
      analysis: defaultDetailOpen || early.analysis === true,
      restricted: !defaultDetailOpen,
      reason: !examEnded
        ? '考试未结束，暂不开放解析和正确答案'
        : !attemptsExhausted
          ? '考试次数未用完，暂不开放解析和正确答案'
          : answerModeOpen
            ? ''
            : '考试设置暂不开放解析和正确答案',
    };
  }

export function isAnswerModeOpen(ctx: StudentContext, 
    mode: ShowAnswerMode,
    attempt: { status: AttemptStatus; submittedAt: Date | null; exam: { endTime: Date } },
  ) {
    switch (mode) {
      case ShowAnswerMode.NEVER:
        return false;
      case ShowAnswerMode.AFTER_SUBMIT:
        return Boolean(attempt.submittedAt);
      case ShowAnswerMode.AFTER_EXAM_END:
        return attempt.exam.endTime <= new Date();
      case ShowAnswerMode.AFTER_MANUAL:
        return attempt.status === AttemptStatus.GRADED;
      default:
        return false;
    }
  }

export function isScoreModeOpen(ctx: StudentContext, 
    mode: ShowScoreMode,
    attempt: { status: AttemptStatus; submittedAt: Date | null; exam: { endTime: Date } },
  ) {
    switch (mode) {
      case ShowScoreMode.NEVER:
        return false;
      case ShowScoreMode.AFTER_SUBMIT:
        return Boolean(attempt.submittedAt);
      case ShowScoreMode.AFTER_GRADED:
        return attempt.status === AttemptStatus.GRADED;
      case ShowScoreMode.AFTER_EXAM_END:
        return attempt.exam.endTime <= new Date();
      case ShowScoreMode.AFTER_MANUAL:
        return attempt.status === AttemptStatus.GRADED;
      default:
        return false;
    }
  }

export function extractResultVisibility(ctx: StudentContext, config: Prisma.JsonValue | null) {
    const defaults = {
      questionScore: true,
      content: false,
      studentAnswer: false,
      correctness: false,
      correctAnswer: false,
      analysis: false,
    };
    if (!config || typeof config !== 'object' || Array.isArray(config)) return defaults;
    const value = (config as Record<string, unknown>).resultVisibility;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    const source = value as Record<string, unknown>;
    return {
      questionScore: typeof source.questionScore === 'boolean' ? source.questionScore : defaults.questionScore,
      content: typeof source.content === 'boolean' ? source.content : defaults.content,
      studentAnswer: typeof source.studentAnswer === 'boolean' ? source.studentAnswer : defaults.studentAnswer,
      correctness: typeof source.correctness === 'boolean' ? source.correctness : defaults.correctness,
      correctAnswer: typeof source.correctAnswer === 'boolean' ? source.correctAnswer : defaults.correctAnswer,
      analysis: typeof source.analysis === 'boolean' ? source.analysis : defaults.analysis,
    };
  }

export function assertExamCanEnter(ctx: StudentContext, exam: { status: ExamStatus; startTime: Date; endTime: Date }) {
    const now = new Date();
    const runtimeStatus = studentRuntimeExamStatus(ctx, exam, now);

    if (runtimeStatus === 'ended') {
      throw new BadRequestException({ code: 40008, message: '考试已结束' });
    }

    if (runtimeStatus !== 'scheduled' && runtimeStatus !== 'running') {
      throw new BadRequestException('考试未发布或已结束');
    }

    if (runtimeStatus === 'scheduled' && exam.startTime > now) {
      throw new BadRequestException({ code: 40007, message: '考试未开始' });
    }
  }

export function studentRuntimeExamStatus(ctx: StudentContext, exam: { status: ExamStatus; startTime: Date; endTime: Date }, now = new Date()) {
    if (exam.status === ExamStatus.ENDED || exam.endTime <= now) return 'ended';
    if (exam.status === ExamStatus.RUNNING || exam.startTime <= now) return 'running';
    if (exam.status === ExamStatus.SCHEDULED) return 'scheduled';
    return toApiEnum(exam.status);
  }

export function assertQuestionInPaper(
  ctx: StudentContext,
  paperSnapshot: PaperSnapshot,
  questionId: string,
): ReturnType<typeof flattenPaperQuestions>[number] {
    const paperQuestion = flattenPaperQuestions(ctx, paperSnapshot).find((question) => question.questionId === questionId);
    if (!paperQuestion) {
      throw new BadRequestException('题目不属于当前试卷实例');
    }
    return paperQuestion;
  }
