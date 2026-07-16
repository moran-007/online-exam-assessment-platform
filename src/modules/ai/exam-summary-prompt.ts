import type { Prisma } from '@prisma/client';
import type { ResolvedProviderCapability } from './ai-provider-capability.registry';
import type { AiResponseFormat } from './ai-provider.gateway';
import type { ExamSummaryDataset } from './datasets/summary-dataset';

export function buildExamSummaryUserPrompt(dataset: ExamSummaryDataset) {
  return [
    '请根据下面的考试统计数据生成考试总结。',
    '只返回一个 JSON 对象；所有结论均须引用 evidenceIndex 中存在的 refId。',
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
    return JSON.parse(content) as unknown;
  } catch {
    throw new ExamSummaryParseError();
  }
}
