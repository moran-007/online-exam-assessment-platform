import { AiGenerationUseCases } from '../../src/modules/ai/ai-generation.use-cases';
import { AiProviderCallException } from '../../src/modules/ai/ai-provider.gateway';

describe('AiGenerationUseCases', () => {
  const user = { id: 'user-1' } as never;
  const config = {
    id: 'config-1', provider: 'custom', baseUrl: 'https://example.com/v1', model: 'model-a',
    maxTokens: null, timeoutMs: 30_000, monthlyTokenBudget: null,
    apiKeyCiphertext: 'cipher', apiKeyIv: 'iv', apiKeyAuthTag: 'tag', apiKeyKeyVersion: 1,
  };

  it('omits the supplier limit while exposing the failure reservation policy', async () => {
    const fixture = dependencies();
    fixture.gateway.complete.mockResolvedValue({
      content: '总结',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, reported: true },
      durationMs: 10,
    });

    const result = await fixture.service.summarize({ content: '待总结内容' }, user);

    expect(fixture.tokenUsage.authorize).toHaveBeenCalledWith(config, 8192);
    expect(fixture.gateway.complete).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: undefined }));
    expect(fixture.tokenUsage.record).toHaveBeenCalledWith(expect.objectContaining({
      requestedOutputTokens: null,
      reservationOutputTokens: 8192,
    }));
    expect(result.outputLimitTokens).toBeNull();
  });

  it('records an unreported timeout consistently with structured summaries', async () => {
    const fixture = dependencies();
    fixture.gateway.complete.mockRejectedValue(new AiProviderCallException('AI 服务调用超时', true));

    await expect(fixture.service.summarize({ content: '待总结内容' }, user)).rejects.toThrow('调用超时');

    expect(fixture.tokenUsage.record).toHaveBeenCalledWith(expect.objectContaining({
      requestedOutputTokens: null,
      reservationOutputTokens: 8192,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: false },
    }));
  });

  function dependencies() {
    const gateway = { complete: jest.fn() };
    const tokenUsage = {
      authorize: jest.fn().mockResolvedValue({}),
      record: jest.fn().mockResolvedValue({ remainingTokens: null }),
    };
    const service = new AiGenerationUseCases(
      { resolve: jest.fn().mockResolvedValue(config) } as never,
      { decrypt: jest.fn().mockReturnValue('secret') } as never,
      gateway as never,
      tokenUsage as never,
      { recordAiSummary: jest.fn() } as never,
      { log: jest.fn() } as never,
    );
    return { service, gateway, tokenUsage };
  }
});
