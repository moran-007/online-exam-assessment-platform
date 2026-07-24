export const LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES = {
  EMPTY_STAGES: 'EMPTY_STAGES',
  INVALID_TOTAL_MINUTES: 'INVALID_TOTAL_MINUTES',
  INVALID_WEIGHT: 'INVALID_WEIGHT',
  TOTAL_MINUTES_TOO_SMALL: 'TOTAL_MINUTES_TOO_SMALL',
} as const;

export type LessonPlanTimeAllocationErrorCode =
  typeof LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES[
    keyof typeof LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES
  ];

export type LessonPlanTimeAllocationResult =
  | {
      ok: true;
      durations: number[];
    }
  | {
      ok: false;
      code: LessonPlanTimeAllocationErrorCode;
      message: string;
    };

/**
 * Uses Hamilton's largest-remainder method while enforcing a one-minute lower
 * bound for every stage. Ties are resolved by the original stage order so the
 * same input always produces the same output.
 */
export function allocateLessonPlanStageDurations(
  totalMinutes: number,
  weights: readonly number[],
): LessonPlanTimeAllocationResult {
  if (!Number.isInteger(totalMinutes) || totalMinutes <= 0) {
    return failure(
      LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES.INVALID_TOTAL_MINUTES,
      '总课时必须为正整数。',
    );
  }

  if (weights.length === 0) {
    return failure(
      LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES.EMPTY_STAGES,
      '至少需要一个教学环节。',
    );
  }

  if (totalMinutes < weights.length) {
    return failure(
      LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES.TOTAL_MINUTES_TOO_SMALL,
      `总课时至少需要 ${weights.length} 分钟，才能保证每个环节均为正整数时长。`,
    );
  }

  const invalidWeightIndex = weights.findIndex(
    (weight) => !Number.isFinite(weight) || weight <= 0,
  );
  if (invalidWeightIndex >= 0) {
    return failure(
      LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES.INVALID_WEIGHT,
      `第 ${invalidWeightIndex + 1} 个环节的分配权重必须为正数。`,
    );
  }

  const durations = Array<number>(weights.length).fill(0);
  let remainingMinutes = totalMinutes;
  let activeIndexes = weights.map((_, index) => index);

  // Fix stages whose proportional quota is below the required one-minute
  // minimum, then recalculate quotas for the remaining stages.
  while (activeIndexes.length > 0) {
    const activeWeightTotal = activeIndexes.reduce(
      (sum, index) => sum + weights[index],
      0,
    );
    const belowMinimum = activeIndexes.filter(
      (index) => (remainingMinutes * weights[index]) / activeWeightTotal < 1,
    );

    if (belowMinimum.length === 0) {
      break;
    }

    const belowMinimumSet = new Set(belowMinimum);
    for (const index of belowMinimum) {
      durations[index] = 1;
      remainingMinutes -= 1;
    }
    activeIndexes = activeIndexes.filter((index) => !belowMinimumSet.has(index));
  }

  if (activeIndexes.length === 0) {
    return { ok: true, durations };
  }

  const activeWeightTotal = activeIndexes.reduce(
    (sum, index) => sum + weights[index],
    0,
  );
  const quotas = activeIndexes.map((index) => {
    const exact = (remainingMinutes * weights[index]) / activeWeightTotal;
    const floor = Math.floor(exact);
    durations[index] = floor;
    return {
      index,
      remainder: exact - floor,
    };
  });

  const allocatedMinutes = durations.reduce((sum, duration) => sum + duration, 0);
  const undistributedMinutes = totalMinutes - allocatedMinutes;
  quotas.sort(
    (left, right) =>
      right.remainder - left.remainder || left.index - right.index,
  );

  for (let offset = 0; offset < undistributedMinutes; offset += 1) {
    durations[quotas[offset].index] += 1;
  }

  return { ok: true, durations };
}

/**
 * Normalizes durations returned by AI to the requested lesson length.
 * Positive numeric values are used as weights; missing, invalid, zero, or
 * negative values fall back to an equal weight of one.
 */
export function normalizeAiLessonPlanDurations(
  totalMinutes: number,
  aiDurations: readonly unknown[],
): LessonPlanTimeAllocationResult {
  const weights = aiDurations.map((duration) => {
    const numericDuration =
      typeof duration === 'number'
        ? duration
        : typeof duration === 'string' && duration.trim()
          ? Number(duration)
          : Number.NaN;
    return Number.isFinite(numericDuration) && numericDuration > 0
      ? numericDuration
      : 1;
  });

  return allocateLessonPlanStageDurations(totalMinutes, weights);
}

function failure(
  code: LessonPlanTimeAllocationErrorCode,
  message: string,
): LessonPlanTimeAllocationResult {
  return {
    ok: false,
    code,
    message,
  };
}
