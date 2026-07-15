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
import { saveAnswersForStudent } from './student-answer-save.operations';
import { assertAttemptBelongsToStudent, resultForStudent, studentRuntimeExamStatus } from './student-attempt-result.operations';
import { submitForStudent } from './student-attempt-submit.operations';
import { enterExamForStudent, getAttemptForStudent } from './student-exam-entry.operations';
import { activeAnnouncementText, ensureActiveAnnouncementRecord, studentExamOrderBy } from './student-paper-format.operations';
import { assertStudentCanAccessExam, ensureStudent, findStudentUser, resolveStudentClassIds } from './student-snapshot.operations';
export async function myExams(ctx: StudentContext, user: RequestUser, query: QueryStudentExamDto) {
    ensureStudent(ctx, user);
    const now = new Date();
    const classIds = await resolveStudentClassIds(ctx, user.id);
    const exams = await ctx.prisma.exam.findMany({
      where: {
        deletedAt: null,
        status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING, ExamStatus.ENDED] },
        OR: [{ classId: null }, { classId: { in: classIds } }],
      },
      include: {
        course: { select: { name: true } },
        announcements: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
          include: {
            reads: {
              where: { userId: user.id },
              select: { readAt: true },
            },
          },
        },
        attempts: {
          where: { userId: user.id },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: studentExamOrderBy(ctx, query),
    });

    return exams
      .map((exam) => {
        const runtimeStatus = studentRuntimeExamStatus(ctx, exam, now);
        const attempts = exam.attempts.map((attempt, index) => ({
          attemptId: attempt.id,
          attemptNo: index + 1,
          status: toApiEnum(attempt.status),
          totalScore: Number(attempt.totalScore),
          submittedAt: attempt.submittedAt,
          startedAt: attempt.startedAt,
        }));
        const latestAttempt = attempts.at(-1);
        const activeAttempt = exam.attempts.find((attempt) => attempt.status === AttemptStatus.IN_PROGRESS);
        const usedCount = exam.attempts.length;
        const activeAnnouncement = exam.announcements[0];
        const announcementReadAt = activeAnnouncement?.reads[0]?.readAt ?? null;
        return {
          examId: exam.id,
          name: exam.name,
          courseName: exam.course.name,
          startTime: exam.startTime,
          endTime: exam.endTime,
          createdAt: exam.createdAt,
          durationMinutes: exam.durationMinutes,
          status: runtimeStatus,
          attemptLimit: exam.attemptLimit,
          attemptUsedCount: usedCount,
          remainingAttemptCount: Math.max(exam.attemptLimit - usedCount, 0),
          attemptStatus: activeAttempt
            ? toApiEnum(activeAttempt.status)
            : latestAttempt?.status ?? 'not_started',
          attemptId: activeAttempt?.id ?? latestAttempt?.attemptId,
          attempts,
          announcement: activeAnnouncementText(ctx, exam),
          announcementId: activeAnnouncement?.id ?? null,
          announcementVersion: activeAnnouncement?.version ?? null,
          announcementReadAt,
          announcementRead: Boolean(announcementReadAt),
        };
      })
      .filter((exam) => !query.status || exam.status === query.status);
  }

export async function examRanking(ctx: StudentContext, examId: string, user: RequestUser) {
    ensureStudent(ctx, user);
    const exam = await ctx.prisma.exam.findFirst({
      where: {
        id: examId,
        deletedAt: null,
        status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING, ExamStatus.ENDED] },
      },
      select: { id: true, name: true },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在或暂不可见');
    }

    const [attempts, allAttempts] = await ctx.prisma.$transaction([
      ctx.prisma.examAttempt.findMany({
        where: { examId, submittedAt: { not: null } },
        orderBy: [{ totalScore: 'desc' }, { submittedAt: 'asc' }],
        take: 100,
      }),
      ctx.prisma.examAttempt.findMany({
        where: { examId },
        orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, userId: true },
      }),
    ]);
    const userIds = [...new Set(attempts.map((attempt) => attempt.userId))];
    const users = await ctx.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, realName: true },
    });
    const userMap = new Map(users.map((item) => [item.id, item]));
    const attemptNoMap = new Map<string, number>();
    const counters = new Map<string, number>();
    for (const attempt of allAttempts) {
      const next = (counters.get(attempt.userId) ?? 0) + 1;
      counters.set(attempt.userId, next);
      attemptNoMap.set(attempt.id, next);
    }

    const items = attempts.map((attempt, index) => {
      const student = userMap.get(attempt.userId);
      return {
        rank: index + 1,
        attemptId: attempt.id,
        attemptNo: attemptNoMap.get(attempt.id) ?? 1,
        studentName: student?.realName ?? student?.username ?? '学生',
        username: student?.username ?? '',
        totalScore: Number(attempt.totalScore),
        objectiveScore: Number(attempt.objectiveScore),
        status: toApiEnum(attempt.status),
        submittedAt: attempt.submittedAt,
        isCurrentUser: attempt.userId === user.id,
      };
    });

    return {
      examId: exam.id,
      examName: exam.name,
      items,
      myRank: items.find((item) => item.isCurrentUser)?.rank ?? null,
    };
  }

export async function enterExam(ctx: StudentContext, examId: string, user: RequestUser) {
    ensureStudent(ctx, user);
    return enterExamForStudent(ctx, examId, user);
  }

export async function readExamAnnouncement(ctx: StudentContext, examId: string, user: RequestUser) {
    ensureStudent(ctx, user);
    await assertStudentCanAccessExam(ctx, examId, user.id);

    const exam = await ctx.prisma.exam.findFirst({
      where: {
        id: examId,
        deletedAt: null,
        status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING, ExamStatus.ENDED] },
      },
      include: {
        announcements: {
          where: { isActive: true },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });

    if (!exam) {
      throw new NotFoundException('考试不存在或暂不可见');
    }

    const announcement = await ensureActiveAnnouncementRecord(ctx, exam);
    if (!announcement) {
      return { read: false, skipped: true };
    }

    const record = await ctx.prisma.examAnnouncementRead.upsert({
      where: {
        announcementId_userId: {
          announcementId: announcement.id,
          userId: user.id,
        },
      },
      update: { readAt: new Date() },
      create: {
        examId,
        announcementId: announcement.id,
        userId: user.id,
      },
    });

    await ctx.audit.log({
      userId: user.id,
      action: 'student:read-exam-announcement',
      module: 'student',
      targetType: 'exam',
      targetId: examId,
      afterData: { announcementId: announcement.id, version: announcement.version },
    });

    return {
      read: true,
      announcementId: announcement.id,
      announcementVersion: announcement.version,
      readAt: record.readAt,
    };
  }

export async function enterExamAsStudent(ctx: StudentContext, examId: string, studentId: string, actor: RequestUser) {
    const student = await findStudentUser(ctx, studentId);
    const result = await enterExamForStudent(ctx, examId, student);
    await ctx.audit.log({
      userId: actor.id,
      action: 'student:simulate-enter-exam',
      module: 'student',
      targetType: 'exam',
      targetId: examId,
      afterData: { simulatedStudentId: studentId, attemptId: result.attemptId },
    });
    return { ...result, simulatedStudent: student };
  }

export async function getAttemptAsStudent(ctx: StudentContext, attemptId: string, studentId: string, _actor: RequestUser) {
    const student = await findStudentUser(ctx, studentId);
    await assertAttemptBelongsToStudent(ctx, attemptId, student.id);
    return getAttemptForStudent(ctx, attemptId, student);
  }

export async function saveAnswersAsStudent(ctx: StudentContext, attemptId: string, studentId: string, dto: SaveAnswersDto, actor: RequestUser) {
    const student = await findStudentUser(ctx, studentId);
    await assertAttemptBelongsToStudent(ctx, attemptId, student.id);
    const result = await saveAnswersForStudent(ctx, attemptId, dto, student);
    await ctx.audit.log({
      userId: actor.id,
      action: 'student:simulate-save-answers',
      module: 'student',
      targetType: 'attempt',
      targetId: attemptId,
      afterData: { simulatedStudentId: studentId, count: dto.answers.length },
    });
    return result;
  }

export async function submitAsStudent(ctx: StudentContext, attemptId: string, studentId: string, actor: RequestUser) {
    const student = await findStudentUser(ctx, studentId);
    await assertAttemptBelongsToStudent(ctx, attemptId, student.id);
    const result = await submitForStudent(ctx, attemptId, student);
    await ctx.audit.log({
      userId: actor.id,
      action: 'student:simulate-submit-attempt',
      module: 'student',
      targetType: 'attempt',
      targetId: attemptId,
      afterData: { simulatedStudentId: studentId },
    });
    return result;
  }

export async function resultAsStudent(ctx: StudentContext, attemptId: string, studentId: string) {
    const student = await findStudentUser(ctx, studentId);
    await assertAttemptBelongsToStudent(ctx, attemptId, student.id);
    return resultForStudent(ctx, attemptId, student, { forceFull: true });
  }