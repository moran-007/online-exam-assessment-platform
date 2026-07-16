import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { toApiEnum } from '../../../common/utils/enum-normalizer';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryStatisticsDto } from '../dto/query-statistics.dto';
import { QuestionDiagnosticDto } from '../dto/statistics-response.dto';
import { diagnosticSuggestion, ratio } from '../statistics-math';
import { StatisticsScopeService } from '../statistics-scope.service';

type DiagnosticAggregate = {
  title: string;
  type: string;
  difficulty: number;
  defaultScore: number;
  knowledgePointNames: Set<string>;
  tagNames: Set<string>;
  total: number;
  correct: number;
  score: number;
  topTotal: number;
  topCorrect: number;
  bottomTotal: number;
  bottomCorrect: number;
  anomalyCount: number;
};

@Injectable()
export class QuestionDiagnosticsQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: StatisticsScopeService,
  ) {}

  async execute(query: QueryStatisticsDto, user: RequestUser): Promise<QuestionDiagnosticDto[]> {
    const attemptWhere = await this.scope.attemptWhere(query, user);
    const records = await this.prisma.answerRecord.findMany({
      where: {
        attempt: attemptWhere,
        question: { deletedAt: null, courseId: query.courseId },
      },
      include: {
        attempt: { select: { id: true, totalScore: true, durationSeconds: true } },
        question: {
          include: {
            knowledgePoints: { include: { knowledgePoint: true } },
            tags: { include: { tag: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5000,
    });
    const scores = new Map<string, number>();
    for (const record of records) scores.set(record.attempt.id, Number(record.attempt.totalScore));
    const sorted = [...scores.entries()].sort((left, right) => right[1] - left[1]);
    const groupSize = sorted.length >= 4
      ? Math.max(1, Math.floor(sorted.length * 0.27))
      : Math.max(1, Math.ceil(sorted.length / 2));
    const topAttemptIds = new Set(sorted.slice(0, groupSize).map(([id]) => id));
    const bottomAttemptIds = new Set(sorted.slice(-groupSize).map(([id]) => id));
    const groups = new Map<string, DiagnosticAggregate>();

    for (const record of records) {
      const question = record.question;
      const current = groups.get(question.id) ?? this.createAggregate(question);
      const score = Number(record.score);
      const isCorrect = record.isCorrect === true;
      current.total += 1;
      current.correct += isCorrect ? 1 : 0;
      current.score += score;
      if (topAttemptIds.has(record.attempt.id)) {
        current.topTotal += 1;
        current.topCorrect += isCorrect ? 1 : 0;
      }
      if (bottomAttemptIds.has(record.attempt.id)) {
        current.bottomTotal += 1;
        current.bottomCorrect += isCorrect ? 1 : 0;
      }
      if ((isCorrect && score <= 0) || (record.isCorrect === false && score > 0) || score > current.defaultScore * 1.25) {
        current.anomalyCount += 1;
      }
      groups.set(question.id, current);
    }

    return [...groups.entries()]
      .map(([questionId, item]) => this.result(questionId, item))
      .sort((left, right) =>
        right.anomalyCount - left.anomalyCount
        || left.discrimination - right.discrimination
        || Math.abs(right.difficultyDelta) - Math.abs(left.difficultyDelta))
      .slice(0, 100);
  }

  private createAggregate(question: {
    title: string;
    type: string;
    difficulty: number;
    defaultScore: unknown;
    knowledgePoints: Array<{ knowledgePoint: { name: string } }>;
    tags: Array<{ tag: { name: string } }>;
  }): DiagnosticAggregate {
    return {
      title: question.title,
      type: toApiEnum(question.type),
      difficulty: question.difficulty,
      defaultScore: Number(question.defaultScore),
      knowledgePointNames: new Set(question.knowledgePoints.map((item) => item.knowledgePoint.name)),
      tagNames: new Set(question.tags.map((item) => item.tag.name)),
      total: 0,
      correct: 0,
      score: 0,
      topTotal: 0,
      topCorrect: 0,
      bottomTotal: 0,
      bottomCorrect: 0,
      anomalyCount: 0,
    };
  }

  private result(questionId: string, item: DiagnosticAggregate): QuestionDiagnosticDto {
    const correctRate = ratio(item.correct, item.total);
    const topRate = ratio(item.topCorrect, item.topTotal);
    const bottomRate = ratio(item.bottomCorrect, item.bottomTotal);
    const discrimination = Number((topRate - bottomRate).toFixed(4));
    const actualDifficulty = Number((1 + (1 - correctRate) * 4).toFixed(2));
    const difficultyDelta = Number((actualDifficulty - item.difficulty).toFixed(2));
    return {
      questionId,
      title: item.title,
      type: item.type,
      difficulty: item.difficulty,
      actualDifficulty,
      difficultyDelta,
      answerCount: item.total,
      correctRate,
      averageScore: item.total ? Number((item.score / item.total).toFixed(2)) : 0,
      discrimination,
      anomalyCount: item.anomalyCount,
      knowledgePointNames: [...item.knowledgePointNames],
      tagNames: [...item.tagNames],
      suggestion: diagnosticSuggestion(discrimination, difficultyDelta, item.anomalyCount),
    };
  }
}
