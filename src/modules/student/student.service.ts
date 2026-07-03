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
  QueryStudentExamDto,
  QueryStudentPaperDto,
  RecordWrongQuestionPracticeDto,
  SaveAnswerDto,
  SaveAnswersDto,
  UpdateWrongQuestionStatusDto,
} from './dto/save-answer.dto';
import { QuestionsService } from '../questions/questions.service';

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
};

type PaperSnapshotQuestion = {
  paperQuestionId: string;
  questionId: string;
  score: number;
  sortOrder: number;
  snapshot: QuestionSnapshot;
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

@Injectable()
export class StudentService {
  private readonly endedAttemptSaveGraceMs = 2 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly questionsService: QuestionsService,
  ) {}

  async myExams(user: RequestUser, query: QueryStudentExamDto) {
    this.ensureStudent(user);
    const now = new Date();
    const classIds = await this.resolveStudentClassIds(user.id);
    const exams = await this.prisma.exam.findMany({
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
      orderBy: this.studentExamOrderBy(query),
    });

    return exams
      .map((exam) => {
        const runtimeStatus = this.studentRuntimeExamStatus(exam, now);
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
          announcement: this.activeAnnouncementText(exam),
          announcementId: activeAnnouncement?.id ?? null,
          announcementVersion: activeAnnouncement?.version ?? null,
          announcementReadAt,
          announcementRead: Boolean(announcementReadAt),
        };
      })
      .filter((exam) => !query.status || exam.status === query.status);
  }

  async examRanking(examId: string, user: RequestUser) {
    this.ensureStudent(user);
    const exam = await this.prisma.exam.findFirst({
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

    const [attempts, allAttempts] = await this.prisma.$transaction([
      this.prisma.examAttempt.findMany({
        where: { examId, submittedAt: { not: null } },
        orderBy: [{ totalScore: 'desc' }, { submittedAt: 'asc' }],
        take: 100,
      }),
      this.prisma.examAttempt.findMany({
        where: { examId },
        orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, userId: true },
      }),
    ]);
    const userIds = [...new Set(attempts.map((attempt) => attempt.userId))];
    const users = await this.prisma.user.findMany({
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

  async enterExam(examId: string, user: RequestUser) {
    this.ensureStudent(user);
    return this.enterExamForStudent(examId, user);
  }

  async readExamAnnouncement(examId: string, user: RequestUser) {
    this.ensureStudent(user);
    await this.assertStudentCanAccessExam(examId, user.id);

    const exam = await this.prisma.exam.findFirst({
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

    const announcement = await this.ensureActiveAnnouncementRecord(exam);
    if (!announcement) {
      return { read: false, skipped: true };
    }

    const record = await this.prisma.examAnnouncementRead.upsert({
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

    await this.audit.log({
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

  async enterExamAsStudent(examId: string, studentId: string, actor: RequestUser) {
    const student = await this.findStudentUser(studentId);
    const result = await this.enterExamForStudent(examId, student);
    await this.audit.log({
      userId: actor.id,
      action: 'student:simulate-enter-exam',
      module: 'student',
      targetType: 'exam',
      targetId: examId,
      afterData: { simulatedStudentId: studentId, attemptId: result.attemptId },
    });
    return { ...result, simulatedStudent: student };
  }

  async getAttemptAsStudent(attemptId: string, studentId: string, actor: RequestUser) {
    const student = await this.findStudentUser(studentId);
    await this.assertAttemptBelongsToStudent(attemptId, student.id);
    return this.getAttemptForStudent(attemptId, student);
  }

  async saveAnswersAsStudent(attemptId: string, studentId: string, dto: SaveAnswersDto, actor: RequestUser) {
    const student = await this.findStudentUser(studentId);
    await this.assertAttemptBelongsToStudent(attemptId, student.id);
    const result = await this.saveAnswersForStudent(attemptId, dto, student);
    await this.audit.log({
      userId: actor.id,
      action: 'student:simulate-save-answers',
      module: 'student',
      targetType: 'attempt',
      targetId: attemptId,
      afterData: { simulatedStudentId: studentId, count: dto.answers.length },
    });
    return result;
  }

  async submitAsStudent(attemptId: string, studentId: string, actor: RequestUser) {
    const student = await this.findStudentUser(studentId);
    await this.assertAttemptBelongsToStudent(attemptId, student.id);
    const result = await this.submitForStudent(attemptId, student);
    await this.audit.log({
      userId: actor.id,
      action: 'student:simulate-submit-attempt',
      module: 'student',
      targetType: 'attempt',
      targetId: attemptId,
      afterData: { simulatedStudentId: studentId },
    });
    return result;
  }

  async resultAsStudent(attemptId: string, studentId: string) {
    const student = await this.findStudentUser(studentId);
    await this.assertAttemptBelongsToStudent(attemptId, student.id);
    return this.resultForStudent(attemptId, student, { forceFull: true });
  }

  private async enterExamForStudent(examId: string, user: RequestUser) {
    const exam = await this.prisma.exam.findFirst({
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

    await this.assertStudentCanAccessExam(examId, user.id);
    this.assertExamCanEnter(exam);

    const attempts = await this.prisma.examAttempt.findMany({
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
        return this.getAttemptForStudent(latestAttempt.id, user);
      }
      throw new BadRequestException('已达到考试可提交次数');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existingInstance = await tx.paperInstance.findUnique({
        where: {
          examId_studentId: {
            examId,
            studentId: user.id,
          },
        },
      });

      const paperSnapshot = existingInstance
        ? (existingInstance.paperSnapshotJson as unknown as PaperSnapshot)
        : await this.buildPaperSnapshot(tx, exam.paper);

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
            optionOrderJson: this.extractOptionOrder(paperSnapshot) as unknown as Prisma.InputJsonObject,
          },
        }));

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

    return this.formatAttemptForStudent(
      result.attempt.id,
      exam,
      result.paperInstance.id,
      result.paperSnapshot,
      result.attempt.startedAt,
    );
  }

  async getAttempt(attemptId: string, user: RequestUser) {
    this.ensureStudent(user);
    return this.getAttemptForStudent(attemptId, user);
  }

  private async getAttemptForStudent(attemptId: string, user: RequestUser) {
    const attempt = await this.prisma.examAttempt.findFirst({
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

    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;

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
        announcement: this.activeAnnouncementText(attempt.exam),
      },
      paper: this.publicPaper(paperSnapshot, attempt.paperInstance.id),
    };
  }

  async saveAnswer(attemptId: string, dto: SaveAnswerDto, user: RequestUser) {
    const attempt = await this.findEditableAttempt(attemptId, user);
    await this.saveAnswerRecord(attempt, dto);

    return {
      saved: true,
      savedAt: new Date().toISOString(),
    };
  }

  async saveAnswers(attemptId: string, dto: SaveAnswersDto, user: RequestUser) {
    return this.saveAnswersForStudent(attemptId, dto, user);
  }

  private async saveAnswersForStudent(attemptId: string, dto: SaveAnswersDto, user: RequestUser) {
    const finalizeEndedAttempt = Boolean(dto.finalizeEndedAttempt);
    const attempt = await this.findSavableAttempt(attemptId, user, { finalizeEndedAttempt });

    for (const answer of dto.answers) {
      await this.saveAnswerRecord(attempt, answer);
    }

    const shouldFinalize = finalizeEndedAttempt && this.shouldFinalizeAfterSave(attempt);
    if (shouldFinalize) {
      await this.recalculateSavedAttempt(attemptId, user, new Date());
    }

    return {
      saved: true,
      finalized: shouldFinalize,
      savedAt: new Date().toISOString(),
    };
  }

  private async saveAnswerRecord(
    attempt: Prisma.ExamAttemptGetPayload<{
      include: { exam: true; paperInstance: true };
    }>,
    dto: SaveAnswerDto,
  ) {
    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;
    const paperQuestion = this.assertQuestionInPaper(paperSnapshot, dto.questionId);
    const existing = await this.prisma.answerRecord.findUnique({
      where: {
        attemptId_questionId: {
          attemptId: attempt.id,
          questionId: dto.questionId,
        },
      },
    });
    const preserveJudgeStatus =
      paperQuestion.snapshot.type.toUpperCase() === QuestionType.PROGRAMMING &&
      Boolean(existing) &&
      (existing?.status === AnswerRecordStatus.JUDGE_PENDING || existing?.status === AnswerRecordStatus.JUDGE_DONE) &&
      this.answerCode(existing?.answerJson) === this.answerCode(dto.answer);

    await this.prisma.answerRecord.upsert({
      where: {
        attemptId_questionId: {
          attemptId: attempt.id,
          questionId: dto.questionId,
        },
      },
      update: {
        answerJson: dto.answer as Prisma.InputJsonObject,
        status: preserveJudgeStatus ? existing?.status : AnswerRecordStatus.SAVED,
        score: preserveJudgeStatus ? existing?.score : undefined,
        isCorrect: preserveJudgeStatus ? existing?.isCorrect : undefined,
        autoResultJson: preserveJudgeStatus ? this.nullableJsonInput(existing?.autoResultJson) : undefined,
      },
      create: {
        attemptId: attempt.id,
        questionId: dto.questionId,
        answerJson: dto.answer as Prisma.InputJsonObject,
        status: AnswerRecordStatus.SAVED,
      },
    });
  }

  async submit(attemptId: string, user: RequestUser) {
    this.ensureStudent(user);
    return this.submitForStudent(attemptId, user);
  }

  private async submitForStudent(attemptId: string, user: RequestUser) {
    const attempt = await this.prisma.examAttempt.findFirst({
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
      return this.result(attemptId, user);
    }

    const submittedAt = new Date();
    const timedOut = this.attemptDeadline(attempt) <= submittedAt;
    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    let objectiveScore = 0;
    let subjectiveScore = 0;
    let judgeScore = 0;
    let hasManual = false;
    let hasJudge = false;

    await this.prisma.$transaction(async (tx) => {
      for (const paperQuestion of this.flattenPaperQuestions(paperSnapshot)) {
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
            : this.gradeQuestion(paperQuestion, answerJson);

        if (grading.status === AnswerRecordStatus.AUTO_GRADED) {
          objectiveScore += grading.score;
        } else if (grading.status === AnswerRecordStatus.MANUAL_NEEDED) {
          hasManual = true;
          subjectiveScore += grading.score;
        } else if (grading.status === AnswerRecordStatus.JUDGE_PENDING || grading.status === AnswerRecordStatus.JUDGE_DONE) {
          hasJudge ||= grading.status === AnswerRecordStatus.JUDGE_PENDING;
          judgeScore += grading.score;
        }

        await tx.answerRecord.upsert({
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

        if (grading.isCorrect === false) {
          const wrongItem = await tx.wrongQuestion.upsert({
            where: {
              studentId_questionId: {
                studentId: user.id,
                questionId: paperQuestion.questionId,
              },
            },
            update: {
              wrongAnswerJson: answerJson as Prisma.InputJsonObject,
              correctAnswerJson: (paperQuestion.snapshot.answer ?? {}) as Prisma.InputJsonObject,
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
          durationSeconds: this.attemptDurationSeconds(attempt, submittedAt),
        },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'student:submit-attempt',
      module: 'student',
      targetType: 'attempt',
      targetId: attemptId,
      afterData: { objectiveScore, subjectiveScore, judgeScore },
    });

    return this.result(attemptId, user);
  }

  async result(attemptId: string, user: RequestUser) {
    this.ensureStudent(user);
    return this.resultForStudent(attemptId, user);
  }

  private async resultForStudent(
    attemptId: string,
    user: RequestUser,
    options: { forceFull?: boolean } = {},
  ) {
    const attempt = await this.prisma.examAttempt.findFirst({
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

    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    const attemptUsedCount = await this.prisma.examAttempt.count({
      where: {
        examId: attempt.examId,
        userId: user.id,
        status: { not: AttemptStatus.CANCELLED },
      },
    });
    const visibility = options.forceFull
      ? this.fullResultVisibility()
      : this.resolveResultVisibility(attempt, attemptUsedCount);

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
      questionResults: this.flattenPaperQuestions(paperSnapshot).map((paperQuestion) => {
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

  async wrongQuestions(user: RequestUser) {
    this.ensureStudent(user);
    const items = await this.prisma.wrongQuestion.findMany({
      where: {
        studentId: user.id,
        masteryStatus: { in: [MasteryStatus.UNMASTERED, MasteryStatus.REVIEWING] },
        question: { deletedAt: null },
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
      nextReviewAt: this.nextReviewAt(item.lastWrongAt, item.wrongCount, item.masteryStatus).nextReviewAt,
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

  async addWrongQuestion(user: RequestUser, dto: AddWrongQuestionDto) {
    this.ensureStudent(user);
    const question = await this.prisma.question.findFirst({
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

    const item = await this.prisma.wrongQuestion.upsert({
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
    await this.prisma.wrongQuestionEvent.create({
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

    await this.audit.log({
      userId: user.id,
      action: 'student:add-wrong-question',
      module: 'student',
      targetType: 'question',
      targetId: dto.questionId,
    });

    return { id: item.id };
  }

  async addWrongQuestions(user: RequestUser, dto: BatchWrongQuestionDto) {
    this.ensureStudent(user);
    const failed: Array<{ questionId: string; message: string }> = [];
    let successCount = 0;

    for (const item of dto.items) {
      try {
        await this.addWrongQuestion(user, item);
        successCount += 1;
      } catch (error) {
        failed.push({
          questionId: item.questionId,
          message: error instanceof Error ? error.message : '加入错题本失败',
        });
      }
    }

    await this.audit.log({
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

  async updateWrongQuestionStatus(
    user: RequestUser,
    questionId: string,
    dto: UpdateWrongQuestionStatusDto,
  ) {
    this.ensureStudent(user);
    const masteryStatus = this.normalizeMasteryStatus(dto.masteryStatus);
    const item = await this.prisma.wrongQuestion.findUnique({
      where: {
        studentId_questionId: {
          studentId: user.id,
          questionId,
        },
      },
    });

    if (!item) {
      throw new NotFoundException('错题不存在');
    }

    const updated = await this.prisma.wrongQuestion.update({
      where: { id: item.id },
      data: { masteryStatus },
    });
    await this.prisma.wrongQuestionEvent.create({
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

    await this.audit.log({
      userId: user.id,
      action: 'student:update-wrong-question-status',
      module: 'student',
      targetType: 'question',
      targetId: questionId,
      afterData: { masteryStatus },
    });

    return true;
  }

  async recordWrongQuestionPractice(user: RequestUser, questionId: string, dto: RecordWrongQuestionPracticeDto) {
    this.ensureStudent(user);
    const item = await this.prisma.wrongQuestion.findUnique({
      where: {
        studentId_questionId: {
          studentId: user.id,
          questionId,
        },
      },
      include: { question: { include: { answer: true } } },
    });
    if (!item) throw new NotFoundException('错题不存在');

    const masteryStatus = dto.isCorrect ? MasteryStatus.MASTERED : MasteryStatus.UNMASTERED;
    const updated = await this.prisma.wrongQuestion.update({
      where: { id: item.id },
      data: dto.isCorrect
        ? { masteryStatus }
        : {
            sourceType: WrongQuestionSourceType.PRACTICE,
            sourceId: questionId,
            wrongAnswerJson: (dto.answer ?? {}) as Prisma.InputJsonObject,
            correctAnswerJson: (item.question.answer?.answerJson ?? item.correctAnswerJson ?? {}) as Prisma.InputJsonObject,
            score: dto.score ?? 0,
            masteryStatus,
            wrongCount: { increment: 1 },
            lastWrongAt: new Date(),
          },
    });

    await this.prisma.wrongQuestionEvent.create({
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
        } as Prisma.InputJsonObject,
      },
    });

    return {
      mastered: dto.isCorrect,
      masteryStatus: toApiEnum(updated.masteryStatus),
      wrongCount: updated.wrongCount,
      nextReviewAt: this.nextReviewAt(updated.lastWrongAt, updated.wrongCount, updated.masteryStatus).nextReviewAt,
    };
  }

  async wrongQuestionEvents(user: RequestUser, questionId: string) {
    this.ensureStudent(user);
    const exists = await this.prisma.wrongQuestion.findUnique({
      where: { studentId_questionId: { studentId: user.id, questionId } },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('错题不存在');

    const events = await this.prisma.wrongQuestionEvent.findMany({
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

  async wrongQuestionInsights(user: RequestUser) {
    this.ensureStudent(user);
    const classIds = await this.resolveStudentClassIds(user.id);
    const [items, events, reviewRules] = await this.prisma.$transaction([
      this.prisma.wrongQuestion.findMany({
        where: { studentId: user.id, question: { deletedAt: null } },
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
      this.prisma.wrongQuestionEvent.findMany({
        where: { studentId: user.id },
        include: { question: { select: { id: true, title: true } } },
        orderBy: { happenedAt: 'asc' },
        take: 500,
      }),
      this.prisma.reviewReminderRule.findMany({
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
        const rule = this.matchReviewRule(item.question, reviewRules, classIds);
        const reviewPlan = this.nextReviewAt(item.lastWrongAt, item.wrongCount, item.masteryStatus, rule);
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

  async generateWrongQuestionPaper(user: RequestUser, dto: GenerateWrongQuestionPaperDto) {
    this.ensureStudent(user);
    const where: Prisma.WrongQuestionWhereInput = {
      studentId: user.id,
      masteryStatus: { in: [MasteryStatus.UNMASTERED, MasteryStatus.REVIEWING] },
      questionId: dto.questionIds?.length ? { in: dto.questionIds } : undefined,
      question: { deletedAt: null, status: QuestionStatus.PUBLISHED },
    };
    const wrongItems = await this.prisma.wrongQuestion.findMany({
      where,
      include: { question: true },
      orderBy: [{ wrongCount: 'desc' }, { lastWrongAt: 'desc' }],
    });

    const selected = (dto.random ? this.pickRandom(wrongItems, dto.count ?? wrongItems.length) : wrongItems)
      .slice(0, dto.count ?? wrongItems.length);

    if (!selected.length) {
      throw new BadRequestException('当前没有可组卷的公开错题');
    }

    const courseId = selected[0].question.courseId;
    const title = dto.name?.trim() || `我的错题组卷 ${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}`;

    const result = await this.prisma.$transaction(async (tx) => {
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
        const snapshot = await this.questionsService.buildSnapshot(tx, item.questionId);
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

    await this.audit.log({
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

  async studentPapers(user: RequestUser, query: QueryStudentPaperDto) {
    this.ensureStudent(user);
    const { page, pageSize, skip, take } = toPagination(query);
    const where = this.studentPracticePaperWhere(query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.paper.findMany({
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
        orderBy: this.studentPaperOrderBy(query),
        skip,
        take,
      }),
      this.prisma.paper.count({ where }),
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

  async previewStudentPaper(user: RequestUser, paperId: string) {
    this.ensureStudent(user);
    const paper = await this.prisma.paper.findFirst({
      where: this.studentPracticePaperPreviewWhere(user.id, paperId),
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

  private studentPracticePaperWhere(query?: Pick<QueryStudentPaperDto, 'courseId' | 'keyword'>): Prisma.PaperWhereInput {
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

  private studentPracticePaperPreviewWhere(userId: string, paperId: string): Prisma.PaperWhereInput {
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

  private async findSavableAttempt(
    attemptId: string,
    user: RequestUser,
    options: { finalizeEndedAttempt?: boolean } = {},
  ) {
    this.ensureStudent(user);
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: user.id },
      include: { exam: true, paperInstance: true },
    });

    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }

    if (attempt.status === AttemptStatus.IN_PROGRESS) {
      const now = new Date();
      const deadline = this.attemptDeadline(attempt);
      if (attempt.exam.endTime <= now || deadline <= now) {
        if (options.finalizeEndedAttempt && this.canFinalizeEndedAttemptSave(attempt, now)) {
          return attempt;
        }
        throw new BadRequestException(
          attempt.exam.endTime <= now ? '考试已结束，不能保存答案' : '答题时长已用完，不能继续保存答案，请提交试卷',
        );
      }
      return attempt;
    }

    if (options.finalizeEndedAttempt && this.canFinalizeEndedAttemptSave(attempt)) {
      return attempt;
    }

    throw new BadRequestException('答案已提交，不能修改');
  }

  private async findEditableAttempt(attemptId: string, user: RequestUser) {
    this.ensureStudent(user);
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: user.id },
      include: { exam: true, paperInstance: true },
    });

    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }

    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('答案已提交，不能修改');
    }

    if (attempt.exam.endTime <= new Date()) {
      throw new BadRequestException('考试已结束，不能保存答案');
    }

    if (this.attemptDeadline(attempt) <= new Date()) {
      throw new BadRequestException('答题时长已用完，不能继续保存答案，请提交试卷');
    }

    return attempt;
  }

  private canFinalizeEndedAttemptSave(
    attempt: {
      status: AttemptStatus;
      submittedAt: Date | null;
      startedAt: Date;
      exam: { status: ExamStatus; endTime: Date; durationMinutes: number };
    },
    now = new Date(),
  ) {
    const salvageableStatuses = new Set<AttemptStatus>([
      AttemptStatus.IN_PROGRESS,
      AttemptStatus.SUBMITTED,
      AttemptStatus.GRADING,
      AttemptStatus.GRADED,
      AttemptStatus.TIMEOUT_SUBMITTED,
    ]);
    if (!salvageableStatuses.has(attempt.status)) {
      return false;
    }

    const deadline = this.attemptDeadline(attempt);
    if (deadline > now) return false;
    return now.getTime() - deadline.getTime() <= this.endedAttemptSaveGraceMs;
  }

  private shouldFinalizeAfterSave(attempt: {
    status: AttemptStatus;
    submittedAt: Date | null;
    startedAt: Date;
    exam: { status: ExamStatus; endTime: Date; durationMinutes: number };
  }) {
    return this.canFinalizeEndedAttemptSave(attempt);
  }

  private async recalculateSavedAttempt(attemptId: string, user: RequestUser, finalizedAt: Date) {
    const attempt = await this.prisma.examAttempt.findFirst({
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

    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    let objectiveScore = 0;
    let subjectiveScore = 0;
    let judgeScore = 0;
    let hasManual = false;
    let hasJudge = false;

    await this.prisma.$transaction(async (tx) => {
      for (const paperQuestion of this.flattenPaperQuestions(paperSnapshot)) {
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
            : this.gradeQuestion(paperQuestion, answerJson);

        if (grading.status === AnswerRecordStatus.AUTO_GRADED) {
          objectiveScore += grading.score;
        } else if (grading.status === AnswerRecordStatus.MANUAL_NEEDED) {
          hasManual = true;
          subjectiveScore += grading.score;
        } else if (grading.status === AnswerRecordStatus.JUDGE_PENDING || grading.status === AnswerRecordStatus.JUDGE_DONE) {
          hasJudge ||= grading.status === AnswerRecordStatus.JUDGE_PENDING;
          judgeScore += grading.score;
        }

        await tx.answerRecord.upsert({
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
      }

      await tx.examAttempt.update({
        where: { id: attemptId },
        data: {
          status: hasManual || hasJudge ? AttemptStatus.GRADING : AttemptStatus.GRADED,
          submittedAt: attempt.submittedAt ?? finalizedAt,
          objectiveScore,
          subjectiveScore,
          judgeScore,
          totalScore: objectiveScore + subjectiveScore + judgeScore,
          durationSeconds: this.attemptDurationSeconds(attempt, attempt.submittedAt ?? finalizedAt),
        },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'student:finalize-saved-attempt',
      module: 'student',
      targetType: 'attempt',
      targetId: attemptId,
      afterData: { objectiveScore, subjectiveScore, judgeScore, salvaged: true },
    });
  }

  private attemptDeadline(attempt: { startedAt: Date; exam: { durationMinutes: number; endTime: Date } }) {
    const durationDeadline = new Date(attempt.startedAt.getTime() + attempt.exam.durationMinutes * 60_000);
    return durationDeadline < attempt.exam.endTime ? durationDeadline : attempt.exam.endTime;
  }

  private attemptDurationSeconds(
    attempt: { startedAt: Date; exam: { durationMinutes: number; endTime: Date } },
    now = new Date(),
  ) {
    const deadline = this.attemptDeadline(attempt);
    const effectiveEnd = now < deadline ? now : deadline;
    return Math.max(0, Math.floor((effectiveEnd.getTime() - attempt.startedAt.getTime()) / 1000));
  }

  private ensureStudent(user: RequestUser) {
    if (user.userType !== 'STUDENT') {
      throw new ForbiddenException('仅学生账号可以访问学生端接口');
    }
  }

  private normalizeMasteryStatus(value: string) {
    const normalized = value.replace(/-/g, '_').toUpperCase() as MasteryStatus;
    if (!Object.values(MasteryStatus).includes(normalized)) {
      throw new BadRequestException('掌握状态不合法');
    }
    return normalized;
  }

  private async findStudentUser(studentId: string): Promise<RequestUser> {
    const student = await this.prisma.user.findFirst({
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

  private async resolveStudentClassIds(studentId: string) {
    const relations = await this.prisma.classStudent.findMany({
      where: { studentId, classGroup: { deletedAt: null, status: 'active' } },
      select: { classId: true },
    });
    return relations.map((relation) => relation.classId);
  }

  private async assertStudentCanAccessExam(examId: string, studentId: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, deletedAt: null },
      select: { classId: true },
    });
    if (!exam?.classId) return;
    const exists = await this.prisma.classStudent.findFirst({
      where: {
        classId: exam.classId,
        studentId,
        classGroup: { deletedAt: null, status: 'active' },
      },
      select: { id: true },
    });
    if (!exists) {
      throw new ForbiddenException('该考试不在你的班级范围内');
    }
  }

  private async assertAttemptBelongsToStudent(attemptId: string, studentId: string) {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId, userId: studentId },
      select: { id: true },
    });
    if (!attempt) {
      throw new NotFoundException('模拟答题记录不存在');
    }
  }

  private fullResultVisibility(): ResultVisibility {
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

  private resolveResultVisibility(
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
    const answerModeOpen = this.isAnswerModeOpen(attempt.exam.showAnswerMode, attempt);
    const scoreVisible = this.isScoreModeOpen(attempt.exam.showScoreMode, attempt);
    const early = this.extractResultVisibility(attempt.exam.antiCheatConfigJson);
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

  private isAnswerModeOpen(
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

  private isScoreModeOpen(
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

  private extractResultVisibility(config: Prisma.JsonValue | null) {
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

  private assertExamCanEnter(exam: { status: ExamStatus; startTime: Date; endTime: Date }) {
    const now = new Date();
    const runtimeStatus = this.studentRuntimeExamStatus(exam, now);

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

  private studentRuntimeExamStatus(exam: { status: ExamStatus; startTime: Date; endTime: Date }, now = new Date()) {
    if (exam.status === ExamStatus.ENDED || exam.endTime <= now) return 'ended';
    if (exam.status === ExamStatus.RUNNING || exam.startTime <= now) return 'running';
    if (exam.status === ExamStatus.SCHEDULED) return 'scheduled';
    return toApiEnum(exam.status);
  }

  private assertQuestionInPaper(paperSnapshot: PaperSnapshot, questionId: string) {
    const paperQuestion = this.flattenPaperQuestions(paperSnapshot).find((question) => question.questionId === questionId);
    if (!paperQuestion) {
      throw new BadRequestException('题目不属于当前试卷实例');
    }
    return paperQuestion;
  }

  private answerCode(answerJson: Prisma.JsonValue | Record<string, unknown> | undefined | null) {
    if (!answerJson || typeof answerJson !== 'object' || Array.isArray(answerJson)) return '';
    const answer = answerJson as Record<string, unknown>;
    return String(answer.code ?? answer.text ?? '').trim();
  }

  private nullableJsonInput(value: Prisma.JsonValue | undefined) {
    return value === null ? Prisma.JsonNull : value === undefined ? undefined : (value as Prisma.InputJsonValue);
  }

  private async buildPaperSnapshot(
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
      return this.buildRandomPaperSnapshot(tx, paper);
    }

    return this.buildFixedPaperSnapshot(paper);
  }

  private buildFixedPaperSnapshot(paper: Prisma.PaperGetPayload<{
    include: {
      sections: { include: { questions: true } };
      questions: true;
      rules: true;
    };
  }>): PaperSnapshot {
    const sections: PaperSnapshotSection[] = paper.sections.map((section) => {
      const orderedQuestions = paper.shuffleQuestions || section.shuffleQuestions
        ? this.shuffle(section.questions)
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
          snapshot: this.prepareQuestionSnapshot(question.questionSnapshotJson, paper.shuffleOptions),
        })),
      };
    });

    if (paper.questions.length) {
      const orderedQuestions = paper.shuffleQuestions ? this.shuffle(paper.questions) : paper.questions;
      sections.push({
        id: null,
        title: '未分区题目',
        sortOrder: sections.length + 1,
        questions: orderedQuestions.map((question, index) => ({
          paperQuestionId: question.id,
          questionId: question.questionId,
          score: Number(question.score),
          sortOrder: index + 1,
          snapshot: this.prepareQuestionSnapshot(question.questionSnapshotJson, paper.shuffleOptions),
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

  private async buildRandomPaperSnapshot(
    tx: Prisma.TransactionClient,
    paper: Prisma.PaperGetPayload<{
      include: {
        sections: { include: { questions: true } };
        questions: true;
        rules: true;
      };
    }>,
  ): Promise<PaperSnapshot> {
    const ruleConfig = this.paperRuleConfig(paper.rules[0]?.ruleJson);
    const sections: PaperSnapshotSection[] = [];
    const selectedIds = new Set<string>();
    const shuffleOptions = ruleConfig.shuffleOptions ?? paper.shuffleOptions;

    for (const [sectionIndex, rule] of ruleConfig.rules.entries()) {
      const candidates = await this.findRandomRuleCandidates(tx, paper.courseId, rule, [...selectedIds]);
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

      const chosen = this.pickRandom(candidates, rule.count);
      const questions: PaperSnapshotQuestion[] = [];
      for (const [index, question] of chosen.entries()) {
        selectedIds.add(question.id);
        const snapshot = await this.questionsService.buildSnapshot(tx, question.id);
        questions.push({
          paperQuestionId: `random-${sectionIndex + 1}-${index + 1}`,
          questionId: question.id,
          score: rule.scoreEach,
          sortOrder: index + 1,
          snapshot: this.prepareQuestionSnapshot(snapshot as Prisma.JsonValue, shuffleOptions),
        });
      }

      sections.push({
        id: `random-${sectionIndex + 1}`,
        title: rule.sectionTitle,
        sortOrder: sectionIndex + 1,
        questions: ruleConfig.shuffleQuestions ? this.shuffle(questions) : questions,
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

  private paperRuleConfig(value: Prisma.JsonValue | undefined) {
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

  private async findRandomRuleCandidates(
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

  private publicPaper(paperSnapshot: PaperSnapshot, paperInstanceId: string) {
    return {
      paperInstanceId,
      sections: paperSnapshot.sections.map((section) => ({
        title: section.title,
        questions: section.questions.map((paperQuestion) => ({
          questionId: paperQuestion.questionId,
          type: paperQuestion.snapshot.type,
          title: paperQuestion.snapshot.title,
          content: paperQuestion.snapshot.content,
          score: paperQuestion.score,
          blankCount: this.blankCount(paperQuestion.snapshot.answer),
          programmingRef: paperQuestion.snapshot.programmingRef
            ? {
                ...paperQuestion.snapshot.programmingRef,
                externalProblemUrl:
                  paperQuestion.snapshot.programmingRef.externalProblemUrl ??
                  null,
              }
            : null,
          options: (paperQuestion.snapshot.options ?? []).map((option) => ({
            optionId: option.id,
            label: option.optionKey,
            content: option.content,
          })),
        })),
      })),
    };
  }

  private blankCount(answerJson: unknown) {
    if (!answerJson || typeof answerJson !== 'object' || Array.isArray(answerJson)) return 1;
    const blanks = (answerJson as { blanks?: unknown[] }).blanks;
    return Array.isArray(blanks) && blanks.length ? blanks.length : 1;
  }

  private formatAttemptForStudent(
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
        announcement: this.extractAnnouncement((exam as { antiCheatConfigJson?: Prisma.JsonValue | null }).antiCheatConfigJson ?? null),
      },
      paper: this.publicPaper(paperSnapshot, paperInstanceId),
    };
  }

  private extractOptionOrder(paperSnapshot: PaperSnapshot) {
    const optionOrder: Record<string, string[]> = {};
    for (const question of this.flattenPaperQuestions(paperSnapshot)) {
      optionOrder[question.questionId] = (question.snapshot.options ?? []).map((option) => option.id);
    }
    return optionOrder;
  }

  private flattenPaperQuestions(paperSnapshot: PaperSnapshot) {
    return paperSnapshot.sections.flatMap((section) => section.questions);
  }

  private prepareQuestionSnapshot(snapshotJson: Prisma.JsonValue, shuffleOptions: boolean) {
    const snapshot = snapshotJson as unknown as QuestionSnapshot;
    if (!shuffleOptions || snapshot.allowOptionShuffle === false || !snapshot.options?.length) {
      return snapshot;
    }

    return {
      ...snapshot,
      options: this.shuffle(snapshot.options).map((option, index) => ({
        ...option,
        sortOrder: index + 1,
      })),
    };
  }

  private shuffle<T>(items: T[]) {
    return [...items].sort(() => Math.random() - 0.5);
  }

  private extractAnnouncement(config: Prisma.JsonValue | null) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return '';
    const value = (config as Record<string, unknown>).announcement;
    return typeof value === 'string' ? value : '';
  }

  private activeAnnouncementText(source: {
    announcements?: Array<{ content: string }>;
    antiCheatConfigJson?: Prisma.JsonValue | null;
  }) {
    return source.announcements?.[0]?.content ?? this.extractAnnouncement(source.antiCheatConfigJson ?? null);
  }

  private async ensureActiveAnnouncementRecord(exam: {
    id: string;
    antiCheatConfigJson: Prisma.JsonValue | null;
    announcements: Array<{ id: string; version: number; content: string }>;
  }) {
    const active = exam.announcements[0];
    if (active) return active;

    const legacyContent = this.extractAnnouncement(exam.antiCheatConfigJson).trim();
    if (!legacyContent) return null;

    const latest = await this.prisma.examAnnouncement.aggregate({
      where: { examId: exam.id },
      _max: { version: true },
    });
    return this.prisma.examAnnouncement.create({
      data: {
        examId: exam.id,
        version: (latest._max.version ?? 0) + 1,
        content: legacyContent,
      },
    });
  }

  private studentExamOrderBy(query: QueryStudentExamDto): Prisma.ExamOrderByWithRelationInput[] {
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

  private studentPaperOrderBy(query: QueryStudentPaperDto): Prisma.PaperOrderByWithRelationInput[] {
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

  private gradeQuestion(paperQuestion: PaperSnapshotQuestion, answerJson: Record<string, unknown>) {
    const type = paperQuestion.snapshot.type.toUpperCase();

    if (
      type === QuestionType.SINGLE_CHOICE ||
      type === QuestionType.MULTIPLE_CHOICE ||
      type === QuestionType.TRUE_FALSE
    ) {
      const selected = new Set((answerJson.selectedOptionIds as string[] | undefined) ?? []);
      const correct = new Set(paperQuestion.snapshot.answer?.correctOptionIds ?? []);
      const isCorrect =
        selected.size === correct.size && [...selected].every((optionId) => correct.has(optionId));
      return {
        score: isCorrect ? paperQuestion.score : 0,
        isCorrect,
        status: AnswerRecordStatus.AUTO_GRADED,
        autoResult: { selectedOptionIds: [...selected], correctOptionIds: [...correct] },
      };
    }

    if (type === QuestionType.FILL_BLANK) {
      const blanks = (answerJson.blanks as Array<{ index: number; value: string }> | undefined) ?? [];
      const rules = paperQuestion.snapshot.answer?.blanks ?? [];
      let score = 0;
      let allCorrect = true;

      for (const rule of rules) {
        const submitted = blanks.find((blank) => blank.index === rule.index)?.value ?? '';
        const normalizedSubmitted = this.normalizeBlank(submitted, rule);
        const matched = rule.answers
          .map((answer) => this.normalizeBlank(answer, rule))
          .includes(normalizedSubmitted);
        if (matched) {
          score += rule.score ?? paperQuestion.score / Math.max(rules.length, 1);
        } else {
          allCorrect = false;
        }
      }

      return {
        score,
        isCorrect: allCorrect,
        status: AnswerRecordStatus.AUTO_GRADED,
        autoResult: { blanks, rules },
      };
    }

    if (type === QuestionType.PROGRAMMING) {
      return {
        score: 0,
        isCorrect: null,
        status: AnswerRecordStatus.JUDGE_PENDING,
        autoResult: {},
      };
    }

    return {
      score: 0,
      isCorrect: null,
      status: AnswerRecordStatus.MANUAL_NEEDED,
      autoResult: {},
    };
  }

  private normalizeBlank(
    value: string,
    rule: { ignoreCase?: boolean; trimSpace?: boolean },
  ) {
    let result = value;
    if (rule.trimSpace ?? true) {
      result = result.trim();
    }
    if (rule.ignoreCase) {
      result = result.toLowerCase();
    }
    return result;
  }

  private matchReviewRule(
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

  private nextReviewAt(
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
    const intervals = this.reviewIntervals(rule?.intervalsJson);
    const masteryRule = this.reviewMasteryRule(rule?.masteryRuleJson);
    const index = Math.min(Math.max(wrongCount || 1, 1) - 1, intervals.length - 1);
    const intervalDays = status === MasteryStatus.REVIEWING ? masteryRule.reviewingIntervalDays : intervals[index];
    return {
      nextReviewAt: new Date(lastWrongAt.getTime() + intervalDays * 24 * 60 * 60 * 1000),
      intervalDays,
    };
  }

  private reviewIntervals(value: Prisma.JsonValue | undefined) {
    if (!Array.isArray(value)) return [1, 3, 7, 14, 30];
    const intervals = value.map(Number).filter((item) => Number.isFinite(item) && item > 0);
    return intervals.length ? intervals : [1, 3, 7, 14, 30];
  }

  private reviewMasteryRule(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { reviewingIntervalDays: 3, correctStreak: 2 };
    }
    const source = value as Record<string, unknown>;
    return {
      reviewingIntervalDays: Number(source.reviewingIntervalDays) > 0 ? Math.round(Number(source.reviewingIntervalDays)) : 3,
      correctStreak: Number(source.correctStreak) > 0 ? Math.round(Number(source.correctStreak)) : 2,
    };
  }

  private pickRandom<T>(items: T[], count: number) {
    return [...items].sort(() => Math.random() - 0.5).slice(0, count);
  }
}
