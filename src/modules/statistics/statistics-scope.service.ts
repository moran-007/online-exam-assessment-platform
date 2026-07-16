import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryStatisticsDto } from './dto/query-statistics.dto';

@Injectable()
export class StatisticsScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async attemptWhere(query: QueryStatisticsDto, user: RequestUser): Promise<Prisma.ExamAttemptWhereInput> {
    const examWhere = await this.examWhere(query, user);
    return {
      submittedAt: this.submittedAtFilter(query),
      examId: query.examId,
      exam: { ...examWhere, courseId: query.courseId, deletedAt: null },
    };
  }

  async examWhere(query: QueryStatisticsDto, user: RequestUser): Promise<Prisma.ExamWhereInput> {
    const scoped = await this.dataScope.examWhere(user, query.classId);
    return { ...scoped, deletedAt: null, courseId: query.courseId, id: query.examId };
  }

  classWhere(user: RequestUser, classId?: string) {
    return this.dataScope.classWhere(user, classId);
  }

  assertExamAccessible(user: RequestUser, examId: string) {
    return this.dataScope.assertExamAccessible(user, examId);
  }

  isUnrestricted(user: RequestUser) {
    return this.dataScope.isUnrestricted(user);
  }

  dateRange(query: QueryStatisticsDto): Prisma.DateTimeFilter | undefined {
    if (!query.startDate && !query.endDate) return undefined;
    return {
      gte: query.startDate ? new Date(query.startDate) : undefined,
      lte: query.endDate ? new Date(query.endDate) : undefined,
    };
  }

  submittedAtFilter(query: QueryStatisticsDto): Prisma.DateTimeNullableFilter {
    return { not: null, ...this.dateRange(query) };
  }

  async loadClassMap(classIds: string[]) {
    if (!classIds.length) return new Map<string, { id: string; name: string }>();
    const classes = await this.prisma.classGroup.findMany({
      where: { id: { in: [...new Set(classIds)] }, deletedAt: null },
      select: { id: true, name: true },
    });
    return new Map(classes.map((item) => [item.id, item]));
  }
}
