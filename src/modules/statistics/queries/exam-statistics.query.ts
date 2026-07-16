import { Injectable, NotFoundException } from '@nestjs/common';
import { AnswerRecordStatus, MasteryStatus, Prisma } from '@prisma/client';
import { toPagination } from '../../../common/dto/pagination-query.dto';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { toApiEnum } from '../../../common/utils/enum-normalizer';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryStatisticsDto } from '../dto/query-statistics.dto';
import {
  ExamPerformancePageDto,
  ExamStatisticsDetailDto,
  ScoreDistributionDto,
  StatisticsOverviewDto,
} from '../dto/statistics-response.dto';
import { average, ratio, scoreSummary } from '../statistics-math';
import { StatisticsScopeService } from '../statistics-scope.service';

@Injectable()
export class ExamStatisticsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: StatisticsScopeService,
  ) {}

  async overview(query: QueryStatisticsDto, user: RequestUser): Promise<StatisticsOverviewDto> {
    const attemptWhere = await this.scope.attemptWhere(query, user);
    const examWhere = await this.scope.examWhere(query, user);
    const classWhere = await this.scope.classWhere(user, query.classId);
    const results = await this.prisma.$transaction([
      this.prisma.course.count({ where: { deletedAt: null } }),
      this.prisma.question.count({ where: { deletedAt: null, courseId: query.courseId } }),
      this.prisma.paper.count({ where: { deletedAt: null, courseId: query.courseId } }),
      this.prisma.exam.count({ where: examWhere }),
      this.prisma.examAttempt.findMany({ where: attemptWhere, select: { totalScore: true, status: true } }),
      this.prisma.answerRecord.count({
        where: {
          status: { in: [AnswerRecordStatus.MANUAL_NEEDED, AnswerRecordStatus.JUDGE_PENDING] },
          attempt: attemptWhere,
        },
      }),
      this.prisma.wrongQuestion.count({
        where: {
          masteryStatus: { in: [MasteryStatus.UNMASTERED, MasteryStatus.REVIEWING] },
          question: { deletedAt: null, courseId: query.courseId },
        },
      }),
      this.prisma.classGroup.count({ where: { ...classWhere, deletedAt: null, courseId: query.courseId } }),
    ]);
    const [courses, questions, papers, exams, attempts, pendingManual, activeWrongQuestions, classes] = results;
    const scores = attempts.map((attempt) => Number(attempt.totalScore));
    return {
      courses,
      questions,
      papers,
      exams,
      classes,
      submittedAttempts: attempts.length,
      pendingManual,
      activeWrongQuestions,
      ...scoreSummary(scores),
      gradedCount: attempts.filter((attempt) => toApiEnum(attempt.status) === 'graded').length,
    };
  }

  async exams(query: QueryStatisticsDto, user: RequestUser): Promise<ExamPerformancePageDto> {
    const { page, pageSize, skip, take } = toPagination(query);
    const where = await this.scope.examWhere(query, user);
    const scopedWhere: Prisma.ExamWhereInput = {
      ...where,
      deletedAt: null,
      id: query.examId,
      courseId: query.courseId,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.exam.findMany({
        where: scopedWhere,
        include: {
          course: { select: { name: true } },
          paper: { select: { totalScore: true } },
          attempts: {
            where: { submittedAt: { not: null } },
            select: { totalScore: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.exam.count({ where: scopedWhere }),
    ]);
    const classMap = await this.scope.loadClassMap(items.flatMap((item) => item.classId ? [item.classId] : []));

    return {
      items: items.map((exam) => {
        const scores = exam.attempts.map((attempt) => Number(attempt.totalScore));
        return {
          examId: exam.id,
          examName: exam.name,
          courseName: exam.course.name,
          className: exam.classId ? classMap.get(exam.classId)?.name ?? '' : '公开',
          fullScore: Number(exam.paper.totalScore),
          status: toApiEnum(exam.status),
          submitCount: exam.attempts.length,
          gradedCount: exam.attempts.filter((attempt) => toApiEnum(attempt.status) === 'graded').length,
          ...scoreSummary(scores),
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  async scoreDistribution(query: QueryStatisticsDto, user: RequestUser): Promise<ScoreDistributionDto> {
    const attemptWhere = await this.scope.attemptWhere(query, user);
    const attempts = await this.prisma.examAttempt.findMany({
      where: attemptWhere,
      include: { exam: { include: { paper: { select: { totalScore: true } } } } },
      orderBy: { submittedAt: 'desc' },
    });
    const buckets = [
      { label: '0-59%', min: 0, max: 59, count: 0 },
      { label: '60-69%', min: 60, max: 69, count: 0 },
      { label: '70-79%', min: 70, max: 79, count: 0 },
      { label: '80-89%', min: 80, max: 89, count: 0 },
      { label: '90-100%', min: 90, max: 100, count: 0 },
    ];
    const scores = attempts.map((attempt) => Number(attempt.totalScore));
    const percents = attempts.map((attempt) => {
      const fullScore = Number(attempt.exam.paper.totalScore) || 0;
      return fullScore > 0 ? Math.min(100, Math.max(0, (Number(attempt.totalScore) / fullScore) * 100)) : 0;
    });

    for (const percent of percents) {
      const rounded = Math.floor(percent);
      const bucket = buckets.find((item) => rounded >= item.min && rounded <= item.max) ?? buckets.at(-1)!;
      bucket.count += 1;
    }

    return {
      total: attempts.length,
      averageScore: average(scores),
      averagePercent: average(percents),
      buckets: buckets.map((bucket) => ({ ...bucket, percent: ratio(bucket.count, attempts.length) })),
    };
  }

  async examDetail(examId: string, user: RequestUser): Promise<ExamStatisticsDetailDto> {
    await this.scope.assertExamAccessible(user, examId);
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, deletedAt: null },
      include: {
        course: true,
        paper: true,
        attempts: { where: { submittedAt: { not: null } }, include: { answers: true } },
      },
    });
    if (!exam) throw new NotFoundException('考试不存在');

    const questionStats = new Map<string, { total: number; correct: number; score: number }>();
    for (const attempt of exam.attempts) {
      for (const answer of attempt.answers) {
        const current = questionStats.get(answer.questionId) ?? { total: 0, correct: 0, score: 0 };
        current.total += 1;
        current.correct += answer.isCorrect ? 1 : 0;
        current.score += Number(answer.score);
        questionStats.set(answer.questionId, current);
      }
    }
    const questions = await this.prisma.question.findMany({
      where: { id: { in: [...questionStats.keys()] } },
      select: { id: true, title: true, type: true, difficulty: true },
    });
    const questionMap = new Map(questions.map((question) => [question.id, question]));
    const scores = exam.attempts.map((attempt) => Number(attempt.totalScore));

    return {
      examId: exam.id,
      examName: exam.name,
      courseName: exam.course.name,
      fullScore: Number(exam.paper.totalScore),
      submitCount: exam.attempts.length,
      ...scoreSummary(scores),
      questionStats: [...questionStats.entries()].map(([questionId, item]) => {
        const question = questionMap.get(questionId);
        return {
          questionId,
          title: question?.title ?? questionId,
          type: question ? toApiEnum(question.type) : '',
          difficulty: question?.difficulty ?? 0,
          answerCount: item.total,
          correctRate: ratio(item.correct, item.total),
          averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
        };
      }),
    };
  }
}
