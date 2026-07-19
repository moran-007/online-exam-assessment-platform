import {
  AttendanceStatus,
  AttemptStatus,
  ExamStatus,
  LessonHourLedgerType,
  LessonRecordStatus,
  LessonSessionStatus,
  Prisma,
} from '@prisma/client';
import { FusionDashboardQuery } from '../../src/modules/statistics/queries/fusion-dashboard.query';

describe('FusionDashboardQuery', () => {
  it('merges assessment, attendance, records and lesson-hour facts within student scope', async () => {
    const prisma = {
      lessonSession: { findMany: jest.fn().mockResolvedValue([{
        id: 'lesson-1', status: LessonSessionStatus.COMPLETED, lessonHours: new Prisma.Decimal(2),
        teacherId: 'teacher-1', teacher: { realName: '教师', username: 'teacher' },
        lessonRecord: { status: LessonRecordStatus.PUBLISHED }, _count: { attendance: 1 },
      }]) },
      examAttempt: { findMany: jest.fn().mockResolvedValue([{
        id: 'attempt-1', status: AttemptStatus.GRADED, totalScore: new Prisma.Decimal(90),
        submittedAt: new Date('2026-07-18T08:00:00Z'),
        exam: { id: 'exam-1', name: '周测', status: ExamStatus.ENDED, course: { name: '编程' } },
      }]) },
      answerRecord: { count: jest.fn().mockResolvedValue(0) },
      wrongQuestion: { count: jest.fn().mockResolvedValue(2) },
      attendanceRecord: { findMany: jest.fn().mockResolvedValue([{ status: AttendanceStatus.PRESENT }]) },
      lessonHourLedger: { findMany: jest.fn()
        .mockResolvedValueOnce([{ type: LessonHourLedgerType.CONSUME, amount: new Prisma.Decimal(-2) }])
        .mockResolvedValueOnce([{ amount: new Prisma.Decimal(8) }]) },
    };
    const scope = {
      academicClassIdsFor: jest.fn().mockResolvedValue(['class-1']),
      studentIdsFor: jest.fn().mockResolvedValue(['student-1']),
    };
    const service = new FusionDashboardQuery(prisma as never, scope as never);
    const user = {
      id: 'student-1', username: 'student', realName: '学生', userType: 'STUDENT',
      roles: ['student'], permissions: ['dashboard:read'],
    };

    const result = await service.execute({
      startDate: '2026-07-18T00:00:00Z', endDate: '2026-07-19T00:00:00Z',
    }, user);

    expect(result.role).toBe('student');
    expect(result.assessment).toMatchObject({ exams: 1, gradedAttempts: 1, averageScore: 90 });
    expect(result.academic).toMatchObject({
      completedLessons: 1, publishedLessonRecords: 1, attendanceRate: 1,
      assignedLessonHours: 2, consumedLessonHours: 2, remainingLessonHours: 8,
    });
    expect(result.teacherPerformance).toEqual([]);
    expect(result.drilldowns).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '考试记录', path: '/learning-portal?tab=exams' }),
      expect.objectContaining({ label: '考勤记录', path: '/teaching-operations?tab=attendance' }),
    ]));
    expect(result.drilldowns.some((item) => item.path.startsWith('/statistics'))).toBe(false);
  });
});
