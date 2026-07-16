import { thinkingModeFor } from '../../src/modules/ai/ai-provider-request.policy';

describe('AI provider request policy', () => {
  it('disables default DeepSeek thinking for bounded teaching summaries', () => {
    expect(thinkingModeFor('deepseek')).toBe('disabled');
    expect(thinkingModeFor(' DeepSeek ')).toBe('disabled');
  });

  it('does not send provider-specific parameters to other compatible APIs', () => {
    expect(thinkingModeFor('qwen')).toBeUndefined();
    expect(thinkingModeFor('openrouter')).toBeUndefined();
  });
});
