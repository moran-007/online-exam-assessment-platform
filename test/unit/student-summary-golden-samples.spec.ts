import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertSummaryDataset } from '../../src/modules/ai/datasets/dataset-validator';
import type { StudentSummaryDataset } from '../../src/modules/ai/datasets/summary-dataset';
import { SummaryOutputValidator } from '../../src/modules/ai/schemas/summary-output.validator';

type Scenario = 'high' | 'low' | 'absent' | 'little_data' | 'no_wrong_questions' | 'anomaly_trend';
type GoldenSample = {
  id: string;
  scenario: Scenario;
  dataset: StudentSummaryDataset;
  output: unknown;
  expected: {
    gradedExamCount: number;
    notSubmittedExamCount: number;
    wrongQuestionCount: number;
    needsReviewCount: number;
  };
};

describe('student summary golden samples', () => {
  const samples = readFileSync(
    join(process.cwd(), 'test', 'fixtures', 'ai', 'student-summary-golden.jsonl'),
    'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line) as GoldenSample);
  const validator = new SummaryOutputValidator();

  it('covers every required scenario twice with anonymized, traceable facts', () => {
    const scenarios: Scenario[] = ['high', 'low', 'absent', 'little_data', 'no_wrong_questions', 'anomaly_trend'];
    expect(samples).toHaveLength(12);
    expect(new Set(samples.map((sample) => sample.id)).size).toBe(12);
    for (const scenario of scenarios) {
      expect(samples.filter((sample) => sample.scenario === scenario)).toHaveLength(2);
    }
    for (const sample of samples) {
      expect(sample.dataset.student.alias).toMatch(/^脱敏学生样本 \d{2}$/);
      expect(JSON.stringify(sample)).not.toMatch(/1[3-9]\d{9}|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(JSON.stringify(sample.output)).not.toMatch(/缺勤|课堂表现|学习态度|家庭情况|心理状态/);
      expect(() => assertSummaryDataset(sample.dataset)).not.toThrow();
      expect(() => validator.validate(sample.output, sample.dataset.evidenceIndex)).not.toThrow();
      expect(sample.dataset.coverage.gradedExamCount.value).toBe(sample.expected.gradedExamCount);
      expect(sample.dataset.coverage.notSubmittedExamCount.value).toBe(sample.expected.notSubmittedExamCount);
      expect(sample.dataset.wrongQuestions).toHaveLength(sample.expected.wrongQuestionCount);
      expect((sample.output as { needsReview: unknown[] }).needsReview).toHaveLength(sample.expected.needsReviewCount);
    }
  });

  it('keeps absent exams null instead of silently converting them to zero scores', () => {
    const absent = samples.filter((sample) => sample.scenario === 'absent');
    for (const sample of absent) {
      const missed = sample.dataset.examPerformance.find((exam) => exam.status.value === 'not_submitted');
      expect(missed).toBeDefined();
      expect(missed?.score.value).toBeNull();
      expect(missed?.scoreRate.value).toBeNull();
    }
  });
});
