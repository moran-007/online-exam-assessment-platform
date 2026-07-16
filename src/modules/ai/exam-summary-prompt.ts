import type { Prisma } from '@prisma/client';
import type { ResolvedProviderCapability } from './ai-provider-capability.registry';
import type { AiResponseFormat } from './ai-provider.gateway';
import type { ExamSummaryDataset } from './datasets/summary-dataset';
import { EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION } from './schemas/summary-output.schema';

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
    '所有 <refId> 都必须替换为 evidenceIndex 中真实存在的 refId；没有可靠结论时返回空数组，不得编造。',
    '保持精炼：overview/strengths/risks 各不超过 2 条，actions 不超过 3 条，needsReview 不超过 2 条。',
    `结构示例：${EXAM_SUMMARY_JSON_SHAPE}`,
    '考试统计数据：',
    JSON.stringify(dataset),
  ].join('\n');
}

export function responseFormatFor(
  capability: ResolvedProviderCapability,
  schema: Prisma.JsonValue,
): AiResponseFormat | undefined {
  if (capability.supportsJsonSchema) {
    return {
      type: 'json_schema',
      json_schema: { name: 'exam_summary', strict: true, schema },
    };
  }
  return capability.supportsJsonObject ? { type: 'json_object' } : undefined;
}

export class ExamSummaryParseError extends Error {
  constructor() {
    super('AI 返回内容不是有效的 JSON');
    this.name = 'ExamSummaryParseError';
  }
}

export function parseSummaryJson(content: string): unknown {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !('schemaVersion' in parsed)) {
      return { schemaVersion: EXAM_SUMMARY_OUTPUT_SCHEMA_VERSION, ...parsed };
    }
    return parsed;
  } catch {
    throw new ExamSummaryParseError();
  }
}
