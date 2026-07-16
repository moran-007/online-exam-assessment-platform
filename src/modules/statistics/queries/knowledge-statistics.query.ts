import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryStatisticsDto } from '../dto/query-statistics.dto';
import { KnowledgePerformanceDto, KnowledgeTrendPointDto } from '../dto/statistics-response.dto';
import { ratio } from '../statistics-math';
import { StatisticsScopeService } from '../statistics-scope.service';

type KnowledgeAggregate = {
  name: string;
  total: number;
  correct: number;
  score: number;
};

@Injectable()
export class KnowledgeStatisticsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: StatisticsScopeService,
  ) {}

  async knowledge(query: QueryStatisticsDto, user: RequestUser): Promise<KnowledgePerformanceDto[]> {
    const attemptWhere = await this.scope.attemptWhere(query, user);
    const records = await this.prisma.answerRecord.findMany({
      where: { attempt: attemptWhere },
      include: {
        question: { include: { knowledgePoints: { include: { knowledgePoint: true } } } },
      },
    });
    const groups = new Map<string, KnowledgeAggregate>();
    for (const record of records) {
      for (const relation of record.question.knowledgePoints) {
        const point = relation.knowledgePoint;
        this.add(groups, point.id, point.name, record.isCorrect === true, Number(record.score));
      }
    }
    return [...groups.entries()].map(([knowledgePointId, item]) => ({
      knowledgePointId,
      ...this.result(item),
    }));
  }

  async trend(query: QueryStatisticsDto, user: RequestUser): Promise<KnowledgeTrendPointDto[]> {
    const attemptWhere = await this.scope.attemptWhere(query, user);
    const records = await this.prisma.answerRecord.findMany({
      where: {
        attempt: attemptWhere,
        question: { deletedAt: null, courseId: query.courseId },
      },
      include: {
        attempt: { select: { submittedAt: true } },
        question: { include: { knowledgePoints: { include: { knowledgePoint: true } } } },
      },
      orderBy: { updatedAt: 'asc' },
    });
    const groups = new Map<string, KnowledgeAggregate & { date: string; knowledgePointId: string }>();
    for (const record of records) {
      const date = (record.attempt.submittedAt ?? record.updatedAt).toISOString().slice(0, 10);
      for (const relation of record.question.knowledgePoints) {
        const point = relation.knowledgePoint;
        const key = `${date}:${point.id}`;
        const current = groups.get(key) ?? {
          date,
          knowledgePointId: point.id,
          name: point.name,
          total: 0,
          correct: 0,
          score: 0,
        };
        current.total += 1;
        current.correct += record.isCorrect === true ? 1 : 0;
        current.score += Number(record.score);
        groups.set(key, current);
      }
    }
    return [...groups.values()]
      .map((item) => ({
        date: item.date,
        knowledgePointId: item.knowledgePointId,
        ...this.result(item),
      }))
      .sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name));
  }

  private add(
    groups: Map<string, KnowledgeAggregate>,
    id: string,
    name: string,
    isCorrect: boolean,
    score: number,
  ) {
    const current = groups.get(id) ?? { name, total: 0, correct: 0, score: 0 };
    current.total += 1;
    current.correct += isCorrect ? 1 : 0;
    current.score += score;
    groups.set(id, current);
  }

  private result(item: KnowledgeAggregate) {
    return {
      name: item.name,
      answerCount: item.total,
      correctRate: ratio(item.correct, item.total),
      averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
    };
  }
}
