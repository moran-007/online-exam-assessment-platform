import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { EvidenceCollector } from '../src/modules/ai/datasets/evidence-collector';
import type { EvidenceSourceType, EvidenceValue } from '../src/modules/ai/datasets/evidence-ref';
import type { StudentSummaryDataset } from '../src/modules/ai/datasets/summary-dataset';
import type { StructuredSummaryOutput } from '../src/modules/ai/schemas/summary-output.schema';

type Scenario = 'high' | 'low' | 'absent' | 'little_data' | 'no_wrong_questions' | 'anomaly_trend';
type GoldenSample = {
  id: string;
  scenario: Scenario;
  dataset: StudentSummaryDataset;
  output: StructuredSummaryOutput;
  expected: {
    gradedExamCount: number;
    notSubmittedExamCount: number;
    wrongQuestionCount: number;
    needsReviewCount: number;
  };
};

const scenarios: Scenario[] = ['high', 'low', 'absent', 'little_data', 'no_wrong_questions', 'anomaly_trend'];
const target = join(process.cwd(), 'test', 'fixtures', 'ai', 'student-summary-golden.jsonl');
void main();

async function main() {
  const samples = Array.from({ length: 12 }, (_, index) => createSample(index + 1));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${samples.map((sample) => JSON.stringify(sample)).join('\n')}\n`, 'utf8');
  process.stdout.write(`Generated ${samples.length} anonymized student summary samples at ${target}\n`);
}

function createSample(number: number): GoldenSample {
  const scenario = scenarios[(number - 1) % scenarios.length];
  const capturedAt = '2026-07-16T00:00:00.000Z';
  const studentId = uuid(number * 100);
  const courseId = uuid(number * 100 + 1);
  const examIds = [uuid(number * 100 + 2), uuid(number * 100 + 3)];
  const evidence = new EvidenceCollector(capturedAt);
  const value = <T extends EvidenceValue>(
    sourceType: EvidenceSourceType,
    sourceId: string,
    metric: string,
    metricValue: T,
    unit?: string,
  ) => evidence.collect({
    sourceType, sourceId, metric, value: metricValue, unit,
    path: `/students/${studentId}/${sourceType}/${sourceId}/${metric}`,
  });
  const examCount = scenario === 'little_data' ? 1 : 2;
  const selectedExamIds = examIds.slice(0, examCount);
  const notSubmitted = scenario === 'absent' ? 1 : 0;
  const graded = examCount - notSubmitted;
  const scores = scoreValues(scenario, number).slice(0, graded);
  const examPerformance = selectedExamIds.map((examId, index) => {
    const isAbsent = index >= graded;
    const score = isAbsent ? null : scores[index];
    return {
      examId,
      examName: `脱敏阶段考试 ${number}-${index + 1}`,
      endedAt: new Date(Date.UTC(2026, 6, 1 + index * 7)).toISOString(),
      status: value('exam_attempt', examId, 'status', isAbsent ? 'not_submitted' : 'graded'),
      submittedAt: isAbsent ? null : new Date(Date.UTC(2026, 6, 1 + index * 7, 1)).toISOString(),
      score: value('exam_attempt', examId, 'score', score, 'score'),
      fullScore: value('exam', examId, 'fullScore', 100, 'score'),
      scoreRate: value('exam_attempt', examId, 'scoreRate', score === null ? null : score / 100, 'ratio'),
    };
  });
  const questionId = uuid(number * 100 + 4);
  const knowledgePointId = uuid(number * 100 + 5);
  const answerCount = graded * 10;
  const averageRate = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length / 100 : 0;
  const wrongQuestions = scenario === 'no_wrong_questions' ? [] : [{
    questionId,
    title: '脱敏错题',
    questionType: 'single_choice',
    wrongCount: value('wrong_question', questionId, 'wrongCount', scenario === 'low' ? 3 : 1, 'count'),
    masteryStatus: value('wrong_question', questionId, 'masteryStatus', scenario === 'high' ? 'mastered' : 'learning'),
  }];
  const dataset: StudentSummaryDataset = {
    type: 'student',
    datasetVersion: 'student-summary/v1',
    generatedAt: capturedAt,
    dataCoverage: {
      from: '2026-07-01T00:00:00.000Z', to: '2026-07-16T23:59:59.999Z',
      includes: ['graded_exams', 'question_types', 'knowledge_points', 'wrong_questions', 'programming'],
      excludes: ['attendance', 'lessons', 'homework', 'classroom_behavior', 'family_data'],
    },
    student: { id: studentId, alias: `脱敏学生样本 ${String(number).padStart(2, '0')}` },
    scope: { courseId, courseName: '脱敏课程', examIds: selectedExamIds },
    coverage: {
      selectedExamCount: value('student', studentId, 'selectedExamCount', examCount, 'exam'),
      gradedExamCount: value('student', studentId, 'gradedExamCount', graded, 'exam'),
      notSubmittedExamCount: value('student', studentId, 'notSubmittedExamCount', notSubmitted, 'exam'),
      ungradedExamCount: value('student', studentId, 'ungradedExamCount', 0, 'exam'),
      gradedAnswerCount: value('student', studentId, 'gradedAnswerCount', answerCount, 'answer'),
    },
    examPerformance,
    questionTypes: answerCount ? [{
      type: 'single_choice',
      answerCount: value('student', studentId, 'questionType.singleChoice.answerCount', answerCount, 'answer'),
      correctRate: value('student', studentId, 'questionType.singleChoice.correctRate', round(averageRate), 'ratio'),
      scoreRate: value('student', studentId, 'questionType.singleChoice.scoreRate', round(averageRate), 'ratio'),
    }] : [],
    knowledgePoints: answerCount ? [{
      knowledgePointId, name: scenario === 'low' ? '脱敏知识点·待加强' : '脱敏知识点·基础',
      answerCount: value('knowledge_point', knowledgePointId, 'answerCount', answerCount, 'answer'),
      correctRate: value('knowledge_point', knowledgePointId, 'correctRate', round(averageRate), 'ratio'),
      scoreRate: value('knowledge_point', knowledgePointId, 'scoreRate', round(averageRate), 'ratio'),
    }] : [],
    wrongQuestions,
    programming: {
      submissionCount: value('student', studentId, 'programming.submissionCount', scenario === 'high' ? 4 : 0, 'submission'),
      acceptedCount: value('student', studentId, 'programming.acceptedCount', scenario === 'high' ? 4 : 0, 'submission'),
      acceptedRate: value('student', studentId, 'programming.acceptedRate', scenario === 'high' ? 1 : 0, 'ratio'),
      averageScore: value('student', studentId, 'programming.averageScore', scenario === 'high' ? 100 : 0, 'score'),
    },
    evidenceIndex: evidence.index,
  };
  const output = outputFor(dataset, scenario);
  return {
    id: `student-golden-${String(number).padStart(2, '0')}`,
    scenario,
    dataset,
    output,
    expected: {
      gradedExamCount: graded,
      notSubmittedExamCount: notSubmitted,
      wrongQuestionCount: wrongQuestions.length,
      needsReviewCount: output.needsReview.length,
    },
  };
}

function outputFor(dataset: StudentSummaryDataset, scenario: Scenario): StructuredSummaryOutput {
  const claim = (text: string, evidenceRefs: string[]) => ({ text, evidenceRefs });
  const firstExam = dataset.examPerformance[0];
  const headlineText = scenario === 'absent'
    ? '所选范围同时包含已评分与未提交考试记录'
    : `所选范围包含 ${dataset.coverage.gradedExamCount.value} 场已评分考试`;
  return {
    schemaVersion: 'student-summary-output/v1',
    headline: claim(headlineText, [dataset.coverage.gradedExamCount.evidenceRef]),
    overview: [claim('总结仅覆盖所选考试及已评分作答', [dataset.coverage.selectedExamCount.evidenceRef])],
    strengths: scenario === 'high'
      ? [claim('已评分考试得分率较高', [firstExam.scoreRate.evidenceRef])]
      : [],
    risks: scenario === 'low'
      ? [claim('已评分考试得分率较低，需要针对性复习', [firstExam.scoreRate.evidenceRef])]
      : scenario === 'absent'
        ? [claim('存在未提交考试记录，但该记录不计为零分', [dataset.coverage.notSubmittedExamCount.evidenceRef])]
        : [],
    actions: [claim('依据已评分题型和知识点安排下一阶段练习', [dataset.coverage.gradedAnswerCount.evidenceRef])],
    needsReview: scenario === 'anomaly_trend'
      ? [claim('两场已评分考试得分变化较大，需人工结合教学情境复核', [
        dataset.examPerformance[0].scoreRate.evidenceRef,
        dataset.examPerformance[1].scoreRate.evidenceRef,
      ])]
      : [],
  };
}

function scoreValues(scenario: Scenario, number: number) {
  if (scenario === 'high') return [94, 97];
  if (scenario === 'low') return [42, 48];
  if (scenario === 'anomaly_trend') return [91, 45];
  if (scenario === 'absent') return [78];
  if (scenario === 'little_data') return [70 + (number % 5)];
  return [76, 82];
}

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function round(value: number) {
  return Number(value.toFixed(4));
}
