import { AiSummaryTaskStatus, AiSummaryType } from '@prisma/client';
import {
  AI_SUMMARY_RETRY_CONFIRMATION_REQUIRED_CODE,
  AiSummaryTaskCoordinator,
} from '../../src/modules/ai/ai-summary-task.coordinator';
import type { SupportedSummaryDataset } from '../../src/modules/ai/datasets/summary-dataset';

describe('AiSummaryTaskCoordinator', () => {
  it('returns a successful idempotent task without calling the model again', async () => {
    const existing = task(AiSummaryTaskStatus.SUCCEEDED);
    const fixture = dependencies(existing);

    const result = await fixture.service.create(definition(), user());

    expect(result.cacheHit).toBe(true);
    expect(fixture.runner.run).not.toHaveBeenCalled();
    expect(fixture.prisma.aiSummaryTask.create).not.toHaveBeenCalled();
    expect(fixture.prisma.aiSummaryTask.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requestedOutputTokens: 1000, outputLimitKey: 1000 }),
    }));
    expect(fixture.prisma.aiSummaryTask.findFirst.mock.calls[0][0].where)
      .not.toHaveProperty('reservationOutputTokens');
  });

  it('blocks an unconfirmed retry of the same failed task without calling the model', async () => {
    const failed = task(AiSummaryTaskStatus.FAILED);
    const fixture = dependencies(failed);

    await expect(fixture.service.create(definition(), user())).rejects.toMatchObject({
      response: expect.objectContaining({ code: AI_SUMMARY_RETRY_CONFIRMATION_REQUIRED_CODE }),
    });

    expect(fixture.runner.run).not.toHaveBeenCalled();
    expect(fixture.prisma.aiSummaryCacheEvent.create).not.toHaveBeenCalled();
    expect(fixture.prisma.aiSummaryTask.create).not.toHaveBeenCalled();
  });

  it('retries the same failed task after explicit confirmation instead of creating a duplicate', async () => {
    const failed = task(AiSummaryTaskStatus.FAILED);
    const succeeded = task(AiSummaryTaskStatus.SUCCEEDED);
    const fixture = dependencies(failed);
    fixture.runner.run.mockResolvedValue(succeeded);

    const result = await fixture.service.create(definition(), user(), { confirmRetry: true });

    expect(fixture.runner.run).toHaveBeenCalledWith(failed.id);
    expect(fixture.prisma.aiSummaryTask.create).not.toHaveBeenCalled();
    expect(result.status).toBe('succeeded');
  });

  function dependencies(existing: ReturnType<typeof task>) {
    const prisma = {
      aiSummaryPromptTemplate: { findFirst: jest.fn().mockResolvedValue(template()) },
      aiSummaryTask: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn() },
      aiSummaryCacheEvent: { create: jest.fn().mockResolvedValue({}) },
      aiUsageEvent: { findFirst: jest.fn().mockResolvedValue({
        requestedOutputTokens: 1000, reservationOutputTokens: 1000, totalTokens: 20, usageReported: true,
      }) },
    };
    const runner = { run: jest.fn() };
    const service = new AiSummaryTaskCoordinator(
      prisma as never,
      { resolve: jest.fn().mockResolvedValue(config()) } as never,
      { resolve: jest.fn().mockResolvedValue({ maxOutputTokens: null }) } as never,
      runner as never,
      { quota: jest.fn().mockResolvedValue({ usedTokens: 20, remainingTokens: 9980 }) } as never,
      { recordAiSummary: jest.fn() } as never,
      { assertSummaryAllowed: jest.fn().mockResolvedValue(undefined) } as never,
    );
    return { prisma, runner, service };
  }

  function definition() {
    return {
      type: AiSummaryType.EXAM,
      subjectId: '00000000-0000-0000-0000-000000000005',
      scope: { examId: '00000000-0000-0000-0000-000000000005' },
      dataset: dataset() as unknown as SupportedSummaryDataset,
      templateCode: 'exam-summary',
      schemaVersion: 'exam-summary-output/v1',
      minOutputTokens: 100,
    };
  }

  function task(status: AiSummaryTaskStatus) {
    return {
      id: '00000000-0000-0000-0000-000000000004',
      type: AiSummaryType.EXAM,
      subjectId: '00000000-0000-0000-0000-000000000005',
      inputHash: 'hash', datasetVersion: 'exam-summary/v1', promptVersion: 1,
      schemaVersion: 'exam-summary-output/v1', providerConfigId: config().id,
      modelSnapshot: config().model, status, attemptCount: 1, inputTokens: 10, outputTokens: 10,
      requestedOutputTokens: 1000, correlationId: '00000000-0000-0000-0000-000000000007',
      reservationOutputTokens: 1000, outputLimitKey: 1000,
      sanitizedError: null, providerConfig: config(), promptTemplate: template(),
      summary: {
        id: '00000000-0000-0000-0000-000000000006', reviewStatus: 'DRAFT',
        draftVersion: 1, summaryJson: { schemaVersion: 'exam-summary-output/v1' },
      },
    };
  }

  function config() {
    return {
      id: '00000000-0000-0000-0000-000000000002', name: '个人模型', provider: 'qwen',
      model: 'model-a', maxTokens: 1000, monthlyTokenBudget: 10000,
    };
  }

  function template() {
    return {
      id: '00000000-0000-0000-0000-000000000003', code: 'exam-summary',
      summaryType: AiSummaryType.EXAM, version: 1,
    };
  }

  function dataset() {
    const capturedAt = '2026-07-16T00:00:00.000Z';
    return {
      type: 'exam' as const, datasetVersion: 'exam-summary/v1', generatedAt: capturedAt,
      dataCoverage: { from: null, to: null, includes: ['exam'], excludes: [] },
      evidenceIndex: {
        'exam:1:score': {
          refId: 'exam:1:score', sourceType: 'exam' as const, sourceId: '1', metric: 'score',
          path: '/score', value: 80, capturedAt,
        },
      },
    };
  }

  function user() {
    return {
      id: '00000000-0000-0000-0000-000000000001', username: 'teacher', realName: 'Teacher',
      userType: 'TEACHER', roles: ['teacher'], permissions: ['ai.summary.exam.generate'],
    };
  }
});
