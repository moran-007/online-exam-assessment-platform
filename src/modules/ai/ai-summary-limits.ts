export const MIN_EXAM_SUMMARY_OUTPUT_TOKENS = 100;
export const MIN_STUDENT_SUMMARY_OUTPUT_TOKENS = 100;
export const MIN_AI_OUTPUT_TOKENS = 1;
export const MAX_AI_OUTPUT_TOKENS = 8192;
export const MAX_EXAM_SUMMARY_OUTPUT_TOKENS = MAX_AI_OUTPUT_TOKENS;

export type OutputTokenPolicy = {
  requestLimit: number | null;
  reservationLimit: number;
};

export function resolveOutputTokenLimit(
  requestedTokens: number | null | undefined,
  configurationLimit: number | null | undefined,
  minimum = MIN_AI_OUTPUT_TOKENS,
) {
  const configured = normalizeLimit(configurationLimit, minimum);
  const requested = normalizeLimit(requestedTokens, minimum);
  if (requested === null) return configured;
  return configured === null ? requested : Math.min(requested, configured);
}

export function resolveOutputTokenPolicy(
  requestedTokens: number | null | undefined,
  configurationLimit: number | null | undefined,
  capabilityLimit: number | null | undefined,
  minimum = MIN_AI_OUTPUT_TOKENS,
): OutputTokenPolicy {
  const explicitLimit = resolveOutputTokenLimit(requestedTokens, configurationLimit, minimum);
  const providerLimit = normalizeLimit(capabilityLimit, MIN_AI_OUTPUT_TOKENS);
  const requestLimit = explicitLimit === null
    ? null
    : Math.min(explicitLimit, providerLimit ?? MAX_AI_OUTPUT_TOKENS);
  return {
    requestLimit,
    reservationLimit: requestLimit ?? providerLimit ?? MAX_AI_OUTPUT_TOKENS,
  };
}

function normalizeLimit(value: number | null | undefined, minimum: number) {
  if (value === null || value === undefined) return null;
  return Math.min(Math.max(Math.trunc(value), minimum), MAX_AI_OUTPUT_TOKENS);
}
