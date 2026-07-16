import type { AiThinkingMode } from './ai-provider.gateway';

export function thinkingModeFor(provider: string): AiThinkingMode | undefined {
  return provider.trim().toLowerCase() === 'deepseek' ? 'disabled' : undefined;
}
