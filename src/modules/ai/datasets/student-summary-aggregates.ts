import { ratio } from '../../statistics/statistics-math';

export type StudentAnswerFact = {
  type: string;
  score: number;
  maxScore: number;
  isCorrect: boolean | null;
  knowledgePoints: Array<{ id: string; name: string }>;
};

type Aggregate = {
  answerCount: number;
  correctCount: number;
  score: number;
  maxScore: number;
};

export function aggregateQuestionTypes(answers: StudentAnswerFact[]) {
  const groups = new Map<string, Aggregate>();
  for (const answer of answers) add(groups, answer.type, answer);
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, aggregate]) => ({ type, ...rates(aggregate) }));
}

export function aggregateKnowledgePoints(answers: StudentAnswerFact[]) {
  const groups = new Map<string, Aggregate & { id: string; name: string }>();
  for (const answer of answers) {
    for (const point of answer.knowledgePoints) {
      const current = groups.get(point.id) ?? { id: point.id, name: point.name, ...emptyAggregate() };
      accumulate(current, answer);
      groups.set(point.id, current);
    }
  }
  return [...groups.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, name, ...aggregate }) => ({ id, name, ...rates(aggregate) }));
}

export function programmingSummary(submissions: Array<{ status: string; score: number | null }>) {
  const acceptedCount = submissions.filter((item) => item.status.toLowerCase() === 'accepted').length;
  const scores = submissions.map((item) => item.score).filter((score): score is number => score !== null);
  return {
    submissionCount: submissions.length,
    acceptedCount,
    acceptedRate: ratio(acceptedCount, submissions.length),
    averageScore: scores.length
      ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2))
      : 0,
  };
}

function add(groups: Map<string, Aggregate>, key: string, answer: StudentAnswerFact) {
  const current = groups.get(key) ?? emptyAggregate();
  accumulate(current, answer);
  groups.set(key, current);
}

function accumulate(aggregate: Aggregate, answer: StudentAnswerFact) {
  aggregate.answerCount += 1;
  aggregate.correctCount += answer.isCorrect === true ? 1 : 0;
  aggregate.score += answer.score;
  aggregate.maxScore += answer.maxScore;
}

function rates(aggregate: Aggregate) {
  return {
    answerCount: aggregate.answerCount,
    correctRate: ratio(aggregate.correctCount, aggregate.answerCount),
    scoreRate: ratio(aggregate.score, aggregate.maxScore),
  };
}

function emptyAggregate(): Aggregate {
  return { answerCount: 0, correctCount: 0, score: 0, maxScore: 0 };
}
