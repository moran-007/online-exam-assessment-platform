import {
  enableThinkingFor,
  providerRequestPolicyFor,
  thinkingModeFor,
} from '../../src/modules/ai/ai-provider-request.policy';

describe('AI provider request policy', () => {
  it('disables default DeepSeek thinking for bounded teaching summaries', () => {
    expect(thinkingModeFor('deepseek')).toBe('disabled');
    expect(thinkingModeFor(' DeepSeek ')).toBe('disabled');
  });

  it('uses the Qwen-compatible top-level switch without a thinking object', () => {
    expect(providerRequestPolicyFor(
      'qwen',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'qwen3.7-plus',
    )).toEqual({ thinking: undefined, enableThinking: false });
    expect(enableThinkingFor(
      'custom',
      'https://example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      'qwen3.7-plus',
    )).toBe(false);
  });

  it('does not send Qwen parameters to unrelated compatible APIs', () => {
    expect(thinkingModeFor('openrouter')).toBeUndefined();
    expect(enableThinkingFor('openrouter', 'https://openrouter.ai/api/v1', 'other-model')).toBeUndefined();
  });
});
