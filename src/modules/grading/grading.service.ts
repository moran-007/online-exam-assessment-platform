import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AnswerRecordStatus, AttemptStatus, Prisma, QuestionType, ShowScoreMode } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { GradeAnswerDto } from './dto/grade-answer.dto';
import { BatchGradeAnswersDto } from './dto/batch-grade-answers.dto';
import { PublishGradesDto } from './dto/grade-visibility.dto';
import { QueryGradingDto } from './dto/query-grading.dto';

type SnapshotQuestion = {
  questionId: string;
  score: number;
  snapshot: {
    id: string;
    type: string;
    title: string;
    content: string;
    analysis?: string | null;
    answer?: Prisma.JsonValue | null;
    options?: Array<{ id: string; optionKey: string; content: string; isCorrect?: boolean }>;
  };
};

type PaperSnapshot = {
  sections: Array<{ questions: SnapshotQuestion[] }>;
};

type ObjectiveGradingResult = {
  score: number;
  isCorrect: boolean;
  autoResult: Prisma.InputJsonObject;
};

@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dataScope: DataScopeService,
  ) {}

  async list(query: QueryGradingDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const status = this.answerStatusWhere(query.status);
    const questionType = this.questionTypeWhere(query.questionType);
    const examScope = await this.dataScope.examWhere(user);
    const where: Prisma.AnswerRecordWhereInput = {
      status:
        status ?? {
          in: [
            AnswerRecordStatus.MANUAL_NEEDED,
            AnswerRecordStatus.MANUAL_GRADED,
            AnswerRecordStatus.JUDGE_PENDING,
            AnswerRecordStatus.JUDGE_DONE,
          ],
        },
      attempt: {
        examId: query.examId,
        userId: query.studentId,
        submittedAt: { not: null },
        exam: examScope,
      },
      question: questionType ? { type: questionType } : undefined,
      OR: query.keyword
        ? [
            { question: { title: { contains: query.keyword, mode: 'insensitive' } } },
            { attempt: { exam: { name: { contains: query.keyword, mode: 'insensitive' } } } },
          ]
        : undefined,
    };

    const [records, total] = await this.prisma.$transaction([
      this.prisma.answerRecord.findMany({
        where,
        include: {
          question: { select: { title: true, type: true } },
          attempt: {
            include: {
              exam: { include: { course: { select: { name: true } } } },
              paperInstance: true,
            },
          },
        },
        orderBy: this.orderBy(query),
        skip,
        take,
      }),
      this.prisma.answerRecord.count({ where }),
    ]);
    const userMap = await this.loadUserMap(records.map((item) => item.attempt.userId));

    return {
      items: records.map((record) => {
        const snapshot = this.findSnapshotQuestion(
          record.attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot,
          record.questionId,
        );
        const student = userMap.get(record.attempt.userId);
        return {
          id: record.id,
          attemptId: record.attemptId,
          examId: record.attempt.examId,
          examName: record.attempt.exam.name,
          courseName: record.attempt.exam.course.name,
          studentId: record.attempt.userId,
          studentName: student?.realName ?? student?.username ?? '学生',
          username: student?.username ?? '',
          questionId: record.questionId,
          questionTitle: snapshot?.snapshot.title ?? record.question.title,
          questionType: this.toQuestionType(snapshot?.snapshot.type ?? record.question.type),
          maxScore: snapshot?.score ?? 0,
          score: Number(record.score),
          isCorrect: record.isCorrect,
          studentAnswer: record.answerJson,
          referenceAnswer: snapshot?.snapshot.answer ?? {},
          options: snapshot?.snapshot.options ?? [],
          manualComment: record.manualComment ?? '',
          status: toApiEnum(record.status),
          submittedAt: record.attempt.submittedAt,
          gradedAt: record.gradedAt,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  async attemptDetail(attemptId: string, user: RequestUser) {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId },
      include: {
        exam: { include: { course: true, paper: true } },
        paperInstance: true,
        answers: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }
    await this.dataScope.assertExamAccessible(user, attempt.examId);
    const student = await this.prisma.user.findFirst({
      where: { id: attempt.userId },
      select: { id: true, username: true, realName: true },
    });
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;

    return {
      attemptId: attempt.id,
      exam: {
        id: attempt.examId,
        name: attempt.exam.name,
        courseName: attempt.exam.course.name,
        paperName: attempt.exam.paper.name,
      },
      student: {
        id: attempt.userId,
        username: student?.username ?? '',
        name: student?.realName ?? student?.username ?? '学生',
      },
      status: toApiEnum(attempt.status),
      totalScore: Number(attempt.totalScore),
      objectiveScore: Number(attempt.objectiveScore),
      subjectiveScore: Number(attempt.subjectiveScore),
      judgeScore: Number(attempt.judgeScore),
      submittedAt: attempt.submittedAt,
      questions: this.flattenSnapshot(paperSnapshot).map((paperQuestion) => {
        const answer = answerMap.get(paperQuestion.questionId);
        return {
          answerRecordId: answer?.id ?? null,
          questionId: paperQuestion.questionId,
          type: this.toQuestionType(paperQuestion.snapshot.type),
          title: paperQuestion.snapshot.title,
          content: paperQuestion.snapshot.content,
          options: paperQuestion.snapshot.options ?? [],
          referenceAnswer: paperQuestion.snapshot.answer ?? {},
          analysis: paperQuestion.snapshot.analysis ?? '',
          maxScore: paperQuestion.score,
          studentAnswer: answer?.answerJson ?? {},
          score: Number(answer?.score ?? 0),
          isCorrect: answer?.isCorrect,
          status: answer ? toApiEnum(answer.status) : 'missing',
          manualComment: answer?.manualComment ?? '',
          gradedAt: answer?.gradedAt,
        };
      }),
    };
  }

  async gradeAnswer(answerRecordId: string, dto: GradeAnswerDto, user: RequestUser) {
    const record = await this.prisma.answerRecord.findFirst({
      where: { id: answerRecordId },
      include: {
        attempt: { include: { paperInstance: true } },
      },
    });
    if (!record) {
      throw new NotFoundException('待批改答案不存在');
    }
    await this.dataScope.assertExamAccessible(user, record.attempt.examId);
    if (!this.isGradableStatus(record.status)) {
      throw new BadRequestException('当前答案不是可批改题');
    }

    const snapshot = this.findSnapshotQuestion(
      record.attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot,
      record.questionId,
    );
    const maxScore = snapshot?.score ?? 0;
    if (dto.score > maxScore) {
      throw new BadRequestException(`得分不能超过该题分值 ${maxScore}`);
    }
    const nextStatus = this.isJudgeQuestion(record.status, snapshot)
      ? AnswerRecordStatus.JUDGE_DONE
      : AnswerRecordStatus.MANUAL_GRADED;

    await this.prisma.$transaction(async (tx) => {
      await tx.answerRecord.update({
        where: { id: answerRecordId },
        data: {
          score: dto.score,
          isCorrect: dto.score >= maxScore && maxScore > 0,
          status: nextStatus,
          manualComment: dto.comment?.trim() || null,
          gradedBy: user.id,
          gradedAt: new Date(),
        },
      });
      await this.recalculateAttempt(tx, record.attemptId);
    });

    await this.audit.log({
      userId: user.id,
      action: 'grading:grade-answer',
      module: 'grading',
      targetType: 'answer_record',
      targetId: answerRecordId,
      afterData: { score: dto.score, comment: dto.comment },
    });

    return { id: answerRecordId };
  }

  async batchGradeAnswers(dto: BatchGradeAnswersDto, user: RequestUser) {
    const ids = [...new Set(dto.answerRecordIds)];
    const records = await this.prisma.answerRecord.findMany({
      where: { id: { in: ids } },
      include: { attempt: { include: { paperInstance: true } } },
    });
    if (records.length !== ids.length) {
      throw new NotFoundException('部分待批改答案不存在，请刷新列表后重试');
    }

    for (const record of records) {
      await this.dataScope.assertExamAccessible(user, record.attempt.examId);
      if (!this.isGradableStatus(record.status)) {
        throw new BadRequestException('选中项中存在不可批改的答案，请刷新列表后重试');
      }
    }

    for (const record of records) {
      const snapshot = this.findSnapshotQuestion(
        record.attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot,
        record.questionId,
      );
      await this.gradeAnswer(
        record.id,
        {
          score: dto.mode === 'full' ? (snapshot?.score ?? 0) : 0,
          comment: dto.comment,
        },
        user,
      );
    }

    return { updatedCount: records.length, mode: dto.mode };
  }

  async finishAttempt(attemptId: string, user: RequestUser) {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId },
      include: { answers: true },
    });
    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }
    await this.dataScope.assertExamAccessible(user, attempt.examId);

    const pending = attempt.answers.filter(
      (answer) =>
        answer.status === AnswerRecordStatus.MANUAL_NEEDED ||
        answer.status === AnswerRecordStatus.JUDGE_PENDING,
    );
    if (pending.length) {
      throw new BadRequestException({
        message: '仍有题目未完成批改或判题，不能完成整卷批改',
        data: {
          pendingCount: pending.length,
          manualPendingCount: pending.filter((answer) => answer.status === AnswerRecordStatus.MANUAL_NEEDED).length,
          judgePendingCount: pending.filter((answer) => answer.status === AnswerRecordStatus.JUDGE_PENDING).length,
        },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.recalculateAttempt(tx, attemptId);
      await tx.examAttempt.update({
        where: { id: attemptId },
        data: { status: AttemptStatus.GRADED },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'grading:finish-attempt',
      module: 'grading',
      targetType: 'attempt',
      targetId: attemptId,
    });

    return this.attemptScore(attemptId);
  }

  async regradeAttempt(attemptId: string, user: RequestUser) {
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId },
      include: {
        paperInstance: true,
        answers: true,
      },
    });
    if (!attempt) {
      throw new NotFoundException('答题记录不存在');
    }
    await this.dataScope.assertExamAccessible(user, attempt.examId);

    const paperSnapshot = attempt.paperInstance.paperSnapshotJson as unknown as PaperSnapshot;
    const answerMap = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    let updatedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const paperQuestion of this.flattenSnapshot(paperSnapshot)) {
        const existing = answerMap.get(paperQuestion.questionId);
        const grading = this.gradeObjectiveQuestion(paperQuestion, existing?.answerJson);
        if (!existing || !grading) continue;

        await tx.answerRecord.update({
          where: { id: existing.id },
          data: {
            score: grading.score,
            isCorrect: grading.isCorrect,
            status: AnswerRecordStatus.AUTO_GRADED,
            autoResultJson: grading.autoResult,
          },
        });
        updatedCount += 1;
      }
      await this.recalculateAttempt(tx, attemptId);
    });

    await this.audit.log({
      userId: user.id,
      action: 'grading:regrade-attempt',
      module: 'grading',
      targetType: 'attempt',
      targetId: attemptId,
      afterData: { updatedCount },
    });

    return {
      ...(await this.attemptScore(attemptId)),
      updatedCount,
    };
  }

  async publishGrades(examId: string, dto: PublishGradesDto, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, examId);
    const mode = this.normalizeShowScoreMode(dto.mode ?? 'after_graded');
    if (mode === ShowScoreMode.NEVER) {
      throw new BadRequestException('发布成绩不能使用 never 模式，请使用撤回接口');
    }

    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        examId,
        id: dto.attemptIds?.length ? { in: [...new Set(dto.attemptIds)] } : undefined,
        userId: dto.studentIds?.length ? { in: [...new Set(dto.studentIds)] } : undefined,
        submittedAt: { not: null },
        status: { not: AttemptStatus.CANCELLED },
      },
      include: { answers: true },
    });
    if (!attempts.length) {
      throw new BadRequestException('没有可发布成绩的提交记录');
    }

    const blocked = attempts.filter((attempt) =>
      attempt.answers.some(
        (answer) =>
          answer.status === AnswerRecordStatus.MANUAL_NEEDED ||
          answer.status === AnswerRecordStatus.JUDGE_PENDING,
      ),
    );
    if (blocked.length && !dto.skipPending) {
      throw new BadRequestException({
        message: '仍有试卷存在未批改或未判题答案，不能发布成绩',
        data: {
          pendingAttemptCount: blocked.length,
          attemptIds: blocked.map((attempt) => attempt.id),
        },
      });
    }

    const publishable = attempts.filter((attempt) => !blocked.some((item) => item.id === attempt.id));
    const publishableIds = publishable.map((attempt) => attempt.id);
    await this.prisma.$transaction(async (tx) => {
      if (publishableIds.length) {
        await tx.examAttempt.updateMany({
          where: { id: { in: publishableIds } },
          data: { status: AttemptStatus.GRADED },
        });
      }
      await tx.exam.update({
        where: { id: examId },
        data: { showScoreMode: mode },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'grading:publish-grades',
      module: 'grading',
      targetType: 'exam',
      targetId: examId,
      afterData: {
        mode,
        publishableCount: publishableIds.length,
        skippedPendingCount: blocked.length,
      },
    });

    return {
      examId,
      showScoreMode: toApiEnum(mode),
      publishedAttemptCount: publishableIds.length,
      skippedPendingCount: blocked.length,
      skippedAttemptIds: blocked.map((attempt) => attempt.id),
    };
  }

  async withdrawGrades(examId: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, examId);
    await this.prisma.exam.update({
      where: { id: examId },
      data: { showScoreMode: ShowScoreMode.NEVER },
    });
    await this.audit.log({
      userId: user.id,
      action: 'grading:withdraw-grades',
      module: 'grading',
      targetType: 'exam',
      targetId: examId,
      afterData: { showScoreMode: ShowScoreMode.NEVER },
    });

    return {
      examId,
      showScoreMode: toApiEnum(ShowScoreMode.NEVER),
      withdrawn: true,
    };
  }

  private async recalculateAttempt(tx: Prisma.TransactionClient, attemptId: string) {
    const answers = await tx.answerRecord.findMany({ where: { attemptId } });
    let objectiveScore = 0;
    let subjectiveScore = 0;
    let judgeScore = 0;
    let hasManual = false;
    let hasJudge = false;

    for (const answer of answers) {
      const score = Number(answer.score);
      if (answer.status === AnswerRecordStatus.JUDGE_PENDING || answer.status === AnswerRecordStatus.JUDGE_DONE) {
        judgeScore += score;
        hasJudge ||= answer.status === AnswerRecordStatus.JUDGE_PENDING;
      } else if (answer.status === AnswerRecordStatus.MANUAL_NEEDED || answer.status === AnswerRecordStatus.MANUAL_GRADED) {
        subjectiveScore += score;
        hasManual ||= answer.status === AnswerRecordStatus.MANUAL_NEEDED;
      } else {
        objectiveScore += score;
      }
    }

    await tx.examAttempt.update({
      where: { id: attemptId },
      data: {
        objectiveScore,
        subjectiveScore,
        judgeScore,
        totalScore: objectiveScore + subjectiveScore + judgeScore,
        status: hasManual || hasJudge ? AttemptStatus.GRADING : AttemptStatus.GRADED,
      },
    });
  }

  private answerStatusWhere(value?: string): Prisma.AnswerRecordWhereInput['status'] {
    if (!value) return undefined;
    const normalized = value.replace(/-/g, '_').toLowerCase();
    if (normalized === 'all') return undefined;
    if (normalized === 'pending') {
      return { in: [AnswerRecordStatus.MANUAL_NEEDED, AnswerRecordStatus.JUDGE_PENDING] };
    }
    if (normalized === 'graded' || normalized === 'done') {
      return { in: [AnswerRecordStatus.MANUAL_GRADED, AnswerRecordStatus.JUDGE_DONE] };
    }

    const enumKey = normalized.toUpperCase() as keyof typeof AnswerRecordStatus;
    return AnswerRecordStatus[enumKey];
  }

  private questionTypeWhere(value?: string) {
    if (!value) return undefined;
    const enumKey = value.replace(/-/g, '_').toUpperCase() as keyof typeof QuestionType;
    const questionType = QuestionType[enumKey];
    if (!questionType) {
      throw new BadRequestException('题型筛选值不合法');
    }
    return questionType;
  }

  private normalizeShowScoreMode(value: string) {
    const enumKey = value.replace(/-/g, '_').toUpperCase() as keyof typeof ShowScoreMode;
    const mode = ShowScoreMode[enumKey];
    if (!mode) {
      throw new BadRequestException('成绩显示模式不合法');
    }
    return mode;
  }

  private isGradableStatus(status: AnswerRecordStatus) {
    return (
      status === AnswerRecordStatus.MANUAL_NEEDED ||
      status === AnswerRecordStatus.MANUAL_GRADED ||
      status === AnswerRecordStatus.JUDGE_PENDING ||
      status === AnswerRecordStatus.JUDGE_DONE
    );
  }

  private isJudgeQuestion(status: AnswerRecordStatus, snapshot?: SnapshotQuestion) {
    return (
      status === AnswerRecordStatus.JUDGE_PENDING ||
      status === AnswerRecordStatus.JUDGE_DONE ||
      String(snapshot?.snapshot.type ?? '').toUpperCase() === QuestionType.PROGRAMMING
    );
  }

  private orderBy(query: QueryGradingDto): Prisma.AnswerRecordOrderByWithRelationInput[] {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    if (query.sortBy === 'gradedAt') return [{ gradedAt: direction }, { updatedAt: 'desc' }];
    if (query.sortBy === 'score') return [{ score: direction }, { updatedAt: 'desc' }];
    if (query.sortBy === 'status') return [{ status: direction }, { updatedAt: 'desc' }];
    return [{ updatedAt: direction }];
  }

  private flattenSnapshot(snapshot: PaperSnapshot) {
    return snapshot.sections.flatMap((section) => section.questions);
  }

  private findSnapshotQuestion(snapshot: PaperSnapshot, questionId: string) {
    return this.flattenSnapshot(snapshot).find((question) => question.questionId === questionId);
  }

  private gradeObjectiveQuestion(
    paperQuestion: SnapshotQuestion,
    value: Prisma.JsonValue | undefined,
  ): ObjectiveGradingResult | null {
    const type = String(paperQuestion.snapshot.type).toUpperCase();
    const answerJson =
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

    if (
      type === QuestionType.SINGLE_CHOICE ||
      type === QuestionType.MULTIPLE_CHOICE ||
      type === QuestionType.TRUE_FALSE
    ) {
      const selected = new Set((answerJson.selectedOptionIds as string[] | undefined) ?? []);
      const correct = new Set(this.correctOptionIds(paperQuestion.snapshot.answer));
      const isCorrect = selected.size === correct.size && [...selected].every((optionId) => correct.has(optionId));
      return {
        score: isCorrect ? paperQuestion.score : 0,
        isCorrect,
        autoResult: { selectedOptionIds: [...selected], correctOptionIds: [...correct] },
      };
    }

    if (type === QuestionType.FILL_BLANK) {
      const blanks = (answerJson.blanks as Array<{ index: number; value: string }> | undefined) ?? [];
      const rules = this.blankRules(paperQuestion.snapshot.answer);
      let score = 0;
      let allCorrect = true;

      for (const rule of rules) {
        const submitted = blanks.find((blank) => blank.index === rule.index)?.value ?? '';
        const normalizedSubmitted = this.normalizeBlank(submitted, rule);
        const matched = rule.answers.map((answer) => this.normalizeBlank(answer, rule)).includes(normalizedSubmitted);
        if (matched) {
          score += rule.score ?? paperQuestion.score / Math.max(rules.length, 1);
        } else {
          allCorrect = false;
        }
      }

      return {
        score,
        isCorrect: allCorrect,
        autoResult: { blanks, rules },
      };
    }

    return null;
  }

  private correctOptionIds(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const correctOptionIds = (value as { correctOptionIds?: unknown }).correctOptionIds;
    return Array.isArray(correctOptionIds) ? correctOptionIds.map(String) : [];
  }

  private blankRules(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const blanks = (value as { blanks?: unknown }).blanks;
    if (!Array.isArray(blanks)) return [];
    return blanks
      .map((blank) => (blank && typeof blank === 'object' && !Array.isArray(blank) ? (blank as Record<string, unknown>) : null))
      .filter((blank): blank is Record<string, unknown> => Boolean(blank))
      .map((blank, index) => ({
        index: Number(blank.index) || index + 1,
        answers: Array.isArray(blank.answers) ? blank.answers.map(String) : [],
        ignoreCase: Boolean(blank.ignoreCase),
        trimSpace: typeof blank.trimSpace === 'boolean' ? blank.trimSpace : true,
        score: Number.isFinite(Number(blank.score)) ? Number(blank.score) : undefined,
      }));
  }

  private normalizeBlank(value: string, rule: { ignoreCase?: boolean; trimSpace?: boolean }) {
    let result = value;
    if (rule.trimSpace ?? true) result = result.trim();
    if (rule.ignoreCase) result = result.toLowerCase();
    return result;
  }

  private async attemptScore(attemptId: string) {
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
      select: {
        status: true,
        objectiveScore: true,
        subjectiveScore: true,
        judgeScore: true,
        totalScore: true,
      },
    });
    return {
      attemptId,
      status: attempt ? toApiEnum(attempt.status) : '',
      objectiveScore: Number(attempt?.objectiveScore ?? 0),
      subjectiveScore: Number(attempt?.subjectiveScore ?? 0),
      judgeScore: Number(attempt?.judgeScore ?? 0),
      totalScore: Number(attempt?.totalScore ?? 0),
    };
  }

  private async loadUserMap(userIds: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, username: true, realName: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  private toQuestionType(value: QuestionType | string) {
    return String(value).toLowerCase();
  }
}
