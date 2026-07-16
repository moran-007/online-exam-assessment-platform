import {
  AiProviderCapabilityRegistry,
  matchesModelPattern,
} from '../../src/modules/ai/ai-provider-capability.registry';
import { assertEvidenceIndex, type EvidenceIndex } from '../../src/modules/ai/datasets/evidence-ref';
import { assertSummaryDataset } from '../../src/modules/ai/datasets/dataset-validator';
import { createSummaryInputHash } from '../../src/modules/ai/summary-input-hash';
import {
  EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION,
  type StructuredSummaryOutput,
} from '../../src/modules/ai/schemas/summary-output.schema';
import {
  SummaryOutputValidationError,
  SummaryOutputValidator,
} from '../../src/modules/ai/schemas/summary-output.validator';

const evidence: EvidenceIndex = {
  'exam:one:average': {
    refId: 'exam:one:average',
    sourceType: 'exam',
    sourceId: '00000000-0000-0000-0000-000000000001',
    metric: 'averageScore',
    path: '/scores/average',
    value: 82.5,
    unit: 'score',
    capturedAt: '2026-07-16T00:00:00.000Z',
  },
};

function output(refId = 'exam:one:average'): StructuredSummaryOutput {
  const claim = { text: '班级整体表现稳定', evidenceRefs: [refId] };
  return {
    schemaVersion: EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION,
    headline: claim,
    overview: [claim],
    strengths: [],
    risks: [],
    actions: [claim],
    needsReview: [],
  };
}

describe('AI summary foundation', () => {
  it('matches provider model globs without treating model text as a regular expression', () => {
    expect(matchesModelPattern('qwen3.*', 'qwen3.6-plus')).toBe(true);
    expect(matchesModelPattern('deepseek-?-flash', 'deepseek-v-flash')).toBe(true);
    expect(matchesModelPattern('glm-5.1', 'glm-5x1')).toBe(false);
  });

  it('prefers provider-specific and more precise capability registrations', async () => {
    const findMany = jest.fn().mockResolvedValue([
      capability('*', '*', false),
      capability('deepseek', 'deepseek-*', true),
      capability('deepseek', 'deepseek-chat', false),
    ]);
    const registry = new AiProviderCapabilityRegistry({
      aiProviderCapability: { findMany },
    } as never);
    await expect(registry.resolve('DeepSeek', 'deepseek-chat')).resolves.toMatchObject({
      provider: 'deepseek', modelPattern: 'deepseek-chat', supportsJsonSchema: false, source: 'registry',
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { provider: { in: ['deepseek', '*'] }, enabled: true },
    });
  });

  it('uses conservative capabilities for unregistered models', async () => {
    const registry = new AiProviderCapabilityRegistry({
      aiProviderCapability: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);
    await expect(registry.resolve('unknown', 'new-model')).resolves.toMatchObject({
      supportsJsonObject: false, supportsJsonSchema: false, maxOutputTokens: null,
      source: 'conservative-default',
    });
  });

  it('accepts only structured output whose facts reference known evidence', () => {
    const validator = new SummaryOutputValidator();
    expect(validator.validate(output(), evidence)).toEqual(output());
    expect(() => validator.validate(output('missing'), evidence)).toThrow(SummaryOutputValidationError);
  });

  it('rejects malformed evidence indexes before validating model output', () => {
    expect(() => assertEvidenceIndex({
      wrong: { ...evidence['exam:one:average'], capturedAt: 'not-a-date' },
    })).toThrow(/does not match refId/);
  });

  it('validates dataset values against evidence and hashes object keys canonically', () => {
    const base = {
      datasetVersion: 'exam-summary/v1',
      generatedAt: '2026-07-16T00:00:00.000Z',
      dataCoverage: { from: null, to: null, includes: ['exam'], excludes: ['attendance'] },
      evidenceIndex: evidence,
    };
    expect(() => assertSummaryDataset({
      ...base,
      score: { value: 82.5, evidenceRef: 'exam:one:average' },
    })).not.toThrow();
    expect(() => assertSummaryDataset({
      ...base,
      score: { value: 99, evidenceRef: 'exam:one:average' },
    })).toThrow(/does not match evidence/);
    expect(createSummaryInputHash({ b: 2, a: 1 })).toBe(createSummaryInputHash({ a: 1, b: 2 }));
  });
});

function capability(provider: string, modelPattern: string, supportsJsonSchema: boolean) {
  return {
    id: `${provider}:${modelPattern}`, provider, modelPattern,
    supportsJsonObject: supportsJsonSchema, supportsJsonSchema,
    supportsStreaming: false, supportsThinking: false,
    maxContextTokens: null, maxOutputTokens: null, enabled: true,
    createdAt: new Date(), updatedAt: new Date(),
  };
}
