import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { EvidenceCollector } from '../src/modules/ai/datasets/evidence-collector';
import type { ExamSummaryDataset } from '../src/modules/ai/datasets/summary-dataset';
import type { StructuredSummaryOutput } from '../src/modules/ai/schemas/summary-output.schema';

type GoldenSample = {
  id: string;
  dataset: ExamSummaryDataset;
  output: StructuredSummaryOutput;
  expected: { average: number; submissionRate: number; weakKnowledgePoint: string; evidenceCount: number };
};

const target = join(process.cwd(), 'test', 'fixtures', 'ai', 'exam-summary-golden.jsonl');
void main();

async function main() {
  const samples = Array.from({ length: 50 }, (_, index) => createSample(index + 1));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${samples.map((sample) => JSON.stringify(sample)).join('\n')}\n`, 'utf8');
  process.stdout.write(`Generated ${samples.length} anonymized AI golden samples at ${target}\n`);
}

function createSample(number: number): GoldenSample {
  const generatedAt = '2026-07-16T00:00:00.000Z';
  const examId = uuid(number * 100);
  const questionA = uuid(number * 100 + 1);
  const questionB = uuid(number * 100 + 2);
  const knowledgeA = uuid(number * 100 + 3);
  const knowledgeB = uuid(number * 100 + 4);
  const evidence = new EvidenceCollector(generatedAt);
  const eligible = 20 + (number % 7);
  const submitted = eligible - (number % 4);
  const average = 55 + (number % 36);
  const median = Math.min(100, average + (number % 3) - 1);
  const submissionRate = round(submitted / eligible);
  const weakRate = round(0.35 + (number % 15) / 100);
  const strongRate = round(0.72 + (number % 18) / 100);
  const anomalyCount = number % 6 === 0 ? 1 : 0;
  const path = `/statistics/exams/${examId}`;
  const examValue = (metric: string, value: number, unit: string) => evidence.collect({
    sourceType: 'exam', sourceId: examId, metric, path: `${path}/${metric}`, value, unit,
  });
  const questionValue = (id: string, metric: string, value: number, unit: string) => evidence.collect({
    sourceType: 'question', sourceId: id, metric, path: `/statistics/questions/${id}/${metric}`, value, unit,
  });
  const knowledgeValue = (id: string, metric: string, value: number, unit: string) => evidence.collect({
    sourceType: 'knowledge_point', sourceId: id, metric,
    path: `/statistics/knowledge-points/${id}/${metric}`, value, unit,
  });

  const dataset: ExamSummaryDataset = {
    type: 'exam',
    datasetVersion: 'exam-summary/v1',
    generatedAt,
    dataCoverage: {
      from: null, to: null,
      includes: ['exam', 'submitted_attempts', 'scores', 'questions', 'knowledge_points'],
      excludes: ['attendance', 'lessons', 'homework'],
    },
    exam: {
      id: examId,
      name: `脱敏考试样本 ${String(number).padStart(2, '0')}`,
      courseId: uuid(900000 + number),
      courseName: `脱敏课程 ${((number - 1) % 5) + 1}`,
      classId: uuid(800000 + number),
      className: `脱敏班级 ${((number - 1) % 8) + 1}`,
    },
    participation: {
      eligible: examValue('eligibleStudentCount', eligible, 'student'),
      submitted: examValue('submittedCount', submitted, 'attempt'),
      graded: examValue('gradedCount', submitted, 'attempt'),
      submissionRate: examValue('submissionRate', submissionRate, 'ratio'),
    },
    scores: {
      fullScore: examValue('fullScore', 100, 'score'),
      average: examValue('averageScore', average, 'score'),
      median: examValue('medianScore', median, 'score'),
      minimum: examValue('minimumScore', Math.max(0, average - 28), 'score'),
      maximum: examValue('maximumScore', Math.min(100, average + 18), 'score'),
    },
    distribution: [
      {
        label: '0-59%',
        count: examValue('distribution.0-59%.count', Math.floor(submitted * 0.3), 'attempt'),
        rate: examValue('distribution.0-59%.rate', 0.3, 'ratio'),
      },
      {
        label: '60-100%',
        count: examValue('distribution.60-100%.count', submitted - Math.floor(submitted * 0.3), 'attempt'),
        rate: examValue('distribution.60-100%.rate', 0.7, 'ratio'),
      },
    ],
    questions: [
      {
        questionId: questionA, title: '脱敏题目 A',
        answerCount: questionValue(questionA, 'answerCount', submitted, 'answer'),
        correctRate: questionValue(questionA, 'correctRate', weakRate, 'ratio'),
        averageScore: questionValue(questionA, 'averageScore', round(weakRate * 10), 'score'),
        discrimination: questionValue(questionA, 'discrimination', 0.2, 'ratio'),
        anomalyCount: questionValue(questionA, 'anomalyCount', anomalyCount, 'answer'),
      },
      {
        questionId: questionB, title: '脱敏题目 B',
        answerCount: questionValue(questionB, 'answerCount', submitted, 'answer'),
        correctRate: questionValue(questionB, 'correctRate', strongRate, 'ratio'),
        averageScore: questionValue(questionB, 'averageScore', round(strongRate * 10), 'score'),
        discrimination: questionValue(questionB, 'discrimination', 0.35, 'ratio'),
        anomalyCount: questionValue(questionB, 'anomalyCount', 0, 'answer'),
      },
    ],
    knowledgePoints: [
      {
        knowledgePointId: knowledgeA, name: '脱敏知识点·待加强',
        answerCount: knowledgeValue(knowledgeA, 'answerCount', submitted, 'answer'),
        correctRate: knowledgeValue(knowledgeA, 'correctRate', weakRate, 'ratio'),
      },
      {
        knowledgePointId: knowledgeB, name: '脱敏知识点·优势',
        answerCount: knowledgeValue(knowledgeB, 'answerCount', submitted, 'answer'),
        correctRate: knowledgeValue(knowledgeB, 'correctRate', strongRate, 'ratio'),
      },
    ],
    evidenceIndex: evidence.index,
  };
  const output = outputFor(dataset, anomalyCount);
  return {
    id: `exam-golden-${String(number).padStart(2, '0')}`,
    dataset,
    output,
    expected: {
      average,
      submissionRate,
      weakKnowledgePoint: dataset.knowledgePoints[0].name,
      evidenceCount: Object.keys(evidence.index).length,
    },
  };
}

function outputFor(dataset: ExamSummaryDataset, anomalyCount: number): StructuredSummaryOutput {
  const claim = (text: string, evidenceRefs: string[]) => ({ text, evidenceRefs });
  return {
    schemaVersion: 'exam-summary-output/v1',
    headline: claim(`平均成绩为 ${dataset.scores.average.value} 分`, [dataset.scores.average.evidenceRef]),
    overview: [claim(`提交率为 ${Math.round((dataset.participation.submissionRate.value ?? 0) * 100)}%`, [dataset.participation.submissionRate.evidenceRef])],
    strengths: [claim('最高分体现出较好的上限表现', [dataset.scores.maximum.evidenceRef])],
    risks: [claim(`${dataset.knowledgePoints[0].name}正确率偏低`, [dataset.knowledgePoints[0].correctRate.evidenceRef])],
    actions: [claim(`围绕${dataset.knowledgePoints[0].name}安排针对性复习`, [dataset.knowledgePoints[0].correctRate.evidenceRef])],
    needsReview: anomalyCount
      ? [claim('存在异常题目记录，发布前需复核', [dataset.questions[0].anomalyCount.evidenceRef])]
      : [],
  };
}

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function round(value: number) {
  return Number(value.toFixed(4));
}
