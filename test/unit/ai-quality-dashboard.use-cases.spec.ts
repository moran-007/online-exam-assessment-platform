import { AiFeedbackVerdict, AiSummaryReviewStatus, AiSummaryTaskStatus, AiSummaryType, Prisma } from '@prisma/client';
import { AiQualityDashboardUseCases } from '../../src/modules/ai/ai-quality-dashboard.use-cases';

describe('AiQualityDashboardUseCases', () => {
  it('aggregates model quality, cache, token and cost dimensions', async () => {
    const createdAt = new Date('2026-07-18T08:00:00Z');
    const task = {
      type: AiSummaryType.CLASS,
      providerConfigId: 'config-1',
      modelSnapshot: 'model-a',
      promptVersion: 2,
      status: AiSummaryTaskStatus.SUCCEEDED,
      inputTokens: 100,
      outputTokens: 50,
      estimatedCost: new Prisma.Decimal('0.123456'),
      providerConfig: { name: '主模型' },
      summary: {
        reviewStatus: AiSummaryReviewStatus.PUBLISHED,
        publishedAt: createdAt,
        feedback: [{ rating: 4, verdict: AiFeedbackVerdict.PARTIAL }],
      },
    };
    const prisma = {
      aiSummaryTask: { findMany: jest.fn().mockResolvedValue([task]) },
      aiSummaryCacheEvent: { findMany: jest.fn().mockResolvedValue([{ cacheHit: true }, { cacheHit: false }]) },
      aiSummary: { count: jest.fn().mockResolvedValue(1) },
    };
    const result = await new AiQualityDashboardUseCases(prisma as never).dashboard({
      startDate: '2026-07-18T00:00:00Z', endDate: '2026-07-19T00:00:00Z',
    });

    expect(result.totals).toMatchObject({
      calls: 1, succeeded: 1, published: 1, inputTokens: 100, outputTokens: 50,
      estimatedCost: 0.123456, cacheHitRate: 0.5, averageRating: 4,
    });
    expect(result.breakdown[0]).toMatchObject({
      summaryType: 'class', model: 'model-a', promptVersion: 2, successRate: 1,
    });
  });
});
