import {
  AttemptStatus,
  AttendanceStatus,
  ShowScoreMode,
  LessonRecordStatus,
  LessonSessionStatus,
  Prisma,
} from '@prisma/client';
import { ClassSummaryDatasetBuilder } from '../../src/modules/ai/datasets/class-summary-dataset.builder';
import { LessonAssistantDatasetBuilder } from '../../src/modules/ai/datasets/lesson-assistant-dataset.builder';
import { ParentReportDatasetBuilder } from '../../src/modules/ai/datasets/parent-report-dataset.builder';

describe('integrated summary dataset builders', () => {
  const user = {
    id: '10000000-0000-0000-0000-000000000001',
    username: 'teacher',
    realName: '教师',
    userType: 'TEACHER',
    roles: ['teacher'],
    permissions: [],
  };
  const scope = {
    assertAcademicClassAccessible: jest.fn().mockResolvedValue(undefined),
    assertStudentSummaryAccessible: jest.fn().mockResolvedValue(undefined),
  };

  it('builds class aggregates without individual student identity', async () => {
    const prisma = {
      classGroup: { findFirst: jest.fn().mockResolvedValue({
        id: 'class-1', name: 'A 班', course: { name: '编程' }, _count: { students: 2 },
      }) },
      exam: { findMany: jest.fn().mockResolvedValue([{
        id: 'exam-1',
        attempts: [{
          status: AttemptStatus.GRADED,
          totalScore: new Prisma.Decimal(85),
          answers: [{
            score: new Prisma.Decimal(8),
            isCorrect: true,
            currentEvaluation: { maxScore: new Prisma.Decimal(10) },
            question: {
              type: 'SINGLE_CHOICE',
              defaultScore: new Prisma.Decimal(10),
              knowledgePoints: [{ knowledgePoint: { id: 'kp-1', name: '循环' } }],
            },
          }],
        }],
      }]) },
      lessonSession: { findMany: jest.fn().mockResolvedValue([{
        id: 'lesson-1',
        status: LessonSessionStatus.COMPLETED,
        lessonHours: new Prisma.Decimal(2),
        lessonRecord: { id: 'record-1', status: LessonRecordStatus.PUBLISHED, publicHomework: '练习 1' },
        attendance: [{ status: AttendanceStatus.PRESENT }, { status: AttendanceStatus.ABSENT }],
      }]) },
    };
    const dataset = await new ClassSummaryDatasetBuilder(prisma as never, scope as never)
      .build({ classId: 'class-1' }, user);

    expect(dataset.coverage.studentCount.value).toBe(2);
    expect(dataset.attendance.attendanceRate.value).toBe(0.5);
    expect(dataset.lessons.completedHours.value).toBe(2);
    expect(dataset.dataCoverage.excludes).toContain('student_names');
    expect(JSON.stringify(dataset)).not.toContain('student-secret');
  });

  it('honors score visibility and excludes internal lesson notes from parent reports', async () => {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'student-1' }) },
      examAttempt: { findMany: jest.fn().mockResolvedValue([{
        id: 'attempt-1',
        status: AttemptStatus.GRADED,
        totalScore: new Prisma.Decimal(95),
        submittedAt: new Date('2026-07-18T08:00:00Z'),
        exam: {
          id: 'exam-1', name: '周测', showScoreMode: ShowScoreMode.AFTER_EXAM_END,
          endTime: new Date('2026-07-20T08:00:00Z'),
        },
      }]) },
      lessonSession: { findMany: jest.fn().mockResolvedValue([{
        id: 'lesson-1', title: '循环', startsAt: new Date('2026-07-18T08:00:00Z'),
        attendance: [{ id: 'attendance-1', status: AttendanceStatus.PRESENT }],
        lessonRecord: {
          id: 'record-1', status: LessonRecordStatus.PUBLISHED,
          publicLearningGoal: '掌握循环', publicClassPerformance: '完成课堂练习',
          publicHomework: '循环练习', publicNextPlan: '函数',
        },
      }]) },
    };
    const dataset = await new ParentReportDatasetBuilder(prisma as never, scope as never)
      .build({ studentId: 'student-1' }, user);

    expect(dataset.exams[0]).toMatchObject({
      score: { value: null },
      scoreVisible: { value: false },
    });
    expect(dataset.publishedLessons[0].homework.value).toBe('循环练习');
    expect(JSON.stringify(dataset)).not.toContain('internalTeachingNotes');
  });

  it('keeps internal notes only in the teacher lesson-assistant draft dataset', async () => {
    const prisma = { lessonSession: { findUnique: jest.fn().mockResolvedValue({
      id: 'lesson-1', title: '循环', startsAt: new Date('2026-07-18T08:00:00Z'), classId: 'class-1',
      classGroup: { name: 'A 班' },
      lessonRecord: {
        id: 'record-1', status: LessonRecordStatus.DRAFT,
        publicTeachingContent: '循环', publicLearningGoal: '掌握循环', publicClassPerformance: null,
        publicHomework: null, publicNextPlan: null,
        internalTeachingNotes: '下次增加演示', internalClassPerformance: '节奏稍快',
      },
    }) } };
    const dataset = await new LessonAssistantDatasetBuilder(prisma as never, scope as never)
      .build('lesson-1', user);

    expect(dataset.currentRecord.internalTeachingNotes.value).toBe('下次增加演示');
    expect(dataset.dataCoverage.includes).toContain('teacher_internal_notes_for_drafting_only');
    expect(scope.assertAcademicClassAccessible).toHaveBeenCalledWith(user, 'class-1');
  });
});
