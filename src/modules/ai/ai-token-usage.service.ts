import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MetricsService } from '../../observability/metrics.service';
import { PrismaService } from '../prisma/prisma.service';

type BudgetConfig = {
  id: string;
  monthlyTokenBudget: number | null;
};

export type AiTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reported: boolean;
};

export type AiTokenQuota = {
  periodStart: Date;
  periodEnd: Date;
  budgetTokens: number | null;
  usedTokens: number;
  remainingTokens: number | null;
  unreportedCalls: number;
  usageComplete: boolean;
  balanceSource: 'local-monthly-budget' | 'not-configured';
};

type RecordUsageInput = {
  config: BudgetConfig;
  operation: string;
  correlationId?: string;
  requestedOutputTokens: number;
  usage: AiTokenUsage;
  userId: string;
};

@Injectable()
export class AiTokenUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async quotas(configs: BudgetConfig[]) {
    const period = this.currentPeriod();
    const rows = configs.length ? await this.prisma.aiUsageEvent.groupBy({
      by: ['providerConfigId', 'usageReported'],
      where: {
        providerConfigId: { in: configs.map((config) => config.id) },
        createdAt: { gte: period.start, lt: period.end },
      },
      _sum: { totalTokens: true },
      _count: { _all: true },
    }) : [];
    const usageByConfig = new Map<string, { usedTokens: number; unreportedCalls: number }>();
    for (const row of rows) {
      const usage = usageByConfig.get(row.providerConfigId) ?? { usedTokens: 0, unreportedCalls: 0 };
      usage.usedTokens += row._sum.totalTokens ?? 0;
      if (!row.usageReported) usage.unreportedCalls += row._count._all;
      usageByConfig.set(row.providerConfigId, usage);
    }
    return new Map(configs.map((config) => {
      const usage = usageByConfig.get(config.id) ?? { usedTokens: 0, unreportedCalls: 0 };
      return [config.id, this.toQuota(config, usage, period)];
    }));
  }

  async quota(config: BudgetConfig) {
    const quotas = await this.quotas([config]);
    return quotas.get(config.id) as AiTokenQuota;
  }

  async authorize(config: BudgetConfig, requestedOutputTokens: number) {
    const quota = await this.quota(config);
    const allowed = quota.remainingTokens === null
      || (quota.usageComplete && quota.remainingTokens >= requestedOutputTokens);
    this.metrics.recordAiBudgetDecision(config.id, allowed ? 'accepted' : 'rejected');
    if (!allowed && !quota.usageComplete) {
      throw new BadRequestException('供应商存在未报告的 Token 用量，无法可靠执行本地预算限制');
    }
    if (!allowed) throw new BadRequestException('本地月度 Token 预算不足，请调整预算或等待下个周期');
    return quota;
  }

  async record(input: RecordUsageInput) {
    await this.prisma.aiUsageEvent.create({
      data: {
        providerConfigId: input.config.id,
        operation: input.operation,
        correlationId: input.correlationId ?? randomUUID(),
        requestedOutputTokens: input.requestedOutputTokens,
        inputTokens: input.usage.promptTokens,
        outputTokens: input.usage.completionTokens,
        totalTokens: input.usage.totalTokens,
        usageReported: input.usage.reported,
        createdBy: input.userId,
      },
    });
    return this.quota(input.config);
  }

  private currentPeriod(now = new Date()) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
  }

  private toQuota(
    config: BudgetConfig,
    usage: { usedTokens: number; unreportedCalls: number },
    period: ReturnType<AiTokenUsageService['currentPeriod']>,
  ) {
    const budget = config.monthlyTokenBudget;
    return {
      periodStart: period.start,
      periodEnd: period.end,
      budgetTokens: budget,
      usedTokens: usage.usedTokens,
      remainingTokens: budget === null ? null : Math.max(0, budget - usage.usedTokens),
      unreportedCalls: usage.unreportedCalls,
      usageComplete: usage.unreportedCalls === 0,
      balanceSource: budget === null ? 'not-configured' as const : 'local-monthly-budget' as const,
    };
  }
}
