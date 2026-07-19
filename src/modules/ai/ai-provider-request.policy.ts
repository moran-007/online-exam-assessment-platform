import type { AiThinkingMode } from './ai-provider.gateway';

export type AiProviderRequestPolicy = {
  thinking?: AiThinkingMode;
  enableThinking?: boolean;
};

export function providerRequestPolicyFor(
  provider: string,
  baseUrl: string,
  model: string,
): AiProviderRequestPolicy {
  return {
    thinking: thinkingModeFor(provider),
    enableThinking: enableThinkingFor(provider, baseUrl, model),
  };
}

export function thinkingModeFor(provider: string): AiThinkingMode | undefined {
  return provider.trim().toLowerCase() === 'deepseek' ? 'disabled' : undefined;
}

export function enableThinkingFor(provider: string, baseUrl: string, model: string) {
  const normalizedProvider = provider.trim().toLowerCase();
  const qwenProvider = /(^|[-_])(qwen|dashscope|alibaba|aliyun)([-_]|$)/.test(normalizedProvider);
  if (qwenProvider) return false;
  return isAliyunHost(baseUrl) && model.trim().toLowerCase().includes('qwen') ? false : undefined;
}

function isAliyunHost(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === 'aliyuncs.com' || hostname.endsWith('.aliyuncs.com');
  } catch {
    return false;
  }
}
