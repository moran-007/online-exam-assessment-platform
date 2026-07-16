import { ExamSummaryDatasetBuilder } from '../../src/modules/ai/datasets/exam-summary-dataset.builder';
import { createSummaryDatasetInputHash } from '../../src/modules/ai/summary-input-hash';

describe('ExamSummaryDatasetBuilder', () => {
  const examId = '00000000-0000-0000-0000-000000000001';
  const classId = '00000000-0000-0000-0000-000000000002';
  const questionId = '00000000-0000-0000-0000-000000000003';
  const knowledgePointId = '00000000-0000-0000-0000-000000000004';
  const user = {
    id: '00000000-0000-0000-0000-000000000005', username: 'teacher', realName: 'Teacher',
    userType: 'TEACHER', roles: ['teacher'], permissions: ['ai.summary.exam.generate'],
  };

  function dependencies() {
    const prisma = {
      exam: { findFirst: jest.fn().mockResolvedValue({
        id: examId, name: '期中考试', courseId: '00000000-0000-0000-0000-000000000006',
        classId, course: { name: '数学' },
      }) },
      classGroup: { findFirst: jest.fn().mockResolvedValue({
        id: classId, name: '一班', _count: { students: 4 },
      }) },
    };
    const dataScope = { assertExamAccessible: jest.fn().mockResolvedValue(undefined) };
    const statistics = {
      examDetail: jest.fn().mockResolvedValue({
        submitCount: 2, gradedCount: 2, fullScore: 100,
        averageScore: 80, medianScore: 80, minScore: 70, maxScore: 90,
      }),
      scoreDistribution: jest.fn().mockResolvedValue({
        buckets: [{ label: '80-89%', count: 1, percent: 0.5 }],
      }),
      knowledge: jest.fn().mockResolvedValue([{
        knowledgePointId, name: '函数', answerCount: 2, correctRate: 0.5,
      }]),
      questionDiagnostics: jest.fn().mockResolvedValue([{
        questionId, title: '函数题', answerCount: 2, correctRate: 0.5,
        averageScore: 8, discrimination: 0.4, anomalyCount: 0,
      }]),
    };
    return { prisma, dataScope, statistics };
  }

  it('builds a deterministic, evidence-backed, permission-scoped dataset', async () => {
    const deps = dependencies();
    const builder = new ExamSummaryDatasetBuilder(
      deps.prisma as never, deps.dataScope as never, deps.statistics as never,
    );
    const dataset = await builder.build(examId, user);
    expect(deps.dataScope.assertExamAccessible).toHaveBeenCalledWith(user, examId);
    expect(dataset).toMatchObject({
      datasetVersion: 'exam-summary/v1',
      exam: { id: examId, classId, className: '一班' },
      participation: {
        eligible: { value: 4 }, submitted: { value: 2 }, graded: { value: 2 },
        submissionRate: { value: 0.5 },
      },
      scores: { average: { value: 80 }, median: { value: 80 } },
    });
    expect(Object.keys(dataset.evidenceIndex)).toHaveLength(18);
    expect(dataset.questions[0].correctRate.evidenceRef).toContain(questionId);
    expect(dataset.dataCoverage.excludes).toContain('attendance');

    const firstHash = createSummaryDatasetInputHash(dataset);
    const later = {
      ...dataset,
      generatedAt: '2030-01-01T00:00:00.000Z',
      evidenceIndex: Object.fromEntries(Object.entries(dataset.evidenceIndex).map(([key, value]) => [
        key, { ...value, capturedAt: '2030-01-01T00:00:00.000Z' },
      ])),
    };
    expect(createSummaryDatasetInputHash(later)).toBe(firstHash);
  });

  it('stops before reading exam facts when scope authorization fails', async () => {
    const deps = dependencies();
    deps.dataScope.assertExamAccessible.mockRejectedValue(new Error('forbidden'));
    const builder = new ExamSummaryDatasetBuilder(
      deps.prisma as never, deps.dataScope as never, deps.statistics as never,
    );
    await expect(builder.build(examId, user)).rejects.toThrow('forbidden');
    expect(deps.prisma.exam.findFirst).not.toHaveBeenCalled();
  });
});
