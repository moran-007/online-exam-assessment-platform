export const MIN_EXAM_SUMMARY_OUTPUT_TOKENS = 100;
export const MIN_AI_OUTPUT_TOKENS = 1;
export const MAX_AI_OUTPUT_TOKENS = 8192;
export const MAX_EXAM_SUMMARY_OUTPUT_TOKENS = MAX_AI_OUTPUT_TOKENS;

export function resolveOutputTokenLimit(
  requestedTokens: number | undefined,
  configurationLimit: number,
  minimum = MIN_AI_OUTPUT_TOKENS,
) {
  const configured = Math.min(Math.max(Math.trunc(configurationLimit), minimum), MAX_AI_OUTPUT_TOKENS);
  if (requestedTokens === undefined) return configured;
  return Math.min(Math.max(Math.trunc(requestedTokens), minimum), configured);
}
