import { AttemptStatus } from '@prisma/client';
import { StudentSummaryDatasetBuilder } from '../../src/modules/ai/datasets/student-summary-dataset.builder';
import { createSummaryDatasetInputHash } from '../../src/modules/ai/summary-input-hash';

describe('StudentSummaryDatasetBuilder', () => {
  const ids = {
    teacher: '00000000-0000-4000-8000-000000000001',
    student: '00000000-0000-4000-8000-000000000002',
    course: '00000000-0000-4000-8000-000000000003',
    class: '00000000-0000-4000-8000-000000000004',
    exam1: '00000000-0000-4000-8000-000000000011',
    exam2: '00000000-0000-4000-8000-000000000012',
    exam3: '00000000-0000-4000-8000-000000000013',
    attempt1: '00000000-0000-4000-8000-000000000021',
    attempt2: '00000000-0000-4000-8000-000000000022',
    question1: '00000000-0000-4000-8000-000000000031',
    question2: '00000000-0000-4000-8000-000000000032',
    kp1: '00000000-0000-4000-8000-000000000041',
    kp2: '00000000-0000-4000-8000-000000000042',
    wrong: '00000000-0000-4000-8000-000000000051',
  };
  const user = {
    id: ids.teacher, username: 'teacher', realName: 'Teacher', userType: 'TEACHER',
    roles: ['teacher'], permissions: ['ai.summary.student.generate'],
  };

  function dependencies() {
    const exams = [
      exam(ids.exam1, '第一次考试', '2026-05-01T00:00:00.000Z', 100),
      exam(ids.exam2, '第二次考试', '2026-06-01T00:00:00.000Z', 50),
      exam(ids.exam3, '第三次考试', '2026-07-01T00:00:00.000Z', 100),
    ];
    const attempts = [
      {
        id: ids.attempt1, examId: ids.exam1, status: AttemptStatus.GRADED,
        submittedAt: new Date('2026-05-01T01:00:00.000Z'), totalScore: 80,
        answers: [
          answer(ids.question1, 'SINGLE_CHOICE', 8, 10, true, [{ id: ids.kp1, name: '变量' }]),
          answer(ids.question2, 'PROGRAMMING', 6, 10, null, [{ id: ids.kp2, name: '循环' }]),
        ],
      },
      {
        id: ids.attempt2, examId: ids.exam2, status: AttemptStatus.SUBMITTED,
        submittedAt: new Date('2026-06-01T01:00:00.000Z'), totalScore: 0, answers: [],
      },
    ];
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: ids.student }) },
      classStudent: { findMany: jest.fn().mockResolvedValue([{ classId: ids.class }]) },
      exam: { findMany: jest.fn().mockResolvedValue(exams) },
      examAttempt: { findMany: jest.fn().mockResolvedValue(attempts) },
      wrongQuestion: { findMany: jest.fn().mockResolvedValue([{
        id: ids.wrong, questionId: ids.question1, wrongCount: 2, masteryStatus: 'REVIEWING',
        question: { title: '变量选择题', type: 'SINGLE_CHOICE' },
      }]) },
      judgeSubmission: { findMany: jest.fn().mockResolvedValue([
        { status: 'accepted', score: 100 }, { status: 'wrong_answer', score: 0 },
      ]) },
    };
    const dataScope = {
      assertStudentSummaryAccessible: jest.fn().mockResolvedValue(undefined),
      examWhere: jest.fn().mockResolvedValue({ classId: { in: [ids.class] } }),
    };
    return { prisma, dataScope };
  }

  it('builds privacy-safe trends, coverage and traceable evidence', async () => {
    const deps = dependencies();
    const builder = new StudentSummaryDatasetBuilder(deps.prisma as never, deps.dataScope as never);
    const dataset = await builder.build({
      studentId: ids.student,
      courseId: ids.course,
      examIds: [ids.exam3, ids.exam1, ids.exam2],
    }, user);

    expect(deps.dataScope.assertStudentSummaryAccessible).toHaveBeenCalledWith(user, ids.student);
    expect(dataset).toMatchObject({
      type: 'student',
      datasetVersion: 'student-summary/v1',
      student: { id: ids.student, alias: '该学生' },
      scope: { courseId: ids.course, courseName: '编程', examIds: [ids.exam1, ids.exam2, ids.exam3] },
      coverage: {
        selectedExamCount: { value: 3 },
        gradedExamCount: { value: 1 },
        notSubmittedExamCount: { value: 1 },
        ungradedExamCount: { value: 1 },
        gradedAnswerCount: { value: 2 },
      },
      programming: {
        submissionCount: { value: 2 }, acceptedCount: { value: 1 }, acceptedRate: { value: 0.5 },
      },
    });
    expect(dataset.examPerformance.map((item) => [item.status.value, item.score.value])).toEqual([
      ['graded', 80], ['ungraded', null], ['not_submitted', null],
    ]);
    expect(dataset.questionTypes).toHaveLength(2);
    expect(dataset.knowledgePoints).toHaveLength(2);
    expect(dataset.wrongQuestions[0]).toMatchObject({
      questionId: ids.question1, title: '变量选择题', wrongCount: { value: 2 }, masteryStatus: { value: 'reviewing' },
    });
    expect(dataset.dataCoverage.excludes).toEqual(expect.arrayContaining([
      'attendance', 'homework', 'classroom_behavior', 'answer_text', 'ungraded_scores',
    ]));
    expect(JSON.stringify(dataset)).not.toContain('answerJson');
    expect(Object.keys(dataset.evidenceIndex)).toHaveLength(35);

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

  it('stops before student and exam reads when scope authorization fails', async () => {
    const deps = dependencies();
    deps.dataScope.assertStudentSummaryAccessible.mockRejectedValue(new Error('forbidden'));
    const builder = new StudentSummaryDatasetBuilder(deps.prisma as never, deps.dataScope as never);
    await expect(builder.build({ studentId: ids.student }, user)).rejects.toThrow('forbidden');
    expect(deps.prisma.user.findFirst).not.toHaveBeenCalled();
    expect(deps.prisma.exam.findMany).not.toHaveBeenCalled();
  });

  it('rejects an explicit selection when any requested exam is outside scope', async () => {
    const deps = dependencies();
    deps.prisma.exam.findMany.mockResolvedValue([exam(ids.exam1, '第一次考试', '2026-05-01T00:00:00.000Z', 100)]);
    const builder = new StudentSummaryDatasetBuilder(deps.prisma as never, deps.dataScope as never);
    await expect(builder.build({ studentId: ids.student, examIds: [ids.exam1, ids.exam2] }, user))
      .rejects.toThrow('所选考试不存在、学生不在范围内或当前教师无权访问');
    expect(deps.prisma.examAttempt.findMany).not.toHaveBeenCalled();
  });

  function exam(id: string, name: string, endedAt: string, fullScore: number) {
    return {
      id, name, courseId: ids.course, endTime: new Date(endedAt),
      course: { name: '编程' }, paper: { totalScore: fullScore },
    };
  }

  function answer(
    id: string,
    type: string,
    score: number,
    maxScore: number,
    isCorrect: boolean | null,
    knowledgePoints: Array<{ id: string; name: string }>,
  ) {
    return {
      id, score, isCorrect, currentEvaluation: { maxScore },
      question: {
        id, type, defaultScore: maxScore,
        knowledgePoints: knowledgePoints.map((knowledgePoint) => ({ knowledgePoint })),
      },
    };
  }
});
