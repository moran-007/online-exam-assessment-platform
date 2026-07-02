export const paperStatusOptions = [
  {
    label: '草稿',
    value: 'draft',
    type: 'warning',
    description: '未公开，仅用于维护试卷内容、题序、分值和随机设置。',
  },
  {
    label: '已公开',
    value: 'published',
    type: 'success',
    description: '可创建考试；未被考试占用时可进入学生试卷题库，内容默认锁定。',
  },
  {
    label: '已归档',
    value: 'archived',
    type: 'info',
    description: '从常用维护流程中收起，不建议继续创建考试；需要调整时可恢复为草稿。',
  },
];

export const examStatusOptions = [
  {
    label: '草稿',
    value: 'draft',
    type: 'info',
    description: '尚未发布给学生，可编辑试卷、时间、班级、公告和结果开放设置。',
  },
  {
    label: '已安排',
    value: 'scheduled',
    type: 'primary',
    description: '已发布并等待开始，学生可在列表中看到，到开始时间后可进入。',
  },
  {
    label: '进行中',
    value: 'running',
    type: 'success',
    description: '学生可进入或继续作答，核心配置锁定，仅建议结束考试或做状态修正。',
  },
  {
    label: '已结束',
    value: 'ended',
    type: 'info',
    description: '考试不可继续作答，可查看成绩、排名、统计和导出结果。',
  },
  {
    label: '已归档',
    value: 'archived',
    type: 'info',
    description: '历史考试状态，通常不再参与日常安排和学生作答。',
  },
];

export const attemptStatusOptions = [
  { label: '未开始', value: 'not_started', type: 'info' },
  { label: '作答中', value: 'in_progress', type: 'warning' },
  { label: '已提交', value: 'submitted', type: 'success' },
  { label: '批改中', value: 'grading', type: 'warning' },
  { label: '已批改', value: 'graded', type: 'success' },
  { label: '已取消', value: 'cancelled', type: 'info' },
  { label: '超时提交', value: 'timeout_submitted', type: 'danger' },
];

const statusGroups = {
  paper: paperStatusOptions,
  exam: examStatusOptions,
  attempt: attemptStatusOptions,
};

const paperTransitions = {
  draft: ['published', 'archived'],
  published: ['draft', 'archived'],
  archived: ['draft'],
};

const examTransitions = {
  draft: ['scheduled', 'running', 'archived'],
  scheduled: ['draft', 'running', 'ended', 'archived'],
  running: ['ended'],
  ended: ['archived'],
  archived: ['draft'],
};

export function statusMeta(group, value) {
  const normalized = normalizeStatus(value);
  return statusGroups[group]?.find((item) => item.value === normalized) ?? {
    label: value || '-',
    value,
    type: 'info',
    description: '',
  };
}

export function statusLabel(group, value) {
  return statusMeta(group, value).label;
}

export function statusTagType(group, value) {
  return statusMeta(group, value).type;
}

export function statusDescription(group, value) {
  return statusMeta(group, value).description;
}

export function statusTransitionOptions(group, value) {
  const normalized = normalizeStatus(value);
  const transitions = group === 'paper' ? paperTransitions : group === 'exam' ? examTransitions : {};
  return (transitions[normalized] ?? [])
    .map((nextValue) => statusMeta(group, nextValue))
    .filter((item) => item.value !== normalized);
}

export function normalizeStatus(value) {
  return String(value ?? '').trim().replace(/-/g, '_').toLowerCase();
}
