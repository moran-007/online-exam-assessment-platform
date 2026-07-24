import { AiSummaryType } from '@prisma/client';
import { AiDataPermissionService } from '../../src/modules/ai/ai-data-permission.service';

describe('AiDataPermissionService', () => {
  const teacher = {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'teacher', realName: '教师', userType: 'TEACHER', roles: ['teacher'],
    permissions: [
      'grading:score:read', 'attendance:read', 'schedule:read',
      'ai.data.grade-history', 'ai.data.attendance', 'ai.data.schedule',
    ],
  };

  function service(codes = [
    'grading:score:read', 'attendance:read', 'schedule:read',
    'student:identity:read', 'academic-profile:read', 'lesson-record:read', 'lesson-plan:read',
    'ai.data.grade-history', 'ai.data.attendance', 'ai.data.schedule',
    'ai.data.student-identity', 'ai.data.teacher-identity', 'ai.data.teacher-materials',
    'ai.data.lesson-plans',
  ]) {
    return new AiDataPermissionService({
      codes: jest.fn().mockResolvedValue(new Set(codes)),
    } as never);
  }

  it('requires both the AI data permission and the ordinary business permission', async () => {
    const permissions = service();

    await expect(permissions.isAllowed('grade_history', teacher)).resolves.toBe(true);
    await expect(permissions.isAllowed('grade_history', {
      ...teacher,
      permissions: teacher.permissions.filter((code) => code !== 'grading:score:read'),
    })).resolves.toBe(false);
    await expect(service([
      'grading:score:read',
    ]).isAllowed('grade_history', teacher)).resolves.toBe(false);
  });

  it('fails closed before a summary can use a data domain missing from the role', async () => {
    const permissions = service([
      'grading:score:read', 'attendance:read', 'schedule:read',
      'ai.data.grade-history', 'ai.data.schedule',
    ]);

    await expect(permissions.assertSummaryAllowed(AiSummaryType.STUDENT, teacher))
      .rejects.toThrow('AI 数据权限未开放：出勤情况');
  });

  it('checks only the data categories selected for a student or class summary', async () => {
    const permissions = service([
      'grading:score:read', 'attendance:read', 'schedule:read',
      'ai.data.grade-history', 'ai.data.schedule',
    ]);

    await expect(permissions.assertSummaryAllowed(AiSummaryType.STUDENT, teacher, ['exams']))
      .resolves.toBeUndefined();
    await expect(permissions.assertSummaryAllowed(AiSummaryType.STUDENT, teacher, ['lessons']))
      .rejects.toThrow('AI 数据权限未开放：出勤情况');
  });

  it('keeps real-name access independent from score access', async () => {
    const permissions = service();

    await expect(permissions.isAllowed('student_identity', teacher)).resolves.toBe(false);
    await expect(permissions.isAllowed('student_identity', {
      ...teacher,
      permissions: [...teacher.permissions, 'student:identity:read', 'ai.data.student-identity'],
    })).resolves.toBe(true);
  });
});
