import { AiConfigUseCases } from '../../src/modules/ai/ai-config.use-cases';
import { AiProviderCallException } from '../../src/modules/ai/ai-provider.gateway';

describe('AiConfigUseCases connection usage', () => {
  it('reserves the explicit probe limit when a dispatched test times out', async () => {
    const config = {
      id: 'config-1', provider: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.7-plus', maxTokens: null, timeoutMs: 30_000, monthlyTokenBudget: null,
      apiKeyCiphertext: 'cipher', apiKeyIv: 'iv', apiKeyAuthTag: 'tag', apiKeyKeyVersion: 1,
    };
    const gateway = {
      complete: jest.fn().mockRejectedValue(new AiProviderCallException('AI 服务调用超时', true)),
    };
    const tokenUsage = {
      authorize: jest.fn().mockResolvedValue({}),
      record: jest.fn().mockResolvedValue({}),
    };
    const service = new AiConfigUseCases(
      { aiProviderConfig: { update: jest.fn().mockResolvedValue({}) } } as never,
      { decrypt: jest.fn().mockReturnValue('secret') } as never,
      gateway as never,
      { log: jest.fn() } as never,
      tokenUsage as never,
      { requireManageable: jest.fn().mockResolvedValue(config) } as never,
    );

    await expect(service.test(config.id, { id: 'user-1' } as never)).rejects.toThrow('调用超时');

    expect(gateway.complete).toHaveBeenCalledWith(expect.objectContaining({
      maxTokens: 4,
      enableThinking: false,
      thinking: undefined,
    }));
    expect(tokenUsage.record).toHaveBeenCalledWith(expect.objectContaining({
      requestedOutputTokens: 4,
      reservationOutputTokens: 4,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: false },
    }));
  });

  it('retires a configuration without deleting its historical row', async () => {
    const existing = {
      id: 'config-1', name: 'Retired model', provider: 'custom', baseUrl: 'https://example.com/v1',
      model: 'model', scope: 'SYSTEM', ownerUserId: null, enabled: true, isDefault: true,
      inputCostPerMillion: 0, outputCostPerMillion: 0,
    };
    const update = jest.fn().mockResolvedValue({ ...existing, deletedAt: new Date() });
    const encrypt = jest.fn().mockReturnValue({
      ciphertext: 'retired-cipher', iv: 'retired-iv', authTag: 'retired-tag', keyVersion: 2,
    });
    const audit = { log: jest.fn() };
    const service = new AiConfigUseCases(
      { aiProviderConfig: { update } } as never,
      { encrypt } as never,
      {} as never,
      audit as never,
      {} as never,
      { requireManageable: jest.fn().mockResolvedValue(existing) } as never,
    );

    await expect(service.remove(existing.id, { id: 'user-1' } as never))
      .resolves.toEqual({ id: existing.id, deleted: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: expect.objectContaining({
        apiKeyCiphertext: 'retired-cipher', enabled: false, isDefault: false,
        deletedAt: expect.any(Date), updatedBy: 'user-1',
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai:config-delete' }));
  });
});
