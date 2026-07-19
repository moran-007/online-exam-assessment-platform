import { BadRequestException, Injectable } from '@nestjs/common';
import { AiFeedbackVerdict, AiSummaryReviewStatus, AiSummaryTaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiQualityRangeQueryDto } from './dto/ai-quality.dto';

type BreakdownAccumulator = {
  summaryType: string;
  configId: string;
  configName: string;
  model: string;
  promptVersion: number;
  calls: number;
  succeeded: number;
  published: number;
  ratingTotal: number;
  feedbackCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
};

@Injectable()
export class AiQualityDashboardUseCases {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(query: AiQualityRangeQueryDto) {
    const { from, to } = this.range(query);
    const [tasks, cacheEvents, published] = await Promise.all([
      this.prisma.aiSummaryTask.findMany({
        where: { createdAt: { gte: from, lt: to } },
        select: {
          type: true,
          providerConfigId: true,
          modelSnapshot: true,
          promptVersion: true,
          status: true,
          inputTokens: true,
          outputTokens: true,
          estimatedCost: true,
          providerConfig: { select: { name: true } },
          summary: {
            select: {
              reviewStatus: true,
              publishedAt: true,
              feedback: {
                where: { createdAt: { gte: from, lt: to } },
                select: { rating: true, verdict: true },
              },
            },
          },
        },
      }),
      this.prisma.aiSummaryCacheEvent.findMany({
        where: { createdAt: { gte: from, lt: to } },
        select: { cacheHit: true },
      }),
      this.prisma.aiSummary.count({
        where: {
          reviewStatus: AiSummaryReviewStatus.PUBLISHED,
          publishedAt: { gte: from, lt: to },
        },
      }),
    ]);
    const breakdown = new Map<string, BreakdownAccumulator>();
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedCost = 0;
    let ratingTotal = 0;
    let feedbackCount = 0;
    let incorrectCount = 0;
    for (const task of tasks) {
      inputTokens += task.inputTokens;
      outputTokens += task.outputTokens;
      estimatedCost += Number(task.estimatedCost);
      const key = [task.type, task.providerConfigId, task.modelSnapshot, task.promptVersion].join(':');
      const row = breakdown.get(key) ?? this.emptyBreakdown(task);
      row.calls += 1;
      row.succeeded += Number(task.status === AiSummaryTaskStatus.SUCCEEDED);
      row.inputTokens += task.inputTokens;
      row.outputTokens += task.outputTokens;
      row.estimatedCost += Number(task.estimatedCost);
      if (task.summary?.reviewStatus === AiSummaryReviewStatus.PUBLISHED
        && task.summary.publishedAt && task.summary.publishedAt >= from && task.summary.publishedAt < to) {
        row.published += 1;
      }
      for (const feedback of task.summary?.feedback ?? []) {
        row.ratingTotal += feedback.rating;
        row.feedbackCount += 1;
        ratingTotal += feedback.rating;
        feedbackCount += 1;
        incorrectCount += Number(feedback.verdict === AiFeedbackVerdict.INCORRECT);
      }
      breakdown.set(key, row);
    }
    const succeeded = tasks.filter((task) => task.status === AiSummaryTaskStatus.SUCCEEDED).length;
    const failed = tasks.filter((task) => task.status === AiSummaryTaskStatus.FAILED).length;
    const cacheHits = cacheEvents.filter((event) => event.cacheHit).length;
    return {
      from,
      to,
      totals: {
        calls: tasks.length,
        succeeded,
        failed,
        published,
        inputTokens,
        outputTokens,
        estimatedCost: this.round(estimatedCost, 6),
        cacheRequests: cacheEvents.length,
        cacheHits,
        cacheHitRate: this.rate(cacheHits, cacheEvents.length),
        feedbackCount,
        averageRating: this.average(ratingTotal, feedbackCount),
        incorrectRate: this.rate(incorrectCount, feedbackCount),
      },
      breakdown: [...breakdown.values()]
        .map((row) => ({
          summaryType: row.summaryType,
          configId: row.configId,
          configName: row.configName,
          model: row.model,
          promptVersion: row.promptVersion,
          calls: row.calls,
          successRate: this.rate(row.succeeded, row.calls),
          published: row.published,
          averageRating: this.average(row.ratingTotal, row.feedbackCount),
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          estimatedCost: this.round(row.estimatedCost, 6),
        }))
        .sort((left, right) => right.calls - left.calls || left.model.localeCompare(right.model)),
    };
  }

  private range(query: AiQualityRangeQueryDto) {
    const to = query.endDate ? new Date(query.endDate) : new Date();
    const from = query.startDate ? new Date(query.startDate) : new Date(to.getTime() - 30 * 86_400_000);
    if (from >= to) throw new BadRequestException('开始时间必须早于结束时间');
    if (to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new BadRequestException('质量看板查询范围不能超过 366 天');
    }
    return { from, to };
  }

  private emptyBreakdown(task: {
    type: string;
    providerConfigId: string;
    modelSnapshot: string;
    promptVersion: number;
    providerConfig: { name: string };
  }): BreakdownAccumulator {
    return {
      summaryType: task.type.toLowerCase(),
      configId: task.providerConfigId,
      configName: task.providerConfig.name,
      model: task.modelSnapshot,
      promptVersion: task.promptVersion,
      calls: 0,
      succeeded: 0,
      published: 0,
      ratingTotal: 0,
      feedbackCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
    };
  }

  private average(total: number, count: number) {
    return count ? this.round(total / count, 2) : 0;
  }

  private rate(value: number, total: number) {
    return total ? this.round(value / total, 4) : 0;
  }

  private round(value: number, digits: number) {
    return Number(value.toFixed(digits));
  }
}
