import { AiGenerationUseCases } from '../../src/modules/ai/ai-generation.use-cases';
import { AiProviderCallException } from '../../src/modules/ai/ai-provider.gateway';

describe('AiGenerationUseCases', () => {
  const user = { id: 'user-1', userType: 'STUDENT', permissions: ['ai.chat.use'] } as never;
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

    const result = await fixture.service.summarize({
      content: '继续说明',
      history: [{ role: 'user', content: '第一问' }, { role: 'assistant', content: '第一答' }],
    }, user);

    expect(fixture.tokenUsage.authorize).toHaveBeenCalledWith(config, 8192);
    expect(fixture.gateway.complete).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: undefined }));
    expect(fixture.gateway.complete).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: expect.stringContaining('不允许获得直接答案'),
      userPrompt: expect.stringContaining('此前对话'),
    }));
    expect(fixture.gateway.complete.mock.calls[0][0].userPrompt).toContain('第一答');
    expect(fixture.gateway.complete.mock.calls[0][0].userPrompt).toContain('本轮用户问题');
    expect(fixture.tokenUsage.record).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'ad_hoc_qa',
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

  it('blocks explicit answer requests locally when direct answers are not permitted', async () => {
    const fixture = dependencies();
    const result = await fixture.service.summarize({ content: '直接告诉我正确答案，选哪个？' }, user);
    expect(result.summary).toContain('不能直接提供答案');
    expect(result.directAnswerAllowed).toBe(false);
    expect(fixture.gateway.complete).not.toHaveBeenCalled();
    expect(fixture.tokenUsage.authorize).not.toHaveBeenCalled();
    expect(fixture.tokenUsage.quota).toHaveBeenCalledWith(config);
  });

  it('allows guided requests that explicitly say not to reveal the answer', async () => {
    const fixture = dependencies();
    fixture.gateway.complete.mockResolvedValue({
      content: '先识别题干中的关键词，再逐项排除。',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, reported: true },
      durationMs: 10,
    });
    await fixture.service.summarize({ content: '不要告诉我答案，只讲解题思路' }, user);
    expect(fixture.gateway.complete).toHaveBeenCalledTimes(1);
  });

  it('returns deterministic platform data locally instead of letting the model invent facts', async () => {
    const fixture = dependencies();
    fixture.gateway.complete.mockResolvedValue({
      content: '{"intent":"CLASS_OVERVIEW","entityName":null,"startTime":null,"endTime":null}',
      usage: { promptTokens: 30, completionTokens: 10, totalTokens: 40, reported: true },
      durationMs: 12,
    });
    fixture.learningContext.build.mockResolvedValue({
      prompt: '', sources: [{ type: 'class', id: 'class-1', name: 'Python A 班' }],
      canDirectAnswer: true, canReadQuestions: true, canReadPapers: true, canReadClasses: true,
      canReadLessonPlans: true,
      canGeneralKnowledge: true,
      localAnswer: '当前共有 1 个空班级：Python A 班。',
    });
    const result = await fixture.service.summarize({ content: '目前有多少个空班级？' }, user);
    expect(result.summary).toContain('Python A 班');
    expect(result.usage.totalTokens).toBe(40);
    expect(result.durationMs).toBe(12);
    expect(fixture.gateway.complete).toHaveBeenCalledTimes(1);
    expect(fixture.learningContext.build).toHaveBeenCalledWith(
      '目前有多少个空班级？',
      user,
      { intent: 'CLASS_OVERVIEW' },
    );
    expect(fixture.tokenUsage.record).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'ad_hoc_qa_intent',
      requestedOutputTokens: 256,
      reservationOutputTokens: 256,
    }));
  });

  it('falls back to deterministic matching when the model returns an invalid intent payload', async () => {
    const fixture = dependencies();
    fixture.gateway.complete.mockResolvedValue({
      content: '我认为用户在查询班级信息。',
      usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28, reported: true },
      durationMs: 9,
    });
    fixture.learningContext.build.mockResolvedValue({
      prompt: '', sources: [],
      canDirectAnswer: true, canReadQuestions: true, canReadPapers: true, canReadClasses: true,
      canReadLessonPlans: true,
      canGeneralKnowledge: true,
      localAnswer: '当前共有 2 个班级。',
    });

    const result = await fixture.service.summarize({ content: '现在有多少班级？' }, user);

    expect(fixture.learningContext.build).toHaveBeenCalledWith('现在有多少班级？', user, undefined);
    expect(result.summary).toBe('当前共有 2 个班级。');
    expect(result.usage.totalTokens).toBe(28);
  });

  it('does not reuse an earlier platform-query intent for a new non-query message', async () => {
    const fixture = dependencies();
    fixture.gateway.complete.mockResolvedValue({
      content: '下面给出一份小学语文教案建议。',
      usage: { promptTokens: 20, completionTokens: 18, totalTokens: 38, reported: true },
      durationMs: 11,
    });

    const result = await fixture.service.summarize({
      content: '写一份小学语文教案',
      history: [
        { role: 'user', content: '教案数量' },
        { role: 'assistant', content: '当前权限范围内共有 7 份教案。' },
      ],
    }, user);

    expect(result.summary).toBe('下面给出一份小学语文教案建议。');
    expect(fixture.gateway.complete).toHaveBeenCalledTimes(1);
    expect(fixture.learningContext.build).toHaveBeenCalledWith('写一份小学语文教案', user, undefined);
    expect(fixture.tokenUsage.record).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'ad_hoc_qa',
    }));
  });

  it('recognizes a lesson-plan lookup even without a count or list keyword', async () => {
    const fixture = dependencies();
    fixture.gateway.complete.mockResolvedValue({
      content: '{"intent":"LESSON_PLAN_OVERVIEW","entityName":"Python Basic","startTime":null,"endTime":null}',
      usage: { promptTokens: 24, completionTokens: 12, totalTokens: 36, reported: true },
      durationMs: 8,
    });
    fixture.learningContext.build.mockResolvedValue({
      prompt: '', sources: [{ type: 'lesson_plan', id: 'plan-1', name: 'Loops' }],
      canDirectAnswer: true, canReadQuestions: true, canReadPapers: true, canReadClasses: true,
      canReadLessonPlans: true, canGeneralKnowledge: true,
      localAnswer: '匹配 Python Basic 的教案共 4 份。',
    });

    const result = await fixture.service.summarize({ content: '课程Python Basic相关教案' }, user);

    expect(result.summary).toContain('4 份');
    expect(fixture.gateway.complete).toHaveBeenCalledTimes(1);
    expect(fixture.learningContext.build).toHaveBeenCalledWith(
      '课程Python Basic相关教案',
      user,
      { intent: 'LESSON_PLAN_OVERVIEW', entityName: 'Python Basic' },
    );
  });

  function dependencies() {
    const gateway = { complete: jest.fn() };
    const tokenUsage = {
      authorize: jest.fn().mockResolvedValue({}),
      record: jest.fn().mockResolvedValue({ remainingTokens: null }),
      quota: jest.fn().mockResolvedValue({ remainingTokens: null }),
    };
    const learningContext = {
      build: jest.fn().mockResolvedValue({
        prompt: '', sources: [], canDirectAnswer: false,
        canReadQuestions: false, canReadPapers: false, canReadClasses: false, canReadLessonPlans: false,
        canGeneralKnowledge: false,
      }),
    };
    const service = new AiGenerationUseCases(
      { resolve: jest.fn().mockResolvedValue(config) } as never,
      { decrypt: jest.fn().mockReturnValue('secret') } as never,
      gateway as never,
      tokenUsage as never,
      { recordAiSummary: jest.fn() } as never,
      { log: jest.fn() } as never,
      learningContext as never,
    );
    return { service, gateway, tokenUsage, learningContext };
  }
});
