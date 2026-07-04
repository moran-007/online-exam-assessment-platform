import { RequestUser } from '../interfaces/request-user.interface';

const LEGACY_IMPLICATIONS: Record<string, string[]> = {
  'grading:score:read': ['grading:read', 'exam:result:read'],
  'grading:score:update': ['grading:update'],
  'grading:rubric:update': ['grading:update'],
  'grading:regrade:preview': ['grading:update'],
  'grading:regrade:confirm': ['grading:update'],
  'exam:answer:read': ['grading:read', 'exam:result:read'],
  'question:answer:read': ['question:read', 'grading:read'],
  'question:analysis:read': ['question:read', 'grading:read'],
  'student:identity:read': ['user:read', 'grading:read'],
  'export:task:create': ['exam:result:export'],
  'export:task:read': ['exam:result:export'],
  'export:file:download': ['exam:result:export'],
  'attachment:preview': ['question:read', 'question:create'],
  'attachment:download': ['question:read', 'question:create'],
};

export function hasPermission(user: RequestUser | undefined, permission: string) {
  if (!user) return false;
  if (user.userType === 'SUPER_ADMIN') return true;
  const granted = new Set(user.permissions ?? []);
  return granted.has(permission) || (LEGACY_IMPLICATIONS[permission] ?? []).some((legacy) => granted.has(legacy));
}

export function fieldAccess(user: RequestUser) {
  return {
    score: hasPermission(user, 'grading:score:read'),
    studentAnswer: hasPermission(user, 'exam:answer:read'),
    referenceAnswer: hasPermission(user, 'question:answer:read'),
    analysis: hasPermission(user, 'question:analysis:read'),
    studentIdentity: hasPermission(user, 'student:identity:read'),
  };
}
