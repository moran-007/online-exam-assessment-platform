export const LESSON_RECORD_DRAFT_FIELDS = [
  'internalTeachingNotes',
  'internalClassPerformance',
  'publicTeachingContent',
  'publicLearningGoal',
  'publicClassPerformance',
  'publicHomework',
  'publicNextPlan',
  'publicMaterials',
] as const;

export type LessonRecordDraftField = (typeof LESSON_RECORD_DRAFT_FIELDS)[number];
export type LessonRecordDraft = Partial<Record<LessonRecordDraftField, string>>;

export function nonEmptyLessonRecordDraft(source: Record<string, unknown>): LessonRecordDraft {
  const result: LessonRecordDraft = {};
  for (const key of LESSON_RECORD_DRAFT_FIELDS) {
    const value = source[key];
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) result[key] = text;
  }
  return result;
}

export function hasLessonRecordDraftConflict(
  current: Record<string, unknown>,
  replacement: LessonRecordDraft,
) {
  return Object.entries(replacement).some(([key, value]) => {
    const existing = current[key];
    return typeof existing === 'string' && existing.trim() !== '' && existing.trim() !== value;
  });
}

export function isMessageBoxDismissal(reason: unknown) {
  return reason === 'cancel' || reason === 'close';
}
