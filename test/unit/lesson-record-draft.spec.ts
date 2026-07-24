import {
  hasLessonRecordDraftConflict,
  isMessageBoxDismissal,
  nonEmptyLessonRecordDraft,
} from '../../frontend/src/features/lesson-records/composables/lessonRecordDraft';

describe('lesson record AI draft merge', () => {
  it('omits missing, invalid and blank AI fields so they cannot clear existing content', () => {
    const current = {
      publicTeachingContent: '原有教学内容',
      publicLearningGoal: '原有学习目标',
      publicHomework: '原有作业',
    };
    const replacement = nonEmptyLessonRecordDraft({
      publicTeachingContent: '  新教学内容  ',
      publicLearningGoal: '',
      publicHomework: undefined,
      unknownField: '不可写入',
    });

    expect({ ...current, ...replacement }).toEqual({
      publicTeachingContent: '新教学内容',
      publicLearningGoal: '原有学习目标',
      publicHomework: '原有作业',
    });
  });

  it('requires confirmation only when a non-empty field would actually change', () => {
    const current = {
      publicTeachingContent: '相同内容',
      publicLearningGoal: '',
    };

    expect(hasLessonRecordDraftConflict(current, {
      publicTeachingContent: '相同内容',
      publicLearningGoal: '新增目标',
    })).toBe(false);
    expect(hasLessonRecordDraftConflict(current, {
      publicTeachingContent: '不同内容',
    })).toBe(true);
  });

  it('recognizes Element Plus confirmation dismissal actions', () => {
    expect(isMessageBoxDismissal('cancel')).toBe(true);
    expect(isMessageBoxDismissal('close')).toBe(true);
    expect(isMessageBoxDismissal(new Error('network error'))).toBe(false);
  });
});
