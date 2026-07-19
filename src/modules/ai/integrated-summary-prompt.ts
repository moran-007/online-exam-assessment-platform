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
    '每个 evidenceRefs 必须引用 evidenceIndex 中真实存在的 refId；无证据则不输出该结论。',
    `结构示例：${shape(schemaVersion)}`,
  ];
}

export function buildClassSummaryUserPrompt(dataset: ClassSummaryDataset) {
  return [
    '请根据班级聚合数据生成班级总结和下一周期教学建议。',
    ...commonRules(CLASS_SUMMARY_OUTPUT_SCHEMA_VERSION),
    '只能分析班级聚合指标，不得要求、猜测或输出学生姓名、学生 ID、单个学生成绩或作答。',
    '未评分成绩不是零分；考勤状态不能用于推断学习态度、人格、家庭或心理情况。',
    'overview/strengths/risks 各不超过 3 条，actions 不超过 4 条。',
    '班级聚合数据：',
    JSON.stringify(dataset),
  ].join('\n');
}

export function buildParentReportUserPrompt(dataset: ParentReportDataset) {
  return [
    '请根据家长可见的已确认或已发布数据生成家长报告草稿。',
    ...commonRules(PARENT_REPORT_OUTPUT_SCHEMA_VERSION),
    '使用中性、清晰、不贴标签的语言，不得诊断或评价人格、态度、家庭、心理、健康和纪律。',
    'scoreVisible=false 的成绩不可描述或推断；作业字段表示教师布置内容，不代表学生已完成。',
    '不得出现其他学生、教师内部备注或未发布教学内容。',
    '报告必须由教师审核后才能发布；在 needsReview 中列出需要教师核实的表达。',
    '家长可见数据：',
    JSON.stringify(dataset),
  ].join('\n');
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
    JSON.stringify(dataset),
  ].join('\n');
}
