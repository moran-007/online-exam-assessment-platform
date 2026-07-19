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
    '必须说明数据覆盖范围；not_submitted 与 ungraded 不是零分；不得把无教育数据解释为缺勤，未确认考勤也不是缺勤。',
    '考试结论只分析已评分数据；课堂目标、课堂表现和作业只使用已发布教学记录。',
    'homework 表示教师已布置内容，不代表学生已经完成，不得推断作业完成率。',
    'Scratch 只能总结作品版本、提交/判定状态和教师已经写入的评分点评；不得读取作品内容推断能力，也不得把外部运行时账号当作学生身份事实。',
    '不得从迟到、请假或缺席推断学习态度、家庭情况、心理状态、人格、健康或纪律。',
    '不得推断家庭情况、心理状态、人格、健康、纪律等未提供事实。',
    dataset.generationMode === 'fact_card'
      ? '当前 generationMode=fact_card：数据量不足，只输出中性事实卡；strengths、risks 和推断性 actions 应为空，需补数据时写入 needsReview。'
      : '当前 generationMode=analysis：可以基于多个相互支持的 EvidenceRef 总结优势、风险和行动建议。',
    '保持精炼：overview/strengths/risks 各不超过 2 条，actions 不超过 3 条，needsReview 不超过 2 条。',
    `结构示例：${STUDENT_SUMMARY_JSON_SHAPE}`,
    '学生学习统计数据：',
    JSON.stringify(dataset),
  ].join('\n');
}
