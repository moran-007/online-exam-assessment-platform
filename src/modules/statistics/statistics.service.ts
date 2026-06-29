import { Injectable, NotFoundException } from '@nestjs/common';
import { AnswerRecordStatus, MasteryStatus, Prisma } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { toApiEnum } from '../../common/utils/enum-normalizer';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryStatisticsDto } from './dto/query-statistics.dto';

@Injectable()
export class StatisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async overview(query: QueryStatisticsDto, user: RequestUser) {
    const attemptWhere = await this.attemptWhere(query, user);
    const examWhere = await this.examWhere(query, user);
    const classWhere = await this.dataScope.classWhere(user, query.classId);
    const [courses, questions, papers, exams, attempts, pendingManual, activeWrongQuestions, classes] = await this.prisma.$transaction([
      this.prisma.course.count({ where: { deletedAt: null } }),
      this.prisma.question.count({ where: { deletedAt: null, courseId: query.courseId } }),
      this.prisma.paper.count({ where: { deletedAt: null, courseId: query.courseId } }),
      this.prisma.exam.count({
        where: examWhere,
      }),
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
      this.prisma.classGroup.count({
        where: { ...classWhere, deletedAt: null, courseId: query.courseId },
      }),
    ]);
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
      averageScore: this.average(scores),
      maxScore: scores.length ? Math.max(...scores) : 0,
      minScore: scores.length ? Math.min(...scores) : 0,
      gradedCount: attempts.filter((attempt) => toApiEnum(attempt.status) === 'graded').length,
    };
  }

  async exams(query: QueryStatisticsDto, user: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where = await this.examWhere(query, user);
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
    const classMap = await this.loadClassMap(items.map((item) => item.classId).filter(Boolean) as string[]);

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
          averageScore: this.average(scores),
          maxScore: scores.length ? Math.max(...scores) : 0,
          minScore: scores.length ? Math.min(...scores) : 0,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  async examDetail(examId: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, examId);
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, deletedAt: null },
      include: {
        course: true,
        paper: true,
        attempts: {
          where: { submittedAt: { not: null } },
          include: { answers: true },
        },
      },
    });
    if (!exam) throw new NotFoundException('考试不存在');
    const scores = exam.attempts.map((attempt) => Number(attempt.totalScore));
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

    return {
      examId: exam.id,
      examName: exam.name,
      courseName: exam.course.name,
      fullScore: Number(exam.paper.totalScore),
      submitCount: exam.attempts.length,
      averageScore: this.average(scores),
      maxScore: scores.length ? Math.max(...scores) : 0,
      minScore: scores.length ? Math.min(...scores) : 0,
      questionStats: [...questionStats.entries()].map(([questionId, item]) => {
        const question = questionMap.get(questionId);
        return {
          questionId,
          title: question?.title ?? questionId,
          type: question ? toApiEnum(question.type) : '',
          difficulty: question?.difficulty ?? 0,
          answerCount: item.total,
          correctRate: item.total ? Number((item.correct / item.total).toFixed(4)) : 0,
          averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
        };
      }),
    };
  }

  async knowledge(query: QueryStatisticsDto, user: RequestUser) {
    const attemptWhere = await this.attemptWhere(query, user);
    const answerRecords = await this.prisma.answerRecord.findMany({
      where: {
        attempt: attemptWhere,
      },
      include: {
        question: {
          include: {
            knowledgePoints: { include: { knowledgePoint: true } },
          },
        },
      },
    });
    const map = new Map<string, { name: string; total: number; correct: number; score: number }>();
    for (const record of answerRecords) {
      for (const relation of record.question.knowledgePoints) {
        const point = relation.knowledgePoint;
        const current = map.get(point.id) ?? { name: point.name, total: 0, correct: 0, score: 0 };
        current.total += 1;
        current.correct += record.isCorrect ? 1 : 0;
        current.score += Number(record.score);
        map.set(point.id, current);
      }
    }
    return [...map.entries()].map(([knowledgePointId, item]) => ({
      knowledgePointId,
      name: item.name,
      answerCount: item.total,
      correctRate: item.total ? Number((item.correct / item.total).toFixed(4)) : 0,
      averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
    }));
  }

  async classes(query: QueryStatisticsDto, user: RequestUser) {
    const classWhere = await this.dataScope.classWhere(user, query.classId);
    const classGroups = await this.prisma.classGroup.findMany({
      where: { ...classWhere, deletedAt: null, courseId: query.courseId },
      include: { course: true, _count: { select: { students: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        submittedAt: { not: null },
        exam: { classId: { in: classGroups.map((item) => item.id) }, courseId: query.courseId },
      },
      select: { exam: { select: { classId: true } }, totalScore: true },
    });
    const scoreMap = new Map<string, number[]>();
    for (const attempt of attempts) {
      const classId = attempt.exam.classId;
      if (!classId) continue;
      const scores = scoreMap.get(classId) ?? [];
      scores.push(Number(attempt.totalScore));
      scoreMap.set(classId, scores);
    }
    return classGroups.map((item) => {
      const scores = scoreMap.get(item.id) ?? [];
      return {
        classId: item.id,
        className: item.name,
        courseName: item.course?.name ?? '',
        studentCount: item._count.students,
        submitCount: scores.length,
        averageScore: this.average(scores),
        maxScore: scores.length ? Math.max(...scores) : 0,
        minScore: scores.length ? Math.min(...scores) : 0,
      };
    });
  }

  private async attemptWhere(query: QueryStatisticsDto, user: RequestUser): Promise<Prisma.ExamAttemptWhereInput> {
    const examWhere = await this.examWhere(query, user);
    return {
      submittedAt: { not: null },
      examId: query.examId,
      exam: {
        ...examWhere,
        courseId: query.courseId,
        deletedAt: null,
      },
    };
  }

  private async examWhere(query: QueryStatisticsDto, user: RequestUser): Promise<Prisma.ExamWhereInput> {
    const scopeWhere = await this.dataScope.examWhere(user, query.classId);
    return {
      ...scopeWhere,
      deletedAt: null,
      courseId: query.courseId,
      id: query.examId,
    };
  }

  private average(scores: number[]) {
    return scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : 0;
  }

  private async loadClassMap(classIds: string[]) {
    if (!classIds.length) return new Map<string, { id: string; name: string }>();
    const classes = await this.prisma.classGroup.findMany({
      where: { id: { in: [...new Set(classIds)] }, deletedAt: null },
      select: { id: true, name: true },
    });
    return new Map(classes.map((item) => [item.id, item]));
  }
}
