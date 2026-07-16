import type { StudentSummaryDataset } from './datasets/summary-dataset';
import { STUDENT_SUMMARY_OUTPUT_SCHEMA_VERSION } from './schemas/summary-output.schema';

const STUDENT_SUMMARY_JSON_SHAPE = JSON.stringify({
  schemaVersion: STUDENT_SUMMARY_OUTPUT_SCHEMA_VERSION,
  headline: { text: '<核心结论>', evidenceRefs: ['<refId>'] },
  overview: [{ text: '<学习表现事实>', evidenceRefs: ['<refId>'] }],
  strengths: [{ text: '<优势事实>', evidenceRefs: ['<refId>'] }],
  risks: [{ text: '<需关注事实>', evidenceRefs: ['<refId>'] }],
  actions: [{ text: '<学习或教学行动>', evidenceRefs: ['<refId>'] }],
  needsReview: [{ text: '<需人工确认事项>', evidenceRefs: ['<refId>'] }],
});

export function buildStudentSummaryUserPrompt(dataset: StudentSummaryDataset) {
  return [
    '请根据下面的学生学习统计数据生成学生总结。',
    '只返回一个 JSON 对象，不要使用 Markdown 或代码围栏。',
    `必须原样保留 schemaVersion="${STUDENT_SUMMARY_OUTPUT_SCHEMA_VERSION}"，并且只使用以下七个顶层字段：schemaVersion、headline、overview、strengths、risks、actions、needsReview。`,
    'headline 是单个结论对象，其余五项是结论对象数组；每个结论对象必须同时包含 text 和 evidenceRefs。',
    '所有 <refId> 都必须替换为 evidenceIndex 中真实存在的 refId；没有可靠结论时返回空数组，不得编造。',
    '必须说明数据覆盖范围；not_submitted 与 ungraded 不是零分，不得把无教育数据解释为缺勤、课堂表现或学习态度问题。',
    '只分析已评分数据。不得推断家庭情况、心理状态、人格、健康、纪律或其他未提供事实。',
    '保持精炼：overview/strengths/risks 各不超过 2 条，actions 不超过 3 条，needsReview 不超过 2 条。',
    `结构示例：${STUDENT_SUMMARY_JSON_SHAPE}`,
    '学生学习统计数据：',
    JSON.stringify(dataset),
  ].join('\n');
}
