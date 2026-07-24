import {
  allocateLessonPlanStageDurations,
  LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES,
  normalizeAiLessonPlanDurations,
} from '../../frontend/src/features/lesson-records/composables/lessonPlanTimeAllocation';

describe('lesson plan time allocation', () => {
  it('preserves current durations when they already add up to the total', () => {
    expect(allocateLessonPlanStageDurations(45, [5, 30, 10])).toEqual({
      ok: true,
      durations: [5, 30, 10],
    });
  });

  it('uses the largest remainder and resolves equal remainders by stage order', () => {
    expect(allocateLessonPlanStageDurations(10, [1, 2, 1])).toEqual({
      ok: true,
      durations: [3, 5, 2],
    });
    expect(allocateLessonPlanStageDurations(5, [1, 1, 1])).toEqual({
      ok: true,
      durations: [2, 2, 1],
    });
  });

  it('enforces a positive duration without distorting other feasible quotas', () => {
    expect(allocateLessonPlanStageDurations(4, [100, 1, 1])).toEqual({
      ok: true,
      durations: [2, 1, 1],
    });
  });

  it('returns the same allocation for repeated calls', () => {
    const allocations = Array.from({ length: 20 }, () =>
      allocateLessonPlanStageDurations(17, [3, 4, 5, 6]),
    );

    expect(new Set(allocations.map((result) => JSON.stringify(result))).size).toBe(1);
  });

  it('returns an identifiable error when the total cannot give every stage one minute', () => {
    expect(allocateLessonPlanStageDurations(2, [1, 1, 1])).toMatchObject({
      ok: false,
      code: LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES.TOTAL_MINUTES_TOO_SMALL,
    });
  });

  it.each([
    {
      totalMinutes: 0,
      weights: [1],
      code: LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES.INVALID_TOTAL_MINUTES,
    },
    {
      totalMinutes: 45,
      weights: [],
      code: LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES.EMPTY_STAGES,
    },
    {
      totalMinutes: 45,
      weights: [1, Number.NaN],
      code: LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES.INVALID_WEIGHT,
    },
    {
      totalMinutes: 45,
      weights: [1, 0],
      code: LESSON_PLAN_TIME_ALLOCATION_ERROR_CODES.INVALID_WEIGHT,
    },
  ])('validates invalid allocation input', ({ totalMinutes, weights, code }) => {
    expect(allocateLessonPlanStageDurations(totalMinutes, weights)).toMatchObject({
      ok: false,
      code,
    });
  });

  it('normalizes AI durations to positive integers with an exact total', () => {
    const result = normalizeAiLessonPlanDurations(7, [2, 1, 1]);

    expect(result).toEqual({
      ok: true,
      durations: [3, 2, 2],
    });
    if (result.ok) {
      expect(result.durations.every(Number.isInteger)).toBe(true);
      expect(result.durations.every((duration) => duration > 0)).toBe(true);
      expect(result.durations.reduce((sum, duration) => sum + duration, 0)).toBe(7);
    }
  });

  it('uses equal fallback weights for invalid AI duration values', () => {
    expect(normalizeAiLessonPlanDurations(5, [0, Number.NaN, -5])).toEqual({
      ok: true,
      durations: [2, 2, 1],
    });
  });

  it('accepts numeric duration strings returned by a loosely typed AI provider', () => {
    expect(normalizeAiLessonPlanDurations(45, ['5', '30', '10'])).toEqual({
      ok: true,
      durations: [5, 30, 10],
    });
  });
});
