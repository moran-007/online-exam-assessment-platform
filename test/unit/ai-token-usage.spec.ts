import { AiTokenUsageService } from '../../src/modules/ai/ai-token-usage.service';

describe('AiTokenUsageService', () => {
  const config = { id: '00000000-0000-0000-0000-000000000001', monthlyTokenBudget: 1000 };
  const metrics = { recordAiBudgetDecision: jest.fn() };

  beforeEach(() => jest.clearAllMocks());

  it('reports used tokens and local monthly budget remaining', async () => {
    const groupBy = jest.fn().mockResolvedValue([{
      providerConfigId: config.id,
      usageReported: true,
      _sum: { totalTokens: 320 },
      _count: { _all: 1 },
    }]);
    const service = new AiTokenUsageService({ aiUsageEvent: { groupBy } } as never, metrics as never);
    await expect(service.quota(config)).resolves.toMatchObject({
      budgetTokens: 1000,
      usedTokens: 320,
      remainingTokens: 680,
      unreportedCalls: 0,
      usageComplete: true,
      balanceSource: 'local-monthly-budget',
    });
    expect(groupBy.mock.calls[0][0].where.createdAt).toEqual({
      gte: expect.any(Date),
      lt: expect.any(Date),
    });
  });

  it('records provider-reported usage before returning the updated quota', async () => {
    const create = jest.fn().mockResolvedValue({});
    const groupBy = jest.fn().mockResolvedValue([{
      providerConfigId: config.id,
      usageReported: true,
      _sum: { totalTokens: 13 },
      _count: { _all: 1 },
    }]);
    const service = new AiTokenUsageService({ aiUsageEvent: { create, groupBy } } as never, metrics as never);
    await service.record({
      config,
      operation: 'exam_summary',
      requestedOutputTokens: 1000,
      usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13, reported: true },
      userId: '00000000-0000-0000-0000-000000000002',
    });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      requestedOutputTokens: 1000,
      inputTokens: 10,
      outputTokens: 3,
      totalTokens: 13,
      usageReported: true,
    }) });
  });

  it('marks remaining balance unknown when no local budget is configured', async () => {
    const service = new AiTokenUsageService({
      aiUsageEvent: { groupBy: jest.fn().mockResolvedValue([]) },
    } as never, metrics as never);
    await expect(service.quota({ ...config, monthlyTokenBudget: null })).resolves.toMatchObject({
      budgetTokens: null,
      remainingTokens: null,
      balanceSource: 'not-configured',
    });
  });

  it('rejects a call whose requested output exceeds the local remaining budget', async () => {
    const service = new AiTokenUsageService({
      aiUsageEvent: { groupBy: jest.fn().mockResolvedValue([{
        providerConfigId: config.id, usageReported: true,
        _sum: { totalTokens: 900 }, _count: { _all: 1 },
      }]) },
    } as never, metrics as never);
    await expect(service.authorize(config, 101)).rejects.toThrow('预算不足');
    expect(metrics.recordAiBudgetDecision).toHaveBeenCalledWith(config.id, 'rejected');
  });

  it('marks quota incomplete when a provider omitted usage', async () => {
    const service = new AiTokenUsageService({
      aiUsageEvent: { groupBy: jest.fn().mockResolvedValue([{
        providerConfigId: config.id, usageReported: false,
        _sum: { totalTokens: 0 }, _count: { _all: 2 },
      }]) },
    } as never, metrics as never);
    await expect(service.quota(config)).resolves.toMatchObject({
      usedTokens: 0, remainingTokens: 1000, unreportedCalls: 2, usageComplete: false,
    });
    await expect(service.authorize(config, 1)).rejects.toThrow('无法可靠执行');
  });
});
