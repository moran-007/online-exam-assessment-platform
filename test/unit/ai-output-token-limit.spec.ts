import {
  MAX_AI_OUTPUT_TOKENS,
  MIN_EXAM_SUMMARY_OUTPUT_TOKENS,
  resolveOutputTokenLimit,
  resolveOutputTokenPolicy,
} from '../../src/modules/ai/ai-summary-limits';

describe('AI output token limit policy', () => {
  it('uses an explicit model configuration ceiling when the per-request value is empty', () => {
    expect(resolveOutputTokenLimit(undefined, 1600)).toBe(1600);
    expect(resolveOutputTokenLimit(undefined, 1600, MIN_EXAM_SUMMARY_OUTPUT_TOKENS)).toBe(1600);
  });

  it('does not create a hidden request limit when both values are empty', () => {
    expect(resolveOutputTokenLimit(undefined, null)).toBeNull();
    expect(resolveOutputTokenPolicy(undefined, null, null)).toEqual({
      requestLimit: null,
      reservationLimit: MAX_AI_OUTPUT_TOKENS,
    });
  });

  it('allows an explicit lower request without exceeding the configuration ceiling', () => {
    expect(resolveOutputTokenLimit(700, 1600)).toBe(700);
    expect(resolveOutputTokenLimit(3000, 1600)).toBe(1600);
  });

  it('keeps configuration and request values inside the shared platform range', () => {
    expect(resolveOutputTokenLimit(undefined, 20_000)).toBe(MAX_AI_OUTPUT_TOKENS);
    expect(resolveOutputTokenLimit(10, 1600, MIN_EXAM_SUMMARY_OUTPUT_TOKENS))
      .toBe(MIN_EXAM_SUMMARY_OUTPUT_TOKENS);
  });

  it('uses provider capability only for a visible failure reservation when no limit is explicit', () => {
    expect(resolveOutputTokenPolicy(undefined, null, 4096)).toEqual({
      requestLimit: null,
      reservationLimit: 4096,
    });
  });
});
