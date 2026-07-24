import type {
  ClassSummaryDataset,
  LessonAssistantDataset,
  ParentReportDataset,
} from './datasets/summary-dataset';
import {
  CLASS_SUMMARY_OUTPUT_SCHEMA_VERSION,
  LESSON_ASSISTANT_OUTPUT_SCHEMA_VERSION,
  PARENT_REPORT_OUTPUT_SCHEMA_VERSION,
} from './schemas/summary-output.schema';
import { summaryPromptFacts } from './summary-prompt';

function shape(schemaVersion: string) {
  return JSON.stringify({
    schemaVersion,
    headline: { text: '<核心结论>', evidenceRefs: ['<refId>'] },
    overview: [{ text: '<事实概览>', evidenceRefs: ['<refId>'] }],
    strengths: [{ text: '<优势>', evidenceRefs: ['<refId>'] }],
    risks: [{ text: '<需关注项>', evidenceRefs: ['<refId>'] }],
    actions: [{ text: '<行动建议>', evidenceRefs: ['<refId>'] }],
    needsReview: [{ text: '<需人工确认事项>', evidenceRefs: ['<refId>'] }],
  });
}

function commonRules(schemaVersion: string) {
  return [
    '只返回一个 JSON 对象，不要使用 Markdown 或代码围栏。',
    `必须原样保留 schemaVersion="${schemaVersion}"，且只使用 schemaVersion、headline、overview、strengths、risks、actions、needsReview 七个顶层字段。`,
    'headline 是单个对象，其余字段是对象数组；每个对象必须包含 text 和 evidenceRefs。',
    '每个 evidenceRefs 必须引用数据中 evidenceRef 字段给出的真实 refId；无证据则不输出该结论。',
    `结构示例：${shape(schemaVersion)}`,
  ];
}

export function buildClassSummaryUserPrompt(dataset: ClassSummaryDataset) {
  return [
    '请根据班级聚合数据生成班级总结和下一周期教学建议。',
    ...commonRules(CLASS_SUMMARY_OUTPUT_SCHEMA_VERSION),
    '只能分析班级聚合指标，不得要求、猜测或输出学生姓名、学生 ID、单个学生成绩或作答。',
    '未评分成绩不是零分；考勤状态不能用于推断学习态度、人格、家庭或心理情况。',
    `本次只总结这些内容：${classDomainLabels(dataset.scope.summaryDomains)}；未选择的类别不得分析或提及。`,
    'overview/strengths/risks 各不超过 3 条，actions 不超过 4 条。',
    '班级聚合数据：',
    JSON.stringify(classPromptFacts(dataset)),
  ].join('\n');
}

function classPromptFacts(dataset: ClassSummaryDataset): Record<string, unknown> {
  const facts = summaryPromptFacts(dataset) as ClassSummaryDataset & Record<string, unknown>;
  const result = { ...facts, coverage: { ...facts.coverage }, lessons: { ...facts.lessons } } as Record<string, any>;
  const domains = new Set(dataset.scope.summaryDomains);
  if (!domains.has('exams')) {
    delete result.assessment;
    delete result.coverage.examCount;
    delete result.coverage.gradedAttemptCount;
  }
  if (!domains.has('lessons')) {
    delete result.attendance;
    delete result.coverage.lessonCount;
    delete result.coverage.publishedLessonRecordCount;
    delete result.lessons.completedCount;
    delete result.lessons.completedHours;
    delete result.lessons.publishedRecordCount;
  }
  if (!domains.has('homework')) {
    delete result.coverage.homeworkAssignmentCount;
    delete result.lessons.homeworkAssignmentCount;
  }
  if (!Object.keys(result.lessons).length) delete result.lessons;
  return result;
}

function classDomainLabels(domains: ClassSummaryDataset['scope']['summaryDomains']) {
  const labels = { lessons: '上课', exams: '考试', homework: '作业' };
  return domains.map((item) => labels[item]).join('、');
}

export function buildParentReportUserPrompt(dataset: ParentReportDataset) {
  const domains = dataset.scope.summaryDomains;
  return [
    '请根据家长可见的已确认或已发布数据生成家长报告草稿。',
    ...commonRules(PARENT_REPORT_OUTPUT_SCHEMA_VERSION),
    '使用中性、清晰、不贴标签的语言，不得诊断或评价人格、态度、家庭、心理、健康和纪律。',
    'scoreVisible=false 的成绩不可描述或推断；作业字段表示教师布置内容，不代表学生已完成。',
    `本次只报告这些内容：${parentDomainLabels(domains)}；未选择的类别不得分析或提及。`,
    '不得出现其他学生、教师内部备注或未发布教学内容。',
    '报告必须由教师审核后才能发布；在 needsReview 中列出需要教师核实的表达。',
    '家长可见数据：',
    JSON.stringify(parentPromptFacts(dataset)),
  ].join('\n');
}

function parentPromptFacts(dataset: ParentReportDataset): Record<string, unknown> {
  const facts = summaryPromptFacts(dataset) as ParentReportDataset & Record<string, unknown>;
  const result = { ...facts, coverage: { ...facts.coverage } } as Record<string, any>;
  const domains = new Set(dataset.scope.summaryDomains);
  if (!domains.has('exams')) {
    delete result.exams;
    delete result.coverage.visibleExamCount;
  }
  if (!domains.has('lessons')) {
    delete result.attendance;
    delete result.coverage.publishedLessonRecordCount;
    delete result.coverage.confirmedAttendanceCount;
  }
  if (!domains.has('lessons') && domains.has('homework')) {
    result.homeworkAssignments = facts.publishedLessons
      .filter((lesson) => lesson.homework.value)
      .map((lesson) => ({ sessionId: lesson.sessionId, title: lesson.title, startsAt: lesson.startsAt, homework: lesson.homework }));
    delete result.publishedLessons;
  } else if (domains.has('lessons') && !domains.has('homework')) {
    result.publishedLessons = facts.publishedLessons.map(({ homework: _homework, ...lesson }) => lesson);
  } else if (!domains.has('lessons') && !domains.has('homework')) {
    delete result.publishedLessons;
  }
  return result;
}

function parentDomainLabels(domains: ParentReportDataset['scope']['summaryDomains']) {
  const labels = { lessons: '上课', exams: '考试', homework: '作业' };
  return domains.map((item) => labels[item]).join('、');
}

export function buildLessonAssistantUserPrompt(dataset: LessonAssistantDataset) {
  return [
    '请协助教师整理当前课次记录，并提出作业与下次教学计划草稿。',
    ...commonRules(LESSON_ASSISTANT_OUTPUT_SCHEMA_VERSION),
    'overview 用于措辞清晰的教学内容/课堂记录建议；actions 用于作业和下次计划草稿。',
    '不得添加数据集中不存在的学生姓名、成绩、课堂事件或完成情况。',
    '内部备注只能用于帮助教师起草，不得在建议中暴露敏感描述或给学生贴标签。',
    '所有输出都是教师草稿，绝不能声称已发布、已布置或已通知家长。',
    '当前课次数据：',
    JSON.stringify(summaryPromptFacts(dataset)),
  ].join('\n');
}
