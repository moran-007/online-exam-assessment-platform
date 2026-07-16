import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryStatisticsDto } from '../dto/query-statistics.dto';
import { ClassPerformanceDto } from '../dto/statistics-response.dto';
import { ratio, scoreSummary } from '../statistics-math';
import { StatisticsScopeService } from '../statistics-scope.service';

@Injectable()
export class ClassStatisticsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: StatisticsScopeService,
  ) {}

  async execute(query: QueryStatisticsDto, user: RequestUser): Promise<ClassPerformanceDto[]> {
    const classWhere = await this.scope.classWhere(user, query.classId);
    const classGroups = await this.prisma.classGroup.findMany({
      where: { ...classWhere, deletedAt: null, courseId: query.courseId },
      include: { course: true, _count: { select: { students: true } } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        submittedAt: this.scope.submittedAtFilter(query),
        exam: { classId: { in: classGroups.map((item) => item.id) }, courseId: query.courseId },
      },
      select: {
        exam: { select: { classId: true, paper: { select: { totalScore: true } } } },
        totalScore: true,
      },
    });
    const scoreMap = new Map<string, Array<{ score: number; fullScore: number }>>();
    for (const attempt of attempts) {
      const classId = attempt.exam.classId;
      if (!classId) continue;
      const scores = scoreMap.get(classId) ?? [];
      scores.push({
        score: Number(attempt.totalScore),
        fullScore: Number(attempt.exam.paper.totalScore) || 0,
      });
      scoreMap.set(classId, scores);
    }
    return classGroups.map((item) => {
      const classAttempts = scoreMap.get(item.id) ?? [];
      const scores = classAttempts.map((attempt) => attempt.score);
      const passCount = classAttempts.filter(
        (attempt) => attempt.fullScore > 0 && attempt.score / attempt.fullScore >= 0.6,
      ).length;
      return {
        classId: item.id,
        className: item.name,
        courseName: item.course?.name ?? '',
        studentCount: item._count.students,
        submitCount: scores.length,
        ...scoreSummary(scores),
        passRate: ratio(passCount, classAttempts.length),
        completionRate: ratio(classAttempts.length, item._count.students),
      };
    });
  }
}
