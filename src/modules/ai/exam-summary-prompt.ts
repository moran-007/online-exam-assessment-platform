import type { ExamSummaryDataset } from './datasets/summary-dataset';
import { EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION } from './schemas/summary-output.schema';
import {
  parseSummaryJson as parseStructuredSummaryJson,
  SummaryParseError,
  summaryPromptFacts,
} from './summary-prompt';

const EXAM_SUMMARY_JSON_SHAPE = JSON.stringify({
  schemaVersion: EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION,
  headline: { text: '<核心结论>', evidenceRefs: ['<refId>'] },
  overview: [{ text: '<整体事实>', evidenceRefs: ['<refId>'] }],
  strengths: [{ text: '<优势事实>', evidenceRefs: ['<refId>'] }],
  risks: [{ text: '<风险事实>', evidenceRefs: ['<refId>'] }],
  actions: [{ text: '<教学行动>', evidenceRefs: ['<refId>'] }],
  needsReview: [],
});

export function buildExamSummaryUserPrompt(dataset: ExamSummaryDataset) {
  return [
    '请根据下面的考试统计数据生成考试总结。',
    '只返回一个 JSON 对象，不要使用 Markdown 或代码围栏。',
    `必须原样保留 schemaVersion="${EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION}"，并且只使用以下七个顶层字段：schemaVersion、headline、overview、strengths、risks、actions、needsReview。`,
    'headline 是单个结论对象，其余五项是结论对象数组；每个结论对象必须同时包含 text 和 evidenceRefs。',
    '所有 <refId> 都必须替换为数据中 evidenceRef 字段给出的真实 refId；没有可靠结论时返回空数组，不得编造。',
    '保持精炼：overview/strengths/risks 各不超过 2 条，actions 不超过 3 条，needsReview 不超过 2 条。',
    `结构示例：${EXAM_SUMMARY_JSON_SHAPE}`,
    '考试统计数据：',
    JSON.stringify(summaryPromptFacts(dataset)),
  ].join('\n');
}

export { SummaryParseError as ExamSummaryParseError };

export function parseSummaryJson(content: string): unknown {
  return parseStructuredSummaryJson(content, EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION);
}
