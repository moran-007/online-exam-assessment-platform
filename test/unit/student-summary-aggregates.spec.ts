import {
  aggregateKnowledgePoints,
  aggregateQuestionTypes,
  programmingSummary,
  type StudentAnswerFact,
} from '../../src/modules/ai/datasets/student-summary-aggregates';

describe('student summary aggregates', () => {
  const answers: StudentAnswerFact[] = [
    {
      type: 'single_choice', score: 8, maxScore: 10, isCorrect: true,
      knowledgePoints: [{ id: 'kp-1', name: '变量' }],
    },
    {
      type: 'single_choice', score: 2, maxScore: 10, isCorrect: false,
      knowledgePoints: [{ id: 'kp-1', name: '变量' }, { id: 'kp-2', name: '循环' }],
    },
    {
      type: 'programming', score: 6, maxScore: 10, isCorrect: null,
      knowledgePoints: [{ id: 'kp-2', name: '循环' }],
    },
  ];

  it('calculates question-type correctness and score rates independently', () => {
    expect(aggregateQuestionTypes(answers)).toEqual([
      { type: 'programming', answerCount: 1, correctRate: 0, scoreRate: 0.6 },
      { type: 'single_choice', answerCount: 2, correctRate: 0.5, scoreRate: 0.5 },
    ]);
  });

  it('attributes an answer to every linked knowledge point without reading answer text', () => {
    expect(aggregateKnowledgePoints(answers)).toEqual([
      { id: 'kp-1', name: '变量', answerCount: 2, correctRate: 0.5, scoreRate: 0.5 },
      { id: 'kp-2', name: '循环', answerCount: 2, correctRate: 0, scoreRate: 0.4 },
    ]);
  });

  it('summarizes programming submissions with stable zero-data behavior', () => {
    expect(programmingSummary([
      { status: 'accepted', score: 100 },
      { status: 'wrong_answer', score: 0 },
      { status: 'accepted', score: null },
    ])).toEqual({ submissionCount: 3, acceptedCount: 2, acceptedRate: 0.6667, averageScore: 50 });
    expect(programmingSummary([])).toEqual({
      submissionCount: 0, acceptedCount: 0, acceptedRate: 0, averageScore: 0,
    });
  });
});
