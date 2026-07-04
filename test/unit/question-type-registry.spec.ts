import { AnswerRecordStatus } from '@prisma/client';
import { QuestionTypeRegistry } from '../../src/modules/question-types/question-type-registry.service';

describe('QuestionTypeRegistry', () => {
  const registry = new QuestionTypeRegistry();

  it('registers the complete baseline with safe public metadata', () => {
    expect(registry.descriptors().map((item) => item.code)).toEqual([
      'single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer',
      'programming', 'file_upload', 'scratch_project', 'arduino_project', 'material',
    ]);
    expect(registry.descriptors().every((item) => item.version === 1 && item.responseSchema)).toBe(true);
  });

  it('supports exact, partial-no-wrong and penalty multiple-choice modes with details', () => {
    const snapshot = { type: 'multiple_choice', answer: { correctOptionIds: ['a', 'b'] } };
    const partial = registry.grade({
      snapshot: { ...snapshot, scoringRule: { mode: 'partial_no_wrong' } },
      answer: { selectedOptionIds: ['a'] }, maxScore: 10,
    });
    expect(partial.score).toBe(5);
    expect(partial.details).toMatchObject({ mode: 'partial_no_wrong', matchedOptionIds: ['a'] });

    const penalty = registry.grade({
      snapshot: { ...snapshot, scoringRule: { mode: 'partial_penalty', incorrectPenalty: 2 } },
      answer: { selectedOptionIds: ['a', 'x'] }, maxScore: 10,
    });
    expect(penalty.score).toBe(3);
  });

  it('grades text, numeric tolerance and safe regex blanks item by item', () => {
    const result = registry.grade({
      snapshot: {
        type: 'fill_blank',
        answer: { blanks: [
          { index: 1, answers: ['Hello'], ignoreCase: true, score: 2 },
          { index: 2, answers: ['3.14'], matchMode: 'numeric', tolerance: 0.01, score: 2 },
          { index: 3, answers: ['^a+$'], matchMode: 'regex', score: 2 },
        ] },
      },
      answer: { blanks: [{ index: 1, value: ' hello ' }, { index: 2, value: '3.145' }, { index: 3, value: 'aaa' }] },
      maxScore: 6,
    });
    expect(result).toMatchObject({ score: 6, isCorrect: true, status: AnswerRecordStatus.AUTO_GRADED });
    expect((result.details.blanks as unknown[])).toHaveLength(3);
  });

  it('rejects malformed responses and leaves manual, judge and material types pending', () => {
    expect(() => registry.normalizeResponse('multiple_choice', { selectedOptionIds: ['a', 'a'] })).toThrow('答案格式不合法');
    expect(registry.grade({ snapshot: { type: 'short_answer' }, answer: { text: 'x' }, maxScore: 5 }).status)
      .toBe(AnswerRecordStatus.MANUAL_NEEDED);
    expect(registry.grade({ snapshot: { type: 'programming' }, answer: { code: 'x' }, maxScore: 5 }).status)
      .toBe(AnswerRecordStatus.JUDGE_PENDING);
    expect(registry.grade({ snapshot: { type: 'material' }, answer: {}, maxScore: 0 }).warnings[0])
      .toContain('不直接判分');
  });
});
