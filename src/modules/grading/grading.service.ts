import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AnswerRecordStatus, AttemptStatus, Prisma, QuestionType } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { GradeAnswerDto } from './dto/grade-answer.dto';
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
