import { AiSummaryTaskStatus, AiSummaryType } from '@prisma/client';
import { AiProviderCallException } from '../../src/modules/ai/ai-provider.gateway';
import { AiSummaryTaskRunner } from '../../src/modules/ai/ai-summary-task.runner';
import { SummaryOutputValidationError } from '../../src/modules/ai/schemas/summary-output.validator';

describe('AiSummaryTaskRunner', () => {
  it('records usage and atomically creates a validated draft', async () => {
    const fixture = dependencies();
    fixture.gateway.complete.mockResolvedValue({
      content: JSON.stringify(output()),
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70, reported: true },
      durationMs: 10,
    });
    fixture.validator.validate.mockReturnValue(output());

    await fixture.runner.run(fixture.task.id);

    expect(fixture.tokenUsage.authorize).toHaveBeenCalledWith(fixture.task.providerConfig, 1000);
    expect(fixture.tokenUsage.record).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: `${fixture.task.correlationId}:1`,
      operation: 'exam-summary',
      usage: expect.objectContaining({ totalTokens: 70, reported: true }),
    }));
    expect(fixture.prisma.$transaction).toHaveBeenCalled();
    expect(fixture.prisma.aiSummary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: AiSummaryType.EXAM }),
    }));
    const summaryData = fixture.prisma.aiSummary.create.mock.calls[0][0].data;
    expect(summaryData).not.toHaveProperty('reviewStatus');
    expect(summaryData).not.toHaveProperty('publishedAt');
  });

  it('marks a schema validation failure after preserving reported usage', async () => {
    const fixture = dependencies();
    fixture.gateway.complete.mockResolvedValue({
      content: '{}',
      usage: { promptTokens: 40, completionTokens: 5, totalTokens: 45, reported: true },
      durationMs: 10,
    });
    fixture.validator.validate.mockImplementation(() => {
      throw new SummaryOutputValidationError('schema invalid');
    });

    await fixture.runner.run(fixture.task.id);

    expect(fixture.tokenUsage.record).toHaveBeenCalled();
    expect(fixture.prisma.aiSummary.create).not.toHaveBeenCalled();
    expect(fixture.prisma.aiSummaryTask.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: AiSummaryTaskStatus.FAILED,
        inputTokens: 40,
        outputTokens: 5,
        sanitizedError: 'schema invalid',
      }),
    }));
  });

  it('marks quota as incomplete when a timed-out request may have consumed tokens', async () => {
    const fixture = dependencies();
    fixture.gateway.complete.mockRejectedValue(new AiProviderCallException('AI 服务调用超时', true));

    await fixture.runner.run(fixture.task.id);

    expect(fixture.tokenUsage.record).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: `${fixture.task.correlationId}:1`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: false },
    }));
    expect(fixture.prisma.aiSummaryTask.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AiSummaryTaskStatus.FAILED, estimatedCost: 0.001 }),
    }));
  });

  it('records reported usage carried by an empty-content provider error', async () => {
    const fixture = dependencies();
    fixture.gateway.complete.mockRejectedValue(new AiProviderCallException(
      'AI 服务未返回文本内容',
      false,
      { promptTokens: 80, completionTokens: 1000, totalTokens: 1080, reported: true },
    ));

    await fixture.runner.run(fixture.task.id);

    expect(fixture.tokenUsage.record).toHaveBeenCalledWith(expect.objectContaining({
      usage: { promptTokens: 80, completionTokens: 1000, totalTokens: 1080, reported: true },
    }));
    expect(fixture.prisma.aiSummaryTask.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inputTokens: 80, outputTokens: 1000 }),
    }));
  });

  it('does not send maxTokens for a provider-default task but authorizes its estimate', async () => {
    const fixture = dependencies();
    Object.assign(fixture.task, {
      requestedOutputTokens: null,
      reservationOutputTokens: 8192,
      outputLimitKey: 0,
    });
    fixture.gateway.complete.mockResolvedValue({
      content: JSON.stringify(output()),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, reported: true },
      durationMs: 10,
    });
    fixture.validator.validate.mockReturnValue(output());

    await fixture.runner.run(fixture.task.id);

    expect(fixture.tokenUsage.authorize).toHaveBeenCalledWith(fixture.task.providerConfig, 8192);
    expect(fixture.gateway.complete).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: undefined }));
    expect(fixture.tokenUsage.record).toHaveBeenCalledWith(expect.objectContaining({
      requestedOutputTokens: null,
      reservationOutputTokens: 8192,
    }));
  });

  it('uses the student prompt and persists a student summary through the shared runner', async () => {
    const fixture = dependencies(AiSummaryType.STUDENT);
    fixture.gateway.complete.mockResolvedValue({
      content: JSON.stringify(output('student-summary-output/v1')),
      usage: { promptTokens: 40, completionTokens: 15, totalTokens: 55, reported: true },
      durationMs: 10,
    });
    fixture.validator.validate.mockReturnValue(output('student-summary-output/v1'));

    await fixture.runner.run(fixture.task.id);

    expect(fixture.gateway.complete).toHaveBeenCalledWith(expect.objectContaining({
      userPrompt: expect.stringContaining('不得把无教育数据解释为缺勤'),
      responseFormat: expect.objectContaining({
        json_schema: expect.objectContaining({ name: 'student_summary' }),
      }),
    }));
    expect(fixture.tokenUsage.record).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'student-summary',
    }));
    expect(fixture.prisma.aiSummary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: AiSummaryType.STUDENT }),
    }));
  });

  function dependencies(type: AiSummaryType = AiSummaryType.EXAM) {
    const task = taskFixture(type);
    const prisma = {
      aiSummaryTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(task),
        update: jest.fn().mockResolvedValue(task),
      },
      aiSummary: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const gateway = { complete: jest.fn() };
    const tokenUsage = {
      authorize: jest.fn().mockResolvedValue({}),
      record: jest.fn().mockResolvedValue({}),
    };
    const validator = { validate: jest.fn() };
    const runner = new AiSummaryTaskRunner(
      prisma as never,
      { decrypt: jest.fn().mockReturnValue('secret') } as never,
      gateway as never,
      { resolve: jest.fn().mockResolvedValue({
        supportsJsonSchema: true, supportsJsonObject: true, maxOutputTokens: 1200,
      }) } as never,
      tokenUsage as never,
      validator as never,
      { recordAiSummary: jest.fn() } as never,
    );
    return { runner, prisma, gateway, tokenUsage, validator, task };
  }

  function taskFixture(type: AiSummaryType) {
    const capturedAt = '2026-07-16T00:00:00.000Z';
    const datasetType = type === AiSummaryType.STUDENT ? 'student' : 'exam';
    const schemaVersion = `${datasetType}-summary-output/v1`;
    return {
      id: '00000000-0000-0000-0000-000000000001',
      subjectId: '00000000-0000-0000-0000-000000000002',
      type,
      inputSnapshotJson: {
        type: datasetType, datasetVersion: `${datasetType}-summary/v1`, generatedAt: capturedAt,
        dataCoverage: { from: null, to: null, includes: ['exam'], excludes: [] },
        score: { value: 80, evidenceRef: 'exam:1:score' },
        evidenceIndex: {
          'exam:1:score': {
            refId: 'exam:1:score', sourceType: 'exam', sourceId: '1', metric: 'score',
            path: '/score', value: 80, capturedAt,
          },
        },
      },
      requestedOutputTokens: 1000,
      reservationOutputTokens: 1000,
      outputLimitKey: 1000,
      schemaVersion,
      modelSnapshot: 'model-a',
      correlationId: '00000000-0000-0000-0000-000000000003',
      attemptCount: 1,
      createdBy: '00000000-0000-0000-0000-000000000004',
      estimatedCost: 0,
      providerConfig: {
        id: '00000000-0000-0000-0000-000000000005', provider: 'qwen', enabled: true,
        baseUrl: 'https://example.com/v1', model: 'model-a', maxTokens: 1000,
        timeoutMs: 30000, monthlyTokenBudget: 10000,
        inputCostPerMillion: 0, outputCostPerMillion: 1,
        apiKeyCiphertext: 'cipher', apiKeyIv: 'iv', apiKeyAuthTag: 'tag', apiKeyKeyVersion: 1,
      },
      promptTemplate: { systemPrompt: 'system', outputSchema: {} },
      summary: null,
    };
  }

  function output(schemaVersion = 'exam-summary-output/v1') {
    const claim = { text: '平均成绩为 80 分', evidenceRefs: ['exam:1:score'] };
    return {
      schemaVersion, headline: claim,
      overview: [], strengths: [], risks: [], actions: [], needsReview: [],
    };
  }
});
