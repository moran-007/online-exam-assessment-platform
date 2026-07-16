import { DataScopeService } from '../../src/modules/data-scope/data-scope.service';

describe('DataScopeService student summary access', () => {
  const teacher = {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'teacher', realName: 'Teacher', userType: 'TEACHER', roles: [], permissions: [],
  };
  const studentId = '00000000-0000-0000-0000-000000000002';

  function service(classMembership: unknown, authoredExamAttempt: unknown) {
    const prisma = {
      classStudent: { findFirst: jest.fn().mockResolvedValue(classMembership) },
      examAttempt: { findFirst: jest.fn().mockResolvedValue(authoredExamAttempt) },
    };
    return { prisma, scope: new DataScopeService(prisma as never) };
  }

  it('allows a teacher assigned to an active class containing the student', async () => {
    const { scope } = service({ id: 'membership' }, null);
    await expect(scope.assertStudentSummaryAccessible(teacher, studentId)).resolves.toBeUndefined();
  });

  it('allows the creator of a classless exam attempted by the student', async () => {
    const { scope } = service(null, { id: 'attempt' });
    await expect(scope.assertStudentSummaryAccessible(teacher, studentId)).resolves.toBeUndefined();
  });

  it('rejects unrelated teachers and non-teaching identities', async () => {
    const { scope } = service(null, null);
    await expect(scope.assertStudentSummaryAccessible(teacher, studentId)).rejects.toThrow('无权限访问该学生');
    await expect(scope.assertStudentSummaryAccessible({ ...teacher, userType: 'STUDENT' }, studentId))
      .rejects.toThrow('无权限访问该学生');
  });

  it('keeps administrators unrestricted without student lookup side channels', async () => {
    const { prisma, scope } = service(null, null);
    await expect(scope.assertStudentSummaryAccessible({ ...teacher, userType: 'ADMIN' }, studentId))
      .resolves.toBeUndefined();
    expect(prisma.classStudent.findFirst).not.toHaveBeenCalled();
  });
});
