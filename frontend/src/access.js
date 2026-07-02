export const publicMenuItems = [
  { path: '/question-bank', label: '公开题库', icon: 'EditPen' },
];

export const studentMenuItems = [
  { path: '/question-bank', label: '题库', icon: 'EditPen' },
  { path: '/student/papers', label: '试卷题库', icon: 'Document' },
  { path: '/student/exams', label: '我的考试', icon: 'Calendar' },
  { path: '/student/wrong-questions', label: '错题本', icon: 'Notebook' },
  { path: '/student/profile', label: '个人信息', icon: 'User' },
];

export const adminMenuItems = [
  { path: '/dashboard', label: '看板', icon: 'DataBoard', permissions: ['statistics:read'] },
  { path: '/courses', label: '课程', icon: 'Collection', permissions: ['course:read'] },
  { path: '/classes', label: '班级', icon: 'UserFilled', permissions: ['class:read'] },
  { path: '/users', label: '用户权限', icon: 'Setting', userTypes: ['SUPER_ADMIN'] },
  { path: '/knowledge', label: '课程知识点', icon: 'Share', permissions: ['knowledge-point:read'] },
  { path: '/tags', label: '标签', icon: 'PriceTag', permissions: ['tag:read'] },
  { path: '/questions', label: '题库', icon: 'EditPen', permissions: ['question:read'] },
  { path: '/question-import', label: '题目导入', icon: 'Upload', permissions: ['question:create'] },
  { path: '/papers', label: '试卷', icon: 'Document', permissions: ['paper:read'] },
  { path: '/exams', label: '考试', icon: 'Timer', permissions: ['exam:read'] },
  { path: '/grading', label: '批改', icon: 'Checked', permissions: ['grading:read'] },
  { path: '/exports', label: '导出', icon: 'Download', permissions: ['exam:result:export'] },
  { path: '/statistics', label: '统计', icon: 'TrendCharts', permissions: ['statistics:read'] },
  { path: '/external-accounts', label: '外部账号', icon: 'Link', userTypes: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT'] },
  { path: '/profile', label: '个人信息', icon: 'User' },
];

export function isStudent(user) {
  return user?.userType === 'STUDENT';
}

export function isPrivilegedUser(user) {
  return ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT'].includes(user?.userType);
}

export function hasAnyPermission(user, permissions = []) {
  if (!permissions.length) return true;
  if (user?.userType === 'SUPER_ADMIN') return true;
  const granted = new Set(user?.permissions ?? []);
  return permissions.some((permission) => granted.has(permission));
}

export function canAccessByMeta(user, meta = {}) {
  if (meta.public) return true;
  if (!user) return false;
  if (meta.studentOnly) return isStudent(user);
  if (meta.adminOnly && !isPrivilegedUser(user)) return false;
  if (meta.userTypes?.length && !meta.userTypes.includes(user.userType)) return false;
  return hasAnyPermission(user, meta.permissions);
}

export function menuForUser(user) {
  if (!user) return publicMenuItems;
  if (isStudent(user)) return studentMenuItems;
  if (!isPrivilegedUser(user)) return publicMenuItems;
  return adminMenuItems.filter(
    (item) => (!item.userTypes?.length || item.userTypes.includes(user.userType)) && hasAnyPermission(user, item.permissions),
  );
}

export function firstAccessiblePath(user) {
  return menuForUser(user)[0]?.path ?? '/question-bank';
}
