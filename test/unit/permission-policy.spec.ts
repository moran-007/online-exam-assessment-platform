import { fieldAccess, hasPermission } from '../../src/common/security/permission-policy';
import { RequestUser } from '../../src/common/interfaces/request-user.interface';

const user = (permissions: string[], userType = 'TEACHER'): RequestUser => ({
  id: 'user-1', username: 'u', realName: null, roles: [], userType, permissions,
});

describe('permission policy', () => {
  it('keeps legacy aggregate permissions compatible with fine-grained checks', () => {
    expect(hasPermission(user(['grading:update']), 'grading:regrade:confirm')).toBe(true);
    expect(hasPermission(user(['question:read']), 'attachment:preview')).toBe(true);
    expect(hasPermission(user(['exam:result:export']), 'export:file:download')).toBe(true);
  });

  it('does not let an unrelated fine permission reveal other fields', () => {
    expect(fieldAccess(user(['grading:score:read']))).toEqual({
      score: true,
      studentAnswer: false,
      referenceAnswer: false,
      analysis: false,
      studentIdentity: false,
    });
  });

  it('lets super administrators pass every operation', () => {
    expect(hasPermission(user([], 'SUPER_ADMIN'), 'export:file:download')).toBe(true);
  });

  it('rejects anonymous, missing, and unrelated permissions', () => {
    expect(hasPermission(undefined, 'question:read')).toBe(false);
    expect(hasPermission(user([]), 'question:read')).toBe(false);
    expect(hasPermission(user(['question:create']), 'attachment:download')).toBe(true);
  });

  it('computes all protected field decisions independently', () => {
    expect(fieldAccess(user([
      'grading:score:read',
      'exam:answer:read',
      'question:answer:read',
      'question:analysis:read',
      'student:identity:read',
    ]))).toEqual({
      score: true,
      studentAnswer: true,
      referenceAnswer: true,
      analysis: true,
      studentIdentity: true,
    });
  });
});
