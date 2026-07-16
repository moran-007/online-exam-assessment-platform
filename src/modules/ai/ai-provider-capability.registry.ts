import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ResolvedProviderCapability = {
  provider: string;
  modelPattern: string;
  supportsJsonObject: boolean;
  supportsJsonSchema: boolean;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  source: 'registry' | 'conservative-default';
};

export function matchesModelPattern(pattern: string, model: string) {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${expression}$`, 'i').test(model);
}

@Injectable()
export class AiProviderCapabilityRegistry {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(provider: string, model: string): Promise<ResolvedProviderCapability> {
    const normalizedProvider = provider.trim().toLowerCase();
    const rows = await this.prisma.aiProviderCapability.findMany({
      where: { provider: { in: [normalizedProvider, '*'] }, enabled: true },
    });
    const matched = rows
      .filter((row) => matchesModelPattern(row.modelPattern, model))
      .sort((left, right) => {
        const providerPriority = Number(right.provider === normalizedProvider) - Number(left.provider === normalizedProvider);
        return providerPriority || right.modelPattern.length - left.modelPattern.length;
      })[0];
    if (!matched) return this.conservativeDefault(normalizedProvider);
    return {
      provider: matched.provider,
      modelPattern: matched.modelPattern,
      supportsJsonObject: matched.supportsJsonObject,
      supportsJsonSchema: matched.supportsJsonSchema,
      supportsStreaming: matched.supportsStreaming,
      supportsThinking: matched.supportsThinking,
      maxContextTokens: matched.maxContextTokens,
      maxOutputTokens: matched.maxOutputTokens,
      source: 'registry',
    };
  }

  private conservativeDefault(provider: string): ResolvedProviderCapability {
    return {
      provider,
      modelPattern: '*',
      supportsJsonObject: false,
      supportsJsonSchema: false,
      supportsStreaming: false,
      supportsThinking: false,
      maxContextTokens: null,
      maxOutputTokens: null,
      source: 'conservative-default',
    };
  }
}
