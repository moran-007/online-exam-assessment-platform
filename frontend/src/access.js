const academicReadPermissions = [
  'schedule:read', 'lesson-hour:read', 'lesson-type:read', 'course-unit:read',
];

export const publicMenuItems = [
  { path: '/question-bank', label: '公开题库', icon: 'EditPen', section: 'assessment' },
];

export const studentMenuItems = [
  { path: '/dashboard', label: '学习看板', icon: 'DataBoard', permissions: ['dashboard:read'], section: 'overview' },
  { path: '/question-bank', label: '题库', icon: 'EditPen', section: 'assessment' },
  { path: '/student/papers', label: '试卷题库', icon: 'Document', section: 'assessment' },
  { path: '/student/exams', label: '我的考试', icon: 'Calendar', section: 'assessment' },
  { path: '/student/wrong-questions', label: '错题本', icon: 'Notebook', section: 'assessment' },
  { path: '/student/profile', label: '个人信息', icon: 'User', section: 'account' },
  { path: '/teaching-operations', label: '课表与课时', icon: 'Calendar', permissions: academicReadPermissions, section: 'academics' },
  { path: '/learning-portal', label: '学习门户', icon: 'Reading', section: 'academics' },
];

export const parentMenuItems = [
  { path: '/dashboard', label: '学习看板', icon: 'DataBoard', permissions: ['dashboard:read'], section: 'overview' },
  { path: '/profile', label: '关联学生', icon: 'User', section: 'account' },
  { path: '/teaching-operations', label: '课表与课时', icon: 'Calendar', permissions: academicReadPermissions, section: 'academics' },
  { path: '/learning-portal', label: '学习门户', icon: 'Reading', section: 'academics' },
];

export const adminMenuItems = [
  { path: '/dashboard', label: '融合看板', icon: 'DataBoard', permissions: ['dashboard:read'], section: 'overview' },
  { path: '/courses', label: '课程与知识点', icon: 'Collection', permissions: ['course:read', 'knowledge-point:read'], section: 'academics' },
  { path: '/classes', label: '班级', icon: 'UserFilled', permissions: ['class:read'], section: 'academics' },
  { path: '/users', label: '用户权限', icon: 'Setting', userTypes: ['SUPER_ADMIN'], section: 'platform' },
  { path: '/academic-profiles', label: '教务档案', icon: 'Postcard', userTypes: ['SUPER_ADMIN', 'ADMIN'], section: 'academics' },
  { path: '/ai-settings', label: 'AI 中心', icon: 'Setting', userTypes: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT'], section: 'platform' },
  { path: '/teaching-operations', label: '教学运营', icon: 'Calendar', permissions: academicReadPermissions, section: 'academics' },
  { path: '/tags', label: '标签', icon: 'PriceTag', permissions: ['tag:read'], section: 'assessment' },
  { path: '/questions', label: '题库', icon: 'EditPen', permissions: ['question:read'], section: 'assessment' },
  { path: '/question-import', label: '题目导入', icon: 'Upload', permissions: ['question:create'], section: 'assessment' },
  { path: '/papers', label: '试卷', icon: 'Document', permissions: ['paper:read'], section: 'assessment' },
  { path: '/exams', label: '考试', icon: 'Timer', permissions: ['exam:read'], section: 'assessment' },
  { path: '/grading', label: '批改', icon: 'Checked', permissions: ['grading:score:read', 'grading:read'], section: 'assessment' },
  { path: '/exports', label: '导出', icon: 'Download', permissions: ['export:task:read', 'exam:result:export'], section: 'insights' },
  { path: '/statistics', label: '统计', icon: 'TrendCharts', permissions: ['statistics:read'], section: 'insights' },
  { path: '/external-accounts', label: '外部账号', icon: 'Link', userTypes: ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT'], section: 'platform' },
  { path: '/profile', label: '个人信息', icon: 'User', section: 'platform' },
];

const menuSections = {
  overview: { label: '概览' },
  academics: { label: '教务与学习' },
  assessment: { label: '测评中心' },
  insights: { label: '数据与导出' },
  platform: { label: '平台设置' },
  account: { label: '个人中心' },
};

export function isStudent(user) {
  return user?.userType === 'STUDENT';
}

export function isParent(user) {
  return user?.userType === 'PARENT';
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
  if (isStudent(user)) return accessibleItems(studentMenuItems, user);
  if (isParent(user)) return accessibleItems(parentMenuItems, user);
  if (!isPrivilegedUser(user)) return publicMenuItems;
  return accessibleItems(adminMenuItems, user);
}

function accessibleItems(items, user) {
  return items.filter(
    (item) => (!item.userTypes?.length || item.userTypes.includes(user.userType)) && hasAnyPermission(user, item.permissions),
  );
}

export function menuGroupsForUser(user) {
  const groups = new Map(Object.entries(menuSections).map(([id, section]) => [id, { id, ...section, items: [] }]));
  for (const item of menuForUser(user)) {
    const id = item.section || 'platform';
    groups.get(id).items.push(item);
  }
  return [...groups.values()].filter((group) => group.items.length);
}

export function firstAccessiblePath(user) {
  return menuForUser(user)[0]?.path ?? '/question-bank';
}
