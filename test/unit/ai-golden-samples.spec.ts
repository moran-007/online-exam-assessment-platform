import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertSummaryDataset } from '../../src/modules/ai/datasets/dataset-validator';
import type { ExamSummaryDataset } from '../../src/modules/ai/datasets/summary-dataset';
import { SummaryOutputValidator } from '../../src/modules/ai/schemas/summary-output.validator';

type GoldenSample = {
  id: string;
  dataset: ExamSummaryDataset;
  output: unknown;
  expected: { average: number; submissionRate: number; weakKnowledgePoint: string; evidenceCount: number };
};

describe('exam summary golden samples', () => {
  const samples = readFileSync(
    join(process.cwd(), 'test', 'fixtures', 'ai', 'exam-summary-golden.jsonl'),
    'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line) as GoldenSample);
  const validator = new SummaryOutputValidator();

  it('contains 50 unique anonymized, evidence-valid evaluation cases', () => {
    expect(samples).toHaveLength(50);
    expect(new Set(samples.map((sample) => sample.id)).size).toBe(50);
    for (const sample of samples) {
      expect(sample.dataset.exam.name).toMatch(/^脱敏考试样本 \d{2}$/);
      expect(JSON.stringify(sample)).not.toMatch(/1[3-9]\d{9}|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(() => assertSummaryDataset(sample.dataset)).not.toThrow();
      expect(() => validator.validate(sample.output, sample.dataset.evidenceIndex)).not.toThrow();
      expect(sample.dataset.scores.average.value).toBe(sample.expected.average);
      expect(sample.dataset.participation.submissionRate.value).toBe(sample.expected.submissionRate);
      expect(sample.dataset.knowledgePoints[0].name).toBe(sample.expected.weakKnowledgePoint);
      expect(Object.keys(sample.dataset.evidenceIndex)).toHaveLength(sample.expected.evidenceCount);
    }
  });
});
