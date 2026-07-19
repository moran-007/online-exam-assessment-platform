import { AiRegressionStatus, AiSummaryTaskStatus, AiSummaryType } from '@prisma/client';
import { AiRegressionUseCases } from '../../src/modules/ai/ai-regression.use-cases';

describe('AiRegressionUseCases', () => {
  it('validates a real successful fixture against the candidate model and active schema', async () => {
    const capturedAt = '2026-07-18T08:00:00.000Z';
    const dataset = {
      type: 'exam', datasetVersion: 'exam-summary/v1', generatedAt: capturedAt,
      dataCoverage: { from: null, to: null, includes: ['exam'], excludes: [] },
      evidenceIndex: {
        ref1: {
          refId: 'ref1', sourceType: 'exam', sourceId: 'exam-1', metric: 'score',
          path: '/score', value: 80, capturedAt,
        },
      },
      scores: { average: { value: 80, evidenceRef: 'ref1' } },
    };
    const run = {
      id: 'run-1', providerConfigId: 'config-1', promptTemplateId: 'template-1',
      summaryType: AiSummaryType.EXAM, status: AiRegressionStatus.RUNNING,
      passedCases: 0, totalCases: 1, inputTokens: 0, outputTokens: 0,
      sanitizedError: null, createdBy: 'user-1', createdAt: new Date(), finishedAt: null,
    };
    const config = {
      id: 'config-1', name: '候选模型', provider: 'openai-compatible', baseUrl: 'https://example.com/v1',
      model: 'model-a', maxTokens: 1000, timeoutMs: 30000, monthlyTokenBudget: null,
      apiKeyCiphertext: 'cipher', apiKeyIv: 'iv', apiKeyAuthTag: 'tag', apiKeyKeyVersion: 1,
    };
    const template = {
      id: 'template-1', summaryType: AiSummaryType.EXAM, version: 1,
      systemPrompt: 'system', outputSchema: {},
    };
    const updated = {
      ...run, status: AiRegressionStatus.PASSED, passedCases: 1,
      inputTokens: 20, outputTokens: 10, finishedAt: new Date(),
      providerConfig: { name: config.name, model: config.model },
    };
    const prisma = {
      aiSummaryPromptTemplate: { findFirst: jest.fn().mockResolvedValue(template) },
      aiSummaryTask: { findMany: jest.fn().mockResolvedValue([{
        id: 'fixture-1', type: AiSummaryType.EXAM, status: AiSummaryTaskStatus.SUCCEEDED,
        inputSnapshotJson: dataset,
      }]) },
      aiModelRegressionRun: {
        create: jest.fn().mockResolvedValue(run),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    const gateway = { complete: jest.fn().mockResolvedValue({
      content: JSON.stringify({ schemaVersion: 'exam-summary-output/v1' }),
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30, reported: true },
    }) };
    const validator = { validate: jest.fn().mockReturnValue({}) };
    const usage = { authorize: jest.fn(), record: jest.fn().mockResolvedValue({}) };
    const service = new AiRegressionUseCases(
      prisma as never,
      { resolve: jest.fn().mockResolvedValue(config) } as never,
      { decrypt: jest.fn().mockReturnValue('secret') } as never,
      gateway as never,
      { resolve: jest.fn().mockResolvedValue({ supportsJsonObject: false, supportsJsonSchema: false }) } as never,
      validator as never,
      usage as never,
      { log: jest.fn() } as never,
    );
    const user = {
      id: 'user-1', username: 'admin', realName: '管理员', userType: 'ADMIN',
      roles: ['admin'], permissions: ['ai.quality.manage'],
    };

    const result = await service.run({ configId: config.id, summaryType: 'exam', caseCount: 1 }, user);

    expect(result).toMatchObject({ status: 'passed', passedCases: 1, totalCases: 1, model: 'model-a' });
    expect(validator.validate).toHaveBeenCalledWith(expect.any(Object), dataset.evidenceIndex);
    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ operation: 'model-regression' }));
  });
});
