import { AiSummaryTaskStatus, AiSummaryType } from '@prisma/client';
import { ExamSummaryTaskUseCases } from '../../src/modules/ai/exam-summary-task.use-cases';

describe('ExamSummaryTaskUseCases', () => {
  const user = {
    id: '00000000-0000-0000-0000-000000000001', username: 'teacher', realName: 'Teacher',
    userType: 'TEACHER', roles: ['teacher'], permissions: ['ai.summary.exam.generate'],
  };
  const config = {
    id: '00000000-0000-0000-0000-000000000002', name: '个人模型', provider: 'qwen',
    model: 'model-a', maxTokens: 1000, monthlyTokenBudget: 10000,
  };
  const template = {
    id: '00000000-0000-0000-0000-000000000003', code: 'exam-summary',
    summaryType: AiSummaryType.EXAM, version: 1,
  };

  it('returns a successful idempotent task without calling the model again', async () => {
    const existing = task(AiSummaryTaskStatus.SUCCEEDED);
    const prisma = {
      aiSummaryPromptTemplate: { findFirst: jest.fn().mockResolvedValue(template) },
      aiSummaryTask: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn() },
    };
    const runner = { run: jest.fn() };
    const service = new ExamSummaryTaskUseCases(
      prisma as never,
      { build: jest.fn().mockResolvedValue(dataset()) } as never,
      { resolve: jest.fn().mockResolvedValue(config) } as never,
      runner as never,
      { quota: jest.fn().mockResolvedValue({ usedTokens: 20, remainingTokens: 9980 }) } as never,
      { recordAiSummary: jest.fn() } as never,
    );

    const result = await service.create({ examId: existing.subjectId, configId: config.id }, user);

    expect(result.cacheHit).toBe(true);
    expect(result.status).toBe('succeeded');
    expect(runner.run).not.toHaveBeenCalled();
    expect(prisma.aiSummaryTask.create).not.toHaveBeenCalled();
  });

  it('retries the same failed task instead of creating a duplicate', async () => {
    const failed = task(AiSummaryTaskStatus.FAILED);
    const succeeded = task(AiSummaryTaskStatus.SUCCEEDED);
    const prisma = {
      aiSummaryPromptTemplate: { findFirst: jest.fn().mockResolvedValue(template) },
      aiSummaryTask: { findFirst: jest.fn().mockResolvedValue(failed), create: jest.fn() },
    };
    const runner = { run: jest.fn().mockResolvedValue(succeeded) };
    const service = new ExamSummaryTaskUseCases(
      prisma as never,
      { build: jest.fn().mockResolvedValue(dataset()) } as never,
      { resolve: jest.fn().mockResolvedValue(config) } as never,
      runner as never,
      { quota: jest.fn().mockResolvedValue({ usedTokens: 20, remainingTokens: 9980 }) } as never,
      { recordAiSummary: jest.fn() } as never,
    );

    const result = await service.create({ examId: failed.subjectId }, user);

    expect(runner.run).toHaveBeenCalledWith(failed.id);
    expect(prisma.aiSummaryTask.create).not.toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
  });

  function task(status: AiSummaryTaskStatus) {
    return {
      id: '00000000-0000-0000-0000-000000000004',
      type: AiSummaryType.EXAM,
      subjectId: '00000000-0000-0000-0000-000000000005',
      inputHash: 'hash', datasetVersion: 'exam-summary/v1', promptVersion: 1,
      schemaVersion: 'exam-summary-output/v1', providerConfigId: config.id,
      modelSnapshot: config.model, status, attemptCount: 1, inputTokens: 10, outputTokens: 10,
      sanitizedError: null, providerConfig: config, promptTemplate: template,
      summary: {
        id: '00000000-0000-0000-0000-000000000006', reviewStatus: 'DRAFT',
        draftVersion: 1, summaryJson: { schemaVersion: 'exam-summary-output/v1' },
      },
    };
  }

  function dataset() {
    const capturedAt = '2026-07-16T00:00:00.000Z';
    return {
      type: 'exam', datasetVersion: 'exam-summary/v1', generatedAt: capturedAt,
      dataCoverage: { from: null, to: null, includes: ['exam'], excludes: [] },
      evidenceIndex: {
        'exam:1:score': {
          refId: 'exam:1:score', sourceType: 'exam', sourceId: '1', metric: 'score',
          path: '/score', value: 80, capturedAt,
        },
      },
      score: { value: 80, evidenceRef: 'exam:1:score' },
    };
  }
});
