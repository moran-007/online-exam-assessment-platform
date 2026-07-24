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

  it('requires both the AI data permission and the ordinary business permission', async () => {
    const service = new AiDataPermissionService();

    await expect(service.isAllowed('grade_history', teacher)).resolves.toBe(true);
    await expect(service.isAllowed('grade_history', {
      ...teacher,
      permissions: teacher.permissions.filter((code) => code !== 'grading:score:read'),
    })).resolves.toBe(false);
    await expect(service.isAllowed('grade_history', {
      ...teacher,
      permissions: teacher.permissions.filter((code) => code !== 'ai.data.grade-history'),
    })).resolves.toBe(false);
  });

  it('fails closed before a summary can use a data domain missing from the role', async () => {
    const service = new AiDataPermissionService();
    const withoutAttendance = {
      ...teacher,
      permissions: teacher.permissions.filter((code) => code !== 'ai.data.attendance'),
    };

    await expect(service.assertSummaryAllowed(AiSummaryType.STUDENT, withoutAttendance))
      .rejects.toThrow('AI 数据权限未开放：出勤情况');
  });

  it('checks only the data categories selected for a student or class summary', async () => {
    const service = new AiDataPermissionService();
    const withoutAttendance = {
      ...teacher,
      permissions: teacher.permissions.filter((code) => code !== 'ai.data.attendance'),
    };

    await expect(service.assertSummaryAllowed(AiSummaryType.STUDENT, withoutAttendance, ['exams']))
      .resolves.toBeUndefined();
    await expect(service.assertSummaryAllowed(AiSummaryType.STUDENT, withoutAttendance, ['lessons']))
      .rejects.toThrow('AI 数据权限未开放：出勤情况');
  });

  it('keeps real-name access independent from score access', async () => {
    const service = new AiDataPermissionService();

    await expect(service.isAllowed('student_identity', teacher)).resolves.toBe(false);
    await expect(service.isAllowed('student_identity', {
      ...teacher,
      permissions: [...teacher.permissions, 'student:identity:read', 'ai.data.student-identity'],
    })).resolves.toBe(true);
  });
});
