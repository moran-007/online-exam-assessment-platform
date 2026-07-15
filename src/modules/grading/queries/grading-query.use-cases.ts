import { Injectable, NotFoundException } from '@nestjs/common';
import { AnswerRecordStatus, Prisma } from '@prisma/client';
import { toPagination } from '../../../common/dto/pagination-query.dto';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { fieldAccess } from '../../../common/security/permission-policy';
import { toApiEnum } from '../../../common/utils/enum-normalizer';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaperSnapshot, GradingSupportOperations } from '../grading-support.operations';
import { QueryGradingDto } from '../dto/query-grading.dto';

@Injectable()
export class GradingQueryUseCases {
  constructor(
    readonly prisma: PrismaService,
    readonly dataScope: DataScopeService,
    readonly support: GradingSupportOperations,
  ) {}

  async list(query: QueryGradingDto, user: RequestUser) {
    const access = fieldAccess(user);
    const { page, pageSize, skip, take } = toPagination(query);
    const status = this.support.answerStatusWhere(query.status);
    const questionType = this.support.questionTypeWhere(query.questionType);
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
        orderBy: this.support.orderBy(query),
        skip,
        take,
      }),
      this.prisma.answerRecord.count({ where }),
    ]);
    const userMap = await this.support.loadUserMap(records.map((item) => item.attempt.userId));

    return {
      items: records.map((record) => {
        const snapshot = this.support.findSnapshotQuestion(
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
          studentId: access.studentIdentity ? record.attempt.userId : null,
          studentName: access.studentIdentity ? student?.realName ?? student?.username ?? '学生' : '匿名学生',
          username: access.studentIdentity ? student?.username ?? '' : '',
          questionId: record.questionId,
          questionTitle: snapshot?.snapshot.title ?? record.question.title,
          questionType: this.support.toQuestionType(snapshot?.snapshot.type ?? record.question.type),
          maxScore: snapshot?.score ?? 0,
          score: access.score ? Number(record.score) : null,
          isCorrect: access.score ? record.isCorrect : null,
          studentAnswer: access.studentAnswer ? record.answerJson : {},
          referenceAnswer: access.referenceAnswer ? snapshot?.snapshot.answer ?? {} : {},
          options: snapshot?.snapshot.options ?? [],
          manualComment: record.manualComment ?? '',
          status: toApiEnum(record.status),
          submittedAt: record.attempt.submittedAt,
          gradedAt: record.gradedAt,
          updatedAt: record.updatedAt,
        };
      }),
      page,
      pageSize,
      total,
      _fieldAccess: access,
    };
  }


  async attemptDetail(attemptId: string, user: RequestUser) {
    const access = fieldAccess(user);
    const attempt = await this.prisma.examAttempt.findFirst({
      where: { id: attemptId },
      include: {
        exam: { include: { course: true, paper: true } },
        paperInstance: true,
        answers: { orderBy: { createdAt: 'asc' }, include: { currentEvaluation: true } },
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
        id: access.studentIdentity ? attempt.userId : null,
        username: access.studentIdentity ? student?.username ?? '' : '',
        name: access.studentIdentity ? student?.realName ?? student?.username ?? '学生' : '匿名学生',
      },
      status: toApiEnum(attempt.status),
      totalScore: access.score ? Number(attempt.totalScore) : null,
      objectiveScore: access.score ? Number(attempt.objectiveScore) : null,
      subjectiveScore: access.score ? Number(attempt.subjectiveScore) : null,
      judgeScore: access.score ? Number(attempt.judgeScore) : null,
      submittedAt: attempt.submittedAt,
      questions: this.support.flattenSnapshot(paperSnapshot).map((paperQuestion) => {
        const answer = answerMap.get(paperQuestion.questionId);
        return {
          answerRecordId: answer?.id ?? null,
          questionId: paperQuestion.questionId,
          type: this.support.toQuestionType(paperQuestion.snapshot.type),
          title: paperQuestion.snapshot.title,
          content: paperQuestion.snapshot.content,
          options: paperQuestion.snapshot.options ?? [],
          referenceAnswer: access.referenceAnswer ? paperQuestion.snapshot.answer ?? {} : {},
          analysis: access.analysis ? paperQuestion.snapshot.analysis ?? '' : '',
          scoringRule: paperQuestion.snapshot.scoringRule ?? {},
          maxScore: paperQuestion.score,
          studentAnswer: access.studentAnswer ? answer?.answerJson ?? {} : {},
          score: access.score ? Number(answer?.score ?? 0) : null,
          isCorrect: access.score ? answer?.isCorrect : null,
          status: answer ? toApiEnum(answer.status) : 'missing',
          manualComment: answer?.manualComment ?? '',
          gradedAt: answer?.gradedAt,
          updatedAt: answer?.updatedAt,
          rubricScores: this.support.evaluationRubricScores(answer?.currentEvaluation?.detailJson),
        };
      }),
      _fieldAccess: access,
    };
  }

}
