import type { Prisma } from '@prisma/client';
import type { ResolvedProviderCapability } from './ai-provider-capability.registry';
import type { AiResponseFormat } from './ai-provider.gateway';

export class SummaryParseError extends Error {
  constructor() {
    super('AI 返回内容不是有效的 JSON');
    this.name = 'SummaryParseError';
  }
}

export function parseSummaryJson(content: string, schemaVersion: string): unknown {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !('schemaVersion' in parsed)) {
      return { schemaVersion, ...parsed };
    }
    return parsed;
  } catch {
    throw new SummaryParseError();
  }
}

export function responseFormatFor(
  capability: ResolvedProviderCapability,
  schema: Prisma.JsonValue,
  schemaName: string,
): AiResponseFormat | undefined {
  if (capability.supportsJsonSchema) {
    return {
      type: 'json_schema',
      json_schema: { name: schemaName, strict: true, schema },
    };
  }
  return capability.supportsJsonObject ? { type: 'json_object' } : undefined;
}
